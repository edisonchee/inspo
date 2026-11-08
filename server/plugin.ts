import { createReadStream, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
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

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Yields the request body, failing with 413 once it passes `max` bytes. */
async function* capped(req: IncomingMessage, max: number): AsyncGenerator<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > max) throw new HttpError(413, `body larger than ${max} bytes`);
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) throw new HttpError(413, `body larger than ${max} bytes`);
    yield c as Buffer;
  }
}

/**
 * True when a browser sent this request on behalf of another site (cross-site request forgery).
 * Browsers always send Sec-Fetch-Site and/or Origin on such requests; local tools without them pass.
 */
function crossSite(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function readJson(req: IncomingMessage): Promise<any> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'expected Content-Type: application/json');
  const chunks: Buffer[] = [];
  for await (const c of capped(req, MAX_JSON_BYTES)) chunks.push(c);
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
  // Media is data, never a page: no scripts (e.g. inside an SVG) even when opened directly.
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
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
        .then(async () => {
          // Serve only files whose real location is inside media/ or incoming/ (no symlinks out).
          const real = await fs.realpath(file).catch(() => null);
          const realRoots = await Promise.all(roots.map((r) => fs.realpath(r).then((x) => x + path.sep, () => null)));
          if (!real) return next();
          if (!realRoots.some((r) => r && real.startsWith(r))) return send(res, 403, { error: 'forbidden' });
          return serveFile(req, res, real, next);
        })
        .catch(next);
      return;
    }
    if (!p.startsWith('/api/')) return next();
    if (crossSite(req)) return send(res, 403, { error: 'cross-site request refused' });

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
        // A custom header can't be sent cross-site without a CORS preflight, which this server never grants.
        if (req.headers['x-inspo-upload'] !== '1') throw new HttpError(400, 'missing X-Inspo-Upload header');
        return send(res, 201, await store.uploadMedia(m[1], name, Readable.from(capped(req, MAX_UPLOAD_BYTES))));
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
