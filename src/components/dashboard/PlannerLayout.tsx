/**
 * Mission Planner: a contextual console.
 *
 * The 3-D view fills the workspace. A subsystem selector (overview, power,
 * communications, terrain, science) decides which panels float over it, the
 * accent colour of the console, the coverage layer on the terrain and what the
 * scene emphasises. Panels are glass trays docked to the edges: they never
 * resize the canvas and never cover the middle of it, so the lander can be
 * dragged at all times. No modal dialogs.
 */
import { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { SceneView } from '../3d/SceneView';
import { useSceneUi } from '../3d/sceneMath';
import { useActiveScenario, useMission } from '../../state/mission';
import { BottomTab, LeftTab, PanelId, RightTab, SUBSYSTEMS, useApp } from '../../state/store';
import { SubsystemCurtain, SubsystemTabs } from './SubsystemSwitch';

export { subsystemLabel } from './SubsystemSwitch';
import { useT } from '../../lib/format';
import { VerdictCard } from '../VerdictCard';
import { VitalCards } from '../VitalCards';
import { ContingencyPanel } from './ContingencyPanel';
import { HorizonPanorama } from './HorizonPanorama';
import { LinkBudgetCard } from './KpiMatrix';
import { EngineeringView } from './EngineeringView';
import { QuickCompare } from './QuickCompare';
import { Readout } from './Readout';
import { HardwarePanel, SitesPanel } from './ScenarioPanel';
import { ScorePanel } from './ScorePanel';
import { SurvivalPanel } from './SurvivalPanel';
import { ThermalChart } from './ThermalChart';
import { Timeline } from './Timeline';
import { WindowsPanel } from './WindowsPanel';

type T = (en: string, es: string) => string;

function panelLabel(id: PanelId, t: T, subsystem?: string): string {
  if (id === 'timeline' && subsystem === 'science') return t('Detailed timeline', 'Línea de tiempo detallada');
  return {
    sites: t('Sites and dates', 'Sitios y fechas'),
    hardware: t('Hardware', 'Equipo'),
    contingency: t('Attitude and tip-over', 'Actitud y vuelco'),
    vitals: t('Vitals', 'Signos vitales'),
    compare: t('Compare A/B', 'Comparar A/B'),
    windows: t('Landing dates', 'Fechas'),
    energy: t('Energy and survival', 'Energía y supervivencia'),
    link: t('Link budget', 'Presupuesto de enlace'),
    survival: t('Dispersion and escape', 'Dispersión y escape'),
    score: t('Suitability index', 'Índice de aptitud'),
    engineering: t('Engineering view', 'Vista de ingeniería'),
    timeline: t('Mission windows', 'Ventanas de misión'),
    horizon: t('Horizon 360°', 'Horizonte 360°'),
    thermal: t('Power and temperature', 'Potencia y temperatura'),
  }[id];
}

function panelHint(id: PanelId, t: T): string {
  return {
    sites: t('Where and when each scenario lands. A and B are compared side by side.', 'Dónde y cuándo aluniza cada escenario. A y B se comparan lado a lado.'),
    hardware: t('Solar panels, battery, heaters, radio and relays. Bigger panels and battery survive longer shadows.', 'Paneles, batería, calefactores, radio y relays. Paneles y batería más grandes resisten sombras más largas.'),
    contingency: t('What happens if the lander ends up tilted, tips over, or lands next to another vehicle.', 'Qué pasa si el lander queda inclinado, vuelca o aluniza junto a otro vehículo.'),
    vitals: t('Hours of sunlight left, whether the Earth is reachable, and the time until the battery freezes, from the time on the clock.', 'Horas de sol restantes, si la Tierra está al alcance y el tiempo hasta que se congele la batería, desde la hora del reloj.'),
    compare: t('The two scenarios side by side in four bars. The full table is in Science, Engineering view.', 'Los dos escenarios lado a lado en cuatro barras. La tabla completa está en Ciencia, Vista de ingeniería.'),
    windows: t('Which landing dates work, and what rules out the others.', 'Qué fechas de alunizaje sirven y qué descarta a las demás.'),
    energy: t('Whether the battery and the electronics get through the cold of the shadows.', 'Si la batería y la electrónica resisten el frío de las sombras.'),
    link: t('Whether the radio signal reaches the Earth: power, distance, antenna, mountains in the way.', 'Si la señal de radio llega a la Tierra: potencia, distancia, antena y montañas en el camino.'),
    survival: t('25 touchdown points within 200 m, the escape vector, and how much the answer depends on terrain errors.', '25 puntos de contacto a 200 m, el vector de escape y cuánto depende la respuesta del error del terreno.'),
    engineering: t('Every KPI of the mission in one table, with the detailed timeline below: one row per ground station, the relay and simultaneous operations.', 'Todos los KPI de la misión en una tabla, con la línea de tiempo detallada abajo: una fila por estación terrena, el relay y las operaciones simultáneas.'),
    score: t('A single 0–100 mark that weighs sunlight, Earth view, slope and science interest, with the orbital layers behind it.', 'Una nota de 0 a 100 que pondera luz, vista a la Tierra, pendiente e interés científico, con las capas orbitales detrás.'),
    timeline: t('Sun, Earth and both at once over the window. Green is the golden window.', 'Sol, Tierra y ambos a la vez en la ventana. El verde es la ventana de oro.'),
    horizon: t('The skyline all around the lander with the paths of the Sun and the Earth.', 'El horizonte alrededor del lander con las trayectorias del Sol y la Tierra.'),
    thermal: t('Array power, battery charge and bus temperature against time.', 'Potencia del panel, carga de batería y temperatura del bus en el tiempo.'),
  }[id];
}

/** A "(?)" that explains a panel or a parameter in one sentence. */
export function Hint({ text }: { text: string }) {
  return <span className="hint" tabIndex={0} role="note" aria-label={text} title={text} data-tip={text}>?</span>;
}

function ConsoleTools() {
  const t = useT();
  const telemetry = useApp((s) => s.panels.telemetry);
  const setPanels = useApp((s) => s.setPanels);
  return (
    <div className="subsys-tools">
      <button type="button" className={`btn btn-small${telemetry ? ' is-on' : ''}`} aria-pressed={telemetry} onClick={() => setPanels({ telemetry: !telemetry })} data-testid="dock-telemetry">
        {t('Telemetry', 'Telemetría')}
      </button>
    </div>
  );
}

function MinButton({ side, onClick }: { side: string; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="btn-min" onClick={onClick} aria-label={t('Minimise panel', 'Minimizar panel')} title={t('Minimise panel', 'Minimizar panel')} data-testid={`min-${side}`}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 9.5h8" stroke="currentColor" strokeWidth="1.6" /></svg>
    </button>
  );
}

function Tray<Id extends PanelId>({ side, tabs, active, onSelect, onMinimise, children }: {
  side: 'left' | 'right'; tabs: Id[]; active: Id; onSelect: (id: Id) => void; onMinimise: () => void; children: ReactNode;
}) {
  const t = useT();
  const subsystem = useApp((s) => s.subsystem);
  return (
    <aside className={`tray tray-${side} drawer-${side}`} data-testid={`drawer-${side}`} data-sub={subsystem}>
      <header className="tray-head">
        <h2>{panelLabel(active, t)}<Hint text={panelHint(active, t)} /></h2>
        <MinButton side={side} onClick={onMinimise} />
      </header>
      {tabs.length > 1 && (
        <div className="tray-tabs" role="tablist">
          {tabs.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={id === active} className={id === active ? 'is-on' : ''} onClick={() => onSelect(id)} data-testid={`dock-${id}`}>
              {panelLabel(id, t)}
            </button>
          ))}
        </div>
      )}
      <div className="drawer-body tray-body">{children}</div>
    </aside>
  );
}

