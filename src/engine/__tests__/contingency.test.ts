/**
 * Tests of the contingency and survival modules (requirements SyR-P2 to SyR-P5).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET_SHAPES, ATTITUDE_PRESETS, BAND_FREQUENCY_HZ, CANDIDATE_SITES, CRITERIA, DAMAGE_FLUENCE_KG_M2, DEFAULT_ASSET, DEFAULT_POWER,
  DEFAULT_RF, DEFAULT_THERMAL, DEG, DemManifest, DemStack, DispersionOutcome, GROUND_MASK_DEG, MissionInput, MountType,
  NOMINAL_ATTITUDE, POINTING_LOSS_FLOOR_DB, STATE_RF_PHYSICAL, T_BATTERY_DEATH_K, V3, arrayProjection, attitudeMatrix, attitudeOnSlope,
  capacityFraction, computeDSNLinkBudgetAndDataRate, computeDispersionGridAndEscapeVector, computeGroundContact,
  computeLunarRFPropagationLoss, computeSOMRandomForestSiteScore, criterionWeights, decodeGrid, enuFromAzEl,
  evaluateLanderAttitudeImpact, evaluateMission, evaluateMultiAssetInterference, evaluateScenario, fresnelNu, knifeEdgeLossDb,
  kmScaleRoughnessM, latLonToXY, linkBudget, mountProjectionFactor, multipathFadeDb, obstacleAngles, obstacleShadowFraction,
  persistentShadowDistanceKm, plumeEjectaHazard, pointingLossDb, radiatedW, regolithReflection, simulateElectroThermalTimeline,
  stowedBoresight, tiltDeg, toBody, toEnu,
} from '../index';

// ------------------------------------------------------------- attitude

describe('SyR-P2 landing attitude', () => {
  const up: V3 = [0, 0, 1];

  it('builds a proper rotation with the documented sign conventions', () => {
    for (const a of [{ rollDeg: 0, pitchDeg: 0, yawDeg: 0 }, { rollDeg: 30, pitchDeg: -20, yawDeg: 130 }, { rollDeg: -75, pitchDeg: 85, yawDeg: 300 }]) {
      const r = attitudeMatrix(a);
      const v: V3 = [0.3, -0.5, 0.81];
      const back = toEnu(r, toBody(r, v));
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(v[k], 12);
      const z = toEnu(r, up);
      expect(Math.hypot(z[0], z[1], z[2])).toBeCloseTo(1, 12);
    }
    attitudeMatrix(NOMINAL_ATTITUDE).forEach((v, k) => expect(v).toBeCloseTo(k % 4 === 0 ? 1 : 0, 12));
    // Positive roll: right side (east at zero yaw) goes down, body z leans east.
    const roll = attitudeMatrix({ rollDeg: 30, pitchDeg: 0, yawDeg: 0 });
    expect(toEnu(roll, [1, 0, 0])[2]).toBeCloseTo(-0.5, 9);
    expect(toEnu(roll, up)[0]).toBeCloseTo(0.5, 9);
    expect(tiltDeg(roll)).toBeCloseTo(30, 9);
    // Positive pitch: nose (north) up.
    expect(toEnu(attitudeMatrix({ rollDeg: 0, pitchDeg: 20, yawDeg: 0 }), [0, 1, 0])[2]).toBeCloseTo(Math.sin(20 * DEG), 9);
    // Yaw is a compass heading: 90 deg turns the nose to the east.
    const nose = toEnu(attitudeMatrix({ rollDeg: 0, pitchDeg: 0, yawDeg: 90 }), [0, 1, 0]);
    expect(nose[0]).toBeCloseTo(1, 9);
    expect(nose[1]).toBeCloseTo(0, 9);
  });

  it('reduces to the level-lander projection factors at zero attitude', () => {
    for (const el of [-1, 0, 1.5, 12]) {
      const s = enuFromAzEl(77, el);
      for (const mount of ['tracker1axis', 'cylindrical', 'horizontal'] as MountType[]) {
        expect(arrayProjection(mount, s)).toBeCloseTo(mountProjectionFactor(mount, el), 9);
      }
    }
  });

  it('quantifies the IM-1 case: 30 deg of roll starves a deck array and depoints the antenna', () => {
    const im1 = ATTITUDE_PRESETS.find((p) => p.id === 'im1');
    if (!im1) throw new Error('preset missing');
    const att = { ...NOMINAL_ATTITUDE, rollDeg: im1.rollDeg, pitchDeg: im1.pitchDeg, yawDeg: im1.yawDeg };
    // Earth to the east: the roll axis (north) is across the line of sight, so the roll depoints fully.
    // (An Earth due north would lie along the roll axis and barely move in the body frame.)
    const earth = enuFromAzEl(90, 5);
    const boresight = stowedBoresight([90], [5]);
    // Sun low in the west: a lander rolled towards the east turns its deck away from it.
    const west = evaluateLanderAttitudeImpact(att, 'horizontal', boresight, enuFromAzEl(270, 20), earth, 4.2);
    expect(west.nominalProjection).toBeCloseTo(Math.sin(20 * DEG), 9);
    expect(west.projection).toBe(0);
    // Sun in the east: the same roll helps.
    const east = evaluateLanderAttitudeImpact(att, 'horizontal', boresight, enuFromAzEl(90, 20), earth, 4.2);
    expect(east.projection).toBeCloseTo(Math.sin(50 * DEG), 9);
    // Antenna: boresight swings about 30 deg, the 20 deg gimbal recovers part of it.
    expect(west.boresightSeparationDeg).toBeGreaterThan(25);
    expect(west.offAxisDeg).toBeCloseTo(west.boresightSeparationDeg - 20, 9);
    expect(west.pointingLossDb).toBe(POINTING_LOSS_FLOOR_DB);
    expect(west.tiltDeg).toBeCloseTo(30, 9);
    // A level lander keeps the Earth inside the gimbal: no loss.
    const level = evaluateLanderAttitudeImpact(NOMINAL_ATTITUDE, 'horizontal', boresight, enuFromAzEl(270, 20), enuFromAzEl(96, -1), 4.2);
    // Rolling about an axis that points at the Earth leaves the antenna on target.
    const along = evaluateLanderAttitudeImpact(att, 'horizontal', stowedBoresight([0], [0]), enuFromAzEl(270, 20), enuFromAzEl(0, 0), 4.2);
    expect(along.boresightSeparationDeg).toBeCloseTo(0, 6);
    expect(level.pointingLossDb).toBe(0);
    expect(level.selfOccluded).toBe(false);
  });

  it('applies the 12 (alpha / theta)^2 depointing law and flags self-occlusion when tipped over', () => {
    expect(pointingLossDb(0, 10)).toBe(0);
    expect(pointingLossDb(5, 10)).toBeCloseTo(3, 9); // half the beamwidth off axis = the -3 dB point
    expect(pointingLossDb(10, 10)).toBeCloseTo(12, 9);
    expect(pointingLossDb(500, 10)).toBe(POINTING_LOSS_FLOOR_DB);
    // IM-2 on its side, right side down: the Earth to the west is behind the deck.
    const im2 = { ...NOMINAL_ATTITUDE, rollDeg: 75 };
    const boresight = stowedBoresight([270], [4]);
    expect(evaluateLanderAttitudeImpact(im2, 'tracker1axis', boresight, enuFromAzEl(0, 1), enuFromAzEl(270, 4), 4.2).selfOccluded).toBe(true);
    expect(evaluateLanderAttitudeImpact(im2, 'tracker1axis', boresight, enuFromAzEl(0, 1), enuFromAzEl(90, 4), 4.2).selfOccluded).toBe(false);
  });

  it('derives the resting attitude from the terrain gradient', () => {
    // Ground rising 10 % towards the east: the lander leans west by atan(0.1).
    const a = attitudeOnSlope(0.1, 0);
    expect(a.rollDeg).toBeCloseTo(-Math.atan(0.1) / DEG, 9);
    expect(a.pitchDeg).toBeCloseTo(0, 9);
    const b = attitudeOnSlope(0.05, -0.12);
    const z = toEnu(attitudeMatrix({ ...b, yawDeg: 0 }), [0, 0, 1]);
    const inv = 1 / Math.hypot(0.05, 0.12, 1);
    expect(z[0]).toBeCloseTo(-0.05 * inv, 9);
    expect(z[1]).toBeCloseTo(0.12 * inv, 9);
    expect(z[2]).toBeCloseTo(inv, 9);
  });
});

// ------------------------------------------------------------------- RF

describe('SyR-P3 physical RF propagation', () => {
  it('implements the ITU-R P.526 knife-edge approximation', () => {
    expect(knifeEdgeLossDb(0)).toBeCloseTo(6.03, 2); // grazing incidence: about 6 dB
    expect(knifeEdgeLossDb(-0.78)).toBe(0);
    expect(knifeEdgeLossDb(-0.7799)).toBeLessThan(0.01); // continuous at the lower limit
    expect(knifeEdgeLossDb(-3)).toBe(0);
    expect(knifeEdgeLossDb(1)).toBeCloseTo(13.9, 1);
    expect(knifeEdgeLossDb(2.4)).toBeCloseTo(20.5, 1);
    let prev = 0;
    for (let nu = -0.78; nu < 6; nu += 0.1) {
      const l = knifeEdgeLossDb(nu);
      expect(l).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = l;
    }
    expect(fresnelNu(10, 15_000, 0.0357)).toBeCloseTo(10 * Math.sqrt(2 / (0.0357 * 15_000)), 12);
  });

  it('charges about 6 dB when the Earth sits exactly on the ridge, more at X band than at S band below it', () => {
    const grazing = computeLunarRFPropagationLoss(1.2, 1.2, 15_000, 8.4, 4.2, -10);
    expect(grazing.nu).toBeCloseTo(0, 9);
    expect(grazing.diffractionDb).toBeCloseTo(6.03, 2);
    expect(grazing.fresnelRadiusM).toBeCloseTo(Math.sqrt(0.03569 * 15_000), 1);
    // 0.1 deg below a ridge 15 km away: 26 m of rock above the ray.
    const x = computeLunarRFPropagationLoss(1.1, 1.2, 15_000, 8.4, 4.2, -10);
    const s = computeLunarRFPropagationLoss(1.1, 1.2, 15_000, 2.2, 15.9, -10);
    expect(x.obstacleAboveRayM).toBeCloseTo(26.2, 0);
    expect(x.diffractionDb).toBeGreaterThan(s.diffractionDb + 3);
    expect(s.diffractionDb).toBeGreaterThan(6.03);
    // Well clear of the first Fresnel zone: no diffraction loss.
    expect(computeLunarRFPropagationLoss(3, 1.2, 15_000, 8.4, 4.2, -10).diffractionDb).toBe(0);
  });

  it('models the regolith reflection (eps_r = 3.7) and the worst-case two-ray fade', () => {
    const grazing = regolithReflection(0.2);
    expect(grazing.horizontal).toBeGreaterThan(0.98);
    expect(grazing.vertical).toBeGreaterThan(0.95);
    // Brewster angle for vertical polarisation: tan(psi) = 1 / sqrt(eps_r) -> 27.5 deg.
    expect(regolithReflection(27.47).vertical).toBeLessThan(0.02);
    expect(regolithReflection(27.47).horizontal).toBeGreaterThan(0.5);
    // Normal incidence: (1 - sqrt(eps)) / (1 + sqrt(eps)) = 0.316.
    expect(regolithReflection(90).horizontal).toBeCloseTo(0.316, 2);
    expect(multipathFadeDb(-1, 0.0357, 4.2)).toBe(0);
    // A narrow beam rejects the ground bounce; a wide one does not.
    const narrow = multipathFadeDb(1.5, 0.0357, 4.2), wide = multipathFadeDb(1.5, 0.0357, 40);
    expect(narrow).toBeLessThan(wide);
    expect(wide).toBeGreaterThan(3);
    expect(multipathFadeDb(20, 0.0357, 4.2)).toBeLessThan(0.01);
  });

  it('hands the Moon over between the three DSN complexes as the Earth turns', () => {
    const start = Date.UTC(2027, 8, 1);
    const c = computeGroundContact(start, 30 * 24, 1, 'dsn34');
    expect(c.sites.map((s) => s.name)).toEqual(['Goldstone', 'Madrid', 'Canberra']);
    const share = [0, 0, 0];
    let none = 0, handovers = 0;
    for (let i = 0; i < c.station.length; i++) {
      const s = c.station[i];
      if (s < 0) none++; else { share[s]++; expect(c.elevationDeg[i]).toBeGreaterThan(GROUND_MASK_DEG); }
      if (i > 0 && s !== c.station[i - 1]) handovers++;
    }
    // Three sites about 120 deg apart: near-continuous coverage, each tracking roughly a third of the time.
    expect(none / c.station.length).toBeLessThan(0.08);
    for (const n of share) {
      expect(n / c.station.length).toBeGreaterThan(0.18);
      expect(n / c.station.length).toBeLessThan(0.5);
    }
    // About three handovers per day.
    expect(handovers / 30).toBeGreaterThan(2.4);
    expect(handovers / 30).toBeLessThan(4.6);
    // A single dish in Concepcion sees the Moon only part of each day.
    const udec = computeGroundContact(start, 30 * 24, 1, 'gisat37');
    const up = Array.from(udec.station).filter((s) => s >= 0).length / udec.station.length;
    expect(up).toBeGreaterThan(0.25);
    expect(up).toBeLessThan(0.55);
  });

  it('turns excess loss into data rate through the link budget', () => {
    const rf = { ...DEFAULT_RF, groundStationId: 'gisat37' };
    const base = linkBudget(rf, 384_400);
    const clear = computeDSNLinkBudgetAndDataRate(base, rf, 384_400, 0, true);
    expect(clear.dataRateBps).toBeCloseTo(base.dataRateBps, 3);
    expect(clear.limitedBy).toBe('power');
    // 10 dB of extra loss costs a factor of ten in a power-limited link.
    const lossy = computeDSNLinkBudgetAndDataRate(base, rf, 384_400, 10, true);
    expect(clear.dataRateBps / lossy.dataRateBps).toBeCloseTo(10, 6);
    expect(lossy.marginDb).toBeCloseTo(rf.linkMarginDb, 9);
    // The big dish has margin to spare: 6 dB of diffraction does not touch the bandwidth-limited rate.
    const dsn = linkBudget(DEFAULT_RF, 384_400);
    expect(computeDSNLinkBudgetAndDataRate(dsn, DEFAULT_RF, 384_400, 6, true).dataRateBps).toBe(dsn.bandwidthLimitedRateBps);
    expect(computeDSNLinkBudgetAndDataRate(dsn, DEFAULT_RF, 384_400, 0, false).limitedBy).toBe('no-station');
    expect(computeDSNLinkBudgetAndDataRate(base, rf, 384_400, 60, true).dataRateBps).toBe(0);
    expect(BAND_FREQUENCY_HZ.X).toBe(8.4e9);
  });
});

// -------------------------------------------------------------- thermal

describe('SyR-P4 electro-thermal survival', () => {
  const dark = (hours: number): { p: Float32Array; f: Float32Array } => ({ p: new Float32Array(hours), f: new Float32Array(hours) });

  it('derates the battery between -10 and -20 degC', () => {
    expect(capacityFraction(300)).toBe(1);
    expect(capacityFraction(263.15)).toBe(1);
    expect(capacityFraction(258.15)).toBeCloseTo(0.8, 9);
    expect(capacityFraction(T_BATTERY_DEATH_K)).toBeCloseTo(0.6, 9);
    expect(radiatedW(DEFAULT_THERMAL, 273.15, 70)).toBeCloseTo(0.5 * 5.670374e-8 * 0.5 * (273.15 ** 4 - 70 ** 4), 6);
  });

  it('holds the bus near 0 degC with the heaters and pays for it from the battery', () => {
    const { p, f } = dark(40);
    const power = { ...DEFAULT_POWER, batteryCapacityWh: 20_000 };
    const r = simulateElectroThermalTimeline(power, DEFAULT_THERMAL, p, f, 1);
    expect(r.survives).toBe(true);
    expect(r.thermalDeathIndex).toBe(-1);
    // The thermostat keeps the bus within its 5 K band once it has cooled to the set point.
    expect(r.minBusK).toBeGreaterThan(271.5);
    expect(r.tBusK[39]).toBeLessThan(280);
    expect(r.heaterHours).toBeGreaterThan(5);
    // Mean heater power balances the radiative leak minus the survival electronics.
    const leak = radiatedW(DEFAULT_THERMAL, 275, 70);
    const tail = r.heaterW.slice(25).reduce((a, b) => a + b, 0) / 15;
    expect(tail).toBeGreaterThan(leak - DEFAULT_POWER.survivalLoadW - 15);
    expect(tail).toBeLessThan(leak - DEFAULT_POWER.survivalLoadW + 15);
    // Energy bookkeeping: what left the battery is what was consumed.
    expect(20_000 - r.socWh[39]).toBeCloseTo(r.consumedWh, 0);
    expect(r.heaterWh).toBeLessThan(r.consumedWh);
  });

  it('freezes the battery when the heaters are too small or the battery too small', () => {
    // No heaters: the bus cools from +20 to -20 degC in roughly a day.
    const { p, f } = dark(120);
    const cold = simulateElectroThermalTimeline(DEFAULT_POWER, { ...DEFAULT_THERMAL, heaterW: 0 }, p, f, 1);
    expect(cold.thermalDeathIndex).toBeGreaterThan(10);
    expect(cold.thermalDeathIndex).toBeLessThan(60);
    expect(cold.survives).toBe(false);
    expect(cold.survivalHours).toBe(cold.thermalDeathIndex);
    expect(cold.tBusK[cold.thermalDeathIndex]).toBeLessThanOrEqual(T_BATTERY_DEATH_K + 0.5);
    // Heaters present but a small battery: it empties, then the bus freezes.
    const small = simulateElectroThermalTimeline({ ...DEFAULT_POWER, batteryCapacityWh: 1500 }, DEFAULT_THERMAL, p, f, 1);
    expect(small.survives).toBe(false);
    expect(small.unmetWh).toBeGreaterThan(0);
    expect(small.thermalDeathIndex).toBeGreaterThan(cold.thermalDeathIndex);
    // The default 4 kWh battery outlasts both, but not 120 h of darkness.
    const nominal = simulateElectroThermalTimeline(DEFAULT_POWER, DEFAULT_THERMAL, p, f, 1);
    expect(nominal.survivalHours).toBeGreaterThan(small.survivalHours);
    expect(nominal.survives).toBe(false);
    // Once dead, it stays dead: no load is served afterwards.
    expect(cold.loadW[119]).toBe(0);
    expect(cold.socWh[119]).toBe(0);
  });

  it('stays warm and charged in sunlight, limited by the thermal control ceiling', () => {
    const p = new Float32Array(72).fill(800), f = new Float32Array(72).fill(1);
    const r = simulateElectroThermalTimeline(DEFAULT_POWER, DEFAULT_THERMAL, p, f, 1);
    expect(r.survives).toBe(true);
    expect(r.heaterWh).toBe(0);
    expect(r.minSocFraction).toBeCloseTo(1, 6);
    expect(Math.max(...r.tBusK)).toBeLessThanOrEqual(DEFAULT_THERMAL.maxBusK + 1e-3);
    expect(r.tEnvK[71]).toBeGreaterThan(225);
    // A day/night cycle: the bus temperature follows the light, the battery recovers each day.
    const cyc = new Float32Array(288).map((_, i) => (i % 96 < 50 ? 800 : 0)); // 50 h of light, 46 h of night
    const cf = cyc.map((v) => (v > 0 ? 1 : 0));
    const c = simulateElectroThermalTimeline(DEFAULT_POWER, DEFAULT_THERMAL, cyc, cf, 1);
    expect(c.survives).toBe(true);
    expect(c.heaterWh).toBeGreaterThan(0);
    expect(c.socWh[96 + 49]).toBeCloseTo(DEFAULT_POWER.batteryCapacityWh, -1); // full again at the end of the second day
  });
});

// ------------------------------------------------------ score / dispersion

describe('SyR-P5 site score, dispersion and coexistence', () => {
  it('uses the published weights and renormalises over the available criteria', () => {
    const w = criterionWeights('synthesized');
    expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const total = CRITERIA.reduce((a, c) => a + c.weightPct, 0);
    expect(total).toBeCloseTo(97.37, 2);
    expect(w.earthVisibility).toBeCloseTo(23.16 / total, 12);
    expect(criterionWeights('engineering').earthVisibility).toBeGreaterThan(w.earthVisibility);
    expect(criterionWeights('science').hydrogen).toBeGreaterThan(w.hydrogen);

    const best = { earthVisibility: 100, hydrogen: 0.5, roughness: 0, slope: 0, illumination: 100, psrProximity: 0, feo: 20, geology: 1, gravity: -300 };
    const worst = { earthVisibility: 0, hydrogen: 0, roughness: 400, slope: 30, illumination: 0, psrProximity: 50, feo: 0, geology: 0, gravity: 0 };
    expect(computeSOMRandomForestSiteScore(best).score).toBeCloseTo(100, 9);
    expect(computeSOMRandomForestSiteScore(best).coveragePct).toBeCloseTo(100, 9);
    expect(computeSOMRandomForestSiteScore(worst).score).toBeCloseTo(0, 9);

    // Without hydrogen, FeO, geology and gravity: 68.85 % of the weight, and the score ignores the rest.
    const computed = { earthVisibility: 80, roughness: 50, slope: 5, illumination: 60, psrProximity: 4, hydrogen: null };
    const s = computeSOMRandomForestSiteScore(computed);
    expect(s.coveragePct).toBeCloseTo((100 * (23.16 + 12.82 + 11.55 + 9.83 + 9.68)) / total, 6);
    const expected = (23.16 * 0.8 + 12.82 * 0.75 + 11.55 * 0.75 + 9.83 * 0.6 + 9.68 * 0.8) / (23.16 + 12.82 + 11.55 + 9.83 + 9.68);
    expect(s.score).toBeCloseTo(100 * expected, 9);
    expect(s.rows.reduce((a, r) => a + r.points, 0)).toBeCloseTo(s.score, 9);
    expect(s.rows.find((r) => r.id === 'hydrogen')?.available).toBe(false);
    // Science-first weighting favours a volatile-rich site.
    const rich = { ...computed, hydrogen: 0.5 }, poor = { ...computed, hydrogen: 0 };
    const gap = (m: 'synthesized' | 'science'): number => computeSOMRandomForestSiteScore(rich, m).score - computeSOMRandomForestSiteScore(poor, m).score;
    expect(gap('science')).toBeGreaterThan(gap('synthesized'));
  });

  it('finds the escape vector across a 5 x 5 dispersion grid', () => {
    // Survival improves towards the south-east corner.
    const evalAt = (e: number, n: number): DispersionOutcome => {
      const h = 100 + 0.2 * e - 0.1 * n;
      return { survivalHours: h, linkPct: 40, energyWh: 1000, lost: h < 110 };
    };
    const d = computeDispersionGridAndEscapeVector(evalAt, 200, 5, 160);
    expect(d.cells).toHaveLength(25);
    expect(d.cells[0].eastM).toBe(-200);
    expect(d.cells[0].northM).toBe(-200);
    expect(d.cells[24].eastM).toBe(200);
    expect(d.centre.eastM).toBe(0);
    expect(d.best.eastM).toBe(200);
    expect(d.best.northM).toBe(-200);
    expect(d.escape?.distanceM).toBeCloseTo(Math.hypot(200, 200), 9);
    expect(d.escape?.azimuthDeg).toBeCloseTo(135, 9); // south-east
    expect(d.escape?.gainHours).toBeCloseTo(60, 9);
    expect(d.best.merit).toBeGreaterThan(d.centre.merit);
    // When the aim point is already the best, there is nowhere to escape to.
    const flat = computeDispersionGridAndEscapeVector(() => ({ survivalHours: 50, linkPct: 30, energyWh: 10, lost: false }), 200, 5, 50);
    expect(flat.escape).toBeNull();
    expect(flat.survivingPct).toBe(100);
    // Ties in survival are broken by link availability.
    const link = computeDispersionGridAndEscapeVector((e) => ({ survivalHours: 50, linkPct: 30 + e / 20, energyWh: 10, lost: false }), 200, 5, 50);
    expect(link.best.eastM).toBe(200);
    expect(link.escape?.azimuthDeg).toBeCloseTo(90, 9);
  });

  it('computes mutual shadowing geometry', () => {
    // A 10 m tower 150 m away subtends 0.38 deg half-width and rises to 3.05 deg above 2 m arrays.
    const a = obstacleAngles(2, 10, 2, 150);
    expect(a.halfWidthDeg).toBeCloseTo(Math.atan(1 / 150) / DEG, 9);
    expect(a.topElevDeg).toBeCloseTo(Math.atan(8 / 150) / DEG, 9);
    expect(obstacleShadowFraction(90, 1, 0.266, 90, a.halfWidthDeg, a.topElevDeg)).toBe(1); // Sun dead behind it
    expect(obstacleShadowFraction(95, 1, 0.266, 90, a.halfWidthDeg, a.topElevDeg)).toBe(0); // off to the side
    expect(obstacleShadowFraction(90, 5, 0.266, 90, a.halfWidthDeg, a.topElevDeg)).toBe(0); // above its top
    const edge = obstacleShadowFraction(90 + a.halfWidthDeg, 1, 0.266, 90, a.halfWidthDeg, a.topElevDeg);
    expect(edge).toBeCloseTo(0.5, 2); // half the disc behind the edge

    // Sun circling the horizon at 1 deg: the tower hides it for a short arc each turn.
    const az = new Float32Array(720).map((_, i) => i / 2), el = new Float32Array(720).fill(1), lit = new Float32Array(720).fill(1);
    const r = evaluateMultiAssetInterference({ ...DEFAULT_ASSET, enabled: true }, az, el, lit, 0.266, 0, 2);
    expect(r.landerShadedPct).toBeGreaterThan(0.2);
    expect(r.landerShadedPct).toBeLessThan(1.5);
    expect(r.assetShadedPct).toBeGreaterThan(0.2);
    expect(r.landerBlock[180]).toBe(1); // az 90
    expect(r.landerBlock[0]).toBe(0);
    expect(ASSET_SHAPES.tower.heightM).toBe(10);
  });

  it('scales the plume ejecta hazard with thrust and distance', () => {
    // Calibration: a 13 kN lunar-module-class engine gives the 2 km keep-out radius.
    expect(plumeEjectaHazard(13, 2000).hazardRadiusM).toBeCloseTo(2000, 6);
    expect(plumeEjectaHazard(13, 2000).fluenceRatio).toBeCloseTo(1, 9);
    // A 3 kN CLPS-class engine: radius scales with the square root of thrust.
    const clps = plumeEjectaHazard(3, 150);
    expect(clps.hazardRadiusM).toBeCloseTo(2000 * Math.sqrt(3 / 13), 6);
    expect(clps.violated).toBe(true);
    expect(clps.fluenceAtAssetKgM2).toBeGreaterThan(DAMAGE_FLUENCE_KG_M2);
    expect(plumeEjectaHazard(3, 1200).violated).toBe(false);
    // Inverse-square in distance.
    expect(plumeEjectaHazard(3, 100).fluenceAtAssetKgM2 / plumeEjectaHazard(3, 200).fluenceAtAssetKgM2).toBeCloseTo(4, 9);
  });
});

// ------------------------------------------------------ mission on LOLA

describe('mission evaluation on LOLA terrain', () => {
  const dir = join(process.cwd(), 'public', 'dem');
  const load = (file: string): ArrayBuffer => {
    const b = readFileSync(join(dir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  let dem: DemStack;
  const site = CANDIDATE_SITES[0];
  const input = (over: Partial<MissionInput> = {}): MissionInput => ({
    latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs: Date.UTC(2027, 8, 1), days: 30, stepHours: 1, mastM: 2,
    power: DEFAULT_POWER, rf: DEFAULT_RF, ...over,
  });

  beforeAll(() => {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as DemManifest;
    const info = manifest.sites.find((s) => s.id === site.id);
    if (!info) throw new Error('missing site grid');
    const [cx, cy] = latLonToXY(site.latDeg, site.lonDeg);
    dem = { regional: decodeGrid(load(manifest.regional.file), manifest.regional), local: decodeGrid(load(info.file), info, cx, cy) };
  });

  it('leaves the baseline untouched for a level lander', () => {
    const base = evaluateScenario(dem, input());
    const m = evaluateMission(dem, input());
    for (let i = 0; i < base.count; i++) expect(m.powerW[i]).toBeCloseTo(base.powerW[i], 2);
    expect(m.kpis.illuminationPct).toBe(base.kpis.illuminationPct);
    expect(m.kpis.dtePct).toBe(base.kpis.dtePct);
    expect(m.kpis.energyWh).toBeCloseTo(base.kpis.energyWh, 0);
    expect(m.adv.kpis.attitudePowerPenaltyPct).toBeCloseTo(0, 3); // float32 power series
    expect(m.adv.kpis.attitudeRfPenaltyPct).toBeCloseTo(0, 6);
    expect(m.adv.kpis.tiltDeg).toBe(0);
    expect(m.adv.thermal).toBeNull();
    // Station shares and the uncovered share add up to the whole window.
    expect(m.adv.kpis.stationSharePct.reduce((a, b) => a + b, 0) + m.adv.kpis.noStationPct).toBeCloseTo(100, 9);
    // The physical link is never up while the Earth is 3 deg below the terrain.
    for (let i = 0; i < m.count; i++) {
      if (m.earthClear[i] + DEFAULT_RF.elevationMarginDeg < -3) expect(m.state[i] & STATE_RF_PHYSICAL).toBe(0);
      if (!(m.state[i] & STATE_RF_PHYSICAL)) expect(m.rateMbps[i]).toBe(0);
    }
    expect(m.adv.kpis.rfAvailabilityPct).toBeGreaterThan(20);
    expect(m.adv.kpis.roughnessM).toBeGreaterThan(1);
    expect(m.adv.kpis.roughnessM).toBeCloseTo(kmScaleRoughnessM(dem, m.observer.x, m.observer.y), 9);
  });

  it('shows the historical tip-over cases cost power and, above all, the downlink', () => {
    const level = evaluateMission(dem, input());
    const im1 = evaluateMission(dem, input({ attitude: { ...NOMINAL_ATTITUDE, rollDeg: 30 } }));
    const im2 = evaluateMission(dem, input({ attitude: { ...NOMINAL_ATTITUDE, rollDeg: 75 } }));
    expect(im1.adv.kpis.tiltDeg).toBeCloseTo(30, 6);
    expect(im1.adv.kpis.attitudePowerPenaltyPct).toBeGreaterThan(2);
    expect(im1.kpis.energyWh).toBeLessThan(level.kpis.energyWh);
    // 30 deg of tilt exceeds the 20 deg gimbal: the 4 deg beam misses the Earth.
    expect(im1.adv.kpis.attitudeRfPenaltyPct).toBeGreaterThan(50);
    expect(im1.kpis.dataGb).toBeLessThan(0.5 * level.kpis.dataGb);
    expect(im2.adv.kpis.attitudePowerPenaltyPct).toBeGreaterThan(im1.adv.kpis.attitudePowerPenaltyPct);
    expect(im2.adv.kpis.attitudeRfPenaltyPct).toBeGreaterThan(90);
    // A wider gimbal recovers the IM-1 link.
    const steer = evaluateMission(dem, input({ attitude: { ...NOMINAL_ATTITUDE, rollDeg: 30, gimbalRangeDeg: 45 } }));
    expect(steer.adv.kpis.attitudeRfPenaltyPct).toBeLessThan(5);
  });

  it('couples the thermal model and a neighbouring asset into the same result', () => {
    const m = evaluateMission(dem, input({ thermal: DEFAULT_THERMAL, asset: { ...DEFAULT_ASSET, enabled: true } }));
    const th = m.adv.thermal;
    if (!th) throw new Error('thermal result missing');
    expect(m.battery).toBe(th);
    for (let i = 0; i < m.count; i++) {
      expect(th.tBusK[i]).toBeGreaterThan(150);
      expect(th.tBusK[i]).toBeLessThanOrEqual(DEFAULT_THERMAL.maxBusK + 1e-3);
    }
    expect(m.adv.kpis.minBusC).toBeCloseTo(th.minBusK - 273.15, 9);
    const co = m.adv.coexistence;
    if (!co) throw new Error('coexistence result missing');
    expect(co.psi.violated).toBe(true); // 150 m from a 3 kN descent
    expect(co.landerShadedPct).toBeGreaterThanOrEqual(0);
    expect(m.kpis.energyWh).toBeLessThanOrEqual(evaluateMission(dem, input({ thermal: DEFAULT_THERMAL })).kpis.energyWh + 1e-6);
  });

  it('locates the persistent shadow of Shackleton next to the ridge', () => {
    const m = evaluateMission(dem, input());
    const psr = persistentShadowDistanceKm(dem, m);
    expect(psr.distanceKm).not.toBeNull();
    expect(psr.distanceKm as number).toBeGreaterThan(0.1);
    expect(psr.distanceKm as number).toBeLessThan(8);
    expect(psr.shadowedPct).toBeGreaterThan(2);
    expect(psr.shadowedPct).toBeLessThan(90);
  });
});
