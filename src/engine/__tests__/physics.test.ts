import { beforeAll, describe, expect, it } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import {
  ANCHOR_SITES, AU_KM, BAND_FREQUENCY_HZ, DAY_MS, DEFAULT_POWER, DEFAULT_RF, DEG, DemStack, Grid, HOUR_MS, HorizonProfile,
  LOCAL_SPACING_KM, RAD, R_MOON_KM, STATE_DTE, STATE_SUN, ScenarioInput, accumulateVisible, bodyFixedVectors,
  buildLocalGrid, buildRegionalGrid, computeEphemeris, decimateGrid, computeHorizon, dishGainDbi, earthClearanceDeg, evaluateScenario,
  farPlaneBase, fsplDb, horizonAt, latLonToXY, linkBudget, litFractionBytes, loadExternalGrid, makeObserver,
  makeSweepContext, mountProjectionFactor, rayHitDistance, relocatedXY, sampleGrid, simulateBattery, siteFrame, skyAt,
  solarDiscFraction, solarIrradiance, solarPowerW, sunAngularRadiusDeg, sweepShadowCeiling, terrainHeight, topocentric,
  wrap180, xyToLatLon,
} from '../index';

const T0 = Date.UTC(2027, 0, 1);

// The synthetic terrain is a deterministic test fixture: its landforms are tied
// to these anchor points, not to the landing points the app uses on LOLA terrain.
const SYNTH_SITES = ANCHOR_SITES.map((s, i) => ({ ...s, id: `synthetic-${i}` }));

// ------------------------------------------------------------ ephemeris

describe('ephemeris: lunar body-fixed frame and libration', () => {
  it('reproduces the sub-Earth point given by an independent libration series', () => {
    // Astronomy.Libration() uses the classical Eckhardt/Meeus formulation; our
    // frame comes from the IAU pole and prime meridian. They must agree closely.
    for (let d = 0; d < 720; d += 17) {
      const ms = T0 + d * DAY_MS;
      const v = bodyFixedVectors(ms).earth;
      const lat = Math.asin(v[2] / Math.hypot(...v)) * RAD;
      const lon = wrap180(Math.atan2(v[1], v[0]) * RAD);
      const lib = Astronomy.Libration(Astronomy.MakeTime(new Date(ms)));
      expect(Math.abs(lat - lib.elat)).toBeLessThan(0.25);
      expect(Math.abs(wrap180(lon - lib.elon))).toBeLessThan(0.25);
    }
  });

  it('keeps the Earth inside the libration box (+-6.9 deg lat, +-8.2 deg lon) and fills most of it', () => {
    const eph = computeEphemeris(T0, 365 * 24, 2);
    let latMax = 0, lonMax = 0;
    for (let i = 0; i < eph.count; i++) {
      latMax = Math.max(latMax, Math.abs(eph.subEarthLat[i]));
      lonMax = Math.max(lonMax, Math.abs(eph.subEarthLon[i]));
    }
    expect(latMax).toBeLessThan(6.95);
    expect(latMax).toBeGreaterThan(6.2);
    expect(lonMax).toBeLessThan(8.3);
    expect(lonMax).toBeGreaterThan(6.5);
  });

  it('keeps the sub-solar latitude within the 1.54 deg lunar obliquity (plus perturbations)', () => {
    let min = Infinity, max = -Infinity;
    for (let y = 2026; y <= 2030; y++) {
      const eph = computeEphemeris(Date.UTC(y, 0, 1), 365 * 24, 12);
      for (let i = 0; i < eph.count; i++) {
        min = Math.min(min, eph.subSolarLat[i]);
        max = Math.max(max, eph.subSolarLat[i]);
      }
    }
    expect(max).toBeLessThan(1.62);
    expect(max).toBeGreaterThan(1.45);
    expect(min).toBeGreaterThan(-1.62);
    expect(min).toBeLessThan(-1.45);
  });

  it('gives Earth-Moon and Sun-Moon distances in the physical range', () => {
    const eph = computeEphemeris(T0, 400 * 24, 6);
    for (let i = 0; i < eph.count; i++) {
      const e = Math.hypot(eph.earth[i * 3], eph.earth[i * 3 + 1], eph.earth[i * 3 + 2]);
      const s = Math.hypot(eph.sun[i * 3], eph.sun[i * 3 + 1], eph.sun[i * 3 + 2]) / AU_KM;
      expect(e).toBeGreaterThan(356_000);
      expect(e).toBeLessThan(407_000);
      expect(s).toBeGreaterThan(0.979);
      expect(s).toBeLessThan(1.021);
    }
  });
});

