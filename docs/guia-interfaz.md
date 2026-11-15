# Guía de la interfaz — CLPS Lunar Mission Browser v2.1

GISAT UdeC · NASA Space Apps 2026 · Navegador de sitios de alunizaje del Polo Sur lunar

Esta guía describe cada botón y cada panel de la versión 2.1, interfaz por interfaz, y cómo usar la aplicación según quién la usa: un ingeniero que planifica, el público general o un docente (modo tutorial y fichas de sitios) y un equipo ante un alunizaje no previsto (modo Emergencia).

> Las cifras salen de un modelo físico propio sobre el relieve LRO LOLA. Sirven para comparar sitios, fechas y diseños de lander; no son la predicción certificada de una misión real. Los umbrales marcados como «supuesto de ingeniería» son elecciones de esta herramienta.

## 1. Barra superior

De izquierda a derecha:

| Control | Qué hace |
|---|---|
| Marca | Nombre de la aplicación y del equipo. |
| Planificador / Emergencia | Cambia el modo de la aplicación (sección 2 y 10). |
| Cambiar de versión | Vuelve a la pregunta de entrada: Principiante (entrenamiento guiado de 8 misiones) o Mission Leader (esta consola). |
| Reloj UTC y T+ | Fecha y hora del cursor de tiempo, y el tiempo transcurrido desde el alunizaje. |
| Guía de misión | Activa el modo tutorial (sección 8). Antes de empezar muestra un aviso con Iniciar / Cancelar. |
| Exportar CSV | Descarga con un clic la telemetría simulada de la misión en pantalla: 26 columnas en unidades SI, una fila por hora. |
| EN / ES | Idioma de toda la interfaz. |
| Guía (PDF) | Abre esta guía en una pestaña nueva, en el idioma activo. |

![](img/es/01-barra-superior.png)

![](img/es/10-exportar.png)

## 2. Planificador: la consola

El planificador es la vista de trabajo. Arriba está el veredicto; debajo, la vista 3D ocupa toda la pantalla y los paneles flotan sobre ella como bandejas de cristal que no la redimensionan. La cámara se recentra en el área libre para que el lander nunca quede tapado.

![](img/es/03-resumen.png)

### 2.1 Veredicto

Una línea en lenguaje claro: **VIABLE**, **RIESGO MODERADO** o **CRÍTICO**, con la causa principal y el día en que ocurre. Si no está en verde, el botón **Optimizar sitio y fecha** prueba los 25 puntos de contacto a 200 m y luego las fechas siguientes (en 30, 60 o 90 días; 60 por defecto), y mueve el lander al primero que sobrevive. Muestra el antes y el después, cuántas misiones evaluó y el tiempo que tardó. Si nada salva la misión, lo dice.

### 2.2 Pestañas de subsistema

Cinco pestañas ocupan todo el ancho. Cada una trae sus paneles, su color y lo que destaca la escena 3D. Al cambiar de pestaña la interfaz pasa a negro, aparece el ícono del subsistema y vuelve la consola con su capa ya aplicada (alrededor de un segundo; con la opción del sistema «reducir movimiento» nada se mueve: solo fundidos).

| Pestaña | Color | Izquierda | Derecha | Abajo | Escena 3D |
|---|---|---|---|---|---|
| Resumen | esmeralda | Sitios y fechas | Signos vitales, Ventanas de aterrizaje | Ventanas de misión | Sombras |
| Energía / térmico | ámbar | Equipo: energía y térmico | Energía y supervivencia | Potencia y temperatura, Ventanas de misión | Horas de sol, haz solar |
| Comunicaciones / RF | cian | Equipo: radio y relays | Presupuesto de enlace | Horizonte 360°, Ventanas de misión | Vista de la Tierra, haz a la Tierra destacado |
| Terreno / alunizaje | gris claro | Actitud y vuelco | Emergencia: supervivencia | Horizonte 360°, Ventanas de misión | Pendientes, flecha de escape |
| Ciencia | violeta | Sitios y fechas | Índice de aptitud, Vista de ingeniería | Línea de tiempo detallada | Sombras |

Cada bandeja tiene un **(?)** con una explicación de una frase y un botón **—** para minimizarla; la pestaña que queda en el borde la vuelve a abrir.

### 2.3 Vista 3D

