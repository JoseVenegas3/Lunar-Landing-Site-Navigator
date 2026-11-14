/**
 * Terrain-uncertainty ensemble (evolution E1).
 *
 * The LOLA elevation model is not exact: Barker et al. (2021) report a typical
 * height error of 0.3-0.5 m RMS at 5 m/px, mostly interpolation between laser
 * tracks. With the Sun and the Earth within a degree or two of the skyline, a
 * few decimetres on a rise 50 m away move the horizon by as much as the solar
 * disc is wide. This module turns that error into a spread on the results.
 *
 * Each ensemble member adds a spatially correlated Gaussian height error to the
 * terrain within NEAR_FIELD_KM of the lander (where the error matters: 0.4 m at
 * 2 km is 0.01 deg) and to the ground under the lander itself, rebuilds the
 * near horizon, and keeps the unperturbed far horizon. The mission model is
 * then run on every member.
 *
 * The random numbers are a seeded sequence: the same inputs always give the
 * same ensemble. With sigma = 0 every member equals the deterministic case.
 */
import { DEG, RAD, R_MOON_KM } from './constants';
import { AZ_COUNT, HorizonProfile, MAX_RANGE_KM, Observer, azimuthToMap } from './horizonEngine';
import { DemStack, demHeight, gridContains } from './terrain';

export interface UncertaintyConfig {
  /** Ensemble size. */
  members: number;
  /** RMS height error of the terrain model, m. */
  sigmaM: number;
  /** Correlation length of that error, m. */
  corrLenM: number;
  seed: number;
}

export const DEFAULT_UNCERTAINTY: UncertaintyConfig = { members: 48, sigmaM: 0.4, corrLenM: 40, seed: 20261113 };

/** Range inside which the terrain is perturbed, km. */
export const NEAR_FIELD_KM = 2;
const FIELD_SPACING_KM = 0.016;
const FIELD_HALF_KM = NEAR_FIELD_KM + 0.1;

/** Small fast seeded generator (mulberry32), uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ErrorField {
  n: number;
  spacingKm: number;
  /** Map coordinates of sample (0, 0). */
  x0: number;
  y0: number;
  /** Height error, km. */
  data: Float32Array;
}

/**
 * Correlated Gaussian height-error field centred on (cx, cy). White noise is
 * smoothed with three box passes (a close approximation of a Gaussian kernel
 * of the requested correlation length) and rescaled to the requested RMS.
 */
export function heightErrorField(cx: number, cy: number, sigmaM: number, corrLenM: number, random: () => number): ErrorField {
  const n = 2 * Math.round(FIELD_HALF_KM / FIELD_SPACING_KM) + 1;
  const data = new Float32Array(n * n);
  const field: ErrorField = { n, spacingKm: FIELD_SPACING_KM, x0: cx - FIELD_HALF_KM, y0: cy - FIELD_HALF_KM, data };
  if (sigmaM <= 0) return field;
  // Box-Muller white noise.
  for (let k = 0; k < data.length; k += 2) {
    const u = Math.max(1e-12, random()), v = random();
    const r = Math.sqrt(-2 * Math.log(u));
    data[k] = r * Math.cos(2 * Math.PI * v);
    if (k + 1 < data.length) data[k + 1] = r * Math.sin(2 * Math.PI * v);
  }
  const radius = Math.max(0, Math.round(corrLenM / 1000 / FIELD_SPACING_KM / 2));
  if (radius > 0) {
    const tmp = new Float32Array(n * n);
    const pass = (src: Float32Array, dst: Float32Array, stride: number, other: number): void => {
      for (let line = 0; line < n; line++) {
        let sum = 0;
        const base = line * other;
        for (let k = -radius; k <= radius; k++) sum += src[base + Math.min(n - 1, Math.max(0, k)) * stride];
        for (let k = 0; k < n; k++) {
          dst[base + k * stride] = sum;
          sum += src[base + Math.min(n - 1, k + radius + 1) * stride] - src[base + Math.max(0, k - radius) * stride];
        }
      }
    };
    for (let p = 0; p < 3; p++) {
      pass(data, tmp, 1, n);
      pass(tmp, data, n, 1);
    }
  }
  let ss = 0;
  for (let k = 0; k < data.length; k++) ss += data[k] * data[k];
  const scale = sigmaM / 1000 / Math.sqrt(ss / data.length);
  for (let k = 0; k < data.length; k++) data[k] *= scale;
  return field;
}

/** Height error (km) at a map point, bilinear; zero outside the field. */
export function sampleError(f: ErrorField, x: number, y: number): number {
  const fx = (x - f.x0) / f.spacingKm, fy = (y - f.y0) / f.spacingKm;
  if (fx < 0 || fy < 0 || fx > f.n - 1 || fy > f.n - 1) return 0;
  const i = Math.min(f.n - 2, Math.floor(fx)), j = Math.min(f.n - 2, Math.floor(fy));
  const tx = fx - i, ty = fy - j, d = f.data, k = j * f.n + i;
  const a = d[k] + (d[k + 1] - d[k]) * tx;
  const b = d[k + f.n] + (d[k + f.n + 1] - d[k + f.n]) * tx;
  return a + (b - a) * ty;
}

/** Radial sampling schedule, identical to the one of the horizon engine. */
const DISTANCES = (() => {
  const d: number[] = [];
  let r = 0.02;
  while (r < MAX_RANGE_KM) {
    d.push(r);
    r += r < 9 ? Math.max(0.016, r * 0.02) : Math.max(0.3, r * 0.02);
  }
  return d;
})();
const NEAR_STEPS = DISTANCES.findIndex((d) => d > NEAR_FIELD_KM);

/**
 * Largest tangent of the terrain elevation per azimuth over the schedule steps
 * [from, to), with an optional height error added to the terrain.
 */
