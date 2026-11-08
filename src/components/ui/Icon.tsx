import type { ReactNode, SVGProps } from 'react';
import { cx } from './styled.tsx';
import styles from './Icon.module.css';

/** 24×24 stroke icons. SVG (not text glyphs) so they center exactly and don't depend on font fallback. */
const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  arrowLeft: <path d="M19 12H5m7 7-7-7 7-7" />,
  arrowRight: <path d="M5 12h14m-7-7 7 7-7 7" />,
  arrowUp: <path d="M12 19V5m-7 7 7-7 7 7" />,
  arrowDown: <path d="M12 5v14m7-7-7 7-7-7" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  external: <path d="M7 17 17 7M8 7h9v9" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  moon: <path d="M20.5 14.1A8.5 8.5 0 1 1 9.9 3.5a6.6 6.6 0 0 0 10.6 10.6Z" />,
  monitor: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Inline icons sit in running text; the default is a block for flex layouts (buttons). */
  inline?: boolean;
}

export function Icon({ name, inline, className, ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
      className={cx(styles.icon, inline && styles.inline, className)}
    >
      {PATHS[name]}
    </svg>
  );
}