* **Arrastrar** orbita la cámara; la **rueda** acerca y aleja.
* **Arrastrar el lander** lo mueve dentro del cuadro punteado de ±500 m. Cada posición es una misión nueva.
* **Doble clic en el terreno**: a ±500 m mueve el lander; más lejos crea un sitio propio. Al pasar el cursor, un retículo dice qué ocurrirá: «Mover el lander (X m)» o «Crear sitio propio aquí». Al norte de 80° S el retículo se pone rojo y el doble clic muestra «Fuera del área». La pista de abajo recuerda esto y se oculta con la **×** (queda recordado).
* **Órbita / Vista lander**: cámara exterior o desde el mástil del lander.
* **Sombras / Horas de sol / Vista Tierra / Pendiente**: capa de color sobre el terreno, con su escala.
* **Leyenda**: explica cada símbolo de la escena.
* Arriba a la izquierda: nombre completo del sitio, coordenadas, altura, pendiente y el desplazamiento del lander (ΔE, ΔN), con **Volver al punto nominal** cuando se movió.
* Los nombres de los accidentes del relieve flotan sobre el horizonte con su distancia.

![](img/es/02-vista-3d.png)

### 2.4 Control de tiempo (en la vista 3D)

Abajo al centro: **−1 h**, **Reproducir / Pausa**, **+1 h** y la velocidad: **1**, **24** o **72 h/s** (24 por defecto). Para saltar más lejos, arrastra sobre la línea de tiempo.

### 2.5 Telemetría

El chip **Telemetría** (abierta / cerrada, se recuerda entre visitas) muestra lo que reportaría el lander a la hora del reloj, en cuatro grupos:

* **Sol**: Sol visible (% del disco) y altura del Sol.
* **Energía**: potencia de los paneles y batería.
* **Térmico**: temperatura de la electrónica y calefactores.
* **Enlace con la Tierra**: Tierra sobre el relieve, estación terrena, margen de enlace (cuánto sobra de señal respecto al mínimo) y tasa de datos.

Verde, ámbar y rojo siguen umbrales definidos en un solo lugar: batería bajo 40 % y 20 %, electrónica bajo 0 °C y −20 °C, margen bajo 3 dB y 0 dB. Al pasar el cursor por una lectura aparece su explicación. En Ciencia se añaden las lecturas técnicas: acimut solar, despeje de línea de vista, pérdida extra y ángulos de la Tierra.

## 3. Paneles de Resumen

### 3.1 Sitios y fechas

Un solo escenario de alunizaje: **sitio** (cinco candidatos, dos alunizajes reales o coordenadas propias), **inicio de ventana** (UTC), **duración** (1–180 días) y el **desplazamiento** al este y al norte. Muestra la descripción del sitio, sus coordenadas, la distancia a la coordenada del enunciado y la fuente del terreno (LRO LOLA y su resolución). Los nombres de los sitios se muestran siempre completos.

### 3.2 Signos vitales

Tres tarjetas grandes contadas desde la hora del reloj: **luz continua** restante, **ventana DTE** abierta o cerrada (y cuándo cambia) y **tiempo hasta congelamiento**.

### 3.3 Ventanas de aterrizaje

Busca en 30, 60, 90 o 180 días qué fechas de contacto sirven para una misión de N días y un rumbo de aproximación. Una fecha se acepta si el lander toca la superficie con sol, la descarga cierra, sobrevive la misión y el Sol no queda de frente ni justo detrás de las cámaras de descenso. La franja de colores muestra cada fecha; la lista da las ventanas con **Alunizar ahí**; la tabla dice por qué se rechazan las demás. El cono de deslumbramiento (±25°), el cono sin sombras (±15°) y la elipse con al menos 50 % de sol son umbrales supuestos de ingeniería, fijos.

### 3.4 Comparar (dentro de Ventanas de aterrizaje)

El interruptor **Comparar con otro sitio o fecha** crea el escenario B como copia del actual. Aparecen:

* **En la vista 3D: A / B**, para elegir cuál se ve.
* Los controles del **escenario B** (sitio, fecha, ventana, desplazamiento) y el atajo **Usar la misma ventana que A**.
* El **comparador rápido**: cuatro barras por escenario (energía solar, contacto con la Tierra, supervivencia nocturna y seguridad de aterrizaje = 1 − P(vuelco)), con la pendiente aparte.
* La **tabla KPI** completa, con la marca del mejor valor de cada fila.

