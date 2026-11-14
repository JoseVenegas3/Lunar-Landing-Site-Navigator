/**
 * Exports of a mission result: a telemetry CSV in SI / engineering units for
 * the GISAT ground-station tooling, and an iCalendar file of operations.
 */
import {
  HOUR_MS, MissionResult, Run, STATE_DEPLETED, STATE_DTE, STATE_RF_PHYSICAL, STATE_SUN, runsOf,
} from '../engine';

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');
const num = (v: number, d: number): string => (Number.isFinite(v) ? v.toFixed(d) : '');

export interface ExportMeta { site: string; scenario: string }

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

const icsTime = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace('.000', '');
const icsText = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
/** Largest number of events written, so calendar clients stay responsive. */
export const ICS_EVENT_LIMIT = 400;

/** Operations calendar: downlink passes per ground station, eclipses and loss of the lander. */
export function buildOpsIcs(r: MissionResult, meta: ExportMeta): string {
  const at = (i: number): number => r.eph.startMs + i * r.stepHours * HOUR_MS;
  const events: { start: number; end: number; summary: string; description: string }[] = [];
  const stations = r.adv.contact.sites;
  // Downlink passes: a new event whenever the link drops or the tracking station changes.
  let open = -1, openStation = -1;
  for (let i = 0; i <= r.count; i++) {
    const up = i < r.count && (r.state[i] & STATE_RF_PHYSICAL) !== 0;
    const st = up ? r.adv.contact.station[i] : -1;
    if (open >= 0 && (!up || st !== openStation)) {
      let gb = 0;
      for (let k = open; k < i; k++) gb += (r.rateMbps[k] * 1e6 * r.stepHours * 3600) / 8e9;
      events.push({
        start: at(open), end: at(i),
        summary: `Downlink ${stations[openStation]?.name ?? ''} (${meta.site})`,
        description: `${r.input.rf.band}-band direct-to-Earth pass, ${gb.toFixed(2)} GB`,
      });
      open = -1;
    }
    if (up && open < 0) { open = i; openStation = st; }
  }
  const dark: Run[] = runsOf(r.count, (i) => (r.state[i] & STATE_SUN) === 0);
  for (const run of dark) {
    events.push({
      start: at(run.start), end: at(run.end),
      summary: `Eclipse, on battery (${meta.site})`,
      description: `Topographic shadow for ${((run.end - run.start) * r.stepHours).toFixed(0)} h`,
    });
  }
  const lost = runsOf(r.count, (i) => (r.state[i] & STATE_DEPLETED) !== 0);
  if (lost.length > 0) {
    const death = r.adv.thermal && r.adv.thermal.thermalDeathIndex >= 0;
    events.push({
      start: at(lost[0].start), end: at(lost[0].start + 1),
      summary: `${death ? 'CRITICAL THERMAL DEATH' : 'Battery depleted'} (${meta.site})`,
      description: death ? 'Bus below -20 degC: battery frozen' : 'No stored energy and no array power',
    });
  }
  events.sort((a, b) => a.start - b.start);
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GISAT UdeC//CLPS Lunar Mission Browser//EN', 'CALSCALE:GREGORIAN'];
  events.slice(0, ICS_EVENT_LIMIT).forEach((e, k) => {
    out.push(
      'BEGIN:VEVENT', `UID:clps-${r.eph.startMs}-${k}@gisat.udec`, `DTSTAMP:${icsTime(r.eph.startMs)}`,
      `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(e.end)}`, `SUMMARY:${icsText(e.summary)}`, `DESCRIPTION:${icsText(e.description)}`,
      'END:VEVENT',
    );
  });
  out.push('END:VCALENDAR');
  return `${out.join('\r\n')}\r\n`;
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
