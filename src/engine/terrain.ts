/**
 * Synthetic digital elevation model of the lunar south polar region.
 *
 * This is NOT the LOLA gridded product. It is an analytic height field
 * h(x, y) built from the published geometry of the real south-polar landforms
 * (crater centres, diameters, depths, massif heights from LOLA-era literature)
 * plus fractal roughness and a deterministic population of small craters. It is
 * rasterised into two nested grids:
 *
 *   regional  1001 x 1001 samples, 800 m spacing, +-400 km around the pole
 *   local      513 x 513 samples,  32 m spacing, +-8.2 km around a landing site
 *
 * Because every site samples the same continuous function, custom coordinates
 * and +-500 m micro-relocations are evaluated on consistent terrain.
 *
 * Map frame: azimuthal-equidistant projection centred on the south pole.
 *   r = R * colatitude, x = r sin(lon), y = r cos(lon)   [km]
 * so longitude 0 (the Earth-facing meridian) points to +y and 90 E to +x, the
 * same orientation as the standard LOLA south-pole maps. Heights are km above
 * the 1737.4 km reference sphere.
 *
 * `loadExternalGrid` accepts a real LOLA raster in the same Grid layout, so the
 * synthetic model can be replaced without touching the rest of the engine.
 */
import { DEG, RAD, R_MOON_KM } from './constants';

export interface Grid {
  /** Samples per side. */
  n: number;
  spacingKm: number;
  /** Map coordinates of sample (0, 0). */
  x0: number;
  y0: number;
  /** Row-major heights, km. Index = j * n + i with i along +x and j along +y. */
  data: Float32Array;
}

export interface LatLon { latDeg: number; lonDeg: number }

export function latLonToXY(latDeg: number, lonDeg: number): [number, number] {
  const r = R_MOON_KM * (90 + latDeg) * DEG;
  const lon = lonDeg * DEG;
  return [r * Math.sin(lon), r * Math.cos(lon)];
}

export function xyToLatLon(x: number, y: number): LatLon {
  const r = Math.hypot(x, y);
  return { latDeg: -90 + (r / R_MOON_KM) * RAD, lonDeg: r < 1e-9 ? 0 : Math.atan2(x, y) * RAD };
}

/** Unit north and east vectors (map frame) for a point at longitude `lonDeg`. */
export function localAxes(lonDeg: number): { nx: number; ny: number; ex: number; ey: number } {
  const lon = lonDeg * DEG;
  const s = Math.sin(lon), c = Math.cos(lon);
  return { nx: s, ny: c, ex: c, ey: -s };
}

// ---------------------------------------------------------------- noise

function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const S2 = Math.SQRT1_2;
const GRAD_X = [1, S2, 0, -S2, -1, -S2, 0, S2];
const GRAD_Y = [0, S2, 1, S2, 0, -S2, -1, -S2];

/** 2-D gradient noise, roughly in [-1, 1]. */
function gradientNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g00 = hash(ix, iy, seed) & 7, g10 = hash(ix + 1, iy, seed) & 7;
  const g01 = hash(ix, iy + 1, seed) & 7, g11 = hash(ix + 1, iy + 1, seed) & 7;
  const n00 = GRAD_X[g00] * fx + GRAD_Y[g00] * fy;
  const n10 = GRAD_X[g10] * (fx - 1) + GRAD_Y[g10] * fy;
  const n01 = GRAD_X[g01] * fx + GRAD_Y[g01] * (fy - 1);
  const n11 = GRAD_X[g11] * (fx - 1) + GRAD_Y[g11] * (fy - 1);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.6;
}

function fbm(x: number, y: number, octaves: number, gain: number, seed: number): number {
  let sum = 0, amp = 1, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradientNoise(x * f, y * f, seed + o * 131);
    f *= 2.03;
    amp *= gain;
  }
  return sum;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------- landforms

