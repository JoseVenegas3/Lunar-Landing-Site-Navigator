/**
 * Survival panel: thermal outcome of the window (SyR-P4) and the 5 x 5 landing
 * dispersion grid with its escape vector (SyR-C5.2).
 */
import { RELOCATION_LIMIT_M, clamp, skylineShiftDeg } from '../../engine';
import { CELL_MEMBERS, DISPERSION_RADIUS_M, useDispersion, useUncertainty } from '../../state/insights';
import { ScenarioData } from '../../state/mission';
import { useApp } from '../../state/store';
import { cardinal, fmtDuration, fmtEnergy, fmtNum, useT } from '../../lib/format';

/** Colour of a dispersion cell: crimson when the lander is lost, emerald when it survives, by merit. */
function cellColour(merit: number, lost: boolean): string {
  if (lost) return `rgba(239,68,68,${0.25 + 0.55 * (1 - merit)})`;
  return `rgba(16,185,129,${0.2 + 0.65 * merit})`;
}

/** Colour of a cell by probability of survival: crimson at 0, emerald at 1. */
function probabilityColour(p: number): string {
  return p >= 0.5 ? `rgba(16,185,129,${0.2 + 0.65 * (p - 0.5) * 2})` : `rgba(239,68,68,${0.25 + 0.55 * (0.5 - p) * 2})`;
}

function Band({ label, q, unit, digits = 0 }: { label: string; q: { p10: number; p50: number; p90: number }; unit: string; digits?: number }) {
  return (
    <div className="band">
      <span>{label}</span>
      <output className="mono">{fmtNum(q.p10, digits)} · <b>{fmtNum(q.p50, digits)}</b> · {fmtNum(q.p90, digits)} {unit}</output>
    </div>
  );
}

