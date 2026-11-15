/** Contextual glossary tooltips (SR-706): a dotted term that explains itself on hover or keyboard focus. */
import { ReactNode, useId } from 'react';
import { glossById, glossSplit } from '../lib/glossary';
import { useApp } from '../state/store';

export function Gloss({ id, children }: { id: string; children: ReactNode }) {
  const lang = useApp((s) => s.lang);
  const tipId = useId();
  const g = glossById(id);
  if (!g) return <>{children}</>;
  const li = lang === 'es' ? 1 : 0;
  return (
    <span className="gloss" tabIndex={0} aria-describedby={tipId} data-gloss={id} data-testid={`gloss-${id}`}>
      {children}
      <span className="gloss-tip" role="tooltip" id={tipId}>
        <b>{g.term[li]}</b>
        {g.def[li]}
      </span>
    </span>
  );
}

/** A running text with its glossary terms turned into tooltips. */
export function Glossed({ text }: { text: string }) {
  return <>{glossSplit(text).map((p, i) => (typeof p === 'string' ? p : <Gloss key={i} id={p.id}>{p.text}</Gloss>))}</>;
}