/**
 * Radial crater profile. `rho` is distance / rim radius. Inside: flat floor of
 * fractional radius `floorFrac`, then a wall rising to the rim crest. Outside:
 * ejecta blanket decaying as rho^-3 and windowed to zero by 3.2 radii.
 * Returns height (km) relative to the pre-impact surface.
 */
function craterProfile(rho: number, depthKm: number, rimKm: number, floorFrac: number): number {
  if (rho >= 1) {
    if (rho >= 3.2) return 0;
    return (rimKm / (rho * rho * rho)) * (1 - smoothstep(2.2, 3.2, rho));
  }
  const t = rho <= floorFrac ? 0 : (rho - floorFrac) / (1 - floorFrac);
  return rimKm - depthKm * (1 - Math.pow(t, 1.3));
}

interface CraterDef {
  name: string;
  lat: number;
  lon: number;
  /** Rim-to-rim diameter, km. */
  d: number;
  /** Rim-crest-to-floor depth, km. */
  depth: number;
  /** Rim height above surroundings, km. */
  rim: number;
  /** Calibration anchor: the radius is set so the rim crest passes through this point. */
  rimThrough?: LatLon;
}

/**
 * Named craters. Centres and diameters follow the IAU Gazetteer / LOLA-era
 * literature to ~1 km; depths are rounded published values, reduced for the
 * strongly degraded pre-Nectarian basins. The radius of de Gerlache is adjusted
 * so that its rim crest passes through candidate site 5, and the Haworth radius
 * is tied to candidate site 3 on its south rim (see ARCHITECTURE.md,
 * "Anclas de calibracion").
 */
const CRATERS: CraterDef[] = [
  { name: 'Shackleton', lat: -89.67, lon: 129.78, d: 21.0, depth: 4.2, rim: 0.95 },
  { name: 'de Gerlache', lat: -88.5, lon: -87.1, d: 29.8, depth: 2.6, rim: 0.75, rimThrough: { latDeg: -88.71, lonDeg: -68.7 } }, // IAU D = 32.4 km
  { name: 'Haworth', lat: -87.45, lon: -5.17, d: 51.4, depth: 3.4, rim: 0.9, rimThrough: { latDeg: -88.3, lonDeg: -5.17 } }, // IAU centre; south rim crest through site 3
  { name: 'Shoemaker', lat: -88.1, lon: 44.9, d: 51.8, depth: 3.6, rim: 0.8 },
  { name: 'Faustini', lat: -87.3, lon: 77.0, d: 39.0, depth: 3.0, rim: 0.7 },
  { name: 'Sverdrup', lat: -88.5, lon: -152.0, d: 35.0, depth: 2.6, rim: 0.6 },
  { name: 'Slater', lat: -88.08, lon: 111.3, d: 25.0, depth: 2.4, rim: 0.5 },
  { name: 'Nobile', lat: -85.2, lon: 53.5, d: 73.0, depth: 3.9, rim: 0.9 },
  { name: 'Malapert', lat: -84.9, lon: 12.9, d: 69.0, depth: 2.4, rim: 0.5 },
  { name: 'Cabeus', lat: -84.9, lon: -35.5, d: 98.0, depth: 4.0, rim: 0.9 },
  { name: 'Amundsen', lat: -84.5, lon: 82.8, d: 101.0, depth: 4.8, rim: 1.1 },
  { name: 'Scott', lat: -82.1, lon: 48.5, d: 103.0, depth: 3.2, rim: 0.7 },
  { name: 'Wiechert', lat: -84.5, lon: 165.0, d: 41.0, depth: 2.6, rim: 0.6 },
  { name: "Idel'son L", lat: -84.2, lon: 115.8, d: 28.0, depth: 2.4, rim: 0.5 },
  { name: 'Kocher', lat: -84.5, lon: -134.0, d: 24.0, depth: 2.3, rim: 0.5 },
  { name: 'Ibn Bajja', lat: -86.3, lon: -72.7, d: 12.0, depth: 2.0, rim: 0.4 },
  { name: "Nefed'ev", lat: -81.1, lon: -135.5, d: 56.0, depth: 3.0, rim: 0.7 },
  { name: 'Hedervari', lat: -81.8, lon: 84.0, d: 69.0, depth: 3.2, rim: 0.7 },
  { name: 'Cabeus B', lat: -82.3, lon: -54.0, d: 61.0, depth: 3.0, rim: 0.7 },
  { name: 'Ashbrook', lat: -81.4, lon: -112.5, d: 156.0, depth: 3.0, rim: 0.7 },
  { name: 'Drygalski', lat: -79.3, lon: -84.9, d: 149.0, depth: 4.0, rim: 1.0 },
  { name: 'Ganswindt', lat: -79.6, lon: 110.3, d: 74.0, depth: 3.4, rim: 0.8 },
  { name: 'Schomberger', lat: -76.7, lon: 24.9, d: 85.0, depth: 4.2, rim: 1.0 },
  { name: 'Newton', lat: -76.7, lon: -16.9, d: 79.0, depth: 5.0, rim: 1.1 },
  { name: 'Wiechert J', lat: -85.6, lon: 177.0, d: 35.0, depth: 2.4, rim: 0.5 },
  { name: 'Unnamed infill crater (synthetic)', lat: -89.25, lon: 165.0, d: 9.0, depth: 1.3, rim: 0.25 },
];

