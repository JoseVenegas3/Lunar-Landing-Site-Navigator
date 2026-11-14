/** Evolutions of the v3 audit: sky view factor (E2), terrain-uncertainty ensemble (E1), hindcast site (E3), ground stations (E7). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, CUSTOM_LAT_MAX, DEFAULT_POWER, DEFAULT_RF, DEFAULT_THERMAL, DEFAULT_UNCERTAINTY, DemManifest, DemStack, GROUND_STATIONS,
  HISTORICAL_LANDINGS, HorizonProfile, MemberOutcome, NEAR_FIELD_KM, STATE_RF_PHYSICAL, STATE_SUN, computeGroundContact, computeHorizon,
  computeHorizonEnsemble, decodeGrid, evaluateMission, fieldRmsM, gridContains, groundStation, heightErrorField, latLonToXY, linkBudget,
  makeObserver, quantiles, requiredGroundStation, resampleLocalGrid, seededRandom, simulateElectroThermalTimeline, sinkT4, skyViewFactor,
  skylineShiftDeg, summariseEnsemble, terrainLitSeries,
} from '../index';

const dir = join(process.cwd(), 'public', 'dem');
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

function ring(elevDeg: number): HorizonProfile {
  return {
    observer: { x: 0, y: -50, latDeg: -88.35, lonDeg: 180, groundKm: 0, heightKm: 0 },
    elevDeg: new Float32Array(360).fill(elevDeg), distKm: new Float32Array(360).fill(1),
    farElevDeg: new Float32Array(360).fill(elevDeg), farDistKm: new Float32Array(360).fill(1),
  };
}

describe('E2 sky view factor and terrain infrared', () => {
  it('integrates cos^2 of the horizon elevation', () => {
    expect(skyViewFactor(ring(0))).toBeCloseTo(1, 12);
    expect(skyViewFactor(ring(30))).toBeCloseTo(0.75, 9);
    expect(skyViewFactor(ring(60))).toBeCloseTo(0.25, 9);
    expect(skyViewFactor(ring(-3))).toBeCloseTo(1, 12); // a summit sees no more than the whole sky
    const half = ring(0);
    for (let a = 0; a < 180; a++) half.elevDeg[a] = 45;
    expect(skyViewFactor(half)).toBeCloseTo(0.75, 9); // half the azimuths at cos^2 = 0.5
  });

  it('mixes sky and terrain in the radiative sink', () => {
    expect(sinkT4(0, 200)).toBeCloseTo(200 ** 4, 3);
    // Flat plain: the upper half of the bus sees 3 K sky, the lower half the ground.
    expect(sinkT4(1, 200)).toBeCloseTo(0.5 * 3 ** 4 + 0.5 * 200 ** 4, 3);
    expect(sinkT4(0.5, 200)).toBeGreaterThan(sinkT4(1, 200));
  });

  it('matters when the surroundings are sunlit, and hardly at all when they are dark', () => {
    const n = 200, p = new Float32Array(n), f = new Float32Array(n);
    const cold = { ...DEFAULT_THERMAL, heaterW: 0 };
    const death = (skyView: number, lit: number): number =>
      simulateElectroThermalTimeline(DEFAULT_POWER, cold, p, f, 1, { skyView, terrainLit: new Float32Array(n).fill(lit) }).thermalDeathIndex;
    // Shadowed lander with dark terrain around: a 70 K wall and a 3 K sky are both "cold"
    // next to a 270 K bus (70^4 / 270^4 = 0.5 %), so the hollow hardly changes the outcome.
    const openDark = death(1, 0), hollowDark = death(0.5, 0);
    expect(openDark).toBeGreaterThan(10);
    expect(Math.abs(hollowDark - openDark)).toBeLessThanOrEqual(1);
    // Shadowed lander with sunlit slopes around (230 K): they return real heat.
    const openLit = death(1, 1), hollowLit = death(0.5, 1);
    expect(openLit).toBeGreaterThan(openDark + 2);
    expect(hollowLit).toBeGreaterThan(openLit + 2);
    // Without the environment argument the original single-sink model is unchanged.
    const legacy = simulateElectroThermalTimeline(DEFAULT_POWER, cold, p, f, 1);
    const same = simulateElectroThermalTimeline(DEFAULT_POWER, cold, p, f, 1, { skyView: 0 });
    expect(same.thermalDeathIndex).toBe(legacy.thermalDeathIndex);
  });
});

describe('E7 ground stations', () => {
  it('lists the South American and ESA options and marks the GISAT dish as hypothetical', () => {
    expect(GROUND_STATIONS.map((g) => g.id)).toEqual(['dsn34', 'estrack35', 'com13', 'ssc13', 'gisat37']);
    expect(groundStation('gisat37').name).toContain('hypothetical');
    const start = Date.UTC(2027, 8, 1);
    const esa = computeGroundContact(start, 20 * 24, 1, 'estrack35');
    expect(esa.sites.map((s) => s.name)).toEqual(['Cebreros', 'New Norcia', 'Malargüe']);
    const up = (c: { station: Int8Array }): number => Array.from(c.station).filter((s) => s >= 0).length / c.station.length;
    expect(up(esa)).toBeGreaterThan(0.85);
    const scl = computeGroundContact(start, 20 * 24, 1, 'ssc13');
    expect(up(scl)).toBeGreaterThan(0.25);
    expect(up(scl)).toBeLessThan(0.55);
  });

  it('inverts the link budget: which G/T closes a target rate', () => {
    const rf = { ...DEFAULT_RF, groundStationId: 'gisat37' };
    const lb = linkBudget(rf, 384_400);
    // Asking for exactly the rate the station achieves must return the station.
    const need = requiredGroundStation(rf, 384_400, lb.powerLimitedRateBps, 0, 190, 0.55);
    expect(need.gOverTDbK).toBeCloseTo(lb.gOverTDbK, 6);
    expect(need.dishDiameterM).toBeCloseTo(3.7, 3);
    // Ten times the rate, or 10 dB of extra loss, costs 10 dB of G/T; a dish sqrt(10) times wider.
    const fast = requiredGroundStation(rf, 384_400, 10 * lb.powerLimitedRateBps, 0, 190, 0.55);
    expect(fast.gOverTDbK - need.gOverTDbK).toBeCloseTo(10, 6);
    expect(fast.dishDiameterM / need.dishDiameterM).toBeCloseTo(Math.sqrt(10), 4);
    expect(requiredGroundStation(rf, 384_400, lb.powerLimitedRateBps, 10, 190, 0.55).gOverTDbK - need.gOverTDbK).toBeCloseTo(10, 6);
  });
});

describe('E1 terrain-uncertainty ensemble', () => {
  it('builds a reproducible, correlated height-error field with the requested RMS', () => {
    const a = heightErrorField(10, -20, 0.4, 40, seededRandom(5));
    const b = heightErrorField(10, -20, 0.4, 40, seededRandom(5));
    const c = heightErrorField(10, -20, 0.4, 40, seededRandom(6));
    expect(fieldRmsM(a)).toBeCloseTo(0.4, 6);
    expect(Array.from(a.data.slice(0, 50))).toEqual(Array.from(b.data.slice(0, 50)));
    expect(a.data[1234]).not.toBe(c.data[1234]);
    expect(fieldRmsM(heightErrorField(0, 0, 0, 40, seededRandom(1)))).toBe(0);
    // Neighbouring samples (16 m apart) move together; samples 400 m apart do not.
    const corr = (lag: number): number => {
      let s = 0, m = 0;
      for (let j = 20; j < a.n - 20; j += 3) for (let i = 20; i < a.n - 20 - lag; i += 3) { s += a.data[j * a.n + i] * a.data[j * a.n + i + lag]; m++; }
      return s / m / (0.0004 * 0.0004);
    };
    expect(corr(1)).toBeGreaterThan(0.8);
    expect(Math.abs(corr(25))).toBeLessThan(0.2);
    // The field covers the perturbed zone around its centre.
    expect(a.x0).toBeLessThan(10 - NEAR_FIELD_KM);
    expect(skylineShiftDeg(0.4, 50)).toBeCloseTo(0.458, 2); // 0.4 m at 50 m is most of a solar diameter
    expect(quantiles([5, 1, 3, 2, 4])).toEqual({ p10: 1.4, p50: 3, p90: 4.6 });
  });

  describe('on LOLA terrain', () => {
    let dem: DemStack;
    let regional: DemStack['regional'];
    let manifest: DemManifest;
    const site = CANDIDATE_SITES[0];

    beforeAll(() => {
      manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
      regional = decodeGrid(load(manifest.regional.file), manifest.regional);
      const info = manifest.sites.find((s) => s.id === site.id);
      if (!info) throw new Error('missing site grid');
      const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
      dem = { regional, local: decodeGrid(load(info.file), info, cx, cy) };
    });

    it('collapses to the deterministic horizon when sigma is zero', () => {
      const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
      const base = computeHorizon(dem, makeObserver(dem, x, y, 2));
      const ens = computeHorizonEnsemble(dem, base, { ...DEFAULT_UNCERTAINTY, sigmaM: 0 });
      for (const k of [0, 7]) {
        const m = ens.member(k);
        for (let a = 0; a < 360; a++) expect(m.elevDeg[a]).toBeCloseTo(base.elevDeg[a], 3);
        expect(m.observer.heightKm).toBe(base.observer.heightKm);
      }
    });

    it('spreads the results more as the terrain error grows', () => {
      const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
      const input = {
        latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 300, dyM: 0, startMs: Date.UTC(2027, 3, 1), days: 20, stepHours: 1, mastM: 2,
        power: DEFAULT_POWER, rf: DEFAULT_RF, thermal: DEFAULT_THERMAL,
      };
      void x; void y;
      const base = evaluateMission(dem, input);
      const run = (sigmaM: number) => {
        const ens = computeHorizonEnsemble(dem, base.horizon, { members: 12, sigmaM, corrLenM: 40, seed: 99 });
        const outcomes: MemberOutcome[] = [];
        let spread = 0;
        for (let k = 0; k < 12; k++) {
          const hz = ens.member(k);
          for (let a = 0; a < 360; a += 10) spread = Math.max(spread, Math.abs(hz.elevDeg[a] - base.horizon.elevDeg[a]));
          const r = evaluateMission(dem, input, hz);
          const flags = new Uint8Array(r.count);
          for (let i = 0; i < r.count; i++) flags[i] = ((r.state[i] & STATE_SUN) ? 1 : 0) | ((r.state[i] & STATE_RF_PHYSICAL) ? 2 : 0);
          outcomes.push({
            illuminationPct: r.kpis.illuminationPct, dtePct: r.kpis.dtePct, downlinkPct: r.adv.kpis.rfAvailabilityPct, energyWh: r.kpis.energyWh,
            dataGb: r.kpis.dataGb, survivalHours: r.adv.kpis.survivalHours, survives: r.kpis.survives, flags,
          });
        }
        return { stats: summariseEnsemble(outcomes), spread };
      };
      const zero = run(0), small = run(0.4), large = run(2);
      expect(zero.spread).toBeLessThan(0.002);
      expect(zero.stats.illuminationSpreadPts).toBeCloseTo(0, 6);
      expect(zero.stats.illuminationPct.p50).toBeCloseTo(base.kpis.illuminationPct, 6);
      expect(small.spread).toBeGreaterThan(0.01);
      expect(large.spread).toBeGreaterThan(small.spread);
      expect(large.stats.illuminationSpreadPts).toBeGreaterThanOrEqual(small.stats.illuminationSpreadPts);
      expect(small.stats.members).toBe(12);
      expect(small.stats.pSurvive).toBeGreaterThanOrEqual(0);
      expect(small.stats.pSurvive).toBeLessThanOrEqual(1);
      expect(small.stats.pSunlit).toHaveLength(base.count);
      expect(Math.max(...small.stats.pSunlit)).toBeLessThanOrEqual(1 + 1e-6);
      // The sunlit share of the surrounding terrain is a fraction, and the lander reports its sky view.
      const lit = terrainLitSeries(dem, base);
      expect(lit).not.toBeNull();
      expect(Math.min(...(lit as Float32Array))).toBeGreaterThanOrEqual(0);
      expect(Math.max(...(lit as Float32Array))).toBeLessThanOrEqual(1);
      expect(base.adv.kpis.skyViewFactor).toBeGreaterThan(0.9);
      expect(base.adv.kpis.skyViewFactor).toBeLessThanOrEqual(1);
    });

    it('covers 80 S and holds a 20 m grid of the IM-2 landing point', () => {
      expect(CUSTOM_LAT_MAX).toBe(-80);
      // IM-1 came down near 80.13 S: inside the regional grid with room for the horizon search.
      const [ix, iy] = latLonToXY(-80.13, 1.44);
      expect(gridContains(regional, ix, iy)).toBe(true);
      expect(gridContains(regional, ix, iy + 200)).toBe(true);
      const local = resampleLocalGrid([regional], ix, iy);
      const hz = computeHorizon({ regional, local: local.grid }, makeObserver({ regional, local: local.grid }, ix, iy, 2));
      for (let a = 0; a < 360; a += 30) expect(Number.isFinite(hz.elevDeg[a])).toBe(true);
      const athena = HISTORICAL_LANDINGS[0];
      const info = manifest.sites.find((s) => s.id === athena.id);
      expect(info).toBeDefined();
      expect(info?.latDeg).toBeCloseTo(athena.latDeg, 6);
      expect(info?.sourcePixelM).toBe(20);
      expect(new Date(athena.touchdownMs).toISOString().slice(0, 10)).toBe('2025-03-06');
    });
  });
});
