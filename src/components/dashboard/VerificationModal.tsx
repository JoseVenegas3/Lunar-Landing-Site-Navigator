/** INCOSE-style verification matrix, evaluated live, with the telemetry and calendar exports. */
import { useEffect, useMemo, useRef } from 'react';
import { useInsights } from '../../state/insights';
import { useActiveScenario } from '../../state/mission';
import { useApp } from '../../state/store';
import { ICS_EVENT_LIMIT, buildOpsIcs, buildTelemetryCsv, downloadText } from '../../lib/export';
import { fmtDate, useT } from '../../lib/format';
import { VerificationStatus, buildVerificationMatrix } from '../../lib/verification';

const STATUS_TEXT: Record<VerificationStatus, [string, string]> = {
  VERIFIED: ['PASS / VERIFIED', 'CUMPLE / VERIFICADO'],
  PARTIAL: ['PARTIAL', 'PARCIAL'],
  INSPECTION: ['BY INSPECTION', 'POR INSPECCIÓN'],
  FAIL: ['FAIL', 'NO CUMPLE'],
};

export function VerificationModal() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const open = useApp((s) => s.verificationOpen);
  const setOpen = useApp((s) => s.setVerificationOpen);
  const data = useActiveScenario();
  const score = useInsights((s) => s.score[data.key]) ?? null;
  const dispersion = useInsights((s) => s.dispersion[data.key]) ?? null;
  const dialog = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => (open ? buildVerificationMatrix({ result: data.result, score, dispersion }) : []),
    [open, data.result, score, dispersion],
  );

  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const r = data.result;
  const meta = { site: data.name, scenario: data.key };
  const stem = r ? `clps_${data.short.toLowerCase()}_${fmtDate(r.eph.startMs)}_${Math.round(((r.count - 1) * r.stepHours) / 24)}d` : 'clps';
  const counts = rows.filter((x) => x.parent !== null).reduce<Record<string, number>>((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {});

  return (
    <div className="sheet-wrap">
      <div className="modal sheet" role="region" aria-labelledby="verif-title" tabIndex={-1} ref={dialog} data-testid="verification-modal">
        <header className="modal-head">
          <div>
            <h2 id="verif-title">{t('Systems engineering verification matrix', 'Matriz de verificación de ingeniería de sistemas')}</h2>
            <p className="mono">
              INCOSE SE Handbook / ISO/IEC/IEEE 15288 · {t('scenario', 'escenario')} {data.key} · {data.name}
            </p>
          </div>
          <button type="button" className="btn" onClick={() => setOpen(false)} data-testid="verification-close">{t('Close', 'Cerrar')}</button>
        </header>

        <div className="modal-body">
          <p className="verif-summary mono" data-testid="verification-summary">
            {counts.VERIFIED ?? 0} {t('verified', 'verificados')} · {counts.PARTIAL ?? 0} {t('partial', 'parciales')} · {counts.INSPECTION ?? 0} {t('by inspection', 'por inspección')} · {counts.FAIL ?? 0} {t('failed', 'fallidos')}
          </p>
          <table className="verif-table">
            <thead>
              <tr>
                <th>{t('Requirement', 'Requisito')}</th>
                <th>{t('Status', 'Estado')}</th>
                <th>{t('Evidence measured now', 'Evidencia medida ahora')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.parent === null ? 'is-parent' : ''} data-req={row.id} data-status={row.status}>
                  <th scope="row">
                    <span className="mono req-id">{row.id}</span>
                    {row.title[lang]}
                    {row.fn && <small className="mono">{row.fn}</small>}
                  </th>
                  <td><span className={`status status-${row.status}`}>{STATUS_TEXT[row.status][lang === 'es' ? 1 : 0]}</span></td>
                  <td className="evidence">{row.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kpi-note pad0">
            {t('Each row is recomputed when this dialog opens: analytic checks call the engine with known inputs, live figures come from the active scenario. "Partial" means the function works but an input it needs is not loaded. Evidence text is in English.', 'Cada fila se recalcula al abrir este diálogo: las comprobaciones analíticas llaman al motor con entradas conocidas y las cifras en vivo salen del escenario activo. «Parcial» significa que la función opera pero falta cargar una de sus entradas. El texto de evidencia está en inglés.')}
          </p>
        </div>

        <footer className="modal-foot">
          <span>{t('Export the simulated mission', 'Exportar la misión simulada')}</span>
          <button
            type="button" className="btn" disabled={!r} data-testid="export-csv"
            onClick={() => { if (r) downloadText(`${stem}_telemetry.csv`, buildTelemetryCsv(r, meta), 'text/csv;charset=utf-8'); }}
          >
            {t('Telemetry CSV', 'Telemetría CSV')}
          </button>
          <button
            type="button" className="btn" disabled={!r} data-testid="export-ics"
            onClick={() => { if (r) downloadText(`${stem}_operations.ics`, buildOpsIcs(r, meta), 'text/calendar;charset=utf-8'); }}
          >
            {t('Operations calendar (.ics)', 'Calendario de operaciones (.ics)')}
          </button>
          <small>{t(`One CSV row per hour in SI units. The calendar holds downlink passes per ground station, eclipses and loss events, up to ${ICS_EVENT_LIMIT}.`, `Una fila CSV por hora en unidades SI. El calendario contiene pasadas de descarga por estación, eclipses y eventos de pérdida, hasta ${ICS_EVENT_LIMIT}.`)}</small>
        </footer>
      </div>
    </div>
  );
}
