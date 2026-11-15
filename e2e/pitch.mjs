/**
 * End-to-end check of the video pitch player (`?pitch=true`), on the
 * production build, in real time (about 3.5 minutes):
 *   - loads without console errors and without any request to the internet;
 *   - plays the 180 s straight through the six acts and seventeen scenes, in order;
 *   - frame rate while playing (median of the player's own counter);
 *   - the emergency headline turns to SURVIVES after the one-click rescue;
 *   - ES / EN switches the teleprompter, H hides the controls, ← / → jump scenes.
 *
 *   npm run build && npm run e2e:pitch
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'artifacts', 'pitch');
mkdirSync(shots, { recursive: true });
const PORT = 4175;
const BASE = `http://127.0.0.1:${PORT}/`;

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};
async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start at ${url}`);
}

const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
try {
  await waitForServer(BASE);
  browser = await chromium.launch({
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const external = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) { external.push(u.href); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__pitchAudio = { played: [] }; });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // the button in Mission Leader's top bar opens the pitch
  await page.goto(`${BASE}?mode=leader`);
  await page.waitForSelector('[data-testid="pitch-open"]', { timeout: 60000 });
  check('Mission Leader has a one-click "Video pitch (3:00)" button', /3:00/.test(await page.textContent('[data-testid="pitch-open"]') ?? ''));

  await page.goto(`${BASE}?pitch=true`);
  await page.waitForSelector('[data-testid="pitch-start"]', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="pitch-play-big"]')?.hasAttribute('disabled'), null, { timeout: 60000 });
  check('?pitch=true opens the player with its start card', true);
  await page.click('[data-testid="pitch-play-big"]');

  // play straight through, sampling once per second
  const seen = [], acts = [], fps = [];
  let headAfter = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 230000) {
    const s = await page.evaluate(() => ({ t: window.__pitch.t(), scene: window.__pitch.scene(), act: window.__pitch.act(), fps: window.__pitch.fps(), done: window.__pitch.done(), head: document.querySelector('[data-testid="pitch-headline"]')?.textContent ?? '' }));
    if (seen[seen.length - 1] !== s.scene) { seen.push(s.scene); await page.screenshot({ path: join(shots, `${String(seen.length).padStart(2, '0')}-${s.scene}.png`) }); }
    if (acts[acts.length - 1] !== s.act) acts.push(s.act);
    if (s.t > 3) fps.push(s.fps);
    if (s.scene === 'rescue' && s.t > 157) headAfter = s.head;
    if (s.done) break;
    await page.waitForTimeout(1000);
  }
  const elapsed = (Date.now() - t0) / 1000;
  const order = ['im1', 'im2', 'stat', 'brand', 'gate', 'm0', 'badges', 'learn', 'ocean1', 'ocean2', 'ocean3', 'ocean4', 'ocean5', 'alert', 'rescue', 'trust', 'finale'];
  check('it plays the seventeen scenes in order', JSON.stringify(seen) === JSON.stringify(order), seen.join(' > '));
  check('it passes through the six acts', JSON.stringify(acts) === JSON.stringify(['hook', 'proposal', 'training', 'leader', 'emergency', 'close']), acts.join(' > '));
  const end = await page.evaluate(() => ({ t: window.__pitch.t(), done: window.__pitch.done() }));
  check('it lasts exactly 180 s and stops at 3:00', end.done && Math.abs(end.t - 180) < 1e-6 && elapsed > 175 && elapsed < 200, `${end.t} s, wall ${elapsed.toFixed(1)} s`);
  fps.sort((a, b) => a - b);
  const median = fps[Math.floor(fps.length / 2)] ?? 0, p10 = fps[Math.floor(fps.length * 0.1)] ?? 0;
  check('frame rate while playing: median ≥ 55 fps', median >= 55, `median ${median}, p10 ${p10}`);
  check('the one-click rescue turns the emergency headline to SURVIVES', /^SURVIVES(?! IF)/.test(headAfter), headAfter.slice(0, 120));
  const played = await page.evaluate(() => window.__pitchAudio.played);
  check('the procedural sound effects fire on cue (mocked audio)', ['landing', 'siren', 'thrusters', 'fanfare'].every((x) => played.includes(x)), played.join(','));

  // controls
  await page.evaluate(() => window.__pitch.seek(30));
  await page.waitForTimeout(400);
  const en = await page.textContent('[data-testid="pitch-prompter"]');
  await page.click('[data-testid="pitch-lang-es"]');
  await page.waitForTimeout(300);
  const es = await page.textContent('[data-testid="pitch-prompter"]');
  check('ES / EN switches the teleprompter', /GISAT UdeC built/.test(en ?? '') && /GISAT UdeC creó/.test(es ?? ''), `${en?.slice(0, 40)} | ${es?.slice(0, 40)}`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const right = await page.evaluate(() => window.__pitch.scene());
  await page.keyboard.press('h');
  await page.waitForTimeout(200);
  const hidden = (await page.locator('[data-testid="pitch-hud"]').count()) === 0;
  await page.keyboard.press('h');
  check('→ jumps to the next scene and H hides / shows the controls', right === 'gate' && hidden && (await page.locator('[data-testid="pitch-hud"]').count()) === 1, `${right} hidden=${hidden}`);
  const marks = await page.$$eval('.pk-mark em', (e) => e.map((x) => x.textContent));
  check('the progress bar carries the act marks 0:00 0:25 0:45 1:20 2:15 2:40 3:00', JSON.stringify(marks) === JSON.stringify(['0:00', '0:25', '0:45', '1:20', '2:15', '2:40', '3:00']), marks.join(' '));
  check('no request to the internet', external.length === 0, external.slice(0, 3).join(' '));
  check('no console errors or uncaught exceptions', errors.length === 0, errors.slice(0, 5).join(' | '));

  const failed = checks.filter((c) => !c.pass);
  writeFileSync(join(shots, 'pitch-report.json'), JSON.stringify({ date: new Date().toISOString(), checks, fps: { median, p10 }, scenes: seen }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
} catch (err) {
  console.error('PITCH E2E ABORTED:', err);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
  server.kill();
}
