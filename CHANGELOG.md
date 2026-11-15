# Cambios

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
