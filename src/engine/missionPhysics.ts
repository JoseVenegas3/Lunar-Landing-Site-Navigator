/**
 * Mission physics: electrical power budget and direct-to-Earth RF link budget.
 *
 * This module has no dependency on the lunar terrain or the ephemeris. It takes
 * plain numbers (sun elevation, illuminated fraction, slant range) and returns
 * engineering quantities, so the GISAT ground-station software can import it
 * unchanged for CanSat / CubeSat link and power analysis.
 */
import { AU_KM, BOLTZMANN_DBW, C_LIGHT_M_S, DEG, SOLAR_CONSTANT_W_M2 } from './constants';

// ------------------------------------------------------------------ power

/**
 * tracker1axis : flat array on a vertical mast, rotating in azimuth to face the Sun.
 * cylindrical  : body-mounted cells wrapped around a vertical cylinder.
 * horizontal   : flat array fixed on the top deck, normal to the local vertical.
 */
export type MountType = 'tracker1axis' | 'cylindrical' | 'horizontal';

export interface PowerConfig {
  /** Total cell area, m2. For `cylindrical` this is the full lateral surface. */
  panelAreaM2: number;
  mount: MountType;
  /** Beginning-of-life conversion efficiency, 0..1. */
  efficiency: number;
  /** Lumped derating: dust, temperature, harness, MPPT, 0..1. */
  derating: number;
  /** Electrical load while operating (array output at or above this value), W. */
  baseLoadW: number;
  /** Hibernation load (survival heaters, clock, receiver) in darkness or deep penumbra, W. */
  survivalLoadW: number;
  batteryCapacityWh: number;
  /** Deepest discharge the cells tolerate without accelerated ageing, 0..1. */
  maxDepthOfDischarge: number;
  /** Battery round-trip charge efficiency, 0..1. */
  chargeEfficiency: number;
  /** State of charge at the start of the window, 0..1. */
  initialSoc: number;
}

export const DEFAULT_POWER: PowerConfig = {
  panelAreaM2: 2.4,
  mount: 'tracker1axis',
  efficiency: 0.295,
  derating: 0.85,
  baseLoadW: 180,
  survivalLoadW: 35,
  batteryCapacityWh: 4000,
  maxDepthOfDischarge: 0.8,
  chargeEfficiency: 0.95,
  initialSoc: 1,
};

/** Solar irradiance (W/m2) at heliocentric distance `sunRangeKm` (inverse-square law). */
export function solarIrradiance(sunRangeKm: number): number {
  const r = sunRangeKm / AU_KM;
  return SOLAR_CONSTANT_W_M2 / (r * r);
}

/**
 * Ratio of projected (Sun-facing) area to total cell area for a mount type.
 *  - tracker1axis: the array normal is horizontal and follows the solar azimuth,
 *    so only the elevation contributes: cos(el).
 *  - cylindrical: a cylinder of lateral area A = 2 pi r h projects 2 r h cos(el),
 *    i.e. A cos(el) / pi.
 *  - horizontal: sin(el), zero when the Sun is below the deck plane.
 */
export function mountProjectionFactor(mount: MountType, sunElDeg: number): number {
  const el = sunElDeg * DEG;
  switch (mount) {
    case 'tracker1axis': return Math.cos(el);
    case 'cylindrical': return Math.cos(el) / Math.PI;
    case 'horizontal': return Math.max(0, Math.sin(el));
  }
}

/** Instantaneous array output (W). `discFraction` is the visible share of the solar disc. */
export function solarPowerW(cfg: PowerConfig, sunElDeg: number, discFraction: number, sunRangeKm: number = AU_KM): number {
  if (discFraction <= 0) return 0;
  return solarIrradiance(sunRangeKm) * cfg.panelAreaM2 * cfg.efficiency * cfg.derating
    * mountProjectionFactor(cfg.mount, sunElDeg) * discFraction;
}

