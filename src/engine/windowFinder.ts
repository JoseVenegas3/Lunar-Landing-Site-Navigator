/**
 * Landing-window finder: "when can we land here?".
 *
 * A candidate touchdown time is accepted when a mission of the required length
 * started at that instant
 *   - lands in sunlight,
 *   - has a robust downlink at touchdown (Earth above the terrain by the
 *     antenna margin, a ground station tracking the Moon, positive link margin;
 *     a signal that only diffracts over the skyline does not count),
 *   - survives (battery and, with the thermal model on, bus temperature),
 *   - and meets the approach-lighting constraint: the Sun neither ahead of the
 *     descent cameras (glare) nor directly behind them (zero-phase washout,
 *     no visible shadows), and enough of the landing ellipse sunlit for
 *     optical hazard detection.
 * Every rejected candidate keeps the list of reasons, so the answer to "why
 * not that week?" is explicit.
 *
 * The lighting thresholds are engineering assumptions of this tool, not the
 * published requirement of any mission; they are parameters.
 */
import { DEG, HOUR_MS, wrap180 } from './constants';
import { STATE_DTE } from './analysis';
import { HorizonProfile, azimuthToMap, farHorizonAt, farHorizonDistAt } from './horizonEngine';
import { MissionInput, MissionResult, STATE_RF_PHYSICAL, evaluateMission } from './missionAnalysis';
import { SweepContext, farPlaneBase, makeSweepContext, sweepShadowCeiling } from './shadowSweep';
import { DemStack } from './terrain';

export type RejectReason =
  | 'thermal' | 'battery' | 'dark' | 'no-station' | 'earth-blocked' | 'link-margin' | 'glare' | 'washout' | 'ellipse-shadow';

/** Order used to pick the one reason that labels a rejected candidate. */
export const REJECT_PRIORITY: RejectReason[] = [
  'thermal', 'battery', 'dark', 'earth-blocked', 'no-station', 'link-margin', 'ellipse-shadow', 'glare', 'washout',
];

export interface WindowConfig {
  /** Span searched from the first candidate, days. */
  searchDays: number;
  /** Spacing of candidate touchdown times, hours. */
  candidateStepHours: number;
  /** Surface mission that must be survived from touchdown, days. */
  missionDays: number;
  /** Time step of each mission evaluation, hours. */
  stepHours: number;
  /** Heading of the ground track at touchdown, degrees east of north. */
  approachAzDeg: number;
  /** Sun within this angle of the heading: glare in the descent cameras. */
  glareHalfDeg: number;
  /** Sun within this angle of the reverse heading: zero-phase washout. */
  washoutHalfDeg: number;
  /** Radius of the landing ellipse checked for sunlight, m. */
  ellipseRadiusM: number;
  /** Least sunlit share of the ellipse for optical hazard detection, percent. */
  minEllipseLitPct: number;
}

export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  searchDays: 90, candidateStepHours: 12, missionDays: 14, stepHours: 1,
  approachAzDeg: 180, glareHalfDeg: 25, washoutHalfDeg: 15, ellipseRadiusM: 200, minEllipseLitPct: 50,
};

export interface LandingCandidate {
  timeMs: number;
  ok: boolean;
  reasons: RejectReason[];
  sunElDeg: number;
  sunAzDeg: number;
  /** Sun azimuth relative to the approach heading, deg in (-180, 180]; 0 = dead ahead. */
  sunRelDeg: number;
  /** Sunlit share of the landing ellipse at touchdown, percent (null without a local grid). */
  ellipseLitPct: number | null;
  survives: boolean;
  survivalHours: number;
  /** Share of the mission with a downlink that closes, percent. */
  linkPct: number;
  illuminationPct: number;
  energyWh: number;
  dataGb: number;
  minSocPct: number;
}

export interface LandingWindow {
  startMs: number;
  /** End of the last accepted candidate's interval. */
  endMs: number;
  /** Open time: accepted candidates times their spacing, hours. */
  openHours: number;
  count: number;
  /** Accepted candidate with the largest data return. */
  best: LandingCandidate;
}

