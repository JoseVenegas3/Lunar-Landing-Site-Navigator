/**
 * Multi-mission coexistence (requirement SyR-C5.3): what a lander does to an
 * asset already on the surface, and the other way round.
 *
 * Two effects are modelled:
 *  - mutual shadowing. With the Sun a degree or two above the horizon a 10 m
 *    tower casts a shadow hundreds of metres long;
 *  - plume-surface interaction (PSI). The descent engine erodes regolith and
 *    throws it outward in a thin, nearly horizontal sheet. With no atmosphere
 *    the grains fly ballistically and sand-blast whatever stands in the way.
 */
import { DEG, RAD } from './constants';

export type AssetKind = 'tower' | 'habitat' | 'rover';

export interface AssetConfig {
  enabled: boolean;
  kind: AssetKind;
  /** Range and bearing of the asset from the lander: metres, deg clockwise from north. */
  distanceM: number;
  azimuthDeg: number;
  /** Thrust of the landing engine near touchdown, kN. */
  thrustKN: number;
}

export const ASSET_SHAPES: Record<AssetKind, { heightM: number; widthM: number; name: { en: string; es: string } }> = {
  tower: { heightM: 10, widthM: 2, name: { en: 'Vertical solar tower (10 m)', es: 'Torre solar vertical (10 m)' } },
  habitat: { heightM: 6, widthM: 8, name: { en: 'Surface habitat', es: 'Hábitat de superficie' } },
  rover: { heightM: 2, widthM: 3, name: { en: 'Rover from an earlier mission', es: 'Rover de una misión previa' } },
};

export const DEFAULT_ASSET: AssetConfig = { enabled: false, kind: 'tower', distanceM: 150, azimuthDeg: 90, thrustKN: 3 };

/** Height and width assumed for the lander itself when it shades the asset, m. */
export const LANDER_HEIGHT_M = 3.5;
export const LANDER_WIDTH_M = 3;
/** Height on the asset at which shading by the lander is evaluated, m. */
export const ASSET_REFERENCE_HEIGHT_M = 1;

/**
 * Share (0..1) of the solar disc hidden by a rectangular obstacle whose centre
 * line lies at `bearingDeg` and which subtends +-halfWidthDeg in azimuth and
 * rises to `topElevDeg`.
 */
export function obstacleShadowFraction(
  sunAzDeg: number, sunElDeg: number, sunRadiusDeg: number, bearingDeg: number, halfWidthDeg: number, topElevDeg: number,
): number {
  let dAz = ((sunAzDeg - bearingDeg + 540) % 360) - 180;
  dAz = Math.abs(dAz) * Math.cos(sunElDeg * DEG);
  const fx = Math.max(0, Math.min(1, (halfWidthDeg + sunRadiusDeg - dAz) / (2 * sunRadiusDeg)));
  const fy = Math.max(0, Math.min(1, (topElevDeg - (sunElDeg - sunRadiusDeg)) / (2 * sunRadiusDeg)));
  return fx * fy;
}

/** Angular half-width and top elevation of an obstacle seen from an eye at `eyeHeightM`. */
export function obstacleAngles(widthM: number, topHeightM: number, eyeHeightM: number, distanceM: number): { halfWidthDeg: number; topElevDeg: number } {
  const d = Math.max(1, distanceM);
  return { halfWidthDeg: Math.atan(widthM / 2 / d) * RAD, topElevDeg: Math.atan((topHeightM - eyeHeightM) / d) * RAD };
}

// ------------------------------------------------------------------ PSI

/** Lunar surface gravity, m/s2. */
export const G_MOON = 1.62;
/**
 * Regolith eroded per unit of thrust impulse, kg per kN.s. From the Apollo
 * estimate of roughly 2.6 t removed by a ~13 kN lunar module hovering low for
 * about a minute (Metzger and co-workers): 2600 / (13 * 60).
 */
export const EROSION_KG_PER_KN_S = 2600 / (13 * 60);
/** Seconds the engine spends close enough to the surface to erode it. */
export const NEAR_SURFACE_BURN_S = 30;
/** Half-thickness of the ejecta sheet above the horizontal, rad (about 3 deg). */
export const EJECTA_SHEET_RAD = 3 * DEG;
/**
 * Reference areal mass fluence, kg/m2. Chosen so that an Apollo
 * lunar-module-class lander gives 2 km, the exclusion distance of NASA's 2011
 * recommendations for descents near heritage sites.
 *
 * That 2 km is a NORMATIVE figure, not a physical damage boundary: by the
 * account of one of its authors it was picked to put the lander just beyond
 * the horizon, and ejecta are reported to travel more than 20 km even for
 * small landers. The radius below is therefore "the NASA heritage-site
 * exclusion distance, scaled with thrust", useful for comparing engines and
 * separations. Hardware outside it is not thereby safe.
 */
