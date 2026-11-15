/**
 * Verdict of a scenario and the one-click rescue: try the 25 touchdown points
 * of the dispersion grid, and when none of them saves the mission, walk the
 * calendar forward to the first date that does. Runs in a Web Worker (v3.1,
 * R6), or time-sliced on the main thread where workers are unavailable, so the
 * 3-D view never stalls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  MicroHazard, RescueOptions, RescueResult, Verdict, microHazard, missionVerdict, rescueSteps, staticStabilityDeg, sunlitDirections, tipoverMap,
} from '../engine';
import type { RescueReply, RescueRequest } from './rescueProtocol';
import { DISPERSION_RADIUS_M, DISPERSION_SIZE } from './insights';
import { ScenarioData } from './mission';
import { ScenarioKey, useApp } from './store';

export interface RescueOutcome {
  before: Verdict;
  after: Verdict;
  /** What the rescue changed. */
  action: 'move' | 'date' | 'none';
  eastM: number;
  northM: number;
  /** New touchdown date when the action is 'date', ms. */
  startMs: number | null;
  /** Scenario state the outcome describes; a later edit of the scenario makes it stale. */
  signature: string;
  /** Missions flown, touchdown points pruned (too steep to rest on), where it ran and wall time, for the record. */
  missions: number;
  pruned: number;
  engine: 'worker' | 'main';
  elapsedMs: number;
}

interface RescueStore {
  last: Partial<Record<ScenarioKey, RescueOutcome>>;
  set: (k: ScenarioKey, o: RescueOutcome | undefined) => void;
}
export const useRescueStore = create<RescueStore>((set) => ({
  last: {},
  set: (k, o) => set((s) => ({ last: { ...s.last, [k]: o } })),
}));

/** Verdict of the scenario on screen, with the tip-over probability of the aim point. */
export function useVerdict(data: ScenarioData): Verdict | null {
  const tipover = useApp((s) => s.tipover);
  const { result, dem, latDeg, lonDeg, input } = data;
  return useMemo(() => {
    if (!result || !dem || !input) return null;
    const tip = tipoverMap(dem, { latDeg, lonDeg, dxM: input.dxM, dyM: input.dyM }, tipover, 200, 1 + 2).centre.p;
    return missionVerdict(result, tip);
  }, [result, dem, latDeg, lonDeg, input, tipover]);
}

/**
 * Sub-pixel hazard of the ground at the lander, always computed in the
 * emergency flow (v2.1 change 3). Measured cost: 35–67 ms median, 93 ms worst
 * over the five candidate sites (scripts/measure_micro_hazard.ts), under the
 * 300 ms limit set for keeping it behind a switch. It is deterministic, so a
 * switch would only hide hazards in a critical situation. It runs just after
 * the render so the inputs stay responsive; `ms` is the time it took here.
 */
export function useMicroHazard(data: ScenarioData): { hazard: MicroHazard; ms: number } | null {
  const { result, dem } = data;
  const [out, setOut] = useState<{ hazard: MicroHazard; ms: number } | null>(null);
  useEffect(() => {
    setOut(null);
    if (!result || !dem) return;
    const id = setTimeout(() => {
      const t0 = performance.now();
      const obs = result.observer;
      const hazard = microHazard(dem, obs.x, obs.y, obs.lonDeg, sunlitDirections(result, 6));
      setOut({ hazard, ms: performance.now() - t0 });
    }, 0);
    return () => clearTimeout(id);
  }, [result, dem]);
  return out;
}

/** Step between the later dates the rescue tries, hours (the candidate step of the landing-window search). */
const RESCUE_STEP_HOURS = 12;

/** Place and date of a scenario, as one string. */
export function scenarioSignature(key: ScenarioKey): string {
  const c = useApp.getState().scenarios[key];
  return [c.siteId, c.customLat, c.customLon, c.dxM, c.dyM, c.startMs, c.days].join('|');
}

