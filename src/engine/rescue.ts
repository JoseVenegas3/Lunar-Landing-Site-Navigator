/**
 * The one-click rescue search, as a pure step generator (v3.1, R6): try the
 * touchdown points of the dispersion grid and, when none saves the mission,
 * walk the calendar forward to the first date that does. It yields after
 * every mission flown, so the same code runs in a Web Worker
 * (src/state/rescue.worker.ts) or time-sliced on the main thread.
 *
 * Early pruning: a touchdown point steeper than the lander's static stability
 * angle is skipped without flying the mission (the lander would tip over at
 * rest, so it can never be the answer), and the calendar walk stops at the
 * first date that is no longer a no-go.
 */
import { DemStack, slopeDeg } from './terrain';
import { relocatedXY } from './analysis';
import { HorizonProfile, computeHorizon, makeObserver } from './horizonEngine';
import { MissionInput, evaluateMission } from './missionAnalysis';
import { Verdict, missionVerdict, verdictImproves } from './verdict';
import { HOUR_MS } from './constants';

export interface RescueOptions {
  /** Half-width of the touchdown grid and its size (points per side). */
  radiusM: number;
  size: number;
  /** How many days of later dates to try, and the step between them, hours. */
  searchDays: number;
  stepHours: number;
  /** Slope above which a touchdown point is pruned, degrees (the static stability angle). */
  pruneSlopeDeg: number;
}

export interface RescueResult {
  before: Verdict;
  after: Verdict;
  action: 'move' | 'date' | 'none';
  eastM: number;
  northM: number;
  startMs: number | null;
  missions: number;
  pruned: number;
}

/** Yields the progress (0–1) after each mission; returns the outcome. */
export function* rescueSteps(dem: DemStack, input: MissionInput, horizon: HorizonProfile, before: Verdict, o: RescueOptions): Generator<number, RescueResult, void> {
  const step = (2 * o.radiusM) / (o.size - 1);
  const cells = o.size * o.size;
  const dates = Math.floor((o.searchDays * 24) / o.stepHours);
  const total = cells + dates;
  let best = { verdict: before, eastM: 0, northM: 0 };
  let missions = 0, pruned = 0;
  const done = (r: Omit<RescueResult, 'before' | 'missions' | 'pruned'>): RescueResult => ({ ...r, before, missions, pruned });

  // Phase 1: the touchdown points within reach.
  for (let k = 0; k < cells; k++) {
    const eastM = -o.radiusM + (k % o.size) * step, northM = -o.radiusM + Math.floor(k / o.size) * step;
    if (eastM === 0 && northM === 0) continue;
    const at: MissionInput = { ...input, dxM: input.dxM + eastM, dyM: input.dyM + northM };
    const [x, y] = relocatedXY(at.latDeg, at.lonDeg, at.dxM, at.dyM);
    if (slopeDeg(dem, x, y) > o.pruneSlopeDeg) { pruned++; yield (k + 1) / total; continue; }
    const v = missionVerdict(evaluateMission(dem, at, computeHorizon(dem, makeObserver(dem, x, y, at.mastM))));
    missions++;
    if (verdictImproves(best.verdict, v)) best = { verdict: v, eastM, northM };
    yield (k + 1) / total;
  }
  if (best.verdict.level !== 'nogo' && verdictImproves(before, best.verdict)) {
    return done({ after: best.verdict, action: 'move', eastM: best.eastM, northM: best.northM, startMs: null });
  }
  // Phase 2: the same point on later dates; stop at the first one that is not a no-go.
  for (let d = 0; d < dates; d++) {
    const startMs = input.startMs + (d + 1) * o.stepHours * HOUR_MS;
    const v = missionVerdict(evaluateMission(dem, { ...input, startMs }, horizon));
    missions++;
    if (v.level !== 'nogo' && verdictImproves(before, v)) return done({ after: v, action: 'date', eastM: 0, northM: 0, startMs });
    yield (cells + d + 1) / total;
  }
  // Nothing saves it: keep the best partial improvement, if any.
  if (verdictImproves(before, best.verdict)) return done({ after: best.verdict, action: 'move', eastM: best.eastM, northM: best.northM, startMs: null });
  return done({ after: before, action: 'none', eastM: 0, northM: 0, startMs: null });
}

/** Run the whole search at once (tests, scripts, the worker). */
export function runRescue(dem: DemStack, input: MissionInput, horizon: HorizonProfile, before: Verdict, o: RescueOptions, onProgress?: (p: number) => void): RescueResult {
  const it = rescueSteps(dem, input, horizon, before, o);
  for (;;) {
    const s = it.next();
    if (s.done) return s.value;
    onProgress?.(s.value);
  }
}
