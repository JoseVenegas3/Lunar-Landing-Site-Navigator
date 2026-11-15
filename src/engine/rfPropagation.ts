/**
 * Physical RF propagation over the lunar surface and Earth ground segment
 * (requirement SyR-P3).
 *
 * Reference standard for lunar-surface propagation: Recommendation ITU-R
 * P.2170 (2025). This module does not implement it; it uses the knife-edge
 * approximation of ITU-R P.526 (one edge, or three with the Deygout
 * construction) and a two-ray reflection.
 *
 * Sources (v2.1, model-assumptions table): the single-edge loss
 * J(nu) = 6.9 + 20 log10(sqrt((nu - 0.1)^2 + 1) + nu - 0.1) is the
 * approximation given in ITU-R P.526; the three-edge construction is
 * J. Deygout, "Multiple knife-edge diffraction of microwaves", IEEE Trans.
 * Antennas Propag. 14(4), 480-489 (1966). Both are quoted from memory, not
 * re-checked against the texts. DEYGOUT_RIDGE_GUARD and the regolith
 * permittivity / loss tangent are team parameters, not validated.
 *
 * Replaces the boolean "Earth visible" by a continuous loss:
 *   - knife-edge diffraction over the dominant ridge (ITU-R P.526 approximation),
 *     which attenuates a grazing link before the Earth geometrically sets and
 *     lets a weak signal through shortly after;
 *   - two-ray multipath from the regolith in front of the lander;
 *   - rotation of the Earth: which ground station has the Moon above its mask.
 *
 * There is no atmosphere and no ionosphere on the Moon, so these are the
 * mechanisms that matter near the horizon.
 */
import * as Astronomy from 'astronomy-engine';
import { C_LIGHT_M_S, DEG, HOUR_MS } from './constants';
import { LinkBudget, RfConfig, fromDb, linkBudget, toDb } from './missionPhysics';

// ------------------------------------------------------------ diffraction

/** Fresnel-Kirchhoff parameter for a single edge with the far terminal at infinity. */
export function fresnelNu(obstacleAboveRayM: number, distanceM: number, wavelengthM: number): number {
  return obstacleAboveRayM * Math.sqrt(2 / (wavelengthM * distanceM));
}

/** Knife-edge diffraction loss, dB (ITU-R P.526, valid for nu > -0.78; zero below). */
export function knifeEdgeLossDb(nu: number): number {
  if (nu <= -0.78) return 0;
  const x = nu - 0.1;
  return 6.9 + 20 * Math.log10(Math.sqrt(x * x + 1) + x);
}

// -------------------------------------------------------------- multipath

/** Relative permittivity and loss tangent of dry lunar regolith at S/X band. */
export const REGOLITH_EPS_R = 3.7;
export const REGOLITH_TAN_DELTA = 0.01;

interface Complex { re: number; im: number }
const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const cMul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);
function cSqrt(a: Complex): Complex {
  const m = cAbs(a);
  const re = Math.sqrt((m + a.re) / 2);
  const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (m - a.re) / 2));
  return { re, im };
}

/**
 * Fresnel reflection coefficients of a smooth dielectric half-space at grazing
 * angle `grazingDeg`. Returns magnitudes for horizontal and vertical
 * polarisation and for the co-polar component of a circularly polarised wave,
 * (Gh + Gv) / 2.
 */
export function regolithReflection(grazingDeg: number, epsR = REGOLITH_EPS_R, tanDelta = REGOLITH_TAN_DELTA): { horizontal: number; vertical: number; circular: number } {
  const s = Math.sin(grazingDeg * DEG), c = Math.cos(grazingDeg * DEG);
  const eps: Complex = { re: epsR, im: -epsR * tanDelta };
  const root = cSqrt({ re: eps.re - c * c, im: eps.im });
  const sC: Complex = { re: s, im: 0 };
  const gh = cDiv(cSub(sC, root), cAdd(sC, root));
  const es = cMul(eps, sC);
  const gv = cDiv(cSub(es, root), cAdd(es, root));
  return { horizontal: cAbs(gh), vertical: cAbs(gv), circular: cAbs({ re: (gh.re + gv.re) / 2, im: (gh.im + gv.im) / 2 }) };
}

