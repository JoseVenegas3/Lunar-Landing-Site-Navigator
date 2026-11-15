/**
 * Electro-thermal timeline (SyR-C4.1): battery state of charge and bus
 * temperature on a shared time axis, with the heater duty as a band, the
 * thermostat and freezing thresholds, and the instant of thermal death.
 */
import { HOUR_MS, MissionResult, T_BATTERY_DEATH_K, T_FREEZE_K } from '../../engine';
import { ScenarioData } from '../../state/mission';
import { C, FONT_MONO, FONT_UI, useCanvas } from '../../lib/useCanvas';
import { fmtDateTime, useT } from '../../lib/format';
import { currentUnits, useUnits } from '../../lib/units';
import { ScenarioBadge } from '../ScenarioBadge';

const PAD = { l: 46, r: 52, t: 14, b: 22 };

interface Scale { pw: number; ph: number; tMin: number; tMax: number; X: (i: number) => number; YT: (c: number) => number; YS: (pct: number) => number }

function scale(w: number, h: number, r: MissionResult): Scale | null {
  const th = r.adv.thermal;
  const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
  if (pw < 60 || ph < 40) return null;
  // The interesting range is the survival band; a lost lander cooling to 100 K is clipped at the floor.
  const lo = th ? -40 : -30, hi = 45;
  const n = r.count;
  return {
    pw, ph, tMin: lo, tMax: hi,
    X: (i) => PAD.l + (i / Math.max(1, n - 1)) * pw,
    YT: (c) => PAD.t + ((hi - c) / (hi - lo)) * ph,
    YS: (pct) => PAD.t + ((100 - pct) / 100) * ph,
  };
}

