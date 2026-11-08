import { useRef, useState } from 'react';
import { AlertDialog, Dialog, DialogActions } from './ui/Dialog.tsx';
import { Button, buttonClass } from './ui/Button.tsx';
import type { Entry } from '../lib/types.ts';
import { domain, mediaUrl } from '../lib/media.ts';
import { api } from '../lib/api.ts';
import { useReducedMotion } from '../hooks.ts';
import { Highlight } from './Highlight.tsx';
import { Icon } from './ui/Icon.tsx';
import { LinkFace } from './Card.tsx';
import chip from './ui/Chip.module.css';
import field from './ui/Field.module.css';
import styles from './Viewer.module.css';

interface Props {
  entry: Entry | null;
  results: Entry[];
  tokens: string[];
  categoryName: (id: string) => string;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onTag: (tag: string) => void;
  onEdit: (entry: Entry) => void;
  onDeleted: () => void;
}

export function Viewer({ entry, results, tokens, categoryName, onNavigate, onClose, onTag, onEdit, onDeleted }: Props) {
  // Focus the dialog itself on open, so no control (e.g. the video) starts with a focus ring.
  const popupRef = useRef<HTMLDivElement>(null);
  const at = entry ? results.findIndex((e) => e.id === entry.id) : -1;
  const prev = at > 0 ? results[at - 1] : null;
  const next = at >= 0 && at < results.length - 1 ? results[at + 1] : null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const to = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
    if (!to) return;
    e.preventDefault();
    onNavigate(to.id);
  };

  return (
    <Dialog.Root open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup size="viewer" ref={popupRef} initialFocus={popupRef} onKeyDown={onKeyDown}>
          {entry && (
            <ViewerBody
              key={entry.id}
              entry={entry}
              tokens={tokens}
              categoryName={categoryName(entry.category)}
              position={at >= 0 ? `${at + 1} of ${results.length}` : 'Not in current results'}
              prev={prev}
              next={next}
              onNavigate={onNavigate}
              onTag={onTag}
              onEdit={onEdit}
              onDeleted={onDeleted}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface BodyProps {
  entry: Entry;
  tokens: string[];
  categoryName: string;
  position: string;
  prev: Entry | null;
  next: Entry | null;
  onNavigate: (id: string) => void;
  onTag: (tag: string) => void;
  onEdit: (entry: Entry) => void;
  onDeleted: () => void;
}

function ViewerBody({ entry, tokens, categoryName, position, prev, next, onNavigate, onTag, onEdit, onDeleted }: BodyProps) {
  const [clip, setClip] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const media = entry.media[clip];

  return (
    <article className={styles.body}>
      <div className={styles.stage}>
        {media?.type === 'video' && (
          <video
            key={media.file}
            className={styles.video}
            src={mediaUrl(media.file)}
            controls
            loop
            muted
            playsInline
            autoPlay={!reduced}
          />
        )}
        {media?.type === 'image' && (
          <button
            type="button"
            className={styles.image}
            data-zoomed={zoomed || undefined}
            onClick={() => setZoomed((z) => !z)}
            aria-label={zoomed ? 'Zoom out' : 'Zoom in'}
          >
            <img src={mediaUrl(media.file)} alt={entry.title} />
          </button>
        )}
        {!media && (
          <div className={styles.linkFace}>
            <LinkFace title={entry.title} url={entry.source.url} />
          </div>
        )}
        {entry.media.length > 1 && (
          <div className={styles.clips} role="group" aria-label="Clips">
            <Button variant="ghost" size="icon" disabled={clip === 0} onClick={() => setClip((c) => c - 1)} aria-label="Previous clip">
              <Icon name="chevronLeft" />
            </Button>
            <span aria-live="polite" className={styles.clipPosition}>
              {clip + 1} of {entry.media.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={clip === entry.media.length - 1}
              onClick={() => setClip((c) => c + 1)}
              aria-label="Next clip"
            >
              <Icon name="chevronRight" />
            </Button>
          </div>
        )}
      </div>

      <div className={styles.info}>
        <Dialog.Close className={`${buttonClass({ variant: 'ghost', size: 'icon' })} ${styles.close}`} aria-label="Close">
          <Icon name="close" />
        </Dialog.Close>
        <Dialog.Title className={styles.title}>
          <Highlight text={entry.title} tokens={tokens} />
        </Dialog.Title>
        <p className={styles.meta}>
          {categoryName} · {entry.id} · added {entry.added}
        </p>
        {entry.why ? (
          <Dialog.Description className={styles.why}>
            <Highlight text={entry.why} tokens={tokens} />
          </Dialog.Description>
        ) : (
          <p className={styles.whyEmpty}>No note yet.</p>
        )}
        {entry.tags.length > 0 && (
          <ul className={styles.tags} aria-label="Tags">
            {entry.tags.map((t) => (
              <li key={t}>
                <button type="button" className={chip.chip} onClick={() => onTag(t)} title={`Filter by ${t}`}>
                  <span>
                    #<Highlight text={t} tokens={tokens} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {entry.source.url && (
          <p className={styles.source}>
            <a href={entry.source.url} target="_blank" rel="noreferrer noopener">
              <Highlight text={entry.source.label || domain(entry.source.url)} tokens={tokens} /> <Icon name="external" inline />
            </a>
          </p>
        )}

        <div className={styles.actions}>
          <Button size="sm" onClick={() => onEdit(entry)}>
            Edit
          </Button>
          <AlertDialog.Root>
            <AlertDialog.Trigger className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              <span>Delete</span>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Backdrop />
              <AlertDialog.Popup size="sm">
                <AlertDialog.Title>Delete “{entry.title}”?</AlertDialog.Title>
                <AlertDialog.Description>
                  {entry.id} will be removed and its ID won’t be reused. Its {entry.media.length} media file(s) stay in
                  data/media/, so you can attach them to another entry.
                </AlertDialog.Description>
                {deleteError && (
                  <p role="alert" className={field.error}>
                    {deleteError}
                  </p>
                )}
                <DialogActions>
                  <AlertDialog.Close className={buttonClass()}>
                    <span>Cancel</span>
                  </AlertDialog.Close>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      try {
                        await api.deleteEntry(entry.id);
                        onDeleted();
                      } catch (e) {
                        setDeleteError((e as Error).message);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </DialogActions>
              </AlertDialog.Popup>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>

        <nav className={styles.nav} aria-label="Browse results">
          <Button size="sm" disabled={!prev} onClick={() => prev && onNavigate(prev.id)}>
            <Icon name="arrowLeft" />
            Previous
          </Button>
          <span className={styles.position}>{position}</span>
          <Button size="sm" disabled={!next} onClick={() => next && onNavigate(next.id)}>
            Next
            <Icon name="arrowRight" />
          </Button>
        </nav>
      </div>
    </article>
  );
}
