/** Telemetry strip: instantaneous values of the active scenario at the time cursor. */
import { useMemo } from 'react';
import {
  HOUR_MS, STATE_BELOW_DOD, STATE_DEPLETED, STATE_RF_PHYSICAL, azElAtFraction, earthClearanceDeg, siteFrame, solarDiscFraction,
} from '../../engine';
import { ScenarioData, cursorIndex, useThrottledCursor } from '../../state/mission';
import { cardinal, fmtDateTime, fmtNum, fmtRate, fmtSigned, useT } from '../../lib/format';

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

export function Readout({ data }: { data: ScenarioData }) {
  const t = useT();
  const cursor = useThrottledCursor();
  const v = useInstant(data, cursor);
  if (!v) return <div className="readout" data-testid="readout" />;
  const sunUp = v.sunFrac > 0;
  return (
    <div className="readout mono" data-testid="readout">
      <div className="ro-cell ro-time">
        <label>UTC</label>
        <output>{fmtDateTime(v.timeMs)}</output>
      </div>
      <div className={`ro-cell ${sunUp ? 'is-sun' : 'is-crit'}`}>
        <label>{t('Sun az / el', 'Sol az / el')}</label>
        <output>{fmtNum(v.sunAz, 1)}° {cardinal(v.sunAz)} / {fmtSigned(v.sunEl, 2)}°</output>
      </div>
      <div className={`ro-cell ${sunUp ? 'is-sun' : 'is-crit'}`}>
        <label>{t('Solar disc', 'Disco solar')}</label>
        <output>{sunUp ? `${fmtNum(v.sunFrac * 100, 0)} %` : t('occulted', 'ocultado')}</output>
      </div>
      <div className={`ro-cell ${v.powerW > 0 ? 'is-sun' : ''}`}>
        <label>{t('Array power', 'Potencia paneles')}</label>
        <output>{fmtNum(v.powerW, 0)} W</output>
      </div>
      <div className={`ro-cell ${v.depleted ? 'is-crit' : v.belowDod ? 'is-warn' : ''}`}>
        <label>{t('Battery', 'Batería')}</label>
        <output>{v.depleted ? t('lost', 'perdido') : `${fmtNum(v.socPct, 0)} %`}</output>
      </div>
      {v.busC !== null && (
        <div className={`ro-cell ${v.busC <= -20 ? 'is-crit' : v.busC < 0 ? 'is-warn' : ''}`}>
          <label>{t('Bus temp / heater', 'Temp. bus / calefactor')}</label>
          <output>{fmtSigned(v.busC, 1)} °C / {fmtNum(v.heaterW, 0)} W</output>
        </div>
      )}
      <div className={`ro-cell ${v.clear > 0 ? 'is-rf' : 'is-crit'}`}>
        <label>{t('Earth az / el', 'Tierra az / el')}</label>
        <output>{fmtNum(v.earthAz, 1)}° {cardinal(v.earthAz)} / {fmtSigned(v.earthEl, 2)}°</output>
      </div>
      <div className={`ro-cell ${v.clear > 0 ? 'is-rf' : 'is-crit'}`}>
        <label>{t('LOS clearance', 'Despeje LOS')}</label>
        <output>{fmtSigned(v.clear, 2)}°</output>
      </div>
      <div className={`ro-cell ${v.station ? 'is-rf' : 'is-crit'}`}>
        <label>{t('Ground station', 'Estación terrena')}</label>
        <output>{v.station ?? t('none in view', 'ninguna a la vista')}</output>
      </div>
      <div className={`ro-cell ${v.linkUp ? 'is-rf' : 'is-crit'}`}>
        <label>{t('Excess loss / margin', 'Pérdida extra / margen')}</label>
        <output>{v.excessLossDb === null ? '—' : `${fmtNum(v.excessLossDb, 1)} dB`} / {v.marginDb === null ? '—' : `${fmtSigned(v.marginDb, 1)} dB`}</output>
      </div>
      <div className={`ro-cell ${v.linkUp ? 'is-rf' : 'is-crit'}`}>
        <label>{t('Downlink', 'Descarga')}</label>
        <output>{v.linkUp ? fmtRate(v.rateMbps) : t('no link', 'sin enlace')}</output>
      </div>
    </div>
  );
}
