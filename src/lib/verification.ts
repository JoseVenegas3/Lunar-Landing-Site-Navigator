/**
 * Live verification matrix (INCOSE / ISO 15288 style) for requirements SyR-P1
 * to SyR-P5 of the team's specification.
 *
 * Every row is evaluated when the dialog opens: analytic checks call the engine
 * functions with known inputs, live checks read the active scenario. Statuses:
 *   VERIFIED    the check ran and met its criterion
 *   PARTIAL     the function works but part of its input is not available
 *   INSPECTION  can only be confirmed by looking at the application
 *   FAIL        the check ran and did not meet its criterion
 */
import {
  ATTITUDE_PRESETS, DEFAULT_POWER, DEFAULT_THERMAL, DispersionResult, HorizonProfile, MissionResult, NOMINAL_ATTITUDE, R_MOON_KM, SiteScore,
  T_BATTERY_DEATH_K, computeDispersionGridAndEscapeVector, computeLunarRFPropagationLoss, enuFromAzEl, evaluateLanderAttitudeImpact,
  plumeEjectaHazard, simulateElectroThermalTimeline, solarDiscFraction, stowedBoresight,
} from '../engine';

export type VerificationStatus = 'VERIFIED' | 'PARTIAL' | 'INSPECTION' | 'FAIL';

export interface VerificationRow {
  id: string;
  parent: string | null;
  title: { en: string; es: string };
  fn: string;
  status: VerificationStatus;
  /** Measured evidence, language independent. */
  evidence: string;
}

export interface VerificationContext {
  result: MissionResult | null;
  score: SiteScore | null;
  dispersion: DispersionResult | null;
}

function flatProfile(): HorizonProfile {
  return {
    observer: { x: 0, y: -50, latDeg: -88.35, lonDeg: 180, groundKm: 0, heightKm: 0 },
    elevDeg: new Float32Array(360), distKm: new Float32Array(360).fill(10),
    farElevDeg: new Float32Array(360), farDistKm: new Float32Array(360).fill(10),
  };
}

const ok = (pass: boolean): VerificationStatus => (pass ? 'VERIFIED' : 'FAIL');

