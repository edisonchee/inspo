import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createStore, HttpError } from './store.ts';
import type { EntryInput } from '../src/lib/types.ts';

let dir: string;
const input = (over: Partial<EntryInput> = {}): EntryInput => ({
  title: 'New thing', why: 'Because', category: 'techniques', tags: ['css'],
  source: { label: 'Someone', url: 'https://example.com' }, media: [], ...over,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'inspo-'));
  mkdirSync(path.join(dir, 'media'));
  writeFileSync(path.join(dir, 'media', 'di-001-a.png'), 'png');
  writeFileSync(path.join(dir, 'gallery.json'), JSON.stringify({
    schema: 'design-inspiration/v1', exported: '2026-11-08', next_id: 'di-002', extra: 'keep-me',
    categories: [{ id: 'techniques', name: 'T', rule: '' }, { id: 'inbox', name: 'I', rule: '' }],
    tags: [{ tag: 'css', facet: 'Technique' }],
    entries: [{ id: 'di-001', added: '2026-01-01', category: 'techniques', title: 'A',
      source: { label: 'x', url: 'https://x.com' }, why: '', tags: [], custom: 1,
      media: [{ file: 'media/di-001-a.png', type: 'image' }] }],
  }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const json = () => JSON.parse(readFileSync(path.join(dir, 'gallery.json'), 'utf8'));

const media = (f: string) => existsSync(path.join(dir, 'media', f));

describe('store', () => {
  it('creates entries with the next id, preserving unknown fields', async () => {
    const s = createStore(dir);
    expect((await s.createEntry(input())).id).toBe('di-002');
    const g = json();
    expect(g).toMatchObject({ next_id: 'di-003', extra: 'keep-me' });
    expect(g.entries.map((x: any) => x.id)).toEqual(['di-002', 'di-001']);
  });

  it('creates an entry with a given id and date, keeping next_id above it', async () => {
    const s = createStore(dir);
    await s.createEntry(input(), { id: 'di-007', added: '2026-10-01' });
    expect(json()).toMatchObject({ next_id: 'di-008' });
    expect(json().entries.map((x: any) => [x.id, x.added])).toEqual([['di-007', '2026-10-01'], ['di-001', '2026-01-01']]);
    await expect(s.createEntry(input(), { id: 'di-007' })).rejects.toThrow(/exists/);
  });

  it('rejects invalid input', async () => {
    const s = createStore(dir);
    await expect(s.createEntry(input({ title: ' ' }))).rejects.toBeInstanceOf(HttpError);
    await expect(s.createEntry(input({ tags: ['nope'] }))).rejects.toThrow(/not in tags/);
    expect(json().next_id).toBe('di-002');
  });

  it('updates an entry; removed media stays on disk, unreferenced', async () => {
    const s = createStore(dir);
    await s.updateEntry('di-001', input({ title: 'A2', media: [] }));
    expect(json().entries[0]).toMatchObject({ title: 'A2', custom: 1, media: [] });
    expect(media('di-001-a.png')).toBe(true);
    expect(await s.unreferenced()).toEqual(['media/di-001-a.png']);
  });

  it('deletes an entry, keeping its media and never reusing its id', async () => {
    const s = createStore(dir);
    await s.deleteEntry('di-001');
    expect(media('di-001-a.png')).toBe(true);
    expect((await s.createEntry(input())).id).toBe('di-002');
    const e = await s.createEntry(input());
    await s.deleteEntry(e.id);
    expect((await s.createEntry(input())).id).toBe('di-004');
  });

  it('attaches an unreferenced file, renaming it for the entry', async () => {
    writeFileSync(path.join(dir, 'media', 'Cool Shot.PNG'), 'png');
    const s = createStore(dir);
    const e = await s.createEntry(input({ media: ['media/Cool Shot.PNG'] }));
    expect(e.media).toEqual([{ file: 'media/di-002-cool-shot.png', type: 'image' }]);
    expect(media('di-002-cool-shot.png')).toBe(true);
    await expect(s.createEntry(input({ media: ['media/di-001-a.png'] }))).rejects.toThrow(/not an unreferenced/);
  });

  it('attaches files from incoming/, moving them into media/ and pruning the emptied folder', async () => {
    mkdirSync(path.join(dir, 'incoming', 'di-002', '.frames'), { recursive: true });
    writeFileSync(path.join(dir, 'incoming', 'di-002', 'Hero Shot.png'), 'png');
    writeFileSync(path.join(dir, 'incoming', 'di-002', '.frames', 'f1.jpg'), 'jpg');
    writeFileSync(path.join(dir, 'incoming', 'loose.png'), 'png');
    const s = createStore(dir);
    expect(await s.unreferenced()).toEqual(['incoming/di-002/Hero Shot.png', 'incoming/loose.png']);
    const e = await s.createEntry(input({ media: ['incoming/di-002/Hero Shot.png'] }), { id: 'di-002' });
    expect(e.media).toEqual([{ file: 'media/di-002-hero-shot.png', type: 'image' }]);
    expect(existsSync(path.join(dir, 'incoming', 'di-002'))).toBe(false);
    expect(existsSync(path.join(dir, 'incoming', 'loose.png'))).toBe(true);
    await expect(s.createEntry(input({ media: ['incoming/../gallery.json'] }))).rejects.toThrow(/incoming/);
  });

  it('uploads media and adds tags', async () => {
    const s = createStore(dir);
    const e = await s.createEntry(input());
    const after = await s.uploadMedia(e.id, 'My Clip.png', Readable.from([Buffer.from('img')]));
    expect(after.media).toEqual([{ file: 'media/di-002-my-clip.png', type: 'image' }]);
    await expect(s.uploadMedia(e.id, 'notes.txt', Readable.from([]))).rejects.toThrow(/unsupported/);
    await s.addTag({ tag: 'blur', facet: 'Technique' });
    expect(json().tags.map((t: any) => t.tag)).toEqual(['blur', 'css']);
    await expect(s.addTag({ tag: 'css', facet: 'Technique' })).rejects.toThrow(/exists/);
  });
});
