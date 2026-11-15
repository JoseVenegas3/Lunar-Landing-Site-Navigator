/**
 * "Model assumptions" (v2.1 change 8): every figure or threshold of the tool
 * that is not a measurement, read-only, with its origin. It is the only place
 * where a value without a source is allowed, and it is in plain view in the
 * engineering view of the Science console. Values are read from the code that
 * uses them, so the table cannot drift from the model.
 */
import {
  CAPACITY_AT_DEATH, DEFAULT_POWER, DEFAULT_TIPOVER, DEFAULT_UNCERTAINTY, DEFAULT_WINDOW_CONFIG, DEYGOUT_RIDGE_GUARD, DEFAULT_MICRO_RELIEF,
  EQUILIBRIUM_K, GROUND_MASK_DEG, REGOLITH_EPS_R, REGOLITH_TAN_DELTA, T_BATTERY_DEATH_K, T_DERATE_START_K, T_FREEZE_K, VERDICT_LIMITS,
  staticStabilityDeg,
} from '../../engine';
import { EMERGENCY_HORIZON_DAYS, SYNODIC_MONTH_D } from '../EmergencyFlow';
import { EXIT_MOVE_RADIUS_M } from '../../state/exitPlan';
import { RESCUE_SPANS, useApp } from '../../state/store';
import { TELEMETRY_LIMITS } from '../../lib/telemetry';
import { fmtNum, useT } from '../../lib/format';
import { LolaLimits } from '../DataLimits';
import { useUnits } from '../../lib/units';

type Bi = [string, string];
interface Row { p: Bi; value: string; unit: string; source: Bi | null; where: Bi }

const C = (k: number): string => fmtNum(k - 273.15, 0);
const TEAM: null = null;

