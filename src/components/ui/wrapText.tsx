import { Children, type ReactNode } from 'react';

/**
 * Wraps each run of bare text in a <span> so it becomes a real flex item that CSS can target.
 * Capsule styles trim those spans to cap height (text-box), which centers the text optically;
 * bare text would be an anonymous flex item that text-box can't reach. Spacing comes from `gap`.
 */
export function wrapText(children: ReactNode): ReactNode {
  const out: ReactNode[] = [];
  let run = '';
  const flush = () => {
    const text = run.trim();
    if (text) out.push(<span key={`t${out.length}`}>{text}</span>);
    run = '';
  };
  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') run += child;
    else {
      flush();
      if (child !== null && child !== undefined && typeof child !== 'boolean') out.push(child);
    }
  });
  flush();
  return out;
}
