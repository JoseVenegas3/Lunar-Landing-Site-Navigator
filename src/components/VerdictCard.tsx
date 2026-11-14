/**
 * Executive verdict of the active scenario in plain language (GO / CAUTION /
 * NO-GO), with the one-click rescue and its before/after.
 */
import { Verdict, VerdictCause } from '../engine';
import { ScenarioData } from '../state/mission';
import { useRescue, useVerdict } from '../state/verdict';
import { cardinal, fmtDateTime, fmtDuration, fmtNum, useT } from '../lib/format';
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
    case 'thermal': return t(`Thermal failure on ${dayHour(v.survivalHours, t)}: a long shadow drains the battery and the bus freezes at −20 °C.`, `Falla térmica en ${dayHour(v.survivalHours, t)}: una sombra prolongada agota la batería y el bus se congela a −20 °C.`);
    case 'battery': return t(`Battery empty on ${dayHour(v.survivalHours, t)}: the shadows last longer than the stored energy.`, `Batería agotada en ${dayHour(v.survivalHours, t)}: las sombras duran más que la energía almacenada.`);
    case 'no-link': return t('No contact with the Earth: the terrain hides it for the whole mission.', 'Sin contacto con la Tierra: el terreno la oculta durante toda la misión.');
    case 'needs-relay': return t(`It loses contact with the Earth for ${fmtDuration(v.longestLinkGapH)} in a row. It needs a relay satellite.`, `Pierde contacto con la Tierra ${fmtDuration(v.longestLinkGapH)} seguidas. Necesita un satélite relay.`);
    case 'link-gap': return t(`Even with the relay it is out of contact for ${fmtDuration(v.longestLinkGapH)} in a row.`, `Aun con relay queda sin contacto ${fmtDuration(v.longestLinkGapH)} seguidas.`);
    case 'deep-discharge': return t('The battery goes below its safe depth of discharge.', 'La batería baja de su profundidad de descarga segura.');
    case 'tilt': return t(`The lander rests tilted ${fmtNum(v.tiltDeg, 0)}°.`, `El lander queda inclinado ${fmtNum(v.tiltDeg, 0)}°.`);
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
    return t(`The lander survives the ${days} days. Sunlight ${fmtNum(v.illuminationPct, 0)} % of the time and contact with the Earth ${fmtNum(v.linkPct, 0)} %.`, `El lander sobrevive los ${days} días. Luz solar el ${fmtNum(v.illuminationPct, 0)} % del tiempo y contacto con la Tierra el ${fmtNum(v.linkPct, 0)} %.`);
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

export function VerdictCard({ data }: { data: ScenarioData }) {
  const t = useT();
  const v = useVerdict(data);
  const rescue = useRescue(data);
  if (!v) {
    return <div className="verdict is-wait" data-testid="verdict" role="status"><span className="verdict-light" /><p>{t('Reading the terrain…', 'Leyendo el terreno…')}</p></div>;
  }
  const o = rescue.last;
  return (
    <div className={`verdict is-${v.level}`} data-testid="verdict" data-level={v.level} role="status" aria-live="polite">
      <span className="verdict-light" aria-hidden="true" />
      <div className="verdict-text">
        <strong><ScenarioBadge k={data.key} />{verdictLabel(v, t)}</strong>
        <p data-testid="verdict-sentence">{verdictSentence(v, t)}</p>
        {o && (
          <p className="verdict-after" data-testid="verdict-after">
            <Chip v={o.before} t={t} /><span aria-hidden="true">→</span><Chip v={o.after} t={t} />
            <span>
              {o.after.level === 'nogo' && o.action !== 'none' && t('No point within 200 m and no date in the next 60 days saves this mission. Best found: ', 'Ningún punto a 200 m ni fecha en los próximos 60 días salva esta misión. Lo mejor hallado: ')}
              {o.action === 'move' && t(`moved ${fmtNum(Math.hypot(o.eastM, o.northM), 0)} m to the ${cardinal((Math.atan2(o.eastM, o.northM) * 180) / Math.PI)}`, `movido ${fmtNum(Math.hypot(o.eastM, o.northM), 0)} m al ${cardinal((Math.atan2(o.eastM, o.northM) * 180) / Math.PI)}`)}
              {o.action === 'date' && o.startMs !== null && t(`landing moved to ${fmtDateTime(o.startMs)} UTC`, `alunizaje movido al ${fmtDateTime(o.startMs)} UTC`)}
              {o.action === 'none' && t('No better point within 200 m and no better date in the next 60 days. Try a shorter mission, a larger battery or another site', 'No hay mejor punto a 200 m ni mejor fecha en los próximos 60 días. Prueba una misión más corta, una batería mayor u otro sitio')}
              {' · '}{o.missions} {t('missions in', 'misiones en')} {fmtNum(o.elapsedMs / 1000, 1)} s
            </span>
          </p>
        )}
      </div>
      {rescue.progress !== null ? (
        <div className="verdict-busy mono" data-testid="verdict-busy">{t('Searching', 'Buscando')} {Math.round(rescue.progress * 100)}%<div className="bar"><i style={{ width: `${Math.round(rescue.progress * 100)}%` }} /></div></div>
      ) : v.level !== 'go' && (
        <button type="button" className="btn btn-rescue" onClick={rescue.run} data-testid="verdict-fix" title={t('Tries the 25 touchdown points within 200 m, then later dates', 'Prueba los 25 puntos de contacto a 200 m y luego fechas posteriores')}>
          {t('⚡ Optimise site and date', '⚡ Optimizar sitio y fecha')}
        </button>
      )}
    </div>
  );
}
