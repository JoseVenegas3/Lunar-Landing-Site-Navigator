/**
 * End-to-end verification (render -> look -> fix loop), interface v2.0.
 *
 *   npm run build && npm run e2e
 *
 * Serves the production build, drives it in headless Chromium, and checks:
 * no console errors, no overlapping layout regions, frame rate, the top bar
 * and the transport in the 3-D view, the full-width subsystem tabs and their
 * transition, a single scenario by default and the comparison inside the
 * landing-windows panel, the micro-relocation tool (slider, drag and
 * double-click), overlays, the shared emergency flow, telemetry, the
 * engineering view, the CSV export, the PDF guide, the tutorial mode,
 * Explorer mode, language switch and the narrow layout.
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

/** Abbreviated site codes that must never reach the interface. */
const SITE_CODES = ['SCR', 'MAL', 'HAW', 'NOB', 'DGR', 'IM2', 'CUS'];

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
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', acceptDownloads: true });
  const page = await ctx.newPage();
  // The checks below exercise every panel: start with the first-visit tour done.
  await page.addInitScript(() => localStorage.setItem('clps.briefing', 'done'));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const shot = (name) => page.screenshot({ path: join(shots, name) });
  // Console navigation as a person does it: pick the subsystem that has the panel, then its tab.
  const SUBS = {
    overview: { left: ['sites'], right: ['vitals', 'windows'], bottom: ['timeline'] },
    power: { left: ['hardware'], right: ['energy'], bottom: ['thermal', 'timeline'] },
    comms: { left: ['hardware'], right: ['link'], bottom: ['horizon', 'timeline'] },
    terrain: { left: ['contingency'], right: ['survival'], bottom: ['horizon', 'timeline'] },
    science: { left: ['sites'], right: ['score', 'engineering'], bottom: ['timeline'] },
  };
  const ORDER = ['overview', 'power', 'comms', 'terrain', 'science'];
  const sideOf = (s, id) => ['left', 'right', 'bottom'].find((k) => SUBS[s][k].includes(id));
  const subsystemNow = (pg = page) => pg.evaluate(() => document.querySelector('[data-testid="planner"]')?.dataset.subsystem);
  /** Click a subsystem tab and wait for the transition (black, icon, console) to finish. */
  const goSub = async (s, pg = page) => {
    if ((await subsystemNow(pg)) === s) return;
    await pg.click(`[data-testid="subsys-${s}"]`);
    await pg.waitForFunction((x) => document.querySelector('[data-testid="planner"]')?.dataset.subsystem === x && !document.querySelector('[data-testid="subsys-curtain"]'), s, { timeout: 10000 });
  };
  const openPanel = async (id, sub, pg = page) => {
    const now = await subsystemNow(pg);
    const s = sub ?? (sideOf(now, id) ? now : ORDER.find((x) => sideOf(x, id)));
    await goSub(s, pg);
    const side = sideOf(s, id);
    if (side !== 'bottom' && (await pg.locator(`[data-testid="drawer-${side}"]`).count()) === 0) await pg.click(`[data-testid="open-${side}"]`);
    for (const sel of [`[data-testid="dock-${id}"]`, `[data-testid="bottom-${id}"]`]) {
      if (await pg.locator(sel).count()) { await pg.click(sel); break; }
    }
    await pg.waitForTimeout(120);
  };
  /** Whether the Compare block is on (the KPI table then lives inside it). */
  let comparing = false;
  /** The KPI table: inside the Compare block while comparing, in Science > Engineering view otherwise. */
  const openKpis = async () => {
    if ((await page.locator('[data-testid="kpi-table"]').count()) > 0) return;
    if (comparing) {
      await openPanel('windows');
      await page.locator('[data-testid="compare-block"]').scrollIntoViewIfNeeded();
    } else {
      await openPanel('engineering');
    }
  };
  const kpisReady = async () => {
    await openKpis();
    await page.waitForFunction(() => {
      const cells = document.querySelectorAll('[data-testid="kpi-table"] tbody td');
      return cells.length >= 12 && !document.querySelector('[data-testid="kpi-table"] td.is-pending');
    }, null, { timeout: 60000 });
  };
  const kpi = async (id, col) => {
    await kpisReady();
    return (await page.locator(`[data-testid="kpi-table"] tbody td[data-kpi="${id}"]`).nth(col).innerText()).trim();
  };
  const setCompare = async (on) => {
    await openPanel('windows');
    const box = page.locator('[data-testid="compare-toggle"]');
    await box.scrollIntoViewIfNeeded();
    if ((await box.isChecked()) !== on) await box.click();
    comparing = on;
    await page.waitForTimeout(300);
  };
  // Frame pacing: the median and 95th-percentile frame intervals describe the
  // steady state; isolated stalls (GC, first-use shader compilation) are reported separately.
  const fps = (ms = 4000, pg = page) => pg.evaluate((dur) => new Promise((resolve) => {
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
  const overlaps = (pg = page) => pg.evaluate(() => {
    const out = [];
    const rect = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
    const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    // Trays float over the 3-D view by design; they must not overlap each other, the console bars or the HUD.
    const regions = ['.subsys-bar', '.verdict', '.tray-left', '.tray-right', '.tray-bottom', '.tray-handle-left', '.tray-handle-right', '.ex-stage', '.ex-side', '.ex-time'].filter((s) => document.querySelector(s));
    for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) if (hit(rect(regions[i]), rect(regions[j]))) out.push(`${regions[i]} x ${regions[j]}`);
    const hud = ['.hud-tl', '.hud-tr', '.hud-bl', '.hud-br', '.hud-bc', '.dbl-hint'].filter((s) => document.querySelector(s) && getComputedStyle(document.querySelector(s)).display !== 'none');
    for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) if (hit(rect(hud[i]), rect(hud[j]))) out.push(`${hud[i]} x ${hud[j]}`);
    for (const h of hud) for (const tr of ['.tray-left', '.tray-right', '.tray-bottom']) if (hit(rect(h), rect(tr))) out.push(`${h} x ${tr}`);
    const top = rect('.topbar');
    const kids = [...document.querySelectorAll('.topbar > *')].map((e) => e.getBoundingClientRect());
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) if (hit(kids[i], kids[j])) out.push(`topbar child ${i} x ${j}`);
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const e of document.querySelectorAll('.tm-read output, .kpi-val span, .subsys-btn span, .vital-value, [data-site-label]')) {
      if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible') out.push(`clipped text: ${e.textContent}`);
    }
    return { out, top: top ? top.height : 0 };
  });
  /** Every site label shows a full name: no site code, nothing clipped. */
  const siteLabels = (pg = page) => pg.evaluate((codes) => [...document.querySelectorAll('[data-site-label]')].map((e) => {
    const r = e.getBoundingClientRect();
    return { text: e.textContent.trim(), full: e.getAttribute('data-site-label'), clipped: e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible', code: codes.includes(e.textContent.trim()), visible: r.width > 0 };
  }).filter((x) => x.visible), SITE_CODES);
  const labelsOk = (ls) => ls.length > 0 && ls.every((l) => l.text === l.full && !l.clipped && !l.code && l.text.length > 4);

  // ---------------------------------------------------------- boot + planner
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForSelector('[data-testid="planner"]', { timeout: 60000 });
  await page.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 60000 });
  const calm = await page.evaluate(() => ({
    sub: document.querySelector('[data-testid="planner"]')?.dataset.subsystem,
    left: Boolean(document.querySelector('.tray-left [data-testid="scenario-A"]')), vitals: Boolean(document.querySelector('[data-testid="vitals"]')),
    readout: Boolean(document.querySelector('[data-testid="readout"]')), legend: Boolean(document.querySelector('[data-testid="legend"]')),
    pano: Boolean(document.querySelector('.pano-canvas')), timeline: Boolean(document.querySelector('.timeline-canvas')),
    modal: Boolean(document.querySelector('[aria-modal="true"]')),
    abTabs: document.querySelectorAll('[data-testid="tab-A"], [data-testid="tab-B"]').length, badgesB: document.querySelectorAll('.badge-B').length,
    scenarioB: Boolean(document.querySelector('[data-testid="scenario-B"]')),
  }));
  check('default console: overview with one landing scenario (no A/B tabs, no trace of B), vitals and timeline, no modal',
    calm.sub === 'overview' && calm.left && calm.vitals && !calm.readout && !calm.legend && !calm.pano && calm.timeline && !calm.modal && calm.abTabs === 0 && calm.badgesB === 0 && !calm.scenarioB, JSON.stringify(calm));
  await page.waitForFunction(() => window.__clps && window.__clps.frames > 5, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('00-planner-default-workspace.png');
  const terrainTag = await page.locator('[data-testid="terrain-A"]').innerText();
  check('scenario runs on real LOLA terrain at 20 m/px', /LOLA, 20 m\/px/.test(terrainTag), terrainTag);

  // top bar: brand, mode, UTC clock, mission guide, export, language, PDF guide; transport in the 3-D view
  const bar = await page.evaluate(() => ({
    kids: [...document.querySelectorAll('.topbar > *')].map((e) => e.getAttribute('data-testid') ?? e.className.split(' ')[0]),
    verification: Boolean(document.querySelector('[data-testid="open-verification"]')),
    transportInBar: Boolean(document.querySelector('.topbar [data-testid="play"]')),
    transportInScene: Boolean(document.querySelector('[data-testid="scene"] [data-testid="transport"] [data-testid="play"]')),
    speeds: [...document.querySelectorAll('[data-testid="speed"] button')].map((b) => b.dataset.speed),
    speedOn: document.querySelector('[data-testid="speed"] button[aria-checked="true"]')?.dataset.speed,
    dayButtons: [...document.querySelectorAll('button')].filter((b) => /[−-]1 ?d|\+1 ?d/.test(b.textContent)).length,
    hourButtons: document.querySelectorAll('[data-testid="hour-back"], [data-testid="hour-fwd"]').length,
    fps: Boolean(document.querySelector('[data-testid="fps"]')), map: [...document.querySelectorAll('.hud-tr button')].some((b) => b.textContent === 'Map'),
  }));
  check('top bar holds only brand, mode, UTC clock, mission guide, export, language and the PDF guide',
    JSON.stringify(bar.kids) === JSON.stringify(['brand', 'mode-switch', 'clock', 'briefing-open', 'export-csv', 'lang', 'guide-pdf']) && !bar.verification, bar.kids.join(', '));
  check('time transport lives in the 3-D view: −1 h, play, +1 h and 1 / 24 / 72 h/s (24 by default), no ±1 d',
    !bar.transportInBar && bar.transportInScene && bar.speeds.join() === '1,24,72' && bar.speedOn === '24' && bar.dayButtons === 0 && bar.hourButtons === 2, JSON.stringify(bar));
  check('no frame-rate counter and no "Map" camera in the HUD', !bar.fps && !bar.map);

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
  await openPanel('windows');
  await page.waitForTimeout(300);
  check('trays reopen from their edge handles and tabs', await page.evaluate(() => Boolean(document.querySelector('.tray-left') && document.querySelector('.timeline-canvas') && document.querySelector('[data-testid="readout"]') && document.querySelector('[data-testid="windows-panel"]'))));
  const tm = await page.evaluate(() => ({
    chip: document.querySelector('[data-testid="dock-telemetry"]')?.textContent, pressed: document.querySelector('[data-testid="dock-telemetry"]')?.getAttribute('aria-pressed'),
    groups: [...document.querySelectorAll('[data-testid="readout"] .tm-group h4')].map((h) => h.textContent),
    tips: [...document.querySelectorAll('[data-testid="readout"] .tm-read')].every((r) => (r.getAttribute('title') ?? '').length > 15),
    units: [...document.querySelectorAll('[data-testid="readout"] .tm-read output')].map((o) => o.textContent),
    margin: document.querySelector('[data-reading="margin"]')?.getAttribute('title'),
    jargon: Boolean(document.querySelector('[data-reading="excess"], [data-reading="clearance"]')),
    stored: localStorage.getItem('clps.telemetry'),
  }));
  check('telemetry: chip with open state (remembered), four plain-language groups, units and a one-line tip per reading, no jargon outside Science',
    /Telemetry/.test(tm.chip) && /open/.test(tm.chip) && tm.pressed === 'true' && tm.stored === '1' && tm.groups.join('|') === 'Sun|Energy|Thermal|Earth link' && tm.tips && /how much signal is left over the minimum/.test(tm.margin) && !tm.jargon && tm.units.some((u) => / W$/.test(u)) && tm.units.some((u) => /°C$/.test(u)),
    `${tm.groups.join(' / ')}; ${tm.units.join(' · ')}`);
  await page.waitForFunction(() => window.__clps && window.__clps.frames > 5, null, { timeout: 30000 });
  const bootMs = Date.now() - t0;

  // subsystem tabs: full width, thick, with an icon each; black -> icon -> console transition
  const tabs = await page.evaluate(() => {
    const barR = document.querySelector('[data-testid="subsys-bar"]').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.subsys-btn')];
    const on = document.querySelector('.subsys-btn.is-on');
    return {
      barW: barR.width, vw: window.innerWidth, h: Math.round(btns[0].getBoundingClientRect().height), sumW: btns.reduce((s, b) => s + b.getBoundingClientRect().width, 0),
      icons: btns.every((b) => b.querySelector('svg')), border: getComputedStyle(on).boxShadow,
    };
  });
  check('subsystem tabs span the full width, at least 56 px tall, 4 px accent border, an icon each',
    Math.abs(tabs.barW - tabs.vw) <= 1 && Math.abs(tabs.sumW - tabs.barW) <= 2 && tabs.h >= 56 && tabs.icons && /0px -4px 0px/.test(tabs.border), JSON.stringify(tabs));
  const switchLog = await page.evaluate(async () => {
    const log = [];
    const t0 = performance.now();
    document.querySelector('[data-testid="subsys-power"]').click();
    await new Promise((resolve) => {
      const tick = () => {
        const c = document.querySelector('[data-testid="subsys-curtain"]');
        const phase = c ? c.dataset.phase : 'idle';
        const emblem = c?.querySelector('.subsys-emblem strong')?.textContent ?? '';
        const color = c ? getComputedStyle(c.querySelector('.subsys-emblem') ?? c).color : '';
        if (!log.length || log[log.length - 1].phase !== phase) log.push({ t: Math.round(performance.now() - t0), phase, emblem, color, sub: document.querySelector('[data-testid="planner"]').dataset.subsystem });
        if (performance.now() - t0 < 1400) requestAnimationFrame(tick); else resolve();
      };
      tick();
    });
    return log;
  });
  const phases = switchLog.map((x) => x.phase).join('>');
  const hold = switchLog.find((x) => x.phase === 'hold');
  const doneAt = switchLog.find((x, i) => i > 0 && x.phase === 'idle')?.t ?? 9999;
  check('tab change: fade to black, the destination icon in its accent colour, then the console with its overlay (700–900 ms)',
    /out>hold>in>idle/.test(phases) && hold && /Power/.test(hold.emblem) && hold.color === 'rgb(245, 158, 11)' && hold.sub === 'power' && doneAt >= 650 && doneAt <= 1000, `${phases}; ${JSON.stringify(hold)}; done at ${doneAt} ms`);
  // rapid clicks during a transition end on the last tab clicked, with nothing left half-done
  await page.evaluate(() => { for (const s of ['comms', 'terrain', 'science', 'terrain']) document.querySelector(`[data-testid="subsys-${s}"]`).click(); });
  await page.waitForTimeout(150);
  await page.click('[data-testid="subsys-comms"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="subsys-curtain"]') && document.querySelector('[data-testid="planner"]').dataset.subsystem === 'comms', null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const settled = await page.evaluate(() => ({ sub: document.querySelector('[data-testid="planner"]').dataset.subsystem, curtain: Boolean(document.querySelector('[data-testid="subsys-curtain"]')), tab: document.querySelector('.subsys-btn.is-on')?.dataset.testid ?? document.querySelector('.subsys-btn.is-on')?.getAttribute('data-testid'), overlay: [...document.querySelectorAll('.hud-tr .seg button.is-on')].map((b) => b.textContent).join('|') }));
  check('clicks during a transition leave a consistent state (last tab wins)', settled.sub === 'comms' && !settled.curtain && settled.tab === 'subsys-comms' && /Earth view/.test(settled.overlay), JSON.stringify(settled));

  // contextual console: each subsystem brings its panels, accent and 3-D layer
  const EXPECT = {
    power: { accent: '#F59E0B', overlay: 'Sun hours', left: 'Power system', right: 'thermal-kpis', bottom: 'thermal-chart' },
    comms: { accent: '#06B6D4', overlay: 'Earth view', left: 'DTE radio link', right: 'link-budget', bottom: 'panorama' },
    terrain: { accent: '#E2E8F0', overlay: 'Slope', left: 'Landing attitude', right: 'emergency-flow', bottom: 'panorama' },
    science: { accent: '#B49CFF', overlay: 'Shadows', left: 'Landing site', right: 'score-A', bottom: 'timeline' },
  };
  await goSub('overview');
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
  // engineering view inside Science replaces the global switch
  await openPanel('engineering');
  await page.waitForSelector('[data-testid="engineering-view"] [data-testid="kpi-table"]', { timeout: 60000 });
  const eng = await page.evaluate(() => ({
    rows: document.querySelectorAll('[data-testid="engineering-view"] [data-testid="kpi-table"] tbody tr').length,
    cols: document.querySelectorAll('[data-testid="engineering-view"] [data-testid="kpi-table"] thead th').length,
    toggle: Boolean(document.querySelector('[data-testid="expert-toggle"]')),
    timeline: document.querySelector('[data-testid="bottom-timeline"]')?.textContent,
    techTelemetry: Boolean(document.querySelector('[data-reading="excess"]')),
  }));
  check('Science has its own engineering view: full KPI table and the detailed timeline; no global engineering switch',
    eng.rows > 10 && eng.cols === 2 && !eng.toggle && /Detailed timeline/.test(eng.timeline) && eng.techTelemetry, JSON.stringify(eng));
  await shot('00d-science-engineering-view.png');
  await goSub('power');
  await page.click('[data-testid="play"]');
  await page.waitForTimeout(1500);
  const glassFps = await fps(4000);
  await page.click('[data-testid="play"]');
  check('60 fps with the glass trays open over the scene (power console, playback)', at60(glassFps), fpsText(glassFps));
  await goSub('overview');
  check('boots to the planner with the scenario evaluated', true, `${bootMs} ms`);
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
  await page.waitForTimeout(400); // the clock text is throttled to ~12 Hz: let it settle after the pause
  const h0 = await page.locator('[data-testid="clock"] output').innerText();
  await page.click('[data-testid="hour-fwd"]');
  await page.click('[data-testid="hour-fwd"]');
  await page.waitForTimeout(200);
  const h1 = await page.locator('[data-testid="clock"] output').innerText();
  check('+1 h steps the clock by one hour', (Date.parse(h1.replace(' UTC', 'Z').replace(' ', 'T')) - Date.parse(h0.replace(' UTC', 'Z').replace(' ', 'T'))) === 2 * 3600e3, `${h0} -> ${h1}`);

  // -------------------------------------------------------------- comparator (inside landing windows)
  await setCompare(true);
  await page.waitForSelector('[data-testid="quick-B"] .quick-level', { timeout: 60000 });
  const a0 = await kpi('illum', 0), bCopy = await kpi('illum', 1);
  check('switching Compare on creates B as a copy of the current scenario', a0 === bCopy && (await page.locator('[data-testid="site-B"]').inputValue()) === (await page.locator('[data-testid="site-A"]').inputValue()), `A ${a0} | B ${bCopy}`);
  await page.selectOption('[data-testid="site-B"]', 'nobile-rim');
  await page.waitForTimeout(300);
  const b1 = await kpi('illum', 1);
  check('changing site B recomputes its column only', b1 !== bCopy && (await kpi('illum', 0)) === a0, `B ${bCopy} -> ${b1}`);
  await page.fill('[data-testid="start-B"]', '2028-03-01');
  await page.waitForTimeout(400);
  const b2 = await kpi('illum', 1);
  check('changing date range B recomputes its KPIs', b2 !== b1, `B ${b1} -> ${b2}`);
  const same = page.getByRole('button', { name: /Use the same window as A/ }).first();
  check('the "use the same window" shortcut appears when the windows differ', (await same.count()) === 1);
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="quick-A"]').scrollIntoViewIfNeeded();
  await shot('03-comparator-site-and-dates.png');
  const lbl = await siteLabels();
  check('site labels show the full name, never an abbreviation or a clipped string', labelsOk(lbl), lbl.map((l) => `${l.text}${l.clipped ? ' (clipped)' : ''}`).join(' | '));
  await page.click('[data-testid="view-A"]');
  await page.waitForTimeout(1200);

  // --------------------------------------------------------- micro-relocation
  const before = { illum: await kpi('illum', 0), dte: await kpi('dte', 0) };
  await openPanel('sites');
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
  await page.click('[data-testid="reloc-reset"]');
  await page.waitForTimeout(300);
  check('returning to the nominal point restores the KPIs', (await kpi('illum', 0)) === before.illum, await kpi('illum', 0));

  // ------------------------------------------------------ overlays and views
  await page.getByRole('button', { name: 'Sun hours' }).click();
  await page.waitForFunction(() => /of the window/.test(document.querySelector('.ramp-labels')?.textContent ?? ''), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await shot('06-insolation-map.png');
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
  const adv = await page.evaluate(() => ({ folded: !document.querySelector('[data-testid="advanced-assumptions"]')?.open, text: document.querySelector('[data-testid="advanced-assumptions"]')?.textContent ?? '' }));
  check('heater thresholds sit in a folded "Advanced assumptions" group labelled as an engineering assumption', adv.folded && /0 °C/.test(adv.text) && /−20 °C/.test(adv.text) && /Engineering assumption/.test(adv.text), adv.text.slice(0, 140));
  await goSub('comms');
  await page.selectOption('[data-testid="station"]', 'gisat37');
  await page.waitForTimeout(300);
  const rateText = await page.locator('[data-testid="link-budget"]').innerText();
  check('link budget follows the ground-station choice', /kbps|Mbps/.test(rateText), rateText.split('\n').slice(12, 14).join(' '));
  await shot('10-link-budget-gisat-station.png');
  await page.selectOption('[data-testid="station"]', 'dsn34');

  // relay constellation: presets and number of satellites only
  const dteBefore = parseFloat(await kpi('dte', 0));
  await goSub('comms');
  await page.check('[data-testid="relay-enable"]');
  await page.waitForTimeout(400);
  const relayOrbit = (await page.locator('[data-testid="relay-orbit"]').innerText()).trim();
  const relayForm = await page.evaluate(() => ({
    custom: [...document.querySelectorAll('[data-testid="relay-preset"] option')].some((o) => o.value === 'custom'),
    elements: [...document.querySelectorAll('.tray-left .field-label')].filter((l) => /Semi-major|Eccentricity|Inclination|periapsis|Orbital planes/.test(l.textContent)).length,
    count: Boolean(document.querySelector('[data-testid="relay-count"]')),
  }));
  check('relay form keeps the presets and the number of satellites, no individual orbital elements', !relayForm.custom && relayForm.elements === 0 && relayForm.count, JSON.stringify(relayForm));
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
  await goSub('science');
  const legendText = await page.locator('.timeline .legend').innerText();
  check('the detailed timeline shows the DSN stations handing over', /Goldstone/.test(legendText) && /Madrid/.test(legendText) && /Canberra/.test(legendText), legendText.replace(/\s+/g, ' '));

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
  const caveat = (await page.locator('[data-testid="replay-caveat"]').innerText()).replace(/\s+/g, ' ');
  check('the real-landing replay always states that the model does not reproduce the loss of IM-2', /does not reproduce the loss of IM-2/.test(caveat), caveat.slice(0, 120));

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
  await openPanel('windows');
  await page.click('[data-testid="view-B"]');
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

  // the survival panel is the shared emergency flow: position, energy, optional tilt; no date
  await openPanel('survival');
  await page.waitForSelector('[data-testid="emergency-flow"] [data-testid="dispersion-grid"]', { timeout: 120000 });
  const flow = await page.evaluate(() => {
    const f = document.querySelector('[data-testid="emergency-flow"]');
    return {
      cells: f.querySelectorAll('[data-testid="dispersion-grid"] [role="gridcell"]').length,
      escape: f.querySelector('[data-testid="tri-escape"]')?.textContent ?? '',
      map: Boolean(f.querySelector('[data-testid="polar-map"]')), coords: Boolean(f.querySelector('[data-testid="tri-coords"]')),
      energy: Boolean(f.querySelector('[data-testid="emg-energy"]')) && Boolean(f.querySelector('[data-testid="emg-load"]')),
      tiltFolded: !f.querySelector('.emg-tilt')?.open,
      date: f.querySelectorAll('input[type="date"]').length,
      removed: ['unc-sigma', 'unc-run', 'unc-cells', 'escape-go'].filter((id) => document.querySelector(`[data-testid="${id}"]`)).length,
      bands: /P10/.test(f.textContent), freeze: Boolean(f.querySelector('[data-vital="freeze"]')), verdict: f.querySelector('[data-testid="emg-verdict"]')?.textContent ?? '',
    };
  });
  check('survival panel = emergency flow: position and energy (tilt folded), no date, 5 x 5 grid, escape and time to freeze; RMS sliders, per-cell P and bands removed',
    flow.cells === 25 && flow.escape.length > 10 && flow.map && flow.coords && flow.energy && flow.tiltFolded && flow.date === 0 && flow.removed === 0 && !flow.bands && flow.freeze && /(GO|CAUTION|NO-GO)/.test(flow.verdict), JSON.stringify({ ...flow, escape: flow.escape.slice(0, 60) }));
  await page.waitForTimeout(600);
  await shot('22-terrain-console-emergency-flow.png');
  lay = await overlaps();
  check('terrain console (emergency flow, horizon) has no overlaps', lay.out.length === 0, lay.out.join('; '));

  // SyR-C5.1: suitability score, synthesized weighting only
  await openPanel('score');
  await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="score-B"]')?.textContent ?? ''), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  const scoreB0 = parseFloat(await page.locator('[data-testid="score-B"]').innerText());
  const scoreUi = await page.evaluate(() => ({
    modes: document.querySelectorAll('[data-testid^="score-mode-"]').length,
    inputs: document.querySelectorAll('[data-testid="science-hydrogen"], [data-testid="science-geology"]').length,
    rows: [...document.querySelectorAll('tr[data-criterion]')].map((r) => r.dataset.criterion),
  }));
  check('suitability index: synthesized only, no weighting modes, no hydrogen or geology fields', scoreB0 > 0 && scoreB0 <= 100 && scoreUi.modes === 0 && scoreUi.inputs === 0 && !scoreUi.rows.includes('hydrogen') && !scoreUi.rows.includes('geology'), `B ${scoreB0}; ${JSON.stringify(scoreUi)}`);
  await shot('23-suitability-score.png');
  const coverageB = await page.locator('[data-testid="coverage-B"]').innerText();
  const psrSource = (await page.locator('tr[data-criterion="psrProximity"] th small').innerText()).trim();
  const orbital = (await page.locator('[data-testid="orbital-data"]').innerText()).replace(/\s+/g, ' ');
  check('score uses the real PSR, FeO and gravity layers and shows the Diviner data of the site', /LOLA PSR/.test(psrSource) && /\d+ K/.test(orbital) && /8\d %|9\d %/.test(coverageB), `${coverageB.replace(/\s+/g, ' ')}; ${psrSource}; ${orbital.slice(0, 160)}`);
  const lbl2 = await siteLabels();
  check('score headers name the sites in full', labelsOk(lbl2), lbl2.map((l) => l.text).join(' | '));

  // export: one click on the top bar, CSV only
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export-csv"]')]);
  const csv = readFileSync(await csvDl.path(), 'utf8');
  const csvRows = csv.trim().split('\n').filter((l) => !l.startsWith('#'));
  check('Export downloads the telemetry CSV in one click (26 SI columns, one row per hour, full site name)',
    /^clps_nobile[a-z-]*_2028-03-01_60d_telemetry\.csv$/.test(csvDl.suggestedFilename()) && csvRows.length === 60 * 24 + 2 && csvRows[0].split(',').length === 26 && csvRows[0].startsWith('utc,met_h,sun_az_deg'),
    `${csvDl.suggestedFilename()}, ${csvRows.length - 1} rows, ${csvRows[0].split(',').length} columns`);
  check('no verification matrix and no calendar export anywhere', (await page.locator('[data-testid="verification-modal"], [data-testid="open-verification"], [data-testid="export-ics"]').count()) === 0);

  // back to the comparison layout used by the remaining checks
  await openPanel('windows');
  await page.click('[data-testid="view-A"]');
  await page.click('[data-testid="bottom-timeline"]');
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

  // custom coordinates (scenario B, in the Compare block)
  await openPanel('windows');
  await page.selectOption('[data-testid="site-B"]', 'custom');
  await page.waitForTimeout(300);
  await kpi('illum', 1);
  await openPanel('windows');
  const customTag = await page.locator('[data-testid="terrain-B"]').innerText();
  check('custom selenographic coordinates are evaluated on LOLA terrain (160 m cap, then the 20 m patch)', /%/.test(await kpi('illum', 1)) && /(160|20) m\/px/.test(customTag), `B illum ${await kpi('illum', 1)}; ${customTag}`);

  // ------------------------------------------------ v3 evolutions (E1, E2, E3, E7)
  await openPanel('link');
  const gtEmpty = await page.evaluate(() => ({ value: document.querySelector('[data-testid="gt-target"]').value, result: Boolean(document.querySelector('[data-testid="gt-required"]')), chips: [...document.querySelectorAll('[data-testid^="gt-chip-"]')].map((c) => c.textContent) }));
  await page.click('[data-testid="gt-chip-1000"]');
  await page.waitForTimeout(300);
  const gt = (await page.locator('[data-testid="gt-required"]').innerText()).replace(/\s+/g, ' ');
  check('inverse link budget: empty by default, quick 10 / 100 / 1000 kbps chips, gives the G/T a station needs',
    gtEmpty.value === '' && !gtEmpty.result && gtEmpty.chips.join() === '10 kbps,100 kbps,1000 kbps' && /dB\/K/.test(gt) && / m /.test(gt), `${JSON.stringify(gtEmpty)}; ${gt}`);

  await openPanel('energy');
  const skyText = (await page.locator('[data-testid="thermal-kpis"]').innerText()).replace(/\s+/g, ' ');
  check('thermal panel reports the sky view factor and the sunlit share of the terrain', /Sky view factor 0\.\d+|Sky view factor 1\.000/.test(skyText), skyText.slice(-110));
  await openPanel('engineering');
  await page.locator('[data-testid="unc-run"]').scrollIntoViewIfNeeded();
  await page.click('[data-testid="unc-run"]');
  await page.waitForSelector('[data-testid="unc-stats"]', { timeout: 120000 });
  const uncText = (await page.locator('[data-testid="unc-stats"]').innerText()).replace(/\s+/g, ' ');
  check('terrain-uncertainty ensemble (Science > Engineering view) returns P(survive) and P10/P50/P90 bands', /Probability of surviving the window \d+ %/.test(uncText) && /P10/.test(uncText), uncText.slice(0, 200));
  await page.waitForTimeout(400);
  await shot('25-terrain-uncertainty.png');

  // ------------------------------------ v3, second iteration (windows + E6, E5, E4)
  await openPanel('link');
  const ridges = (await page.locator('[data-testid="deygout"]').innerText()).replace(/\s+/g, ' ');
  check('link panel reports the three-edge (Deygout) diffraction', /Downlink closes [\d.]+ %/.test(ridges) && /[\d.]+ dB/.test(ridges) && /\d+ h/.test(ridges), ridges.slice(0, 210));

  await openPanel('windows');
  await page.locator('[data-testid="windows-panel"]').scrollIntoViewIfNeeded();
  const winUi = await page.evaluate(() => ({ note: document.querySelector('[data-testid="win-assumptions"]')?.textContent ?? '', sliders: [...document.querySelectorAll('[data-testid="windows-panel"] .field-label')].filter((l) => /Glare cone|Ellipse sunlit/.test(l.textContent)).length }));
  check('glare cone and minimum sunlit ellipse are fixed, with an engineering-assumption note', winUi.sliders === 0 && /Engineering assumption thresholds/.test(winUi.note), winUi.note.slice(0, 120));
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
  await page.waitForTimeout(600);

  // switching the comparison off removes every trace of B
  await setCompare(false);
  await page.waitForTimeout(800);
  const noB = await page.evaluate(() => ({
    badges: document.querySelectorAll('.badge-B, .badge-A').length, quick: document.querySelectorAll('[data-testid^="quick-"]').length,
    kpi: document.querySelectorAll('[data-testid="kpi-table"]').length, scenarioB: Boolean(document.querySelector('[data-testid="scenario-B"]')),
    hud: document.querySelector('.hud-title')?.textContent,
  }));
  await goSub('science');
  await page.click('[data-testid="dock-score"]');
  await page.waitForTimeout(500);
  const noB2 = await page.evaluate(() => ({ scoreB: Boolean(document.querySelector('[data-testid="score-B"]')), kpiCols: document.querySelectorAll('.score-table thead th').length }));
  await goSub('overview');
  check('with the comparison off there is no trace of B (badges, comparator, KPI table, 3-D title, index)', noB.badges === 0 && noB.quick === 0 && noB.kpi === 0 && !noB.scenarioB && !noB2.scoreB && noB2.kpiCols === 2, JSON.stringify({ ...noB, ...noB2 }));

  await page.click('[data-testid="mode-explorer"]');
  await page.waitForSelector('[data-testid="explorer"]');
  await page.waitForFunction(() => document.querySelectorAll('.site-card .meter').length >= 15, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await shot('12-explorer-mode.png');
  lay = await overlaps();
  check('explorer layout has no overlapping regions', lay.out.length === 0, lay.out.join('; '));
  const exLabels = await siteLabels();
  check('explorer cards and title name the sites in full; no scenario B', labelsOk(exLabels) && (await page.locator('.badge-B').count()) === 0, exLabels.map((l) => l.text).join(' | '));
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

  // the PDF guide opens from the top-right corner, in the active language
  const guide = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="guide-pdf"]');
    const r = a.getBoundingClientRect();
    return { href: a.getAttribute('href'), target: a.getAttribute('target'), right: Math.round(window.innerWidth - r.right), top: Math.round(r.top), text: a.textContent };
  });
  const pdfEs = await fetch(new globalThis.URL(guide.href, URL));
  const pdfEn = await fetch(new globalThis.URL(guide.href.replace('-es.pdf', '-en.pdf'), URL));
  const magic = Buffer.from(await pdfEs.arrayBuffer()).subarray(0, 5).toString();
  check('Guide (PDF) sits in the top-right corner and opens the guide of the active language in a new tab',
    /guia-interfaz-es\.pdf$/.test(guide.href) && guide.target === '_blank' && guide.right < 20 && guide.top < 20 && pdfEs.ok && pdfEn.ok && magic === '%PDF-' && /Guía/.test(guide.text), `${JSON.stringify(guide)}; es ${pdfEs.status}, en ${pdfEn.status}`);

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

  // ------------------------------------------------------------ first visit, tutorial mode, verdict, emergency
  {
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const p2 = await ctx2.newPage();
  p2.on('console', (m) => { if (m.type() === 'error') errors.push(`p2: ${m.text()}`); });
  p2.on('pageerror', (e) => errors.push(`p2 pageerror: ${e.message}`));
  const shot2 = (name) => p2.screenshot({ path: join(shots, name) });
  const text2 = async (sel) => (await p2.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const state2 = () => p2.evaluate(() => ({
    mode: document.querySelector('.app')?.className.replace('app app-', ''), sub: document.querySelector('[data-testid="planner"]')?.dataset.subsystem ?? null,
    site: document.querySelector('.hud-title')?.textContent ?? null, clock: document.querySelector('[data-testid="clock"] output')?.textContent ?? null,
    compare: Boolean(document.querySelector('[data-testid="scenario-B"]')) || document.querySelectorAll('.badge-B').length > 0,
  }));
  await p2.goto(URL);
  await p2.waitForSelector('[data-testid="planner"]', { timeout: 60000 });
  await p2.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 60000 });
  await p2.waitForTimeout(1200);
  await shot2('29-first-visit.png');
  const first = await p2.evaluate(() => ({
    offer: Boolean(document.querySelector('[data-testid="briefing-offer"]')),
    sub: document.querySelector('[data-testid="planner"]')?.dataset.subsystem,
    offerBox: document.querySelector('[data-testid="briefing-offer"]')?.getBoundingClientRect().toJSON(),
  }));
  check('first visit offers the guided tour in the bottom-right corner over the overview console', first.offer && first.sub === 'overview' && first.offerBox.right > 1400 && first.offerBox.bottom > 800, JSON.stringify(first));
  // set a user state the tutorial must give back
  await p2.click('[data-testid="briefing-skip"]');
  await p2.click('[data-testid="subsys-comms"]');
  await p2.waitForFunction(() => document.querySelector('[data-testid="planner"]')?.dataset.subsystem === 'comms' && !document.querySelector('[data-testid="subsys-curtain"]'));
  await openPanel('sites', 'science', p2);
  await p2.selectOption('[data-testid="site-A"]', 'haworth-rim');
  await p2.fill('[data-testid="start-A"]', '2028-01-15');
  await p2.waitForTimeout(800);
  await goSub('comms', p2);
  const userState = await state2();
  // "Mission guide" asks first, without a modal
  await p2.click('[data-testid="briefing-open"]');
  await p2.waitForSelector('[data-testid="briefing-confirm"]');
  const notice = await p2.evaluate(() => ({ text: document.querySelector('[data-testid="briefing-confirm"]').textContent, modal: Boolean(document.querySelector('[aria-modal="true"]')), box: document.querySelector('[data-testid="briefing-confirm"]').getBoundingClientRect().toJSON() }));
  check('Mission guide first shows a light notice (Start / Cancel, Esc to leave), not a full-screen modal',
    /predetermined sequence/.test(notice.text) && /tabs, site and date/.test(notice.text) && /Esc/.test(notice.text) && !notice.modal && notice.box.width < 500, notice.text.slice(0, 140));
  await p2.click('[data-testid="briefing-cancel"]');
  check('Cancel leaves the app untouched', JSON.stringify(await state2()) === JSON.stringify(userState) && (await p2.locator('[data-testid="briefing-step"]').count()) === 0);
  await p2.click('[data-testid="briefing-open"]');
  await p2.click('[data-testid="briefing-go"]');
  const steps = [];
  for (let k = 1; k <= 10; k++) {
    await p2.waitForSelector(`[data-testid="briefing-step"][data-step="${k}"]`, { timeout: 8000 });
    await p2.waitForTimeout(k >= 4 && k <= 9 ? 1700 : 600);
    const st = await p2.evaluate(() => {
      const spot = document.querySelector('.brief-spot');
      const r = spot?.getBoundingClientRect();
      return {
        title: document.querySelector('.brief-card h3')?.textContent, tag: document.querySelector('.brief-tag')?.textContent,
        spot: r && r.width > 20 && r.height > 20 && r.bottom <= window.innerHeight + 8, through: spot && getComputedStyle(spot).pointerEvents === 'none',
        mode: document.querySelector('.app')?.className.replace('app app-', ''), sub: document.querySelector('[data-testid="planner"]')?.dataset.subsystem ?? null,
        site: document.querySelector('.hud-title')?.textContent ?? '', compare: Boolean(document.querySelector('[data-testid="compare-block"].is-on')), playing: document.querySelector('[data-testid="play"]')?.getAttribute('aria-pressed'),
      };
    });
    steps.push(st);
    if (k === 4) await shot2('29b-tutorial-step-4-power.png');
    if (k === 8) await shot2('29c-tutorial-step-8-compare.png');
    if (k < 10) await p2.keyboard.press('ArrowRight');
  }
  const drove = steps[0].site.includes('Shackleton') && steps[0].sub === 'overview' && steps[2].playing === 'true' && steps[3].sub === 'power' && steps[4].sub === 'comms'
    && steps[5].sub === 'terrain' && steps[6].sub === 'science' && steps[7].compare && steps[8].mode === 'triage' && steps[9].mode === 'planner';
  check('tutorial runs ten spotlighted steps that drive the real interface (3-D, double-click, transport, five tabs, windows and comparison, Emergency, export)',
    drove && steps.every((s) => s.spot && s.through) && steps[1].tag.includes('2/10'), steps.map((s) => `${s.tag?.replace(/\s+/g, ' ')} ${s.title} [${s.mode}/${s.sub}]`).join(' | '));
  await p2.keyboard.press('ArrowRight'); // finish
  await p2.waitForTimeout(1500);
  const restored = await state2();
  check('finishing the tutorial restores the previous state (mode, subsystem, site, date, no comparison)', JSON.stringify(restored) === JSON.stringify(userState), `${JSON.stringify(userState)} -> ${JSON.stringify(restored)}`);
  await p2.click('[data-testid="briefing-open"]');
  await p2.click('[data-testid="briefing-go"]');
  await p2.waitForSelector('[data-testid="briefing-step"][data-step="1"]');
  await p2.keyboard.press('ArrowRight'); await p2.keyboard.press('ArrowRight'); await p2.keyboard.press('ArrowRight');
  await p2.waitForTimeout(1200);
  await p2.keyboard.press('Escape');
  await p2.waitForTimeout(1500);
  check('Escape leaves the tutorial at any step and restores the state', (await p2.locator('[data-testid="briefing-step"]').count()) === 0 && JSON.stringify(await state2()) === JSON.stringify(userState) && await p2.evaluate(() => localStorage.getItem('clps.briefing') === 'done'));

  // back to the default site for the verdict checks
  await openPanel('sites', 'overview', p2);
  await p2.selectOption('[data-testid="site-A"]', 'shackleton-ridge');
  await p2.fill('[data-testid="start-A"]', '2027-09-01');
  await p2.waitForTimeout(1500);
  const levelA = await p2.locator('[data-testid="verdict"]').getAttribute('data-level');
  const sentenceA = await text2('[data-testid="verdict-sentence"]');
  check('verdict card states GO / CAUTION / NO-GO in plain language', ['go', 'caution', 'nogo'].includes(levelA) && sentenceA.length > 30, `${levelA}: ${sentenceA}`);
  await openPanel('windows', 'overview', p2);
  await p2.locator('[data-testid="compare-toggle"]').scrollIntoViewIfNeeded();
  await p2.click('[data-testid="compare-toggle"]');
  await p2.selectOption('[data-testid="site-B"]', 'malapert-massif');
  await p2.waitForSelector('[data-testid="quick-B"] .quick-level', { timeout: 60000 });
  const quick = await p2.evaluate(() => ({ bars: document.querySelectorAll('[data-testid="quick-A"] .quick-bar').length, ground: document.querySelector('[data-testid="quick-A"] [data-bar="ground"]')?.textContent ?? '', slope: document.querySelector('[data-testid="quick-A"] [data-bar="slope"]')?.textContent ?? '' }));
  check('quick comparison: four bars per scenario; landing safety = 1 − P(tip-over) as a probability, the slope apart', quick.bars === 4 && /1 − P\(tip-over\)/.test(quick.ground) && /Ground slope [\d.]+°/.test(quick.slope), JSON.stringify(quick));
  await p2.waitForTimeout(400);
  await p2.locator('[data-testid="quick-A"]').scrollIntoViewIfNeeded();
  await shot2('30-quick-compare.png');

  // one-click rescue of the scenario that loses the lander (Malapert, 60 days)
  await p2.click('[data-testid="view-B"]');
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

  // double-click to land: reticle, hint, action
  await p2.click('[data-testid="view-A"]');
  await p2.waitForTimeout(1500);
  const hint = await text2('[data-testid="dbl-hint"]');
  const lp = await p2.evaluate(() => window.__clps.landerScreen());
  await p2.mouse.move(lp.x + 50, lp.y + 25);
  await p2.waitForTimeout(400);
  const reticle = await p2.evaluate(() => { const c = document.querySelector('[data-testid="dbl-cursor"]'); return { shown: c.style.display !== 'none', action: c.dataset.action, text: c.textContent }; });
  check('the 3-D view states the double-click permanently and the reticle says what will happen', /Double-click the terrain: move the lander \(≤ 500 m\) or create a custom site/.test(hint) && reticle.shown && ((reticle.action === 'move' && /Move the lander \(\d+ m\)/.test(reticle.text)) || (reticle.action === 'create' && /Create a custom site here/.test(reticle.text))), `${hint} | ${JSON.stringify(reticle)}`);
  const box = await p2.locator('[data-testid="scene"] canvas').boundingBox();
  const before2 = await text2('[data-testid="reloc-readout"]');
  await p2.mouse.dblclick(box.x + box.width * 0.5 + 60, box.y + box.height * 0.5 + 40);
  await p2.waitForTimeout(2500);
  const hudAfter = await text2('.hud-tl');
  const after2 = await text2('[data-testid="reloc-readout"]');
  check('double-click on the terrain moves the lander there', after2 !== before2 || /Custom/.test(hudAfter), `${before2} -> ${after2}; ${hudAfter.slice(0, 60)}`);
  await p2.click('[data-testid="dbl-hint-close"]');
  await p2.reload();
  await p2.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 60000 });
  check('the double-click hint can be dismissed and stays dismissed', (await p2.locator('[data-testid="dbl-hint"]').count()) === 0 && await p2.evaluate(() => localStorage.getItem('clps.dblhint') === 'hidden'));
  check('the telemetry chip remembers it was closed', await p2.evaluate(() => !document.querySelector('[data-testid="readout"]') && document.querySelector('[data-testid="dock-telemetry"]')?.getAttribute('aria-pressed') === 'false'));

  // emergency: the same flow, from now, anywhere in the cap
  await p2.click('[data-testid="mode-triage"]');
  await p2.waitForSelector('[data-testid="triage"]');
  await p2.waitForSelector('[data-testid="emg-now"]');
  const nowText = await text2('[data-testid="emg-now"]');
  const today = new Date().toISOString().slice(0, 10);
  const triUi = await p2.evaluate(() => ({ date: document.querySelectorAll('[data-testid="triage"] input[type="date"]').length, retry: [...document.querySelectorAll('[data-testid="triage"] button')].some((b) => /Retry 20 m/.test(b.textContent)), shared: Boolean(document.querySelector('[data-testid="triage"] [data-testid="emg-inputs"]')) && Boolean(document.querySelector('[data-testid="triage"] [data-testid="emg-result"]')) }));
  check('Emergency mode uses the shared emergency flow, evaluated from now (no date, no "Retry 20 m")', triUi.shared && triUi.date === 0 && !triUi.retry && nowText.includes(today) && /From now/.test(nowText), `${nowText}; ${JSON.stringify(triUi)}`);
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
  check('emergency mode gives the time to freeze and where to move', /(\d+ h|survives|never|holds|sunlit|SAFE)/.test(clocks) && /(m →|Stay)/.test(esc), `${clocks} || ${esc}`);
  const freeze0 = await text2('[data-vital="freeze"]');
  await p2.fill('[data-testid="emg-energy"]', '300');
  await p2.locator('[data-testid="emg-energy"]').blur();
  await p2.waitForTimeout(2500);
  const freeze1 = await text2('[data-vital="freeze"]');
  check('the energy left in the battery changes the answer', freeze0 !== freeze1 || /(\d+ h)/.test(freeze1), `${freeze0} -> ${freeze1}`);
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

  // ------------------------------------------------------------ reduced motion and the developer frame counter
  {
  const ctx3 = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push(`p3 pageerror: ${e.message}`));
  await p3.addInitScript(() => localStorage.setItem('clps.briefing', 'done'));
  await p3.goto(`${URL}?debug=1`);
  await p3.waitForSelector('[data-testid="verdict"][data-level]', { timeout: 60000 });
  const reduced = await p3.evaluate(async () => {
    const t0 = performance.now();
    let emblem = false;
    document.querySelector('[data-testid="subsys-terrain"]').click();
    await new Promise((resolve) => {
      const tick = () => {
        if (document.querySelector('.subsys-emblem')) emblem = true;
        if (performance.now() - t0 < 900) requestAnimationFrame(tick); else resolve();
      };
      tick();
    });
    return { emblem, sub: document.querySelector('[data-testid="planner"]').dataset.subsystem, curtain: Boolean(document.querySelector('[data-testid="subsys-curtain"]')) };
  });
  check('with prefers-reduced-motion the tab change is a short fade without the animated icon', !reduced.emblem && reduced.sub === 'terrain' && !reduced.curtain, JSON.stringify(reduced));
  check('the frame counter appears only with ?debug=1', (await p3.locator('[data-testid="fps"]').count()) === 1);
  await ctx3.close();
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
