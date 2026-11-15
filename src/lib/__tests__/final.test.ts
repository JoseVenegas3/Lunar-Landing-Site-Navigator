/**
 * v3.1 final release: unit system (SR-711), CSV export (SR-710), solar
 * elevation KPI (SR-403), Earth-vs-Moon formulas (SR-502/708), glossary in
 * both guides (SR-706), published-illumination honesty (R8) and the rescue
 * search used by the Web Worker (R6).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, DEFAULT_POWER, DEFAULT_RF, DEFAULT_THERMAL, DemManifest, DemStack, G_EARTH_M_S2, G_MOON_M_S2, Grid, MissionInput, PUBLISHED_ILLUMINATION,
  R_EARTH_MEAN_KM, R_MOON_KM, STEFAN_BOLTZMANN, ballisticRangeKm, computeHorizon, curvatureRatio, decodeGrid, evaluateMission, horizonDistanceKm,
  latLonToXY, makeObserver, maxSunElevationDeg, missionVerdict, mountProjectionFactor, radiatedWm2, resampleLocalGrid, rescueSteps, runRescue, solarElevationKpi,
} from '../../engine';
import { cToF, fToC, ftToM, kToF, kmToMi, m2ToFt2, mToFt, makeUnits, miToKm, msToFts, unitsFor } from '../units';
import { TELEMETRY_COLUMNS, buildTelemetryCsv } from '../export';
import { GLOSSARY, glossSplit } from '../glossary';

describe('unit system (SR-711)', () => {
  it('converts both ways with the standard factors', () => {
    expect(mToFt(1)).toBeCloseTo(3.28084, 5);
    expect(ftToM(mToFt(123.4))).toBeCloseTo(123.4, 9);
    expect(kmToMi(1)).toBeCloseTo(0.621371, 6);
    expect(miToKm(kmToMi(42))).toBeCloseTo(42, 9);
    expect(cToF(0)).toBe(32);
    expect(cToF(-20)).toBeCloseTo(-4, 9);
    expect(cToF(100)).toBeCloseTo(212, 9);
    expect(fToC(cToF(-173.2))).toBeCloseTo(-173.2, 9);
    expect(kToF(273.15)).toBeCloseTo(32, 9);
    expect(msToFts(1)).toBeCloseTo(3.28084, 5);
    expect(m2ToFt2(1)).toBeCloseTo(10.7639, 3);
  });
  it('formats lengths, distances, temperatures and speeds per system', () => {
    const si = makeUnits('si'), imp = makeUnits('imperial');
    expect(si.m(150)).toBe('150 m');
    expect(imp.m(150)).toBe('492 ft');
    expect(imp.m(10, 1)).toBe('32.8 ft');
    expect(si.c(-20)).toBe('−20 °C');
    expect(imp.c(-20)).toBe('−4 °F');
    expect(imp.c(0)).toBe('32 °F');
    expect(si.k(150)).toBe('150 K');
    expect(imp.k(255.372)).toBe('0 °F');
    expect(si.dist(320)).toBe('320 m');
    expect(si.dist(1840)).toBe('1,840 m (1.84 km)');
    expect(imp.dist(1840)).toBe('6,037 ft (1.14 mi)');
    // the cursor ruler: one number only
    expect(si.span(320)).toBe('320 m');
    expect(si.span(1840)).toBe('1.84 km');
    expect(imp.span(320)).toBe('1050 ft');
    expect(imp.span(1840)).toBe('1.14 mi');
    expect(imp.kmStr(10, 1)).toBe('6.2 mi');
    expect(si.ms(0.5, 2)).toBe('0.50 m/s');
    expect(imp.ms(0.5, 2)).toBe('1.64 ft/s');
    expect(unitsFor('imperial').lenU).toBe('ft');
  });
});

const dir = join(process.cwd(), 'public', 'dem');
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
let regional: Grid, cap: Grid;
beforeAll(() => {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
  regional = decodeGrid(load(manifest.regional.file), manifest.regional);
  cap = decodeGrid(load(manifest.cap.file), manifest.cap);
});
const site = CANDIDATE_SITES[0];
const input = (days = 7): MissionInput => ({
  latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days, stepHours: 1, mastM: 2,
  power: DEFAULT_POWER, rf: DEFAULT_RF, thermal: DEFAULT_THERMAL,
});
const flyAt = (inp: MissionInput) => {
  const [x, y] = latLonToXY(inp.latDeg, inp.lonDeg);
  const dem: DemStack = { regional, local: resampleLocalGrid([cap, regional], x, y).grid };
  const hz = computeHorizon(dem, makeObserver(dem, x, y, inp.mastM));
  return { dem, hz, r: evaluateMission(dem, inp, hz) };
};

describe('telemetry CSV export (SR-710)', () => {
  it('has the 26 documented columns, one row per sample, and says it is in SI units', () => {
    const { r } = flyAt(input(2));
    const csv = buildTelemetryCsv(r, { site: site.name, scenario: 'A', displayUnits: 'imperial' });
    const lines = csv.trimEnd().split('\n');
    const comments = lines.filter((l) => l.startsWith('#'));
    const header = lines.find((l) => !l.startsWith('#')) as string;
    const rows = lines.slice(lines.indexOf(header) + 1);
    expect(TELEMETRY_COLUMNS).toHaveLength(26);
    expect(header.split(',')).toEqual([...TELEMETRY_COLUMNS]);
    expect(rows).toHaveLength(r.count);
    for (const row of rows) expect(row.split(',')).toHaveLength(26);
    expect(comments.some((c) => /units=SI/.test(c) && /display_units=imperial/.test(c))).toBe(true);
    // every physical column carries its unit in the name
    for (const c of TELEMETRY_COLUMNS) {
      if (['utc', 'ground_station', 'sun_disc_fraction', 'relay_coverage', 'sunlit', 'dte_geometric', 'downlink_up', 'lander_lost'].includes(c)) continue;
      expect(c).toMatch(/_(h|deg|km|w|wh|pct|c|k|db|mbps)$/);
    }
    expect(rows[0].split(',')[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('solar elevation KPI (SR-403)', () => {
  it('reads the elevation, the disc fraction and the power of the result without new physics', () => {
    const { r } = flyAt(input(14));
    const k = solarElevationKpi(r, 0);
    expect(k.elNowDeg).toBeCloseTo(r.sunEl[0], 6);
    expect(k.fracNow).toBeCloseTo(r.sunFrac[0], 6);
    expect(k.powerNowW).toBeCloseTo(r.powerW[0], 6);
    expect(k.incidenceNow).toBeCloseTo(mountProjectionFactor(r.input.power.mount, r.sunEl[0]), 9);
    expect(k.elMaxDeg).toBeCloseTo(r.kpis.sunElMaxDeg, 4);
    // at the pole the Sun stays a few degrees from the horizon
    expect(k.elMaxDeg).toBeLessThan(5);
    expect(k.powerPeakW).toBeGreaterThanOrEqual(k.powerNowW);
  });
});

describe('Earth vs Moon formulas (SR-502 / SR-708)', () => {
  it('computes the comparison from the constants', () => {
    expect(curvatureRatio()).toBeCloseTo(R_EARTH_MEAN_KM / R_MOON_KM, 9);
    expect(curvatureRatio()).toBeGreaterThan(3.6);
    expect(curvatureRatio()).toBeLessThan(3.7);
    expect(horizonDistanceKm(R_MOON_KM, 2)).toBeCloseTo(2.636, 2);
    expect(horizonDistanceKm(R_EARTH_MEAN_KM, 2)).toBeCloseTo(5.048, 2);
    expect(maxSunElevationDeg(-89.5, 1.54)).toBeCloseTo(2.04, 6);
    expect(maxSunElevationDeg(-36.83, 23.44)).toBeCloseTo(76.61, 2);
    expect(radiatedWm2(300, STEFAN_BOLTZMANN)).toBeCloseTo(459.3, 0);
    expect(radiatedWm2(100, STEFAN_BOLTZMANN)).toBeCloseTo(5.67, 2);
    expect(ballisticRangeKm(1000, (3 * Math.PI) / 180, G_MOON_M_S2)).toBeCloseTo(64.5, 0);
    expect(G_EARTH_M_S2 / G_MOON_M_S2).toBeGreaterThan(6);
  });
});

describe('glossary (SR-706)', () => {
  const docs = (f: string): string => readFileSync(join(process.cwd(), 'docs', f), 'utf8');
  it('defines every required term in both languages', () => {
    const ids = ['dte', 'los', 'libration', 'dem', 'lola', 'psr', 'weh', 'dod', 'deygout', 'fresnel', 'multipath', '6dof', 'gimbal', 'psi', 'elfo', 'somrf'];
    expect(GLOSSARY.map((g) => g.id).sort()).toEqual([...ids].sort());
    for (const g of GLOSSARY) { expect(g.def[0].length).toBeGreaterThan(40); expect(g.def[1].length).toBeGreaterThan(40); }
  });
  it('is at the end of both interface guides', () => {
    const es = docs('guia-interfaz.md'), en = docs('guia-interfaz.en.md');
    expect(es).toMatch(/Glosario de Términos Lunares y de Ingeniería/);
    expect(en).toMatch(/Lunar & Engineering Glossary/);
    for (const g of GLOSSARY) {
      expect(es.includes(g.term[1]), g.term[1]).toBe(true);
      expect(en.includes(g.term[0]), g.term[0]).toBe(true);
    }
  });
  it('finds the terms in a running text', () => {
    const parts = glossSplit('The DTE link and the LOLA DEM decide.');
    expect(parts.filter((p) => typeof p !== 'string').map((p) => (p as { id: string }).id)).toEqual(['dte', 'lola', 'dem']);
    expect(parts.map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe('The DTE link and the LOLA DEM decide.');
  });
});

describe('published illumination (R8)', () => {
  it('has an entry per candidate site, never an unverified number', () => {
    for (const s of CANDIDATE_SITES) {
      const p = PUBLISHED_ILLUMINATION[s.id];
      expect(p, s.id).toBeDefined();
      expect(p.ref.length).toBeGreaterThan(5);
      // a value may only be filled in together with the paper it was read from
      if (p.illumPct !== null) expect(p.illumPct).toBeGreaterThan(0);
    }
  });
});

describe('rescue search for the Web Worker (R6)', () => {
  it('yields progress, prunes nothing on gentle ground and returns a consistent outcome', () => {
    const inp = input(5);
    const { dem, hz, r } = flyAt(inp);
    const before = missionVerdict(r);
    const opts = { radiusM: 200, size: 3, searchDays: 1, stepHours: 12, pruneSlopeDeg: 90 };
    const seen: number[] = [];
    const out = runRescue(dem, inp, hz, before, opts, (p) => seen.push(p));
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(out.pruned).toBe(0);
    expect(['move', 'date', 'none']).toContain(out.action);
    expect(out.missions).toBeGreaterThan(0);
    expect(out.before).toEqual(before);
  });
  it('skips touchdown points steeper than the stability angle without flying them', () => {
    const inp = input(3);
    const { dem, hz, r } = flyAt(inp);
    const it = rescueSteps(dem, inp, hz, missionVerdict(r), { radiusM: 200, size: 3, searchDays: 0, stepHours: 12, pruneSlopeDeg: -1 });
    let s = it.next();
    while (!s.done) s = it.next();
    expect(s.value.pruned).toBe(8);
    expect(s.value.missions).toBe(0);
    expect(s.value.action).toBe('none');
  });
});
