/**
 * Opening cinematic of the Beginner training (v3.0): the real Moon turning
 * in the dark, the globe tilting to show the south pole, and the camera
 * diving towards it; then the 3-D scene takes over for the powered descent
 * and the touchdown (Beginner.tsx drives the lander drop and the camera).
 *
 * WebGL (three.js): a sphere with the LRO LROC WAC colour mosaic and the LOLA
 * relief as bump map (public domain, NASA SVS CGI Moon Kit, see
 * public/beginner/SOURCES.md), lit by a low Sun as at the pole, over a star
 * field. Over the south pole lies a cap with the real LOLA relief of the app
 * (80–90° S, hillshaded), so the dive ends on the true polar terrain instead
 * of the stretched pole of a global map. The sequence is driven by the clock, and a timer ends it even if the
 * page stops drawing, so it can never get stuck. With prefers-reduced-motion
 * it is three still shots. "Skip" is always there.
 */
import { useEffect, useRef } from 'react';
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Points,
  PointsMaterial, SRGBColorSpace, Scene, SphereGeometry, Texture, TextureLoader, WebGLRenderer, CanvasTexture, DoubleSide,
} from 'three';
import { HALF_KM, shadedRelief } from '../components/PolarMap';
import { R_MOON_KM } from '../engine';
import { useT } from '../lib/format';
import { useUnits } from '../lib/units';
import { useMission } from '../state/mission';
import { useApp } from '../state/store';
import { play } from './audio';
import { useBeginner } from './state';

const ease = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const span = (p: number, a: number, b: number): number => ease((p - a) / (b - a));

