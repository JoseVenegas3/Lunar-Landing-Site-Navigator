/**
 * Sub-pixel terrain: what a 20 m elevation model cannot contain.
 *
 * The LOLA 20 m mosaic is interpolated between laser tracks and holds nothing
 * smaller than a few tens of metres. The replay of IM-2 Athena shows the
 * consequence: the lander came to rest in a crater a few tens of metres wide,
 * in shadow, on ground the model shows as flat and sunlit.
 *
 * This module does NOT recover the real small craters (only metre-scale
 * imagery can). It builds a deterministic, statistically plausible surface
 * for the 2-15 m band and uses it to answer one question: how likely is it
 * that a spot which looks safe at 20 m hides a metre-scale shadow or slope
 * trap? The surface is the sum of
 *   - a fractal (value-noise fBm) roughness whose amplitude follows the
 *     unresolved RMS slope, and
 *   - a crater population in equilibrium, N(>D) = k D^-2 per m^2, with
 *     degraded depth-to-diameter ratios.
 * Both are seeded by the selenographic position, so the same point always
 * gets the same relief. The statistics are assumptions (see ARCHITECTURE.md);
 * the result is an index for comparing spots, not a map of real hazards.
 */
import { DEG, RAD } from './constants';
import { azimuthToMap } from './horizonEngine';
import { DemStack, demHeight } from './terrain';

export interface MicroReliefConfig {
  /** RMS slope the terrain model does not resolve, deg (drives the fractal amplitude). */
  slopeRmsDeg: number;
  /** Crater density relative to the equilibrium population (1 = saturated surface). */
  craterDensity: number;
  /** Smallest and largest crater modelled, m. */
  craterMinM: number;
  craterMaxM: number;
  /** Slope over the lander footprint above which a cell is a hazard, deg. */
  slopeLimitDeg: number;
  /** Baseline of that slope: the footprint of the lander, m. */
  footprintM: number;
}

export const DEFAULT_MICRO_RELIEF: MicroReliefConfig = {
  slopeRmsDeg: 2.5, craterDensity: 1, craterMinM: 3, craterMaxM: 15, slopeLimitDeg: 15, footprintM: 4,
};

/** Equilibrium crater density coefficient: N(>D) = k / D^2 craters per m^2, D in metres. */
export const EQUILIBRIUM_K = 0.079;

