/**
 * Plain-language answer of the emergency flow (v2.1 change 7): a one-line
 * headline with three states (survives / survives if… / does not survive)
 * and, right under it, the "Way out" block: is there one, the options computed
 * with the engine (stay and cut the load, move within 500 m, wait for the
 * Sun) and, when none works, what is missing. Colour, icon and text together;
 * both blocks are status regions for screen readers.
 */
import { HOUR_MS } from '../engine';
import { ExitPlan, SurvivalState } from '../state/exitPlan';
import { useApp } from '../state/store';
import { cardinal, fmtDateTime, fmtDuration, fmtNum, useT } from '../lib/format';

type T = (en: string, es: string) => string;
export type Tone = 'ok' | 'warn' | 'crit' | 'busy';

export interface ExitOptionText { key: 'load' | 'move' | 'wait'; tone: Tone; text: string }
export interface ExitText {
  state: SurvivalState | 'pending';
  tone: Tone;
  title: string;
  line: string;
  /** "Yes, there is a way out" / "No way out with what was declared" / searching. */
  exit: string;
  options: ExitOptionText[];
  /** What would be missing, only when there is no way out. */
  missing: string | null;
}

/** Absolute date and time since the start of the horizon: "2027-09-05 17:00 UTC (T+3 d 17 h)". */
export const when = (startMs: number, h: number): string => `${fmtDateTime(startMs + h * HOUR_MS)} UTC (T+${fmtDuration(h)})`;

