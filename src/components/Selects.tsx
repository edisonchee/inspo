import { Select } from '@base-ui/react/select';
import { cx } from './ui/styled.tsx';
import { Icon } from './ui/Icon.tsx';
import field from './ui/Field.module.css';
import popup from './ui/Popup.module.css';
import styles from './Selects.module.css';

interface Option<V extends string> {
  label: string;
  value: V;
}

interface SimpleSelectProps<V extends string> {
  label: string;
  value: V | null;
  options: Option<V>[];
  placeholder?: string;
  onChange: (value: V) => void;
}

/** A labelled single-value Base UI Select. */
export function SimpleSelect<V extends string>({ label, value, options, placeholder, onChange }: SimpleSelectProps<V>) {
  return (
    <div className={field.root}>
      <Select.Root items={options} value={value} onValueChange={(v) => v !== null && onChange(v as V)}>
        <Select.Label className={field.label}>{label}</Select.Label>
        <Select.Trigger className={cx(field.control, styles.trigger)}>
          <Select.Value className={styles.value} placeholder={placeholder} />
          <Select.Icon className={styles.icon}>
            <Icon name="chevronDown" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className={popup.positioner}>
            <Select.Popup className={popup.popup}>
              <Select.List>
                {options.map((o) => (
                  <Select.Item key={o.value} value={o.value} className={popup.item}>
                    <span className={popup.indicator}>
                      <Select.ItemIndicator>
                        <Icon name="check" />
                      </Select.ItemIndicator>
                    </span>
                    <Select.ItemText>{o.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

export function FacetSelect<F extends string>({
  value,
  onChange,
  options,
}: {
  value: F;
  onChange: (f: F) => void;
  options: readonly F[];
}) {
  return <SimpleSelect label="Facet" value={value} onChange={onChange} options={options.map((f) => ({ label: f, value: f }))} />;
}
