// pnpm ingest <id> [url]   prepare one item in data/incoming/<id>/ and print a JSON summary
// pnpm ingest --list       show what is waiting in data/incoming/
//
// data/incoming/ is the drop folder for media that isn't in the gallery yet.
// - Semi-automated: the user drops files there, named or foldered by item ID
//   (`di-043.mp4`, `di-043-2.png`, or anything inside `di-043/`). Loose `di-043*` files are moved into `di-043/`.
// - Fully automated: with no files present and a URL given, media is downloaded into `di-043/`.
// Either way, an X URL also yields the post's text and author (public embed endpoint, no login), and every
// video gets frames in `di-043/.frames/` to look at. `pnpm entry put` (or the app's editor) moves the files
// into data/media/; the emptied folder is then removed.
// Requests carry only the generic USER_AGENT.
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FFMPEG_INPUT_GUARD, ROOT, USER_AGENT, YTDLP_SAFE_ARGS, requireSafe, run } from '../server/tools.ts';
import { ID_RE } from '../src/lib/ids.ts';
import { mediaTypeFor } from '../src/lib/media.ts';

const DATA = process.env.INSPO_DATA_DIR ?? path.join(ROOT, 'data');
const INCOMING = path.join(DATA, 'incoming');
const FRAMES_PER_VIDEO = 6;
const X_POST = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/i;
const rel = (p: string) => path.relative(DATA, p).split(path.sep).join('/');

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${new URL(url).host}: HTTP ${res.status}`);
  return res;
}

/** Public embed data for an X post (what embedded-tweet widgets use). */
async function xPost(id: string) {
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  const res = await get(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`);
  return (await res.json()) as {
    text?: string;
    user?: { screen_name?: string };
    mediaDetails?: { type: 'photo' | 'video' | 'animated_gif'; media_url_https: string }[];
  };
}

async function ytDlp(url: string, dir: string, direct: boolean): Promise<void> {
  const bin = await requireSafe('yt-dlp');
  const args = [...YTDLP_SAFE_ARGS, ...(direct ? [] : ['--use-extractors', 'default,-generic'])];
  await run(bin, [...args, '-o', path.join(dir, '%(autonumber)s.%(ext)s'), url], 10 * 60_000);
  // Keep post metadata out of the way of the media files.
  await fs.mkdir(path.join(dir, '.frames'), { recursive: true });
  for (const f of await fs.readdir(dir)) if (f.endsWith('.info.json')) await fs.rename(path.join(dir, f), path.join(dir, '.frames', f));
}

async function duration(ffmpeg: string, file: string): Promise<number> {
  // ffmpeg with no output exits non-zero but prints the input's duration.
  const out = await run(ffmpeg, ['-hide_banner', ...FFMPEG_INPUT_GUARD, '-i', file]).catch((e) => String(e.stderr ?? ''));
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function frames(ffmpeg: string, file: string, dir: string): Promise<string[]> {
  const len = await duration(ffmpeg, file);
  const n = len >= 3 ? FRAMES_PER_VIDEO : 1;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = n === 1 ? 0 : (len * (i + 0.5)) / n;
    const frame = path.join(dir, `${path.parse(file).name}-${i + 1}.jpg`);
    await run(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(2), ...FFMPEG_INPUT_GUARD, '-i', file,
      '-frames:v', '1', '-vf', "scale='min(768,iw)':-2", '-q:v', '4', frame,
    ]);
    out.push(frame);
  }
  return out;
}

/** Regular media files in a folder; symlinks are ignored so nothing outside data/ can be pulled in. */
async function mediaIn(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((d) => d.isFile() && !d.name.startsWith('.') && mediaTypeFor(d.name))
    .map((d) => path.join(dir, d.name))
    .sort();
}

