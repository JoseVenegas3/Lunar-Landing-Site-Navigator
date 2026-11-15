/**
 * Immediate-emergency flow, shared by the Emergency mode and the survival
 * panel of the Terrain console: one component, one purpose.
 *
 * It asks only what matters when the lander is already down: where it is,
 * how much energy is left, and (optionally) how it is tilted. There is no
 * date: the mission is evaluated from now over the next days. It answers
 * first in one plain line (survives / survives if… / does not survive) with
 * the "Way out" block right under it (ExitBlock.tsx), then the time until
 * the bus freezes, and where to move inside the 5 x 5 dispersion grid (best
 * cell and escape vector).
 */
import { ReactNode, useEffect, useState } from 'react';
import {
  CUSTOM_LAT_MAX, DAY_MS, HOUR_MS, RELOCATION_LIMIT_M, attitudeOnSlope, clamp, terrainGradient,
} from '../engine';
import { PolarMap } from './PolarMap';
import { VitalCards } from './VitalCards';
import { NumberField } from './dashboard/ScenarioPanel';
import { DISPERSION_RADIUS_M, useDispersion } from '../state/insights';
import { ScenarioData } from '../state/mission';
import { ScenarioKey, scenarioLatLon, useApp } from '../state/store';
import { ExitBlock, SurvivalHeadline } from './ExitBlock';
import { useExitPlan } from '../state/exitPlan';
import { cardinal, fmtDateTime, fmtDuration, fmtEnergy, fmtLat, fmtLon, fmtNum, fmtSigned, useT } from '../lib/format';

/**
 * Days evaluated from now in an emergency, by default: one lunar night. Half a
 * synodic month is 29.53 / 2 = 14.77 d; it is rounded up to whole days (the
 * window is set in days) so the horizon always contains a full night: 15 d.
 */
export const SYNODIC_MONTH_D = 29.530589;
export const EMERGENCY_HORIZON_DAYS = Math.ceil(SYNODIC_MONTH_D / 2);
/** Shorter horizons offered in the inputs (a quick answer for the next days), and the default. */
export const EMERGENCY_HORIZONS = [3, 7, EMERGENCY_HORIZON_DAYS] as const;
const LAST_START = Date.UTC(2030, 11, 31) - EMERGENCY_HORIZON_DAYS * DAY_MS;

/** The current hour, UTC (clamped to the ephemeris range of the tool). The Beginner training may fix it (`nowOverride`). */
export const nowHourMs = (): number => Math.min(LAST_START, Math.floor((useApp.getState().nowOverride ?? Date.now()) / HOUR_MS) * HOUR_MS);

/** Coordinates pasted as text: "-84.79, 29.20", "84.79 S 29.20 E"… */
export function parseCoords(text: string): { latDeg: number; lonDeg: number } | null {
  const m = text.match(/-?\d+(?:[.,]\d+)?/g);
  if (!m || m.length < 2) return null;
  let lat = Number(m[0].replace(',', '.')), lon = Number(m[1].replace(',', '.'));
  if (/s/i.test(text) && lat > 0) lat = -lat;
  if (/[wo]\b/i.test(text) && lon > 0) lon = -lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > CUSTOM_LAT_MAX || Math.abs(lon) > 360) return null;
  return { latDeg: lat, lonDeg: ((lon + 540) % 360) - 180 };
}

/** Horizon in use: the scenario window when it is one of the offered horizons, else the default lunar night. */
const horizonOf = (days: number): number => ((EMERGENCY_HORIZONS as readonly number[]).includes(days) ? days : EMERGENCY_HORIZON_DAYS);

/** Re-anchor the scenario to now, over the emergency horizon. */
function atNow(k: ScenarioKey, days?: number): void {
  const s = useApp.getState();
  s.setPlaying(false);
  s.updateScenario(k, { startMs: nowHourMs(), days: days ?? horizonOf(s.scenarios[k].days) });
  s.setCursor(0);
}

/** True when the scenario already starts at the current hour. */
const isNow = (startMs: number): boolean => Math.abs(startMs - nowHourMs()) < HOUR_MS;

function Step({ n, title, children, testId }: { n: number; title: string; children: ReactNode; testId: string }) {
  return (
    <section className="tri-step" data-testid={testId}>
      <h3><b>{n}</b>{title}</h3>
      {children}
    </section>
  );
}

