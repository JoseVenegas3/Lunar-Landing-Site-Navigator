import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, DEFAULT_POWER, DEFAULT_RELAY, DEFAULT_RF, DemManifest, DemStack, HorizonProfile, MOON_SIDEREAL_S, MU_MOON,
  OrbitElements, RELAY_EPOCH_MS, RELAY_PRESETS, R_MOON_KM, STATE_DTE, STATE_RELAY, apoapsisAltKm, constellation, decodeGrid,
  evaluateScenario, latLonToXY, orbitalPeriodS, periapsisAltKm, relayCoverageFraction, relayPosition, relayShape, relayView,
  seesEarth, siteFrame, solveKepler, subSatellitePoint, wrap180,
} from '../index';

const elfo = RELAY_PRESETS[0].shape;
const sat = (over: Partial<OrbitElements> = {}): OrbitElements => ({ ...elfo, raanDeg: 0, meanAnomalyDeg: 0, ...over });

/** Horizon of a smooth sphere seen from the surface: 0 deg everywhere. */
function flatHorizon(latDeg: number, lonDeg: number): HorizonProfile {
  const [x, y] = latLonToXY(latDeg, lonDeg);
  return {
    observer: { x, y, latDeg, lonDeg, groundKm: 0, heightKm: 0 },
    elevDeg: new Float32Array(360), distKm: new Float32Array(360).fill(1),
    farElevDeg: new Float32Array(360), farDistKm: new Float32Array(360).fill(1),
  };
}

describe('relay orbits', () => {
  it('solves Kepler\'s equation', () => {
    for (const e of [0, 0.1, 0.58, 0.9]) {
      for (let m = -6; m <= 6; m += 0.37) {
        const ecc = solveKepler(m, e);
        const back = ecc - e * Math.sin(ecc);
        expect(Math.abs(Math.sin(back) - Math.sin(m))).toBeLessThan(1e-9);
        expect(Math.abs(Math.cos(back) - Math.cos(m))).toBeLessThan(1e-9);
      }
    }
  });

  it('gives the elliptical frozen orbit its 10.8 h period and southern apoapsis', () => {
    expect(orbitalPeriodS(elfo.aKm) / 3600).toBeCloseTo(10.84, 1);
    expect(periapsisAltKm(elfo)).toBeCloseTo(5740 * 0.42 - R_MOON_KM, 6);
    expect(apoapsisAltKm(elfo)).toBeGreaterThan(7000);
    // Mean anomaly 180 deg = apoapsis: far above the southern hemisphere.
    const apo = subSatellitePoint(sat({ meanAnomalyDeg: 180 }), RELAY_EPOCH_MS);
    expect(apo.latDeg).toBeLessThan(-50);
    expect(apo.altKm).toBeCloseTo(apoapsisAltKm(elfo), 3);
    const peri = subSatellitePoint(sat(), RELAY_EPOCH_MS);
    expect(peri.latDeg).toBeGreaterThan(50);
    expect(peri.altKm).toBeCloseTo(periapsisAltKm(elfo), 3);
    // Kepler's second law: it lingers over the south.
    let south = 0;
    const steps = 2000, period = orbitalPeriodS(elfo.aKm) * 1000;
    for (let i = 0; i < steps; i++) if (subSatellitePoint(sat(), RELAY_EPOCH_MS + (i / steps) * period).latDeg < 0) south++;
    expect(south / steps).toBeGreaterThan(0.75);
  });

  it('conserves the orbit radius and energy and closes after one period', () => {
    const p = new Float64Array(3), q = new Float64Array(3);
    const circ = sat({ aKm: 3000, e: 0, incDeg: 70 });
    for (let h = 0; h < 30; h += 1.3) {
      relayPosition(circ, RELAY_EPOCH_MS + h * 3_600_000, p);
      expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(3000, 6);
    }
    // In the rotating frame the track does not close after one orbit; in the inertial
    // frame it does. Undo the lunar rotation to compare.
    const T = orbitalPeriodS(elfo.aKm);
    relayPosition(sat({ meanAnomalyDeg: 40 }), RELAY_EPOCH_MS, p);
    relayPosition(sat({ meanAnomalyDeg: 40 }), RELAY_EPOCH_MS + T * 1000, q);
    const turn = (2 * Math.PI * T) / MOON_SIDEREAL_S;
    const qx = q[0] * Math.cos(turn) - q[1] * Math.sin(turn), qy = q[0] * Math.sin(turn) + q[1] * Math.cos(turn);
    expect(qx).toBeCloseTo(p[0], 4);
    expect(qy).toBeCloseTo(p[1], 4);
    expect(q[2]).toBeCloseTo(p[2], 4);
  });

  it('keeps a selenostationary satellite over a fixed longitude', () => {
    // Circular equatorial orbit with the lunar sidereal period: fixed in the rotating frame.
    const a = Math.cbrt(MU_MOON * (MOON_SIDEREAL_S / (2 * Math.PI)) ** 2);
    expect(a).toBeGreaterThan(88_000);
    expect(a).toBeLessThan(89_000);
    const el = sat({ aKm: a, e: 0, incDeg: 0, argPeriDeg: 0, raanDeg: 0, meanAnomalyDeg: 33 });
    const lon0 = subSatellitePoint(el, RELAY_EPOCH_MS).lonDeg;
    for (let d = 1; d <= 40; d += 3.7) {
      expect(wrap180(subSatellitePoint(el, RELAY_EPOCH_MS + d * 86_400_000).lonDeg - lon0)).toBeCloseTo(0, 6);
    }
    expect(lon0).toBeCloseTo(33, 6);
  });

  it('limits custom orbits so the periapsis clears the surface, and phases constellations evenly', () => {
    const shape = relayShape({ ...DEFAULT_RELAY, preset: 'custom', custom: { aKm: 2500, e: 0.9, incDeg: 80, argPeriDeg: 90 } });
    expect(periapsisAltKm(shape)).toBeCloseTo(20, 6);
    const four = constellation({ ...DEFAULT_RELAY, enabled: true, count: 4, planes: 2 });
    expect(four).toHaveLength(4);
    expect(new Set(four.map((s) => s.raanDeg)).size).toBe(2);
    const single = constellation({ ...DEFAULT_RELAY, count: 3, planes: 1 });
    expect(single.map((s) => s.meanAnomalyDeg)).toEqual([0, 120, 240]);
    expect(constellation({ ...DEFAULT_RELAY, count: 50, planes: 99 })).toHaveLength(8);
  });
});

