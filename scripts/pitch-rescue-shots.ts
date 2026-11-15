/**
 * Rescue screenshots for the pitch deck (act V), taken from the real app.
 *
 *   npx tsx scripts/pitch-rescue-shots.ts
 *
 * Same scenario as guided mission 7 and the interface guide: Mission Leader,
 * Emergency mode, Nobile Crater Rim (85.2682° S, 32.0028° E), 4000 Wh left,
 * clock frozen at 2027-09-01 00:00 UTC, in Spanish at 1440 x 900. It saves the
 * diagnosis, presses «Ejecutar esta salida» and saves the result, and prints
 * the texts the app shows so the deck quotes the engine, not a memory of it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const PORT = 4181;
const W = 1440, H = 900;
const out = join(root, 'docs', 'img', 'pitch');

async function waitForServer(url: string, ms = 60000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not start at ${url}`);
}

const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`);
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, colorScheme: 'dark' });
  await ctx.addInitScript(() => { localStorage.setItem('clps.briefing', 'done'); localStorage.setItem('clps.dblhint', '1'); localStorage.setItem('clps.telemetry', '0'); });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date('2027-09-01T00:00:00Z'));
  await page.goto(`http://127.0.0.1:${PORT}/?mode=leader`);
  await page.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 120000 });
  await page.click('[data-testid="lang-es"]');
  await page.click('[data-testid="mode-triage"]');
  await page.waitForSelector('[data-testid="emg-inputs"]');
  await page.fill('[data-testid="tri-coords"]', '-85.2682, 32.0028');
  await page.click('[data-testid="tri-go"]');
  await page.fill('[data-testid="emg-energy"]', '4000');
  await page.locator('[data-testid="emg-energy"]').blur();
  await page.waitForTimeout(1000);
  const settled = () => page.waitForFunction(() => { const b = document.querySelector('[data-testid="exit-block"]'); return b && b.getAttribute('data-state') !== 'pending'; }, null, { timeout: 180000 });
  await settled();
  await page.waitForTimeout(3000);
  const read = () => page.evaluate(() => ({
    head: document.querySelector('[data-testid="surv-head"]')?.textContent?.replace(/\s+/g, ' ').trim(),
    options: [...document.querySelectorAll('[data-testid="exit-block"] li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim()),
    move: document.querySelector('[data-testid="exit-move"]')?.getAttribute('data-distance-m') + ' m @ ' + document.querySelector('[data-testid="exit-move"]')?.getAttribute('data-azimuth-deg') + '°',
  }));
  await page.mouse.move(W - 2, H - 2);
  await page.screenshot({ path: join(out, 'rescue-before.png') });
  console.log('BEFORE', JSON.stringify(await read(), null, 1));
  await page.click('[data-testid="exit-move"]');
  await page.waitForTimeout(1500);
  await settled();
  await page.waitForTimeout(3500);
  await page.mouse.move(W - 2, H - 2);
  await page.screenshot({ path: join(out, 'rescue-after.png') });
  console.log('AFTER', JSON.stringify(await read(), null, 1));
  await browser.close();
} finally {
  server.kill();
}
