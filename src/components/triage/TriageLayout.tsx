/**
 * Emergency triage: the lander came down somewhere unplanned. Three answers,
 * in order, with no menus: where are we and how well do we know the ground,
 * how long do we have, and where should we go.
 */
import { useState } from 'react';
import { CUSTOM_LAT_MAX, RELOCATION_LIMIT_M, attitudeOnSlope, clamp, terrainGradient } from '../../engine';
import { SceneView } from '../3d/SceneView';
import { PolarMap } from '../PolarMap';
import { VerdictCard } from '../VerdictCard';
import { VitalCards } from '../VitalCards';
import { Timeline } from '../dashboard/Timeline';
import { retryTerrainStream } from '../../state/dem';
import { useDispersion } from '../../state/insights';
import { ScenarioData, useMission } from '../../state/mission';
import { scenarioLatLon, useApp } from '../../state/store';
import { useMicroHazard } from '../../state/verdict';
import { cardinal, fmtDuration, fmtEnergy, fmtLat, fmtLon, fmtNum, fmtSigned, fromDateInput, toDateInput, useT } from '../../lib/format';

type T = (en: string, es: string) => string;

/** One line that says where the terrain under the lander comes from. */
export function terrainStatusText(data: ScenarioData, t: T): { text: string; tone: 'ok' | 'warn' | 'busy' } {
  const res = data.terrainResolutionM;
  switch (data.stream) {
    case 'static': return { text: t('LOLA 20 m/px, pre-loaded: landing precision active', 'LOLA 20 m/px, precargado: precisión de aterrizaje activa'), tone: 'ok' };
    case 'ready': return { text: t(`READY: LOLA 20 m/px read live${data.streamCoveragePct !== null && data.streamCoveragePct < 99.5 ? ` (${fmtNum(data.streamCoveragePct, 0)} % of the patch)` : ''}. Landing precision active`, `LISTO: LOLA 20 m/px leído en vivo${data.streamCoveragePct !== null && data.streamCoveragePct < 99.5 ? ` (${fmtNum(data.streamCoveragePct, 0)} % del parche)` : ''}. Precisión de aterrizaje activa`), tone: 'ok' };
    case 'cached': return { text: t('READY: LOLA 20 m/px from the offline store. Landing precision active', 'LISTO: LOLA 20 m/px desde el almacén sin conexión. Precisión de aterrizaje activa'), tone: 'ok' };
    case 'loading': return { text: t(`Loading tactical relief LOLA 20 m/px… showing ${res ?? 160} m/px meanwhile`, `Cargando relieve táctico LOLA 20 m/px… se muestra ${res ?? 160} m/px mientras tanto`), tone: 'busy' };
    case 'unavailable': return { text: t(`20 m source unreachable: working at ${res ?? 160} m/px. Slopes and escape vectors are indicative only`, `Fuente de 20 m inaccesible: se trabaja a ${res ?? 160} m/px. Pendientes y vectores de escape son solo indicativos`), tone: 'warn' };
    case 'outside': return { text: t(`Outside the 20 m mosaic: working at ${res ?? 800} m/px`, `Fuera del mosaico de 20 m: se trabaja a ${res ?? 800} m/px`), tone: 'warn' };
    default: return { text: res ? `LOLA ${res} m/px` : t('Loading the terrain…', 'Cargando el terreno…'), tone: res && res <= 32 ? 'ok' : 'busy' };
  }
}


function parseCoords(text: string): { latDeg: number; lonDeg: number } | null {
  const m = text.match(/-?\d+(?:[.,]\d+)?/g);
  if (!m || m.length < 2) return null;
  let lat = Number(m[0].replace(',', '.')), lon = Number(m[1].replace(',', '.'));
  if (/s/i.test(text) && lat > 0) lat = -lat;
  if (/[wo]\b/i.test(text) && lon > 0) lon = -lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > CUSTOM_LAT_MAX || Math.abs(lon) > 360) return null;
  return { latDeg: lat, lonDeg: ((lon + 540) % 360) - 180 };
}

