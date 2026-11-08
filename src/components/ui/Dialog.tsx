import type { ComponentProps } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { cx, withClass } from './styled.tsx';
import styles from './Dialog.module.css';

type Size = 'sm' | 'md' | 'viewer';

function sized<C extends typeof BaseDialog.Popup | typeof BaseAlertDialog.Popup>(Popup: C) {
  return function SizedPopup({ size = 'md', className, ...props }: Omit<ComponentProps<C>, 'className'> & { size?: Size; className?: string }) {
    const Inner = Popup as typeof BaseDialog.Popup;
    return <Inner {...(props as ComponentProps<typeof BaseDialog.Popup>)} className={cx(styles.popup, styles[size], className)} />;
  };
}

/** Styled dialog parts; Root, Portal, Trigger and Close come straight from Base UI. */
export const Dialog = {
  ...BaseDialog,
  Backdrop: withClass(BaseDialog.Backdrop, styles.backdrop, 'Dialog.Backdrop'),
  Popup: sized(BaseDialog.Popup),
  Title: withClass(BaseDialog.Title, styles.title, 'Dialog.Title'),
  Description: withClass(BaseDialog.Description, styles.description, 'Dialog.Description'),
};

export const AlertDialog = {
  ...BaseAlertDialog,
  Backdrop: withClass(BaseAlertDialog.Backdrop, styles.backdrop, 'AlertDialog.Backdrop'),
  Popup: sized(BaseAlertDialog.Popup),
  Title: withClass(BaseAlertDialog.Title, styles.title, 'AlertDialog.Title'),
  Description: withClass(BaseAlertDialog.Description, styles.description, 'AlertDialog.Description'),
};

export function DialogActions({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cx(styles.actions, className)} />;
}
