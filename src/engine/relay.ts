/**
 * Lunar relay satellites and constellations.
 *
 * A relay is a satellite in orbit around the Moon that forwards the lander's
 * signal to the Earth while the direct line of sight is closed. This module
 * propagates Keplerian orbits, expresses them in the rotating selenographic
 * frame and tests each satellite against the same 360-degree terrain horizon
 * used for the Sun and the Earth.
 *
 * Model and its limits:
 *  - Two-body motion with constant elements. Real lunar orbits are perturbed by
 *    the Earth and by the lunar gravity field; "frozen" orbits are designed so
 *    that eccentricity, inclination and argument of periapsis stay nearly
 *    constant, which is what this model assumes. The node drifts in reality and
 *    does not here, so results describe typical coverage over weeks, not the
 *    pass times of a specific spacecraft.
 *  - Elements are referred to the lunar equator. The frame is inertial with its
 *    z axis on the lunar spin axis and its x axis on the prime meridian at
 *    RELAY_EPOCH_MS; the Moon then turns under the orbit at its sidereal rate.
 *    The 18.6-year precession of the lunar pole is ignored.
 *  - A relay counts only when it is above the terrain (plus the antenna margin)
 *    AND has the Earth in view, i.e. the lunar sphere does not block the
 *    relay-to-Earth line. Store-and-forward is not modelled.
 */
import { DEG, HOUR_MS, RAD, R_MOON_KM, wrap360 } from './constants';
import { SiteFrame } from './ephemeris';
import { HorizonProfile, horizonAt } from './horizonEngine';

/** Lunar gravitational parameter, km^3 / s^2. */
export const MU_MOON = 4902.800066;
/** Sidereal rotation period of the Moon, seconds. */
export const MOON_SIDEREAL_S = 27.321661 * 86400;
const MOON_RATE = (2 * Math.PI) / MOON_SIDEREAL_S;
/** Reference epoch of the orbit elements. */
export const RELAY_EPOCH_MS = Date.UTC(2027, 0, 1);
/** Lowest periapsis accepted, km above the mean sphere (clears the highest relief). */
export const MIN_PERIAPSIS_ALT_KM = 20;

export interface OrbitElements {
  /** Semi-major axis, km. */
  aKm: number;
  e: number;
  /** Inclination to the lunar equator, deg. */
  incDeg: number;
  /** Argument of periapsis, deg. 90 puts the apoapsis over the southern hemisphere. */
  argPeriDeg: number;
  /** Longitude of the ascending node at RELAY_EPOCH_MS, deg from the prime meridian. */
  raanDeg: number;
  /** Mean anomaly at RELAY_EPOCH_MS, deg. */
  meanAnomalyDeg: number;
}

export type RelayPresetId = 'elfo' | 'polar' | 'custom';

export interface RelayOrbitShape { aKm: number; e: number; incDeg: number; argPeriDeg: number }

export interface RelayPreset { id: RelayPresetId; name: { en: string; es: string }; shape: RelayOrbitShape }

export const RELAY_PRESETS: RelayPreset[] = [
  {
    // Elliptical lunar frozen orbit with a southern apoapsis. Generic elements, not those of any flown mission:
    // 10.8 h period, apoapsis ~7300 km above the southern hemisphere.
    id: 'elfo',
    name: { en: 'Elliptical frozen orbit (south apoapsis)', es: 'Órbita elíptica congelada (apoapsis sur)' },
    shape: { aKm: 5740, e: 0.58, incDeg: 54.856, argPeriDeg: 86.322 },
  },
  {
    // Low circular polar orbit of the mapping-orbiter class: short, frequent passes.
    id: 'polar',
    name: { en: 'Low polar circular orbit, 100 km', es: 'Órbita polar circular baja, 100 km' },
    shape: { aKm: R_MOON_KM + 100, e: 0, incDeg: 90, argPeriDeg: 0 },
  },
];

export interface RelayConfig {
  enabled: boolean;
  preset: RelayPresetId;
  /** Number of satellites, 1..8. */
  count: number;
  /** Orbital planes the satellites are spread over, 1..count. */
  planes: number;
  /** Orbit used when `preset` is 'custom'. */
  custom: RelayOrbitShape;
  /** Information rate of the lander-to-relay proximity link, Mbit/s. */
  rateMbps: number;
}

