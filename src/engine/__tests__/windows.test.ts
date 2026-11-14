/** v3 audit, second iteration: landing-window finder with approach lighting (E6), Deygout diffraction (E5), tip-over probability (E4). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, DEFAULT_POWER, DEFAULT_RF, DEFAULT_THERMAL, DEFAULT_TIPOVER, DEFAULT_WINDOW_CONFIG, DemManifest, DemStack, G_MOON_M_S2, HOUR_MS,
  LandingCandidate, MissionInput, REJECT_PRIORITY, STATE_RF_PHYSICAL, approachLighting, candidateTimes, computeHorizon, criticalVelocityMs,
  decodeGrid, deygoutLossDb, ellipseLitFraction, evaluateMission, findLandingWindows, fresnelNu, groupLandingWindows, knifeEdgeLossDb,
  latLonToXY, makeEllipseSweep, makeObserver, primaryReason, rejectionCounts, staticStabilityDeg, terrainProfile, tipoverMap,
  tipoverProbability,
} from '../index';

const dir = join(process.cwd(), 'public', 'dem');
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const cand = (k: number, ok: boolean, dataGb = 1, reasons: LandingCandidate['reasons'] = []): LandingCandidate => ({
  timeMs: k * 12 * HOUR_MS, ok, reasons: ok ? [] : reasons.length ? reasons : ['dark'], sunElDeg: 1, sunAzDeg: 0, sunRelDeg: 0, ellipseLitPct: 80,
  survives: true, survivalHours: 100, linkPct: 50, illuminationPct: 80, energyWh: 1000, dataGb, minSocPct: 50,
});

describe('E6 approach lighting', () => {
  const cfg = { approachAzDeg: 180, glareHalfDeg: 25, washoutHalfDeg: 15 };
  it('flags the Sun ahead as glare and the Sun behind as washout', () => {
    expect(approachLighting(180, cfg)).toMatchObject({ relDeg: 0, glare: true, washout: false });
    expect(approachLighting(200, cfg).glare).toBe(true);
    expect(approachLighting(206, cfg).glare).toBe(false);
    expect(approachLighting(0, cfg)).toMatchObject({ glare: false, washout: true });
    expect(approachLighting(350, cfg).washout).toBe(true); // 170 deg off the heading
    expect(approachLighting(344, cfg).washout).toBe(false);
    expect(approachLighting(90, cfg)).toMatchObject({ relDeg: -90, glare: false, washout: false }); // cross-lit
  });
  it('wraps headings across north', () => {
    expect(approachLighting(350, { ...cfg, approachAzDeg: 10 }).relDeg).toBeCloseTo(-20, 9);
    expect(approachLighting(10, { ...cfg, approachAzDeg: 350 }).glare).toBe(true);
  });
});

describe('landing windows: grouping and reasons', () => {
  it('groups consecutive accepted candidates and keeps the best of each run', () => {
    const cs = [cand(0, false), cand(1, true, 2), cand(2, true, 5), cand(3, true, 3), cand(4, false), cand(5, true, 1)];
    const w = groupLandingWindows(cs, 12);
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ startMs: 12 * HOUR_MS, endMs: 48 * HOUR_MS, openHours: 36, count: 3 });
    expect(w[0].best.dataGb).toBe(5);
    expect(w[1]).toMatchObject({ count: 1, openHours: 12 });
    expect(groupLandingWindows([cand(0, false)], 12)).toHaveLength(0);
  });
  it('counts every reason and labels a candidate by priority', () => {
    const cs = [cand(0, false, 0, ['glare', 'thermal']), cand(1, false, 0, ['glare']), cand(2, true)];
    const n = rejectionCounts(cs);
    expect(n.glare).toBe(2);
    expect(n.thermal).toBe(1);
    expect(n.dark).toBe(0);
    expect(primaryReason(cs[0])).toBe('thermal');
    expect(primaryReason(cs[1])).toBe('glare');
    expect(primaryReason(cs[2])).toBeNull();
    expect(new Set(REJECT_PRIORITY).size).toBe(9);
  });
  it('lays candidate times on the requested spacing', () => {
    const t = candidateTimes(1000, { searchDays: 2, candidateStepHours: 12 });
    expect(t).toEqual([1000, 1000 + 12 * HOUR_MS, 1000 + 24 * HOUR_MS, 1000 + 36 * HOUR_MS, 1000 + 48 * HOUR_MS]);
  });
});

describe('E5 Deygout diffraction', () => {
  const lambda = 0.0357; // X band
  it('reduces to the single knife edge when there is one ridge', () => {
    // One ridge 5 m above a horizontal ray at 1 km; everything else far below.
    const dist = [200, 500, 1000, 2000, 5000];
    const tan = [-0.05, -0.05, 5 / 1000, -0.05, -0.05];
    const r = deygoutLossDb(dist, tan, 0, lambda);
    const single = knifeEdgeLossDb(fresnelNu(5, 1000, lambda));
    expect(r.mainDistM).toBe(1000);
    expect(r.mainDb).toBeCloseTo(single, 9);
    expect(r.totalDb).toBeCloseTo(single, 9);
    expect(r.edges).toBe(1);
  });
  it('is zero when the ray clears the terrain comfortably', () => {
    const r = deygoutLossDb([500, 1000, 3000], [-0.02, -0.01, -0.02], 0.02, lambda);
    expect(r.totalDb).toBe(0);
    expect(r.edges).toBe(0);
  });
  it('adds a second ridge beyond the first, matching the hand calculation', () => {
    // Principal ridge 5 m above the ray at 1 km; second ridge at 3 km, 2 m above the ray leaving the first.
    const dist = [500, 1000, 3000, 6000];
    const tan = [-0.05, 5 / 1000, 7 / 3000, -0.05];
    const r = deygoutLossDb(dist, tan, 0, lambda);
    const main = knifeEdgeLossDb(fresnelNu(5, 1000, lambda));
    const second = knifeEdgeLossDb(fresnelNu(7 - 5, 2000, lambda));
    expect(r.mainDb).toBeCloseTo(main, 9);
    expect(r.rxDb).toBeCloseTo((1 - Math.exp(-main / 6)) * second, 9);
    expect(r.txDb).toBe(0);
    expect(r.rxDistM).toBe(3000);
    expect(r.edges).toBe(2);
    expect(r.totalDb).toBeGreaterThan(main + 5);
  });
  it('adds a ridge between the lander and the principal edge', () => {
    // A nearer ridge that just touches the line to the top of the principal edge: nu = 0, J = 6 dB.
    const dist = [400, 1000, 4000];
    const tan = [5 / 1000, 5 / 1000, -0.05];
    const r = deygoutLossDb(dist, tan, 0, lambda);
    const main = knifeEdgeLossDb(fresnelNu(5, 1000, lambda));
    expect(r.txDb).toBeCloseTo((1 - Math.exp(-main / 6)) * knifeEdgeLossDb(0), 9);
    expect(r.txDistM).toBe(400);
  });
  it('ignores samples that belong to the principal ridge itself', () => {
    const r = deygoutLossDb([950, 1000, 1050], [5 / 1000, 5 / 1000, 5 / 1000], 0, lambda);
    expect(r.edges).toBe(1);
  });
  it('accepts a principal edge supplied by the horizon profile', () => {
    const r = deygoutLossDb([400, 3000], [-0.05, 7 / 3000], 0, lambda, { distM: 1000, tan: 5 / 1000 });
    expect(r.mainDistM).toBe(1000);
    expect(r.rxDistM).toBe(3000);
  });
});

describe('E4 tip-over probability', () => {
  const c = DEFAULT_TIPOVER;
  it('matches the energy criterion by hand', () => {
    const beta = Math.atan2(c.tipRadiusM, c.cgHeightM);
    expect(staticStabilityDeg(c)).toBeCloseTo((beta * 180) / Math.PI, 9);
    const L = Math.hypot(c.cgHeightM, c.tipRadiusM);
    expect(criticalVelocityMs(c, 0)).toBeCloseTo(Math.sqrt(2 * G_MOON_M_S2 * L * (1 - Math.cos(beta))), 9);
    expect(criticalVelocityMs(c, staticStabilityDeg(c) + 1)).toBe(0);
    expect(criticalVelocityMs(c, 10)).toBeLessThan(criticalVelocityMs(c, 0));
  });
  it('on level ground with no slope error equals the Rayleigh tail', () => {
    const flat = { ...c, sigmaSlopeDeg: 0 };
    const vc = criticalVelocityMs(flat, 0);
    expect(tipoverProbability(flat, 0)).toBeCloseTo(Math.exp(-(vc * vc) / (2 * flat.sigmaVelMs ** 2)), 9);
  });
  it('grows with slope, with residual velocity and with a higher centre of mass', () => {
    const p0 = tipoverProbability(c, 0), p10 = tipoverProbability(c, 10), p20 = tipoverProbability(c, 20);
    expect(p10).toBeGreaterThan(p0);
    expect(p20).toBeGreaterThan(p10);
    expect(tipoverProbability({ ...c, sigmaVelMs: 1 }, 5)).toBeGreaterThan(tipoverProbability(c, 5));
    expect(tipoverProbability({ ...c, cgHeightM: 3 }, 5)).toBeGreaterThan(tipoverProbability(c, 5));
    expect(tipoverProbability({ ...c, tipRadiusM: 3 }, 5)).toBeLessThan(tipoverProbability(c, 5));
  });
  it('stays a probability and saturates on a cliff', () => {
    for (const s of [0, 5, 15, 30, 60, 85]) {
      const p = tipoverProbability(c, s);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // Steeper than the stability angle: every downhill direction tips, uphill ones do not.
    const p = tipoverProbability({ ...c, sigmaSlopeDeg: 0, sigmaVelMs: 0 }, 80);
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.5);
    expect(tipoverProbability({ ...c, sigmaSlopeDeg: 0, sigmaVelMs: 0 }, 5)).toBe(0);
  });
});

describe('on the LOLA terrain', () => {
  const site = CANDIDATE_SITES[0];
  let dem: DemStack;
  let input: MissionInput;
  beforeAll(() => {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
    const info = manifest.sites.find((s) => s.id === site.id);
    if (!info) throw new Error('missing site grid');
    const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
    dem = { regional: decodeGrid(load(manifest.regional.file), manifest.regional), local: decodeGrid(load(info.file), info, cx, cy) };
    input = {
      latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days: 14, stepHours: 1, mastM: 2,
      power: DEFAULT_POWER, rf: DEFAULT_RF, thermal: DEFAULT_THERMAL,
    };
  });

  it('finds windows and explains every rejection', () => {
    const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
    const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
    const cfg = { ...DEFAULT_WINDOW_CONFIG, searchDays: 30, candidateStepHours: 24, missionDays: 5, stepHours: 2 };
    const s = findLandingWindows(dem, input, hz, input.startMs, cfg);
    expect(s.candidates).toHaveLength(31);
    for (const c of s.candidates) {
      expect(c.ok).toBe(c.reasons.length === 0);
      expect(c.ellipseLitPct).not.toBeNull();
      // The Sun turns once a synodic month, so glare and washout cannot hold together.
      expect(c.reasons.includes('glare') && c.reasons.includes('washout')).toBe(false);
    }
    const accepted = s.candidates.filter((c) => c.ok).length;
    expect(s.windows.reduce((n, w) => n + w.count, 0)).toBe(accepted);
    expect(s.acceptedPct).toBeCloseTo((100 * accepted) / 31, 9);
    // Over a synodic month the Sun crosses both the heading and its reverse: lighting must reject some days.
    expect(s.counts.glare + s.counts.washout + s.counts.dark).toBeGreaterThan(0);
    // Reversing the approach swaps glare and washout days rather than removing them.
    const rev = findLandingWindows(dem, input, hz, input.startMs, { ...cfg, approachAzDeg: 0 });
    const flagged = (k: LandingCandidate[]) => k.filter((c) => c.reasons.includes('glare') || c.reasons.includes('washout')).length;
    expect(flagged(rev.candidates)).toBeGreaterThan(0);
  }, 120_000);

  it('the ellipse is darker with the Sun below the skyline than well above it', () => {
    const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
    const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
    const sweep = makeEllipseSweep(dem, hz, 200);
    expect(sweep).not.toBeNull();
    if (!sweep) return;
    expect(sweep.cells.length).toBeGreaterThan(100);
    expect(ellipseLitFraction(sweep, hz, 40, 30)).toBeGreaterThan(0.95);
    expect(ellipseLitFraction(sweep, hz, 40, -5)).toBeLessThan(0.05);
  });

  it('secondary ridges only ever add loss and leave a clear link untouched', () => {
    const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
    const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
    const r = evaluateMission(dem, { ...input, days: 30 }, hz);
    let diffracting = 0;
    for (let i = 0; i < r.count; i++) {
      const sec = r.adv.secondaryDiffractionDb[i];
      expect(sec).toBeGreaterThanOrEqual(0);
      if (r.adv.diffractionDb[i] === 0) expect(sec).toBe(0);
      if (sec > 0) { diffracting++; expect(r.adv.diffractionDb[i]).toBeGreaterThanOrEqual(sec); }
      if (r.state[i] & STATE_RF_PHYSICAL) expect(r.adv.diffractionDb[i]).toBeLessThan(99);
    }
    expect(r.adv.kpis.maxSecondaryDiffractionDb).toBeGreaterThanOrEqual(0);
    expect(r.adv.kpis.secondaryEdgeHours).toBeLessThanOrEqual(diffracting * r.stepHours + 1e-9);
    const prof = terrainProfile(dem, hz.observer, 0);
    expect(prof.distM.length).toBeGreaterThan(100);
    expect(prof.distM[1]).toBeGreaterThan(prof.distM[0]);
  }, 60_000);

  it('maps the tip-over probability over the landing ellipse', () => {
    const m = tipoverMap(dem, { latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0 }, DEFAULT_TIPOVER);
    expect(m.cells).toHaveLength(25);
    expect(m.centre.eastM).toBe(0);
    expect(m.centre.northM).toBe(0);
    expect(m.maxP).toBeGreaterThanOrEqual(m.meanP);
    const steepest = m.cells.reduce((a, b) => (b.slopeDeg > a.slopeDeg ? b : a));
    expect(steepest.p).toBeCloseTo(m.maxP, 12);
    expect(steepest.slopeDeg).toBeCloseTo(m.maxSlopeDeg, 12);
  });
});