/** Sweep buffers for the ellipse-lighting check, built once per search. */
export interface EllipseSweep { ctx: SweepContext; ceil: Float32Array; cells: number[]; key: string }

/** Prepare the lighting check of the ellipse around the lander of `horizon`. */
export function makeEllipseSweep(dem: DemStack, horizon: HorizonProfile, radiusM: number): EllipseSweep | null {
  if (!dem.local) return null;
  const ctx = makeSweepContext(dem.local);
  const obs = horizon.observer, m = ctx.n, rKm = radiusM / 1000;
  const cells: number[] = [];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      if (Math.hypot(ctx.x0 + i * ctx.spacingKm - obs.x, ctx.y0 + j * ctx.spacingKm - obs.y) <= rKm) cells.push(j * m + i);
    }
  }
  return { ctx, ceil: new Float32Array(m * m), cells, key: `${obs.x}|${obs.y}|${radiusM}` };
}

/** Sunlit share (0..1) of the ellipse for a Sun at (az, el) seen from the lander; the disc centre decides. */
export function ellipseLitFraction(sweep: EllipseSweep, horizon: HorizonProfile, sunAzDeg: number, sunElDeg: number): number {
  if (sweep.cells.length === 0) return 0;
  const obs = horizon.observer, { ctx, ceil, cells } = sweep;
  const tanEl = Math.tan(sunElDeg * DEG);
  const [dirX, dirY] = azimuthToMap(obs.lonDeg, sunAzDeg);
  const farBase = farPlaneBase(obs.heightKm, Math.tan(farHorizonAt(horizon, sunAzDeg) * DEG), farHorizonDistAt(horizon, sunAzDeg), tanEl);
  sweepShadowCeiling(ctx, { dirX, dirY, tanEl, farBase, originX: obs.x, originY: obs.y }, ceil);
  const bias = ctx.spacingKm * 1e-3;
  let lit = 0;
  for (let c = 0; c < cells.length; c++) if (ctx.flat[cells[c]] + bias > ceil[cells[c]]) lit++;
  return lit / cells.length;
}

/** Approach-lighting verdict from the Sun azimuth relative to the heading. */
export function approachLighting(sunAzDeg: number, cfg: Pick<WindowConfig, 'approachAzDeg' | 'glareHalfDeg' | 'washoutHalfDeg'>): { relDeg: number; glare: boolean; washout: boolean } {
  const relDeg = wrap180(sunAzDeg - cfg.approachAzDeg);
  return { relDeg, glare: Math.abs(relDeg) < cfg.glareHalfDeg, washout: Math.abs(relDeg) > 180 - cfg.washoutHalfDeg };
}

/** Reasons a mission result fails as a landing at its first sample. */
export function judgeLanding(r: MissionResult, cfg: WindowConfig, ellipseLit: number | null): { reasons: RejectReason[]; relDeg: number } {
  const reasons: RejectReason[] = [];
  if (!r.kpis.survives) reasons.push(r.adv.kpis.thermalDeathH !== null ? 'thermal' : 'battery');
  const sunUp = r.sunFrac[0] >= 0.5;
  if (!sunUp) reasons.push('dark');
  // Touchdown needs a robust link: the Earth above the terrain by the antenna margin, not a
  // few kbps diffracted over the skyline, and then a station tracking with positive margin.
  if (!(r.state[0] & STATE_DTE)) reasons.push('earth-blocked');
  else if (!(r.state[0] & STATE_RF_PHYSICAL)) reasons.push(r.adv.contact.station[0] < 0 ? 'no-station' : 'link-margin');
  const light = approachLighting(r.sunAz[0], cfg);
  // Glare and washout need the Sun in the sky; in the dark the 'dark' reason already covers it.
  if (sunUp && light.glare) reasons.push('glare');
  if (sunUp && light.washout) reasons.push('washout');
  if (ellipseLit !== null && 100 * ellipseLit < cfg.minEllipseLitPct) reasons.push('ellipse-shadow');
  return { reasons, relDeg: light.relDeg };
}

