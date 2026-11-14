/**
 * Real-terrain checks against the LOLA assets in public/dem/
 * (built by scripts/build_lola_dem.py from Barker et al. 2023).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, DEFAULT_POWER, DEFAULT_RF, DemGridInfo, DemManifest, DemStack, Grid, LOCAL_N, LOCAL_SPACING_KM,
  decodeGrid, evaluateScenario, latLonToXY, resampleLocalGrid, sampleGrid, slopeDeg,
} from '../index';

const dir = join(process.cwd(), 'public', 'dem');
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('LOLA asset decoding', () => {
  it('decodes both encodings into kilometres and rejects truncated files', () => {
    const i16: DemGridInfo = { file: 'a.i16', n: 3, spacingM: 800, encoding: 'int16le-0.5m', sourcePixelM: 240, minM: 0, maxM: 0 };
    const g = decodeGrid(new Int16Array([0, 2, 4, 6, 8, 10, -2000, 14, 16]).buffer, i16);
    expect(g.spacingKm).toBeCloseTo(0.8, 12);
    expect(g.x0).toBeCloseTo(-0.8, 12);
    expect(g.data[1]).toBeCloseTo(0.001, 9); // 2 half-metres = 1 m
    expect(g.data[6]).toBeCloseTo(-1, 9);
    const f32: DemGridInfo = { ...i16, file: 'b.f32', encoding: 'float32le-m' };
    const h = decodeGrid(new Float32Array([0, 1500, 0, 0, 0, 0, 0, 0, 0]).buffer, f32, 10, -20);
    expect(h.data[1]).toBeCloseTo(1.5, 6);
    expect(h.x0).toBeCloseTo(10 - 0.8, 12);
    expect(() => decodeGrid(new ArrayBuffer(10), i16)).toThrow();
  });

  it('interpolates a local grid for custom coordinates from the finest source that covers it', () => {
    const plane = (n: number, sp: number): Grid => {
      const data = new Float32Array(n * n);
      const half = ((n - 1) / 2) * sp;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = 0.01 * (-half + i * sp) - 0.02 * (-half + j * sp);
      return { n, spacingKm: sp, x0: -half, y0: -half, data };
    };
    const cap = plane(401, 0.16), regional = plane(201, 0.8);
    const inside = resampleLocalGrid([cap, regional], 5, -7);
    expect(inside.sourceSpacingKm).toBeCloseTo(0.16, 12);
    expect(inside.grid.n).toBe(LOCAL_N);
    expect(inside.grid.spacingKm).toBe(LOCAL_SPACING_KM);
    expect(sampleGrid(inside.grid, 5.3, -6.9)).toBeCloseTo(0.01 * 5.3 - 0.02 * -6.9, 5);
    // Outside the cap the regional grid takes over.
    expect(resampleLocalGrid([cap, regional], 60, 0).sourceSpacingKm).toBeCloseTo(0.8, 12);
  });
});

describe('real LOLA terrain', () => {
  let manifest: DemManifest;
  let regional: Grid;
  let cap: Grid;
  const demFor = (id: string): DemStack => {
    const info = manifest.sites.find((s) => s.id === id);
    if (!info) throw new Error(`no LOLA grid for ${id}`);
    const [cx, cy] = latLonToXY(info.latDeg, info.lonDeg);
    return { regional, local: decodeGrid(load(info.file), info, cx, cy) };
  };

  beforeAll(() => {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
    regional = decodeGrid(load(manifest.regional.file), manifest.regional);
    cap = decodeGrid(load(manifest.cap.file), manifest.cap);
  });

  it('has a pre-built 20 m grid centred on every candidate landing point', () => {
    for (const site of CANDIDATE_SITES) {
      const info = manifest.sites.find((s) => s.id === site.id);
      expect(info, site.id).toBeDefined();
      expect(info?.latDeg).toBeCloseTo(site.latDeg, 6);
      expect(info?.lonDeg).toBeCloseTo(site.lonDeg, 6);
      expect(info?.sourcePixelM).toBe(20);
    }
  });

  it('reproduces known south-polar topography', () => {
    // The pole sits on the rim of Shackleton (~ +1.3 km); the floor is ~4.1 km below.
    const pole = sampleGrid(cap, 0, 0);
    const [sx, sy] = latLonToXY(-89.67, 129.78);
    const floor = sampleGrid(cap, sx, sy);
    expect(pole).toBeGreaterThan(1.1);
    expect(pole).toBeLessThan(1.5);
    expect(pole - floor).toBeGreaterThan(3.6);
    expect(pole - floor).toBeLessThan(4.5);
    // Malapert Massif rises about 5 km above the reference sphere.
    const [mx, my] = latLonToXY(-86.04, 2.7);
    expect(sampleGrid(cap, mx, my)).toBeGreaterThan(4.5);
    // The centre of Haworth (the coordinate of the original brief) is a deep floor.
    const [hx, hy] = latLonToXY(-87.45, -5.12);
    expect(sampleGrid(cap, hx, hy)).toBeLessThan(-2.5);
    // The three resolutions agree where they overlap.
    expect(Math.abs(sampleGrid(regional, mx, my) - sampleGrid(cap, mx, my))).toBeLessThan(0.35);
    const ridge = demFor('shackleton-ridge');
    const [rx, ry] = latLonToXY(CANDIDATE_SITES[0].latDeg, CANDIDATE_SITES[0].lonDeg);
    expect(Math.abs(sampleGrid(ridge.local as Grid, rx, ry) - sampleGrid(cap, rx, ry))).toBeLessThan(0.08);
  });

  it('gives the candidate landing points the properties they were selected for', () => {
    const year = { startMs: Date.UTC(2027, 0, 1), days: 180, stepHours: 2, dxM: 0, dyM: 0, mastM: 2, power: DEFAULT_POWER, rf: DEFAULT_RF };
    const kpis = Object.fromEntries(CANDIDATE_SITES.map((s) => {
      const dem = demFor(s.id);
      const [x, y] = latLonToXY(s.latDeg, s.lonDeg);
      expect(slopeDeg(dem, x, y), `${s.id} slope`).toBeLessThanOrEqual(10.5);
      return [s.id, evaluateScenario(dem, { ...year, latDeg: s.latDeg, lonDeg: s.lonDeg }).kpis];
    }));
    // The connecting ridge is the best-lit candidate; Malapert has the best Earth view.
    expect(kpis['shackleton-ridge'].illuminationPct).toBeGreaterThan(70);
    for (const s of CANDIDATE_SITES) {
      expect(kpis['shackleton-ridge'].illuminationPct).toBeGreaterThanOrEqual(kpis[s.id].illuminationPct - 8);
      expect(kpis['malapert-massif'].dtePct).toBeGreaterThanOrEqual(kpis[s.id].dtePct - 5);
    }
    expect(kpis['malapert-massif'].dtePct).toBeGreaterThan(60);
    expect(kpis['malapert-massif'].groundElevationM).toBeGreaterThan(4800);
  });

  it('shows the original Haworth coordinate is in near-permanent shadow, unlike the rim point', () => {
    const [x, y] = latLonToXY(-87.45, -5.12);
    const floorDem: DemStack = { regional, local: resampleLocalGrid([cap, regional], x, y).grid };
    const window = { startMs: Date.UTC(2027, 8, 1), days: 60, stepHours: 2, dxM: 0, dyM: 0, mastM: 2, power: DEFAULT_POWER, rf: DEFAULT_RF };
    const floor = evaluateScenario(floorDem, { ...window, latDeg: -87.45, lonDeg: -5.12 }).kpis;
    const rimSite = CANDIDATE_SITES[2];
    const rim = evaluateScenario(demFor(rimSite.id), { ...window, latDeg: rimSite.latDeg, lonDeg: rimSite.lonDeg }).kpis;
    expect(floor.illuminationPct).toBeLessThan(5);
    expect(rim.illuminationPct).toBeGreaterThan(floor.illuminationPct + 30);
  });
});