/** Deterministic hash of two integers and a seed to [0, 1). */
export function hash01(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in [-1, 1] with features of `wavelengthM`, anchored to absolute map metres. */
export function valueNoise(xM: number, yM: number, wavelengthM: number, seed: number): number {
  const fx = xM / wavelengthM, fy = yM / wavelengthM;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = smooth(fx - ix), ty = smooth(fy - iy);
  const a = hash01(ix, iy, seed), b = hash01(ix + 1, iy, seed);
  const c = hash01(ix, iy + 1, seed), d = hash01(ix + 1, iy + 1, seed);
  return 2 * (a + (b - a) * tx + (c + (d - c) * tx - a - (b - a) * tx) * ty) - 1;
}

const OCTAVES = [16, 8, 4, 2];
/** Hurst exponent of the lunar surface at these scales (close to self-similar). */
const HURST = 0.9;

/** Fractal roughness, m: zero mean, amplitude set by the unresolved RMS slope. */
export function fractalHeightM(xM: number, yM: number, slopeRmsDeg: number): number {
  // An octave of wavelength L and amplitude A has an RMS slope of about 2.2 A / L;
  // amplitudes scale as L^H and the octave slopes add in quadrature.
  let norm = 0;
  for (const L of OCTAVES) norm += (2.2 * L ** (HURST - 1)) ** 2;
  const unit = Math.tan(slopeRmsDeg * DEG) / Math.sqrt(norm);
  let h = 0;
  for (let k = 0; k < OCTAVES.length; k++) h += unit * OCTAVES[k] ** HURST * valueNoise(xM, yM, OCTAVES[k], 101 + k);
  return h;
}

export interface MicroCrater { xM: number; yM: number; diameterM: number; depthM: number }

const CRATER_CELL_M = 32;

/** Craters whose centre falls inside the map rectangle (metres), deterministic. */
export function cratersIn(x0M: number, y0M: number, x1M: number, y1M: number, cfg: MicroReliefConfig): MicroCrater[] {
  const out: MicroCrater[] = [];
  const lo = cfg.craterMinM, hi = cfg.craterMaxM;
  const expected = cfg.craterDensity * EQUILIBRIUM_K * (1 / (lo * lo) - 1 / (hi * hi)) * CRATER_CELL_M * CRATER_CELL_M;
  for (let cy = Math.floor(y0M / CRATER_CELL_M); cy <= Math.floor(y1M / CRATER_CELL_M); cy++) {
    for (let cx = Math.floor(x0M / CRATER_CELL_M); cx <= Math.floor(x1M / CRATER_CELL_M); cx++) {
      const count = Math.floor(expected) + (hash01(cx, cy, 7) < expected - Math.floor(expected) ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const xM = (cx + hash01(cx, cy, 11 + 4 * k)) * CRATER_CELL_M, yM = (cy + hash01(cx, cy, 12 + 4 * k)) * CRATER_CELL_M;
        if (xM < x0M || xM > x1M || yM < y0M || yM > y1M) continue;
        // Inverse CDF of N(>D) ~ D^-2 between the two diameters.
        const u = hash01(cx, cy, 13 + 4 * k);
        const diameterM = lo / Math.sqrt(1 - u * (1 - (lo * lo) / (hi * hi)));
        // Mostly degraded bowls: depth/diameter from 0.04 to 0.16, skewed shallow.
        const w = hash01(cx, cy, 14 + 4 * k);
        out.push({ xM, yM, diameterM, depthM: diameterM * (0.04 + 0.12 * w * w) });
      }
    }
  }
  return out;
}

export interface MicroPatch {
  n: number;
  spacingM: number;
  /** Map coordinates of sample (0, 0), m. */
  x0M: number;
  y0M: number;
  /** Micro-relief alone, m. */
  micro: Float32Array;
  /** Terrain model plus micro-relief, m above the datum. */
  height: Float32Array;
  craters: MicroCrater[];
}

/** Sub-pixel surface on a square patch centred on a map point. */
export function buildMicroPatch(dem: DemStack, xKm: number, yKm: number, cfg: MicroReliefConfig = DEFAULT_MICRO_RELIEF, sizeM = 96, spacingM = 1): MicroPatch {
  const n = Math.round(sizeM / spacingM) + 1;
  const x0M = xKm * 1000 - sizeM / 2, y0M = yKm * 1000 - sizeM / 2;
  const micro = new Float32Array(n * n), height = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) micro[j * n + i] = fractalHeightM(x0M + i * spacingM, y0M + j * spacingM, cfg.slopeRmsDeg);
  }
  const pad = cfg.craterMaxM / 2;
  const craters = cratersIn(x0M - pad, y0M - pad, x0M + sizeM + pad, y0M + sizeM + pad, cfg);
  for (const c of craters) {
    const R = c.diameterM / 2;
    const i0 = Math.max(0, Math.ceil((c.xM - R - x0M) / spacingM)), i1 = Math.min(n - 1, Math.floor((c.xM + R - x0M) / spacingM));
    const j0 = Math.max(0, Math.ceil((c.yM - R - y0M) / spacingM)), j1 = Math.min(n - 1, Math.floor((c.yM + R - y0M) / spacingM));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const q = ((x0M + i * spacingM - c.xM) ** 2 + (y0M + j * spacingM - c.yM) ** 2) / (R * R);
        // Parabolic bowl; where two craters overlap the deeper one wins.
        if (q < 1) micro[j * n + i] = Math.min(micro[j * n + i], -c.depthM * (1 - q));
      }
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) height[j * n + i] = demHeight(dem, (x0M + i * spacingM) / 1000, (y0M + j * spacingM) / 1000) * 1000 + micro[j * n + i];
  }
  return { n, spacingM, x0M, y0M, micro, height, craters };
}

/**
 * Share (0..1) of the patch that the patch itself shadows for a light at
 * (azimuth, elevation). Cells are visited from the light side inwards; a cell
 * is lit when it rises above the shadow line of everything up-light of it.
 * Light entering through the patch edge is taken as unobstructed, so this is
 * the micro-relief's own shadow, on top of the shadows of the 20 m terrain.
 */
export function microShadowFraction(p: MicroPatch, lonDeg: number, sunAzDeg: number, sunElDeg: number): number {
  const { n, spacingM, height } = p;
  if (sunElDeg <= 0) return 1;
  const [ux, uy] = azimuthToMap(lonDeg, sunAzDeg);
  const tanEl = Math.tan(sunElDeg * DEG);
  const steps = Math.ceil(n * 1.5);
  let shadowed = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h0 = height[j * n + i];
      let dark = false;
      // March towards the Sun in one-sample steps.
      for (let s = 1; s < steps; s++) {
        const fx = i + ux * s, fy = j + uy * s;
        if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) break;
        const ix = Math.min(n - 2, Math.floor(fx)), iy = Math.min(n - 2, Math.floor(fy));
        const tx = fx - ix, ty = fy - iy, k = iy * n + ix;
        const a = height[k] + (height[k + 1] - height[k]) * tx;
        const b = height[k + n] + (height[k + n + 1] - height[k + n]) * tx;
        if (a + (b - a) * ty > h0 + s * spacingM * tanEl) { dark = true; break; }
      }
      if (dark) shadowed++;
    }
  }
  return shadowed / (n * n);
}