export const DEFAULT_RELAY: RelayConfig = {
  enabled: false,
  preset: 'elfo',
  count: 2,
  planes: 1,
  custom: { aKm: 4000, e: 0.4, incDeg: 75, argPeriDeg: 90 },
  rateMbps: 2,
};

export const MAX_RELAYS = 8;

/** Orbit shape of a configuration, with the eccentricity limited so the periapsis clears the surface. */
export function relayShape(cfg: RelayConfig): RelayOrbitShape {
  const base = cfg.preset === 'custom' ? cfg.custom : (RELAY_PRESETS.find((p) => p.id === cfg.preset) ?? RELAY_PRESETS[0]).shape;
  const aKm = Math.max(R_MOON_KM + MIN_PERIAPSIS_ALT_KM, base.aKm);
  const eMax = 1 - (R_MOON_KM + MIN_PERIAPSIS_ALT_KM) / aKm;
  return { aKm, e: Math.min(Math.max(0, base.e), Math.max(0, eMax)), incDeg: base.incDeg, argPeriDeg: base.argPeriDeg };
}

/**
 * Elements of every satellite of a constellation: satellites are spread evenly
 * in mean anomaly, planes evenly in node, with a relative phasing between
 * planes so that the satellites do not cross the pole together.
 */
export function constellation(cfg: RelayConfig): OrbitElements[] {
  const shape = relayShape(cfg);
  const count = Math.min(MAX_RELAYS, Math.max(1, Math.round(cfg.count)));
  const planes = Math.min(count, Math.max(1, Math.round(cfg.planes)));
  const sats: OrbitElements[] = [];
  for (let k = 0; k < count; k++) {
    const plane = k % planes;
    const slot = Math.floor(k / planes);
    const perPlane = Math.ceil(count / planes);
    sats.push({
      ...shape,
      raanDeg: (360 * plane) / planes,
      meanAnomalyDeg: wrap360((360 * slot) / perPlane + (360 * plane) / count),
    });
  }
  return sats;
}

export const orbitalPeriodS = (aKm: number): number => 2 * Math.PI * Math.sqrt((aKm * aKm * aKm) / MU_MOON);
export const periapsisAltKm = (s: RelayOrbitShape): number => s.aKm * (1 - s.e) - R_MOON_KM;
export const apoapsisAltKm = (s: RelayOrbitShape): number => s.aKm * (1 + s.e) - R_MOON_KM;

/** Eccentric anomaly from mean anomaly (radians), Newton iteration. */
export function solveKepler(meanAnomaly: number, e: number): number {
  let m = meanAnomaly % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  else if (m < -Math.PI) m += 2 * Math.PI;
  let ecc = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let k = 0; k < 12; k++) {
    const d = (ecc - e * Math.sin(ecc) - m) / (1 - e * Math.cos(ecc));
    ecc -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return ecc;
}

/** Satellite position in the selenographic (rotating) frame, km. Writes into `out`. */
export function relayPosition(el: OrbitElements, timeMs: number, out: Float64Array): Float64Array {
  const dt = (timeMs - RELAY_EPOCH_MS) / 1000;
  const n = Math.sqrt(MU_MOON / (el.aKm * el.aKm * el.aKm));
  const ecc = solveKepler(el.meanAnomalyDeg * DEG + n * dt, el.e);
  // Perifocal coordinates.
  const xp = el.aKm * (Math.cos(ecc) - el.e);
  const yp = el.aKm * Math.sqrt(1 - el.e * el.e) * Math.sin(ecc);
  const w = el.argPeriDeg * DEG, inc = el.incDeg * DEG;
  // The node is fixed in inertial space, so in the rotating frame it regresses at the lunar spin rate.
  const node = el.raanDeg * DEG - MOON_RATE * dt;
  const cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(inc), si = Math.sin(inc), co = Math.cos(node), so = Math.sin(node);
  const xo = xp * cw - yp * sw;
  const yo = xp * sw + yp * cw;
  out[0] = xo * co - yo * ci * so;
  out[1] = xo * so + yo * ci * co;
  out[2] = yo * si;
  return out;
}

