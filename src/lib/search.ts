import type { Entry } from './types.ts';
import { byIdDesc } from './ids.ts';

const DIACRITICS = /\p{Diacritic}/gu;

export function normalize(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

export function tokenize(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

// Field weights: title hits rank above tag/id/source hits, which rank above why hits.
const WEIGHTS = { title: 8, tags: 4, id: 4, source: 2, why: 1 } as const;
type Field = keyof typeof WEIGHTS;

interface Indexed {
  entry: Entry;
  fields: Record<Field, string>;
}

export function indexEntries(entries: Entry[]): Indexed[] {
  return entries.map((entry) => ({
    entry,
    fields: {
      title: normalize(entry.title),
      tags: normalize(entry.tags.join(' ')),
      id: normalize(entry.id),
      source: normalize(entry.source.label),
      why: normalize(entry.why),
    },
  }));
}

/** Score an entry against tokens; 0 means "not every token matched". */
export function score(item: Indexed, tokens: string[]): number {
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of Object.keys(WEIGHTS) as Field[]) {
      if (item.fields[field].includes(token)) best = Math.max(best, WEIGHTS[field]);
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

export interface Filters {
  q: string;
  cat: string; // 'all' or a category id
  tags: string[];
}

export function matchesTags(entry: Entry, tags: string[]): boolean {
  return tags.every((t) => entry.tags.includes(t));
}

/**
 * Apply search + tag filters (not category), ranked. Category is applied separately
 * so the category switcher can show counts for the current search.
 */
export function searchEntries(index: Indexed[], q: string, tags: string[]): Entry[] {
  const tokens = tokenize(q);
  const scored: { entry: Entry; s: number }[] = [];
  for (const item of index) {
    if (!matchesTags(item.entry, tags)) continue;
    const s = tokens.length ? score(item, tokens) : 1;
    if (s > 0) scored.push({ entry: item.entry, s });
  }
  scored.sort((a, b) => b.s - a.s || byIdDesc(a.entry, b.entry));
  return scored.map((x) => x.entry);
}

export function filterCategory(entries: Entry[], cat: string): Entry[] {
  return cat === 'all' ? entries : entries.filter((e) => e.category === cat);
}

export type Segment = { text: string; hit: boolean };

/** Split `text` into hit / non-hit segments for every token, diacritic- and case-insensitive. */
export function highlight(text: string, tokens: string[]): Segment[] {
  if (!tokens.length || !text) return [{ text, hit: false }];
  // Normalise char by char, remembering which original index each normalised char came from.
  let norm = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const n = normalize(ch);
    for (let k = 0; k < n.length; k++) map.push(i);
    norm += n;
    i += ch.length;
  }
  map.push(text.length);

  const hits = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let from = 0;
    for (;;) {
      const at = norm.indexOf(token, from);
      if (at < 0) break;
      const start = map[at];
      const end = map[at + token.length] ?? text.length;
      for (let j = start; j < end; j++) hits[j] = true;
      from = at + 1;
    }
  }

  const out: Segment[] = [];
  for (let j = 0; j < text.length; j++) {
    const last = out[out.length - 1];
    if (last && last.hit === hits[j]) last.text += text[j];
    else out.push({ text: text[j], hit: hits[j] });
  }
  return out;
}
