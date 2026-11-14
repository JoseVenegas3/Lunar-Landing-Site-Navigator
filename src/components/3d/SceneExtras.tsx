/**
 * Scene helpers of the v4 interface: the escape arrow of the emergency mode,
 * the names of the landforms around the horizon and double-click-to-land.
 */
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Sprite,
  SpriteMaterial, Vector2, Vector3,
} from 'three';
import {
  ALL_SITES, CUSTOM_LAT_MAX, DemStack, MissionResult, NAMED_LANDFORMS, RELOCATION_LIMIT_M, demHeight, latLonToXY, localAxes, xyToLatLon,
} from '../../engine';
import { siteColour } from '../PolarMap';
import { useInsights } from '../../state/insights';
import { ScenarioKey, useApp } from '../../state/store';
import { BODY_DISTANCE_KM, LiveSky, SKYLINE_RADIUS_KM, SceneFrame, hudTags, mapToScene, useSceneUi } from './sceneMath';

const ARROW_COLOUR = 0x34f5a8;

/** Bright green arrow on the ground from the lander to the best cell of the dispersion grid. */
export function EscapeArrow({ result, frame, dem, scenarioKey }: { result: MissionResult; frame: SceneFrame; dem: DemStack; scenarioKey: ScenarioKey }) {
  const grid = useInsights((s) => s.dispersion[scenarioKey]);
  const obs = result.observer;
  const object = useMemo(() => {
    if (!grid || !grid.escape) return null;
    const ax = localAxes(obs.lonDeg);
    const e = (grid.best.eastM - grid.centre.eastM) / 1000, n = (grid.best.northM - grid.centre.northM) / 1000;
    const len = Math.hypot(e, n);
    if (len < 1e-6) return null;
    // Unit vectors along and across the arrow, in the map frame.
    const ux = (ax.ex * e + ax.nx * n) / len, uy = (ax.ey * e + ax.ny * n) / len;
    const px = -uy, py = ux;
    const half = 0.007, headLen = Math.min(0.05, len * 0.4), headHalf = 0.022, lift = 0.006;
    const v = new Vector3();
    const pts: number[] = [];
    const at = (along: number, across: number): void => {
      const x = obs.x + ux * along + px * across, y = obs.y + uy * along + py * across;
      mapToScene(frame, x, y, demHeight(dem, x, y) + lift, v);
      pts.push(v.x, v.y, v.z);
    };
    const steps = 16, shaft = len - headLen;
    for (let i = 0; i < steps; i++) {
      const a0 = (shaft * i) / steps, a1 = (shaft * (i + 1)) / steps;
      at(a0, -half); at(a1, -half); at(a1, half);
      at(a0, -half); at(a1, half); at(a0, half);
    }
    at(shaft, -headHalf); at(len, 0); at(shaft, headHalf);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    const mesh = new Mesh(g, new MeshBasicMaterial({ color: ARROW_COLOUR, side: DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return mesh;
  }, [grid, obs, frame, dem]);

  useEffect(() => () => { object?.geometry.dispose(); (object?.material as MeshBasicMaterial | undefined)?.dispose(); }, [object]);
  return object ? <primitive object={object} /> : null;
}

const LANDMARKS = ['Shackleton', 'Haworth', 'Shoemaker', 'Cabeus', 'Amundsen', 'Nobile', 'de Gerlache', 'Faustini', 'Malapert Massif', 'Mons Mouton'];

/** Full landform name on a dark plate. The canvas is as wide as the text: names are never clipped or abbreviated. */
function labelSprite(text: string): Sprite {
  const c = document.createElement('canvas');
  const font = '26px "B612", system-ui, sans-serif';
  const probe = c.getContext('2d') as CanvasRenderingContext2D;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width + 22);
  c.width = w + 4; c.height = 56;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = font;
  ctx.fillStyle = 'rgba(8,11,17,0.62)';
  ctx.fillRect(2, 8, w, 40);
  ctx.fillStyle = '#c9d4e3';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, 29);
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }));
  // Same text height as before (1.08 units for 56 px); the width follows the text.
  sprite.scale.set((1.08 * c.width) / 56, 1.08, 1);
  sprite.userData.label = text;
  sprite.renderOrder = 5;
  return sprite;
}