export const DAMAGE_FLUENCE_KG_M2 = (EROSION_KG_PER_KN_S * 13 * NEAR_SURFACE_BURN_S) / (2 * Math.PI * 2000 * 2000 * EJECTA_SHEET_RAD);

export interface PsiAssessment {
  erodedMassKg: number;
  /** Ejecta fluence arriving at the asset, kg/m2. */
  fluenceAtAssetKgM2: number;
  /** Radius inside which the fluence exceeds the damage threshold, m. */
  hazardRadiusM: number;
  /** Fluence at the asset divided by the damage threshold. */
  fluenceRatio: number;
  violated: boolean;
}

/**
 * Plume-surface interaction hazard. The eroded mass scales with thrust; it
 * leaves in a sheet of angular thickness EJECTA_SHEET_RAD, so the fluence on a
 * vertical surface at range d is M / (2 pi d^2 theta).
 *
 * This is a scaling law anchored on Apollo-era estimates, good for comparing
 * separations and engine sizes. It is not a substitute for a plume simulation.
 */
export function plumeEjectaHazard(thrustKN: number, distanceM: number): PsiAssessment {
  const erodedMassKg = EROSION_KG_PER_KN_S * thrustKN * NEAR_SURFACE_BURN_S;
  const d = Math.max(1, distanceM);
  const fluence = erodedMassKg / (2 * Math.PI * d * d * EJECTA_SHEET_RAD);
  return {
    erodedMassKg,
    fluenceAtAssetKgM2: fluence,
    hazardRadiusM: Math.sqrt(erodedMassKg / (2 * Math.PI * EJECTA_SHEET_RAD * DAMAGE_FLUENCE_KG_M2)),
    fluenceRatio: fluence / DAMAGE_FLUENCE_KG_M2,
    violated: fluence > DAMAGE_FLUENCE_KG_M2,
  };
}

export interface CoexistenceAssessment {
  psi: PsiAssessment;
  /** Share of the window in which the asset hides part of the Sun from the lander, percent. */
  landerShadedPct: number;
  /** Mean share of the solar disc the asset hides while it does, percent. */
  landerMeanBlockPct: number;
  /** Share of the window in which the lander hides part of the Sun from the asset, percent. */
  assetShadedPct: number;
  /** Per-sample fraction of the disc hidden from the lander by the asset, 0..1. */
  landerBlock: Float32Array;
}

/**
 * Mutual shadowing over a Sun track, plus the PSI hazard.
 *
 * @param sunLitFraction  share of the disc above the terrain at each sample (shadows only matter when the Sun is up)
 * @param assetGroundDeltaM  height of the ground under the asset minus the ground under the lander
 * @param eyeHeightM  height of the lander's arrays above its ground
 */
export function evaluateMultiAssetInterference(
  asset: AssetConfig, sunAzDeg: ArrayLike<number>, sunElDeg: ArrayLike<number>, sunLitFraction: ArrayLike<number>,
  sunRadiusDeg: number, assetGroundDeltaM = 0, eyeHeightM = 2,
): CoexistenceAssessment {
  const shape = ASSET_SHAPES[asset.kind];
  const n = sunAzDeg.length;
  const landerBlock = new Float32Array(n);
  // Asset seen from the lander's arrays.
  const fromLander = obstacleAngles(shape.widthM, assetGroundDeltaM + shape.heightM, eyeHeightM, asset.distanceM);
  // Lander seen from the foot of the asset (1 m up): with a grazing Sun the shadow of a 3.5 m
  // lander only reaches the lowest part of a tall asset, which is where shading starts.
  const fromAsset = obstacleAngles(LANDER_WIDTH_M, -assetGroundDeltaM + LANDER_HEIGHT_M, ASSET_REFERENCE_HEIGHT_M, asset.distanceM);
  const back = (asset.azimuthDeg + 180) % 360;
  let landerHits = 0, assetHits = 0, blockSum = 0;
  for (let i = 0; i < n; i++) {
    if (sunLitFraction[i] <= 0) continue;
    const a = obstacleShadowFraction(sunAzDeg[i], sunElDeg[i], sunRadiusDeg, asset.azimuthDeg, fromLander.halfWidthDeg, fromLander.topElevDeg);
    if (a > 0) { landerBlock[i] = a; landerHits++; blockSum += a; }
    if (obstacleShadowFraction(sunAzDeg[i], sunElDeg[i], sunRadiusDeg, back, fromAsset.halfWidthDeg, fromAsset.topElevDeg) > 0) assetHits++;
  }
  return {
    psi: plumeEjectaHazard(asset.thrustKN, asset.distanceM),
    landerShadedPct: n > 0 ? (100 * landerHits) / n : 0,
    landerMeanBlockPct: landerHits > 0 ? (100 * blockSum) / landerHits : 0,
    assetShadedPct: n > 0 ? (100 * assetHits) / n : 0,
    landerBlock,
  };
}
