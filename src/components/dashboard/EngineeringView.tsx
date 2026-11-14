/**
 * Engineering view (Science console): the full KPI table of the mission, for
 * the engineer who wants every figure. The detailed timeline (one row per
 * ground station, the relay and simultaneous operations) sits in the bottom
 * tray of the same console.
 */
import { KpiMatrix } from './KpiMatrix';
import { useT } from '../../lib/format';

export function EngineeringView() {
  const t = useT();
  return (
    <div data-testid="engineering-view">
      <KpiMatrix />
      <p className="kpi-note">
        {t('The timeline below is the detailed one in this console: sunlight, battery, Earth in view, the downlink coloured by ground station, the relay when there is one, and the hours of simultaneous operations. The other consoles show the simple three-row version.', 'La línea de tiempo de abajo es la detallada en esta consola: luz solar, batería, Tierra visible, la descarga coloreada por estación terrena, el relay si lo hay y las horas de operación simultánea. Las demás consolas muestran la versión simple de tres filas.')}
      </p>
    </div>
  );
}
