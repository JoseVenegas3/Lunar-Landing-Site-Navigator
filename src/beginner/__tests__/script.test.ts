/**
 * The Beginner script (v3.0): Spanish and English parity, no number typed by
 * hand in a narration, a real end condition on every step, and the unlock
 * order of the consoles. The engine-backed predicates are covered by
 * scenarios.test.ts and the end-to-end run (e2e/beginner.mjs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MISSION_TITLES, SCRIPT } from '../script';
import { SFX_CAPTION } from '../audio';

const SRC = readFileSync(join(process.cwd(), 'src', 'beginner', 'script.ts'), 'utf8');

/** Literal text of every t('…', '…') / t(`…`, `…`) pair, with the interpolations removed. */
function pairs(src: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /t\(\s*(['`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*(['`])((?:\\.|(?!\3)[\s\S])*?)\3\s*\)/g;
  for (const m of src.matchAll(re)) out.push([m[2], m[4]]);
  return out;
}
const strip = (s: string): string => s.replace(/\$\{[^}]*\}/g, '');

describe('Beginner script', () => {
  const ps = pairs(SRC);

  it('every narration exists in English and Spanish, with the same interpolated values', () => {
    expect(ps.length).toBeGreaterThan(40);
    for (const [en, es] of ps) {
      expect(en.trim().length, es).toBeGreaterThan(0);
      expect(es.trim().length, en).toBeGreaterThan(0);
      const vars = (s: string): string[] => [...s.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].replace(/\s/g, '')).filter((x, i, a) => a.indexOf(x) === i).sort();
      expect(vars(es), en).toEqual(vars(en));
    }
  });

  it('no number is typed by hand in a narration (only names and labels of the interface)', () => {
    // Names and interface labels that contain digits: preset and mission names, the mast option, the 60-day search span of the guion.
    const allowed = /[−+]1 h|IM-1|IM-2|Chang'e 7|10 m|2 m|360°|60 days|60 días|\(2 m\)|Artemis III\/IV|Comms \/ RF/g;
    for (const [en, es] of ps) {
      for (const s of [en, es]) expect(strip(s).replace(allowed, ''), s).not.toMatch(/\d/);
    }
  });

  it('every step ends on a real action, a timed narration or a Continue button', () => {
    for (const s of SCRIPT) {
      const ways = [s.click, s.until, s.auto, s.cont, s.diploma].filter((x) => x !== undefined && x !== false).length;
      expect(ways, s.id).toBeGreaterThan(0);
      if (!s.auto && !s.cont && !s.diploma) expect(Boolean(s.click || s.until), s.id).toBe(true);
    }
  });

  it('the eight missions run in order and unlock the consoles one by one, ending with the diploma', () => {
    const missions = [...new Set(SCRIPT.map((s) => s.mission))];
    expect(missions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(MISSION_TITLES).toHaveLength(8);
    expect(SCRIPT.filter((s) => s.unlock).map((s) => s.unlock)).toEqual(['terrain', 'power', 'comms', 'science']);
    expect(SCRIPT.filter((s) => s.seal).map((s) => s.mission)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(SCRIPT[SCRIPT.length - 1].diploma).toBe(true);
    expect(new Set(SCRIPT.map((s) => s.id)).size).toBe(SCRIPT.length);
  });

  it('every sound effect has a subtitle in both languages', () => {
    for (const [k, [en, es]] of Object.entries(SFX_CAPTION)) {
      expect(en, k).toMatch(/^\[.+\]$/);
      expect(es, k).toMatch(/^\[.+\]$/);
    }
  });
});
