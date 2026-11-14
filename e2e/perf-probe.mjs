/**
 * Frame-time probe.
 *
 *   npm run build && npm run perf
 *
 * Two passes over the production build in headless Chromium:
 *   1. vsync-paced : frame pacing as a user would see it (target 60 fps).
 *   2. uncapped    : frame-rate limit removed, which exposes the real cost of a
 *                    frame and therefore the headroom below 16.7 ms.
 *
 * Note: with the ANGLE D3D11 backend, headless Chromium on Windows pauses its
 * vsync scheduler for ~450 ms every second or two, even on an empty page. Those
 * pauses are not produced by the application (no long tasks are recorded and
 * they vanish in the uncapped pass), so the paced pass uses the ANGLE GL backend.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4174;
const URL = `http://127.0.0.1:${PORT}/`;

const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });

const rate = (page, ms) => page.evaluate((dur) => new Promise((resolve) => {
  const times = [];
  const long = [];
  let po = null;
  try {
    po = new PerformanceObserver((list) => { for (const e of list.getEntries()) long.push(Math.round(e.duration)); });
    po.observe({ entryTypes: ['longtask'] });
  } catch { /* longtask not supported */ }
  const tick = (t) => {
    times.push(t);
    if (t - times[0] < dur) { requestAnimationFrame(tick); return; }
    if (po) po.disconnect();
    const dts = times.slice(1).map((v, i) => v - times[i]);
    const sorted = [...dts].sort((a, b) => a - b);
    resolve({
      fps: ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]),
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      stalls: dts.filter((d) => d > 25).map((d) => Math.round(d)),
      longTasks: long,
    });
  };
  requestAnimationFrame(tick);
}), ms);

const show = (label, r) => console.log(
  `  ${label.padEnd(26)} ${r.fps.toFixed(1).padStart(7)} fps   median ${r.medianMs.toFixed(2)} ms   p95 ${r.p95Ms.toFixed(2)} ms   `
  + `frames > 25 ms [${r.stalls.join(',')}]   long tasks [${r.longTasks.join(',')}]`,
);

async function pass(title, args) {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--enable-gpu', ...args] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
    console.log(`${title}  (${args.join(' ')})`);
    await page.goto('about:blank');
    show('empty page', await rate(page, 3000));
    await page.goto(URL);
    await page.waitForFunction(() => window.__clps && window.__clps.frames > 5 && !document.querySelector('[data-testid="kpi-table"] td.is-pending'), null, { timeout: 60000 });
    await page.waitForTimeout(5000);
    show('planner, idle', await rate(page, 5000));
    await page.click('[data-testid="play"]');
    await page.waitForTimeout(1500);
    show('planner, playback 12 h/s', await rate(page, 6000));
    await page.click('[data-testid="play"]');
    await page.click('[data-testid="mode-triage"]');
    await page.waitForSelector('[data-testid="triage"]');
    await page.waitForTimeout(3000);
    show('emergency mode, idle', await rate(page, 5000));
  } finally {
    await browser.close();
  }
}

try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(URL)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await pass('vsync-paced', ['--use-angle=gl']);
  await pass('uncapped', ['--use-angle=d3d11', '--disable-gpu-vsync', '--disable-frame-rate-limit']);
} finally {
  server.kill();
}
