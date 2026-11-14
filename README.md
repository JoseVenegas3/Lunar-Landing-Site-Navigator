# CLPS Lunar Mission Browser v2.0

Navegador de sitios de alunizaje del Polo Sur lunar. GISAT UdeC, NASA Space
Apps Challenge 2026.

Compara sitios candidatos y rangos de fechas mostrando dónde están el Sol y la
Tierra respecto del horizonte topográfico local, y qué significa eso para la
energía y para el enlace directo a la Tierra (DTE).

![Mission Planner](docs/img/planner.png)

## Cómo ejecutarlo

Con doble clic en `run-dev.cmd`, o desde una terminal:

```bash
npm install
npm run dev
```

Abre <http://127.0.0.1:5173>. Requiere Node.js 20 o superior
(`winget install OpenJS.NodeJS.LTS`).

## Qué hace

- **Efemérides reales** del Sol y la Tierra desde cualquier punto entre 80° S y
  90° S, de 2026 a 2030, en ventanas de 1 a 180 días con paso horario. Validadas
  contra NASA/JPL Horizons (error máximo 0,0023°). Sin conexión a servicios
  externos.
- **Cinco sitios precargados** más coordenadas personalizadas y
  micro-relocalización de ±500 m, arrastrando el lander en la vista 3D.
- **Horizonte de 360°** por sitio, fracción visible del disco solar y línea de
  vista DTE con margen de antena.
- **Presupuesto de energía** (tres monturas de panel, batería, alerta de
  profundidad de descarga y de congelamiento) y **presupuesto de enlace** en
  banda X o S con tres estaciones terrenas.
- **Satélites de retransmisión**: constelaciones de 1 a 8 relays en órbita lunar
  (elíptica congelada, polar baja o personalizada) y cuánto cierran los cortes
  del enlace directo en cada sitio.
- **Contingencia y supervivencia**: actitud de alunizaje con presets IM-1, IM-2 y
  SLIM; enlace con difracción, multipath y relevo de estaciones DSN; modelo
  térmico acoplado con calefactores y congelación de batería; índice
  multicriterio; malla de dispersión con vector de escape; activo vecino con
  sombra mutua y eyección por pluma.
- **Exportar CSV** con un clic: telemetría simulada en 26 columnas SI, una fila
  por hora.
- **Tres modos**: Planner (un escenario de alunizaje, con comparación A/B a
  demanda dentro de Ventanas de aterrizaje), Explorer (recorrido guiado para
  educadores y público) y **Emergencia** (posición y energía disponible,
  evaluado desde ahora: cuánto tiempo queda y hacia dónde moverse).
- **Veredicto GO / CAUTION / NO-GO** en lenguaje llano sobre la vista 3D, con
  rescate de un clic (mejor punto a 200 m o siguiente fecha viable) y su antes
  y después.
- **Consola por subsistemas**: cinco pestañas a todo el ancho (Resumen,
  Energía/térmico, Comunicaciones/RF, Terreno/alunizaje y Ciencia) con una
  transición negro → ícono → consola. Cada una trae sus paneles, su color, su
  capa sobre el terreno y lo que destaca la escena 3D. Los paneles son bandejas
  de cristal que flotan sobre la vista sin redimensionarla. Ciencia incluye la
  Vista de ingeniería (tabla KPI completa y línea de tiempo detallada).
- **Control de tiempo en la vista 3D** (−1 h, reproducir, +1 h; 1, 24 o 72 h/s)
  y doble clic en el terreno para mover el lander o crear un sitio, con un
  retículo que dice qué ocurrirá.
- **Modo tutorial** («Guía de misión»): una secuencia de diez pasos que conduce
  la interfaz y al terminar devuelve el estado previo. **Guía (PDF)** completa
  en español e inglés.
- **Terreno de 20 m en cualquier punto entre 80° S y 90° S**: se lee bajo
  demanda del mosaico LOLA con peticiones HTTP Range y queda guardado en
  IndexedDB. Requiere el proxy incluido en `npm run dev` / `npm run preview`
  (el servidor de NASA no permite CORS) o un espejo en `VITE_LOLA_COG_URL`.
- Interfaz en inglés y español.

**Terreno:** modelo de elevación real de LRO/LOLA (Barker et al. 2023,
doi:10.3847/PSJ/acf3e1), a 20 m/px bajo los cinco sitios. Los puntos de
aterrizaje se eligieron sobre ese relieve y difieren de las coordenadas del
enunciado; el porqué está en la sección 4.2 de [ARCHITECTURE.md](ARCHITECTURE.md).

## Comandos

| Comando | Para qué |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run build` | verificación de tipos y build de producción en `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 128 tests del motor, la verificación, la exportación y la interfaz (vitest) |
| `npm run guide` | regenera `public/guide/guia-interfaz-es.pdf` y `-en.pdf` desde `docs/guia-interfaz*.md` |
| `npm run e2e` | verificación en navegador con Playwright (requiere `npm run build`) |
| `npm run perf` | medición de cuadros por segundo |
| `npm run build-dem` | regenera las mallas LOLA de `public/dem/` (requiere `pip install rasterio numpy`) |
| `python scripts/fetch_science_layers.py` | regenera las capas orbitales de `public/science/` (PSR, Diviner, FeO, gravedad) |
| `npx tsx scripts/verify_cog_stream.ts` | lee un parche de 20 m del servidor de NASA y lo compara con la malla precompilada |
| `npx tsx scripts/probe_windows.ts` | ventanas de alunizaje, difracción y vuelco de los cinco sitios |
| `npm run optimise-sites` | busca el mejor punto de aterrizaje de cada región sobre LOLA |
| `npm run calibrate` | informe de KPIs del modelo sintético de pruebas |
| `npm run compare-horizons -- <json>` | compara el motor con un caché de JPL Horizons |

La primera vez que uses `npm run e2e` en otra máquina: `npx playwright install chromium`.

### Caché de JPL Horizons (opcional)

```bash
python scripts/fetch_jpl_horizons.py --site malapert-massif --start 2028-03-01 --days 30
```

Solo usa la biblioteca estándar de Python. La aplicación no depende de este
script.

## Reutilización en la Estación Terrena

`src/engine/missionPhysics.ts` no depende del resto del proyecto:

```ts
import { DEFAULT_RF, linkBudget, simulateBattery, solarPowerW } from './engine/missionPhysics';

const enlace = linkBudget({ ...DEFAULT_RF, groundStationId: 'gisat37', band: 'S' }, 384_400);
console.log(enlace.cn0DbHz, enlace.dataRateBps, enlace.marginDb);
```

Para añadir una estación, agrega una entrada a `GROUND_STATIONS`.

## Documentación

[ARCHITECTURE.md](ARCHITECTURE.md): modelo físico, decisiones, calibración del
terreno, resultados de verificación y límites conocidos. La sección 6.6 resume
la interfaz v2.0.

[Guía de la interfaz](docs/guia-interfaz.md) ([English](docs/guia-interfaz.en.md)):
cada botón y panel, y los usos para ingeniería, público y emergencia.
