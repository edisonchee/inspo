// pnpm entry put <file.json>
// pnpm entry source-doc <link>  record the capture document's link in gallery.json (source_doc)
// Create or update one gallery entry from JSON, validated and written atomically by the store.
//
// {
//   "id": "di-042", "added": "2026-11-08",            // optional: keep the capture document's ID and date
//   "title": "…", "why": "…", "category": "components", "tags": ["motion"],
//   "source": { "label": "someone on X", "url": "https://…" },
//   "media": ["incoming/di-042/00001.mp4", "media/di-042-old.mp4"], // incoming/… is moved in; media/… kept
//   "newTags": [{ "tag": "scroll-snap", "facet": "Technique" }]     // optional: added to the vocabulary first
// }
//
// Incoming files end up as data/media/di-NNN-<title-slug>.<ext>; video posters are made, and the emptied
// incoming/<id>/ folder is removed.
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createStore } from '../server/store.ts';
import { ROOT } from '../server/tools.ts';
import { slugify } from '../src/lib/ids.ts';
import type { EntryInput, Tag } from '../src/lib/types.ts';

interface Put extends EntryInput {
  id?: string;
  added?: string;
  newTags?: Tag[];
}

async function main() {
  const [cmd, file] = process.argv.slice(2);
  if (cmd === 'source-doc' && file) {
    const dataDir = process.env.INSPO_DATA_DIR ?? path.join(ROOT, 'data');
    console.log(await createStore(dataDir).setSourceDoc(file));
    return;
  }
  if (cmd !== 'put' || !file) {
    console.error('usage: pnpm entry put <file.json> | pnpm entry source-doc <link>');
    process.exit(2);
  }
  const put = JSON.parse(await fs.readFile(file, 'utf8')) as Put;
  const dataDir = process.env.INSPO_DATA_DIR ?? path.join(ROOT, 'data');
  const store = createStore(dataDir);
  const g = await store.read();

  for (const t of put.newTags ?? []) if (!g.tags.some((x) => x.tag === t.tag)) await store.addTag(t);

  // Name incoming files after the title, so the store's final name is di-NNN-<title-slug>.<ext>.
  // Check every incoming path before touching any file: a regular file inside data/incoming/, no symlinks.
  const incoming = path.join(path.resolve(dataDir), 'incoming') + path.sep;
  for (const m of (put.media ?? []).filter((x) => x.startsWith('incoming/'))) {
    const st = await fs.lstat(path.resolve(dataDir, m)).catch(() => null);
    if (!path.resolve(dataDir, m).startsWith(incoming) || !st?.isFile()) throw new Error(`${m}: not a regular file inside data/incoming/`);
  }

  const renamed: [string, string][] = [];
  const media: string[] = [];
  for (const m of put.media ?? []) {
    if (!m.startsWith('incoming/')) {
      media.push(m);
      continue;
    }
    const from = path.resolve(dataDir, m);
    const ext = path.extname(m).toLowerCase();
    let to = path.join(path.dirname(from), `${slugify(put.title)}${ext}`);
    for (let n = 2; to !== from && existsSync(to); n++) to = path.join(path.dirname(from), `${slugify(put.title)}-${n}${ext}`);
    await fs.rename(from, to);
    renamed.push([from, to]);
    media.push(path.relative(dataDir, to).split(path.sep).join('/'));
  }

  const input: EntryInput = {
    title: put.title,
    why: put.why ?? '',
    category: put.category,
    tags: put.tags ?? [],
    source: put.source,
    media,
  };
  try {
    const exists = put.id !== undefined && g.entries.some((e) => e.id === put.id);
    const entry = exists ? await store.updateEntry(put.id!, input) : await store.createEntry(input, { id: put.id, added: put.added });
    console.log(JSON.stringify(entry, null, 2));
  } catch (err) {
    for (const [from, to] of renamed.reverse()) await fs.rename(to, from).catch(() => {});
    throw err;
  }
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
