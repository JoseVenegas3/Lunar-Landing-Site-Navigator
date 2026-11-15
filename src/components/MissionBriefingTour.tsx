/**
 * Tutorial mode: a fixed script that drives the real interface.
 *
 * "Mission guide" in the top bar first shows a light notice (not a modal):
 * the app will change tabs, site and date by itself and can be left at any
 * time with Esc. Once started, each step sets the console up (subsystem,
 * site, date, overlay, mode), spotlights the control it talks about and
 * explains it. Leaving or finishing restores the user's previous state.
 *
 * First visit: a control-room greeting in the bottom-right corner offers the
 * same tutorial or a direct start; the choice is remembered. The spotlight
 * dims the screen without catching the pointer. Keys: right arrow next, left
 * arrow back, Escape to leave.
 */
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CANDIDATE_SITES, RELOCATION_LIMIT_M } from '../engine';
import { AppState, useApp } from '../state/store';
import { useT } from '../lib/format';
import { cancelSubsystemSwitch, requestSubsystem } from './dashboard/SubsystemSwitch';

interface Step {
  title: [string, string];
  body: [string, string];
  /** Element to spotlight, or a function returning a rectangle (the lander on screen). */
  target: () => DOMRect | null;
  /** Drive the interface to what the step talks about. */
  apply: () => void;
}

const rectOf = (sel: string): DOMRect | null => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};
const union = (...rs: (DOMRect | null)[]): DOMRect | null => {
  const ok = rs.filter((r): r is DOMRect => r !== null);
  if (ok.length === 0) return null;
  const l = Math.min(...ok.map((r) => r.left)), t = Math.min(...ok.map((r) => r.top));
  return new DOMRect(l, t, Math.max(...ok.map((r) => r.right)) - l, Math.max(...ok.map((r) => r.bottom)) - t);
};
/** The part of `r` visible inside `box` (a block scrolled inside a tray). */
const clip = (r: DOMRect | null, box: DOMRect | null): DOMRect | null => {
  if (!r || !box) return r;
  const l = Math.max(r.left, box.left), t = Math.max(r.top, box.top), rr = Math.min(r.right, box.right), b = Math.min(r.bottom, box.bottom);
  return rr > l && b > t ? new DOMRect(l, t, rr - l, b - t) : null;
};
const app = (): AppState => useApp.getState();
const RIDGE = CANDIDATE_SITES[0].id;
const MALAPERT = CANDIDATE_SITES[1].id;
const TOUR_START = Date.UTC(2027, 8, 1);

/** Planner on a known site and date, so every run of the tutorial shows the same thing. */
function plannerOn(subsystem: Parameters<typeof requestSubsystem>[0]): void {
  const s = app();
  if (s.mode !== 'planner') s.setMode('planner');
  if (s.subsystem !== subsystem) requestSubsystem(subsystem);
}

