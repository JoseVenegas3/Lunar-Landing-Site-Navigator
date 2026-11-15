/**
 * Polar map of the whole 80-90 S cap: shaded relief from the regional LOLA
 * grid, latitude rings, named landforms and the lander. A click anywhere
 * inside 80 S puts the lander there.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_SITES, CANDIDATE_SITES, CUSTOM_LAT_MAX, DEG, HISTORICAL_LANDINGS, MISSION_SITES, NAMED_LANDFORMS, R_MOON_KM, REFERENCE_MARKERS, latLonToXY, sampleGrid, xyToLatLon,
} from '../engine';
import { getRegional } from '../state/dem';
import { useT } from '../lib/format';

/** Half-width of the map, km: 80 S is 303 km from the pole. */
export const HALF_KM = 318;

/** Dot colour of a catalogue site, by group. Names appear only under the pointer, so 20 dots never pile up into unreadable labels. */
export function siteColour(id: string): string {
  if (CANDIDATE_SITES.some((s) => s.id === id)) return '#10B981';
  if (HISTORICAL_LANDINGS.some((s) => s.id === id)) return '#E6EDF7';
  return MISSION_SITES.find((s) => s.id === id)?.group === 'artemis' ? '#F59E0B' : '#06B6D4';
}
/** Label offset from its landform (px) and alignment, chosen so the names around the pole do not collide. */
const LABELS: Record<string, [number, number, CanvasTextAlign]> = {
  Shackleton: [0, 11, 'center'], 'de Gerlache': [-6, 3, 'right'], Haworth: [-6, -3, 'right'], Shoemaker: [6, -5, 'left'], Faustini: [6, 7, 'left'],
  Nobile: [6, 0, 'left'], Amundsen: [6, 0, 'left'], Cabeus: [-6, 0, 'right'], 'Malapert Massif': [0, -10, 'center'], 'Mons Mouton': [6, -3, 'left'],
};

export function shadedRelief(px: number): ImageData | null {
  const g = getRegional();
  if (!g || typeof ImageData === 'undefined') return null;
  const img = new ImageData(px, px);
  const kmPerPx = (2 * HALF_KM) / px;
  const edge = R_MOON_KM * 10 * DEG;
  for (let j = 0; j < px; j++) {
    const y = HALF_KM - (j + 0.5) * kmPerPx;
    for (let i = 0; i < px; i++) {
      const x = -HALF_KM + (i + 0.5) * kmPerPx;
      const k = (j * px + i) * 4;
      const inside = Math.hypot(x, y) <= edge;
      // Light from the upper left, as on a printed map.
      const dzdx = (sampleGrid(g, x + kmPerPx, y) - sampleGrid(g, x - kmPerPx, y)) / (2 * kmPerPx);
      const dzdy = (sampleGrid(g, x, y + kmPerPx) - sampleGrid(g, x, y - kmPerPx)) / (2 * kmPerPx);
      const shade = Math.max(0, Math.min(1, 0.5 + 2.2 * (-dzdx + dzdy) * 0.7071));
      const v = inside ? 30 + 190 * shade : 14 + 30 * shade;
      img.data[k] = v * 0.92; img.data[k + 1] = v * 0.96; img.data[k + 2] = v; img.data[k + 3] = 255;
    }
  }
  return img;
}

