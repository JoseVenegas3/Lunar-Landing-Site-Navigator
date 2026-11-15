/**
 * Scene objects around the lander: the lander itself (draggable), the Sun and
 * Earth on the sky shell, the DTE beam, the far-field skyline and the az/el
 * gauge ring.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group, Line,
  LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Sprite, SpriteMaterial,
  Vector2, Vector3,
} from 'three';
import {
  DEG, DemStack, HOUR_MS, MAX_RELAYS, MissionResult, RELOCATION_LIMIT_M, azimuthToMap, demHeight, enuFromAzEl, gridContains, localAxes,
  rayHitDistance, relayView,
} from '../../engine';
import { bodyQuaternion, enuToScene, steeredBoresightEnu } from './SceneContingency';
import { sceneFocus, useApp } from '../../state/store';
import {
  BODY_DISTANCE_KM, LiveSky, RING_ELEVATION_GAIN, SKYLINE_RADIUS_KM, SceneFrame, dirToScene, hudTags, landerAnim, mapToScene, resultFrame,
  useSceneUi,
} from './sceneMath';

const UP = new Vector3(0, 1, 0);
const LANDER_QINV = new Quaternion(), LANDER_TMP = new Vector3();
const COLOR_RF = new Color('#06B6D4');
const COLOR_SUN = new Color('#F59E0B');
const COLOR_CRIT = new Color('#EF4444');
const COLOR_RELAY = new Color('#B49CFF');
const COLOR_RELAY_IDLE = new Color('#4B5D78');

interface CommonProps {
  result: MissionResult;
  frame: SceneFrame;
  live: LiveSky;
}

// ------------------------------------------------------------------ lander

/**
 * Lander model in metres, scaled so it stays readable from orbit distance.
 * Dragging it runs the micro-relocation: the pointer ray is intersected with
 * the DEM and the offset is clamped to the +-500 m pad.
 */
