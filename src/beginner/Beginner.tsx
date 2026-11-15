/**
 * Director of the Beginner training (v3.0). Runs the declarative script
 * (script.ts) over the real app: each step drives the store, spotlights its
 * target, narrates with live engine values and waits for the real action
 * (state predicate, click on the target, gesture on the 3-D view).
 *
 * Screens: the opening cinematic (Intro), the splash of each mission (its
 * patch, goal and reward), the transmission panel for every step
 * (typewriter text the user reads at their own pace, then "Continue" or the
 * objective to carry out), and the celebration of each finished mission
 * (its subsystem badge snapping into the rack, the console unlocked and what
 * comes next). v3.1: no dimming on the free 3-D steps of mission 0, strict
 * action locking (pointer and keyboard) everywhere else, and the target is
 * scrolled into view and followed while its panel scrolls.
 * After 15 s without progress the target pulses; after 45 s "Do it for me"
 * appears. The dimmed area outside the target catches the pointer and
 * answers with a nudge; on the 3-D view only the gestures of the step pass.
 */
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMission } from '../state/mission';
import { useApp } from '../state/store';
import { useT } from '../lib/format';
import { LearnButton, MISSION_TOPIC } from '../components/LearnMore';
import { Glossed } from '../components/Glossary';
import { camProbe, landerAnim } from '../components/3d/sceneMath';
import { SUB_ICON, subsystemLabel } from '../components/dashboard/SubsystemSwitch';
import { finishTraining } from './lifecycle';
import { DESCENT_KM, MISSION_INFO, MISSION_TITLES, SCRIPT, Ctx, Step } from './script';
import { applyVolume, blip, play } from './audio';
import { nudge, useBeginner } from './state';
import { Intro } from './Intro';
import { Patch } from './Patch';
import { BADGES, Badge } from './Badges';

const HINT_MS = 15_000, HELP_MS = 45_000;
const endIntro = (): void => { if (useBeginner.getState().phase === 'intro') useBeginner.getState().set({ phase: 'splash' }); };

