/**
 * Browser side of the on-demand 20 m terrain: HTTP range requests against the
 * LOLA cloud-optimised GeoTIFF (through geotiff.js) and an IndexedDB cache so
 * a patch read once stays available offline.
 *
 * The NASA PGDA server does not send CORS headers, so a browser cannot read
 * the file directly. In development and in `vite preview` the request goes to
 * the same-origin path /lola-cog/, which vite.config.ts forwards to PGDA. A
 * static deployment needs either that small proxy or a CORS-enabled mirror in
 * VITE_LOLA_COG_URL; without one the app keeps the 160 m terrain and says so.
 */
import { LOLA_COG, PixelWindow, WindowReader, withRetry } from '../engine';

const env = import.meta.env as Record<string, string | undefined>;
export const cogUrl = (): string => env.VITE_LOLA_COG_URL ?? `${import.meta.env.BASE_URL}lola-cog/${LOLA_COG.file}`;

let readerPromise: Promise<WindowReader> | null = null;

/** Reader of pixel windows of the 20 m mosaic. The GeoTIFF library is loaded on first use. */
export function cogReader(): Promise<WindowReader> {
  if (!readerPromise) {
    readerPromise = (async () => {
      const { fromUrl } = await import('geotiff');
      const tiff = await fromUrl(new URL(cogUrl(), window.location.href).href, { blockSize: 1 << 20 } as Parameters<typeof fromUrl>[1]);
      const image = await tiff.getImage(0);
      if (image.getWidth() !== LOLA_COG.size || image.getHeight() !== LOLA_COG.size) {
        throw new Error(`unexpected raster size ${image.getWidth()} x ${image.getHeight()}`);
      }
      return withRetry(async (w: PixelWindow): Promise<Float32Array> => {
        const out = await image.readRasters({ window: [w.col0, w.row0, w.col0 + w.width, w.row0 + w.height], samples: [0], interleave: true });
        return out instanceof Float32Array ? out : Float32Array.from(out as ArrayLike<number>);
      });
    })();
    // A failed start (no proxy, no network) must not poison later attempts.
    readerPromise.catch(() => { readerPromise = null; });
  }
  return readerPromise;
}

// ------------------------------------------------------------- patch cache

const DB_NAME = 'clps-terrain', STORE = 'patches-v1';

export interface StoredPatch { data: Float32Array; coveragePct: number; savedUtc: string }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function loadStoredPatch(key: string): Promise<StoredPatch | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as StoredPatch | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function storePatch(key: string, patch: StoredPatch): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(patch, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* storage unavailable: the patch stays in memory for this visit */ }
}

/** Keys of the patches kept for offline use. */
export async function storedPatchKeys(): Promise<string[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result.map(String));
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
