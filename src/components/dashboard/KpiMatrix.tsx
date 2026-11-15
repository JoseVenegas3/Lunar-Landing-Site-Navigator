/** Side-by-side KPI comparison of scenarios A and B, plus the link budget of the active one. */
import { useState } from 'react';
import { AdvancedKpis, Kpis, LinkBudget, groundStation, requiredGroundStation } from '../../engine';
import { useUnits } from '../../lib/units';

type AllKpis = Kpis & AdvancedKpis;
import { ScenarioData, useMission } from '../../state/mission';
import { useApp } from '../../state/store';
import { fmtData, fmtDate, fmtDuration, fmtEnergy, fmtNum, fmtRate, useT } from '../../lib/format';
import { ScenarioBadge } from '../ScenarioBadge';

interface Row {
  id: string;
  label: string;
  hint?: string;
  value: (k: AllKpis) => number;
  text: (k: AllKpis) => string;
  /** Which direction is better; 0 = informative only. */
  better: 1 | -1 | 0;
  /** Draw a 0-100 bar under the value. */
  bar?: 'sun' | 'rf' | 'ops' | 'relay';
  alert?: (k: AllKpis) => 'crit' | 'warn' | null;
}

function useRows(): Row[] {
  const t = useT();
  const u = useUnits();
  const relayOn = useApp((s) => s.relay.enabled);
  const relayRows: Row[] = relayOn ? [
    { id: 'relay', label: t('Relay in view', 'Relay a la vista'), hint: t('above terrain and with Earth in view', 'sobre el relieve y con la Tierra a la vista'), value: (k) => k.relayPct, text: (k) => `${fmtNum(k.relayPct)} %`, better: 1, bar: 'relay' },
    { id: 'anylink', label: t('Any path to Earth', 'Algún camino a la Tierra'), hint: t('DTE or relay', 'DTE o relay'), value: (k) => k.anyLinkPct, text: (k) => `${fmtNum(k.anyLinkPct)} %`, better: 1, bar: 'rf' },
    { id: 'outage', label: t('Longest total outage', 'Mayor corte total'), value: (k) => k.longestLinkOutageH, text: (k) => fmtDuration(k.longestLinkOutageH), better: -1 },
    { id: 'relaydata', label: t('Data through the relay', 'Datos por el relay'), hint: t('while DTE is closed', 'mientras el DTE está cerrado'), value: (k) => k.relayDataGb, text: (k) => fmtData(k.relayDataGb), better: 1 },
  ] : [];
  const base: Row[] = [
    { id: 'sunel', label: t('Solar elevation, max (power KPI)', 'Elevación solar máx. (KPI potencia)'), hint: t('Sun skims the horizon: tenths of a degree change the power', 'el Sol roza el horizonte: décimas de grado cambian la potencia'), value: (k) => k.sunElMaxDeg, text: (k) => `${fmtNum(k.sunElMaxDeg, 2)}° ${t('max', 'máx')}${k.sunElMaxDeg < 5 ? ` · ${t('grazing', 'rasante')}` : ''}`, better: 1 },
    { id: 'illum', label: t('Average illumination', 'Iluminación media'), hint: t('visible solar disc, time-averaged', 'disco solar visible, promedio temporal'), value: (k) => k.illuminationPct, text: (k) => `${fmtNum(k.illuminationPct)} %`, better: 1, bar: 'sun' },
    { id: 'sunlit', label: t('Hours with sunlight', 'Horas con luz solar'), value: (k) => k.sunlitPct, text: (k) => `${fmtNum(k.sunlitPct)} %`, better: 1, bar: 'sun' },
    { id: 'light', label: t('Longest continuous light', 'Mayor período continuo de luz'), value: (k) => k.longestLightH, text: (k) => fmtDuration(k.longestLightH), better: 1 },
    { id: 'dark', label: t('Longest darkness', 'Mayor período de oscuridad'), hint: t('battery survival span', 'tramo de supervivencia con batería'), value: (k) => k.longestDarkH, text: (k) => fmtDuration(k.longestDarkH), better: -1 },
    { id: 'dte', label: t('DTE window', 'Ventana DTE'), value: (k) => k.dtePct, text: (k) => `${fmtNum(k.dtePct)} %`, better: 1, bar: 'rf' },
    { id: 'gap', label: t('Longest DTE outage', 'Mayor corte DTE'), value: (k) => k.longestDteGapH, text: (k) => fmtDuration(k.longestDteGapH), better: -1 },
    { id: 'both', label: t('Sun + DTE together', 'Sol + DTE simultáneos'), value: (k) => k.simultaneousPct, text: (k) => `${fmtNum(k.simultaneousPct)} %`, better: 1, bar: 'ops' },
    { id: 'energy', label: t('Energy generated', 'Energía generada'), value: (k) => k.energyWh, text: (k) => fmtEnergy(k.energyWh), better: 1 },
    { id: 'rfavail', label: t('Downlink closes', 'La descarga cierra'), hint: t('diffraction, multipath, pointing, station in view', 'difracción, multipath, apuntamiento, estación a la vista'), value: (k) => k.rfAvailabilityPct, text: (k) => `${fmtNum(k.rfAvailabilityPct)} %`, better: 1, bar: 'rf' },
    { id: 'data', label: t('Science data return', 'Retorno de datos científicos'), value: (k) => k.dataGb, text: (k) => fmtData(k.dataGb), better: 1 },
    { id: 'attpen', label: t('Attitude penalty', 'Penalización por actitud'), hint: t('power / data lost to the tilt', 'potencia / datos perdidos por la inclinación'), value: (k) => k.attitudePowerPenaltyPct + k.attitudeRfPenaltyPct, text: (k) => `${fmtNum(k.attitudePowerPenaltyPct, 0)} % / ${fmtNum(k.attitudeRfPenaltyPct, 0)} %`, better: -1, alert: (k) => (k.attitudeRfPenaltyPct > 30 || k.attitudePowerPenaltyPct > 30 ? 'crit' : null) },
    { id: 'busmin', label: t('Lowest bus temperature', 'Temperatura mínima del bus'), value: (k) => k.minBusC ?? 0, text: (k) => (k.minBusC === null ? '—' : u.c(k.minBusC, 1)), better: 1, alert: (k) => (k.thermalDeathH !== null ? 'crit' : k.minBusC !== null && k.minBusC < -10 ? 'warn' : null) },
    {
      id: 'soc', label: t('Lowest battery charge', 'Carga mínima de batería'), value: (k) => k.minSocPct, text: (k) => `${fmtNum(k.minSocPct, 0)} %`, better: 1,
      alert: (k) => (!k.survives ? 'crit' : k.dodAlert ? 'warn' : null),
    },
    {
      id: 'survive', label: t('Survives the window', 'Sobrevive la ventana'), value: (k) => (k.survives ? 1 : 0), better: 1,
      text: (k) => (k.survives ? (k.dodAlert ? t('Yes, past DoD limit', 'Sí, excede DoD') : t('Yes', 'Sí')) : `${t('No, lost at', 'No, se pierde en')} T+${fmtDuration(k.survivalHours)}`),
      alert: (k) => (!k.survives ? 'crit' : k.dodAlert ? 'warn' : null),
    },
    { id: 'slope', label: t('Ground slope', 'Pendiente del terreno'), value: (k) => k.slopeDeg, text: (k) => `${fmtNum(k.slopeDeg)}°`, better: -1, alert: (k) => (k.slopeDeg > 15 ? 'crit' : k.slopeDeg > 10 ? 'warn' : null) },
  ];
  // Relay rows sit right after the direct-link rows.
  const at = base.findIndex((r) => r.id === 'both');
  return [...base.slice(0, at), ...relayRows, ...base.slice(at)];
}

