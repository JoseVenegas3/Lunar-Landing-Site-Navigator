/**
 * Compare the in-browser ephemeris engine with a JPL Horizons cache produced by
 * scripts/fetch_jpl_horizons.py.
 *
 *   npm run compare-horizons -- data/horizons/<file>.json
 */
import { readFileSync } from 'node:fs';
import { bodyFixedVectors, siteFrame, topocentric, wrap180 } from '../src/engine';

interface Row { ms: number; az: number; el: number; range_km: number }
interface Cache { site: { lat_deg: number; lon_deg: number; height_km: number }; sun: Row[]; earth: Row[] }

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run compare-horizons -- <horizons-cache.json>');
  process.exit(2);
}
const cache = JSON.parse(readFileSync(file, 'utf8')) as Cache;
const frame = siteFrame(cache.site.lat_deg, cache.site.lon_deg, cache.site.height_km);

for (const body of ['sun', 'earth'] as const) {
  let maxAz = 0, maxEl = 0, sumEl2 = 0, sumAz2 = 0, maxRange = 0;
  for (const row of cache[body]) {
    const v = bodyFixedVectors(row.ms)[body];
    const p = topocentric(v[0], v[1], v[2], frame);
    // Compare azimuth as an on-sky arc so it stays meaningful near the zenith.
    const dAz = Math.abs(wrap180(p.azDeg - row.az)) * Math.cos((row.el * Math.PI) / 180);
    const dEl = Math.abs(p.elDeg - row.el);
    maxAz = Math.max(maxAz, dAz);
    maxEl = Math.max(maxEl, dEl);
    sumAz2 += dAz * dAz;
    sumEl2 += dEl * dEl;
    maxRange = Math.max(maxRange, Math.abs(p.rangeKm - row.range_km));
  }
  const n = cache[body].length;
  console.log(
    `${body.padEnd(5)} n=${n}  azimuth: rms ${(Math.sqrt(sumAz2 / n)).toFixed(4)} deg, max ${maxAz.toFixed(4)} deg   `
    + `elevation: rms ${(Math.sqrt(sumEl2 / n)).toFixed(4)} deg, max ${maxEl.toFixed(4)} deg   range: max ${maxRange.toFixed(0)} km`,
  );
}