const REDUCED_MOTION = (): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export function Lander({ result, frame, live, dem }: CommonProps & { dem: DemStack }) {
  const group = useRef<Group>(null);
  const tracker = useRef<Group>(null);
  const dish = useRef<Group>(null);
  const pole = useRef<Mesh>(null);
  const panel = useRef<Mesh>(null);
  const { camera, gl, controls } = useThree();
  const mount = result.input.power.mount;
  const active = useApp((s) => s.active);
  const dragging = useRef(false);
  // v3.1 reactive motion: a relocation is a short propelled hop, attitude and pointing changes are eased.
  const anim = useRef({ init: false, hopFrom: new Vector3(), hopTo: new Vector3(), hopAt: -1, hopDur: 900, q: new Quaternion(), dishQ: new Quaternion(), trackY: 0 });

  useFrame(() => {
    const g = group.current;
    if (!g || !live.valid) return;
    const a = anim.current;
    const now = performance.now();
    g.visible = useApp.getState().view !== 'eye';
    if (!a.init) { a.hopTo.copy(live.lander); a.hopFrom.copy(live.lander); }
    const held = dragging.current || useSceneUi.getState().dragging;
    // A new landing point that is not being dragged: hop there along a short arc.
    if (!held && a.hopTo.distanceTo(live.lander) > 0.004) {
      a.hopFrom.copy(g.position).setY(g.position.y - landerAnim.drop);
      a.hopTo.copy(live.lander);
      a.hopAt = now;
      a.hopDur = REDUCED_MOTION() ? 1 : 900;
    } else if (held) { a.hopTo.copy(live.lander); a.hopAt = -1; }
    const e = a.hopAt < 0 ? 1 : Math.min(1, (now - a.hopAt) / a.hopDur);
    if (e < 1) {
      const k = e * e * (3 - 2 * e);
      g.position.lerpVectors(a.hopFrom, a.hopTo, k);
      g.position.y += Math.sin(Math.PI * e) * Math.min(0.06, 0.25 * a.hopFrom.distanceTo(a.hopTo) + 0.01);
    } else {
      if (a.hopAt >= 0) { a.hopAt = -1; landerAnim.dustAt = now; }
      g.position.copy(live.lander);
    }
    g.position.y += landerAnim.drop;
    landerAnim.drawn.copy(g.position);
    landerAnim.hasDrawn = true;
    const dist = camera.position.distanceTo(live.lander);
    // The training shows the lander bigger while it lands and unfolds (landerAnim.size), then eases back.
    landerAnim.size += (landerAnim.sizeTarget - landerAnim.size) * 0.03;
    g.scale.setScalar(Math.max(0.001, dist * 0.0075 * landerAnim.size));
    // The model tilts with the landing attitude; array and antenna are then steered in the body frame.
    bodyQuaternion(result.adv.attitude, result.observer.lonDeg, a.q);
    if (!a.init || REDUCED_MOTION()) g.quaternion.copy(a.q); else g.quaternion.slerp(a.q, 0.07);
    LANDER_QINV.copy(g.quaternion).invert();
    LANDER_TMP.copy(live.sunDir).applyQuaternion(LANDER_QINV);
    if (tracker.current) {
      // the array turns towards the Sun smoothly (shortest way round)
      const target = Math.atan2(LANDER_TMP.x, LANDER_TMP.z);
      const d = Math.atan2(Math.sin(target - a.trackY), Math.cos(target - a.trackY));
      a.trackY = !a.init ? target : a.trackY + d * 0.08;
      tracker.current.rotation.y = a.trackY;
    }
    // Mast and array follow the configuration: a 10 m mast raises the array, folded arrays open (v3.0).
    const mastTarget = result.input.mastM > 2 ? 1 : 0;
    landerAnim.mastK += (mastTarget - landerAnim.mastK) * 0.04;
    if (Math.abs(mastTarget - landerAnim.mastK) < 0.002) landerAnim.mastK = mastTarget;
    if (pole.current) { pole.current.scale.y = 1 + landerAnim.mastK * 4; pole.current.position.y = 0.7 * (1 + landerAnim.mastK * 4); }
    if (panel.current) {
      const d = landerAnim.deploy;
      panel.current.position.y = 1.9 + landerAnim.mastK * 5.6 - (1 - d) * 0.9;
      panel.current.scale.set(0.12 + 0.88 * d, 0.25 + 0.75 * d, 1);
    }
    if (dish.current) {
      const steered = steeredBoresightEnu(result.adv.attitude, result.adv.boresightBody, enuFromAzEl(live.earthAz, live.earthEl));
      enuToScene(result.observer.lonDeg, steered, LANDER_TMP).normalize().applyQuaternion(LANDER_QINV);
      a.dishQ.setFromUnitVectors(UP, LANDER_TMP);
      if (!a.init || REDUCED_MOTION()) dish.current.quaternion.copy(a.dishQ); else dish.current.quaternion.slerp(a.dishQ, 0.08);
    }
    a.init = true;
  });

  useEffect(() => {
    const el = gl.domElement;
    const ray = new Raycaster();
    const ndc = new Vector2();
    const p = new Vector3();
    const local = dem.local;

    const onMove = (ev: PointerEvent): void => {
      if (!dragging.current || !local) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const o = ray.ray.origin, d = ray.ray.direction;
      // March the pointer ray over the height field, then bisect the crossing.
      let t0 = 0, hit = -1;
      for (let t = 0.01; t < 80; t += Math.max(0.012, t * 0.01)) {
        p.copy(d).multiplyScalar(t).add(o);
        const mx = frame.cx + p.x, my = frame.cy - p.z;
        if (gridContains(local, mx, my) && p.y + frame.h0 < demHeight(dem, mx, my)) { hit = t; break; }
        t0 = t;
      }
      if (hit < 0) return;
      let a = t0, b = hit;
      for (let k = 0; k < 12; k++) {
        const m = (a + b) / 2;
        p.copy(d).multiplyScalar(m).add(o);
        if (p.y + frame.h0 < demHeight(dem, frame.cx + p.x, frame.cy - p.z)) b = m; else a = m;
      }
      p.copy(d).multiplyScalar(b).add(o);
      const ax = localAxes(result.input.lonDeg);
      const ex = p.x, ny = -p.z; // offset from the nominal site in map km
      const east = (ex * ax.ex + ny * ax.ey) * 1000;
      const north = (ex * ax.nx + ny * ax.ny) * 1000;
      useApp.getState().setRelocation(active, east, north);
    };
    const onUp = (): void => {
      if (!dragging.current) return;
      dragging.current = false;
      if (controls) (controls as unknown as { enabled: boolean }).enabled = true;
      useSceneUi.getState().set({ dragging: false });
      el.style.cursor = '';
    };
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, controls, dem, frame, result.input.lonDeg, active]);

  const onDown = (e: ThreeEvent<PointerEvent>): void => {
    e.stopPropagation();
    dragging.current = true;
    if (controls) (controls as unknown as { enabled: boolean }).enabled = false;
    useSceneUi.getState().set({ dragging: true });
    gl.domElement.style.cursor = 'grabbing';
  };
  const onOver = (): void => { if (!dragging.current) gl.domElement.style.cursor = 'grab'; };
  const onOut = (): void => { if (!dragging.current) gl.domElement.style.cursor = ''; };

  return (
    <group ref={group}>
      {/* generous invisible grab volume */}
      <mesh position={[0, 2.2, 0]} onPointerDown={onDown} onPointerOver={onOver} onPointerOut={onOut}>
        <sphereGeometry args={[3.4, 12, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* body */}
      <mesh position={[0, 1.25, 0]}>
        <cylinderGeometry args={[1.05, 1.3, 0.9, 8]} />
        <meshLambertMaterial color={mount === 'cylindrical' ? '#27406e' : '#c9b37a'} flatShading />
      </mesh>
      {mount === 'horizontal' && (
        <mesh position={[0, 1.74, 0]}>
          <boxGeometry args={[2.3, 0.05, 2.3]} />
          <meshLambertMaterial color="#27406e" />
        </mesh>
      )}
      {/* legs */}
      {[0, 1, 2, 3].map((k) => {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        return (
          <group key={k} rotation={[0, a, 0]}>
            <mesh position={[1.45, 0.62, 0]} rotation={[0, 0, 0.62]}>
              <cylinderGeometry args={[0.05, 0.05, 1.5, 6]} />
              <meshLambertMaterial color="#9aa5b5" />
            </mesh>
            <mesh position={[1.9, 0.04, 0]}>
              <cylinderGeometry args={[0.28, 0.28, 0.08, 10]} />
              <meshLambertMaterial color="#9aa5b5" />
            </mesh>
          </group>
        );
      })}
      {/* solar tracker: vertical array on a mast, facing the solar azimuth */}
      {mount === 'tracker1axis' && (
        <group ref={tracker} position={[0, 1.7, 0]}>
          <mesh ref={pole} position={[0, 0.7, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 1.4, 6]} />
            <meshLambertMaterial color="#9aa5b5" />
          </mesh>
          <mesh ref={panel} position={[0, 1.9, 0]}>
            <boxGeometry args={[2.6, 1.3, 0.05]} />
            <meshLambertMaterial color="#1f3a6b" emissive="#0a1630" />
          </mesh>
        </group>
      )}
      {/* high-gain antenna, boresight along +Y of this group */}
      <group position={[0.75, 1.9, 0.75]}>
        <group ref={dish}>
          <mesh position={[0, 0.22, 0]}>
            <coneGeometry args={[0.42, 0.3, 20, 1, true]} />
            <meshLambertMaterial color="#e6edf7" side={DoubleSide} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ------------------------------------------------------------ relocation pad

/** Draped outline of the +-500 m relocation box plus the nominal-point marker. */
export function RelocationPad({ result, frame, dem }: { result: MissionResult; frame: SceneFrame; dem: DemStack }) {
  const lonDeg = result.input.lonDeg;
  const objects = useMemo(() => {
    const ax = localAxes(lonDeg);
    const lim = RELOCATION_LIMIT_M / 1000;
    const pts: number[] = [];
    const v = new Vector3();
    const add = (e: number, n: number): void => {
      const x = frame.cx + ax.ex * e + ax.nx * n, y = frame.cy + ax.ey * e + ax.ny * n;
      mapToScene(frame, x, y, demHeight(dem, x, y) + 0.003, v);
      pts.push(v.x, v.y, v.z);
    };
    const steps = 24;
    for (let i = 0; i <= steps; i++) add(-lim + (2 * lim * i) / steps, -lim);
    for (let i = 1; i <= steps; i++) add(lim, -lim + (2 * lim * i) / steps);
    for (let i = 1; i <= steps; i++) add(lim - (2 * lim * i) / steps, lim);
    for (let i = 1; i <= steps; i++) add(-lim, lim - (2 * lim * i) / steps);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    const box = new Line(g, new LineDashedMaterial({ color: 0x8aa0bd, dashSize: 0.04, gapSize: 0.03 }));
    box.computeLineDistances();
    box.frustumCulled = false;

    // Nominal point: a small cross on the ground.
    const c: number[] = [];
    const cross = 0.03;
    for (const [e0, n0, e1, n1] of [[-cross, 0, cross, 0], [0, -cross, 0, cross]] as const) {
      for (const [e, n] of [[e0, n0], [e1, n1]] as const) {
        const x = frame.cx + ax.ex * e + ax.nx * n, y = frame.cy + ax.ey * e + ax.ny * n;
        mapToScene(frame, x, y, demHeight(dem, x, y) + 0.004, v);
        c.push(v.x, v.y, v.z);
      }
    }
    const cg = new BufferGeometry();
    cg.setAttribute('position', new BufferAttribute(new Float32Array(c), 3));
    const mark = new LineSegments(cg, new LineBasicMaterial({ color: 0xe6edf7 }));
    mark.frustumCulled = false;
    return { box, mark };
  }, [lonDeg, frame, dem]);

  useEffect(() => () => {
    objects.box.geometry.dispose();
    objects.mark.geometry.dispose();
  }, [objects]);

  return (
    <group>
      <primitive object={objects.box} />
      <primitive object={objects.mark} />
    </group>
  );
}

// ------------------------------------------------------------- sky bodies

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,244,214,1)');
  grad.addColorStop(0.08, 'rgba(255,214,130,0.85)');
  grad.addColorStop(0.3, 'rgba(245,158,11,0.22)');
  grad.addColorStop(1, 'rgba(245,158,11,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Sun and Earth at their true directions and true angular sizes on a shell around the lander. */
export function SkyBodies({ live }: { live: LiveSky }) {
  const sun = useRef<Group>(null);
  const earth = useRef<Mesh>(null);
  const glow = useMemo(glowTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);
  const sunRadiusKm = BODY_DISTANCE_KM * Math.tan(0.266 * DEG);
  const earthRadiusKm = BODY_DISTANCE_KM * Math.tan(0.95 * DEG);

  useFrame(() => {
    if (!live.valid) return;
    sun.current?.position.copy(live.sunDir).multiplyScalar(BODY_DISTANCE_KM).add(live.eye);
    earth.current?.position.copy(live.earthDir).multiplyScalar(BODY_DISTANCE_KM).add(live.eye);
  });

  return (
    <group>
      <group ref={sun}>
        <mesh>
          <sphereGeometry args={[sunRadiusKm, 24, 16]} />
          <meshBasicMaterial color="#fff4d6" />
        </mesh>
        <sprite scale={[sunRadiusKm * 26, sunRadiusKm * 26, 1]}>
          <spriteMaterial map={glow} blending={AdditiveBlending} depthWrite={false} transparent />
        </sprite>
      </group>
      <mesh ref={earth}>
        <sphereGeometry args={[earthRadiusKm, 32, 20]} />
        <meshLambertMaterial color="#3f7fd6" emissive="#061a33" />
      </mesh>
    </group>
  );
}

// --------------------------------------------------------- far skyline

/**
 * Silhouette of the terrain beyond the local tile, drawn on a cylinder around
 * the lander from the far-field horizon profile. It occludes the Sun and the
 * Earth exactly when the profile says they are below the distant relief.
 */
export function FarSkyline({ result, live }: { result: MissionResult; live: LiveSky }) {
  const group = useRef<Group>(null);
  const objects = useMemo(() => {
    const hz = result.horizon;
    const lon = result.observer.lonDeg;
    const n = 360;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const top = new Float32Array((n + 1) * 3);
    for (let a = 0; a <= n; a++) {
      const [ux, uy] = azimuthToMap(lon, a % n);
      const el = Math.max(-12, hz.farElevDeg[a % n]);
      const y = SKYLINE_RADIUS_KM * Math.tan(el * DEG);
      const x = ux * SKYLINE_RADIUS_KM, z = -uy * SKYLINE_RADIUS_KM;
      pos.set([x, y, z, x, -SKYLINE_RADIUS_KM * 0.3, z], a * 6);
      top.set([x, y, z], a * 3);
    }
    const idx: number[] = [];
    for (let a = 0; a < n; a++) {
      const p = a * 2;
      idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setIndex(idx);
    const wall = new Mesh(g, new MeshBasicMaterial({ color: 0x070a11, side: DoubleSide }));
    wall.frustumCulled = false;
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(top, 3));
    const line = new Line(lg, new LineBasicMaterial({ color: 0x2b3a52 }));
    line.frustumCulled = false;
    return { wall, line };
  }, [result.horizon, result.observer.lonDeg]);

  useEffect(() => () => {
    objects.wall.geometry.dispose();
    objects.line.geometry.dispose();
  }, [objects]);

  useFrame(() => {
    if (group.current && live.valid) group.current.position.copy(live.eye);
  });

  return (
    <group ref={group}>
      <primitive object={objects.wall} />
      <primitive object={objects.line} />
    </group>
  );
}

// ------------------------------------------------------------- DTE beam

/**
 * Direct-to-Earth beam. Cyan cone to the sky shell when the line of sight is
 * open; red and cut short at the terrain when it is blocked.
 */
export function DteBeam({ result, live, dem }: CommonProps & { dem: DemStack }) {
  const group = useRef<Group>(null);
  const cone = useRef<Mesh>(null);
  const coneScale = useRef<Group>(null);
  const stop = useRef<Group>(null);
  const q = useMemo(() => new Quaternion(), []);
  const tip = useMemo(() => new Vector3(), []);
  const { camera, size } = useThree();
  const lastHit = useRef({ az: NaN, el: NaN, result: null as MissionResult | null, dist: null as number | null });
  const lang = useApp((s) => s.lang);

  useFrame(() => {
    const g = group.current, c = cone.current, cs = coneScale.current;
    if (!g || !c || !cs || !live.valid) return;
    const open = live.earthClear > 0;
    let length = BODY_DISTANCE_KM;
    let hitKm: number | null = null;
    if (!open) {
      const l = lastHit.current;
      if (l.result !== result || Math.abs(l.az - live.earthAz) > 0.02 || Math.abs(l.el - live.earthEl) > 0.01) {
        l.result = result; l.az = live.earthAz; l.el = live.earthEl;
        // Boresight ray first; if only the antenna margin is violated, use the range of the skyline point.
        l.dist = rayHitDistance(dem, result.observer, live.earthAz, live.earthEl)
          ?? result.horizon.distKm[Math.round(live.earthAz) % 360];
      }
      hitKm = l.dist;
      length = Math.min(SKYLINE_RADIUS_KM, Math.max(0.05, hitKm ?? SKYLINE_RADIUS_KM));
    }
    g.position.copy(live.eye);
    q.setFromUnitVectors(UP, live.earthDir);
    g.quaternion.copy(q);
    const eyeView = useApp.getState().view === 'eye';
    // From the lander's own eye the cone would fill the screen: the Earth itself is the cue there.
    cs.visible = !eyeView;
    // In the communications console the beam is the subject; elsewhere it steps back.
    const focus = sceneFocus(useApp.getState());
    const gain = focus === 'comms' ? 2.4 : 1;
    const width = Math.max(0.012, length * 0.0065) * gain;
    cs.scale.set(width, length, width);
    const mat = c.material as MeshBasicMaterial;
    mat.color.copy(open ? COLOR_RF : COLOR_CRIT);
    mat.opacity = (open ? 0.2 : 0.34) * (focus === 'comms' ? 1.9 : focus === 'power' || focus === 'terrain' ? 0.45 : 1);
    if (stop.current) {
      stop.current.visible = !open && !eyeView;
      stop.current.position.set(0, length, 0);
      const s = Math.max(0.02, length * 0.03);
      stop.current.scale.setScalar(s);
    }
    const tag = hudTags.los;
    if (tag) {
      tip.copy(live.earthDir).multiplyScalar(length).add(live.eye).project(camera);
      const visible = !open && hitKm !== null && tip.z < 1 && Math.abs(tip.x) < 1 && Math.abs(tip.y) < 1;
      tag.style.display = visible ? 'block' : 'none';
      if (visible && hitKm !== null) {
        const km = hitKm < 10 ? hitKm.toFixed(2) : hitKm.toFixed(0);
        const text = hitKm < 0.15
          ? (lang === 'es' ? 'Tierra bajo el terreno local' : 'Earth below the local ground')
          : (lang === 'es' ? `LOS bloqueada a ${km} km` : `LOS blocked at ${km} km`);
        if (tag.textContent !== text) tag.textContent = text;
        const x = ((tip.x + 1) / 2) * size.width, y = ((1 - tip.y) / 2) * size.height;
        tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -260%)`;
      }
    }
  });

  useEffect(() => () => { if (hudTags.los) hudTags.los.style.display = 'none'; }, []);

  return (
    <group ref={group}>
      {/* unit cone: apex at the lander, opening along +Y; the group carries the scale */}
      <group ref={coneScale}>
        <mesh ref={cone} position={[0, 0.5, 0]}>
          <cylinderGeometry args={[1, 0.08, 1, 24, 1, true]} />
          <meshBasicMaterial color="#06B6D4" transparent opacity={0.2} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      </group>
      <group ref={stop} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.12, 8, 28]} />
          <meshBasicMaterial color="#EF4444" />
        </mesh>
      </group>
    </group>
  );
}

/** Thin ray towards the Sun: amber when the disc is visible, dim red when it is hidden. */
export function SunVector({ live }: { live: LiveSky }) {
  const line = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0]), 3));
    const l = new Line(g, new LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.8 }));
    l.frustumCulled = false;
    return l;
  }, []);
  useEffect(() => () => line.geometry.dispose(), [line]);
  const q = useMemo(() => new Quaternion(), []);
  useFrame(() => {
    if (!live.valid) return;
    line.visible = useApp.getState().view !== 'eye';
    line.position.copy(live.eye);
    line.quaternion.copy(q.setFromUnitVectors(UP, live.sunDir));
    line.scale.set(1, BODY_DISTANCE_KM, 1);
    const m = line.material as LineBasicMaterial;
    m.color.copy(live.sunFrac > 0 ? COLOR_SUN : COLOR_CRIT);
    const focus = sceneFocus(useApp.getState());
    m.opacity = (live.sunFrac > 0 ? 0.35 + 0.5 * live.sunFrac : 0.3) * (focus === 'power' ? 1.2 : focus === 'comms' ? 0.4 : 1);
  });
  return <primitive object={line} />;
}

// ----------------------------------------------------------- horizon ring

/**
 * Az/el gauge wrapped around the lander: a reference circle at 0 deg elevation
 * with ticks and cardinal marks, the local 360-deg skyline, and Sun / Earth
 * markers. Elevations on the gauge are exaggerated by RING_ELEVATION_GAIN so a
 * 2-deg clearance is visible; the bodies on the sky shell stay at true angles.
 */
export function HorizonRing({ result, live }: { result: MissionResult; live: LiveSky }) {
  const group = useRef<Group>(null);
  const sunDot = useRef<Mesh>(null);
  const earthDot = useRef<Mesh>(null);
  const { camera } = useThree();
  const lon = result.observer.lonDeg;

  const objects = useMemo(() => {
    const hz = result.horizon;
    const k = RING_ELEVATION_GAIN * DEG;
    const sky = new Float32Array(361 * 3);
    const rib = new Float32Array(361 * 2 * 3);
    for (let a = 0; a <= 360; a++) {
      const [ux, uy] = azimuthToMap(lon, a % 360);
      const y = hz.elevDeg[a % 360] * k;
      sky.set([ux, y, -uy], a * 3);
      rib.set([ux, y, -uy, ux, Math.min(y, -8 * k) - 0.02, -uy], a * 6);
    }
    const idx: number[] = [];
    for (let a = 0; a < 360; a++) {
      const p = a * 2;
      idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(sky, 3));
    const skyline = new Line(sg, new LineBasicMaterial({ color: 0xc9d4e3 }));
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(rib, 3));
    rg.setIndex(idx);
    const ribbon = new Mesh(rg, new MeshBasicMaterial({ color: 0x5b6b82, transparent: true, opacity: 0.3, side: DoubleSide, depthWrite: false }));

    // Reference circle and ticks every 10 deg (longer every 90).
    const ref: number[] = [];
    for (let a = 0; a < 360; a += 2) {
      const [u0x, u0y] = azimuthToMap(lon, a), [u1x, u1y] = azimuthToMap(lon, a + 2);
      ref.push(u0x, 0, -u0y, u1x, 0, -u1y);
    }
    for (let a = 0; a < 360; a += 10) {
      const [ux, uy] = azimuthToMap(lon, a);
      const len = a % 90 === 0 ? 1.12 : a % 30 === 0 ? 1.06 : 1.03;
      ref.push(ux, 0, -uy, ux * len, 0, -uy * len);
    }
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(new Float32Array(ref), 3));
    const circle = new LineSegments(fg, new LineBasicMaterial({ color: 0x4b5d78 }));
    for (const o of [skyline, ribbon, circle]) o.frustumCulled = false;
    return { skyline, ribbon, circle };
  }, [result.horizon, lon]);

  useEffect(() => () => {
    objects.skyline.geometry.dispose();
    objects.ribbon.geometry.dispose();
    objects.circle.geometry.dispose();
  }, [objects]);

  const cardinals = useMemo(() => (['N', 'E', 'S', 'W'] as const).map((name, i) => {
    const [ux, uy] = azimuthToMap(lon, i * 90);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.font = '700 44px "JetBrains Mono", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 7;
    g.strokeStyle = '#04060a';
    g.strokeText(name, 32, 34);
    g.fillStyle = name === 'N' ? '#ffffff' : '#c9d4e3';
    g.fillText(name, 32, 34);
    const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), transparent: true, depthTest: false }));
    sprite.position.set(ux * 1.2, 0.02, -uy * 1.2);
    sprite.scale.setScalar(0.17);
    sprite.renderOrder = 10;
    return sprite;
  }), [lon]);
  useEffect(() => () => {
    for (const s of cardinals) {
      s.material.map?.dispose();
      s.material.dispose();
    }
  }, [cardinals]);

  const tmp = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const g = group.current;
    if (!g || !live.valid) return;
    g.visible = useApp.getState().view !== 'eye';
    g.position.copy(live.eye);
    const dist = camera.position.distanceTo(live.eye);
    g.scale.setScalar(Math.min(3, Math.max(0.03, dist * 0.2)));
    const k = RING_ELEVATION_GAIN * DEG;
    if (sunDot.current) {
      dirToScene(lon, live.sunAz, 0, tmp);
      sunDot.current.position.set(tmp.x, live.sunEl * k, tmp.z);
      (sunDot.current.material as MeshBasicMaterial).color.copy(live.sunFrac > 0 ? COLOR_SUN : COLOR_CRIT);
    }
    if (earthDot.current) {
      dirToScene(lon, live.earthAz, 0, tmp);
      earthDot.current.position.set(tmp.x, live.earthEl * k, tmp.z);
      (earthDot.current.material as MeshBasicMaterial).color.copy(live.earthClear > 0 ? COLOR_RF : COLOR_CRIT);
    }
  });

  return (
    <group ref={group}>
      <primitive object={objects.ribbon} />
      <primitive object={objects.skyline} />
      <primitive object={objects.circle} />
      <mesh ref={sunDot}>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshBasicMaterial color="#F59E0B" />
      </mesh>
      <mesh ref={earthDot}>
        <sphereGeometry args={[0.035, 12, 8]} />
        <meshBasicMaterial color="#06B6D4" />
      </mesh>
      {cardinals.map((s) => <primitive key={s.uuid} object={s} />)}
    </group>
  );
}

// ---------------------------------------------------------------- relays

/**
 * Relay satellites on the sky shell at their true directions. A violet link
 * line joins the lander to every satellite that can relay right now (above the
 * terrain and with the Earth in its own view); the others are shown dimmed.
 */
export function RelaySats({ result, live }: { result: MissionResult; live: LiveSky }) {
  const pool = useMemo(() => Array.from({ length: MAX_RELAYS }, () => {
    const marker = new Mesh(undefined, new MeshBasicMaterial({ color: 0xb49cff }));
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0]), 3));
    const link = new Line(g, new LineBasicMaterial({ color: 0xb49cff, transparent: true, opacity: 0.75 }));
    link.frustumCulled = false;
    marker.frustumCulled = false;
    return { marker, link };
  }), []);
  useEffect(() => () => {
    for (const p of pool) {
      p.link.geometry.dispose();
      (p.link.material as LineBasicMaterial).dispose();
      (p.marker.material as MeshBasicMaterial).dispose();
    }
  }, [pool]);
  const dir = useMemo(() => new Vector3(), []);
  const q = useMemo(() => new Quaternion(), []);
  const shell = BODY_DISTANCE_KM * 0.82;

  useFrame(() => {
    if (!live.valid) return;
    const sats = result.relaySats;
    const cursor = useApp.getState().cursorHours;
    const idx = Math.max(0, Math.min(result.count - 1, Math.round(cursor / result.stepHours)));
    const k = idx * 3;
    const timeMs = result.eph.startMs + cursor * HOUR_MS;
    const frame = resultFrame(result);
    const margin = result.input.rf.elevationMarginDeg;
    for (let i = 0; i < pool.length; i++) {
      const { marker, link } = pool[i];
      if (i >= sats.length) { marker.visible = false; link.visible = false; continue; }
      const v = relayView(sats[i], timeMs, frame, result.horizon, margin, result.eph.earth[k], result.eph.earth[k + 1], result.eph.earth[k + 2]);
      if (v.elDeg < -4) { marker.visible = false; link.visible = false; continue; }
      dirToScene(result.observer.lonDeg, v.azDeg, v.elDeg, dir);
      marker.visible = true;
      marker.position.copy(dir).multiplyScalar(shell).add(live.eye);
      (marker.material as MeshBasicMaterial).color.copy(v.usable ? COLOR_RELAY : COLOR_RELAY_IDLE);
      link.visible = v.usable;
      if (v.usable) {
        link.position.copy(live.eye);
        link.quaternion.copy(q.setFromUnitVectors(UP, dir));
        link.scale.set(1, shell, 1);
      }
    }
  });

  return (
    <group>
      {pool.map((p, i) => (
        <group key={i}>
          <primitive object={p.marker}>
            <octahedronGeometry args={[0.55, 0]} />
          </primitive>
          <primitive object={p.link} />
        </group>
      ))}
    </group>
  );
}
