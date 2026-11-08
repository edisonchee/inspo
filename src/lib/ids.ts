export const ID_RE = /^di-\d{3,}$/;

export function idNumber(id: string): number {
  return Number(id.slice(3));
}

export function formatId(n: number): string {
  return `di-${String(n).padStart(3, '0')}`;
}

/** Sort comparator: newest (highest id) first. */
export function byIdDesc(a: { id: string }, b: { id: string }): number {
  return idNumber(b.id) - idNumber(a.id);
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file'
  );
}

export const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
