/** Quick view: the two scenarios in four self-explanatory bars each. */
import { Verdict } from '../../engine';
import { ScenarioData, useMission } from '../../state/mission';
import { useVerdict } from '../../state/verdict';
import { useApp } from '../../state/store';
import { verdictLabel, verdictSentence } from '../VerdictCard';
import { fmtNum, useT } from '../../lib/format';

/** Landing safety, percent: 1 - P(tip-over) from the touchdown dispersion model. A probability; null until the model has run. */
export function landingSafetyPct(v: Verdict): number | null {
  return v.tipoverP === null || v.tipoverP === undefined ? null : 100 * (1 - v.tipoverP);
}

function Bars({ data }: { data: ScenarioData }) {
  const t = useT();
  const v = useVerdict(data);
  const setActive = useApp((s) => s.setActive);
  const active = useApp((s) => s.active);
  const bars: { id: string; icon: string; label: string; value: number | null; tone: string }[] = [
    { id: 'sun', icon: '☀', label: t('Solar energy', 'Energía solar'), value: v ? v.illuminationPct : null, tone: 'sun' },
    { id: 'earth', icon: '⌁', label: t('Contact with the Earth', 'Contacto con la Tierra'), value: v ? v.linkPct : null, tone: 'rf' },
    { id: 'night', icon: '▮', label: t('Night survival', 'Supervivencia nocturna'), value: v ? Math.min(100, (100 * v.survivalHours) / Math.max(1, v.windowHours)) : null, tone: 'ops' },
    { id: 'ground', icon: '▲', label: t('Landing safety = 1 − P(tip-over)', 'Seguridad de aterrizaje = 1 − P(vuelco)'), value: v ? landingSafetyPct(v) : null, tone: 'rock' },
  ];
  return (
    <section className={`panel block quick${active === data.key ? ' is-active' : ''}`} data-testid={`quick-${data.key}`}>
      <h3>
        <span className={`badge badge-${data.key}`}>{data.key}</span><span className="site-label" data-site-label={data.name}>{data.name}</span>
        {v && <em className={`quick-level is-${v.level}`}>{verdictLabel(v, t)}</em>}
      </h3>
      {bars.map((b) => (
        <div key={b.id} className="quick-bar" data-bar={b.id}>
          <span><i aria-hidden="true">{b.icon}</i>{b.label}</span>
          <div className="quick-track"><i className={`tone-${b.tone}`} style={{ width: `${b.value ?? 0}%` }} /></div>
          <output className="mono">{b.value === null ? '···' : `${fmtNum(b.value, 0)} %`}</output>
        </div>
      ))}
      {v && <p className="quick-slope mono" data-bar="slope">{t('Ground slope', 'Pendiente del terreno')} {fmtNum(v.slopeDeg, 1)}°</p>}
      {v && <p className="kpi-note pad0">{verdictSentence(v, t)}</p>}
      {active !== data.key && <button type="button" className="btn btn-small" onClick={() => setActive(data.key)}>{t('Show this one in 3-D', 'Ver este en 3D')}</button>}
    </section>
  );
}

export function QuickCompare() {
  const { A, B } = useMission();
  return (<><Bars data={A} /><Bars data={B} /></>);
}
