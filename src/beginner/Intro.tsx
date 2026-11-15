/**
 * Opening cinematic of the Beginner training (v3.0): the whole Moon turning
 * in the dark, the view tilting to the south pole and diving towards the
 * landing site; then the 3-D scene takes over for the powered descent and the
 * touchdown (Beginner.tsx drives the lander drop and the camera).
 *
 * The Moon is drawn on a 2-D canvas from a procedural albedo map (maria,
 * highlands and craters from a seeded hash): no image file, no network. With
 * prefers-reduced-motion the sequence is three still frames that cross-fade.
 * "Skip" is always there.
 */
import { useEffect, useRef } from 'react';
import { fmtNum, useT } from '../lib/format';
import { useMission } from '../state/mission';
import { play } from './audio';
import { useApp } from '../state/store';
import { useBeginner } from './state';

const TEX_W = 512, TEX_H = 256;

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Equirectangular albedo map of a plausible Moon: dark maria on the near side, bright cratered highlands. */
function moonTexture(): Float32Array {
  const a = new Float32Array(TEX_W * TEX_H);
  const smooth = (x: number, y: number, s: number): number => {
    const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const v = (i: number, j: number): number => hash(((i % 64) + 64) % 64, j);
    const u = (t: number): number => t * t * (3 - 2 * t);
    return v(ix, iy) * (1 - u(tx)) * (1 - u(ty)) + v(ix + 1, iy) * u(tx) * (1 - u(ty)) + v(ix, iy + 1) * (1 - u(tx)) * u(ty) + v(ix + 1, iy + 1) * u(tx) * u(ty);
  };
  for (let j = 0; j < TEX_H; j++) {
    for (let i = 0; i < TEX_W; i++) {
      const n = 0.5 * smooth(i, j, 48) + 0.3 * smooth(i, j, 20) + 0.2 * smooth(i, j, 7);
      const lat = (0.5 - j / TEX_H) * Math.PI;
      // maria: darker blotches, mostly on the near side and away from the poles
      const nearSide = Math.max(0, Math.cos(((i / TEX_W) * 2 - 1) * Math.PI));
      const mare = n > 0.55 && Math.abs(lat) < 1.0 ? 0.42 * nearSide : 0;
      a[j * TEX_W + i] = 0.78 - 0.18 * n - mare;
    }
  }
  // craters: darker floors with a bright rim
  for (let k = 0; k < 900; k++) {
    // uniform on the sphere: latitude from asin of a uniform value
    const lat = Math.asin(2 * hash(k, 2) - 1);
    const cx = hash(k, 1) * TEX_W, cy = (0.5 - lat / Math.PI) * TEX_H, r = 1.2 + Math.pow(hash(k, 3), 3) * 11;
    const rx = Math.min(TEX_W / 2, r / Math.max(0.08, Math.cos(lat)));
    for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
      if (y < 0 || y >= TEX_H) continue;
      for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
        const d = Math.hypot((x - cx) * (r / rx), y - cy) / r;
        const xi = ((x % TEX_W) + TEX_W) % TEX_W;
        if (d < 0.85) a[y * TEX_W + xi] *= 0.86;
        else if (d < 1.15) a[y * TEX_W + xi] = Math.min(1, a[y * TEX_W + xi] * 1.12);
      }
    }
  }
  return a;
}

