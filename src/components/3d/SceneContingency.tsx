/**
 * 3-D elements of the contingency modules: the body normal and antenna beam of
 * a tilted lander (SyR-C2.2), and a neighbouring surface asset with its plume
 * keep-out circle (SyR-C5.3).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Line, LineBasicMaterial, LineDashedMaterial, Matrix4,
  Mesh, MeshBasicMaterial, Quaternion, Vector3,
} from 'three';
import {
  ASSET_SHAPES, AttitudeConfig, BAND_FREQUENCY_HZ, DEG, DemStack, MissionResult, RAD, STATE_RF_PHYSICAL, V3, attitudeMatrix,
  azimuthToMap, beamwidthDeg, demHeight, enuFromAzEl, localAxes, toEnu,
} from '../../engine';
import { useApp } from '../../state/store';
import { LiveSky, SceneFrame, mapToScene } from './sceneMath';

const UP = new Vector3(0, 1, 0);
const COLOR_RF = new Color('#06B6D4');
const COLOR_CRIT = new Color('#EF4444');

/** Scene vector of a local East/North/Up vector at longitude `lonDeg`. */
export function enuToScene(lonDeg: number, v: V3, out: Vector3): Vector3 {
  const ax = localAxes(lonDeg);
  return out.set(ax.ex * v[0] + ax.nx * v[1], v[2], -(ax.ey * v[0] + ax.ny * v[1]));
}

const mX = new Vector3(), mY = new Vector3(), mZ = new Vector3(), basis = new Matrix4();

/**
 * Orientation of the lander model for an attitude. The model is built with
 * +X to the right (body x), +Y up (body z) and -Z forward (body y).
 */
export function bodyQuaternion(attitude: AttitudeConfig, lonDeg: number, out: Quaternion): Quaternion {
  const r = attitudeMatrix(attitude);
  enuToScene(lonDeg, toEnu(r, [1, 0, 0]), mX);
  enuToScene(lonDeg, toEnu(r, [0, 0, 1]), mY);
  enuToScene(lonDeg, toEnu(r, [0, 1, 0]), mZ).negate();
  return out.setFromRotationMatrix(basis.makeBasis(mX, mY, mZ));
}

/**
 * Where the antenna actually points (ENU): at the Earth if the gimbal reaches
 * it, otherwise as far towards it as the gimbal allows from the stowed boresight.
 */
export function steeredBoresightEnu(attitude: AttitudeConfig, boresightBody: V3, earthEnu: V3): V3 {
  const b = toEnu(attitudeMatrix(attitude), boresightBody);
  const dot = Math.max(-1, Math.min(1, b[0] * earthEnu[0] + b[1] * earthEnu[1] + b[2] * earthEnu[2]));
  const sep = Math.acos(dot) * RAD;
  if (sep <= attitude.gimbalRangeDeg || sep < 1e-6) return earthEnu;
  // Spherical interpolation from the stowed boresight towards the Earth by the gimbal range.
  const f = attitude.gimbalRangeDeg / sep, omega = sep * DEG, so = Math.sin(omega);
  const p = Math.sin((1 - f) * omega) / so, q = Math.sin(f * omega) / so;
  return [p * b[0] + q * earthEnu[0], p * b[1] + q * earthEnu[1], p * b[2] + q * earthEnu[2]];
}

