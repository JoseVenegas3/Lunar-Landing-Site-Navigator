/**
 * Prints the glossary section of the interface guides from src/lib/glossary.ts
 * (the same text as the in-app tooltips):  npx vite-node scripts/glossary-md.ts es|en
 */
import { GLOSSARY } from '../src/lib/glossary';

const lang = process.argv[2] === 'en' ? 0 : 1;
const title = lang === 0 ? '## Lunar & Engineering Glossary' : '## Glosario de Términos Lunares y de Ingeniería';
const intro = lang === 0
  ? 'The same definitions appear in the app as tooltips: hover over (or focus with the keyboard) a dotted term, above all in the Beginner narration.'
  : 'Las mismas definiciones aparecen en la app como tooltips: pasa el cursor (o enfoca con el teclado) un término subrayado con puntos, sobre todo en la narración del modo Principiante.';
const out = [title, '', intro, ''];
for (const g of GLOSSARY) out.push(`**${g.term[lang]}.** ${g.def[lang]}`, '');
process.stdout.write(out.join('\n'));