describe('ephemeris: topocentric geometry at the lunar south pole', () => {
  it('maps zenith, north and east to the expected azimuth/elevation', () => {
    const f = siteFrame(-85, 30, 0);
    const far = 1e6;
    const up = topocentric(f.px + f.ux * far, f.py + f.uy * far, f.pz + f.uz * far, f);
    expect(up.elDeg).toBeCloseTo(90, 6);
    const north = topocentric(f.px + f.nx * far, f.py + f.ny * far, f.pz + f.nz * far, f);
    expect(north.elDeg).toBeCloseTo(0, 6);
    expect(Math.min(north.azDeg, 360 - north.azDeg)).toBeLessThan(1e-6);
    const east = topocentric(f.px + f.ex * far, f.py + f.ey * far, f.pz + f.ez * far, f);
    expect(east.azDeg).toBeCloseTo(90, 6);
  });

  it('keeps the Sun grazing the horizon at the pole and turns it 360 deg per synodic month', () => {
    const eph = computeEphemeris(T0, 2 * 29.530589 * 24, 1);
    const f = siteFrame(-89.9, 0, 0);
    let total = 0, prev = 0;
    for (let i = 0; i < eph.count; i++) {
      const s = topocentric(eph.sun[i * 3], eph.sun[i * 3 + 1], eph.sun[i * 3 + 2], f);
      expect(Math.abs(s.elDeg)).toBeLessThan(1.75);
      if (i > 0) total += wrap180(s.azDeg - prev);
      prev = s.azDeg;
    }
    expect(Math.abs(Math.abs(total) - 720)).toBeLessThan(8);
  });

  it('places the Earth near north at a mean elevation equal to the colatitude, oscillating with libration', () => {
    // Malapert Massif, 86.04 S: mean Earth elevation ~ 3.96 deg.
    const eph = computeEphemeris(T0, 365 * 24, 1);
    const f = siteFrame(-86.04, 2.7, 0);
    let sum = 0, min = Infinity, max = -Infinity, azMax = 0;
    for (let i = 0; i < eph.count; i++) {
      const e = topocentric(eph.earth[i * 3], eph.earth[i * 3 + 1], eph.earth[i * 3 + 2], f);
      sum += e.elDeg;
      min = Math.min(min, e.elDeg);
      max = Math.max(max, e.elDeg);
      azMax = Math.max(azMax, Math.abs(wrap180(e.azDeg)));
    }
    const mean = sum / eph.count;
    // Parallax lowers the Earth by ~0.26 deg for an observer near the limb.
    expect(mean).toBeGreaterThan(3.3);
    expect(mean).toBeLessThan(4.1);
    expect(max - min).toBeGreaterThan(12);
    expect(max - min).toBeLessThan(14.2);
    expect(azMax).toBeLessThan(12);
  });

  it('matches the one-shot helper and gives a solar radius of about 0.27 deg', () => {
    const sky = skyAt(T0 + 40 * DAY_MS, -89.54, -129.78, 1.2);
    const eph = computeEphemeris(T0 + 40 * DAY_MS, 24, 1);
    const f = siteFrame(-89.54, -129.78, 1.2);
    const s = topocentric(eph.sun[0], eph.sun[1], eph.sun[2], f);
    expect(sky.sun.azDeg).toBeCloseTo(s.azDeg, 9);
    expect(sky.sun.elDeg).toBeCloseTo(s.elDeg, 9);
    const r = sunAngularRadiusDeg(sky.sun.rangeKm);
    expect(r).toBeGreaterThan(0.26);
    expect(r).toBeLessThan(0.275);
  });
});