async function list() {
  const names = await fs.readdir(INCOMING, { withFileTypes: true }).catch(() => []);
  const items: Record<string, string[]> = {};
  const unmatched: string[] = [];
  for (const d of names) {
    if (d.name.startsWith('.')) continue;
    if (d.isDirectory()) items[d.name] = (await mediaIn(path.join(INCOMING, d.name))).map(rel);
    else if (mediaTypeFor(d.name)) {
      const id = /^(di-\d{3,})(?![0-9])/.exec(d.name)?.[1];
      if (id) (items[id] ??= []).push(rel(path.join(INCOMING, d.name)));
      else unmatched.push(rel(path.join(INCOMING, d.name)));
    }
  }
  console.log(JSON.stringify({ items, unmatched }, null, 2));
}

async function prepare(id: string, url: string | undefined) {
  const dir = path.join(INCOMING, id);
  await fs.mkdir(dir, { recursive: true });

  // Gather loose files named for this ID.
  for (const d of await fs.readdir(INCOMING, { withFileTypes: true })) {
    if (d.isFile() && new RegExp(`^${id}(?![0-9])`).test(d.name) && mediaTypeFor(d.name)) {
      await fs.rename(path.join(INCOMING, d.name), path.join(dir, d.name));
    }
  }

  const x = url ? X_POST.exec(url) : null;
  const post = x ? await xPost(x[2]) : null;
  const provided = (await mediaIn(dir)).length > 0;
  let note: string | undefined;

  if (!provided && url) {
    if (x) {
      const details = post?.mediaDetails ?? [];
      let n = 100;
      for (const m of details.filter((d) => d.type === 'photo')) {
        const src = new URL(m.media_url_https);
        if (src.host !== 'pbs.twimg.com') continue;
        const to = path.join(dir, `${n++}${path.extname(src.pathname) || '.jpg'}`);
        await pipeline(Readable.fromWeb((await get(`${src.href}?name=orig`)).body as never), createWriteStream(to));
      }
      if (details.some((d) => d.type !== 'photo')) await ytDlp(url, dir, false);
      if (!details.length) note = 'post has no media: link-only entry';
    } else {
      try {
        await ytDlp(url, dir, mediaTypeFor(new URL(url).pathname) !== null);
      } catch (err) {
        const msg = String((err as { stderr?: string }).stderr ?? (err as Error).message);
        if (!/Unsupported URL|No suitable extractor|No video/i.test(msg)) throw err;
        note = 'no downloadable media at this URL: link-only entry (read the page title/description with WebFetch)';
      }
    }
  } else if (!provided) {
    note = 'no files in incoming/ for this ID and no URL given';
  }

  const files = await mediaIn(dir);
  const ffmpeg = files.some((f) => mediaTypeFor(f) === 'video') ? await requireSafe('ffmpeg') : '';
  const summary = {
    id,
    dir: rel(dir),
    media: provided ? 'provided by the user' : files.length ? 'downloaded' : 'none',
    author: post?.user?.screen_name ?? x?.[1] ?? null,
    text: post?.text ?? null,
    files: [] as { path: string; view: string; type: string; frames: string[] }[],
    ...(note ? { note } : {}),
  };
  if (files.length) await fs.mkdir(path.join(dir, '.frames'), { recursive: true });
  for (const file of files) {
    const type = mediaTypeFor(file)!;
    const shots = type === 'video' ? await frames(ffmpeg, file, path.join(dir, '.frames')) : [];
    // path: what `pnpm entry put` takes; view/frames: absolute paths to open and look at.
    summary.files.push({ path: rel(file), view: file, type, frames: shots });
  }
  if (!files.length) await fs.rm(dir, { recursive: true, force: true });
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const [a, b] = process.argv.slice(2);
  if (a === '--list') return list();
  if (!a || !ID_RE.test(a) || (b && !/^https?:\/\//.test(b))) {
    console.error('usage: pnpm ingest <id> [url]   |   pnpm ingest --list');
    process.exit(2);
  }
  await fs.mkdir(INCOMING, { recursive: true });
  await prepare(a, b);
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}${(err as { stderr?: string }).stderr ? `\n${(err as { stderr: string }).stderr}` : ''}`);
  process.exit(1);
});