export function Intro({ onDone }: { onDone: () => void }) {
  const t = useT();
  const u = useUnits();
  const host = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const fast = useBeginner((s) => s.fast);
  const A = useMission().A;
  // Distance to the Earth at touchdown, from the ephemeris of the engine.
  const rangeKm = A.result ? A.result.earthRangeKm[0] : null;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const DUR = fast ? 900 : 10000;
    let finished = false;
    const finish = (): void => { if (!finished) { finished = true; doneRef.current(); } };
    // Whatever happens to the drawing, the intro ends.
    const guard = window.setTimeout(finish, DUR + 2500);

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      window.clearTimeout(guard);
      finish();
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = SRGBColorSpace;
    el.prepend(renderer.domElement);
    renderer.domElement.className = 'intro-canvas';

    const scene = new Scene();
    scene.background = new Color('#02040a');
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    const resize = (): void => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    // stars
    const n = 2500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 40;
      const s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(pos, 3));
    const stars = new Points(sg, new PointsMaterial({ color: 0xe6edf7, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.85 }));
    scene.add(stars);

    // the Moon
    const loader = new TextureLoader();
    const base = import.meta.env.BASE_URL;
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const textures: Texture[] = [];
    loader.load(`${base}beginner/moon-color.jpg`, (tx) => { tx.colorSpace = SRGBColorSpace; tx.anisotropy = 8; mat.map = tx; mat.needsUpdate = true; textures.push(tx); });
    loader.load(`${base}beginner/moon-relief.jpg`, (tx) => { mat.bumpMap = tx; mat.bumpScale = 6; mat.needsUpdate = true; textures.push(tx); });
    const geo = new SphereGeometry(1, 160, 120);
    const moon = new Mesh(geo, mat);
    const tilt = new Group();
    tilt.add(moon);

    // Real polar relief (LOLA, the app's regional grid) on a spherical cap over the south pole.
    const capRad = HALF_KM / R_MOON_KM;
    let cap: Mesh | null = null, capTex: CanvasTexture | null = null;
    const relief = shadedRelief(1024);
    if (relief) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1024;
      const cx2 = cv.getContext('2d') as CanvasRenderingContext2D;
      cx2.putImageData(relief, 0, 0);
      // fade the edge into the global map
      cx2.globalCompositeOperation = 'destination-in';
      const g = cx2.createRadialGradient(512, 512, 300, 512, 512, 512);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      cx2.fillStyle = g; cx2.fillRect(0, 0, 1024, 1024);
      capTex = new CanvasTexture(cv);
      capTex.colorSpace = SRGBColorSpace;
      capTex.anisotropy = 8;
      const cg = new SphereGeometry(1.0015, 256, 48, 0, Math.PI * 2, Math.PI - capRad, capRad);
      const p3 = cg.getAttribute('position'), uv = cg.getAttribute('uv');
      for (let i = 0; i < p3.count; i++) {
        const x = p3.getX(i), y = p3.getY(i), z = p3.getZ(i);
        const colat = Math.acos(Math.max(-1, Math.min(1, -y / 1.0015)));
        // longitude as in the global map of three's sphere (lon 0 = +X, east towards -Z); azimuthal equidistant like latLonToXY
        const lon = Math.atan2(-z, x);
        const rKm = colat * R_MOON_KM;
        uv.setXY(i, 0.5 + (rKm * Math.sin(lon)) / (2 * HALF_KM), 0.5 + (rKm * Math.cos(lon)) / (2 * HALF_KM));
      }
      uv.needsUpdate = true;
      // warm tint and a little self-light so the grey hillshade matches the colour mosaic around it
      cap = new Mesh(cg, new MeshStandardMaterial({ map: capTex, color: 0xd9cdb8, emissive: 0xffffff, emissiveMap: capTex, emissiveIntensity: 0.32, transparent: true, roughness: 1, metalness: 0, side: DoubleSide, depthWrite: false }));
      moon.add(cap);
    }
    scene.add(tilt);
    scene.add(new AmbientLight(0x2a3242, 0.35));
    const sun = new DirectionalLight(0xfff4e0, 2.6);
    scene.add(sun);

    const t0 = performance.now();
    play('whoosh', useApp.getState().lang);
    let raf = 0;
    const frame = (now: number): void => {
      let p = Math.min(1, (now - t0) / DUR);
      if (reduced) p = p < 0.33 ? 0.12 : p < 0.66 ? 0.5 : 0.92;
      // 0–0.3 the globe turns; 0.25–0.6 it tilts to show the south pole; 0.55–1 the camera dives.
      moon.rotation.y = 0.6 + p * 1.4;
      tilt.rotation.x = -span(p, 0.25, 0.6) * (Math.PI / 2 - 0.05);
      const dist = 4.2 - span(p, 0.55, 0.97) * 3.0; // ends 0.2 radii above the pole: the whole polar cap in view
      camera.position.set(0, 0, dist);
      camera.lookAt(0, 0, 0);
      // light: from the side at first, grazing the pole at the end, as at the lunar south pole
      const g = span(p, 0.4, 0.8);
      sun.position.set(-3 + g * 0.5, 1.2 - g * 1.0, 2.2 - g * 2.0);
      stars.rotation.y = p * 0.15;
      if (caption.current) caption.current.dataset.phase = p < 0.27 ? 'moon' : p < 0.58 ? 'pole' : 'dive';
      el.style.setProperty('--fade', String(span(p, 0.9, 1)));
      renderer.render(scene, camera);
      if (p >= 1) { finish(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(guard);
      window.removeEventListener('resize', resize);
      geo.dispose(); mat.dispose(); capTex?.dispose(); cap?.geometry.dispose(); (cap?.material as MeshStandardMaterial | undefined)?.dispose(); sg.dispose(); (stars.material as PointsMaterial).dispose();
      textures.forEach((tx) => tx.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [fast]);

  return (
    <div className="intro" ref={host} data-testid="intro" role="img" aria-label={t('The Moon turns, the view tilts to the south pole and dives towards the landing site.', 'La Luna gira, la vista se inclina hacia el polo sur y desciende hacia el sitio de alunizaje.')}>
      <div className="intro-fade" aria-hidden="true" />
      <div className="intro-caption" ref={caption} data-phase="moon" aria-hidden="true">
        <span className="intro-moon">{rangeKm ? t(`The Moon, ${u.kmStr(rangeKm, 0)} from home.`, `La Luna, a ${u.kmStr(rangeKm, 0)} de casa.`) : t('The Moon.', 'La Luna.')}</span>
        <span className="intro-pole">{t('Its south pole: the Sun never climbs, the shadows last for weeks.', 'Su polo sur: el Sol nunca sube y las sombras duran semanas.')}</span>
        <span className="intro-dive">{t('Descending towards ', 'Descendiendo hacia ')}{A.name}</span>
      </div>
      <p className="intro-credit">{t('Moon maps: NASA SVS, LRO LROC and LOLA', 'Mapas lunares: NASA SVS, LRO LROC y LOLA')}</p>
      <button type="button" className="intro-skip" onClick={() => doneRef.current()} data-testid="intro-skip">{t('Skip intro', 'Saltar introducción')}</button>
    </div>
  );
}
