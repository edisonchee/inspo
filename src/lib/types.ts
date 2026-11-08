export const FACETS = ['Component', 'Technique', 'Theme', 'Use'] as const;
export type Facet = (typeof FACETS)[number];

export type MediaType = 'video' | 'image';

export interface Category {
  id: string;
  name: string;
  rule: string;
}

export interface Tag {
  tag: string;
  facet: Facet;
}

export interface Media {
  /** Path relative to the data folder, e.g. `media/di-041-foo.mp4`. */
  file: string;
  type: MediaType;
}

export interface Entry {
  id: string;
  added: string;
  category: string;
  title: string;
  source: { label: string; url: string };
  why: string;
  tags: string[];
  media: Media[];
}

export interface Gallery {
  schema: string;
  exported?: string;
  source_doc?: string;
  next_id: string;
  categories: Category[];
  tags: Tag[];
  entries: Entry[];
}

/** The editable fields of an entry, as sent to the API. */
export interface EntryInput {
  title: string;
  why: string;
  category: string;
  tags: string[];
  source: { label: string; url: string };
  /** Files (relative to data/) to keep, in order. Unreferenced files in media/ may be attached. */
  media: string[];
}
