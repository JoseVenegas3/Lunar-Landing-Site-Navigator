/**
 * Mission evaluation with the contingency and survival physics on top of the
 * baseline scenario.
 *
 * `evaluateScenario` (analysis.ts) remains the level-zero model: a level lander,
 * a geometric line of sight and an uncoupled battery. `evaluateMission` runs it
 * unchanged and then re-derives power, battery and downlink with:
 *   - the landing attitude (tilted arrays, depointed or self-occluded antenna),
 *   - shadowing by a neighbouring surface asset,
 *   - the coupled electro-thermal model (survival heaters, battery freezing),
 *   - physical propagation (ridge diffraction, regolith multipath) and the
 *     rotation of the Earth under the ground stations.
 * With a level lander, no asset and the thermal model off, the power series is
 * identical to the baseline.
 */
import { C_LIGHT_M_S, DEG, HOUR_MS, RAD, R_MOON_KM } from './constants';
import {
  STATE_BELOW_DOD, STATE_DEPLETED, STATE_DTE, STATE_RELAY, ScenarioInput, ScenarioResult, evaluateScenario, runsOf,
} from './analysis';
import {
  AttitudeConfig, NOMINAL_ATTITUDE, V3, arrayProjection, attitudeMatrix, enuFromAzEl, evaluateLanderAttitudeImpact, stowedBoresight,
  tiltDeg, toBody,
} from './attitude';
import { AssetConfig, CoexistenceAssessment, evaluateMultiAssetInterference } from './coexistence';
import { HorizonProfile, TerrainProfile, azimuthToMap, farHorizonAt, farHorizonDistAt, horizonAt, skyViewFactor, terrainProfile } from './horizonEngine';
import { BAND_FREQUENCY_HZ, BatteryResult, beamwidthDeg, bitsToGb, simulateBattery, solarIrradiance } from './missionPhysics';
import { GroundContact, computeDSNLinkBudgetAndDataRate, computeGroundContact, computeLunarRFPropagationLoss, deygoutLossDb, fresnelNu, knifeEdgeLossDb } from './rfPropagation';
import { accumulateVisible, farPlaneBase, makeSweepContext, sweepShadowCeiling } from './shadowSweep';
import { DemStack, decimateGrid, demHeight, localAxes } from './terrain';
import { ElectroThermalResult, ThermalConfig, simulateElectroThermalTimeline } from './thermal';

/** Radius around the lander whose sunlit share sets the temperature of the terrain it sees, km. */
export const TERRAIN_VIEW_KM = 1.5;

export const STATE_RF_PHYSICAL = 32;

export interface MissionInput extends ScenarioInput {
  attitude?: AttitudeConfig;
  /** Coupled thermal model; omitted or null keeps the uncoupled battery. */
  thermal?: ThermalConfig | null;
  asset?: AssetConfig | null;
}

export interface AdvancedKpis {
  tiltDeg: number;
  /** Energy lost to the landing attitude relative to a level lander, percent. */
  attitudePowerPenaltyPct: number;
  /** Science data lost to the landing attitude relative to a level lander, percent. */
  attitudeRfPenaltyPct: number;
  meanPointingLossDb: number;
  /** Share of the window in which the lander's own body hides the Earth, percent. */
  selfOccludedPct: number;
  /** Share of the window with a downlink that closes with the physical losses, percent. */
  rfAvailabilityPct: number;
  /** Share of the window each ground station tracks, percent, in the order of `contact.sites`. */
  stationSharePct: number[];
  noStationPct: number;
  /** Mean excess loss (diffraction + multipath) while the link is up, dB. */
  meanExcessLossDb: number;
  /** Largest loss added by secondary ridges (Deygout) at any sample still diffracting, dB. */
  maxSecondaryDiffractionDb: number;
  /** Hours in which secondary ridges add more than 0.5 dB. */
  secondaryEdgeHours: number;
  /** Hours of downlink that close with the skyline ridge alone and fail with the secondary ridges. */
  secondaryLostHours: number;
  /** Data return of a level lander with the same physical model, GB. */
  nominalDataGb: number;
  minBusC: number | null;
  heaterWh: number;
  heaterHours: number;
  /** Hours from the window start to battery freezing, or null. */
  thermalDeathH: number | null;
  survivalHours: number;
  /** Sky view factor of a horizontal surface at the lander, 0..1. */
  skyViewFactor: number;
  /** Mean sunlit share of the terrain within TERRAIN_VIEW_KM over the window, percent (null with the thermal model off). */
  terrainLitPct: number | null;
  /** RMS relief about the best-fit plane within 1 km, m. */
  roughnessM: number;
  /** Slope of the ground along the mean Earth azimuth, deg (positive uphill). */
  slopeTowardEarthDeg: number;
}