/** Evaluate one candidate touchdown time. `horizon` must be the profile of the lander position of `input`. */
export function evaluateLandingCandidate(
  dem: DemStack, input: MissionInput, horizon: HorizonProfile, timeMs: number, cfg: WindowConfig, sweep: EllipseSweep | null,
): LandingCandidate {
  const r = evaluateMission(dem, { ...input, startMs: timeMs, days: cfg.missionDays, stepHours: cfg.stepHours }, horizon);
  const lit = sweep ? ellipseLitFraction(sweep, horizon, r.sunAz[0], r.sunEl[0]) : null;
  const { reasons, relDeg } = judgeLanding(r, cfg, lit);
  return {
    timeMs, ok: reasons.length === 0, reasons,
    sunElDeg: r.sunEl[0], sunAzDeg: r.sunAz[0], sunRelDeg: relDeg,
    ellipseLitPct: lit === null ? null : 100 * lit,
    survives: r.kpis.survives, survivalHours: r.adv.kpis.survivalHours, linkPct: r.adv.kpis.rfAvailabilityPct,
    illuminationPct: r.kpis.illuminationPct, energyWh: r.kpis.energyWh, dataGb: r.kpis.dataGb, minSocPct: r.kpis.minSocPct,
  };
}

/** Candidate touchdown times of a search starting at `startMs`. */
export function candidateTimes(startMs: number, cfg: Pick<WindowConfig, 'searchDays' | 'candidateStepHours'>): number[] {
  const n = Math.floor((cfg.searchDays * 24) / cfg.candidateStepHours) + 1;
  return Array.from({ length: n }, (_, k) => startMs + k * cfg.candidateStepHours * HOUR_MS);
}

/** Runs of consecutive accepted candidates. */
export function groupLandingWindows(candidates: LandingCandidate[], candidateStepHours: number): LandingWindow[] {
  const out: LandingWindow[] = [];
  let run: LandingCandidate[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    let best = run[0];
    for (const c of run) if (c.dataGb > best.dataGb || (c.dataGb === best.dataGb && c.energyWh > best.energyWh)) best = c;
    out.push({
      startMs: run[0].timeMs, endMs: run[run.length - 1].timeMs + candidateStepHours * HOUR_MS,
      openHours: run.length * candidateStepHours, count: run.length, best,
    });
    run = [];
  };
  for (const c of candidates) { if (c.ok) run.push(c); else flush(); }
  flush();
  return out;
}

/** The reason that labels a rejected candidate (highest priority among its reasons), or null when accepted. */
export function primaryReason(c: LandingCandidate): RejectReason | null {
  for (const r of REJECT_PRIORITY) if (c.reasons.includes(r)) return r;
  return null;
}

/** How many candidates each reason rejects (a candidate can count under several). */
export function rejectionCounts(candidates: LandingCandidate[]): Record<RejectReason, number> {
  const counts = Object.fromEntries(REJECT_PRIORITY.map((r) => [r, 0])) as Record<RejectReason, number>;
  for (const c of candidates) for (const r of c.reasons) counts[r]++;
  return counts;
}

export interface WindowSearch {
  config: WindowConfig;
  candidates: LandingCandidate[];
  windows: LandingWindow[];
  counts: Record<RejectReason, number>;
  acceptedPct: number;
}

export function summariseWindowSearch(candidates: LandingCandidate[], config: WindowConfig): WindowSearch {
  const accepted = candidates.reduce((n, c) => n + (c.ok ? 1 : 0), 0);
  return {
    config, candidates, windows: groupLandingWindows(candidates, config.candidateStepHours), counts: rejectionCounts(candidates),
    acceptedPct: candidates.length > 0 ? (100 * accepted) / candidates.length : 0,
  };
}

/** Synchronous search (tests and scripts; the app time-slices the same loop). */
export function findLandingWindows(dem: DemStack, input: MissionInput, horizon: HorizonProfile, startMs: number, config: WindowConfig = DEFAULT_WINDOW_CONFIG): WindowSearch {
  const sweep = makeEllipseSweep(dem, horizon, config.ellipseRadiusM);
  const candidates = candidateTimes(startMs, config).map((t) => evaluateLandingCandidate(dem, input, horizon, t, config, sweep));
  return summariseWindowSearch(candidates, config);
}
