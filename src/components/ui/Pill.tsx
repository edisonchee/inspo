import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { ComponentProps } from 'react';
import { withClass } from './styled.tsx';
import { wrapText } from './wrapText.tsx';
import styles from './Pill.module.css';

/** A rounded toggle button ("pill"); pressed state via [data-pressed]. */
const StyledToggle = withClass(Toggle, styles.pill, 'Pill');
export function Pill({ children, ...props }: ComponentProps<typeof StyledToggle>) {
  return <StyledToggle {...props}>{wrapText(children)}</StyledToggle>;
}
export const PillGroup = withClass(ToggleGroup, styles.group, 'PillGroup');
export const pillStyles = styles;
