/** Physical constants shared by the engine. SI unless the name says otherwise. */
export const R_MOON_KM = 1737.4; // IAU mean lunar radius (LOLA reference sphere)
export const R_EARTH_KM = 6378.137;
export const R_SUN_KM = 695_700;
export const AU_KM = 149_597_870.7;
export const SOLAR_CONSTANT_W_M2 = 1361; // total solar irradiance at 1 au
export const C_LIGHT_M_S = 299_792_458;
export const BOLTZMANN_DBW = -228.5991672; // 10*log10(k), dBW/K/Hz
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Wrap an angle in degrees to [0, 360). */
export const wrap360 = (deg: number): number => ((deg % 360) + 360) % 360;
/** Wrap an angle in degrees to (-180, 180]. */
export const wrap180 = (deg: number): number => {
  const w = wrap360(deg);
  return w > 180 ? w - 360 : w;
};