export const ASSUMPTIONS: Row[] = [
  // thermal
  { p: ['Survival heaters switch on below', 'Calefactores de supervivencia se encienden bajo'], value: C(T_FREEZE_K), unit: '°C', source: TEAM, where: ['Thermal model, telemetry', 'Modelo térmico, telemetría'] },
  { p: ['Battery starts losing capacity below', 'La batería empieza a perder capacidad bajo'], value: C(T_DERATE_START_K), unit: '°C', source: TEAM, where: ['Thermal model', 'Modelo térmico'] },
  { p: ['Battery frozen, lander lost at', 'Batería congelada, módulo perdido a'], value: C(T_BATTERY_DEATH_K), unit: '°C', source: TEAM, where: ['Thermal model, verdict, emergency headline', 'Modelo térmico, veredicto, titular de emergencia'] },
  { p: ['Usable capacity left at −20 °C', 'Capacidad utilizable a −20 °C'], value: fmtNum(100 * CAPACITY_AT_DEATH, 0), unit: '%', source: TEAM, where: ['Thermal model', 'Modelo térmico'] },
  // landing windows
  { p: ['Glare cone around the direction of flight', 'Cono de deslumbramiento en la dirección de vuelo'], value: `±${DEFAULT_WINDOW_CONFIG.glareHalfDeg}`, unit: '°', source: TEAM, where: ['Landing windows', 'Ventanas de aterrizaje'] },
  { p: ['Washout cone behind the lander (no shadows)', 'Cono sin sombras detrás del módulo'], value: `±${DEFAULT_WINDOW_CONFIG.washoutHalfDeg}`, unit: '°', source: TEAM, where: ['Landing windows', 'Ventanas de aterrizaje'] },
  { p: ['Sunlit share of the landing ellipse', 'Fracción con sol de la elipse de alunizaje'], value: `≥ ${DEFAULT_WINDOW_CONFIG.minEllipseLitPct}`, unit: '%', source: TEAM, where: ['Landing windows', 'Ventanas de aterrizaje'] },
  { p: ['Landing ellipse radius', 'Radio de la elipse de alunizaje'], value: String(DEFAULT_WINDOW_CONFIG.ellipseRadiusM), unit: 'm', source: TEAM, where: ['Landing windows', 'Ventanas de aterrizaje'] },
  // verdict
  { p: ['Longest routine silence with the Earth', 'Silencio rutinario más largo con la Tierra'], value: String(VERDICT_LIMITS.linkGapH), unit: 'h', source: TEAM, where: ['Verdict', 'Veredicto'] },
  { p: ['No usable link below', 'Sin enlace útil bajo'], value: String(VERDICT_LIMITS.noLinkPct), unit: '%', source: TEAM, where: ['Verdict', 'Veredicto'] },
  { p: ['Little sunlight below', 'Poca luz solar bajo'], value: String(VERDICT_LIMITS.lowSunPct), unit: '%', source: TEAM, where: ['Verdict', 'Veredicto'] },
  { p: ['Tilt warning above', 'Aviso de inclinación sobre'], value: String(VERDICT_LIMITS.tiltDeg), unit: '°', source: TEAM, where: ['Verdict', 'Veredicto'] },
  { p: ['Slope warning above', 'Aviso de pendiente sobre'], value: String(VERDICT_LIMITS.slopeDeg), unit: '°', source: TEAM, where: ['Verdict', 'Veredicto'] },
  { p: ['Tip-over probability warning above', 'Aviso de probabilidad de vuelco sobre'], value: fmtNum(100 * VERDICT_LIMITS.tipoverP, 0), unit: '%', source: TEAM, where: ['Verdict', 'Veredicto'] },
  // telemetry colours
  { p: ['Battery amber / red below', 'Batería ámbar / roja bajo'], value: `${TELEMETRY_LIMITS.batteryWarnPct} / ${TELEMETRY_LIMITS.batteryCritPct}`, unit: '%', source: TEAM, where: ['Telemetry', 'Telemetría'] },
  { p: ['Link margin amber / red below', 'Margen de enlace ámbar / rojo bajo'], value: `${TELEMETRY_LIMITS.marginWarnDb} / ${TELEMETRY_LIMITS.marginCritDb}`, unit: 'dB', source: TEAM, where: ['Telemetry', 'Telemetría'] },
  // vehicle
  { p: ['Default battery / operating load / survival load', 'Batería / consumo operativo / de supervivencia por defecto'], value: `${fmtNum(DEFAULT_POWER.batteryCapacityWh, 0)} / ${DEFAULT_POWER.baseLoadW} / ${DEFAULT_POWER.survivalLoadW}`, unit: 'Wh / W / W', source: ['illustrative example, editable in Hardware', 'ejemplo ilustrativo, editable en Equipo'], where: ['Every mission', 'Toda misión'] },
  { p: ['Default cells: area / efficiency / derating', 'Celdas por defecto: área / eficiencia / pérdidas'], value: `${DEFAULT_POWER.panelAreaM2} / ${fmtNum(100 * DEFAULT_POWER.efficiency, 1)} / ${fmtNum(100 * DEFAULT_POWER.derating, 0)}`, unit: 'm² / % / %', source: ['illustrative example, editable in Hardware', 'ejemplo ilustrativo, editable en Equipo'], where: ['Every mission', 'Toda misión'] },
  { p: ['Tip-over vehicle: centre of mass / tip radius', 'Vehículo de vuelco: centro de masa / radio de vuelco'], value: `${DEFAULT_TIPOVER.cgHeightM} / ${DEFAULT_TIPOVER.tipRadiusM} (${fmtNum(staticStabilityDeg(DEFAULT_TIPOVER), 0)}°)`, unit: 'm', source: ['illustrative example, editable in Attitude and tip-over', 'ejemplo ilustrativo, editable en Actitud y vuelco'], where: ['Tip-over, slope range of the index', 'Vuelco, rango de pendiente del índice'] },
  // radio
  { p: ['Ground-station elevation mask', 'Máscara de elevación de las estaciones'], value: String(GROUND_MASK_DEG), unit: '°', source: TEAM, where: ['Downlink', 'Descarga'] },
  { p: ['Regolith permittivity / loss tangent', 'Permitividad / tangente de pérdidas del regolito'], value: `${REGOLITH_EPS_R} / ${REGOLITH_TAN_DELTA}`, unit: '—', source: ['team parameters, not validated', 'parámetros del equipo, no validados'], where: ['Multipath', 'Multitrayecto'] },
  { p: ['Knife-edge loss J(ν) and three-edge construction', 'Pérdida de filo de cuchillo J(ν) y construcción de tres filos'], value: 'J(ν) = 6.9 + 20 log(√((ν−0.1)²+1) + ν − 0.1)', unit: 'dB', source: ['ITU-R P.526; Deygout (1966), IEEE Trans. Antennas Propag. 14(4)', 'UIT-R P.526; Deygout (1966), IEEE Trans. Antennas Propag. 14(4)'], where: ['Diffraction over the ridges', 'Difracción sobre las crestas'] },
  { p: ['Samples of one ridge (share of the main-edge range)', 'Muestras de una misma cresta (fracción del alcance del filo principal)'], value: String(DEYGOUT_RIDGE_GUARD), unit: '—', source: ['team parameters, not validated', 'parámetros del equipo, no validados'], where: ['Deygout construction', 'Construcción de Deygout'] },
  // terrain
  { p: ['LOLA height error (RMS) / correlation length', 'Error de altura LOLA (RMS) / longitud de correlación'], value: `${DEFAULT_UNCERTAINTY.sigmaM} / ${DEFAULT_UNCERTAINTY.corrLenM}`, unit: 'm', source: ['Barker et al. (2021) for 0.3–0.5 m; length: team', 'Barker et al. (2021) para 0,3–0,5 m; longitud: equipo'], where: ['Terrain uncertainty', 'Incertidumbre del terreno'] },
  { p: ['Equilibrium crater density k in N(>D) = k D⁻²', 'Densidad de cráteres en equilibrio k en N(>D) = k D⁻²'], value: String(EQUILIBRIUM_K), unit: 'm⁻²', source: ['Trask (1966), equilibrium 10^−1.1', 'Trask (1966), equilibrio 10^−1,1'], where: ['Sub-pixel hazards', 'Peligros bajo el píxel'] },
  { p: ['Sub-pixel RMS slope / craters / footprint / slope limit', 'Pendiente RMS bajo el píxel / cráteres / huella / límite'], value: `${DEFAULT_MICRO_RELIEF.slopeRmsDeg}° / ${DEFAULT_MICRO_RELIEF.craterMinM}–${DEFAULT_MICRO_RELIEF.craterMaxM} m / ${DEFAULT_MICRO_RELIEF.footprintM} m / ${DEFAULT_MICRO_RELIEF.slopeLimitDeg}°`, unit: '—', source: ['team parameters, not validated (fractal, Hurst 0.9)', 'parámetros del equipo, no validados (fractal, Hurst 0,9)'], where: ['Sub-pixel hazards', 'Peligros bajo el píxel'] },
  // emergency and search
  { p: ['Emergency horizon (one lunar night)', 'Horizonte de emergencia (una noche lunar)'], value: String(EMERGENCY_HORIZON_DAYS), unit: 'd', source: [`half a synodic month, ${fmtNum(SYNODIC_MONTH_D / 2, 2)} d, rounded up`, `medio mes sinódico, ${fmtNum(SYNODIC_MONTH_D / 2, 2)} d, redondeado hacia arriba`], where: ['Emergency flow', 'Flujo de emergencia'] },
  { p: ['Relocation reach of the way-out search', 'Alcance de la reubicación en la búsqueda de salida'], value: String(EXIT_MOVE_RADIUS_M), unit: 'm', source: TEAM, where: ['Emergency: way out', 'Emergencia: salida'] },
  { p: ['Later dates tried by "Optimise"', 'Fechas posteriores que prueba «Optimizar»'], value: RESCUE_SPANS.join(' / '), unit: 'd', source: TEAM, where: ['Verdict: Optimise site and date', 'Veredicto: Optimizar sitio y fecha'] },
];