interface MassifDef {
  name: string;
  lat: number;
  lon: number;
  heightKm: number;
  /** 1-sigma half-widths along and across the major axis, km. */
  major: number;
  minor: number;
  /** Azimuth of the major axis, degrees east of local north at the massif. */
  orientDeg: number;
  /** 2 = Gaussian, larger = flat-topped mesa. */
  power: number;
}

const MASSIFS: MassifDef[] = [
  // Malapert Massif: ~5 km summit ridge elongated east-west, facing the Earth.
  { name: 'Malapert Massif', lat: -86.04, lon: 2.7, heightKm: 4.6, major: 24, minor: 8.5, orientDeg: 90, power: 2 },
  // Mons Mouton (Leibnitz beta): broad flat-topped mesa, ~6 km above datum.
  { name: 'Mons Mouton', lat: -84.8, lon: 31.0, heightKm: 5.6, major: 40, minor: 30, orientDeg: 90, power: 4 },
  { name: 'Leibnitz west', lat: -83.6, lon: -22.0, heightKm: 3.6, major: 34, minor: 18, orientDeg: 70, power: 2 },
  { name: 'Leibnitz north', lat: -82.4, lon: 6.0, heightKm: 3.2, major: 38, minor: 20, orientDeg: 95, power: 2 },
  { name: 'Shackleton-Slater highland', lat: -89.0, lon: 105.0, heightKm: 0.7, major: 14, minor: 9, orientDeg: 40, power: 2 },
];

interface RidgeDef {
  name: string;
  /** Polyline in map km. */
  pts: [number, number][];
  heightKm: number;
  sigmaKm: number;
}

interface KnobDef { x: number; y: number; heightKm: number; sigmaKm: number }

/**
 * Anchor points of the synthetic model: the designed landforms (crest, summit,
 * rim) pass through them. They are the coordinates of the original challenge
 * brief, except the third, which sits on the synthetic Haworth rim. The
 * application's landing points on real LOLA terrain are in sites.ts.
 */
export const ANCHOR_SITES: LatLon[] = [
  { latDeg: -89.54, lonDeg: -129.78 },
  { latDeg: -86.04, lonDeg: 2.7 },
  { latDeg: -88.3, lonDeg: -5.17 },
  { latDeg: -85.2, lonDeg: 31.3 },
  { latDeg: -88.71, lonDeg: -68.7 },
];
const ANCHORS_XY = ANCHOR_SITES.map((s) => latLonToXY(s.latDeg, s.lonDeg));
const PAD_RADIUS_KM = 0.25;

