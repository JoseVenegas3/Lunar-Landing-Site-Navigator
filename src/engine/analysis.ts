/**
 * Scenario evaluation: one landing position over one date range.
 * Combines ephemeris, horizon, power and link modules into hourly series,
 * operating windows and comparison KPIs.
 */
import { HOUR_MS } from './constants';
import { EphemerisSeries, computeEphemeris, siteFrame, sunAngularRadiusDeg, topocentric } from './ephemeris';
import { HorizonProfile, Observer, computeHorizon, earthClearanceDeg, makeObserver, solarDiscFraction } from './horizonEngine';
import { BatteryResult, LinkBudget, PowerConfig, RfConfig, bitsToGb, linkBudget, simulateBattery, solarPowerW } from './missionPhysics';
import { OrbitElements, RelayConfig, constellation, relayCoverageFraction } from './relay';
import { DemStack, latLonToXY, localAxes, slopeDeg } from './terrain';

export interface ScenarioInput {
  /** Nominal site, selenographic degrees. */
  latDeg: number;
  lonDeg: number;
  /** Micro-relocation from the nominal site: metres east and north. */
  dxM: number;
  dyM: number;
  /** Window start, ms since Unix epoch (UTC). */
  startMs: number;
  days: number;
  stepHours: number;
  /** Height of the solar array / antenna above the ground, m. */
  mastM: number;
  power: PowerConfig;
  rf: RfConfig;
  /** Optional relay constellation; omitted or disabled means direct-to-Earth only. */
  relay?: RelayConfig | null;
}

/** Half-open run of samples [start, end). */
export interface Run { start: number; end: number }

export const STATE_SUN = 1;
export const STATE_DTE = 2;
export const STATE_DEPLETED = 4;
export const STATE_BELOW_DOD = 8;
export const STATE_RELAY = 16;

export interface Kpis {
  /** Time-averaged visible fraction of the solar disc, %. */
  illuminationPct: number;
  /** Share of the window with any direct sunlight, %. */
  sunlitPct: number;
  longestLightH: number;
  longestDarkH: number;
  dtePct: number;
  longestDteGapH: number;
  /** Share of the window with sunlight and DTE at once, %. */
  simultaneousPct: number;
  longestSimultaneousH: number;
  /** Share of the window with at least one usable relay, %. 0 without a constellation. */
  relayPct: number;
  /** Share of the window with any path to Earth (DTE or relay), %. */
  anyLinkPct: number;
  /** Longest stretch with neither DTE nor relay, hours. */
  longestLinkOutageH: number;
  /** Data returned through the relay while DTE was closed, GB. */
  relayDataGb: number;
  energyWh: number;
  peakPowerW: number;
  dataGb: number;
  meanRateMbps: number;
  minSocPct: number;
  hoursBelowDod: number;
  hoursDepleted: number;
  survives: boolean;
  dodAlert: boolean;
  slopeDeg: number;
  groundElevationM: number;
  sunElMinDeg: number;
  sunElMaxDeg: number;
  /** Libration box of the Earth in the local sky. */
  earthElMinDeg: number;
  earthElMaxDeg: number;
  earthAzMinDeg: number;
  earthAzMaxDeg: number;
}

export interface ScenarioResult {
  input: ScenarioInput;
  observer: Observer;
  horizon: HorizonProfile;
  eph: EphemerisSeries;
  count: number;
  stepHours: number;
  sunAz: Float32Array;
  sunEl: Float32Array;
  sunFrac: Float32Array;
  sunRadiusDeg: number;
  earthAz: Float32Array;
  earthEl: Float32Array;
  /** Earth elevation minus horizon minus antenna margin, deg. */
  earthClear: Float32Array;
  earthRangeKm: Float32Array;
  powerW: Float32Array;
  rateMbps: Float32Array;
  /** Fraction of each sample interval covered by at least one relay, 0..1. */
  relayFrac: Float32Array;
  /** Satellites of the constellation evaluated (empty without one). */
  relaySats: OrbitElements[];
  /** Bit mask per sample: STATE_SUN | STATE_DTE | STATE_DEPLETED | STATE_BELOW_DOD. */
  state: Uint8Array;
  battery: BatteryResult;
  /** Link budget at the mean Earth range of the window. */
  link: LinkBudget;
  windows: { sun: Run[]; dark: Run[]; dte: Run[]; dteGap: Run[]; both: Run[]; linkOutage: Run[] };
  kpis: Kpis;
}