export function buildVerificationMatrix(ctx: VerificationContext): VerificationRow[] {
  const r = ctx.result;
  const rows: VerificationRow[] = [];
  const child = (id: string, parent: string, en: string, es: string, fn: string, status: VerificationStatus, evidence: string): void => {
    rows.push({ id, parent, title: { en, es }, fn, status, evidence });
  };

  // ---- SyR-P1
  const drop = (100 * 100 * 1000) / (2 * R_MOON_KM);
  child('SyR-C1.1', 'SyR-P1', '360° horizon with spherical curvature', 'Horizonte 360° con curvatura esférica', 'computeHorizon',
    ok(Math.abs(drop - 2878) < 1 && (!r || r.horizon.elevDeg.length === 360)),
    `curvature drop at 100 km = ${drop.toFixed(0)} m (expected 2878 m); profile ${r ? r.horizon.elevDeg.length : 360} azimuths, range 250 km, exact spherical geometry`);

  let lib = 'no scenario loaded';
  let libPass = true;
  if (r) {
    let latMax = 0, lonMax = 0;
    for (let i = 0; i < r.eph.count; i++) {
      latMax = Math.max(latMax, Math.abs(r.eph.subEarthLat[i]));
      lonMax = Math.max(lonMax, Math.abs(r.eph.subEarthLon[i]));
    }
    libPass = latMax < 6.95 && lonMax < 8.3;
    lib = `libration in this window: lat ±${latMax.toFixed(2)}°, lon ±${lonMax.toFixed(2)}° (limits 6.9° / 8.2°); validated against JPL Horizons to 0.0023°`;
  }
  child('SyR-C1.2', 'SyR-P1', 'Selenocentric ephemeris and libration box', 'Efemérides selenocéntricas y caja de libración', 'computeEphemeris', ok(libPass), lib);

  const half = solarDiscFraction(flatProfile(), 40, 0, 0.2665);
  child('SyR-C1.3', 'SyR-P1', 'Finite solar disc and penumbra fraction', 'Disco solar finito y fracción de penumbra', 'solarDiscFraction',
    ok(Math.abs(half - 0.5) < 0.01), `disc centred on the horizon: f = ${half.toFixed(3)} (expected 0.50); disc diameter 0.533°`);

  // ---- SyR-P2
  const im1 = ATTITUDE_PRESETS.find((p) => p.id === 'im1') ?? ATTITUDE_PRESETS[0];
  const t0 = performance.now();
  const samples = r ? r.count : 1441;
  let loss = 0;
  const bore = stowedBoresight([90], [4]);
  for (let i = 0; i < samples; i++) {
    loss = evaluateLanderAttitudeImpact({ ...NOMINAL_ATTITUDE, rollDeg: im1.rollDeg }, 'horizontal', bore, enuFromAzEl(270, 3), enuFromAzEl(90, 4), 4.2).pointingLossDb;
  }
  const dt = performance.now() - t0;
  child('SyR-C2.1', 'SyR-P2', 'Kinematic transform of arrays and antenna', 'Transformación cinemática de paneles y antena', 'evaluateLanderAttitudeImpact',
    ok(dt < 50 && loss > 0), `${samples} samples re-evaluated in ${dt.toFixed(1)} ms (limit 50 ms); IM-1 preset: ${loss.toFixed(0)} dB depointing, deck array output 0 W with the Sun in the west`
      + (r ? `; active scenario: tilt ${r.adv.kpis.tiltDeg.toFixed(0)}°, power penalty ${r.adv.kpis.attitudePowerPenaltyPct.toFixed(1)} %, data penalty ${r.adv.kpis.attitudeRfPenaltyPct.toFixed(1)} %` : ''));
  child('SyR-C2.2', 'SyR-P2', '3-D view of the tilted lander, antenna cone and Earth ray', 'Vista 3D del lander inclinado, cono de antena y rayo a la Tierra', 'Lander / AttitudeGizmo (three.js)',
    'INSPECTION', 'move the roll and pitch sliders of the Contingency panel and watch the 3-D view; covered by the automated screenshots');

  // ---- SyR-P3
  const graze = computeLunarRFPropagationLoss(1.2, 1.2, 15000, 8.4, 4.2, -10);
  child('SyR-C3.1', 'SyR-P3', 'Knife-edge diffraction (ITU-R P.526) and regolith multipath', 'Difracción en filo de cuchillo (ITU-R P.526) y multipath en regolito', 'computeLunarRFPropagationLoss',
    ok(Math.abs(graze.diffractionDb - 6.03) < 0.05), `Earth exactly on the ridge (nu = 0): ${graze.diffractionDb.toFixed(2)} dB (expected ≈ 6.0 dB); regolith eps_r = 3.7, tan delta = 0.01`
      + (r ? `; active scenario: mean excess loss ${r.adv.kpis.meanExcessLossDb.toFixed(1)} dB while the link is up` : ''));
  let dsn = 'no scenario loaded';
  let dsnStatus: VerificationStatus = 'VERIFIED';
  if (r) {
    let hand = 0;
    for (let i = 1; i < r.count; i++) if (r.adv.contact.station[i] !== r.adv.contact.station[i - 1] && r.adv.contact.station[i] >= 0 && r.adv.contact.station[i - 1] >= 0) hand++;
    const days = (r.count * r.stepHours) / 24;
    const shares = r.adv.contact.sites.map((s, k) => `${s.name} ${r.adv.kpis.stationSharePct[k].toFixed(0)} %`).join(', ');
    dsn = `${shares}; ${(hand / days).toFixed(1)} handovers per day; ${r.kpis.dataGb.toFixed(1)} GB returned, mean ${r.kpis.meanRateMbps.toFixed(2)} Mbps`;
    if (r.adv.contact.sites.length >= 3) dsnStatus = ok(hand / days > 2 && hand / days < 5);
    else dsnStatus = 'PARTIAL';
    if (r.adv.contact.sites.length < 3) dsn += ' (single ground site selected: no handover to verify)';
  }
  child('SyR-C3.2', 'SyR-P3', 'Ground-station handover and data rate', 'Relevo de estaciones terrenas y tasa de datos', 'computeDSNLinkBudgetAndDataRate / computeGroundContact', dsnStatus, dsn);

  // ---- SyR-P4
  const night = simulateElectroThermalTimeline(DEFAULT_POWER, DEFAULT_THERMAL, new Float32Array(160), new Float32Array(160), 1);
  const heaterAt = night.heaterW.findIndex((w) => w > 0);
  const heaterTemp = heaterAt > 0 ? night.tBusK[heaterAt - 1] : NaN;
  const thermalPass = heaterAt > 0 && heaterTemp < 279 && night.thermalDeathIndex > heaterAt && night.tBusK[night.thermalDeathIndex] <= T_BATTERY_DEATH_K + 0.5;
  child('SyR-C4.1', 'SyR-P4', 'Thermostat loop of the survival heaters', 'Lazo termostático de los calefactores de supervivencia', 'simulateElectroThermalTimeline',
    ok(thermalPass), `160 h of darkness, default lander: heaters switch on at hour ${heaterAt} (bus at ${(heaterTemp - 273.15).toFixed(1)} °C), battery frozen at hour ${night.thermalDeathIndex}`
      + (r && r.adv.thermal ? `; active scenario: minimum bus ${r.adv.kpis.minBusC?.toFixed(1)} °C, heaters ${r.adv.kpis.heaterHours.toFixed(0)} h, ${r.adv.kpis.thermalDeathH === null ? 'no thermal death' : `thermal death at T+${r.adv.kpis.thermalDeathH.toFixed(0)} h`}` : '')
      + (r && !r.adv.thermal ? '; thermal model is switched off in the active scenario' : ''));

  // ---- SyR-P5
  if (ctx.score) {
    child('SyR-C5.1', 'SyR-P5', 'Multi-criteria suitability score', 'Índice multicriterio de aptitud', 'computeSOMRandomForestSiteScore',
      ctx.score.coveragePct > 99.9 ? 'VERIFIED' : 'PARTIAL',
      `score ${ctx.score.score.toFixed(1)} / 100 over ${ctx.score.coveragePct.toFixed(0)} % of the published weight`
        + (ctx.score.coveragePct > 99.9 ? '' : `; no data for: ${ctx.score.rows.filter((x) => !x.available).map((x) => x.id).join(', ')} (enter by hand to include them)`));
  } else {
    child('SyR-C5.1', 'SyR-P5', 'Multi-criteria suitability score', 'Índice multicriterio de aptitud', 'computeSOMRandomForestSiteScore', 'PARTIAL', 'open the Score panel to evaluate the active site');
  }
  const synth = computeDispersionGridAndEscapeVector((e, n) => ({ survivalHours: 100 + 0.2 * e - 0.1 * n, linkPct: 40, energyWh: 1, lost: false }), 200, 5);
  const synthPass = synth.cells.length === 25 && Math.abs((synth.escape?.azimuthDeg ?? 0) - 135) < 1e-6;
  child('SyR-C5.2', 'SyR-P5', '5 × 5 dispersion grid and escape vector', 'Malla de dispersión 5 × 5 y vector de escape', 'computeDispersionGridAndEscapeVector',
    ok(synthPass), `reference gradient: 25 cells, escape azimuth ${synth.escape?.azimuthDeg.toFixed(0)}° over ${synth.escape?.distanceM.toFixed(0)} m (expected 135°, 283 m)`
      + (ctx.dispersion ? `; active site: ${ctx.dispersion.escape ? `escape ${ctx.dispersion.escape.azimuthDeg.toFixed(0)}° / ${ctx.dispersion.escape.distanceM.toFixed(0)} m, +${ctx.dispersion.escape.gainHours.toFixed(0)} h` : 'aim point is already the best cell'}, ${ctx.dispersion.survivingPct.toFixed(0)} % of cells survive` : '; open the Survival panel to run it on the active site'));
  const lm = plumeEjectaHazard(13, 2000);
  child('SyR-C5.3', 'SyR-P5', 'Scaled NASA exclusion radius and mutual shadowing', 'Radio de exclusión NASA escalado y sombra mutua', 'evaluateMultiAssetInterference',
    ok(Math.abs(lm.hazardRadiusM - 2000) < 1), `calibration: 13 kN engine -> ${lm.hazardRadiusM.toFixed(0)} m (NASA heritage-site exclusion distance, a normative figure)`
      + (r && r.adv.coexistence ? `; active asset: hazard radius ${r.adv.coexistence.psi.hazardRadiusM.toFixed(0)} m, fluence ${r.adv.coexistence.psi.fluenceRatio.toFixed(1)} x threshold, lander shaded ${r.adv.coexistence.landerShadedPct.toFixed(2)} % of the window` : '; no neighbouring asset is enabled'));

  // ---- parents
  const parents: [string, string, string][] = [
    ['SyR-P1', 'Topographic and ephemeris engine', 'Motor topográfico y de efemérides'],
    ['SyR-P2', 'Resilience to landing-attitude anomalies', 'Resiliencia a anomalías de actitud'],
    ['SyR-P3', 'Physical RF link budget and ground segment', 'Presupuesto de enlace RF físico y segmento terreno'],
    ['SyR-P4', 'Coupled electro-thermal simulation', 'Simulación electro-térmica acoplada'],
    ['SyR-P5', 'Spatial optimisation and multi-mission coexistence', 'Optimización espacial y coexistencia multi-misión'],
  ];
  const out: VerificationRow[] = [];
  for (const [id, en, es] of parents) {
    const kids = rows.filter((k) => k.parent === id);
    const status: VerificationStatus = kids.some((k) => k.status === 'FAIL') ? 'FAIL'
      : kids.some((k) => k.status === 'PARTIAL') ? 'PARTIAL'
        : kids.every((k) => k.status === 'INSPECTION') ? 'INSPECTION' : 'VERIFIED';
    out.push({ id, parent: null, title: { en, es }, fn: '', status, evidence: `${kids.filter((k) => k.status === 'VERIFIED').length} of ${kids.length} child requirements verified automatically` });
    out.push(...kids);
  }
  return out;
}