function Cell({ row, k, wins }: { row: Row; k: AllKpis | null; wins: boolean }) {
  if (!k) return <td className="kpi-val mono is-pending">···</td>;
  const alert = row.alert?.(k) ?? null;
  return (
    <td className={`kpi-val mono${wins ? ' is-best' : ''}${alert ? ` is-${alert}` : ''}`} data-kpi={row.id}>
      <span>{row.text(k)}</span>
      {row.bar && <i className={`kpi-bar kpi-bar-${row.bar}`} style={{ width: `${Math.max(0, Math.min(100, row.value(k)))}%` }} />}
    </td>
  );
}

function Caption({ d, startMs, days }: { d: ScenarioData; startMs: number; days: number }) {
  return <div className="kpi-cap kpi-site"><span className="site-label" data-site-label={d.name}>{d.name}</span><br /><span className="mono">{days} d · {fmtDate(startMs)}</span></div>;
}

export function KpiMatrix() {
  const t = useT();
  const { A, B } = useMission();
  const compare = useApp((s) => s.compare);
  const cfg = useApp((s) => s.scenarios);
  const rows = useRows();
  const ka: AllKpis | null = A.result ? { ...A.result.kpis, ...A.result.adv.kpis } : null;
  const kb: AllKpis | null = compare && B.result ? { ...B.result.kpis, ...B.result.adv.kpis } : null;

  return (
    <section className="panel kpis" aria-label={t('Scenario comparison', 'Comparación de escenarios')}>
      <header className="panel-head"><h2>{compare ? t('Scenario comparison', 'Comparación de escenarios') : t('Mission KPIs', 'KPI de la misión')}</h2></header>
      <table className="kpi-table" data-testid="kpi-table">
        <thead>
          <tr>
            <th />
            <th><ScenarioBadge k="A" /><Caption d={A} startMs={cfg.A.startMs} days={cfg.A.days} /></th>
            {compare && <th><span className="badge badge-B">B</span><Caption d={B} startMs={cfg.B.startMs} days={cfg.B.days} /></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            let win: 'A' | 'B' | null = null;
            if (ka && kb && row.better !== 0) {
              const d = (row.value(ka) - row.value(kb)) * row.better;
              const scale = Math.max(Math.abs(row.value(ka)), Math.abs(row.value(kb)), 1e-9);
              if (Math.abs(d) / scale > 0.005) win = d > 0 ? 'A' : 'B';
            }
            return (
              <tr key={row.id}>
                <th scope="row">{row.label}{row.hint && <small>{row.hint}</small>}</th>
                <Cell row={row} k={ka} wins={win === 'A'} />
                {compare && <Cell row={row} k={kb} wins={win === 'B'} />}
              </tr>
            );
          })}
        </tbody>
      </table>
      {compare && <p className="kpi-note">{t('The marker ▸ flags the better value of each row.', 'La marca ▸ señala el mejor valor de cada fila.')}</p>}
    </section>
  );
}

