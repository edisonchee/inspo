import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, Connect } from 'vite';
import { HttpError, createStore, type Store } from './store.ts';
import { makePoster } from './posters.ts';
import { mediaTypeFor } from '../src/lib/media.ts';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

/** Static file with Range support (needed for video seeking). */
async function serveFile(req: IncomingMessage, res: ServerResponse, file: string, next: Connect.NextFunction) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return next();
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

/** Posters are derived files: a missing `media/posters/<name>.jpg` is generated from `media/<name>.<video ext>` on first request. */
async function ensurePoster(dataDir: string, file: string): Promise<void> {
  const postersDir = path.join(dataDir, 'media', 'posters') + path.sep;
  if (!file.startsWith(postersDir) || !file.endsWith('.jpg') || existsSync(file)) return;
  const name = path.basename(file, '.jpg');
  const media = await fs.readdir(path.join(dataDir, 'media')).catch(() => [] as string[]);
  const video = media.find((f) => path.parse(f).name === name && mediaTypeFor(f) === 'video');
  if (video) await makePoster(path.join(dataDir, 'media', video), file);
}

export function createHandler(store: Store, dataDir: string): Connect.NextHandleFunction {
  const roots = [path.join(dataDir, 'media') + path.sep, path.join(dataDir, 'incoming') + path.sep];

  return (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const p = url.pathname;
    const method = req.method ?? 'GET';

    if ((p.startsWith('/media/') || p.startsWith('/incoming/')) && (method === 'GET' || method === 'HEAD')) {
      const file = path.join(dataDir, decodeURIComponent(p));
      if (!roots.some((r) => file.startsWith(r))) return send(res, 403, { error: 'forbidden' });
      ensurePoster(dataDir, file)
        .then(() => serveFile(req, res, file, next))
        .catch(next);
      return;
    }
    if (!p.startsWith('/api/')) return next();

    const route = async () => {
      let m: RegExpExecArray | null;
      if (p === '/api/gallery' && method === 'GET') return send(res, 200, await store.read());
      if (p === '/api/media/unreferenced' && method === 'GET') return send(res, 200, await store.unreferenced());
      if (p === '/api/entries' && method === 'POST') return send(res, 201, await store.createEntry(await readJson(req)));
      if ((m = /^\/api\/entries\/(di-\d+)$/.exec(p))) {
        if (method === 'PUT') return send(res, 200, await store.updateEntry(m[1], await readJson(req)));
        if (method === 'DELETE') {
          await store.deleteEntry(m[1]);
          return send(res, 200, { ok: true });
        }
      }
      if ((m = /^\/api\/entries\/(di-\d+)\/media$/.exec(p)) && method === 'POST') {
        const name = url.searchParams.get('name');
        if (!name) throw new HttpError(400, 'name query parameter is required');
        return send(res, 201, await store.uploadMedia(m[1], name, req));
      }
      if (p === '/api/tags' && method === 'POST') return send(res, 201, await store.addTag(await readJson(req)));
      send(res, 404, { error: `no route ${method} ${p}` });
    };

    route().catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[inspo]', err);
      send(res, status, { error: err.message });
    });
  };
}

export function inspoApi(dataDir = process.env.INSPO_DATA_DIR ?? path.resolve('data')): Plugin {
  const handler = createHandler(createStore(dataDir), dataDir);
  return {
    name: 'inspo-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
