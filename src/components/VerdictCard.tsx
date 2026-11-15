/**
 * Executive verdict of the active scenario in plain language (GO / CAUTION /
 * NO-GO), with the one-click rescue and its before/after.
 */
import { Verdict, VerdictCause } from '../engine';
import { ScenarioData } from '../state/mission';
import { useRescue, useVerdict } from '../state/verdict';
import { RESCUE_SPANS, useApp } from '../state/store';
import { cardinal, fmtDateTime, fmtDuration, fmtNum, useT } from '../lib/format';
import { currentUnits, useUnits } from '../lib/units';
import { ScenarioBadge } from './ScenarioBadge';

type T = (en: string, es: string) => string;

const dayHour = (hours: number, t: T): string => {
  const d = Math.floor(hours / 24), h = Math.round(hours - d * 24);
  return t(`day ${d + 1}, hour ${h}`, `día ${d + 1}, hora ${h}`);
};

export function verdictLabel(v: Verdict, t: T): string {
  return v.level === 'go' ? t('GO', 'VIABLE') : v.level === 'caution' ? t('CAUTION', 'RIESGO MODERADO') : t('NO-GO', 'CRÍTICO');
}

function causeText(c: VerdictCause, v: Verdict, t: T): string {
  switch (c) {
    case 'thermal': return t(`Thermal failure on ${dayHour(v.survivalHours, t)}: a long shadow drains the battery and the bus freezes at ${currentUnits().c(-20)}.`, `Falla térmica en ${dayHour(v.survivalHours, t)}: una sombra prolongada agota la batería y el bus se congela a ${currentUnits().c(-20)}.`);
    case 'battery': return t(`Battery empty on ${dayHour(v.survivalHours, t)}: the shadows last longer than the stored energy.`, `Batería agotada en ${dayHour(v.survivalHours, t)}: las sombras duran más que la energía almacenada.`);
    case 'no-link': return t('No contact with the Earth: the terrain hides it for the whole mission.', 'Sin contacto con la Tierra: el terreno la oculta durante toda la misión.');
    case 'needs-relay': return t(`It loses contact with the Earth for ${fmtDuration(v.longestLinkGapH)} in a row. It needs a relay satellite.`, `Pierde contacto con la Tierra durante ${fmtDuration(v.longestLinkGapH)} sin interrupción. Necesita un satélite de relevo.`);
    case 'link-gap': return t(`Even with the relay it is out of contact for ${fmtDuration(v.longestLinkGapH)} in a row.`, `Aun con relevo queda sin contacto durante ${fmtDuration(v.longestLinkGapH)} sin interrupción.`);
    case 'deep-discharge': return t('The battery goes below its safe depth of discharge.', 'La batería baja de su profundidad de descarga segura.');
    case 'tilt': return t(`The lander rests tilted ${fmtNum(v.tiltDeg, 0)}°.`, `El módulo queda inclinado ${fmtNum(v.tiltDeg, 0)}°.`);
    case 'tipover': return t(`Risk of tipping over at touchdown: ${fmtNum(100 * (v.tipoverP ?? 0), 0)} %.`, `Riesgo de vuelco al contacto: ${fmtNum(100 * (v.tipoverP ?? 0), 0)} %.`);
    case 'slope': return t(`Steep ground: ${fmtNum(v.slopeDeg, 0)}° of slope.`, `Terreno empinado: ${fmtNum(v.slopeDeg, 0)}° de pendiente.`);
    case 'low-sun': return t(`Little sunlight: ${fmtNum(v.illuminationPct, 0)} % of the time.`, `Poca luz solar: ${fmtNum(v.illuminationPct, 0)} % del tiempo.`);
    default: return '';
  }
}

/** One or two sentences a non-specialist can act on. */
export function verdictSentence(v: Verdict, t: T): string {
  const days = fmtNum(v.windowHours / 24, 0);
  if (v.level === 'go') {
    return t(`The lander survives the ${days} days. Sunlight ${fmtNum(v.illuminationPct, 0)} % of the time and contact with the Earth ${fmtNum(v.linkPct, 0)} %.`, `El módulo sobrevive los ${days} días. Luz solar el ${fmtNum(v.illuminationPct, 0)} % del tiempo y contacto con la Tierra el ${fmtNum(v.linkPct, 0)} %.`);
  }
  const lead = v.level === 'caution' && v.survives ? t(`It survives the ${days} days, but: `, `Sobrevive los ${days} días, pero: `) : '';
  const rest = v.also.slice(0, 1).map((c) => ` ${causeText(c, v, t)}`).join('');
  return `${lead}${causeText(v.cause, v, t)}${rest}`;
}

function Chip({ v, t }: { v: Verdict; t: T }) {
  return (
    <span className={`verdict-chip is-${v.level}`}>
      <b>{verdictLabel(v, t)}</b>
      <span className="mono">{v.survives ? t('survives', 'sobrevive') : `T+${fmtDuration(v.survivalHours)}`} · {t('link', 'enlace')} {fmtNum(v.linkPct, 0)} %</span>
    </span>
  );
}

