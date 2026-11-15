/**
 * NASA Space Apps pitch decks: exactly 7 slides, English for the global
 * submission and Spanish for the live pitch in Concepción.
 *
 *   node scripts/build-pitch-pptx.mjs
 *
 * Every figure comes from the app's engine or its documentation (README,
 * ARCHITECTURE); the screenshots are real captures of the app (docs/img/pitch).
 * Speaker notes carry the 3-minute script with timings, in both languages.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pptxgen from 'pptxgenjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = (f) => join(root, 'docs', 'img', 'pitch', f);
const LOGO = join(root, 'public', 'brand', 'logo-gisat.png');
const C = { bg: '060911', panel: '0F1624', line: '1E293B', cyan: '00F0FF', amber: 'FFB800', red: 'FF2A54', green: '00E676', text: 'E6EDF7', dim: '8A9BB4', white: 'FFFFFF' };

/** [en, es] for every text. */
const S = [
  {
    time: '0:00–0:25', crit: ['IMPACT', 'IMPACTO'], img: 'hero.png',
    title: ['Lunar Landing Site Navigator', 'Lunar Landing Site Navigator'],
    sub: ['Where to land, and how to survive, at the lunar south pole', 'Dónde alunizar, y cómo sobrevivir, en el Polo Sur de la Luna'],
    bullets: [
      ['IM-1 Odysseus (Feb 2024) came to rest tilted; IM-2 Athena (Mar 2025) ended on its side in a shadowed crater.', 'IM-1 Odysseus (feb 2024) quedó inclinado; IM-2 Athena (mar 2025) terminó de costado en un cráter en sombra.'],
      ['At 80–90° S the Sun skims the horizon and the Earth only rocks by libration.', 'A 80–90° S el Sol roza el horizonte y la Tierra solo se mece por libración.'],
      ['A few hundred metres separate a sunlit ridge from permanent shadow.', 'Unos cientos de metros separan una cresta iluminada de la sombra permanente.'],
    ],
    metric: ['2.0°', '2,0°'], mlabel: ['highest possible Sun at 89.5° S (engine)', 'Sol más alto posible a 89,5° S (motor)'], mcolor: C.amber,
    say: ['In 2024 and 2025, Odysseus and Athena showed that reaching the Moon is not enough. At the south pole the Sun never climbs more than a couple of degrees, so a tilt or a few hundred metres into a shadow can lose a lander in hours. GISAT UdeC built the Lunar Landing Site Navigator to know exactly where to touch down.',
      'En 2024 y 2025, Odysseus y Athena mostraron que llegar a la Luna no basta. En el Polo Sur el Sol no sube más de un par de grados, así que una inclinación o unos cientos de metros dentro de una sombra pueden perder una nave en horas. GISAT UdeC creó Lunar Landing Site Navigator para saber exactamente dónde tocar suelo.'],
  },
  {
    time: '0:25–0:50', crit: ['RELEVANCE · NASA DATA', 'RELEVANCIA · DATOS NASA'], img: 'terr.png',
    title: ['NASA data is the engine, not decoration', 'Los datos de la NASA son el motor, no un adorno'],
    bullets: [
      ['LRO LOLA topography (Barker et al. 2023): 20 m/px at the sites, 160 m/px across the cap, 800 m/px horizon out to 250 km.', 'Topografía LRO LOLA (Barker et al. 2023): 20 m/px en los sitios, 160 m/px en el casquete y horizonte a 800 m/px hasta 250 km.'],
      ['Sun and Earth ephemerides checked against NASA JPL Horizons.', 'Efemérides del Sol y la Tierra contrastadas con NASA JPL Horizons.'],
      ['LRO Diviner temperatures and permanent-shadow layers feed the thermal model and the science index.', 'Temperaturas de LRO Diviner y capas de sombra permanente alimentan el modelo térmico y el índice científico.'],
      ['LOLA limits stated on screen; terrain error propagated as P10 / P50 / P90.', 'Límites de LOLA declarados en pantalla; error del terreno propagado como P10 / P50 / P90.'],
    ],
    metric: ['0.0023°', '0,0023°'], mlabel: ['max ephemeris error vs JPL Horizons', 'error máx. de efemérides frente a JPL Horizons'], mcolor: C.cyan,
    say: ['We do not use NASA data as decoration: it is our physics. Every shadow and horizon comes from LRO LOLA terrain, the ephemerides agree with JPL Horizons to two thousandths of a degree, and Diviner temperatures drive the thermal model. Where the data has limits, the app says so and propagates the error.',
      'No usamos los datos de la NASA como adorno: son nuestra física. Cada sombra y cada horizonte salen del terreno LOLA del LRO, las efemérides coinciden con JPL Horizons en dos milésimas de grado y las temperaturas de Diviner mueven el modelo térmico. Donde los datos tienen límites, la app lo dice y propaga el error.'],
  },
  {
    time: '0:50–1:15', crit: ['IMPACT · USABILITY', 'IMPACTO · USABILIDAD'], img: 'gate.png', img2: 'rack.png',
    title: ['From student to flight director', 'De estudiante a director de vuelo'],
    bullets: [
      ['One entry gate: English / Spanish and SI / Imperial units.', 'Una sola puerta: inglés / español y unidades SI / Imperial.'],
      ['Guided mode: eight narrated missions, one badge per subsystem, and "Learn more: Earth vs Moon".', 'Modo Guiado: ocho misiones narradas, una insignia por subsistema y «Aprender más: Tierra vs. Luna».'],
      ['Full mode (Mission Leader): every engineering control, with A/B comparison.', 'Modo Completo (Mission Leader): todos los controles de ingeniería, con comparación A/B.'],
    ],
    metric: ['2 modes', '2 modos'], mlabel: ['for mission planners and for the public', 'para planificadores de misión y para el público'], mcolor: C.green,
    say: ['The challenge asks to serve mission planners and the public. One gate leads to a guided training, eight missions with badges that teach why the Moon is different, and to the full engineering console. Both in English or Spanish, in SI or Imperial units.',
      'El desafío pide servir a planificadores y al público. Una puerta lleva a un entrenamiento guiado, ocho misiones con insignias que enseñan por qué la Luna es distinta, y a la consola de ingeniería completa. Ambos en español o inglés, en unidades SI o Imperiales.'],
  },
  {
    time: '1:15–1:45', crit: ['CREATIVITY', 'CREATIVIDAD'], img: 'cont.png',
    title: ['A lander that tilts, freezes and recovers', 'Un módulo que se inclina, se congela y se recupera'],
    bullets: [
      ['6-DOF attitude: IM-1 and IM-2 presets, pointing loss, self-occlusion and an antenna gimbal.', 'Actitud 6-DOF: preajustes IM-1 e IM-2, pérdida de apuntamiento, autooclusión y cardán de antena.'],
      ['Coupled electro-thermal model: radiative cooling (σT⁴), heaters at 0 °C, battery lost at −20 °C.', 'Modelo electrotérmico acoplado: enfriamiento radiativo (σT⁴), calefactores a 0 °C, batería perdida a −20 °C.'],
      ['Solar elevation as a power KPI; 10 m mast and 1-axis Sun tracker.', 'Elevación solar como KPI de potencia; mástil de 10 m y seguidor solar de 1 eje.'],
    ],
    metric: ['35% → 7%', '35 % → 7 %'], mlabel: ['downlink time with a 30° roll (engine)', 'tiempo de enlace con 30° de alabeo (motor)'], mcolor: C.red,
    say: ['Most tools assume a lander sits level and only measure geometric light. We model attitude in six degrees of freedom: with the IM-1 tilt of 30 degrees, our engine shows the downlink dropping from 35 to 7 percent of the window, and the antenna gimbal getting it back. And we couple power and temperature, down to the frozen battery.',
      'La mayoría de las herramientas supone que la nave queda nivelada y solo mide luz geométrica. Modelamos la actitud en seis grados de libertad: con la inclinación de 30 grados de IM-1, el motor muestra que el enlace cae del 35 al 7 por ciento de la ventana, y el cardán de antena lo recupera. Y acoplamos energía y temperatura, hasta la batería congelada.'],
  },
  {
    time: '1:45–2:10', crit: ['CREATIVITY · LOCAL IMPACT', 'CREATIVIDAD · IMPACTO LOCAL'], img: 'com.png',
    title: ['Real radio physics, from the Moon to Concepción', 'Física de radio real, de la Luna a Concepción'],
    bullets: [
      ['Knife-edge diffraction over up to three ridges (Deygout, ITU-R P.526) and regolith multipath.', 'Difracción de filo de cuchillo sobre hasta tres crestas (Deygout, ITU-R P.526) y multitrayecto en el regolito.'],
      ['DSN 34 m stations and a relay in an elliptical frozen orbit.', 'Estaciones DSN de 34 m y un relevo en órbita elíptica congelada.'],
      ['A hypothetical GISAT UdeC 3.7 m ground station in Concepción, Chile.', 'Una estación terrena hipotética GISAT UdeC de 3,7 m en Concepción, Chile.'],
      ['Plume-surface interaction: exclusion radius to protect neighbouring assets.', 'Interacción pluma-superficie: radio de exclusión para proteger activos vecinos.'],
    ],
    metric: ['3.7 m', '3,7 m'], mlabel: ['GISAT UdeC dish, modelled as a hypothetical station', 'antena GISAT UdeC, modelada como estación hipotética'], mcolor: C.cyan,
    say: ['We replace the yes-or-no line of sight with diffraction over three ridges and bounces on the regolith, and connect the Moon to the Deep Space Network, to a relay, and to a hypothetical 3.7 metre GISAT station here in Concepción. We also keep a landing from blasting dust onto its neighbours.',
      'Reemplazamos la línea de vista de sí o no por difracción sobre tres crestas y rebotes en el regolito, y conectamos la Luna con la Red del Espacio Profundo, con un relevo y con una estación hipotética de GISAT de 3,7 metros aquí en Concepción. Además, evitamos que un alunizaje lance polvo sobre sus vecinos.'],
  },
  {
    time: '2:10–2:40', crit: ['VALIDITY · LIVE DEMO', 'VALIDEZ · DEMO EN VIVO'], img: 'res.png',
    title: ['Emergency triage: rescued in one click', 'Triaje de emergencia: rescate en un clic'],
    bullets: [
      ['1 · Where are we? Position, slope and sub-pixel hazards.', '1 · ¿Dónde estamos? Posición, pendiente y peligros bajo el píxel.'],
      ['2 · How long do we have? A plain-language verdict with date and time.', '2 · ¿Cuánto tiempo queda? Un veredicto en lenguaje llano con fecha y hora.'],
      ['3 · Where to go? 25 touchdown points, an escape vector and "Run this way out".', '3 · ¿Hacia dónde ir? 25 puntos de contacto, un vector de escape y «Ejecutar esta salida».'],
      ['"Optimise" flies 38 missions in 1.1 s in a Web Worker.', '«Optimizar» simula 38 misiones en 1,1 s en un Web Worker.'],
    ],
    metric: ['250 m → E', '250 m → E'], mlabel: ['SURVIVES the 15 days, 13% energy margin (engine)', 'SOBREVIVE los 15 días, 13 % de margen (motor)'], mcolor: C.green,
    say: ['Live: a lander comes down off course near Nobile. The Emergency mode answers where we are, how long we have, and where to go. One click on "Run this way out" moves it 250 metres east, and the headline turns green: it survives the 15 days with a 13 percent energy margin.',
      'En vivo: una nave cae fuera de curso cerca de Nobile. El modo Emergencia responde dónde estamos, cuánto tiempo queda y hacia dónde ir. Un clic en «Ejecutar esta salida» la mueve 250 metros al este y el titular cambia a verde: sobrevive los 15 días con 13 por ciento de margen de energía.'],
  },
  {
    time: '2:40–3:00', crit: ['SUMMARY', 'RESUMEN'], summary: true,
    title: ['Verified, open and ready to use', 'Verificado, abierto y listo para usar'],
    cards: [['175', ['unit tests passing', 'pruebas unitarias en verde'], C.green], ['159', ['browser checks passing', 'comprobaciones en navegador'], C.green], ['0', ['internet requests: works offline', 'peticiones a internet: sin conexión'], C.cyan], ['16', ['glossary terms, PDF guide EN / ES', 'términos de glosario, guía PDF ES / EN'], C.amber]],
    bullets: [
      ['Telemetry CSV export, model assumptions with sources, runs with npm install && npm run dev.', 'Exportación CSV de telemetría, supuestos con fuentes; se ejecuta con npm install && npm run dev.'],
      ['Aiming for: Best Mission Concept · Best Use of Science · Best Use of Data · Local Impact.', 'Apuntamos a: Best Mission Concept · Best Use of Science · Best Use of Data · Local Impact.'],
    ],
    close: ['At the lunar south pole, 200 metres or a few hours write the story. Now we know where to touch down.', 'En el Polo Sur lunar, 200 metros o unas pocas horas escriben la historia. Hoy sabemos dónde tocar suelo.'],
    say: ['A finished application: 175 unit tests and 159 browser checks pass, it runs without internet, and every assumption shows its source. Ready for the next CLPS mission and for students alike. At the lunar south pole, 200 metres or a few hours write the story. Thank you.',
      'Una aplicación terminada: pasan 175 pruebas unitarias y 159 comprobaciones en navegador, funciona sin internet y cada supuesto muestra su fuente. Lista para la próxima misión CLPS y para estudiantes por igual. En el Polo Sur lunar, 200 metros o unas pocas horas escriben la historia. Muchas gracias.'],
  },
];

