/** Scenario and hardware configuration (left rail of the Mission Planner). */
import { ReactNode, useEffect, useState } from 'react';
import {
  ALL_SITES, CANDIDATE_SITES, HISTORICAL_LANDINGS, CUSTOM_LAT_MAX, CUSTOM_LAT_MIN, DAY_MS, GROUND_STATIONS, MAX_RELAYS, MountType, RELAY_PRESETS, RELOCATION_LIMIT_M,
  RelayPresetId, RfBand, apoapsisAltKm, clamp, latLonToXY, orbitalPeriodS, periapsisAltKm, relayShape,
} from '../../engine';
import { ScenarioKey, scenarioLatLon, useApp } from '../../state/store';
import { useMission } from '../../state/mission';
import { fmtLat, fmtLon, fromDateInput, toDateInput, useT } from '../../lib/format';

const MIN_DATE = Date.UTC(2026, 0, 1);
const MAX_DATE = Date.UTC(2030, 11, 31);

/** Range input that shows its value live but commits only when released (expensive recomputes). */
function CommitRange({ value, min, max, step, onCommit, format, label, testId }: {
  value: number; min: number; max: number; step: number; onCommit: (v: number) => void; format: (v: number) => string; label: string; testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => { if (draft !== value) onCommit(draft); };
  return (
    <label className="field">
      <span className="field-label">{label}<output className="mono">{format(draft)}</output></span>
      <input
        type="range" min={min} max={max} step={step} value={draft} data-testid={testId}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit}
      />
    </label>
  );
}

export function NumberField({ label, value, min, max, step, unit, onChange, testId }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; testId?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) { setText(String(value)); return; }
    const c = clamp(v, min, max);
    setText(String(c));
    if (c !== value) onChange(c);
  };
  return (
    <label className="field field-num">
      <span className="field-label">{label}</span>
      <span className="num-wrap">
        <input
          type="number" className="mono" value={text} min={min} max={max} step={step} data-testid={testId}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {unit && <i>{unit}</i>}
      </span>
    </label>
  );
}

/** The landing scenario: site, date, window and offset. A second scenario is created from the Compare block of the landing-windows panel. */
export function SitesPanel() {
  return <ScenarioPanel k="A" />;
}

