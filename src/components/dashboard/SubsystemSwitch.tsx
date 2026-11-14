/**
 * Subsystem tabs across the whole width of the app, and the transition between
 * consoles: the interface fades to black, the icon of the destination appears
 * in its accent colour, and the new console fades in with its overlay already
 * applied (about 850 ms). Clicks during a transition retarget it when the
 * console has not been swapped yet, and are queued otherwise, so the state is
 * always the one of the last tab clicked. With prefers-reduced-motion it is a
 * short fade with no icon.
 */
import { CSSProperties, ReactNode, useEffect } from 'react';
import { create } from 'zustand';
import { SUBSYSTEMS, SUBSYSTEM_ORDER, Subsystem, useApp } from '../../state/store';
import { useT } from '../../lib/format';

type T = (en: string, es: string) => string;
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const SUB_ICON: Record<Subsystem, ReactNode> = {
  overview: <path d="M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM10 6v4l2.8 1.8" {...stroke} />,
  power: <path d="M3 7h9v6H3zM5.2 7v6M7.5 7v6M9.8 7v6M12 10h2.5M16 6.5v7M14.5 10H17.5" {...stroke} />,
  comms: <path d="M4 16 10 10M8 5.5a6.5 6.5 0 0 1 6.5 6.5M8 2.5a9.5 9.5 0 0 1 9.5 9.5M4 16h3.5M4 16v-3.5" {...stroke} />,
  terrain: <path d="M2 15.5 7 8l3 4 2.5-3.5L18 15.5ZM2 17.5h16" {...stroke} />,
  science: <path d="M8 2.5v5.2L3.5 15.4A1.4 1.4 0 0 0 4.7 17.5h10.6a1.4 1.4 0 0 0 1.2-2.1L12 7.7V2.5M7 2.5h6M6 12.5h8" {...stroke} />,
};

export function subsystemLabel(s: Subsystem, t: T): string {
  return {
    overview: t('Overview', 'Resumen'),
    power: t('Power / thermal', 'Energía / térmico'),
    comms: t('Comms / RF', 'Comunicaciones / RF'),
    terrain: t('Terrain / landing', 'Terreno / alunizaje'),
    science: t('Science', 'Ciencia'),
  }[s];
}

/** Phase of the console transition. */
export type SwitchPhase = 'idle' | 'out' | 'hold' | 'in';

const reducedMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Durations of the three phases, ms. */
export const SWITCH_MS = { out: 220, hold: 380, in: 250 } as const;
const SWITCH_MS_REDUCED = { out: 90, hold: 0, in: 120 } as const;

interface SwitchState { phase: SwitchPhase; target: Subsystem | null; reduced: boolean }
/** Transition state, kept apart from the app store so a transition only re-renders the tabs and the curtain. */
export const useSwitch = create<SwitchState>(() => ({ phase: 'idle', target: null, reduced: false }));

let want: Subsystem | null = null;
let queued: Subsystem | null = null;
let timers: number[] = [];

function run(s: Subsystem): void {
  const reduced = reducedMotion();
  const ms = reduced ? SWITCH_MS_REDUCED : SWITCH_MS;
  want = s;
  useSwitch.setState({ phase: 'out', target: s, reduced });
  const later = (fn: () => void, at: number): void => { timers.push(window.setTimeout(fn, at)); };
  later(() => {
    // Swap the console under the black screen, to the last tab clicked.
    useApp.getState().setSubsystem(want ?? s);
    useSwitch.setState({ phase: 'hold' });
  }, ms.out);
  later(() => useSwitch.setState({ phase: 'in' }), ms.out + ms.hold);
  later(() => {
    timers = [];
    useSwitch.setState({ phase: 'idle', target: null });
    const next = queued;
    queued = null;
    if (next && next !== useApp.getState().subsystem) run(next);
  }, ms.out + ms.hold + ms.in);
}

/** Ask for a console; animated, and safe to call while a transition is running. */
export function requestSubsystem(s: Subsystem): void {
  const { phase } = useSwitch.getState();
  if (phase === 'idle') {
    if (s !== useApp.getState().subsystem) run(s);
  } else if (phase === 'out') {
    want = s;
    useSwitch.setState({ target: s });
  } else {
    queued = s;
  }
}

/** Abort a running transition (the console is left where the store says). */
export function cancelSubsystemSwitch(): void {
  timers.forEach((id) => clearTimeout(id));
  timers = [];
  want = null;
  queued = null;
  useSwitch.setState({ phase: 'idle', target: null });
}

export function SubsystemTabs() {
  const t = useT();
  const subsystem = useApp((s) => s.subsystem);
  const pending = useSwitch((s) => s.target);
  const shown = pending ?? subsystem;
  return (
    <nav className="subsys-bar" aria-label={t('Mission subsystem', 'Subsistema de misión')} data-testid="subsys-bar">
      <div className="subsys-list" role="tablist">
        {SUBSYSTEM_ORDER.map((s) => (
          <button
            key={s} type="button" role="tab" aria-selected={shown === s} className={`subsys-btn${shown === s ? ' is-on' : ''}`}
            style={{ '--sub': SUBSYSTEMS[s].accent } as CSSProperties} onClick={() => requestSubsystem(s)} data-testid={`subsys-${s}`}
          >
            <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true">{SUB_ICON[s]}</svg>
            <span>{subsystemLabel(s, t)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

/** Black screen with the icon of the destination console, over the console area. */
export function SubsystemCurtain() {
  const t = useT();
  const { phase, target, reduced } = useSwitch();
  useEffect(() => cancelSubsystemSwitch, []);
  if (phase === 'idle' || !target) return null;
  const accent = SUBSYSTEMS[target].accent;
  return (
    <div
      className={`subsys-curtain is-${phase}${reduced ? ' is-reduced' : ''}`} aria-hidden="true" data-testid="subsys-curtain" data-phase={phase}
      style={{ '--sub': accent, '--out-ms': `${reduced ? SWITCH_MS_REDUCED.out : SWITCH_MS.out}ms`, '--in-ms': `${reduced ? SWITCH_MS_REDUCED.in : SWITCH_MS.in}ms` } as CSSProperties}
    >
      {!reduced && (
        <div className="subsys-emblem">
          <svg viewBox="0 0 20 20" width="88" height="88">{SUB_ICON[target]}</svg>
          <strong>{subsystemLabel(target, t)}</strong>
        </div>
      )}
    </div>
  );
}
