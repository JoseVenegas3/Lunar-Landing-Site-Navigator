/** Multi-criteria suitability score of both scenarios (SyR-C5.1), with the orbital data behind it. */
import { CRITERIA, Criterion, CriterionId, SiteScore } from '../../engine';
import { PSR_SEARCH_KM, SHADOW_SEARCH_KM, SiteScoreView, useSiteScore } from '../../state/insights';
import { ScenarioData, useMission } from '../../state/mission';
import { useScience } from '../../state/science';
import { useApp } from '../../state/store';
import { fmtNum, fmtSigned, useT } from '../../lib/format';
import { ScenarioBadge } from '../ScenarioBadge';

function rawText(id: CriterionId, raw: number | null, view: SiteScoreView): string {
  if (raw === null) return '—';
  if (id === 'psrProximity') return view.psrBeyond ? `> ${(view.psrFromLayer ? PSR_SEARCH_KM : SHADOW_SEARCH_KM).toFixed(0)} km` : `${fmtNum(raw, 2)} km`;
  if (id === 'earthVisibility' || id === 'illumination') return `${fmtNum(raw, 0)} %`;
  if (id === 'slope') return `${fmtNum(raw, 1)}°`;
  if (id === 'roughness') return `${fmtNum(raw, 0)} m`;
  if (id === 'hydrogen') return `${fmtNum(raw, 2)} wt.%`;
  if (id === 'feo') return `${fmtNum(raw, 1)} wt.%`;
  if (id === 'gravity') return `${fmtSigned(raw, 0)} mGal`;
  return fmtNum(raw, 2);
}

function ScoreHead({ data, score }: { data: ScenarioData; score: SiteScore | null }) {
  return (
    <th>
      <ScenarioBadge k={data.key} />
      <div className="score-big mono" data-testid={`score-${data.key}`}>{score ? fmtNum(score.score, 1) : '···'}</div>
      <div className="kpi-cap kpi-site" data-testid={`coverage-${data.key}`}><span className="site-label" data-site-label={data.name}>{data.name}</span><br /><span className="mono">{score ? `${fmtNum(score.coveragePct, 0)} %` : ''}</span></div>
    </th>
  );
}

