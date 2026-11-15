/**
 * State of the Beginner training (v3.0) that is not part of the mission:
 * the current step, hints, sound settings and the parts of the interface the
 * training has revealed so far. Sound settings persist; progress does not
 * (the gate asks again on every load).
 */
import { create } from 'zustand';
import { ScenarioCfg, Subsystem } from '../state/store';

/** Parts of the interface the training reveals one by one. */
export type Reveal = 'transport' | 'subsys' | 'trays' | 'verdict' | 'telemetry' | 'mode';

const SOUND_KEY = 'clps.beginner.sound';
interface SoundPrefs { muted: boolean; volume: number; subtitles: boolean; music: boolean }
const readPrefs = (): SoundPrefs => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SOUND_KEY) : null;
    if (raw) return { muted: false, volume: 0.7, subtitles: false, music: true, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { muted: false, volume: 0.7, subtitles: false, music: true };
};

export interface BeginnerState extends SoundPrefs {
  /** Index of the step on screen, -1 before the training starts. */
  step: number;
  /** When the current step started (performance.now), for the hint (15 s) and "do it for me" (45 s). */
  stepAt: number;
  /** 0 = nothing, 1 = pulse on the target, 2 = "do it for me" offered. */
  stuck: 0 | 1 | 2;
  reveal: Reveal[];
  /** Subsystem just unlocked: shown with a flash and a "New!" tag. */
  fresh: Subsystem | null;
  /** Message of the last refused action (locked tab, click outside the target). */
  nudge: string | null;
  /** Subtitle of the last sound effect. */
  caption: string | null;
  /** Timers ×10 faster, for the end-to-end test only (?tutorialSpeed=fast). */
  fast: boolean;
  /** Missions completed (0..8), for the progress seals. */
  done: number;
  /** Site validated in mission 6, kept when the training ends. */
  validated: ScenarioCfg | null;
  /**
   * What is on screen: the opening cinematic, the splash of a mission, a step,
   * or the celebration of a finished mission.
   */
  phase: 'intro' | 'splash' | 'step' | 'celebrate';
  /** Points earned (stars and XP of the celebration cards). */
  xp: number;
  set: (p: Partial<BeginnerState>) => void;
  setSound: (p: Partial<SoundPrefs>) => void;
}

export const useBeginner = create<BeginnerState>((set, get) => ({
  ...readPrefs(),
  step: -1, stepAt: 0, stuck: 0, reveal: [], fresh: null, nudge: null, caption: null, done: 0, validated: null, phase: 'intro', xp: 0,
  fast: typeof location !== 'undefined' && new URLSearchParams(location.search).get('tutorialSpeed') === 'fast',
  set: (p) => set(p),
  setSound: (p) => {
    set(p);
    const { muted, volume, subtitles, music } = { ...get(), ...p };
    try { localStorage.setItem(SOUND_KEY, JSON.stringify({ muted, volume, subtitles, music })); } catch { /* storage unavailable */ }
  },
}));

/** Show a one-line nudge for a few seconds. */
let nudgeTimer = 0;
export function nudge(text: string): void {
  useBeginner.getState().set({ nudge: text });
  if (typeof window !== 'undefined') {
    window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(() => useBeginner.getState().set({ nudge: null }), 3200);
  }
}
