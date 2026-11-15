/**
 * Explicit limits of the LOLA topography (v3.1, SR-104, R1, R5) and the
 * contrast of each site with published illumination maps (R8, SR-101).
 * Every number here is read from the engine; nothing is claimed that the
 * engine or a cited source does not say.
 */
import { CANDIDATE_SITES, DEFAULT_MICRO_RELIEF, EQUILIBRIUM_K, LOCAL_SPACING_KM, MAX_RANGE_KM, REGIONAL_SPACING_KM, PUBLISHED_ILLUMINATION } from '../engine';
import { ScenarioData } from '../state/mission';
import { useApp } from '../state/store';
import { fmtLat, fmtLon, fmtNum, useT } from '../lib/format';
import { useUnits } from '../lib/units';

/** Resolution of the 20 m site grid and of the free-coordinate cap, metres per pixel. */
const SITE_RES_M = 20;
const CAP_RES_M = 160;

export function LolaLimits({ testid = 'lola-limits' }: { testid?: string }) {
  const t = useT();
  const u = useUnits();
  const reg = REGIONAL_SPACING_KM * 1000;
  return (
    <section className="lola-limits" data-testid={testid}>
      <h4>{t('Limits of the LOLA topographic data (Barker et al. 2023)', 'Límites de los datos topográficos LOLA (Barker et al. 2023)')}</h4>
      <ol>
        <li>{t(
          `Base resolution: ${u.m(SITE_RES_M)}/px under the candidate sites, ${u.m(CAP_RES_M)}/px at free coordinates, ${u.m(reg)}/px for the far horizon out to ${u.kmStr(MAX_RANGE_KM, 0)}. The 3-D tile is sampled every ${u.m(LOCAL_SPACING_KM * 1000)}.`,
          `Resolución base: ${u.m(SITE_RES_M)}/px bajo los sitios candidatos, ${u.m(CAP_RES_M)}/px en coordenadas libres, ${u.m(reg)}/px para el horizonte lejano hasta ${u.kmStr(MAX_RANGE_KM, 0)}. El mosaico 3-D se muestrea cada ${u.m(LOCAL_SPACING_KM * 1000)}.`,
        )}</li>
        <li>{t(
          `Interpolation between laser tracks: most pixels of the ${u.m(SITE_RES_M)} grid are interpolated between LRO orbit tracks, not measured (the share varies by site and is not mapped in this app). Craters and boulders smaller than ${u.m(SITE_RES_M)} are not in the deterministic map.`,
          `Interpolación entre trazas láser: la mayoría de los píxeles de la grilla de ${u.m(SITE_RES_M)} se interpolan entre trazas orbitales del LRO, no se miden (la fracción varía por sitio y esta app no la mapea). Cráteres y bloques menores a ${u.m(SITE_RES_M)} no están en el mapa determinista.`,
        )}</li>
        <li>{t(
          `Sub-pixel micro-relief: modelled statistically (equilibrium crater density k = ${EQUILIBRIUM_K}, Trask 1966 as quoted in the engine; unresolved RMS slope ${DEFAULT_MICRO_RELIEF.slopeRmsDeg}°, team parameter). It is a hazard probability, not a photographic map of rocks.`,
          `Micro-relieve sub-píxel: modelado estadísticamente (densidad de cráteres en equilibrio k = ${EQUILIBRIUM_K}, Trask 1966 según el motor; pendiente RMS no resuelta ${DEFAULT_MICRO_RELIEF.slopeRmsDeg}°, parámetro del equipo). Es una probabilidad de peligro, no un mapa fotográfico de rocas.`,
        )}</li>
        <li>{t(
          'Vertical error: a few decimetres RMS; the terrain-uncertainty runs (Terrain › Dispersion and escape) propagate it to sunlight, Earth view and survival as P10 / P50 / P90 bands.',
          'Error vertical: pocos decímetros RMS; las corridas de incertidumbre del terreno (Terreno › Dispersión y escape) lo propagan a la luz, la vista de la Tierra y la supervivencia como bandas P10 / P50 / P90.',
        )}</li>
      </ol>
    </section>
  );
}

/** Reference coordinate and published annual illumination next to what the engine computes for the window on screen. */
export function PublishedContrast({ data }: { data: ScenarioData }) {
  const t = useT();
  const siteId = useApp((s) => s.scenarios[data.key].siteId);
  const site = CANDIDATE_SITES.find((s) => s.id === siteId);
  if (!site) return null;
  const pub = PUBLISHED_ILLUMINATION[site.id];
  const r = data.result;
  return (
    <div className="pub-contrast" data-testid="pub-contrast">
      <span>{t('Reference coordinate (challenge brief)', 'Coordenada de referencia (enunciado del desafío)')}: <span className="mono">{fmtLat(site.brief.latDeg)} {fmtLon(site.brief.lonDeg)}</span></span>
      <span>{t('Computed by the app, this window', 'Calculado por la app, esta ventana')}: <b className="mono" data-testid="pub-computed">{r ? `${fmtNum(r.kpis.illuminationPct, 0)} %` : '…'}</b> {t('sunlight', 'de luz')}</span>
      {pub && pub.illumPct !== null ? (
        <span>{t('Published annual illumination', 'Iluminación media anual publicada')}: <b className="mono">{fmtNum(pub.illumPct, 0)} %</b> ({pub.ref})</span>
      ) : (
        <span className="is-unverified" data-testid="pub-unverified">
          {t('Published annual illumination: no value verified for this release. Compare with ', 'Iluminación media anual publicada: sin dato verificado en esta versión. Comparar con ')}{pub?.ref ?? 'Mazarico et al. 2011'}.
        </span>
      )}
    </div>
  );
}
