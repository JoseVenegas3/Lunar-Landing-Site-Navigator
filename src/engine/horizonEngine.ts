/**
 * 360-degree topographic horizon profiles and the visibility tests built on them.
 *
 * For each whole degree of azimuth a ray is marched outward over the nested DEM
 * and the largest apparent elevation of the terrain is kept. Apparent elevation
 * uses exact spherical geometry, so the lunar curvature (2.9 km of drop at
 * 100 km) is accounted for: for an observer at radius Ro and a terrain point at
 * radius Rt separated by the central angle g = d / R,
 *
 *   tan(elev) = (Rt cos g - Ro) / (Rt sin g)
 *
 * Solar visibility    : fraction of the solar disc above the horizon line.
 * DTE line of sight   : Earth centre above the horizon plus an antenna margin.
 */
import { DEG, RAD, R_MOON_KM, wrap360 } from './constants';
import { DemStack, demHeight, gridContains, localAxes, xyToLatLon } from './terrain';

export const AZ_COUNT = 360;
export const MAX_RANGE_KM = 250;
/** Beyond this range the fine march hands over to the coarse schedule. */
const FINE_RANGE_KM = 9;

/** Radial sampling schedule shared by all azimuths: distance, cos and sin of d/R. */
const SCHEDULE = (() => {
  const d: number[] = [];
  let r = 0.02;
  while (r < MAX_RANGE_KM) {
    d.push(r);
    r += r < FINE_RANGE_KM ? Math.max(0.016, r * 0.02) : Math.max(0.3, r * 0.02);
  }
  const dist = Float64Array.from(d);
  return {
    dist,
    cos: dist.map((v) => Math.cos(v / R_MOON_KM)),
    sin: dist.map((v) => Math.sin(v / R_MOON_KM)),
  };
})();

export interface Observer {
  /** Map position, km. */
  x: number;
  y: number;
  latDeg: number;
  lonDeg: number;
  /** Terrain height under the lander, km above datum. */
  groundKm: number;
  /** Height of the sensor (solar array / antenna phase centre), km above datum. */
  heightKm: number;
}

export interface HorizonProfile {
  observer: Observer;
  /** Horizon elevation per whole degree of azimuth, deg. */
  elevDeg: Float32Array;
  /** Range of the terrain point that defines the horizon, km. */
  distKm: Float32Array;
  /** Horizon produced only by terrain outside the local grid (used by the 3-D shadow sweep). */
  farElevDeg: Float32Array;
  farDistKm: Float32Array;
}

export function makeObserver(dem: DemStack, x: number, y: number, mastM = 2): Observer {
  const ll = xyToLatLon(x, y);
  const groundKm = demHeight(dem, x, y);
  return { x, y, latDeg: ll.latDeg, lonDeg: ll.lonDeg, groundKm, heightKm: groundKm + mastM / 1000 };
}

/** Map-frame unit vector for an azimuth (deg east of north) at the observer. */
export function azimuthToMap(lonDeg: number, azDeg: number): [number, number] {
  const ax = localAxes(lonDeg);
  const a = azDeg * DEG;
  const c = Math.cos(a), s = Math.sin(a);
  return [ax.nx * c + ax.ex * s, ax.ny * c + ax.ey * s];
}