const [RIDGE_SITE_X, RIDGE_SITE_Y] = ANCHORS_XY[0];

const RIDGES: RidgeDef[] = [
  {
    // Shackleton - de Gerlache connecting ridge, routed through candidate site 1.
    name: 'Connecting Ridge',
    pts: [[-2.7, -7.8], [RIDGE_SITE_X, RIDGE_SITE_Y], [-21.0, -6.2], [-31.2, -2.3]],
    heightKm: 0.95,
    sigmaKm: 1.5,
  },
];

const KNOBS: KnobDef[] = [
  // Local crest high point under candidate site 1: a narrow summit, so a few
  // hundred metres of displacement drops the lander below the ridge line.
  { x: RIDGE_SITE_X, y: RIDGE_SITE_Y, heightKm: 0.08, sigmaKm: 0.6 },
  // Summit knoll of Malapert Massif under candidate site 2.
  { x: ANCHORS_XY[1][0], y: ANCHORS_XY[1][1], heightKm: 0.15, sigmaKm: 0.5 },
];

interface CompiledCrater { cx: number; cy: number; r: number; reach2: number; depth: number; rim: number; floor: number; peak: number }
const COMPILED_CRATERS: CompiledCrater[] = CRATERS.map((c) => {
  const [cx, cy] = latLonToXY(c.lat, c.lon);
  let r = c.d / 2;
  if (c.rimThrough) {
    const [ax, ay] = latLonToXY(c.rimThrough.latDeg, c.rimThrough.lonDeg);
    r = Math.hypot(ax - cx, ay - cy);
  }
  return {
    cx, cy, r,
    reach2: (3.2 * r) * (3.2 * r),
    depth: c.depth,
    rim: c.rim,
    floor: c.d < 15 ? 0 : c.d < 40 ? 0.3 : 0.5,
    peak: c.d >= 60 ? 0.22 * c.depth : 0,
  };
});

interface CompiledMassif { cx: number; cy: number; ax: number; ay: number; h: number; major: number; minor: number; halfPower: number; reach2: number }
const COMPILED_MASSIFS: CompiledMassif[] = MASSIFS.map((m) => {
  const [cx, cy] = latLonToXY(m.lat, m.lon);
  const ax = localAxes(m.lon);
  const o = m.orientDeg * DEG;
  return {
    cx, cy,
    ax: ax.nx * Math.cos(o) + ax.ex * Math.sin(o),
    ay: ax.ny * Math.cos(o) + ax.ey * Math.sin(o),
    h: m.heightKm, major: m.major, minor: m.minor, halfPower: m.power / 2,
    reach2: (m.major * 4) * (m.major * 4),
  };
});

function distanceToPolyline(x: number, y: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
    const vx = bx - ax, vy = by - ay;
    let t = ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + vx * t), dy = y - (ay + vy * t);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/**
 * Deterministic population of unnamed craters: one candidate per cell of a
 * jittered grid. Craters whose bowl would swallow a candidate-site landing pad
 * are skipped, so the calibrated sites stay on their crests.
 */
function hashedCraters(x: number, y: number, cell: number, seed: number, depthRatio: number, rimRatio: number): number {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  let z = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const h = hash(gx + di, gy + dj, seed);
      if ((h & 0xff) > 150) continue;
      const u1 = ((h >>> 8) & 0xff) / 255, u2 = ((h >>> 16) & 0xff) / 255, u3 = (h >>> 24) / 255;
      const r = cell * (0.06 + 0.24 * u3 * u3);
      const cx = (gx + di + 0.15 + 0.7 * u1) * cell, cy = (gy + dj + 0.15 + 0.7 * u2) * cell;
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 10.24 * r * r) continue;
      let skip = false;
      for (let a = 0; a < ANCHORS_XY.length; a++) {
        const ex = ANCHORS_XY[a][0] - cx, ey = ANCHORS_XY[a][1] - cy;
        const lim = 1.7 * r + PAD_RADIUS_KM;
        if (ex * ex + ey * ey < lim * lim) { skip = true; break; }
      }
      if (skip) continue;
      const fresh = 0.3 + 0.7 * (((h >>> 4) & 0xf) / 15);
      z += craterProfile(Math.sqrt(d2) / r, depthRatio * 2 * r * fresh, rimRatio * 2 * r * fresh, 0);
    }
  }
  return z;
}

