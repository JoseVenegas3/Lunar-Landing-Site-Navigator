/**
 * Writes docs/pitch-guion.md, the speaker's script of the video pitch, from
 * src/pitch/timeline.ts (the same lines as the teleprompter):
 *   npx vite-node scripts/pitch-script-md.ts
 */
import { writeFileSync } from 'node:fs';
import { ACTS, SCENES, clock } from '../src/pitch/timeline';

const slot = (s: string): string => s
  .replace('{head}', '«titular de la app en vivo»')
  .replace('{move}', '«botón de salida en vivo»')
  .replace('{tests}', '«recuento de pruebas»');
const out: string[] = [
  '# Guion del video pitch (3:00)',
  '',
  'Generado desde `src/pitch/timeline.ts` (`npx vite-node scripts/pitch-script-md.ts`): son las mismas líneas del teleprompter del reproductor (`?pitch=true`). Lo que va entre «» lo completa la app en vivo con valores del motor.',
  '',
];
for (const a of ACTS) {
  out.push(`## Acto ${a.n} · ${a.title[1]} (${clock(a.start)}–${clock(a.end)})`, '');
  for (const s of SCENES.filter((x) => x.act === a.id)) {
    out.push(`**${clock(s.start)}–${clock(s.end)}** ${slot(s.say[1])}`, '', `> EN: ${slot(s.say[0]).replace('«titular de la app en vivo»', '«live app headline»').replace('«botón de salida en vivo»', '«live way-out button»').replace('«recuento de pruebas»', '«test counts»')}`, '');
  }
}
writeFileSync('docs/pitch-guion.md', out.join('\n'));
console.log('docs/pitch-guion.md');
