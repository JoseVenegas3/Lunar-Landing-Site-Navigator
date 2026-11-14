/**
 * 3-D view of the selected landing site: terrain tile, lander, Sun and Earth
 * vectors, horizon gauge and the micro-relocation tool, with a DOM HUD on top.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { DirectionalLight, NoToneMapping, PerspectiveCamera, Vector3 } from 'three';
import { DemStack, Grid, MissionResult, RELOCATION_LIMIT_M, xyToLatLon } from '../../engine';
import { AssetMarker, AttitudeGizmo } from './SceneContingency';
import { ScenarioData, useActiveScenario } from '../../state/mission';
import { OverlayKind, ScenarioKey, ViewKind, sceneFocus, useApp } from '../../state/store';
import { fmtLat, fmtLon, fmtNum, fmtSigned, useT } from '../../lib/format';
import { DteBeam, FarSkyline, HorizonRing, Lander, RelaySats, RelocationPad, SkyBodies, SunVector } from './SceneObjects';
import { Terrain } from './Terrain';
import { DoubleClickLand, EscapeArrow, LandmarkLabels, SunBeam } from './SceneExtras';
import { Transport } from './Transport';
import { terrainStatusText } from '../triage/TriageLayout';
import { LiveSky, RING_ELEVATION_GAIN, dirToScene, hudTags, makeLiveSky, makeSceneFrame, updateLiveSky, useSceneUi } from './sceneMath';
import { ScenarioBadge } from '../ScenarioBadge';

declare global {
  interface Window {
    /** Hooks for automated verification (Playwright). */
    __clps?: { landerScreen: () => { x: number; y: number } | null; frames: number };
  }
}

/**
 * Shift the projection centre into the part of the canvas no tray covers. The
 * canvas keeps its size (trays float over it); only the principal point moves,
 * so picking, dragging and projected HUD tags stay consistent.
 */
function ViewInset() {
  const inset = useSceneUi((s) => s.inset);
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as PerspectiveCamera;
    const dx = (inset.l - inset.r) / 2, dy = inset.b / 2;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) cam.clearViewOffset();
    else cam.setViewOffset(size.width, size.height, -dx, dy, size.width, size.height);
    cam.updateProjectionMatrix();
  }, [inset, camera, size]);
  useEffect(() => () => { (camera as PerspectiveCamera).clearViewOffset(); }, [camera]);
  return null;
}

function CameraRig({ live, result, siteKey }: { live: LiveSky; result: MissionResult; siteKey: Grid }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const view = useApp((s) => s.view);
  const { camera } = useThree();
  const pending = useRef(true);
  const dir = useMemo(() => new Vector3(), []);

  useEffect(() => { pending.current = true; }, [view, siteKey]);

  useFrame(() => {
    const c = controls.current;
    if (!c || !live.valid) return;
    const cam = camera as PerspectiveCamera;
    if (pending.current) {
      pending.current = false;
      if (view === 'orbit') {
        cam.fov = 40; cam.near = 0.01;
        cam.position.copy(live.lander).add(dir.set(1.9, 1.25, 2.3));
        c.target.copy(live.lander);
      } else if (view === 'top') {
        cam.fov = 40; cam.near = 0.01;
        cam.position.copy(live.lander).add(dir.set(0, 13, 0.02));
        c.target.copy(live.lander);
      } else {
        cam.fov = 55; cam.near = 0.0005;
        cam.position.copy(live.eye);
        dirToScene(result.observer.lonDeg, live.sunAz, 3, dir);
        c.target.copy(live.eye).addScaledVector(dir, 0.01);
      }
      cam.updateProjectionMatrix();
    }
    if (view === 'eye') {
      // Keep the eye on the mast: re-anchor after the controls have orbited the look-at point.
      dir.copy(c.target).sub(cam.position).normalize();
      cam.position.copy(live.eye);
      c.target.copy(live.eye).addScaledVector(dir, 0.01);
    } else if (!useSceneUi.getState().dragging) {
      c.target.lerp(live.lander, 0.15);
    }
    c.update();
  });

  const eye = view === 'eye';
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.14}
      enablePan={false}
      enableZoom={!eye}
      rotateSpeed={eye ? -0.3 : 0.7}
      minDistance={eye ? 0.01 : 0.06}
      maxDistance={eye ? 0.01 : 28}
      maxPolarAngle={eye ? Math.PI : Math.PI * 0.53}
    />
  );
}