export const TUTORIAL: Step[] = [
  {
    title: ['The south pole in 3-D', 'El polo sur en 3D'],
    body: [
      'Real LOLA terrain around the Shackleton connecting ridge. Drag to orbit and scroll to zoom. The Sun never climbs more than a couple of degrees here, so every hill casts a shadow kilometres long.',
      'Terreno LOLA real alrededor de la cresta de Shackleton. Arrastra para orbitar y usa la rueda para acercar. Aquí el Sol nunca sube más de un par de grados, así que cada loma proyecta una sombra de kilómetros.',
    ],
    target: () => rectOf('[data-testid="deck"]') ?? rectOf('[data-testid="scene"]'),
    apply: () => {
      const s = app();
      if (s.compare) s.setCompare(false);
      s.setPlaying(false);
      s.updateScenario('A', { siteId: RIDGE, startMs: TOUR_START, days: 60, dxM: 0, dyM: 0 });
      s.setCursor(96);
      s.setView('orbit');
      plannerOn('overview');
      s.setOverlay('none');
    },
  },
  {
    title: ['Double-click to land', 'Doble clic para alunizar'],
    body: [
      `Drag the lander inside the dashed box, or double-click the ground: within ±${RELOCATION_LIMIT_M} m it moves the lander, farther away it creates a custom site. The reticle under the pointer says which one will happen before you click.`,
      `Arrastra el lander dentro del cuadro punteado, o haz doble clic en el suelo: a ±${RELOCATION_LIMIT_M} m mueve el lander, más lejos crea un sitio propio. El retículo bajo el cursor dice cuál de las dos ocurrirá antes de hacer clic.`,
    ],
    target: () => {
      const p = window.__clps?.landerScreen();
      return union(p ? new DOMRect(p.x - 46, p.y - 46, 92, 92) : null, rectOf('[data-testid="dbl-hint"]')) ?? rectOf('[data-testid="scene"]');
    },
    apply: () => { app().setPlaying(false); plannerOn('overview'); },
  },
  {
    title: ['Time transport', 'Control de tiempo'],
    body: [
      'Play runs the mission clock: the shadows sweep and the Earth wobbles over the horizon. ±1 h steps by the hour; 1, 24 and 72 h/s set the pace. The date and the time since touchdown are on the clock of the top bar.',
      'Reproducir hace correr el reloj de la misión: las sombras barren el suelo y la Tierra se mece sobre el horizonte. ±1 h avanza por horas; 1, 24 y 72 h/s fijan el ritmo. La fecha y el tiempo desde el alunizaje están en el reloj de la barra superior.',
    ],
    target: () => union(rectOf('[data-testid="transport"]'), rectOf('[data-testid="clock"]')),
    apply: () => { const s = app(); plannerOn('overview'); s.setSpeed(24); s.setPlaying(true); },
  },
  {
    title: ['Subsystems: Power / thermal', 'Subsistemas: Energía / térmico'],
    body: [
      'Five tabs, one console each. Power / thermal turns amber: the terrain shows the hours of sunlight, a solid shaft marks the Sun, and the chart below draws the array power, the battery and the bus temperature.',
      'Cinco pestañas, una consola cada una. Energía / térmico se vuelve ámbar: el terreno muestra las horas de sol, un haz sólido marca el Sol y el gráfico de abajo dibuja la potencia del panel, la batería y la temperatura del bus.',
    ],
    target: () => rectOf('[data-testid="subsys-bar"]'),
    apply: () => { app().setPlaying(false); plannerOn('power'); },
  },
  {
    title: ['Comms / RF', 'Comunicaciones / RF'],
    body: [
      'Cyan: the beam to the Earth is in focus, the terrain shows how much of the time the Earth is in view, and the right tray gives the link budget with the ridges between the lander and the Earth.',
      'Cian: el haz hacia la Tierra pasa al frente, el terreno muestra cuánto tiempo se ve la Tierra y la bandeja derecha da el presupuesto de enlace con las crestas entre el lander y la Tierra.',
    ],
    target: () => union(rectOf('[data-testid="subsys-comms"]'), rectOf('[data-testid="drawer-right"]')),
    apply: () => plannerOn('comms'),
  },
  {
    title: ['Terrain / landing', 'Terreno / alunizaje'],
    body: [
      'The slopes are coloured on the ground. On the right, the landing dispersion: 25 full missions within 200 m of the aim point, the best cell with its escape vector, and how much the answer depends on the error of the terrain model. The emergency flow is in the Emergency mode.',
      'Las pendientes se colorean sobre el suelo. A la derecha, la dispersión de alunizaje: 25 misiones completas a 200 m del punto de mira, la mejor celda con su vector de escape y cuánto depende la respuesta del error del modelo de terreno. El flujo de emergencia está en el modo Emergencia.',
    ],
    target: () => union(rectOf('[data-testid="subsys-terrain"]'), rectOf('[data-testid="drawer-right"]')),
    apply: () => plannerOn('terrain'),
  },
  {
    title: ['Science and the engineering view', 'Ciencia y la vista de ingeniería'],
    body: [
      'Science gives the 0–100 suitability index with the orbital data behind it. Its "Engineering view" tab holds the full KPI table, and the timeline of this console is the detailed one: a row per ground station, the relay and simultaneous operations.',
      'Ciencia da el índice de aptitud de 0 a 100 con los datos orbitales detrás. Su pestaña «Vista de ingeniería» tiene la tabla completa de KPI, y la línea de tiempo de esta consola es la detallada: una fila por estación, el relay y la operación simultánea.',
    ],
    target: () => union(rectOf('[data-testid="subsys-science"]'), rectOf('[data-testid="drawer-right"]')),
    apply: () => {
      plannerOn('science');
      window.setTimeout(() => { if (app().subsystem === 'science') app().openPanel('engineering'); }, 950);
    },
  },
  {
    title: ['Landing windows and comparison', 'Ventanas de aterrizaje y comparación'],
    body: [
      'Which touchdown dates work, and why the others fail. At the bottom, "Compare" creates a second scenario: here Malapert Massif against the Shackleton ridge, with the quick bars and the full table. Switched off, the second scenario disappears.',
      'Qué fechas de contacto sirven y por qué fallan las demás. Al final, «Comparar» crea un segundo escenario: aquí el macizo Malapert frente a la cresta de Shackleton, con las barras rápidas y la tabla completa. Al apagarlo, el segundo escenario desaparece.',
    ],
    target: () => clip(rectOf('[data-testid="compare-block"]'), rectOf('[data-testid="drawer-right"]')) ?? rectOf('[data-testid="drawer-right"]'),
    apply: () => {
      plannerOn('overview');
      const s = app();
      if (!s.compare) s.setCompare(true);
      s.updateScenario('B', { siteId: MALAPERT });
      window.setTimeout(() => {
        if (app().subsystem !== 'overview') return;
        app().openPanel('windows');
        window.setTimeout(() => document.querySelector('[data-testid="compare-block"]')?.scrollIntoView({ block: 'start' }), 120);
      }, 950);
    },
  },
  {
    title: ['Emergency mode', 'Modo Emergencia'],
    body: [
      'For a lander already on the ground somewhere unplanned. The same flow as the Terrain console, evaluated from now: where it is, how much energy is left, how long it has and where to move. The green arrow on the terrain is the escape vector.',
      'Para un lander ya en el suelo en un lugar no previsto. El mismo flujo que la consola de Terreno, evaluado desde ahora: dónde está, cuánta energía queda, cuánto tiempo tiene y hacia dónde moverse. La flecha verde sobre el terreno es el vector de escape.',
    ],
    target: () => rectOf('[data-testid="triage"] .tri-right') ?? rectOf('[data-testid="triage"]'),
    apply: () => { cancelSubsystemSwitch(); const s = app(); s.setActive('A'); s.setMode('triage'); },
  },
  {
    title: ['Export the telemetry', 'Exportar la telemetría'],
    body: [
      'One click downloads the simulated telemetry of the mission on screen: a CSV with 26 columns in SI units, one row per hour, for the ground-station tools. When this tutorial ends, the app returns to where you were.',
      'Un clic descarga la telemetría simulada de la misión en pantalla: un CSV con 26 columnas en unidades SI, una fila por hora, para las herramientas de la estación terrena. Al terminar este tutorial, la app vuelve a donde estabas.',
    ],
    target: () => rectOf('[data-testid="export-csv"]'),
    apply: () => plannerOn('overview'),
  },
];