/** Map position of the lander after applying the east/north relocation. */
export function relocatedXY(latDeg: number, lonDeg: number, dxM: number, dyM: number): [number, number] {
  const [x, y] = latLonToXY(latDeg, lonDeg);
  const ax = localAxes(lonDeg);
  return [x + (ax.ex * dxM + ax.nx * dyM) / 1000, y + (ax.ey * dxM + ax.ny * dyM) / 1000];
}

export function runsOf(n: number, test: (i: number) => boolean): Run[] {
  const runs: Run[] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (test(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ start, end: i });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ start, end: n });
  return runs;
}

const longest = (runs: Run[]): number => runs.reduce((m, r) => Math.max(m, r.end - r.start), 0);

/** Azimuth span of a set of directions clustered around north (handles the 0/360 wrap). */
function azimuthSpan(az: Float32Array): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < az.length; i++) {
    const a = az[i] > 180 ? az[i] - 360 : az[i];
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  return [lo, hi];
}

/**
 * Evaluate a scenario. `horizon` can be supplied when the caller already holds
 * the profile for this exact lander position (for example while only the date
 * range or the hardware changes).
 */
export function evaluateScenario(dem: DemStack, input: ScenarioInput, horizon?: HorizonProfile): ScenarioResult {
  const [x, y] = relocatedXY(input.latDeg, input.lonDeg, input.dxM, input.dyM);
  const profile = horizon ?? computeHorizon(dem, makeObserver(dem, x, y, input.mastM));
  const observer = profile.observer;
  const eph = computeEphemeris(input.startMs, input.days * 24, input.stepHours);
  const frame = siteFrame(observer.latDeg, observer.lonDeg, observer.heightKm);
  const n = eph.count;
  const step = eph.stepHours;

  const sunAz = new Float32Array(n), sunEl = new Float32Array(n), sunFrac = new Float32Array(n);
  const earthAz = new Float32Array(n), earthEl = new Float32Array(n), earthClear = new Float32Array(n);
  const earthRangeKm = new Float32Array(n), powerW = new Float32Array(n), rateMbps = new Float32Array(n);
  const state = new Uint8Array(n);

  let sunRadiusSum = 0, rangeSum = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 3;
    const s = topocentric(eph.sun[k], eph.sun[k + 1], eph.sun[k + 2], frame);
    const e = topocentric(eph.earth[k], eph.earth[k + 1], eph.earth[k + 2], frame);
    const radius = sunAngularRadiusDeg(s.rangeKm);
    sunRadiusSum += radius;
    rangeSum += e.rangeKm;
    const frac = solarDiscFraction(profile, s.azDeg, s.elDeg, radius);
    const clear = earthClearanceDeg(profile, e.azDeg, e.elDeg, input.rf.elevationMarginDeg);
    sunAz[i] = s.azDeg; sunEl[i] = s.elDeg; sunFrac[i] = frac;
    earthAz[i] = e.azDeg; earthEl[i] = e.elDeg; earthClear[i] = clear; earthRangeKm[i] = e.rangeKm;
    powerW[i] = solarPowerW(input.power, s.elDeg, frac, s.rangeKm);
    if (frac > 0) state[i] |= STATE_SUN;
    if (clear > 0) state[i] |= STATE_DTE;
  }

  const battery = simulateBattery(input.power, powerW, step);
  // One full budget at the mean range; per-sample rates follow the inverse-square law.
  const link = linkBudget(input.rf, rangeSum / n);
  const dodFloorWh = input.power.batteryCapacityWh * (1 - input.power.maxDepthOfDischarge);
  let bits = 0, rateSum = 0, dteCount = 0, peakPowerW = 0, fracSum = 0;
  let sunElMin = Infinity, sunElMax = -Infinity, earthElMin = Infinity, earthElMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const soc = battery.socWh[i];
    if (soc <= 0 && powerW[i] <= input.power.survivalLoadW) state[i] |= STATE_DEPLETED;
    if (soc < dodFloorWh - 1e-6) state[i] |= STATE_BELOW_DOD;
    if (state[i] & STATE_DTE) {
      dteCount++;
      // The transmitter needs a powered bus: no downlink while the battery is flat.
      if (!(state[i] & STATE_DEPLETED)) {
        const q = link.rangeKm / earthRangeKm[i];
        const rate = Math.min(link.bandwidthLimitedRateBps, link.powerLimitedRateBps * q * q);
        rateMbps[i] = rate / 1e6;
        rateSum += rate;
        bits += rate * step * 3600;
      }
    }
    if (powerW[i] > peakPowerW) peakPowerW = powerW[i];
    fracSum += sunFrac[i];
    if (sunEl[i] < sunElMin) sunElMin = sunEl[i];
    if (sunEl[i] > sunElMax) sunElMax = sunEl[i];
    if (earthEl[i] < earthElMin) earthElMin = earthEl[i];
    if (earthEl[i] > earthElMax) earthElMax = earthEl[i];
  }

  // ---- relay constellation: fills the gaps of the direct link
  const relayFrac = new Float32Array(n);
  const relayCfg = input.relay && input.relay.enabled ? input.relay : null;
  const relaySats = relayCfg ? constellation(relayCfg) : [];
  let relaySum = 0, anySum = 0, relayBits = 0;
  for (let i = 0; i < n; i++) {
    const dteOpen = (state[i] & STATE_DTE) !== 0;
    let f = 0;
    if (relayCfg) {
      const k = i * 3;
      f = relayCoverageFraction(
        relaySats, eph.startMs + i * step * HOUR_MS, step, frame, profile, input.rf.elevationMarginDeg,
        eph.earth[k], eph.earth[k + 1], eph.earth[k + 2],
      );
      relayFrac[i] = f;
      if (f > 0) state[i] |= STATE_RELAY;
      relaySum += f;
      if (!dteOpen && !(state[i] & STATE_DEPLETED)) relayBits += f * relayCfg.rateMbps * 1e6 * step * 3600;
    }
    anySum += dteOpen ? 1 : f;
  }
  const linkOutage = runsOf(n, (i) => (state[i] & (STATE_DTE | STATE_RELAY)) === 0);

  const sun = runsOf(n, (i) => (state[i] & STATE_SUN) !== 0);
  const dark = runsOf(n, (i) => (state[i] & STATE_SUN) === 0);
  const dte = runsOf(n, (i) => (state[i] & STATE_DTE) !== 0);
  const dteGap = runsOf(n, (i) => (state[i] & STATE_DTE) === 0);
  const both = runsOf(n, (i) => (state[i] & (STATE_SUN | STATE_DTE)) === (STATE_SUN | STATE_DTE));
  const count = (runs: Run[]): number => runs.reduce((m, r) => m + r.end - r.start, 0);
  const [earthAzMin, earthAzMax] = azimuthSpan(earthAz);

  const kpis: Kpis = {
    illuminationPct: (100 * fracSum) / n,
    sunlitPct: (100 * count(sun)) / n,
    longestLightH: longest(sun) * step,
    longestDarkH: longest(dark) * step,
    dtePct: (100 * dteCount) / n,
    longestDteGapH: longest(dteGap) * step,
    simultaneousPct: (100 * count(both)) / n,
    longestSimultaneousH: longest(both) * step,
    relayPct: (100 * relaySum) / n,
    anyLinkPct: (100 * anySum) / n,
    longestLinkOutageH: longest(linkOutage) * step,
    relayDataGb: bitsToGb(relayBits),
    energyWh: battery.generatedWh,
    peakPowerW,
    dataGb: bitsToGb(bits),
    meanRateMbps: dteCount > 0 ? rateSum / dteCount / 1e6 : 0,
    minSocPct: 100 * battery.minSocFraction,
    hoursBelowDod: battery.hoursBelowDod,
    hoursDepleted: battery.hoursDepleted,
    survives: battery.survives,
    dodAlert: battery.dodAlert,
    slopeDeg: slopeDeg(dem, observer.x, observer.y),
    groundElevationM: observer.groundKm * 1000,
    sunElMinDeg: sunElMin,
    sunElMaxDeg: sunElMax,
    earthElMinDeg: earthElMin,
    earthElMaxDeg: earthElMax,
    earthAzMinDeg: earthAzMin,
    earthAzMaxDeg: earthAzMax,
  };

  return {
    input, observer, horizon: profile, eph, count: n, stepHours: step,
    sunAz, sunEl, sunFrac, sunRadiusDeg: sunRadiusSum / n,
    earthAz, earthEl, earthClear, earthRangeKm, powerW, rateMbps, relayFrac, relaySats, state, battery,
    link,
    windows: { sun, dark, dte, dteGap, both, linkOutage },
    kpis,
  };
}

/** UTC timestamp (ms) of sample `i` of a result. */
export const sampleTimeMs = (r: ScenarioResult, i: number): number => r.eph.startMs + i * r.stepHours * HOUR_MS;
