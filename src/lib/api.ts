import type { Entry, EntryInput, Gallery, Tag } from './types.ts';

async function call<T>(method: string, url: string, body?: BodyInit, json = true): Promise<T> {
  const res = await fetch(url, {
    method,
    body,
    headers: body && json ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${method} ${url} failed (${res.status})`);
  return data as T;
}

export const api = {
  gallery: () => call<Gallery>('GET', '/api/gallery'),
  unreferenced: () => call<string[]>('GET', '/api/media/unreferenced'),
  createEntry: (input: EntryInput) => call<Entry>('POST', '/api/entries', JSON.stringify(input)),
  updateEntry: (id: string, input: EntryInput) => call<Entry>('PUT', `/api/entries/${id}`, JSON.stringify(input)),
  deleteEntry: (id: string) => call<{ ok: true }>('DELETE', `/api/entries/${id}`),
  addTag: (tag: Tag) => call<Tag>('POST', '/api/tags', JSON.stringify(tag)),
  uploadMedia: (id: string, file: File) =>
    call<Entry>('POST', `/api/entries/${id}/media?name=${encodeURIComponent(file.name)}`, file, false),
};
