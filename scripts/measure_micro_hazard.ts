/**
 * Cost of the sub-pixel hazard estimate (v2.1 change 3): how long
 * `microHazard` takes at the lander, the way the emergency flow calls it
 * (6 sunlit directions of a 15-day window), on the real LOLA terrain of the
 * five candidate sites.
 *
 *   npm run measure-micro
 *
 * Prints the median and the worst time per site. Node and the browser run
 * the same engine code; a browser on a slower machine can be a few times
 * slower, which is why the decision threshold (300 ms) is compared with the
 * worst case here and the result is also checked in the e2e run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANDIDATE_SITES, DEFAULT_POWER, DEFAULT_RF, DEFAULT_THERMAL, DemManifest, DemStack, computeHorizon, decodeGrid, evaluateMission, latLonToXY,
  makeObserver, microHazard, resampleLocalGrid, sunlitDirections,
} from '../src/engine';

const dir = join(process.cwd(), 'public', 'dem');
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
const regional = decodeGrid(load(manifest.regional.file), manifest.regional);
const cap = decodeGrid(load(manifest.cap.file), manifest.cap);

const RUNS = 15;
let worst = 0;
for (const site of CANDIDATE_SITES) {
  const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
  const dem: DemStack = { regional, local: resampleLocalGrid([cap, regional], x, y).grid };
  const input = {
    latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days: 15, stepHours: 1, mastM: 2,
    power: DEFAULT_POWER, rf: DEFAULT_RF, thermal: DEFAULT_THERMAL,
  };
  const r = evaluateMission(dem, input, computeHorizon(dem, makeObserver(dem, x, y, 2)));
  const sun = sunlitDirections(r, 6);
  const times: number[] = [];
  for (let k = 0; k < RUNS; k++) {
    const t0 = performance.now();
    microHazard(dem, r.observer.x, r.observer.y, r.observer.lonDeg, sun);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const med = times[Math.floor(RUNS / 2)], max = times[RUNS - 1];
  worst = Math.max(worst, max);
  console.log(`${site.name.padEnd(32)} median ${med.toFixed(1)} ms · worst ${max.toFixed(1)} ms`);
}
console.log(`worst of all: ${worst.toFixed(1)} ms (decision threshold 300 ms)`);