export function computeHorizon(dem: DemStack, obs: Observer): HorizonProfile {
  const elevDeg = new Float32Array(AZ_COUNT);
  const distKm = new Float32Array(AZ_COUNT);
  const farElevDeg = new Float32Array(AZ_COUNT);
  const farDistKm = new Float32Array(AZ_COUNT);
  const ro = R_MOON_KM + obs.heightKm;
  const { dist, cos, sin } = SCHEDULE;
  const steps = dist.length;

  // Grid sampling is inlined: this loop runs ~120 000 times per profile and is
  // on the interactive path of the micro-relocation tool.
  const rg = dem.regional;
  const rN = rg.n, rD = rg.data, rInv = 1 / rg.spacingKm, rX0 = rg.x0, rY0 = rg.y0, rMax = rN - 1.000001;
  const lg = dem.local;
  const lN = lg ? lg.n : 0, lD = lg ? lg.data : rD, lInv = lg ? 1 / lg.spacingKm : 0;
  const lX0 = lg ? lg.x0 : 0, lY0 = lg ? lg.y0 : 0, lMax = lN - 1.000001;
  const ax = localAxes(obs.lonDeg);

  for (let a = 0; a < AZ_COUNT; a++) {
    const ar = a * DEG;
    const ca = Math.cos(ar), sa = Math.sin(ar);
    const ux = ax.nx * ca + ax.ex * sa, uy = ax.ny * ca + ax.ey * sa;
    let best = -Infinity, bestD = 0, far = -Infinity, farD = MAX_RANGE_KM;
    let inLocal = lg !== null;
    for (let s = 0; s < steps; s++) {
      const d = dist[s];
      const x = obs.x + ux * d, y = obs.y + uy * d;
      let h: number;
      if (inLocal) {
        const fx = (x - lX0) * lInv, fy = (y - lY0) * lInv;
        if (fx >= 0 && fy >= 0 && fx <= lMax && fy <= lMax) {
          const i = fx | 0, j = fy | 0, k = j * lN + i;
          const tx = fx - i, ty = fy - j;
          const p = lD[k] + (lD[k + 1] - lD[k]) * tx;
          const q = lD[k + lN] + (lD[k + lN + 1] - lD[k + lN]) * tx;
          h = p + (q - p) * ty;
        } else {
          // A straight ray that has left the (convex) local grid never re-enters it.
          inLocal = false;
          s--;
          continue;
        }
      } else {
        const fx = (x - rX0) * rInv, fy = (y - rY0) * rInv;
        if (fx < 0 || fy < 0 || fx > rMax || fy > rMax) break;
        const i = fx | 0, j = fy | 0, k = j * rN + i;
        const tx = fx - i, ty = fy - j;
        const p = rD[k] + (rD[k + 1] - rD[k]) * tx;
        const q = rD[k + rN] + (rD[k + rN + 1] - rD[k + rN]) * tx;
        h = p + (q - p) * ty;
      }
      const rt = R_MOON_KM + h;
      const t = (rt * cos[s] - ro) / (rt * sin[s]);
      if (t > best) { best = t; bestD = d; }
      if (!inLocal && t > far) { far = t; farD = d; }
    }
    elevDeg[a] = Math.atan(best) * RAD;
    distKm[a] = bestD;
    farElevDeg[a] = far === -Infinity ? -90 : Math.atan(far) * RAD;
    farDistKm[a] = farD;
  }
  return { observer: obs, elevDeg, distKm, farElevDeg, farDistKm };
}

function interp(arr: Float32Array, azDeg: number): number {
  const a = wrap360(azDeg);
  const i = Math.floor(a) % AZ_COUNT;
  const t = a - Math.floor(a);
  const j = (i + 1) % AZ_COUNT;
  return arr[i] + (arr[j] - arr[i]) * t;
}

/** Horizon elevation (deg) at an arbitrary azimuth, linear between whole degrees. */
export const horizonAt = (p: HorizonProfile, azDeg: number): number => interp(p.elevDeg, azDeg);
export const horizonDistAt = (p: HorizonProfile, azDeg: number): number => p.distKm[Math.round(wrap360(azDeg)) % AZ_COUNT];
export const farHorizonAt = (p: HorizonProfile, azDeg: number): number => interp(p.farElevDeg, azDeg);
export const farHorizonDistAt = (p: HorizonProfile, azDeg: number): number => p.farDistKm[Math.round(wrap360(azDeg)) % AZ_COUNT];

const DISC_STRIPS = 9;

/**
 * Fraction (0..1) of the solar disc area above the horizon. The disc is cut in
 * vertical strips; each strip is clipped by the horizon elevation at its own
 * azimuth, so a ragged skyline (a notch between two peaks) is handled.
 */