export interface Advanced {
  attitude: AttitudeConfig;
  boresightBody: V3;
  /** Array output of a level, unshaded lander, W. */
  nominalPowerW: Float32Array;
  pointingLossDb: Float32Array;
  /** Diffraction over the skyline ridge plus the secondary ridges, dB (99 = far below the skyline). */
  diffractionDb: Float32Array;
  /** Part of `diffractionDb` the three-edge Deygout construction adds to the skyline edge alone, dB. */
  secondaryDiffractionDb: Float32Array;
  multipathDb: Float32Array;
  ebN0MarginDb: Float32Array;
  selfOccluded: Uint8Array;
  contact: GroundContact;
  thermal: ElectroThermalResult | null;
  coexistence: CoexistenceAssessment | null;
  kpis: AdvancedKpis;
}

export type MissionResult = Omit<ScenarioResult, 'input'> & { input: MissionInput; adv: Advanced };

/** RMS height about the best-fit plane inside `radiusKm`, metres (kilometre-scale roughness). */
export function kmScaleRoughnessM(dem: DemStack, x: number, y: number, radiusKm = 1, stepKm = 0.064): number {
  let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  const pts: number[] = [];
  for (let dy = -radiusKm; dy <= radiusKm; dy += stepKm) {
    for (let dx = -radiusKm; dx <= radiusKm; dx += stepKm) {
      if (dx * dx + dy * dy > radiusKm * radiusKm) continue;
      const z = demHeight(dem, x + dx, y + dy) * 1000;
      const px = dx * 1000, py = dy * 1000;
      pts.push(px, py, z);
      n++; sx += px; sy += py; sz += z; sxx += px * px; syy += py * py; sxy += px * py; sxz += px * z; syz += py * z;
    }
  }
  // Least-squares plane z = a x + b y + c (the grid is symmetric, so the normal equations are well conditioned).
  const mx = sx / n, my = sy / n, mz = sz / n;
  const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
  const cxz = sxz / n - mx * mz, cyz = syz / n - my * mz;
  const det = cxx * cyy - cxy * cxy;
  const a = (cxz * cyy - cyz * cxy) / det, b = (cyz * cxx - cxz * cxy) / det;
  let ss = 0;
  for (let k = 0; k < pts.length; k += 3) {
    const r = pts[k + 2] - mz - a * (pts[k] - mx) - b * (pts[k + 1] - my);
    ss += r * r;
  }
  return Math.sqrt(ss / n);
}

/** Terrain gradient at a map point: rise per metre towards local east and north. */
export function terrainGradient(dem: DemStack, x: number, y: number, lonDeg: number, baselineKm = 0.064): { east: number; north: number } {
  const ax = localAxes(lonDeg);
  const b = baselineKm / 2;
  const e = (demHeight(dem, x + ax.ex * b, y + ax.ey * b) - demHeight(dem, x - ax.ex * b, y - ax.ey * b)) / baselineKm;
  const n = (demHeight(dem, x + ax.nx * b, y + ax.ny * b) - demHeight(dem, x - ax.nx * b, y - ax.ny * b)) / baselineKm;
  return { east: e, north: n };
}

