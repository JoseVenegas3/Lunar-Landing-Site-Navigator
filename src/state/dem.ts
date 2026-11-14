/**
 * DEM service.
 *
 * Preferred source: the real LRO/LOLA terrain shipped in public/dem/ (built by
 * scripts/build_lola_dem.py). Pre-built 32 m grids exist for the candidate
 * sites; any other coordinate is served from the 160 m polar cap, or from the
 * 800 m regional grid beyond it.
 *
 * Fallback: when those assets cannot be loaded, the synthetic terrain model is
 * generated instead so the application still runs offline from source. In
 * that mode the candidate coordinates do not correspond to the synthetic
 * landforms, and the interface says so.
 */
import { create } from 'zustand';
import {
  DemManifest, Grid, LOCAL_N, LOCAL_SPACING_KM, buildGridAsync, decodeGrid, gridContains, latLonToXY, loadExternalGrid, resampleLocalGrid,
  sampleGrid, streamLocalPatch,
} from '../engine';
import { cogReader, loadStoredPatch, storePatch } from './cogClient';

/**
 * Where the terrain under a point comes from right now.
 *   static       pre-built 20 m grid shipped with the app
 *   loading      coarse grid on screen, 20 m patch being read
 *   ready        20 m patch read from the LOLA mosaic in this visit
 *   cached       20 m patch restored from the browser's offline store
 *   unavailable  the 20 m source could not be reached; coarse grid stays
 *   outside      the point is beyond the 20 m mosaic (north of 80 S)
 */
export type StreamStatus = 'static' | 'loading' | 'ready' | 'cached' | 'unavailable' | 'outside';

interface TerrainStream {
  status: Record<string, StreamStatus>;
  /** Share of the local grid that came from the 20 m raster, percent. */
  coverage: Record<string, number>;
  /** Bumped whenever the grid of a key is replaced. */
  version: Record<string, number>;
  set: (key: string, status: StreamStatus, coveragePct?: number, replaced?: boolean) => void;
}
export const useTerrainStream = create<TerrainStream>((set) => ({
  status: {}, coverage: {}, version: {},
  set: (key, status, coveragePct, replaced) => set((s) => ({
    status: { ...s.status, [key]: status },
    coverage: coveragePct === undefined ? s.coverage : { ...s.coverage, [key]: coveragePct },
    version: replaced ? { ...s.version, [key]: (s.version[key] ?? 0) + 1 } : s.version,
  })),
}));

/** Set to false to keep the coarse terrain (tests of the offline path). */
let streamingEnabled = true;
export const setTerrainStreaming = (on: boolean): void => { streamingEnabled = on; };

export type TerrainKind = 'lola' | 'synthetic';

let kind: TerrainKind = 'synthetic';
let manifest: DemManifest | null = null;
let regional: Grid | null = null;
let regionalPromise: Promise<Grid> | null = null;
let cap: Grid | null = null;
let capPromise: Promise<Grid> | null = null;
const locals = new Map<string, Grid>();
const localResolutionM = new Map<string, number>();
const pending = new Map<string, Promise<Grid>>();
const LOCAL_CACHE_LIMIT = 8;

const assetUrl = (file: string): string => `${import.meta.env.BASE_URL}dem/${file}`;