function TrayHandle({ side, label, onOpen }: { side: 'left' | 'right'; label: string; onOpen: () => void }) {
  return (
    <button type="button" className={`tray-handle tray-handle-${side}`} onClick={onOpen} data-testid={`open-${side}`} title={label}>
      <span>{label}</span>
    </button>
  );
}

export function PlannerLayout() {
  const t = useT();
  const mission = useMission();
  const active = useActiveScenario();
  const subsystem = useApp((s) => s.subsystem);
  const panels = useApp((s) => s.panels);
  const setPanels = useApp((s) => s.setPanels);
  const openPanel = useApp((s) => s.openPanel);
  const openSide = useApp((s) => s.openSide);
  const def = SUBSYSTEMS[subsystem];
  const deck = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLElement>(null);
  const [bottomH, setBottomH] = useState(0);

  // The bottom tray floats over the scene; the HUD keeps clear of it.
  useEffect(() => {
    const el = bottom.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBottomH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const left = panels.leftTab && def.left.includes(panels.leftTab) ? panels.leftTab : null;
  const right = panels.rightTab && def.right.includes(panels.rightTab) ? panels.rightTab : null;
  const bottomTab = panels.bottomTab && def.bottom.includes(panels.bottomTab) ? panels.bottomTab : null;

  // Tell the camera how much of the canvas the trays cover (none when the layout stacks on narrow screens).
  useEffect(() => {
    const measure = (): void => {
      const d = deck.current;
      if (!d) return;
      const stacked = getComputedStyle(d).position === 'static';
      const w = (sel: string): number => {
        const el = d.querySelector(sel);
        return el && !stacked ? el.getBoundingClientRect().width + 8 : 0;
      };
      useSceneUi.getState().set({ inset: { l: w('.tray-left'), r: w('.tray-right'), b: stacked ? 0 : bottomH + 8 } });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [left, right, bottomH]);
  useEffect(() => () => useSceneUi.getState().set({ inset: { l: 0, r: 0, b: 0 } }), []);

  const leftBody = (id: LeftTab): ReactNode => {
    if (id === 'sites') return <SitesPanel />;
    if (id === 'hardware') return <HardwarePanel focus={subsystem === 'comms' ? 'comms' : subsystem === 'power' ? 'power' : 'all'} />;
    return <ContingencyPanel />;
  };
  const rightBody = (id: RightTab): ReactNode => {
    switch (id) {
      case 'vitals': return <div className="panel block"><VitalCards data={active} /></div>;
      case 'compare': return <QuickCompare />;
      case 'engineering': return <EngineeringView />;
      case 'windows': return <WindowsPanel data={active} />;
      case 'energy': return <SurvivalPanel data={active} part="thermal" />;
      case 'link': return <LinkBudgetCard data={active} />;
      case 'survival': return <SurvivalPanel data={active} part="landing" />;
      default: return <ScorePanel />;
    }
  };
  const bottomBody = (id: BottomTab): ReactNode => {
    if (id === 'timeline') return <Timeline scenarios={[mission.A, mission.B]} simple={subsystem !== 'science'} />;
    if (id === 'horizon') return <div className="pano-wrap"><HorizonPanorama data={active} /></div>;
    return <div className="pano-wrap"><ThermalChart data={active} /></div>;
  };

  const deckStyle = {
    '--accent': def.accent,
    '--tray-l': left ? 'var(--tray-l-w)' : '0px',
    '--tray-r': right ? 'var(--tray-r-w)' : '0px',
    '--tray-b': `${bottomH}px`,
  } as CSSProperties;

  return (
    <main className="planner ws2" data-testid="planner" data-subsystem={subsystem} style={{ '--accent': def.accent } as CSSProperties}>
      <SubsystemTabs />
      <div className="ws2-body">
      <VerdictCard data={active} />
      <div className="deck" ref={deck} style={deckStyle} data-testid="deck">
        <SceneView />
        {left ? (
          <Tray key={`l-${subsystem}`} side="left" tabs={def.left} active={left} onSelect={(id) => openPanel(id)} onMinimise={() => setPanels({ leftTab: null })}>
            {leftBody(left)}
          </Tray>
        ) : <TrayHandle side="left" label={panelLabel(def.left[0], t)} onOpen={() => openSide('left')} />}
        {right ? (
          <Tray key={`r-${subsystem}`} side="right" tabs={def.right} active={right} onSelect={(id) => openPanel(id)} onMinimise={() => setPanels({ rightTab: null })}>
            {rightBody(right)}
          </Tray>
        ) : <TrayHandle side="right" label={panelLabel(def.right[0], t)} onOpen={() => openSide('right')} />}
        <section className={`tray tray-bottom drawer-bottom${bottomTab ? '' : ' is-min'}`} ref={bottom} data-testid="drawer-bottom">
          <header className="bottom-head">
            <div className="bottom-tabs" role="tablist">
              {def.bottom.map((id) => (
                <button key={id} type="button" role="tab" aria-selected={bottomTab === id} className={bottomTab === id ? 'is-on' : ''} onClick={() => openPanel(id)} data-testid={`bottom-${id}`}>
                  {panelLabel(id, t, subsystem)}
                </button>
              ))}
            </div>
            <ConsoleTools />
            {bottomTab && <MinButton side="bottom" onClick={() => setPanels({ bottomTab: null })} />}
          </header>
          {panels.telemetry && <Readout data={active} />}
          {bottomTab && <div className="tray-bottom-body" key={`${subsystem}-${bottomTab}`}>{bottomBody(bottomTab)}</div>}
        </section>
      </div>
      <SubsystemCurtain />
      </div>
    </main>
  );
}