export function evaluateMission(dem: DemStack, input: MissionInput, horizon?: HorizonProfile): MissionResult {
  const base = evaluateScenario(dem, input, horizon);
  const n = base.count, step = base.stepHours;
  const { eph, observer, horizon: hz, state } = base;
  const attitude = input.attitude ?? NOMINAL_ATTITUDE;
  const power = input.power, rf = input.rf;
  const rot = attitudeMatrix(attitude);
  const boresightBody = stowedBoresight(base.earthAz, base.earthEl);
  const freqHz = BAND_FREQUENCY_HZ[rf.band];
  const beam = beamwidthDeg(rf.txDishDiameterM, freqHz);

  // ---- neighbouring asset: shadow on the lander
  let coexistence: CoexistenceAssessment | null = null;
  const asset = input.asset && input.asset.enabled ? input.asset : null;
  if (asset) {
    const [ux, uy] = azimuthToMap(observer.lonDeg, asset.azimuthDeg);
    const ax = observer.x + (ux * asset.distanceM) / 1000, ay = observer.y + (uy * asset.distanceM) / 1000;
    const deltaM = (demHeight(dem, ax, ay) - observer.groundKm) * 1000;
    coexistence = evaluateMultiAssetInterference(asset, base.sunAz, base.sunEl, base.sunFrac, base.sunRadiusDeg, deltaM, input.mastM);
  }

  // ---- array power in the actual attitude
  const nominalPowerW = base.powerW;
  const powerW = new Float32Array(n);
  const litFrac = new Float32Array(n);
  const rating = power.panelAreaM2 * power.efficiency * power.derating;
  let eNominal = 0, eAttitude = 0, peakPowerW = 0;
  for (let i = 0; i < n; i++) {
    const frac = base.sunFrac[i] * (coexistence ? 1 - coexistence.landerBlock[i] : 1);
    litFrac[i] = frac;
    eNominal += nominalPowerW[i];
    if (base.sunFrac[i] <= 0) continue;
    const k = i * 3;
    const sunRange = Math.hypot(eph.sun[k], eph.sun[k + 1], eph.sun[k + 2]);
    const proj = arrayProjection(power.mount, toBody(rot, enuFromAzEl(base.sunAz[i], base.sunEl[i])));
    const unshaded = solarIrradiance(sunRange) * rating * proj * base.sunFrac[i];
    eAttitude += unshaded;
    powerW[i] = solarIrradiance(sunRange) * rating * proj * frac;
    if (powerW[i] > peakPowerW) peakPowerW = powerW[i];
  }

  // ---- battery, coupled to the bus temperature when the thermal model is on
  const skyView = skyViewFactor(hz);
  const terrainLit = input.thermal ? terrainLitSeries(dem, base) : null;
  const thermal = input.thermal
    ? simulateElectroThermalTimeline(power, input.thermal, powerW, litFrac, step, { skyView, terrainLit: terrainLit ?? undefined })
    : null;
  const battery: BatteryResult = thermal ?? simulateBattery(power, powerW, step);
  const dodFloorWh = power.batteryCapacityWh * (1 - power.maxDepthOfDischarge);
  for (let i = 0; i < n; i++) {
    state[i] &= ~(STATE_DEPLETED | STATE_BELOW_DOD);
    const dead = thermal !== null && thermal.thermalDeathIndex >= 0 && i >= thermal.thermalDeathIndex;
    if (dead || (battery.socWh[i] <= 0 && powerW[i] <= power.survivalLoadW)) state[i] |= STATE_DEPLETED;
    if (battery.socWh[i] < dodFloorWh - 1e-6) state[i] |= STATE_BELOW_DOD;
  }

  // ---- physical downlink
  const contact = computeGroundContact(eph.startMs, n, step, rf.groundStationId);
  const [earthMeanAz] = [Math.atan2(boresightBody[0], boresightBody[1]) * RAD];
  const grad = terrainGradient(dem, observer.x, observer.y, observer.lonDeg);
  const slopeTowardEarthDeg = Math.atan(grad.east * Math.sin(earthMeanAz * DEG) + grad.north * Math.cos(earthMeanAz * DEG)) * RAD;
  const pointingLossDb = new Float32Array(n), diffractionDb = new Float32Array(n), multipathDb = new Float32Array(n);
  const secondaryDiffractionDb = new Float32Array(n);
  const wavelength = C_LIGHT_M_S / freqHz;
  let maxSecondary = 0, secondaryCount = 0, secondaryLost = 0;
  const ebN0MarginDb = new Float32Array(n).fill(-99);
  const selfOccluded = new Uint8Array(n);
  const rateMbps = new Float32Array(n);
  const stationCount = new Array<number>(contact.sites.length).fill(0);
  let bits = 0, bitsNominal = 0, rateSum = 0, upCount = 0, pointSum = 0, excessSum = 0, occludedCount = 0, noStation = 0;
  for (let i = 0; i < n; i++) {
    const st = contact.station[i];
    if (st >= 0) stationCount[st]++; else noStation++;
    const az = base.earthAz[i], el = base.earthEl[i];
    const horizonEl = horizonAt(hz, az);
    const impact = evaluateLanderAttitudeImpact(attitude, power.mount, boresightBody, enuFromAzEl(base.sunAz[i], base.sunEl[i]), enuFromAzEl(az, el), beam);
    pointingLossDb[i] = impact.pointingLossDb;
    if (impact.selfOccluded) { selfOccluded[i] = 1; occludedCount++; }
    // More than ~3 deg below the skyline no useful signal diffracts over the ridge at these wavelengths.
    if (el < horizonEl - 3) { diffractionDb[i] = 99; continue; }
    const azI = Math.round(az) % 360;
    const loss = computeLunarRFPropagationLoss(el, horizonEl, hz.distKm[azI] * 1000, freqHz / 1e9, beam, slopeTowardEarthDeg);
    // Multiple ridges (Deygout, three edges). The skyline is often a small rise close to the
    // lander with a massif just under it farther away: a single edge at the rise lets far too
    // much signal round it. The correction is the three-edge loss of the terrain profile minus
    // the loss of its skyline edge alone, added to the loss of the horizon profile.
    let extra = 0;
    if (loss.diffractionDb > 0) {
      const prof = profileToward(dem, hz, azI);
      const earthTan = Math.tan(el * DEG), dSky = hz.distKm[azI] * 1000;
      const dg = deygoutLossDb(prof.distM, prof.tanElev, earthTan, wavelength);
      const skyline = knifeEdgeLossDb(fresnelNu(dSky * (Math.tan(hz.elevDeg[azI] * DEG) - earthTan), dSky, wavelength));
      extra = Math.max(0, dg.totalDb - skyline);
      secondaryDiffractionDb[i] = extra;
      loss.diffractionDb += extra;
      loss.totalDb += extra;
      if (extra > maxSecondary) maxSecondary = extra;
      if (extra > 0.5) secondaryCount++;
    }
    diffractionDb[i] = loss.diffractionDb;
    multipathDb[i] = loss.multipathDb;
    const alive = !(state[i] & STATE_DEPLETED);
    const nominal = computeDSNLinkBudgetAndDataRate(base.link, rf, base.earthRangeKm[i], loss.totalDb, st >= 0 && alive);
    bitsNominal += nominal.dataRateBps * step * 3600;
    const link = impact.selfOccluded
      ? null
      : computeDSNLinkBudgetAndDataRate(base.link, rf, base.earthRangeKm[i], loss.totalDb + impact.pointingLossDb, st >= 0 && alive);
    if (link) ebN0MarginDb[i] = Number.isFinite(link.marginDb) ? link.marginDb : -99;
    // Samples the single-edge model would have counted as a working link.
    if (extra > 0 && link && link.dataRateBps <= 0
      && computeDSNLinkBudgetAndDataRate(base.link, rf, base.earthRangeKm[i], loss.totalDb - extra + impact.pointingLossDb, st >= 0 && alive).dataRateBps > 0) secondaryLost++;
    if (link && link.dataRateBps > 0) {
      state[i] |= STATE_RF_PHYSICAL;
      rateMbps[i] = link.dataRateBps / 1e6;
      bits += link.dataRateBps * step * 3600;
      rateSum += link.dataRateBps;
      upCount++;
      pointSum += impact.pointingLossDb;
      excessSum += loss.totalDb;
    }
  }

  // ---- relay data with the updated power state
  let relayBits = 0;
  const relayRate = input.relay && input.relay.enabled ? input.relay.rateMbps * 1e6 : 0;
  if (relayRate > 0) {
    for (let i = 0; i < n; i++) {
      if (!(state[i] & STATE_DTE) && !(state[i] & STATE_DEPLETED) && (state[i] & STATE_RELAY)) relayBits += base.relayFrac[i] * relayRate * step * 3600;
    }
  }

  const kpis = {
    ...base.kpis,
    energyWh: battery.generatedWh,
    peakPowerW,
    dataGb: bitsToGb(bits),
    meanRateMbps: upCount > 0 ? rateSum / upCount / 1e6 : 0,
    minSocPct: 100 * battery.minSocFraction,
    hoursBelowDod: battery.hoursBelowDod,
    hoursDepleted: battery.hoursDepleted,
    survives: battery.survives,
    dodAlert: battery.dodAlert,
    relayDataGb: bitsToGb(relayBits),
  };
  const lost = runsOf(n, (i) => (state[i] & STATE_DEPLETED) !== 0);
  const adv: Advanced = {
    attitude, boresightBody, nominalPowerW, pointingLossDb, diffractionDb, secondaryDiffractionDb, multipathDb, ebN0MarginDb, selfOccluded, contact, thermal, coexistence,
    kpis: {
      tiltDeg: tiltDeg(rot),
      attitudePowerPenaltyPct: eNominal > 0 ? Math.max(0, 100 * (1 - eAttitude / eNominal)) : 0,
      attitudeRfPenaltyPct: bitsNominal > 0 ? Math.max(0, 100 * (1 - bits / bitsNominal)) : 0,
      meanPointingLossDb: upCount > 0 ? pointSum / upCount : 0,
      selfOccludedPct: (100 * occludedCount) / n,
      rfAvailabilityPct: (100 * upCount) / n,
      stationSharePct: stationCount.map((c) => (100 * c) / n),
      noStationPct: (100 * noStation) / n,
      meanExcessLossDb: upCount > 0 ? excessSum / upCount : 0,
      maxSecondaryDiffractionDb: maxSecondary,
      secondaryEdgeHours: secondaryCount * step,
      secondaryLostHours: secondaryLost * step,
      nominalDataGb: bitsToGb(bitsNominal),
      minBusC: thermal ? thermal.minBusK - 273.15 : null,
      heaterWh: thermal ? thermal.heaterWh : 0,
      heaterHours: thermal ? thermal.heaterHours : 0,
      thermalDeathH: thermal && thermal.thermalDeathIndex >= 0 ? thermal.thermalDeathIndex * step : null,
      survivalHours: thermal ? thermal.survivalHours : (lost.length > 0 ? lost[0].start : n) * step,
      roughnessM: kmScaleRoughnessM(dem, observer.x, observer.y),
      skyViewFactor: skyView,
      terrainLitPct: terrainLit ? (100 * terrainLit.reduce((a, b) => a + b, 0)) / n : null,
      slopeTowardEarthDeg,
    },
  };
  return { ...base, input, powerW, rateMbps, battery, kpis, adv };
}