/** Scroll the panel that holds the target (the wheel over the locked area still scrolls it). */
function scrollTargetPanel(focus: string | 'canvas' | null | undefined, dy: number): void {
  if (!focus || focus === 'canvas') return;
  let el = document.querySelector(focus)?.parentElement ?? null;
  while (el && !(el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  el?.scrollBy({ top: dy, behavior: 'auto' });
}

const rectOf = (focus: string | 'canvas' | null | undefined): DOMRect | null => {
  if (!focus) return null;
  const el = document.querySelector(focus === 'canvas' ? '[data-testid="scene"]' : focus);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};
const reducedMotion = (): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Text that is typed in, like a transmission; a click shows it all. */
function useTypewriter(text: string, speedCps: number, key: string): [string, boolean, () => void] {
  const [n, setN] = useState(0);
  const all = useRef(false);
  useEffect(() => { setN(0); all.current = false; }, [key]);
  useEffect(() => {
    if (reducedMotion() || all.current) { setN(text.length); return; }
    if (n >= text.length) return;
    const id = window.setTimeout(() => { setN((v) => Math.min(text.length, v + 2)); blip(); }, 1000 / speedCps * 2);
    return () => window.clearTimeout(id);
  }, [n, text, speedCps]);
  const finish = useCallback(() => { all.current = true; setN(text.length); }, [text]);
  return [text.slice(0, n), n >= text.length, finish];
}

export function Beginner() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const app = useApp();
  const { A, B } = useMission();
  const b = useBeginner();
  const memo = useRef<Record<string, number>>({});
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const clicked = useRef(false);
  const step: Step | null = b.step >= 0 ? SCRIPT[b.step] : null;
  const ctx: Ctx = { app, A, B, memo: memo.current };
  const scale = b.fast ? 0.1 : 1;
  const li = lang === 'es' ? 1 : 0;

  // Start: everything locked, nothing revealed, the cinematic first.
  useEffect(() => {
    const s = useApp.getState();
    s.setUnlocked([]);
    s.setBriefing('off');
    landerAnim.deploy = 0;
    landerAnim.drop = DESCENT_KM;
    useBeginner.getState().set({ step: 0, stepAt: performance.now(), stuck: 0, reveal: [], done: 0, fresh: null, phase: 'intro' });
    return () => { landerAnim.deploy = 1; landerAnim.drop = 0; landerAnim.size = landerAnim.sizeTarget = 1; };
  }, []);

  useEffect(() => { applyVolume(); }, [b.muted, b.volume, b.music]);

  // Enter a step (only once the splash or intro is gone).
  useEffect(() => {
    if (!step || b.phase !== 'step') return;
    clicked.current = false;
    setReady(false);
    step.enter?.({ app: useApp.getState(), A, B, memo: memo.current });
    if (step.reveal) useBeginner.getState().set({ reveal: [...new Set([...useBeginner.getState().reveal, ...step.reveal])] });
    if (step.sfx) play(step.sfx, useApp.getState().lang);
    else if (step.click || step.until) play('objective', useApp.getState().lang);
    useBeginner.getState().set({ stepAt: performance.now(), stuck: 0 });
    // The last step of a mission is its celebration.
    if (step.cont && step.seal) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.step, b.phase]);

  /** Move on: a mission's last step opens its celebration; a new mission opens its splash. */
  const next = useCallback((afterCelebration = false) => {
    const st = useBeginner.getState();
    const cur = SCRIPT[st.step];
    if (!cur) return;
    play('click', useApp.getState().lang);
    if (!afterCelebration && st.phase === 'step' && cur.seal && !cur.diploma) {
      const u = MISSION_INFO[cur.mission].unlocks;
      if (u && u !== 'overview') {
        useApp.getState().setUnlocked([...new Set([...useApp.getState().unlocked, u])]);
        st.set({ fresh: u });
      }
      st.set({ phase: 'celebrate', done: Math.max(st.done, cur.mission + 1) });
      play('fanfare', useApp.getState().lang);
      window.setTimeout(() => play('xp', useApp.getState().lang), 700);
      return;
    }
    if (st.step + 1 >= SCRIPT.length) return;
    const nextStep = SCRIPT[st.step + 1];
    st.set({ step: st.step + 1, phase: nextStep.mission !== cur.mission ? 'splash' : 'step' });
    if (nextStep.mission !== cur.mission) play('whoosh', useApp.getState().lang);
  }, []);

  // Clicks on the step target count as the action.
  useEffect(() => {
    if (!step?.click || b.phase !== 'step') return;
    const sel = step.click;
    const onClick = (e: MouseEvent): void => { if ((e.target as Element | null)?.closest(sel)) clicked.current = true; };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step, b.phase]);

  // The target is brought into view (centred) and keeps the focus; the keyboard cannot reach anything else.
  useEffect(() => {
    if (!step || b.phase !== 'step' || !step.focus || step.focus === 'canvas') return;
    const sel = step.focus;
    const bring = (): void => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    };
    const ids = [window.setTimeout(bring, 120), window.setTimeout(bring, 1300)];
    const inTarget = (n: EventTarget | null): boolean => {
      const el = n as Element | null;
      return Boolean(el && (el.closest(sel) || el.closest('.beg, .beg-hud, .beg-confirm, .learn, .units')));
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') {
        const target = document.querySelector(sel) as HTMLElement | null;
        const focusable = target?.matches('button, input, select, a, [tabindex]') ? target : target?.querySelector('button, input, select, a, [tabindex]') as HTMLElement | null;
        if (focusable && !inTarget(document.activeElement)) { e.preventDefault(); focusable.focus(); }
        else if (!inTarget(document.activeElement)) e.preventDefault();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && !inTarget(document.activeElement)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { ids.forEach((i) => window.clearTimeout(i)); window.removeEventListener('keydown', onKey, true); };
  }, [step, b.phase]);

  // Gestures on the 3-D view: only those of the step get through.
  useEffect(() => {
    const el = document.querySelector('[data-testid="scene"]');
    if (!el || !step) return;
    const allow = b.phase === 'step' && step.focus === 'canvas' ? step.allow ?? [] : [];
    const es = useApp.getState().lang === 'es';
    const block = (kind: 'drag' | 'wheel' | 'dblclick') => (e: Event): void => {
      if (allow.includes(kind)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (b.phase === 'step') nudge(es ? 'Ahora no: sigue la indicación del mensaje' : 'Not now: follow the instruction in the message');
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
  }, [step, b.phase, A.result]);

  // The descent and the array deployment of mission 0 (cinematic).
  useEffect(() => {
    if (!step || b.phase !== 'step') return;
    let raf = 0;
    if (step.id === 'm0-approach') {
      const t0 = performance.now(), dur = (reducedMotion() ? 600 : 4200) * scale;
      landerAnim.drop = DESCENT_KM;
      landerAnim.size = landerAnim.sizeTarget = 3.2;
      camProbe.aim = 'close';
      const tick = (now: number): void => {
        const p = Math.min(1, (now - t0) / dur);
        landerAnim.drop = DESCENT_KM * Math.pow(1 - p, 2.2);
        if (p < 1) raf = requestAnimationFrame(tick);
        else { landerAnim.drop = 0; landerAnim.dustAt = performance.now(); play('landing', useApp.getState().lang); }
      };
      raf = requestAnimationFrame(tick);
    } else if (step.id === 'm0-landed') {
      const t0 = performance.now(), dur = (reducedMotion() ? 300 : 2400) * scale;
      const tick = (now: number): void => {
        landerAnim.deploy = Math.min(1, (now - t0) / dur);
        if (landerAnim.deploy < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else { landerAnim.deploy = 1; landerAnim.sizeTarget = 1; }
    return () => cancelAnimationFrame(raf);
  }, [step, b.phase, scale]);

  // The loop: follow the target, check the end condition, raise the hint and the help.
  useEffect(() => {
    if (!step || b.phase !== 'step' || step.cont || step.diploma) return;
    let raf = 0, last = '';
    const tick = (): void => {
      const r = rectOf(step.focus);
      const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) { last = key; setRect(r); }
      const st = useBeginner.getState();
      const c: Ctx = { app: useApp.getState(), A, B, memo: memo.current };
      const cond = !step.until || step.until(c);
      if (step.auto !== undefined) {
        setReady(cond);
      } else {
        let done = false;
        if (step.cine) done = cond;
        else if (step.click) done = clicked.current && cond;
        else if (step.until) done = cond;
        if (done) { if (!step.cine && !step.auto) play('success', useApp.getState().lang); next(); return; }
        const idle = performance.now() - st.stepAt;
        const stuck = step.cine ? 0 : idle > HELP_MS * scale ? 2 : idle > HINT_MS * scale ? 1 : 0;
        if (stuck !== st.stuck) st.set({ stuck });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, b.phase, A, B, next, scale]);

  const doIt = (): void => {
    if (!step) return;
    const c: Ctx = { app: useApp.getState(), A, B, memo: memo.current };
    if (step.doIt) step.doIt(c);
    else if (step.click) (document.querySelector(step.click) as HTMLElement | null)?.click();
  };

  const text = step ? step.say(ctx, t) : '';
  const [typed, typedAll, finishTyping] = useTypewriter(text, b.fast ? 400 : 55, `${b.step}-${b.phase}-${lang}`);
  const panelAtTop = useMemo(() => Boolean(rect && rect.bottom > window.innerHeight - 280 && rect.top > 200), [rect]);

  if (!step) return null;

  if (b.phase === 'intro') {
    return (
      <div className="beg" data-testid="beginner" data-step="intro" data-mission={0}>
        <Intro onDone={endIntro} />
      </div>
    );
  }

  const m = step.mission;
  const info = MISSION_INFO[m];
  const isAction = step.auto === undefined && !step.cine && !step.cont && !step.diploma;
  const pad = 8;
  // The top bar (training controls, sound, exit) always stays usable.
  const topH = Math.round(document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 48);
  const onCanvas = step.focus === 'canvas';
  const spot = rect && b.phase === 'step' && !step.cont ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad } : null;
  const unlockName = info.unlocks ? subsystemLabel(info.unlocks, t) : null;
  const nextTitle = MISSION_TITLES[m + 1]?.[li];

  return (
    <div className="beg" data-testid="beginner" data-step={b.phase === 'step' ? step.id : b.phase} data-mission={m}>
      {spot ? (
        <>
          {[
            { left: 0, top: topH, width: '100%', height: Math.max(0, spot.top - topH) },
            { left: 0, top: spot.top + spot.height, width: '100%', bottom: 0 },
            { left: 0, top: spot.top, width: spot.left, height: spot.height },
            { left: spot.left + spot.width, top: spot.top, right: 0, height: spot.height },
          ].map((s, i) => (
            // Everything outside the target is locked; on the free 3-D steps the blockers are clear (no dimming).
            <div key={i} className={`beg-dim${onCanvas ? ' is-clear' : ''}`} style={s as CSSProperties}
              onPointerDown={() => { play('error', lang); nudge(lang === 'es' ? 'Usa la zona indicada' : 'Use the highlighted area'); }}
              onWheel={(e) => scrollTargetPanel(step.focus, e.deltaY)} />
          ))}
          {!onCanvas && <div className={`beg-spot${b.stuck >= 1 ? ' is-pulse' : ''}`} style={spot} aria-hidden="true" />}
        </>
      ) : b.phase !== 'step' || step.cont || step.diploma ? <div className="beg-dim beg-dim-all" style={{ top: topH }} /> : null}
      {step.alert && b.phase === 'step' && <div className={`beg-alert${reducedMotion() ? ' is-static' : ''}`} aria-hidden="true" />}

      {b.phase === 'splash' && (
        <section className="beg-splash" role="dialog" aria-modal="true" aria-labelledby="beg-splash-h" data-testid="beg-splash">
          <Patch n={m} icon={info.unlocks && info.unlocks !== 'overview' ? undefined : undefined} size={150} />
          <p className="beg-splash-kicker">{t(`Mission ${m} of ${MISSION_TITLES.length - 1}`, `Misión ${m} de ${MISSION_TITLES.length - 1}`)}</p>
          <h2 id="beg-splash-h">{MISSION_TITLES[m][li]}</h2>
          <p className="beg-splash-goal">{info.goal[li]}</p>
          {info.unlocks && (
            <p className="beg-splash-reward">
              <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">{SUB_ICON[info.unlocks]}</svg>
              {info.unlocks === 'overview' ? t(`You start with the console "${unlockName}".`, `Empiezas con la consola «${unlockName}».`) : t(`Reward: the console "${unlockName}".`, `Recompensa: la consola «${unlockName}».`)}
            </p>
          )}
          <button type="button" className="btn beg-go" onClick={() => { play('objective', lang); useBeginner.getState().set({ phase: 'step', stepAt: performance.now() }); }} data-testid="beg-start-mission" autoFocus>
            {m === 0 ? t('Start the landing', 'Iniciar el alunizaje') : t('Start the mission', 'Comenzar la misión')}
          </button>
        </section>
      )}

      {b.phase === 'celebrate' && (
        <section className="beg-celebrate" role="dialog" aria-modal="true" aria-labelledby="beg-cel-h" data-testid="beg-big">
          {!reducedMotion() && <div className="beg-confetti" aria-hidden="true">{Array.from({ length: 26 }, (_, k) => <i key={k} style={{ '--k': k } as CSSProperties} />)}</div>}
          <div className="beg-badge-big"><Badge i={m} earned fresh size={150} /></div>
          <p className="beg-badge-name" data-testid="beg-badge">{t(`Badge ${m}: ${BADGES[m].name[0]}`, `Insignia ${m}: ${BADGES[m].name[1]}`)}</p>
          <h2 id="beg-cel-h">{text}</h2>
          {info.unlocks && info.unlocks !== 'overview' && (
            <p className="beg-unlock" data-testid="beg-unlock">
              <svg viewBox="0 0 20 20" width="26" height="26" aria-hidden="true">{SUB_ICON[info.unlocks]}</svg>
              {t(`New console unlocked: ${unlockName}`, `Nueva consola desbloqueada: ${unlockName}`)}
            </p>
          )}
          {nextTitle && (
            <div className="beg-next">
              <Patch n={m + 1} size={56} locked />
              <span>{t('Next', 'Siguiente')}: <b>{nextTitle}</b><br /><small>{MISSION_INFO[m + 1].goal[li]}</small></span>
            </div>
          )}
          <div className="beg-cel-actions">
            <LearnButton topic={MISSION_TOPIC[m]} big testid="learn-cel" />
            <button type="button" className="btn beg-go" onClick={() => next(true)} data-testid="beg-continue" autoFocus>
              {t('Next mission', 'Siguiente misión')}
            </button>
          </div>
        </section>
      )}

      {b.phase === 'step' && step.diploma && (
        <div className="beg-diploma" role="dialog" aria-modal="true" aria-labelledby="beg-dip-h" data-testid="diploma">
          {!reducedMotion() && <div className="beg-confetti" aria-hidden="true">{Array.from({ length: 40 }, (_, k) => <i key={k} style={{ '--k': k } as CSSProperties} />)}</div>}
          <img src={`${import.meta.env.BASE_URL}brand/logo-gisat.png`} alt="GISAT UDEC" width="110" height="110" />
          <h2 id="beg-dip-h">{t('Training complete: graduated as Flight Director', 'Entrenamiento completado: graduado como Flight Director')}</h2>
          <div className="beg-dip-patches" aria-hidden="true">{BADGES.map((_, k) => <Badge key={k} i={k} earned size={54} />)}</div>
          <p>{text}</p>
          <div className="beg-cel-actions">
            <LearnButton topic="master" big testid="learn-dip" />
            <button type="button" className="btn beg-pro" onClick={finishTraining} data-testid="beg-to-pro" autoFocus>{t('Open Full mode (Mission Leader)', 'Abrir el Modo Completo (Mission Leader)')}</button>
          </div>
        </div>
      )}

      {b.phase === 'step' && !step.cont && !step.diploma && (
        <section className={`capcom${panelAtTop ? ' is-top' : ''}${isAction ? ' is-action' : ''}`} role="status" aria-live="polite" data-testid="beg-card">
          <header className="capcom-head">
            <svg className="capcom-role" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M4 11V9a6 6 0 0 1 12 0v2M4 11h2.5v4H4zM13.5 11H16v4h-2.5zM16 15c0 1.5-2 2.5-5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className={`capcom-wave${typedAll ? '' : ' is-live'}`} aria-hidden="true">{Array.from({ length: 7 }, (_, k) => <i key={k} style={{ '--k': k } as CSSProperties} />)}</span>
            <span className="capcom-where">{t('Mission', 'Misión')} {m} · {MISSION_TITLES[m][li]}</span>
          </header>
          <p className="capcom-text" onClick={finishTyping}>{typedAll ? <Glossed text={typed} /> : typed}<span className="sr-only">{typed === text ? '' : text}</span></p>
          {isAction && typedAll && <p className="capcom-goal" data-testid="beg-objective"><b>{t('Your move', 'Tu turno')}</b> {t('Do it in the highlighted area.', 'Hazlo en la zona iluminada.')}</p>}
          {b.stuck >= 1 && step.hint && <p className="capcom-hint" data-testid="beg-hint">{step.hint[li]}</p>}
          <div className="capcom-actions">
            {!typedAll && <button type="button" className="btn btn-small capcom-skip" onClick={finishTyping}>{t('Show all', 'Mostrar todo')}</button>}
            {b.stuck >= 2 && isAction && <button type="button" className="btn capcom-help" onClick={doIt} data-testid="beg-doit">{t('Do it for me', 'Hazlo por mí')}</button>}
            {step.auto !== undefined && (
              <button type="button" className="btn beg-go capcom-next" disabled={!ready || !typedAll} onClick={() => next()} data-testid="beg-next">
                {ready ? t('Continue', 'Continuar') : t('Working…', 'Calculando…')}
              </button>
            )}
          </div>
        </section>
      )}

      {b.phase === 'step' && step.cont && (
        // A plain "Continue" step that is not a mission end is shown as the transmission too.
        <section className="capcom" role="status" data-testid="beg-card">
          <p className="capcom-text"><Glossed text={text} /></p>
          <div className="capcom-actions"><button type="button" className="btn beg-go" onClick={() => next()} data-testid="beg-continue">{t('Continue', 'Continuar')}</button></div>
        </section>
      )}

      {b.nudge && <div className="beg-nudge" role="status" data-testid="beg-nudge">{b.nudge}</div>}
      {b.caption && (b.muted || b.subtitles) && <div className="beg-caption" aria-live="polite" data-testid="beg-caption">{b.caption}</div>}
    </div>
  );
}
