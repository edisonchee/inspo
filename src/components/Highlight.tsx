import { highlight } from '../lib/search.ts';

export function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  return (
    <>
      {highlight(text, tokens).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : s.text))}
    </>
  );
}
