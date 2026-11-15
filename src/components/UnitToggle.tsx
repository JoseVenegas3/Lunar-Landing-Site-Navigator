/** SI / Imperial switch (SR-711): in the top bar next to the language, and in long form on the entry gate. */
import { useApp } from '../state/store';
import { useT } from '../lib/format';

export function UnitToggle({ long = false, testid = 'units' }: { long?: boolean; testid?: string }) {
  const t = useT();
  const sys = useApp((s) => s.unitSystem);
  const set = useApp((s) => s.setUnitSystem);
  return (
    <div className={`lang units${long ? ' units-long' : ''}`} role="group" aria-label={t('Units', 'Unidades')} data-testid={testid} data-units={sys}>
      {long && <span className="units-cap">{t('Units', 'Unidades')}</span>}
      <button type="button" className={sys === 'si' ? 'is-on' : ''} aria-pressed={sys === 'si'} onClick={() => set('si')} data-testid={`${testid}-si`}
        title={t('International System: metres, kilometres, °C', 'Sistema Internacional: metros, kilómetros, °C')}>
        {long ? 'SI (m, °C)' : 'SI'}
      </button>
      <button type="button" className={sys === 'imperial' ? 'is-on' : ''} aria-pressed={sys === 'imperial'} onClick={() => set('imperial')} data-testid={`${testid}-imperial`}
        title={t('Imperial: feet, miles, °F (power, energy, frequency, dB and angles do not change)', 'Imperial: pies, millas, °F (potencia, energía, frecuencia, dB y ángulos no cambian)')}>
        {long ? 'Imperial (ft, °F)' : 'IMP'}
      </button>
    </div>
  );
}
