import { useId, useRef, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Dialog, DialogActions } from './ui/Dialog.tsx';
import { Button, buttonClass } from './ui/Button.tsx';
import { Field, Input } from './ui/Field.tsx';
import { cx } from './ui/styled.tsx';
import { Icon } from './ui/Icon.tsx';
import field from './ui/Field.module.css';
import popup from './ui/Popup.module.css';
import chip from './ui/Chip.module.css';
import styles from './TagPicker.module.css';
import { FACETS, type Facet, type Tag } from '../lib/types.ts';
import { TAG_RE, slugify } from '../lib/ids.ts';
import { api } from '../lib/api.ts';
import { FacetSelect } from './Selects.tsx';

const CREATE = '\u0000create:';

interface Props {
  tags: Tag[];
  value: string[];
  onChange: (tags: string[]) => void;
  /** Called after a new tag is added to the vocabulary. */
  onTagCreated: (tag: Tag) => void | Promise<void>;
}

/** Multi-select over the controlled tag vocabulary, with inline creation of new tags. */
export function TagPicker({ tags, value, onChange, onTagCreated }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const highlighted = useRef<string | undefined>(undefined);

  const facetOf = new Map(tags.map((t) => [t.tag, t.facet]));
  const trimmed = slugify(query.trim());
  const canCreate = query.trim() !== '' && !facetOf.has(trimmed);
  const items = canCreate ? [...tags.map((t) => t.tag), `${CREATE}${trimmed}`] : tags.map((t) => t.tag);

  return (
    <>
      <Combobox.Root
        multiple
        autoHighlight
        items={items}
        value={value}
        inputValue={query}
        onInputValueChange={setQuery}
        onItemHighlighted={(item) => {
          highlighted.current = item as string | undefined;
        }}
        onValueChange={(next: string[]) => {
          const create = next.find((t) => t.startsWith(CREATE));
          if (create) {
            setCreating(create.slice(CREATE.length));
            return;
          }
          onChange(next);
          setQuery('');
        }}
        itemToStringLabel={(t: string) => (t.startsWith(CREATE) ? t.slice(CREATE.length) : t)}
      >
        <div className={field.root}>
        <label htmlFor={id} className={field.label}>
          Tags
        </label>
        <Combobox.InputGroup className={cx(field.control, styles.group)}>
          <Combobox.Chips className={styles.chips} aria-label={value.length ? 'Selected tags' : undefined}>
            {value.map((t) => (
              <Combobox.Chip key={t} className={chip.chip} aria-label={t}>
                <span>#{t}</span>
                <Combobox.ChipRemove className={chip.remove} aria-label={`Remove ${t}`}>
                  <Icon name="close" />
                </Combobox.ChipRemove>
              </Combobox.Chip>
            ))}
            <Combobox.Input
              id={id}
              className={styles.input}
              placeholder={value.length ? '' : 'Add tags…'}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Never submit the surrounding entry form from here. (preventDefault only stops the
                // native submit; Base UI still selects the highlighted item.)
                e.preventDefault();
                // Enter with nothing highlighted creates the typed tag.
                if (!highlighted.current && canCreate) setCreating(trimmed);
              }}
            />
          </Combobox.Chips>
        </Combobox.InputGroup>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className={popup.positioner}>
            <Combobox.Popup className={popup.popup}>
              <Combobox.Empty className={popup.empty}>No matching tags.</Combobox.Empty>
              <Combobox.List>
                {(t: string) =>
                  t.startsWith(CREATE) ? (
                    <Combobox.Item key={t} value={t} className={popup.item}>
                      <span className={popup.indicator}>
                        <Icon name="plus" />
                      </span>
                      Create “{t.slice(CREATE.length)}”
                    </Combobox.Item>
                  ) : (
                    <Combobox.Item key={t} value={t} className={popup.item}>
                      <span className={popup.indicator}>
                        <Combobox.ItemIndicator>
                          <Icon name="check" />
                        </Combobox.ItemIndicator>
                      </span>
                      {t} <small className={popup.hint}>{facetOf.get(t)}</small>
                    </Combobox.Item>
                  )
                }
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      <CreateTagDialog
        initial={creating}
        onClose={() => setCreating(null)}
        onCreated={async (tag) => {
          await onTagCreated(tag);
          onChange([...value, tag.tag]);
          setCreating(null);
          setQuery('');
        }}
      />
    </>
  );
}

function CreateTagDialog({
  initial,
  onClose,
  onCreated,
}: {
  initial: string | null;
  onClose: () => void;
  onCreated: (tag: Tag) => Promise<void>;
}) {
  return (
    <Dialog.Root open={initial !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup size="sm">
          {initial !== null && <CreateTagForm initial={initial} onCreated={onCreated} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateTagForm({ initial, onCreated }: { initial: string; onCreated: (tag: Tag) => Promise<void> }) {
  const [tag, setTag] = useState(initial);
  const [facet, setFacet] = useState<Facet>('Technique');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = TAG_RE.test(tag);

  return (
    <form
      className={styles.form}
      onSubmit={async (e) => {
        e.preventDefault();
        e.stopPropagation(); // don't submit the entry form underneath
        if (!valid) return;
        setBusy(true);
        try {
          await onCreated(await api.addTag({ tag, facet }));
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Dialog.Title>New tag</Dialog.Title>
      <Dialog.Description>Tags are a controlled vocabulary, grouped by facet.</Dialog.Description>
      <Field.Root invalid={!valid}>
        <Field.Label>Name (lowercase-kebab-case)</Field.Label>
        <Input value={tag} onValueChange={(v) => setTag(v.toLowerCase().replace(/\s+/g, '-'))} autoFocus />
        {!valid && <Field.Error match>Use lowercase letters, digits and single hyphens.</Field.Error>}
      </Field.Root>
      <FacetSelect value={facet} onChange={setFacet} options={FACETS} />
      {error && (
        <p role="alert" className={field.error}>
          {error}
        </p>
      )}
      <DialogActions>
        <Dialog.Close type="button" className={buttonClass()}>
          <span>Cancel</span>
        </Dialog.Close>
        <Button type="submit" variant="primary" disabled={!valid || busy}>
          Create tag
        </Button>
      </DialogActions>
    </form>
  );
}