// -------------------------------------------------------------- horizon

function syntheticGrid(n: number, spacingKm: number, fn: (x: number, y: number) => number, cx = 0, cy = 0): Grid {
  const data = new Float32Array(n * n);
  const half = ((n - 1) / 2) * spacingKm;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = fn(cx - half + i * spacingKm, cy - half + j * spacingKm);
  return loadExternalGrid(data, n, spacingKm, cx, cy);
}

/** A profile with a constant horizon elevation, for the visibility maths. */
function flatProfile(elevDeg: number): HorizonProfile {
  const obs = { x: 0, y: -100, latDeg: -86.7, lonDeg: 180, groundKm: 0, heightKm: 0 };
  return {
    observer: obs,
    elevDeg: new Float32Array(360).fill(elevDeg),
    distKm: new Float32Array(360).fill(10),
    farElevDeg: new Float32Array(360).fill(elevDeg),
    farDistKm: new Float32Array(360).fill(10),
  };
}

describe('horizon engine', () => {
  it('returns the geometric dip of a smooth sphere for an elevated observer', () => {
    const dem: DemStack = { regional: syntheticGrid(801, 1, () => 0), local: null };
    const mastM = 1500;
    const hz = computeHorizon(dem, makeObserver(dem, 20, -30, mastM));
    const dip = -Math.acos(R_MOON_KM / (R_MOON_KM + mastM / 1000)) * RAD; // -2.38 deg
    for (let a = 0; a < 360; a += 15) expect(hz.elevDeg[a]).toBeCloseTo(dip, 1);
    // Horizon distance sqrt(2 R h) ~ 72 km.
    expect(hz.distKm[0]).toBeGreaterThan(60);
    expect(hz.distKm[0]).toBeLessThan(85);
  });

  it('measures the apparent elevation of a distant peak including curvature drop', () => {
    // Observer at lon 180 (y < 0): local north points to -y. A 3 km peak sits 50 km north.
    const peak = (x: number, y: number): number => 3 * Math.exp(-((x * x) + (y + 150) * (y + 150)) / (2 * 4 * 4));
    const dem: DemStack = { regional: syntheticGrid(801, 0.5, peak, 0, -100), local: null };
    const obs = makeObserver(dem, 0, -100, 2);
    expect(obs.lonDeg).toBeCloseTo(180, 6);
    const hz = computeHorizon(dem, obs);
    const g = 50 / R_MOON_KM;
    const expected = Math.atan2((R_MOON_KM + 3) * Math.cos(g) - (R_MOON_KM + obs.heightKm), (R_MOON_KM + 3) * Math.sin(g)) * RAD;
    expect(expected).toBeGreaterThan(2.5); // 3.43 deg flat-Moon, ~2.7 deg after 0.72 km of curvature drop
    expect(hz.elevDeg[0]).toBeCloseTo(expected, 1);
    expect(Math.abs(hz.distKm[0] - 50)).toBeLessThan(3);
    // Opposite direction: nothing but the sphere.
    expect(hz.elevDeg[180]).toBeLessThan(0.05);
    // A ray below the summit hits near 50 km, a ray above it escapes.
    const hit = rayHitDistance(dem, obs, 0, expected - 0.5);
    expect(hit).not.toBeNull();
    expect(hit as number).toBeLessThan(50);
    expect(rayHitDistance(dem, obs, 0, expected + 0.3)).toBeNull();
  });

  it('computes the visible solar-disc fraction through sunrise', () => {
    const p = flatProfile(0);
    const r = 0.266;
    expect(solarDiscFraction(p, 123, 1, r)).toBe(1);
    expect(solarDiscFraction(p, 123, -1, r)).toBe(0);
    expect(solarDiscFraction(p, 123, 0, r)).toBeCloseTo(0.5, 2);
    expect(solarDiscFraction(p, 123, r, r)).toBeCloseTo(1, 6);
    expect(solarDiscFraction(p, 123, -r, r)).toBeCloseTo(0, 6);
    let prev = -1;
    for (let el = -0.4; el <= 0.4; el += 0.02) {
      const f = solarDiscFraction(p, 10, el, r);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = f;
    }
    // A notch in the skyline lets part of the disc through.
    const notch = flatProfile(1);
    notch.elevDeg[200] = -1;
    expect(solarDiscFraction(notch, 200, -0.6, r)).toBeGreaterThan(0);
    expect(solarDiscFraction(notch, 200, -0.6, r)).toBeLessThan(1);
    expect(solarDiscFraction(notch, 200, 0.5, r)).toBe(1);
    expect(solarDiscFraction(notch, 100, 0.5, r)).toBe(0);
  });

  it('applies the antenna elevation margin to the DTE test', () => {
    const p = flatProfile(1.5);
    expect(earthClearanceDeg(p, 5, 4, 2)).toBeCloseTo(0.5, 6);
    expect(earthClearanceDeg(p, 5, 3, 2)).toBeLessThan(0);
    expect(horizonAt(p, 359.5)).toBeCloseTo(1.5, 6);
  });
});