Al apagarlo, B desaparece de la vista 3D, de la línea de tiempo y de todas las tablas.

![](img/es/09-ventanas-comparar.png)

### 3.5 Ventanas de misión (línea de tiempo)

Cada fila es la ventana completa: día/noche, Tierra visible y ambos a la vez (las «ventanas de oro»). Arrastrar sobre ella mueve el cursor de tiempo.

## 4. Energía / térmico

* **Equipo**: altura de paneles y antena (2 m o mástil de 10 m), montura de paneles, área, eficiencia, consumo operativo y de supervivencia, batería y límite de descarga. **Control térmico**: acoplar la batería a la temperatura del bus, potencia de calefactores, área radiante, emisividad, masa térmica y sumidero en sombra. **Supuestos avanzados** (plegado): calefactores a 0 °C, pérdida de capacidad bajo −10 °C, congelamiento a −20 °C; supuesto de ingeniería.
* **Energía y supervivencia**: si sobrevive la ventana, temperatura mínima, horas y energía de calefactores, energía solar y pico, carga mínima, factor de vista al cielo y terreno circundante con sol. Avisa la muerte térmica crítica.
* **Potencia y temperatura**: potencia del panel (relleno ámbar), carga de batería y temperatura del bus en el tiempo.

![](img/es/04-energia.png)

## 5. Comunicaciones / RF

* **Equipo**: enlace DTE (banda X o S, margen de antena, estación, potencia, antena del lander, ancho de banda, margen de enlace) y **satélites relay**: preset de órbita, número de satélites y tasa lander-relay.
* **Presupuesto de enlace**: ganancia, ancho de haz, PIRE, pérdida de espacio libre, G/T, C/N₀, tasa alcanzable, Eb/N₀ y margen. **Crestas entre el lander y la Tierra**: difracción sobre hasta tres crestas (Deygout). **¿Qué estación cierra el enlace?**: ingresa la tasa objetivo o usa los chips 10 / 100 / 1000 kbps; da el G/T y la antena equivalente que hacen falta.
* **Horizonte 360°**: el perfil del horizonte con las trayectorias del Sol y de la Tierra.

![](img/es/05-comunicaciones.png)

## 6. Terreno / alunizaje

* **Actitud y vuelco**: presets (nominal, IM-1, IM-2, SLIM, apoyado en la pendiente), alabeo, cabeceo, guiñada, ancho de haz y cardán de la antena, y sus penalizaciones. Probabilidad de vuelco sobre la elipse según la velocidad de contacto. **Reproducir un alunizaje real**: siempre advierte que el modelo no reproduce la pérdida de IM-2 Athena (quedó en un cráter pequeño en sombra que el terreno de 20 m no contiene). **Activo vecino**: radio de exclusión del penacho y sombreado mutuo.
* **Emergencia: supervivencia**: el mismo flujo que el modo Emergencia (sección 10). Sin fecha: **Evaluar desde ahora** (o cualquier dato ingresado) fija el inicio en la hora actual durante una noche lunar (15 días; también 3 o 7).

![](img/es/06-terreno.png)

## 7. Ciencia

* **Índice de aptitud** de 0 a 100, sintetizado: luz, vista a la Tierra, pendiente y FeO, con el peso, la fuente y el rango de cada criterio (al pasar el cursor). Cada rango se ancla a un límite físico; la rugosidad, la proximidad a sombra permanente y la gravedad quedan fuera porque no tienen uno. Datos orbitales del sitio (temperaturas Diviner, hielo estable, PSR).
* **Vista de ingeniería**: la tabla completa de KPI y la **incertidumbre del terreno** (error de altura RMS, longitud de correlación, N variantes de terreno, probabilidad de sobrevivir y bandas P10/P50/P90) y la tabla **Supuestos del modelo**: cada parámetro, su valor, su unidad, su origen («fuente: …» o «supuesto del equipo») y dónde se usa. En esta consola la línea de tiempo es la **detallada**: Sol, batería, Tierra visible, descarga por estación, relay y operación simultánea.

![](img/es/07-ciencia.png)

![](img/es/08-vista-ingenieria.png)

