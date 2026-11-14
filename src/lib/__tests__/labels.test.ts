/**
 * Interface rule (v2.0, change 11): a site or terrain label shows the full
 * name or nothing, never an abbreviation, a diminutive or a clipped string.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SITES } from '../../engine';
import { CUSTOM_SITE_NAME, scenarioLatLon } from '../../state/store';

const SRC = join(process.cwd(), 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? (f === '__tests__' ? [] : files(p)) : [p];
});
const uiSources = [...files(join(SRC, 'components')), ...files(join(SRC, 'state')), ...files(join(SRC, 'lib'))].filter((f) => /\.tsx?$/.test(f));

describe('site labels are never abbreviated', () => {
  it('every scenario resolves to the full site name', () => {
    for (const site of ALL_SITES) {
      const r = scenarioLatLon({ siteId: site.id, customLat: 0, customLon: 0, dxM: 0, dyM: 0, startMs: 0, days: 1 });
      expect(r.name).toBe(site.name);
      expect(Object.keys(r)).not.toContain('short');
    }
    const custom = { siteId: 'custom', customLat: -85, customLon: 10, dxM: 0, dyM: 0, startMs: 0, days: 1 };
    expect(scenarioLatLon(custom, 'en').name).toBe(CUSTOM_SITE_NAME.en);
    expect(scenarioLatLon(custom, 'es').name).toBe(CUSTOM_SITE_NAME.es);
  });

  it('no interface code reads the abbreviated site code', () => {
    const offenders = uiSources.filter((f) => /\.short\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no interface code truncates a name with slice or substring', () => {
    const bad = uiSources.filter((f) => /\bname\s*\.\s*(slice|substring|substr)\s*\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('site labels are styled to wrap, never to clip with an ellipsis', () => {
    const css = readFileSync(join(SRC, 'styles', 'global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
    const labelRules = rules.filter((r) => /site-label|hud-title|kpi-site|site-card strong|terrain-tag/.test(r.sel));
    expect(labelRules.length).toBeGreaterThan(0);
    for (const r of labelRules) expect(r.body, r.sel).not.toMatch(/text-overflow:\s*ellipsis/);
    const site = rules.find((r) => r.sel === '.site-label');
    expect(site?.body).toMatch(/white-space:\s*normal/);
  });
});