/**
 * Background relief shared by both detail levels: long-wavelength undulation of
 * the South Pole - Aitken rim highlands, self-affine roughness (Hurst ~0.85)
 * down to ~1.2 km, and two size classes of unnamed degraded craters.
 */
function backgroundRelief(x: number, y: number): number {
  return 1.05 * fbm(x / 260 + 3.1, y / 260 - 1.7, 3, 0.5, 11)
    + 0.42 * fbm(x / 40, y / 40, 6, 0.555, 37)
    + hashedCraters(x, y, 24, 101, 0.16, 0.032) + hashedCraters(x, y, 9, 211, 0.15, 0.028);
}

const LEVEL_SIGMA_KM = 1.2;
const LEVEL_REACH2 = (3.5 * LEVEL_SIGMA_KM) * (3.5 * LEVEL_SIGMA_KM);
const anchorGradientCache: [number, number][] = [];
function anchorGradient(i: number): [number, number] {
  let g = anchorGradientCache[i];
  if (g === undefined) {
    const [ax, ay] = ANCHORS_XY[i];
    const b = 0.05;
    g = [
      (backgroundRelief(ax + b, ay) - backgroundRelief(ax - b, ay)) / (2 * b),
      (backgroundRelief(ax, ay + b) - backgroundRelief(ax, ay - b)) / (2 * b),
    ];
    anchorGradientCache[i] = g;
  }
  return g;
}

/**
 * Structure below ~1 km: the spectrum steepens (Hurst ~1) so that 30 m slopes
 * stay near the 5-8 deg typical of LOLA highland baselines, plus three size
 * classes of small degraded craters.
 */
function fineStructure(x: number, y: number): number {
  return 0.0125 * fbm(x / 0.6, y / 0.6, 4, 0.5, 59)
    + hashedCraters(x, y, 3.5, 307, 0.13, 0.02) + hashedCraters(x, y, 1.3, 401, 0.11, 0.014) + hashedCraters(x, y, 0.5, 503, 0.1, 0.012);
}

const PAD_FADE_KM = 0.6;
const anchorFineCache: number[] = [];
function anchorFine(i: number): number {
  let v = anchorFineCache[i];
  if (v === undefined) {
    v = fineStructure(ANCHORS_XY[i][0], ANCHORS_XY[i][1]);
    anchorFineCache[i] = v;
  }
  return v;
}

/** Detail level: 0 = regional (no structure below ~1.2 km), 1 = full. */
export type DetailLevel = 0 | 1;

