/**
 * Emergency headline and "Way out" block (v2.1 change 7): the three states,
 * in English and Spanish, with no jargon and a way-out block that is never
 * empty.
 */
import { describe, expect, it } from 'vitest';
import { ExitPlan, MoveOption, nextSunAfterH, survivalState } from '../exitPlan';
import { exitText } from '../../components/ExitBlock';

const START = Date.UTC(2027, 8, 1);
const en = (a: string): string => a;
const es = (_a: string, b: string): string => b;

const lostBase = { survives: false, lossH: 89, cause: 'battery' as const, minSocPct: 0 };
const move = (survives: boolean): MoveOption => ({
  survives, lossH: survives ? null : 120, cause: survives ? null : 'battery', eastM: 250, northM: 250, distanceM: 353.6, azimuthDeg: 45, gainH: survives ? 271 : 31,
});
const plan = (patch: Partial<ExitPlan>): ExitPlan => ({
  state: 'lost', horizonH: 360, startMs: START, base: lostBase, load: null, move: null, wait: null, need: null, done: true, progress: 1, ...patch,
});

const SURVIVES = plan({ state: 'survives', base: { survives: true, lossH: null, cause: null, minSocPct: 63 } });
const SURVIVES_IF = plan({
  state: 'survives-if', load: { currentW: 35, maxW: 21.4, atZero: { survives: true, lossH: null, cause: null } }, move: move(true),
  wait: { sunH: 140, alive: false, shortH: 51 },
});
const LOST = plan({
  state: 'lost', load: { currentW: 35, maxW: null, atZero: { survives: false, lossH: 130, cause: 'thermal' } }, move: move(false),
  wait: { sunH: 300, alive: false, shortH: 211 }, need: { energyWh: 9200, extraWh: 5200, ceilingWh: 40000 },
});

const JARGON = /NO-GO|lost at|se pierde en T/;

describe('survival state from the options', () => {
  it('survives / survives if / does not survive', () => {
    expect(survivalState(SURVIVES.base, null, null)).toBe('survives');
    expect(survivalState(lostBase, SURVIVES_IF.load, null)).toBe('survives-if');
    expect(survivalState(lostBase, null, move(true))).toBe('survives-if');
    expect(survivalState(lostBase, LOST.load, move(false))).toBe('lost');
  });
});

describe('headline and way out, in both languages', () => {
  for (const [lang, t] of [['en', en], ['es', es]] as const) {
    it(`${lang}: survives`, () => {
      const x = exitText(SURVIVES, t);
      expect(x.state).toBe('survives');
      expect(x.title).toBe(lang === 'en' ? 'SURVIVES' : 'SOBREVIVE');
      expect(x.line).toContain('15 d');
      expect(x.line).toContain('63 %');
      expect(x.exit).toBe(lang === 'en' ? 'Yes, there is a way out' : 'Sí hay salida');
      expect(x.missing).toBeNull();
    });
    it(`${lang}: survives if…`, () => {
      const x = exitText(SURVIVES_IF, t);
      expect(x.state).toBe('survives-if');
      expect(x.title).toBe(lang === 'en' ? 'SURVIVES IF…' : 'SOBREVIVE SI…');
      expect(x.line).toMatch(/21[.,]4 W/);
      // absolute date and time since the start
      expect(x.line).toContain('2027-09-04 17:00 UTC');
      expect(x.line).toContain('T+3 d 17 h');
      expect(x.options.map((o) => o.key)).toEqual(['load', 'move', 'wait']);
      expect(x.options[1].text).toMatch(/354 m/);
      expect(x.exit).toBe(lang === 'en' ? 'Yes, there is a way out' : 'Sí hay salida');
    });
    it(`${lang}: does not survive, and the way-out block is never empty`, () => {
      const x = exitText(LOST, t);
      expect(x.state).toBe('lost');
      expect(x.title).toBe(lang === 'en' ? 'DOES NOT SURVIVE' : 'NO SOBREVIVE');
      expect(x.line).toMatch(lang === 'en' ? /runs out of energy on 2027-09-04 17:00 UTC \(T\+3 d 17 h\) if nothing changes/ : /Se queda sin energía el 2027-09-04 17:00 UTC \(T\+3 d 17 h\) si no cambia nada/);
      expect(x.exit).toBe(lang === 'en' ? 'No way out with what was declared' : 'No hay salida con lo declarado');
      expect(x.options).toHaveLength(3);
      for (const o of x.options) expect(o.text.length).toBeGreaterThan(20);
      expect(x.missing).toMatch(/5\D?200 Wh/);
      expect(x.missing).toMatch(lang === 'en' ? /until the next sunlight/ : /para el próximo Sol/);
    });
    it(`${lang}: no jargon in any text`, () => {
      for (const p of [SURVIVES, SURVIVES_IF, LOST, plan({ done: false, progress: 0.4 })]) {
        const x = exitText(p, t);
        for (const s of [x.title, x.line, x.exit, x.missing ?? '', ...x.options.map((o) => o.text)]) expect(s).not.toMatch(JARGON);
      }
    });
  }

  it('while the options are computed the block says so (never empty)', () => {
    const x = exitText(plan({ done: false, progress: 0.4 }), es);
    expect(x.state).toBe('pending');
    expect(x.exit).toBe('Buscando una salida… 40 %');
    expect(x.options.every((o) => o.text.length > 0)).toBe(true);
  });
});

describe('next sunlight after the loss', () => {
  it('uses the sunFrac >= 0.5 test of the emergency countdown', () => {
    const sunFrac = new Float32Array([1, 1, 0, 0, 0.3, 0.6, 1]);
    const r = { count: 7, stepHours: 1, sunFrac } as unknown as Parameters<typeof nextSunAfterH>[0];
    expect(nextSunAfterH(r, 2)).toBe(5);
    expect(nextSunAfterH(r, 0)).toBe(0);
    expect(nextSunAfterH({ ...r, sunFrac: new Float32Array(7) } as typeof r, 1)).toBeNull();
  });
});