export function Intro({ onDone }: { onDone: () => void }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const caption = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const fast = useBeginner((s) => s.fast);
  const A = useMission().A;
  // Distance to the Earth at touchdown, from the ephemeris of the engine.
  const rangeKm = A.result ? A.result.earthRangeKm[0] : null;

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tex = moonTexture();
    const stars = Array.from({ length: 260 }, (_, k) => [hash(k, 7), hash(k, 8), 0.3 + hash(k, 9) * 0.7]);
    const DUR = fast ? 900 : 9000;
    const t0 = performance.now();
    const lang = useApp.getState().lang;
    play('whoosh', lang);
    let raf = 0, done = false;
    const S = 360; // sphere render resolution
    const img = ctx.createImageData(S, S);
    const off = document.createElement('canvas');
    off.width = off.height = S;
    const octx = off.getContext('2d') as CanvasRenderingContext2D;

    const frame = (now: number): void => {
      const w = (c.width = c.clientWidth), h = (c.height = c.clientHeight);
      let p = Math.min(1, (now - t0) / DUR);
      if (reduced) p = p < 0.33 ? 0.1 : p < 0.66 ? 0.5 : 0.95;
      const ease = (x: number): number => x * x * (3 - 2 * x);
      // phases: 0-0.35 turn, 0.35-0.65 tilt to the pole, 0.65-1 dive
      const spin = p * 1.6;
      const tilt = ease(Math.min(1, Math.max(0, (p - 0.3) / 0.35))) * (Math.PI / 2 - 0.12);
      const zoom = 1 + Math.pow(ease(Math.min(1, Math.max(0, (p - 0.62) / 0.38))), 2) * 9;
      ctx.fillStyle = '#03050a';
      ctx.fillRect(0, 0, w, h);
      for (const [sx, sy, b] of stars) { ctx.fillStyle = `rgba(230,237,247,${b * (1 - Math.min(1, (zoom - 1) / 4))})`; ctx.fillRect(sx * w, sy * h, 1.4, 1.4); }
      // sphere: orthographic, light from the upper left
      const L = [-0.55, 0.45, 0.7];
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const nx = (x / S) * 2 - 1, ny = 1 - (y / S) * 2;
          const r2 = nx * nx + ny * ny, k = (y * S + x) * 4;
          if (r2 > 1) { img.data[k + 3] = 0; continue; }
          const nz = Math.sqrt(1 - r2);
          // rotate about the x axis by the tilt (bringing the south pole to the front), then read lat/lon
          const by = ny * cosT - nz * sinT, bz = ny * sinT + nz * cosT;
          const lat = Math.asin(Math.max(-1, Math.min(1, by)));
          const lon = Math.atan2(nx, bz) + spin;
          const u = ((((lon / (2 * Math.PI)) % 1) + 1) % 1) * TEX_W, v = (0.5 - lat / Math.PI) * TEX_H;
          const alb = tex[Math.min(TEX_H - 1, Math.max(0, Math.floor(v))) * TEX_W + Math.floor(u) % TEX_W];
          const lit = Math.max(0.04, nx * L[0] + ny * L[1] + nz * L[2]);
          const g = Math.min(255, 255 * alb * (0.15 + 0.95 * lit));
          img.data[k] = g * 0.97; img.data[k + 1] = g * 0.96; img.data[k + 2] = g; img.data[k + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      const R = Math.min(w, h) * 0.34 * zoom;
      // dive towards a point just above the centre (the pole after the tilt)
      const cx = w / 2, cy = h / 2 + (zoom - 1) * R * 0.012;
      ctx.drawImage(off, cx - R, cy - R, 2 * R, 2 * R);
      // limb glow
      if (zoom < 2) {
        const gr = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
        gr.addColorStop(0, 'rgba(150,180,230,0.18)'); gr.addColorStop(1, 'rgba(150,180,230,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, 2 * Math.PI); ctx.fill();
      }
      // target reticle on the pole once tilted
      if (tilt > 1.2 && zoom < 6) {
        ctx.strokeStyle = 'rgba(245,158,11,0.9)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy - R * 0.02, 14 + 10 * (zoom - 1), 0, 2 * Math.PI); ctx.stroke();
      }
      // fade to the 3-D scene
      if (p > 0.88) { ctx.fillStyle = `rgba(3,5,10,${(p - 0.88) / 0.12})`; ctx.fillRect(0, 0, w, h); }
      if (caption.current) caption.current.dataset.phase = p < 0.3 ? 'moon' : p < 0.65 ? 'pole' : 'dive';
      if (p >= 1 && !done) { done = true; doneRef.current(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fast]);

  return (
    <div className="intro" data-testid="intro" role="img" aria-label={t('The Moon turns, the view tilts to the south pole and dives towards the landing site.', 'La Luna gira, la vista se inclina hacia el polo sur y desciende hacia el sitio de alunizaje.')}>
      <canvas ref={ref} className="intro-canvas" />
      <div className="intro-caption" ref={caption} data-phase="moon" aria-hidden="true">
        <span className="intro-moon">{rangeKm ? t(`The Moon, ${fmtNum(rangeKm, 0)} km from home.`, `La Luna, a ${fmtNum(rangeKm, 0)} km de casa.`) : t('The Moon.', 'La Luna.')}</span>
        <span className="intro-pole">{t('Its south pole: the Sun never climbs, the shadows last for weeks.', 'Su polo sur: el Sol nunca sube y las sombras duran semanas.')}</span>
        <span className="intro-dive">{t('Descending towards ', 'Descendiendo hacia ')}{A.name}</span>
      </div>
      <button type="button" className="intro-skip" onClick={onDone} data-testid="intro-skip">{t('Skip intro', 'Saltar introducción')}</button>
    </div>
  );
}