export interface BatteryResult {
  /** Stored energy at each sample, Wh. */
  socWh: Float32Array;
  /** Load actually demanded at each sample, W. */
  loadW: Float32Array;
  generatedWh: number;
  consumedWh: number;
  /** Demand that could not be served because the battery was empty, Wh. */
  unmetWh: number;
  minSocFraction: number;
  /** Hours spent below the depth-of-discharge limit. */
  hoursBelowDod: number;
  /** Hours with an empty battery and no sunlight: the lander freezes. */
  hoursDepleted: number;
  survives: boolean;
  dodAlert: boolean;
}

/**
 * Energy balance over a power series sampled every `stepHours`.
 * Policy: the lander runs its operating load only while the array covers it;
 * in darkness and in deep penumbra it hibernates on the survival load, so a
 * sliver of Sun is used to slow the discharge rather than to run payloads.
 * Surplus charges the battery (with charge losses); deficit discharges it. An
 * empty battery with no array power counts as a freeze event and the mission
 * is flagged as not surviving.
 */
export function simulateBattery(cfg: PowerConfig, powerW: ArrayLike<number>, stepHours: number): BatteryResult {
  const n = powerW.length;
  const socWh = new Float32Array(n);
  const loadW = new Float32Array(n);
  const cap = cfg.batteryCapacityWh;
  const floorWh = cap * (1 - cfg.maxDepthOfDischarge);
  let e = cap * Math.min(1, Math.max(0, cfg.initialSoc));
  let generatedWh = 0, consumedWh = 0, unmetWh = 0, minE = e, hoursBelowDod = 0, hoursDepleted = 0;

  for (let i = 0; i < n; i++) {
    const gen = powerW[i];
    const load = gen >= cfg.baseLoadW ? cfg.baseLoadW : cfg.survivalLoadW;
    loadW[i] = load;
    generatedWh += gen * stepHours;
    const net = (gen - load) * stepHours;
    if (net >= 0) {
      e = Math.min(cap, e + net * cfg.chargeEfficiency);
      consumedWh += load * stepHours;
    } else {
      const need = -net;
      if (need > e) {
        unmetWh += need - e;
        consumedWh += load * stepHours - (need - e);
        e = 0;
        hoursDepleted += stepHours;
      } else {
        e -= need;
        consumedWh += load * stepHours;
      }
    }
    if (e < floorWh - 1e-6) hoursBelowDod += stepHours;
    if (e < minE) minE = e;
    socWh[i] = e;
  }

  return {
    socWh, loadW, generatedWh, consumedWh, unmetWh,
    minSocFraction: cap > 0 ? minE / cap : 0,
    hoursBelowDod, hoursDepleted,
    survives: hoursDepleted === 0,
    dodAlert: hoursBelowDod > 0,
  };
}

// ------------------------------------------------------------------- link

export type RfBand = 'X' | 'S';

/** Deep-space / near-Earth downlink centre frequencies, Hz. */
export const BAND_FREQUENCY_HZ: Record<RfBand, number> = { X: 8.4e9, S: 2.2e9 };

export interface GroundStationPreset {
  id: string;
  name: string;
  dishDiameterM: number;
  apertureEfficiency: number;
  /** System noise temperature when pointing at the Moon, K. */
  systemNoiseK: Record<RfBand, number>;
}

/**
 * System noise includes the lunar disc filling part of the beam (the Moon is a
 * ~200-240 K source), which is why the large dishes are far from their cold-sky
 * figures.
 */
export const GROUND_STATIONS: GroundStationPreset[] = [
  { id: 'dsn34', name: 'DSN 34 m BWG', dishDiameterM: 34, apertureEfficiency: 0.7, systemNoiseK: { X: 140, S: 110 } },
  { id: 'estrack35', name: 'ESA ESTRACK 35 m', dishDiameterM: 35, apertureEfficiency: 0.7, systemNoiseK: { X: 140, S: 110 } },
  { id: 'com13', name: 'Commercial 13 m network', dishDiameterM: 13, apertureEfficiency: 0.62, systemNoiseK: { X: 150, S: 130 } },
  { id: 'ssc13', name: 'SSC Santiago 13 m', dishDiameterM: 13, apertureEfficiency: 0.62, systemNoiseK: { X: 150, S: 130 } },
  // Hypothetical: a 3.7 m dish with an X / S-band receive chain. Confirm what the real station operates before quoting rates.
  { id: 'gisat37', name: 'GISAT UdeC 3.7 m (hypothetical X/S)', dishDiameterM: 3.7, apertureEfficiency: 0.55, systemNoiseK: { X: 190, S: 170 } },
];