const profileCache = new WeakMap<HorizonProfile, Map<number, TerrainProfile>>();

/** Terrain profile from the lander of `hz` towards a whole-degree azimuth, cached per horizon. */
function profileToward(dem: DemStack, hz: HorizonProfile, azI: number): TerrainProfile {
  let byAz = profileCache.get(hz);
  if (!byAz) { byAz = new Map(); profileCache.set(hz, byAz); }
  let p = byAz.get(azI);
  if (!p) { p = terrainProfile(dem, hz.observer, azI); byAz.set(azI, p); }
  return p;
}

const terrainLitCache = new Map<string, Float32Array>();

/**
 * Sunlit share (0..1) of the terrain within TERRAIN_VIEW_KM of the lander at
 * each sample: what the lander's sides and underside exchange heat with. A
 * lander in a shadowed hollow can be dark while the slopes around it are lit,
 * and the other way round. Swept on a coarse grid every second sample.
 */
export function terrainLitSeries(dem: DemStack, r: Pick<ScenarioResult, 'observer' | 'horizon' | 'count' | 'sunEl' | 'sunAz' | 'sunRadiusDeg' | 'sunFrac' | 'eph'>): Float32Array | null {
  if (!dem.local) return null;
  const obs = r.observer;
  const key = `${dem.local.x0}|${dem.local.y0}|${obs.x.toFixed(4)}|${obs.y.toFixed(4)}|${r.eph.startMs}|${r.count}`;
  const hit = terrainLitCache.get(key);
  if (hit) return hit;
  const grid = decimateGrid(dem.local, 8);
  const ctx = makeSweepContext(grid);
  const m = grid.n;
  const cells: number[] = [];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      if (Math.hypot(grid.x0 + i * grid.spacingKm - obs.x, grid.y0 + j * grid.spacingKm - obs.y) <= TERRAIN_VIEW_KM) cells.push(j * m + i);
    }
  }
  const out = new Float32Array(r.count);
  const ceil = new Float32Array(m * m);
  const bias = grid.spacingKm * 1e-3;
  let last = 0;
  for (let i = 0; i < r.count; i++) {
    if (i % 2 === 0) {
      const tanEl = Math.tan(r.sunEl[i] * DEG);
      const [dirX, dirY] = azimuthToMap(obs.lonDeg, r.sunAz[i]);
      const farBase = farPlaneBase(obs.heightKm, Math.tan(farHorizonAt(r.horizon, r.sunAz[i]) * DEG), farHorizonDistAt(r.horizon, r.sunAz[i]), tanEl);
      sweepShadowCeiling(ctx, { dirX, dirY, tanEl, farBase, originX: obs.x, originY: obs.y }, ceil);
      let lit = 0;
      for (let c = 0; c < cells.length; c++) if (ctx.flat[cells[c]] + bias > ceil[cells[c]]) lit++;
      last = cells.length > 0 ? lit / cells.length : r.sunFrac[i];
    }
    out[i] = last;
  }
  if (terrainLitCache.size >= 12) terrainLitCache.delete(terrainLitCache.keys().next().value as string);
  terrainLitCache.set(key, out);
  return out;
}

