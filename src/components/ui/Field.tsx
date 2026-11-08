import { Field as BaseField } from '@base-ui/react/field';
import { Input as BaseInput } from '@base-ui/react/input';
import { withClass } from './styled.tsx';
import styles from './Field.module.css';

/** Styled Base UI Field parts. Use Field.Control with render={<textarea />} for multi-line input. */
export const Field = {
  Root: withClass(BaseField.Root, styles.root, 'Field.Root'),
  Label: withClass(BaseField.Label, styles.label, 'Field.Label'),
  Control: withClass(BaseField.Control, styles.control, 'Field.Control'),
  Description: withClass(BaseField.Description, styles.description, 'Field.Description'),
  Error: withClass(BaseField.Error, styles.error, 'Field.Error'),
};

export const Input = withClass(BaseInput, styles.control, 'Input');

export const fieldStyles = styles;
