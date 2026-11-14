/**
 * "Compare" block of the landing-windows panel. Off by default: the planner
 * works on a single landing scenario. Switching it on creates scenario B as a
 * copy of the current one, shows its controls, the quick A/B comparison, the
 * full KPI table and the "use the same window" shortcut. Switching it off
 * removes every trace of B (3-D view, timeline, comparator).
 */
import { useApp } from '../../state/store';
import { useT } from '../../lib/format';
import { KpiMatrix } from './KpiMatrix';
import { QuickCompare } from './QuickCompare';
import { ScenarioPanel } from './ScenarioPanel';

export function CompareBlock() {
  const t = useT();
  const compare = useApp((s) => s.compare);
  const setCompare = useApp((s) => s.setCompare);
  const active = useApp((s) => s.active);
  const setActive = useApp((s) => s.setActive);
  return (
    <section className={`panel block compare-block${compare ? ' is-on' : ''}`} data-testid="compare-block">
      <h3>{t('Compare', 'Comparar')}</h3>
      <label className="check compare-switch">
        <input type="checkbox" role="switch" checked={compare} onChange={(e) => setCompare(e.target.checked)} data-testid="compare-toggle" />
        <span>{t('Compare with another site or date', 'Comparar con otro sitio o fecha')}</span>
      </label>
      {!compare ? (
        <p className="kpi-note pad0">
          {t('Creates a second scenario, B, as a copy of the current one. Change its site or date and both are evaluated side by side, hour by hour.', 'Crea un segundo escenario, B, como copia del actual. Cambia su sitio o su fecha y ambos se evalúan lado a lado, hora a hora.')}
        </p>
      ) : (
        <>
          <div className="compare-view" role="group" aria-label={t('Scenario shown in 3-D', 'Escenario mostrado en 3D')}>
            <span>{t('Shown in 3-D', 'En la vista 3D')}</span>
            <div className="seg">
              {(['A', 'B'] as const).map((k) => (
                <button key={k} type="button" className={active === k ? 'is-on' : ''} aria-pressed={active === k} onClick={() => setActive(k)} data-testid={`view-${k}`}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="compare-b">
            <h4><span className="badge badge-B">B</span>{t('Scenario B', 'Escenario B')}</h4>
            <ScenarioPanel k="B" />
          </div>
          <QuickCompare />
          <KpiMatrix />
        </>
      )}
    </section>
  );
}
