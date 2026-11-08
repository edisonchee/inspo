import type { Filters } from './search.ts';
import { ID_RE } from './ids.ts';

export function parseFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  return {
    q: p.get('q') ?? '',
    cat: p.get('cat') || 'all',
    tags: (p.get('tags') ?? '').split(',').filter(Boolean),
  };
}

export function serializeFilters(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.cat && f.cat !== 'all') p.set('cat', f.cat);
  if (f.tags.length) p.set('tags', f.tags.join(','));
  const s = p.toString().replace(/%2C/g, ',');
  return s ? `?${s}` : '';
}

/** `#di-041` → `di-041`; anything else → null. */
export function parseHash(hash: string): string | null {
  const id = hash.replace(/^#/, '');
  return ID_RE.test(id) ? id : null;
}
