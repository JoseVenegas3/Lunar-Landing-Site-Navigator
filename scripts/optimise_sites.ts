/**
 * Landing-point search on the real LOLA terrain.
 *
 * For each region named in the challenge brief, scan the terrain within
 * SEARCH_RADIUS_KM of the brief's coordinate and rank candidate points by
 * annual average illumination plus annual direct-to-Earth coverage, keeping
 * only points a lander could use (slope <= MAX_SLOPE_DEG over a 64 m baseline).
 *
 *   npm run optimise-sites            reads public/dem/, writes data/site_optimisation.json
 *
 * The grids in public/dem/ must be centred on the brief coordinates listed in
 * BRIEF below (run scripts/build_lola_dem.py with those in sites.ts, or pass
 * --brief to that script).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DemManifest, DemStack, computeEphemeris, computeHorizon, decodeGrid, earthClearanceDeg, latLonToXY, localAxes,
  makeObserver, siteFrame, slopeDeg, solarDiscFraction, sunAngularRadiusDeg, topocentric, xyToLatLon,
} from '../src/engine';

const SEARCH_RADIUS_KM = 4;
const STEP_KM = 0.16;
const MAX_SLOPE_DEG = 10;
const YEAR_START = Date.UTC(2027, 0, 1);
const dir = join(process.cwd(), 'public', 'dem');

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const regional = decodeGrid(load(manifest.regional.file), manifest.regional);
const eph = computeEphemeris(YEAR_START, 365 * 24, 2);

interface Score { eastM: number; northM: number; latDeg: number; lonDeg: number; elevationM: number; slopeDeg: number; illuminationPct: number; dtePct: number }

function score(dem: DemStack, x: number, y: number): Omit<Score, 'eastM' | 'northM'> {
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
  return {
    latDeg: ll.latDeg, lonDeg: ll.lonDeg, elevationM: obs.groundKm * 1000, slopeDeg: slopeDeg(dem, x, y),
    illuminationPct: (100 * lit) / eph.count, dtePct: (100 * dte) / eph.count,
  };
}

const out: Record<string, { brief: Score; best: Score; candidates: number; usable: number }> = {};
for (const site of manifest.sites) {
  const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
  const dem: DemStack = { regional, local: decodeGrid(load(site.file), site, cx, cy) };
  const ax = localAxes(site.lonDeg);
  const brief: Score = { eastM: 0, northM: 0, ...score(dem, cx, cy) };
  let best: Score | null = null;
  let candidates = 0, usable = 0;
  const t0 = performance.now();
  for (let n = -SEARCH_RADIUS_KM; n <= SEARCH_RADIUS_KM + 1e-9; n += STEP_KM) {
    for (let e = -SEARCH_RADIUS_KM; e <= SEARCH_RADIUS_KM + 1e-9; e += STEP_KM) {
      if (e * e + n * n > SEARCH_RADIUS_KM * SEARCH_RADIUS_KM) continue;
      candidates++;
      const x = cx + ax.ex * e + ax.nx * n, y = cy + ax.ey * e + ax.ny * n;
      if (slopeDeg(dem, x, y) > MAX_SLOPE_DEG) continue;
      usable++;
      const s = score(dem, x, y);
      if (!best || s.illuminationPct + s.dtePct > best.illuminationPct + best.dtePct) best = { eastM: e * 1000, northM: n * 1000, ...s };
    }
  }
  if (!best) best = brief;
  out[site.id] = { brief, best, candidates, usable };
  const f = (s: Score): string => `${s.latDeg.toFixed(4)}, ${s.lonDeg.toFixed(4)}  elev ${s.elevationM.toFixed(0)} m  slope ${s.slopeDeg.toFixed(1)} deg  illum ${s.illuminationPct.toFixed(1)} %  DTE ${s.dtePct.toFixed(1)} %`;
  console.log(`${site.name}  (${usable}/${candidates} usable points, ${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`   brief  ${f(brief)}`);
  console.log(`   best   ${f(best)}   offset E ${best.eastM.toFixed(0)} m, N ${best.northM.toFixed(0)} m`);
}

mkdirSync(join(process.cwd(), 'data'), { recursive: true });
writeFileSync(join(process.cwd(), 'data', 'site_optimisation.json'), JSON.stringify({
  method: `annual illumination % + annual DTE % (2027, 2 h step, sensor 2 m above ground, 2 deg antenna margin) maximised over points within ${SEARCH_RADIUS_KM} km of the grid centre with slope <= ${MAX_SLOPE_DEG} deg`,
  terrain: manifest.citation,
  sites: out,
}, null, 1));