/** Body normal and antenna beam of the lander in its actual attitude. */
export function AttitudeGizmo({ result, live }: { result: MissionResult; live: LiveSky }) {
  const group = useRef<Group>(null);
  const cone = useRef<Mesh>(null);
  const coneScale = useRef<Group>(null);
  const { camera } = useThree();
  const normal = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0]), 3));
    const l = new Line(g, new LineBasicMaterial({ color: 0xe6edf7 }));
    l.frustumCulled = false;
    return l;
  }, []);
  useEffect(() => () => { normal.geometry.dispose(); (normal.material as LineBasicMaterial).dispose(); }, [normal]);
  const q = useMemo(() => new Quaternion(), []);
  const dir = useMemo(() => new Vector3(), []);
  const beam = beamwidthDeg(result.input.rf.txDishDiameterM, BAND_FREQUENCY_HZ[result.input.rf.band]);
  const tanHalf = Math.tan((beam / 2) * DEG);

  useFrame(() => {
    const g = group.current;
    if (!g || !live.valid) return;
    g.visible = useApp.getState().view !== 'eye';
    g.position.copy(live.eye);
    const size = Math.min(2.4, Math.max(0.03, camera.position.distanceTo(live.eye) * 0.26));
    const lon = result.observer.lonDeg;
    // body normal
    enuToScene(lon, toEnu(attitudeMatrix(result.adv.attitude), [0, 0, 1]), dir);
    normal.quaternion.copy(q.setFromUnitVectors(UP, dir));
    normal.scale.set(1, size * 0.55, 1);
    // antenna beam
    const steered = steeredBoresightEnu(result.adv.attitude, result.adv.boresightBody, enuFromAzEl(live.earthAz, live.earthEl));
    enuToScene(lon, steered, dir).normalize();
    if (coneScale.current && cone.current) {
      coneScale.current.quaternion.copy(q.setFromUnitVectors(UP, dir));
      coneScale.current.scale.set(size * tanHalf, size, size * tanHalf);
      const idx = Math.max(0, Math.min(result.count - 1, Math.round(useApp.getState().cursorHours / result.stepHours)));
      const up = (result.state[idx] & STATE_RF_PHYSICAL) !== 0;
      const mat = cone.current.material as MeshBasicMaterial;
      mat.color.copy(up ? COLOR_RF : COLOR_CRIT);
      mat.opacity = up ? 0.32 : 0.42;
    }
  });

  return (
    <group ref={group}>
      <primitive object={normal} />
      <group ref={coneScale}>
        <mesh ref={cone} position={[0, 0.5, 0]}>
          <cylinderGeometry args={[1, 0, 1, 28, 1, true]} />
          <meshBasicMaterial color="#06B6D4" transparent opacity={0.32} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      </group>
    </group>
  );
}

/** Neighbouring surface asset on the terrain, and the plume ejecta keep-out circle around the lander. */
export function AssetMarker({ result, frame, live, dem }: { result: MissionResult; frame: SceneFrame; live: LiveSky; dem: DemStack }) {
  const asset = result.input.asset;
  const marker = useRef<Group>(null);
  const { camera } = useThree();
  const co = result.adv.coexistence;
  const shape = asset ? ASSET_SHAPES[asset.kind] : ASSET_SHAPES.tower;
  const pos = useMemo(() => new Vector3(), []);

  const ring = useMemo(() => {
    const pts = new Float32Array(145 * 3);
    for (let k = 0; k <= 144; k++) {
      const a = (k / 144) * 2 * Math.PI;
      pts.set([Math.cos(a), 0, Math.sin(a)], k * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pts, 3));
    const l = new Line(g, new LineDashedMaterial({ color: 0xef4444, dashSize: 0.04, gapSize: 0.03 }));
    l.computeLineDistances();
    l.frustumCulled = false;
    return l;
  }, []);
  useEffect(() => () => { ring.geometry.dispose(); (ring.material as LineDashedMaterial).dispose(); }, [ring]);

  useFrame(() => {
    const show = Boolean(asset && asset.enabled && co && live.valid);
    if (marker.current) marker.current.visible = show;
    ring.visible = show && co !== null && co.psi.hazardRadiusM <= 9000;
    if (!show || !asset || !co) return;
    const obs = result.observer;
    const [ux, uy] = azimuthToMap(obs.lonDeg, asset.azimuthDeg);
    const ax = obs.x + (ux * asset.distanceM) / 1000, ay = obs.y + (uy * asset.distanceM) / 1000;
    mapToScene(frame, ax, ay, demHeight(dem, ax, ay), pos);
    if (marker.current) {
      marker.current.position.copy(pos);
      // True size up close; a readable minimum from far away.
      marker.current.scale.setScalar(Math.max(0.001, camera.position.distanceTo(pos) * 0.0045));
    }
    const rKm = co.psi.hazardRadiusM / 1000;
    ring.position.copy(live.lander).y += 0.004;
    ring.scale.set(rKm, 1, rKm);
  });

  return (
    <group>
      <group ref={marker} visible={false}>
        <mesh position={[0, shape.heightM / 2, 0]}>
          <boxGeometry args={[shape.widthM, shape.heightM, shape.widthM]} />
          <meshLambertMaterial color="#94A3B8" emissive="#1E293B" />
        </mesh>
      </group>
      <primitive object={ring} />
    </group>
  );
}