export function solarDiscFraction(p: HorizonProfile, azDeg: number, elDeg: number, radiusDeg: number): number {
  const centre = horizonAt(p, azDeg);
  // Fast paths: the horizon moves by well under 2 deg across the disc.
  if (elDeg - radiusDeg > centre + 2) return 1;
  if (elDeg + radiusDeg < centre - 2) return 0;
  const azScale = 1 / Math.max(0.05, Math.cos(elDeg * DEG));
  let visible = 0, total = 0;
  for (let k = 0; k < DISC_STRIPS; k++) {
    const xk = (-1 + (2 * k + 1) / DISC_STRIPS) * radiusDeg;
    const half = Math.sqrt(radiusDeg * radiusDeg - xk * xk);
    const h = horizonAt(p, azDeg + xk * azScale);
    const top = elDeg + half, bottom = elDeg - half;
    const seen = top <= h ? 0 : bottom >= h ? 2 * half : top - h;
    visible += seen;
    total += 2 * half;
  }
  return visible / total;
}

/**
 * DTE clearance (deg): Earth elevation minus the horizon minus the antenna
 * margin. Positive means the radio line of sight is open.
 */
export function earthClearanceDeg(p: HorizonProfile, azDeg: number, elDeg: number, marginDeg: number): number {
  return elDeg - horizonAt(p, azDeg) - marginDeg;
}

/**
 * Range (km) at which a ray leaving the observer at (az, el) first meets the
 * terrain, or null when the ray clears everything out to MAX_RANGE_KM.
 */
export function rayHitDistance(dem: DemStack, obs: Observer, azDeg: number, elDeg: number): number | null {
  const [ux, uy] = azimuthToMap(obs.lonDeg, azDeg);
  const ro = R_MOON_KM + obs.heightKm;
  const tanEl = Math.tan(elDeg * DEG);
  const { dist, cos, sin } = SCHEDULE;
  for (let s = 0; s < dist.length; s++) {
    const d = dist[s];
    const x = obs.x + ux * d, y = obs.y + uy * d;
    if (!gridContains(dem.regional, x, y)) return null;
    const rt = R_MOON_KM + demHeight(dem, x, y);
    if ((rt * cos[s] - ro) / (rt * sin[s]) > tanEl) return d;
  }
  return null;
}

/**
 * Sky view factor of a horizontal surface at the observer: the share of its
 * hemisphere that is open sky rather than terrain,
 *   F = (1 / 2 pi) * integral of cos^2(H(phi)) dphi,
 * with H the horizon elevation (negative horizons count as fully open).
 * A flat plain gives 1; a uniform 30 deg wall all around gives 0.75.
 */
export function skyViewFactor(p: HorizonProfile): number {
  let sum = 0;
  for (let a = 0; a < AZ_COUNT; a++) {
    const c = Math.cos(Math.max(0, p.elevDeg[a]) * DEG);
    sum += c * c;
  }
  return sum / AZ_COUNT;
}

/** Terrain along one azimuth as the observer sees it: range and tangent of the elevation angle of each sample. */
export interface TerrainProfile { distM: Float32Array; tanElev: Float32Array }

/**
 * Profile of the terrain in azimuth `azDeg` on the horizon sampling schedule,
 * out to the edge of the regional grid. Used for multiple-edge diffraction.
 */
export function terrainProfile(dem: DemStack, obs: Observer, azDeg: number): TerrainProfile {
  const [ux, uy] = azimuthToMap(obs.lonDeg, azDeg);
  const ro = R_MOON_KM + obs.heightKm;
  const { dist, cos, sin } = SCHEDULE;
  const d: number[] = [], tan: number[] = [];
  for (let s = 0; s < dist.length; s++) {
    const x = obs.x + ux * dist[s], y = obs.y + uy * dist[s];
    if (!gridContains(dem.regional, x, y)) break;
    const rt = R_MOON_KM + demHeight(dem, x, y);
    d.push(dist[s] * 1000);
    tan.push((rt * cos[s] - ro) / (rt * sin[s]));
  }
  return { distM: Float32Array.from(d), tanElev: Float32Array.from(tan) };
}