export function TriageLayout() {
  const t = useT();
  const mission = useMission();
  const data = mission.A;
  const cfg = useApp((s) => s.scenarios.A);
  const updateScenario = useApp((s) => s.updateScenario);
  const setRelocation = useApp((s) => s.setRelocation);
  const setAttitude = useApp((s) => s.setAttitude);
  const setCursor = useApp((s) => s.setCursor);
  const setPlaying = useApp((s) => s.setPlaying);
  const micro = useApp((s) => s.microRelief);
  const setMicro = useApp((s) => s.setMicroRelief);
  const hazard = useMicroHazard(data);
  const { result: grid, progress } = useDispersion(data, true);
  const [coords, setCoords] = useState('');
  const [coordError, setCoordError] = useState(false);
  const nominal = scenarioLatLon(cfg);
  const r = data.result;
  const status = terrainStatusText(data, t);

  const dropAt = (latDeg: number, lonDeg: number): void => {
    setPlaying(false);
    updateScenario('A', { siteId: 'custom', customLat: latDeg, customLon: lonDeg, dxM: 0, dyM: 0 });
    setCursor(0);
  };
  const submitCoords = (): void => {
    const p = parseCoords(coords);
    setCoordError(!p);
    if (p) dropAt(p.latDeg, p.lonDeg);
  };
  const restOnSlope = (): void => {
    if (!r || !data.dem) return;
    const g = terrainGradient(data.dem, r.observer.x, r.observer.y, r.observer.lonDeg);
    const rest = attitudeOnSlope(g.east, g.north);
    setAttitude({ rollDeg: Math.round(rest.rollDeg * 10) / 10, pitchDeg: Math.round(rest.pitchDeg * 10) / 10, yawDeg: 0 });
  };
  const escape = grid?.escape ?? null;
  const goEscape = (): void => {
    if (!grid) return;
    setRelocation('A', clamp(cfg.dxM + grid.best.eastM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M), clamp(cfg.dyM + grid.best.northM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M));
  };

  return (
    <main className="triage" data-testid="triage">
      <aside className="tri-side tri-left">
        <header className="tri-head"><h2>{t('Where did it come down?', '¿Dónde cayó?')}</h2></header>
        <p className="kpi-note pad0">{t('Click anywhere inside the 80° S circle, or paste the coordinates.', 'Haz clic en cualquier punto dentro del círculo de 80° S, o pega las coordenadas.')}</p>
        <PolarMap latDeg={nominal.latDeg} lonDeg={nominal.lonDeg} onPick={dropAt} />
        <form className="tri-coords" onSubmit={(e) => { e.preventDefault(); submitCoords(); }}>
          <input
            type="text" className={`mono${coordError ? ' is-bad' : ''}`} value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="-84.79, 29.20"
            aria-label={t('Latitude and longitude in degrees', 'Latitud y longitud en grados')} data-testid="tri-coords"
          />
          <button type="submit" className="btn btn-small" data-testid="tri-go">{t('Go', 'Ir')}</button>
        </form>
        {coordError && <p className="kpi-note pad0 is-crit">{t('Use latitude between −90 and −80 and longitude in degrees, e.g. −84.79, 29.20', 'Usa latitud entre −90 y −80 y longitud en grados, p. ej. −84,79; 29,20')}</p>}
        <label className="field">
          <span className="field-label">{t('Time of the emergency (UTC)', 'Hora de la emergencia (UTC)')}</span>
          <input type="date" className="mono" value={toDateInput(cfg.startMs)} onChange={(e) => { const ms = fromDateInput(e.target.value); if (ms !== null) { updateScenario('A', { startMs: ms }); setCursor(0); } }} data-testid="tri-date" />
        </label>
      </aside>

      <div className="tri-stage">
        <VerdictCard data={data} />
        <SceneView />
        <div className="tri-time"><Timeline scenarios={[data]} simple /></div>
      </div>

      <aside className="tri-side tri-right">
        <section className="tri-step" data-testid="tri-step-1">
          <h3><b>1</b>{t('Where are we, and how well do we know the ground?', '¿Dónde estamos y qué tan bien conocemos el suelo?')}</h3>
          {r ? (
            <>
              <p className="tri-big mono">{fmtLat(r.observer.latDeg)} {fmtLon(r.observer.lonDeg)}</p>
              <p className="tri-line mono">{fmtSigned(r.kpis.groundElevationM, 0)} m · {t('slope', 'pendiente')} <span className={r.kpis.slopeDeg > 15 ? 'is-crit' : r.kpis.slopeDeg > 10 ? 'is-warn' : ''}>{fmtNum(r.kpis.slopeDeg, 1)}°</span> · {t('tilt', 'inclinación')} {fmtNum(r.adv.kpis.tiltDeg, 1)}°</p>
            </>
          ) : <p className="tri-line">{t('Reading the terrain…', 'Leyendo el terreno…')}</p>}
          <p className={`tri-status is-${status.tone}`} data-testid="tri-terrain" data-stream={data.stream ?? ''}>{status.text}</p>
          <div className="tour-actions">
            <button type="button" className="btn btn-small" onClick={restOnSlope} disabled={!r} data-testid="tri-slope">{t('We came to rest on the slope', 'Quedamos apoyados en la pendiente')}</button>
            {data.stream === 'unavailable' && <button type="button" className="btn btn-small" onClick={() => retryTerrainStream(nominal.latDeg, nominal.lonDeg)}>{t('Retry 20 m', 'Reintentar 20 m')}</button>}
          </div>
          <label className="check">
            <input type="checkbox" checked={micro} onChange={(e) => setMicro(e.target.checked)} data-testid="micro-toggle" />
            <span>{t('Sub-pixel terrain (LOLA + fractal micro-relief)', 'Terreno sub-píxel (LOLA + micro-relieve fractal)')}</span>
          </label>
          {hazard && (
            <div className="stat-grid" data-testid="micro-hazard">
              <div className={`stat${hazard.index > 0.4 ? ' is-crit' : hazard.index > 0.2 ? ' is-warn' : ' is-ok'}`}><span>{t('Micro-shadow and rock hazard', 'Peligro de micro-sombra y roca')}</span><output className="mono">{fmtNum(100 * hazard.index, 0)} %</output></div>
              <div className="stat"><span>{t('Hidden shadow traps', 'Trampas de sombra ocultas')}</span><output className="mono">{fmtNum(100 * hazard.shadowTrap, 0)} %</output></div>
              <div className="stat"><span>{t('Footprint slope over 15°', 'Pendiente bajo las patas > 15°')}</span><output className="mono">{fmtNum(100 * hazard.slopeTrap, 0)} %</output></div>
              <div className="stat"><span>{t('Ground inside 3–15 m craters', 'Suelo dentro de cráteres de 3–15 m')}</span><output className="mono">{fmtNum(100 * hazard.craterCover, 0)} %</output></div>
            </div>
          )}
          {micro && <p className="kpi-note pad0">{t('Statistical, not a map: the model places craters and roughness the 20 m terrain cannot contain, with the same result for the same place. It says how likely a hidden trap is, not where it is.', 'Estadístico, no un mapa: el modelo sitúa cráteres y rugosidad que el terreno de 20 m no puede contener, con el mismo resultado para el mismo lugar. Dice qué tan probable es una trampa oculta, no dónde está.')}</p>}
        </section>

        <section className="tri-step" data-testid="tri-step-2">
          <h3><b>2</b>{t('How long do we have?', '¿Cuánto tiempo nos queda?')}</h3>
          <VitalCards data={data} testId="tri-clocks" />
          <p className="kpi-note pad0">{t('Counted from the time on the clock above; move the timeline to look ahead.', 'Contado desde la hora del reloj de arriba; mueve la línea de tiempo para mirar adelante.')}</p>
        </section>

        <section className="tri-step" data-testid="tri-step-3">
          <h3><b>3</b>{t('Where should we go?', '¿Hacia dónde movernos?')}</h3>
          {grid ? (escape ? (
            <div className="escape" data-testid="tri-escape">
              {grid.best.lost && <strong className="is-crit">{t('No point within 200 m saves the lander. The least bad one:', 'Ningún punto a 200 m salva el lander. El menos malo:')}</strong>}
              <output className="mono">{fmtNum(escape.distanceM, 0)} m → {cardinal(escape.azimuthDeg)} ({t('azimuth', 'acimut')} {fmtNum(escape.azimuthDeg, 0)}°)</output>
              <span>
                {escape.gainHours > 0.5
                  ? t(`Moving there adds ${fmtDuration(escape.gainHours)} of life`, `Moverse ahí suma ${fmtDuration(escape.gainHours)} de vida`)
                  : escape.gainLinkPct >= 0.05
                    ? t(`Moving there adds ${fmtNum(escape.gainLinkPct, 1)} points of contact with the Earth`, `Moverse ahí suma ${fmtNum(escape.gainLinkPct, 1)} puntos de contacto con la Tierra`)
                    : t(`Moving there only adds ${fmtEnergy(Math.max(0, grid.best.energyWh - grid.centre.energyWh))} of solar energy`, `Moverse ahí solo suma ${fmtEnergy(Math.max(0, grid.best.energyWh - grid.centre.energyWh))} de energía solar`)}
                {grid.best.lost ? '.' : t(', and the lander survives the window.', ', y el lander sobrevive la ventana.')}
              </span>
              <button type="button" className="btn btn-rescue" onClick={goEscape} data-testid="tri-move">{t('Move the lander there', 'Mover el lander ahí')}</button>
            </div>
          ) : (
            <p className="escape-none" data-testid="tri-escape">{t('This is already the best of the 25 points within 200 m. Stay.', 'Este ya es el mejor de los 25 puntos a 200 m. Quedarse.')}</p>
          )) : (
            <div className="disp-wait">
              <div className="mono">{t('Flying 25 missions around the lander', 'Volando 25 misiones alrededor del lander')} {progress !== null ? `${Math.round(progress * 100)}%` : ''}</div>
              <div className="bar"><i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
            </div>
          )}
          <p className="kpi-note pad0">{t('The green arrow on the terrain shows the same vector.', 'La flecha verde sobre el terreno muestra el mismo vector.')}</p>
        </section>
      </aside>
    </main>
  );
}
