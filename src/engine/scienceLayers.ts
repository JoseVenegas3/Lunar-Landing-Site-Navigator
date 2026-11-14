/**
 * Orbital science layers written by scripts/fetch_science_layers.py and the
 * look-ups the suitability score needs from them.
 *
 *   psr      permanently shadowed regions from LOLA (Barker et al. 2023)
 *   diviner  annual temperatures and ice-stability depth (Paige et al. 2010)
 *   feo      Lunar Prospector GRS FeO, 2 degree pixels (Prettyman et al. 2006)
 *   gravity  GRAIL free-air anomaly, degree 420 (Lemoine et al. 2014)
 *
 * Hydrogen and geological density are not among them: no gridded product was
 * found for either, so they stay as values the user may enter.
 */
import { latLonToXY } from './terrain';

export interface SitePsr { distanceKm: number | null; fractionWithin8kmPct: number; landingPointInPsr: boolean }

export interface SiteDiviner {
  /** Annual average and maximum bolometric surface temperature, K. */
  tAvgK: number;
  tMaxK: number;
  /** Depth at which water ice is thermally stable at the site, m; null when it is not stable. */
  iceDepthM: number | null;
  /** Range to the nearest ground where ice is stable at depth, and at the surface, km. */
  nearestIceStableKm: number | null;
  nearestSurfaceIceKm: number | null;
  /** Share of the searched area where ice is stable, percent. */
  iceStablePct: number;
  coldestTAvgK: number;
  searchRadiusKm: number;
  offsetKm: number;
}

export interface SiteScience {
  latDeg: number;
  lonDeg: number;
  psr: SitePsr;
  diviner: SiteDiviner;
  feoWtPct: number | null;
  gravityMgal: number;
}

interface LayerInfo { source: string; citation: string; note: string }

export interface ScienceManifest {
  generatedUtc: string;
  layers: {
    psr: LayerInfo & { file: string; n: number; spacingM: number; capPsrPct: number };
    diviner: LayerInfo & { cellM: number };
    /** Pixels as [minLat, maxLat, minLon, maxLon, FeO wt.%]. */
    feo: LayerInfo & { pixels: number[][] };
    gravity: LayerInfo & { file: string; n: number; spacingM: number; unit: string; minMgal: number; maxMgal: number };
  };
  notLoaded: Record<string, string>;
  sites: Record<string, SiteScience>;
}

export interface ScienceLayers {
  manifest: ScienceManifest;
  /** PSR mask on the polar cap grid, one bit per cell, most significant bit first. */
  psrMask: Uint8Array;
  /** Free-air anomaly on a polar grid, mGal, row-major with rows running south to north in map y. */
  gravity: Float32Array;
}

/** FeO weight percent of the Lunar Prospector pixel that contains a point, or null outside the table. */
export function feoAt(layers: ScienceLayers, latDeg: number, lonDeg: number): number | null {
  for (const p of layers.manifest.layers.feo.pixels) {
    if (latDeg < p[0] || latDeg > p[1]) continue;
    if ((lonDeg >= p[2] && lonDeg <= p[3]) || (lonDeg + 360 >= p[2] && lonDeg + 360 <= p[3]) || (lonDeg - 360 >= p[2] && lonDeg - 360 <= p[3])) return p[4];
  }
  return null;
}

/** Free-air gravity anomaly (mGal) at a map point (km), bilinear; null outside the grid. */
export function gravityAt(layers: ScienceLayers, x: number, y: number): number | null {
  const { n, spacingM } = layers.manifest.layers.gravity;
  const sp = spacingM / 1000;
  const half = ((n - 1) / 2) * sp;
  const fx = (x + half) / sp, fy = (y + half) / sp;
  if (fx < 0 || fy < 0 || fx > n - 1 || fy > n - 1) return null;
  const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fy));
  const tx = fx - i, ty = fy - j;
  const g = layers.gravity;
  const a = g[j * n + i] + (g[j * n + i + 1] - g[j * n + i]) * tx;
  const b = g[(j + 1) * n + i] + (g[(j + 1) * n + i + 1] - g[(j + 1) * n + i]) * tx;
  return a + (b - a) * ty;
}

const bit = (mask: Uint8Array, k: number): boolean => ((mask[k >> 3] >> (7 - (k & 7))) & 1) === 1;

/** Whether a map point (km) lies in a permanently shadowed region of the cap mask. */
export function inPsr(layers: ScienceLayers, x: number, y: number): boolean {
  const { n, spacingM } = layers.manifest.layers.psr;
  const sp = spacingM / 1000;
  const half = ((n - 1) / 2) * sp;
  const i = Math.round((x + half) / sp), j = Math.round((y + half) / sp);
  if (i < 0 || j < 0 || i >= n || j >= n) return false;
  return bit(layers.psrMask, j * n + i);
}

/**
 * Distance (km) from a map point to the nearest permanently shadowed cell of
 * the cap mask, searched out to `maxKm`. Returns 0 inside a PSR and null when
 * none lies within the search radius (or the point is off the cap).
 */
export function psrDistanceKm(layers: ScienceLayers, x: number, y: number, maxKm = 20): number | null {
  const { n, spacingM } = layers.manifest.layers.psr;
  const sp = spacingM / 1000;
  const half = ((n - 1) / 2) * sp;
  const ci = Math.round((x + half) / sp), cj = Math.round((y + half) / sp);
  if (ci < 0 || cj < 0 || ci >= n || cj >= n) return null;
  const reach = Math.ceil(maxKm / sp);
  let best = Infinity;
  for (let dj = -reach; dj <= reach; dj++) {
    const j = cj + dj;
    if (j < 0 || j >= n) continue;
    for (let di = -reach; di <= reach; di++) {
      const i = ci + di;
      if (i < 0 || i >= n) continue;
      const d2 = di * di + dj * dj;
      if (d2 >= best || !bit(layers.psrMask, j * n + i)) continue;
      best = d2;
    }
  }
  if (!Number.isFinite(best)) return null;
  const d = Math.sqrt(best) * sp;
  return d <= maxKm ? d : null;
}

/** Layer record of a candidate site, matched by coordinates. */
export function siteScience(layers: ScienceLayers, latDeg: number, lonDeg: number): SiteScience | null {
  for (const s of Object.values(layers.manifest.sites)) {
    if (Math.abs(s.latDeg - latDeg) < 1e-6 && Math.abs(s.lonDeg - lonDeg) < 1e-6) return s;
  }
  return null;
}

/** Decode the raw assets. The bit mask must cover n*n cells; the gravity file n*n float32. */
export function decodeScienceLayers(manifest: ScienceManifest, psrBuffer: ArrayBuffer, gravityBuffer: ArrayBuffer): ScienceLayers {
  const p = manifest.layers.psr, g = manifest.layers.gravity;
  if (psrBuffer.byteLength < Math.ceil((p.n * p.n) / 8)) throw new Error(`psr mask: ${psrBuffer.byteLength} bytes for ${p.n} x ${p.n} cells`);
  if (gravityBuffer.byteLength !== g.n * g.n * 4) throw new Error(`gravity grid: ${gravityBuffer.byteLength} bytes for ${g.n} x ${g.n} cells`);
  return { manifest, psrMask: new Uint8Array(psrBuffer), gravity: new Float32Array(gravityBuffer) };
}

/** Map coordinates (km) of a latitude / longitude, re-exported for callers of the look-ups above. */
export const scienceXY = latLonToXY;