/** What the tutorial may change, saved when it starts and put back when it ends. */
let saved: Partial<AppState> | null = null;

function snapshot(): void {
  const s = useApp.getState();
  const keep: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (typeof v !== 'function' && k !== 'lang' && k !== 'briefing') keep[k] = v;
  saved = keep as Partial<AppState>;
}

function restore(): void {
  cancelSubsystemSwitch();
  if (saved) useApp.setState(saved);
  saved = null;
}

export function startTutorial(): void {
  snapshot();
  useApp.getState().setBriefing(0);
}

/** Leave the tutorial (Esc, Exit or Finish): back to the user's state. */
export function endTutorial(): void {
  restore();
  useApp.getState().setBriefing('off');
}

const CARD_W = 360;

function placeCard(r: DOMRect | null, h: number): CSSProperties {
  const vw = window.innerWidth, vh = window.innerHeight, gap = 14, pad = 12;
  if (!r) return { right: pad, bottom: pad };
  const fits = (x: number, y: number): boolean => x >= pad && y >= pad && x + CARD_W <= vw - pad && y + h <= vh - pad;
  const cx = Math.min(Math.max(pad, r.left + r.width / 2 - CARD_W / 2), vw - CARD_W - pad);
  const options: [number, number][] = [
    [cx, r.bottom + gap], [cx, r.top - gap - h], [r.right + gap, r.top], [r.left - gap - CARD_W, r.top],
    // big targets: inside their bottom-left, then bottom-right corner
    [r.left + gap, r.bottom - h - gap], [r.right - CARD_W - gap, r.bottom - h - gap],
  ];
  const hit = options.find(([x, y]) => fits(x, y));
  return hit ? { left: hit[0], top: hit[1] } : { right: pad, bottom: pad };
}

