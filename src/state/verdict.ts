/**
 * Verdict of a scenario and the one-click rescue: try the 25 touchdown points
 * of the dispersion grid, and when none of them saves the mission, walk the
 * calendar forward to the first date that does. Runs time-sliced so the 3-D
 * view never stalls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  HOUR_MS, MicroHazard, MissionInput, Verdict, computeHorizon, evaluateMission, makeObserver, microHazard, missionVerdict, relocatedXY,
  sunlitDirections, tipoverMap, verdictImproves,
} from '../engine';
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
  /** Missions flown and wall time, for the record. */
  missions: number;
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

export function useRescue(data: ScenarioData): RescueView {
  const [progress, setProgress] = useState<number | null>(null);
  const stored = useRescueStore((s) => s.last[data.key]) ?? null;
  // Subscribing to the scenario keeps the before/after only while it still describes what is on screen.
  const cfg = useApp((s) => s.scenarios[data.key]);
  const last = stored && cfg && stored.signature === scenarioSignature(data.key) ? stored : null;
  const setLast = useRescueStore((s) => s.set);
  const token = useRef(0);
  const { dem, input, result, key } = data;
  const searchDays = useApp((s) => s.rescueDays);

  useEffect(() => () => { token.current++; }, []);

  const run = useCallback(() => {
    if (!dem || !input || !result) return;
    const my = ++token.current;
    const t0 = performance.now();
    const before = missionVerdict(result);
    const step = (2 * DISPERSION_RADIUS_M) / (DISPERSION_SIZE - 1);
    const cells = DISPERSION_SIZE * DISPERSION_SIZE;
    const dates = Math.floor((searchDays * 24) / RESCUE_STEP_HOURS);
    let best = { verdict: before, eastM: 0, northM: 0 };
    let k = 0, missions = 0;
    setProgress(0);

    const finish = (o: Omit<RescueOutcome, 'before' | 'missions' | 'elapsedMs' | 'signature'>): void => {
      const s = useApp.getState();
      if (o.action === 'move') s.setRelocation(key, input.dxM + o.eastM, input.dyM + o.northM);
      if (o.action === 'date' && o.startMs !== null) { s.setPlaying(false); s.updateScenario(key, { startMs: o.startMs }); s.setCursor(0); }
      setLast(key, { ...o, before, missions, elapsedMs: performance.now() - t0, signature: scenarioSignature(key) });
      setProgress(null);
    };

    const tick = (): void => {
      if (token.current !== my) return;
      const start = performance.now();
      while (performance.now() - start < 24) {
        if (k < cells) {
          // Phase 1: the 25 touchdown points within reach.
          const eastM = -DISPERSION_RADIUS_M + (k % DISPERSION_SIZE) * step, northM = -DISPERSION_RADIUS_M + Math.floor(k / DISPERSION_SIZE) * step;
          k++;
          if (eastM === 0 && northM === 0) continue;
          const at: MissionInput = { ...input, dxM: input.dxM + eastM, dyM: input.dyM + northM };
          const [x, y] = relocatedXY(at.latDeg, at.lonDeg, at.dxM, at.dyM);
          const v = missionVerdict(evaluateMission(dem, at, computeHorizon(dem, makeObserver(dem, x, y, at.mastM))));
          missions++;
          if (verdictImproves(best.verdict, v)) best = { verdict: v, eastM, northM };
          continue;
        }
        if (best.verdict.level !== 'nogo' && verdictImproves(before, best.verdict)) {
          finish({ after: best.verdict, action: 'move', eastM: best.eastM, northM: best.northM, startMs: null });
          return;
        }
        if (k - cells >= dates) {
          // Nothing saves it: keep the best partial improvement, if any.
          if (verdictImproves(before, best.verdict)) finish({ after: best.verdict, action: 'move', eastM: best.eastM, northM: best.northM, startMs: null });
          else finish({ after: before, action: 'none', eastM: 0, northM: 0, startMs: null });
          return;
        }
        // Phase 2: the same point on later dates.
        const startMs = input.startMs + (k - cells + 1) * RESCUE_STEP_HOURS * HOUR_MS;
        k++;
        const v = missionVerdict(evaluateMission(dem, { ...input, startMs }, result.horizon));
        missions++;
        if (v.level !== 'nogo' && verdictImproves(before, v)) {
          finish({ after: v, action: 'date', eastM: 0, northM: 0, startMs });
          return;
        }
      }
      setProgress(Math.min(0.99, k / (cells + dates)));
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }, [dem, input, result, key, setLast, searchDays]);

  const clear = useCallback(() => setLast(key, undefined), [key, setLast]);
  return { run, progress, last, clear };
}
