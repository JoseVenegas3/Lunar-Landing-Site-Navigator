/**
 * Reads a 20 m patch straight from the NASA PGDA cloud-optimised GeoTIFF with
 * the same code the browser uses (geotiff.js + cogStream.ts) and compares it
 * with the grid scripts/build_lola_dem.py wrote for the same site.
 *   npx tsx scripts/verify_cog_stream.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromUrl } from 'geotiff';
import { DemManifest, LOLA_COG, PixelWindow, decodeGrid, latLonToXY, patchWindow, streamLocalPatch, windowBytes, withRetry } from '../src/engine';

const dir = join(process.cwd(), 'public', 'dem');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;

// One failed range request rejects the whole read; the sibling requests then reject unobserved.
process.on('unhandledRejection', () => undefined);
const tiff = await fromUrl(`https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/${LOLA_COG.file}`, { blockSize: 1 << 20 } as Parameters<typeof fromUrl>[1]);
const image = await tiff.getImage(0);
console.log(`raster ${image.getWidth()} x ${image.getHeight()}, origin ${image.getOrigin().slice(0, 2).join(', ')}, pixel ${image.getResolution()[0]} m`);
const read = withRetry(async (w: PixelWindow): Promise<Float32Array> =>
  (await image.readRasters({ window: [w.col0, w.row0, w.col0 + w.width, w.row0 + w.height], samples: [0], interleave: true })) as Float32Array);

for (const id of ['shackleton-ridge', 'im2-athena']) {
  const info = manifest.sites.find((s) => s.id === id);
  if (!info) continue;
  const [cx, cy] = latLonToXY(info.latDeg, info.lonDeg);
  const b = readFileSync(join(dir, info.file));
  const built = decodeGrid(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, info, cx, cy);
  const win = patchWindow(cx, cy) as PixelWindow;
  const t0 = performance.now();
  const res = await streamLocalPatch(read, cx, cy, () => NaN);
  if (!res) throw new Error('outside the mosaic');
  let sq = 0, worst = 0;
  for (let k = 0; k < built.data.length; k++) {
    const d = Math.abs(res.grid.data[k] - built.data[k]) * 1000;
    sq += d * d;
    if (d > worst) worst = d;
  }
  console.log(`${id}: window ${win.width} x ${win.height} px (${(windowBytes(win) / 1e6).toFixed(1)} MB raw) in ${((performance.now() - t0) / 1000).toFixed(1)} s, `
    + `coverage ${res.coveragePct.toFixed(1)} %, vs pre-built grid: RMS ${Math.sqrt(sq / built.data.length).toFixed(3)} m, worst ${worst.toFixed(3)} m`);
}
