/**
 * On-demand 20 m terrain for any point of the polar cap.
 *
 * The pre-built 32 m grids only exist for the candidate sites. For any other
 * coordinate the application reads a window of the same source raster the
 * build script uses (LDEM_80S_20MPP_ADJ, a cloud-optimised GeoTIFF: 30400 x
 * 30400 float32 pixels of 20 m in south polar stereographic projection) and
 * resamples it onto the local grid, exactly as scripts/build_lola_dem.py does.
 *
 * This module is the geometry and the resampling only; how the pixels arrive
 * (HTTP range requests through geotiff.js, a cache, a test fixture) is the
 * caller's `WindowReader`.
 */
import { R_MOON_KM } from './constants';
import { Grid, LOCAL_N, LOCAL_SPACING_KM, loadExternalGrid } from './terrain';

/** Georeferencing of LDEM_80S_20MPP_ADJ.TIF (read from the file header, Barker et al. 2023). */
export const LOLA_COG = {
  file: 'LDEM_80S_20MPP_ADJ.TIF',
  /** Stereographic x of the left edge and y of the top edge, m. */
  originXM: -304000,
  originYM: 304000,
  pixelM: 20,
  size: 30400,
} as const;

export interface PixelWindow { col0: number; row0: number; width: number; height: number }

/** Azimuthal-equidistant map coordinates (km) to south polar stereographic (m). */
export function mapKmToStereoM(xKm: number, yKm: number): [number, number] {
  const r = Math.hypot(xKm, yKm);
  if (r < 1e-9) return [xKm * 1000, yKm * 1000];
  const scale = (2 * R_MOON_KM * Math.tan(r / R_MOON_KM / 2)) / r;
  return [xKm * scale * 1000, yKm * scale * 1000];
}

/**
 * Pixel window of the raster that covers the local grid centred on
 * (cxKm, cyKm) with a margin for the bilinear kernel, clipped to the raster.
 * Null when the grid lies entirely outside the mosaic.
 */
export function patchWindow(cxKm: number, cyKm: number, n = LOCAL_N, spacingKm = LOCAL_SPACING_KM, marginPx = 3): PixelWindow | null {
  const half = ((n - 1) / 2) * spacingKm;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  // Corners and edge mid-points: the projection is radial, so the extremes sit on the boundary.
  for (const fx of [-1, 0, 1]) {
    for (const fy of [-1, 0, 1]) {
      const [sx, sy] = mapKmToStereoM(cxKm + fx * half, cyKm + fy * half);
      if (sx < xMin) xMin = sx;
      if (sx > xMax) xMax = sx;
      if (sy < yMin) yMin = sy;
      if (sy > yMax) yMax = sy;
    }
  }
  const { originXM, originYM, pixelM, size } = LOLA_COG;
  const col0 = Math.max(0, Math.floor((xMin - originXM) / pixelM) - marginPx);
  const col1 = Math.min(size, Math.ceil((xMax - originXM) / pixelM) + marginPx);
  const row0 = Math.max(0, Math.floor((originYM - yMax) / pixelM) - marginPx);
  const row1 = Math.min(size, Math.ceil((originYM - yMin) / pixelM) + marginPx);
  if (col1 <= col0 || row1 <= row0) return null;
  return { col0, row0, width: col1 - col0, height: row1 - row0 };
}

export interface PatchResult {
  grid: Grid;
  /** Share of the local grid taken from the 20 m raster, percent (the rest comes from `fallback`). */
  coveragePct: number;
}

/**
 * Bilinear resampling of a raster window (metres, row 0 at the top) onto the
 * local grid. Samples whose kernel touches a missing pixel or leaves the
 * window use `fallback(xKm, yKm)` (km), normally the 160 m cap.
 */
export function resamplePatch(
  raster: Float32Array, win: PixelWindow, cxKm: number, cyKm: number, fallback: (xKm: number, yKm: number) => number,
  n = LOCAL_N, spacingKm = LOCAL_SPACING_KM,
): PatchResult {
  if (raster.length !== win.width * win.height) throw new Error(`raster has ${raster.length} pixels, window needs ${win.width * win.height}`);
  const { originXM, originYM, pixelM } = LOLA_COG;
  const half = ((n - 1) / 2) * spacingKm;
  const data = new Float32Array(n * n);
  let covered = 0;
  for (let j = 0; j < n; j++) {
    const y = cyKm - half + j * spacingKm;
    for (let i = 0; i < n; i++) {
      const x = cxKm - half + i * spacingKm;
      const [sx, sy] = mapKmToStereoM(x, y);
      const fc = (sx - originXM) / pixelM - 0.5 - win.col0;
      const fr = (originYM - sy) / pixelM - 0.5 - win.row0;
      const c = Math.floor(fc), r = Math.floor(fr);
      let v = NaN;
      if (c >= 0 && r >= 0 && c + 1 < win.width && r + 1 < win.height) {
        const k = r * win.width + c;
        const tx = fc - c, ty = fr - r;
        const top = raster[k] + (raster[k + 1] - raster[k]) * tx;
        const bottom = raster[k + win.width] + (raster[k + win.width + 1] - raster[k + win.width]) * tx;
        v = (top + (bottom - top) * ty) / 1000;
      }
      if (Number.isFinite(v)) { data[j * n + i] = v; covered++; } else data[j * n + i] = fallback(x, y);
    }
  }
  return { grid: loadExternalGrid(data, n, spacingKm, cxKm, cyKm), coveragePct: (100 * covered) / (n * n) };
}

/** Returns the pixels of a window, row-major from the top-left, in metres (NaN = no data). */
export type WindowReader = (win: PixelWindow) => Promise<Float32Array>;

/** Local grid around any point from the 20 m raster. Null when the point is outside the mosaic. */
export async function streamLocalPatch(
  read: WindowReader, cxKm: number, cyKm: number, fallback: (xKm: number, yKm: number) => number,
): Promise<PatchResult | null> {
  const win = patchWindow(cxKm, cyKm);
  if (!win) return null;
  return resamplePatch(await read(win), win, cxKm, cyKm, fallback);
}

/** Bytes a window costs before compression (the file is deflate-compressed, so the transfer is smaller). */
export const windowBytes = (win: PixelWindow): number => win.width * win.height * 4;

/** A reader that repeats a failed window read: range requests to the source fail now and then. */
export function withRetry(read: WindowReader, attempts = 5, delayMs = 800): WindowReader {
  return async (win) => {
    let last: unknown;
    for (let k = 0; k < attempts; k++) {
      try {
        return await read(win);
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, delayMs * (k + 1)));
      }
    }
    throw last instanceof Error ? last : new Error('window read failed');
  };
}