function SceneContents({ dem, result, overlay, scenarioKey }: { dem: DemStack; result: MissionResult; overlay: OverlayKind; scenarioKey: ScenarioKey }) {
  const focus = useApp(sceneFocus);
  const grid = dem.local as Grid;
  const live = useMemo(makeLiveSky, []);
  const frame = useMemo(() => makeSceneFrame(grid), [grid]);
  const light = useRef<DirectionalLight>(null);
  const { camera, gl, scene } = useThree();
  const fps = useRef({ frames: 0, t: performance.now() });
  const mount = result.input.power.mount;

  // Compile every shader program up front, including those of objects that are
  // hidden at first (the blocked-beam marker, bodies outside the frustum).
  // Otherwise the first appearance of each one stalls a frame for ~100-500 ms.
  useEffect(() => {
    const id = setTimeout(() => { void gl.compileAsync(scene, camera).catch(() => undefined); }, 0);
    return () => clearTimeout(id);
  }, [gl, scene, camera, grid, mount]);

  // Runs before every other frame subscriber so they all see the same sky state.
  useFrame(() => {
    updateLiveSky(live, result, useApp.getState().cursorHours, frame);
    if (light.current) {
      light.current.position.copy(live.sunDir).multiplyScalar(10).add(live.lander);
      light.current.target.position.copy(live.lander);
      light.current.target.updateMatrixWorld();
      light.current.intensity = 2.6 * live.sunFrac;
    }
    const f = fps.current;
    f.frames++;
    if (window.__clps) window.__clps.frames++;
    const now = performance.now();
    if (now - f.t >= 500) {
      useSceneUi.getState().set({ fps: Math.round((f.frames * 1000) / (now - f.t)) });
      f.frames = 0;
      f.t = now;
    }
  }, -1);

  useEffect(() => {
    const v = new Vector3();
    window.__clps = {
      frames: 0,
      landerScreen: () => {
        if (!live.valid) return null;
        v.copy(live.lander).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
    };
    return () => { delete window.__clps; };
  }, [live, camera, gl]);

  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight ref={light} intensity={2.6} />
      <Stars radius={220} depth={40} count={1600} factor={7} saturation={0} speed={0} />
      <CameraRig live={live} result={result} siteKey={grid} />
      <ViewInset />
      <Terrain grid={grid} frame={frame} result={result} live={live} overlay={overlay} />
      <FarSkyline result={result} live={live} />
      <SkyBodies live={live} />
      <RelocationPad result={result} frame={frame} dem={dem} />
      <HorizonRing result={result} live={live} />
      <SunVector live={live} />
      <RelaySats result={result} live={live} />
      <AttitudeGizmo result={result} live={live} />
      <AssetMarker result={result} frame={frame} live={live} dem={dem} />
      <DteBeam result={result} frame={frame} live={live} dem={dem} />
      <Lander result={result} frame={frame} live={live} dem={dem} />
      <LandmarkLabels result={result} frame={frame} />
      {(focus === 'triage' || focus === 'terrain') && <EscapeArrow result={result} frame={frame} dem={dem} scenarioKey={scenarioKey} />}
      {focus === 'power' && <SunBeam live={live} />}
      <DoubleClickLand result={result} frame={frame} scenarioKey={scenarioKey} />
    </>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'is-on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SceneHud({ data }: { data: ScenarioData }) {
  const t = useT();
  const view = useApp((s) => s.view);
  const overlay = useApp((s) => s.overlay);
  const cfg = useApp((s) => s.scenarios[data.key]);
  const setView = useApp((s) => s.setView);
  const setOverlay = useApp((s) => s.setOverlay);
  const setRelocation = useApp((s) => s.setRelocation);
  const legend = useApp((s) => s.panels.legend);
  const setPanels = useApp((s) => s.setPanels);
  const fps = useSceneUi((s) => s.fps);
  const progress = useSceneUi((s) => s.overlayProgress);
  const r = data.result;
  const pos = r ? xyToLatLon(r.observer.x, r.observer.y) : null;
  const moved = cfg.dxM !== 0 || cfg.dyM !== 0;

  return (
    <div className="scene-hud">
      <div className="scene-tag scene-tag-crit hud-los" ref={(el) => { hudTags.los = el; }} style={{ display: 'none' }} />
      <div className="hud-block hud-tl">
        <div className="hud-title"><ScenarioBadge k={data.key} />{data.name}</div>
        {r && pos && (
          <p className="hud-line mono">
            {fmtLat(pos.latDeg)} {fmtLon(pos.lonDeg)} · {fmtSigned(r.kpis.groundElevationM, 0)} m ·{' '}
            <span className={r.kpis.slopeDeg > 15 ? 'is-crit' : r.kpis.slopeDeg > 10 ? 'is-warn' : ''}>
              {t('slope', 'pendiente')} {fmtNum(r.kpis.slopeDeg, 1)}°
            </span>
          </p>
        )}
        <p className="hud-line hud-reloc mono">
          <span className="reloc-title">{t('Lander offset', 'Desplazamiento')}</span>{' '}
          <span className="reloc-values" data-testid="reloc-readout">ΔE {fmtSigned(cfg.dxM, 0)} m&nbsp;&nbsp;ΔN {fmtSigned(cfg.dyM, 0)} m</span>
          {moved && (
            <button type="button" className="btn btn-small hud-reset" onClick={() => setRelocation(data.key, 0, 0)} data-testid="reloc-reset">
              {t('Return to nominal point', 'Volver al punto nominal')}
            </button>
          )}
        </p>
        {r && data.stream && data.stream !== 'static' && (
          <p className={`hud-line hud-stream is-${terrainStatusText(data, t).tone}`} data-testid="hud-stream" data-stream={data.stream}>{terrainStatusText(data, t).text}</p>
        )}
      </div>

      <div className="hud-block hud-tr">
        <Segmented<ViewKind>
          label={t('Camera', 'Cámara')}
          value={view}
          onChange={setView}
          options={[
            { value: 'orbit', label: t('Orbit', 'Órbita') },
            { value: 'top', label: t('Map', 'Mapa') },
            { value: 'eye', label: t('Lander eye', 'Vista lander') },
          ]}
        />
        <Segmented<OverlayKind>
          label={t('Coverage overlay', 'Capa de cobertura')}
          value={overlay}
          onChange={setOverlay}
          options={[
            { value: 'none', label: t('Shadows', 'Sombras') },
            { value: 'insolation', label: t('Sun hours', 'Horas de sol') },
            { value: 'dte', label: t('Earth view', 'Vista Tierra') },
            { value: 'slope', label: t('Slope', 'Pendiente') },
          ]}
        />
        {overlay !== 'none' && (
          <div className="hud-ramp">
            <div className={`ramp ramp-${overlay}`} />
            {overlay === 'slope'
              ? <div className="ramp-labels mono"><span>0°</span><span>5°</span><span>10°</span><span>15°</span><span>25°+</span></div>
              : <div className="ramp-labels mono"><span>0%</span><span>{progress !== null ? `${t('computing', 'calculando')} ${Math.round(progress * 100)}%` : t('of the window', 'de la ventana')}</span><span>100%</span></div>}
          </div>
        )}
        <div className="hud-fps mono" data-testid="fps">{fps} fps</div>
      </div>

      <div className="hud-block hud-bl">
        {legend && (
          <ul className="legend" data-testid="legend">
            <li><i className="sw sw-sun" />{t('Sun vector', 'Vector solar')}</li>
            <li><i className="sw sw-rf" />{t('DTE beam, clear', 'Haz DTE, libre')}</li>
            <li><i className="sw sw-crit" />{t('Blocked by terrain', 'Bloqueado por relieve')}</li>
            <li><i className="sw sw-relay" />{t('Relay satellite, linked', 'Satélite relay, enlazado')}</li>
            <li><i className="sw sw-cone" />{t('Antenna beam (θ3dB) and body normal', 'Haz de antena (θ3dB) y normal del cuerpo')}</li>
            <li><i className="sw sw-psi" />{t('NASA exclusion radius, scaled', 'Radio de exclusión NASA, escalado')}</li>
            <li><i className="sw sw-ring" />{t(`Horizon gauge, elevation ×${RING_ELEVATION_GAIN}`, `Anillo de horizonte, elevación ×${RING_ELEVATION_GAIN}`)}</li>
            <li><i className="sw sw-box" />{t(`Drag the lander inside the ±${RELOCATION_LIMIT_M} m box`, `Arrastra el lander dentro del cuadro de ±${RELOCATION_LIMIT_M} m`)}</li>
          </ul>
        )}
        <button type="button" className={`btn btn-small${legend ? ' is-on' : ''}`} aria-pressed={legend} onClick={() => setPanels({ legend: !legend })} data-testid="legend-toggle">
          {t('Legend', 'Leyenda')}
        </button>
      </div>

      <Transport />
    </div>
  );
}

export function SceneView() {
  const data = useActiveScenario();
  const overlay = useApp((s) => s.overlay);
  const t = useT();
  const ready = data.dem !== null && data.result !== null;

  return (
    <div className="scene" data-testid="scene">
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 40, near: 0.01, far: 600, position: [1.9, 1.25, 2.3] }}
        onCreated={({ gl }) => { gl.toneMapping = NoToneMapping; }}
      >
        <color attach="background" args={['#04060a']} />
        {ready && <SceneContents dem={data.dem as DemStack} result={data.result as MissionResult} overlay={overlay} scenarioKey={data.key} />}
      </Canvas>
      <SceneHud data={data} />
      {data.loading !== null && (
        <div className="scene-loading" role="status">
          <div className="mono">{t('Loading local terrain', 'Cargando el terreno local')} {Math.round(data.loading * 100)}%</div>
          <div className="bar"><i style={{ width: `${Math.round(data.loading * 100)}%` }} /></div>
        </div>
      )}
    </div>
  );
}
