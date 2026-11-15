/**
 * Horizon panorama: local skyline over 360 deg of azimuth, with the grazing
 * path of the Sun and the libration loop of the Earth drawn on top.
 * The azimuth axis is rotated so the Earth sits in the middle of the plot.
 */
import { useRef } from 'react';
import {
  STATE_DTE, STATE_SUN, ScenarioResult, azElAtFraction, earthClearanceDeg, horizonAt, siteFrame, solarDiscFraction, wrap360,
} from '../../engine';
import { ScenarioData, cursorIndex } from '../../state/mission';
import { C, FONT_MONO, FONT_UI, useCanvas } from '../../lib/useCanvas';
import { cardinal, useT } from '../../lib/format';
import { currentUnits } from '../../lib/units';
import { ScenarioBadge } from '../ScenarioBadge';

const PAD = { l: 44, r: 12, t: 22, b: 26 };

function circularMeanDeg(values: Float32Array): number {
  let s = 0, c = 0;
  for (let i = 0; i < values.length; i += 6) {
    s += Math.sin((values[i] * Math.PI) / 180);
    c += Math.cos((values[i] * Math.PI) / 180);
  }
  return wrap360((Math.atan2(s, c) * 180) / Math.PI);
}

export function HorizonPanorama({ data }: { data: ScenarioData }) {
  const t = useT();
  const hover = useRef<{ x: number; y: number } | null>(null);
  const result = data.result;
  const labels = {
    sun: t('Sun path', 'Trayectoria del Sol'),
    earth: t('Earth libration loop', 'Bucle de libración de la Tierra'),
    box: t('libration box', 'caja de libración'),
    margin: t('antenna margin', 'margen de antena'),
    horizon: t('horizon', 'horizonte'),
    az: t('Azimuth', 'Azimut'),
    el: t('Elevation', 'Elevación'),
    elShort: t('el', 'elev'),
  };

  const { ref, invalidate } = useCanvas({
    base: (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = C.panel;
      ctx.fillRect(0, 0, w, h);
      if (result) drawBase(ctx, w, h, result, labels);
    },
    overlay: (ctx, w, h, cursorHours) => {
      if (result) drawOverlay(ctx, w, h, result, cursorHours, hover.current, labels);
    },
  }, [result, labels.sun]);

  return (
    <section className="panel pano" aria-label={t('Horizon panorama', 'Panorama de horizonte')}>
      <header className="panel-head">
        <h2><ScenarioBadge k={data.key} />{t('Horizon panorama', 'Panorama de horizonte')}</h2>
        <ul className="legend legend-inline">
          <li><i className="sw sw-sun" />{labels.sun}</li>
          <li><i className="sw sw-rf" />{labels.earth}</li>
          <li><i className="sw sw-crit" />{t('Hidden by terrain', 'Oculto por relieve')}</li>
        </ul>
      </header>
      <canvas
        ref={ref}
        className="pano-canvas"
        data-testid="panorama"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          hover.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          invalidate.current();
        }}
        onPointerLeave={() => { hover.current = null; invalidate.current(); }}
      />
    </section>
  );
}

interface Axes {
  pw: number; ph: number; yMin: number; yMax: number; hzMax: number; az0: number; yScale: number;
  X: (az: number) => number; Y: (el: number) => number;
}

function axes(w: number, h: number, r: ScenarioResult): Axes | null {
  const hz = r.horizon, k = r.kpis;
  const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
  if (pw < 40 || ph < 40) return null;
  let hzMin = Infinity, hzMax = -Infinity;
  for (let a = 0; a < 360; a++) { hzMin = Math.min(hzMin, hz.elevDeg[a]); hzMax = Math.max(hzMax, hz.elevDeg[a]); }
  const yMin = Math.floor(Math.min(-6, hzMin - 1, k.earthElMinDeg - 1.5, k.sunElMinDeg - 1));
  const yMax = Math.ceil(Math.max(8, hzMax + 1.5, k.earthElMaxDeg + 1.5, k.sunElMaxDeg + 1));
  const az0 = wrap360(circularMeanDeg(r.earthAz) - 180);
  return {
    pw, ph, yMin, yMax, hzMax, az0, yScale: ph / (yMax - yMin),
    X: (az) => PAD.l + (wrap360(az - az0) / 360) * pw,
    Y: (el) => PAD.t + ((yMax - el) / (yMax - yMin)) * ph,
  };
}