/** True when the straight line from `p` to the Earth (both Moon-centred, km) misses the lunar sphere. */
export function seesEarth(p: ArrayLike<number>, ex: number, ey: number, ez: number): boolean {
  const dx = ex - p[0], dy = ey - p[1], dz = ez - p[2];
  const t = -(p[0] * dx + p[1] * dy + p[2] * dz) / (dx * dx + dy * dy + dz * dz);
  if (t <= 0 || t >= 1) return true;
  const cx = p[0] + dx * t, cy = p[1] + dy * t, cz = p[2] + dz * t;
  return cx * cx + cy * cy + cz * cz > R_MOON_KM * R_MOON_KM;
}

export interface RelayView {
  azDeg: number;
  elDeg: number;
  rangeKm: number;
  /** Elevation above the terrain horizon minus the antenna margin, deg. */
  clearanceDeg: number;
  /** The relay itself has the Earth in view. */
  earthInView: boolean;
  /** Usable for relaying right now. */
  usable: boolean;
}

const scratch = new Float64Array(3);

/** Where one relay is in the lander's sky at `timeMs`, and whether it can relay. */
export function relayView(
  el: OrbitElements, timeMs: number, frame: SiteFrame, horizon: HorizonProfile, marginDeg: number,
  earthX: number, earthY: number, earthZ: number,
): RelayView {
  const p = relayPosition(el, timeMs, scratch);
  const dx = p[0] - frame.px, dy = p[1] - frame.py, dz = p[2] - frame.pz;
  const range = Math.hypot(dx, dy, dz);
  const e = dx * frame.ex + dy * frame.ey + dz * frame.ez;
  const n = dx * frame.nx + dy * frame.ny + dz * frame.nz;
  const u = dx * frame.ux + dy * frame.uy + dz * frame.uz;
  const azDeg = wrap360(Math.atan2(e, n) * RAD);
  const elDeg = Math.asin(Math.max(-1, Math.min(1, u / range))) * RAD;
  const clearanceDeg = elDeg - horizonAt(horizon, azDeg) - marginDeg;
  const earthInView = seesEarth(p, earthX, earthY, earthZ);
  return { azDeg, elDeg, rangeKm: range, clearanceDeg, earthInView, usable: clearanceDeg > 0 && earthInView };
}

/** Samples per hour used to resolve short passes inside an hourly analysis step. */
export const RELAY_SUBSTEPS = 12;

/**
 * Fraction (0..1) of the interval [timeMs, timeMs + stepHours) during which at
 * least one satellite of `sats` can relay. Allocation-free: it runs for every
 * sample of a scenario.
 */
export function relayCoverageFraction(
  sats: OrbitElements[], timeMs: number, stepHours: number, frame: SiteFrame, horizon: HorizonProfile, marginDeg: number,
  earthX: number, earthY: number, earthZ: number,
): number {
  const sub = Math.max(1, Math.round(RELAY_SUBSTEPS * stepHours));
  let covered = 0;
  for (let s = 0; s < sub; s++) {
    const t = timeMs + ((s + 0.5) / sub) * stepHours * HOUR_MS;
    for (let k = 0; k < sats.length; k++) {
      const p = relayPosition(sats[k], t, scratch);
      const dx = p[0] - frame.px, dy = p[1] - frame.py, dz = p[2] - frame.pz;
      const u = dx * frame.ux + dy * frame.uy + dz * frame.uz;
      const range = Math.hypot(dx, dy, dz);
      // Cheap rejection: more than 8 deg below the horizontal, deeper than any terrain dip.
      if (u < -0.14 * range) continue;
      const e = dx * frame.ex + dy * frame.ey + dz * frame.ez;
      const n = dx * frame.nx + dy * frame.ny + dz * frame.nz;
      const elDeg = Math.asin(Math.max(-1, Math.min(1, u / range))) * RAD;
      const azDeg = wrap360(Math.atan2(e, n) * RAD);
      if (elDeg - horizonAt(horizon, azDeg) - marginDeg <= 0) continue;
      if (!seesEarth(p, earthX, earthY, earthZ)) continue;
      covered++;
      break;
    }
  }
  return covered / sub;
}

/** Selenographic latitude / longitude under a satellite, deg. */
export function subSatellitePoint(el: OrbitElements, timeMs: number): { latDeg: number; lonDeg: number; altKm: number } {
  const p = relayPosition(el, timeMs, scratch);
  const r = Math.hypot(p[0], p[1], p[2]);
  return { latDeg: Math.asin(p[2] / r) * RAD, lonDeg: Math.atan2(p[1], p[0]) * RAD, altKm: r - R_MOON_KM };
}