export function ScorePanel() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const active = useApp((s) => s.active);
  const layers = useScience((s) => s.layers);
  const status = useScience((s) => s.status);
  const { A, B } = useMission();
  const compare = useApp((s) => s.compare);
  const sa = useSiteScore(A), sb = useSiteScore(B);
  const act = active === 'A' ? sa : sb;
  const sourceText = (c: Criterion): string => {
    if (c.source === 'computed') return t('computed', 'calculado');
    if (c.source === 'input') return t('entered', 'ingresado');
    if (!layers) return c.id === 'psrProximity' ? t('window-shadow proxy', 'sustituto por ventana') : t('layer not loaded', 'capa no cargada');
    return c.id === 'psrProximity' ? 'LOLA PSR' : c.id === 'feo' ? 'LP GRS' : 'GRAIL';
  };
  const dv = act.site?.diviner ?? null;
  const psr = act.site?.psr ?? null;

  return (
    <section className="panel score" data-testid="score-panel">
      <p className="kpi-note score-weighting">{t('Synthesized index: sunlight, Earth view, slope and the orbital science layers, weighted as in the team\'s state-of-the-art study.', 'Índice sintetizado: luz, vista a la Tierra, pendiente y las capas científicas orbitales, ponderadas según el estudio de estado del arte del equipo.')}</p>
      <table className="kpi-table score-table">
        <thead>
          <tr>
            <th />
            <ScoreHead data={A} score={sa.score} />
            {compare && <ScoreHead data={B} score={sb.score} />}
          </tr>
        </thead>
        <tbody>
          {CRITERIA.map((c, k) => c.source === 'input' ? null : (
            <tr key={c.id} data-criterion={c.id}>
              <th scope="row">
                {c.name[lang]}
                <small className="mono">{fmtNum(100 * (sa.score?.rows[k].weight ?? 0), 1)} % · {sourceText(c)}</small>
              </th>
              {(compare ? [sa, sb] : [sa]).map((s, col) => {
                const row = s.score?.rows[k];
                return (
                  <td key={col} className={`kpi-val mono${row?.available ? '' : ' is-pending'}`}>
                    <span>{row ? rawText(c.id, row.raw, s) : '···'}</span>
                    {row?.available && <i className="kpi-bar kpi-bar-score" style={{ width: `${Math.round(row.merit * 100)}%` }} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="score-inputs">
        <h3><ScenarioBadge k={active} />{t('Orbital data at this site', 'Datos orbitales en este sitio')}</h3>
        {status === 'missing' && <p className="kpi-note pad0">{t('The science layers in public/science/ were not found; run scripts/fetch_science_layers.py.', 'No se hallaron las capas científicas en public/science/; ejecuta scripts/fetch_science_layers.py.')}</p>}
        {dv && psr ? (
          <dl className="link-grid mono" data-testid="orbital-data">
            <div><dt>{t('Annual mean surface temperature', 'Temperatura superficial media anual')}</dt><dd>{fmtNum(dv.tAvgK, 0)} K</dd></div>
            <div><dt>{t('Annual maximum temperature', 'Temperatura máxima anual')}</dt><dd>{fmtNum(dv.tMaxK, 0)} K</dd></div>
            <div><dt>{t('Water ice stable under the lander', 'Hielo de agua estable bajo el lander')}</dt><dd>{dv.iceDepthM === null ? t('no', 'no') : dv.iceDepthM < 1e-6 ? t('at the surface', 'en superficie') : `${t('below', 'bajo')} ${fmtNum(dv.iceDepthM * 100, 0)} cm`}</dd></div>
            <div><dt>{t('Nearest ice-stable ground', 'Terreno con hielo estable más cercano')}</dt><dd>{dv.nearestIceStableKm === null ? `> ${fmtNum(dv.searchRadiusKm, 0)} km` : `${fmtNum(dv.nearestIceStableKm, 2)} km`}</dd></div>
            <div><dt>{t('Nearest surface cold trap', 'Trampa fría superficial más cercana')}</dt><dd>{dv.nearestSurfaceIceKm === null ? `> ${fmtNum(dv.searchRadiusKm, 0)} km` : `${fmtNum(dv.nearestSurfaceIceKm, 2)} km`}</dd></div>
            <div><dt>{t('Nearest PSR (20 m mask)', 'PSR más cercana (máscara de 20 m)')}</dt><dd>{psr.distanceKm === null ? '> 8 km' : `${fmtNum(psr.distanceKm, 2)} km`}</dd></div>
            <div><dt>{t('PSR share of the 8 km disc', 'Fracción PSR del disco de 8 km')}</dt><dd>{fmtNum(psr.fractionWithin8kmPct, 1)} %</dd></div>
          </dl>
        ) : layers && (
          <p className="kpi-note pad0">{t('Diviner temperatures were fetched for the five candidate sites only. PSR distance, FeO and gravity are available at any point of the polar cap.', 'Las temperaturas de Diviner se obtuvieron solo para los cinco sitios candidatos. La distancia a PSR, el FeO y la gravedad están disponibles en cualquier punto del casquete polar.')}</p>
        )}
        {dv && (
          <p className="kpi-note pad0">
            {t(`The thermal model uses ${fmtNum(dv.tMaxK, 0)} K, the Diviner annual maximum here, as its sunlit sink temperature.`, `El modelo térmico usa ${fmtNum(dv.tMaxK, 0)} K, el máximo anual de Diviner aquí, como temperatura de sumidero al sol.`)}
          </p>
        )}

      </div>
      <p className="kpi-note">
        {t('Weights as listed in the team\'s state-of-the-art document (SOM / random-forest study), renormalised over the criteria with data; the percentage under each score is the share of the weight covered. Hydrogen and geological density have no gridded layer in the archives used and are left out. The normalisation ranges are this project\'s convention. FeO is one value per ~60 km pixel and the gravity anomaly is dominated by topography: both describe the region, not the landing point.', 'Pesos según el documento de estado del arte del equipo (estudio SOM / random forest), renormalizados sobre los criterios con datos; el porcentaje bajo cada índice es la parte del peso cubierta. El hidrógeno y la densidad geológica no tienen capa en malla en los archivos usados y quedan fuera. Los rangos de normalización son convención de este proyecto. El FeO es un valor por píxel de ~60 km y la anomalía gravitatoria está dominada por la topografía: ambos describen la región, no el punto de alunizaje.')}
      </p>
    </section>
  );
}
