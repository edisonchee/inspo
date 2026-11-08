import type { ComponentProps } from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { cx } from './styled.tsx';
import { wrapText } from './wrapText.tsx';
import styles from './Button.module.css';

export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'icon';

/** Classes for any element that should look like a button (e.g. Dialog.Close, Popover.Trigger). */
export function buttonClass({ variant = 'secondary', size = 'md' }: { variant?: ButtonVariant; size?: ButtonSize } = {}) {
  return cx(styles.button, styles[variant], styles[size]);
}

type Props = Omit<ComponentProps<typeof BaseButton>, 'className'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

export function Button({ variant, size, className, children, ...props }: Props) {
  return (
    <BaseButton {...props} className={cx(buttonClass({ variant, size }), className)}>
      {wrapText(children)}
    </BaseButton>
  );
}
