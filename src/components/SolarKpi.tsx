/**
 * Effective solar elevation as a power KPI (v3.1, SR-403): elevation now and
 * the best of the window, the incidence factor of the array and the visible
 * share of the solar disc, on a 0–5° arc. Values from solarElevationKpi().
 */
import { solarElevationKpi } from '../engine';
import { ScenarioData, useThrottledCursor } from '../state/mission';
import { fmtDuration, fmtNum, useT } from '../lib/format';

const ARC_MAX = 5;

/** Quarter-dial from 0° to 5°: the cyan needle is the Sun now, the amber tick the best of the window. */
export function SolarArc({ now, max, size = 112 }: { now: number; max: number; size?: number }) {
  const R = 44, cx = 50, cy = 52;
  const at = (deg: number): [number, number] => {
    const a = (Math.max(0, Math.min(ARC_MAX, deg)) / ARC_MAX) * (Math.PI / 2);
    return [cx - R * Math.cos(a), cy - R * Math.sin(a)];
  };
  const [nx, ny] = at(now), [mx, my] = at(max);
  const ticks = [0, 1, 2, 3, 4, 5];
  return (
    <svg className="sun-arc" viewBox="0 0 100 60" width={size} height={(size * 60) / 100} role="img"
      aria-label={`${fmtNum(now, 2)}° / ${fmtNum(max, 2)}°`} data-testid="sun-arc">
      <path d={`M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx} ${cy - R}`} className="sun-arc-track" />
      {ticks.map((d) => { const [x, y] = at(d); const [x2, y2] = [cx + (x - cx) * 0.86, cy + (y - cy) * 0.86]; return <g key={d}><line x1={x} y1={y} x2={x2} y2={y2} className="sun-arc-tick" /><text x={cx + (x - cx) * 0.7} y={cy + (y - cy) * 0.7 + 2} className="sun-arc-lab">{d}°</text></g>; })}
      <line x1={cx} y1={cy} x2={mx} y2={my} className="sun-arc-max" />
      <line x1={cx} y1={cy} x2={nx} y2={ny} className={`sun-arc-now${now <= 0 ? ' is-down' : ''}`} />
      <circle cx={nx} cy={ny} r="3.4" className={`sun-arc-sun${now <= 0 ? ' is-down' : ''}`} />
      <line x1={cx - R - 2} y1={cy} x2={cx + 4} y2={cy} className="sun-arc-horizon" />
    </svg>
  );
}

export function SolarKpi({ data, compact = false }: { data: ScenarioData; compact?: boolean }) {
  const t = useT();
  const cursor = useThrottledCursor();
  const r = data.result;
  if (!r) return null;
  const k = solarElevationKpi(r, cursor);
  const grazing = k.elMaxDeg < 5;
  const tone = k.fracNow <= 0 ? 'crit' : k.fracNow < 0.5 ? 'warn' : 'ok';
  return (
    <div className={`vital solar-kpi is-${tone}${compact ? ' is-compact' : ''}`} data-vital="sunel" data-testid="solar-kpi"
      data-el-now={k.elNowDeg.toFixed(2)} data-el-max={k.elMaxDeg.toFixed(2)}>
      <span className="vital-label">{t('Effective solar elevation (power KPI)', 'Elevación solar efectiva (KPI potencia)')}</span>
      <div className="solar-kpi-row">
        <SolarArc now={k.elNowDeg} max={k.elMaxDeg} size={compact ? 92 : 112} />
        <div className="solar-kpi-nums">
          <output className="vital-value mono" data-testid="solar-el-now">{fmtNum(k.elNowDeg, 2)}°</output>
          <span className="vital-sub mono" data-testid="solar-el-max">
            {fmtNum(k.elMaxDeg, 2)}° {t('max', 'máx')} · T+{fmtDuration(k.elMaxAtH)}{grazing ? ` · ${t('grazing polar Sun', 'Sol rasante polar')}` : ''}
          </span>
        </div>
      </div>
      <dl className="solar-kpi-dl">
        <div><dt>{t('Visible solar disc', 'Disco solar visible')} f☉</dt><dd className="mono" data-testid="solar-frac">{fmtNum(100 * k.fracNow, 0)} %</dd></div>
        <div><dt>{t('Incidence factor on the array', 'Factor de incidencia en el arreglo')}</dt><dd className="mono">{fmtNum(k.incidenceNow, 3)}</dd></div>
        <div><dt>{t('Array power now / peak', 'Potencia ahora / pico')}</dt><dd className="mono" data-testid="solar-power">{fmtNum(k.powerNowW, 0)} W / {fmtNum(k.powerPeakW, 0)} W</dd></div>
      </dl>
      {!compact && (
        <p className="vital-sub solar-kpi-note">
          {t('The Sun skims the horizon: a few tenths of a degree decide whether the disc clears a ridge (f☉) and so how much power reaches the array. Raising the mast lifts the panels above nearby shadows.', 'El Sol roza el horizonte: unas décimas de grado deciden si el disco supera una cresta (f☉) y por tanto cuánta potencia llega al arreglo. Subir el mástil eleva los paneles por encima de las sombras cercanas.')}
        </p>
      )}
    </div>
  );
}
