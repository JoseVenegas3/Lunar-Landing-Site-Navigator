/**
 * Writes docs/guion-principiante.md, the final Beginner script with the values
 * the engine gave, from the narration the end-to-end run recorded
 * (artifacts/beginner/narration.json, in Spanish).
 *
 *   npm run e2e:beginner && node scripts/build-guion.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const seen = JSON.parse(readFileSync(join(root, 'artifacts', 'beginner', 'narration.json'), 'utf8'));
const TITLES = ['Primer alunizaje', 'Sitio y fecha', 'Terreno y vuelco', 'Energía y frío', 'Comunicaciones', 'Contingencia', 'Ciencia', 'Emergencia (examen final)'];
const clean = (s) => s.replace(/★/g, '').replace(/(Continuar|Continue)$/, '').replace(/(ACCEDER A LA CONSOLA PRO \(MISSION LEADER\))$/, '').trim();

let md = `# Guion del Principiante (v3.0), con los valores del motor

Generado por \`scripts/build-guion.mjs\` a partir de la narración que registró la
prueba \`npm run e2e:beginner\` (${new Date().toISOString().slice(0, 10)}), en español. Cada cifra la calculó el motor
en ese momento; la app la vuelve a leer en vivo. Escenarios: \`src/beginner/scenarios.ts\`
(búsqueda con \`npm run find-scenarios\`); discrepancias con el guion original y su
resolución: ARCHITECTURE.md, sección 6.8.

`;
let mission = -1;
for (const s of seen) {
  const m = Number(s.id.slice(1, 2));
  if (m !== mission) { mission = m; md += `\n## Misión ${m} · ${TITLES[m]}\n\n`; }
  md += `- **${s.id}**: ${clean(s.text)}\n`;
}
writeFileSync(join(root, 'docs', 'guion-principiante.md'), md);
console.log(`docs/guion-principiante.md (${seen.length} pasos)`);