describe('relay visibility', () => {
  it('detects occultation of the relay-to-Earth line by the Moon', () => {
    const earth: [number, number, number] = [384_400, 0, 0];
    expect(seesEarth([5000, 0, 0], ...earth)).toBe(true); // between Moon and Earth
    expect(seesEarth([-5000, 0, 0], ...earth)).toBe(false); // directly behind the Moon
    expect(seesEarth([-5000, 3000, 0], ...earth)).toBe(true); // behind, but clear of the limb
    expect(seesEarth([0, 0, -9000], ...earth)).toBe(true); // over the south pole
  });

  it('places a satellite over the pole at the zenith of a polar lander', () => {
    const frame = siteFrame(-89.99, 0, 0);
    const hz = flatHorizon(-89.99, 0);
    // Polar circular orbit; find the instant it crosses the south pole.
    const el = sat({ aKm: R_MOON_KM + 500, e: 0, incDeg: 90, argPeriDeg: 0 });
    let best = { el: -90, t: 0 };
    for (let s = 0; s < orbitalPeriodS(el.aKm); s += 5) {
      const v = relayView(el, RELAY_EPOCH_MS + s * 1000, frame, hz, 2, 384_400, 0, 0);
      if (v.elDeg > best.el) best = { el: v.elDeg, t: s };
    }
    expect(best.el).toBeGreaterThan(89);
    const top = relayView(el, RELAY_EPOCH_MS + best.t * 1000, frame, hz, 2, 384_400, 0, 0);
    expect(top.rangeKm).toBeCloseTo(500, -1);
    expect(top.usable).toBe(true);
    // Half an orbit later it is over the north pole: far below the horizon.
    const far = relayView(el, RELAY_EPOCH_MS + (best.t + orbitalPeriodS(el.aKm) / 2) * 1000, frame, hz, 2, 384_400, 0, 0);
    expect(far.elDeg).toBeLessThan(-80);
    expect(far.usable).toBe(false);
  });

  it('gives an elliptical frozen orbit far more polar coverage than a low orbit, and more with more satellites', () => {
    const frame = siteFrame(-89.5, 0, 0);
    const hz = flatHorizon(-89.5, 0);
    const coverage = (sats: OrbitElements[]): number => {
      let sum = 0;
      const hours = 24 * 20;
      for (let h = 0; h < hours; h++) sum += relayCoverageFraction(sats, RELAY_EPOCH_MS + h * 3_600_000, 1, frame, hz, 2, 384_400, 0, 0);
      return sum / hours;
    };
    const one = coverage(constellation({ ...DEFAULT_RELAY, preset: 'elfo', count: 1, planes: 1 }));
    const two = coverage(constellation({ ...DEFAULT_RELAY, preset: 'elfo', count: 2, planes: 1 }));
    const low = coverage(constellation({ ...DEFAULT_RELAY, preset: 'polar', count: 1, planes: 1 }));
    expect(one).toBeGreaterThan(0.55);
    expect(one).toBeLessThan(0.95);
    expect(two).toBeGreaterThan(one + 0.05);
    expect(two).toBeGreaterThan(0.9);
    expect(low).toBeLessThan(0.2);
    expect(low).toBeGreaterThan(0.01);
  });
});

