/**
 * Director of the video pitch: what each scene does to the REAL app (store,
 * 3-D camera, lander animation, panels, buttons). `enter` puts the app in the
 * scene's starting state; `cues` are timed actions inside the scene. Seeking
 * runs `enter` and then every cue up to the new time, so a jump with ← / →
 * always lands in a consistent state. Values shown on screen are read back
 * from the engine; nothing here computes physics.
 */
import {
  ALL_SITES, ATTITUDE_PRESETS, DEFAULT_ASSET, DEFAULT_POWER, DEFAULT_RELAY, DEFAULT_RF, NOMINAL_ATTITUDE,
} from '../engine';
import { ensureLocal } from '../state/dem';
import { useApp, Subsystem } from '../state/store';
import { cancelSubsystemSwitch } from '../components/dashboard/SubsystemSwitch';
import { camProbe, fxCue, landerAnim } from '../components/3d/sceneMath';
import { useLearn } from '../components/LearnMore';
import { TUTORIAL_SCENARIOS as SC } from '../beginner/scenarios';
import { SceneId } from './timeline';
import { sfx } from './pitchAudio';

const s0 = () => useApp.getState();
/** Units the user had when the pitch opened; the gate scene shows both and returns to them. */
let startUnits: 'si' | 'imperial' = 'si';
export const setPitchStartUnits = (u: 'si' | 'imperial'): void => { startUnits = u; };
const DESCENT_KM = 0.6;
const START_2027_09 = Date.UTC(2027, 8, 1);

/** Everything back to a plain Mission Leader on one site and window. */
function reset(siteId: string, startMs: number, days: number, extra: { dxM?: number; dyM?: number } = {}): void {
  const s = s0();
  cancelSubsystemSwitch();
  useLearn.getState().close();
  fxCue.sun = false; fxCue.radio = false;
  s.setPlaying(false);
  if (s.compare) s.setCompare(false);
  s.setNowOverride(null);
  s.setMode('planner');
  s.setPower({ ...DEFAULT_POWER });
  s.setRf({ ...DEFAULT_RF });
  s.setRelay({ ...DEFAULT_RELAY });
  s.setAttitude({ ...NOMINAL_ATTITUDE });
  s.setAsset({ ...DEFAULT_ASSET });
  s.setMast(2);
  s.setOverlay('none');
  s.setView('orbit');
  const cfg = s.scenarios.A;
  if (cfg.siteId !== siteId || cfg.startMs !== startMs || cfg.days !== days) s.updateScenario('A', { siteId, startMs, days });
  s.setRelocation('A', extra.dxM ?? 0, extra.dyM ?? 0);
  s.setCursor(0);
  landerAnim.drop = 0; landerAnim.deploy = 1; landerAnim.size = landerAnim.sizeTarget = 1;
}

/** Only the 3-D view: every tray minimised. */
const cinema = (): void => { s0().setPanels({ leftTab: null, rightTab: null, bottomTab: null }); landerAnim.sizeTarget = 2.4; };
/** Switch the console at once (the animated curtain could be cut by a seek and leave the previous console). */
const sub = (x: Subsystem): void => { cancelSubsystemSwitch(); s0().setSubsystem(x); };
const click = (sel: string): void => { (document.querySelector(sel) as HTMLElement | null)?.click(); };

/** Animate a number over real time (cancelled when the scene changes). */
let anims: number[] = [];
export function stopAnims(): void { anims.forEach((id) => cancelAnimationFrame(id)); anims = []; }
function tween(ms: number, step: (p: number) => void, instant: boolean): void {
  if (instant) { step(1); return; }
  const t0 = performance.now();
  const tick = (now: number): void => {
    const p = Math.min(1, (now - t0) / ms);
    step(p);
    if (p < 1) anims.push(requestAnimationFrame(tick));
  };
  anims.push(requestAnimationFrame(tick));
}

const descend = (instant: boolean): void => {
  landerAnim.size = landerAnim.sizeTarget = 2.4;
  tween(2600, (p) => {
    landerAnim.drop = DESCENT_KM * Math.pow(1 - p, 2.2);
    if (p >= 1) { landerAnim.drop = 0; landerAnim.dustAt = performance.now(); landerAnim.sizeTarget = 2.4; }
  }, instant);
};

