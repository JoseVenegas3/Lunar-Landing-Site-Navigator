/**
 * Solar elevation as a power KPI (v3.1, SR-403). At the lunar south pole the
 * Sun is never more than a couple of degrees above the astronomical horizon,
 * so tenths of a degree decide whether the disc clears a ridge (the visible
 * disc fraction f☉) and therefore how much power the array collects. This
 * reads the mission result; it adds no physics of its own.
 */
import type { ScenarioResult } from './analysis';
import { mountProjectionFactor } from './missionPhysics';

export interface SolarElevationKpi {
  /** Elevation of the centre of the solar disc at the cursor, degrees above the astronomical horizon. */
  elNowDeg: number;
  /** Highest elevation in the window, and when (hours from the start). */
  elMaxDeg: number;
  elMaxAtH: number;
  /** Mean elevation over the samples with any visible disc. */
  elMeanLitDeg: number;
  /** Visible share of the solar disc at the cursor, 0–1 (terrain occultation). */
  fracNow: number;
  /** Projection (incidence) factor of the array for its mount at the cursor elevation, 0–1. */
  incidenceNow: number;
  /** Array output at the cursor and its peak in the window, W. */
  powerNowW: number;
  powerPeakW: number;
}

/** Elevation KPI of a result at a mission time (hours). */
export function solarElevationKpi(r: ScenarioResult, atHours: number): SolarElevationKpi {
  const i0 = Math.max(0, Math.min(r.count - 1, Math.round(atHours / r.stepHours)));
  let elMax = -90, elMaxI = 0, sum = 0, nLit = 0, peak = 0;
  for (let i = 0; i < r.count; i++) {
    const el = r.sunEl[i];
    if (el > elMax) { elMax = el; elMaxI = i; }
    if (r.sunFrac[i] > 0) { sum += el; nLit++; }
    if (r.powerW[i] > peak) peak = r.powerW[i];
  }
  const elNow = r.sunEl[i0];
  return {
    elNowDeg: elNow,
    elMaxDeg: elMax,
    elMaxAtH: elMaxI * r.stepHours,
    elMeanLitDeg: nLit ? sum / nLit : Number.NaN,
    fracNow: r.sunFrac[i0],
    incidenceNow: mountProjectionFactor(r.input.power.mount, elNow),
    powerNowW: r.powerW[i0],
    powerPeakW: peak,
  };
}