/** Analytic terrain height (km above the 1737.4 km sphere) at map point (x, y). */
export function terrainHeight(x: number, y: number, detail: DetailLevel): number {
  let z = backgroundRelief(x, y);

  // Distance to the nearest candidate-site anchor.
  let pad2 = Infinity, nearest = 0;
  for (let a = 0; a < ANCHORS_XY.length; a++) {
    const dx = x - ANCHORS_XY[a][0], dy = y - ANCHORS_XY[a][1];
    const d2 = dx * dx + dy * dy;
    if (d2 < pad2) { pad2 = d2; nearest = a; }
  }
  // Levelling: remove the random tilt of the background under each anchor so
  // the designed landform (crest, rim, summit) decides where the high point is.
  if (pad2 < LEVEL_REACH2) {
    const g = anchorGradient(nearest);
    z -= (g[0] * (x - ANCHORS_XY[nearest][0]) + g[1] * (y - ANCHORS_XY[nearest][1])) * Math.exp(-pad2 / (LEVEL_SIGMA_KM * LEVEL_SIGMA_KM));
  }
  // Below ~1 km the spectrum steepens (Hurst ~1) so that 30 m slopes stay near
  // the 5-8 deg typical of LOLA highland baselines.


  for (let i = 0; i < COMPILED_CRATERS.length; i++) {
    const c = COMPILED_CRATERS[i];
    const dx = x - c.cx, dy = y - c.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= c.reach2) continue;
    const rho = Math.sqrt(d2) / c.r;
    z += craterProfile(rho, c.depth, c.rim, c.floor);
    if (c.peak > 0 && rho < 0.3) z += c.peak * Math.exp(-(rho * rho) / 0.0098);
  }

  for (let i = 0; i < COMPILED_MASSIFS.length; i++) {
    const m = COMPILED_MASSIFS[i];
    const dx = x - m.cx, dy = y - m.cy;
    if (dx * dx + dy * dy >= m.reach2) continue;
    const a = (dx * m.ax + dy * m.ay) / m.major;
    const b = (-dx * m.ay + dy * m.ax) / m.minor;
    z += m.h * Math.exp(-Math.pow(a * a + b * b, m.halfPower));
  }

  for (let i = 0; i < RIDGES.length; i++) {
    const r = RIDGES[i];
    const d = distanceToPolyline(x, y, r.pts) / r.sigmaKm;
    if (d < 4) z += r.heightKm * Math.exp(-d * d);
  }
  for (let i = 0; i < KNOBS.length; i++) {
    const k = KNOBS[i];
    const dx = (x - k.x) / k.sigmaKm, dy = (y - k.y) / k.sigmaKm;
    const d2 = dx * dx + dy * dy;
    if (d2 < 16) z += k.heightKm * Math.exp(-d2);
  }

  if (detail === 1) {
    // Fine structure, kept continuous but faded towards a constant on the landing
    // pads: candidate sites are, by selection, locally smooth.
    const fine = fineStructure(x, y);
    if (pad2 >= PAD_FADE_KM * PAD_FADE_KM) z += fine;
    else {
      const w = smoothstep(0.1, PAD_FADE_KM, Math.sqrt(pad2));
      const ref = anchorFine(nearest);
      z += ref + w * (fine - ref);
    }
  }
  return z;
}

// ------------------------------------------------------------------ grids

export const REGIONAL_N = 1001;
export const REGIONAL_SPACING_KM = 0.8;
export const LOCAL_N = 513;
export const LOCAL_SPACING_KM = 0.032;

function allocGrid(cx: number, cy: number, n: number, spacingKm: number): Grid {
  const half = ((n - 1) / 2) * spacingKm;
  return { n, spacingKm, x0: cx - half, y0: cy - half, data: new Float32Array(n * n) };
}

function fillRows(g: Grid, detail: DetailLevel, jFrom: number, jTo: number): void {
  const { n, spacingKm, x0, y0, data } = g;
  for (let j = jFrom; j < jTo; j++) {
    const y = y0 + j * spacingKm;
    let k = j * n;
    for (let i = 0; i < n; i++) data[k++] = terrainHeight(x0 + i * spacingKm, y, detail);
  }
}

export function buildRegionalGrid(): Grid {
  const g = allocGrid(0, 0, REGIONAL_N, REGIONAL_SPACING_KM);
  fillRows(g, 0, 0, g.n);
  return g;
}