export function SurvivalPanel({ data, part = 'all' }: { data: ScenarioData; part?: 'all' | 'thermal' | 'landing' }) {
  const t = useT();
  const unc = useUncertainty(data);
  const cfg = useApp((s) => s.scenarios[data.key]);
  const thermalOn = useApp((s) => s.thermalOn);
  const setRelocation = useApp((s) => s.setRelocation);
  const { result: grid, progress } = useDispersion(data, part !== 'thermal');
  const r = data.result;
  const a = r?.adv.kpis;
  const windowH = r ? (r.count - 1) * r.stepHours : 0;

  const moveTo = (eastM: number, northM: number): void => {
    setRelocation(data.key, clamp(cfg.dxM + eastM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M), clamp(cfg.dyM + northM, -RELOCATION_LIMIT_M, RELOCATION_LIMIT_M));
  };

  return (
    <>
      {part !== 'landing' && <section className="panel block" data-testid="thermal-kpis">
        <h3><span className={`badge badge-${data.key}`}>{data.key}</span>{t('Night survival', 'Supervivencia nocturna')}</h3>
        {r && a ? (
          <>
            {a.thermalDeathH !== null && (
              <p className="alert" role="alert" data-testid="thermal-death">
                {t(`CRITICAL THERMAL DEATH at T+${fmtDuration(a.thermalDeathH)}: bus below −20 °C, battery frozen.`, `MUERTE TÉRMICA CRÍTICA en T+${fmtDuration(a.thermalDeathH)}: bus bajo −20 °C, batería congelada.`)}
              </p>
            )}
            <div className="stat-grid">
              <div className={`stat${r.kpis.survives ? ' is-ok' : ' is-crit'}`}>
                <span>{t('Survives the window', 'Sobrevive la ventana')}</span>
                <output className="mono">{r.kpis.survives ? t('Yes', 'Sí') : `${t('No, lost at', 'No, se pierde en')} T+${fmtDuration(a.survivalHours)}`}</output>
              </div>
              <div className="stat">
                <span>{t('Lowest bus temperature', 'Temperatura mínima del bus')}</span>
                <output className="mono">{a.minBusC === null ? t('thermal model off', 'modelo térmico apagado') : `${fmtNum(a.minBusC, 1)} °C`}</output>
              </div>
              <div className="stat">
                <span>{t('Heaters on', 'Calefactores encendidos')}</span>
                <output className="mono">{fmtDuration(a.heaterHours)} · {fmtEnergy(a.heaterWh)}</output>
              </div>
              <div className="stat">
                <span>{t('Solar energy over the window', 'Energía solar en la ventana')}</span>
                <output className="mono">{fmtEnergy(r.kpis.energyWh)} · {t('peak', 'pico')} {fmtNum(r.kpis.peakPowerW, 0)} W</output>
              </div>
              <div className="stat">
                <span>{t('Lowest battery charge', 'Carga mínima de batería')}</span>
                <output className="mono">{fmtNum(r.kpis.minSocPct, 0)} %</output>
              </div>
              <div className="stat">
                <span>{t('Sky view factor', 'Factor de vista al cielo')}</span>
                <output className="mono">{fmtNum(a.skyViewFactor, 3)}</output>
              </div>
              <div className="stat">
                <span>{t('Surrounding terrain sunlit', 'Terreno circundante con sol')}</span>
                <output className="mono">{a.terrainLitPct === null ? '—' : `${fmtNum(a.terrainLitPct, 0)} %`}</output>
              </div>
            </div>
            {!thermalOn && <p className="kpi-note pad0">{t('The coupled thermal model is switched off (Hardware panel): survival is judged on stored energy alone.', 'El modelo térmico acoplado está apagado (panel Equipo): la supervivencia se juzga solo por energía almacenada.')}</p>}
          </>
        ) : <p className="kpi-note pad0">{t('Waiting for the terrain model.', 'Esperando el modelo de terreno.')}</p>}
      </section>}

      {part !== 'thermal' && <section className="panel block" data-testid="dispersion-panel">
        <h3>{t(`Landing dispersion ±${DISPERSION_RADIUS_M} m`, `Dispersión de alunizaje ±${DISPERSION_RADIUS_M} m`)}</h3>
        <p className="kpi-note pad0">
          {t('Each cell is a full mission run from that touchdown point. Green: the lander survives the window. Red: it is lost. Select a cell to move the lander there.', 'Cada celda es una misión completa desde ese punto de contacto. Verde: el lander sobrevive la ventana. Rojo: se pierde. Elige una celda para mover el lander ahí.')}
        </p>
        {grid ? (
          <>
            <div className="disp-wrap">
              <div className="disp-grid" role="grid" aria-label={t('Dispersion grid, north up', 'Malla de dispersión, norte arriba')} data-testid="dispersion-grid">
                {Array.from({ length: grid.size }, (_, row) => grid.size - 1 - row).map((j) => (
                  <div key={j} role="row" className="disp-row">
                    {Array.from({ length: grid.size }, (_, i) => {
                      const c = grid.cells[j * grid.size + i];
                      const isBest = c === grid.best, isCentre = c === grid.centre;
                      return (
                        <button
                          key={i} type="button" role="gridcell" className={`disp-cell${isBest ? ' is-best' : ''}${isCentre ? ' is-centre' : ''}`}
                          style={{ background: unc.cellSurvival && !unc.stale ? probabilityColour(unc.cellSurvival[j * grid.size + i]) : cellColour(c.merit, c.lost) }}
                          onClick={() => moveTo(c.eastM, c.northM)}
                          title={`E ${c.eastM > 0 ? '+' : ''}${c.eastM} m, N ${c.northM > 0 ? '+' : ''}${c.northM} m · ${fmtDuration(c.survivalHours)} · ${fmtNum(c.linkPct, 0)} % link`}
                        >
                          <span className="mono">
                            {unc.cellSurvival && !unc.stale
                              ? `P ${fmtNum(100 * unc.cellSurvival[j * grid.size + i], 0)}%`
                              : c.lost ? fmtDuration(c.survivalHours) : `${fmtNum(c.linkPct, 0)}%`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <svg className="disp-arrow" viewBox="-110 -110 220 220" aria-hidden="true">
                {grid.escape && (
                  <g transform={`rotate(${grid.escape.azimuthDeg})`}>
                    <line x1="0" y1="0" x2="0" y2={-(grid.escape.distanceM / DISPERSION_RADIUS_M) * 78} stroke="#E6EDF7" strokeWidth="2.500" />
                    <path d={`M0 ${-(grid.escape.distanceM / DISPERSION_RADIUS_M) * 78 - 9} l-6 11 h12 z`} fill="#E6EDF7" />
                  </g>
                )}
              </svg>
              <span className="disp-north mono">N</span>
            </div>
            <p className="disp-legend mono">
              {t('survives: link %', 'sobrevive: % de enlace')} · {t('lost: time alive', 'se pierde: tiempo con vida')} · {fmtNum(grid.survivingPct, 0)} % {t('of cells survive', 'de celdas sobrevive')}
            </p>
            {grid.escape ? (
              <div className="escape" data-testid="escape-vector">
                <strong>{t('Emergency relocation vector', 'Vector de reubicación de emergencia')}</strong>
                <output className="mono">
                  {fmtNum(grid.escape.azimuthDeg, 0)}° {cardinal(grid.escape.azimuthDeg)} · {fmtNum(grid.escape.distanceM, 0)} m
                </output>
                <span>
                  {grid.escape.gainHours > 0.5
                    ? t(`gains ${fmtDuration(grid.escape.gainHours)} of survival`, `gana ${fmtDuration(grid.escape.gainHours)} de supervivencia`)
                    : t(`gains ${fmtNum(grid.escape.gainLinkPct, 1)} points of downlink`, `gana ${fmtNum(grid.escape.gainLinkPct, 1)} puntos de descarga`)}
                  {windowH > 0 && grid.best.survivalHours >= windowH - 1 ? t(', survives the whole window', ', sobrevive toda la ventana') : ''}
                </span>
                <button type="button" className="btn btn-small" onClick={() => moveTo(grid.best.eastM, grid.best.northM)} data-testid="escape-go">
                  {t('Move the lander to the best cell', 'Mover el lander a la mejor celda')}
                </button>
              </div>
            ) : (
              <p className="escape-none" data-testid="escape-vector">{t('The aim point is already the best of the 25 cells: no relocation needed.', 'El punto de mira ya es la mejor de las 25 celdas: no hace falta reubicar.')}</p>
            )}
          </>
        ) : (
          <div className="disp-wait">
            <div className="mono">{t('Running 25 missions', 'Ejecutando 25 misiones')} {progress !== null ? `${Math.round(progress * 100)}%` : ''}</div>
            <div className="bar"><i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
          </div>
        )}
      </section>}

      {part !== 'thermal' && <section className="panel block" data-testid="uncertainty-panel">
        <h3>{t('Terrain uncertainty (LOLA)', 'Incertidumbre del terreno (LOLA)')}</h3>
        <p className="kpi-note pad0">
          {t(`The elevation model has an error of a few decimetres. With the Sun on the skyline that is enough to change the answer: ${fmtNum(unc.config.sigmaM, 1)} m on a rise 50 m away moves the horizon ${fmtNum(skylineShiftDeg(unc.config.sigmaM, 50), 2)}°, and the solar disc is 0.53° wide. Each run re-flies the mission on terrain perturbed within 2 km of the lander.`, `El modelo de elevación tiene un error de pocos decímetros. Con el Sol en el horizonte eso basta para cambiar la respuesta: ${fmtNum(unc.config.sigmaM, 1)} m en una elevación a 50 m mueve el horizonte ${fmtNum(skylineShiftDeg(unc.config.sigmaM, 50), 2)}°, y el disco solar mide 0,53°. Cada corrida repite la misión sobre un terreno perturbado dentro de 2 km del lander.`)}
        </p>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('Height error (RMS)', 'Error de altura (RMS)')}<output className="mono">{fmtNum(unc.config.sigmaM, 1)} m</output></span>
            <input type="range" min={0} max={2} step={0.1} value={unc.config.sigmaM} onChange={(e) => unc.setConfig({ sigmaM: Number(e.target.value) })} data-testid="unc-sigma" />
          </label>
          <label className="field">
            <span className="field-label">{t('Correlation length', 'Longitud de correlación')}<output className="mono">{unc.config.corrLenM} m</output></span>
            <input type="range" min={16} max={200} step={8} value={unc.config.corrLenM} onChange={(e) => unc.setConfig({ corrLenM: Number(e.target.value) })} />
          </label>
        </div>
        <div className="tour-actions">
          <button type="button" className="btn btn-small" onClick={unc.run} disabled={!r || unc.progress !== null} data-testid="unc-run">
            {t(`Run ${unc.config.members} terrain variants`, `Ejecutar ${unc.config.members} variantes de terreno`)}
          </button>
          <button type="button" className="btn btn-small" onClick={unc.runCells} disabled={!r || unc.progress !== null} data-testid="unc-cells">
            {t('Survival probability per cell', 'Probabilidad de supervivencia por celda')}
          </button>
        </div>
        {unc.progress !== null && <div className="bar"><i style={{ width: `${Math.round(unc.progress * 100)}%` }} /></div>}
        {unc.stats && (
          <div className={`bands${unc.stale ? ' is-stale' : ''}`} data-testid="unc-stats">
            <div className={`band band-head${unc.stats.pSurvive >= 0.9 ? ' is-ok' : unc.stats.pSurvive <= 0.5 ? ' is-crit' : ' is-warn'}`}>
              <span>{t('Probability of surviving the window', 'Probabilidad de sobrevivir la ventana')}</span>
              <output className="mono">{fmtNum(100 * unc.stats.pSurvive, 0)} %</output>
            </div>
            <div className="band band-cap"><span /><output className="mono">P10 · <b>P50</b> · P90</output></div>
            <Band label={t('Sunlight', 'Luz solar')} q={unc.stats.illuminationPct} unit="%" digits={1} />
            <Band label={t('Earth in view', 'Tierra a la vista')} q={unc.stats.dtePct} unit="%" digits={1} />
            <Band label={t('Downlink closes', 'La descarga cierra')} q={unc.stats.downlinkPct} unit="%" digits={1} />
            <Band label={t('Time alive', 'Tiempo con vida')} q={unc.stats.survivalHours} unit="h" />
            <Band label={t('Science data', 'Datos científicos')} q={unc.stats.dataGb} unit="GB" />
            {unc.stale && <p className="kpi-note pad0">{t('The scenario changed since this run.', 'El escenario cambió desde esta corrida.')}</p>}
          </div>
        )}
        {unc.cellSurvival && !unc.stale && (
          <p className="kpi-note pad0" data-testid="unc-cells-done">
            {t(`The dispersion grid above now shows P(survive) from ${CELL_MEMBERS} terrain variants per cell.`, `La malla de dispersión de arriba muestra ahora P(sobrevivir) con ${CELL_MEMBERS} variantes de terreno por celda.`)}
          </p>
        )}
        <p className="kpi-note pad0">
          {t('Height error after Barker et al. (2021): 0.3–0.5 m RMS typical. It is a probability over the terrain error only; it says nothing about hardware failures or landing dynamics.', 'Error de altura según Barker et al. (2021): 0,3–0,5 m RMS típico. Es una probabilidad solo sobre el error del terreno; no dice nada de fallas de equipo ni de la dinámica del alunizaje.')}
        </p>
      </section>}
    </>
  );
}
