import { describe, expect, it } from 'vitest';
import type { Entry } from './types.ts';
import { filterCategory, highlight, indexEntries, searchEntries } from './search.ts';

const entry = (id: string, over: Partial<Entry>): Entry => ({
  id, added: '2026-01-01', category: 'techniques', title: '', why: '', tags: [],
  source: { label: '', url: '' }, media: [], ...over,
});
const entries = [
  entry('di-001', { title: 'Card hover', why: 'A sidebar trick', tags: ['css'] }),
  entry('di-002', { title: 'Liquid sidebar', tags: ['motion', 'css'], category: 'components' }),
  entry('di-003', { title: 'Café menu', tags: ['motion'] }),
];
const index = indexEntries(entries);
const ids = (q: string, tags: string[] = []) => searchEntries(index, q, tags).map((e) => e.id);

describe('search', () => {
  it('lists newest first and filters by category', () => {
    expect(ids('')).toEqual(['di-003', 'di-002', 'di-001']);
    expect(filterCategory(searchEntries(index, '', []), 'components').map((e) => e.id)).toEqual(['di-002']);
  });

  it('ranks title hits above why hits; every word must match, ignoring case and diacritics', () => {
    expect(ids('sidebar')).toEqual(['di-002', 'di-001']);
    expect(ids('LIQUID sídebar')).toEqual(['di-002']);
    expect(ids('cafe')).toEqual(['di-003']);
    expect(ids('di-001')).toEqual(['di-001']);
    expect(ids('sidebar zzz')).toEqual([]);
  });

  it('combines tags with AND', () => {
    expect(ids('', ['motion', 'css'])).toEqual(['di-002']);
  });

  it('highlights matches on the original text', () => {
    expect(highlight('Café Sidebar', ['cafe', 'side'])).toEqual([
      { text: 'Café', hit: true },
      { text: ' ', hit: false },
      { text: 'Side', hit: true },
      { text: 'bar', hit: false },
    ]);
  });
});
