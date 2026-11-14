/**
 * Decoders for the LOLA terrain assets written by scripts/build_lola_dem.py.
 *
 * The files are raw little-endian rasters in the application's map frame
 * (see terrain.ts), so decoding is a unit conversion and nothing else. Every
 * platform the app targets is little-endian; the typed-array views below rely
 * on that.
 */
import { Grid, LOCAL_N, LOCAL_SPACING_KM, gridContains, loadExternalGrid, sampleGrid } from './terrain';

export interface DemGridInfo {
  file: string;
  n: number;
  spacingM: number;
  encoding: 'int16le-0.5m' | 'float32le-m';
  sourcePixelM: number;
  minM: number;
  maxM: number;
}

export interface DemSiteInfo extends DemGridInfo {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  elevationM: number;
  slopeDeg: number;
}

export interface DemManifest {
  source: string;
  citation: string;
  dataDoi: string;
  frame: string;
  generatedUtc: string;
  regional: DemGridInfo;
  cap: DemGridInfo;
  sites: DemSiteInfo[];
}

/** Decode a raster into a Grid centred on (centreXKm, centreYKm). Heights become km. */
export function decodeGrid(buffer: ArrayBuffer, info: DemGridInfo, centreXKm = 0, centreYKm = 0): Grid {
  const count = info.n * info.n;
  const data = new Float32Array(count);
  if (info.encoding === 'int16le-0.5m') {
    if (buffer.byteLength !== count * 2) throw new Error(`${info.file}: expected ${count * 2} bytes, got ${buffer.byteLength}`);
    const raw = new Int16Array(buffer);
    for (let i = 0; i < count; i++) data[i] = raw[i] * 0.0005;
  } else {
    if (buffer.byteLength !== count * 4) throw new Error(`${info.file}: expected ${count * 4} bytes, got ${buffer.byteLength}`);
    const raw = new Float32Array(buffer);
    for (let i = 0; i < count; i++) data[i] = raw[i] * 0.001;
  }
  return loadExternalGrid(data, info.n, info.spacingM / 1000, centreXKm, centreYKm);
}

/**
 * Local 513 x 513, 32 m grid around an arbitrary point, interpolated from a
 * coarser grid (the 160 m polar cap, or the 800 m regional grid outside it).
 * The result has the resolution of its source, not 32 m: it exists so custom
 * coordinates use the same code path as the pre-built sites.
 */
export function resampleLocalGrid(sources: Grid[], centreXKm: number, centreYKm: number): { grid: Grid; sourceSpacingKm: number } {
  const n = LOCAL_N, sp = LOCAL_SPACING_KM;
  const half = ((n - 1) / 2) * sp;
  const corners: [number, number][] = [
    [centreXKm - half, centreYKm - half], [centreXKm + half, centreYKm - half],
    [centreXKm - half, centreYKm + half], [centreXKm + half, centreYKm + half],
  ];
  const src = sources.find((g) => corners.every(([x, y]) => gridContains(g, x, y))) ?? sources[sources.length - 1];
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const y = centreYKm - half + j * sp;
    for (let i = 0; i < n; i++) data[j * n + i] = sampleGrid(src, centreXKm - half + i * sp, y);
  }
  return { grid: loadExternalGrid(data, n, sp, centreXKm, centreYKm), sourceSpacingKm: src.spacingKm };
}
