/**
 * Polar map of the whole 80-90 S cap: shaded relief from the regional LOLA
 * grid, latitude rings, named landforms and the lander. A click anywhere
 * inside 80 S puts the lander there.
 */
import { useEffect, useMemo, useRef } from 'react';
import { ALL_SITES, CUSTOM_LAT_MAX, DEG, NAMED_LANDFORMS, R_MOON_KM, latLonToXY, sampleGrid, xyToLatLon } from '../engine';
import { getRegional } from '../state/dem';
import { useT } from '../lib/format';

/** Half-width of the map, km: 80 S is 303 km from the pole. */
const HALF_KM = 318;
/** Label offset from its landform (px) and alignment, chosen so the names around the pole do not collide. */
const LABELS: Record<string, [number, number, CanvasTextAlign]> = {
  Shackleton: [0, 11, 'center'], 'de Gerlache': [-6, 3, 'right'], Haworth: [-6, -3, 'right'], Shoemaker: [6, -5, 'left'], Faustini: [6, 7, 'left'],
  Nobile: [6, 0, 'left'], Amundsen: [6, 0, 'left'], Cabeus: [-6, 0, 'right'], 'Malapert Massif': [0, -10, 'center'], 'Mons Mouton': [6, -3, 'left'],
};

function shadedRelief(px: number): ImageData | null {
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
      ctx.fillStyle = '#10B981';
      ctx.fillRect(X(x) - 2, Y(y) - 2, 4, 4);
    }
    const [lx, ly] = latLonToXY(latDeg, lonDeg);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(lx), Y(ly), 7, 0, 2 * Math.PI);
    ctx.moveTo(X(lx) - 12, Y(ly)); ctx.lineTo(X(lx) + 12, Y(ly));
    ctx.moveTo(X(lx), Y(ly) - 12); ctx.lineTo(X(lx), Y(ly) + 12);
    ctx.stroke();
  }, [relief, size, latDeg, lonDeg, t]);

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
    />
  );
}
