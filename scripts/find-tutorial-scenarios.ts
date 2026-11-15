/**
 * Finds, with the real engine, the scenarios of the beginner tutorial (v3.0)
 * and writes them to src/beginner/scenarios.ts.
 *
 *   npm run find-scenarios
 *
 * Search space: the six sites whose 20 m LOLA grid ships with the app (no
 * network), touchdown dates in 2027, relocations inside the ±500 m box. For
 * each mission the first scenario that meets its condition (scenarioCheck.ts)
 * is kept, preferring the clearest one. Nothing is tuned by hand.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_POWER, HOUR_MS, RELOCATION_LIMIT_M, STATE_RF_PHYSICAL, missionVerdict,
} from '../src/engine';
import { checkBadDate, checkFirstLanding, checkMast, checkRelay, fly, im1Attitude, inputFor, slopeAt } from '../src/beginner/scenarioCheck';
import { loadOffline } from './tutorialData';

const { sites, layers } = loadOffline();
const Y2027 = Date.UTC(2027, 0, 1);
const days2027 = (stepH: number): number[] => Array.from({ length: Math.floor((365 * 24) / stepH) }, (_, k) => Y2027 + k * stepH * HOUR_MS);
const log = (...a: unknown[]): void => console.log(...a);
const out: Record<string, unknown> = {};
const t0 = Date.now();

// ---- mission 0: first landing (prefer the Shackleton ridge, the classic polar site)
m0: for (const site of [...sites].sort((a) => (a.siteId === 'shackleton-ridge' ? -1 : 1))) {
  for (const startMs of days2027(6)) {
    const r = fly(site.dem, inputFor(site, layers, { startMs, days: 3 }));
    const c = checkFirstLanding(r);
    if (c.ok && c.startPct < 50) {
      out.m0 = { siteId: site.siteId, startMs, days: 14, ...c };
      log('m0', site.siteId, new Date(startMs).toISOString(), c);
      break m0;
    }
  }
}

// ---- mission 1: a 2027 date with no sunlight and no Earth link, and landing windows within the next 60 days
m1: for (const site of sites) {
  let tries = 0;
  for (const startMs of days2027(24)) {
    const input = inputFor(site, layers, { startMs, days: 14 });
    const r = fly(site.dem, input);
    if (r.sunFrac[0] !== 0 || (r.state[0] & STATE_RF_PHYSICAL) !== 0 || missionVerdict(r).level !== 'nogo') continue;
    if (++tries > 3) break;
    const c = checkBadDate(site.dem, input, r);
    log('m1 try', site.siteId, new Date(startMs).toISOString(), c);
    if (c.ok) { out.m1 = { siteId: site.siteId, startMs, days: 14, ...c }; break m1; }
  }
}

// ---- mission 2: steep aim point with level ground within 150 m, inside the relocation box
{
  let best: Record<string, number | string> | null = null;
  const step = 32, lim = RELOCATION_LIMIT_M - 50;
  for (const site of sites) {
    const pts: { dx: number; dy: number; s: number; p: number }[] = [];
    for (let dy = -lim; dy <= lim; dy += step) for (let dx = -lim; dx <= lim; dx += step) {
      const { slopeDeg: s, tipP: p } = slopeAt(site.dem, site, dx, dy);
      pts.push({ dx, dy, s, p });
    }
    for (const a of pts) {
      if (a.s <= 15 || a.s > 30) continue;
      for (const b of pts) {
        const d = Math.hypot(b.dx - a.dx, b.dy - a.dy);
        if (d > 150 || d < 60 || b.s >= 5 || b.p > 0.01) continue;
        const score = a.p - b.p + (a.s - b.s) / 100;
        if (!best || score > (best.score as number)) best = { siteId: site.siteId, dxM: a.dx, dyM: a.dy, slopeDeg: a.s, tipP: a.p, safeDxM: b.dx, safeDyM: b.dy, safeSlopeDeg: b.s, safeTipP: b.p, distanceM: d, score };
      }
    }
  }
  out.m2 = best;
  log('m2', best);
}

// ---- mission 3: the deck array freezes, the 10 m mast survives (same site and date)
m3: for (const site of sites) {
  for (const startMs of days2027(48)) {
    const low = fly(site.dem, inputFor(site, layers, { startMs, days: 14, mastM: 2 }));
    if (low.kpis.survives || low.adv.kpis.thermalDeathH === null || low.adv.kpis.thermalDeathH < 24) continue;
    const high = fly(site.dem, inputFor(site, layers, { startMs, days: 14, mastM: 10 }));
    const c = checkMast(low, high);
    if (c.ok) { out.m3 = { siteId: site.siteId, startMs, days: 14, ...c }; log('m3', site.siteId, new Date(startMs).toISOString(), c); break m3; }
  }
}

// ---- mission 4: the Earth hides behind the terrain; the relay restores the link
m4: for (const site of sites) {
  let tries = 0;
  for (const startMs of days2027(72)) {
    const direct = fly(site.dem, inputFor(site, layers, { startMs, days: 14 }));
    const v = missionVerdict(direct);
    if (v.linkPct >= 50 || !direct.kpis.survives) continue;
    if (++tries > 6) break;
    const relay = fly(site.dem, inputFor(site, layers, { startMs, days: 14, relay: { enabled: true } }));
    const c = checkRelay(direct, relay);
    log('m4 try', site.siteId, new Date(startMs).toISOString(), c);
    if (c.ok) { out.m4 = { siteId: site.siteId, startMs, days: 14, relayRateMbps: relay.kpis.meanRateMbps, ...c }; break m4; }
  }
}

// ---- mission 5: IM-1 tilt with the antenna fixed; the smallest gimbal range that brings the downlink back
m5: for (const site of sites) {
  for (const startMs of days2027(24 * 15)) {
    const nominal = fly(site.dem, inputFor(site, layers, { startMs, days: 14 }));
    const n = nominal.adv.kpis.rfAvailabilityPct;
    if (n < 15) continue;
    // The antenna starts fixed (gimbal 0°): the tutorial lander has a stowed antenna until the user frees the gimbal.
    const tilted = fly(site.dem, inputFor(site, layers, { startMs, days: 14, attitude: { ...im1Attitude(), gimbalRangeDeg: 0 } }));
    const t = tilted.adv.kpis.rfAvailabilityPct;
    if (t > 0.5 * n) continue;
    for (let g = 5; g <= 60; g += 5) {
      const fixed = fly(site.dem, inputFor(site, layers, { startMs, days: 14, attitude: { ...im1Attitude(), gimbalRangeDeg: g } }));
      if (fixed.adv.kpis.rfAvailabilityPct >= 0.9 * n) {
        out.m5 = { siteId: site.siteId, startMs, days: 14, nominalPct: n, tiltedPct: t, gimbalDeg: g, fixedPct: fixed.adv.kpis.rfAvailabilityPct };
        log('m5', out.m5);
        break m5;
      }
    }
  }
}

// ---- mission 7: emergency from a fixed "now": lost as declared, saved by moving within 500 m
{
  const site = sites.find((s) => s.siteId === 'nobile-rim') ?? sites[0];
  const startMs = Date.UTC(2027, 8, 1);
  const base = fly(site.dem, inputFor(site, layers, { startMs, days: 15 }));
  let best: Record<string, number> | null = null;
  for (let k = 0; k < 25; k++) {
    const e = -500 + (k % 5) * 250, n = -500 + Math.floor(k / 5) * 250;
    const d = Math.hypot(e, n);
    if (d < 1 || d > 501) continue;
    const r = fly(site.dem, inputFor(site, layers, { startMs, days: 15, dxM: e, dyM: n }));
    if (r.kpis.survives && (!best || d < best.distanceM)) best = { eastM: e, northM: n, distanceM: d, minSocPct: r.kpis.minSocPct };
  }
  out.m7 = { siteId: site.siteId, nowMs: startMs, days: 15, energyWh: DEFAULT_POWER.batteryCapacityWh, baseSurvives: base.kpis.survives, baseLossH: base.adv.kpis.survivalHours, move: best };
  log('m7', out.m7);
}

const header = `/**
 * Scenarios of the beginner tutorial, found with the real engine by
 * scripts/find-tutorial-scenarios.ts (${new Date().toISOString().slice(0, 10)}). Do not edit by hand: run
 * \`npm run find-scenarios\`. The unit test src/beginner/__tests__/scenarios.test.ts
 * re-checks every condition against the engine. The measured values are kept
 * for the record (ARCHITECTURE.md, docs/guion-principiante.md); the narration
 * always reads the live values from the app.
 */
`;
writeFileSync(join(process.cwd(), 'src', 'beginner', 'scenarios.ts'), `${header}export const TUTORIAL_SCENARIOS = ${JSON.stringify(out, null, 2)} as const;\n`);
log(`written in ${((Date.now() - t0) / 1000).toFixed(0)} s; missing: ${['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm7'].filter((k) => !out[k]).join(', ') || 'none'}`);
