/**
 * "Can it survive, and how does it get out?" for a lander already on the
 * ground (emergency flow, v2.1 change 7).
 *
 * Loss criterion: the engine's own, unchanged, with no new threshold. The
 * lander is lost when the battery runs empty with no array power
 * (`simulateBattery`: `kpis.survives === false`) or, with the coupled thermal
 * model on, when the bus falls to -20 degC and the battery freezes
 * (`adv.kpis.thermalDeathH`). `adv.kpis.survivalHours` is the time of loss.
 * "Sunlight" uses the test of the emergency countdown (`sunFrac >= 0.5`).
 *
 * Three states over the horizon:
 *   survives     the declared situation survives the whole horizon;
 *   survives-if  it does not, but one concrete action computed here saves it
 *                (lower the minimum load to at most N W, or move to a point
 *                within 500 m);
 *   lost         nothing above saves it: say when it is lost and what would
 *                be missing (energy, or hours until the next sunlight).
 *
 * Every option is a full mission flown again with the engine. The search is
 * time-sliced so the 3-D view never stalls.
 */
import { useEffect, useState } from 'react';
import {
  MissionInput, MissionResult, RELOCATION_LIMIT_M, clamp, computeHorizon, evaluateMission, makeObserver, relocatedXY,
} from '../engine';
import { ScenarioData } from './mission';

export type SurvivalState = 'survives' | 'survives-if' | 'lost';

/** Outcome of one re-flown mission, reduced to what the exit block needs. */
export interface Outcome {
  survives: boolean;
  /** Hours from the start of the horizon to the loss, or null when it survives. */
  lossH: number | null;
  cause: 'thermal' | 'battery' | null;
}

export interface MoveOption extends Outcome {
  eastM: number;
  northM: number;
  distanceM: number;
  /** Bearing from the current position, degrees clockwise from north. */
  azimuthDeg: number;
  /** Hours of life gained over staying (the horizon length when it then survives). */
  gainH: number;
}

export interface ExitPlan {
  state: SurvivalState;
  horizonH: number;
  startMs: number;
  base: Outcome & { minSocPct: number };
  /** (a) stay and lower the minimum (survival) load. */
  load: { currentW: number; maxW: number | null; atZero: Outcome } | null;
  /** (b) best point within 500 m, or null when none is better than staying. */
  move: MoveOption | null;
  /** (c) wait for the next sunlight: when it comes back and whether the lander is still alive then. */
  wait: { sunH: number | null; alive: boolean; shortH: number | null } | null;
  /** What is missing when nothing saves it: the battery energy that would, or null when even the search ceiling does not. */
  need: { energyWh: number | null; extraWh: number | null; ceilingWh: number } | null;
  /** True once every option has been computed. */
  done: boolean;
  progress: number;
}

/** Radius of the relocation search, m: the reach of the relocation box of the tool. */
export const EXIT_MOVE_RADIUS_M = RELOCATION_LIMIT_M;
/** 5 x 5 grid of points over that radius (step 250 m), plus the current point. */
const MOVE_SIZE = 5;
/** Bisection steps of the load and energy searches (resolution: range / 2^7). */
const BISECT_STEPS = 7;
/** Largest stored energy the "what is missing" search tries, as a multiple of the battery capacity. */
const NEED_CEILING_X = 10;

export function outcomeOf(r: MissionResult): Outcome {
  // Same reading as missionVerdict: kpis.survives is the battery (or, with the thermal model, the frozen battery) verdict.
  const a = r.adv.kpis;
  if (r.kpis.survives) return { survives: true, lossH: null, cause: null };
  return { survives: false, lossH: a.survivalHours, cause: a.thermalDeathH !== null ? 'thermal' : 'battery' };
}

/** First sunlit sample at or after the loss, hours (the test of the emergency countdown). */
export function nextSunAfterH(r: MissionResult, fromH: number): number | null {
  const i0 = Math.max(0, Math.min(r.count - 1, Math.ceil(fromH / r.stepHours)));
  for (let i = i0; i < r.count; i++) if (r.sunFrac[i] >= 0.5) return i * r.stepHours;
  return null;
}

/** Survival state from the computed options: the whole decision, in one place. */
export function survivalState(base: Outcome, load: ExitPlan['load'], move: MoveOption | null): SurvivalState {
  if (base.survives) return 'survives';
  if ((load && load.maxW !== null) || (move && move.survives)) return 'survives-if';
  return 'lost';
}