export function AssumptionsTable() {
  const t = useT();
  const u = useUnits();
  const li = useApp((s) => (s.lang === 'es' ? 1 : 0));
  return (
    <section className="panel block" data-testid="assumptions">
      <h3>{t('Model assumptions', 'Supuestos del modelo')}</h3>
      <p className="kpi-note pad0">{t('Every value of the tool that is not a measurement, with its origin. "Team assumption" means an engineering choice of this tool with no published source behind it; this table is the only place where one is allowed.', 'Cada valor de la herramienta que no es una medición, con su origen. «Supuesto del equipo» es una elección de ingeniería de esta herramienta sin fuente publicada detrás; esta tabla es el único lugar donde se admite uno.')}</p>
      <div className="assume-wrap">
        <table className="assume-table">
          <thead>
            <tr><th>{t('Parameter', 'Parámetro')}</th><th>{t('Value', 'Valor')}</th><th>{t('Unit', 'Unidad')}</th><th>{t('Origin', 'Origen')}</th><th>{t('Used in', 'Dónde se usa')}</th></tr>
          </thead>
          <tbody>
            {ASSUMPTIONS.map((r) => (
              <tr key={r.p[0]} data-origin={r.source ? 'source' : 'team'}>
                <th scope="row">{r.p[li]}</th>
                <td className="mono">{r.unit === '°C' && u.sys === 'imperial' ? fmtNum(u.tempC(Number(r.value)), 0) : r.value}</td>
                <td className="mono">{r.unit === '°C' ? u.tempU : r.unit}</td>
                <td className={r.source ? '' : 'is-team'}>{r.source ? r.source[li] : t('team assumption', 'supuesto del equipo')}</td>
                <td>{r.where[li]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LolaLimits testid="lola-limits-assume" />
    </section>
  );
}
