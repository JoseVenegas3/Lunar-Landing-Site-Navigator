/**
 * Calibration report for the synthetic DEM: builds the grids, evaluates the
 * five candidate sites over a 180-day window and prints timing and KPIs.
 * Run with `npm run calibrate`.
 */
import {
  CANDIDATE_SITES, DEFAULT_POWER, DEFAULT_RF, buildLocalGrid, buildRegionalGrid, computeHorizon,
  evaluateScenario, gridMinMax, latLonToXY, makeObserver, relocatedXY,
} from '../src/engine';

const t0 = performance.now();
const regional = buildRegionalGrid();
const tRegional = performance.now() - t0;
const mm = gridMinMax(regional);
console.log(`regional grid: ${tRegional.toFixed(0)} ms, min ${mm.min.toFixed(2)} km, max ${mm.max.toFixed(2)} km`);

const startMs = Date.UTC(2027, 0, 1);
const pad = (s: string | number, n: number): string => String(s).padStart(n);

console.log('site                           elev_m slope  illum%  sunlit% maxLight maxDark  DTE%  both%   kWh    GB   minSoC surv  hzMin hzMax');
for (const site of CANDIDATE_SITES) {
  const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
  const t1 = performance.now();
  const local = buildLocalGrid(cx, cy);
  const tLocal = performance.now() - t1;
  const dem = { regional, local };
  const t2 = performance.now();
  const r = evaluateScenario(dem, {
    latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs, days: 180, stepHours: 1, mastM: 2,
    power: DEFAULT_POWER, rf: DEFAULT_RF,
  });
  const tEval = performance.now() - t2;
  const k = r.kpis;
  let hzMin = Infinity, hzMax = -Infinity;
  for (const v of r.horizon.elevDeg) { hzMin = Math.min(hzMin, v); hzMax = Math.max(hzMax, v); }
  console.log(
    site.name.padEnd(30),
    pad(k.groundElevationM.toFixed(0), 6), pad(k.slopeDeg.toFixed(1), 5),
    pad(k.illuminationPct.toFixed(1), 7), pad(k.sunlitPct.toFixed(1), 8),
    pad(k.longestLightH.toFixed(0), 8), pad(k.longestDarkH.toFixed(0), 7),
    pad(k.dtePct.toFixed(1), 6), pad(k.simultaneousPct.toFixed(1), 6),
    pad((k.energyWh / 1000).toFixed(0), 6), pad(k.dataGb.toFixed(0), 6),
    pad(k.minSocPct.toFixed(0), 6), pad(k.survives ? 'yes' : 'NO', 5),
    pad(hzMin.toFixed(1), 6), pad(hzMax.toFixed(1), 5),
    `| local ${tLocal.toFixed(0)} ms, eval ${tEval.toFixed(0)} ms`,
  );
  console.log('   horizon az:elev@km ->', [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `${a}:${r.horizon.elevDeg[a].toFixed(1)}@${r.horizon.distKm[a].toFixed(1)}`).join('  '), `| sunEl ${k.sunElMinDeg.toFixed(1)}..${k.sunElMaxDeg.toFixed(1)} earthEl ${k.earthElMinDeg.toFixed(1)}..${k.earthElMaxDeg.toFixed(1)} az ${k.earthAzMinDeg.toFixed(1)}..${k.earthAzMaxDeg.toFixed(1)}`);
  // Sensitivity to a 500 m move in the four cardinal directions.
  const moves: [string, number, number][] = [['E', 500, 0], ['W', -500, 0], ['N', 0, 500], ['S', 0, -500]];
  const parts: string[] = [];
  for (const [label, dx, dy] of moves) {
    const [x, y] = relocatedXY(site.latDeg, site.lonDeg, dx, dy);
    const t3 = performance.now();
    const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
    const tH = performance.now() - t3;
    const m = evaluateScenario(dem, {
      latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: dx, dyM: dy, startMs, days: 180, stepHours: 1, mastM: 2,
      power: DEFAULT_POWER, rf: DEFAULT_RF,
    }, hz);
    parts.push(`${label}: illum ${m.kpis.illuminationPct.toFixed(0)}% dte ${m.kpis.dtePct.toFixed(0)}% (hz ${tH.toFixed(1)} ms)`);
  }
  console.log('   +-500 m ->', parts.join(' | '));
}