export interface RescueView {
  run: () => void;
  progress: number | null;
  last: RescueOutcome | null;
  clear: () => void;
}

/** One worker for the session, created on first use; null where workers are unavailable (then the search is time-sliced). */
let worker: Worker | null | undefined;
function rescueWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./rescue.worker.ts', import.meta.url), { type: 'module' });
  } catch { worker = null; }
  return worker;
}

export function useRescue(data: ScenarioData): RescueView {
  const [progress, setProgress] = useState<number | null>(null);
  const stored = useRescueStore((s) => s.last[data.key]) ?? null;
  // Subscribing to the scenario keeps the before/after only while it still describes what is on screen.
  const cfg = useApp((s) => s.scenarios[data.key]);
  const last = stored && cfg && stored.signature === scenarioSignature(data.key) ? stored : null;
  const setLast = useRescueStore((s) => s.set);
  const token = useRef(0);
  /** A search already running is not restarted by a second click. */
  const running = useRef(false);
  const { dem, input, result, key } = data;
  const searchDays = useApp((s) => s.rescueDays);
  const tipover = useApp((s) => s.tipover);

  useEffect(() => () => { token.current++; running.current = false; }, []);

  const run = useCallback(() => {
    if (!dem || !input || !result || running.current) return;
    running.current = true;
    const my = ++token.current;
    const t0 = performance.now();
    const before = missionVerdict(result);
    const options: RescueOptions = { radiusM: DISPERSION_RADIUS_M, size: DISPERSION_SIZE, searchDays, stepHours: RESCUE_STEP_HOURS, pruneSlopeDeg: staticStabilityDeg(tipover) };
    setProgress(0);

    const finish = (o: RescueResult, engine: 'worker' | 'main'): void => {
      running.current = false;
      if (token.current !== my) return;
      const s = useApp.getState();
      if (o.action === 'move') s.setRelocation(key, input.dxM + o.eastM, input.dyM + o.northM);
      if (o.action === 'date' && o.startMs !== null) { s.setPlaying(false); s.updateScenario(key, { startMs: o.startMs }); s.setCursor(0); }
      setLast(key, { before: o.before, after: o.after, action: o.action, eastM: o.eastM, northM: o.northM, startMs: o.startMs, missions: o.missions, pruned: o.pruned, engine, elapsedMs: performance.now() - t0, signature: scenarioSignature(key) });
      if (typeof document !== 'undefined') document.documentElement.dataset.rescueEngine = engine;
      setProgress(null);
    };

    // Main-thread fallback: the same generator, time-sliced so the 3-D view never stalls.
    const mainThread = (): void => {
      const it = rescueSteps(dem, input, result.horizon, before, options);
      const tick = (): void => {
        if (token.current !== my) { running.current = false; return; }
        const start = performance.now();
        while (performance.now() - start < 24) {
          const s = it.next();
          if (s.done) { finish(s.value, 'main'); return; }
          setProgress(Math.min(0.99, s.value));
        }
        setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
    };

    const w = rescueWorker();
    if (!w) { mainThread(); return; }
    const onMessage = (e: MessageEvent<RescueReply>): void => {
      const m = e.data;
      if (m.id !== my) return;
      if (m.kind === 'progress') { if (token.current === my) setProgress(Math.min(0.99, m.progress)); return; }
      w.removeEventListener('message', onMessage);
      if (m.kind === 'done') finish(m.result, 'worker');
      else mainThread();
    };
    w.addEventListener('message', onMessage);
    try {
      const req: RescueRequest = { id: my, dem, input, horizon: result.horizon, before, options };
      w.postMessage(req);
    } catch {
      w.removeEventListener('message', onMessage);
      mainThread();
    }
  }, [dem, input, result, key, setLast, searchDays, tipover]);

  const clear = useCallback(() => setLast(key, undefined), [key, setLast]);
  return { run, progress, last, clear };
}