describe('shadow sweep', () => {
  it('casts a shadow of length h / tan(el) behind a wall and none in front of it', () => {
    const n = 257, sp = LOCAL_SPACING_KM;
    // Wall 0.1 km high along x = 0, light arriving from +x at 5.7 deg (tan = 0.1): shadow 1 km long.
    const grid = syntheticGrid(n, sp, (x) => (Math.abs(x) < sp * 0.75 ? 0.1 : 0));
    const ctx = makeSweepContext(grid);
    // Undo the tangent-plane reduction so the test is exactly planar.
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ctx.flat[j * n + i] = grid.data[j * n + i];
    const ceil = new Float32Array(n * n);
    sweepShadowCeiling(ctx, { dirX: 1, dirY: 0, tanEl: 0.1, farBase: farPlaneBase(0, -Infinity, 10, 0.1), originX: 0, originY: 0 }, ceil);
    const acc = new Float32Array(n * n);
    accumulateVisible(ctx, ceil, acc);
    const row = 128 * n;
    const at = (xKm: number): number => acc[row + 128 + Math.round(xKm / sp)];
    expect(at(1.5)).toBe(1); // sunward side
    expect(at(-0.3)).toBe(0); // inside the shadow
    expect(at(-0.8)).toBe(0);
    expect(at(-1.3)).toBe(1); // beyond the shadow tip
    // Penumbra bytes: fully lit in front, dark behind.
    const lo = new Float32Array(n * n), bytes = new Uint8Array(n * n);
    sweepShadowCeiling(ctx, { dirX: 1, dirY: 0, tanEl: 0.09, farBase: -1e6, originX: 0, originY: 0 }, lo);
    litFractionBytes(ctx, ceil, lo, bytes);
    expect(bytes[row + 128 + 40]).toBe(255);
    expect(bytes[row + 128 - 10]).toBe(0);
  });

  it('decimates a grid without moving it', () => {
    const g = syntheticGrid(129, LOCAL_SPACING_KM, (x, y) => x * 2 + y);
    const d = decimateGrid(g, 2);
    expect(d.n).toBe(65);
    expect(d.spacingKm).toBeCloseTo(LOCAL_SPACING_KM * 2, 12);
    expect(sampleGrid(d, 0.5, -0.25)).toBeCloseTo(sampleGrid(g, 0.5, -0.25), 5);
    expect(() => decimateGrid(g, 3)).toThrow();
  });

  it('applies the far-field horizon as a boundary plane', () => {
    const n = 129;
    const grid = syntheticGrid(n, LOCAL_SPACING_KM, () => 0);
    const ctx = makeSweepContext(grid);
    ctx.flat.fill(0);
    const ceil = new Float32Array(n * n), acc = new Float32Array(n * n);
    // Far ridge rising to 2 deg at 30 km; Sun at 1 deg: everything is shadowed.
    const tanEl = Math.tan(1 * DEG);
    sweepShadowCeiling(ctx, { dirX: 0, dirY: 1, tanEl, farBase: farPlaneBase(0, Math.tan(2 * DEG), 30, tanEl), originX: 0, originY: 0 }, ceil);
    accumulateVisible(ctx, ceil, acc);
    expect(acc.reduce((a, b) => a + b, 0)).toBe(0);
    // Sun at 3 deg clears the ridge: everything is lit.
    acc.fill(0);
    const tan3 = Math.tan(3 * DEG);
    sweepShadowCeiling(ctx, { dirX: 0, dirY: 1, tanEl: tan3, farBase: farPlaneBase(0, Math.tan(2 * DEG), 30, tan3), originX: 0, originY: 0 }, ceil);
    accumulateVisible(ctx, ceil, acc);
    expect(acc.reduce((a, b) => a + b, 0)).toBe(n * n);
  });
});