/**
 * Worst-case fade of the two-ray (direct + ground-reflected) field, dB.
 *
 * The reflected ray is weakened by the Fresnel coefficient of the regolith, by
 * surface roughness (Rayleigh factor) and by the antenna pattern, since it
 * arrives 2 x grazing below the boresight. Its phase depends on the antenna
 * height to a fraction of a wavelength, which is not known, so the envelope
 * 1 - |Gamma_eff| is used: the deepest fade the geometry allows.
 */
export function multipathFadeDb(grazingDeg: number, wavelengthM: number, beamwidthDeg: number, roughnessM = 0.05): number {
  if (grazingDeg <= 0) return 0;
  const gamma = regolithReflection(grazingDeg).circular;
  const g = (4 * Math.PI * roughnessM * Math.sin(grazingDeg * DEG)) / wavelengthM;
  const rough = Math.exp(-0.5 * g * g);
  const pattern = Math.pow(10, -Math.min(40, 12 * ((2 * grazingDeg) / beamwidthDeg) ** 2) / 20);
  const eff = Math.min(0.97, gamma * rough * pattern);
  return -20 * Math.log10(1 - eff);
}

export interface PropagationLoss {
  wavelengthM: number;
  /** Height of the ridge above the direct ray, m (negative when the ray clears it). */
  obstacleAboveRayM: number;
  /** Radius of the first Fresnel zone at the ridge, m. */
  fresnelRadiusM: number;
  nu: number;
  diffractionDb: number;
  multipathDb: number;
  totalDb: number;
}

/**
 * Excess loss of the lander-to-Earth path over free space.
 *
 * @param earthElevDeg    elevation of the Earth above the local horizontal
 * @param horizonElevDeg  elevation of the terrain horizon in the Earth's azimuth
 * @param obstacleDistM   range of the ridge that defines that horizon
 * @param freqGHz         carrier frequency
 * @param beamwidthDeg    antenna half-power beamwidth (for the multipath term)
 * @param groundSlopeDeg  slope of the ground towards the Earth (positive uphill)
 */
export function computeLunarRFPropagationLoss(
  earthElevDeg: number, horizonElevDeg: number, obstacleDistM: number, freqGHz: number, beamwidthDeg = 4.2, groundSlopeDeg = 0,
): PropagationLoss {
  const wavelengthM = C_LIGHT_M_S / (freqGHz * 1e9);
  const d = Math.max(1, obstacleDistM);
  const obstacleAboveRayM = d * (Math.tan(horizonElevDeg * DEG) - Math.tan(earthElevDeg * DEG));
  const nu = fresnelNu(obstacleAboveRayM, d, wavelengthM);
  const diffractionDb = knifeEdgeLossDb(nu);
  const multipathDb = multipathFadeDb(earthElevDeg - groundSlopeDeg, wavelengthM, beamwidthDeg);
  return {
    wavelengthM, obstacleAboveRayM, nu, diffractionDb, multipathDb,
    fresnelRadiusM: Math.sqrt(wavelengthM * d),
    totalDb: diffractionDb + multipathDb,
  };
}

// ------------------------------------------------- multiple edges (Deygout)

export interface DeygoutLoss {
  /** Loss of the principal edge, dB. */
  mainDb: number;
  /** Weighted loss of the secondary edge between the lander and the principal edge, dB. */
  txDb: number;
  /** Weighted loss of the secondary edge beyond the principal edge, dB. */
  rxDb: number;
  totalDb: number;
  mainDistM: number;
  txDistM: number | null;
  rxDistM: number | null;
  /** Edges that contribute more than 0.1 dB. */
  edges: number;
}

/** Samples closer than this share of the principal edge range belong to the same ridge. */
export const DEYGOUT_RIDGE_GUARD = 0.1;

/**
 * Three-edge Deygout construction for a path whose far terminal is at
 * infinity (the Earth), after the cascaded knife-edge method of ITU-R P.526:
 *   L = J(nu_p) + T (J(nu_t) + J(nu_r)),   T = 1 - exp(-J(nu_p) / 6),
 * with nu_p the principal edge of the whole path, nu_t the worst edge of the
 * sub-path lander -> principal edge and nu_r the worst edge of the sub-path
 * principal edge -> Earth. The empirical correction C = 10 + 0.04 D of P.526
 * is left out: it was fitted to terrestrial paths.
 *
 * @param distM     range of each terrain sample from the antenna, m (increasing)
 * @param tanElev   tangent of the elevation angle of each sample seen from the antenna
 * @param earthTan  tangent of the elevation of the Earth
 * @param main      principal edge when it is already known (e.g. from the horizon profile)
 */