/** Names of the real landforms, floating above the skyline in their true bearing, with the distance. */
export function LandmarkLabels({ result, frame }: { result: MissionResult; frame: SceneFrame }) {
  const obs = result.observer;
  const group = useMemo(() => {
    const g = new Group();
    const eye = mapToScene(frame, obs.x, obs.y, obs.heightKm, new Vector3());
    for (const name of LANDMARKS) {
      const f = NAMED_LANDFORMS.find((x) => x.name === name);
      if (!f) continue;
      const [x, y] = latLonToXY(f.latDeg, f.lonDeg);
      const dx = x - obs.x, dy = y - obs.y, d = Math.hypot(dx, dy);
      if (d < 4) continue; // standing on it
      const s = labelSprite(`${f.name} · ${Math.round(d)} km`);
      s.position.set(eye.x + (dx / d) * SKYLINE_RADIUS_KM * 0.92, eye.y + SKYLINE_RADIUS_KM * 0.075, eye.z - (dy / d) * SKYLINE_RADIUS_KM * 0.92);
      g.add(s);
    }
    return g;
  }, [obs, frame]);

  useEffect(() => () => {
    for (const o of group.children) {
      const m = (o as Sprite).material;
      m.map?.dispose();
      m.dispose();
    }
  }, [group]);
  return <primitive object={group} />;
}

/** Round dot of one colour, for the site markers. */
function dotSprite(colour: string): Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = 'rgba(8,11,17,0.75)';
  ctx.beginPath(); ctx.arc(16, 16, 11, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(16, 16, 7, 0, 2 * Math.PI); ctx.fill();
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(0.55, 0.55, 1);
  sprite.renderOrder = 6;
  return sprite;
}

/**
 * Every catalogue site as a dot just above the skyline, in its true bearing
 * (colour by group, as on the polar map). With about twenty sites the names
 * would overlap, so a name with its distance appears only under the pointer.
 */
export function SiteMarkers({ result, frame, nameOf }: { result: MissionResult; frame: SceneFrame; nameOf: (id: string, name: string, km: number) => string }) {
  const { gl, camera } = useThree();
  const obs = result.observer;
  const { group, tags } = useMemo(() => {
    const g = new Group();
    const list: { sprite: Sprite; label: string }[] = [];
    const eye = mapToScene(frame, obs.x, obs.y, obs.heightKm, new Vector3());
    for (const s of ALL_SITES) {
      const [x, y] = latLonToXY(s.latDeg, s.lonDeg);
      const dx = x - obs.x, dy = y - obs.y, d = Math.hypot(dx, dy);
      if (d < 0.3) continue; // the site the lander is on
      const sp = dotSprite(siteColour(s.id));
      sp.position.set(eye.x + (dx / d) * SKYLINE_RADIUS_KM * 0.9, eye.y + SKYLINE_RADIUS_KM * 0.035, eye.z - (dy / d) * SKYLINE_RADIUS_KM * 0.9);
      g.add(sp);
      list.push({ sprite: sp, label: nameOf(s.id, s.name, d) });
    }
    return { group: g, tags: list };
  }, [obs, frame, nameOf]);

  useEffect(() => {
    const el = gl.domElement;
    const v = new Vector3();
    let raf = 0;
    let last: PointerEvent | null = null;
    const hide = (): void => { if (hudTags.site) hudTags.site.style.display = 'none'; };
    const show = (ev: PointerEvent): void => {
      const tip = hudTags.site;
      if (!tip) return;
      const r = el.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let best: { label: string; x: number; y: number } | null = null, bestD = 12;
      for (const t of tags) {
        v.copy(t.sprite.position).project(camera);
        if (v.z > 1) continue;
        const x = (v.x * 0.5 + 0.5) * r.width, y = (0.5 - v.y * 0.5) * r.height;
        const d = Math.hypot(x - mx, y - my);
        if (d < bestD) { bestD = d; best = { label: t.label, x, y }; }
      }
      if (!best) { hide(); return; }
      tip.textContent = best.label;
      tip.style.display = 'block';
      tip.style.transform = `translate(${Math.round(best.x)}px, ${Math.round(best.y)}px)`;
    };
    const onMove = (ev: PointerEvent): void => {
      last = ev;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (last) show(last); });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', hide);
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', hide); cancelAnimationFrame(raf); hide(); };
  }, [gl, camera, tags]);

  useEffect(() => () => {
    for (const o of group.children) {
      const m = (o as Sprite).material;
      m.map?.dispose();
      m.dispose();
    }
  }, [group]);
  return <primitive object={group} />;
}

/** Labels of the double-click action, in the interface language. */
export interface DoubleClickText {
  move: (m: number) => string;
  create: string;
  outside: string;
}

/**
 * Double-click on the terrain puts the lander there: a relocation when it is
 * within the ±500 m box, a new site otherwise. While the pointer moves over
 * the terrain a reticle says which of the two will happen; north of 80° S the
 * click is refused with a message instead of being ignored.
 */