/** Share (0..1) of the patch whose slope over the lander footprint exceeds the limit. */
export function steepFraction(p: MicroPatch, cfg: MicroReliefConfig = DEFAULT_MICRO_RELIEF): number {
  const { n, spacingM, height } = p;
  const b = Math.max(1, Math.round(cfg.footprintM / spacingM / 2));
  const limit = Math.tan(cfg.slopeLimitDeg * DEG);
  let steep = 0, total = 0;
  for (let j = b; j < n - b; j++) {
    for (let i = b; i < n - b; i++) {
      const gx = (height[j * n + i + b] - height[j * n + i - b]) / (2 * b * spacingM);
      const gy = (height[(j + b) * n + i] - height[(j - b) * n + i]) / (2 * b * spacingM);
      total++;
      if (Math.hypot(gx, gy) > limit) steep++;
    }
  }
  return total > 0 ? steep / total : 0;
}

export interface MicroHazard {
  /** Probability that a touchdown spot is in a metre-scale shadow while the 20 m model shows it sunlit, 0..1. */
  shadowTrap: number;
  /** Probability that the footprint slope exceeds the limit, 0..1. */
  slopeTrap: number;
  /** Either of the two, 0..1. */
  index: number;
  /** Share of the patch inside a modelled crater, 0..1. */
  craterCover: number;
  craterCount: number;
  /** RMS of the micro-relief, m. */
  rmsM: number;
  /** RMS slope of the micro-relief alone over the footprint, deg. */
  microSlopeRmsDeg: number;
  /** Sun elevations used, deg. */
  sunElDeg: number[];
}

/**
 * Micro-shadow and slope hazard of the ground around a touchdown point.
 * `sun` lists the directions of the Sun (as seen at the lander) at the instants
 * of interest, all with the Sun above the 20 m horizon.
 */
export function microHazard(
  dem: DemStack, xKm: number, yKm: number, lonDeg: number, sun: { azDeg: number; elDeg: number }[], cfg: MicroReliefConfig = DEFAULT_MICRO_RELIEF,
): MicroHazard {
  const p = buildMicroPatch(dem, xKm, yKm, cfg);
  let shadow = 0;
  for (const s of sun) shadow += microShadowFraction(p, lonDeg, s.azDeg, s.elDeg);
  const shadowTrap = sun.length > 0 ? shadow / sun.length : 0;
  const slopeTrap = steepFraction(p, cfg);
  let sq = 0, inCrater = 0;
  for (let k = 0; k < p.micro.length; k++) sq += p.micro[k] * p.micro[k];
  for (let j = 0; j < p.n; j++) {
    for (let i = 0; i < p.n; i++) {
      const x = p.x0M + i * p.spacingM, y = p.y0M + j * p.spacingM;
      if (p.craters.some((c) => (x - c.xM) ** 2 + (y - c.yM) ** 2 < (c.diameterM / 2) ** 2)) inCrater++;
    }
  }
  const b = Math.max(1, Math.round(cfg.footprintM / p.spacingM / 2));
  let g2 = 0, gN = 0;
  for (let j = b; j < p.n - b; j++) {
    for (let i = b; i < p.n - b; i++) {
      const gx = (p.micro[j * p.n + i + b] - p.micro[j * p.n + i - b]) / (2 * b * p.spacingM);
      const gy = (p.micro[(j + b) * p.n + i] - p.micro[(j - b) * p.n + i]) / (2 * b * p.spacingM);
      g2 += gx * gx + gy * gy; gN++;
    }
  }
  return {
    shadowTrap, slopeTrap, index: 1 - (1 - shadowTrap) * (1 - slopeTrap),
    craterCover: inCrater / p.micro.length, craterCount: p.craters.length,
    rmsM: Math.sqrt(sq / p.micro.length), microSlopeRmsDeg: Math.atan(Math.sqrt(g2 / Math.max(1, gN))) * RAD,
    sunElDeg: sun.map((s) => s.elDeg),
  };
}

/** Up to `count` sunlit instants of a mission, evenly spread, as Sun directions. */
export function sunlitDirections(r: { count: number; sunAz: ArrayLike<number>; sunEl: ArrayLike<number>; sunFrac: ArrayLike<number> }, count = 8): { azDeg: number; elDeg: number }[] {
  const lit: number[] = [];
  for (let i = 0; i < r.count; i++) if (r.sunFrac[i] >= 0.5 && r.sunEl[i] > 0) lit.push(i);
  const out: { azDeg: number; elDeg: number }[] = [];
  for (let k = 0; k < Math.min(count, lit.length); k++) {
    const i = lit[Math.floor(((k + 0.5) * lit.length) / Math.min(count, lit.length))];
    out.push({ azDeg: r.sunAz[i], elDeg: r.sunEl[i] });
  }
  return out;
}
