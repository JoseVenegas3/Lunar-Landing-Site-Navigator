/**
 * Glue between the engine (map frame, km) and the three.js scene.
 *
 * Scene frame: X = map x - cx, Y = height - h0, Z = -(map y - cy), all in km at
 * true scale (no vertical exaggeration), centred on the nominal landing site.
 */
import { Vector3 } from 'three';
import { create } from 'zustand';
import {
  DEG, Grid, MissionResult, azElAtFraction, azimuthToMap, earthClearanceDeg, sampleGrid, siteFrame, solarDiscFraction,
  sunAngularRadiusDeg, SiteFrame,
} from '../../engine';

export interface SceneFrame { cx: number; cy: number; h0: number }

export function makeSceneFrame(grid: Grid): SceneFrame {
  const half = ((grid.n - 1) / 2) * grid.spacingKm;
  const cx = grid.x0 + half, cy = grid.y0 + half;
  return { cx, cy, h0: sampleGrid(grid, cx, cy) };
}

export function mapToScene(f: SceneFrame, x: number, y: number, h: number, out: Vector3): Vector3 {
  return out.set(x - f.cx, h - f.h0, -(y - f.cy));
}

/** Unit scene vector for a local azimuth/elevation at longitude `lonDeg`. */
export function dirToScene(lonDeg: number, azDeg: number, elDeg: number, out: Vector3): Vector3 {
  const [ux, uy] = azimuthToMap(lonDeg, azDeg);
  const c = Math.cos(elDeg * DEG);
  return out.set(ux * c, Math.sin(elDeg * DEG), -uy * c);
}

/** Per-frame sky state, mutated in place by the frame driver and read by scene objects. */
export interface LiveSky {
  valid: boolean;
  sunAz: number; sunEl: number; sunFrac: number; sunRadius: number;
  earthAz: number; earthEl: number; earthClear: number;
  sunDir: Vector3; earthDir: Vector3;
  lander: Vector3; eye: Vector3;
}

export const makeLiveSky = (): LiveSky => ({
  valid: false,
  sunAz: 0, sunEl: 0, sunFrac: 0, sunRadius: 0.266,
  earthAz: 0, earthEl: 0, earthClear: 0,
  sunDir: new Vector3(1, 0, 0), earthDir: new Vector3(0, 0, -1),
  lander: new Vector3(), eye: new Vector3(),
});

const frameCache = new WeakMap<MissionResult, SiteFrame>();

/** Site frame of a result's observer, cached per result. */
export function resultFrame(result: MissionResult): SiteFrame {
  let frame = frameCache.get(result);
  if (!frame) {
    const obs = result.observer;
    frame = siteFrame(obs.latDeg, obs.lonDeg, obs.heightKm);
    frameCache.set(result, frame);
  }
  return frame;
}

export function updateLiveSky(live: LiveSky, result: MissionResult, cursorHours: number, f: SceneFrame): void {
  const obs = result.observer;
  const frame = resultFrame(result);
  const idx = Math.max(0, Math.min(result.count - 1, cursorHours / result.stepHours));
  const sun = azElAtFraction(result.eph, idx, frame, 'sun');
  const earth = azElAtFraction(result.eph, idx, frame, 'earth');
  live.sunAz = sun.azDeg; live.sunEl = sun.elDeg;
  live.sunRadius = sunAngularRadiusDeg(sun.rangeKm);
  live.sunFrac = solarDiscFraction(result.horizon, sun.azDeg, sun.elDeg, live.sunRadius);
  live.earthAz = earth.azDeg; live.earthEl = earth.elDeg;
  live.earthClear = earthClearanceDeg(result.horizon, earth.azDeg, earth.elDeg, result.input.rf.elevationMarginDeg);
  dirToScene(obs.lonDeg, sun.azDeg, sun.elDeg, live.sunDir);
  dirToScene(obs.lonDeg, earth.azDeg, earth.elDeg, live.earthDir);
  mapToScene(f, obs.x, obs.y, obs.groundKm, live.lander);
  mapToScene(f, obs.x, obs.y, obs.heightKm, live.eye);
  live.valid = true;
}

/** Small UI store for things the DOM HUD shows about the canvas. */
interface SceneUi {
  fps: number;
  overlayProgress: number | null;
  dragging: boolean;
  /** Pixels of the canvas covered by floating trays (left, right, bottom); the camera centres on the rest. */
  inset: { l: number; r: number; b: number };
  set: (patch: Partial<Omit<SceneUi, 'set'>>) => void;
}
export const useSceneUi = create<SceneUi>((set) => ({
  fps: 0,
  overlayProgress: null,
  dragging: false,
  inset: { l: 0, r: 0, b: 0 },
  set: (patch) => set(patch),
}));

/**
 * DOM tags positioned over the canvas by scene objects. They live in the HUD
 * layer (pointer-events: none) so they never intercept the lander drag.
 */
export const hudTags: {
  los: HTMLDivElement | null;
  /** Reticle and "what a double-click does here" text that follow the pointer over the terrain. */
  cursor: HTMLDivElement | null;
  /** Short-lived message of the last double-click (outside the allowed area). */
  notice: HTMLDivElement | null;
  /** Name of the catalogue site under the pointer (3-D site markers). */
  site: HTMLDivElement | null;
} = { los: null, cursor: null, notice: null, site: null };

/**
 * Where the camera looks (v3.0 Beginner training): angle between the view
 * direction and the Sun / the Earth, distance to the target, and a pending
 * aim request ("do it for me"). Written by the camera rig every frame.
 */
export const camProbe: { sunOffDeg: number; earthOffDeg: number; dist: number; frames: number; aim: 'sun' | 'earth' | 'far' | 'zoom' | 'close' | null } = {
  sunOffDeg: 180, earthOffDeg: 180, dist: 0, frames: 0, aim: null,
};

/**
 * Animation state of the lander model (v3.0). `deploy` folds (0) or opens (1)
 * the solar array; `drop` lifts the whole lander above the ground (scene km)
 * for the descent of the training intro; `mastK` follows the mast height the
 * engine uses (0 = deck, 1 = 10 m mast) and is eased by the model itself.
 * Mission Leader keeps deploy = 1 and drop = 0.
 */
/** Effects asked for by the video pitch (v3.1) outside the training: sunlight beads and radio rings. */
export const fxCue = { sun: false, radio: false };

export const landerAnim = { deploy: 1, drop: 0, mastK: 0, size: 1, sizeTarget: 1, dustAt: 0, drawn: new Vector3(), hasDrawn: false };

/** Radii (km) of the far-field shells drawn around the lander. */
export const SKYLINE_RADIUS_KM = 40;
export const BODY_DISTANCE_KM = 55;
/** Elevation exaggeration of the az/el gauge ring around the lander. */
export const RING_ELEVATION_GAIN = 5;
