/** Scenario letter (A / B). Shown only while a comparison is running: a single scenario needs no label. */
import { ScenarioKey, useApp } from '../state/store';

export function ScenarioBadge({ k }: { k: ScenarioKey }) {
  const compare = useApp((s) => s.compare);
  if (!compare) return null;
  return <span className={`badge badge-${k}`}>{k}</span>;
}
