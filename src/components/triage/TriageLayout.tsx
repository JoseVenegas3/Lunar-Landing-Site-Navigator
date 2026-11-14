/**
 * Emergency triage: the lander came down somewhere unplanned. The same
 * emergency flow as the survival panel of the Terrain console (position,
 * energy, optional tilt; evaluated from now), plus the terrain source and the
 * sub-pixel hazard, around the 3-D view. The sub-pixel hazard is always shown:
 * it costs under 100 ms and is deterministic, so there is nothing to choose
 * (v2.1 change 3; the switch of v2.0 was removed).
 */
import { SceneView } from '../3d/SceneView';
import { EmergencyInputs, EmergencyResult, useEmergencyNow } from '../EmergencyFlow';
import { VerdictCard } from '../VerdictCard';
import { Timeline } from '../dashboard/Timeline';
import { ScenarioData, useMission } from '../../state/mission';
import { useMicroHazard } from '../../state/verdict';
import { fmtNum, useT } from '../../lib/format';

type T = (en: string, es: string) => string;

/** One line that says where the terrain under the lander comes from. */
export function terrainStatusText(data: ScenarioData, t: T): { text: string; tone: 'ok' | 'warn' | 'busy' } {
  const res = data.terrainResolutionM;
  switch (data.stream) {
    case 'static': return { text: t('LOLA 20 m/px, pre-loaded: landing precision active', 'LOLA 20 m/px, precargado: precisión de aterrizaje activa'), tone: 'ok' };
    case 'ready': return { text: t(`READY: LOLA 20 m/px read live${data.streamCoveragePct !== null && data.streamCoveragePct < 99.5 ? ` (${fmtNum(data.streamCoveragePct, 0)} % of the patch)` : ''}. Landing precision active`, `LISTO: LOLA 20 m/px leído en vivo${data.streamCoveragePct !== null && data.streamCoveragePct < 99.5 ? ` (${fmtNum(data.streamCoveragePct, 0)} % del parche)` : ''}. Precisión de aterrizaje activa`), tone: 'ok' };
    case 'cached': return { text: t('READY: LOLA 20 m/px from the offline store. Landing precision active', 'LISTO: LOLA 20 m/px desde el almacén sin conexión. Precisión de aterrizaje activa'), tone: 'ok' };
    case 'loading': return { text: t(`Loading tactical relief LOLA 20 m/px… showing ${res ?? 160} m/px meanwhile`, `Cargando relieve táctico LOLA 20 m/px… se muestra ${res ?? 160} m/px mientras tanto`), tone: 'busy' };
    case 'unavailable': return { text: t(`20 m source unreachable: working at ${res ?? 160} m/px. Slopes and escape vectors are indicative only`, `Fuente de 20 m inaccesible: se trabaja a ${res ?? 160} m/px. Pendientes y vectores de escape son solo indicativos`), tone: 'warn' };
    case 'outside': return { text: t(`Outside the 20 m mosaic: working at ${res ?? 800} m/px`, `Fuera del mosaico de 20 m: se trabaja a ${res ?? 800} m/px`), tone: 'warn' };
    default: return { text: res ? `LOLA ${res} m/px` : t('Loading the terrain…', 'Cargando el terreno…'), tone: res && res <= 32 ? 'ok' : 'busy' };
  }
}


export function TriageLayout() {
  const t = useT();
  const data = useMission().A;
  const micro = useMicroHazard(data);
  const hazard = micro?.hazard ?? null;
  const status = terrainStatusText(data, t);
  useEmergencyNow('A');

  return (
    <main className="triage" data-testid="triage">
      <aside className="tri-side tri-left">
        <header className="tri-head"><h2>{t('Lander down: what do we know?', 'Lander en superficie: ¿qué sabemos?')}</h2></header>
        <EmergencyInputs data={data} />
      </aside>

      <div className="tri-stage">
        <VerdictCard data={data} gloss />
        <SceneView />
        <div className="tri-time"><Timeline scenarios={[data]} simple /></div>
      </div>

      <aside className="tri-side tri-right">
        <EmergencyResult
          data={data} clocksTestId="tri-clocks"
          extra={(
            <>
              <p className={`tri-status is-${status.tone}`} data-testid="tri-terrain" data-stream={data.stream ?? ''}>{status.text}</p>
              <h4 className="micro-head">{t('Hazards under the 20 m pixel', 'Peligros bajo el píxel de 20 m')}</h4>
              {hazard ? (
                <div className="stat-grid" data-testid="micro-hazard" data-ms={micro ? Math.round(micro.ms) : ''}>
                  <div className={`stat${hazard.index > 0.4 ? ' is-crit' : hazard.index > 0.2 ? ' is-warn' : ' is-ok'}`}><span>{t('Micro-shadow and rock hazard', 'Peligro de micro-sombra y roca')}</span><output className="mono">{fmtNum(100 * hazard.index, 0)} %</output></div>
                  <div className="stat"><span>{t('Hidden shadow traps', 'Trampas de sombra ocultas')}</span><output className="mono">{fmtNum(100 * hazard.shadowTrap, 0)} %</output></div>
                  <div className="stat"><span>{t('Footprint slope over 15°', 'Pendiente bajo las patas > 15°')}</span><output className="mono">{fmtNum(100 * hazard.slopeTrap, 0)} %</output></div>
                  <div className="stat"><span>{t('Ground inside 3–15 m craters', 'Suelo dentro de cráteres de 3–15 m')}</span><output className="mono">{fmtNum(100 * hazard.craterCover, 0)} %</output></div>
                </div>
              ) : <p className="kpi-note pad0" data-testid="micro-wait">{t('Estimating the hazards under the pixel…', 'Estimando los peligros bajo el píxel…')}</p>}
              <p className="kpi-note pad0">{t('Statistical, not a map: the model places craters and roughness the 20 m terrain cannot contain, with the same result for the same place. It says how likely a hidden trap is, not where it is.', 'Estadístico, no un mapa: el modelo sitúa cráteres y rugosidad que el terreno de 20 m no puede contener, con el mismo resultado para el mismo lugar. Dice qué tan probable es una trampa oculta, no dónde está.')}</p>
              <p className="kpi-note pad0" data-testid="micro-params">{t('Fractal roughness parameters (Hurst 0.9, 2.5° RMS slope below 20 m, 3–15 m craters, 4 m footprint, 15° limit) are team parameters, not validated. The crater density follows the equilibrium of Trask (1966).', 'Los parámetros de la rugosidad fractal (Hurst 0,9, pendiente RMS de 2,5° bajo 20 m, cráteres de 3–15 m, huella de 4 m, límite de 15°) son parámetros del equipo, no validados. La densidad de cráteres sigue el equilibrio de Trask (1966).')}</p>
            </>
          )}
        />
      </aside>
    </main>
  );
}
