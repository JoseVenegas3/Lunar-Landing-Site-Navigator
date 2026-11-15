/**
 * Post-landing attitude (requirement SyR-P2).
 *
 * Every other lunar site tool assumes a lander standing level. This module
 * rotates the solar arrays and the high-gain antenna with the body, so a lander
 * that comes to rest tilted or tipped over (IM-1, IM-2, SLIM) is evaluated with
 * the geometry it really has.
 *
 * Frames. Local frame: East, North, Up (ENU). Body frame at zero attitude
 * coincides with it: x_b = East (right), y_b = North (forward), z_b = Up.
 *   yaw   psi   : heading, clockwise from north seen from above
 *   pitch theta : nose (y_b) up positive
 *   roll  phi   : right side (x_b) down positive
 * Body-to-ENU rotation: R = Rz(-psi) * Rx(theta) * Ry(phi).
 */
import { DEG, RAD } from './constants';
import { MountType } from './missionPhysics';

export interface AttitudeConfig {
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  /** Half-angle the antenna gimbal can steer away from its stowed boresight, deg. */
  gimbalRangeDeg: number;
}

export const NOMINAL_ATTITUDE: AttitudeConfig = { rollDeg: 0, pitchDeg: 0, yawDeg: 0, gimbalRangeDeg: 20 };

export interface AttitudePreset {
  id: string;
  name: { en: string; es: string };
  note: { en: string; es: string };
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
}

/**
 * Historical cases. The tilt values are the ones quoted in the team's
 * state-of-the-art document; they are representative, not reconstructed flight
 * attitudes.
 */
export const ATTITUDE_PRESETS: AttitudePreset[] = [
  {
    id: 'nominal', rollDeg: 0, pitchDeg: 0, yawDeg: 0,
    name: { en: 'Nominal touchdown (0° tilt)', es: 'Alunizaje nominal (0° de inclinación)' },
    note: { en: 'Level lander: the reference case.', es: 'Módulo nivelado: el caso de referencia.' },
  },
  {
    id: 'im1', rollDeg: 30, pitchDeg: 0, yawDeg: 0,
    name: { en: 'IM-1 Odysseus anomaly (30° roll)', es: 'Anomalía IM-1 Odysseus (30° de alabeo)' },
    note: { en: 'Came to rest tilted about 30° after touching down with lateral velocity.', es: 'Quedó inclinado unos 30° tras tocar el suelo con velocidad lateral.' },
  },
  {
    id: 'im2', rollDeg: 75, pitchDeg: 0, yawDeg: 0,
    name: { en: 'IM-2 Athena tip-over (75° roll)', es: 'Vuelco IM-2 Athena (75° de alabeo)' },
    note: { en: 'On its side inside a shadowed depression.', es: 'De costado dentro de una depresión en sombra.' },
  },
  {
    id: 'slim', rollDeg: 0, pitchDeg: -85, yawDeg: 270,
    name: { en: 'JAXA SLIM nose-down (85° pitch)', es: 'JAXA SLIM de nariz (85° de cabeceo)' },
    note: { en: 'Rested on its nose with the arrays facing west.', es: 'Apoyado sobre la nariz con los paneles hacia el oeste.' },
  },
];

export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type V3 = [number, number, number];

/** Body-to-ENU rotation matrix, row-major. */
export function attitudeMatrix(a: Pick<AttitudeConfig, 'rollDeg' | 'pitchDeg' | 'yawDeg'>): Mat3 {
  const cr = Math.cos(a.rollDeg * DEG), sr = Math.sin(a.rollDeg * DEG);
  const cp = Math.cos(a.pitchDeg * DEG), sp = Math.sin(a.pitchDeg * DEG);
  const cy = Math.cos(a.yawDeg * DEG), sy = Math.sin(a.yawDeg * DEG);
  // Ry(phi): right-hand rotation about y.  Rx(theta): about x.  Rz(-psi): compass heading.
  // M = Rx * Ry
  const m00 = cr, m01 = 0, m02 = sr;
  const m10 = sp * sr, m11 = cp, m12 = -sp * cr;
  const m20 = -cp * sr, m21 = sp, m22 = cp * cr;
  // R = Rz(-psi) * M, with Rz(-psi) = [[cy, sy, 0], [-sy, cy, 0], [0, 0, 1]]
  return [
    cy * m00 + sy * m10, cy * m01 + sy * m11, cy * m02 + sy * m12,
    -sy * m00 + cy * m10, -sy * m01 + cy * m11, -sy * m02 + cy * m12,
    m20, m21, m22,
  ];
}

/** ENU vector expressed in the body frame (R transposed times v). */
export function toBody(r: Mat3, v: V3): V3 {
  return [r[0] * v[0] + r[3] * v[1] + r[6] * v[2], r[1] * v[0] + r[4] * v[1] + r[7] * v[2], r[2] * v[0] + r[5] * v[1] + r[8] * v[2]];
}

/** Body vector expressed in ENU. */
export function toEnu(r: Mat3, v: V3): V3 {
  return [r[0] * v[0] + r[1] * v[1] + r[2] * v[2], r[3] * v[0] + r[4] * v[1] + r[5] * v[2], r[6] * v[0] + r[7] * v[1] + r[8] * v[2]];
}

/** Unit ENU vector for an azimuth (clockwise from north) and elevation. */
export function enuFromAzEl(azDeg: number, elDeg: number): V3 {
  const c = Math.cos(elDeg * DEG);
  return [Math.sin(azDeg * DEG) * c, Math.cos(azDeg * DEG) * c, Math.sin(elDeg * DEG)];
}