export interface RfConfig {
  band: RfBand;
  /** RF power at the amplifier output, W. */
  txPowerW: number;
  /** Lander high-gain antenna diameter, m. */
  txDishDiameterM: number;
  txApertureEfficiency: number;
  /** Feeder / switch loss between amplifier and antenna, dB. */
  txLineLossDb: number;
  groundStationId: string;
  /** Pointing + polarisation + atmospheric loss, dB. */
  miscLossDb: number;
  /** Eb/N0 the decoder needs for the target frame error rate, dB. */
  requiredEbN0Db: number;
  /** Demodulator implementation loss, dB. */
  implementationLossDb: number;
  /** Link margin held in reserve, dB. */
  linkMarginDb: number;
  /** Allocated channel bandwidth, Hz. */
  bandwidthHz: number;
  /** Information bits per second per hertz for the chosen modulation and code. */
  spectralEfficiency: number;
  /** Clearance the antenna boresight needs above the terrain, deg. */
  elevationMarginDeg: number;
}

export const DEFAULT_RF: RfConfig = {
  band: 'X',
  txPowerW: 20,
  txDishDiameterM: 0.6,
  txApertureEfficiency: 0.55,
  txLineLossDb: 1.0,
  groundStationId: 'dsn34',
  miscLossDb: 1.2,
  requiredEbN0Db: 2.6, // CCSDS concatenated RS(255,223) + conv (7,1/2), FER 1e-5
  implementationLossDb: 1.0,
  linkMarginDb: 3.0,
  bandwidthHz: 10e6,
  spectralEfficiency: 1.0, // QPSK, rate 1/2
  elevationMarginDeg: 2,
};

export const toDb = (x: number): number => 10 * Math.log10(x);
export const fromDb = (db: number): number => Math.pow(10, db / 10);

export const wavelengthM = (frequencyHz: number): number => C_LIGHT_M_S / frequencyHz;

/** Free-space path loss, dB: 20 log10(4 pi d / lambda). */
export function fsplDb(rangeKm: number, frequencyHz: number): number {
  return 20 * Math.log10((4 * Math.PI * rangeKm * 1000) / wavelengthM(frequencyHz));
}

/** Boresight gain of a circular parabolic reflector, dBi: eta (pi D / lambda)^2. */
export function dishGainDbi(diameterM: number, apertureEfficiency: number, frequencyHz: number): number {
  const x = (Math.PI * diameterM) / wavelengthM(frequencyHz);
  return toDb(apertureEfficiency * x * x);
}

/** Half-power beamwidth of a parabolic reflector, deg (70 lambda / D rule). */
export function beamwidthDeg(diameterM: number, frequencyHz: number): number {
  return (70 * wavelengthM(frequencyHz)) / diameterM;
}

export function groundStation(id: string): GroundStationPreset {
  return GROUND_STATIONS.find((g) => g.id === id) ?? GROUND_STATIONS[0];
}

export interface LinkBudget {
  frequencyHz: number;
  rangeKm: number;
  txGainDbi: number;
  eirpDbw: number;
  fsplDb: number;
  rxGainDbi: number;
  /** Receive figure of merit, dB/K. */
  gOverTDbK: number;
  /** Carrier-to-noise-density ratio, dB-Hz. */
  cn0DbHz: number;
  /** Highest information rate the power budget supports, bit/s. */
  powerLimitedRateBps: number;
  /** Highest information rate the allocated bandwidth supports, bit/s. */
  bandwidthLimitedRateBps: number;
  /** Achievable rate: the smaller of the two limits, bit/s. */
  dataRateBps: number;
  /** Eb/N0 at the achievable rate, dB. */
  ebN0Db: number;
  /** Margin left over the requirement after implementation loss, dB. */
  marginDb: number;
  limitedBy: 'power' | 'bandwidth';
  txBeamwidthDeg: number;
}