/** The search as a sequence of steps, each one at most a mission or two. */
function* planSteps(input: MissionInput, result: MissionResult, data: ScenarioData, plan: ExitPlan): Generator<number, void, void> {
  const dem = data.dem;
  if (!dem) return;
  const fly = (patch: Partial<MissionInput>, horizon = result.horizon): Outcome => outcomeOf(evaluateMission(dem, { ...input, ...patch }, horizon));
  const base = plan.base;
  const total = (base.survives ? 0 : 1 + BISECT_STEPS + BISECT_STEPS + 1) + MOVE_SIZE * MOVE_SIZE;
  let n = 0;
  const tick = (): number => ++n / Math.max(1, total);

  // (a) stay and lower the minimum load
  if (!base.survives) {
    const currentW = input.power.survivalLoadW;
    const atZero = fly({ power: { ...input.power, survivalLoadW: 0 } });
    yield tick();
    let maxW: number | null = null;
    if (atZero.survives) {
      let lo = 0, hi = currentW;
      for (let k = 0; k < BISECT_STEPS; k++) {
        const mid = (lo + hi) / 2;
        if (fly({ power: { ...input.power, survivalLoadW: mid } }).survives) lo = mid; else hi = mid;
        yield tick();
      }
      maxW = Math.floor(lo * 10) / 10;
    } else n += BISECT_STEPS;
    plan.load = { currentW, maxW, atZero };
  }

  // (b) best point within 500 m (same rule as the dispersion grid: live longest, then survive)
  const step = (2 * EXIT_MOVE_RADIUS_M) / (MOVE_SIZE - 1);
  let best: MoveOption | null = null;
  for (let k = 0; k < MOVE_SIZE * MOVE_SIZE; k++) {
    const e = -EXIT_MOVE_RADIUS_M + (k % MOVE_SIZE) * step, nn = -EXIT_MOVE_RADIUS_M + Math.floor(k / MOVE_SIZE) * step;
    const dist = Math.hypot(e, nn);
    const dx = clamp(input.dxM + e, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M), dy = clamp(input.dyM + nn, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M);
    if (dist < 1 || dist > EXIT_MOVE_RADIUS_M + 1 || dx !== input.dxM + e || dy !== input.dyM + nn) { yield tick(); continue; }
    const [x, y] = relocatedXY(input.latDeg, input.lonDeg, dx, dy);
    const o = fly({ dxM: dx, dyM: dy }, computeHorizon(dem, makeObserver(dem, x, y, input.mastM)));
    const life = o.lossH ?? plan.horizonH;
    const gainH = life - (base.lossH ?? plan.horizonH);
    if (gainH > 0.5 && (!best || life > (best.lossH ?? plan.horizonH) + 0.5)) {
      best = { ...o, eastM: e, northM: nn, distanceM: dist, azimuthDeg: ((Math.atan2(e, nn) * 180) / Math.PI + 360) % 360, gainH };
    }
    yield tick();
  }
  plan.move = best;

  if (base.survives) return;

  // (c) wait for the next sunlight
  const sunH = nextSunAfterH(result, base.lossH ?? 0);
  plan.wait = { sunH, alive: false, shortH: sunH === null ? null : sunH - (base.lossH ?? 0) };

  // What is missing, when nothing saves it: the stored energy that would (full battery of that size).
  if (survivalState(base, plan.load, plan.move) === 'lost') {
    const have = input.power.batteryCapacityWh * input.power.initialSoc;
    const ceilingWh = Math.max(1, input.power.batteryCapacityWh) * NEED_CEILING_X;
    const withEnergy = (wh: number): Outcome => fly({ power: { ...input.power, batteryCapacityWh: Math.max(input.power.batteryCapacityWh, wh), initialSoc: wh / Math.max(input.power.batteryCapacityWh, wh) } });
    const top = withEnergy(ceilingWh);
    yield tick();
    if (!top.survives) {
      plan.need = { energyWh: null, extraWh: null, ceilingWh };
    } else {
      let lo = have, hi = ceilingWh;
      for (let k = 0; k < BISECT_STEPS; k++) {
        const mid = (lo + hi) / 2;
        if (withEnergy(mid).survives) hi = mid; else lo = mid;
        yield tick();
      }
      const energyWh = Math.ceil(hi / 10) * 10;
      plan.need = { energyWh, extraWh: Math.max(0, energyWh - have), ceilingWh };
    }
  }
}

/** Survival headline and exit options of the scenario on screen, recomputed when it changes. */
export function useExitPlan(data: ScenarioData): ExitPlan | null {
  const { result, input, dem } = data;
  const [plan, setPlan] = useState<ExitPlan | null>(null);
  useEffect(() => {
    if (!result || !input || !dem) { setPlan(null); return; }
    const base0 = outcomeOf(result);
    const p: ExitPlan = {
      state: base0.survives ? 'survives' : 'lost',
      horizonH: (result.count - 1) * result.stepHours,
      startMs: result.eph.startMs,
      base: { ...base0, minSocPct: result.kpis.minSocPct },
      load: null, move: null, wait: null, need: null, done: false, progress: 0,
    };
    setPlan({ ...p });
    let cancelled = false;
    const steps = planSteps(input, result, data, p);
    const tick = (): void => {
      if (cancelled) return;
      const t0 = performance.now();
      let r = steps.next();
      while (!r.done && performance.now() - t0 < 24) r = steps.next();
      if (r.done) {
        p.state = survivalState(p.base, p.load, p.move);
        p.done = true;
        p.progress = 1;
        setPlan({ ...p });
        return;
      }
      p.progress = r.value;
      setPlan({ ...p });
      setTimeout(tick, 0);
    };
    const id = setTimeout(tick, 200);
    return () => { cancelled = true; clearTimeout(id); };
    // data is read through result / input / dem only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, input, dem]);
  return plan;
}
