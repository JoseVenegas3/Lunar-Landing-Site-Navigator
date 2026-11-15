/**
 * Report cards of the five candidate sites, in the Sites tab of the planner
 * (moved there from the Explorer mode removed in v2.1). Each card measures the
 * site over the current window with the same engine and hardware, one site at
 * a time in the background; a click selects the site.
 *
 * Scales of the meters (every bar has a written reason):
 *   sunlight, Earth contact  0–100 % of the window (a physical share);
 *   longest night            full bar = hibernation autonomy of the battery
 *                            (capacity / survival load), so a full bar means
 *                            the night is as long as the battery can bridge.
 */
import { useEffect, useState } from 'react';
import { PUBLISHED_ILLUMINATION, CANDIDATE_SITES, Kpis, evaluateScenario } from '../../engine';
import { ensureLocal, getRegional } from '../../state/dem';
import { useApp } from '../../state/store';
import { fmtDuration, fmtNum, useT } from '../../lib/format';

/** Hours the battery alone carries the survival load: capacity / survival load (no depth-of-discharge limit, no heaters). */
export const hibernationHours = (batteryWh: number, survivalLoadW: number): number => batteryWh / Math.max(1, survivalLoadW);

/** KPIs of every candidate site for the current window, computed one site at a time in the background. */
function useScorecards(startMs: number, days: number): Record<string, Kpis | undefined> {
  const power = useApp((s) => s.power);
  const rf = useApp((s) => s.rf);
  const mastM = useApp((s) => s.mastM);
  const [cards, setCards] = useState<Record<string, Kpis | undefined>>({});
  useEffect(() => {
    let alive = true;
    setCards({});
    void (async () => {
      for (const site of CANDIDATE_SITES) {
        const local = await ensureLocal(site.latDeg, site.lonDeg);
        const regional = getRegional();
        if (!alive || !regional) return;
        const r = evaluateScenario({ regional, local }, {
          latDeg: site.latDeg, lonDeg: site.lonDeg, dxM: 0, dyM: 0, startMs, days, stepHours: 1, mastM, power, rf,
        });
        setCards((c) => ({ ...c, [site.id]: r.kpis }));
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    })();
    return () => { alive = false; };
  }, [startMs, days, power, rf, mastM]);
  return cards;
}

function Meter({ label, pct, tone, text, why }: { label: string; pct: number; tone: 'sun' | 'rf' | 'night'; text: string; why: string }) {
  return (
    <div className="meter" title={why}>
      <span>{label}</span>
      <div className="meter-track"><i className={`meter-fill meter-${tone}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>
      <output className="mono">{text}</output>
    </div>
  );
}

export function SiteCards() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const cfg = useApp((s) => s.scenarios.A);
  const update = useApp((s) => s.updateScenario);
  const battH = useApp((s) => hibernationHours(s.power.batteryCapacityWh, s.power.survivalLoadW));
  const cards = useScorecards(cfg.startMs, cfg.days);

  return (
    <section className="panel cards" aria-label={t('Candidate sites', 'Sitios candidatos')} data-testid="site-cards">
      <header className="panel-head">
        <h3>{t('Candidate sites', 'Sitios candidatos')}</h3>
        <span className="mono cards-cap">{cfg.days} d</span>
      </header>
      <ul className="site-cards">
        {CANDIDATE_SITES.map((site) => {
          const c = cards[site.id];
          const on = cfg.siteId === site.id;
          return (
            <li key={site.id}>
              <button type="button" className={`site-card${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => update('A', { siteId: site.id })} data-testid={`card-${site.id}`}>
                <strong className="site-label" data-site-label={site.name}>{site.name}</strong>
                <em>{site.summary[lang]}</em>
                {c ? (
                  <>
                    <Meter label={t('Sunlight', 'Luz solar')} tone="sun" pct={c.illuminationPct} text={`${fmtNum(c.illuminationPct, 0)} %`} why={t('Share of the window with the solar disc visible (0–100 %).', 'Parte de la ventana con el disco solar visible (0–100 %).')} />
                    <Meter label={t('Earth contact', 'Contacto Tierra')} tone="rf" pct={c.dtePct} text={`${fmtNum(c.dtePct, 0)} %`} why={t('Share of the window with the Earth above the terrain (0–100 %).', 'Parte de la ventana con la Tierra sobre el relieve (0–100 %).')} />
                    <Meter
                      label={t('Longest night', 'Noche más larga')} tone="night" pct={(100 * c.longestDarkH) / Math.max(1, battH)} text={fmtDuration(c.longestDarkH)}
                      why={t(`Full bar = ${fmtDuration(battH)}, what the battery can bridge in hibernation.`, `Barra llena = ${fmtDuration(battH)}, lo que la batería resiste en hibernación.`)}
                    />
                  </>
                ) : <span className="mono card-wait">{t('analysing terrain…', 'analizando el relieve…')}</span>}
                <small className="pub-contrast" data-testid={`pub-${site.id}`}>
                  {t('Published annual illumination', 'Iluminación anual publicada')}: {PUBLISHED_ILLUMINATION[site.id]?.illumPct != null ? `${fmtNum(PUBLISHED_ILLUMINATION[site.id].illumPct as number, 0)} %` : <span className="is-unverified">{t('not verified', 'sin verificar')}</span>}
                </small>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="kpi-note">{t('Same engine and hardware as the planner, without the thermal model. A full "Longest night" bar is a night as long as the battery can bridge in hibernation. Published illumination (Mazarico et al. 2011, Bussey et al. 2010, De Rosa et al. 2012) is an annual figure for the published point; this app computes the window on screen at its own landing point, so the two are compared, not expected to match exactly.', 'Mismo motor y equipo que el planificador, sin el modelo térmico. Una barra «Noche más larga» llena es una noche tan larga como la que la batería resiste en hibernación. La iluminación publicada (Mazarico et al. 2011, Bussey et al. 2010, De Rosa et al. 2012) es una cifra anual para el punto publicado; esta app calcula la ventana en pantalla en su propio punto de alunizaje, así que se comparan, no se espera que coincidan exactamente.')}</p>
    </section>
  );
}