async function fetchBuffer(file: string): Promise<ArrayBuffer> {
  const res = await fetch(assetUrl(file));
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export const localKey = (latDeg: number, lonDeg: number): string => `${latDeg.toFixed(4)},${lonDeg.toFixed(4)}`;
export const terrainKind = (): TerrainKind => kind;
export const terrainCitation = (): string | null => manifest?.citation ?? null;
export const getRegional = (): Grid | null => regional;
export const getLocal = (latDeg: number, lonDeg: number): Grid | null => locals.get(localKey(latDeg, lonDeg)) ?? null;
/** Pixel size (m) of the data behind the local grid of a point, once it is loaded. */
export const localSourceResolutionM = (latDeg: number, lonDeg: number): number | null =>
  localResolutionM.get(localKey(latDeg, lonDeg)) ?? null;

export function ensureRegional(onProgress?: (f: number) => void): Promise<Grid> {
  if (regional) return Promise.resolve(regional);
  if (!regionalPromise) {
    regionalPromise = (async () => {
      try {
        const res = await fetch(assetUrl('manifest.json'));
        if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
        const m = (await res.json()) as DemManifest;
        onProgress?.(0.2);
        const grid = decodeGrid(await fetchBuffer(m.regional.file), m.regional);
        manifest = m;
        kind = 'lola';
        onProgress?.(1);
        return grid;
      } catch (err) {
        console.warn('LOLA terrain assets unavailable, using the synthetic terrain model.', err);
        kind = 'synthetic';
        manifest = null;
        return buildGridAsync('regional', 0, 0, onProgress);
      }
    })().then((g) => {
      regional = g;
      return g;
    });
  }
  return regionalPromise;
}

function ensureCap(): Promise<Grid> {
  if (cap) return Promise.resolve(cap);
  if (!capPromise) {
    const m = manifest as DemManifest;
    capPromise = fetchBuffer(m.cap.file).then((buf) => {
      cap = decodeGrid(buf, m.cap);
      return cap;
    });
  }
  return capPromise;
}

async function loadLocal(latDeg: number, lonDeg: number, onProgress?: (f: number) => void): Promise<{ grid: Grid; resolutionM: number }> {
  const [cx, cy] = latLonToXY(latDeg, lonDeg);
  if (kind === 'synthetic' || !manifest) {
    return { grid: await buildGridAsync('local', cx, cy, onProgress), resolutionM: 32 };
  }
  const site = manifest.sites.find((s) => Math.abs(s.latDeg - latDeg) < 1e-6 && Math.abs(s.lonDeg - lonDeg) < 1e-6);
  if (site) {
    useTerrainStream.getState().set(localKey(latDeg, lonDeg), 'static', 100);
    onProgress?.(0.3);
    const grid = decodeGrid(await fetchBuffer(site.file), site, cx, cy);
    onProgress?.(1);
    return { grid, resolutionM: site.sourcePixelM };
  }
  onProgress?.(0.2);
  const capGrid = await ensureCap();
  onProgress?.(0.7);
  const { grid, sourceSpacingKm } = resampleLocalGrid([capGrid, regional as Grid], cx, cy);
  onProgress?.(1);
  return { grid, resolutionM: Math.round(sourceSpacingKm * 1000) };
}

export function ensureLocal(latDeg: number, lonDeg: number, onProgress?: (f: number) => void): Promise<Grid> {
  const key = localKey(latDeg, lonDeg);
  const hit = locals.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = loadLocal(latDeg, lonDeg, onProgress).then(({ grid, resolutionM }) => {
      if (locals.size >= LOCAL_CACHE_LIMIT) {
        const oldest = locals.keys().next().value as string;
        locals.delete(oldest);
        localResolutionM.delete(oldest);
      }
      locals.set(key, grid);
      localResolutionM.set(key, resolutionM);
      pending.delete(key);
      if (resolutionM > 32 && kind === 'lola') void upgradeLocal(latDeg, lonDeg, key);
      return grid;
    });
    pending.set(key, p);
  }
  return p;
}

/**
 * Replace the coarse local grid of a point by the 20 m terrain: from the
 * offline store when the point was visited before, otherwise by reading a
 * window of the LOLA mosaic. The coarse grid stays on screen meanwhile.
 */
async function upgradeLocal(latDeg: number, lonDeg: number, key: string): Promise<void> {
  const stream = useTerrainStream.getState();
  if (!streamingEnabled) { stream.set(key, 'unavailable'); return; }
  const status = stream.status[key];
  if (status === 'loading' || status === 'ready' || status === 'cached') return;
  stream.set(key, 'loading');
  const [cx, cy] = latLonToXY(latDeg, lonDeg);
  const install = (grid: Grid, coveragePct: number, as: StreamStatus): void => {
    if (!locals.has(key)) return; // evicted while loading
    locals.set(key, grid);
    localResolutionM.set(key, 20);
    useTerrainStream.getState().set(key, as, coveragePct, true);
  };
  try {
    const stored = await loadStoredPatch(key);
    if (stored && stored.data.length === LOCAL_N * LOCAL_N) {
      install(loadExternalGrid(stored.data, LOCAL_N, LOCAL_SPACING_KM, cx, cy), stored.coveragePct, 'cached');
      return;
    }
    const coarse = (x: number, y: number): number => sampleGrid(cap && gridContains(cap, x, y) ? cap : (regional as Grid), x, y);
    const res = await streamLocalPatch(await cogReader(), cx, cy, coarse);
    if (!res) { useTerrainStream.getState().set(key, 'outside'); return; }
    install(res.grid, res.coveragePct, 'ready');
    void storePatch(key, { data: res.grid.data, coveragePct: res.coveragePct, savedUtc: new Date().toISOString() });
  } catch (err) {
    console.warn('20 m LOLA patch unavailable, keeping the coarse terrain.', err);
    useTerrainStream.getState().set(key, 'unavailable');
  }
}

/** Try again after a failed read (for example once the connection is back). */
export function retryTerrainStream(latDeg: number, lonDeg: number): void {
  const key = localKey(latDeg, lonDeg);
  if (locals.has(key) && useTerrainStream.getState().status[key] === 'unavailable') void upgradeLocal(latDeg, lonDeg, key);
}
