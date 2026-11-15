/**
 * Export of a mission result: a telemetry CSV in SI / engineering units for
 * the GISAT ground-station tooling (26 columns, one row per hour).
 */
import { HOUR_MS, MissionResult, STATE_DEPLETED, STATE_DTE, STATE_RF_PHYSICAL, STATE_SUN } from '../engine';

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');
const num = (v: number, d: number): string => (Number.isFinite(v) ? v.toFixed(d) : '');

/** displayUnits: the unit system on screen when exporting; the CSV itself is always SI and says so. */
export interface ExportMeta { site: string; scenario: string; displayUnits?: 'si' | 'imperial' }

export const TELEMETRY_COLUMNS = [
  'utc', 'met_h', 'sun_az_deg', 'sun_el_deg', 'sun_disc_fraction', 'earth_az_deg', 'earth_el_deg', 'earth_clearance_deg',
  'earth_range_km', 'array_power_w', 'battery_wh', 'battery_soc_pct', 'bus_temp_c', 'env_temp_k', 'heater_w', 'ground_station',
  'pointing_loss_db', 'diffraction_loss_db', 'multipath_loss_db', 'ebn0_margin_db', 'data_rate_mbps', 'relay_coverage',
  'sunlit', 'dte_geometric', 'downlink_up', 'lander_lost',
] as const;

/** One row per analysis sample. Lines starting with '#' carry the provenance. */
export function buildTelemetryCsv(r: MissionResult, meta: ExportMeta): string {
  const cap = Math.max(1, r.input.power.batteryCapacityWh);
  const th = r.adv.thermal;
  const lines: string[] = [
    '# CLPS Lunar Mission Browser - GISAT UdeC - simulated telemetry',
    `# scenario=${meta.scenario} site=${meta.site}`,
    `# units=SI (unit suffix in each column name: _deg degrees, _km kilometres, _m metres, _w watts, _wh watt-hours, _pct percent, _c degrees Celsius, _k kelvin, _db decibels, _mbps megabits per second) display_units=${meta.displayUnits ?? 'si'}`,
    `# lander_lat_deg=${r.observer.latDeg.toFixed(5)} lander_lon_deg=${r.observer.lonDeg.toFixed(5)} ground_elevation_m=${(r.observer.groundKm * 1000).toFixed(1)}`,
    `# window_start_utc=${iso(r.eph.startMs)} step_h=${r.stepHours} samples=${r.count}`,
    `# attitude roll_deg=${r.adv.attitude.rollDeg} pitch_deg=${r.adv.attitude.pitchDeg} yaw_deg=${r.adv.attitude.yawDeg} gimbal_deg=${r.adv.attitude.gimbalRangeDeg}`,
    `# band=${r.input.rf.band} ground_segment=${r.adv.contact.sites.map((s) => s.name).join('/')} thermal_model=${th ? 'coupled' : 'off'}`,
    '# terrain: LRO LOLA, Barker et al. 2023, doi:10.3847/PSJ/acf3e1',
    TELEMETRY_COLUMNS.join(','),
  ];
  for (let i = 0; i < r.count; i++) {
    const s = r.state[i];
    const st = r.adv.contact.station[i];
    lines.push([
      iso(r.eph.startMs + i * r.stepHours * HOUR_MS), num(i * r.stepHours, 2),
      num(r.sunAz[i], 3), num(r.sunEl[i], 3), num(r.sunFrac[i], 4),
      num(r.earthAz[i], 3), num(r.earthEl[i], 3), num(r.earthClear[i], 3), num(r.earthRangeKm[i], 0),
      num(r.powerW[i], 1), num(r.battery.socWh[i], 1), num((100 * r.battery.socWh[i]) / cap, 2),
      th ? num(th.tBusK[i] - 273.15, 2) : '', th ? num(th.tEnvK[i], 1) : '', th ? num(th.heaterW[i], 1) : '',
      st >= 0 ? r.adv.contact.sites[st].name : '',
      num(r.adv.pointingLossDb[i], 2), r.adv.diffractionDb[i] >= 99 ? '' : num(r.adv.diffractionDb[i], 2), num(r.adv.multipathDb[i], 2),
      r.adv.ebN0MarginDb[i] <= -99 ? '' : num(r.adv.ebN0MarginDb[i], 2), num(r.rateMbps[i], 4), num(r.relayFrac[i], 3),
      s & STATE_SUN ? 1 : 0, s & STATE_DTE ? 1 : 0, s & STATE_RF_PHYSICAL ? 1 : 0, s & STATE_DEPLETED ? 1 : 0,
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** File name stem of an export: site, window start and length, no abbreviations. */
export function exportStem(siteName: string, r: MissionResult): string {
  const slug = siteName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const days = Math.round(((r.count - 1) * r.stepHours) / 24);
  return `clps_${slug}_${new Date(r.eph.startMs).toISOString().slice(0, 10)}_${days}d`;
}

/** Hand a text file to the browser's download flow. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
