/**
 * Mission-window timeline (Gantt). One lane group per scenario, all sharing the
 * same elapsed-time axis so two sites or two date ranges line up hour by hour.
 *
 * Rows per scenario:
 *   Sun      amber, opacity = visible fraction of the solar disc
 *   Battery  grey while running on stored energy, red when below the DoD limit
 *            or depleted; the white trace is the state of charge
 *   DTE      cyan while the Earth is above the terrain plus the antenna margin
 *   Ops      green when sunlight and DTE coincide (critical simultaneous operations)
 */
import { useRef } from 'react';
import { HOUR_MS, MissionResult, STATE_BELOW_DOD, STATE_DEPLETED, STATE_DTE, STATE_RF_PHYSICAL, STATE_SUN } from '../../engine';

/** One tint of the RF family per ground station, in the order of the network. */
const STATION_RGB = ['6,182,212', '125,211,252', '45,212,191'];

const RELAY_RGB = '180,156,255';
import { ScenarioData } from '../../state/mission';
import { maxCursorHours, useApp } from '../../state/store';
import { C, FONT_MONO, FONT_UI, useCanvas } from '../../lib/useCanvas';
import { fmtDateTime, fmtMonthDay, useT } from '../../lib/format';

const GUTTER = 96;
const PAD_R = 14;
const AXIS_H = 20;
const ROW_H = 15;
const ROW_GAP = 3;
const GROUP_GAP = 12;

interface Lane { data: ScenarioData; top: number }