export function deygoutLossDb(
  distM: ArrayLike<number>, tanElev: ArrayLike<number>, earthTan: number, wavelengthM: number, main?: { distM: number; tan: number },
): DeygoutLoss {
  const n = distM.length;
  let dm = main?.distM ?? 0, tm = main?.tan ?? 0;
  if (!main) {
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const nu = fresnelNu(distM[i] * (tanElev[i] - earthTan), distM[i], wavelengthM);
      if (nu > best) { best = nu; dm = distM[i]; tm = tanElev[i]; }
    }
  }
  const none: DeygoutLoss = { mainDb: 0, txDb: 0, rxDb: 0, totalDb: 0, mainDistM: dm, txDistM: null, rxDistM: null, edges: 0 };
  if (dm <= 0) return none;
  const mainDb = knifeEdgeLossDb(fresnelNu(dm * (tm - earthTan), dm, wavelengthM));
  if (mainDb <= 0) return none;

  let nuT = -Infinity, nuR = -Infinity, dT: number | null = null, dR: number | null = null;
  const lo = dm * (1 - DEYGOUT_RIDGE_GUARD), hi = dm * (1 + DEYGOUT_RIDGE_GUARD);
  for (let i = 0; i < n; i++) {
    const d = distM[i];
    if (d < lo) {
      // Height above the line antenna -> top of the principal edge, both terminals at finite range.
      const nu = d * (tanElev[i] - tm) * Math.sqrt((2 * dm) / (wavelengthM * d * (dm - d)));
      if (nu > nuT) { nuT = nu; dT = d; }
    } else if (d > hi) {
      // Height above the ray that leaves the top of the principal edge towards the Earth.
      const nu = fresnelNu(d * tanElev[i] - dm * tm - (d - dm) * earthTan, d - dm, wavelengthM);
      if (nu > nuR) { nuR = nu; dR = d; }
    }
  }
  const weight = 1 - Math.exp(-mainDb / 6);
  const txDb = weight * knifeEdgeLossDb(nuT), rxDb = weight * knifeEdgeLossDb(nuR);
  return {
    mainDb, txDb, rxDb, totalDb: mainDb + txDb + rxDb, mainDistM: dm,
    txDistM: txDb > 0.1 ? dT : null, rxDistM: rxDb > 0.1 ? dR : null,
    edges: 1 + (txDb > 0.1 ? 1 : 0) + (rxDb > 0.1 ? 1 : 0),
  };
}

// ---------------------------------------------------------- ground segment

export interface GroundSite { id: string; name: string; latDeg: number; lonDeg: number }

/** NASA Deep Space Network complexes. */
export const DSN_SITES: GroundSite[] = [
  { id: 'gds', name: 'Goldstone', latDeg: 35.4, lonDeg: -116.9 },
  { id: 'mad', name: 'Madrid', latDeg: 40.4, lonDeg: -4.2 },
  { id: 'cbr', name: 'Canberra', latDeg: -35.4, lonDeg: 149.0 },
];

/**
 * Ground sites behind each station preset of missionPhysics. The commercial
 * preset is assumed to be a three-site network at DSN-like longitudes; the
 * GISAT station is a single dish in Concepcion, so it sees the Moon only part
 * of each day.
 */
export const GROUND_NETWORKS: Record<string, GroundSite[]> = {
  dsn34: DSN_SITES,
  // ESA deep-space antennas. Coordinates rounded to 0.01 deg, from memory: check before citing.
  estrack35: [
    { id: 'ceb', name: 'Cebreros', latDeg: 40.45, lonDeg: -4.37 },
    { id: 'nno', name: 'New Norcia', latDeg: -31.05, lonDeg: 116.19 },
    { id: 'mlg', name: 'Malargüe', latDeg: -35.78, lonDeg: -69.4 },
  ],
  ssc13: [{ id: 'scl', name: 'Santiago', latDeg: -33.15, lonDeg: -70.67 }],
  com13: DSN_SITES.map((s) => ({ ...s, id: `c-${s.id}`, name: `${s.name} (13 m)` })),
  gisat37: [{ id: 'udec', name: 'Concepción', latDeg: -36.83, lonDeg: -73.03 }],
};