/**
 * Distance from the lander to the nearest ground that receives no sunlight at
 * any sampled instant of the window, on the local grid.
 *
 * This is "persistent shadow over the analysed window", a proxy for a
 * permanently shadowed region: a true PSR needs the full 18.6-year cycle.
 * Returns null when no such ground exists within the local grid (8 km).
 */
export function persistentShadowDistanceKm(dem: DemStack, result: Pick<ScenarioResult, 'observer' | 'horizon' | 'count' | 'sunEl' | 'sunAz' | 'sunRadiusDeg'>, maxSweeps = 120): { distanceKm: number | null; shadowedPct: number } {
  if (!dem.local) return { distanceKm: null, shadowedPct: 0 };
  const grid = decimateGrid(dem.local, 4);
  const ctx = makeSweepContext(grid);
  const m = grid.n;
  const ceil = new Float32Array(m * m), acc = new Float32Array(m * m);
  const obs = result.observer, hz = result.horizon;
  const stride = Math.max(1, Math.ceil(result.count / maxSweeps));
  for (let i = 0; i < result.count; i += stride) {
    // The upper limb decides whether any sunlight reaches the ground.
    const tanEl = Math.tan((result.sunEl[i] + result.sunRadiusDeg) * DEG);
    const [dirX, dirY] = azimuthToMap(obs.lonDeg, result.sunAz[i]);
    const farBase = farPlaneBase(obs.heightKm, Math.tan(farHorizonAt(hz, result.sunAz[i]) * DEG), farHorizonDistAt(hz, result.sunAz[i]), tanEl);
    sweepShadowCeiling(ctx, { dirX, dirY, tanEl, farBase, originX: obs.x, originY: obs.y }, ceil);
    accumulateVisible(ctx, ceil, acc);
  }
  let best = Infinity, dark = 0;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      if (acc[j * m + i] > 0) continue;
      dark++;
      const d = Math.hypot(grid.x0 + i * grid.spacingKm - obs.x, grid.y0 + j * grid.spacingKm - obs.y);
      if (d < best) best = d;
    }
  }
  return { distanceKm: Number.isFinite(best) ? best : null, shadowedPct: (100 * dark) / (m * m) };
}

/** Time of sample `i` of a mission result, ms since the Unix epoch. */
export const missionTimeMs = (r: Pick<ScenarioResult, 'eph' | 'stepHours'>, i: number): number => r.eph.startMs + i * r.stepHours * HOUR_MS;
/** Kept for callers that want the lunar radius next to these helpers. */
export const LUNAR_RADIUS_KM = R_MOON_KM;
