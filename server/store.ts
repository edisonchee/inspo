import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { Entry, EntryInput, Gallery, Tag } from '../src/lib/types.ts';
import { FACETS } from '../src/lib/types.ts';
import { ID_RE, TAG_RE, formatId, idNumber, slugify } from '../src/lib/ids.ts';
import { mediaTypeFor, posterFile } from '../src/lib/media.ts';
import { validateGallery } from '../src/lib/validate.ts';
import { makePoster } from './posters.ts';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const bad = (msg: string) => new HttpError(400, msg);

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function createStore(dataDir: string) {
  const galleryPath = path.join(dataDir, 'gallery.json');
  const mediaDir = path.join(dataDir, 'media');
  const abs = (file: string) => path.join(dataDir, file);

  // Serialise every mutation so concurrent requests can't interleave read-modify-write.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function read(): Promise<Gallery> {
    return JSON.parse(await fs.readFile(galleryPath, 'utf8'));
  }

  async function listMediaFiles(): Promise<string[]> {
    const names = await fs.readdir(mediaDir, { withFileTypes: true });
    return names.filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => `media/${d.name}`);
  }

  /** Media files waiting in incoming/ (any depth; dot-folders such as `.frames` skipped), as `incoming/…` paths. */
  async function listIncoming(): Promise<string[]> {
    const out: string[] = [];
    async function walk(rel: string): Promise<void> {
      const entries = await fs.readdir(abs(rel), { withFileTypes: true }).catch(() => []);
      for (const d of entries) {
        if (d.name.startsWith('.')) continue;
        const child = `${rel}/${d.name}`;
        if (d.isDirectory()) await walk(child);
        else if (d.isFile() && mediaTypeFor(d.name)) out.push(child);
      }
    }
    await walk('incoming');
    return out.sort();
  }

  async function write(g: Gallery): Promise<void> {
    const errors = validateGallery(g, { mediaFiles: await listMediaFiles() });
    if (errors.length) throw bad(errors.join('; '));
    const tmp = `${galleryPath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(g, null, 2) + '\n');
    await fs.rename(tmp, galleryPath);
  }

  async function exists(p: string): Promise<boolean> {
    return fs.access(p).then(
      () => true,
      () => false,
    );
  }

  /** A free `media/<id>-<slug><ext>` path for this entry. */
  async function canonicalName(id: string, originalName: string): Promise<string> {
    const ext = path.extname(originalName).toLowerCase();
    let base = slugify(path.basename(originalName, path.extname(originalName)));
    // Files that are already named for some entry keep their slug only.
    base = base.replace(/^di-\d{3,}-/, '');
    for (let n = 1; ; n++) {
      const file = `media/${id}-${base}${n > 1 ? `-${n}` : ''}${ext}`;
      if (!(await exists(abs(file)))) return file;
    }
  }

  /** Detach a file from its entry: the file stays in media/ (unreferenced, attachable again); its derived poster goes. */
  async function releaseMedia(file: string): Promise<void> {
    await fs.rm(abs(posterFile(file)), { force: true });
  }

  function checkInput(g: Gallery, input: EntryInput): void {
    if (typeof input?.title !== 'string' || !input.title.trim()) throw bad('title is required');
    if (typeof input.why !== 'string') throw bad('why must be a string');
    if (!g.categories.some((c) => c.id === input.category)) throw bad(`unknown category "${input.category}"`);
    if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string')) throw bad('tags must be strings');
    if (typeof input.source?.label !== 'string' || typeof input.source?.url !== 'string') {
      throw bad('source needs label and url');
    }
    if (!Array.isArray(input.media) || input.media.some((m) => typeof m !== 'string')) throw bad('media must be file paths');
  }

  /**
   * Resolve the requested media list for an entry. Files already on the entry are kept as-is;
   * other files must be unreferenced files in media/ or files in incoming/; both are moved/renamed into
   * media/ with the entry's naming.
   * Returns the new list plus files removed from the entry (released, not deleted, after a successful write).
   */
  async function resolveMedia(g: Gallery, entry: Entry | null, id: string, requested: string[]) {
    const current = new Map((entry?.media ?? []).map((m) => [m.file, m]));
    const usedElsewhere = new Set(g.entries.filter((e) => e.id !== id).flatMap((e) => e.media.map((m) => m.file)));
    const media: Entry['media'] = [];
    const renames: [string, string][] = [];
    for (const file of requested) {
      const kept = current.get(file);
      if (kept) {
        media.push(kept);
        continue;
      }
      const fromMedia = /^media\/[^/]+$/.test(file) && !usedElsewhere.has(file);
      const fromIncoming = /^incoming\/[^\0]+$/.test(file) && !file.split('/').some((p) => p === '..' || p.startsWith('.'));
      if (!(fromMedia || fromIncoming) || !(await exists(abs(file)))) {
        throw bad(`${file} is not an unreferenced file in media/ or a file in incoming/`);
      }
      const type = mediaTypeFor(file);
      if (!type) throw bad(`${file}: unsupported media type`);
      const target = await canonicalName(id, file.slice('media/'.length));
      renames.push([file, target]);
      media.push({ file: target, type });
    }
    const keep = new Set(requested);
    const removed = [...current.keys()].filter((f) => !keep.has(f));
    return { media, renames, removed };
  }

  async function applyRenames(renames: [string, string][]) {
    for (const [from, to] of renames) {
      await fs.rename(abs(from), abs(to));
      await fs.rm(abs(posterFile(from)), { force: true });
    }
  }

  /**
   * After files leave incoming/, remove each item folder they came from once it holds no media files.
   * What remains there is derived (frames, post metadata) and safe to drop. Loose files at the top stay.
   */
  async function pruneIncoming(renames: [string, string][]) {
    const dirs = new Set(renames.map(([from]) => from).filter((f) => f.startsWith('incoming/')).map((f) => f.split('/').slice(0, 2).join('/')));
    for (const dir of dirs) {
      if (dir.split('/').length < 2 || !(await fs.stat(abs(dir)).then((st) => st.isDirectory(), () => false))) continue;
      const left = (await listIncoming()).filter((f) => f.startsWith(`${dir}/`));
      if (!left.length) await fs.rm(abs(dir), { recursive: true, force: true });
    }
  }

  async function undoRenames(renames: [string, string][]) {
    for (const [from, to] of renames) await fs.rename(abs(to), abs(from)).catch(() => {});
  }

  async function postersFor(media: Entry['media']) {
    for (const m of media) if (m.type === 'video') await makePoster(abs(m.file), abs(posterFile(m.file)));
  }

  return {
    galleryPath,
    mediaDir,
    read,
    listMediaFiles,

    listIncoming,

    /** Files that can be attached to an entry: unreferenced files in media/, then everything in incoming/. */
    async unreferenced(): Promise<string[]> {
      const g = await read();
      const used = new Set(g.entries.flatMap((e) => e.media.map((m) => m.file)));
      const loose = (await listMediaFiles()).filter((f) => !used.has(f) && mediaTypeFor(f)).sort();
      return [...loose, ...(await listIncoming())];
    },

    /**
     * Create an entry. By default the ID comes from `next_id` and `added` is today; pass `id`/`added` to
     * mirror an item that already has them elsewhere (e.g. a capture document). `next_id` stays above every ID.
     */
    createEntry: (input: EntryInput, opts: { id?: string; added?: string } = {}) =>
      exclusive(async () => {
        const g = await read();
        checkInput(g, input);
        const id = opts.id ?? g.next_id;
        if (!ID_RE.test(id)) throw bad(`malformed id "${id}"`);
        if (g.entries.some((e) => e.id === id)) throw new HttpError(409, `${id} already exists`);
        if (opts.added !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.added)) throw bad('added must be YYYY-MM-DD');
        const nextId = formatId(Math.max(idNumber(g.next_id), idNumber(id) + 1));
        const { media, renames } = await resolveMedia(g, null, id, input.media);
        const entry: Entry = {
          id,
          added: opts.added ?? today(),
          category: input.category,
          title: input.title.trim(),
          source: { label: input.source.label.trim(), url: input.source.url.trim() },
          why: input.why.trim(),
          tags: [...new Set(input.tags)],
          media,
        };
        await applyRenames(renames);
        try {
          const entries = [entry, ...g.entries].sort((a, b) => idNumber(b.id) - idNumber(a.id));
          await write({ ...g, next_id: nextId, entries });
        } catch (e) {
          await undoRenames(renames);
          throw e;
        }
        await postersFor(media);
        await pruneIncoming(renames);
        return entry;
      }),

    updateEntry: (id: string, input: EntryInput) =>
      exclusive(async () => {
        const g = await read();
        const i = g.entries.findIndex((e) => e.id === id);
        if (i < 0) throw new HttpError(404, `no entry ${id}`);
        checkInput(g, input);
        const old = g.entries[i];
        const { media, renames, removed } = await resolveMedia(g, old, id, input.media);
        // Spread the old entry first so unknown extra fields survive.
        const entry: Entry = {
          ...old,
          category: input.category,
          title: input.title.trim(),
          source: { ...old.source, label: input.source.label.trim(), url: input.source.url.trim() },
          why: input.why.trim(),
          tags: [...new Set(input.tags)],
          media,
        };
        await applyRenames(renames);
        const entries = g.entries.slice();
        entries[i] = entry;
        try {
          await write({ ...g, entries });
        } catch (e) {
          await undoRenames(renames);
          throw e;
        }
        for (const f of removed) await releaseMedia(f);
        await postersFor(media.filter((m) => renames.some(([, to]) => to === m.file)));
        await pruneIncoming(renames);
        return entry;
      }),

    deleteEntry: (id: string) =>
      exclusive(async () => {
        const g = await read();
        const entry = g.entries.find((e) => e.id === id);
        if (!entry) throw new HttpError(404, `no entry ${id}`);
        await write({ ...g, entries: g.entries.filter((e) => e.id !== id) });
        for (const m of entry.media) await releaseMedia(m.file);
      }),

    addTag: (tag: Tag) =>
      exclusive(async () => {
        const g = await read();
        if (typeof tag?.tag !== 'string' || !TAG_RE.test(tag.tag)) throw bad('tag must be lowercase kebab-case');
        if (!FACETS.includes(tag.facet)) throw bad(`facet must be one of ${FACETS.join(', ')}`);
        if (g.tags.some((t) => t.tag === tag.tag)) throw new HttpError(409, `tag "${tag.tag}" already exists`);
        // Keep tags grouped by facet (in FACETS order) and alphabetical within a facet.
        const tags = [...g.tags, { tag: tag.tag, facet: tag.facet }].sort(
          (a, b) => FACETS.indexOf(a.facet) - FACETS.indexOf(b.facet) || a.tag.localeCompare(b.tag),
        );
        await write({ ...g, tags });
        return { tag: tag.tag, facet: tag.facet };
      }),

    /** Stream an upload into media/ and append it to the entry. */
    uploadMedia: (id: string, originalName: string, body: Readable) =>
      exclusive(async () => {
        if (!ID_RE.test(id)) throw bad('bad entry id');
        const type = mediaTypeFor(originalName);
        if (!type) throw bad(`${originalName}: unsupported media type`);
        const g = await read();
        const i = g.entries.findIndex((e) => e.id === id);
        if (i < 0) throw new HttpError(404, `no entry ${id}`);
        const file = await canonicalName(id, originalName);
        try {
          await pipeline(body, createWriteStream(abs(file), { flags: 'wx' }));
        } catch (e) {
          await fs.rm(abs(file), { force: true });
          throw e;
        }
        const entries = g.entries.slice();
        entries[i] = { ...entries[i], media: [...entries[i].media, { file, type }] };
        try {
          await write({ ...g, entries });
        } catch (e) {
          await fs.rm(abs(file), { force: true });
          throw e;
        }
        if (type === 'video') await makePoster(abs(file), abs(posterFile(file)));
        return entries[i];
      }),
  };
}

export type Store = ReturnType<typeof createStore>;
