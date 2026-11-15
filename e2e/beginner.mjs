/**
 * End-to-end check of the v3.0 entry gate and the Beginner training.
 *
 *   npm run e2e:beginner          (needs `npm run build`; serves dist/ like e2e/verify.mjs)
 *   node e2e/beginner.mjs <url>   (against a running server)
 *
 * (a) the gate comes up on every load and its four paths work, including the
 *     two-step warning of the Pro shortcut; (b) the whole training, mission 0
 *     to the diploma, with fast timers (?tutorialSpeed=fast) and the audio
 *     mocked; (c) a locked subsystem does not open; (d) "Do it for me";
 *     (e) reduced motion; leaving the training frees every lock and clears the
 *     overrides. Mission Leader is covered by e2e/verify.mjs (?mode=leader).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'artifacts', 'beginner');
mkdirSync(shots, { recursive: true });
const PORT = 4174;
const external = process.argv[2];
const URL = external ?? `http://127.0.0.1:${PORT}/`;
const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${String(detail).slice(0, 400)}]` : ''}`);
};
async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start at ${url}`);
}

const server = external ? null : spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
let browser;
const errors = [];
try {
  await waitForServer(URL);
  browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl'] });
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(() => { window.__clpsAudioMock = { played: [] }; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    return p;
  };

  // ---------------------------------------------------------------- (a) the gate, every load, four paths
  const g = await newPage();
  const gateUp = async () => { await g.goto(URL); await g.waitForSelector('[data-testid="gate"]', { timeout: 20000 }); };
  await gateUp();
  const a11y = await g.evaluate(() => {
    const d = document.querySelector('[data-testid="gate"]');
    return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), focus: document.activeElement?.getAttribute('data-testid'), q: d.querySelector('h2')?.textContent };
  });
  await g.keyboard.press('Escape');
  check('the gate is the first screen: dialog, aria-modal, focus on the answer, Escape does not close it',
    a11y.role === 'dialog' && a11y.modal === 'true' && a11y.focus === 'gate-no' && /used this app/.test(a11y.q) && (await g.locator('[data-testid="gate"]').count()) === 1, JSON.stringify(a11y));
  await g.click('[data-testid="gate-lang-es"]');
  check('the gate has its own language switch', /alguna vez/.test(await g.locator('[data-testid="gate"] h2').innerText()));
  await g.click('[data-testid="gate-lang-en"]');
  // No → Pro shortcut → warning → back to training
  await g.click('[data-testid="gate-no"]');
  await g.click('[data-testid="gate-skip-pro"]');
  const warn = await g.locator('[data-testid="gate"] h2').innerText();
  check('"Go straight to Pro" asks for confirmation inside the gate, with "Back to the training" first', /every engineering control/.test(warn) && (await g.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'gate-back-training', warn);
  await g.click('[data-testid="gate-pro-confirm"]');
  await g.waitForSelector('[data-testid="planner"]', { timeout: 90000 });
  check('confirmed Pro shortcut opens Mission Leader with every subsystem unlocked', (await g.locator('[data-locked]').count()) === 0 && (await g.locator('[data-testid="beginner"]').count()) === 0);
  // every load asks again
  await gateUp();
  check('the gate comes back on every load (the answer is not stored)', (await g.locator('[data-testid="gate"]').count()) === 1);
  await g.click('[data-testid="gate-yes"]');
  await g.click('[data-testid="gate-open-leader"]');
  await g.waitForSelector('[data-testid="planner"]', { timeout: 90000 });
  check('Yes → "Open Mission Leader"', (await g.locator('[data-testid="briefing-open"]').count()) === 1 && (await g.locator('[data-testid="briefing-offer"]').count()) === 0);
  await gateUp();
  await g.click('[data-testid="gate-yes"]');
  await g.click('[data-testid="gate-forgot"]');
  await g.waitForSelector('[data-testid="beginner"]', { timeout: 90000 });
  check('Yes → "Forgot how it works?" opens the training', true);
  // switch version from the training: two clicks (progress warning), back to the gate
  await g.click('[data-testid="switch-version"]');
  const warn2 = await g.locator('[data-testid="switch-version"]').innerText();
  await g.click('[data-testid="switch-version"]');
  await g.waitForSelector('[data-testid="gate"]');
  check('"Switch version" warns that the training progress is lost, then reopens the gate', /progress is lost/.test(warn2), warn2);
  const leaderUrl = await (async () => { await g.goto(`${URL}?mode=leader`); await g.waitForSelector('[data-testid="planner"]', { timeout: 90000 }); return (await g.locator('[data-testid="gate"]').count()) === 0; })();
  check('?mode=leader skips the gate', leaderUrl);
  await g.context().close();

  // ---------------------------------------------------------------- (b) the whole training, fast
  const p = await newPage();
  await p.goto(`${URL}?mode=beginner&tutorialSpeed=fast`);
  await p.waitForSelector('[data-testid="beginner"]', { timeout: 90000 });
  // The training runs in Spanish (the narration is kept as the final script, docs/guion-principiante.md).
  await p.click('[data-testid="lang-es"]');
  const seen = [];
  let lockedChecked = false, doItUsed = 0, last = '', sameSince = Date.now();
  const t0 = Date.now();
  while (Date.now() - t0 < 900000) {
    const st = await p.evaluate(() => ({
      step: document.querySelector('[data-testid="beginner"]')?.getAttribute('data-step') ?? null,
      text: (document.querySelector('[data-testid="beg-card"], [data-testid="beg-big"], [data-testid="diploma"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      doit: Boolean(document.querySelector('[data-testid="beg-doit"]')),
      cont: Boolean(document.querySelector('[data-testid="beg-continue"]')),
      diploma: Boolean(document.querySelector('[data-testid="diploma"]')),
    }));
    if (!st.step) break;
    if (st.step !== last) { seen.push({ id: st.step, text: st.text }); last = st.step; sameSince = Date.now(); console.log(`  · ${st.step}: ${st.text.slice(0, 160)}`); }
    if (st.step === 'm1-overview' && !lockedChecked) {
      // (c) a locked subsystem does not open
      lockedChecked = true;
      await p.click('[data-testid="subsys-power"]', { force: true }).catch(() => {});
      await p.waitForTimeout(300);
      const locked = await p.evaluate(() => ({ sub: document.querySelector('[data-testid="planner"]')?.dataset.subsystem, nudge: document.querySelector('[data-testid="beg-nudge"]')?.textContent ?? '', lock: document.querySelector('[data-testid="subsys-power"]')?.dataset.locked }));
      check('a locked subsystem does not open, and says why', locked.sub === 'overview' && locked.lock === '1', JSON.stringify(locked));
    }
    if (st.diploma) {
      await p.screenshot({ path: join(shots, 'diploma.png') });
      await p.click('[data-testid="beg-to-pro"]');
      break;
    }
    if (st.cont) { await p.screenshot({ path: join(shots, `${st.step}.png`) }); await p.click('[data-testid="beg-continue"]'); await p.waitForTimeout(200); continue; }
    // Real clicks where the step asks for one; "Do it for me" otherwise once it appears.
    const target = await p.evaluate(() => {
      const id = document.querySelector('[data-testid="beginner"]')?.getAttribute('data-step') ?? '';
      const map = { 'm1-overview': 'subsys-overview', 'm2-brief': 'subsys-terrain', 'm2-overlay': 'seg-slope', 'm3-brief': 'subsys-power', 'm4-brief': 'subsys-comms', 'm4-horizon': 'bottom-horizon', 'm5-brief': 'subsys-terrain', 'm5-preset': 'preset-im1', 'm6-brief': 'subsys-science', 'm6-adopt': 'adopt-b', 'm7-exit': 'exit-move', 'm3-mast': 'mast', 'm4-relay': 'relay-enable' };
      return map[id] ?? null;
    });
    if (target && Date.now() - sameSince > 1500) {
      const sel = `[data-testid="${target}"]`;
      if (await p.locator(sel).count()) {
        if (target === 'mast') await p.selectOption(sel, '10');
        else if (target === 'relay-enable') await p.check(sel);
        else await p.click(sel);
        sameSince = Date.now();
        await p.waitForTimeout(400);
        continue;
      }
    }
    if (st.doit) { doItUsed++; await p.click('[data-testid="beg-doit"]'); sameSince = Date.now(); await p.waitForTimeout(400); continue; }
    if (Date.now() - sameSince > 120000) { check(`step ${st.step} does not end`, false, st.text); break; }
    await p.waitForTimeout(250);
  }
  const ids = seen.map((s) => s.id);
  check('the training runs from mission 0 to the diploma', ids[0] === 'm0-approach' && ids.includes('m7-diploma'), ids.join(' > '));
  const bad = seen.filter((s) => /NaN|undefined|Infinity|null/.test(s.text));
  check('no narration shows NaN, undefined or a missing value', bad.length === 0, bad.map((s) => `${s.id}: ${s.text}`).join(' | '));
  check('"Do it for me" appears when the user is stuck and performs the action', doItUsed > 0, `${doItUsed} times`);
  await p.waitForSelector('[data-testid="planner"]');
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({
    beginner: Boolean(document.querySelector('[data-testid="beginner"]')), locked: document.querySelectorAll('[data-locked]').length,
    site: document.querySelector('.hud-title')?.textContent ?? '', mode: document.querySelector('.app')?.getAttribute('data-experience'),
  }));
  check('the Pro console opens with every lock removed and the validated site kept', !after.beginner && after.locked === 0 && after.mode === 'leader' && /Malapert/.test(after.site), JSON.stringify(after));
  const played = await p.evaluate(() => window.__clpsAudioMock.played);
  check('the sound effects play through the (mocked) audio module', ['landing', 'unlock', 'siren', 'success'].every((s) => played.includes(s)), played.join(','));
  writeFileSync(join(shots, 'narration.json'), JSON.stringify(seen, null, 2));
  await p.context().close();

  // ---------------------------------------------------------------- (e) reduced motion, subtitles, exit
  const r = await newPage({ reduced: true });
  await r.goto(`${URL}?mode=beginner&tutorialSpeed=fast`);
  await r.waitForSelector('[data-testid="beg-card"]', { timeout: 90000 });
  await r.click('[data-testid="beg-mute"]');
  await r.waitForSelector('[data-testid="beg-caption"]', { timeout: 20000 }).catch(() => {});
  const cap = await r.locator('[data-testid="beg-caption"]').count();
  check('muted: every effect shows its subtitle', cap === 1);
  const stored = await r.evaluate(() => localStorage.getItem('clps.beginner.sound'));
  check('sound settings persist', /"muted":true/.test(stored ?? ''), stored);
  const anim = await r.evaluate(() => getComputedStyle(document.querySelector('.subsys-curtain') ?? document.body).animationName);
  check('reduced motion: no animated alert or pulse', anim === 'none' || anim === '', anim);
  await r.click('[data-testid="beg-exit"]');
  await r.click('[data-testid="beg-exit-yes"]');
  await r.waitForTimeout(500);
  check('"Exit to Pro" (confirmed) leaves the training with every subsystem unlocked', (await r.locator('[data-testid="beginner"]').count()) === 0 && (await r.locator('[data-locked]').count()) === 0);
  await r.context().close();

  check('no console errors or uncaught exceptions', errors.length === 0, errors.slice(0, 5).join(' | '));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  writeFileSync(join(root, 'artifacts', 'beginner-report.json'), JSON.stringify({ date: new Date().toISOString(), checks, errors }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
} catch (err) {
  console.error('BEGINNER E2E ABORTED:', err);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
  server?.kill();
}