export function ScenarioPanel({ k }: { k: ScenarioKey }) {
  const t = useT();
  const cfg = useApp((s) => s.scenarios[k]);
  const other = useApp((s) => s.scenarios[k === 'A' ? 'B' : 'A']);
  const lang = useApp((s) => s.lang);
  const update = useApp((s) => s.updateScenario);
  const setRelocation = useApp((s) => s.setRelocation);
  const data = useMission()[k];
  const site = ALL_SITES.find((s) => s.id === cfg.siteId);
  const nominal = scenarioLatLon(cfg);
  const compare = useApp((s) => s.compare);
  const sameWindow = !compare || (cfg.startMs === other.startMs && cfg.days === other.days);
  const briefKm = site ? (() => {
    const [x0, y0] = latLonToXY(site.latDeg, site.lonDeg);
    const [x1, y1] = latLonToXY(site.brief.latDeg, site.brief.lonDeg);
    return Math.hypot(x1 - x0, y1 - y0);
  })() : null;

  return (
    <section className="panel scenario" data-testid={`scenario-${k}`}>

      <label className="field">
        <span className="field-label">{t('Landing site', 'Sitio de alunizaje')}</span>
        <select value={cfg.siteId} onChange={(e) => update(k, { siteId: e.target.value })} data-testid={`site-${k}`}>
          {CANDIDATE_SITES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <optgroup label={t('Real landings', 'Alunizajes reales')}>
            {HISTORICAL_LANDINGS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
          <option value="custom">{t('Custom coordinates…', 'Coordenadas personalizadas…')}</option>
        </select>
      </label>

      {cfg.siteId === 'custom' ? (
        <div className="field-row">
          <NumberField label={t('Latitude', 'Latitud')} unit="°" value={cfg.customLat} min={CUSTOM_LAT_MIN} max={CUSTOM_LAT_MAX} step={0.01} onChange={(v) => update(k, { customLat: v, dxM: 0, dyM: 0 })} testId={`lat-${k}`} />
          <NumberField label={t('Longitude (east +)', 'Longitud (este +)')} unit="°" value={cfg.customLon} min={-180} max={180} step={0.01} onChange={(v) => update(k, { customLon: v, dxM: 0, dyM: 0 })} testId={`lon-${k}`} />
        </div>
      ) : (
        <p className="site-note">{site?.summary[lang]}</p>
      )}
      <p className="site-coords mono">{fmtLat(nominal.latDeg)}&nbsp;&nbsp;{fmtLon(nominal.lonDeg)}{data.loading !== null && <em> · DEM {Math.round(data.loading * 100)}%</em>}</p>
      {site && briefKm !== null && briefKm > 0.05 && (
        <p className="site-brief">
          {t(`Landing point chosen on LOLA terrain, ${briefKm.toFixed(1)} km from the brief coordinate`, `Punto elegido sobre el relieve LOLA, a ${briefKm.toFixed(1)} km de la coordenada del enunciado`)}
          {' '}<span className="mono">({fmtLat(site.brief.latDeg)} {fmtLon(site.brief.lonDeg)})</span>
        </p>
      )}
      <p className={`terrain-tag mono${data.terrain === 'synthetic' || (data.terrainResolutionM ?? 0) > 100 ? ' is-warn' : ''}`} data-testid={`terrain-${k}`}>
        {data.terrain === 'synthetic'
          ? t('Terrain: synthetic model (LOLA files not found)', 'Terreno: modelo sintético (no se hallaron los archivos LOLA)')
          : data.terrainResolutionM === null
            ? t('Terrain: LRO LOLA', 'Terreno: LRO LOLA')
            : t(`Terrain: LRO LOLA, ${data.terrainResolutionM} m/px`, `Terreno: LRO LOLA, ${data.terrainResolutionM} m/px`)}
      </p>

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t('Window start (UTC)', 'Inicio de ventana (UTC)')}</span>
          <input
            type="date" className="mono" value={toDateInput(cfg.startMs)} min={toDateInput(MIN_DATE)} max={toDateInput(MAX_DATE)} data-testid={`start-${k}`}
            onChange={(e) => {
              const ms = fromDateInput(e.target.value);
              if (ms !== null) update(k, { startMs: clamp(ms, MIN_DATE, MAX_DATE - cfg.days * DAY_MS) });
            }}
          />
        </label>
      </div>
      <CommitRange label={t('Window length', 'Duración de ventana')} value={cfg.days} min={1} max={180} step={1} format={(v) => `${v} d`} onCommit={(v) => update(k, { days: v })} testId={`days-${k}`} />
      {!sameWindow && (
        <button type="button" className="btn btn-small btn-ghost" onClick={() => update(k, { startMs: other.startMs, days: other.days })}>
          {t(`Use the same window as ${k === 'A' ? 'B' : 'A'}`, `Usar la misma ventana que ${k === 'A' ? 'B' : 'A'}`)}
        </button>
      )}

      <div className="reloc-sliders">
        <label className="field">
          <span className="field-label">{t('Move east', 'Mover al este')}<output className="mono">{cfg.dxM > 0 ? '+' : ''}{cfg.dxM} m</output></span>
          <input type="range" min={-RELOCATION_LIMIT_M} max={RELOCATION_LIMIT_M} step={10} value={cfg.dxM} data-testid={`dx-${k}`} onChange={(e) => setRelocation(k, Number(e.target.value), cfg.dyM)} />
        </label>
        <label className="field">
          <span className="field-label">{t('Move north', 'Mover al norte')}<output className="mono">{cfg.dyM > 0 ? '+' : ''}{cfg.dyM} m</output></span>
          <input type="range" min={-RELOCATION_LIMIT_M} max={RELOCATION_LIMIT_M} step={10} value={cfg.dyM} data-testid={`dy-${k}`} onChange={(e) => setRelocation(k, cfg.dxM, Number(e.target.value))} />
        </label>
      </div>
    </section>
  );
}

function Group({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="panel group" open={open}>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

export function HardwarePanel({ focus = 'all' }: { focus?: 'all' | 'power' | 'comms' }) {
  const showPower = focus !== 'comms', showComms = focus !== 'power';
  const t = useT();
  const power = useApp((s) => s.power);
  const rf = useApp((s) => s.rf);
  const setPower = useApp((s) => s.setPower);
  const setRf = useApp((s) => s.setRf);
  const relay = useApp((s) => s.relay);
  const setRelay = useApp((s) => s.setRelay);
  const thermal = useApp((s) => s.thermal);
  const setThermal = useApp((s) => s.setThermal);
  const thermalOn = useApp((s) => s.thermalOn);
  const setThermalOn = useApp((s) => s.setThermalOn);
  const mastM = useApp((s) => s.mastM);
  const setMast = useApp((s) => s.setMast);
  const lang = useApp((s) => s.lang);
  const shape = relayShape(relay);

  return (
    <>
      {showPower && <Group title={t('Power system', 'Sistema de energía')} open>
        <label className="field">
          <span className="field-label">{t('Array and antenna height', 'Altura de paneles y antena')}</span>
          <select value={mastM} onChange={(e) => setMast(Number(e.target.value))} data-testid="mast">
            <option value={2}>{t('2 m, on the lander deck', '2 m, sobre la cubierta del lander')}</option>
            <option value={10}>{t('10 m, on a mast', '10 m, sobre un mástil')}</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('Solar array mount', 'Montura de paneles')}</span>
          <select value={power.mount} onChange={(e) => setPower({ mount: e.target.value as MountType })} data-testid="mount">
            <option value="tracker1axis">{t('1-axis Sun tracker (vertical)', 'Seguidor solar de 1 eje (vertical)')}</option>
            <option value="cylindrical">{t('Vertical cylinder (body-mounted)', 'Cilíndrica vertical (en el cuerpo)')}</option>
            <option value="horizontal">{t('Horizontal deck', 'Horizontal (cubierta)')}</option>
          </select>
        </label>
        <div className="field-row">
          <NumberField label={t('Array area', 'Área de paneles')} unit="m²" value={power.panelAreaM2} min={0.1} max={40} step={0.1} onChange={(v) => setPower({ panelAreaM2: v })} testId="area" />
          <NumberField label={t('Cell efficiency', 'Eficiencia')} unit="%" value={Math.round(power.efficiency * 1000) / 10} min={5} max={40} step={0.5} onChange={(v) => setPower({ efficiency: v / 100 })} />
        </div>
        <div className="field-row">
          <NumberField label={t('Operating load', 'Consumo operativo')} unit="W" value={power.baseLoadW} min={1} max={5000} step={5} onChange={(v) => setPower({ baseLoadW: v })} />
          <NumberField label={t('Survival load', 'Consumo de supervivencia')} unit="W" value={power.survivalLoadW} min={0} max={2000} step={1} onChange={(v) => setPower({ survivalLoadW: v })} />
        </div>
        <div className="field-row">
          <NumberField label={t('Battery', 'Batería')} unit="Wh" value={power.batteryCapacityWh} min={50} max={200000} step={50} onChange={(v) => setPower({ batteryCapacityWh: v })} testId="battery" />
          <NumberField label={t('DoD limit', 'Límite DoD')} unit="%" value={Math.round(power.maxDepthOfDischarge * 100)} min={10} max={100} step={5} onChange={(v) => setPower({ maxDepthOfDischarge: v / 100 })} />
        </div>
      </Group>}

      {showComms && <Group title={t('DTE radio link', 'Enlace de radio DTE')} open={focus === 'comms'}>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('Band', 'Banda')}</span>
            <select value={rf.band} onChange={(e) => setRf({ band: e.target.value as RfBand })} data-testid="band">
              <option value="X">X · 8.4 GHz</option>
              <option value="S">S · 2.2 GHz</option>
            </select>
          </label>
          <NumberField label={t('Antenna margin', 'Margen de antena')} unit="°" value={rf.elevationMarginDeg} min={0} max={10} step={0.5} onChange={(v) => setRf({ elevationMarginDeg: v })} testId="margin" />
        </div>
        <label className="field">
          <span className="field-label">{t('Ground station', 'Estación terrena')}</span>
          <select value={rf.groundStationId} onChange={(e) => setRf({ groundStationId: e.target.value })} data-testid="station">
            {GROUND_STATIONS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <div className="field-row">
          <NumberField label={t('Transmit power', 'Potencia de transmisión')} unit="W" value={rf.txPowerW} min={0.1} max={500} step={1} onChange={(v) => setRf({ txPowerW: v })} />
          <NumberField label={t('Lander dish', 'Antena del lander')} unit="m" value={rf.txDishDiameterM} min={0.1} max={5} step={0.05} onChange={(v) => setRf({ txDishDiameterM: v })} />
        </div>
        <div className="field-row">
          <NumberField label={t('Bandwidth', 'Ancho de banda')} unit="MHz" value={rf.bandwidthHz / 1e6} min={0.01} max={500} step={0.5} onChange={(v) => setRf({ bandwidthHz: v * 1e6 })} />
          <NumberField label={t('Link margin', 'Margen de enlace')} unit="dB" value={rf.linkMarginDb} min={0} max={20} step={0.5} onChange={(v) => setRf({ linkMarginDb: v })} />
        </div>
      </Group>}

      {showPower && <Group title={t('Thermal control', 'Control térmico')} open>
        <label className="check">
          <input type="checkbox" checked={thermalOn} onChange={(e) => setThermalOn(e.target.checked)} data-testid="thermal-enable" />
          <span>{t('Couple the battery to the bus temperature', 'Acoplar la batería a la temperatura del bus')}</span>
        </label>
        {thermalOn && (
          <>
            <label className="field">
              <span className="field-label">{t('Survival heater power', 'Potencia de calefactores de supervivencia')}<output className="mono">{thermal.heaterW} W</output></span>
              <input type="range" min={20} max={150} step={5} value={thermal.heaterW} onChange={(e) => setThermal({ heaterW: Number(e.target.value) })} data-testid="heater-power" />
            </label>
            <div className="field-row">
              <NumberField label={t('Radiating area', 'Área radiante')} unit="m²" value={thermal.radiatorAreaM2} min={0.05} max={10} step={0.05} onChange={(v) => setThermal({ radiatorAreaM2: v })} />
              <NumberField label={t('Emissivity', 'Emisividad')} value={thermal.emissivity} min={0.02} max={1} step={0.05} onChange={(v) => setThermal({ emissivity: v })} />
            </div>
            <div className="field-row">
              <NumberField label={t('Thermal mass', 'Masa térmica')} unit="kJ/K" value={thermal.heatCapacityJK / 1000} min={5} max={2000} step={5} onChange={(v) => setThermal({ heatCapacityJK: v * 1000 })} />
              <NumberField label={t('Shadow sink', 'Sumidero en sombra')} unit="K" value={thermal.envDarkK} min={30} max={150} step={5} onChange={(v) => setThermal({ envDarkK: v })} />
            </div>
            <details className="adv-assume" data-testid="advanced-assumptions">
              <summary>{t('Advanced assumptions', 'Supuestos avanzados')}</summary>
              <dl className="link-grid mono">
                <div><dt>{t('Heaters switch on below', 'Calefactores se encienden bajo')}</dt><dd>0 °C</dd></div>
                <div><dt>{t('Battery starts losing capacity below', 'La batería pierde capacidad bajo')}</dt><dd>−10 °C</dd></div>
                <div><dt>{t('Battery frozen, lander lost at', 'Batería congelada, lander perdido a')}</dt><dd>−20 °C</dd></div>
              </dl>
              <p className="kpi-note pad0">{t('Engineering assumption of this tool, typical of lithium-ion cells; not the specification of a real lander.', 'Supuesto de ingeniería de esta herramienta, típico de celdas de ion-litio; no es la especificación de un lander real.')}</p>
            </details>
          </>
        )}
      </Group>}

      {showComms && <Group title={t('Relay satellites', 'Satélites de retransmisión')} open={focus === 'comms'}>
        <label className="check">
          <input type="checkbox" checked={relay.enabled} onChange={(e) => setRelay({ enabled: e.target.checked })} data-testid="relay-enable" />
          <span>{t('Add a relay constellation in lunar orbit', 'Añadir una constelación de relays en órbita lunar')}</span>
        </label>
        {relay.enabled && (
          <>
            <label className="field">
              <span className="field-label">{t('Orbit', 'Órbita')}</span>
              <select value={relay.preset} onChange={(e) => setRelay({ preset: e.target.value as RelayPresetId })} data-testid="relay-preset">
                {RELAY_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}
              </select>
            </label>
            <NumberField label={t('Number of relay satellites', 'Número de satélites relay')} value={relay.count} min={1} max={MAX_RELAYS} step={1} onChange={(v) => setRelay({ count: Math.round(v), planes: Math.min(relay.planes, Math.round(v)) })} testId="relay-count" />
            <NumberField label={t('Lander-to-relay data rate', 'Tasa lander-relay')} unit="Mbps" value={relay.rateMbps} min={0.01} max={500} step={0.5} onChange={(v) => setRelay({ rateMbps: v })} />
            <p className="orbit-note mono" data-testid="relay-orbit">
              {t('Period', 'Período')} {(orbitalPeriodS(shape.aKm) / 3600).toFixed(2)} h · {t('altitude', 'altitud')} {periapsisAltKm(shape).toFixed(0)}–{apoapsisAltKm(shape).toFixed(0)} km
            </p>
            <p className="kpi-note orbit-help">
              {t('Two-body orbits with fixed elements: typical coverage, not the pass times of a specific spacecraft.', 'Órbitas de dos cuerpos con elementos fijos: cobertura típica, no las pasadas de una nave concreta.')}
            </p>
          </>
        )}
      </Group>}
    </>
  );
}