/** Short translation of the verdict label, for the emergency mode where the jargon is spelled out once. */
export function verdictGloss(v: Verdict, t: T): string {
  return v.level === 'go'
    ? t('the mission can be completed as declared', 'la misión se puede cumplir tal como está declarada')
    : v.level === 'caution'
      ? t('it can be completed, with the risks below', 'se puede cumplir, con los riesgos de abajo')
      : t('the mission cannot be completed as declared', 'la misión no se puede cumplir tal como está declarada');
}

export function VerdictCard({ data, gloss = false }: { data: ScenarioData; gloss?: boolean }) {
  const t = useT();
  const u = useUnits();
  const v = useVerdict(data);
  const rescue = useRescue(data);
  const days = useApp((s) => s.rescueDays);
  if (!v) {
    return <div className="verdict is-wait" data-testid="verdict" role="status"><span className="verdict-light" /><p>{t('Reading the terrain…', 'Leyendo el terreno…')}</p></div>;
  }
  const o = rescue.last;
  return (
    <div className={`verdict is-${v.level}`} data-testid="verdict" data-level={v.level} role="status" aria-live="polite">
      <span className="verdict-light" aria-hidden="true" />
      <div className="verdict-text">
        <strong><ScenarioBadge k={data.key} />{verdictLabel(v, t)}{gloss && <span className="verdict-gloss" data-testid="verdict-gloss">: {verdictGloss(v, t)}</span>}</strong>
        <p data-testid="verdict-sentence">{verdictSentence(v, t)}</p>
        {o && (
          <p className="verdict-after" data-testid="verdict-after">
            <Chip v={o.before} t={t} /><span aria-hidden="true">→</span><Chip v={o.after} t={t} />
            <span>
              {o.after.level === 'nogo' && o.action !== 'none' && t(`No point within 200 m and no date in the next ${days} days saves this mission. Best found: `, `Ningún punto a 200 m ni fecha en los próximos ${days} días salva esta misión. Lo mejor hallado: `)}
              {o.action === 'move' && t(`moved ${u.m(Math.hypot(o.eastM, o.northM))} to the ${cardinal((Math.atan2(o.eastM, o.northM) * 180) / Math.PI)}`, `movido ${u.m(Math.hypot(o.eastM, o.northM))} al ${cardinal((Math.atan2(o.eastM, o.northM) * 180) / Math.PI)}`)}
              {o.action === 'date' && o.startMs !== null && t(`landing moved to ${fmtDateTime(o.startMs)} UTC`, `alunizaje movido al ${fmtDateTime(o.startMs)} UTC`)}
              {o.action === 'none' && t(`No better point within 200 m and no better date in the next ${days} days. Try a shorter mission, a larger battery or another site`, `No hay mejor punto a 200 m ni mejor fecha en los próximos ${days} días. Prueba una misión más corta, una batería mayor u otro sitio`)}
              {' · '}<span data-testid="rescue-record" data-engine={o.engine}>{o.missions} {t('missions in', 'misiones en')} {fmtNum(o.elapsedMs / 1000, 1)} s{o.engine === 'worker' ? ` (Web Worker${o.pruned ? t(`, ${o.pruned} too steep skipped`, `, ${o.pruned} demasiado empinados omitidos`) : ''})` : o.pruned ? ` (${t(`${o.pruned} too steep skipped`, `${o.pruned} demasiado empinados omitidos`)})` : ''}</span>
            </span>
          </p>
        )}
      </div>
      {rescue.progress !== null ? (
        <div className="verdict-busy mono" data-testid="verdict-busy">{t('Searching', 'Buscando')} {Math.round(rescue.progress * 100)}%<div className="bar"><i style={{ width: `${Math.round(rescue.progress * 100)}%` }} /></div></div>
      ) : v.level !== 'go' && (
        <div className="verdict-actions">
          <label className="rescue-span" title={t('How far ahead the later dates are searched, every 12 h: one, two or three lunar months', 'Hasta dónde se buscan fechas posteriores, cada 12 h: uno, dos o tres meses lunares')}>
            <span>{t('Dates within', 'Fechas en')}</span>
            <select value={days} onChange={(e) => useApp.getState().setRescueDays(Number(e.target.value))} data-testid="rescue-days">
              {RESCUE_SPANS.map((d) => <option key={d} value={d}>{d} d</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-rescue" onClick={rescue.run} data-testid="verdict-fix" title={t(`Tries the 25 touchdown points within 200 m, then later dates over ${days} days`, `Prueba los 25 puntos de contacto a 200 m y luego fechas posteriores durante ${days} días`)}>
            {t('⚡ Optimise site and date', '⚡ Optimizar sitio y fecha')}
          </button>
        </div>
      )}
    </div>
  );
}
