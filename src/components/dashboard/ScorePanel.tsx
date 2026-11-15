/** Multi-criteria suitability score of both scenarios (SyR-C5.1), with the orbital data behind it. */
import { CRITERIA, Criterion, CriterionId, INDEX_CRITERIA, SiteScore, staticStabilityDeg } from '../../engine';
import { PSR_SEARCH_KM, SHADOW_SEARCH_KM, SiteScoreView, useSiteScore } from '../../state/insights';
import { ScenarioData, useMission } from '../../state/mission';
import { useScience } from '../../state/science';
import { useApp } from '../../state/store';
import { fmtNum, fmtSigned, useT } from '../../lib/format';
import { currentUnits, useUnits } from '../../lib/units';
import { ScenarioBadge } from '../ScenarioBadge';

function rawText(id: CriterionId, raw: number | null, view: SiteScoreView): string {
  const u = currentUnits();
  if (raw === null) return '—';
  if (id === 'psrProximity') return view.psrBeyond ? `> ${u.kmStr(view.psrFromLayer ? PSR_SEARCH_KM : SHADOW_SEARCH_KM, 0)}` : u.kmStr(raw, 2);
  if (id === 'earthVisibility' || id === 'illumination') return `${fmtNum(raw, 0)} %`;
  if (id === 'slope') return `${fmtNum(raw, 1)}°`;
  if (id === 'roughness') return u.m(raw);
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

/** The range each merit bar spans and why (v2.1: every range is anchored or the criterion is out of the index). */
export function rangeWhy(id: CriterionId, slopeLimitDeg: number, t: (en: string, es: string) => string): string {
  switch (id) {
    case 'earthVisibility': return t('0–100 % of the window with the Earth above the terrain (a physical share).', '0–100 % de la ventana con la Tierra sobre el relieve (una fracción física).');
    case 'illumination': return t('0–100 % of the solar disc visible over the window (a physical share).', '0–100 % del disco solar visible en la ventana (una fracción física).');
    case 'slope': return t(`0° scores 1; ${fmtNum(slopeLimitDeg, 0)}° scores 0: the static stability angle of the vehicle in Attitude and tip-over, atan(tip radius / centre-of-mass height).`, `0° vale 1; ${fmtNum(slopeLimitDeg, 0)}° vale 0: el ángulo de estabilidad estática del vehículo de Actitud y vuelco, atan(radio de vuelco / altura del centro de masa).`);
    case 'feo': return t('0–20 wt.%: the span of lunar soils, from the highlands (a few %) to the iron-rich mare soils (about 20 %).', '0–20 % en peso: el rango de los suelos lunares, de las tierras altas (pocos %) a los suelos de mare ricos en hierro (~20 %).');
    default: return '';
  }
}

export function ScorePanel() {
  const t = useT();
  const u = useUnits();
  const slopeLimitDeg = useApp((s) => staticStabilityDeg(s.tipover));
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
    if (!layers) return c.id === 'psrProximity' ? t('window-shadow proxy', 'aproximado con la ventana') : t('layer not loaded', 'capa no cargada');
    return c.id === 'psrProximity' ? 'LOLA PSR' : c.id === 'feo' ? 'LP GRS' : 'GRAIL';
  };
  const dv = act.site?.diviner ?? null;
  const psr = act.site?.psr ?? null;

  return (
    <section className="panel score" data-testid="score-panel">
      <p className="kpi-note score-weighting">{t('Synthesized index: Earth view, sunlight, slope and FeO, weighted as in the team\'s state-of-the-art study. Each range is anchored to a physical limit (hover a criterion to see it).', 'Índice sintetizado: vista a la Tierra, luz, pendiente y FeO, ponderados según el estudio de estado del arte del equipo. Cada rango se ancla a un límite físico (pasa el cursor por un criterio para verlo).')}</p>
      <table className="kpi-table score-table">
        <thead>
          <tr>
            <th />
            <ScoreHead data={A} score={sa.score} />
            {compare && <ScoreHead data={B} score={sb.score} />}
          </tr>
        </thead>
        <tbody>
          {CRITERIA.map((c, k) => !INDEX_CRITERIA.includes(c.id) ? null : (
            <tr key={c.id} data-criterion={c.id}>
              <th scope="row" title={rangeWhy(c.id, slopeLimitDeg, t)} data-range={rangeWhy(c.id, slopeLimitDeg, t)}>
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
            <div><dt>{t('Annual mean surface temperature', 'Temperatura superficial media anual')}</dt><dd>{u.k(dv.tAvgK)}</dd></div>
            <div><dt>{t('Annual maximum temperature', 'Temperatura máxima anual')}</dt><dd>{u.k(dv.tMaxK)}</dd></div>
            <div><dt>{t('Water ice stable under the lander', 'Hielo de agua estable bajo el módulo')}</dt><dd>{dv.iceDepthM === null ? t('no', 'no') : dv.iceDepthM < 1e-6 ? t('at the surface', 'en superficie') : `${t('below', 'bajo')} ${fmtNum(dv.iceDepthM * 100, 0)} cm`}</dd></div>
            <div><dt>{t('Nearest ice-stable ground', 'Terreno con hielo estable más cercano')}</dt><dd>{dv.nearestIceStableKm === null ? `> ${u.kmStr(dv.searchRadiusKm, 0)}` : u.kmStr(dv.nearestIceStableKm, 2)}</dd></div>
            <div><dt>{t('Nearest surface cold trap', 'Trampa fría superficial más cercana')}</dt><dd>{dv.nearestSurfaceIceKm === null ? `> ${u.kmStr(dv.searchRadiusKm, 0)}` : u.kmStr(dv.nearestSurfaceIceKm, 2)}</dd></div>
            <div><dt>{t('Nearest PSR (20 m mask)', 'PSR más cercana (máscara de 20 m)')}</dt><dd>{psr.distanceKm === null ? `> ${u.kmStr(8, 0)}` : u.kmStr(psr.distanceKm, 2)}</dd></div>
            <div><dt>{t('PSR share of the 8 km disc', 'Fracción PSR del disco de 8 km')}</dt><dd>{fmtNum(psr.fractionWithin8kmPct, 1)} %</dd></div>
          </dl>
        ) : layers && (
          <p className="kpi-note pad0">{t('Diviner temperatures were fetched for the five candidate sites only. PSR distance, FeO and gravity are available at any point of the polar cap.', 'Las temperaturas de Diviner se obtuvieron solo para los cinco sitios candidatos. La distancia a PSR, el FeO y la gravedad están disponibles en cualquier punto del casquete polar.')}</p>
        )}
        {dv && (
          <p className="kpi-note pad0">
            {t(`The thermal model uses ${u.k(dv.tMaxK)}, the Diviner annual maximum here, as its sunlit sink temperature.`, `El modelo térmico usa ${u.k(dv.tMaxK)}, el máximo anual de Diviner aquí, como temperatura de sumidero al sol.`)}
          </p>
        )}

      </div>
      <p className="kpi-note">
        {t('Weights as listed in the team\'s state-of-the-art document (SOM / random-forest study, not checked against the paper), renormalised over the criteria in the index; the percentage under each score is the share of the published weight covered. Left out of the index because their normalisation range cannot be anchored to a physical limit or a requirement: kilometre-scale roughness, distance to a permanent shadow and the gravity anomaly. Hydrogen and geological density have no gridded layer in the archives used. FeO is one value per ~60 km pixel: it describes the region, not the landing point.', 'Pesos según el documento de estado del arte del equipo (estudio SOM / random forest, sin contrastar con el artículo), renormalizados sobre los criterios del índice; el porcentaje bajo cada índice es la parte del peso publicado cubierta. Quedan fuera del índice porque su rango de normalización no se puede anclar a un límite físico ni a un requisito: la rugosidad a escala kilométrica, la distancia a sombra permanente y la anomalía gravitatoria. El hidrógeno y la densidad geológica no tienen capa en malla en los archivos usados. El FeO es un valor por píxel de ~60 km: describe la región, no el punto de alunizaje.')}
      </p>
    </section>
  );
}