/** Every text of the headline and the exit block, from the plan alone (unit-tested in both languages). */
export function exitText(p: ExitPlan, t: T): ExitText {
  const d = fmtNum(p.horizonH / 24, 0);
  const lossPhrase = (h: number | null, cause: 'thermal' | 'battery' | null): string => (h === null ? '' : cause === 'thermal'
    ? t(`it leaves its thermal range (bus below −20 °C, battery frozen) on ${when(p.startMs, h)}`, `sale del rango térmico (bus bajo −20 °C, batería congelada) el ${when(p.startMs, h)}`)
    : t(`it runs out of energy on ${when(p.startMs, h)}`, `se queda sin energía el ${when(p.startMs, h)}`));
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const pending = !p.done;
  const b = p.base;

  // (a) stay and cut the load
  const load: ExitOptionText = b.survives
    ? { key: 'load', tone: 'ok', text: t(`Stay: with the current minimum load it lasts the ${d} d.`, `Quedarse: con la carga mínima actual aguanta los ${d} d.`) }
    : !p.load
      ? { key: 'load', tone: 'busy', text: t('Stay and cut the load: computing…', 'Quedarse y reducir carga: calculando…') }
      : p.load.maxW !== null
        ? { key: 'load', tone: 'ok', text: t(`Stay and lower the minimum load from ${fmtNum(p.load.currentW, 0)} W to ${fmtNum(p.load.maxW, 1)} W or less: it lasts the ${d} d.`, `Quedarse y bajar la carga mínima de ${fmtNum(p.load.currentW, 0)} W a ${fmtNum(p.load.maxW, 1)} W o menos: aguanta los ${d} d.`) }
        : { key: 'load', tone: 'crit', text: t(`Stay and cut the load: not enough. Even at 0 W ${lossPhrase(p.load.atZero.lossH, p.load.atZero.cause)}.`, `Quedarse y reducir carga: no alcanza. Aun con 0 W ${lossPhrase(p.load.atZero.lossH, p.load.atZero.cause)}.`) };

  // (b) move within 500 m
  const m = p.move;
  const move: ExitOptionText = m
    ? m.survives
      ? { key: 'move', tone: 'ok', text: t(`Move ${fmtNum(m.distanceM, 0)} m to the ${cardinal(m.azimuthDeg)} (azimuth ${fmtNum(m.azimuthDeg, 0)}°): it lasts the ${d} d.`, `Moverse ${fmtNum(m.distanceM, 0)} m al ${cardinal(m.azimuthDeg)} (acimut ${fmtNum(m.azimuthDeg, 0)}°): aguanta los ${d} d.`) }
      : { key: 'move', tone: 'warn', text: t(`Move ${fmtNum(m.distanceM, 0)} m to the ${cardinal(m.azimuthDeg)} (azimuth ${fmtNum(m.azimuthDeg, 0)}°): ${fmtDuration(m.gainH)} more, but ${lossPhrase(m.lossH, m.cause)}.`, `Moverse ${fmtNum(m.distanceM, 0)} m al ${cardinal(m.azimuthDeg)} (acimut ${fmtNum(m.azimuthDeg, 0)}°): ${fmtDuration(m.gainH)} más, pero ${lossPhrase(m.lossH, m.cause)}.`) }
    : pending
      ? { key: 'move', tone: 'busy', text: t('Move up to 500 m: computing…', 'Moverse hasta 500 m: calculando…') }
      : { key: 'move', tone: b.survives ? 'ok' : 'crit', text: t('Move up to 500 m: no point within 500 m does better than staying.', 'Moverse hasta 500 m: ningún punto a 500 m o menos mejora quedarse.') };

  // (c) wait for the Sun
  const w = p.wait;
  const wait: ExitOptionText = b.survives
    ? { key: 'wait', tone: 'ok', text: t('Wait for the next sunlight: not needed, it survives as it is.', 'Esperar la próxima luz: no hace falta, sobrevive tal como está.') }
    : !w
      ? { key: 'wait', tone: 'busy', text: t('Wait for the next sunlight: computing…', 'Esperar la próxima luz: calculando…') }
      : w.sunH === null
        ? { key: 'wait', tone: 'crit', text: t(`Wait for the next sunlight: the Sun does not come back within the ${d} d.`, `Esperar la próxima luz: el Sol no vuelve dentro de los ${d} d.`) }
        : { key: 'wait', tone: 'crit', text: t(`Wait for the next sunlight: the Sun comes back on ${when(p.startMs, w.sunH)}, ${fmtDuration(w.shortH ?? 0)} after the loss; the lander does not get there alive.`, `Esperar la próxima luz: el Sol vuelve el ${when(p.startMs, w.sunH)}, ${fmtDuration(w.shortH ?? 0)} después de la pérdida; el módulo no llega vivo.`) };

  const options = [load, move, wait];
  const state: SurvivalState | 'pending' = b.survives ? 'survives' : pending ? 'pending' : p.state;

  let title: string, line: string, tone: Tone;
  if (state === 'survives') {
    title = t('SURVIVES', 'SOBREVIVE');
    line = t(`The lander survives the whole horizon (${d} d) with ${fmtNum(b.minSocPct, 0)} % energy margin (lowest battery charge).`, `El módulo sobrevive todo el horizonte (${d} d) con ${fmtNum(b.minSocPct, 0)} % de margen de energía (carga mínima de la batería).`);
    tone = 'ok';
  } else if (state === 'survives-if') {
    title = t('SURVIVES IF…', 'SOBREVIVE SI…');
    const act = p.load && p.load.maxW !== null
      ? t(`it lowers its minimum load to ${fmtNum(p.load.maxW, 1)} W or less`, `baja su carga mínima a ${fmtNum(p.load.maxW, 1)} W o menos`)
      : t(`it moves ${fmtNum(m?.distanceM ?? 0, 0)} m to the ${cardinal(m?.azimuthDeg ?? 0)}`, `se mueve ${fmtNum(m?.distanceM ?? 0, 0)} m al ${cardinal(m?.azimuthDeg ?? 0)}`);
    line = t(`…${act}. If nothing changes, ${lossPhrase(b.lossH, b.cause)}.`, `…${act}. Si no cambia nada, ${lossPhrase(b.lossH, b.cause)}.`);
    tone = 'warn';
  } else if (state === 'lost') {
    title = t('DOES NOT SURVIVE', 'NO SOBREVIVE');
    line = t(`${cap(lossPhrase(b.lossH, b.cause))} if nothing changes.`, `${cap(lossPhrase(b.lossH, b.cause))} si no cambia nada.`);
    tone = 'crit';
  } else {
    title = t('DOES NOT SURVIVE AS IT IS', 'NO SOBREVIVE TAL COMO ESTÁ');
    line = t(`${cap(lossPhrase(b.lossH, b.cause))} if nothing changes. Looking for a way out…`, `${cap(lossPhrase(b.lossH, b.cause))} si no cambia nada. Buscando una salida…`);
    tone = 'crit';
  }

  const exit = state === 'pending'
    ? t(`Looking for a way out… ${Math.round(100 * p.progress)} %`, `Buscando una salida… ${Math.round(100 * p.progress)} %`)
    : state === 'lost' ? t('No way out with what was declared', 'No hay salida con lo declarado') : t('Yes, there is a way out', 'Sí hay salida');

  let missing: string | null = null;
  if (state === 'lost') {
    const need = p.need;
    const sun = w && w.sunH !== null && w.shortH !== null ? t(` ${fmtDuration(w.shortH)} are missing until the next sunlight.`, ` Faltan ${fmtDuration(w.shortH)} para el próximo Sol.`) : '';
    missing = need && need.energyWh !== null && need.extraWh !== null
      ? t(`No way out with the declared resources: it would need ${fmtNum(need.extraWh, 0)} Wh more in the battery (${fmtNum(need.energyWh, 0)} Wh in all).${sun}`, `No hay salida con los recursos declarados: se necesitarían ${fmtNum(need.extraWh, 0)} Wh más en la batería (${fmtNum(need.energyWh, 0)} Wh en total).${sun}`)
      : t(`No way out with the declared resources: not even ${fmtNum(need?.ceilingWh ?? 0, 0)} Wh stored would save it.${sun}`, `No hay salida con los recursos declarados: ni con ${fmtNum(need?.ceilingWh ?? 0, 0)} Wh almacenados sobrevive.${sun}`);
  }
  return { state, tone, title, line, exit, options, missing };
}