/** Inputs: current position, energy left, optional tilt. */
export function EmergencyInputs({ data, compact = false }: { data: ScenarioData; compact?: boolean }) {
  const t = useT();
  const k = data.key;
  const cfg = useApp((s) => s.scenarios[k]);
  const lang = useApp((s) => s.lang);
  const power = useApp((s) => s.power);
  const attitude = useApp((s) => s.attitude);
  const [coords, setCoords] = useState('');
  const [coordError, setCoordError] = useState(false);
  const nominal = scenarioLatLon(cfg, lang);
  const r = data.result;

  const dropAt = (latDeg: number, lonDeg: number): void => {
    useApp.getState().updateScenario(k, { siteId: 'custom', customLat: latDeg, customLon: lonDeg, dxM: 0, dyM: 0 });
    atNow(k);
  };
  const submitCoords = (): void => {
    const p = parseCoords(coords);
    setCoordError(!p);
    if (p) dropAt(p.latDeg, p.lonDeg);
  };
  const energyWh = Math.round(power.batteryCapacityWh * power.initialSoc);
  const setEnergy = (wh: number): void => {
    useApp.getState().setPower({ initialSoc: clamp(wh / Math.max(1, power.batteryCapacityWh), 0, 1) });
    atNow(k);
  };
  const setLoad = (w: number): void => {
    useApp.getState().setPower({ survivalLoadW: w });
    atNow(k);
  };
  const restOnSlope = (): void => {
    if (!r || !data.dem) return;
    const g = terrainGradient(data.dem, r.observer.x, r.observer.y, r.observer.lonDeg);
    const rest = attitudeOnSlope(g.east, g.north);
    useApp.getState().setAttitude({ rollDeg: Math.round(rest.rollDeg * 10) / 10, pitchDeg: Math.round(rest.pitchDeg * 10) / 10, yawDeg: 0 });
  };

  return (
    <div className={`emg-inputs${compact ? ' is-compact' : ''}`} data-testid="emg-inputs">
      <div className="emg-q">
        <h4><b>1</b>{t('Current position', 'Posición actual')}</h4>
        <p className="kpi-note pad0">{t('Click inside the 80° S circle, or paste the coordinates.', 'Haz clic dentro del círculo de 80° S, o pega las coordenadas.')}</p>
        <PolarMap latDeg={nominal.latDeg} lonDeg={nominal.lonDeg} onPick={dropAt} />
        <form className="tri-coords" onSubmit={(e) => { e.preventDefault(); submitCoords(); }}>
          <input
            type="text" className={`mono${coordError ? ' is-bad' : ''}`} value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="-84.79, 29.20"
            aria-label={t('Latitude and longitude in degrees', 'Latitud y longitud en grados')} data-testid="tri-coords"
          />
          <button type="submit" className="btn btn-small" data-testid="tri-go">{t('Go', 'Ir')}</button>
        </form>
        {coordError && <p className="kpi-note pad0 is-crit">{t('Use latitude between −90 and −80 and longitude in degrees, e.g. −84.79, 29.20', 'Usa latitud entre −90 y −80 y longitud en grados, p. ej. −84,79; 29,20')}</p>}
      </div>

      <div className="emg-q">
        <h4><b>2</b>{t('Energy available', 'Energía disponible')}</h4>
        <div className="field-row">
          <NumberField label={t(`Left in the battery (of ${fmtNum(power.batteryCapacityWh, 0)} Wh)`, `Restante en batería (de ${fmtNum(power.batteryCapacityWh, 0)} Wh)`)} unit="Wh" value={energyWh} min={0} max={power.batteryCapacityWh} step={50} onChange={setEnergy} testId="emg-energy" />
          <NumberField label={t('Minimum survival load', 'Carga mínima de supervivencia')} unit="W" value={power.survivalLoadW} min={0} max={2000} step={1} onChange={setLoad} testId="emg-load" />
        </div>
      </div>

      <details className="emg-q emg-tilt">
        <summary>{t('Current tilt (optional)', 'Inclinación actual (opcional)')}</summary>
        <div className="field-row">
          <NumberField label={t('Roll', 'Alabeo')} unit="°" value={attitude.rollDeg} min={-90} max={90} step={0.5} onChange={(v) => useApp.getState().setAttitude({ rollDeg: v })} testId="emg-roll" />
          <NumberField label={t('Pitch', 'Cabeceo')} unit="°" value={attitude.pitchDeg} min={-90} max={90} step={0.5} onChange={(v) => useApp.getState().setAttitude({ pitchDeg: v })} testId="emg-pitch" />
        </div>
        <button type="button" className="btn btn-small" onClick={restOnSlope} disabled={!r} data-testid="tri-slope">{t('We came to rest on the slope', 'Quedamos apoyados en la pendiente')}</button>
      </details>

      <label className="field emg-horizon">
        <span className="field-label">{t('Horizon', 'Horizonte')}</span>
        <select value={horizonOf(cfg.days)} onChange={(e) => atNow(k, Number(e.target.value))} data-testid="emg-horizon">
          {EMERGENCY_HORIZONS.map((d) => (
            <option key={d} value={d}>{d === EMERGENCY_HORIZON_DAYS ? t(`next ${d} d (one lunar night)`, `próximos ${d} d (una noche lunar)`) : t(`next ${d} d`, `próximos ${d} d`)}</option>
          ))}
        </select>
      </label>
      <p className="emg-now mono" data-testid="emg-now">
        {isNow(cfg.startMs)
          ? t(`From now, ${fmtDateTime(cfg.startMs)} UTC, over the next ${cfg.days} d`, `Desde ahora, ${fmtDateTime(cfg.startMs)} UTC, durante los próximos ${cfg.days} d`)
          : (
            <button type="button" className="btn btn-small btn-primary" onClick={() => atNow(k)} data-testid="emg-evaluate">
              {t('Evaluate from now', 'Evaluar desde ahora')}
            </button>
          )}
      </p>
    </div>
  );
}