/** Static layer: grid, skyline, Sun path, libration loop and box. */
function drawBase(ctx: CanvasRenderingContext2D, w: number, h: number, r: ScenarioResult, labels: Record<string, string>): void {
  const ax = axes(w, h, r);
  if (!ax) return;
  const { pw, ph, yMin, yMax, hzMax, az0, X, Y } = ax;
  const hz = r.horizon;
  const k = r.kpis;

  // ---- grid
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  const yStep = yMax - yMin > 24 ? 4 : 2;
  for (let el = Math.ceil(yMin / yStep) * yStep; el <= yMax; el += yStep) {
    ctx.strokeStyle = el === 0 ? '#2b3a52' : C.lineSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, Math.round(Y(el)) + 0.5);
    ctx.lineTo(w - PAD.r, Math.round(Y(el)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = el === 0 ? C.text : C.dim;
    ctx.textAlign = 'right';
    ctx.fillText(`${el > 0 ? '+' : ''}${el}°`, PAD.l - 6, Y(el));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let a = 0; a < 360; a += 30) {
    const x = Math.round(X(a)) + 0.5;
    ctx.strokeStyle = a % 90 === 0 ? '#22304a' : C.lineSoft;
    ctx.beginPath();
    ctx.moveTo(x, PAD.t);
    ctx.lineTo(x, PAD.t + ph);
    ctx.stroke();
    ctx.fillStyle = a % 90 === 0 ? C.text : C.dim;
    if (x > PAD.l + 14 && x < w - PAD.r - 14) ctx.fillText(a % 90 === 0 ? `${cardinal(a)} ${a}°` : `${a}°`, x, PAD.t + ph + 6);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.l, PAD.t, pw, ph);
  ctx.clip();

  // ---- Sun path (behind the skyline: hidden samples disappear into the rock)
  for (let i = 0; i < r.count; i++) {
    const lit = (r.state[i] & STATE_SUN) !== 0;
    ctx.fillStyle = lit ? `rgba(245,158,11,${0.3 + 0.6 * r.sunFrac[i]})` : 'rgba(239,68,68,0.55)';
    ctx.fillRect(X(r.sunAz[i]) - 1, Y(r.sunEl[i]) - 1, 2, 2);
  }

  // ---- skyline silhouette
  const grad = ctx.createLinearGradient(0, Y(hzMax), 0, PAD.t + ph);
  grad.addColorStop(0, 'rgba(40,52,74,0.94)');
  grad.addColorStop(1, 'rgba(13,17,26,0.96)');
  ctx.beginPath();
  ctx.moveTo(PAD.l, PAD.t + ph);
  for (let s = 0; s <= 360; s++) ctx.lineTo(PAD.l + (s / 360) * pw, Y(horizonAt(hz, az0 + s)));
  ctx.lineTo(PAD.l + pw, PAD.t + ph);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  for (let s = 0; s <= 360; s++) {
    const x = PAD.l + (s / 360) * pw, y = Y(horizonAt(hz, az0 + s));
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = C.rock;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Hidden Sun samples stay faintly visible through the rock so the full path can be read.
  for (let i = 0; i < r.count; i += 2) {
    if (r.state[i] & STATE_SUN) continue;
    ctx.fillStyle = 'rgba(239,68,68,0.28)';
    ctx.fillRect(X(r.sunAz[i]) - 0.5, Y(r.sunEl[i]) - 0.5, 1.5, 1.5);
  }

  // ---- antenna margin above the skyline, across the libration box
  const margin = r.input.rf.elevationMarginDeg;
  const azLo = k.earthAzMinDeg - 4, azHi = k.earthAzMaxDeg + 4;
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(6,182,212,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let a = azLo; a <= azHi; a += 0.5) {
    const x = X(a), y = Y(horizonAt(hz, a) + margin);
    if (a === azLo) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ---- libration box
  const bx0 = X(k.earthAzMinDeg), bx1 = X(k.earthAzMaxDeg);
  ctx.strokeStyle = 'rgba(6,182,212,0.35)';
  ctx.strokeRect(bx0 - 3, Y(k.earthElMaxDeg) - 3, bx1 - bx0 + 6, Y(k.earthElMinDeg) - Y(k.earthElMaxDeg) + 6);
  ctx.setLineDash([]);

  // ---- Earth loop: one path per link state
  ctx.lineWidth = 1.4;
  for (const open of [true, false]) {
    ctx.strokeStyle = open ? 'rgba(6,182,212,0.85)' : 'rgba(239,68,68,0.85)';
    ctx.beginPath();
    for (let i = 1; i < r.count; i++) {
      if (((r.state[i] & STATE_DTE) !== 0) !== open) continue;
      ctx.moveTo(X(r.earthAz[i - 1]), Y(r.earthEl[i - 1]));
      ctx.lineTo(X(r.earthAz[i]), Y(r.earthEl[i]));
    }
    ctx.stroke();
  }
  ctx.restore();

  // ---- labels
  ctx.font = `10px ${FONT_UI}`;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(6,182,212,0.8)';
  ctx.fillText(labels.box, Math.min(bx0 - 3, w - PAD.r - 90), Y(k.earthElMaxDeg) - 6);
  ctx.fillStyle = C.dim;
  ctx.textBaseline = 'top';
  ctx.fillText(labels.el, 4, 4);
  ctx.textAlign = 'right';
  ctx.fillText(labels.az, w - PAD.r, 4);
}

/** Live layer: Sun and Earth at the cursor, and the hover read-out. */
function drawOverlay(
  ctx: CanvasRenderingContext2D, w: number, h: number, r: ScenarioResult, cursorHours: number,
  hover: { x: number; y: number } | null, labels: Record<string, string>,
): void {
  const ax = axes(w, h, r);
  if (!ax) return;
  const { pw, ph, yMin, yMax, az0, yScale, X, Y } = ax;
  const hz = r.horizon;
  const margin = r.input.rf.elevationMarginDeg;
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.l, PAD.t, pw, ph);
  ctx.clip();
  const obs = hz.observer;
  const frame = siteFrame(obs.latDeg, obs.lonDeg, obs.heightKm);
  const idx = cursorIndex(r, cursorHours);
  const sun = azElAtFraction(r.eph, idx, frame, 'sun');
  const earth = azElAtFraction(r.eph, idx, frame, 'earth');
  const frac = solarDiscFraction(hz, sun.azDeg, sun.elDeg, r.sunRadiusDeg);
  const clear = earthClearanceDeg(hz, earth.azDeg, earth.elDeg, margin);

  const sunR = Math.max(4.5, r.sunRadiusDeg * yScale);
  ctx.beginPath();
  ctx.arc(X(sun.azDeg), Y(sun.elDeg), sunR + 5, 0, Math.PI * 2);
  ctx.fillStyle = frac > 0 ? 'rgba(245,158,11,0.18)' : 'rgba(239,68,68,0.16)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(X(sun.azDeg), Y(sun.elDeg), sunR, 0, Math.PI * 2);
  ctx.fillStyle = frac > 0 ? C.sun : '#7f1d1d';
  ctx.fill();
  ctx.strokeStyle = frac > 0 ? '#fde68a' : C.crit;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const earthR = Math.max(5.5, 0.95 * yScale);
  ctx.beginPath();
  ctx.arc(X(earth.azDeg), Y(earth.elDeg), earthR, 0, Math.PI * 2);
  ctx.fillStyle = clear > 0 ? 'rgba(6,182,212,0.22)' : 'rgba(239,68,68,0.22)';
  ctx.fill();
  ctx.strokeStyle = clear > 0 ? C.rf : C.crit;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  // ---- hover read-out
  if (hover && hover.x >= PAD.l && hover.x <= PAD.l + pw && hover.y >= PAD.t && hover.y <= PAD.t + ph) {
    const az = wrap360(az0 + ((hover.x - PAD.l) / pw) * 360);
    const el = yMax - ((hover.y - PAD.t) / ph) * (yMax - yMin);
    const he = horizonAt(hz, az);
    const hd = hz.distKm[Math.round(az) % 360];
    ctx.strokeStyle = 'rgba(201,212,227,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(hover.x) + 0.5, PAD.t);
    ctx.lineTo(Math.round(hover.x) + 0.5, PAD.t + ph);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hover.x, Y(he), 3, 0, Math.PI * 2);
    ctx.fillStyle = C.text;
    ctx.fill();
    const text = `az ${az.toFixed(0)}° ${cardinal(az)}   ${labels.elShort} ${el >= 0 ? '+' : ''}${el.toFixed(1)}°   ${labels.horizon} ${he >= 0 ? '+' : ''}${he.toFixed(2)}° @ ${currentUnits().kmStr(hd, hd < 10 ? 2 : 0)}`;
    ctx.font = `10.5px ${FONT_MONO}`;
    const tw = ctx.measureText(text).width + 14;
    const tx = Math.min(Math.max(PAD.l + 2, hover.x - tw / 2), PAD.l + pw - tw - 2);
    const ty = PAD.t + 4;
    ctx.fillStyle = 'rgba(8,11,17,0.92)';
    ctx.fillRect(tx, ty, tw, 19);
    ctx.strokeStyle = C.line;
    ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, 18);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, tx + 7, ty + 10);
  }
}