function Icon({ tone }: { tone: Tone }) {
  const d = tone === 'ok' ? 'M4 10.5 8 14.5 16 5.5' : tone === 'warn' ? 'M10 4v7M10 14.5v.5' : tone === 'crit' ? 'M5 5l10 10M15 5 5 15' : 'M4 10h2M9 10h2M14 10h2';
  return <svg className="exit-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** One-line headline: survives / survives if… / does not survive. */
export function SurvivalHeadline({ plan }: { plan: ExitPlan }) {
  const t = useT();
  const x = exitText(plan, t);
  return (
    <div className={`surv-head is-${x.tone}`} role="status" aria-live="polite" data-testid="surv-head" data-state={x.state}>
      <Icon tone={x.tone} />
      <p><strong>{x.title}</strong> {x.line}</p>
    </div>
  );
}

/** The "Way out" block, always visible under the headline. */
export function ExitBlock({ plan, onMove }: { plan: ExitPlan; onMove: (eastM: number, northM: number) => void }) {
  const t = useT();
  const x = exitText(plan, t);
  const lang = useApp((s) => s.lang);
  return (
    <section className={`exit-block is-${x.state === 'lost' ? 'crit' : x.state === 'pending' ? 'busy' : 'ok'}`} aria-label={t('Way out', 'Salida')} data-testid="exit-block" data-state={x.state} lang={lang}>
      <h4 role="status" aria-live="polite"><Icon tone={x.state === 'lost' ? 'crit' : x.state === 'pending' ? 'busy' : 'ok'} />{t('Way out', 'Salida')}: <b data-testid="exit-answer">{x.exit}</b></h4>
      <ol className="exit-options">
        {x.options.map((o) => (
          <li key={o.key} className={`is-${o.tone}`} data-option={o.key} data-tone={o.tone}>
            <Icon tone={o.tone} /><span>{o.text}</span>
            {o.key === 'move' && plan.move && (
              <button type="button" className="btn btn-small" onClick={() => onMove(plan.move?.eastM ?? 0, plan.move?.northM ?? 0)} data-testid="exit-move">{t('Move there', 'Mover ahí')}</button>
            )}
          </li>
        ))}
      </ol>
      {x.missing && <p className="exit-missing" data-testid="exit-missing">{x.missing}</p>}
    </section>
  );
}
