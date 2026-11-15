/**
 * Mission badges of the Beginner training (v3.1): one per mission, with the
 * icon of the subsystem it trains, in place of stars and points. The rack in
 * the top bar starts as eight faint silhouettes; each badge snaps into its
 * slot with a metallic shine when its mission is completed.
 */
import { ReactNode } from 'react';
import { SUB_ICON } from '../components/dashboard/SubsystemSwitch';

const st = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export interface BadgeDef { name: [string, string]; icon: ReactNode; tone: string }

export const BADGES: BadgeDef[] = [
  { name: ['Lunar initiation', 'Iniciación lunar'], tone: '#c9d4e3', icon: <path d="M13.5 3.5a7 7 0 1 0 3 9.5 5.5 5.5 0 0 1-3-9.5ZM4 17.5h12" {...st} /> },
  { name: ['Navigation and windows', 'Navegación y ventanas'], tone: '#10B981', icon: SUB_ICON.overview },
  { name: ['Geotechnics and landing', 'Geotecnia y aterrizaje'], tone: '#E2E8F0', icon: SUB_ICON.terrain },
  { name: ['Power and thermal', 'Potencia y térmica'], tone: '#F59E0B', icon: SUB_ICON.power },
  { name: ['Telecommunications and RF', 'Telecomunicaciones y RF'], tone: '#06B6D4', icon: SUB_ICON.comms },
  { name: ['Attitude and operational safety', 'Actitud y seguridad operacional'], tone: '#f472b6', icon: <path d="M4 15.5 10 5l6 10.5ZM10 9.5v3M10 14.3v.2M2.5 17.5h15" {...st} transform="rotate(-18 10 11)" /> },
  { name: ['Science and site selection', 'Ciencia y selección lunar'], tone: '#B49CFF', icon: SUB_ICON.science },
  { name: ['Triage and critical rescue', 'Triaje y rescate crítico'], tone: '#ef4444', icon: <path d="M10 3v4M5 5l2 3M15 5l-2 3M4 16h12v-3a6 6 0 0 0-12 0Z" {...st} /> },
];

export function Badge({ i, earned, size = 26, fresh = false }: { i: number; earned: boolean; size?: number; fresh?: boolean }) {
  const b = BADGES[i];
  return (
    <svg className={`badge-ic${earned ? ' is-earned' : ''}${fresh ? ' is-fresh' : ''}`} viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" style={{ color: earned ? b.tone : undefined }}>
      <defs>
        <linearGradient id={`bg-metal-${i}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b4a66" />
          <stop offset="0.5" stopColor="#1a2338" />
          <stop offset="1" stopColor="#0c1220" />
        </linearGradient>
      </defs>
      <path d="M20 1.5 36 10.5v19L20 38.5 4 29.5v-19Z" fill={earned ? `url(#bg-metal-${i})` : 'none'} stroke="currentColor" strokeWidth={earned ? 2 : 1.2} opacity={earned ? 1 : 0.35} />
      <g transform="translate(10 10)" opacity={earned ? 1 : 0.3}>{b.icon}</g>
      {earned && <path className="badge-shine" d="M6 12 34 6v6L6 18Z" fill="#fff" opacity="0" />}
    </svg>
  );
}