export function PolarMap({ latDeg, lonDeg, onPick, size = 356 }: { latDeg: number; lonDeg: number; onPick: (latDeg: number, lonDeg: number) => void; size?: number }) {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const relief = useMemo(() => shadedRelief(size), [size]);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const px = (km: number): number => (km / (2 * HALF_KM)) * size;
    const X = (x: number): number => size / 2 + px(x), Y = (y: number): number => size / 2 - px(y);
    ctx.clearRect(0, 0, size, size);
    if (relief) ctx.putImageData(relief, 0, 0);
    ctx.lineWidth = 1;
    ctx.font = '9.5px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    for (const lat of [-80, -82, -84, -86, -88]) {
      ctx.strokeStyle = lat === -80 ? 'rgba(230,237,247,0.75)' : 'rgba(230,237,247,0.22)';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, px(R_MOON_KM * (90 + lat) * DEG), 0, 2 * Math.PI);
      ctx.stroke();
      // Ring labels along the 135 deg W diagonal, clear of the Earth arrow and of most names.
      const rr = px(R_MOON_KM * (90 + lat) * DEG) * 0.7071;
      ctx.fillStyle = 'rgba(230,237,247,0.6)';
      ctx.textAlign = 'left';
      ctx.fillText(`${-lat}°`, size / 2 - rr + 3, size / 2 + rr - 6);
    }
    ctx.fillStyle = 'rgba(6,182,212,0.95)';
    ctx.textAlign = 'center';
    ctx.fillText(t('Earth ↑ (0° lon)', 'Tierra ↑ (lon 0°)'), size / 2, 8);
    ctx.font = '9.5px "B612", sans-serif';
    for (const f of NAMED_LANDFORMS) {
      const place = LABELS[f.name];
      if (!place) continue;
      const [x, y] = latLonToXY(f.latDeg, f.lonDeg);
      const [ox, oy, align] = place;
      const colour = f.kind === 'massif' ? '#f5d08a' : '#e6edf7';
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 1.8, 0, 2 * Math.PI);
      ctx.fill();
      const w = ctx.measureText(f.name).width + 6;
      const left = align === 'center' ? X(x) + ox - w / 2 : align === 'left' ? X(x) + ox - 3 : X(x) + ox - w + 3;
      ctx.fillStyle = 'rgba(8,11,17,0.72)';
      ctx.fillRect(left, Y(y) + oy - 6.5, w, 13);
      ctx.fillStyle = colour;
      ctx.textAlign = align;
      ctx.fillText(f.name, X(x) + ox, Y(y) + oy);
    }
    for (const s of ALL_SITES) {
      const [x, y] = latLonToXY(s.latDeg, s.lonDeg);
      ctx.fillStyle = siteColour(s.id);
      ctx.fillRect(X(x) - 2, Y(y) - 2, 4, 4);
    }
    // Missions north of 80 S: an arrow on the rim in their bearing, never a point to analyse.
    for (const m of REFERENCE_MARKERS) {
      const [x, y] = latLonToXY(m.latDeg, m.lonDeg);
      const d = Math.hypot(x, y), rim = R_MOON_KM * 10 * DEG;
      const ex = X((x / d) * rim), ey = Y((y / d) * rim), a = Math.atan2(-(y / d), x / d);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(1, -4.5); ctx.lineTo(1, 4.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    const tip = hover ? ALL_SITES.find((s) => s.id === hover) ?? REFERENCE_MARKERS.find((m) => m.id === hover) : null;
    if (tip) {
      const out = REFERENCE_MARKERS.some((m) => m.id === tip.id);
      let [x, y] = latLonToXY(tip.latDeg, tip.lonDeg);
      if (out) { const d = Math.hypot(x, y), rim = R_MOON_KM * 10 * DEG; x = (x / d) * rim; y = (y / d) * rim; }
      const label = out ? `${tip.name} · ${t('outside LOLA coverage (80°–90° S)', 'fuera de cobertura LOLA (80°–90° S)')}` : tip.name;
      ctx.font = '10.5px "B612", sans-serif';
      const w = ctx.measureText(label).width + 10;
      const left = Math.min(size - w - 2, Math.max(2, X(x) - w / 2)), top = Y(y) > 30 ? Y(y) - 24 : Y(y) + 10;
      ctx.fillStyle = 'rgba(8,11,17,0.9)';
      ctx.fillRect(left, top, w, 16);
      ctx.fillStyle = out ? '#cbd5e1' : siteColour(tip.id);
      ctx.textAlign = 'left';
      ctx.fillText(label, left + 5, top + 8);
    }
    const [lx, ly] = latLonToXY(latDeg, lonDeg);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(lx), Y(ly), 7, 0, 2 * Math.PI);
    ctx.moveTo(X(lx) - 12, Y(ly)); ctx.lineTo(X(lx) + 12, Y(ly));
    ctx.moveTo(X(lx), Y(ly) - 12); ctx.lineTo(X(lx), Y(ly) + 12);
    ctx.stroke();
  }, [relief, size, latDeg, lonDeg, t, hover]);

  /** Catalogue site (or out-of-coverage marker) under the pointer, within 7 px. */
  const nearest = (clientX: number, clientY: number): string | null => {
    const c = ref.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const k = size / r.width;
    const mx = (clientX - r.left) * k, my = (clientY - r.top) * k;
    const toPx = (x: number, y: number): [number, number] => [size / 2 + (x / (2 * HALF_KM)) * size, size / 2 - (y / (2 * HALF_KM)) * size];
    let best: string | null = null, bestD = 7;
    for (const s of ALL_SITES) {
      const [px, py] = toPx(...latLonToXY(s.latDeg, s.lonDeg));
      const d = Math.hypot(px - mx, py - my);
      if (d < bestD) { bestD = d; best = s.id; }
    }
    for (const m of REFERENCE_MARKERS) {
      const [x, y] = latLonToXY(m.latDeg, m.lonDeg);
      const dd = Math.hypot(x, y), rim = R_MOON_KM * 10 * DEG;
      const [px, py] = toPx((x / dd) * rim, (y / dd) * rim);
      const d = Math.hypot(px - mx, py - my);
      if (d < bestD + 3) { bestD = d; best = m.id; }
    }
    return best;
  };

  const pick = (clientX: number, clientY: number): void => {
    const c = ref.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width - 0.5) * 2 * HALF_KM, y = (0.5 - (clientY - r.top) / r.height) * 2 * HALF_KM;
    const ll = xyToLatLon(x, y);
    if (ll.latDeg > CUSTOM_LAT_MAX) return;
    onPick(Math.round(ll.latDeg * 10000) / 10000, Math.round(ll.lonDeg * 10000) / 10000);
  };

  return (
    <canvas
      ref={ref} width={size} height={size} className="polar-map" data-testid="polar-map" role="img"
      aria-label={t('Map of the lunar south pole, 80° S to 90° S. Click to place the lander.', 'Mapa del polo sur lunar, 80° S a 90° S. Haz clic para situar el lander.')}
      onClick={(e) => pick(e.clientX, e.clientY)}
      onMouseMove={(e) => { const id = nearest(e.clientX, e.clientY); if (id !== hover) setHover(id); }}
      onMouseLeave={() => setHover(null)}
      data-hover={hover ?? ''}
    />
  );
}
