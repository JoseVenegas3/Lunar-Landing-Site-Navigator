/**
 * Coarse search for a landing region on a crater rim, on the 160 m LOLA polar cap.
 *
 * Scans an annulus around a crater centre and ranks points by annual
 * illumination plus direct-to-Earth coverage. Used once to place the "Haworth
 * Crater Rim" site on the real rim; the fine search (scripts/optimise_sites.ts)
 * then refines the point on the 20 m terrain.
 *
 *   npm run search-rim -- <centreLat> <centreLon> <rMinKm> <rMaxKm>
 *   npm run search-rim -- -87.45 -5.17 18 36
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DemManifest, DemStack, computeEphemeris, computeHorizon, decodeGrid, earthClearanceDeg, latLonToXY, makeObserver,
  siteFrame, slopeDeg, solarDiscFraction, sunAngularRadiusDeg, topocentric, xyToLatLon,
} from '../src/engine';

const [lat, lon, rMin, rMax] = process.argv.slice(2).map(Number);
if (![lat, lon, rMin, rMax].every(Number.isFinite)) {
  console.error('usage: npm run search-rim -- <centreLat> <centreLon> <rMinKm> <rMaxKm>');
  process.exit(2);
}
const dir = join(process.cwd(), 'public', 'dem');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const dem: DemStack = { regional: decodeGrid(load(manifest.regional.file), manifest.regional), local: decodeGrid(load(manifest.cap.file), manifest.cap) };
const eph = computeEphemeris(Date.UTC(2027, 0, 1), 365 * 24, 4);
const [cx, cy] = latLonToXY(lat, lon);
const STEP = 0.48;

interface Hit { lat: number; lon: number; elev: number; slope: number; illum: number; dte: number; bearing: number; r: number }
const hits: Hit[] = [];
for (let dy = -rMax; dy <= rMax; dy += STEP) {
  for (let dx = -rMax; dx <= rMax; dx += STEP) {
    const r = Math.hypot(dx, dy);
    if (r < rMin || r > rMax) continue;
    const x = cx + dx, y = cy + dy;
    const slope = slopeDeg(dem, x, y, 0.32);
    if (slope > 10) continue;
    const obs = makeObserver(dem, x, y, 2);
    const hz = computeHorizon(dem, obs);
    const frame = siteFrame(obs.latDeg, obs.lonDeg, obs.heightKm);
    let lit = 0, dte = 0;
    for (let i = 0; i < eph.count; i++) {
      const k = i * 3;
      const s = topocentric(eph.sun[k], eph.sun[k + 1], eph.sun[k + 2], frame);
      lit += solarDiscFraction(hz, s.azDeg, s.elDeg, sunAngularRadiusDeg(s.rangeKm));
      const e = topocentric(eph.earth[k], eph.earth[k + 1], eph.earth[k + 2], frame);
      if (earthClearanceDeg(hz, e.azDeg, e.elDeg, 2) > 0) dte++;
    }
    const ll = xyToLatLon(x, y);
    hits.push({
      lat: ll.latDeg, lon: ll.lonDeg, elev: obs.groundKm * 1000, slope,
      illum: (100 * lit) / eph.count, dte: (100 * dte) / eph.count,
      bearing: (Math.atan2(dx, dy) * 180) / Math.PI, r,
    });
  }
}
hits.sort((a, b) => b.illum + b.dte - (a.illum + a.dte));
console.log(`${hits.length} usable points in the annulus ${rMin}-${rMax} km around ${lat}, ${lon}`);
console.log('rank    lat       lon     elev_m slope illum%  DTE%   r_km  map-bearing');
// Print the leaders, skipping points within 3 km of a better one so distinct areas show up.
const shown: Hit[] = [];
for (const h of hits) {
  const [hx, hy] = latLonToXY(h.lat, h.lon);
  if (shown.some((s) => { const [sx, sy] = latLonToXY(s.lat, s.lon); return Math.hypot(sx - hx, sy - hy) < 3; })) continue;
  shown.push(h);
  console.log(`${String(shown.length).padStart(3)}  ${h.lat.toFixed(3)}  ${h.lon.toFixed(3).padStart(8)}  ${h.elev.toFixed(0).padStart(6)}  ${h.slope.toFixed(1).padStart(4)}  ${h.illum.toFixed(1).padStart(5)}  ${h.dte.toFixed(1).padStart(5)}  ${h.r.toFixed(1).padStart(5)}  ${h.bearing.toFixed(0).padStart(5)}`);
  if (shown.length >= 10) break;
}
