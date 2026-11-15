/**
 * Earth-vs-Moon reference values and the small formulas behind the
 * "Learn more" comparison (v3.1, SR-502 / SR-708). Pure functions, no React.
 * Lunar values are those the rest of the engine uses; Earth values are
 * standard references (IERS / IAU / ISO 80000).
 */
import { R_MOON_KM } from './constants';

/** Standard gravity, m/s² (ISO 80000-3). */
export const G_EARTH_M_S2 = 9.80665;
/** Mean Earth radius, km (IUGG). */
export const R_EARTH_MEAN_KM = 6371.0;
/** Obliquity of the Earth's equator to the ecliptic, degrees (J2000). */
export const EARTH_OBLIQUITY_DEG = 23.44;
/** Tilt of the Moon's spin axis to the ecliptic, degrees (Cassini state): why the polar Sun never climbs. */
export const MOON_SPIN_TILT_DEG = 1.54;
/** Mean synodic month (new Moon to new Moon), days: one lunar day-night cycle. */
export const SYNODIC_MONTH_D = 29.530589;
/** Optical libration amplitudes seen from the Earth, degrees. */
export const LIBRATION_LON_DEG = 7.9;
export const LIBRATION_LAT_DEG = 6.7;
/** Order of magnitude of the lunar surface-bounded exosphere pressure, torr (daytime ~1e-12 torr). */
export const MOON_SURFACE_PRESSURE_TORR = 1e-12;
/** Sea-level pressure on Earth, torr. */
export const EARTH_SURFACE_PRESSURE_TORR = 760;
/** Latitude of Concepción, Chile (GISAT UdeC), degrees: the Earth side of the comparison. */
export const CONCEPCION_LAT_DEG = -36.83;

/** Highest noon Sun at a latitude over a year, degrees above the horizon (no terrain, no refraction). */
export const maxSunElevationDeg = (latDeg: number, axisTiltDeg: number): number => Math.min(90, 90 - Math.abs(latDeg) + axisTiltDeg);

/** Distance to the geometric horizon of a smooth sphere for an eye at h metres, km. */
export const horizonDistanceKm = (radiusKm: number, eyeM: number): number => Math.sqrt(2 * radiusKm * (eyeM / 1000) + (eyeM / 1000) ** 2);

/** How far the ground drops below a level line after d km on a sphere, metres. */
export const curvatureDropM = (radiusKm: number, dKm: number): number => ((dKm * dKm) / (2 * radiusKm)) * 1000;

/** Ratio of how fast the horizon falls away with distance, Moon vs Earth (inverse ratio of the radii). */
export const curvatureRatio = (): number => R_EARTH_MEAN_KM / R_MOON_KM;

/** Power radiated by a black surface at T kelvin, W/m² (Stefan-Boltzmann). */
export const radiatedWm2 = (tK: number, sigma: number): number => sigma * tK ** 4;

/** Range of a ballistic particle in vacuum on flat ground: v² sin(2θ) / g, km. */
export const ballisticRangeKm = (speedMs: number, angleRad: number, g: number): number => ((speedMs * speedMs * Math.sin(2 * angleRad)) / g) / 1000;

/** Daylight half of the lunar day-night cycle at the equator, days. */
export const lunarDaylightDays = (): number => SYNODIC_MONTH_D / 2;