function marchTangents(dem: DemStack, obs: Observer, from: number, to: number, error: ErrorField | null): { tan: Float64Array; dist: Float32Array } {
  const tan = new Float64Array(AZ_COUNT).fill(-Infinity);
  const dist = new Float32Array(AZ_COUNT);
  const ro = R_MOON_KM + obs.heightKm;
  for (let a = 0; a < AZ_COUNT; a++) {
    const [ux, uy] = azimuthToMap(obs.lonDeg, a);
    for (let s = from; s < to; s++) {
      const d = DISTANCES[s];
      const x = obs.x + ux * d, y = obs.y + uy * d;
      if (!gridContains(dem.regional, x, y)) break;
      const rt = R_MOON_KM + demHeight(dem, x, y) + (error ? sampleError(error, x, y) : 0);
      const g = d / R_MOON_KM;
      const t = (rt * Math.cos(g) - ro) / (rt * Math.sin(g));
      if (t > tan[a]) { tan[a] = t; dist[a] = d; }
    }
  }
  return { tan, dist };
}

export interface HorizonEnsemble {
  config: UncertaintyConfig;
  /** Horizon of ensemble member k (0 <= k < config.members). Deterministic in k. */
  member: (k: number) => HorizonProfile;
}

/**
 * Prepare an ensemble around a base horizon profile. The far horizon is marched
 * once; each member only re-marches the near field.
 */
export function computeHorizonEnsemble(dem: DemStack, base: HorizonProfile, config: UncertaintyConfig = DEFAULT_UNCERTAINTY): HorizonEnsemble {
  const obs = base.observer;
  const far = marchTangents(dem, obs, NEAR_STEPS, DISTANCES.length, null);
  return {
    config,
    member: (k: number): HorizonProfile => {
      const field = heightErrorField(obs.x, obs.y, config.sigmaM, config.corrLenM, seededRandom(config.seed + 7919 * k));
      const shift = sampleError(field, obs.x, obs.y);
      const moved: Observer = { ...obs, groundKm: obs.groundKm + shift, heightKm: obs.heightKm + shift };
      const near = marchTangents(dem, moved, 0, NEAR_STEPS, field);
      const elevDeg = new Float32Array(AZ_COUNT), distKm = new Float32Array(AZ_COUNT);
      for (let a = 0; a < AZ_COUNT; a++) {
        const nearWins = near.tan[a] >= far.tan[a];
        elevDeg[a] = Math.atan(nearWins ? near.tan[a] : far.tan[a]) * RAD;
        distKm[a] = nearWins ? near.dist[a] : far.dist[a];
      }
      return { observer: moved, elevDeg, distKm, farElevDeg: base.farElevDeg, farDistKm: base.farDistKm };
    },
  };
}

export interface Quantiles { p10: number; p50: number; p90: number }

export function quantiles(values: number[]): Quantiles {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => {
    if (s.length === 0) return NaN;
    const x = q * (s.length - 1), i = Math.floor(x);
    return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (x - i);
  };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

/** What one ensemble member contributes to the statistics. */
export interface MemberOutcome {
  illuminationPct: number;
  dtePct: number;
  downlinkPct: number;
  energyWh: number;
  dataGb: number;
  survivalHours: number;
  survives: boolean;
  /** Bit per sample: lit (1), downlink up (2). */
  flags: Uint8Array;
}

export interface EnsembleStats {
  members: number;
  illuminationPct: Quantiles;
  dtePct: Quantiles;
  downlinkPct: Quantiles;
  energyWh: Quantiles;
  dataGb: Quantiles;
  survivalHours: Quantiles;
  /** Share of the members in which the lander survives the whole window, 0..1. */
  pSurvive: number;
  /** Per sample: share of the members with sunlight, and with a downlink, 0..1. */
  pSunlit: Float32Array;
  pDownlink: Float32Array;
  /** Largest spread of the horizon between members is implied by this spread in illumination, percentage points. */
  illuminationSpreadPts: number;
}

export function summariseEnsemble(outcomes: MemberOutcome[]): EnsembleStats {
  const n = outcomes.length;
  const count = n > 0 ? outcomes[0].flags.length : 0;
  const pSunlit = new Float32Array(count), pDownlink = new Float32Array(count);
  for (const o of outcomes) {
    for (let i = 0; i < count; i++) {
      if (o.flags[i] & 1) pSunlit[i] += 1 / n;
      if (o.flags[i] & 2) pDownlink[i] += 1 / n;
    }
  }
  const q = (f: (o: MemberOutcome) => number): Quantiles => quantiles(outcomes.map(f));
  const ill = q((o) => o.illuminationPct);
  return {
    members: n,
    illuminationPct: ill,
    dtePct: q((o) => o.dtePct),
    downlinkPct: q((o) => o.downlinkPct),
    energyWh: q((o) => o.energyWh),
    dataGb: q((o) => o.dataGb),
    survivalHours: q((o) => o.survivalHours),
    pSurvive: n > 0 ? outcomes.filter((o) => o.survives).length / n : 0,
    pSunlit, pDownlink,
    illuminationSpreadPts: ill.p90 - ill.p10,
  };
}

/** Standard deviation of a field, m (for tests and for reporting the realised error). */
export function fieldRmsM(f: ErrorField): number {
  let ss = 0;
  for (let k = 0; k < f.data.length; k++) ss += f.data[k] * f.data[k];
  return Math.sqrt(ss / f.data.length) * 1000;
}

/** Angular size of a height error at a range, deg: how far it moves the skyline. */
export const skylineShiftDeg = (heightErrorM: number, rangeM: number): number => Math.atan(heightErrorM / rangeM) / DEG;
