/**
 * Mission briefing: a five-step guided tour that spotlights the real controls.
 *
 * First visit: a control-room greeting in the bottom-right corner offers the
 * tour or a direct start; the choice is remembered. The "Mission guide"
 * button of the top bar relaunches it. The spotlight dims the rest of the
 * screen without catching the pointer, so the scene stays usable throughout.
 * Keys: right arrow next, left arrow back, Escape to leave.
 */
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RELOCATION_LIMIT_M } from '../engine';
import { useApp } from '../state/store';
import { useT } from '../lib/format';

interface Step {
  title: [string, string];
  body: [string, string];
  /** Element to spotlight, or a function returning a rectangle (the lander on screen). */
  target: () => DOMRect | null;
  /** Prepare the console for the step (open the panel it talks about). */
  prepare?: () => void;
}

const rectOf = (sel: string): DOMRect | null => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};

const STEPS: Step[] = [
  {
    title: ['The south pole in 3-D', 'El polo sur en 3D'],
    body: [
      'Real LOLA terrain around the landing site. Drag to orbit, scroll to zoom. The Sun never climbs more than a couple of degrees here, so every hill casts a shadow kilometres long: that is what kills landers.',
      'Terreno LOLA real alrededor del sitio. Arrastra para orbitar y usa la rueda para acercar. Aquí el Sol nunca sube más de un par de grados, así que cada loma proyecta una sombra de kilómetros: eso es lo que mata a los landers.',
    ],
    target: () => rectOf('[data-testid="deck"]') ?? rectOf('[data-testid="scene"]'),
  },
  {
    title: ['Micro-relocation of the lander', 'Micro-reubicación del lander'],
    body: [
      `Drag the lander inside the dashed box (±${RELOCATION_LIMIT_M} m). Every position is a new mission: sunlight, Earth contact and survival update at once. Double-click the ground to jump further.`,
      `Arrastra el lander dentro del cuadro punteado (±${RELOCATION_LIMIT_M} m). Cada posición es una misión nueva: luz, contacto con la Tierra y supervivencia se recalculan al instante. Doble clic en el suelo para saltar más lejos.`,
    ],
    target: () => {
      const p = window.__clps?.landerScreen();
      return p ? new DOMRect(p.x - 46, p.y - 46, 92, 92) : rectOf('[data-testid="scene"]');
    },
  },
  {
    title: ['Subsystem selector', 'Selector de subsistemas'],
    body: [
      'The console adapts to the subsystem you pick: Power turns amber and shows the solar vector and the energy curve, Comms turns cyan and puts the Earth beam in focus, Terrain colours the slopes and shows the escape vector.',
      'La consola se adapta al subsistema elegido: Energía se vuelve ámbar y muestra el vector solar y la curva de energía, Comunicaciones se vuelve cian y enfoca el haz a la Tierra, Terreno colorea las pendientes y muestra el vector de escape.',
    ],
    target: () => rectOf('[data-testid="subsys-bar"] .subsys-list'),
  },
  {
    title: ['Timeline: the golden windows', 'Línea de tiempo: las ventanas de oro'],
    body: [
      'Each row is the whole window. Amber is sunlight, cyan is the Earth above the terrain, and green is both at once: the golden windows when the lander has power and can talk home. Drag along it to move in time; the horizon view in Comms shows the same paths around the skyline.',
      'Cada fila es la ventana completa. Ámbar es luz solar, cian es la Tierra sobre el relieve y verde es ambas a la vez: las ventanas de oro en que el lander tiene energía y puede hablar con casa. Arrastra sobre ella para moverte en el tiempo; la vista de horizonte en Comunicaciones muestra las mismas trayectorias.',
    ],
    target: () => rectOf('[data-testid="drawer-bottom"]'),
    prepare: () => {
      const s = useApp.getState();
      if (s.panels.bottomTab !== 'timeline') s.openPanel('timeline');
    },
  },
  {
    title: ['Verdict and auto-escape', 'Veredicto y auto-escape'],
    body: [
      'The bar on top says GO, CAUTION or NO-GO in plain words. When it is not green, the lightning button tries every point within 200 m and the following dates, and moves the lander to the first one that survives. The Emergency mode does the same for an unplanned touchdown anywhere in the cap.',
      'La barra superior dice VIABLE, RIESGO o CRÍTICO en palabras simples. Si no está en verde, el botón del rayo prueba cada punto a 200 m y las fechas siguientes, y mueve el lander al primero que sobrevive. El modo Emergencia hace lo mismo para un alunizaje imprevisto en cualquier punto del casquete.',
    ],
    target: () => rectOf('[data-testid="verdict-fix"]') ?? rectOf('[data-testid="verdict"]'),
  },
];

