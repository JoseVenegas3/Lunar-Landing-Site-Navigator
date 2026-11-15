/**
 * Director of the Beginner training (v3.0). Runs the declarative script
 * (script.ts) over the real app: each step drives the store, spotlights its
 * target, narrates with live engine values and waits for the real action
 * (state predicate, click on the target, gesture on the 3-D view). After
 * 15 s without progress the target pulses; after 45 s "Do it for me" appears.
 * The dimmed area outside the target catches the pointer and answers with a
 * nudge; on the 3-D view only the gestures of the step get through.
 *
 * The overlay reuses the spotlight approach of the v2.1 tutorial
 * (MissionBriefingTour): a rectangle that follows the target every frame.
 */
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMission } from '../state/mission';
import { SUBSYSTEM_ORDER, useApp } from '../state/store';
import { useT } from '../lib/format';
import { finishTraining } from './lifecycle';
import { SCRIPT, Ctx } from './script';
import { applyVolume, closeAudio, play } from './audio';
import { nudge, useBeginner } from './state';

const HINT_MS = 15_000, HELP_MS = 45_000;

const rectOf = (focus: string | 'canvas' | null | undefined): DOMRect | null => {
  if (!focus) return null;
  const el = document.querySelector(focus === 'canvas' ? '[data-testid="scene"]' : focus);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};

const CARD_W = 380;
function placeCard(r: DOMRect | null, h: number, canvas: boolean): CSSProperties {
  const vw = window.innerWidth, vh = window.innerHeight, gap = 14, pad = 12;
  if (!r || canvas) return { left: Math.max(pad, (vw - CARD_W) / 2), top: 120 };
  const fits = (x: number, y: number): boolean => x >= pad && y >= pad && x + CARD_W <= vw - pad && y + h <= vh - pad;
  const cx = Math.min(Math.max(pad, r.left + r.width / 2 - CARD_W / 2), vw - CARD_W - pad);
  const options: [number, number][] = [[cx, r.bottom + gap], [cx, r.top - gap - h], [r.right + gap, r.top], [r.left - gap - CARD_W, r.top]];
  const hit = options.find(([x, y]) => fits(x, y));
  return hit ? { left: hit[0], top: hit[1] } : { right: pad, bottom: pad };
}

