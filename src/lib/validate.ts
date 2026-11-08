import { FACETS, type Gallery } from './types.ts';
import { ID_RE, TAG_RE, idNumber } from './ids.ts';

export interface ValidateOptions {
  /** Every file under media/ (relative to data/, e.g. `media/x.mp4`), posters excluded. */
  mediaFiles: string[];
}

/** Returns a list of problems; empty means valid. */
export function validateGallery(g: Gallery, opts: ValidateOptions): string[] {
  const errors: string[] = [];
  const categories = new Set(g.categories.map((c) => c.id));
  const tags = new Set<string>();
  for (const t of g.tags) {
    if (tags.has(t.tag)) errors.push(`duplicate tag "${t.tag}"`);
    tags.add(t.tag);
    if (!TAG_RE.test(t.tag)) errors.push(`malformed tag "${t.tag}"`);
    if (!FACETS.includes(t.facet)) errors.push(`tag "${t.tag}" has unknown facet "${t.facet}"`);
  }

  if (!ID_RE.test(g.next_id)) errors.push(`malformed next_id "${g.next_id}"`);
  const files = new Set(opts.mediaFiles);
  const referenced = new Set<string>();
  const ids = new Set<string>();

  for (const e of g.entries) {
    const where = e.id;
    if (!ID_RE.test(e.id)) errors.push(`malformed id "${e.id}"`);
    if (ids.has(e.id)) errors.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    if (ID_RE.test(e.id) && ID_RE.test(g.next_id) && idNumber(e.id) >= idNumber(g.next_id)) {
      errors.push(`${where}: id is not below next_id ${g.next_id}`);
    }
    if (!e.title?.trim()) errors.push(`${where}: empty title`);
    if (!categories.has(e.category)) errors.push(`${where}: unknown category "${e.category}"`);
    for (const t of e.tags) if (!tags.has(t)) errors.push(`${where}: tag "${t}" is not in tags[]`);
    if (new Set(e.tags).size !== e.tags.length) errors.push(`${where}: duplicate tags`);
    if (e.source.url && !/^https?:\/\//.test(e.source.url)) {
      errors.push(`${where}: source url must start with http(s)://`);
    }
    for (const m of e.media) {
      if (referenced.has(m.file)) errors.push(`${where}: ${m.file} is used more than once`);
      referenced.add(m.file);
      if (!files.has(m.file)) errors.push(`${where}: missing media file ${m.file}`);
      if (m.type !== 'video' && m.type !== 'image') errors.push(`${where}: bad media type "${m.type}"`);
    }
  }
  return errors;
}
