/**
 * End-to-end verification (render -> look -> fix loop).
 *
 *   npm run build && npm run e2e
 *
 * Serves the production build, drives it in headless Chromium, and checks:
 * no console errors, no overlapping layout regions, frame rate, the dual
 * comparator, the micro-relocation tool (slider and drag), overlays, camera
 * modes, Explorer mode, language switch and the narrow layout.
 * Screenshots go to artifacts/screenshots/, the report to artifacts/verify-report.json.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'artifacts', 'screenshots');
mkdirSync(shots, { recursive: true });
const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;

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
  await waitForServer(URL);
  browser = await chromium.launch({
    headless: true,
    // ANGLE GL backend: the D3D11 backend makes headless Chromium pause its vsync
    // scheduler for ~450 ms at a time even on an empty page (see e2e/perf-probe.mjs).
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });
  // The checks below exercise every panel: start at the engineering level with the first-visit tour done.
  await page.addInitScript(() => { localStorage.setItem('clps.expert', '1'); localStorage.setItem('clps.briefing', 'done'); });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const shot = (name) => page.screenshot({ path: join(shots, name) });
  // Console navigation as a person does it: pick the subsystem that has the panel, then its tab.
  const SUBS = {
    overview: { left: ['sites'], right: ['vitals', 'compare', 'windows'], bottom: ['timeline'] },
    power: { left: ['hardware'], right: ['energy'], bottom: ['thermal', 'timeline'] },
    comms: { left: ['hardware'], right: ['link'], bottom: ['horizon', 'timeline'] },
    terrain: { left: ['contingency'], right: ['survival'], bottom: ['horizon', 'timeline'] },
    science: { left: ['sites'], right: ['score'], bottom: ['timeline'] },
  };
  const ORDER = ['overview', 'power', 'comms', 'terrain', 'science'];
  const sideOf = (s, id) => ['left', 'right', 'bottom'].find((k) => SUBS[s][k].includes(id));
  const subsystemNow = () => page.evaluate(() => document.querySelector('[data-testid="planner"]')?.dataset.subsystem);
  const goSub = async (s) => {
    if ((await subsystemNow()) === s) return;
    await page.click(`[data-testid="subsys-${s}"]`);
    await page.waitForFunction((x) => document.querySelector('[data-testid="planner"]')?.dataset.subsystem === x, s);
  };
  const openPanel = async (id, sub) => {
    const now = await subsystemNow();
    const s = sub ?? (sideOf(now, id) ? now : ORDER.find((x) => sideOf(x, id)));
    await goSub(s);
    const side = sideOf(s, id);
    if (side !== 'bottom' && (await page.locator(`[data-testid="drawer-${side}"]`).count()) === 0) await page.click(`[data-testid="open-${side}"]`);
    for (const sel of [`[data-testid="dock-${id}"]`, `[data-testid="bottom-${id}"]`]) {
      if (await page.locator(sel).count()) { await page.click(sel); break; }
    }
    await page.waitForTimeout(120);
  };
  const kpi = async (id, col) => {
    if ((await page.locator('[data-testid="kpi-table"]').count()) === 0) {
      await openPanel('compare');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="kpi-table"] tbody td').length >= 24 && !document.querySelector('[data-testid="kpi-table"] td.is-pending'), null, { timeout: 60000 });
    }
    return (await page.locator(`[data-testid="kpi-table"] tbody td[data-kpi="${id}"]`).nth(col).innerText()).trim();
  };
  const kpisReady = () => page.waitForFunction(() => {
    const cells = document.querySelectorAll('[data-testid="kpi-table"] tbody td');
    return cells.length >= 24 && !document.querySelector('[data-testid="kpi-table"] td.is-pending');
  }, null, { timeout: 60000 });
  // Frame pacing: the median and 95th-percentile frame intervals describe the
  // steady state; isolated stalls (GC, first-use shader compilation) are reported separately.
  const fps = (ms = 4000) => page.evaluate((dur) => new Promise((resolve) => {
    const times = [];
    const scene0 = window.__clps ? window.__clps.frames : 0;
    const tick = (t) => {
      times.push(t);
      if (t - times[0] < dur) { requestAnimationFrame(tick); return; }
      const span = times[times.length - 1] - times[0];
      const dts = times.slice(1).map((v, i) => v - times[i]).sort((a, b) => a - b);
      resolve({
        mean: ((times.length - 1) * 1000) / span,
        scene: (((window.__clps ? window.__clps.frames : 0) - scene0) * 1000) / span,
        medianMs: dts[Math.floor(dts.length / 2)],
        p95Ms: dts[Math.floor(dts.length * 0.95)],
        maxMs: dts[dts.length - 1],
        slow: dts.filter((d) => d > 25).length,
        frames: dts.length,
      });
    };
    requestAnimationFrame(tick);
  }), ms);
  const at60 = (f) => f.medianMs <= 17.5 && f.p95Ms <= 20 && f.scene >= 50;
  const fpsText = (f) => `median ${f.medianMs.toFixed(1)} ms (${(1000 / f.medianMs).toFixed(0)} fps), p95 ${f.p95Ms.toFixed(1)} ms, mean ${f.mean.toFixed(1)} fps, scene ${f.scene.toFixed(1)} fps, ${f.slow}/${f.frames} frames > 25 ms, worst ${f.maxMs.toFixed(0)} ms`;
  const overlaps = () => page.evaluate(() => {
    const out = [];
    const rect = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
    const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    // Trays float over the 3-D view by design; they must not overlap each other, the console bars or the HUD.
    const regions = ['.subsys-bar', '.verdict', '.tray-left', '.tray-right', '.tray-bottom', '.tray-handle-left', '.tray-handle-right', '.ex-stage', '.ex-side', '.ex-time'].filter((s) => document.querySelector(s));
    for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) if (hit(rect(regions[i]), rect(regions[j]))) out.push(`${regions[i]} x ${regions[j]}`);
    const hud = ['.hud-tl', '.hud-tr', '.hud-bl', '.hud-br'].filter((s) => document.querySelector(s) && getComputedStyle(document.querySelector(s)).display !== 'none');
    for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) if (hit(rect(hud[i]), rect(hud[j]))) out.push(`${hud[i]} x ${hud[j]}`);
    for (const h of hud) for (const tr of ['.tray-left', '.tray-right', '.tray-bottom']) if (hit(rect(h), rect(tr))) out.push(`${h} x ${tr}`);
    const top = rect('.topbar');
    const kids = [...document.querySelectorAll('.topbar > *')].map((e) => e.getBoundingClientRect());
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit(kids[i], kids[j])) out.push(`topbar child ${i} x ${j}`);
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const e of document.querySelectorAll('.ro-cell output, .kpi-val span, .subsys-btn span, .vital-value')) {
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') out.push(`clipped text: ${e.textContent}`);
    }
    return { out, top: top ? top.height : 0 };
  });

  // ---------------------------------------------------------- boot + planner
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForSelector('[data-testid="planner"]', { timeout: 60000 });
  await page.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 60000 });
  const calm = await page.evaluate(() => ({
    sub: document.querySelector('[data-testid="planner"]')?.dataset.subsystem,
    left: Boolean(document.querySelector('.tray-left [data-testid="scenario-A"]')), vitals: Boolean(document.querySelector('[data-testid="vitals"]')),
    readout: Boolean(document.querySelector('.readout')), legend: Boolean(document.querySelector('[data-testid="legend"]')),
    pano: Boolean(document.querySelector('.pano-canvas')), timeline: Boolean(document.querySelector('.timeline-canvas')),
    modal: Boolean(document.querySelector('[aria-modal="true"]')),
  }));
  check('default console: overview with sites, vitals and timeline, no modal', calm.sub === 'overview' && calm.left && calm.vitals && !calm.readout && !calm.legend && !calm.pano && calm.timeline && !calm.modal, JSON.stringify(calm));
  await page.waitForFunction(() => window.__clps && window.__clps.frames > 5, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('00-planner-default-workspace.png');
  const terrainTag = await page.locator('[data-testid="terrain-A"]').innerText();
  check('scenario runs on real LOLA terrain at 20 m/px', /LOLA, 20 m\/px/.test(terrainTag), terrainTag);

  // minimise everything, then reopen: trays float, so the canvas never changes size
  const sceneBox0 = await page.locator('.scene').boundingBox();
  const landerX0 = await page.evaluate(() => window.__clps.landerScreen()?.x ?? 0);
  await page.click('[data-testid="min-left"]');
  await page.click('[data-testid="min-right"]');
  await page.click('[data-testid="min-bottom"]');
  await page.waitForTimeout(500);
  const sceneBox = await page.locator('.scene').boundingBox();
  const landerX1 = await page.evaluate(() => window.__clps.landerScreen()?.x ?? 0);
  const gone = await page.evaluate(() => !document.querySelector('.tray-left') && !document.querySelector('.tray-right') && !document.querySelector('.timeline-canvas'));
  check('trays minimise without resizing the 3-D canvas; the view re-centres on the free area', gone && sceneBox.width === sceneBox0.width && sceneBox.height === sceneBox0.height && Math.abs(landerX1 - landerX0) > 10,
    `canvas ${Math.round(sceneBox0.width)} x ${Math.round(sceneBox0.height)} -> ${Math.round(sceneBox.width)} x ${Math.round(sceneBox.height)} px; lander x ${Math.round(landerX0)} -> ${Math.round(landerX1)} px`);
  await shot('00b-all-panels-minimised.png');
  await page.click('[data-testid="open-left"]');
  await page.click('[data-testid="bottom-timeline"]');
  await page.click('[data-testid="dock-telemetry"]');
  await openPanel('compare');
  await page.waitForTimeout(300);
  check('trays reopen from their edge handles and tabs', await page.evaluate(() => Boolean(document.querySelector('.tray-left') && document.querySelector('.timeline-canvas') && document.querySelector('.readout') && document.querySelector('[data-testid="kpi-table"]'))));
  await kpisReady();
  await page.waitForFunction(() => window.__clps && window.__clps.frames > 5, null, { timeout: 30000 });
  const bootMs = Date.now() - t0;

  // contextual console: each subsystem brings its panels, accent and 3-D layer
  const EXPECT = {
    power: { accent: '#F59E0B', overlay: 'Sun hours', left: 'Power system', right: 'thermal-kpis', bottom: 'thermal-chart' },
    comms: { accent: '#06B6D4', overlay: 'Earth view', left: 'DTE radio link', right: 'link-budget', bottom: 'panorama' },
    terrain: { accent: '#E2E8F0', overlay: 'Slope', left: 'Landing attitude', right: 'dispersion-panel', bottom: 'panorama' },
    science: { accent: '#B49CFF', overlay: 'Shadows', left: 'Landing site', right: 'score-A', bottom: 'timeline' },
  };
  const canvas0 = await page.locator('.scene canvas').boundingBox();
  const subResults = [];
  for (const [s, e] of Object.entries(EXPECT)) {
    await goSub(s);
    await page.waitForTimeout(500);
    const got = await page.evaluate(({ e }) => ({
      accent: getComputedStyle(document.querySelector('[data-testid="planner"]')).getPropertyValue('--accent').trim(),
      overlay: [...document.querySelectorAll('.hud-tr .seg button.is-on, .hud-tr button.is-on')].map((b) => b.textContent).join('|'),
      left: (document.querySelector('.tray-left')?.textContent ?? '').includes(e.left),
      right: Boolean(document.querySelector(`.tray-right [data-testid="${e.right}"]`)),
      bottom: Boolean(document.querySelector(`.tray-bottom [data-testid="${e.bottom}"]`)),
      // the RF and power panels hide the other half of the hardware form
      relayHidden: !document.querySelector('[data-testid="relay-enable"]'), mountHidden: !document.querySelector('[data-testid="mount"]'),
    }), { e });
    const ok = got.accent.toUpperCase() === e.accent && got.overlay.includes(e.overlay) && got.left && got.right && got.bottom
      && (s !== 'power' || got.relayHidden) && (s !== 'comms' || got.mountHidden);
    subResults.push(`${s}: ${ok ? 'ok' : JSON.stringify(got)}`);
    await shot(`00c-subsystem-${s}.png`);
  }
  const canvas1 = await page.locator('.scene canvas').boundingBox();
  check('each subsystem brings its own panels, accent colour and terrain layer', subResults.every((x) => x.endsWith('ok')), subResults.join('; '));
  check('switching subsystems never resizes the 3-D canvas', canvas0.width === canvas1.width && canvas0.height === canvas1.height, `${Math.round(canvas0.width)} x ${Math.round(canvas0.height)} px`);
  await goSub('power');
  await page.click('[data-testid="play"]');
  await page.waitForTimeout(1500);
  const glassFps = await fps(4000);
  await page.click('[data-testid="play"]');
  check('60 fps with the glass trays open over the scene (power console, playback)', at60(glassFps), fpsText(glassFps));
  await goSub('overview');
  await openPanel('compare');
  await kpisReady();
  check('boots to the planner with both scenarios evaluated', true, `${bootMs} ms`);
  await page.waitForTimeout(5000); // let first-use shader compilation and JIT warm-up finish

  const gl = await page.evaluate(() => {
    const c = document.querySelector('.scene canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    const ext = g && g.getExtension('WEBGL_debug_renderer_info');
    return g ? (ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'webgl (renderer hidden)') : 'no webgl';
  });
  console.log(`      WebGL renderer: ${gl}`);
  await shot('01-planner-default.png');

  // The WebGL back buffer is only readable inside the frame that drew it, so sample
  // it from an animation-frame callback that runs after the scene renderer.
  const sceneLit = await page.evaluate(() => new Promise((resolve) => {
    const sample = () => {
      const c = document.querySelector('.scene canvas');
      const probe = document.createElement('canvas');
      probe.width = 160; probe.height = 90;
      const g = probe.getContext('2d');
      g.drawImage(c, 0, 0, 160, 90);
      const d = g.getImageData(0, 0, 160, 90).data;
      let bright = 0;
      const varied = new Set();
      for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; if (l > 120) bright++; varied.add(l >> 4); }
      resolve({ bright, levels: varied.size });
    };
    requestAnimationFrame(() => requestAnimationFrame(sample));
  }));
  check('3-D scene renders terrain (not a blank canvas)', sceneLit.bright > 150 && sceneLit.levels > 8, `bright px ${sceneLit.bright}, levels ${sceneLit.levels}`);

  let lay = await overlaps();
  check('planner layout has no overlapping regions or clipped read-outs', lay.out.length === 0, lay.out.join('; '));

  const idle = await fps(4000);
  check('60 fps frame pacing, idle', at60(idle), fpsText(idle));

  // ---------------------------------------------------------------- playback
  const clock0 = await page.locator('[data-testid="clock"] output').innerText();
  await page.click('[data-testid="play"]');
  await page.waitForTimeout(1500);
  const playing = await fps(5000);
  await shot('02-playback.png');
  await page.click('[data-testid="play"]');
  const clock1 = await page.locator('[data-testid="clock"] output').innerText();
  check('playback advances the mission clock', clock0 !== clock1, `${clock0} -> ${clock1}`);
  check('60 fps frame pacing during playback (shadow sweep every frame)', at60(playing), fpsText(playing));

  // -------------------------------------------------------------- comparator
  const a0 = await kpi('illum', 0), b0 = await kpi('illum', 1);
  check('comparator shows distinct KPIs for sites A and B', a0 !== b0, `A ${a0} | B ${b0}`);
  await page.click('[data-testid="tab-B"]');
  await page.selectOption('[data-testid="site-B"]', 'nobile-rim');
  await page.waitForTimeout(300);
  await kpisReady();
  const b1 = await kpi('illum', 1);
  check('changing site B recomputes its column only', b1 !== b0 && (await kpi('illum', 0)) === a0, `B ${b0} -> ${b1}`);
  await page.fill('[data-testid="start-B"]', '2028-03-01');
  await page.waitForTimeout(400);
  await kpisReady();
  const b2 = await kpi('illum', 1);
  check('changing date range B recomputes its KPIs', b2 !== b1, `B ${b1} -> ${b2}`);
  await page.waitForTimeout(1500);
  await shot('03-comparator-site-and-dates.png');
  await page.click('[data-testid="tab-A"]');
  await page.waitForTimeout(1200);

  // --------------------------------------------------------- micro-relocation
  const before = { illum: await kpi('illum', 0), dte: await kpi('dte', 0) };
  const tReloc = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="dy-A"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const t = performance.now();
    set.call(el, '400');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t;
  });
  await page.waitForTimeout(250);
  const after = { illum: await kpi('illum', 0), dte: await kpi('dte', 0) };
  check('a 400 m relocation changes the site KPIs', before.illum !== after.illum || before.dte !== after.dte, `illum ${before.illum} -> ${after.illum}, DTE ${before.dte} -> ${after.dte}`);
  check('relocation recompute + repaint is interactive', tReloc < 120, `${tReloc.toFixed(0)} ms for horizon, series, KPIs and two frames`);
  await shot('04-relocated-400m-north.png');

  const p = await page.evaluate(() => window.__clps.landerScreen());
  const readout0 = await page.locator('[data-testid="reloc-readout"]').innerText();
  await page.mouse.move(p.x, p.y - 6);
  await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y + 14, { steps: 6 });
  await page.mouse.move(p.x + 60, p.y + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const readout1 = await page.locator('[data-testid="reloc-readout"]').innerText();
  check('dragging the lander in the 3-D view relocates it', readout0 !== readout1, `${readout0.replace(/\s+/g, ' ')} -> ${readout1.replace(/\s+/g, ' ')}`);
  await shot('05-relocated-by-drag.png');
  await page.getByRole('button', { name: 'Return to nominal point' }).click();
  await page.waitForTimeout(300);
  check('returning to the nominal point restores the KPIs', (await kpi('illum', 0)) === before.illum, await kpi('illum', 0));

  // ------------------------------------------------------ overlays and views
  await page.getByRole('button', { name: 'Sun hours' }).click();
  await page.waitForFunction(() => /of the window/.test(document.querySelector('.ramp-labels')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await shot('06-insolation-map.png');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.waitForTimeout(900);
  await shot('07-map-view-insolation.png');
  await page.getByRole('button', { name: 'Earth view' }).click();
  await page.waitForFunction(() => /of the window/.test(document.querySelector('.ramp-labels')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await shot('08-earth-visibility-map.png');
  lay = await overlaps();
  check('HUD with overlay legend has no overlaps', lay.out.length === 0, lay.out.join('; '));
  await page.getByRole('button', { name: 'Shadows' }).click();
  await page.getByRole('button', { name: 'Lander eye' }).click();
  await page.waitForTimeout(1200);
  await shot('09-lander-eye.png');
  await page.getByRole('button', { name: 'Orbit' }).click();
  await page.waitForTimeout(900);

  // hardware: a deck-mounted array is nearly useless at the pole
  const e0 = await kpi('energy', 0);
  await openPanel('hardware');
  await page.selectOption('[data-testid="mount"]', 'horizontal');
  await page.waitForTimeout(300);
  const e1 = await kpi('energy', 0);
  await openPanel('hardware');
  await page.selectOption('[data-testid="mount"]', 'tracker1axis');
  check('array mount type drives the energy KPI', e0 !== e1, `tracker ${e0} vs horizontal ${e1}`);
  await goSub('comms');
  await page.selectOption('[data-testid="station"]', 'gisat37');
  await page.waitForTimeout(300);
  const rateText = await page.locator('[data-testid="link-budget"]').innerText();
  check('link budget follows the ground-station choice', /kbps|Mbps/.test(rateText), rateText.split('\n').slice(12, 14).join(' '));
  await shot('10-link-budget-gisat-station.png');
  await page.selectOption('[data-testid="station"]', 'dsn34');

  // relay constellation
  const dteBefore = parseFloat(await kpi('dte', 0));
  await goSub('comms');
  await page.check('[data-testid="relay-enable"]');
  await page.waitForTimeout(400);
  const relayOrbit = (await page.locator('[data-testid="relay-orbit"]').innerText()).trim();
  await page.locator('[data-testid="drawer-left"] .drawer-body').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.waitForTimeout(600);
  await shot('10b-relay-constellation.png');
  lay = await overlaps();
  check('communications console with the relay form has no overlaps', lay.out.length === 0, lay.out.join('; '));
  await page.waitForTimeout(200);
  const anyLink = parseFloat(await kpi('anylink', 0));
  const outage = await kpi('outage', 0);
  check('a relay constellation raises the link coverage above direct-to-Earth', anyLink > dteBefore + 20 && Math.abs(parseFloat(await kpi('dte', 0)) - dteBefore) < 0.05,
    `DTE ${dteBefore} % -> any path ${anyLink} %, longest total outage ${outage}; ${relayOrbit}`);
  await goSub('comms');
  await page.selectOption('[data-testid="relay-preset"]', 'polar');
  await page.waitForTimeout(500);
  const lowOrbit = parseFloat(await kpi('relay', 0));
  check('a low polar relay gives short passes instead of long dwell', lowOrbit > 0 && lowOrbit < 30, `relay in view ${lowOrbit} % of the window`);
  await goSub('comms');
  await page.uncheck('[data-testid="relay-enable"]');
  await openPanel('sites');
  await page.waitForTimeout(300);

  // ------------------------------------------------ contingency modules (SyR-P2 .. SyR-P5)
  const legendText = await page.locator('.timeline .legend').innerText();
  check('timeline shows the DSN stations handing over', /Goldstone/.test(legendText) && /Madrid/.test(legendText) && /Canberra/.test(legendText), legendText.replace(/\s+/g, ' '));

  // SyR-P2: landing attitude
  const dataLevel = await kpi('data', 0);
  await openPanel('contingency');
  const tAtt = await page.evaluate(async () => {
    const t = performance.now();
    document.querySelector('[data-testid="preset-im1"]').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return performance.now() - t;
  });
  await page.waitForSelector('[data-testid="attitude-alert"]', { timeout: 10000 });
  const attText = (await page.locator('[data-testid="attitude-kpis"]').innerText()).replace(/\s+/g, ' ');
  const dataTilted = await kpi('data', 0);
  check('IM-1 preset (30° roll) cuts the science return and raises the antenna alert', dataTilted !== dataLevel && /30\.0°/.test(attText), `data ${dataLevel} -> ${dataTilted}; ${attText}`);
  check('attitude change is recomputed and repainted interactively', tAtt < 250, `${tAtt.toFixed(0)} ms for the whole mission and two frames`);
  await openPanel('contingency');
  await page.waitForTimeout(700);
  await shot('18-attitude-im1-odysseus.png');
  await page.click('[data-testid="preset-im2"]');
  await page.waitForTimeout(900);
  await shot('19-attitude-im2-athena.png');
  await page.click('[data-testid="preset-slim"]');
  await page.waitForTimeout(900);
  const slimText = (await page.locator('[data-testid="attitude-kpis"]').innerText()).replace(/\s+/g, ' ');
  check('SLIM preset (85° pitch) is representable and evaluated', /85\.0°/.test(slimText), slimText);
  await shot('20-attitude-slim.png');
  lay = await overlaps();
  check('contingency panel has no overlaps or clipped figures', lay.out.length === 0, lay.out.join('; '));
  await page.click('[data-testid="preset-nominal"]');

  // SyR-C5.3: neighbouring asset
  await page.locator('[data-testid="drawer-left"] .drawer-body').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.check('[data-testid="asset-enable"]');
  await page.waitForSelector('[data-testid="psi-alert"]', { timeout: 10000 });
  const assetText = (await page.locator('[data-testid="asset-kpis"]').innerText()).replace(/\s+/g, ' ');
  check('neighbouring asset: plume keep-out radius and mutual shadowing are reported', /961 m/.test(assetText), assetText);
  await page.locator('[data-testid="drawer-left"] .drawer-body').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.waitForTimeout(700);
  await shot('21-neighbouring-asset-psi.png');
  await page.uncheck('[data-testid="asset-enable"]');

  // SyR-P4: electro-thermal, on scenario B (Nobile in winter: long nights)
  await openPanel('sites');
  await page.click('[data-testid="tab-B"]');
  await openPanel('energy');
  await page.waitForSelector('[data-testid="thermal-chart"]', { timeout: 60000 });
  await page.waitForTimeout(400);
  const thermalBox = await page.locator('[data-testid="thermal-chart"]').boundingBox();
  const thermalText = (await page.locator('[data-testid="thermal-kpis"]').innerText()).replace(/\s+/g, ' ');
  check('thermal chart and night-survival figures render', thermalBox.height > 150 && /°C/.test(thermalText), `${Math.round(thermalBox.width)} x ${Math.round(thermalBox.height)} px; ${thermalText.slice(0, 200)}`);
  const death = await page.locator('[data-testid="thermal-death"]').count();
  check('long polar night is flagged as critical thermal death', death === 1, death ? await page.locator('[data-testid="thermal-death"]').innerText() : 'no thermal death in this window');
  await page.waitForTimeout(400);
  await shot('22a-power-console-thermal.png');
  await openPanel('survival');
  await page.waitForSelector('[data-testid="dispersion-grid"]', { timeout: 60000 });
  const cells = await page.locator('[data-testid="dispersion-grid"] [role="gridcell"]').count();
  const escape = (await page.locator('[data-testid="escape-vector"]').innerText()).replace(/\s+/g, ' ');
  check('5 x 5 dispersion grid and escape vector are computed', cells === 25 && escape.length > 10, `${cells} cells; ${escape}`);
  await page.waitForTimeout(600);
  await shot('22-terrain-console-dispersion.png');
  lay = await overlaps();
  check('terrain console (dispersion, horizon) has no overlaps', lay.out.length === 0, lay.out.join('; '));

  // SyR-C5.1: suitability score
  await openPanel('score');
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="score-B"]')?.textContent ?? ''), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const scoreB0 = parseFloat(await page.locator('[data-testid="score-B"]').innerText());
  await page.fill('[data-testid="science-hydrogen"]', '0.5');
  await page.waitForTimeout(400);
  const scoreB1 = parseFloat(await page.locator('[data-testid="score-B"]').innerText());
  await page.click('[data-testid="score-mode-science"]');
  await page.waitForTimeout(300);
  const scoreB2 = parseFloat(await page.locator('[data-testid="score-B"]').innerText());
  check('suitability score responds to an entered science layer and to the weighting mode', scoreB1 > scoreB0 && scoreB2 !== scoreB1 && scoreB0 > 0 && scoreB0 <= 100, `B: ${scoreB0} -> ${scoreB1} with 0.5 wt.% hydrogen -> ${scoreB2} science-first`);
  await shot('23-suitability-score.png');
  const coverageB = await page.locator('[data-testid="coverage-B"]').innerText();
  const psrSource = (await page.locator('tr[data-criterion="psrProximity"] th small').innerText()).trim();
  const orbital = (await page.locator('[data-testid="orbital-data"]').innerText()).replace(/\s+/g, ' ');
  check('score uses the real PSR, FeO and gravity layers and shows the Diviner data of the site', /LOLA PSR/.test(psrSource) && /\d+ K/.test(orbital) && /8\d %|9\d %/.test(coverageB), `${coverageB.replace(/\s+/g, ' ')}; ${psrSource}; ${orbital.slice(0, 160)}`);
  await page.click('[data-testid="score-mode-synthesized"]');
  await page.fill('[data-testid="science-hydrogen"]', '');

  // INCOSE verification matrix and exports
  await page.click('[data-testid="open-verification"]');
  await page.waitForSelector('[data-testid="verification-modal"]');
  const statuses = await page.locator('.verif-table tbody tr').evaluateAll((rows) => rows.map((r) => `${r.dataset.req}=${r.dataset.status}`));
  const fails = statuses.filter((x) => x.endsWith('=FAIL'));
  check('verification matrix: all 16 rows evaluated, none failing', statuses.length === 16 && fails.length === 0, statuses.join(' '));
  await page.waitForTimeout(400); // the sheet slides in
  const fits = await page.evaluate(() => {
    const m = document.querySelector('.modal').getBoundingClientRect();
    return m.right <= window.innerWidth && m.bottom <= window.innerHeight && m.left >= 0 && m.top >= 0;
  });
  check('verification dialog fits the viewport', fits);
  const sheet = await page.evaluate(() => ({ modal: Boolean(document.querySelector('[aria-modal="true"]')), backdrop: Boolean(document.querySelector('.modal-back')), left: document.querySelector('[data-testid="verification-modal"]').getBoundingClientRect().left }));
  check('verification matrix is a docked sheet, not a modal over the scene', !sheet.modal && !sheet.backdrop && sheet.left > 200, JSON.stringify(sheet));
  await shot('24-incose-verification-matrix.png');
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export-csv"]')]);
  const csv = readFileSync(await csvDl.path(), 'utf8');
  const csvRows = csv.trim().split('\n').filter((l) => !l.startsWith('#'));
  check('telemetry CSV export', /_telemetry\.csv$/.test(csvDl.suggestedFilename()) && csvRows.length === 60 * 24 + 2 && csvRows[0].startsWith('utc,met_h,sun_az_deg'), `${csvDl.suggestedFilename()}, ${csvRows.length - 1} rows, ${csvRows[0].split(',').length} columns`);
  const [icsDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export-ics"]')]);
  const ics = readFileSync(await icsDl.path(), 'utf8');
  check('operations calendar export', ics.startsWith('BEGIN:VCALENDAR') && /BEGIN:VEVENT/.test(ics), `${icsDl.suggestedFilename()}, ${(ics.match(/BEGIN:VEVENT/g) ?? []).length} events`);
  await page.click('[data-testid="verification-close"]');

  // back to the comparison layout used by the remaining checks
  await openPanel('compare');
  await page.click('[data-testid="bottom-timeline"]');
  await page.click('[data-testid="tab-A"]');
  await page.waitForTimeout(400);

  // timeline scrub
  const tl = await page.locator('[data-testid="timeline"]').boundingBox();
  const c0 = await page.locator('[data-testid="clock"] output').innerText();
  await page.mouse.click(tl.x + tl.width * 0.7, tl.y + 40);
  await page.waitForTimeout(300);
  const c1 = await page.locator('[data-testid="clock"] output').innerText();
  check('clicking the timeline moves the shared cursor', c0 !== c1, `${c0} -> ${c1}`);
  await openPanel('horizon');
  await page.waitForTimeout(500);
  const pano = await page.locator('[data-testid="panorama"]').boundingBox();
  await page.mouse.move(pano.x + pano.width * 0.62, pano.y + pano.height * 0.5);
  await page.waitForTimeout(300);
  check('horizon panorama opens in the communications console', pano.height > 150, `${Math.round(pano.width)} x ${Math.round(pano.height)} px`);
  await shot('11-horizon-panorama-tab.png');
  await openPanel('timeline', 'overview');
  await page.click('[data-testid="legend-toggle"]');
  await page.waitForTimeout(300);
  lay = await overlaps();
  check('legend opens on demand without overlapping the HUD', (await page.locator('[data-testid="legend"]').count()) === 1 && lay.out.length === 0, lay.out.join('; '));
  await page.click('[data-testid="legend-toggle"]');

  // custom coordinates
  await openPanel('sites');
  await page.click('[data-testid="tab-B"]');
  await page.selectOption('[data-testid="site-B"]', 'custom');
  await page.waitForTimeout(300);
  await kpi('illum', 1);
  await openPanel('sites');
  const customTag = await page.locator('[data-testid="terrain-B"]').innerText();
  check('custom selenographic coordinates are evaluated on LOLA terrain (160 m cap, then the 20 m patch)', /%/.test(await kpi('illum', 1)) && /(160|20) m\/px/.test(customTag), `B illum ${await kpi('illum', 1)}; ${customTag}`);

  // ---------------------------------------------------------------- explorer
  // ------------------------------------------------ v3 evolutions (E1, E2, E3, E7)
  await openPanel('sites');
  await page.click('[data-testid="tab-A"]');
  await openPanel('link');
  await page.fill('[data-testid="gt-target"]', '1000');
  await page.waitForTimeout(300);
  const gt = (await page.locator('[data-testid="gt-required"]').innerText()).replace(/\s+/g, ' ');
  check('inverse link budget gives the G/T a station needs', /dB\/K/.test(gt) && / m /.test(gt), gt);

  await openPanel('energy');
  const skyText = (await page.locator('[data-testid="thermal-kpis"]').innerText()).replace(/\s+/g, ' ');
  check('thermal panel reports the sky view factor and the sunlit share of the terrain', /Sky view factor 0\.\d+|Sky view factor 1\.000/.test(skyText), skyText.slice(-110));
  await openPanel('survival');
  await page.waitForSelector('[data-testid="dispersion-grid"]', { timeout: 60000 });
  await page.locator('[data-testid="drawer-right"] .drawer-body').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.click('[data-testid="unc-run"]');
  await page.waitForSelector('[data-testid="unc-stats"]', { timeout: 120000 });
  const uncText = (await page.locator('[data-testid="unc-stats"]').innerText()).replace(/\s+/g, ' ');
  check('terrain-uncertainty ensemble returns P(survive) and P10/P50/P90 bands', /Probability of surviving the window \d+ %/.test(uncText) && /P10/.test(uncText), uncText.slice(0, 200));
  await page.click('[data-testid="unc-cells"]');
  await page.waitForSelector('[data-testid="unc-cells-done"]', { timeout: 240000 });
  const cellP = await page.locator('[data-testid="dispersion-grid"] [role="gridcell"]').first().innerText();
  check('dispersion grid shows a survival probability per cell', /^P \d+%$/.test(cellP.trim()), cellP.trim());
  await page.locator('[data-testid="drawer-right"] .drawer-body').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await page.waitForTimeout(400);
  await shot('25-terrain-uncertainty.png');

  // ------------------------------------ v3, second iteration (windows + E6, E5, E4)
  await openPanel('link');
  const ridges = (await page.locator('[data-testid="deygout"]').innerText()).replace(/\s+/g, ' ');
  check('link panel reports the three-edge (Deygout) diffraction', /Downlink closes [\d.]+ %/.test(ridges) && /[\d.]+ dB/.test(ridges) && /\d+ h/.test(ridges), ridges.slice(0, 210));

  await openPanel('windows');
  await page.selectOption('[data-testid="win-span"]', '30');
  await page.click('[data-testid="win-run"]');
  await page.waitForSelector('[data-testid="win-result"]', { timeout: 120000 });
  const winAccepted = await page.locator('[data-testid="win-accepted"]').innerText();
  const stripCells = await page.locator('[data-testid="win-strip"] i').count();
  const winReasons = (await page.locator('[data-testid="win-reasons"]').innerText()).replace(/\s+/g, ' ');
  check('landing-date finder evaluates 61 candidate dates and reports windows', stripCells === 61 && /\d+ % · \d+ windows?/.test(winAccepted), `${stripCells} dates; ${winAccepted}`);
  check('rejected dates carry their reasons, approach lighting among them', /Sun (ahead|directly behind)/.test(winReasons), winReasons.slice(0, 220));
  await page.waitForTimeout(300);
  await shot('27-landing-windows.png');
  lay = await overlaps();
  check('landing-date panel has no overlaps', lay.out.length === 0, lay.out.join('; '));
  const clockBefore = await page.locator('[data-testid="clock"] output').innerText();
  const firstWindow = await page.locator('[data-testid="win-list"] li strong').first().innerText();
  await page.click('[data-testid="win-use"]');
  await page.waitForTimeout(2000);
  const clockAfter = await page.locator('[data-testid="clock"] output').innerText();
  await openPanel('vitals');
  const survivesThere = await page.locator('[data-vital="freeze"]').innerText();
  check('choosing a window moves the scenario to that touchdown date and the lander survives', clockAfter !== clockBefore && /SAFE/.test(survivesThere), `${clockBefore} -> ${clockAfter} (window ${firstWindow}); ${survivesThere.replace(/\s+/g, ' ')}`);

  await openPanel('contingency');
  const tipText = (await page.locator('[data-testid="tipover-kpis"]').innerText()).replace(/\s+/g, ' ');
  const tipCells = await page.locator('[data-testid="tipover-grid"] [role="gridcell"]').count();
  const p0 = Number((tipText.match(/aim point ([\d.]+) %/) ?? [])[1]);
  await page.locator('[data-testid="tip-vel"]').fill('1.5');
  await page.waitForTimeout(300);
  const tipFast = (await page.locator('[data-testid="tipover-kpis"]').innerText()).replace(/\s+/g, ' ');
  const p1 = Number((tipFast.match(/aim point ([\d.]+) %/) ?? [])[1]);
  check('tip-over probability is mapped over the ellipse and grows with touchdown speed', tipCells === 25 && p1 > p0 && p0 >= 0, `${tipCells} cells; aim point ${p0} % at 0.5 m/s, ${p1} % at 1.5 m/s`);
  await page.locator('[data-testid="tip-vel"]').fill('0.5');
  await page.locator('[data-testid="tipover-grid"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot('28-tipover-probability.png');

  await page.click('[data-testid="replay-im2-athena"]');
  await page.waitForSelector('[data-testid="replay-result"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  const replayText = (await page.locator('[data-testid="replay-result"]').innerText()).replace(/\s+/g, ' ');
  const clockReplay = await page.locator('[data-testid="clock"] output').innerText();
  check('IM-2 Athena replay runs at the real place and date', /2025-03-06/.test(clockReplay) && /13 h/.test(replayText), `${clockReplay}; ${replayText}`);
  await shot('26-replay-im2-athena.png');
  lay = await overlaps();
  check('replay view has no overlaps', lay.out.length === 0, lay.out.join('; '));
  // restore the default lander and site for the remaining checks
  await page.click('[data-testid="preset-nominal"]');
  await openPanel('hardware');
  await page.selectOption('[data-testid="mount"]', 'tracker1axis');
  await openPanel('sites');
  await page.selectOption('[data-testid="site-A"]', 'shackleton-ridge');
  await page.fill('[data-testid="start-A"]', '2027-09-01');
  await openPanel('compare');
  await page.waitForTimeout(600);
  await kpisReady();

  await page.click('[data-testid="mode-explorer"]');
  await page.waitForSelector('[data-testid="explorer"]');
  await page.waitForFunction(() => document.querySelectorAll('.site-card .meter').length >= 15, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await shot('12-explorer-mode.png');
  lay = await overlaps();
  check('explorer layout has no overlapping regions', lay.out.length === 0, lay.out.join('; '));
  await page.click('[data-testid="tour-action"]');
  await page.waitForTimeout(2500);
  await shot('13-explorer-tour-playing.png');
  const exFps = await fps(4000);
  check('60 fps frame pacing in explorer playback', at60(exFps), fpsText(exFps));
  await page.click('[data-testid="tour-next"]');
  await page.click('[data-testid="tour-action"]');
  await page.waitForFunction(() => /of the window/.test(document.querySelector('.ramp-labels')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForTimeout(900);
  await shot('14-explorer-sunlight-map.png');
  await page.click('[data-testid="card-malapert-massif"]');
  await page.waitForTimeout(2500);
  await page.click('[data-testid="lang-es"]');
  await page.waitForTimeout(500);
  await shot('15-explorer-spanish-malapert.png');
  check('language switch translates the interface', (await page.locator('.tour h1').innerText()).includes('Sombras'), await page.locator('.tour h1').innerText());

  // ------------------------------------------------------------ narrow layout
  await page.click('[data-testid="mode-planner"]');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(1200);
  lay = await overlaps();
  check('1280 x 720 planner has no overlaps', lay.out.length === 0, lay.out.join('; '));
  await shot('16-planner-1280x720-spanish.png');
  await page.setViewportSize({ width: 820, height: 1100 });
  await page.waitForTimeout(1200);
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('820 px layout stacks without horizontal scroll', narrow);
  await page.screenshot({ path: join(shots, '17-narrow-820.png'), fullPage: true });

  // ------------------------------------------------------------ v4: first visit, verdict, emergency
  {
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  p2.on('console', (m) => { if (m.type() === 'error') errors.push(`v4: ${m.text()}`); });
  p2.on('pageerror', (e) => errors.push(`v4 pageerror: ${e.message}`));
  const shot2 = (name) => p2.screenshot({ path: join(shots, name) });
  const text2 = async (sel) => (await p2.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  await p2.goto(URL);
  await p2.waitForSelector('[data-testid="planner"]', { timeout: 60000 });
  await p2.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 60000 });
  await p2.waitForTimeout(1200);
  await shot2('29-first-visit-quick-view.png');
  const first = await p2.evaluate(() => ({
    offer: Boolean(document.querySelector('[data-testid="briefing-offer"]')),
    sub: document.querySelector('[data-testid="planner"]')?.dataset.subsystem,
    offerBox: document.querySelector('[data-testid="briefing-offer"]')?.getBoundingClientRect().toJSON(),
  }));
  check('first visit offers the mission briefing in the bottom-right corner over the overview console', first.offer && first.sub === 'overview' && first.offerBox.right > 1400 && first.offerBox.bottom > 800, JSON.stringify(first));
  await p2.click('[data-testid="briefing-start"]');
  const steps = [];
  for (let k = 1; k <= 5; k++) {
    await p2.waitForSelector(`[data-testid="briefing-step"][data-step="${k}"]`, { timeout: 5000 });
    await p2.waitForTimeout(350);
    const st = await p2.evaluate(() => {
      const spot = document.querySelector('.brief-spot');
      const r = spot?.getBoundingClientRect();
      return { title: document.querySelector('.brief-card h3')?.textContent, tag: document.querySelector('.brief-tag')?.textContent, spot: r && r.width > 20 && r.height > 20, through: spot && getComputedStyle(spot).pointerEvents === 'none' };
    });
    steps.push(st);
    if (k === 3) await shot2('29b-briefing-step-3.png');
    await p2.keyboard.press('ArrowRight');
  }
  await p2.waitForTimeout(300);
  check('mission briefing runs five spotlighted steps on the real controls (keyboard driven, pointer passes through) and closes',
    steps.every((s) => s.spot && s.through) && steps[1].tag.includes('2/5') && (await p2.locator('[data-testid="briefing-step"]').count()) === 0, steps.map((s) => `${s.tag} ${s.title}`).join(' | '));
  await p2.click('[data-testid="briefing-open"]');
  await p2.waitForSelector('[data-testid="briefing-step"][data-step="1"]');
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(200);
  check('the mission guide button relaunches the briefing and Escape leaves it', (await p2.locator('[data-testid="briefing-step"]').count()) === 0 && await p2.evaluate(() => localStorage.getItem('clps.briefing') === 'done'));
  const levelA = await p2.locator('[data-testid="verdict"]').getAttribute('data-level');
  const sentenceA = await text2('[data-testid="verdict-sentence"]');
  check('verdict card states GO / CAUTION / NO-GO in plain language', ['go', 'caution', 'nogo'].includes(levelA) && sentenceA.length > 30, `${levelA}: ${sentenceA}`);
  await p2.click('[data-testid="dock-compare"]');
  await p2.waitForSelector('[data-testid="quick-B"] .quick-level', { timeout: 60000 });
  const bars = await p2.locator('[data-testid="quick-A"] .quick-bar').count();
  check('quick comparison shows four bars per scenario', bars === 4, await text2('[data-testid="quick-A"]'));
  await p2.waitForTimeout(400);
  await shot2('30-quick-compare.png');

  // one-click rescue of the scenario that loses the lander
  await p2.click('[data-testid="tab-B"]');
  await p2.waitForFunction(() => document.querySelector('[data-testid="verdict"] .badge')?.textContent === 'B' && document.querySelector('[data-testid="verdict"]')?.getAttribute('data-level'), null, { timeout: 60000 });
  const levelB = await p2.locator('[data-testid="verdict"]').getAttribute('data-level');
  const sentenceB = await text2('[data-testid="verdict-sentence"]');
  check('a scenario that freezes reads NO-GO with the cause and the day', levelB === 'nogo' && /(day|hour)/.test(sentenceB), `${levelB}: ${sentenceB}`);
  await p2.click('[data-testid="verdict-fix"]');
  await p2.waitForSelector('[data-testid="verdict-after"]', { timeout: 180000 });
  await p2.waitForTimeout(1500);
  const after = await text2('[data-testid="verdict-after"]');
  const levelB2 = await p2.locator('[data-testid="verdict"]').getAttribute('data-level');
  check('a mission nothing can save says so instead of claiming a rescue', /→/.test(after) && /missions in/.test(after) && (levelB2 !== 'nogo' || /(No point within 200 m|No better point)/.test(after)), `${levelB} -> ${levelB2}; ${after}`);
  // a mission that can be saved: Malapert, two weeks, landing on a date that runs into a long shadow
  await p2.selectOption('[data-testid="site-B"]', 'malapert-massif');
  await p2.fill('[data-testid="start-B"]', '2027-09-01');
  await p2.locator('[data-testid="days-B"]').fill('14');
  await p2.locator('[data-testid="days-B"]').blur();
  await p2.waitForFunction(() => /Malapert/.test(document.querySelector('.hud-title')?.textContent ?? '') && document.querySelector('[data-testid="verdict"]')?.getAttribute('data-level'), null, { timeout: 60000 });
  await p2.waitForTimeout(1500);
  const levelM = await p2.locator('[data-testid="verdict"]').getAttribute('data-level');
  const sentenceM = await text2('[data-testid="verdict-sentence"]');
  await p2.click('[data-testid="verdict-fix"]');
  await p2.waitForSelector('[data-testid="verdict-after"]', { timeout: 180000 });
  await p2.waitForTimeout(1500);
  const afterM = await text2('[data-testid="verdict-after"]');
  const levelM2 = await p2.locator('[data-testid="verdict"]').getAttribute('data-level');
  check('one-click rescue turns a NO-GO into a mission that survives, with before and after', levelM === 'nogo' && levelM2 !== 'nogo' && /(moved|landing moved)/.test(afterM), `${levelM} (${sentenceM}) -> ${levelM2}; ${afterM}`);
  await shot2('31-rescue-before-after.png');

  // double-click to land
  await p2.click('[data-testid="tab-A"]');
  await p2.waitForTimeout(1500);
  const box = await p2.locator('[data-testid="scene"] canvas').boundingBox();
  const before2 = await text2('[data-testid="reloc-readout"]');
  await p2.mouse.dblclick(box.x + box.width * 0.5 + 60, box.y + box.height * 0.5 + 40);
  await p2.waitForTimeout(2500);
  const hudAfter = await text2('.hud-tl');
  const after2 = await text2('[data-testid="reloc-readout"]');
  check('double-click on the terrain moves the lander there', after2 !== before2 || /Custom/.test(hudAfter), `${before2} -> ${after2}; ${hudAfter.slice(0, 60)}`);

  // engineering level
  await p2.click('[data-testid="dock-compare"]');
  await p2.click('[data-testid="expert-toggle"]');
  await p2.waitForSelector('[data-testid="kpi-table"]', { timeout: 30000 });
  check('engineering mode replaces the quick bars with the full comparison table', (await p2.locator('[data-testid="kpi-table"] tbody tr').count()) > 10);
  await p2.click('[data-testid="expert-toggle"]');

  // emergency triage anywhere in the cap
  await p2.click('[data-testid="mode-triage"]');
  await p2.waitForSelector('[data-testid="triage"]');
  const map = await p2.locator('[data-testid="polar-map"]').boundingBox();
  // 86.4 S towards lon -60: open ground away from the pre-built sites.
  await p2.mouse.click(map.x + map.width * (0.5 - 0.148), map.y + map.height * (0.5 - 0.085));
  await p2.waitForFunction(() => /[\d.]+° S/.test(document.querySelector('[data-testid="tri-step-1"] .tri-big')?.textContent ?? ''), null, { timeout: 60000 });
  const coarse = await text2('[data-testid="tri-terrain"]');
  await p2.waitForFunction(() => ['ready', 'cached', 'unavailable', 'outside'].includes(document.querySelector('[data-testid="tri-terrain"]')?.getAttribute('data-stream')), null, { timeout: 180000 });
  const stream = await p2.locator('[data-testid="tri-terrain"]').getAttribute('data-stream');
  const fine = await text2('[data-testid="tri-terrain"]');
  check('a point clicked on the polar map is served first coarse, then with the live 20 m patch', (stream === 'ready' || stream === 'cached') && /20 m\/px/.test(fine), `${coarse} => [${stream}] ${fine}`);
  await p2.waitForSelector('[data-testid="tri-clocks"]', { timeout: 60000 });
  await p2.waitForSelector('[data-testid="tri-escape"]', { timeout: 120000 });
  await p2.waitForTimeout(1500);
  const clocks = await text2('[data-testid="tri-clocks"]');
  const esc = await text2('[data-testid="tri-escape"]');
  check('emergency mode gives the countdowns and an escape vector', /(\d+ h|survives|never|holds|sunlit)/.test(clocks) && /(m →|Stay)/.test(esc), `${clocks} || ${esc}`);
  await p2.click('[data-testid="micro-toggle"]');
  await p2.waitForSelector('[data-testid="micro-hazard"]', { timeout: 30000 });
  const hz2 = await text2('[data-testid="micro-hazard"]');
  check('sub-pixel terrain mode reports the micro-shadow and rock hazard', /hazard \d+ %/.test(hz2), hz2);
  await p2.waitForTimeout(600);
  await shot2('32-emergency-triage.png');
  const triFps = await p2.evaluate((dur) => new Promise((resolve) => {
    const t = []; let last = performance.now(); const t0 = last;
    const tick = (now) => { t.push(now - last); last = now; if (now - t0 < dur) requestAnimationFrame(tick); else { t.sort((a, b) => a - b); resolve({ median: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)] }); } };
    requestAnimationFrame(tick);
  }), 3000);
  check('60 fps frame pacing in the emergency mode', triFps.median < 18 && triFps.p95 < 25, `median ${triFps.median.toFixed(1)} ms, p95 ${triFps.p95.toFixed(1)} ms`);

  // northern edge of the domain and the offline store
  await p2.fill('[data-testid="tri-coords"]', '-80.5, 12');
  await p2.click('[data-testid="tri-go"]');
  await p2.waitForFunction(() => /80\.5\d*° S/.test(document.querySelector('[data-testid="tri-step-1"] .tri-big')?.textContent ?? ''), null, { timeout: 60000 });
  await p2.waitForSelector('[data-testid="tri-clocks"]', { timeout: 60000 });
  const north = await text2('[data-testid="tri-step-1"]');
  check('coordinates at 80.5° S are accepted and evaluated', /80\.5/.test(north) && /slope [\d.]+°/.test(north), north.slice(0, 120));
  const stored = await p2.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('clps-terrain', 1);
    req.onsuccess = () => { const k = req.result.transaction('patches-v1', 'readonly').objectStore('patches-v1').getAllKeys(); k.onsuccess = () => resolve(k.result.length); k.onerror = () => resolve(-1); };
    req.onerror = () => resolve(-1);
  }));
  check('streamed patches are kept in IndexedDB for offline use', stored >= 1, `${stored} patches stored`);
  const narrowTri = await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('emergency layout has no horizontal overflow', narrowTri);
  await ctx2.close();
  }

  check('no console errors or uncaught exceptions', errors.length === 0, errors.slice(0, 5).join(' | '));

  const failed = checks.filter((c) => !c.pass);
  writeFileSync(join(root, 'artifacts', 'verify-report.json'), JSON.stringify({
    date: new Date().toISOString(), webglRenderer: gl, bootMs,
    fps: { idle, playing, explorer: exFps }, checks, consoleErrors: errors,
  }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
} catch (err) {
  console.error('VERIFY ABORTED:', err);
  process.exitCode = 2;
} finally {
  if (browser) await browser.close();
  server.kill();
}
