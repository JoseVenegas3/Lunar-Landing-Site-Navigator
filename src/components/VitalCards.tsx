/**
 * The three numbers a flight director asks for first: how long the Sun stays,
 * whether the Earth is reachable, and how long until the lander freezes.
 * Counted from the time on the shared cursor.
 */
import { emergencyCountdown } from '../engine';
import { ScenarioData, useThrottledCursor } from '../state/mission';
import { fmtDuration, useT } from '../lib/format';
import { useUnits } from '../lib/units';
import { SolarKpi } from './SolarKpi';

type Tone = 'ok' | 'warn' | 'crit';

function Card({ label, value, sub, tone, id }: { label: string; value: string; sub: string; tone: Tone; id: string }) {
  return (
    <div className={`vital is-${tone}`} data-vital={id}>
      <span className="vital-label">{label}</span>
      <output className="vital-value mono">{value}</output>
      <span className="vital-sub">{sub}</span>
    </div>
  );
}

export function VitalCards({ data, testId = 'vitals', showSolar = true }: { data: ScenarioData; testId?: string; showSolar?: boolean }) {
  const t = useT();
  const u = useUnits();
  const cursor = useThrottledCursor();
  const r = data.result;
  if (!r) return <div className="vitals" data-testid={testId}><p className="kpi-note pad0">{t('Flying the mission…', 'Simulando la misión…')}</p></div>;
  const c = emergencyCountdown(r, cursor);
  const windowH = (r.count - 1) * r.stepHours;
  const left = Math.max(0, windowH - cursor);

  const light: [string, string, Tone] = !c.aliveNow
    ? ['—', t('the lander is lost', 'el módulo está perdido'), 'crit']
    : c.sunNow
      ? [c.toDarkH === null ? fmtDuration(left) : fmtDuration(c.toDarkH), c.toDarkH === null ? t('sunlit to the end of the window', 'con sol hasta el final de la ventana') : t('of sunlight before the next shadow', 'de sol antes de la próxima sombra'), c.toDarkH !== null && c.toDarkH < 24 ? 'warn' : 'ok']
      : ['0 h', c.toSunH === null ? t('dark, no sunrise in this window', 'a oscuras, sin amanecer en esta ventana') : t(`dark now, sunrise in ${fmtDuration(c.toSunH)}`, `a oscuras, amanece en ${fmtDuration(c.toSunH)}`), c.toSunH === null ? 'crit' : 'warn'];

  const dte: [string, string, Tone] = c.linkNow
    ? [t('OPEN', 'ACTIVA'), c.toLinkLossH === null ? t('stays open to the end of the window', 'abierta hasta el final de la ventana') : t(`closes in ${fmtDuration(c.toLinkLossH)}`, `se cierra en ${fmtDuration(c.toLinkLossH)}`), 'ok']
    : [t('CLOSED', 'CERRADA'), c.toLinkH === null ? t('no contact in this window', 'sin contacto en esta ventana') : t(`opens in ${fmtDuration(c.toLinkH)}`, `se abre en ${fmtDuration(c.toLinkH)}`), c.toLinkH === null ? 'crit' : 'warn'];

  const freeze: [string, string, Tone] = !c.aliveNow
    ? ['0 h', c.lossCause === 'thermal' ? t('battery frozen', 'batería congelada') : t('battery empty', 'batería agotada'), 'crit']
    : c.toLossH === null
      ? [t('SAFE', 'A SALVO'), t(`survives the ${Math.round(windowH / 24)} days`, `sobrevive los ${Math.round(windowH / 24)} días`), 'ok']
      : [fmtDuration(c.toLossH), c.lossCause === 'thermal' ? t(`until the bus freezes at ${u.c(-20)}`, `hasta que el bus se congele a ${u.c(-20)}`) : t('until the battery is empty', 'hasta agotar la batería'), c.toLossH < 48 ? 'crit' : 'warn'];

  return (
    <div className="vitals" data-testid={testId}>
      <Card id="light" label={t('Continuous sunlight', 'Luz continua')} value={light[0]} sub={light[1]} tone={light[2]} />
      <Card id="dte" label={t('Earth link window', 'Ventana DTE')} value={dte[0]} sub={dte[1]} tone={dte[2]} />
      <Card id="freeze" label={t('Time to freeze', 'Tiempo hasta congelamiento')} value={freeze[0]} sub={freeze[1]} tone={freeze[2]} />
      {showSolar && <SolarKpi data={data} compact />}
    </div>
  );
}