const im1 = ATTITUDE_PRESETS.find((p) => p.id === 'im1');
const im2 = ATTITUDE_PRESETS.find((p) => p.id === 'im2');

/** Starting state and timed cues of each scene. `instant` is true when seeking (no animation). */
export interface Direction {
  enter: (instant: boolean) => void;
  cues?: { at: number; run: (instant: boolean) => void }[];
}

export const DIRECTION: Record<SceneId, Direction> = {
  im1: {
    // the tilt case of the training (mission 5): with a 30° roll the downlink collapses at this site and date
    enter: (i) => { reset(SC.m5.siteId, SC.m5.startMs, SC.m5.days); cinema(); camProbe.aim = 'close'; descend(i); },
    cues: [
      { at: 2.6, run: (i) => { if (!i) sfx('landing'); } },
      { at: 3.2, run: (i) => { if (im1) s0().setAttitude({ rollDeg: im1.rollDeg, pitchDeg: im1.pitchDeg, yawDeg: im1.yawDeg, gimbalRangeDeg: 0 }); if (!i) sfx('alarm'); } },
    ],
  },
  im2: {
    enter: () => {
      reset('im2-athena', SC.m1.startMs, SC.m1.days); cinema(); s0().setPanels({ bottomTab: 'thermal' }); camProbe.aim = 'close';
      if (im2) s0().setAttitude({ rollDeg: im2.rollDeg, pitchDeg: im2.pitchDeg, yawDeg: im2.yawDeg });
    },
    cues: [
      { at: 1, run: (i) => {
        const r = () => useApp.getState();
        tween(6000, (p) => r().setCursor(p * Math.min(r().scenarios.A.days * 24 - 1, 120)), i);
      } },
    ],
  },
  stat: {
    enter: () => { cinema(); camProbe.aim = 'far'; },
  },
  brand: {
    enter: () => { reset('shackleton-ridge', SC.m0.startMs, SC.m0.days); cinema(); camProbe.aim = 'far'; },
  },
  gate: {
    enter: () => { cinema(); },
    cues: [
      { at: 3, run: () => click(startUnits === 'si' ? '[data-testid="gate-units-imperial"]' : '[data-testid="gate-units-si"]') },
      { at: 5.5, run: () => s0().setUnitSystem(startUnits) },
      { at: 7, run: () => click('[data-testid="gate-no"]') },
    ],
  },
  m0: {
    enter: (i) => { reset(SC.m0.siteId, SC.m0.startMs, SC.m0.days); cinema(); camProbe.aim = 'close'; landerAnim.deploy = 0; descend(i); },
    cues: [
      { at: 2.8, run: (i) => { tween(2200, (p) => { landerAnim.deploy = p; }, i); if (!i) sfx('deploy'); } },
      { at: 5.5, run: () => { camProbe.aim = 'sun'; fxCue.sun = true; } },
      { at: 8.5, run: (i) => { camProbe.aim = 'earth'; fxCue.sun = false; fxCue.radio = true; if (!i) sfx('radio'); } },
    ],
  },
  badges: {
    enter: () => { reset(SC.m3.siteId, SC.m3.startMs, SC.m3.days); sub('overview'); s0().openPanel('windows'); },
    cues: [
      { at: 4, run: () => sub('power') },
      { at: 6.5, run: (i) => { s0().setMast(10); fxCue.sun = true; if (!i) sfx('servo'); } },
    ],
  },
  learn: {
    enter: () => { useLearn.getState().open('move200'); },
    cues: [{ at: 6, run: (i) => { useLearn.getState().close(); if (!i) sfx('fanfare'); } }],
  },
  ocean1: {
    enter: () => { reset(SC.m2.siteId, START_2027_09, 14, { dxM: SC.m2.dxM, dyM: SC.m2.dyM }); sub('terrain'); s0().setOverlay('slope'); },
    cues: [
      { at: 1.5, run: () => click('[data-testid="unc-run"]') },
      { at: 8.6, run: () => { s0().setRelocation('A', SC.m2.safeDxM, SC.m2.safeDyM); } },
    ],
  },
  ocean2: {
    enter: () => {
      reset(SC.m3.siteId, SC.m3.startMs, SC.m3.days);
      s0().setPower({ ...DEFAULT_POWER, mount: 'horizontal' });
      sub('power');
    },
    cues: [
      { at: 1.2, run: () => s0().setPanels({ bottomTab: 'thermal' }) },
      { at: 4.5, run: (i) => { s0().setMast(10); if (!i) sfx('servo'); } },
      { at: 6.5, run: (i) => { s0().setPower({ mount: 'tracker1axis' }); fxCue.sun = true; if (!i) sfx('success'); } },
    ],
  },
  ocean3: {
    enter: () => { reset(SC.m4.siteId, SC.m4.startMs, SC.m4.days); sub('comms'); },
    cues: [
      { at: 1.2, run: () => s0().setPanels({ bottomTab: 'horizon' }) },
      { at: 4, run: () => s0().setRf({ groundStationId: 'gisat37' }) },
      { at: 7, run: (i) => { s0().setRelay({ ...DEFAULT_RELAY, enabled: true }); fxCue.radio = true; if (!i) sfx('radio'); } },
    ],
  },
  ocean4: {
    enter: () => { reset(SC.m5.siteId, SC.m5.startMs, SC.m5.days); sub('terrain'); },
    cues: [
      { at: 1, run: (i) => { if (im1) s0().setAttitude({ rollDeg: im1.rollDeg, pitchDeg: im1.pitchDeg, yawDeg: im1.yawDeg, gimbalRangeDeg: 0 }); if (!i) sfx('alarm'); } },
      { at: 3.8, run: (i) => { s0().setAttitude({ gimbalRangeDeg: 35 }); fxCue.radio = true; if (!i) sfx('servo'); } },
      { at: 6, run: (i) => {
        s0().setAsset({ ...DEFAULT_ASSET, enabled: true, distanceM: 150 });
        tween(4000, (p) => s0().setAsset({ distanceM: Math.round((150 + p * 2450) / 10) * 10 }), i);
      } },
    ],
  },
  ocean5: {
    // The case the e2e uses: Malapert, two weeks from 2027-09-01, runs into a long shadow; "Optimise" saves it.
    enter: () => { reset('malapert-massif', START_2027_09, 14); sub('science'); },
    cues: [{ at: 3, run: () => click('[data-testid="verdict-fix"]') }],
  },
  alert: {
    enter: (i) => {
      reset(SC.m7.siteId, SC.m7.nowMs, SC.m7.days);
      s0().setPower({ ...DEFAULT_POWER, initialSoc: SC.m7.energyWh / DEFAULT_POWER.batteryCapacityWh });
      s0().setNowOverride(SC.m7.nowMs);
      s0().setMode('triage');
      if (!i) sfx('siren');
    },
  },
  rescue: {
    enter: () => { if (s0().mode !== 'triage') DIRECTION.alert.enter(true); },
    cues: [{ at: 2.5, run: (i) => { click('[data-testid="exit-move"]'); if (!i) sfx('thrusters'); } }],
  },
  trust: {
    enter: () => { reset('shackleton-ridge', START_2027_09, 14); sub('science'); },
    cues: [{ at: 1.3, run: () => s0().openPanel('engineering') }],
  },
  finale: {
    enter: () => { reset(SC.m0.siteId, SC.m0.startMs, SC.m0.days); cinema(); camProbe.aim = 'far'; fxCue.radio = true; },
  },
};

/** Load every terrain the pitch uses before it starts, so no scene waits on the disk. */
export async function preloadPitch(): Promise<void> {
  const ids = new Set(['malapert-massif', 'shackleton-ridge', 'nobile-rim', SC.m1.siteId, SC.m5.siteId]);
  const sites = ALL_SITES.filter((s) => ids.has(s.id));
  await Promise.all(sites.map((s) => ensureLocal(s.latDeg, s.lonDeg).catch(() => undefined)));
}
