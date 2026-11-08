import type { ComponentProps, ComponentType } from 'react';

type ClassName = string | false | null | undefined;

export function cx(...names: ClassName[]): string {
  return names.filter(Boolean).join(' ');
}

/**
 * Wraps a component so it always carries `base` classes, merged with any className passed in.
 * Base UI's function-form className (state => string) is supported too.
 */
export function withClass<C extends ComponentType<any>>(Comp: C, base: string, displayName?: string) {
  function Styled(props: ComponentProps<C>) {
    const { className, ...rest } = props as { className?: unknown };
    const merged =
      typeof className === 'function'
        ? (state: unknown) => cx(base, (className as (s: unknown) => string | undefined)(state))
        : cx(base, className as ClassName);
    const Inner = Comp as ComponentType<Record<string, unknown>>;
    return <Inner {...rest} className={merged} />;
  }
  Styled.displayName = displayName ?? `Styled(${Comp.displayName ?? Comp.name ?? 'Component'})`;
  return Styled;
}