/** Angle between the body z axis and the local vertical, deg. */
export function tiltDeg(r: Mat3): number {
  return Math.acos(Math.max(-1, Math.min(1, r[8]))) * RAD;
}

/**
 * Sum over the arrays of A_i * max(0, s . (R n_i)), divided by the total area,
 * for the three mount types, with the Sun vector already in the body frame.
 *  - horizontal  : one array on the deck, normal +z_b.
 *  - cylindrical : cells around the body axis; a cylinder of lateral area A
 *                  projects (A / pi) * |s perpendicular to the axis|.
 *  - tracker1axis: an array on a mast that turns about the body axis to face
 *                  the Sun, so it collects the component of s perpendicular to
 *                  that axis. A tipped lander still turns its array, but about
 *                  a tilted axis.
 * At zero attitude these reduce to sin(el), cos(el)/pi and cos(el).
 */
export function arrayProjection(mount: MountType, sunBody: V3): number {
  const lateral = Math.hypot(sunBody[0], sunBody[1]);
  switch (mount) {
    case 'horizontal': return Math.max(0, sunBody[2]);
    case 'cylindrical': return lateral / Math.PI;
    case 'tracker1axis': return lateral;
  }
}

/** Depointing loss of a parabolic antenna inside and near its main lobe, dB: 12 (alpha / theta_3dB)^2. */
export function pointingLossDb(offAxisDeg: number, beamwidthDeg: number): number {
  const x = offAxisDeg / beamwidthDeg;
  return Math.min(POINTING_LOSS_FLOOR_DB, 12 * x * x);
}
/** Beyond the main lobe the quadratic law is meaningless; side and back lobes sit about this far down. */
export const POINTING_LOSS_FLOOR_DB = 40;
/** The antenna sits on the top deck: Earth more than this far below the deck plane is hidden by the body. */
const DECK_MASK_DEG = -5;

export interface AttitudeImpact {
  /** Projected-to-total array area ratio in the actual attitude. */
  projection: number;
  /** The same ratio for a level lander. */
  nominalProjection: number;
  /** Earth direction relative to the stowed boresight, deg. */
  boresightSeparationDeg: number;
  /** Residual off-axis angle after the gimbal has steered as far as it can, deg. */
  offAxisDeg: number;
  pointingLossDb: number;
  /** The lander's own body hides the Earth from the antenna. */
  selfOccluded: boolean;
  tiltDeg: number;
}

/**
 * Effect of the landing attitude on solar collection and antenna pointing at
 * one instant.
 *
 * `boresightBody` is the antenna's stowed pointing direction in the body frame:
 * the direction it was aligned to before landing (see `stowedBoresight`).
 */
export function evaluateLanderAttitudeImpact(
  attitude: AttitudeConfig, mount: MountType, boresightBody: V3, sunEnu: V3, earthEnu: V3, beamwidthDeg: number,
): AttitudeImpact {
  const r = attitudeMatrix(attitude);
  const sunBody = toBody(r, sunEnu);
  const earthBody = toBody(r, earthEnu);
  const dot = boresightBody[0] * earthBody[0] + boresightBody[1] * earthBody[1] + boresightBody[2] * earthBody[2];
  const separation = Math.acos(Math.max(-1, Math.min(1, dot))) * RAD;
  const offAxis = Math.max(0, separation - attitude.gimbalRangeDeg);
  const selfOccluded = earthBody[2] < Math.sin(DECK_MASK_DEG * DEG);
  return {
    projection: arrayProjection(mount, sunBody),
    nominalProjection: arrayProjection(mount, sunEnu),
    boresightSeparationDeg: separation,
    offAxisDeg: offAxis,
    pointingLossDb: selfOccluded ? POINTING_LOSS_FLOOR_DB : pointingLossDb(offAxis, beamwidthDeg),
    selfOccluded,
    tiltDeg: tiltDeg(r),
  };
}

/**
 * Stowed boresight in the body frame: the antenna is aligned before landing to
 * the mean direction of the Earth over the mission window, assuming a level
 * touchdown. Returns a unit vector.
 */
export function stowedBoresight(earthAzDeg: ArrayLike<number>, earthElDeg: ArrayLike<number>): V3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < earthAzDeg.length; i++) {
    const v = enuFromAzEl(earthAzDeg[i], earthElDeg[i]);
    x += v[0]; y += v[1]; z += v[2];
  }
  const n = Math.hypot(x, y, z) || 1;
  return [x / n, y / n, z / n];
}

/**
 * Roll and pitch of a lander resting flat on a slope, from the terrain gradient
 * (rise per metre towards east and towards north), at zero yaw.
 */
export function attitudeOnSlope(gradEast: number, gradNorth: number): { rollDeg: number; pitchDeg: number } {
  const inv = 1 / Math.hypot(gradEast, gradNorth, 1);
  const nE = -gradEast * inv, nN = -gradNorth * inv;
  // R z_b = (sin(phi), -sin(theta) cos(phi), cos(theta) cos(phi)) must equal the terrain normal.
  const roll = Math.asin(Math.max(-1, Math.min(1, nE)));
  const pitch = -Math.asin(Math.max(-1, Math.min(1, nN / Math.cos(roll))));
  return { rollDeg: roll * RAD, pitchDeg: pitch * RAD };
}