const CARD_W = 348;

function placeCard(r: DOMRect | null, h: number): CSSProperties {
  const vw = window.innerWidth, vh = window.innerHeight, gap = 14, pad = 12;
  if (!r) return { right: pad, bottom: pad };
  const fits = (x: number, y: number): boolean => x >= pad && y >= pad && x + CARD_W <= vw - pad && y + h <= vh - pad;
  const cx = Math.min(Math.max(pad, r.left + r.width / 2 - CARD_W / 2), vw - CARD_W - pad);
  const options: [number, number][] = [
    [cx, r.bottom + gap], [cx, r.top - gap - h], [r.right + gap, r.top], [r.left - gap - CARD_W, r.top],
    // big targets: inside their bottom-right corner
    [r.right - CARD_W - gap, r.bottom - h - gap],
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

  useEffect(() => { if (step >= 0) STEPS[step].prepare?.(); }, [step]);

  // Follow the target while the step is on screen (panels resize, the lander moves with the camera).
  useEffect(() => {
    if (step < 0) return;
    let raf = 0, last = '';
    const tick = (): void => {
      const r = STEPS[step].target();
      const key = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
      if (key !== last) { last = key; setRect(r); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useLayoutEffect(() => { if (card.current) setCardH(card.current.offsetHeight); }, [step, briefing]);

  useEffect(() => {
    if (step < 0) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') setBriefing('off');
      else if (e.key === 'ArrowRight') setBriefing(step + 1 < STEPS.length ? step + 1 : 'off');
      else if (e.key === 'ArrowLeft' && step > 0) setBriefing(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, setBriefing]);

  if (briefing === 'off') return null;

  if (briefing === 'offer') {
    return (
      <div className="brief-card brief-offer" role="region" aria-label={t('Mission briefing', 'Inducción de misión')} data-testid="briefing-offer">
        <span className="brief-tag mono">GISAT UdeC · {t('MISSION CONTROL', 'CONTROL DE MISIÓN')}</span>
        <p>{t('CLPS Lunar Mission Browser v4 initialised. Start the mission induction sequence (45 s)?', 'CLPS Lunar Mission Browser v4 inicializado. ¿Desea iniciar la secuencia de inducción de misión (45 s)?')}</p>
        <div className="brief-actions">
          <button type="button" className="btn btn-small" onClick={() => setBriefing('off')} data-testid="briefing-skip">{t('Skip / direct access', 'Omitir / acceso directo')}</button>
          <button type="button" className="btn btn-small btn-brief" onClick={() => setBriefing(0)} data-testid="briefing-start">{t('Start check', 'Iniciar chequeo')}</button>
        </div>
      </div>
    );
  }

  const s = STEPS[step];
  const pad = 6;
  return (
    <>
      <div
        className="brief-spot" aria-hidden="true"
        style={rect ? { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad } : { left: '50%', top: '50%', width: 0, height: 0 }}
      />
      <div className="brief-card" ref={card} role="dialog" aria-label={t('Mission briefing', 'Inducción de misión')} style={placeCard(rect, cardH)} data-testid="briefing-step" data-step={step + 1}>
        <span className="brief-tag mono">{t('STEP', 'PASO')} {step + 1}/{STEPS.length}</span>
        <div className="brief-progress" aria-hidden="true"><i style={{ transform: `scaleX(${(step + 1) / STEPS.length})` }} /></div>
        <h3>{t(...s.title)}</h3>
        <p>{t(...s.body)}</p>
        <div className="brief-actions">
          <button type="button" className="btn btn-small" onClick={() => setBriefing('off')} data-testid="briefing-exit">{t('Exit (Esc)', 'Salir (Esc)')}</button>
          {step > 0 && <button type="button" className="btn btn-small" onClick={() => setBriefing(step - 1)}>{t('Back', 'Atrás')}</button>}
          <button type="button" className="btn btn-small btn-brief" onClick={() => setBriefing(step + 1 < STEPS.length ? step + 1 : 'off')} data-testid="briefing-next">
            {step + 1 < STEPS.length ? t('Next →', 'Siguiente →') : t('Finish', 'Terminar')}
          </button>
        </div>
      </div>
    </>
  );
}