/** Answers: verdict, time to freeze, where to move. */
export function EmergencyResult({ data, clocksTestId = 'emg-clocks', extra }: { data: ScenarioData; clocksTestId?: string; extra?: ReactNode }) {
  const t = useT();
  const k = data.key;
  const cfg = useApp((s) => s.scenarios[k]);
  const plan = useExitPlan(data);
  const { result: grid, progress } = useDispersion(data, true);
  const r = data.result;
  const escape = grid?.escape ?? null;
  const moveTo = (eastM: number, northM: number): void => {
    useApp.getState().setRelocation(k, clamp(cfg.dxM + eastM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M), clamp(cfg.dyM + northM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M));
  };

  return (
    <div className="emg-result" data-testid="emg-result">
      <Step n={1} title={t('Where are we?', '¿Dónde estamos?')} testId="tri-step-1">
        {r ? (
          <>
            <p className="tri-big mono">{fmtLat(r.observer.latDeg)} {fmtLon(r.observer.lonDeg)}</p>
            <p className="tri-line mono">{fmtSigned(r.kpis.groundElevationM, 0)} m · {t('slope', 'pendiente')} <span className={r.kpis.slopeDeg > 15 ? 'is-crit' : r.kpis.slopeDeg > 10 ? 'is-warn' : ''}>{fmtNum(r.kpis.slopeDeg, 1)}°</span> · {t('tilt', 'inclinación')} {fmtNum(r.adv.kpis.tiltDeg, 1)}°</p>
          </>
        ) : <p className="tri-line">{t('Reading the terrain…', 'Leyendo el terreno…')}</p>}
        {plan ? (
          <>
            <SurvivalHeadline plan={plan} />
            <ExitBlock plan={plan} onMove={moveTo} />
          </>
        ) : (
          <section className="exit-block is-busy" aria-label={t('Way out', 'Salida')} data-testid="exit-block" data-state="pending">
            <h4 role="status">{t('Way out', 'Salida')}: <b data-testid="exit-answer">{t('waiting for the terrain…', 'esperando el terreno…')}</b></h4>
          </section>
        )}
        {extra}
      </Step>

      <Step n={2} title={t('How long do we have?', '¿Cuánto tiempo nos queda?')} testId="tri-step-2">
        <VitalCards data={data} testId={clocksTestId} />
      </Step>

      <Step n={3} title={t('Where can we go?', '¿Hacia dónde podemos ir?')} testId="tri-step-3">
        {grid ? (
          <>
            <div className="disp-wrap emg-grid">
              <div className="disp-grid" role="grid" aria-label={t('Touchdown points within 200 m, north up', 'Puntos de contacto a 200 m, norte arriba')} data-testid="dispersion-grid">
                {Array.from({ length: grid.size }, (_, row) => grid.size - 1 - row).map((j) => (
                  <div key={j} role="row" className="disp-row">
                    {Array.from({ length: grid.size }, (_, i) => {
                      const c = grid.cells[j * grid.size + i];
                      const isBest = c === grid.best, isCentre = c === grid.centre;
                      return (
                        <button
                          key={i} type="button" role="gridcell" className={`disp-cell${isBest ? ' is-best' : ''}${isCentre ? ' is-centre' : ''}`}
                          style={{ background: c.lost ? `rgba(239,68,68,${0.25 + 0.55 * (1 - c.merit)})` : `rgba(16,185,129,${0.2 + 0.65 * c.merit})` }}
                          onClick={() => moveTo(c.eastM, c.northM)}
                          title={`E ${c.eastM > 0 ? '+' : ''}${c.eastM} m, N ${c.northM > 0 ? '+' : ''}${c.northM} m · ${fmtDuration(c.survivalHours)} · ${fmtNum(c.linkPct, 0)} %`}
                        >
                          <span className="mono">{c.lost ? fmtDuration(c.survivalHours) : `${fmtNum(c.linkPct, 0)}%`}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <svg className="disp-arrow" viewBox="-110 -110 220 220" aria-hidden="true">
                {escape && (
                  <g transform={`rotate(${escape.azimuthDeg})`}>
                    <line x1="0" y1="0" x2="0" y2={-(escape.distanceM / DISPERSION_RADIUS_M) * 78} stroke="#E6EDF7" strokeWidth="2.5" />
                    <path d={`M0 ${-(escape.distanceM / DISPERSION_RADIUS_M) * 78 - 9} l-6 11 h12 z`} fill="#E6EDF7" />
                  </g>
                )}
              </svg>
              <span className="disp-north mono">N</span>
            </div>
            <p className="disp-legend mono">{t('green: survives (link %) · red: does not survive (time alive)', 'verde: sobrevive (% de enlace) · rojo: no sobrevive (tiempo con vida)')}</p>
            {escape ? (
              <div className="escape" data-testid="tri-escape">
                {grid.best.lost && <strong className="is-crit">{t('No point within 200 m saves the lander. The one that lasts longest:', 'Ningún punto a 200 m salva el lander. El que más aguanta:')}</strong>}
                <output className="mono" data-testid="escape-vector">{fmtNum(escape.distanceM, 0)} m → {cardinal(escape.azimuthDeg)} ({t('azimuth', 'acimut')} {fmtNum(escape.azimuthDeg, 0)}°)</output>
                <span>
                  {escape.gainHours > 0.5
                    ? t(`Moving there adds ${fmtDuration(escape.gainHours)} of life`, `Moverse ahí suma ${fmtDuration(escape.gainHours)} de vida`)
                    : escape.gainLinkPct >= 0.05
                      ? t(`Moving there adds ${fmtNum(escape.gainLinkPct, 1)} points of contact with the Earth`, `Moverse ahí suma ${fmtNum(escape.gainLinkPct, 1)} puntos de contacto con la Tierra`)
                      : t(`Moving there only adds ${fmtEnergy(Math.max(0, grid.best.energyWh - grid.centre.energyWh))} of solar energy`, `Moverse ahí solo suma ${fmtEnergy(Math.max(0, grid.best.energyWh - grid.centre.energyWh))} de energía solar`)}
                  {grid.best.lost ? '.' : t(', and the lander survives the period.', ', y el lander sobrevive el período.')}
                </span>
                <button type="button" className="btn btn-rescue" onClick={() => moveTo(grid.best.eastM, grid.best.northM)} data-testid="tri-move">{t('Move the lander there', 'Mover el lander ahí')}</button>
              </div>
            ) : (
              <p className="escape-none" data-testid="tri-escape">{t('This is already the best of the 25 points within 200 m. Stay.', 'Este ya es el mejor de los 25 puntos a 200 m. Quedarse.')}</p>
            )}
          </>
        ) : (
          <div className="disp-wait">
            <div className="mono">{t('Flying 25 missions around the lander', 'Volando 25 misiones alrededor del lander')} {progress !== null ? `${Math.round(progress * 100)}%` : ''}</div>
            <div className="bar"><i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
          </div>
        )}
        <p className="kpi-note pad0">{t('Each cell is a full mission from that touchdown point. The green arrow on the terrain shows the same vector.', 'Cada celda es una misión completa desde ese punto de contacto. La flecha verde sobre el terreno muestra el mismo vector.')}</p>
      </Step>
    </div>
  );
}

/** Both halves stacked, for the survival tab of the Terrain console. */
export function EmergencyFlow({ data }: { data: ScenarioData }) {
  return (
    <div className="emg-flow" data-testid="emergency-flow">
      <EmergencyInputs data={data} compact />
      <EmergencyResult data={data} />
    </div>
  );
}

/** In the Emergency mode the evaluation always starts from now. */
export function useEmergencyNow(k: ScenarioKey): void {
  useEffect(() => {
    if (!isNow(useApp.getState().scenarios[k].startMs)) atNow(k);
  }, [k]);
}