// ---------------------------------------------------------------- power

describe('power budget', () => {
  it('follows the inverse-square law for irradiance', () => {
    expect(solarIrradiance(AU_KM)).toBeCloseTo(1361, 6);
    expect(solarIrradiance(AU_KM * 2)).toBeCloseTo(1361 / 4, 6);
  });

  it('projects each mount type correctly', () => {
    expect(mountProjectionFactor('tracker1axis', 0)).toBeCloseTo(1, 9);
    expect(mountProjectionFactor('tracker1axis', 60)).toBeCloseTo(0.5, 9);
    expect(mountProjectionFactor('cylindrical', 0)).toBeCloseTo(1 / Math.PI, 9);
    expect(mountProjectionFactor('horizontal', 0)).toBeCloseTo(0, 9);
    expect(mountProjectionFactor('horizontal', 30)).toBeCloseTo(0.5, 9);
    expect(mountProjectionFactor('horizontal', -5)).toBe(0);
  });

  it('computes array power from area, efficiency, derating and disc fraction', () => {
    const cfg = { ...DEFAULT_POWER, panelAreaM2: 2, efficiency: 0.3, derating: 1, mount: 'tracker1axis' as const };
    expect(solarPowerW(cfg, 0, 1, AU_KM)).toBeCloseTo(1361 * 2 * 0.3, 6);
    expect(solarPowerW(cfg, 0, 0.25, AU_KM)).toBeCloseTo(1361 * 2 * 0.3 * 0.25, 6);
    expect(solarPowerW(cfg, 0, 0, AU_KM)).toBe(0);
    // At a grazing polar Sun a deck-mounted array is nearly useless.
    const flat = { ...cfg, mount: 'horizontal' as const };
    expect(solarPowerW(flat, 1.5, 1, AU_KM) / solarPowerW(cfg, 1.5, 1, AU_KM)).toBeLessThan(0.03);
  });

  it('integrates the battery, conserves energy and flags depth of discharge and freezing', () => {
    const cfg = { ...DEFAULT_POWER, batteryCapacityWh: 4000, survivalLoadW: 35, baseLoadW: 180, maxDepthOfDischarge: 0.8, chargeEfficiency: 1, initialSoc: 1 };
    // 80 h of darkness: 2800 Wh drawn, 1200 Wh left, no alert (floor is 800 Wh).
    const night = simulateBattery(cfg, new Float32Array(80), 1);
    expect(night.socWh[79]).toBeCloseTo(4000 - 80 * 35, 3);
    expect(night.survives).toBe(true);
    expect(night.dodAlert).toBe(false);
    // 100 h: below the DoD floor but alive.
    const deep = simulateBattery(cfg, new Float32Array(100), 1);
    expect(deep.dodAlert).toBe(true);
    expect(deep.survives).toBe(true);
    expect(deep.hoursBelowDod).toBeGreaterThan(5);
    // 200 h: 7000 Wh needed, 3000 Wh unmet, lander frozen.
    const dead = simulateBattery(cfg, new Float32Array(200), 1);
    expect(dead.survives).toBe(false);
    expect(dead.unmetWh).toBeCloseTo(3000, 3);
    expect(dead.minSocFraction).toBe(0);
    expect(dead.hoursDepleted).toBeGreaterThan(80);
    // Day/night cycle: energy bookkeeping closes.
    const cycle = new Float32Array(240).map((_, i) => (i % 48 < 30 ? 600 : 0));
    const r = simulateBattery(cfg, cycle, 1);
    expect(r.generatedWh).toBeCloseTo(150 * 600, 3);
    for (const e of r.socWh) {
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(4000);
    }
    expect(r.consumedWh + r.unmetWh).toBeCloseTo(150 * 180 + 90 * 35, 3);
  });
});