## 8. Modo tutorial (Guía de misión)

Un aviso explica que la aplicación cambiará de pestañas, sitio y fecha por sí sola. Con **Iniciar**, una secuencia fija de 10 pasos conduce la interfaz: vista 3D, doble clic, control de tiempo, las cinco pestañas, ventanas de aterrizaje y comparación, modo Emergencia y Exportar. Cada paso resalta el control del que habla. **Flecha derecha** avanza, **flecha izquierda** retrocede y **Esc** sale. Al salir o terminar, la aplicación vuelve exactamente a donde estabas. En la primera visita, una tarjeta abajo a la derecha ofrece el mismo recorrido u omitirlo.

![](img/es/13-tutorial.png)

## 9. Fichas de sitios candidatos (público y docentes)

En Resumen > Sitios y fechas, debajo del escenario, una ficha por cada uno de los cinco sitios candidatos con tres medidores: luz solar y contacto con la Tierra (0–100 % de la ventana) y noche más larga (barra llena = lo que la batería resiste en hibernación). Un clic selecciona el sitio. El modo Explorador de la versión 2.0 se retiró: su recorrido lo cubre el modo tutorial y sus tarjetas de estado, los signos vitales.

## 10. Modo Emergencia

Para un lander que ya está en la superficie en un lugar no previsto. Pregunta solo lo esencial y evalúa desde **ahora** durante los próximos 15 días (una noche lunar; también 3 o 7):

1. **Posición actual**: clic en el mapa polar o coordenadas pegadas (por ejemplo −84,79; 29,20). Se acepta cualquier punto al sur de 80° S.
2. **Energía disponible**: Wh restantes en la batería y carga mínima de supervivencia.
3. **Inclinación actual** (opcional, plegada): alabeo, cabeceo o «Quedamos apoyados en la pendiente».

Responde primero con un titular en lenguaje llano: **SOBREVIVE**, **SOBREVIVE SI…** o **NO SOBREVIVE**, con fecha y hora (UTC y T+). Justo debajo, el bloque **Salida** dice si hay salida y da las opciones calculadas con el motor: quedarse y reducir la carga, moverse hasta 500 m y esperar la próxima luz; si ninguna alcanza, dice qué faltaría. El criterio de pérdida es el del motor: batería agotada sin sol o, con el modelo térmico, bus bajo −20 °C. Después vienen la fuente y resolución del terreno, el tiempo hasta congelarse y **hacia dónde moverse**: la malla de 25 puntos a 200 m (cada celda es una misión completa), el vector de escape y **Mover el lander ahí**. La flecha verde sobre el terreno es el mismo vector. Los peligros bajo el píxel de 20 m (LOLA + micro-relieve fractal: micro-sombras y rocas) se muestran siempre; son estadísticos, no un mapa.

![](img/es/12-salida.png)

![](img/es/11-modo-emergencia.png)

## 11. Usos según el usuario

**Ingeniero de misión.** Fija sitio y fecha en Resumen, dimensiona energía y térmica en Energía, comprueba el enlace en Comunicaciones, revisa actitud, vuelco y escape en Terreno y valida todo en Ciencia > Vista de ingeniería. Usa Ventanas de aterrizaje para elegir la fecha y Comparar para decidir entre dos sitios o dos fechas. Exporta el CSV para las herramientas de la estación terrena.

**Público y docentes.** El modo tutorial y las fichas de sitios cuentan la física del polo sur sin jerga: el Sol rasante, las sombras largas, la Tierra que se esconde tras las montañas y por qué unos cientos de metros cambian el destino de un lander.

**Equipo ante una emergencia.** El modo Emergencia (o Terreno > Emergencia: supervivencia) responde en orden: dónde estamos, cuánto tiempo queda y hacia dónde movernos, desde ahora.

## 12. Fuentes y límites

* Terreno: LRO LOLA (Barker et al., 2023), 20 m/px cerca de los sitios; el resto del casquete a menor resolución.
* Efemérides: astronomy-engine. Estaciones: DSN (Goldstone, Madrid, Canberra).
* No se modelan la trayectoria de descenso, el combustible ni los errores de navegación. El vehículo por defecto es ilustrativo.
* La fórmula de Deygout y los parámetros del micro-relieve se escribieron sin contrastar con la norma o la literatura citada.
