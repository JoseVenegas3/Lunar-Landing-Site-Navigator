/**
 * Landing-window search and secondary-diffraction figures for every candidate
 * site, printed for the record (ARCHITECTURE.md quotes them).
 *   npx tsx scripts/probe_windows.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANDIDATE_SITES, DEFAULT_POWER, DEFAULT_RF, DEFAULT_THERMAL, DEFAULT_TIPOVER, DEFAULT_WINDOW_CONFIG, DemManifest, MissionInput, REJECT_PRIORITY,
  computeHorizon, decodeGrid, evaluateMission, findLandingWindows, latLonToXY, makeObserver, tipoverMap,
} from '../src/engine';

const dir = join(process.cwd(), 'public', 'dem');
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
const regional = decodeGrid(load(manifest.regional.file), manifest.regional);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 13);

for (const site of CANDIDATE_SITES) {
  const info = manifest.sites.find((s) => s.id === site.id);
  if (!info) continue;
  const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
  const dem = { regional, local: decodeGrid(load(info.file), info, x, y) };
  const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
  const input: MissionInput = {
    latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days: 60, stepHours: 1, mastM: 2,
    power: DEFAULT_POWER, rf: DEFAULT_RF, thermal: DEFAULT_THERMAL,
  };
  const t0 = performance.now();
  const s = findLandingWindows(dem, input, hz, input.startMs, DEFAULT_WINDOW_CONFIG);
  const ms = performance.now() - t0;
  const reasons = REJECT_PRIORITY.filter((r) => s.counts[r] > 0).map((r) => `${r} ${s.counts[r]}`).join(', ');
  console.log(`\n${site.id}: ${s.candidates.length} candidates in ${ms.toFixed(0)} ms, accepted ${s.acceptedPct.toFixed(0)} %, ${s.windows.length} windows`);
  console.log(`  rejected by: ${reasons || 'nothing'}`);
  for (const w of s.windows.slice(0, 6)) console.log(`  ${iso(w.startMs)} -> ${iso(w.endMs)}  ${(w.openHours / 24).toFixed(1)} d  best ${iso(w.best.timeMs)} ${w.best.dataGb.toFixed(1)} GB`);
  const r = evaluateMission(dem, input, hz);
  console.log(`  60 d mission: Earth in view ${r.kpis.dtePct.toFixed(2)} %, downlink ${r.adv.kpis.rfAvailabilityPct.toFixed(2)} %, secondary ridges max ${r.adv.kpis.maxSecondaryDiffractionDb.toFixed(1)} dB over ${r.adv.kpis.secondaryEdgeHours} h, downlink lost to them ${r.adv.kpis.secondaryLostHours} h`);
  const tip = tipoverMap(dem, { latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0 }, DEFAULT_TIPOVER);
  console.log(`  tip-over: aim ${(100 * tip.centre.p).toFixed(2)} % (slope ${tip.centre.slopeDeg.toFixed(1)} deg), ellipse mean ${(100 * tip.meanP).toFixed(2)} %, worst ${(100 * tip.maxP).toFixed(2)} % (slope ${tip.maxSlopeDeg.toFixed(1)} deg)`);
}
