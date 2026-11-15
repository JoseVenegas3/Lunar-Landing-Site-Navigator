/** Telemetry strip: instantaneous values of the active scenario at the time cursor. */
import { useMemo } from 'react';
import {
  HOUR_MS, STATE_BELOW_DOD, STATE_DEPLETED, STATE_RF_PHYSICAL, azElAtFraction, earthClearanceDeg, siteFrame, solarDiscFraction,
} from '../../engine';
import { ScenarioData, cursorIndex, useThrottledCursor } from '../../state/mission';
import { cardinal, fmtNum, fmtRate, fmtSigned, useT } from '../../lib/format';
import { useUnits } from '../../lib/units';
import { Tone, batteryTone, busTone, marginTone, sunTone } from '../../lib/telemetry';

export interface Instant {
  timeMs: number;
  sunAz: number; sunEl: number; sunFrac: number;
  earthAz: number; earthEl: number; clear: number; rangeKm: number;
  powerW: number; socPct: number; rateMbps: number;
  depleted: boolean; belowDod: boolean;
  /** Bus temperature, degC, when the thermal model is on. */
  busC: number | null;
  heaterW: number;
  /** Ground station tracking the Moon, if any. */
  station: string | null;
  /** Eb/N0 margin of the physical link, dB, or null when there is no signal. */
  marginDb: number | null;
  /** Excess loss (diffraction + multipath + depointing), dB. */
  excessLossDb: number | null;
  linkUp: boolean;
}

/** Engine values at the cursor (ephemeris interpolated, hourly series from the nearest sample). */
export function useInstant(data: ScenarioData, cursorHours: number): Instant | null {
  const r = data.result;
  const frame = useMemo(() => (r ? siteFrame(r.observer.latDeg, r.observer.lonDeg, r.observer.heightKm) : null), [r]);
  if (!r || !frame) return null;
  const idx = cursorIndex(r, cursorHours);
  const i = Math.round(idx);
  const sun = azElAtFraction(r.eph, idx, frame, 'sun');
  const earth = azElAtFraction(r.eph, idx, frame, 'earth');
  const sunFrac = solarDiscFraction(r.horizon, sun.azDeg, sun.elDeg, r.sunRadiusDeg);
  const clear = earthClearanceDeg(r.horizon, earth.azDeg, earth.elDeg, r.input.rf.elevationMarginDeg);
  const th = r.adv.thermal;
  const st = r.adv.contact.station[i];
  const diff = r.adv.diffractionDb[i];
  return {
    timeMs: r.eph.startMs + idx * r.stepHours * HOUR_MS,
    sunAz: sun.azDeg, sunEl: sun.elDeg, sunFrac,
    earthAz: earth.azDeg, earthEl: earth.elDeg, clear, rangeKm: earth.rangeKm,
    powerW: r.powerW[i],
    socPct: (100 * r.battery.socWh[i]) / Math.max(1, r.input.power.batteryCapacityWh),
    rateMbps: r.rateMbps[i],
    depleted: (r.state[i] & STATE_DEPLETED) !== 0,
    belowDod: (r.state[i] & STATE_BELOW_DOD) !== 0,
    busC: th ? th.tBusK[i] - 273.15 : null,
    heaterW: th ? th.heaterW[i] : 0,
    station: st >= 0 ? r.adv.contact.sites[st].name : null,
    marginDb: r.adv.ebN0MarginDb[i] > -99 ? r.adv.ebN0MarginDb[i] : null,
    excessLossDb: diff >= 99 ? null : diff + r.adv.multipathDb[i] + r.adv.pointingLossDb[i],
    linkUp: (r.state[i] & STATE_RF_PHYSICAL) !== 0,
  };
}

type T = (en: string, es: string) => string;

/** One reading: plain label, value with its unit, a one-line explanation on hover and focus. */
function Reading({ label, value, tip, tone, id }: { label: string; value: string; tip: string; tone?: Tone; id: string }) {
  return (
    <div className={`tm-read${tone ? ` is-${tone}` : ''}`} title={tip} tabIndex={0} aria-label={`${label}: ${value}. ${tip}`} data-reading={id}>
      <span className="tm-label">{label}</span>
      <output className="mono">{value}</output>
    </div>
  );
}

const ICON = {
  sun: <path d="M8 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3" />,
  power: <path d="M2 5h8v6H2zM10 7h1.5v2H10M4.5 5v6M7 5v6M13 4.5v7" />,
  thermal: <path d="M6.5 2.5a1.5 1.5 0 0 1 3 0v6.8a3 3 0 1 1-3 0ZM8 6v5" />,
  link: <path d="M3 13 8 8M6.5 4a5.5 5.5 0 0 1 5.5 5.5M6.5 1.5A8 8 0 0 1 14.5 9.5M3 13h3M3 13v-3" />,
};

function Group({ icon, title, children, id }: { icon: keyof typeof ICON; title: string; children: React.ReactNode; id: string }) {
  return (
    <section className={`tm-group tm-${icon}`} data-group={id} aria-label={title}>
      <h4><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{ICON[icon]}</svg>{title}</h4>
      <div className="tm-reads">{children}</div>
    </section>
  );
}

/**
 * Telemetry strip: what the lander would report at the time on the clock, in
 * four groups with plain labels. The engineering console (Science) adds the
 * technical readings: solar and Earth angles, line-of-sight clearance and
 * excess loss.
 */
