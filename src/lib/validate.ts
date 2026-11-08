import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../schema/inspo-v1.schema.json' with { type: 'json' };
import type { Gallery } from './types.ts';
import { idNumber } from './ids.ts';

export interface ValidateOptions {
  /** Every file under media/ (relative to data/, e.g. `media/x.mp4`), posters excluded. */
  mediaFiles: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkShape = ajv.compile<Gallery>(schema);

/**
 * Returns a list of problems; empty means valid. Structure comes from schema/inspo-v1.schema.json (ajv);
 * cross-references a JSON Schema can't express are checked here.
 */
export function validateGallery(g: unknown, opts: ValidateOptions): string[] {
  if (!checkShape(g)) {
    return (checkShape.errors ?? []).map((e) => {
      // "/entries/3/title" → "entries[3] (di-038).title": name the entry when we can.
      const m = /^\/entries\/(\d+)(.*)$/.exec(e.instancePath);
      const entryId = m ? (g as { entries?: { id?: unknown }[] }).entries?.[Number(m[1])]?.id : undefined;
      const where = m
        ? `entries[${m[1]}]${typeof entryId === 'string' ? ` (${entryId})` : ''}${m[2].replace(/\//g, '.')}`
        : e.instancePath.replace(/^\//, '').replace(/\//g, '.') || 'gallery';
      const detail = e.keyword === 'const' || e.keyword === 'enum' ? ` ${JSON.stringify(e.params)}` : '';
      return `${where} ${e.message}${detail}`;
    });
  }

  const errors: string[] = [];
  const categories = new Set(g.categories.map((c) => c.id));
  if (categories.size !== g.categories.length) errors.push('duplicate category id');
  const tags = new Set<string>();
  for (const t of g.tags) {
    if (tags.has(t.tag)) errors.push(`duplicate tag "${t.tag}"`);
    tags.add(t.tag);
  }

  const files = new Set(opts.mediaFiles);
  const referenced = new Set<string>();
  const ids = new Set<string>();
  for (const e of g.entries) {
    const where = e.id;
    if (ids.has(e.id)) errors.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    if (idNumber(e.id) >= idNumber(g.next_id)) errors.push(`${where}: id is not below next_id ${g.next_id}`);
    if (!categories.has(e.category)) errors.push(`${where}: unknown category "${e.category}"`);
    for (const t of e.tags) if (!tags.has(t)) errors.push(`${where}: tag "${t}" is not in tags[]`);
    for (const m of e.media) {
      if (referenced.has(m.file)) errors.push(`${where}: ${m.file} is used more than once`);
      referenced.add(m.file);
      if (!files.has(m.file)) errors.push(`${where}: missing media file ${m.file}`);
    }
  }
  return errors;
}