function linkRows(l: LinkBudget, t: (en: string, es: string) => string): [string, string][] {
  return [
    [t('Lander antenna gain', 'Ganancia antena lander'), `${fmtNum(l.txGainDbi)} dBi`],
    [t('Beamwidth (-3 dB)', 'Ancho de haz (-3 dB)'), `${fmtNum(l.txBeamwidthDeg, 2)}°`],
    ['EIRP', `${fmtNum(l.eirpDbw)} dBW`],
    [t('Free-space path loss', 'Pérdida de espacio libre'), `${fmtNum(l.fsplDb)} dB`],
    [t('Station G/T', 'G/T estación'), `${fmtNum(l.gOverTDbK)} dB/K`],
    ['C/N₀', `${fmtNum(l.cn0DbHz)} dB-Hz`],
    [t('Achievable data rate', 'Tasa de datos alcanzable'), fmtRate(l.dataRateBps / 1e6)],
    ['Eb/N₀', `${fmtNum(l.ebN0Db)} dB`],
    [t('Margin over requirement', 'Margen sobre requisito'), `${fmtNum(l.marginDb)} dB`],
  ];
}

export function LinkBudgetCard({ data }: { data: ScenarioData }) {
  const t = useT();
  const u = useUnits();
  const rf = useApp((s) => s.rf);
  const l = data.result?.link ?? null;
  const [targetKbps, setTargetKbps] = useState<number | null>(null);
  const need = l && targetKbps !== null && targetKbps > 0 ? requiredGroundStation(rf, l.rangeKm, targetKbps * 1000) : null;
  return (
    <section className="panel link" aria-label={t('DTE link budget', 'Presupuesto de enlace DTE')}>
      <header className="panel-head">
        <h2><ScenarioBadge k={data.key} />{t('DTE link budget', 'Presupuesto de enlace DTE')}</h2>
      </header>
      {l ? (
        <>
          <p className="link-cap mono">
            {rf.band}-band {(l.frequencyHz / 1e9).toFixed(1)} GHz · {groundStation(rf.groundStationId).name} · {u.kmStr(l.rangeKm, 0)}
          </p>
          <dl className="link-grid mono" data-testid="link-budget">
            {linkRows(l, t).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
          </dl>
          {data.result && (
            <div className="gt-calc" data-testid="deygout">
              <h3>{t('Ridges between the lander and the Earth', 'Crestas entre el lander y la Tierra')}</h3>
              <dl className="link-grid mono">
                <div><dt>{t('Downlink closes', 'La descarga cierra')}</dt><dd>{fmtNum(data.result.adv.kpis.rfAvailabilityPct)} %</dd></div>
                <div><dt>{t('Largest loss added by ridges behind the skyline', 'Mayor pérdida añadida por crestas tras el horizonte')}</dt><dd>{fmtNum(data.result.adv.kpis.maxSecondaryDiffractionDb)} dB</dd></div>
                <div>
                  <dt>{t('Downlink a single ridge would wrongly count', 'Descarga que una sola cresta contaría de más')}</dt>
                  <dd className={data.result.adv.kpis.secondaryLostHours > 0 ? 'is-crit' : ''}>{fmtNum(data.result.adv.kpis.secondaryLostHours, 0)} h</dd>
                </div>
              </dl>
              <p className="kpi-note pad0">
                {t('Diffraction over up to three ridges (Deygout construction, ITU-R P.526). When the skyline is a small rise near the lander with a massif just under it farther away, one knife edge lets too much signal through.', 'Difracción sobre hasta tres crestas (construcción de Deygout, UIT-R P.526). Cuando el horizonte es una loma pequeña cerca del lander con un macizo justo debajo más lejos, un solo filo deja pasar demasiada señal.')}
              </p>
            </div>
          )}
          <div className="gt-calc">
            <h3>{t('Which station closes the link?', '¿Qué estación cierra el enlace?')}</h3>
            <label className="field field-num">
              <span className="field-label">{t('Target data rate', 'Tasa de datos objetivo')}</span>
              <span className="num-wrap">
                <input
                  type="number" className="mono" min={0.1} max={100000} step={10} placeholder="—" value={targetKbps ?? ''} data-testid="gt-target"
                  onChange={(e) => setTargetKbps(e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value) || 0))}
                />
                <i>kbps</i>
              </span>
            </label>
            <div className="rate-chips" role="group" aria-label={t('Quick values', 'Valores rápidos')}>
              {[10, 100, 1000].map((k) => (
                <button key={k} type="button" className={`tm-chip${targetKbps === k ? ' is-on' : ''}`} aria-pressed={targetKbps === k} onClick={() => setTargetKbps(k)} data-testid={`gt-chip-${k}`}>{k} kbps</button>
              ))}
            </div>
            {targetKbps === null && <p className="kpi-note pad0">{t('Enter the data rate the mission needs, or pick one of the quick values.', 'Ingresa la tasa de datos que necesita la misión, o elige uno de los valores rápidos.')}</p>}
            {need && (
              <dl className="link-grid mono" data-testid="gt-required">
                <div><dt>{t('Required G/T', 'G/T requerido')}</dt><dd>{fmtNum(need.gOverTDbK)} dB/K</dd></div>
                <div><dt>{t('Equivalent dish at 150 K', 'Antena equivalente a 150 K')}</dt><dd>{u.m(need.dishDiameterM, need.dishDiameterM < 10 ? 2 : 1)}</dd></div>
                <div><dt>{t('Selected station', 'Estación seleccionada')}</dt><dd className={l.gOverTDbK >= need.gOverTDbK ? '' : 'is-crit'}>{fmtNum(l.gOverTDbK)} dB/K ({l.gOverTDbK >= need.gOverTDbK ? '+' : ''}{fmtNum(l.gOverTDbK - need.gOverTDbK)} dB)</dd></div>
              </dl>
            )}
          </div>
          <p className="kpi-note">
            {l.limitedBy === 'bandwidth'
              ? t('Rate is capped by the allocated bandwidth; the spare power shows up as margin.', 'La tasa queda limitada por el ancho de banda asignado; la potencia sobrante aparece como margen.')
              : t('Rate is limited by received power: a larger dish or more transmit power raises it.', 'La tasa queda limitada por la potencia recibida: una antena mayor o más potencia la aumenta.')}
          </p>
        </>
      ) : <p className="kpi-note">{t('Waiting for the terrain model.', 'Esperando el modelo de terreno.')}</p>}
    </section>
  );
}
