/**
 * Night survival of the planned window (SyR-P4): thermal outcome, heaters and
 * energy. The landing dispersion and the escape vector (SyR-C5.2) are part of
 * the shared emergency flow (EmergencyFlow.tsx).
 */
import { ScenarioData } from '../../state/mission';
import { useApp } from '../../state/store';
import { fmtDuration, fmtEnergy, fmtNum, useT } from '../../lib/format';
import { ScenarioBadge } from '../ScenarioBadge';

export function SurvivalPanel({ data }: { data: ScenarioData }) {
  const t = useT();
  const thermalOn = useApp((s) => s.thermalOn);
  const r = data.result;
  const a = r?.adv.kpis;

  return (
    <>
      <section className="panel block" data-testid="thermal-kpis">
        <h3><ScenarioBadge k={data.key} />{t('Night survival', 'Supervivencia nocturna')}</h3>
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
      </section>

    </>
  );
}
