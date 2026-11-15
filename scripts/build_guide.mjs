/**
 * Interface guide: Markdown -> PDF, in Spanish and English.
 *
 *   npm run guide
 *
 * Sources: docs/guia-interfaz.md (es) and docs/guia-interfaz.en.md (en).
 * Output:  public/guide/guia-interfaz-es.pdf and public/guide/guia-interfaz-en.pdf
 *
 * No extra dependency: a small Markdown subset (headings, paragraphs, lists,
 * tables, quotes, bold, inline code, images on their own line) is turned into
 * HTML here, and the Chromium that Playwright already installs for the e2e
 * tests prints it. The images are real screenshots of the app made by
 * scripts/guide-shots.ts (docs/img/es, docs/img/en); the cover carries the
 * official GISAT UDEC badge (public/brand/logo-gisat.png).
 */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'guide');
mkdirSync(out, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const docs = join(root, 'docs');

/** Markdown subset to HTML. */
export function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*$/.test(line)) { flush(); i++; continue; }
    const img = line.match(/^!\[\]\(([^)]+)\)\s*$/);
    if (img) { flush(); html.push(`<figure><img src="${pathToFileURL(join(docs, img[1])).href}" alt=""></figure>`); i++; continue; }
    if (line.startsWith('> ')) {
      flush();
      const q = [];
      while (i < lines.length && lines[i].startsWith('> ')) q.push(lines[i++].slice(2));
      html.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*[*-]\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[*-]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[*-]\s+/, ''));
      html.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s+/, ''));
      html.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`);
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      html.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return html.join('\n');
}

const font = (file) => pathToFileURL(join(root, 'node_modules', '@fontsource', file)).href;
const CSS = `
@font-face { font-family: "B612"; src: url("${font('b612/files/b612-latin-400-normal.woff2')}") format("woff2"); font-weight: 400; }
@font-face { font-family: "B612"; src: url("${font('b612/files/b612-latin-700-normal.woff2')}") format("woff2"); font-weight: 700; }
@font-face { font-family: "JetBrains Mono"; src: url("${font('jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2')}") format("woff2"); }
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
body { font: 10.2pt/1.5 "B612", system-ui, sans-serif; color: #1b2433; }
h1 { font-size: 20pt; color: #06080D; margin: 0 0 4pt; border-bottom: 3pt solid #10B981; padding-bottom: 6pt; }
h1 + p { color: #4a5a72; margin-top: 2pt; }
h2 { font-size: 13.5pt; color: #06080D; margin: 18pt 0 6pt; padding-left: 8pt; border-left: 4pt solid #06B6D4; break-after: avoid; }
h3 { font-size: 11.5pt; color: #0D111A; margin: 12pt 0 4pt; break-after: avoid; }
p { margin: 4pt 0; }
ul, ol { margin: 4pt 0 4pt 16pt; padding: 0; }
li { margin: 2pt 0; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; background: #fff7e6; border-left: 3pt solid #F59E0B; color: #5b4310; }
code { font-family: "JetBrains Mono", monospace; font-size: 9pt; background: #eef2f7; padding: 0 3pt; border-radius: 2pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9pt; break-inside: avoid; }
th { text-align: left; background: #0D111A; color: #e6edf7; padding: 4pt 6pt; }
td { padding: 4pt 6pt; border-bottom: 0.6pt solid #d5dce6; vertical-align: top; }
tr:nth-child(even) td { background: #f6f8fb; }
strong { color: #06080D; }
figure { margin: 6pt 0 8pt; break-inside: avoid; }
figure img { width: 100%; border: 0.6pt solid #b7c2d2; border-radius: 2pt; display: block; }
.cover { display: flex; align-items: center; gap: 14pt; margin-bottom: 8pt; }
.cover img { width: 30mm; height: 30mm; }
`;

const GUIDES = [
  { lang: 'es', src: 'guia-interfaz.md', pdf: 'guia-interfaz-es.pdf', footer: 'Guía de la interfaz · CLPS Lunar Mission Browser v3.1 · GISAT UdeC' },
  { lang: 'en', src: 'guia-interfaz.en.md', pdf: 'guia-interfaz-en.pdf', footer: 'Interface guide · CLPS Lunar Mission Browser v3.1 · GISAT UdeC' },
];

const browser = await chromium.launch();
try {
  for (const g of GUIDES) {
    const md = readFileSync(join(root, 'docs', g.src), 'utf8');
    const title = (md.match(/^#\s+(.*)$/m) ?? [, 'Guide'])[1];
    const html = `<!doctype html><html lang="${g.lang}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="cover"><img src="${pathToFileURL(join(root, 'public', 'brand', 'logo-gisat.png')).href}" alt="GISAT UDEC"></div>${mdToHtml(md)}</body></html>`;
    const tmp = join(out, `.${g.lang}.html`);
    writeFileSync(tmp, html, 'utf8');
    const page = await browser.newPage();
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    const missing = await page.evaluate(() => [...document.images].filter((im) => !im.complete || im.naturalWidth === 0).map((im) => im.src));
    if (missing.length) throw new Error(`images not found: ${missing.join(', ')} (run npm run guide-shots)`);
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: join(out, g.pdf), format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font: 7pt sans-serif; color: #7385a0; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;"><span>${esc(g.footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    await page.close();
    rmSync(tmp);
    console.log(`public/guide/${g.pdf}`);
  }
} finally {
  await browser.close();
}
