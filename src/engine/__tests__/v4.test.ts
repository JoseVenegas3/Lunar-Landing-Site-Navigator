/** v4: full 80-90 S band, on-demand 20 m patches, sub-pixel relief, verdict and emergency countdown. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CANDIDATE_SITES, CUSTOM_LAT_MAX, DEFAULT_MICRO_RELIEF, DEFAULT_POWER, DEFAULT_RF, DEFAULT_THERMAL, DemManifest, DemStack, Grid, LOLA_COG,
  MAX_RANGE_KM, MissionInput, PixelWindow, R_MOON_KM, azimuthToMap, buildMicroPatch, computeHorizon, cratersIn, decodeGrid, emergencyCountdown,
  evaluateMission, fractalHeightM, gridContains, hash01, latLonToXY, longestSilenceH, makeObserver, mapKmToStereoM, microHazard,
  microShadowFraction, missionVerdict, patchWindow, resampleLocalGrid, resamplePatch, sampleGrid, steepFraction, streamLocalPatch,
  sunlitDirections, valueNoise, verdictImproves, xyToLatLon,
} from '../index';

const dir = join(process.cwd(), 'public', 'dem');
const load = (file: string): ArrayBuffer => {
  const b = readFileSync(join(dir, file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

let manifest: DemManifest;
let regional: Grid;
let cap: Grid;
beforeAll(() => {
  manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
  regional = decodeGrid(load(manifest.regional.file), manifest.regional);
  cap = decodeGrid(load(manifest.cap.file), manifest.cap);
});

const input = (latDeg: number, lonDeg: number, days = 14): MissionInput => ({
  latDeg, lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days, stepHours: 1, mastM: 2,
  power: DEFAULT_POWER, rf: DEFAULT_RF, thermal: DEFAULT_THERMAL,
});

describe('full 80-90 S band', () => {
  it('accepts custom latitudes up to 80 S', () => {
    expect(CUSTOM_LAT_MAX).toBe(-80);
  });

  it('keeps every 250 km horizon ray inside the regional grid from the northern edge', () => {
    // 80 S is 303 km from the pole; a ray pointing away from it ends at 553 km.
    expect(((regional.n - 1) / 2) * regional.spacingKm).toBeGreaterThanOrEqual(R_MOON_KM * (10 * Math.PI) / 180 + MAX_RANGE_KM);
    for (const lat of [-80.0, -80.5, -81.5]) {
      for (const lon of [0, 45, 90, 135, 180, -135, -90, -45]) {
        const [x, y] = latLonToXY(lat, lon);
        for (let az = 0; az < 360; az += 5) {
          const [ux, uy] = azimuthToMap(lon, az);
          expect(gridContains(regional, x + ux * MAX_RANGE_KM, y + uy * MAX_RANGE_KM)).toBe(true);
        }
      }
    }
  });

  for (const lat of [-80.0, -80.5, -81.5]) {
    it(`computes the horizon and flies a mission at ${Math.abs(lat)} S`, () => {
      const lon = 12;
      const [x, y] = latLonToXY(lat, lon);
      const dem: DemStack = { regional, local: resampleLocalGrid([cap, regional], x, y).grid };
      const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
      expect(hz.elevDeg).toHaveLength(360);
      for (let a = 0; a < 360; a++) {
        expect(Number.isFinite(hz.elevDeg[a])).toBe(true);
        expect(Math.abs(hz.elevDeg[a])).toBeLessThan(45);
        expect(hz.distKm[a]).toBeGreaterThan(0);
        expect(hz.distKm[a]).toBeLessThanOrEqual(MAX_RANGE_KM);
      }
      const r = evaluateMission(dem, input(lat, lon), hz);
      expect(r.count).toBe(14 * 24 + 1);
      for (const v of [r.kpis.illuminationPct, r.kpis.dtePct, r.kpis.energyWh, r.adv.kpis.rfAvailabilityPct, r.adv.kpis.survivalHours]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      // Ten degrees from the pole the Earth stands about ten degrees high towards lon 0: it is in view from open ground.
      expect(r.kpis.earthElMaxDeg).toBeGreaterThan(5);
      const v = missionVerdict(r);
      expect(['go', 'caution', 'nogo']).toContain(v.level);
    }, 60_000);
  }
});

describe('on-demand 20 m patches', () => {
  it('maps the application frame to the stereographic frame of the raster', () => {
    expect(mapKmToStereoM(0, 0)).toEqual([0, 0]);
    // 80 S: colatitude 10 deg -> stereographic radius 2 R tan(5 deg), the edge of the mosaic.
    const r = (R_MOON_KM * 10 * Math.PI) / 180;
    const [sx, sy] = mapKmToStereoM(0, r);
    expect(sx).toBeCloseTo(0, 6);
    expect(sy).toBeCloseTo(2 * R_MOON_KM * Math.tan((5 * Math.PI) / 180) * 1000, 3);
    expect(sy).toBeCloseTo(304_006, -2);
    const [ax, ay] = mapKmToStereoM(30, -40);
    expect(Math.atan2(ax, ay)).toBeCloseTo(Math.atan2(30, -40), 12); // radial: the bearing is kept
  });

  it('asks for a window that covers the local grid and stays inside the raster', () => {
    const w = patchWindow(10, -20) as PixelWindow;
    expect(w.width).toBeGreaterThan(820);  // 16.4 km at 20 m
    expect(w.width).toBeLessThan(840);
    expect(w.height).toBe(w.width);
    const edge = patchWindow(0, 300) as PixelWindow; // straddles the 80 S edge of the mosaic
    expect(edge.row0).toBe(0);
    expect(edge.height).toBeLessThan(w.height);
    expect(edge.col0 + edge.width).toBeLessThanOrEqual(LOLA_COG.size);
    expect(patchWindow(0, 330)).toBeNull();
  });

  it('reproduces a raster that is linear in the stereographic frame', async () => {
    const plane = (sx: number, sy: number): number => 1500 + 0.01 * sx - 0.02 * sy; // metres
    const reader = async (w: PixelWindow): Promise<Float32Array> => {
      const out = new Float32Array(w.width * w.height);
      for (let r = 0; r < w.height; r++) {
        for (let c = 0; c < w.width; c++) {
          out[r * w.width + c] = plane(LOLA_COG.originXM + (w.col0 + c + 0.5) * LOLA_COG.pixelM, LOLA_COG.originYM - (w.row0 + r + 0.5) * LOLA_COG.pixelM);
        }
      }
      return out;
    };
    const cx = 35.2, cy = -61.7;
    const res = await streamLocalPatch(reader, cx, cy, () => 0);
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.coveragePct).toBe(100);
    expect(res.grid.n).toBe(513);
    for (const [dx, dy] of [[0, 0], [-8.1, 8.1], [3.3, -7.2], [8.19, 8.19]]) {
      const [sx, sy] = mapKmToStereoM(cx + dx, cy + dy);
      expect(sampleGrid(res.grid, cx + dx, cy + dy) * 1000).toBeCloseTo(plane(sx, sy), 1);
    }
  });

  it('falls back to the coarse grid where the raster has no data', async () => {
    const reader = async (w: PixelWindow): Promise<Float32Array> => new Float32Array(w.width * w.height).fill(2000).fill(NaN, 0, Math.floor((w.width * w.height) / 2));
    const res = await streamLocalPatch(reader, 0, 0, () => 0.123);
    if (!res) throw new Error('no patch');
    expect(res.coveragePct).toBeGreaterThan(45);
    expect(res.coveragePct).toBeLessThan(55);
    const values = new Set(Array.from(res.grid.data).map((v) => Math.round(v * 1000)));
    expect([...values].sort()).toEqual([123, 2000]);
    // Past the edge of the mosaic nothing is streamed at all.
    expect(await streamLocalPatch(reader, 0, 400, () => 0)).toBeNull();
    await expect(async () => resamplePatch(new Float32Array(4), { col0: 0, row0: 0, width: 3, height: 3 }, 0, 0, () => 0)).rejects.toThrow();
  });

  it('agrees with the pre-built site grid when fed the same terrain', async () => {
    // The pre-built 32 m grid, re-read through a 20 m raster made from itself, must come back within the resampling error.
    const site = CANDIDATE_SITES[0];
    const info = manifest.sites.find((s) => s.id === site.id);
    if (!info) throw new Error('missing site grid');
    const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
    const local = decodeGrid(load(info.file), info, cx, cy);
    const toMap = (sxM: number, syM: number): [number, number] => {
      const rs = Math.hypot(sxM, syM) / 1000;
      const r = 2 * R_MOON_KM * Math.atan(rs / (2 * R_MOON_KM));
      return rs < 1e-9 ? [0, 0] : [(sxM / 1000) * (r / rs), (syM / 1000) * (r / rs)];
    };
    const reader = async (w: PixelWindow): Promise<Float32Array> => {
      const out = new Float32Array(w.width * w.height);
      for (let r = 0; r < w.height; r++) {
        for (let c = 0; c < w.width; c++) {
          const [x, y] = toMap(LOLA_COG.originXM + (w.col0 + c + 0.5) * LOLA_COG.pixelM, LOLA_COG.originYM - (w.row0 + r + 0.5) * LOLA_COG.pixelM);
          out[r * w.width + c] = gridContains(local, x, y) ? sampleGrid(local, x, y) * 1000 : NaN;
        }
      }
      return out;
    };
    const res = await streamLocalPatch(reader, cx, cy, (x, y) => sampleGrid(local, Math.min(Math.max(x, local.x0), local.x0 + 16.38), Math.min(Math.max(y, local.y0), local.y0 + 16.38)));
    if (!res) throw new Error('no patch');
    let sq = 0;
    for (let k = 0; k < local.data.length; k++) sq += (res.grid.data[k] - local.data[k]) ** 2;
    expect(Math.sqrt(sq / local.data.length) * 1000).toBeLessThan(1.5); // metres RMS, double interpolation of steep terrain
    const ll = xyToLatLon(cx, cy);
    expect(ll.latDeg).toBeCloseTo(site.latDeg, 6);
  });
});

describe('sub-pixel relief', () => {
  const flat: DemStack = { regional: { n: 3, spacingKm: 500, x0: -500, y0: -500, data: new Float32Array(9) }, local: null };

  it('is deterministic and bounded', () => {
    expect(hash01(3, -7, 11)).toBe(hash01(3, -7, 11));
    expect(hash01(3, -7, 11)).not.toBe(hash01(4, -7, 11));
    for (let k = 0; k < 200; k++) {
      const h = hash01(k * 7919, -k * 104729, k);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      const v = valueNoise(k * 1.37, -k * 2.11, 8, 5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(fractalHeightM(123.4, -567.8, 2.5)).toBe(fractalHeightM(123.4, -567.8, 2.5));
    const a = buildMicroPatch(flat, 12.3456, -45.6789), b = buildMicroPatch(flat, 12.3456, -45.6789);
    expect(Array.from(a.micro)).toEqual(Array.from(b.micro));
    // A neighbouring patch shares the same relief where they overlap: it is a property of the place.
    const c = buildMicroPatch(flat, 12.3456 + 0.010, -45.6789);
    expect(c.micro[40 * c.n + 20]).toBeCloseTo(a.micro[40 * a.n + 30], 9);
  });

  it('follows the requested roughness', () => {
    const slopeOf = (deg: number): number => microHazard(flat, 5, 5, 0, [], { ...DEFAULT_MICRO_RELIEF, slopeRmsDeg: deg, craterDensity: 0 }).microSlopeRmsDeg;
    const s1 = slopeOf(1.5), s3 = slopeOf(3);
    expect(s3 / s1).toBeGreaterThan(1.9);
    expect(s3 / s1).toBeLessThan(2.1);
    // Measured over the 4 m footprint the slope is below the requested total, which includes the 2 m octave.
    expect(s3).toBeGreaterThan(1);
    expect(s3).toBeLessThan(4);
    expect(fractalHeightM(10, 10, 0)).toBe(0);
  });

  it('populates craters with the equilibrium size distribution', () => {
    const cs = cratersIn(0, 0, 1000, 1000, DEFAULT_MICRO_RELIEF);
    // N(>3 m) - N(>15 m) = 0.079 (1/9 - 1/225) per m^2 -> about 8430 on a square kilometre.
    expect(cs.length).toBeGreaterThan(7800);
    expect(cs.length).toBeLessThan(9000);
    for (const c of cs.slice(0, 500)) {
      expect(c.diameterM).toBeGreaterThanOrEqual(3);
      expect(c.diameterM).toBeLessThanOrEqual(15);
      expect(c.depthM / c.diameterM).toBeGreaterThanOrEqual(0.04);
      expect(c.depthM / c.diameterM).toBeLessThanOrEqual(0.16);
    }
    // D^-2: a quarter as many craters above twice the diameter.
    const above = (d: number): number => cs.filter((c) => c.diameterM > d).length;
    expect(above(6) / above(3)).toBeGreaterThan(0.17);
    expect(above(6) / above(3)).toBeLessThan(0.27);
    expect(cratersIn(0, 0, 1000, 1000, { ...DEFAULT_MICRO_RELIEF, craterDensity: 0 })).toHaveLength(0);
  });

  it('casts more micro-shadow the lower the Sun, and none on a smooth plain', () => {
    const p = buildMicroPatch(flat, 20, -30);
    const f1 = microShadowFraction(p, 0, 90, 1), f5 = microShadowFraction(p, 0, 90, 5), f30 = microShadowFraction(p, 0, 90, 30);
    expect(f1).toBeGreaterThan(f5);
    expect(f5).toBeGreaterThan(f30);
    expect(f30).toBeLessThan(0.02);
    expect(microShadowFraction(p, 0, 90, -1)).toBe(1);
    const smoothPatch = buildMicroPatch(flat, 20, -30, { ...DEFAULT_MICRO_RELIEF, slopeRmsDeg: 0, craterDensity: 0 });
    expect(microShadowFraction(smoothPatch, 0, 90, 1)).toBe(0);
    expect(steepFraction(smoothPatch)).toBe(0);
  });

  it('reports a hazard index that grows with crater density', () => {
    const sun = [{ azDeg: 40, elDeg: 1.5 }, { azDeg: 200, elDeg: 1.5 }];
    const none = microHazard(flat, 7, 7, 0, sun, { ...DEFAULT_MICRO_RELIEF, craterDensity: 0 });
    const eq = microHazard(flat, 7, 7, 0, sun);
    const dense = microHazard(flat, 7, 7, 0, sun, { ...DEFAULT_MICRO_RELIEF, craterDensity: 2 });
    expect(eq.index).toBeGreaterThan(none.index);
    expect(dense.craterCover).toBeGreaterThan(eq.craterCover);
    expect(dense.shadowTrap).toBeGreaterThan(eq.shadowTrap);
    for (const h of [none, eq, dense]) {
      expect(h.index).toBeGreaterThanOrEqual(Math.max(h.shadowTrap, h.slopeTrap) - 1e-12);
      expect(h.index).toBeLessThanOrEqual(1);
    }
    // In equilibrium about a fifth of the ground lies inside a 3-15 m crater.
    expect(eq.craterCover).toBeGreaterThan(0.1);
    expect(eq.craterCover).toBeLessThan(0.3);
  });
});

describe('verdict and emergency countdown', () => {
  const site = CANDIDATE_SITES[0];
  let dem: DemStack;
  beforeAll(() => {
    const info = manifest.sites.find((s) => s.id === site.id);
    if (!info) throw new Error('missing site grid');
    const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
    dem = { regional, local: decodeGrid(load(info.file), info, cx, cy) };
  });

  it('reads a healthy mission as GO or CAUTION and a frozen one as NO-GO', () => {
    const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
    const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
    const good = evaluateMission(dem, { ...input(site.latDeg, site.lonDeg), startMs: Date.UTC(2027, 8, 14, 12) }, hz);
    const vGood = missionVerdict(good);
    expect(good.kpis.survives).toBe(true);
    expect(vGood.level).not.toBe('nogo');
    expect(vGood.linkPct).toBeGreaterThan(50);
    expect(longestSilenceH(good)).toBe(vGood.longestLinkGapH);

    // A battery a hundredth of the size cannot carry the bus through any shadow.
    const weak = evaluateMission(dem, { ...input(site.latDeg, site.lonDeg, 60), startMs: Date.UTC(2028, 2, 1), power: { ...DEFAULT_POWER, batteryCapacityWh: 40 } }, hz);
    const vWeak = missionVerdict(weak);
    if (!weak.kpis.survives) {
      expect(vWeak.level).toBe('nogo');
      expect(['thermal', 'battery']).toContain(vWeak.cause);
      expect(vWeak.survivalHours).toBeLessThan(vWeak.windowHours);
      expect(verdictImproves(vWeak, vGood)).toBe(true);
      expect(verdictImproves(vGood, vWeak)).toBe(false);
      const c = emergencyCountdown(weak, 0);
      expect(c.toLossH).toBeCloseTo(vWeak.survivalHours, 6);
      expect(c.lossCause).toBe(vWeak.cause);
      expect(emergencyCountdown(weak, vWeak.survivalHours + 5).aliveNow).toBe(false);
    }
    expect(missionVerdict(good, 0.2).also.concat(missionVerdict(good, 0.2).cause)).toContain('tipover');
  }, 60_000);

  it('counts down to the next loss of link and the next shadow', () => {
    const [x, y] = latLonToXY(site.latDeg, site.lonDeg);
    const hz = computeHorizon(dem, makeObserver(dem, x, y, 2));
    const r = evaluateMission(dem, input(site.latDeg, site.lonDeg, 30), hz);
    for (const from of [0, 100, 300]) {
      const c = emergencyCountdown(r, from);
      if (c.linkNow) { expect(c.toLinkH).toBe(0); if (c.toLinkLossH !== null) expect(c.toLinkLossH).toBeGreaterThan(0); }
      else { expect(c.toLinkLossH).toBe(0); if (c.toLinkH !== null) expect(c.toLinkH).toBeGreaterThan(0); }
      if (c.sunNow) expect(c.toSunH).toBe(0); else expect(c.toDarkH).toBe(0);
    }
    const dirs = sunlitDirections(r, 8);
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs.length).toBeLessThanOrEqual(8);
    for (const d of dirs) expect(d.elDeg).toBeGreaterThan(0);
  }, 60_000);
});