/** Direct-to-Earth downlink budget for a slant range (km). */
export function linkBudget(cfg: RfConfig, rangeKm: number): LinkBudget {
  const f = BAND_FREQUENCY_HZ[cfg.band];
  const gs = groundStation(cfg.groundStationId);
  const txGainDbi = dishGainDbi(cfg.txDishDiameterM, cfg.txApertureEfficiency, f);
  const eirpDbw = toDb(cfg.txPowerW) + txGainDbi - cfg.txLineLossDb;
  const loss = fsplDb(rangeKm, f);
  const rxGainDbi = dishGainDbi(gs.dishDiameterM, gs.apertureEfficiency, f);
  const gOverTDbK = rxGainDbi - toDb(gs.systemNoiseK[cfg.band]);
  const cn0DbHz = eirpDbw - loss - cfg.miscLossDb + gOverTDbK - BOLTZMANN_DBW;

  const required = cfg.requiredEbN0Db + cfg.implementationLossDb + cfg.linkMarginDb;
  const powerLimitedRateBps = fromDb(cn0DbHz - required);
  const bandwidthLimitedRateBps = cfg.bandwidthHz * cfg.spectralEfficiency;
  const dataRateBps = Math.min(powerLimitedRateBps, bandwidthLimitedRateBps);
  const ebN0Db = cn0DbHz - toDb(dataRateBps);

  return {
    frequencyHz: f, rangeKm, txGainDbi, eirpDbw, fsplDb: loss, rxGainDbi, gOverTDbK, cn0DbHz,
    powerLimitedRateBps, bandwidthLimitedRateBps, dataRateBps, ebN0Db,
    marginDb: ebN0Db - cfg.requiredEbN0Db - cfg.implementationLossDb,
    limitedBy: powerLimitedRateBps <= bandwidthLimitedRateBps ? 'power' : 'bandwidth',
    txBeamwidthDeg: beamwidthDeg(cfg.txDishDiameterM, f),
  };
}

export interface RequiredStation {
  /** Carrier-to-noise density the target rate needs, dB-Hz. */
  cn0DbHz: number;
  /** Receive figure of merit needed to close the link, dB/K. */
  gOverTDbK: number;
  /** Dish diameter that gives it at the stated noise temperature and efficiency, m. */
  dishDiameterM: number;
}

/**
 * Inverse link budget: the ground-station figure of merit needed to receive
 * `rateBps` from this lander at `rangeKm`, with `excessLossDb` of propagation
 * and pointing loss on top of free space.
 */
export function requiredGroundStation(
  cfg: RfConfig, rangeKm: number, rateBps: number, excessLossDb = 0, systemNoiseK = 150, apertureEfficiency = 0.6,
): RequiredStation {
  const f = BAND_FREQUENCY_HZ[cfg.band];
  const eirpDbw = toDb(cfg.txPowerW) + dishGainDbi(cfg.txDishDiameterM, cfg.txApertureEfficiency, f) - cfg.txLineLossDb;
  const cn0DbHz = toDb(rateBps) + cfg.requiredEbN0Db + cfg.implementationLossDb + cfg.linkMarginDb;
  const gOverTDbK = cn0DbHz - eirpDbw + fsplDb(rangeKm, f) + cfg.miscLossDb + excessLossDb + BOLTZMANN_DBW;
  const gainDbi = gOverTDbK + toDb(systemNoiseK);
  return { cn0DbHz, gOverTDbK, dishDiameterM: (wavelengthM(f) / Math.PI) * Math.sqrt(fromDb(gainDbi) / apertureEfficiency) };
}

/** Convert a bit count to gigabytes (10^9 bytes). */
export const bitsToGb = (bits: number): number => bits / 8e9;
