/**
 * Contingency panel: the landing attitude (requirement SyR-P2) and a
 * neighbouring surface asset (SyR-C5.3).
 */
import {
  ASSET_SHAPES, ATTITUDE_PRESETS, AssetKind, BAND_FREQUENCY_HZ, HISTORICAL_LANDINGS, HOUR_MS, HistoricalLanding, attitudeOnSlope, beamwidthDeg,
  criticalVelocityMs, staticStabilityDeg, terrainGradient, tipoverMap, wavelengthM,
} from '../../engine';
import { useMemo } from 'react';
import { useActiveScenario } from '../../state/mission';
import { useApp } from '../../state/store';
import { fmtDuration, fmtNum, useT } from '../../lib/format';

function Slider({ label, value, min, max, step, unit, onChange, testId }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; testId?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}<output className="mono">{value > 0 && min < 0 ? '+' : ''}{fmtNum(value, step < 1 ? 1 : 0)} {unit}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={testId} />
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'crit' | 'warn' | 'ok' }) {
  return (
    <div className={`stat${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <output className="mono">{value}</output>
    </div>
  );
}

export function ContingencyPanel() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const attitude = useApp((s) => s.attitude);
  const setAttitude = useApp((s) => s.setAttitude);
  const asset = useApp((s) => s.asset);
  const setAsset = useApp((s) => s.setAsset);
  const rf = useApp((s) => s.rf);
  const setRf = useApp((s) => s.setRf);
  const data = useActiveScenario();
  const r = data.result;
  const a = r?.adv.kpis;
  const lambda = wavelengthM(BAND_FREQUENCY_HZ[rf.band]);
  const beam = beamwidthDeg(rf.txDishDiameterM, BAND_FREQUENCY_HZ[rf.band]);
  const preset = ATTITUDE_PRESETS.find((p) => p.rollDeg === attitude.rollDeg && p.pitchDeg === attitude.pitchDeg && p.yawDeg === attitude.yawDeg);

  const restOnSlope = (): void => {
    if (!r || !data.dem) return;
    const g = terrainGradient(data.dem, r.observer.x, r.observer.y, r.observer.lonDeg);
    const rest = attitudeOnSlope(g.east, g.north);
    setAttitude({ rollDeg: Math.round(rest.rollDeg * 10) / 10, pitchDeg: Math.round(rest.pitchDeg * 10) / 10, yawDeg: 0 });
  };

  const tipover = useApp((s) => s.tipover);
  const setTipover = useApp((s) => s.setTipover);
  const dxM = useApp((s) => s.scenarios[s.active].dxM);
  const dyM = useApp((s) => s.scenarios[s.active].dyM);
  const tip = useMemo(
    () => (data.dem ? tipoverMap(data.dem, { latDeg: data.latDeg, lonDeg: data.lonDeg, dxM, dyM }, tipover) : null),
    [data.dem, data.latDeg, data.lonDeg, dxM, dyM, tipover],
  );
  const pct = (p: number): string => `${fmtNum(100 * p, p < 0.0995 ? 2 : 1)} %`;
  /** Emerald up to 1 %, crimson from 10 %. */
  const tipColour = (p: number): string => {
    const k = Math.max(0, Math.min(1, (Math.log10(Math.max(p, 1e-4)) + 2) / 1));
    return k < 0.5 ? `rgba(16,185,129,${0.65 - 0.9 * k})` : `rgba(239,68,68,${0.25 + 1.1 * (k - 0.5)})`;
  };

  const co = r?.adv.coexistence ?? null;
  const active = useApp((s) => s.active);
  const siteId = useApp((s) => s.scenarios[s.active].siteId);

  /** Put the active scenario at a real landing: its place, its date, the attitude it ended in. */
  const replay = (h: HistoricalLanding): void => {
    const s = useApp.getState();
    const p = ATTITUDE_PRESETS.find((x) => x.id === h.attitudePreset);
    s.updateScenario(active, { siteId: h.id, startMs: Math.floor(h.touchdownMs / HOUR_MS) * HOUR_MS, days: 10 });
    if (p) s.setAttitude({ rollDeg: p.rollDeg, pitchDeg: p.pitchDeg, yawDeg: p.yawDeg });
    s.setPower({ mount: 'cylindrical' }); // body-mounted cells, as on that class of lander
    s.setThermalOn(true);
    s.setPlaying(false);
    s.setCursor(0);
  };

  return (
    <>
      <section className="panel block" data-testid="attitude-panel">
        <h3>{t('Landing attitude and tip-over', 'Actitud de alunizaje y vuelco')}</h3>
        <div className="preset-list">
          {ATTITUDE_PRESETS.map((p) => (
            <button
              key={p.id} type="button" className={`btn btn-small${preset?.id === p.id ? ' is-on' : ''}`} aria-pressed={preset?.id === p.id}
              onClick={() => setAttitude({ rollDeg: p.rollDeg, pitchDeg: p.pitchDeg, yawDeg: p.yawDeg })} data-testid={`preset-${p.id}`} title={p.note[lang]}
            >
              {p.name[lang]}
            </button>
          ))}
          <button type="button" className="btn btn-small" onClick={restOnSlope} disabled={!r} data-testid="preset-slope">
            {t('Resting on the local slope', 'Apoyado en la pendiente local')}
          </button>
        </div>
        {preset && preset.id !== 'nominal' && <p className="kpi-note pad0">{preset.note[lang]}</p>}

        <Slider label={t('Roll (right side down +)', 'Alabeo (lado derecho abajo +)')} value={attitude.rollDeg} min={-90} max={90} step={1} unit="°" onChange={(v) => setAttitude({ rollDeg: v })} testId="att-roll" />
        <Slider label={t('Pitch (nose up +)', 'Cabeceo (nariz arriba +)')} value={attitude.pitchDeg} min={-90} max={90} step={1} unit="°" onChange={(v) => setAttitude({ pitchDeg: v })} testId="att-pitch" />
        <Slider label={t('Yaw (heading from north)', 'Guiñada (rumbo desde el norte)')} value={attitude.yawDeg} min={0} max={360} step={5} unit="°" onChange={(v) => setAttitude({ yawDeg: v })} testId="att-yaw" />
        <Slider
          label={t('Antenna beamwidth θ3dB', 'Ancho de haz de antena θ3dB')} value={Math.round(beam * 10) / 10} min={2} max={45} step={0.5} unit="°"
          onChange={(v) => setRf({ txDishDiameterM: Math.round(((70 * lambda) / v) * 1000) / 1000 })} testId="att-beam"
        />
        <Slider label={t('Antenna gimbal range', 'Rango del cardán de antena')} value={attitude.gimbalRangeDeg} min={0} max={60} step={1} unit="°" onChange={(v) => setAttitude({ gimbalRangeDeg: v })} testId="gimbal-range" />
        <p className="kpi-note pad0">
          {t(`A ${fmtNum(beam, 1)}° beam needs a ${fmtNum(rf.txDishDiameterM * 100, 0)} cm dish: narrowing the beam raises the gain and the sensitivity to tilt.`, `Un haz de ${fmtNum(beam, 1)}° exige una antena de ${fmtNum(rf.txDishDiameterM * 100, 0)} cm: estrechar el haz sube la ganancia y la sensibilidad a la inclinación.`)}
        </p>

        {a && r && (
          <div className="stat-grid" data-testid="attitude-kpis">
            <Stat label={t('Tilt from vertical', 'Inclinación respecto de la vertical')} value={`${fmtNum(a.tiltDeg, 1)}°`} tone={a.tiltDeg > 20 ? 'crit' : a.tiltDeg > 10 ? 'warn' : undefined} />
            <Stat label={t('Attitude power penalty', 'Penalización de potencia')} value={`${fmtNum(a.attitudePowerPenaltyPct, 1)} %`} tone={a.attitudePowerPenaltyPct > 30 ? 'crit' : a.attitudePowerPenaltyPct > 5 ? 'warn' : 'ok'} />
            <Stat label={t('Attitude RF penalty', 'Penalización de RF')} value={`${fmtNum(a.attitudeRfPenaltyPct, 1)} %`} tone={a.attitudeRfPenaltyPct > 30 ? 'crit' : a.attitudeRfPenaltyPct > 5 ? 'warn' : 'ok'} />
            <Stat label={t('Mean depointing loss', 'Pérdida media por desapuntamiento')} value={`${fmtNum(a.meanPointingLossDb, 1)} dB`} />
            <Stat label={t('Earth hidden by the lander body', 'Tierra oculta por el propio lander')} value={`${fmtNum(a.selfOccludedPct, 0)} %`} tone={a.selfOccludedPct > 0 ? 'crit' : undefined} />
            <Stat label={t('Science data, level vs actual', 'Datos científicos, nivelado vs real')} value={`${fmtNum(a.nominalDataGb, 0)} → ${fmtNum(r.kpis.dataGb, 0)} GB`} />
          </div>
        )}
        {a && a.attitudeRfPenaltyPct > 30 && (
          <p className="alert" role="alert" data-testid="attitude-alert">
            {t('Antenna misaligned: the Earth is outside the gimbal range for most of the window.', 'Antena desalineada: la Tierra queda fuera del rango del cardán la mayor parte de la ventana.')}
          </p>
        )}
      </section>

      <section className="panel block" data-testid="tipover-panel">
        <h3>{t('Probability of tipping over at touchdown', 'Probabilidad de vuelco al contacto')}</h3>
        <p className="kpi-note pad0">
          {t('Energy criterion: the lander tips when its sideways speed at touchdown is enough to lift the centre of mass over the downhill footpads. The slope comes from the terrain model at each point of the landing ellipse.', 'Criterio de energía: el lander vuelca si su velocidad lateral al contacto basta para levantar el centro de masa por sobre las patas cuesta abajo. La pendiente sale del modelo de terreno en cada punto de la elipse de alunizaje.')}
        </p>
        <Slider label={t('Centre of mass above the footpads', 'Centro de masa sobre las patas')} value={tipover.cgHeightM} min={0.5} max={4} step={0.1} unit="m" onChange={(v) => setTipover({ cgHeightM: v })} testId="tip-cg" />
        <Slider label={t('Centre of mass to the tipping line', 'Centro de masa a la línea de vuelco')} value={tipover.tipRadiusM} min={0.5} max={4} step={0.1} unit="m" onChange={(v) => setTipover({ tipRadiusM: v })} />
        <Slider label={t('Sideways touchdown speed (1σ)', 'Velocidad lateral al contacto (1σ)')} value={tipover.sigmaVelMs} min={0} max={2} step={0.1} unit="m/s" onChange={(v) => setTipover({ sigmaVelMs: v })} testId="tip-vel" />
        <Slider label={t('Unresolved slope (1σ)', 'Pendiente no resuelta (1σ)')} value={tipover.sigmaSlopeDeg} min={0} max={10} step={0.5} unit="°" onChange={(v) => setTipover({ sigmaSlopeDeg: v })} />
        {tip && (
          <>
            <div className="stat-grid" data-testid="tipover-kpis">
              <Stat label={t('Tips over at the aim point', 'Vuelca en el punto de mira')} value={pct(tip.centre.p)} tone={tip.centre.p > 0.1 ? 'crit' : tip.centre.p > 0.01 ? 'warn' : 'ok'} />
              <Stat label={t('Mean over the ±200 m ellipse', 'Media en la elipse de ±200 m')} value={pct(tip.meanP)} tone={tip.meanP > 0.1 ? 'crit' : tip.meanP > 0.01 ? 'warn' : 'ok'} />
              <Stat label={t('Worst cell of the ellipse', 'Peor celda de la elipse')} value={`${pct(tip.maxP)} · ${fmtNum(tip.maxSlopeDeg, 1)}°`} tone={tip.maxP > 0.1 ? 'crit' : tip.maxP > 0.01 ? 'warn' : undefined} />
              <Stat label={t('Static stability angle', 'Ángulo de estabilidad estática')} value={`${fmtNum(staticStabilityDeg(tipover), 1)}°`} />
              <Stat label={t('Tipping speed on level ground', 'Velocidad de vuelco en terreno plano')} value={`${fmtNum(criticalVelocityMs(tipover, 0), 2)} m/s`} />
              <Stat label={t('Tipping speed down the local slope', 'Velocidad de vuelco cuesta abajo aquí')} value={`${fmtNum(criticalVelocityMs(tipover, tip.centre.slopeDeg), 2)} m/s · ${fmtNum(tip.centre.slopeDeg, 1)}°`} />
            </div>
            <div className="disp-wrap tip-wrap">
              <div className="disp-grid" role="grid" aria-label={t('Tip-over probability over the ellipse, north up', 'Probabilidad de vuelco en la elipse, norte arriba')} data-testid="tipover-grid">
                {Array.from({ length: tip.size }, (_, row) => tip.size - 1 - row).map((j) => (
                  <div key={j} role="row" className="disp-row">
                    {Array.from({ length: tip.size }, (_, i) => {
                      const c = tip.cells[j * tip.size + i];
                      return (
                        <div key={i} role="gridcell" className={`disp-cell tip-cell${c === tip.centre ? ' is-centre' : ''}`} style={{ background: tipColour(c.p) }} title={`E ${c.eastM > 0 ? '+' : ''}${c.eastM} m, N ${c.northM > 0 ? '+' : ''}${c.northM} m · ${fmtNum(c.slopeDeg, 1)}°`}>
                          <span className="mono">{fmtNum(100 * c.p, c.p < 0.0995 ? 1 : 0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <span className="disp-north mono">N</span>
            </div>
          </>
        )}
        <p className="kpi-note pad0">
          {t('The default vehicle is illustrative, not a real lander. The model assumes the footpads stop dead and all the sideways energy goes into the rotation; it leaves out leg stroke, crushable absorbers, sliding and vertical speed, and it cannot see rocks or craters smaller than the terrain pixel. Read it as a comparison between sites and vehicle shapes, not as a certified probability.', 'El vehículo por defecto es ilustrativo, no un lander real. El modelo supone que las patas se detienen en seco y que toda la energía lateral se va a la rotación; omite la carrera de las patas, los absorbedores, el deslizamiento y la velocidad vertical, y no ve rocas ni cráteres más pequeños que el píxel del terreno. Léelo como comparación entre sitios y formas de vehículo, no como una probabilidad certificada.')}
        </p>
      </section>

      <section className="panel block" data-testid="replay-panel">
        <h3>{t('Replay a real landing', 'Reproducir un alunizaje real')}</h3>
        <p className="alert" data-testid="replay-caveat">
          {t('Validation only. This model does not reproduce the loss of IM-2 Athena: the lander came to rest in a small crater in shadow that the 20 m terrain does not contain, so here the site looks sunlit.', 'Solo para validación. Este modelo no reproduce la pérdida de IM-2 Athena: el lander quedó en un cráter pequeño en sombra que el terreno de 20 m no contiene, así que aquí el sitio aparece soleado.')}
        </p>
        {HISTORICAL_LANDINGS.map((h) => {
          const on = siteId === h.id;
          return (
            <div key={h.id} className="replay">
              <p className="kpi-note pad0">{h.outcome[lang]}</p>
              <button type="button" className={`btn btn-small${on ? ' is-on' : ''}`} onClick={() => replay(h)} data-testid={`replay-${h.id}`}>
                {t(`Replay ${h.name}`, `Reproducir ${h.name}`)}
              </button>
              {on && r && a && (
                <>
                  <div className="stat-grid" data-testid="replay-result">
                    <Stat label={t('What happened: surface operation', 'Lo ocurrido: operación en superficie')} value={`≈ ${fmtNum(h.actualSurfaceHours, 0)} h`} />
                    <Stat
                      label={t('This model: lander lost at', 'Este modelo: el lander se pierde en')}
                      value={r.kpis.survives ? t('survives 10 days', 'sobrevive 10 días') : `T+${fmtDuration(a.survivalHours)}`}
                      tone={r.kpis.survives ? 'warn' : 'crit'}
                    />
                    <Stat label={t('Sunlight at the landing point', 'Luz solar en el punto de alunizaje')} value={`${fmtNum(r.kpis.illuminationPct, 0)} %`} />
                    <Stat label={t('Array output lost to the attitude', 'Potencia perdida por la actitud')} value={`${fmtNum(a.attitudePowerPenaltyPct, 0)} %`} />
                    <Stat label={t('Downlink lost to the attitude', 'Descarga perdida por la actitud')} value={`${fmtNum(a.attitudeRfPenaltyPct, 0)} %`} />
                    <Stat label={t('Sky view factor', 'Factor de vista al cielo')} value={fmtNum(a.skyViewFactor, 2)} />
                  </div>
                  {r.kpis.survives || a.survivalHours > 3 * h.actualSurfaceHours ? (
                    <p className="alert" role="alert" data-testid="replay-verdict">
                      {t(`The model does not reproduce this loss: it keeps the lander alive far longer than the ${fmtNum(h.actualSurfaceHours, 0)} h it lasted. The lander fell into a crater a few tens of metres across, in shadow; the 20 m terrain model does not contain it, so here the site looks sunlit.`, `El modelo no reproduce esta pérdida: mantiene vivo el lander mucho más que las ${fmtNum(h.actualSurfaceHours, 0)} h que duró. El lander cayó en un cráter de pocas decenas de metros, en sombra; el modelo de terreno de 20 m no lo contiene, así que aquí el sitio aparece soleado.`)}
                    </p>
                  ) : (
                    <p className="kpi-note pad0" data-testid="replay-verdict">
                      {t('The model loses the lander within the same order of time as the real mission.', 'El modelo pierde el lander en el mismo orden de tiempo que la misión real.')}
                    </p>
                  )}
                  <p className="kpi-note pad0">
                    {t('A plausibility check, not a reconstruction. The lander here is this app\'s default (4 kWh battery, 180 W load), not the real vehicle; the 20 m terrain cannot resolve the small crater it came to rest in; and the tilt is a preset. Compare orders of magnitude only.', 'Una comprobación de plausibilidad, no una reconstrucción. El lander es el de esta app por defecto (batería de 4 kWh, carga de 180 W), no el vehículo real; el terreno de 20 m no resuelve el pequeño cráter donde quedó; y la inclinación es un preset. Compara solo órdenes de magnitud.')}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </section>

      <section className="panel block" data-testid="asset-panel">
        <h3>{t('Neighbouring surface asset', 'Activo vecino en superficie')}</h3>
        <label className="check">
          <input type="checkbox" checked={asset.enabled} onChange={(e) => setAsset({ enabled: e.target.checked })} data-testid="asset-enable" />
          <span>{t('Place an asset already deployed near the site', 'Situar un activo ya desplegado cerca del sitio')}</span>
        </label>
        {asset.enabled && (
          <>
            <label className="field">
              <span className="field-label">{t('Asset', 'Activo')}</span>
              <select value={asset.kind} onChange={(e) => setAsset({ kind: e.target.value as AssetKind })}>
                {(Object.keys(ASSET_SHAPES) as AssetKind[]).map((k) => <option key={k} value={k}>{ASSET_SHAPES[k].name[lang]}</option>)}
              </select>
            </label>
            <Slider label={t('Distance from the lander', 'Distancia al lander')} value={asset.distanceM} min={20} max={3000} step={10} unit="m" onChange={(v) => setAsset({ distanceM: v })} testId="asset-distance" />
            <Slider label={t('Bearing from north', 'Rumbo desde el norte')} value={asset.azimuthDeg} min={0} max={355} step={5} unit="°" onChange={(v) => setAsset({ azimuthDeg: v })} />
            <Slider label={t('Landing engine thrust', 'Empuje del motor de descenso')} value={asset.thrustKN} min={0.5} max={50} step={0.5} unit="kN" onChange={(v) => setAsset({ thrustKN: v })} />
            {co && (
              <>
                <div className="stat-grid" data-testid="asset-kpis">
                  <Stat label={t('NASA exclusion radius, scaled', 'Radio de exclusión NASA, escalado')} value={`${fmtNum(co.psi.hazardRadiusM, 0)} m`} />
                  <Stat label={t('Ejecta fluence at the asset', 'Fluencia de eyección en el activo')} value={`${fmtNum(co.psi.fluenceRatio, co.psi.fluenceRatio < 10 ? 2 : 0)} × ${t('limit', 'límite')}`} tone={co.psi.violated ? 'crit' : 'ok'} />
                  <Stat label={t('Lander shaded by the asset', 'Lander sombreado por el activo')} value={`${fmtNum(co.landerShadedPct, 2)} %`} tone={co.landerShadedPct > 1 ? 'warn' : undefined} />
                  <Stat label={t('Asset shaded by the lander', 'Activo sombreado por el lander')} value={`${fmtNum(co.assetShadedPct, 2)} %`} tone={co.assetShadedPct > 1 ? 'warn' : undefined} />
                </div>
                {co.psi.violated && (
                  <p className="alert" role="alert" data-testid="psi-alert">
                    {t(`The asset is inside the ${fmtNum(co.psi.hazardRadiusM, 0)} m exclusion radius (NASA heritage-site guideline scaled with thrust).`, `El activo está dentro del radio de exclusión de ${fmtNum(co.psi.hazardRadiusM, 0)} m (guía NASA para sitios patrimoniales, escalada con el empuje).`)}
                  </p>
                )}
                <p className="kpi-note pad0">
                  {t('This is a normative radius, not a physical damage boundary: the 2 km it scales from was chosen to put a lander just beyond the horizon, and ejecta are reported to travel more than 20 km even for small landers. Being outside it does not make an asset safe.', 'Es un radio normativo, no un límite físico de daño: los 2 km de los que se escala se eligieron para dejar el lander justo tras el horizonte, y se reporta eyección a más de 20 km incluso con landers pequeños. Estar fuera no hace seguro a un activo.')}
                </p>
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}
