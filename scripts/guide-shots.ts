/**
 * Screenshots of the real application for the interface guide (v2.1 change 2).
 *
 *   npm run guide-shots      (npm run guide runs this first, then builds the PDFs)
 *
 * Playwright drives the app served by the Vite dev server at 1440 x 900, in
 * its dark theme, once in Spanish (docs/img/es/) and once in English
 * (docs/img/en/). Everything that could vary is fixed so the images are
 * reproducible: the site and date are the app defaults (Shackleton
 * Connecting Ridge, 1 September 2027, T+4 d), the clock of the browser is
 * frozen at 2027-09-01 00:00 UTC (the emergency flow evaluates "from now"),
 * the first-visit card is skipped and the double-click hint is shown.
 * The images are generated, never edited by hand.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Page, chromium } from 'playwright';

const root = process.cwd();
const PORT = 4180;
// Mission Leader, past the entry gate of v3.0.
const URL = `http://127.0.0.1:${PORT}/?mode=leader`;
const W = 1440, H = 900;
const NOW = new Date('2027-09-01T00:00:00Z');

async function waitForServer(url: string, ms = 60000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not start at ${url}`);
}

const idle = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => !document.querySelector('[data-testid="subsys-curtain"]'), null, { timeout: 15000 });
};
const goSub = async (page: Page, s: string): Promise<void> => {
  if ((await page.evaluate(() => document.querySelector('[data-testid="planner"]')?.getAttribute('data-subsystem'))) === s) return;
  await page.click(`[data-testid="subsys-${s}"]`);
  await page.waitForFunction((x) => document.querySelector('[data-testid="planner"]')?.getAttribute('data-subsystem') === x, s);
  await idle(page);
  await page.waitForTimeout(2500);
};

async function shots(lang: 'es' | 'en'): Promise<void> {
  const out = join(root, 'docs', 'img', lang);
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'no-preference' });
  await ctx.addInitScript(() => { localStorage.setItem('clps.briefing', 'done'); localStorage.removeItem('clps.dblhint'); localStorage.setItem('clps.telemetry', '0'); });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(NOW);
  const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> => {
    await page.mouse.move(W - 2, H - 2);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${name}.png`), clip });
    console.log(`docs/img/${lang}/${name}.png`);
  };
  const box = async (sel: string, pad = 6) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`no ${sel}`);
    return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(W, b.width + 2 * pad), height: Math.min(H, b.height + 2 * pad) };
  };

  await page.goto(URL);
  await page.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 120000 });
  if (lang === 'es') await page.click('[data-testid="lang-es"]');
  await page.waitForTimeout(4000);

  await shot('01-barra-superior', { x: 0, y: 0, width: W, height: 52 });
  await shot('02-vista-3d', await box('[data-testid="deck"]', 0));
  await shot('03-resumen');
  await goSub(page, 'power'); await shot('04-energia');
  await goSub(page, 'comms'); await shot('05-comunicaciones');
  await goSub(page, 'terrain');
  await page.waitForSelector('[data-testid="exit-block"]');
  await page.waitForTimeout(3000);
  await shot('06-terreno');
  await goSub(page, 'science');
  await page.waitForTimeout(1500);
  await shot('07-ciencia');
  await page.click('[data-testid="dock-engineering"]');
  await page.waitForSelector('[data-testid="kpi-table"]');
  await page.waitForTimeout(1500);
  await shot('08-vista-ingenieria');

  await goSub(page, 'overview');
  await page.click('[data-testid="dock-windows"]');
  await page.click('[data-testid="compare-toggle"]');
  await page.waitForSelector('[data-testid="quick-A"]', { timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.locator('[data-testid="compare-block"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot('09-ventanas-comparar');
  await page.click('[data-testid="compare-toggle"]');
  await page.waitForTimeout(800);

  await shot('10-exportar', { x: W - 520, y: 0, width: 520, height: 52 });

  await page.click('[data-testid="mode-triage"]');
  await page.waitForSelector('[data-testid="emg-inputs"]');
  await page.fill('[data-testid="tri-coords"]', '-85.2682, 32.0028');
  await page.click('[data-testid="tri-go"]');
  await page.fill('[data-testid="emg-energy"]', '4000');
  await page.locator('[data-testid="emg-energy"]').blur();
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="exit-block"]'); return b && b.getAttribute('data-state') !== 'pending'; }, null, { timeout: 180000 });
  await page.waitForSelector('[data-testid="micro-hazard"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot('11-modo-emergencia');
  await shot('12-salida', await box('[data-testid="tri-step-1"]', 4));

  await page.click('[data-testid="mode-planner"]');
  await page.waitForTimeout(2500);
  await page.click('[data-testid="briefing-open"]');
  await page.click('[data-testid="briefing-go"]');
  await page.waitForSelector('[data-testid="briefing-step"][data-step="4"]').catch(() => undefined);
  for (let i = 1; i < 4; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500); }
  await page.waitForTimeout(2000);
  await shot('13-tutorial');
  await page.keyboard.press('Escape');
  await browser.close();
}

const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`);
  await shots('es');
  await shots('en');
} finally {
  server.kill();
}
