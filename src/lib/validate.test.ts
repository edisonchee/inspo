import { describe, expect, it } from 'vitest';
import type { Gallery } from './types.ts';
import { validateGallery } from './validate.ts';

const base = (): Gallery => ({
  schema: 'inspo/v1',
  next_id: 'di-003',
  categories: [{ id: 'techniques', name: 'Techniques', rule: '' }],
  tags: [{ tag: 'css', facet: 'Technique' }],
  entries: [
    { id: 'di-002', added: '2026-01-01', category: 'techniques', title: 'B', why: '', tags: ['css'],
      source: { label: 'x', url: 'https://x.com' }, media: [{ file: 'media/di-002-b.mp4', type: 'video' }] },
    { id: 'di-001', added: '2026-01-01', category: 'techniques', title: 'A', why: '', tags: [],
      source: { label: 'x', url: 'https://x.com' }, media: [] },
  ],
});

describe('validateGallery', () => {
  it('accepts valid data, including unreferenced files', () => {
    expect(validateGallery(base(), { mediaFiles: ['media/di-002-b.mp4', 'media/stray.png'] })).toEqual([]);
  });

  it('reports structural problems from the JSON Schema, naming the entry', () => {
    const g = base() as any;
    g.schema = 'other/v9';
    g.entries[0].title = '  ';
    g.entries[0].media[0].type = 'audio';
    g.entries[1].source.url = 'ftp://x';
    g.tags[0].facet = 'Mood';
    const errs = validateGallery(g, { mediaFiles: [] }).join('\n');
    expect(errs).toMatch(/^schema must be equal to constant/m);
    expect(errs).toMatch(/entries\[0\] \(di-002\)\.title must match pattern/);
    expect(errs).toMatch(/entries\[0\] \(di-002\)\.media\.0\.type must be equal to one of the allowed values/);
    expect(errs).toMatch(/entries\[1\] \(di-001\)\.source\.url must match pattern/);
    expect(errs).toMatch(/tags\.0\.facet must be equal to one of the allowed values/);
  });

  it('flags cross-reference problems: ids, tags, categories, next_id, missing media', () => {
    const g = base();
    g.entries[1].id = 'di-002';
    g.entries[0].tags = ['nope'];
    g.entries[0].category = 'nope';
    g.next_id = 'di-002';
    const errs = validateGallery(g, { mediaFiles: [] }).join('\n');
    expect(errs).toMatch(/duplicate id di-002/);
    expect(errs).toMatch(/tag "nope" is not in tags/);
    expect(errs).toMatch(/unknown category "nope"/);
    expect(errs).toMatch(/not below next_id/);
    expect(errs).toMatch(/missing media file media\/di-002-b.mp4/);
  });

  it('keeps unknown fields valid', () => {
    const g = { ...base(), extra: 1, entries: base().entries.map((e) => ({ ...e, custom: true })) };
    expect(validateGallery(g, { mediaFiles: ['media/di-002-b.mp4'] })).toEqual([]);
  });
});
