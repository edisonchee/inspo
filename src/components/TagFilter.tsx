import { Popover } from '@base-ui/react/popover';
import { FACETS, type Entry, type Tag } from '../lib/types.ts';
import { Button, buttonClass } from './ui/Button.tsx';
import { Pill, pillStyles } from './ui/Pill.tsx';
import { cx } from './ui/styled.tsx';
import { Icon } from './ui/Icon.tsx';
import popup from './ui/Popup.module.css';
import chip from './ui/Chip.module.css';
import styles from './TagFilter.module.css';

interface Props {
  tags: Tag[];
  /** Entries currently shown; used for per-tag counts. */
  entries: Entry[];
  selected: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}

export function TagFilter({ tags, entries, selected, onToggle, onClear }: Props) {
  const counts = new Map<string, number>();
  for (const e of entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);

  return (
    <div className={styles.root}>
      {selected.length > 0 && (
        <div className={styles.chips} aria-label="Selected tags" role="group">
          {selected.map((t) => (
            <button key={t} type="button" className={chip.chip} onClick={() => onToggle(t)} aria-label={`Remove tag ${t}`}>
              <span>#{t}</span>
              <span className={chip.remove} aria-hidden="true">
                <Icon name="close" />
              </span>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear tags
          </Button>
        </div>
      )}
      <Popover.Root>
        <Popover.Trigger className={buttonClass({ size: 'sm' })}>
          <span>Tags{selected.length ? ` (${selected.length})` : ''}</span>
          <Icon name="chevronDown" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} align="end" className={popup.positioner}>
            <Popover.Popup className={cx(popup.popup, styles.popup)}>
              <Popover.Title className="visually-hidden">Filter by tags</Popover.Title>
              {FACETS.map((facet) => {
                const inFacet = tags.filter((t) => t.facet === facet);
                if (!inFacet.length) return null;
                return (
                  <fieldset key={facet} className={styles.facet}>
                    <legend className={styles.legend}>{facet}</legend>
                    <div className={styles.facetTags}>
                      {inFacet.map(({ tag }) => {
                        const on = selected.includes(tag);
                        const n = counts.get(tag) ?? 0;
                        return (
                          <Pill
                            key={tag}
                            className={styles.tag}
                            pressed={on}
                            disabled={!on && n === 0}
                            onPressedChange={() => onToggle(tag)}
                          >
                            {tag} <span className={pillStyles.count}>{n}</span>
                          </Pill>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
