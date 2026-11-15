# Cambios

## v3.1 (2026-11-15)

Detalle en la sección 6.9 de ARCHITECTURE.md.

- Misión 0 sin sombreado sobre la vista 3D; bloqueo estricto de acciones
  (puntero y teclado) en el resto.
- El flujo de emergencia sale de Terreno / alunizaje (también en Mission
  Leader): esa bandeja pasa a «Dispersión y escape» (malla 5 × 5, vector de
  escape, incertidumbre LOLA). En el Principiante, Emergencia aparece recién
  en la misión 7.
- Insignias por subsistema en lugar de estrellas y XP, con una fila de ocho
  insignias en la barra superior.
- Desplazamiento automático al objetivo y rueda redirigida al panel.
- Ventanas de cristal esmerilado; animaciones de actitud, seguidor solar,
  antena, salto de reubicación con polvo, pulsos solares y ondas de radio.
- Guion expandido: rumbo de aproximación y deslumbramiento, Vista lander,
  dispersión e incertidumbre LOLA, línea de tiempo, montura y batería,
  difracción, banda, estaciones, telemetría, activo vecino y pluma, Optimizar,
  supuestos y exportación, apoyo en la pendiente y peligros bajo el píxel.

## v3.0 (2026-11-14)

Dos experiencias en una app, detrás de una puerta de entrada. Detalle en la
sección 6.8 de [ARCHITECTURE.md](ARCHITECTURE.md) y el guion real en
[docs/guion-principiante.md](docs/guion-principiante.md).

### Añadido
- **Puerta de entrada** en cada carga: «¿Has usado esta app alguna vez?», con
  sus cuatro caminos y la advertencia del atajo Pro. `?mode=leader` y
  `?mode=beginner` la saltan. Enlace «Cambiar de versión» en la barra.
- **Principiante**: entrenamiento guiado de 8 misiones (primer alunizaje,
  sitio y fecha, terreno, energía y frío, comunicaciones, contingencia,
  ciencia, emergencia) que desbloquea las consolas una a una y termina con el
  diploma y el acceso a la consola Pro. Foco con oscurecido, acciones reales
  detectadas por el estado, pista a 15 s, «Hazlo por mí» a 45 s, repetir paso,
  salir al Pro con confirmación, sellos de progreso.
- Sonido procedural WebAudio (10 efectos) con silencio, volumen y subtítulos.
- Escenarios hallados con el motor (`npm run find-scenarios`) y revalidados en
  pruebas; sin red.
- «Adoptar este sitio» en Comparar.
- e2e del Principiante (`npm run e2e:beginner`).

- Rediseño del Principiante tras la primera revisión: cinemática inicial
  (Luna, polo sur, descenso y alunizaje), canal CAPCOM grande con el ritmo a
  cargo del usuario, portada e insignia de cada misión, celebraciones con
  estrellas y puntos, diploma con las 8 insignias, módulo 3D que despliega
  paneles y sube el mástil, 17 efectos de sonido y música ambiental
  desactivable, pestañas en orden de desbloqueo.

### Cambiado
- Mission Leader = la v2.1. Ya no abre la tarjeta de bienvenida (la sustituye
  la puerta); el tutorial de 10 pasos sigue en «Guía de misión».
- El botón del bloque Salida se rotula «Ejecutar esta salida».
- Emergencia reancla también una ventana que no es de 3 / 7 / 15 d.

## v2.1 (2026-11-14)

Regla de la versión: toda cifra o umbral visible tiene una razón escrita
(fuente, requisito o «supuesto del equipo»); lo que no la tiene, se borra.
Detalle y decisiones en la sección 6.7 de [ARCHITECTURE.md](ARCHITECTURE.md).

### Añadido
- Titular de emergencia en lenguaje llano con tres estados (**SOBREVIVE**,
  **SOBREVIVE SI…**, **NO SOBREVIVE**) y bloque **Salida** siempre visible:
  opciones recalculadas con el motor (bajar la carga mínima, moverse ≤ 500 m,
  esperar la próxima luz) y, si ninguna alcanza, qué faltaría.
- Horizonte de emergencia de una noche lunar (15 d) con selector 3 / 7 / 15 d.
- Sitios Artemis III/IV y otras misiones notables en el selector, agrupados,
  con fuente y «coordenada aproximada»; Chandrayaan-3 como referencia fuera de
  cobertura. Puntos por grupo en el mapa polar y el horizonte 3D, nombre al
  pasar el cursor.
- Fichas de los sitios candidatos en Resumen > Sitios y fechas.
- Tabla **Supuestos del modelo** (solo lectura) en Ciencia > Vista de
  ingeniería.
- Selector 30 / 60 / 90 d para «Optimizar sitio y fecha».
- Insignia oficial GISAT UDEC en la barra, el arranque, el favicon y la portada
  de la guía.
- Guía PDF con capturas reales de la app (`scripts/guide-shots.ts`), ES y EN.
- `npm run measure-micro`, `npm run guide-shots` y `npm run lint`.

### Cambiado
- Transición de subsistema de ~1 s con el ícono fijo 400 ms, igual con
  movimiento reducido (solo fundidos).
- Peligros bajo el píxel de 20 m siempre visibles (costo medido < 100 ms).
- Índice de aptitud: solo criterios con rango anclado (vista a la Tierra, luz,
  pendiente hasta el ángulo de estabilidad del vehículo, FeO), con el rango en
  un tooltip.
- El rótulo del veredicto se explica en el modo Emergencia; sin «NO-GO» ni
  «lost at» en el flujo de emergencia.
- Vehículo por defecto rotulado «ejemplo ilustrativo».

### Eliminado
- Modo Explorador (su recorrido lo cubre el tutorial; sus tarjetas de estado,
  los signos vitales). Un modo `explorer` heredado cae a `planner`.
- Casilla «Terreno sub-píxel».
- Rugosidad, distancia a PSR y gravedad del índice de aptitud (sin rango
  anclable).
- `src/lib/verification.ts` y su prueba (código muerto).

## v2.0 (2026-11-14)

Interfaz por subsistemas, modo tutorial, un solo escenario con Comparar a
demanda, flujo de emergencia compartido y guía PDF. Ver la sección 6.6 de
ARCHITECTURE.md.
