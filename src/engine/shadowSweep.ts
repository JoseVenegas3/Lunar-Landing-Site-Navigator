/**
 * O(N) shadow propagation over the local DEM for one light direction.
 *
 * The grid is processed column by column (or row by row) starting from the edge
 * that faces the light. Each cell receives a "shadow ceiling": the height below
 * which a point at that cell is occluded. The ceiling of a cell is the larger
 * of (terrain height, ceiling) of its upwind neighbours, lowered by the drop of
 * a light ray over one cell. Terrain outside the grid enters through a boundary
 * plane built from the far-field horizon of the lander.
 *
 * Heights are first reduced to the tangent plane at the grid centre
 * (h' = h - d^2 / 2R) so that light rays are straight lines in the working frame.
 *
 * The same sweep serves three consumers: the hard-shadow mask of the 3-D view,
 * the cumulative insolation heat map and the Earth line-of-sight coverage map.
 */
import { R_MOON_KM } from './constants';
import { Grid } from './terrain';

export interface SweepContext {
  n: number;
  spacingKm: number;
  x0: number;
  y0: number;
  /** Heights relative to the tangent plane at the grid centre, km. */
  flat: Float32Array;
}

export function makeSweepContext(grid: Grid): SweepContext {
  const { n, spacingKm, x0, y0, data } = grid;
  const flat = new Float32Array(n * n);
  const c = (n - 1) / 2;
  for (let j = 0; j < n; j++) {
    const dy = (j - c) * spacingKm;
    for (let i = 0; i < n; i++) {
      const dx = (i - c) * spacingKm;
      flat[j * n + i] = data[j * n + i] - (dx * dx + dy * dy) / (2 * R_MOON_KM);
    }
  }
  return { n, spacingKm, x0, y0, flat };
}

export interface LightSample {
  /** Unit map-frame vector pointing from the terrain towards the light. */
  dirX: number;
  dirY: number;
  /** Tangent of the light elevation. */
  tanEl: number;
  /**
   * Far-field boundary plane: ceiling(p) = farBase + s(p) * tanEl, where s is the
   * along-light coordinate (km) of p measured from (originX, originY).
   * Use a very negative farBase when nothing outside the grid can occlude.
   */
  farBase: number;
  originX: number;
  originY: number;
}

/**
 * Far-field plane constant for a lander whose far horizon (terrain outside the
 * local grid) rises to `farElevTan` at range `farDistKm` in the light azimuth.
 */
export function farPlaneBase(observerHeightKm: number, farElevTan: number, farDistKm: number, tanEl: number): number {
  if (!Number.isFinite(farElevTan) || farElevTan < -50) return -1e6;
  return observerHeightKm + farDistKm * farElevTan - farDistKm * tanEl;
}

/** Fill `out` with the shadow ceiling (km, tangent frame) for one light sample. */
export function sweepShadowCeiling(ctx: SweepContext, light: LightSample, out: Float32Array): void {
  const { n, spacingKm, x0, y0, flat } = ctx;
  const { dirX, dirY, tanEl, farBase, originX, originY } = light;
  const alongX = Math.abs(dirX) >= Math.abs(dirY);
  // Primary axis p (the one the light travels mostly along) and secondary axis q.
  const dp = alongX ? dirX : dirY;
  const dq = alongX ? dirY : dirX;
  const sgn = dp >= 0 ? 1 : -1;
  const slope = dq / Math.abs(dp); // secondary-axis cells gained per primary cell towards the light
  const drop = spacingKm * Math.sqrt(1 + slope * slope) * tanEl;
  const strideP = alongX ? 1 : n;
  const strideQ = alongX ? n : 1;
  const first = sgn > 0 ? n - 1 : 0;

  // Along-light coordinate of a cell: s = (x - ox) dirX + (y - oy) dirY.
  const sP = spacingKm * (alongX ? dirX : dirY);
  const sQ = spacingKm * (alongX ? dirY : dirX);
  const s0 = (x0 - originX) * dirX + (y0 - originY) * dirY;

  for (let step = 0; step < n; step++) {
    const p = first - sgn * step;
    const up = p + sgn;
    for (let q = 0; q < n; q++) {
      const idx = p * strideP + q * strideQ;
      const farCeil = farBase + (s0 + p * sP + q * sQ) * tanEl;
      let ceil = farCeil;
      if (step > 0) {
        const fq = q + slope;
        const q0 = Math.floor(fq);
        if (q0 >= 0 && q0 < n - 1) {
          const t = fq - q0;
          const k0 = up * strideP + q0 * strideQ;
          const k1 = k0 + strideQ;
          const c0 = flat[k0] > out[k0] ? flat[k0] : out[k0];
          const c1 = flat[k1] > out[k1] ? flat[k1] : out[k1];
          const local = c0 + (c1 - c0) * t - drop;
          if (local > ceil) ceil = local;
        }
      }
      out[idx] = ceil;
    }
  }
}

/**
 * Penumbra-aware lit fraction (0..255) from two ceilings: one swept with the
 * upper solar limb (el + r) and one with the lower limb (el - r).
 */
export function litFractionBytes(ctx: SweepContext, ceilUpperLimb: Float32Array, ceilLowerLimb: Float32Array, out: Uint8Array): void {
  const flat = ctx.flat;
  for (let i = 0; i < flat.length; i++) {
    const h = flat[i];
    const hi = ceilUpperLimb[i];
    const span = ceilLowerLimb[i] - hi;
    let f = (h - hi) / (span > 1e-5 ? span : 1e-5);
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    out[i] = (f * 255) | 0;
  }
}

/** Add 1 to `acc` for every cell that sees the light (binary test, small bias against acne). */
export function accumulateVisible(ctx: SweepContext, ceil: Float32Array, acc: Float32Array, weight = 1): void {
  const flat = ctx.flat;
  const bias = ctx.spacingKm * 1e-3;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] + bias > ceil[i]) acc[i] += weight;
  }
}