// ----------------------------------------------------------------- link

describe('RF link budget', () => {
  it('computes free-space path loss for the Earth-Moon distance', () => {
    expect(fsplDb(384_400, BAND_FREQUENCY_HZ.X)).toBeCloseTo(222.63, 1);
    expect(fsplDb(384_400, BAND_FREQUENCY_HZ.S)).toBeCloseTo(210.99, 1);
    // Doubling the range costs 6.02 dB.
    expect(fsplDb(768_800, BAND_FREQUENCY_HZ.X) - fsplDb(384_400, BAND_FREQUENCY_HZ.X)).toBeCloseTo(6.0206, 3);
  });

  it('computes parabolic antenna gain', () => {
    expect(dishGainDbi(34, 0.7, BAND_FREQUENCY_HZ.X)).toBeCloseTo(67.97, 1);
    expect(dishGainDbi(0.6, 0.55, BAND_FREQUENCY_HZ.X)).toBeCloseTo(31.86, 1);
    // Gain scales with frequency squared: X over S is 20 log10(8.4 / 2.2) = 11.64 dB.
    expect(dishGainDbi(1, 0.6, BAND_FREQUENCY_HZ.X) - dishGainDbi(1, 0.6, BAND_FREQUENCY_HZ.S)).toBeCloseTo(11.64, 2);
  });

  it('closes a self-consistent budget and respects both rate limits', () => {
    const big = linkBudget(DEFAULT_RF, 384_400);
    expect(big.eirpDbw).toBeCloseTo(10 * Math.log10(20) + big.txGainDbi - 1, 9);
    expect(big.cn0DbHz).toBeCloseTo(big.eirpDbw - big.fsplDb - DEFAULT_RF.miscLossDb + big.gOverTDbK + 228.5991672, 9);
    expect(big.limitedBy).toBe('bandwidth');
    expect(big.dataRateBps).toBe(10e6);
    expect(big.marginDb).toBeGreaterThan(DEFAULT_RF.linkMarginDb);

    const small = linkBudget({ ...DEFAULT_RF, groundStationId: 'gisat37' }, 384_400);
    expect(small.limitedBy).toBe('power');
    expect(small.dataRateBps).toBeLessThan(10e6);
    expect(small.dataRateBps).toBeGreaterThan(1e5);
    // A power-limited link sits exactly on the reserved margin.
    expect(small.marginDb).toBeCloseTo(DEFAULT_RF.linkMarginDb, 9);
    expect(small.ebN0Db).toBeCloseTo(small.cn0DbHz - 10 * Math.log10(small.dataRateBps), 9);

    // Apogee is worse than perigee by the inverse-square law.
    const peri = linkBudget({ ...DEFAULT_RF, groundStationId: 'gisat37' }, 357_000);
    const apo = linkBudget({ ...DEFAULT_RF, groundStationId: 'gisat37' }, 406_000);
    expect(peri.dataRateBps / apo.dataRateBps).toBeCloseTo((406_000 / 357_000) ** 2, 6);
    // S band with the same hardware delivers less than X band.
    const sBand = linkBudget({ ...DEFAULT_RF, groundStationId: 'gisat37', band: 'S' }, 384_400);
    expect(sBand.dataRateBps).toBeLessThan(small.dataRateBps);
  });
});

