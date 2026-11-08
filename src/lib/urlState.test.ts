import { describe, expect, it } from 'vitest';
import { parseFilters, parseHash, serializeFilters } from './urlState.ts';

describe('url state', () => {
  it('round-trips filters and parses entry hashes', () => {
    const f = { q: 'side bar', cat: 'components', tags: ['motion', 'css'] };
    expect(serializeFilters(f)).toBe('?q=side+bar&cat=components&tags=motion,css');
    expect(parseFilters(serializeFilters(f))).toEqual(f);
    expect(parseFilters('')).toEqual({ q: '', cat: 'all', tags: [] });
    expect(parseHash('#di-041')).toBe('di-041');
    expect(parseHash('#foo')).toBeNull();
  });
});