export function buildLocalGrid(cx: number, cy: number): Grid {
  const g = allocGrid(cx, cy, LOCAL_N, LOCAL_SPACING_KM);
  fillRows(g, 1, 0, g.n);
  return g;
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Time-sliced variant for the browser: yields every ~24 ms so the UI can paint. */
export async function buildGridAsync(
  kind: 'regional' | 'local', cx: number, cy: number, onProgress?: (fraction: number) => void,
): Promise<Grid> {
  const g = kind === 'regional'
    ? allocGrid(0, 0, REGIONAL_N, REGIONAL_SPACING_KM)
    : allocGrid(cx, cy, LOCAL_N, LOCAL_SPACING_KM);
  const detail: DetailLevel = kind === 'regional' ? 0 : 1;
  let j = 0;
  while (j < g.n) {
    const t0 = performance.now();
    while (j < g.n && performance.now() - t0 < 24) {
      const next = Math.min(g.n, j + 8);
      fillRows(g, detail, j, next);
      j = next;
    }
    onProgress?.(j / g.n);
    await yieldToUi();
  }
  return g;
}

/** Wrap an externally produced raster (for example resampled LOLA LDEM) as a Grid. */
export function loadExternalGrid(data: Float32Array, n: number, spacingKm: number, centreX: number, centreY: number): Grid {
  if (data.length !== n * n) throw new Error(`Grid data length ${data.length} does not match ${n} x ${n}`);
  const half = ((n - 1) / 2) * spacingKm;
  return { n, spacingKm, x0: centreX - half, y0: centreY - half, data };
}

/** Every `stride`-th sample of a grid (n - 1 must be divisible by stride). */
export function decimateGrid(g: Grid, stride: number): Grid {
  if ((g.n - 1) % stride !== 0) throw new Error(`Grid size ${g.n} cannot be decimated by ${stride}`);
  const n = (g.n - 1) / stride + 1;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = g.data[j * stride * g.n + i * stride];
  return { n, spacingKm: g.spacingKm * stride, x0: g.x0, y0: g.y0, data };
}

export function gridContains(g: Grid, x: number, y: number): boolean {
  const fx = (x - g.x0) / g.spacingKm, fy = (y - g.y0) / g.spacingKm;
  return fx >= 0 && fy >= 0 && fx <= g.n - 1 && fy <= g.n - 1;
}

/** Bilinear height sample. The caller guarantees the point is inside the grid. */
export function sampleGrid(g: Grid, x: number, y: number): number {
  const n = g.n;
  let fx = (x - g.x0) / g.spacingKm, fy = (y - g.y0) / g.spacingKm;
  if (fx < 0) fx = 0; else if (fx > n - 1.000001) fx = n - 1.000001;
  if (fy < 0) fy = 0; else if (fy > n - 1.000001) fy = n - 1.000001;
  const i = fx | 0, j = fy | 0;
  const tx = fx - i, ty = fy - j;
  const k = j * n + i;
  const d = g.data;
  const a = d[k] + (d[k + 1] - d[k]) * tx;
  const b = d[k + n] + (d[k + n + 1] - d[k + n]) * tx;
  return a + (b - a) * ty;
}

/** Nested DEM: fine local grid where available, regional grid elsewhere. */
export interface DemStack { regional: Grid; local: Grid | null }

export function demHeight(dem: DemStack, x: number, y: number): number {
  if (dem.local && gridContains(dem.local, x, y)) return sampleGrid(dem.local, x, y);
  return sampleGrid(dem.regional, x, y);
}

/** Terrain slope (deg) from a central difference over `baselineKm`. */
export function slopeDeg(dem: DemStack, x: number, y: number, baselineKm = 0.064): number {
  const b = baselineKm / 2;
  const gx = (demHeight(dem, x + b, y) - demHeight(dem, x - b, y)) / baselineKm;
  const gy = (demHeight(dem, x, y + b) - demHeight(dem, x, y - b)) / baselineKm;
  return Math.atan(Math.hypot(gx, gy)) * RAD;
}

export function gridMinMax(g: Grid): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  const d = g.data;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

export const NAMED_LANDFORMS: { name: string; latDeg: number; lonDeg: number; kind: 'crater' | 'massif' }[] = [
  ...CRATERS.map((c) => ({ name: c.name, latDeg: c.lat, lonDeg: c.lon, kind: 'crater' as const })),
  ...MASSIFS.map((m) => ({ name: m.name, latDeg: m.lat, lonDeg: m.lon, kind: 'massif' as const })),
];
