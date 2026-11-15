/**
 * The dramatic conditions of the beginner script, measured with the real
 * engine (v3.0). Shared by scripts/find-tutorial-scenarios.ts, which searches
 * the catalogue for scenarios that meet them, and by the unit test that
 * re-validates the stored scenarios: if the engine changes, the test fails.
 *
 * Only the six sites whose 20 m LOLA grid ships in public/dem/ are used, so
 * the tutorial never needs the network. Inputs mirror the app (mission.tsx):
 * default hardware, thermal model on with the Diviner sunlit sink of the site,
 * relocation inside the ±500 m box.
 */
import {
  ATTITUDE_PRESETS, AttitudeConfig, DEFAULT_ASSET, DEFAULT_POWER, DEFAULT_RELAY, DEFAULT_RF, DEFAULT_THERMAL, DEFAULT_TIPOVER, DEFAULT_WINDOW_CONFIG,
  DemStack, HOUR_MS, MissionInput, MissionResult, NOMINAL_ATTITUDE, PowerConfig, RelayConfig, STATE_RF_PHYSICAL, ScienceLayers, computeHorizon,
  emergencyCountdown, evaluateMission, findLandingWindows, makeObserver, missionVerdict, relocatedXY, siteScience, slopeDeg, tipoverMap,
} from '../engine';

export interface SitePoint { siteId: string; latDeg: number; lonDeg: number }

export interface Run {
  startMs: number; days: number; dxM?: number; dyM?: number; mastM?: number;
  power?: Partial<PowerConfig>; relay?: Partial<RelayConfig> | null; attitude?: Partial<AttitudeConfig>;
}

/** The input the app builds for this run (same defaults and site thermal sink as mission.tsx). */
export function inputFor(site: SitePoint, layers: ScienceLayers | null, run: Run): MissionInput {
  const rec = layers ? siteScience(layers, site.latDeg, site.lonDeg) : null;
  const thermal = rec ? { ...DEFAULT_THERMAL, envLitK: Math.min(400, Math.max(DEFAULT_THERMAL.envDarkK + 10, rec.diviner.tMaxK)) } : DEFAULT_THERMAL;
  return {
    latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: run.dxM ?? 0, dyM: run.dyM ?? 0, startMs: run.startMs, days: run.days, stepHours: 1,
    mastM: run.mastM ?? 2, power: { ...DEFAULT_POWER, ...run.power }, rf: DEFAULT_RF, relay: { ...DEFAULT_RELAY, ...(run.relay ?? {}) },
    attitude: { ...NOMINAL_ATTITUDE, ...run.attitude }, thermal, asset: DEFAULT_ASSET,
  };
}

export function fly(dem: DemStack, input: MissionInput): MissionResult {
  const [x, y] = relocatedXY(input.latDeg, input.lonDeg, input.dxM, input.dyM);
  return evaluateMission(dem, input, computeHorizon(dem, makeObserver(dem, x, y, input.mastM)));
}

const link = (r: MissionResult, i: number): boolean => (r.state[i] & STATE_RF_PHYSICAL) !== 0;

/** Mission 0: the Sun is up but low at touchdown, the array peaks later the same day, and the Earth link is open then and closes a few hours later. */
export function checkFirstLanding(r: MissionResult) {
  const look = Math.min(r.count - 1, 36);
  let best = 0;
  for (let i = 0; i <= look; i++) if (r.powerW[i] > r.powerW[best]) best = i;
  const p0 = r.powerW[0], pMax = r.powerW[best];
  const c = emergencyCountdown(r, best);
  const ok = r.sunFrac[0] > 0 && pMax > 0 && p0 < 0.7 * pMax && best >= 3 && link(r, best) && c.toLinkLossH !== null && c.toLinkLossH > 0 && c.toLinkLossH <= 24 && r.kpis.survives;
  return { ok, bestHour: best, p0W: p0, pMaxW: pMax, startPct: pMax > 0 ? (100 * p0) / pMax : 0, linkClosesH: c.toLinkLossH };
}

/** Mission 1: at the requested date there is neither sunlight nor an Earth link, and the 60-day search finds landing windows. */
export function checkBadDate(dem: DemStack, input: MissionInput, r: MissionResult, searchDays = 60) {
  const v = missionVerdict(r);
  const dark = r.sunFrac[0] === 0, silent = !link(r, 0);
  const search = findLandingWindows(dem, input, r.horizon, input.startMs, { ...DEFAULT_WINDOW_CONFIG, searchDays, missionDays: input.days });
  const accepted = search.candidates.filter((c) => c.ok).length;
  return { ok: dark && silent && v.level === 'nogo' && accepted > 0, dark, silent, level: v.level, accepted, total: search.candidates.length };
}

/** Mission 2: the aim point is on a slope steeper than the red class of the slope map, with level ground within 150 m. */
export function slopeAt(dem: DemStack, site: SitePoint, dxM: number, dyM: number) {
  const [x, y] = relocatedXY(site.latDeg, site.lonDeg, dxM, dyM);
  const tip = tipoverMap(dem, { latDeg: site.latDeg, lonDeg: site.lonDeg, dxM, dyM }, DEFAULT_TIPOVER, 200, 3).centre.p;
  return { slopeDeg: slopeDeg(dem, x, y), tipP: tip };
}

/** Mission 3: with the array on the deck (2 m) the lander freezes; on the 10 m mast it survives. */
export function checkMast(low: MissionResult, high: MissionResult) {
  const a = low.adv.kpis, b = high.adv.kpis;
  return {
    ok: !low.kpis.survives && a.thermalDeathH !== null && high.kpis.survives,
    deathH: a.thermalDeathH, energyLowWh: low.kpis.energyWh, energyHighWh: high.kpis.energyWh, minBusLowC: a.minBusC, minBusHighC: b.minBusC,
  };
}

/** Mission 4: the Earth is hidden for a long stretch and the relay restores the link. */
export function checkRelay(direct: MissionResult, relay: MissionResult) {
  const v0 = missionVerdict(direct), v1 = missionVerdict(relay);
  return { ok: v0.linkPct < 50 && v1.linkPct > v0.linkPct + 30 && relay.kpis.survives, directPct: v0.linkPct, relayPct: v1.linkPct, gapH: v0.longestLinkGapH };
}

/** Mission 5: the IM-1 tilt points the antenna away from the Earth; a wider gimbal range brings the link back. */
export function im1Attitude(): AttitudeConfig {
  const p = ATTITUDE_PRESETS.find((x) => x.id === 'im1');
  return { ...NOMINAL_ATTITUDE, rollDeg: p?.rollDeg ?? 30, pitchDeg: p?.pitchDeg ?? 0, yawDeg: p?.yawDeg ?? 0 };
}

export const hourMs = (startMs: number, h: number): number => startMs + h * HOUR_MS;
