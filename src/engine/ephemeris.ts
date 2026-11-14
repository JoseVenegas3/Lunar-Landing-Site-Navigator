/**
 * Lunar-surface ephemeris of the Sun and the Earth.
 *
 * Positions come from `astronomy-engine` (VSOP87 Sun, a truncated ELP/MPP02-class
 * lunar series, IAU 2015 lunar orientation with periodic terms). Everything is
 * evaluated locally: no network, no CORS.
 *
 * Pipeline per instant t:
 *   1. Geocentric J2000 equatorial (EQJ) vectors of the Moon and the Sun.
 *   2. Moon body-fixed (selenographic) basis from the IAU pole (alpha0, delta0)
 *      and prime-meridian angle W.
 *   3. Sun and Earth vectors relative to the centre of the Moon, rotated into the
 *      body-fixed frame. These are site independent, so one series serves every
 *      landing site and every micro-relocation.
 *   4. Per site: subtract the observer position (parallax, ~0.26 deg for the
 *      Earth) and project on the local East/North/Up triad.
 *
 * Optical and physical libration are not modelled separately: they fall out of
 * steps 2-3, because the Earth vector is expressed in the rotating lunar frame.
 */
import * as Astronomy from 'astronomy-engine';
import { AU_KM, DEG, HOUR_MS, RAD, R_MOON_KM, R_SUN_KM, wrap180, wrap360 } from './constants';

export interface EphemerisSeries {
  startMs: number;
  stepHours: number;
  count: number;
  /** Sun centre relative to Moon centre, selenographic frame, km. Packed xyz. */
  sun: Float64Array;
  /** Earth centre relative to Moon centre, selenographic frame, km. Packed xyz. */
  earth: Float64Array;
  /** Selenographic latitude/longitude of the sub-Earth point (the libration), deg. */
  subEarthLat: Float32Array;
  subEarthLon: Float32Array;
  /** Selenographic latitude/longitude of the sub-solar point, deg. */
  subSolarLat: Float32Array;
  subSolarLon: Float32Array;
}

export interface SiteFrame {
  latDeg: number;
  lonDeg: number;
  heightKm: number;
  /** Observer position in the selenographic frame, km. */
  px: number; py: number; pz: number;
  /** Local unit vectors in the selenographic frame. */
  ex: number; ey: number; ez: number;
  nx: number; ny: number; nz: number;
  ux: number; uy: number; uz: number;
}

export interface AzEl {
  /** Azimuth, degrees clockwise from local north through east, [0, 360). */
  azDeg: number;
  /** Elevation above the local geometric horizontal, degrees. */
  elDeg: number;
  /** Observer-to-body-centre distance, km. */
  rangeKm: number;
}

export type Vec3 = [number, number, number];

/** Body-fixed vectors of the Sun and the Earth (km, Moon-centred) at one instant. */
export function bodyFixedVectors(dateMs: number): { sun: Vec3; earth: Vec3 } {
  const time = Astronomy.MakeTime(new Date(dateMs));
  const moon = Astronomy.GeoMoon(time); // EQJ, au, geocentric
  const sunGeo = Astronomy.GeoVector(Astronomy.Body.Sun, time, true);
  const axis = Astronomy.RotationAxis(Astronomy.Body.Moon, time);

  // Body-fixed basis expressed in EQJ.
  const zx = axis.north.x, zy = axis.north.y, zz = axis.north.z;
  const alpha0 = axis.ra * 15 * DEG;
  // Ascending node of the lunar equator on the ICRF equator.
  const qx = -Math.sin(alpha0), qy = Math.cos(alpha0), qz = 0;
  // m = z x q completes the right-handed triad in the equator plane.
  const mx = zy * qz - zz * qy, my = zz * qx - zx * qz, mz = zx * qy - zy * qx;
  const w = (axis.spin % 360) * DEG;
  const cw = Math.cos(w), sw = Math.sin(w);
  const xx = qx * cw + mx * sw, xy = qy * cw + my * sw, xz = qz * cw + mz * sw;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;

  const sx = (sunGeo.x - moon.x) * AU_KM, sy = (sunGeo.y - moon.y) * AU_KM, sz = (sunGeo.z - moon.z) * AU_KM;
  const gx = -moon.x * AU_KM, gy = -moon.y * AU_KM, gz = -moon.z * AU_KM;

  return {
    sun: [sx * xx + sy * xy + sz * xz, sx * yx + sy * yy + sz * yz, sx * zx + sy * zy + sz * zz],
    earth: [gx * xx + gy * xy + gz * xz, gx * yx + gy * yy + gz * yz, gx * zx + gy * zy + gz * zz],
  };
}

const cache = new Map<string, EphemerisSeries>();
const CACHE_LIMIT = 12;