export function DoubleClickLand({ result, frame, scenarioKey, text }: { result: MissionResult; frame: SceneFrame; scenarioKey: ScenarioKey; text: DoubleClickText }) {
  const { gl, camera, scene } = useThree();
  const { latDeg, lonDeg } = result.input;
  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    const el = gl.domElement;
    const pick = (ev: MouseEvent) => {
      const terrain = scene.getObjectByName('terrain');
      if (!terrain) return null;
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, 1 - ((ev.clientY - r.top) / r.height) * 2);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(terrain, false)[0];
      if (!hit) return null;
      const x = hit.point.x + frame.cx, y = frame.cy - hit.point.z;
      const ll = xyToLatLon(x, y);
      const [nx, ny] = latLonToXY(latDeg, lonDeg);
      const ax = localAxes(lonDeg);
      const eastM = ((x - nx) * ax.ex + (y - ny) * ax.ey) * 1000, northM = ((x - nx) * ax.nx + (y - ny) * ax.ny) * 1000;
      const inBox = Math.abs(eastM) <= RELOCATION_LIMIT_M && Math.abs(northM) <= RELOCATION_LIMIT_M;
      return { ll, eastM, northM, inBox, outside: ll.latDeg > CUSTOM_LAT_MAX, px: ev.clientX - r.left, py: ev.clientY - r.top };
    };
    const showCursor = (p: ReturnType<typeof pick>): void => {
      const c = hudTags.cursor;
      if (!c) return;
      if (!p || useSceneUi.getState().dragging) { c.style.display = 'none'; return; }
      const cfg = useApp.getState().scenarios[scenarioKey];
      const label = p.outside ? text.outside : p.inBox ? text.move(Math.round(Math.hypot(p.eastM - cfg.dxM, p.northM - cfg.dyM))) : text.create;
      c.style.display = 'block';
      c.style.transform = `translate(${Math.round(p.px)}px, ${Math.round(p.py)}px)`;
      c.dataset.action = p.outside ? 'outside' : p.inBox ? 'move' : 'create';
      const span = c.lastElementChild as HTMLElement | null;
      if (span && span.textContent !== label) span.textContent = label;
    };
    let raf = 0;
    let last: MouseEvent | null = null;
    const onMove = (ev: MouseEvent): void => {
      last = ev;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; if (last) showCursor(pick(last)); });
    };
    const onLeave = (): void => { if (hudTags.cursor) hudTags.cursor.style.display = 'none'; };
    const onDouble = (ev: MouseEvent): void => {
      const p = pick(ev);
      if (!p) return;
      if (p.outside) {
        const n = hudTags.notice;
        if (n) {
          n.textContent = text.outside;
          n.style.display = 'block';
          window.clearTimeout(Number(n.dataset.timer ?? 0));
          n.dataset.timer = String(window.setTimeout(() => { n.style.display = 'none'; }, 3500));
        }
        return;
      }
      const s = useApp.getState();
      if (p.inBox) s.setRelocation(scenarioKey, p.eastM, p.northM);
      else s.updateScenario(scenarioKey, { siteId: 'custom', customLat: Math.round(p.ll.latDeg * 10000) / 10000, customLon: Math.round(p.ll.lonDeg * 10000) / 10000, dxM: 0, dyM: 0 });
    };
    el.addEventListener('dblclick', onDouble);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('dblclick', onDouble);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
      onLeave();
    };
  }, [gl, camera, scene, frame, latDeg, lonDeg, scenarioKey, text]);
  return null;
}

const UP = new Vector3(0, 1, 0);

/** Power console: a solid shaft along the Sun direction, bright while the disc is up and dim red when it is hidden. */
export function SunBeam({ live }: { live: LiveSky }) {
  const mesh = useMemo(() => {
    const g = new CylinderGeometry(1, 1, 1, 12, 1, true);
    g.translate(0, 0.5, 0);
    const m = new Mesh(g, new MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.32, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }));
    m.frustumCulled = false;
    return m;
  }, []);
  const q = useMemo(() => new Quaternion(), []);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); }, [mesh]);
  useFrame(() => {
    if (!live.valid) return;
    mesh.visible = useApp.getState().view !== 'eye';
    mesh.position.copy(live.eye);
    mesh.quaternion.copy(q.setFromUnitVectors(UP, live.sunDir));
    mesh.scale.set(0.035, BODY_DISTANCE_KM, 0.035);
    const mat = mesh.material as MeshBasicMaterial;
    mat.color.setHex(live.sunFrac > 0 ? 0xf59e0b : 0xef4444);
    mat.opacity = live.sunFrac > 0 ? 0.18 + 0.3 * live.sunFrac : 0.14;
  });
  return <primitive object={mesh} />;
}