async function build(li, file) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pres.title = 'Lunar Landing Site Navigator — GISAT UdeC';
  pres.author = 'GISAT UdeC';
  pres.theme = { headFontFace: 'Calibri', bodyFontFace: 'Calibri' };
  pres.defineSlideMaster({
    title: 'MISSION', background: { color: C.bg },
    objects: [{ text: { text: 'GISAT UdeC · Lunar Landing Site Navigator · NASA Space Apps 2026', options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: C.dim, margin: 0 } } }],
    slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.dim, align: 'right' },
  });
  const tb = (s, text, o) => s.addText(text, { margin: 0, isTextBox: true, ...o });
  for (const [k, d] of S.entries()) {
    const s = pres.addSlide({ masterName: 'MISSION' });
    // judging criterion seal, top right (slide 1 places its own over the photo)
    if (k) s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.55, y: 0.35, w: 4.2, h: 0.42, rectRadius: 0.21, fill: { color: C.panel }, line: { color: k % 2 ? C.amber : C.cyan, width: 1 } });
    if (k) tb(s, `${li ? 'CRITERIO' : 'JUDGING CRITERION'}: ${d.crit[li]}`, { x: 8.55, y: 0.35, w: 4.2, h: 0.42, fontSize: 11, bold: true, color: k % 2 ? C.amber : C.cyan, align: 'center', valign: 'middle' });
    s.addNotes(`[${d.time}]\n${d.say[li]}\n\n— ${li ? 'EN' : 'ES'}: ${d.say[1 - li]}`);
    if (k === 0) {
      if (existsSync(IMG(d.img))) s.addImage({ path: IMG(d.img), x: 7.1, y: 0, w: 6.233, h: 7.5, sizing: { type: 'cover', w: 6.233, h: 7.5 } });
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.35, y: 0.3, w: 5.7, h: 0.55, rectRadius: 0.27, fill: { color: C.panel }, line: { color: C.cyan, width: 1 } });
      tb(s, `${li ? 'CRITERIO' : 'JUDGING CRITERION'}: ${d.crit[li]}`, { x: 7.35, y: 0.3, w: 5.7, h: 0.55, fontSize: 12, bold: true, color: C.cyan, align: 'center', valign: 'middle' });
      if (existsSync(LOGO)) s.addImage({ path: LOGO, x: 0.6, y: 0.5, w: 1.2, h: 1.2 });
      tb(s, d.title[li], { x: 0.6, y: 1.9, w: 6.2, h: 1.3, fontSize: 38, bold: true, color: C.white, valign: 'bottom' });
      tb(s, d.sub[li], { x: 0.6, y: 3.25, w: 6.2, h: 0.75, fontSize: 18, color: C.text });
      tb(s, d.bullets.map((b, i) => ({ text: b[li], options: { bullet: true, breakLine: i < d.bullets.length - 1 } })), { x: 0.6, y: 4.1, w: 6.2, h: 1.7, fontSize: 14, color: C.text, paraSpaceAfter: 6, valign: 'top' });
      tb(s, d.metric[li], { x: 0.6, y: 5.85, w: 1.9, h: 0.8, fontSize: 40, bold: true, color: d.mcolor, valign: 'middle' });
      tb(s, d.mlabel[li], { x: 2.55, y: 5.85, w: 4.25, h: 0.8, fontSize: 14, color: C.dim, valign: 'middle' });
      continue;
    }
    tb(s, d.title[li], { x: 0.6, y: 0.95, w: 12.1, h: 0.8, fontSize: 30, bold: true, color: C.white, valign: 'middle' });
    if (d.summary) {
      d.cards.forEach(([n, l, col], i) => {
        const x = 0.6 + i * 3.1;
        s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.95, w: 2.85, h: 1.9, rectRadius: 0.12, fill: { color: C.panel }, line: { color: C.line, width: 0.75 } });
        tb(s, n, { x: x + 0.25, y: 2.1, w: 2.4, h: 0.9, fontSize: 48, bold: true, color: col, valign: 'bottom' });
        tb(s, l[li], { x: x + 0.25, y: 3.05, w: 2.4, h: 0.7, fontSize: 14, color: C.text, valign: 'top' });
      });
      tb(s, d.bullets.map((b, i) => ({ text: b[li], options: { bullet: true, breakLine: i < d.bullets.length - 1 } })), { x: 0.6, y: 4.15, w: 10.2, h: 1.2, fontSize: 15, color: C.text, paraSpaceAfter: 8, valign: 'top' });
      if (existsSync(LOGO)) s.addImage({ path: LOGO, x: 11.2, y: 4.05, w: 1.5, h: 1.5 });
      tb(s, d.close[li], { x: 0.6, y: 5.75, w: 12.1, h: 0.9, fontSize: 22, bold: true, italic: true, color: C.amber, valign: 'middle' });
      continue;
    }
    // left: bullets and the big metric; right: real screenshot(s) in a cyan frame
    tb(s, d.bullets.map((b, i) => ({ text: b[li], options: { bullet: true, breakLine: i < d.bullets.length - 1 } })), { x: 0.6, y: 1.95, w: 5.6, h: 3.3, fontSize: 15, color: C.text, paraSpaceAfter: 9, valign: 'top' });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 5.35, w: 5.6, h: 1.3, rectRadius: 0.12, fill: { color: C.panel }, line: { color: d.mcolor, width: 1 } });
    tb(s, d.metric[li], { x: 0.85, y: 5.45, w: 2.6, h: 1.1, fontSize: 32, bold: true, color: d.mcolor, valign: 'middle' });
    tb(s, d.mlabel[li], { x: 3.5, y: 5.45, w: 2.55, h: 1.1, fontSize: 13, color: C.text, valign: 'middle' });
    const frame = (f, x, y, w, h) => {
      if (!existsSync(IMG(f))) return;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - 0.05, y: y - 0.05, w: w + 0.1, h: h + 0.1, rectRadius: 0.1, fill: { color: C.panel }, line: { color: C.cyan, width: 1.25 } });
      s.addImage({ path: IMG(f), x, y, w, h, sizing: { type: 'contain', w, h } });
    };
    if (d.img2) { frame(d.img, 6.75, 1.95, 5.95, 3.3); frame(d.img2, 6.75, 5.45, 5.95, 0.52); }
    else frame(d.img, 6.75, 1.95, 5.95, 4.7);
  }
  await pres.writeFile({ fileName: join(root, 'docs', file) });
  console.log(`docs/${file}`);
}

await build(0, 'GISAT_Lunar_Navigator_Global_Submission_7Slides_EN.pptx');
await build(1, 'GISAT_Lunar_Navigator_Local_Pitch_7Slides_ES.pptx');