export function Timeline({ scenarios, simple = false }: { scenarios: ScenarioData[]; simple?: boolean }) {
  const t = useT();
  const setCursor = useApp((s) => s.setCursor);
  const setPlaying = useApp((s) => s.setPlaying);
  const maxHours = useApp((s) => maxCursorHours(s));
  const dragging = useRef(false);
  const relayOn = !simple && scenarios.some((s) => (s.result?.relaySats.length ?? 0) > 0);
  // With a relay constellation a fifth row appears and "operations" means sunlight plus any path to Earth.
  const rowLabels = simple
    ? [t('Day / night', 'Día / noche'), t('Earth', 'Tierra'), t('Sun + Earth', 'Sol + Tierra')]
    : relayOn
    ? [t('Sun', 'Sol'), t('Battery', 'Batería'), t('Earth in view', 'Tierra visible'), t('Downlink', 'Descarga'), t('Relay', 'Relevo'), t('Sun + link', 'Sol + enlace')]
    : [t('Sun', 'Sol'), t('Battery', 'Batería'), t('Earth in view', 'Tierra visible'), t('Downlink', 'Descarga'), t('Sun + link', 'Sol + enlace')];
  const stations = scenarios[0]?.result?.adv.contact.sites ?? [];
  const rows = rowLabels.length;
  const results = scenarios.map((s) => s.result);

  const groupH = rows * ROW_H + (rows - 1) * ROW_GAP;
  const lanes: Lane[] = scenarios.map((data, i) => ({ data, top: AXIS_H + 6 + i * (groupH + GROUP_GAP + AXIS_H) }));

  const { ref } = useCanvas({ base: (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, 0, w, h);
    const pw = w - GUTTER - PAD_R;
    if (pw < 60) return;
    const X = (hours: number): number => GUTTER + (hours / maxHours) * pw;

    for (const lane of lanes) {
      const r = lane.data.result;
      // row labels
      ctx.font = `10.5px ${FONT_UI}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      for (let row = 0; row < rows; row++) {
        const y = lane.top + row * (ROW_H + ROW_GAP);
        ctx.fillStyle = C.dim;
        ctx.fillText(rowLabels[row], GUTTER - 8, y + ROW_H / 2 + 0.5);
        ctx.fillStyle = '#0a0e16';
        ctx.fillRect(GUTTER, y, pw, ROW_H);
      }
      ctx.textAlign = 'left';
      if (lanes.length > 1) {
        ctx.font = `700 11px ${FONT_MONO}`;
        ctx.fillStyle = lane.data.key === 'A' ? '#E6EDF7' : '#A5B4CC';
        ctx.fillText(lane.data.key, 8, lane.top + ROW_H / 2);
      }
      if (!r) continue;
      drawLane(ctx, r, lane.top, pw, maxHours, relayOn, simple);
      drawAxis(ctx, r, lane.top + groupH + 3, pw, maxHours, X);
    }

    // shared elapsed-time header
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.fillText('MET', 8, AXIS_H / 2);
    const days = maxHours / 24;
    const stepD = [1, 2, 5, 10, 15, 30, 60].find((d) => (d / days) * pw >= 52) ?? 60;
    ctx.textAlign = 'center';
    for (let d = 0; d <= days + 1e-9; d += stepD) {
      const x = X(d * 24);
      if (x > w - PAD_R - 18 && d + stepD <= days) continue;
      ctx.fillStyle = C.dim;
      ctx.fillText(`T+${d}d`, Math.min(Math.max(x, GUTTER + 14), w - PAD_R - 16), AXIS_H / 2);
    }
  }, overlay: (ctx, w, h, cursorHours) => {
    const pw = w - GUTTER - PAD_R;
    if (pw < 60) return;
    const X = (hours: number): number => GUTTER + (hours / maxHours) * pw;
    // cursor
    const cx = Math.round(X(cursorHours)) + 0.5;
    ctx.strokeStyle = '#E6EDF7';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, AXIS_H - 2);
    ctx.lineTo(cx, h - 2);
    ctx.stroke();
    ctx.fillStyle = '#E6EDF7';
    ctx.beginPath();
    ctx.moveTo(cx - 4, AXIS_H - 8);
    ctx.lineTo(cx + 4, AXIS_H - 8);
    ctx.lineTo(cx, AXIS_H - 2);
    ctx.closePath();
    ctx.fill();
    // cursor date for each lane
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textBaseline = 'middle';
    for (const lane of lanes) {
      const r = lane.data.result;
      if (!r) continue;
      const inside = cursorHours <= (r.count - 1) * r.stepHours;
      const text = inside ? fmtDateTime(r.eph.startMs + cursorHours * HOUR_MS) : '—';
      const tw = ctx.measureText(text).width + 10;
      const right = cx + 6 + tw < w - 2;
      const tx = right ? cx + 6 : cx - 6 - tw;
      const ty = lane.top + groupH + 5;
      ctx.fillStyle = 'rgba(8,11,17,0.94)';
      ctx.fillRect(tx, ty, tw, 15);
      ctx.fillStyle = '#E6EDF7';
      ctx.textAlign = 'left';
      ctx.fillText(text, tx + 5, ty + 8);
    }
  } }, [results[0] ?? null, results[1] ?? null, maxHours, rowLabels.join('|'), scenarios.length]);

  const scrub = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const pw = r.width - GUTTER - PAD_R;
    setCursor(((e.clientX - r.left - GUTTER) / pw) * maxHours);
  };

  const height = AXIS_H + 6 + scenarios.length * (groupH + AXIS_H) + (scenarios.length - 1) * GROUP_GAP + 4;

  return (
    <section className="panel timeline" aria-label={t('Mission window timeline', 'Línea de tiempo de ventanas de misión')}>
      <header className="panel-head">
        <h2>{t('Mission windows', 'Ventanas de misión')}</h2>
        <ul className="legend legend-inline">
          <li><i className="sw sw-sun" />{t('Sunlight', 'Luz solar')}</li>
          {!simple && <li><i className="sw sw-dark" />{t('On battery', 'En batería')}</li>}
          {!simple && <li><i className="sw sw-crit" />{t('Below DoD limit / frozen', 'Bajo límite DoD / congelado')}</li>}
          <li><i className="sw sw-rf sw-faint" />{t('Earth above terrain', 'Tierra sobre el relieve')}</li>
          {!simple && stations.map((s, k) => <li key={s.id}><i className="sw" style={{ background: `rgb(${STATION_RGB[k % 3]})` }} />{s.name}</li>)}
          {relayOn && <li><i className="sw sw-relay" />{t('Relay in view', 'Relevo a la vista')}</li>}
          <li><i className="sw sw-ops" />{simple ? t('Success: Sun and Earth at once', 'Éxito: Sol y Tierra a la vez') : t('Simultaneous operations', 'Operación simultánea')}</li>
        </ul>
      </header>
      <canvas
        ref={ref}
        className="timeline-canvas"
        data-testid="timeline"
        style={{ height }}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setPlaying(false);
          scrub(e);
        }}
        onPointerMove={(e) => { if (dragging.current) scrub(e); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      />
    </section>
  );
}

/** Paint the four rows of one scenario, one pixel column at a time. */
function drawLane(ctx: CanvasRenderingContext2D, r: MissionResult, top: number, pw: number, maxHours: number, relayRow: boolean, simple = false): void {
  // Quick view: day/night, Earth visible, both at once. Rows that are not shown are parked off-canvas.
  const OFF = -1000;
  const ROW = simple ? { sun: 0, bat: OFF, dte: 1, down: OFF, relay: OFF, ops: 2 } : { sun: 0, bat: 1, dte: 2, down: 3, relay: 4, ops: relayRow ? 5 : 4 };
  const opsRow = ROW.ops;
  const stationOf = r.adv.contact.station;
  const n = r.count;
  const cap = r.input.power.batteryCapacityWh;
  const lastHour = (n - 1) * r.stepHours;
  const cols = Math.round(pw);
  const rowY = (row: number): number => (row === OFF ? -5000 : top + row * (ROW_H + ROW_GAP));
  const socPts: [number, number][] = [];

  for (let px = 0; px < cols; px++) {
    const h0 = (px / cols) * maxHours, h1 = ((px + 1) / cols) * maxHours;
    if (h0 > lastHour) break;
    const i0 = Math.min(n - 1, Math.floor(h0 / r.stepHours));
    const i1 = Math.min(n - 1, Math.max(i0, Math.ceil(h1 / r.stepHours) - 1));
    let frac = 0, dte = 0, both = 0, dark = 0, low = 0, dead = 0, soc = 0, relay = 0, down = 0, station = -1;
    for (let i = i0; i <= i1; i++) {
      const s = r.state[i];
      frac += r.sunFrac[i];
      if (s & STATE_DTE) dte++;
      relay += r.relayFrac[i];
      if (s & STATE_RF_PHYSICAL) { down++; if (station < 0) station = stationOf[i]; }
      // Operations need power and a path to Earth: a downlink that closes, or a relay when one is configured.
      if (s & STATE_SUN) both += (s & STATE_RF_PHYSICAL) ? 1 : (relayRow ? r.relayFrac[i] : 0);
      if (!(s & STATE_SUN)) dark++;
      if (s & STATE_BELOW_DOD) low++;
      if (s & STATE_DEPLETED) dead++;
      soc += r.battery.socWh[i];
    }
    const m = i1 - i0 + 1;
    const x = GUTTER + px;
    if (frac > 0) {
      ctx.fillStyle = `rgba(245,158,11,${0.25 + 0.75 * (frac / m)})`;
      ctx.fillRect(x, rowY(ROW.sun), 1, ROW_H);
    }
    if (dead > 0) {
      ctx.fillStyle = C.crit;
      ctx.fillRect(x, rowY(ROW.bat), 1, ROW_H);
    } else if (low > 0) {
      ctx.fillStyle = 'rgba(239,68,68,0.5)';
      ctx.fillRect(x, rowY(ROW.bat), 1, ROW_H);
    } else if (dark > 0) {
      ctx.fillStyle = `rgba(100,116,139,${0.25 + 0.5 * (dark / m)})`;
      ctx.fillRect(x, rowY(ROW.bat), 1, ROW_H);
    }
    if (dte > 0) {
      ctx.fillStyle = `rgba(6,182,212,${0.12 + 0.3 * (dte / m)})`;
      ctx.fillRect(x, rowY(ROW.dte), 1, ROW_H);
    }
    if (down > 0) {
      ctx.fillStyle = `rgba(${STATION_RGB[Math.max(0, station) % 3]},${0.3 + 0.7 * (down / m)})`;
      ctx.fillRect(x, rowY(ROW.down), 1, ROW_H);
    }
    if (relayRow && relay > 0) {
      ctx.fillStyle = `rgba(${RELAY_RGB},${0.2 + 0.75 * (relay / m)})`;
      ctx.fillRect(x, rowY(ROW.relay), 1, ROW_H);
    }
    if (both > 0) {
      ctx.fillStyle = `rgba(16,185,129,${0.25 + 0.75 * (both / m)})`;
      ctx.fillRect(x, rowY(opsRow), 1, ROW_H);
    }
    socPts.push([x + 0.5, rowY(ROW.bat) + ROW_H - 1.5 - (cap > 0 ? soc / m / cap : 0) * (ROW_H - 3)]);
  }

  // state-of-charge trace over the battery row
  ctx.beginPath();
  socPts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.strokeStyle = 'rgba(230,237,247,0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Calendar axis of one scenario under its lanes. */
function drawAxis(
  ctx: CanvasRenderingContext2D, r: MissionResult, y: number, pw: number, maxHours: number, X: (h: number) => number,
): void {
  const days = ((r.count - 1) * r.stepHours) / 24;
  const stepD = [1, 2, 5, 10, 15, 30, 60].find((d) => ((d * 24) / maxHours) * pw >= 52) ?? 60;
  ctx.font = `9.5px ${FONT_MONO}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let d = 0; d <= days + 1e-9; d += stepD) {
    const x = Math.round(X(d * 24)) + 0.5;
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 2);
    ctx.stroke();
    ctx.fillStyle = C.faint;
    ctx.fillText(fmtMonthDay(r.eph.startMs + d * 24 * HOUR_MS), Math.max(x, GUTTER + 16), y + 4);
  }
}
