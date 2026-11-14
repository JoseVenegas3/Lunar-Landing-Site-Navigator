/**
 * Probability of tipping over at touchdown (energy criterion).
 *
 * The lander is a rigid body that pivots about the line through its downhill
 * footpads. With the centre of mass at height h above the pad plane and at
 * horizontal distance r from that line, the static stability angle is
 *   beta = atan(r / h),      L = sqrt(r^2 + h^2).
 * On ground that slopes alpha along the direction of travel the centre of mass
 * has to rise L (1 - cos(beta - alpha)) to pass over the pivot, so the lander
 * tips when the residual horizontal velocity v satisfies
 *   v^2 / 2 > g L (1 - cos(beta - alpha)).
 * All the horizontal kinetic energy is assumed to go into the rotation (the
 * pads stop dead): leg stroke, crushable energy absorbers, sliding friction
 * and vertical velocity are not modelled. That makes the criterion pessimistic
 * for a sliding lander and optimistic for one that lands hard on one leg.
 *
 * The residual velocity is a two-dimensional Gaussian (magnitude Rayleigh,
 * direction uniform) and the slope under the pads is the terrain-model slope
 * plus a Gaussian error for the relief the model does not resolve. The
 * probability is integrated numerically; nothing is sampled at random.
 */
import { DEG, RAD } from './constants';
import { relocatedXY } from './analysis';
import { DemStack, slopeDeg } from './terrain';

/** Lunar surface gravity, m/s^2. */
export const G_MOON_M_S2 = 1.62;

export interface TipoverConfig {
  /** Height of the centre of mass above the footpad plane, m. */
  cgHeightM: number;
  /** Horizontal distance from the centre of mass to the tipping line, m. */
  tipRadiusM: number;
  /** Standard deviation of each horizontal velocity component at touchdown, m/s. */
  sigmaVelMs: number;
  /** Standard deviation of the slope the terrain model does not resolve, deg. */
  sigmaSlopeDeg: number;
}

/** Illustrative vehicle, not the data sheet of a real lander. */
export const DEFAULT_TIPOVER: TipoverConfig = { cgHeightM: 1.8, tipRadiusM: 2.0, sigmaVelMs: 0.5, sigmaSlopeDeg: 3 };

export const staticStabilityDeg = (c: Pick<TipoverConfig, 'cgHeightM' | 'tipRadiusM'>): number => Math.atan2(c.tipRadiusM, c.cgHeightM) * RAD;

/** Horizontal velocity above which the lander tips on a slope `slopeAlongDeg` in its direction of travel, m/s. */
export function criticalVelocityMs(c: Pick<TipoverConfig, 'cgHeightM' | 'tipRadiusM'>, slopeAlongDeg: number): number {
  const margin = (staticStabilityDeg(c) - slopeAlongDeg) * DEG;
  if (margin <= 0) return 0; // statically unstable
  const L = Math.hypot(c.cgHeightM, c.tipRadiusM);
  return Math.sqrt(2 * G_MOON_M_S2 * L * (1 - Math.cos(Math.min(Math.PI, margin))));
}

const DIRECTIONS = 72;
const SLOPE_NODES = 25;

/** P(tip) on ground of slope `slope` (deg) with no slope error: mean over the direction of travel. */
function tipGivenSlope(c: TipoverConfig, slope: number): number {
  const tanS = Math.tan(Math.min(89, Math.abs(slope)) * DEG);
  let sum = 0;
  for (let k = 0; k < DIRECTIONS; k++) {
    // Direction of travel measured from downhill; the slope along it is atan(tan(slope) cos(phi)).
    const along = Math.atan(tanS * Math.cos(((k + 0.5) / DIRECTIONS) * 2 * Math.PI)) * RAD;
    const vc = criticalVelocityMs(c, along);
    sum += c.sigmaVelMs > 0 ? Math.exp(-(vc * vc) / (2 * c.sigmaVelMs * c.sigmaVelMs)) : vc === 0 ? 1 : 0;
  }
  return sum / DIRECTIONS;
}

/** Probability (0..1) of tipping over at touchdown on terrain whose modelled slope is `slopeDegAtSite`. */
export function tipoverProbability(c: TipoverConfig, slopeDegAtSite: number): number {
  if (c.sigmaSlopeDeg <= 0) return tipGivenSlope(c, slopeDegAtSite);
  // Gaussian slope error over +-3.5 sigma, trapezoid weights renormalised.
  let sum = 0, wSum = 0;
  for (let k = 0; k < SLOPE_NODES; k++) {
    const z = -3.5 + (7 * k) / (SLOPE_NODES - 1);
    const w = Math.exp(-0.5 * z * z);
    sum += w * tipGivenSlope(c, slopeDegAtSite + z * c.sigmaSlopeDeg);
    wSum += w;
  }
  return sum / wSum;
}

export interface TipoverCell { eastM: number; northM: number; slopeDeg: number; p: number }
export interface TipoverMap {
  size: number;
  radiusM: number;
  /** Row-major, south row first. */
  cells: TipoverCell[];
  centre: TipoverCell;
  meanP: number;
  maxP: number;
  maxSlopeDeg: number;
}

/** P(tip) on a size x size grid of touchdown points spanning +-radiusM around the aim point. */
export function tipoverMap(
  dem: DemStack, at: { latDeg: number; lonDeg: number; dxM: number; dyM: number }, c: TipoverConfig, radiusM = 200, size = 5,
): TipoverMap {
  const cells: TipoverCell[] = [];
  const step = (2 * radiusM) / (size - 1);
  let sum = 0, maxP = 0, maxSlope = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const eastM = -radiusM + i * step, northM = -radiusM + j * step;
      const [x, y] = relocatedXY(at.latDeg, at.lonDeg, at.dxM + eastM, at.dyM + northM);
      const s = slopeDeg(dem, x, y);
      const p = tipoverProbability(c, s);
      cells.push({ eastM, northM, slopeDeg: s, p });
      sum += p;
      if (p > maxP) maxP = p;
      if (s > maxSlope) maxSlope = s;
    }
  }
  const mid = (size - 1) / 2;
  return { size, radiusM, cells, centre: cells[mid * size + mid], meanP: sum / cells.length, maxP, maxSlopeDeg: maxSlope };
}
