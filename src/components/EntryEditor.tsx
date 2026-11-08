import { useEffect, useState } from 'react';
import { Dialog, DialogActions } from './ui/Dialog.tsx';
import { Button, buttonClass } from './ui/Button.tsx';
import { Field, Input } from './ui/Field.tsx';
import field from './ui/Field.module.css';
import styles from './EntryEditor.module.css';
import type { Entry, EntryInput, Gallery, MediaType } from '../lib/types.ts';
import { api } from '../lib/api.ts';
import { mediaTypeFor, mediaUrl, posterFile } from '../lib/media.ts';
import { SimpleSelect } from './Selects.tsx';
import { TagPicker } from './TagPicker.tsx';
import { Icon } from './ui/Icon.tsx';

interface Props {
  open: boolean;
  entry: Entry | null;
  gallery: Gallery;
  onClose: () => void;
  onSaved: (entry: Entry, created: boolean) => void | Promise<void>;
  onTagsChanged: () => void | Promise<void>;
}

export function EntryEditor({ open, entry, gallery, onClose, onSaved, onTagsChanged }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup size="md">
          {open && (
            <EditorForm entry={entry} gallery={gallery} onSaved={onSaved} onTagsChanged={onTagsChanged} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A media item in the form: already on disk (kept or attached), or a local file to upload on save. */
type Item =
  | { kind: 'file'; file: string; type: MediaType; attached: boolean }
  | { kind: 'upload'; key: string; upload: File; type: MediaType };

function EditorForm({
  entry,
  gallery,
  onSaved,
  onTagsChanged,
}: Pick<Props, 'entry' | 'gallery' | 'onSaved' | 'onTagsChanged'>) {
  // After a create, further saves update the same entry (e.g. retrying a failed upload).
  const [savedId, setSavedId] = useState<string | null>(entry?.id ?? null);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [why, setWhy] = useState(entry?.why ?? '');
  const [category, setCategory] = useState(entry?.category ?? 'inbox');
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  const [sourceLabel, setSourceLabel] = useState(entry?.source.label ?? '');
  const [sourceUrl, setSourceUrl] = useState(entry?.source.url ?? '');
  const [items, setItems] = useState<Item[]>(
    (entry?.media ?? []).map((m) => ({ kind: 'file', file: m.file, type: m.type, attached: false })),
  );
  const [unreferenced, setUnreferenced] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    api.unreferenced().then(setUnreferenced, () => setUnreferenced([]));
  }, []);

  const attachable = unreferenced.filter((f) => !items.some((i) => i.kind === 'file' && i.file === f));
  const removedExisting = (entry?.media ?? []).filter((m) => !items.some((i) => i.kind === 'file' && i.file === m.file));
  const urlInvalid = sourceUrl.trim() !== '' && !/^https?:\/\/\S+$/.test(sourceUrl.trim());
  const titleInvalid = submitted && !title.trim();

  const move = (i: number, d: -1 | 1) =>
    setItems((list) => {
      const next = list.slice();
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const addUploads = (files: FileList | null) => {
    const added: Item[] = [];
    const rejected: string[] = [];
    for (const f of Array.from(files ?? [])) {
      const type = mediaTypeFor(f.name);
      if (type) added.push({ kind: 'upload', key: `${f.name}:${f.size}:${f.lastModified}`, upload: f, type });
      else rejected.push(f.name);
    }
    setItems((list) => [...list, ...added]);
    setError(rejected.length ? `Not a supported video or image: ${rejected.join(', ')}` : null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!title.trim() || urlInvalid) return;
    setError(null);

    // Uploads are appended by the server after the entry is written, so they go last.
    const files = items.filter((i) => i.kind === 'file');
    const uploads = items.filter((i) => i.kind === 'upload');
    const input: EntryInput = {
      title,
      why,
      category,
      tags,
      source: { label: sourceLabel, url: sourceUrl },
      media: files.map((i) => i.file),
    };
    try {
      setBusy('Saving…');
      let saved = savedId ? await api.updateEntry(savedId, input) : await api.createEntry(input);
      setSavedId(saved.id);
      // Mirror the server after each step (attached files get renamed, uploads become files),
      // so a retry after a failed upload neither re-sends stale names nor re-uploads.
      const asItems = (s: Entry): Item[] =>
        s.media.map((m) => ({ kind: 'file', file: m.file, type: m.type, attached: false }));
      let pending = uploads;
      setItems([...asItems(saved), ...pending]);
      for (const [n, u] of uploads.entries()) {
        setBusy(`Uploading ${n + 1} of ${uploads.length}: ${u.upload.name}…`);
        saved = await api.uploadMedia(saved.id, u.upload);
        pending = pending.filter((p) => p !== u);
        setItems([...asItems(saved), ...pending]);
      }
      await onSaved(saved, !entry);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={save} className={styles.form} noValidate>
      <Dialog.Title>{entry ? `Edit ${entry.id}` : savedId ? `New entry ${savedId}` : 'New entry'}</Dialog.Title>

      <Field.Root invalid={titleInvalid}>
        <Field.Label>Title</Field.Label>
        <Input value={title} onValueChange={setTitle} required autoFocus />
        {titleInvalid && <Field.Error match>A title is required.</Field.Error>}
      </Field.Root>

      <SimpleSelect
        label="Category"
        value={category}
        onChange={setCategory}
        options={gallery.categories.map((c) => ({ label: c.name, value: c.id }))}
      />

      <Field.Root>
        <Field.Label>Why it’s worth keeping</Field.Label>
        <Field.Control render={<textarea rows={5} />} value={why} onValueChange={setWhy} />
        <Field.Description>Leave empty for Inbox items you’ll describe later.</Field.Description>
      </Field.Root>

      <TagPicker
        tags={gallery.tags}
        value={tags}
        onChange={setTags}
        onTagCreated={async () => {
          await onTagsChanged();
        }}
      />

      <fieldset className={field.group}>
        <legend className={field.legend}>Source</legend>
        <Field.Root>
          <Field.Label>Label</Field.Label>
          <Input value={sourceLabel} onValueChange={setSourceLabel} placeholder="e.g. someone on X" />
        </Field.Root>
        <Field.Root invalid={urlInvalid}>
          <Field.Label>URL</Field.Label>
          <Input type="url" value={sourceUrl} onValueChange={setSourceUrl} placeholder="https://…" />
          {urlInvalid && <Field.Error match>Must start with http:// or https://</Field.Error>}
        </Field.Root>
      </fieldset>

      <fieldset className={field.group}>
        <legend className={field.legend}>Media</legend>
        {items.length === 0 && <p className={field.description}>No media — this will be a link-only entry.</p>}
        <ol className={styles.mediaList}>
          {items.map((item, i) => (
            <li key={item.kind === 'file' ? item.file : item.key} className={styles.mediaItem}>
              <MediaThumb item={item} />
              <span className={styles.mediaName}>
                {item.kind === 'file' ? item.file.replace(/^media\//, '') : item.upload.name}
                {item.kind === 'upload' && ' (to upload)'}
                {item.kind === 'file' && item.attached && ' (attach; will be renamed)'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={i === 0 || items[i - 1].kind !== item.kind}
                onClick={() => move(i, -1)}
                aria-label="Move up"
              >
                <Icon name="arrowUp" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={i === items.length - 1 || items[i + 1].kind !== item.kind}
                onClick={() => move(i, 1)}
                aria-label="Move down"
              >
                <Icon name="arrowDown" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setItems((list) => list.filter((x) => x !== item))}
                aria-label="Remove"
              >
                Remove
              </Button>
            </li>
          ))}
        </ol>
        {removedExisting.length > 0 && (
          <p role="status" className={field.description}>
            {removedExisting.length} removed file(s) will stay in data/media/ and can be attached again:{' '}
            {removedExisting.map((m) => m.file.replace(/^media\//, '')).join(', ')}
          </p>
        )}
        <Field.Root>
          <Field.Label>Upload files</Field.Label>
          <input
            className={styles.file}
            type="file"
            multiple
            accept="video/*,image/*"
            onChange={(e) => {
              addUploads(e.target.files);
              e.target.value = '';
            }}
          />
        </Field.Root>
        {attachable.length > 0 && (
          <SimpleSelect<string>
            label="Or attach a file from data/incoming/ (or unreferenced in data/media/)"
            value={null}
            placeholder={`${attachable.length} file(s) available…`}
            options={attachable.map((f) => ({ label: f.replace(/^media\//, ''), value: f }))}
            onChange={(f) => {
              const type = mediaTypeFor(f);
              if (type) setItems((list) => [...list, { kind: 'file', file: f, type, attached: true }]);
            }}
          />
        )}
      </fieldset>

      {error && (
        <p role="alert" className={field.error}>
          {error}
        </p>
      )}
      <DialogActions className={styles.actions}>
        {busy && (
          <span role="status" className={styles.busy}>
            {busy}
          </span>
        )}
        <Dialog.Close type="button" className={buttonClass()} disabled={busy !== null}>
          <span>Cancel</span>
        </Dialog.Close>
        <Button type="submit" variant="primary" disabled={busy !== null}>
          {entry || savedId ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </form>
  );
}

function MediaThumb({ item }: { item: Item }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (item.kind !== 'upload') return;
    const u = URL.createObjectURL(item.upload);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item]);

  if (item.kind === 'file') {
    // Attached files have no poster yet; show the media itself.
    if (item.type === 'video' && !item.attached) return <img className={styles.thumb} src={mediaUrl(posterFile(item.file))} alt="" />;
    if (item.type === 'video') return <video className={styles.thumb} src={mediaUrl(item.file)} muted preload="metadata" />;
    return <img className={styles.thumb} src={mediaUrl(item.file)} alt="" />;
  }
  if (!url) return null;
  return item.type === 'video' ? (
    <video className={styles.thumb} src={url} muted preload="metadata" />
  ) : (
    <img className={styles.thumb} src={url} alt="" />
  );
}