export function Readout({ data, engineering = false }: { data: ScenarioData; engineering?: boolean }) {
  const t: T = useT();
  const u = useUnits();
  const cursor = useThrottledCursor();
  const v = useInstant(data, cursor);
  if (!v) return <div className="telemetry" data-testid="readout"><p className="kpi-note pad0">{t('Flying the mission…', 'Simulando la misión…')}</p></div>;
  const yes = t('yes', 'sí'), no = t('no', 'no');
  return (
    <div className="telemetry" data-testid="readout">
      <Group icon="sun" id="sun" title={t('Sun', 'Sol')}>
        <Reading id="sun-visible" label={t('Sun visible', 'Sol visible')} value={v.sunFrac > 0 ? `${fmtNum(v.sunFrac * 100, 0)} %` : t('in shadow', 'en sombra')} tone={sunTone(v.sunFrac)}
          tip={t('Share of the solar disc above the terrain: 100 % is full sun, 0 % is shadow.', 'Parte del disco solar sobre el relieve: 100 % es sol pleno, 0 % es sombra.')} />
        <Reading id="sun-height" label={t('Sun height', 'Altura del Sol')} value={`${fmtSigned(v.sunEl, 1)}°`}
          tip={t('Angle of the Sun above the horizontal; at the pole it never climbs more than a few degrees.', 'Ángulo del Sol sobre la horizontal; en el polo nunca sube más de unos grados.')} />
        {engineering && <Reading id="sun-az" label={t('Sun azimuth', 'Acimut solar')} value={`${fmtNum(v.sunAz, 1)}° ${cardinal(v.sunAz)}`} tip={t('Compass direction of the Sun, clockwise from north.', 'Dirección del Sol en la brújula, horaria desde el norte.')} />}
      </Group>
      <Group icon="power" id="energy" title={t('Energy', 'Energía')}>
        <Reading id="array" label={t('Solar panels', 'Paneles solares')} value={`${fmtNum(v.powerW, 0)} W`} tone={v.powerW > 0 ? 'ok' : 'warn'}
          tip={t('Electric power the solar array delivers right now.', 'Potencia eléctrica que entregan los paneles en este momento.')} />
        <Reading id="battery" label={t('Battery', 'Batería')} value={v.depleted ? t('empty', 'agotada') : `${fmtNum(v.socPct, 0)} %`} tone={batteryTone(v.socPct, v.depleted)}
          tip={t('Charge left in the battery; red below the safe discharge limit or when empty.', 'Carga que queda en la batería; en rojo bajo el límite seguro de descarga o vacía.')} />
      </Group>
      {v.busC !== null && (
        <Group icon="thermal" id="thermal" title={t('Thermal', 'Térmico')}>
          <Reading id="bus" label={t('Electronics temperature', 'Temperatura de la electrónica')} value={u.cSigned(v.busC, 1)} tone={busTone(v.busC)}
            tip={t(`Temperature of the lander body: heaters switch on at ${u.c(0)}, the battery freezes at ${u.c(-20)}.`, `Temperatura del cuerpo del módulo: los calefactores se encienden a ${u.c(0)} y la batería se congela a ${u.c(-20)}.`)} />
          <Reading id="heater" label={t('Heaters', 'Calefactores')} value={`${fmtNum(v.heaterW, 0)} W`} tone={v.heaterW > 0 ? 'warn' : undefined}
            tip={t('Power spent keeping the electronics warm.', 'Potencia gastada en mantener tibia la electrónica.')} />
        </Group>
      )}
      <Group icon="link" id="link" title={t('Earth link', 'Enlace con la Tierra')}>
        <Reading id="earth-visible" label={t('Earth above the terrain', 'Tierra sobre el relieve')} value={v.clear > 0 ? yes : no} tone={v.clear > 0 ? 'ok' : 'crit'}
          tip={t('Whether the Earth is above the mountains, as seen from the antenna.', 'Si la Tierra está por encima de las montañas, vista desde la antena.')} />
        <Reading id="station" label={t('Ground station', 'Estación terrena')} value={v.station ?? t('none', 'ninguna')} tone={v.station ? undefined : 'warn'}
          tip={t('Antenna on Earth that has the Moon in view at this time.', 'Antena en la Tierra que tiene la Luna a la vista en este momento.')} />
        <Reading id="margin" label={t('Link margin', 'Margen de enlace')} value={v.marginDb === null ? t('no signal', 'sin señal') : `${fmtSigned(v.marginDb, 1)} dB`} tone={marginTone(v.marginDb)}
          tip={t('Link margin: how much signal is left over the minimum needed.', 'Margen de enlace: cuánto sobra de señal respecto al mínimo.')} />
        <Reading id="rate" label={t('Data rate', 'Tasa de datos')} value={v.linkUp ? fmtRate(v.rateMbps) : t('no link', 'sin enlace')} tone={v.linkUp ? 'ok' : 'crit'}
          tip={t('Science data sent to the Earth per second.', 'Datos científicos enviados a la Tierra por segundo.')} />
        {engineering && <Reading id="clearance" label={t('Line-of-sight clearance', 'Despeje de línea de vista')} value={`${fmtSigned(v.clear, 2)}°`} tip={t('Angle between the Earth and the skyline behind it, minus the antenna margin.', 'Ángulo entre la Tierra y el horizonte detrás, menos el margen de antena.')} />}
        {engineering && <Reading id="excess" label={t('Excess loss', 'Pérdida extra')} value={v.excessLossDb === null ? '—' : `${fmtNum(v.excessLossDb, 1)} dB`} tip={t('Diffraction, multipath and pointing losses added to free space.', 'Pérdidas por difracción, multitrayecto y apuntamiento añadidas al espacio libre.')} />}
        {engineering && <Reading id="earth-angles" label={t('Earth az / el', 'Tierra az / elev')} value={`${fmtNum(v.earthAz, 1)}° / ${fmtSigned(v.earthEl, 2)}°`} tip={t('Direction and height of the Earth in the sky.', 'Dirección y altura de la Tierra en el cielo.')} />}
      </Group>
    </div>
  );
}
