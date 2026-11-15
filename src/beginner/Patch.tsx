/**
 * Mission patch of the training (v3.0): a round embroidered badge in the
 * colours of the GISAT UDEC insignia (orange band, deep blue field), with
 * the mission number and the icon of the console it trains. On a
 * celebration the stitches are drawn in (stroke animation; static with
 * reduced motion).
 */
import { ReactNode } from 'react';

export function Patch({ n, icon, size = 132, stitched = false, locked = false }: { n: number; icon?: ReactNode; size?: number; stitched?: boolean; locked?: boolean }) {
  return (
    <svg className={`patch${stitched ? ' is-stitched' : ''}${locked ? ' is-locked' : ''}`} viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
      <circle cx="60" cy="60" r="57" fill="#E8762B" />
      <circle cx="60" cy="60" r="44" fill="#16336a" />
      <circle className="patch-stitch" cx="60" cy="60" r="51" fill="none" stroke="#fff" strokeWidth="1.6" strokeDasharray="3 3.2" />
      <circle cx="60" cy="60" r="44" fill="none" stroke="#0d1f45" strokeWidth="2" />
      {/* a few stars in the field */}
      {[[38, 36], [82, 40], [44, 84], [86, 78], [60, 28]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={k === 4 ? 1.6 : 1.1} fill="#fff" opacity="0.85" />)}
      <text x="60" y={icon ? 56 : 72} textAnchor="middle" className="patch-n">{n}</text>
      {icon && <g transform="translate(48 62) scale(1.2)" className="patch-icon">{icon}</g>}
      {locked && <path d="M50 58v-6a10 10 0 0 1 20 0v6M46 58h28v20H46z" fill="none" stroke="#fff" strokeWidth="2.4" />}
    </svg>
  );
}