/** Lowest elevation at which a ground station tracks, deg. */
export const GROUND_MASK_DEG = 10;

export interface GroundContact {
  sites: GroundSite[];
  /** Index into `sites` of the station tracking at each sample, -1 when none has the Moon above its mask. */
  station: Int8Array;
  /** Elevation of the Moon at that station, deg. */
  elevationDeg: Float32Array;
}

const contactCache = new Map<string, GroundContact>();

/**
 * Which ground station tracks the Moon at each sample: the one where the Moon
 * is highest among those above the mask. The handover follows the rotation of
 * the Earth.
 */
export function computeGroundContact(startMs: number, count: number, stepHours: number, networkId: string): GroundContact {
  const key = `${startMs}|${count}|${stepHours}|${networkId}`;
  const hit = contactCache.get(key);
  if (hit) return hit;
  const sites = GROUND_NETWORKS[networkId] ?? DSN_SITES;
  const observers = sites.map((s) => new Astronomy.Observer(s.latDeg, s.lonDeg, 0));
  const station = new Int8Array(count).fill(-1);
  const elevationDeg = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const time = Astronomy.MakeTime(new Date(startMs + i * stepHours * HOUR_MS));
    let best = -1, bestEl = GROUND_MASK_DEG;
    for (let s = 0; s < observers.length; s++) {
      const eq = Astronomy.Equator(Astronomy.Body.Moon, time, observers[s], true, true);
      const alt = Astronomy.Horizon(time, observers[s], eq.ra, eq.dec).altitude;
      if (alt > bestEl) { bestEl = alt; best = s; }
    }
    station[i] = best;
    elevationDeg[i] = best >= 0 ? bestEl : 0;
  }
  const contact: GroundContact = { sites, station, elevationDeg };
  if (contactCache.size >= 16) contactCache.delete(contactCache.keys().next().value as string);
  contactCache.set(key, contact);
  return contact;
}

export interface PhysicalLink {
  /** Achievable information rate, bit/s (0 when no station tracks or the budget does not close). */
  dataRateBps: number;
  ebN0Db: number;
  /** Margin over the required Eb/N0 at the achieved rate, dB. */
  marginDb: number;
  cn0DbHz: number;
  excessLossDb: number;
  limitedBy: 'power' | 'bandwidth' | 'no-station' | 'no-signal';
}

/** Lowest rate worth calling a link: below this the downlink is treated as closed, bit/s. */
export const MIN_USEFUL_RATE_BPS = 1000;

/**
 * Link budget with the physical losses applied on top of the free-space budget
 * of `base` (computed for `base.rangeKm`), for the actual slant range.
 */
export function computeDSNLinkBudgetAndDataRate(
  base: LinkBudget, rf: RfConfig, rangeKm: number, excessLossDb: number, stationInView: boolean,
): PhysicalLink {
  const required = rf.requiredEbN0Db + rf.implementationLossDb + rf.linkMarginDb;
  const cn0DbHz = base.cn0DbHz - 20 * Math.log10(rangeKm / base.rangeKm) - excessLossDb;
  if (!stationInView) return { dataRateBps: 0, ebN0Db: -Infinity, marginDb: -Infinity, cn0DbHz, excessLossDb, limitedBy: 'no-station' };
  const powerLimited = fromDb(cn0DbHz - required);
  const rate = Math.min(powerLimited, base.bandwidthLimitedRateBps);
  if (rate < MIN_USEFUL_RATE_BPS) return { dataRateBps: 0, ebN0Db: cn0DbHz - toDb(MIN_USEFUL_RATE_BPS), marginDb: cn0DbHz - toDb(MIN_USEFUL_RATE_BPS) - rf.requiredEbN0Db - rf.implementationLossDb, cn0DbHz, excessLossDb, limitedBy: 'no-signal' };
  const ebN0Db = cn0DbHz - toDb(rate);
  return {
    dataRateBps: rate, ebN0Db, marginDb: ebN0Db - rf.requiredEbN0Db - rf.implementationLossDb, cn0DbHz, excessLossDb,
    limitedBy: powerLimited <= base.bandwidthLimitedRateBps ? 'power' : 'bandwidth',
  };
}

/** Convenience: free-space budget for a configuration (re-exported so callers need one import). */
export const baseLinkBudget = (rf: RfConfig, rangeKm: number): LinkBudget => linkBudget(rf, rangeKm);
