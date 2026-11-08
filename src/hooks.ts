import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Gallery } from './lib/types.ts';
import { api } from './lib/api.ts';
import type { Filters } from './lib/search.ts';
import { parseFilters, parseHash, serializeFilters } from './lib/urlState.ts';

export function useGallery() {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setGallery(await api.gallery());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { gallery, error, reload };
}

function replaceUrl(search: string, hash: string) {
  history.replaceState(history.state, '', `${location.pathname}${search}${hash}`);
}

/** Filters live in the query string (`?q=&cat=&tags=`). */
export function useFilters() {
  const [filters, setFiltersState] = useState<Filters>(() => parseFilters(location.search));
  useEffect(() => {
    const onPop = () => setFiltersState(parseFilters(location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const setFilters = useCallback((update: (f: Filters) => Filters) => {
    setFiltersState((f) => {
      const next = update(f);
      replaceUrl(serializeFilters(next), location.hash);
      return next;
    });
  }, []);
  return [filters, setFilters] as const;
}

/** The open entry lives in the hash (`#di-041`). */
export function useHashId() {
  const [id, setId] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setId(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => {
      window.removeEventListener('hashchange', on);
      window.removeEventListener('popstate', on);
    };
  }, []);
  const set = useCallback((next: string | null, mode: 'push' | 'replace' = 'replace') => {
    const url = `${location.pathname}${location.search}${next ? `#${next}` : ''}`;
    if (mode === 'push') history.pushState(null, '', url);
    else history.replaceState(null, '', url);
    setId(next);
  }, []);
  return [id, set] as const;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const motionQuery = '(prefers-reduced-motion: reduce)';
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(motionQuery);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => matchMedia(motionQuery).matches,
  );
}