function drawBase(ctx: CanvasRenderingContext2D, w: number, h: number, r: MissionResult, labels: Record<string, string>): void {
  const s = scale(w, h, r);
  if (!s) return;
  const th = r.adv.thermal;
  const cap = Math.max(1, r.input.power.batteryCapacityWh);
  const n = r.count;

  // sunlight strip and heater band
  for (let px = 0; px < s.pw; px++) {
    const i = Math.min(n - 1, Math.round((px / s.pw) * (n - 1)));
    if (r.sunFrac[i] <= 0) {
      ctx.fillStyle = 'rgba(100,116,139,0.10)';
      ctx.fillRect(PAD.l + px, PAD.t, 1, s.ph);
    }
    if (th && th.heaterW[i] > 0) {
      ctx.fillStyle = `rgba(245,158,11,${0.12 + 0.3 * Math.min(1, th.heaterW[i] / Math.max(1, r.input.thermal?.heaterW ?? 80))})`;
      ctx.fillRect(PAD.l + px, PAD.t + s.ph - 10, 1, 10);
    }
  }

  // grid and axes
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  for (let c = Math.ceil(s.tMin / 10) * 10; c <= s.tMax; c += 10) {
    const y = Math.round(s.YT(c)) + 0.5;
    ctx.strokeStyle = C.lineSoft;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + s.pw, y); ctx.stroke();
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'left';
    ctx.fillText(currentUnits().cSigned(c, 0), PAD.l + s.pw + 6, y);
  }
  ctx.textAlign = 'right';
  for (let p = 0; p <= 100; p += 25) {
    ctx.fillStyle = C.sun;
    ctx.fillText(`${p} %`, PAD.l - 6, s.YS(p));
  }

  // thresholds
  const line = (c: number, colour: string, text: string, below: boolean): void => {
    const y = Math.round(s.YT(c)) + 0.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = colour;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + s.pw, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `10px ${FONT_UI}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = below ? 'top' : 'bottom';
    ctx.fillStyle = colour;
    ctx.fillText(text, PAD.l + s.pw - 6, below ? y + 3 : y - 2);
  };
  if (th) {
    line((r.input.thermal?.heaterSetpointK ?? T_FREEZE_K) - 273.15, 'rgba(245,158,11,0.75)', labels.setpoint, false);
    line(T_BATTERY_DEATH_K - 273.15, 'rgba(239,68,68,0.9)', labels.freeze, true);
  }

  // array power, as a share of its peak, filled
  let peak = 0;
  for (let i = 0; i < n; i++) if (r.powerW[i] > peak) peak = r.powerW[i];
  if (peak > 0) {
    ctx.beginPath();
    ctx.moveTo(s.X(0), s.YS(0));
    for (let i = 0; i < n; i++) ctx.lineTo(s.X(i), s.YS((100 * r.powerW[i]) / peak));
    ctx.lineTo(s.X(n - 1), s.YS(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(245,158,11,0.13)';
    ctx.fill();
    ctx.font = `10px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(245,158,11,0.9)';
    ctx.fillText(`${labels.power} · 100 % = ${peak.toFixed(0)} W`, PAD.l + 6, PAD.t + s.ph - 4);
  }

  // state of charge
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = s.X(i), y = s.YS((100 * r.battery.socWh[i]) / cap);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = C.sun;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  if (th) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, s.pw, s.ph);
    ctx.clip();
    // sink temperature (only the part inside the plotted range is informative)
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = s.X(i), y = s.YT(th.tEnvK[i] - 273.15);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(115,133,160,0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // bus temperature
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = s.X(i), y = s.YT(th.tBusK[i] - 273.15);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#E6EDF7';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
    if (th.thermalDeathIndex >= 0) {
      const x = Math.round(s.X(th.thermalDeathIndex)) + 0.5;
      ctx.fillStyle = 'rgba(239,68,68,0.12)';
      ctx.fillRect(x, PAD.t, PAD.l + s.pw - x, s.ph);
      ctx.strokeStyle = C.crit;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + s.ph); ctx.stroke();
      ctx.font = `700 10.5px ${FONT_UI}`;
      ctx.textBaseline = 'top';
      const right = x + 8 + ctx.measureText(labels.death).width < PAD.l + s.pw;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.fillStyle = C.crit;
      ctx.fillText(labels.death, right ? x + 6 : x - 6, PAD.t + 4);
    }
  } else {
    ctx.font = `11px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.dim;
    ctx.fillText(labels.off, PAD.l + s.pw / 2, PAD.t + s.ph / 2);
  }
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD.l + 0.5, PAD.t + 0.5, s.pw - 1, s.ph - 1);
}

function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, r: MissionResult, cursorHours: number): void {
  const s = scale(w, h, r);
  if (!s) return;
  const idx = Math.max(0, Math.min(r.count - 1, cursorHours / r.stepHours));
  const i = Math.round(idx);
  const x = Math.round(s.X(idx)) + 0.5;
  ctx.strokeStyle = '#E6EDF7';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, PAD.t + s.ph); ctx.stroke();
  const th = r.adv.thermal;
  const cap = Math.max(1, r.input.power.batteryCapacityWh);
  const parts = [fmtDateTime(r.eph.startMs + idx * r.stepHours * HOUR_MS), `array ${r.powerW[i].toFixed(0)} W`, `SoC ${((100 * r.battery.socWh[i]) / cap).toFixed(0)} %`];
  if (th) parts.push(`bus ${currentUnits().c(th.tBusK[i] - 273.15, 1)}`, `env ${currentUnits().k(th.tEnvK[i])}`, `heater ${th.heaterW[i].toFixed(0)} W`);
  const text = parts.join('   ');
  ctx.font = `10.5px ${FONT_MONO}`;
  const tw = ctx.measureText(text).width + 12;
  const tx = Math.min(Math.max(PAD.l, x - tw / 2), PAD.l + s.pw - tw);
  ctx.fillStyle = 'rgba(8,11,17,0.94)';
  ctx.fillRect(tx, h - PAD.b + 3, tw, 17);
  ctx.fillStyle = '#E6EDF7';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, tx + 6, h - PAD.b + 12);
}

export function ThermalChart({ data }: { data: ScenarioData }) {
  const t = useT();
  const u = useUnits();
  const r = data.result;
  const labels = {
    setpoint: t('heaters on below this', 'calefactores encendidos bajo esto'),
    freeze: t(`battery freezes: ${u.c(-20)}`, `la batería se congela: ${u.c(-20)}`),
    death: t('CRITICAL THERMAL DEATH', 'MUERTE TÉRMICA CRÍTICA'),
    off: t('Thermal model switched off: only the state of charge is shown', 'Modelo térmico apagado: solo se muestra el estado de carga'),
    power: t('array power', 'potencia del panel'),
  };
  const { ref } = useCanvas({
    base: (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = C.panel;
      ctx.fillRect(0, 0, w, h);
      if (r) drawBase(ctx, w, h, r, labels);
    },
    overlay: (ctx, w, h, cursor) => { if (r) drawOverlay(ctx, w, h, r, cursor); },
  }, [r, labels.death]);

  return (
    <section className="panel thermal" aria-label={t('Battery and bus temperature', 'Batería y temperatura del bus')}>
      <header className="panel-head">
        <h2><ScenarioBadge k={data.key} />{t('Power, battery and bus temperature', 'Potencia, batería y temperatura del bus')}</h2>
        <ul className="legend legend-inline">
          <li><i className="sw sw-power" />{t('Array power', 'Potencia del panel')}</li>
          <li><i className="sw sw-sun" />{t('State of charge', 'Estado de carga')}</li>
          <li><i className="sw sw-bus" />{t('Bus temperature', 'Temperatura del bus')}</li>
          <li><i className="sw sw-env" />{t('Surroundings', 'Entorno')}</li>
          <li><i className="sw sw-heater" />{t('Heaters on', 'Calefactores encendidos')}</li>
        </ul>
      </header>
      <canvas ref={ref} className="thermal-canvas" data-testid="thermal-chart" />
    </section>
  );
}