/**
 * Site-independent ephemeris series. `hours` is the window length; the series
 * holds floor(hours / stepHours) + 1 samples so the last sample closes the window.
 */
export function computeEphemeris(startMs: number, hours: number, stepHours = 1): EphemerisSeries {
  const key = `${startMs}|${hours}|${stepHours}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const count = Math.max(2, Math.floor(hours / stepHours) + 1);
  const sun = new Float64Array(count * 3);
  const earth = new Float64Array(count * 3);
  const subEarthLat = new Float32Array(count);
  const subEarthLon = new Float32Array(count);
  const subSolarLat = new Float32Array(count);
  const subSolarLon = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const v = bodyFixedVectors(startMs + i * stepHours * HOUR_MS);
    sun.set(v.sun, i * 3);
    earth.set(v.earth, i * 3);
    const [ex, ey, ez] = v.earth;
    subEarthLat[i] = Math.asin(ez / Math.hypot(ex, ey, ez)) * RAD;
    subEarthLon[i] = wrap180(Math.atan2(ey, ex) * RAD);
    const [sx, sy, sz] = v.sun;
    subSolarLat[i] = Math.asin(sz / Math.hypot(sx, sy, sz)) * RAD;
    subSolarLon[i] = wrap180(Math.atan2(sy, sx) * RAD);
  }

  const series: EphemerisSeries = { startMs, stepHours, count, sun, earth, subEarthLat, subEarthLon, subSolarLat, subSolarLon };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, series);
  return series;
}

/** Local East/North/Up triad and position of an observer on the Moon. */
export function siteFrame(latDeg: number, lonDeg: number, heightKm = 0): SiteFrame {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const cl = Math.cos(lat), sl = Math.sin(lat), co = Math.cos(lon), so = Math.sin(lon);
  const ux = cl * co, uy = cl * so, uz = sl;
  const r = R_MOON_KM + heightKm;
  return {
    latDeg, lonDeg, heightKm,
    px: ux * r, py: uy * r, pz: uz * r,
    ex: -so, ey: co, ez: 0,
    nx: -sl * co, ny: -sl * so, nz: cl,
    ux, uy, uz,
  };
}

/** Topocentric azimuth/elevation of a Moon-centred body-fixed vector (km). */
export function topocentric(bx: number, by: number, bz: number, f: SiteFrame): AzEl {
  const dx = bx - f.px, dy = by - f.py, dz = bz - f.pz;
  const range = Math.hypot(dx, dy, dz);
  const e = dx * f.ex + dy * f.ey + dz * f.ez;
  const n = dx * f.nx + dy * f.ny + dz * f.nz;
  const u = dx * f.ux + dy * f.uy + dz * f.uz;
  return { azDeg: wrap360(Math.atan2(e, n) * RAD), elDeg: Math.asin(Math.max(-1, Math.min(1, u / range))) * RAD, rangeKm: range };
}

export type BodyName = 'sun' | 'earth';

/** Azimuth/elevation of a body at series sample `i`. */
export function azElAt(series: EphemerisSeries, i: number, frame: SiteFrame, body: BodyName): AzEl {
  const a = body === 'sun' ? series.sun : series.earth;
  const k = i * 3;
  return topocentric(a[k], a[k + 1], a[k + 2], frame);
}

/**
 * Azimuth/elevation at a fractional sample index (linear interpolation of the
 * body-fixed vectors). Used for smooth playback between hourly samples.
 */
export function azElAtFraction(series: EphemerisSeries, index: number, frame: SiteFrame, body: BodyName): AzEl {
  const a = body === 'sun' ? series.sun : series.earth;
  const i0 = Math.max(0, Math.min(series.count - 2, Math.floor(index)));
  const t = Math.max(0, Math.min(1, index - i0));
  const k = i0 * 3;
  return topocentric(
    a[k] + (a[k + 3] - a[k]) * t,
    a[k + 1] + (a[k + 4] - a[k + 1]) * t,
    a[k + 2] + (a[k + 5] - a[k + 2]) * t,
    frame,
  );
}

/** One-shot azimuth/elevation of the Sun and the Earth for a date and site. */
export function skyAt(dateMs: number, latDeg: number, lonDeg: number, heightKm = 0): { sun: AzEl; earth: AzEl } {
  const v = bodyFixedVectors(dateMs);
  const f = siteFrame(latDeg, lonDeg, heightKm);
  return { sun: topocentric(v.sun[0], v.sun[1], v.sun[2], f), earth: topocentric(v.earth[0], v.earth[1], v.earth[2], f) };
}

/** Apparent angular radius of the Sun (deg) seen from `rangeKm`. */
export const sunAngularRadiusDeg = (rangeKm: number): number => Math.asin(R_SUN_KM / rangeKm) * RAD;