export function Beginner() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const app = useApp();
  const { A, B } = useMission();
  const b = useBeginner();
  const memo = useRef<Record<string, number>>({});
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(180);
  const clicked = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const step = b.step >= 0 ? SCRIPT[b.step] : null;
  const ctx: Ctx = { app, A, B, memo: memo.current };
  const scale = b.fast ? 0.1 : 1;

  // Start: everything locked but the first console, nothing revealed.
  useEffect(() => {
    const s = useApp.getState();
    s.setUnlocked([]);
    s.setBriefing('off');
    useBeginner.getState().set({ step: 0, stepAt: performance.now(), stuck: 0, reveal: [], done: 0, fresh: null });
    return () => { closeAudio(); };
  }, []);

  useEffect(() => { applyVolume(); }, [b.muted, b.volume]);

  // Enter a step: drive the app, play its sound, apply its unlock.
  useEffect(() => {
    if (!step) return;
    clicked.current = false;
    step.enter?.({ app: useApp.getState(), A, B, memo: memo.current });
    if (step.reveal) useBeginner.getState().set({ reveal: [...new Set([...useBeginner.getState().reveal, ...step.reveal])] });
    if (step.sfx) play(step.sfx, useApp.getState().lang);
    if (step.unlock) {
      const u = useApp.getState().unlocked;
      useApp.getState().setUnlocked([...new Set([...u, step.unlock])]);
      useBeginner.getState().set({ fresh: step.unlock });
    }
    useBeginner.getState().set({ stepAt: performance.now(), stuck: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.step]);

  const next = useCallback(() => {
    const st = useBeginner.getState();
    const cur = SCRIPT[st.step];
    if (!cur) return;
    if (cur.seal) st.set({ done: Math.max(st.done, cur.mission + 1) });
    if (st.step + 1 < SCRIPT.length) st.set({ step: st.step + 1 });
  }, []);

  // Clicks on the step target count as the action.
  useEffect(() => {
    if (!step?.click) return;
    const sel = step.click;
    const onClick = (e: MouseEvent): void => { if ((e.target as Element | null)?.closest(sel)) clicked.current = true; };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step]);

  // Gestures on the 3-D view: only those of the step get through.
  useEffect(() => {
    const el = document.querySelector('[data-testid="scene"]');
    if (!el || !step) return;
    const allow = step.focus === 'canvas' ? step.allow ?? [] : [];
    const es = useApp.getState().lang === 'es';
    const block = (kind: 'drag' | 'wheel' | 'dblclick') => (e: Event): void => {
      if (allow.includes(kind)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (kind !== 'wheel' || step.focus === 'canvas') nudge(es ? 'Ahora no: sigue la indicación del recuadro' : 'Not now: follow the instruction in the box');
    };
    const down = block('drag'), wheel = block('wheel'), dbl = block('dblclick');
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('wheel', wheel, { capture: true, passive: false });
    el.addEventListener('dblclick', dbl, true);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('wheel', wheel, true);
      el.removeEventListener('dblclick', dbl, true);
    };
  }, [step, A.result]);

  // The loop: follow the target, check the end condition, raise the hint and the help.
  useEffect(() => {
    if (!step || step.cont || step.diploma) return;
    let raf = 0, last = '';
    let autoFrom: number | null = null;
    const tick = (): void => {
      const r = rectOf(step.focus);
      const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) { last = key; setRect(r); }
      const st = useBeginner.getState();
      const c: Ctx = { app: useApp.getState(), A, B, memo: memo.current };
      const now = performance.now();
      let done = false;
      if (step.auto !== undefined) {
        // A timed step starts counting once its condition (if any) holds: the text then has its values.
        if (autoFrom === null && (!step.until || step.until(c))) autoFrom = now;
        done = autoFrom !== null && now - autoFrom >= step.auto * scale;
      } else if (step.click) done = clicked.current && (!step.until || step.until(c));
      else if (step.until) done = step.until(c);
      if (done) { next(); return; }
      const idle = now - st.stepAt;
      const stuck = step.auto !== undefined ? 0 : idle > HELP_MS * scale ? 2 : idle > HINT_MS * scale ? 1 : 0;
      if (stuck !== st.stuck) st.set({ stuck });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, A, B, next, scale]);

  useLayoutEffect(() => { if (card.current) setCardH(card.current.offsetHeight); }, [b.step, lang, rect]);

  const doIt = (): void => {
    if (!step) return;
    const c: Ctx = { app: useApp.getState(), A, B, memo: memo.current };
    if (step.doIt) step.doIt(c);
    else if (step.click) (document.querySelector(step.click) as HTMLElement | null)?.click();
  };

  if (!step) return null;
  const text = step.say(ctx, t);
  const big = step.cont || step.diploma;
  const pad = 6;
  const spot = rect && !big ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad } : null;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="beg" data-testid="beginner" data-step={step.id} data-mission={step.mission}>
      {/* dim layer: four panels around the target catch the pointer */}
      {spot ? (
        <>
          {[
            { left: 0, top: 0, width: '100%', height: spot.top },
            { left: 0, top: spot.top + spot.height, width: '100%', bottom: 0 },
            { left: 0, top: spot.top, width: spot.left, height: spot.height },
            { left: spot.left + spot.width, top: spot.top, right: 0, height: spot.height },
          ].map((s, i) => (
            <div key={i} className="beg-dim" style={s as CSSProperties} onPointerDown={() => nudge(lang === 'es' ? 'Haz lo indicado en la zona iluminada' : 'Do what the box says in the highlighted area')} />
          ))}
          <div className={`beg-spot${b.stuck >= 1 ? ' is-pulse' : ''}`} style={spot} aria-hidden="true" />
        </>
      ) : big ? <div className="beg-dim beg-dim-all" /> : null}
      {step.alert && <div className={`beg-alert${reduced ? ' is-static' : ''}`} aria-hidden="true" />}

      {step.diploma ? (
        <div className="beg-diploma" role="dialog" aria-modal="true" aria-labelledby="beg-dip-h" data-testid="diploma">
          <img src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="96" height="96" />
          <h2 id="beg-dip-h">{t('TRAINING COMPLETE: GRADUATED AS FLIGHT DIRECTOR', 'ENTRENAMIENTO COMPLETADO: GRADUADO COMO FLIGHT DIRECTOR')}</h2>
          <p>{text}</p>
          <button type="button" className="btn beg-pro" onClick={finishTraining} data-testid="beg-to-pro" autoFocus>{t('OPEN THE PRO CONSOLE (MISSION LEADER)', 'ACCEDER A LA CONSOLA PRO (MISSION LEADER)')}</button>
        </div>
      ) : step.cont ? (
        <div className="beg-big" role="dialog" aria-modal="true" aria-labelledby="beg-big-h" data-testid="beg-big">
          <span className="beg-badge" aria-hidden="true">★</span>
          <h2 id="beg-big-h">{text}</h2>
          <button type="button" className="btn btn-brief" onClick={next} data-testid="beg-continue" autoFocus>{t('Continue', 'Continuar')}</button>
        </div>
      ) : (
        <div className="beg-card" ref={card} role="status" aria-live="polite" style={placeCard(rect, cardH, step.focus === 'canvas')} data-testid="beg-card">
          <p>{text}</p>
          {b.stuck >= 1 && step.hint && <p className="beg-hint" data-testid="beg-hint">{step.hint[lang === 'es' ? 1 : 0]}</p>}
          {b.stuck >= 2 && <button type="button" className="btn btn-small btn-brief" onClick={doIt} data-testid="beg-doit">{t('Do it for me', 'Hazlo por mí')}</button>}
        </div>
      )}

      {b.nudge && <div className="beg-nudge" role="status" data-testid="beg-nudge">{b.nudge}</div>}
      {b.caption && (b.muted || b.subtitles) && <div className="beg-caption" aria-live="polite" data-testid="beg-caption">{b.caption}</div>}
    </div>
  );
}

/** Every subsystem, for the end of the training. */
export const ALL_SUBSYSTEMS = SUBSYSTEM_ORDER;
