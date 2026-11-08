import { describe, expect, it } from 'vitest';
import type { Gallery } from './types.ts';
import { validateGallery } from './validate.ts';

const base = (): Gallery => ({
  schema: 'design-inspiration/v1',
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

  it('flags bad ids, unknown tags and categories, next_id and missing media', () => {
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
});