// ------------------------------------------------------ terrain + system

describe('synthetic DEM and end-to-end scenarios', () => {
  let regional: Grid;
  const dems = new Map<string, DemStack>();
  const input = (siteIndex: number, over: Partial<ScenarioInput> = {}): ScenarioInput => ({
    latDeg: SYNTH_SITES[siteIndex].latDeg, lonDeg: SYNTH_SITES[siteIndex].lonDeg,
    dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days: 60, stepHours: 1, mastM: 2,
    power: DEFAULT_POWER, rf: DEFAULT_RF, ...over,
  });
  const demFor = (siteIndex: number): DemStack => {
    const s = SYNTH_SITES[siteIndex];
    let d = dems.get(s.id);
    if (!d) {
      const [cx, cy] = latLonToXY(s.latDeg, s.lonDeg);
      d = { regional, local: buildLocalGrid(cx, cy) };
      dems.set(s.id, d);
    }
    return d;
  };

  beforeAll(() => {
    regional = buildRegionalGrid();
  });

  it('round-trips the polar projection', () => {
    for (const s of SYNTH_SITES) {
      const [x, y] = latLonToXY(s.latDeg, s.lonDeg);
      const ll = xyToLatLon(x, y);
      expect(ll.latDeg).toBeCloseTo(s.latDeg, 9);
      expect(wrap180(ll.lonDeg - s.lonDeg)).toBeCloseTo(0, 9);
    }
    // 1 deg of latitude is 30.3 km on the Moon.
    const [, y] = latLonToXY(-89, 0);
    expect(y).toBeCloseTo(R_MOON_KM * DEG, 9);
  });

  it('is deterministic and reproduces the calibrated landforms', () => {
    expect(terrainHeight(12.3, -45.6, 1)).toBe(terrainHeight(12.3, -45.6, 1));
    // Shackleton: floor ~4 km below the rim crest.
    const [sx, sy] = latLonToXY(-89.67, 129.78);
    const floor = sampleGrid(regional, sx, sy);
    const rim = sampleGrid(regional, 0, 0); // the south pole lies on the rim
    expect(rim - floor).toBeGreaterThan(3);
    expect(rim - floor).toBeLessThan(5.5);
    // Malapert Massif summit is several km above datum.
    const [mx, my] = latLonToXY(-86.04, 2.7);
    expect(sampleGrid(regional, mx, my)).toBeGreaterThan(3.5);
    // Regional and local grids agree on the large-scale shape.
    const dem = demFor(1);
    expect(Math.abs(sampleGrid(dem.local as Grid, mx, my) - sampleGrid(regional, mx, my))).toBeLessThan(0.15);
  });

  it('produces physically bounded, self-consistent KPIs for every candidate site', () => {
    SYNTH_SITES.forEach((_, idx) => {
      const r = evaluateScenario(demFor(idx), input(idx));
      const k = r.kpis;
      expect(r.count).toBe(60 * 24 + 1);
      for (const pct of [k.illuminationPct, k.sunlitPct, k.dtePct, k.simultaneousPct, k.minSocPct]) {
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
      expect(k.illuminationPct).toBeLessThanOrEqual(k.sunlitPct + 1e-9);
      expect(k.simultaneousPct).toBeLessThanOrEqual(Math.min(k.sunlitPct, k.dtePct) + 1e-9);
      // Light and dark runs partition the window.
      const total = [...r.windows.sun, ...r.windows.dark].reduce((a, w) => a + w.end - w.start, 0);
      expect(total).toBe(r.count);
      expect(k.longestLightH + k.longestDarkH).toBeLessThanOrEqual(r.count * r.stepHours + 1e-9);
      // No power without sunlight, no data without line of sight.
      for (let i = 0; i < r.count; i++) {
        if (!(r.state[i] & STATE_SUN)) expect(r.powerW[i]).toBe(0);
        if (!(r.state[i] & STATE_DTE)) expect(r.rateMbps[i]).toBe(0);
      }
      // Peak power cannot exceed the normal-incidence array rating.
      const rating = solarIrradiance(0.98 * AU_KM) * DEFAULT_POWER.panelAreaM2 * DEFAULT_POWER.efficiency * DEFAULT_POWER.derating;
      expect(k.peakPowerW).toBeLessThanOrEqual(rating);
      // Data volume bounded by the bandwidth cap over the DTE hours.
      expect(k.dataGb).toBeLessThanOrEqual((10e6 * 3600 * r.count * (k.dtePct / 100)) / 8e9 + 1e-6);
      expect(k.slopeDeg).toBeLessThan(25);
    });
  });

  it('ranks the sites as the terrain dictates: ridge for sunlight, Malapert for DTE', () => {
    const ridge = evaluateScenario(demFor(0), input(0)).kpis;
    const malapert = evaluateScenario(demFor(1), input(1)).kpis;
    const haworth = evaluateScenario(demFor(2), input(2)).kpis;
    expect(ridge.illuminationPct).toBeGreaterThan(75);
    // In summer a crater-rim crest is also well lit; the ridge earns its
    // reputation in winter, when the Sun stays below the geometric horizontal.
    const winter = { startMs: Date.UTC(2027, 3, 1), days: 60 };
    const ridgeWinter = evaluateScenario(demFor(0), input(0, winter)).kpis;
    const haworthWinter = evaluateScenario(demFor(2), input(2, winter)).kpis;
    expect(haworth.illuminationPct).toBeGreaterThan(haworthWinter.illuminationPct + 15);
    expect(ridgeWinter.illuminationPct).toBeGreaterThan(haworthWinter.illuminationPct + 15);
    expect(malapert.dtePct).toBeGreaterThan(ridge.dtePct + 10);
    expect(malapert.dtePct).toBeGreaterThan(haworth.dtePct + 10);
    expect(malapert.groundElevationM).toBeGreaterThan(4000);
  });

  it('shows that a 500 m relocation can change the mission outcome', () => {
    const dem = demFor(0);
    const nominal = evaluateScenario(dem, input(0)).kpis;
    const worst = Math.min(
      ...[[500, 0], [-500, 0], [0, 500], [0, -500]].map(([dx, dy]) => evaluateScenario(dem, input(0, { dxM: dx, dyM: dy })).kpis.illuminationPct),
    );
    expect(nominal.illuminationPct - worst).toBeGreaterThan(15);
    // The relocation is applied in the local east/north frame.
    const [x0, y0] = relocatedXY(-89.54, -129.78, 0, 0);
    const [x1, y1] = relocatedXY(-89.54, -129.78, 300, 400);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(0.5, 9);
    const moved = xyToLatLon(...relocatedXY(-86, 10, 0, 500));
    expect(moved.latDeg).toBeGreaterThan(-86); // north is away from the south pole
  });

  it('reuses a supplied horizon profile and stays fast enough for interactive relocation', () => {
    const dem = demFor(0);
    const obs = makeObserver(dem, ...relocatedXY(-89.54, -129.78, 120, -80), 2);
    computeHorizon(dem, obs); // warm-up
    const t0 = performance.now();
    const hz = computeHorizon(dem, obs);
    const r = evaluateScenario(dem, input(0, { dxM: 120, dyM: -80 }), hz);
    const dt = performance.now() - t0;
    expect(r.horizon).toBe(hz);
    expect(dt).toBeLessThan(150); // typically 10-20 ms; generous bound for CI noise
    // Hourly sampling: consecutive Sun samples move by about 0.5 deg of azimuth.
    const step = Math.abs(wrap180(r.sunAz[11] - r.sunAz[10]));
    expect(step).toBeGreaterThan(0.3);
    expect(step).toBeLessThan(0.8);
    expect(HOUR_MS * r.stepHours).toBe(3_600_000);
  });
});