export function MissionBriefingTour() {
  const t = useT();
  const briefing = useApp((s) => s.briefing);
  const setBriefing = useApp((s) => s.setBriefing);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardH, setCardH] = useState(200);
  const card = useRef<HTMLDivElement>(null);
  const step = typeof briefing === 'number' ? briefing : -1;
  const n = TUTORIAL.length;

  // Each step drives the interface to what it talks about.
  useEffect(() => { if (step >= 0) TUTORIAL[step].apply(); }, [step]);

  // Follow the target while the step is on screen (panels resize, the lander moves with the camera).
  useEffect(() => {
    if (step < 0) return;
    let raf = 0, last = '';
    const tick = (): void => {
      const r = TUTORIAL[step].target();
      const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) { last = key; setRect(r); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => { if (card.current) setCardH(card.current.offsetHeight); }, [step, briefing]);

  useEffect(() => {
    if (briefing === 'off' || briefing === 'offer') return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (briefing === 'confirm') {
        if (e.key === 'Escape') setBriefing('off');
        return;
      }
      if (e.key === 'Escape') endTutorial();
      else if (e.key === 'ArrowRight') { if (step + 1 < n) setBriefing(step + 1); else endTutorial(); }
      else if (e.key === 'ArrowLeft' && step > 0) setBriefing(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [briefing, step, n, setBriefing]);

  if (briefing === 'off') return null;

  if (briefing === 'offer') {
    return (
      <div className="brief-card brief-offer" role="region" aria-label={t('Mission briefing', 'Inducción de misión')} data-testid="briefing-offer">
        <span className="brief-tag mono">GISAT UdeC · {t('MISSION CONTROL', 'CONTROL DE MISIÓN')}</span>
        <p>{t('CLPS Lunar Mission Browser v2.0 initialised. Start the guided mission tour? The app will drive itself for about a minute.', 'CLPS Lunar Mission Browser v2.0 inicializado. ¿Desea iniciar el recorrido guiado de misión? La app se conducirá sola durante un minuto.')}</p>
        <div className="brief-actions">
          <button type="button" className="btn btn-small" onClick={() => setBriefing('off')} data-testid="briefing-skip">{t('Skip / direct access', 'Omitir / acceso directo')}</button>
          <button type="button" className="btn btn-small btn-brief" onClick={startTutorial} data-testid="briefing-start">{t('Start check', 'Iniciar chequeo')}</button>
        </div>
      </div>
    );
  }

  if (briefing === 'confirm') {
    return (
      <div className="brief-card brief-confirm" role="region" aria-label={t('Tutorial mode', 'Modo tutorial')} data-testid="briefing-confirm">
        <span className="brief-tag mono">{t('TUTORIAL MODE', 'MODO TUTORIAL')}</span>
        <p>{t('A predetermined sequence will start: the app will change tabs, site and date by itself. You can leave at any time (Esc), and your current state comes back when it ends.', 'Se abrirá una secuencia predeterminada: la app cambiará de pestañas, sitio y fecha por sí sola. Podrás salir en cualquier momento (Esc), y al terminar vuelve tu estado actual.')}</p>
        <div className="brief-actions">
          <button type="button" className="btn btn-small" onClick={() => setBriefing('off')} data-testid="briefing-cancel">{t('Cancel', 'Cancelar')}</button>
          <button type="button" className="btn btn-small btn-brief" onClick={startTutorial} data-testid="briefing-go">{t('Start', 'Iniciar')}</button>
        </div>
      </div>
    );
  }

  const s = TUTORIAL[step];
  const pad = 6;
  return (
    <>
      <div
        className="brief-spot" aria-hidden="true"
        style={rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad } : { left: '50%', top: '50%', width: 0, height: 0 }}
      />
      <div className="brief-card" ref={card} role="dialog" aria-label={t('Tutorial mode', 'Modo tutorial')} style={placeCard(rect, cardH)} data-testid="briefing-step" data-step={step + 1}>
        <span className="brief-tag mono">{t('TUTORIAL', 'TUTORIAL')} · {t('STEP', 'PASO')} {step + 1}/{n}</span>
        <div className="brief-progress" aria-hidden="true"><i style={{ transform: `scaleX(${(step + 1) / n})` }} /></div>
        <h3>{t(...s.title)}</h3>
        <p>{t(...s.body)}</p>
        <div className="brief-actions">
          <button type="button" className="btn btn-small" onClick={endTutorial} data-testid="briefing-exit">{t('Exit (Esc)', 'Salir (Esc)')}</button>
          {step > 0 && <button type="button" className="btn btn-small" onClick={() => setBriefing(step - 1)}>{t('Back', 'Atrás')}</button>}
          <button type="button" className="btn btn-small btn-brief" onClick={() => (step + 1 < n ? setBriefing(step + 1) : endTutorial())} data-testid="briefing-next">
            {step + 1 < n ? t('Next →', 'Siguiente →') : t('Finish', 'Terminar')}
          </button>
        </div>
      </div>
    </>
  );
}
