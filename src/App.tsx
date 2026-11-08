import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@base-ui/react/input';
import type { Entry } from './lib/types.ts';
import { filterCategory, indexEntries, searchEntries, tokenize } from './lib/search.ts';
import { useDebounced, useFilters, useGallery, useHashId } from './hooks.ts';
import { CategorySwitcher } from './components/CategorySwitcher.tsx';
import { TagFilter } from './components/TagFilter.tsx';
import { Card } from './components/Card.tsx';
import { Viewer } from './components/Viewer.tsx';
import { EntryEditor } from './components/EntryEditor.tsx';
import { ThemeSwitcher } from './components/ThemeSwitcher.tsx';
import { Button } from './components/ui/Button.tsx';
import { Icon } from './components/ui/Icon.tsx';
import styles from './App.module.css';

type Editing = { entry: Entry | null } | null;

export function App() {
  const { gallery, error, reload } = useGallery();
  const [filters, setFilters] = useFilters();
  const [openId, setOpenId] = useHashId();
  const [editing, setEditing] = useState<Editing>(null);

  // Search input is local; the debounced value drives filtering and the URL.
  const [qInput, setQInput] = useState(filters.q);
  const q = useDebounced(qInput, 100);
  useEffect(() => setFilters((f) => (f.q === q ? f : { ...f, q })), [q, setFilters]);

  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const index = useMemo(() => indexEntries(gallery?.entries ?? []), [gallery]);
  const searched = useMemo(() => searchEntries(index, filters.q, filters.tags), [index, filters.q, filters.tags]);
  const results = useMemo(() => filterCategory(searched, filters.cat), [searched, filters.cat]);
  const tokens = useMemo(() => tokenize(filters.q), [filters.q]);

  if (error)
    return (
      <p role="alert" className={styles.state}>
        Couldn’t load the gallery: {error}
      </p>
    );
  if (!gallery) return <p className={styles.state}>Loading…</p>;

  const open = openId ? (gallery.entries.find((e) => e.id === openId) ?? null) : null;
  const categoryName = (id: string) => gallery.categories.find((c) => c.id === id)?.name ?? id;
  const toggleTag = (tag: string) =>
    setFilters((f) => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter((t) => t !== tag) : [...f.tags, tag],
    }));

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <h1 className={styles.brand}>Inspo</h1>
        <label className={styles.search}>
          <span className="visually-hidden">Search</span>
          <Icon name="search" className={styles.searchIcon} />
          <Input
            ref={searchRef}
            className={styles.searchInput}
            type="search"
            placeholder="Search"
            value={qInput}
            onValueChange={(v) => setQInput(v)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && qInput) {
                e.preventDefault();
                setQInput('');
              }
            }}
          />
          <kbd className={styles.searchKey} aria-hidden="true">
            /
          </kbd>
        </label>
        <div className={styles.topActions}>
          <Button variant="primary" onClick={() => setEditing({ entry: null })}>
            New entry
          </Button>
          <ThemeSwitcher />
        </div>
      </header>

      <nav className={styles.filters} aria-label="Filters">
        <CategorySwitcher
          categories={gallery.categories}
          entries={searched}
          value={filters.cat}
          onChange={(cat) => setFilters((f) => ({ ...f, cat }))}
        />
        <TagFilter
          tags={gallery.tags}
          entries={results}
          selected={filters.tags}
          onToggle={toggleTag}
          onClear={() => setFilters((f) => ({ ...f, tags: [] }))}
        />
      </nav>

      <main className={styles.main}>
        <p className={styles.resultCount} aria-live="polite">
          {results.length} {results.length === 1 ? 'entry' : 'entries'}
        </p>
        {results.length ? (
          <ul className={styles.grid}>
            {results.map((e) => (
              <li key={e.id}>
                <Card entry={e} categoryName={categoryName(e.category)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Nothing matches. Try fewer words or tags.</p>
        )}
      </main>

      <Viewer
        entry={open}
        results={results}
        tokens={tokens}
        categoryName={categoryName}
        onNavigate={(id) => setOpenId(id)}
        onClose={() => setOpenId(null)}
        onTag={(tag) => {
          setOpenId(null);
          if (!filters.tags.includes(tag)) toggleTag(tag);
        }}
        onEdit={(entry) => setEditing({ entry })}
        onDeleted={async () => {
          setOpenId(null);
          await reload();
        }}
      />

      <EntryEditor
        open={editing !== null}
        entry={editing?.entry ?? null}
        gallery={gallery}
        onClose={() => setEditing(null)}
        onSaved={async (saved, created) => {
          await reload();
          setEditing(null);
          if (created) setOpenId(saved.id, 'push');
        }}
        onTagsChanged={reload}
      />
    </div>
  );
}
