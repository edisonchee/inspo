import type { Category, Entry } from '../lib/types.ts';
import { Pill, PillGroup, pillStyles } from './ui/Pill.tsx';
import styles from './CategorySwitcher.module.css';

interface Props {
  categories: Category[];
  /** Entries matching the current search + tags, before category filtering. */
  entries: Entry[];
  value: string;
  onChange: (cat: string) => void;
}

export function CategorySwitcher({ categories, entries, value, onChange }: Props) {
  const count = (id: string) => entries.filter((e) => e.category === id).length;
  return (
    <PillGroup className={styles.row} aria-label="Category" value={[value]} onValueChange={(v: string[]) => onChange(v[0] ?? 'all')}>
      <Pill value="all">
        All <span className={pillStyles.count}>{entries.length}</span>
      </Pill>
      {categories.map((c) => (
        <Pill
          key={c.id}
          value={c.id}
          title={c.rule}
          className={c.id === 'inbox' ? styles.secondary : undefined}
          data-secondary={c.id === 'inbox' || undefined}
        >
          {c.name} <span className={pillStyles.count}>{count(c.id)}</span>
        </Pill>
      ))}
    </PillGroup>
  );
}