describe('relay in a scenario on LOLA terrain', () => {
  const dir = join(process.cwd(), 'public', 'dem');
  const load = (file: string): ArrayBuffer => {
    const b = readFileSync(join(dir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  it('closes direct-to-Earth outages at the Shackleton ridge', () => {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
    const site = CANDIDATE_SITES[0];
    const info = manifest.sites.find((s) => s.id === site.id);
    if (!info) throw new Error('missing site grid');
    const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
    const dem: DemStack = { regional: decodeGrid(load(manifest.regional.file), manifest.regional), local: decodeGrid(load(info.file), info, cx, cy) };
    const base = { latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days: 30, stepHours: 1, mastM: 2, power: DEFAULT_POWER, rf: DEFAULT_RF };

    const direct = evaluateScenario(dem, base);
    expect(direct.kpis.relayPct).toBe(0);
    expect(direct.kpis.anyLinkPct).toBeCloseTo(direct.kpis.dtePct, 9);
    expect(direct.kpis.longestLinkOutageH).toBe(direct.kpis.longestDteGapH);
    expect(direct.relaySats).toHaveLength(0);

    const one = evaluateScenario(dem, { ...base, relay: { ...DEFAULT_RELAY, enabled: true, count: 1 } });
    const two = evaluateScenario(dem, { ...base, relay: { ...DEFAULT_RELAY, enabled: true, count: 2 } });
    // The direct link is unchanged; the relay only adds.
    expect(one.kpis.dtePct).toBeCloseTo(direct.kpis.dtePct, 9);
    expect(one.kpis.anyLinkPct).toBeGreaterThan(direct.kpis.dtePct + 20);
    expect(two.kpis.anyLinkPct).toBeGreaterThanOrEqual(one.kpis.anyLinkPct);
    expect(two.kpis.anyLinkPct).toBeGreaterThan(90);
    expect(one.kpis.longestLinkOutageH).toBeLessThan(direct.kpis.longestDteGapH / 5);
    expect(one.kpis.relayDataGb).toBeGreaterThan(0);
    // Bookkeeping: state bits and coverage fraction agree.
    for (let i = 0; i < one.count; i++) {
      expect((one.state[i] & STATE_RELAY) !== 0).toBe(one.relayFrac[i] > 0);
      expect(one.relayFrac[i]).toBeLessThanOrEqual(1);
    }
    const any = one.state.reduce((a, s, i) => a + ((s & STATE_DTE) ? 1 : one.relayFrac[i]), 0);
    expect(one.kpis.anyLinkPct).toBeCloseTo((100 * any) / one.count, 5); // relayFrac is stored as float32
  });
});
