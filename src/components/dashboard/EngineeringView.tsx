/**
 * Engineering view (Science console): the full KPI table of the mission, for
 * the engineer who wants every figure. The detailed timeline (one row per
 * ground station, the relay and simultaneous operations) sits in the bottom
 * tray of the same console.
 */
import { skylineShiftDeg } from '../../engine';
import { useUncertainty } from '../../state/insights';
import { useActiveScenario } from '../../state/mission';
import { fmtNum, useT } from '../../lib/format';
import { KpiMatrix } from './KpiMatrix';

function Band({ label, q, unit, digits = 0 }: { label: string; q: { p10: number; p50: number; p90: number }; unit: string; digits?: number }) {
  return (
    <div className="band">
      <span>{label}</span>
      <output className="mono">{fmtNum(q.p10, digits)} · <b>{fmtNum(q.p50, digits)}</b> · {fmtNum(q.p90, digits)} {unit}</output>
    </div>
  );
}

/** How much the answer depends on the error of the elevation model (ensemble of perturbed terrains). */
function UncertaintyBlock() {
  const t = useT();
  const data = useActiveScenario();
  const unc = useUncertainty(data);
  const r = data.result;
  return (
    <section className="panel block" data-testid="uncertainty-panel">
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
      <p className="kpi-note pad0">
        {t('Height error after Barker et al. (2021): 0.3–0.5 m RMS typical. It is a probability over the terrain error only; it says nothing about hardware failures or landing dynamics.', 'Error de altura según Barker et al. (2021): 0,3–0,5 m RMS típico. Es una probabilidad solo sobre el error del terreno; no dice nada de fallas de equipo ni de la dinámica del alunizaje.')}
      </p>
    </section>
  );
}

export function EngineeringView() {
  const t = useT();
  return (
    <div data-testid="engineering-view">
      <KpiMatrix />
      <p className="kpi-note">
        {t('The timeline below is the detailed one in this console: sunlight, battery, Earth in view, the downlink coloured by ground station, the relay when there is one, and the hours of simultaneous operations. The other consoles show the simple three-row version.', 'La línea de tiempo de abajo es la detallada en esta consola: luz solar, batería, Tierra visible, la descarga coloreada por estación terrena, el relay si lo hay y las horas de operación simultánea. Las demás consolas muestran la versión simple de tres filas.')}
      </p>
      <UncertaintyBlock />
    </div>
  );
}
