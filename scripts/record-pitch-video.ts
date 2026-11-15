/**
 * Records the 3-minute video pitch to public/pitch/:
 *
 *   npm run build && npm run record-pitch
 *
 * 1. Serves the production build and opens `?pitch=true&record=auto` at
 *    1920 × 1080 in Chromium with tab capture auto-accepted: the page records
 *    itself (getDisplayMedia + MediaRecorder, 60 fps, with the procedural
 *    sound) from 0:00 to 3:00 and hands over a WebM.
 * 2. If tab capture is not available, falls back to Playwright's own video
 *    recording of the same run (no sound, ~25 fps).
 * 3. If ffmpeg is available (FFMPEG_PATH, or `ffmpeg` on the PATH), also
 *    writes an H.264 MP4 next to the WebM.
 *
 * The controls are hidden in the recording (`hud=0`); the subtitles stay.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = join(root, 'public', 'pitch');
mkdirSync(outDir, { recursive: true });
const NAME = 'gisat-lunar-navigator-pitch-3min';
const webm = join(outDir, `${NAME}.webm`);
const mp4 = join(outDir, `${NAME}.mp4`);
const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}/`;
const lang = process.argv.includes('--en') ? 'en' : 'es';

async function waitForServer(url: string, ms = 30000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start at ${url}`);
}

async function tabCapture(): Promise<boolean> {
  let browser;
  try {
    browser = await chromium.launch({
    headless: false,
    args: ['--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required', '--use-angle=gl', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1920,1160'],
    });
  } catch (e) {
    console.warn('  a visible Chromium could not be started:', (e as Error).message.split(String.fromCharCode(10))[0]);
    return false;
  }
  try {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true });
    const page = await ctx.newPage();
    const started = page.waitForFunction(() => document.querySelector('[data-testid="pitch"]') && (window.__pitch?.t() ?? 0) > 1, null, { timeout: 90000 });
    await page.goto(`${BASE}?pitch=true&record=auto&hud=0&lang=${lang}`);
    await started;
    console.log('  recording in the page (tab capture), 3:00 …');
    const download = await page.waitForEvent('download', { timeout: 260000 });
    await download.saveAs(webm);
    return true;
  } catch (e) {
    console.warn('  tab capture not available:', (e as Error).message.split('\n')[0]);
    return false;
  } finally {
    await browser.close();
  }
}

/** Seconds of the fallback recording after 3:00 (from the end of the pitch to the end of the video). */
let tail = 0;

async function playwrightVideo(): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const dir = join(root, 'artifacts', 'pitch-video');
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { (window as unknown as { __pitchAudio: { played: string[] } }).__pitchAudio = { played: [] }; });
  await page.goto(`${BASE}?pitch=true&autoplay=1&hud=0&lang=${lang}`);
  console.log('  recording with Playwright (no sound), 3:00 …');
  await page.waitForFunction(() => window.__pitch?.done() === true, null, { timeout: 260000, polling: 50 });
  const doneAt = Date.now();
  const video = page.video();
  await ctx.close();
  tail = (Date.now() - doneAt) / 1000;
  const path = await video?.path();
  if (path) copyFileSync(path, webm);
  await browser.close();
}

function ffmpegBin(): string | null {
  const env = process.env.FFMPEG_PATH;
  if (env && existsSync(env)) return env;
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return probe.status === 0 ? 'ffmpeg' : null;
}

const server = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
try {
  await waitForServer(BASE);
  if (!(await tabCapture())) await playwrightVideo();
  if (!existsSync(webm)) throw new Error('no video was produced');
  console.log(`  ${webm} (${(statSync(webm).size / 1e6).toFixed(1)} MB)`);
  const ff = ffmpegBin();
  if (ff) {
    // The video may start a little before or after 0:00: keep the last 180 s before the tail.
    const probe = spawnSync(ff.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webm], { encoding: 'utf8' });
    const total = Number(probe.stdout);
    const start = Number.isFinite(total) ? Math.max(0, total - 180 - tail) : 0;
    const r = spawnSync(ff, ['-y', '-ss', start.toFixed(2), '-i', webm, '-t', '180', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '60', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
    if (r.status === 0) console.log(`  ${mp4} (${(statSync(mp4).size / 1e6).toFixed(1)} MB)`);
  } else {
    console.log('  ffmpeg not found: only the WebM was written (set FFMPEG_PATH for an MP4).');
  }
} finally {
  server.kill();
}
