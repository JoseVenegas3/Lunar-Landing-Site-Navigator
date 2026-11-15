# Arquitectura y decisiones de ingeniería

CLPS Lunar Mission Browser (Lunar Landing Site Navigator) · GISAT UdeC · NASA Space Apps Challenge 2026

Este documento explica qué se construyó, por qué se tomó cada decisión y qué
límites tiene el modelo. Se escribió durante una sesión de trabajo autónoma, sin
consultas al equipo, así que las decisiones tomadas ante ambigüedades están
marcadas como **Decisión**.

## 1. Lo primero que hay que saber

1. **El terreno es el modelo real de LRO/LOLA.** La app usa las mallas de
   elevación ajustadas del polo sur de Barker et al. (2023): 20 m/px bajo los
   cinco sitios, 160 m/px para coordenadas personalizadas y 240 m/px para el
   horizonte lejano. Detalle en la sección 4.
2. **Las coordenadas de los sitios cambiaron respecto del enunciado.** Sobre el
   relieve medido, las coordenadas del enunciado no caen en el accidente que su
   nombre describe (la de la cresta de Shackleton da 23 % de iluminación anual;
   la de Haworth es el piso en sombra del cráter). Cada sitio usa ahora un punto
   de aterrizaje elegido sobre LOLA con un criterio explícito; la coordenada
   original se conserva y se muestra en la interfaz (sección 4.2).
3. **Las efemérides son reales.** Coinciden con NASA/JPL Horizons con un error
   máximo de 0,0023° (8″) en azimut y elevación (sección 3.2).
4. **El enunciado recibido estaba truncado** a mitad de la Fase 3 (terminaba en
   «Ventanas Críticas de Operación Simultánea (»). El Modo 2 y cualquier fase
   posterior se infirieron (sección 7).
5. **El modelo sintético original sigue en el código** como respaldo sin
   conexión y como terreno determinista para los tests del motor. Si la app no
   encuentra los archivos de `public/dem/`, lo usa y lo avisa en la interfaz.

## 2. Mapa del código

```
src/engine/            Motor en TypeScript puro, sin dependencias de UI
  constants.ts           constantes físicas
  ephemeris.ts           Sol y Tierra en el marco selenográfico; az/el topocéntrico
  terrain.ts             proyección polar, mallas, modelo sintético de respaldo
  lolaData.ts            decodificación de las mallas LOLA de public/dem/
  horizonEngine.ts       perfil de horizonte 360°, disco solar visible, LOS DTE
  shadowSweep.ts         propagación de sombras O(N) sobre la malla local
  missionPhysics.ts      presupuesto de energía y de enlace RF (reutilizable)
  relay.ts               órbitas de satélites de retransmisión y su visibilidad
  attitude.ts            actitud 6-DOF: paneles y antena en el marco del cuerpo
  rfPropagation.ts       difracción, multipath en regolito, estaciones terrenas
  thermal.ts             batería y temperatura del bus acopladas
  siteScore.ts           índice multicriterio y malla de dispersión
  scienceLayers.ts       capas orbitales: PSR, Diviner, FeO, gravedad
  coexistence.ts         sombra mutua y eyección por pluma
  missionAnalysis.ts     evaluación de misión sobre el modelo de base
  analysis.ts            series horarias, ventanas y KPIs de un escenario
  sites.ts               sitios candidatos
  __tests__/             tests del motor (vitest; total en la sección 9)
src/state/             zustand (configuración), servicio de DEM, contexto de misión
src/components/3d/     escena three.js / React Three Fiber
src/components/dashboard/   modo Mission Planner
src/components/triage/      modo Emergencia
scripts/               mallas LOLA (Python), búsqueda de sitios, JPL Horizons, comparación
public/dem/            mallas LOLA que carga la app (15 MB)
public/science/        capas orbitales para el índice (0,6 MB)
e2e/                   verificación Playwright y sonda de rendimiento
data/horizons/         cachés de referencia de JPL Horizons
artifacts/             capturas y reporte de verificación
```

`src/engine/missionPhysics.ts` no importa nada del terreno ni de las
efemérides: recibe números (elevación solar, fracción de disco, distancia) y
devuelve magnitudes de ingeniería. Es el módulo pensado para reutilizarse en la
GUI de la Estación Terrena de GISAT.

## 3. Motor astrofísico

### 3.1 Cadena de cálculo

Para cada instante:

1. `astronomy-engine` entrega los vectores geocéntricos J2000 de la Luna y del
   Sol (VSOP87 y una serie lunar truncada), sin red y sin CORS.
2. Se construye la base fija al cuerpo lunar con el polo IAU (α₀, δ₀) y el
   ángulo del meridiano origen W que entrega `RotationAxis(Moon)`.
3. Los vectores Sol−Luna y Tierra−Luna se rotan a ese marco. **Son
   independientes del sitio**, así que una sola serie sirve para todos los
   sitios y para cada micro-relocalización.
4. Por sitio se resta la posición del observador (la paralaje de la Tierra es
   ~0,26°) y se proyecta sobre la tríada local Este/Norte/Arriba.

La libración no se modela aparte: aparece sola porque el vector de la Tierra se
expresa en el marco que rota con la Luna. El bucle mensual se ve en el panorama
de horizonte.

**Decisión.** Guardar la serie en el marco selenográfico y no en az/el. Mover
el lander 500 m solo exige proyectar de nuevo (trigonometría), no recalcular
efemérides. Eso es lo que hace interactiva la relocalización.

### 3.2 Validación contra JPL Horizons

`scripts/fetch_jpl_horizons.py` consulta la API oficial (tabla de observador
desde un punto de la superficie lunar, az/el aparente sin atmósfera).
`npm run compare-horizons -- <archivo>` compara con el motor.

| Caso | Cuerpo | Az máx | El máx |
|---|---|---|---|
| Shackleton Ridge, 2027-09, 721 muestras | Sol | 0,0013° | 0,0020° |
| | Tierra | 0,0011° | 0,0022° |
| Malapert Massif, 2028-03, 721 muestras | Sol | 0,0013° | 0,0022° |
| | Tierra | 0,0022° | 0,0023° |

Los cachés están en `data/horizons/` y `horizons.test.ts` los usa como
regresión sin conexión (tolerancia 0,01°).

Otras comprobaciones independientes en `physics.test.ts`: el punto sub-terrestre
coincide con la serie de libración clásica de `Astronomy.Libration()` (<0,25°),
la caja de libración queda dentro de ±6,9° × ±8,2°, la latitud sub-solar dentro
de ±1,62° en 2026–2030, y el Sol da 720° de azimut en dos meses sinódicos.

## 4. Terreno

### 4.1 Datos

Fuente: «A New View of the Lunar South Pole from LOLA», producto 90 del PGDA de
NASA GSFC. Cita obligatoria: Barker et al. 2023, *Planet. Sci. J.* 4, 183,
doi:10.3847/PSJ/acf3e1 (datos: doi:10.60903/gsfcpgda-lola-spole). Marco MOON_ME
(DE421), alturas sobre la esfera de 1737,4 km.

`scripts/build_lola_dem.py` genera lo que la app necesita. Los archivos de
origen son GeoTIFF optimizados para la nube, así que el script lee solo las
ventanas y los niveles de resumen necesarios con peticiones HTTP por rango: no
hay que descargar los archivos completos (2,6 GB el de 20 m/px).

| Malla | Muestras | Paso | Cobertura | Origen | Uso |
|---|---|---|---|---|---|
| `regional.i16` | 1001² | 800 m | ±400 km del polo | mosaico de 240 m/px, promediado 3×3 | horizonte lejano |
| `cap.i16` | 2001² | 160 m | ±160 km del polo | mosaico de 20 m/px, resumen 8× | coordenadas personalizadas |
| `site-<id>.f32` | 513² | 32 m | ±8,2 km del sitio | mosaico de 20 m/px | los cinco sitios |

Marco de mapa de la app: proyección acimutal equidistante centrada en el polo
sur (r = R·colatitud; longitud 0 hacia +y, 90° E hacia +x). LOLA viene en
estereográfica polar (r = 2R·tan(colatitud/2)). Comparten el acimut, así que la
conversión es solo radial.

La app (`src/state/dem.ts`) carga `manifest.json` y la malla regional al
arrancar; la malla de cada sitio al seleccionarlo; y el casquete de 160 m solo si
se usan coordenadas personalizadas. La interfaz muestra la resolución del terreno
bajo cada escenario.

**Decisión.** Mallas propias en binario crudo en vez de leer GeoTIFF en el
navegador: 15 MB en total, sin bibliotecas geoespaciales en el cliente, y el
motor recibe exactamente el mismo tipo `Grid` que antes.

Para regenerar todo: `pip install rasterio numpy` y `npm run build-dem`
(o `python scripts/build_lola_dem.py --sites-only` tras editar `sites.ts`).

### 4.2 Puntos de aterrizaje

Las coordenadas del enunciado nombran regiones. Para cada una,
`scripts/optimise_sites.ts` recorre el relieve LOLA de 20 m/px en un radio de
4 km (paso de 160 m), descarta los puntos con pendiente mayor de 10° y elige el
que maximiza iluminación anual + cobertura DTE anual (año 2027, paso de 2 h,
sensor a 2 m del suelo, margen de antena de 2°). El resultado completo está en
`data/site_optimisation.json`.

| Sitio | Enunciado | Ahí, sobre LOLA | Punto elegido | En el punto elegido |
|---|---|---|---|---|
| Shackleton Connecting Ridge | 89,54° S, 129,78° O | 23 % luz, 41 % DTE, pendiente 13,6° | 89,4401° S, 137,3618° O (a 3,6 km) | +1958 m, 84 % luz, 43 % DTE |
| Malapert Massif | 86,04° S, 2,70° E | 21 % luz, 35 % DTE | 85,9759° S, 1,5730° E (a 3,1 km) | +5094 m, 58 % luz, 77 % DTE |
| Haworth Crater Rim | 87,45° S, 5,12° O | centro del cráter: piso a −3,3 km, en sombra | 86,7573° S, 20,4744° O (borde noroeste) | +1904 m, 51 % luz, 55 % DTE |
| Nobile Crater Rim (VIPER) | 85,20° S, 31,30° E | 46 % luz, 70 % DTE, pendiente 11,8° | 85,2682° S, 32,0028° E (a 2,7 km) | +6294 m, 51 % luz, 73 % DTE |
| De Gerlache Rim 2 | 88,71° S, 68,70° O | 55 % luz, 16 % DTE | 88,7047° S, 68,4666° O (a 0,2 km) | +1780 m, 78 % luz, 45 % DTE |

Porcentajes anuales. Notas:

- **Haworth** necesitó un paso previo, porque el borde está a ~30 km de la
  coordenada dada: `scripts/search_crater_rim.ts` recorrió un anillo de 18 a
  36 km alrededor del centro IAU sobre el casquete de 160 m. La mejor zona es el
  borde noroeste (~86,8° S, 21° O); la búsqueda fina se hizo ahí.
- **Nobile** queda en la meseta de Mons Mouton, al oeste del cráter, que es
  donde cae la coordenada del enunciado.
- El punto de la cresta de Shackleton coincide, hasta donde recuerdo, con la
  zona de máxima iluminación publicada para esa cresta (en torno a 89,45° S,
  222,7° E). **Conviene contrastarlo con los mapas de iluminación publicados
  antes de citarlo como validación.**
- El criterio es uno entre varios razonables. Dar más peso a la luz o al DTE,
  o exigir una pendiente menor, mueve los puntos unos cientos de metros.

### 4.3 El modelo sintético

`terrain.ts` conserva la función analítica h(x, y) original: 26 cráteres con
nombre, macizos, la cresta de conexión, rugosidad fractal y cráteres pequeños.
Tiene dos usos:

- **Tests del motor.** Es determinista, no depende de archivos y sus accidentes
  pasan por puntos conocidos (`ANCHOR_SITES`), así que sirve para comprobar el
  horizonte, las sombras y los KPIs contra geometría conocida.
- **Respaldo.** Si faltan los archivos LOLA, la app arranca con él y lo indica.
  En ese modo las coordenadas de los sitios no corresponden a sus accidentes.

No debe usarse para sacar conclusiones sobre sitios reales.

### 4.4 Límites del terreno

- La malla local es de 32 m sobre datos de 20 m/px, y alrededor del 90 % de los
  píxeles de LOLA a esa escala son interpolados entre trazas. Los bloques y
  cráteres de pocos metros no están; para el aterrizaje final harían falta
  modelos derivados de imágenes (LROC NAC, ShadowCam).
- Las coordenadas personalizadas usan 160 m/px: sirven para comparar regiones,
  no para afinar un punto. La interfaz lo marca.
- No se propagó la incertidumbre de altura de LOLA a los porcentajes.

## 5. Horizonte, visibilidad y sombras

**Horizonte.** Para cada grado de azimut se marcha un rayo sobre la malla
anidada hasta 250 km (pasos de 16 m cerca, crecientes 2 % lejos) y se guarda la
mayor elevación aparente con geometría esférica exacta:

    tan(elev) = (Rt·cos γ − Ro) / (Rt·sin γ),   γ = d / R

La curvatura lunar importa: a 100 km el terreno cae 2,9 km. Un perfil completo
(≈120 000 muestras) tarda 5–8 ms.

**Luz solar.** Se calcula la fracción del disco solar sobre el horizonte,
cortando el disco en 9 franjas verticales y recortando cada una con el horizonte
en su propio azimut (un collado entre dos picos deja pasar parte del disco).
«Con sol» significa fracción > 0; la energía usa la fracción.

**DTE.** Enlace abierto si El_Tierra > El_horizonte(Az_Tierra) + margen de
antena (2° por defecto, configurable).

**Sombras 3D.** `shadowSweep.ts` propaga un «techo de sombra» celda a celda
desde el borde que mira al Sol: O(N), ~2 ms para la malla de 257². El terreno
fuera del mosaico entra como un plano de borde construido con el horizonte
lejano del lander. Dos barridos (limbo superior e inferior) dan la penumbra. El
mismo barrido, acumulado en el tiempo, produce los mapas de «horas de sol» y de
«vista a la Tierra».

**Decisión.** Sombras por barrido en CPU en vez de shadow maps. Con el Sol a 1°
los shadow maps fallan, y el relieve que proyecta la sombra suele estar fuera
de la malla visible.

## 6. Física de misión

**Energía.** P = S(d)·A·η·derating·f_montura·fracción_disco, con S = 1361 W/m²
escalado por el inverso del cuadrado de la distancia.

| Montura | Factor de proyección |
|---|---|
| Seguidor de 1 eje (panel vertical que sigue el azimut) | cos(el) |
| Cilíndrica vertical (A = área lateral total) | cos(el)/π |
| Horizontal | sin(el) |

Batería: integración horaria con eficiencia de carga. El lander opera con su
carga base solo si el arreglo la cubre; si no, hiberna con la carga de
supervivencia. Se reportan SoC mínimo, horas bajo el límite DoD y horas con
batería agotada (congelamiento).

**Enlace DTE.** EIRP = P_tx + G_tx − L_línea; FSPL = 20·log₁₀(4πd/λ);
C/N₀ = EIRP − FSPL − L_misc + G/T + 228,6. La tasa alcanzable es el mínimo entre
el límite por potencia (C/N₀ − Eb/N₀ requerido − pérdidas − margen) y el límite
por ancho de banda. Hay tres estaciones predefinidas (DSN 34 m, comercial 13 m,
GISAT UdeC 3,7 m) cuya temperatura de ruido incluye el disco lunar en el haz.
El volumen de datos integra la tasa mientras hay LOS y bus energizado.

Supuestos por defecto (ajustables en la interfaz): 2,4 m² a 29,5 %, 180 W
operando, 35 W en supervivencia, 4000 Wh, DoD 80 %; 20 W en banda X con antena
de 0,6 m, 10 MHz, Eb/N₀ requerido 2,6 dB, margen 3 dB.

### 6.1 Satélites de retransmisión (`relay.ts`)

El enlace directo falla cuando la Tierra queda bajo el relieve: en la cresta de
Shackleton, cerca del 58 % del tiempo. Un relay es un satélite en órbita lunar
que reenvía la señal mientras tanto. El módulo permite definir una constelación
(1 a 8 satélites en 1 o más planos) y mide cuánto de esos cortes cierra.

Cómo se calcula:

1. Cada satélite se propaga como órbita kepleriana (ecuación de Kepler por
   Newton) con elementos referidos al ecuador lunar.
2. La posición se pasa al marco que rota con la Luna (la Luna gira bajo la
   órbita a su tasa sidérea) y se proyecta al cielo del lander, igual que el Sol
   y la Tierra.
3. Un relay cuenta solo si cumple dos condiciones: está sobre el horizonte
   topográfico del sitio más el margen de antena, **y** tiene a la Tierra a la
   vista (la esfera lunar no corta la línea relay–Tierra).
4. Dentro de cada hora se evalúan 12 instantes, para no perder las pasadas de
   pocos minutos de una órbita baja.

Órbitas predefinidas:

| Órbita | Elementos | Comportamiento |
|---|---|---|
| Elíptica congelada con apoapsis sur | a = 5740 km, e = 0,58, i = 54,9°, ω = 86,3°; período 10,84 h, altitud 673–7332 km | Permanece la mayor parte de cada órbita sobre el hemisferio sur |
| Polar circular baja | 100 km de altitud, i = 90° | Pasadas cortas y frecuentes |
| Personalizada | a, e, i, ω editables | El periapsis se limita a 20 km de altitud |

Resultado en la cresta de Shackleton (ventana por defecto, 60 días): el DTE solo
da 41 %; con dos relays en la órbita elíptica hay camino a la Tierra el 100 % del
tiempo; un solo relay lo deja en torno al 85 % (ventana de 30 días); dos relays
en órbita baja están a la vista menos del 20 %.

Límites, que también se indican en la interfaz:

- **Dos cuerpos con elementos fijos.** Las órbitas lunares reales se perturban
  por la Tierra y por el campo de gravedad lunar. Las órbitas «congeladas»
  mantienen casi constantes e, i y ω, que es lo que se asume; el nodo deriva en
  la realidad y aquí no. Los resultados describen la cobertura típica de una
  arquitectura, no las horas de pasada de una nave concreta.
- Los elementos de la órbita elíptica son los que recuerdo publicados para la
  clase Lunar Pathfinder / Moonlight. **Hay que contrastarlos con la fuente
  antes de presentarlos como los de esa misión.**
- No se modela almacenamiento y reenvío, ni el presupuesto de enlace
  lander–relay (se usa una tasa fija configurable), ni si la estación terrena
  ve al relay.
- La precesión de 18,6 años del polo lunar se ignora.

## 6.2 Módulos de contingencia y supervivencia (SyR-P2 a SyR-P5)

Añadidos a partir del documento de estado del arte del equipo
(`estado_del_arte_y_evolucion_clps_lunar_mission_browser.md`). El modelo de base
(`evaluateScenario`) no cambió: `evaluateMission` (`missionAnalysis.ts`) lo
ejecuta y luego recalcula potencia, batería y descarga con la física adicional.
Con el lander nivelado, sin activo vecino y con el modelo térmico apagado, la
serie de potencia es idéntica a la de base (hay un test que lo comprueba).

**Sobre las fuentes.** Varias afirmaciones de ese documento no se pudieron
contrastar en esta sesión: los pesos del índice (atribuidos a un estudio
SOM / random forest), los ángulos de vuelco de
IM-2 y SLIM,. Se usan tal como
vienen y la interfaz lo indica donde corresponde. Conviene verificarlas antes
de citarlas ante un jurado.

### Actitud de alunizaje (`attitude.ts`, SyR-P2)

Marco del cuerpo igual al ENU local con actitud cero (x = este, y = norte,
z = arriba). R = Rz(−ψ)·Rx(θ)·Ry(φ): guiñada como rumbo, cabeceo con nariz
arriba positivo, alabeo con lado derecho abajo positivo.

- **Paneles.** El vector solar se lleva al marco del cuerpo. Proyección según
  montura: horizontal max(0, s_z); cilíndrica |s_xy|/π; seguidor de 1 eje |s_xy|
  (el panel sigue girando, pero en torno a un eje inclinado). Con actitud cero
  coinciden con las fórmulas de base.
- **Antena.** El eje de puntería se fija antes del alunizaje hacia la dirección
  media de la Tierra en la ventana. Un cardán (20° por defecto) corrige hasta su
  límite; el exceso es el ángulo fuera de eje y la pérdida es
  12·(α/θ3dB)² dB, con un piso de 40 dB fuera del lóbulo principal. Si la Tierra
  queda más de 5° bajo el plano de la cubierta, el propio cuerpo la oculta.
- **Ancho de haz.** El control de θ3dB modifica el diámetro de la antena
  (θ = 70λ/D), de modo que estrechar el haz sube la ganancia y la sensibilidad
  a la inclinación a la vez. Es más coherente que tratarlos por separado.
- **Desviaciones respecto del enunciado.** Los controles de alabeo y cabeceo
  llegan a ±90° (el enunciado pedía ±45°) porque los presets IM-2 (75°) y SLIM
  (85°) no cabían. Se añadió el cardán, sin el cual una antena de 4° de haz
  perdería el enlace solo por la libración, y un quinto preset que apoya el
  lander sobre la pendiente real del terreno.

Un alabeo en torno a un eje que apunta a la Tierra no desapunta la antena: el
efecto depende de la geometría del sitio, no solo del ángulo.

### Propagación RF física y segmento terreno (`rfPropagation.ts`, SyR-P3)

- **Difracción.** Para cada muestra, la altura de la cresta dominante sobre el
  rayo es h = d·(tan H − tan el), con H y d tomados del perfil de horizonte.
  ν = h·√(2/(λd)) y J(ν) = 6,9 + 20·log₁₀(√((ν−0,1)²+1) + ν − 0,1) para
  ν > −0,78. Con la Tierra justo sobre la cresta la pérdida es 6,03 dB.
- **Multipath.** Coeficientes de Fresnel del regolito (ε_r = 3,7, tan δ = 0,01),
  componente copolar circular, factor de rugosidad de Rayleigh y atenuación por
  el diagrama de la antena (el rayo reflejado llega 2ψ bajo el eje). La fase
  depende de la altura de la antena con precisión de fracción de longitud de
  onda, que no se conoce: se usa la envolvente 1 − |Γ|, el peor caso.
- **Estaciones.** `astronomy-engine` da la elevación de la Luna en cada
  estación; rastrea la que la tiene más alta sobre una máscara de 10°. DSN:
  Goldstone, Madrid y Canberra. La opción GISAT es una sola antena en
  Concepción y ve la Luna solo parte del día. La red comercial de 13 m se
  supone en las mismas longitudes que el DSN: es un supuesto.
- La tasa sale del presupuesto de enlace existente restando la pérdida extra a
  C/N₀. Bajo 1 kbps el enlace se considera cerrado.

Límites: una sola arista (no Deygout ni Bullington para crestas múltiples),
terreno plano frente al lander para el multipath, sin variación de G/T con la
elevación de la estación.

La fila «Tierra a la vista» (línea de vista geométrica con margen) se conserva
junto a la fila «Descarga» (enlace físico) para que se vea la diferencia.

### Electro-térmico acoplado (`thermal.ts`, SyR-P4)

    m·c_p·dT/dt = α·A_abs·S·f_sol + P_carga + Q_calef − ε·σ·A_rad·(T⁴ − T_ent⁴)
    E(t+Δt) = clamp(E + (P_solar − P_carga − Q_calef)·Δt, 0, E_max(T))

Integración explícita con 10 subpasos por hora. Termostato con histéresis de
5 K: los calefactores se encienden bajo 0 °C. La capacidad útil baja
linealmente de 100 % a −10 °C a 60 % a −20 °C; a −20 °C la batería se declara
congelada y el lander se pierde para el resto de la ventana (no se recupera al
volver el Sol). El entorno sigue la luz con una constante de tiempo de 4 h
entre 230 K (iluminado) y 70 K (sombra).

Valores por defecto, todos editables: masa térmica 120 kJ/K, área radiante
0,5 m² con emisividad 0,5, calefactores de 80 W. Son representativos de un
lander pequeño aislado, **no de un vehículo concreto**. Con ellos la fuga a
0 °C es de unos 80 W, así que la noche cuesta unos 115 W en total y los 4 kWh
de batería duran unas 35 h. Supuestos simplificadores: un solo nodo térmico, un
techo de 40 °C que representa el control térmico en caliente, y toda la
potencia eléctrica disipada dentro del bus.

El modelo viene activado. Al activarlo cambian los KPIs de batería y
supervivencia respecto de la versión anterior de la app: es el efecto buscado.

### Índice multicriterio y dispersión (`siteScore.ts`, SyR-C5.1 y C5.2)

Pesos del documento del equipo (suman 97,37 y se renormalizan). El índice es la
media ponderada de los criterios con datos y muestra qué parte del peso cubren.

| Criterio | Peso | Origen del dato |
|---|---|---|
| Visibilidad de la Tierra | 23,16 | calculado (motor) |
| Hidrógeno (WEH) | 13,65 | **sin capa**: se ingresa a mano |
| Rugosidad kilométrica | 12,82 | calculado: RMS respecto del plano de mejor ajuste en 1 km |
| Pendiente local | 11,55 | calculado |
| Iluminación | 9,83 | calculado |
| Distancia a PSR | 9,68 | capa LOLA (regiones en sombra permanente) |
| FeO | 6,03 | capa Lunar Prospector GRS |
| Densidad geológica | 5,81 | **sin capa**: se ingresa a mano |
| Anomalía gravitatoria | 4,84 | capa GRAIL |

Con las capas cargadas el índice cubre el 80 % del peso; sin hidrógeno ni
densidad geológica no llega al 100 %, y la matriz de verificación marca el
requisito como PARCIAL por esa razón.

#### Capas orbitales (`scienceLayers.ts`, `scripts/fetch_science_layers.py`)

Todas se leen con peticiones HTTP por rango: salen 0,6 MB a `public/science/`
sin descargar los archivos de origen.

| Capa | Producto | Resolución | Cobertura en la app | Cita |
|---|---|---|---|---|
| PSR | `LPSR_80S_20MPP_ADJ` (PGDA, producto 90) | 20 m; máscara a 160 m | cualquier punto del casquete | Barker et al. 2023, doi:10.3847/PSJ/acf3e1 |
| Temperatura e hielo | Diviner `LRO-L-DLRE-5-PRP-V2.0` | ~500 m | solo los cinco sitios | Paige et al. 2010, doi:10.1126/science.1187726 |
| FeO | LP GRS `LP-L-GRS-5-ELEM-ABUNDANCE-V1.0` | píxeles de 2° (~60 km) | al sur de 78° S | Prettyman et al. 2006, doi:10.1029/2005JE002656 |
| Gravedad | GRAIL `GGGRX_1200A_ANOM_L420` | 16 px/°, malla de 5 km | ±305 km del polo | Lemoine et al. 2014, doi:10.1002/2014GL060027 |

Las citas son las que recuerdo para cada producto; conviene confirmarlas en las
etiquetas PDS antes de publicarlas.

Valores en los puntos de aterrizaje:

| Sitio | T media / máx (K) | Hielo estable más cercano | FeO (% peso) | Gravedad (mGal) |
|---|---|---|---|---|
| Cresta de Shackleton | 108 / 200 | bajo el lander, a 28 cm | 4,9 | +244 |
| Malapert | 143 / 244 | 1,2 km | 4,8 | +630 |
| Haworth | 133 / 255 | 0,3 km | 5,2 | +250 |
| Nobile / Mons Mouton | 134 / 234 | 0,4 km | 5,0 | +802 |
| De Gerlache | 116 / 207 | bajo el lander, a 84 cm | 5,3 | +206 |

Decisiones y límites:

- **Distancia a PSR.** Se puntúa con la máscara de 160 m, no con la de 20 m. La
  de 20 m contiene cientos de miles de sombras de cráter de decenas de metros
  que quedan a menos de 300 m de todos los sitios y volverían el criterio
  idéntico en todas partes. La distancia de 20 m se muestra aparte, sin puntuar.
- **Diviner alimenta el modelo térmico.** En un sitio candidato, la temperatura
  de sumidero al sol es el máximo anual medido ahí (200–255 K) en lugar de los
  230 K genéricos. Para coordenadas personalizadas se usa el valor por defecto.
- **FeO y gravedad describen la región, no el punto.** Un píxel de FeO mide
  ~60 km y los cinco sitios dan 4,8–5,3 %: este criterio casi no discrimina
  entre ellos. La anomalía de aire libre está dominada por la topografía (los
  macizos destacan); una anomalía de Bouguer sería más informativa sobre el
  subsuelo y no se usó.
- **Hidrógeno: no encontrado.** No hallé un mapa en malla de LEND ni de Lunar
  Prospector en los archivos PDS Geosciences consultados (el nodo solo expone
  datos crudos de LEND). Sigue siendo un campo manual. La estabilidad de hielo
  de Diviner es un indicio relacionado, pero no es una medida de hidrógeno y
  no se usó como sustituto.
- **Normalizaciones** (pendiente 0–20°, rugosidad 0–200 m, PSR 0–20 km, FeO
  0–20 %, |gravedad| 0–300 mGal) y los dos modos de ponderación alternativos son
  convenciones de este proyecto, no valores publicados.
- Si faltan los archivos de `public/science/`, el índice vuelve a los cinco
  criterios calculados y la distancia a PSR usa un sustituto: terreno sin luz
  durante la ventana analizada.

La malla de dispersión evalúa 25 misiones completas en ±200 m. No se usa la
palabra «probabilidad»: cada celda muestra un resultado determinista
(sobrevive o cuándo se pierde). El vector de escape apunta a la mejor celda por
supervivencia, luego enlace, luego energía; entre empates gana la más cercana.

### Coexistencia (`coexistence.ts`, SyR-C5.3)

- **Sombra mutua.** El activo se trata como un rectángulo que oculta parte del
  disco solar. La sombra del lander sobre el activo se evalúa a 1 m de su base.
- **Eyección por pluma.** Ley de escala: la masa erosionada es proporcional al
  empuje (≈2,6 t para un módulo lunar de 13 kN, según estimaciones de la era
  Apollo), sale en una lámina de ~3° y la fluencia a distancia d es
  M/(2π·d²·θ). El umbral de daño se calibró para que 13 kN dé los 2 km de
  exclusión que NASA recomendó cerca de hardware histórico. De ahí,
  R ∝ √empuje: 961 m para 3 kN.

Las cifras de calibración son de memoria y la ley es un orden de magnitud:
sirve para comparar separaciones, no reemplaza una simulación de pluma.

### Matriz de verificación y exportación

El botón «Verification» abre la matriz SyR-P1 a SyR-P5 con sus once requisitos
hijos, recalculada al abrir. Cada fila llama al motor con entradas conocidas y
añade cifras del escenario activo. Estados: VERIFICADO, PARCIAL (falta una
entrada), POR INSPECCIÓN (solo comprobable mirando la app) y NO CUMPLE. No hay
filas marcadas como verificadas sin una comprobación detrás.

Desde ahí se exportan la telemetría en CSV (26 columnas en unidades SI, una fila
por hora) y un calendario `.ics` con pasadas por estación, eclipses y pérdidas.

## 6.3 Evoluciones v3 (auditoría del equipo, 2026-11-13)

Hechas: corrección de textos (PSI rotulado como radio normativo NASA escalado,
no físico; se quitó la referencia arXiv inexistente y «LunaHorizon»; estación
GISAT rotulada como hipotética; órbita de relay genérica), rango ampliado a
80° S (malla regional de ±520 km), E1 (ensamble por incertidumbre de LOLA,
`uncertainty.ts`), E2 (factor de vista al cielo e IR del terreno), E3 (replay de
IM-2) y E7 (ESTRACK, Santiago y G/T requerido). Referencia de propagación lunar:
ITU-R P.2170 (citada, no implementada).

Dos resultados que contradicen lo esperado y hay que decir tal cual:

- **E3: el modelo no reproduce la pérdida de IM-2.** En el punto y la fecha
  reales da 100 % de luz y supervivencia de 10 días, frente a ~13 h reales.
  Athena cayó en un cráter de decenas de metros en sombra que el terreno de
  20 m no contiene. Sirve como límite documentado del modelo, no como
  validación. Haría falta terreno métrico (LROC NAC, ShadowCam).
- **E2: el factor de vista al cielo casi no cambia el congelamiento en sombra.**
  Un muro a 70 K y el cielo a 3 K son ambos «fríos» frente a un bus a 270 K
  (70⁴/270⁴ = 0,5 %). Sí importa cuando el lander está en sombra rodeado de
  laderas soleadas.

### Segunda iteración (2026-11-14)

Prioridad aplicada: primero lo que responde la pregunta de planificación que la
app aún no contestaba (cuándo), después lo que corrige un sesgo optimista del
modelo (E5), después lo que agrega un riesgo nuevo (E4).

**Buscador de ventanas + E6** (`windowFinder.ts`, panel «Cuándo»). Cada fecha
candidata (cada 12 h, 30–180 días) se vuela como una misión completa con
`evaluateMission`. Se acepta si: contacto con sol (≥ 50 % del disco), Tierra
sobre el terreno con el margen de antena y enlace que cierra con estación en
seguimiento, supervivencia de la misión (batería y térmica), Sol fuera del cono
frontal de ±25° (deslumbramiento) y del cono trasero de ±15° (fase cero, sin
sombras), y ≥ 50 % de la elipse de ±200 m iluminada (barrido de sombras sobre
la malla de 32 m). Cada rechazo guarda todas sus razones. Los umbrales de
iluminación son supuestos de ingeniería de esta herramienta, no el requisito
publicado de una misión; son parámetros. No se modela trayectoria, combustible
ni navegación: es un filtro de condiciones en superficie.

Resultado (90 días desde 2027-09-01, misión de 14 días, rumbo 180°;
`scripts/probe_windows.ts`, ~6 s por búsqueda):

| Sitio | Fechas aceptadas | Ventanas | Qué descarta más |
|---|---|---|---|
| Shackleton | 31 % | 4 (hasta 11,5 d) | Tierra tras el terreno (108/181), deslumbramiento (24) |
| De Gerlache | 34 % | 6 (hasta 11,5 d) | Tierra tras el terreno (105), deslumbramiento (26) |
| Malapert | 13 % | 6 (≤ 2,5 d) | muerte térmica (112), elipse en sombra (88) |
| Haworth | 13 % | 5 (≤ 3,5 d) | elipse en sombra (93), Tierra tras el terreno (88), térmica (88) |
| Nobile | 13 % | 3 (≤ 4,5 d) | muerte térmica (125), elipse en sombra (85) |

**E5: difracción de tres aristas** (`deygoutLossDb`, construcción de Deygout,
UIT-R P.526: L = J(νp) + T·(J(νt) + J(νr)), T = 1 − e^(−J(νp)/6); la corrección
empírica C = 10 + 0,04·D se omite porque está ajustada a trayectos terrestres).
La fórmula está escrita de memoria de la recomendación y no se cotejó contra su
texto. El perfil del terreno hacia la Tierra se muestrea con el mismo esquema
radial del horizonte y se cachea por acimut entero. A la pérdida de la arista
del horizonte se le suma la diferencia entre Deygout y esa arista sola.

Hallazgo: con una sola arista el modelo era optimista donde el horizonte es una
loma cercana con un macizo justo debajo más lejos. En De Gerlache, 152 h de las
1440 h de la ventana que antes contaban como descarga dejan de cerrar (67 % →
57 %). En Shackleton, Malapert y Nobile el cambio es nulo; en Haworth hay hasta
30 dB adicionales pero en horas en que el enlace ya no cerraba.

Queda un sesgo sin resolver: la «descarga que cierra» (61 % en Shackleton)
supera a la «Tierra a la vista» geométrica con margen (41 %), porque el modelo
físico acepta enlaces de pocos kbps difractados hasta 3° bajo el horizonte. El
buscador de ventanas no usa esos enlaces para el contacto, pero el KPI de
descarga sí los cuenta.

**E4: probabilidad de vuelco** (`tipover.ts`, panel «Vuelco»). Criterio de
energía ½v² > g·L·(1 − cos(β − α)), β = atan(r/h). Velocidad lateral gaussiana
en dos ejes (módulo Rayleigh, dirección uniforme), pendiente del terreno más un
error gaussiano por el relieve no resuelto; integración numérica determinista
(72 direcciones × 25 nodos), sin muestreo aleatorio. Mapa de 5 × 5 sobre la
elipse de ±200 m. Con el vehículo por defecto (h = 1,8 m, r = 2,0 m, σv = 0,5
m/s, σ pendiente = 3°) da 0,35–0,52 % en el punto de mira de los cinco sitios y
hasta 1,3 % en la peor celda (13° de pendiente). El vehículo es ilustrativo, no
un lander real, y el modelo supone que las patas se detienen en seco: omite
carrera de patas, absorbedores, deslizamiento y velocidad vertical, y no ve
rocas menores que el píxel. Sirve para comparar sitios y geometrías, no como
probabilidad certificada.

Pendientes: hindcast de IM-1 (falta su malla de 20 m, en parte fuera del
mosaico), bandas P10/P90 en la línea de tiempo, y filas de la matriz de
verificación para estas tres funciones.

## 6.4 Evolución v4: resolución en todo el casquete e interfaz de decisión (2026-11-14)

Pedido del equipo: que cualquier punto entre 80° S y 90° S tenga terreno de
nivel de aterrizaje, y que la pantalla se entienda en segundos. La física de
`src/engine/` no se simplificó; todo lo nuevo es lectura de resultados que el
motor ya entrega, salvo el micro-relieve, que es un modelo estadístico aparte.

### Terreno bajo demanda (20 m en cualquier punto)

```
clic / coordenada ──► malla local desde el casquete de 160 m (inmediato)
                      │
                      └─► upgradeLocal()            state/dem.ts
                           ├─ IndexedDB «clps-terrain» ── hay parche ──► instalar (estado «cached»)
                           └─ streamLocalPatch()     engine/cogStream.ts
                                patchWindow()  ventana de ~827 × 827 px del COG
                                WindowReader   geotiff.js, peticiones HTTP Range
                                resamplePatch() bilineal a la malla local 513² de 32 m
                              ──► instalar («ready») y guardar en IndexedDB
```

- Fuente: el mismo ráster que usa `scripts/build_lola_dem.py`
  (`LDEM_80S_20MPP_ADJ.TIF`, 30 400² píxeles float32, deflate, teselas de 512).
- **CORS.** El servidor de PGDA no envía `Access-Control-Allow-Origin`, así que
  un navegador no puede leerlo directo. `vite.config.ts` incluye un proxy de
  rangos en `/lola-cog/` (activo en `npm run dev` y en `vite preview`; rechaza
  peticiones sin `Range`, el archivo pesa 2,7 GB). Un despliegue estático puro
  (GitHub Pages) necesita ese proxy o un espejo con CORS en
  `VITE_LOLA_COG_URL`; sin ninguno la app conserva el terreno de 160 m y lo
  dice en pantalla («Fuente de 20 m inaccesible…»).
- Validación (`scripts/verify_cog_stream.ts`, contra el servidor real): el
  parche leído en vivo coincide con la malla precompilada del mismo sitio con
  0,000 m RMS (peor píxel 0,001 m) en Shackleton y en IM-2; 4–5 peticiones y
  ~6 s por parche, 2,7 MB sin comprimir.
- El mosaico de 20 m termina en 80° S. Un parche que cruza ese borde se
  completa con la malla gruesa y se informa el porcentaje cubierto; más al
  norte el estado es «fuera del mosaico».
- Estados visibles en el HUD y en el modo Emergencia: cargando → LISTO /
  desde el almacén sin conexión / inaccesible / fuera del mosaico.

### Banda 80°–90° S completa

Las coordenadas personalizadas ya se aceptaban hasta 80° S, pero un rayo de
horizonte de 250 km lanzado hacia el norte desde 80° S (a 303 km del polo)
termina a 553 km, fuera de la malla regional de ±520 km: el perfil quedaba
recortado a ~217 km en esos acimuts. En vez de una segunda malla de respaldo
se amplió la regional a **±560 km (1401², 800 m, 3,9 MB)**, con lo que ningún
rayo sale de ella y no hay un segundo camino de código. `public/dem/` pasa a
18,3 MB (límite pedido: 20 MB). Tests: horizonte y misión completos en 80,0°,
80,5° y 81,5° S.

Entre 80° S y 84,7° S el respaldo inmediato es la malla regional de 800 m (el
casquete de 160 m cubre ±160 km); el parche de 20 m la reemplaza al llegar.

### Micro-relieve sub-píxel (`microRelief.ts`)

Modo conmutable. Sobre el terreno de 20 m se superpone, en un parche de 96 m a
1 m, una superficie determinista (misma semilla para la misma coordenada):

- rugosidad fractal (ruido de valor, octavas de 16/8/4/2 m, exponente de Hurst
  0,9) con amplitud fijada por la pendiente RMS no resuelta (2,5° por defecto);
- cráteres de 3–15 m en equilibrio, N(>D) = 0,079·D⁻² por m², profundidad/
  diámetro 0,04–0,16.

De ahí sale el **índice de peligro de micro-sombra y roca**: fracción del
parche en sombra propia para las direcciones solares de la misión (trampas de
sombra que el modelo de 20 m muestra como soleadas) y fracción con pendiente
sobre 15° bajo las patas (4 m).

Límites que hay que decir:

- Es estadístico, **no un mapa**: dice qué tan probable es una trampa oculta,
  no dónde está. No reproduce el cráter real de IM-2.
- No modifica el horizonte ni la misión; es un análisis aparte.
- El coeficiente de equilibrio (0,079), el exponente de Hurst y el rango de
  profundidades están escritos de memoria y **no se cotejaron contra la
  literatura**. El pedido cita la metodología «LDEM Fractal» de Mazarico/Barker;
  no la verifiqué y esto no pretende implementarla.
- No se usa el conteo de trazas LOLA (`LDEC`): no está entre los datos de la
  app, así que la amplitud no se modula por distancia entre trazas.

### Veredicto y rescate (`verdict.ts`, `state/verdict.ts`, `VerdictCard.tsx`)

Tarjeta siempre visible sobre la vista 3D, en lenguaje llano:

| Nivel | Cuándo |
|---|---|
| NO-GO | el lander no sobrevive (térmica o batería), o habla con la Tierra < 1 % del tiempo |
| CAUTION | silencio continuo > 48 h, batería bajo su DoD, inclinación > 12°, vuelco > 5 %, pendiente > 10°, luz < 50 % |
| GO | nada de lo anterior |

Los umbrales están en `VERDICT_LIMITS` y son criterio de esta herramienta.

**Rescate de un clic.** Prueba los 25 puntos de la malla de ±200 m y, si
ninguno salva la misión, recorre fechas posteriores cada 12 h hasta 60 días.
Aplica el cambio y muestra antes → después. Medido en la verificación e2e:
Malapert, 14 días desde 2027-09-01, NO-GO (falla térmica en el día 4) →
CAUTION moviendo el alunizaje al 2027-09-10, 42 misiones en 1,2 s. Un caso sin
salida (Malapert con misión de 60 días desde 2027-09-01) tarda 20 s en agotar
144 misiones y lo dice:
«Ningún punto a 200 m ni fecha en los próximos 60 días salva esta misión».
El pedido fijaba < 100 ms: **no se cumple**; cada misión es una simulación
completa. Corre troceado en el hilo principal (rebanadas de 24 ms) sin
afectar los 60 fps; no se movió a un Web Worker.

### Modo Emergencia (`triage/TriageLayout.tsx`)

Tercer modo en la barra superior. Entrada: clic en el mapa polar (relieve
sombreado de la malla regional, anillos de latitud, accidentes con nombre) o
coordenadas pegadas. Tres pasos:

1. **Dónde estamos**: coordenadas, cota, pendiente, estado del terreno
   (grueso → 20 m en vivo), botón para apoyar el lander en la pendiente local
   y, opcional, el índice sub-píxel.
2. **Cuánto queda** (`emergencyCountdown`): tiempo hasta perder el lander,
   hasta perder o recuperar el enlace, y hasta la próxima sombra o amanecer,
   contados desde la hora del cursor.
3. **Hacia dónde**: el vector de escape de la malla de dispersión, también
   dibujado como flecha verde sobre el terreno 3D. Si ningún punto a 200 m
   salva el lander, lo dice y ofrece el menos malo.

### Niveles de la interfaz

Reemplazado por la consola contextual de la sección 6.5 y, en la v2.0, por la
Vista de ingeniería dentro de Ciencia (sección 6.6). Se mantienen el doble clic
para alunizar y los nombres de accidentes sobre el horizonte.

## 6.5 Consola contextual por subsistemas (v5, 2026-11-14)

> La v2.0 (sección 6.6) cambia parte de lo que sigue: pestañas a todo el ancho
> con transición, un solo escenario por defecto, Ciencia con Vista de
> ingeniería, Terreno con el flujo de emergencia y sin matriz de verificación.

Objetivo del equipo: quitar la saturación de paneles fijos, sin ventanas
modales, con estética de consola de control y una interfaz que cambie según el
subsistema analizado. El motor (`src/engine/`) no se tocó.

**Selector de subsistemas** (`SUBSYSTEMS` en `state/store.ts`, barra bajo la
barra superior). Cada subsistema define sus paneles, su color de acento, la
capa de cobertura que se enciende en el terreno y lo que la escena 3D destaca:

| Subsistema | Acento | Izquierda | Derecha | Abajo | Terreno / escena |
|---|---|---|---|---|---|
| Resumen | esmeralda `#10B981` | sitios y fechas | signos vitales, comparar A/B, fechas | ventanas de misión | sombras |
| Energía / térmico | ámbar `#F59E0B` | equipo: energía y térmico | energía y supervivencia | potencia y temperatura, ventanas | horas de sol; haz solar sólido, haz DTE atenuado |
| Comunicaciones / RF | cian `#06B6D4` | equipo: radio y relays | presupuesto de enlace y Deygout | horizonte 360°, ventanas | vista Tierra; haz DTE 2,4× más ancho y brillante |
| Terreno / alunizaje | gris claro `#E2E8F0` | actitud, vuelco, replay, activo vecino | dispersión 5×5, escape, incertidumbre | horizonte 360°, ventanas | pendientes (0–25°) y flecha de escape sobre el suelo |
| Ciencia | violeta `#B49CFF` | sitios y fechas | índice de aptitud y capas orbitales | ventanas | sombras |

El gris claro de Terreno no está en la paleta del pedido: el ámbar, el rojo y
el cian ya significan otra cosa en el semáforo, y la paleta no traía un cuarto
color neutro.

**Bandejas flotantes.** Los paneles son bandejas de cristal
(`rgba(13,17,26,0.82)`, `backdrop-filter: blur(16px)`, borde
`rgba(255,255,255,0.08)`) acopladas a los bordes de la vista 3D. No cambian el
tamaño del canvas (verificado: 1600 × 812 px con y sin bandejas y en los cinco
subsistemas). Para que el lander no quede tapado, la cámara desplaza su punto
principal al área libre (`setViewOffset`), sin redimensionar ni mover la
cámara: la selección, el arrastre y las etiquetas proyectadas siguen
coincidiendo. El HUD se aparta de las bandejas con variables CSS. La bandeja
inferior ocupa como máximo el 46 % del alto y su contenido se desplaza dentro.
Bajo 980 px de ancho las bandejas se apilan bajo la escena.

Las transiciones usan solo `transform` y `opacity`. Con las tres bandejas de
cristal abiertas y reproducción en curso se mantienen 60 fps (mediana
16,7 ms, p95 16,7 ms, sin cuadros sobre 25 ms) en la verificación headless.

**Sin modales.** La matriz de verificación pasó de diálogo centrado con fondo
oscurecido a una hoja acoplada a la derecha que no captura el puntero fuera de
ella.

**Signos vitales** (`VitalCards.tsx`): tres tarjetas grandes —luz continua
restante, ventana DTE abierta o cerrada y tiempo hasta congelamiento— contadas
desde la hora del cursor. Aparecen en Resumen y en el paso 2 del modo
Emergencia.

**Curva de potencia.** El gráfico de energía muestra la potencia del panel en
el tiempo (relleno ámbar, 100 % = pico) junto a la carga de batería y la
temperatura del bus.

**Inducción de misión** (`MissionBriefingTour.tsx`). En la primera visita
aparece un saludo abajo a la derecha con «Iniciar chequeo» y «Omitir / acceso
directo»; la elección se guarda (`clps.briefing`). El botón «Guía de misión»
de la barra superior lo relanza. Cinco pasos con foco sobre los componentes
reales: vista 3D, lander, selector de subsistemas, línea de tiempo y
veredicto/auto-escape. Se maneja con flecha derecha, flecha izquierda y Esc.
El oscurecido no captura el puntero, así que la escena sigue usable durante el
recorrido. Reemplaza el recorrido de tres globos de la v4.

**Paleta.** Fondo `#06080D`, paneles `#0D111A`; B612 para texto y JetBrains
Mono con cifras tabulares para la telemetría.

## 6.6 Interfaz v2.0 (2026-11-14)

Revisión de la interfaz a partir del inventario de controles (cada control con
su función, su fundamento y la marca «(modificable)» si no tenía razón
suficiente). El motor físico (`src/engine/`) no cambió: solo interfaz, estado y
textos, todo en inglés y español. Un commit por cambio.

| # | Cambio | Dónde |
|---|---|---|
| 1 | «Guía de misión» activa un **modo tutorial**: un aviso ligero (Iniciar / Cancelar, salir con Esc) y una secuencia fija de 10 pasos que conduce la interfaz de verdad (vista 3D, doble clic, transporte, las cinco pestañas, ventanas y comparación, Emergencia, Exportar). Al salir o terminar restaura el estado previo. La oferta del primer uso lanza el mismo recorrido. | `MissionBriefingTour.tsx` |
| 2 | Sin botón ni matriz de **Verificación** en la interfaz. `lib/verification.ts` quedó solo para sus pruebas (borrado en la v2.1). | `TopBar.tsx` |
| 3 | **Pestañas de subsistema** a todo el ancho (58 px, borde inferior de 4 px en el acento, ícono propio). Transición negro → ícono grande con nombre y acento → consola con su capa (~850 ms). Los clics durante la transición cambian el destino o se encolan. Con `prefers-reduced-motion`, fundido corto sin ícono. El estado de la transición vive en un store aparte. | `SubsystemSwitch.tsx` |
| 4 | **Telemetría**: chip con estado abierta/cerrada recordado (`clps.telemetry`); tira en cuatro grupos (Sol, Energía, Térmico, Enlace con la Tierra) con íconos, unidades y una línea de ayuda por lectura. Umbrales en un único lugar. Lecturas técnicas solo en Ciencia. | `Readout.tsx`, `lib/telemetry.ts` |
| 5 | Sin interruptor global de ingeniería: **Ciencia > Vista de ingeniería** con la tabla KPI completa y la incertidumbre del terreno; la línea de tiempo de Ciencia es la detallada. | `EngineeringView.tsx` |
| 6 | **Guía (PDF)** arriba a la derecha, en el idioma activo. Fuente en `docs/guia-interfaz.md` (ES) y `docs/guia-interfaz.en.md` (EN); `npm run guide` la convierte con un conversor Markdown mínimo y el Chromium de Playwright, sin dependencias nuevas. | `scripts/build_guide.mjs`, `public/guide/` |
| 7 | **Transporte** (−1 h, Reproducir/Pausa, +1 h, velocidad) en la vista 3D, abajo al centro. Sin ±1 d. Velocidades 1, 24 y 72 h/s (24 por defecto). El reloj UTC queda arriba. | `3d/Transport.tsx` |
| 8 | **Doble clic** explícito: pista permanente que se oculta con × (`clps.dblhint`), retículo con «Mover el lander (X m)» o «Crear sitio propio aquí», y aviso «Fuera del área» al norte de 80° S en vez de ignorar el clic. | `SceneExtras.tsx`, `SceneView.tsx` |
| 9 | **Un solo escenario** por defecto (sin pestañas A/B). El bloque **Comparar** al final de Ventanas de aterrizaje crea B como copia, muestra sus controles, el comparador rápido, la tabla KPI y «Usar la misma ventana». Apagado, B no se evalúa ni aparece. | `CompareBlock.tsx`, `store.compare` |
| 10 | **Supervivencia** como flujo de emergencia inmediata, compartido con el modo Emergencia: posición (mapa o coordenadas), energía (Wh restantes y carga mínima), inclinación opcional; sin fecha (desde ahora, 14 días). Responde con veredicto, tiempo hasta congelarse y mejor celda / vector de escape. | `EmergencyFlow.tsx` |
| 11 | **Nombres de sitio completos** o nada: se eliminó el código abreviado de la interfaz (tabla KPI, índice, línea de tiempo), las etiquetas del horizonte crecen con el texto. | prueba `labels.test.ts` |
| 12 | **Exportar CSV** en la barra superior, un clic (26 columnas SI, una fila por hora). Sin .ics. | `TopBar.tsx`, `lib/export.ts` |

Decisiones sobre los controles marcados «(modificable)»:

| Control | Decisión |
|---|---|
| Contador de FPS | Fuera del HUD; solo con `?debug=1`. |
| Botones ±1 d, cinco velocidades | Eliminados; tres velocidades. |
| Cámara «Mapa» | Eliminada; quedan Órbita y Vista lander. |
| Umbrales de calefactores 0 / −10 / −20 °C | Grupo plegado «Supuestos avanzados», rotulado como supuesto de ingeniería. |
| Elementos orbitales de relays | Fuera de la interfaz; quedan los presets y el número de satélites. |
| Botón «Mover el lander a la mejor celda» | Eliminado; el movimiento lo hace el flujo de emergencia. |
| Cono de deslumbramiento y elipse iluminada mínima | Fijos, con la nota «umbrales supuestos de ingeniería». |
| Modos Ingeniería primero / Ciencia primero | Eliminados; solo el índice sintetizado. |
| Campos de hidrógeno y geología | Eliminados. |
| «Seguridad del terreno» (100 − pendiente/20·100 − P·400) | Reemplazada por «Seguridad de aterrizaje = 1 − P(vuelco)», una probabilidad; la pendiente se muestra aparte. |
| 100 kbps por defecto | Campo vacío con chips 10 / 100 / 1000 kbps. |
| Exportación .ics | Eliminada. |
| «Reintentar 20 m» (Emergencia) | Eliminado. |
| «Reproducir un alunizaje real» | Se mantiene, con la nota permanente de que el modelo no reproduce la pérdida de IM-2. |

**Decisiones propias fuera del pedido.**

- La v2.0 vive en una copia aparte (rama `v2.0`, carpeta
  `Lunar-Landing-Site-Navigator-v2`) para no tocar la v1.
- La guía tiene dos fuentes Markdown (una por idioma) en lugar de una.
- El flujo de emergencia evalúa 14 días desde la hora actual. La energía
  restante se aplica como estado de carga inicial (`power.initialSoc`) y la
  carga mínima como `power.survivalLoadW`: son ajustes globales, así que
  también afectan al planificador. En el planificador, «Evaluar desde ahora» (o
  cualquier dato ingresado) mueve la fecha del escenario a la hora actual; el
  modo Emergencia lo hace al entrar.
- La incertidumbre del terreno (sliders de error y correlación, N variantes,
  bandas P10/P50/P90) quedó en la Vista de ingeniería; la probabilidad por
  celda se eliminó.
- El desplazamiento del lander (ΔE, ΔN) pasó bajo el título del sitio para
  dejar el centro inferior de la vista 3D al transporte.
- El sitio libre se llama «Sitio propio» / «Custom site».
- Las letras A/B y la marca del mejor valor de la tabla solo aparecen durante
  una comparación.

## 6.7 Interfaz v2.1 (2026-11-14)

Regla de la versión: toda cifra o umbral que se muestra tiene una razón
escrita (fuente, requisito o «supuesto del equipo» visible); lo que no la tiene
y no vale la pena justificar, se borra. Español e inglés sincronizados.

| § | Cambio | Dónde |
|---|---|---|
| 1 | **Transición de subsistema de ~1 s**: entrada 300 ms, ícono (96 px) y nombre quietos 400 ms, salida 300 ms (`SWITCH_OUT_MS`, `SWITCH_HOLD_MS`, `SWITCH_IN_MS`). Solo fundidos, así que con `prefers-reduced-motion` es igual y nada se mueve. La e2e mide el ícono visible ≥ 350 ms. | `SubsystemSwitch.tsx` |
| 2 | **Guía PDF con capturas reales**: `scripts/guide-shots.ts` maneja la app con Playwright a 1440×900, tema oscuro, ES y EN, sitio, fecha y reloj fijos; `npm run guide` toma las capturas y luego arma los PDF con la insignia en la portada. | `scripts/`, `docs/img/{es,en}/` |
| 3 | **Terreno sub-píxel sin casilla**: costo medido (`npm run measure-micro`, LOLA real, 5 sitios, 15 corridas): mediana 35–67 ms, peor 93 ms, < 300 ms. Se muestra siempre, junto a «estadístico, no un mapa» y los parámetros fractales marcados como no validados. | `TriageLayout.tsx`, `state/verdict.ts` |
| 4 | **Insignia oficial GISAT UDEC** en la barra (38 px, `alt`), el arranque, el favicon (32 y 192 px) y la portada del PDF. `public/brand/logo-gisat.png` es una copia a 512 px del archivo aportado (2048 px, 4,9 MB). | `TopBar.tsx`, `App.tsx`, `index.html` |
| 5 | **Sin modo Explorador**: las fichas de los cinco candidatos (luz, contacto con la Tierra, noche más larga; un clic selecciona) pasan a Resumen > Sitios y fechas; la nota de hibernación a Energía. `setMode` convierte `'explorer'` o cualquier valor desconocido en `'planner'`. El perfil dual de Contexto §3.4 (público y especialistas) queda cubierto por el modo tutorial y estas fichas simples. | `SiteCards.tsx`, `store.ts` |
| 6 | **Misiones Artemis III/IV y otras** en el selector, agrupadas, con fuente y «coordenada aproximada»; Chandrayaan-3 fuera de cobertura (opción deshabilitada, flecha en el mapa polar); IM-1 se analiza. Puntos por grupo en el mapa polar y el horizonte 3D, nombre solo al pasar el cursor. | `engine/sites.ts`, `PolarMap.tsx`, `SceneExtras.tsx` |
| 7 | **Emergencia en lenguaje llano**: titular SOBREVIVE / SOBREVIVE SI… / NO SOBREVIVE y bloque **Salida** siempre visible (ver abajo). | `state/exitPlan.ts`, `ExitBlock.tsx` |
| 8 | **Supuestos mejorados o borrados** y tabla **Supuestos del modelo** en la Vista de ingeniería (ver abajo). | `AssumptionsTable.tsx` |

**Criterio de pérdida del titular de emergencia.** Es el del motor, sin
umbrales nuevos: el lander se pierde cuando la batería queda vacía sin
potencia del panel (`simulateBattery`, `kpis.survives`) o, con el modelo
térmico, cuando el bus llega a −20 °C y la batería se congela
(`adv.kpis.thermalDeathH`); la hora de pérdida es `adv.kpis.survivalHours`.
«Hay sol» usa la prueba de la cuenta regresiva (`sunFrac ≥ 0,5`). Las
opciones de salida vuelven a volar la misión completa: (a) bajar la carga
mínima (bisección de 7 pasos entre 0 W y la actual), (b) el mejor de 24
puntos de una malla 5×5 a ≤ 500 m (el alcance de la caja de reubicación),
(c) la próxima muestra con sol después de la pérdida. Si nada alcanza, «qué
faltaría» es la energía almacenada mínima que salva la misión (bisección hasta
10 veces la capacidad) y las horas hasta el próximo Sol. Horizonte: una noche
lunar, ½ mes sinódico = 14,77 d redondeado hacia arriba a 15 d para que
contenga la noche entera, con selector 3 / 7 / 15 d.

**§8, mejorar o borrar.**

| Elemento | Decisión |
|---|---|
| Horizonte fijo de 14 d | `EMERGENCY_HORIZON_DAYS` = 15 d (una noche lunar, razón en el código), visible («próximos 15 d») y con selector 3 / 7 / 15 d. |
| Rangos del índice | Anclados: vista a la Tierra y luz 0–100 %; pendiente 0 – ángulo de estabilidad estática del vehículo (atan(r/h), 48° por defecto); FeO 0–20 % (suelos lunares, de tierras altas a mares). Rango en un tooltip. Rugosidad (200 m), distancia a PSR (20 km) y gravedad (300 mGal) no se pudieron anclar y salen del índice (`INDEX_CRITERIA`); el índice cubre ~52 % del peso publicado. |
| Línea de tiempo del Explorador | Eliminada con el modo. |
| Umbrales térmicos 0 / −10 / −20 °C | Sin fuente: «supuesto del equipo» en la tabla. |
| Umbrales de ventana ±25°, ±15°, ≥ 50 % | Sin fuente: «supuesto del equipo» en la tabla. |
| Vehículo por defecto (4 kWh, 180 W) | Editable en Equipo (confirmado) y rotulado «ejemplo ilustrativo». |
| Búsqueda de 60 d de Optimizar | Selector 30 / 60 / 90 d, 60 por defecto. |
| Deygout y micro-relieve | Citados en código y tabla: UIT-R P.526 (J(ν)), Deygout (1966), Trask (1966) para k = 10^−1,1; citas de memoria, sin recotejar. El resto (guarda de cresta, εr y tan δ del regolito, Hurst, pendiente RMS, cráteres 3–15 m, huella, límite de 15°): «parámetros del equipo, no validados». |
| `lib/verification.ts` y su test | Borrados. |
| Conteos de README y ARCHITECTURE | Escritos tras ejecutar vitest y Playwright (sección 9). |
| Controles de HorizonPanorama, ThermalChart, PolarMap | Revisados: el panorama solo tiene la lectura al pasar el cursor (az/el del horizonte), el gráfico térmico ninguno, el mapa polar el clic para situar el lander y el nombre del sitio al pasar el cursor. Todos con etiqueta y razón; nada que borrar. |

**Decisiones propias (lo ambiguo, resuelto con la opción más simple).**

- Duplicados de §6: se conservó la entrada existente cuando el nombre o la
  misión coincidían (Haworth, Malapert Massif, de Gerlache Rim 2, IM-2; la
  coordenada de IM-2 aportada es su objetivo original en la cresta de
  Shackleton, el mismo punto que el candidato). VIPER / Griffin se mantiene
  aparte del candidato «Nobile Crater Rim (VIPER site)» (12 km de distancia).
  IM-1 Odysseus y Chandrayaan-3 se añadieron con coordenadas de memoria.
- El proyecto no tiene ESLint: `npm run lint` es la verificación de tipos
  estricta (`tsc --noEmit`).
- La opción (a) de Salida baja la carga mínima de supervivencia; la carga de
  operación ya solo corre con el panel, así que bajarla no cambia la energía
  en sombra.
- Las capturas de la guía y la `e2e` fijan el reloj del navegador en
  2027-09-01 00:00 UTC para que los tres casos de emergencia sean
  reproducibles.

## 6.8 v3.0: puerta de entrada y entrenamiento Principiante (2026-11-14)

La v3.0 reúne dos experiencias en una app. **Mission Leader** es la interfaz
v2.1 sin cambios de comportamiento. **Principiante** es un entrenamiento
guiado de ocho misiones que maneja el estado real de la app y lo observa;
nunca simula resultados. Código nuevo en `src/beginner/`.

**Puerta de entrada.** Es lo primero en cada carga, sobre la carga del terreno,
que sigue detrás. Pregunta «¿Has usado esta app alguna vez?» y ofrece:

| Respuesta | Oferta principal | Opción secundaria |
|---|---|---|
| No | Comenzar entrenamiento | Ir directo a la versión Pro, con advertencia de dos pasos |
| Sí | Abrir Mission Leader | ¿Te olvidaste cómo funciona? (abre el entrenamiento) |

- La respuesta no se guarda.
- `?mode=leader` y `?mode=beginner` saltan la puerta (pruebas, capturas, enlaces).
- «Cambiar de versión» en la barra la reabre; desde el entrenamiento pide un segundo clic porque se pierde el progreso.
- La tarjeta de bienvenida de la v2.1 ya no se abre sola; el tutorial de 10 pasos sigue en «Guía de misión» de Mission Leader.

**Excepción acotada a «sin modales» (6.5).** La puerta, el mensaje grande con «Continuar» y el diploma son superposiciones propias a pantalla completa:
- `role="dialog"` y `aria-modal`;
- foco inicial en la respuesta;
- Esc no cierra la puerta.

Solo existen en la puerta y en el entrenamiento; Mission Leader sigue sin modales.

**Estado.**
- `experience: 'gate' | 'beginner' | 'leader'`.
- `unlocked`: subsistemas abiertos. En Mission Leader son siempre todos; `setUnlocked` no puede cerrarlos fuera del entrenamiento.
- `nowOverride`: «ahora» del flujo de emergencia, solo en el Principiante.
- Al salir del entrenamiento (diploma o «Salir al Pro» confirmado) se liberan los candados y se limpian actitud, equipo, relevo, mástil y `nowOverride`; se conserva el sitio validado.

**Director (`Beginner.tsx`, `script.ts`).** Cada paso es una entrada
declarativa con estos campos:
- `enter`: lleva la app al estado del paso.
- `say`: narración leída del motor al dibujar.
- `focus`: selector, la vista 3D o nada.
- `allow`: gestos permitidos en la vista 3D.
- `click` o `until`: la acción real que cierra el paso.
- `auto` (narración temporizada) o `cont` (botón «Continuar»).
- `doIt`, `hint`, `sfx`, `reveal` y `unlock`.

La capa de foco oscurece todo salvo el objetivo con cuatro paneles que reciben el puntero y responden con una microayuda; reutiliza el foco que sigue al objetivo del tutorial v2.1. En los pasos 3D, un filtro en fase de captura deja pasar solo los gestos del paso. A los 15 s sin avance el foco late; a los 45 s aparece «Hazlo por mí», que ejecuta la acción esperada. `?tutorialSpeed=fast` (solo pruebas) divide los tiempos por 10. El HUD vive en la barra superior para no tapar nunca un objetivo: ocho sellos de misión, sonido, volumen, subtítulos, repetir paso y salir al Pro.

**Candados.** `SubsystemSwitch` muestra un candado y rechaza un subsistema bloqueado con una sacudida de 400 ms y «Aún no: completa la misión actual». El desbloqueo da un destello, un sonido y la etiqueta «¡Nuevo!». Lo que aún no se ha revelado (pestañas, bandejas, veredicto, control de tiempo, selector de modo) queda oculto por CSS según `data-reveal`.

**Sonido (`audio.ts`).**
- Solo WebAudio procedural, sin archivos, licencias ni red.
- El `AudioContext` nace con el clic de la puerta y se cierra al salir del entrenamiento.
- Diez efectos, cada uno con su subtítulo, visible con el sonido apagado o con «Subtítulos».
- Silencio, volumen y subtítulos persisten en `clps.beginner.sound`.
- La e2e reemplaza el audio por un registro (`window.__clpsAudioMock`).

**Fotosensibilidad.**
- La alerta roja ocupa solo un borde y late 2 veces por segundo durante 1,5 s; luego queda fija.
- La pista late 1 vez por segundo. Todo queda por debajo de 3 Hz (WCAG 2.3.1).
- Con `prefers-reduced-motion`: borde fijo, sin latidos ni sacudidas.

**Escenarios (`scripts/find-tutorial-scenarios.ts`, `src/beginner/scenarios.ts`).**
Se buscan con el motor real (`npm run find-scenarios`), solo sobre los seis
sitios cuyo LOLA de 20 m viene en `public/dem/`, así que el entrenamiento no
usa red. `src/beginner/__tests__/scenarios.test.ts` revalida cada condición.
Valores medidos (narrados en vivo, no copiados):

| Misión | Escenario | Lo que dice el motor |
|---|---|---|
| 0 | Cresta de Shackleton, 2027-04-27 18:00 UTC | Paneles a 90 W al alunizar (12 % de su máximo); máximo de 731 W en T+36 h; el enlace con la Tierra se cierra 21 h después. |
| 1 | IM-2 Athena, 2027-01-03 | Sin luz y sin enlace al alunizar, veredicto crítico; la búsqueda de 60 días halla ventanas. |
| 2 | Malapert Massif, +350 m E, +414 m N | Pendiente 16,7° (roja en el mapa); terreno de 0,8° y vuelco 0,3 % a 101 m. |
| 3 | Cresta de Shackleton, 2027-03-08 | Paneles a 2 m: el bus llega a −20 °C en T+309 h. En el mástil de 10 m sobrevive. |
| 4 | Cresta de Shackleton, 2027-01-01 | Enlace directo el 50 % del tiempo, silencio de 167 h; con el relevo, 100 %. |
| 5 | Cresta de Shackleton, 2027-09-01, antena fija | Con la inclinación de IM-1 la descarga cae de 35 % a 7 %; con 20° de cardán vuelve a 35 %. |
| 7 | Nobile Crater Rim, «ahora» = 2027-09-01, 4000 Wh | Se pierde en T+65 h; moviéndose 250 m al E sobrevive los 15 d. |

**Discrepancias del guion con la app, y cómo se resolvieron.**

| Guion | Resolución |
|---|---|
| «Cénit» | En el polo el Sol no sube; «mejor posición» es la hora de máxima potencia de los paneles en las 36 h siguientes, narrada con su valor. |
| Primer alunizaje en un sitio Apolo | Fuera de 80–90° S: cresta de Shackleton. |
| Comparador A/B, «Escenario B» | Bloque **Comparar** de Ventanas de aterrizaje, con «Adoptar este sitio» (nuevo). |
| Hidrógeno, «9 criterios SOM-RF» | El índice v2.1 pondera 4 criterios con rango anclado (vista a la Tierra, luz, pendiente, FeO); la narración dice eso. |
| «Contingency» como 5.º subsistema | Es la bandeja «Actitud y vuelco» de Terreno / alunizaje; Ciencia se desbloquea al superar la misión 5. |
| Mástil 2 → 10 m | Selector real «Altura de paneles y antena» (2 m o 10 m), en Equipo. |
| Gimbal «0°–45°», «35°» | Control real «Rango del cardán de antena», 0–60°, ya modelado por el motor (desalineación fuera del rango). La nave del escenario parte con la antena fija (0°) y el valor que basta lo da el motor (20°). |
| Temperatura «−228 °C», «140 W» | El motor no da esas cifras: se narra la hora del congelamiento, las horas de calefactores, la energía con y sin mástil y la temperatura mínima del bus. |
| «Enlace 0 kbps / Eb/N0 negativo», «2,0 Mbps» | Se narra el % del tiempo con enlace, el silencio más largo y la tasa lander-relevo configurada. |
| Puntuación «38 → 88/100» | Se narra la puntuación real del índice para cada sitio. |
| Emergencia: «NO SOBREVIVE» al inicio | El motor responde «SOBREVIVE SI… se mueve 250 m al E»; el titular real se lee en pantalla. |
| «Ejecutar reubicación de escape» | Botón del bloque Salida, rotulado «Ejecutar esta salida» (antes «Mover ahí»). |
| Libración «la Tierra descendió tras la montaña» | Se explica en general; el panorama de horizonte muestra el perfil real. |

**Rediseño de la experiencia (2026-11-15).** Primera revisión del usuario: faltaba la cinemática inicial, los textos pasaban rápido y eran pequeños, el módulo 3D no cambiaba, no se oía sonido y nada invitaba a seguir. Cambios:

- **Cinemática inicial (`Intro.tsx`, WebGL).** La Luna real gira (mosaico de color LRO LROC WAC y relieve LOLA como mapa de relieve, dominio público, NASA SVS CGI Moon Kit; ver `public/beginner/SOURCES.md`). Se inclina al polo sur y la cámara se zambulle hasta un casquete con el relieve LOLA real de la app (80–90° S, sombreado), que reemplaza al polo estirado del mapa global. Un temporizador la termina aunque la página deje de dibujar. Luego, en la escena 3D real, el módulo desciende desde unos 600 m con rugido de motor, toca suelo con golpe y anillo de polvo, y despliega el panel solar. «Saltar» siempre visible; la distancia a la Tierra sale de las efemérides del motor.
- **Modelo 3D (`SceneObjects.tsx`, `landerAnim`).** El panel se pliega y despliega. El mástil sube cuando se elige 10 m: refleja la configuración real también en Mission Leader. Durante el aterrizaje el módulo se muestra más grande y luego vuelve a su tamaño.
- **Canal CAPCOM.** Panel grande abajo (texto de 17 a 20 px) que «transmite» la narración con efecto de máquina de escribir y onda animada. El ritmo lo pone el usuario con «Continuar»; ningún texto avanza solo. En los pasos de acción aparece «Tu turno»; después vienen la pista y «Hazlo por mí».
- **Portada de misión e insignias (`Patch.tsx`).** Cada misión abre con su insignia bordada (colores de la insignia GISAT), objetivo y recompensa. Cada misión cerrada se celebra con la insignia que se cose, estrellas (3 sin ayuda, menos con «Hazlo por mí»), +100 XP, la consola desbloqueada y el adelanto de la siguiente. El diploma reúne las 8 insignias.
- **Sonido.** Corregido el defecto de la primera versión: el `AudioContext` se cerraba en el doble montaje de React StrictMode, así que no sonaba nada. Ahora hay 17 efectos (motor, golpe, despliegue, servo del mástil, objetivo, fanfarria, puntos, paso de escena…), un tono suave por letra y música ambiental espacial generativa (pad filtrado y campanas pentatónicas con eco), desactivable y recordada.
- **Pestañas en orden de desbloqueo** durante el entrenamiento: Resumen, Terreno, Energía, Comunicaciones, Ciencia.
- La barra superior queda siempre usable (el oscurecido empieza bajo ella) y los controles del entrenamiento son botones de ícono con su nombre en `title` y `aria-label`.

**Cambios compartidos (§4) y su prueba en Mission Leader.**
- `experience` y la puerta: Mission Leader se abre con `?mode=leader` y pasa la misma e2e de la v2.1, ajustada solo en la tarjeta de bienvenida, que ya no existe.
- Candados: `unlocked` siempre completo fuera del entrenamiento (`store.test.ts`).
- `nowOverride`: `null` fuera del entrenamiento.
- «Adoptar este sitio» en Comparar.
- Rótulo «Ejecutar esta salida».
- `data-testid` en las capas de la vista 3D y en el cardán.
- `camProbe` (adónde mira la cámara) en `sceneMath.ts`.

## 6.9 v3.1: guion expandido, bloqueo de acciones, insignias y animaciones (2026-11-15)

**Correcciones obligatorias.**
1. **Misión 0 sin sombreado.** En los pasos de cámara libre (buscar el Sol, zoom, buscar la Tierra) la vista 3D queda limpia. Lo que rodea al lienzo se bloquea con paneles transparentes, sin oscurecer. El foco oscuro aparece por primera vez con el control de tiempo.
2. **Bloqueo de acciones.**
   - Puntero: fuera del objetivo, cuatro paneles reciben el puntero y responden con una microayuda; en la vista 3D solo pasan los gestos del paso.
   - Teclado: Tab devuelve el foco al objetivo; Enter y Espacio fuera de él se anulan.
   - La barra de entrenamiento (sonido, salir) sigue usable.
3. **Emergencia aislada.** La bandeja derecha de Terreno / alunizaje ya no contiene el flujo de emergencia. Ahora es **Dispersión y escape**: la malla 5 × 5 a 200 m con su vector de escape (`DispersionBlock`, compartido con el paso 3 del modo Emergencia) y la incertidumbre del terreno LOLA. Esto aplica también a Mission Leader, cuyo tutorial y guía se actualizaron. En el Principiante, el selector de modo (y con él Emergencia) solo se revela al iniciar la misión 7.
4. **Sin estrellas ni XP.** Cada misión entrega una **insignia con el ícono de su subsistema** (`Badges.tsx`). La fila de insignias de la barra superior parte con ocho siluetas tenues, y cada insignia encaja con un brillo metálico al ganarla. El diploma reúne las ocho.
5. **Desplazamiento.**
   - Al empezar un paso, su objetivo se centra con `scrollIntoView({ block: 'center' })`.
   - La rueda sobre la zona bloqueada desplaza el panel que contiene el objetivo.
   - El halo sigue al objetivo en cada cuadro, aunque el panel se desplace o la ventana cambie de tamaño.
6. **Ventanas y animaciones.**
   - Ventanas de cristal esmerilado (`backdrop-filter`) con brillo cian en la narración y ámbar en las acciones, ícono de Flight Director y entradas con curva elástica.
   - En 3D: la actitud (presets y deslizadores 6-DOF) se interpola, y el seguidor solar y el plato de antena giran con suavidad.
   - Toda reubicación (arrastre, doble clic, mejor celda, «Ejecutar esta salida») es un salto propulsado en arco con anillo de polvo al tocar suelo.
   - Pulsos de luz bajan por la dirección del Sol hasta el panel, y las ondas de radio salen hacia la Tierra y, con relevo, también hacia la órbita.
   - Con `prefers-reduced-motion`, todo es inmediato.

**Guion expandido (Anexo A) sobre los controles reales.**

| Misión | Subtareas |
|---|---|
| 1 | Fecha inviable; búsqueda de 60 días; motivos de rechazo (deslumbramiento y lavado, contados por el motor); rumbo de aproximación y nueva búsqueda; la narración dice si el rumbo mejoró o empeoró; Vista lander y signos vitales. |
| 2 | Mapa de pendientes y reubicación; malla de dispersión 5 × 5; error de altura RMS y variantes de terreno; mejor celda. |
| 3 | Cursor de la línea de tiempo hasta el primer tramo oscuro; mástil de 10 m; montura de seguidor de 1 eje (la nave parte con panel horizontal); capacidad de batería y nota de hibernación. |
| 4 | Horizonte 360° y paso del cursor; difracción Deygout y pérdida extra (valores del motor); banda X; estación terrena; telemetría; relevo orbital. |
| 5 | Preset IM-1; cardán de antena (y guiñada); activo vecino y distancia hasta salir del radio de exclusión de la pluma. |
| 6 | Índice de aptitud y sus rangos; Comparar con Malapert; Adoptar este sitio; Optimizar sitio y fecha (solo si el veredicto no está en verde); tabla de supuestos y Exportar CSV. |
| 7 | «Quedamos apoyados en la pendiente»; peligros bajo el píxel; titular y bloque Salida; Ejecutar esta salida. |

**Adaptaciones del guion a la app real.**
- Los modos «Engineering first / Science first» y el botón «Engineering on» no existen desde la v2.0. El paso de pesos se cambió por los rangos anclados del índice (en el tooltip), y «Engineering on» por la telemetría.
- «Mons Mouton Plateau» no tiene relieve de 20 m sin red, así que se usa Malapert Massif.
- Las cifras del guion (110°, 1,0 m, 5000 Wh, 35°, 2100 m, 41 y 87/100) se sustituyen por condiciones y valores que da el motor.
- En la misión 1, el rumbo que el usuario elija puede empeorar el deslumbramiento, y la narración lo dice.

## 6.10 v3.1 final: entrega NASA Space Apps Concepción (2026-11-15)

Cierre de los requisitos SR del XMind y de los riesgos R1–R12 que dependían de la app. Ninguna cifra nueva sale de fuera del motor: lo que se agregó lee el resultado de la misión o fórmulas puras de `src/engine/`.

| Requisito | Qué se hizo | Dónde |
|---|---|---|
| SR-403 | Elevación solar efectiva como KPI de potencia: elevación ahora y máxima de la ventana, disco visible f☉, factor de incidencia de la montura, potencia ahora / pico, arco de 0–5°. En Signos vitales, en la tabla de KPI (fila «Elevación solar máx.») y en la cabecera de Energía / térmico. | `engine/solarKpi.ts`, `components/SolarKpi.tsx` |
| SR-711 | `unitSystem: 'si' \| 'imperial'` en el store, recordado en `localStorage` (`clps.units`, `?units=imperial` lo fuerza). Selector junto al idioma en la puerta («Unidades: SI (m, °C) \| Imperial (ft, °F)») y en la barra superior (SI / IMP). Cambian longitudes, distancias, temperaturas, velocidades y áreas en tarjetas, deslizadores, ejes, etiquetas 3-D y narración; W, Wh, GHz, tasas, dB y ángulos no. El motor y el CSV siguen en SI. | `lib/units.ts`, `components/UnitToggle.tsx` |
| SR-502, SR-708 | Ventana «Aprender más: Física Lunar vs. Tierra» con siete temas (cielo y Sol rasante; por qué 200 m lo cambian todo; frío radiativo; radio, libración y curvatura; polvo balístico; trampas frías; resumen maestro). Dos columnas Tierra / Polo Sur, un diagrama SVG y cifras calculadas: Sol máximo por latitud y oblicuidad, horizonte y caída por curvatura, σT⁴, alcance balístico, velocidad de vuelco con g lunar y terrestre, la malla de dispersión real de la misión. Botón grande en cada celebración y en el diploma; botón discreto en la barra de subsistemas de Mission Leader. | `engine/earthMoon.ts`, `components/LearnMore.tsx` |
| SR-204 | Telémetro del cursor sobre todo el terreno 3-D: distancia (m / km o ft / mi con separador de miles) y rumbo desde el lander, elevación y pendiente bajo el cursor; ámbar fuera del cuadro de ±500 m; línea punteada lander → cursor. | `3d/SceneExtras.tsx` (`DoubleClickLand`) |
| SR-104, R1, R5 | Bloque «Límites de los datos topográficos LOLA (Barker et al. 2023)» en Terreno › Dispersión y escape, en el paso 3 de Emergencia y en la tabla de supuestos. Las resoluciones y parámetros salen de las constantes del motor. | `components/DataLimits.tsx` |
| R2 | Ya cumplido desde la v2: las corridas de incertidumbre dan P10 / P50 / P90 de luz, Tierra a la vista, descarga, tiempo con vida y datos. | `engine/uncertainty.ts`, `EngineeringView.tsx` |
| R8, SR-101 | Contraste con mapas publicados: coordenada de referencia del enunciado y luz calculada junto a la iluminación anual publicada (`PUBLISHED_ILLUMINATION`). | `engine/sites.ts`, `DataLimits.tsx`, `SiteCards.tsx` |
| SR-706 | Glosario de 16 términos, una sola fuente para los tooltips y para la sección final de ambas guías (`scripts/glossary-md.ts`). Tooltips en la narración del Principiante (hover y foco de teclado). | `lib/glossary.ts`, `components/Glossary.tsx` |
| R6 | La búsqueda de rescate / optimización es un generador puro; corre en un Web Worker o, si no hay workers, en tramos de 24 ms en el hilo principal. Poda temprana: puntos más empinados que el ángulo de estabilidad estática no se vuelan, y el paseo por fechas se detiene en la primera que deja de ser NO-GO. | `engine/rescue.ts`, `state/rescue.worker.ts`, `state/verdict.ts` |
| SR-710 | Prueba unitaria del CSV: 26 columnas, una fila por muestra, unidad en el nombre de cada columna, cabecera `# units=SI … display_units=…`. | `lib/__tests__/final.test.ts` |
| SR-704 | Cambiar de versión conserva escenario, idioma y unidades. Botones de la puerta: «Comenzar entrenamiento (Modo Guiado)» y «Abrir Mission Leader (Modo Completo)». | `beginner/Gate.tsx` |

**Sin conexión y en cualquier PC.** Todos los datos esenciales están versionados (`public/dem`, `public/science`, `public/beginner`, `public/brand`, `public/guide`, `data/horizons`); `.gitignore` solo excluye `node_modules`, `dist`, logs y `artifacts`. No hay rutas absolutas en el código ni en los scripts. La app no necesita `.env` (`.env.example` documenta la única variable opcional). La e2e corta toda petición que no sea local, comprueba que no hubo ninguna ni respuestas 4xx en el build de producción, y luego usa `context.setOffline(true)` para verificar que la vista 3-D, las consolas y la ventana de comparación siguen funcionando sin red.

**Límites que se declaran en vez de inventar.**
- **Iluminación publicada por sitio.** Ningún valor se ha verificado contra el artículo, así que la app dice «sin dato verificado» y nombra Mazarico et al. 2011, Bussey et al. 2010 y De Rosa et al. 2012. Un valor solo puede llenarse junto con su referencia (prueba unitaria).
- **Píxeles interpolados.** La fracción interpolada entre trazas LOLA no se calcula: el bloque dice «la mayoría» y que varía por sitio.
- **Rugosidad.** El prompt atribuía el coeficiente 0.079 a Rosenburg et al. 2011; el motor lo atribuye a Trask 1966 (citado de memoria) y así se muestra.
- **Interpolación bicúbica (R1).** No se aplicó sobre las mallas de 20 m: cambiaría los horizontes, los escenarios del entrenamiento validados y los 175 tests sin una medición que lo justifique. El muestreo sigue siendo bilineal, y el límite se declara en el bloque LOLA.
- **Pesos del índice.** Los modos «Engineering first / Science first» siguen sin existir (ver 6.9); el índice multicriterio se explica en el glosario como «Índice SOM-RF» con su advertencia.

## 6.11 Video pitch de 3 minutos (`?pitch=true`, 2026-11-15)

Reproductor de presentación sobre la app real, a 1920 × 1080, y grabador a video.

- **Línea de tiempo** (`src/pitch/timeline.ts`, pura y probada): 180,0 s en seis actos (0:00 gancho, 0:25 propuesta, 0:45 entrenamiento, 1:20 Mission Leader, 2:15 emergencia, 2:40 cierre) y diecisiete escenas; las cinco de Mission Leader duran 11 s cada una. Cada escena trae su línea de teleprompter ES / EN; las cifras se rellenan en vivo (`{head}`, `{move}`, `{tests}`) y una prueba impide escribir números a mano.
- **Director** (`src/pitch/director.ts`): por escena, un `enter` que deja la app en su estado inicial (sitio, fecha, equipo, consola, cámara, efectos) y señales temporizadas (preset IM-1, mástil 2 → 10 m, seguidor solar, estación GISAT, relevo, cardán, activo vecino, «Optimizar», «Ejecutar esta salida»). Saltar con ← / → ejecuta `enter` y las señales hasta ese instante, así que el estado siempre es coherente. Los escenarios son los del entrenamiento (`src/beginner/scenarios.ts`), validados con el motor.
- **Capas** (`src/pitch/PitchShow.tsx`): tipografía cinética, odómetros, chips y etiquetas ancladas al lander, con valores leídos del motor (inclinación y datos perdidos, temperatura del bus, elevación solar, disponibilidad del enlace, radio de exclusión, veredicto y titular de emergencia del DOM real). HUD (ocultable con H): barra con las marcas 0:00 · 0:25 · 0:45 · 1:20 · 2:15 · 2:40 · 3:00, reproducir / pausa (Espacio), reiniciar (R), escena anterior / siguiente (← / →), ES / EN, subtítulos (C), sonido (M), grabar y salir.
- **Sonido** (`src/pitch/pitchAudio.ts`): pad espacial procedural, pulso de telemetría e intensidad por acto (crescendo en V–VI); efectos de los sintetizadores del entrenamiento, con contexto y silencio propios.
- **Grabación**: el botón «Grabar video (1080p)» captura la pestaña (video, capas y sonido) con `getDisplayMedia` + `MediaRecorder` y descarga un WebM. `npm run record-pitch` hace lo mismo sin intervención (Chromium con la captura de pestaña autoaceptada; si no está disponible, la grabación de Playwright sin sonido) y, con ffmpeg (`FFMPEG_PATH` o en el PATH), escribe además un MP4 H.264 en `public/pitch/`.
- **Verificación**: `npm run e2e:pitch` reproduce los 180 s en tiempo real en Chromium headless y comprueba orden de escenas y actos, duración exacta, cuadros por segundo, el rescate que cambia el titular a SOBREVIVE, los efectos de sonido, ES / EN, ← / →, H, las marcas, cero peticiones a internet y cero errores de consola.

**Lo que el brief pedía y se reemplazó por datos verificables.**
- «Solo el 5,08 % del Polo Sur es viable»: la app no calcula esa cifra; el acto I muestra tres valores del motor (Sol máximo por latitud y eje lunar, caja de libración, caída del horizonte 3,7 veces más rápida).
- «INCOSE Verified»: no hay tal verificación; el sello dice «Trazado a SR-101…SR-711».
- «41 → 88/100», «NO SOBREVIVE en 18 h», «280 m al noreste», «31 % de margen», «1,42° máx», «1,420 m»: se muestran los valores que da el motor en cada escena.
- «100 % de requisitos SR» y «120+ tests»: el cierre muestra los recuentos reales de la última verificación (`src/pitch/facts.ts`).
- «~90 % interpolado» y «concordancia con Bussey et al.»: no verificados (ver 6.10); el cierre remite a los supuestos y límites que la app muestra.
- Estación GISAT UdeC 3,7 m: se nombra como hipotética, igual que en el motor.
- IM-1: el preset de 30° se aplica al caso de inclinación del entrenamiento (Shackleton), donde el motor muestra la caída del enlace; en Malapert el mismo preset apenas cuesta datos, y la pantalla dice dónde se aplica.

## 7. Interfaz

**Paleta y tipografía** según el enunciado: fondo `#080B11`, paneles `#111827`,
bordes `#1E293B`; cian (`#06B6D4`) solo para RF/DTE, ámbar solo para energía solar, rojo
solo para ocultación o estado crítico. Esmeralda (`#10B981`) para la operación
simultánea Sol + DTE. JetBrains Mono para toda lectura numérica y B612 (la
tipografía de cabina de Airbus) para etiquetas y texto.

**Modo Mission Planner.** Un escenario de alunizaje y, a demanda (bloque
Comparar de Ventanas de aterrizaje), un segundo escenario B con su propio sitio,
coordenadas, relocalización y ventana de fechas, de modo que se comparan
sitios, fechas o ambos. Matriz de KPIs con marca del mejor valor, presupuesto de
enlace, panorama de horizonte, línea de tiempo sincronizada por tiempo
transcurrido y telemetría instantánea.

El Planner es un espacio de trabajo con paneles acoplados, no un tablero fijo:
la vista 3D está siempre visible y lo demás se abre a demanda desde la barra
lateral (dock). Hay tres zonas, cada una con una pestaña abierta a la vez o
minimizada: configuración a la izquierda (sitios y fechas / equipo), análisis a
la derecha (comparación / enlace) y gráficos abajo (ventanas de misión /
panorama de horizonte). La telemetría y la leyenda de la escena también son
opcionales. Por defecto solo se ven la configuración del sitio, un resumen de
cuatro cifras A/B y la línea de tiempo. La disposición se recuerda en
`localStorage`.

**Decisión.** Paneles acoplados con pestañas en vez de ventanas flotantes
libres: no se tapan entre sí ni tapan el lander, y no hay que ordenarlas.

**Público y docentes** (perfil dual exigido por Contexto §3.4). Hasta la v2.0
lo cubría un modo Explorer aparte. En la v2.1 lo cubren el modo tutorial (diez
pasos que conducen la interfaz) y las fichas simples de los cinco sitios en
Resumen > Sitios y fechas (luz solar, contacto con la Tierra, noche más larga),
sin un modo propio (sección 6.7).

**Idiomas.** Inglés y español, conmutables en la barra superior.

**Vista 3D.** Escala real sin exageración vertical. Sol y Tierra en sus
direcciones y tamaños angulares reales sobre una esfera a 55 km. El anillo de
horizonte alrededor del lander es un instrumento az/el con la elevación
exagerada ×5 (rotulado), porque 2° reales no se distinguen. Dos cámaras:
órbita y vista desde el lander (la vista «Mapa» se quitó en la v2.0).

### Decisiones sobre las skills pedidas

- `frontend-design`: aplicada (paleta del enunciado, color con significado,
  sin tarjetas genéricas ni gradientes decorativos).
- `webapp-testing`: se siguió su método (reconocer, actuar, capturar) pero con
  Playwright para Node en lugar de Python, para que la verificación viva en el
  mismo proyecto y se ejecute con `npm run e2e`.
- `web-artifacts-builder`: **no se usó.** Genera un único HTML para artefactos
  de claude.ai con Parcel, Tailwind y shadcn/ui. Este proyecto necesita un
  build de Vite con three.js y un motor testeable; forzar ese empaquetado
  habría sido peor ingeniería.

## 8. Rendimiento

Medido en el build de producción con `npm run perf` (Radeon 780M integrada):

| Situación | Con vsync | Sin límite de cuadros |
|---|---|---|
| Planner en reposo | 60,0 fps, 0 cuadros > 25 ms | ~1340 fps |
| Planner reproduciendo (barrido de sombras cada cuadro) | 60,0 fps, 0 cuadros > 25 ms | 350–390 fps (2,5–2,8 ms/cuadro) |
| Explorer reproduciendo (v2.0; modo retirado en la v2.1) | 60,0 fps, 0 cuadros > 25 ms | ~270 fps |

Relocalización: 33–45 ms desde el cambio hasta dos cuadros pintados, incluyendo
horizonte, series, KPIs y repintado.

**Nota sobre la medición.** Con el backend ANGLE D3D11, Chromium headless en
Windows pausa su planificador de vsync unos 450 ms cada uno o dos segundos,
incluso en una página vacía. No hay tareas largas asociadas y desaparece al
quitar el límite de cuadros, así que no es de la aplicación. Por eso la medida
con vsync usa el backend ANGLE GL. No se pudo lanzar un Chromium con ventana en
esta sesión; conviene confirmar los 60 fps en un navegador normal.

Qué lo hace posible: series independientes del sitio, muestreo de malla en
línea en el bucle de horizonte, barrido de sombras a la resolución de la malla
visible, capa base de los gráficos 2D en caché (solo el cursor se repinta) y
precompilación de shaders al montar la escena.

## 9. Verificación

| Comando | Qué comprueba | Resultado |
|---|---|---|
| `npm run typecheck` / `npm run lint` | `tsc --noEmit`, modo estricto | sin errores |
| `npm test` | 181 tests: motor, JPL Horizons, terreno LOLA, relays, contingencia, capas, evoluciones v3, ventanas, v4 (banda 80–90° S, parches de 20 m, micro-relieve, veredicto), catálogo de sitios, titular y salida de emergencia, rangos del índice y tabla de supuestos, modo heredado, exportación, umbrales de telemetría y etiquetas sin abreviar | 181/181 (v3.1 final: unidades, CSV, KPI solar, Tierra vs. Luna, glosario, iluminación publicada, búsqueda de rescate; línea de tiempo del video pitch) |
| `npm run build && npm run e2e` | 170 comprobaciones en Chromium headless sobre terreno LOLA: 13 del video pitch (`e2e:pitch`), 132 de Mission Leader (`e2e:leader`, incluye unidades, KPI solar, telémetro, Aprender más, límites LOLA, Web Worker, cero peticiones externas, cero 404 y `context.setOffline(true)`) y 25 del Principiante (`e2e:beginner`) | 13/13, 132/132 y 25/25 |
| `npm run perf` | ritmo de cuadros con y sin vsync | tabla de la sección 8 |
| `npm run guide` | capturas reales de la app (ES y EN) y la guía PDF desde `docs/` | `docs/img/`, `public/guide/*.pdf` |
| `npm run measure-micro` | costo del peligro bajo el píxel, LOLA real | peor caso 93 ms |

`npm run e2e` cubre: arranque, escena no vacía, solapamientos y textos
recortados, 60 fps (reposo, reproducción, bandejas de cristal,
Emergencia), insignia y favicon, barra superior y transporte en la vista 3D, pestañas a todo el
ancho y su transición de ~1 s con el ícono visible ≥ 350 ms (también con
movimiento reducido y con clics durante la transición), un solo escenario por defecto y el bloque Comparar (B como copia,
sitio y fechas, sin rastro al apagarlo), relocalización por deslizador,
arrastre y doble clic (pista y retículo), mapas de cobertura, cámaras,
telemetría agrupada, Vista de ingeniería, flujo de emergencia compartido,
exportación CSV, guía PDF, modo tutorial (aviso, diez pasos que conducen la
interfaz, restauración del estado), etiquetas de sitio completas, fichas de
sitios sin modo Explorer, tabla de supuestos, rangos del índice, selector de
Optimizar, peligros bajo el píxel sin casilla (< 300 ms), los tres casos de
emergencia (sobrevive / sobrevive si… / no sobrevive) en ES y EN con el reloj
fijo, idioma, 1280×720, 820 px y consola sin errores. Deja las capturas en
`artifacts/screenshots/` y el detalle en `artifacts/verify-report.json`.

## 10. Límites conocidos

- Resolución del terreno (sección 4.4).
- Las coordenadas personalizadas se aceptan entre 80° S y 90° S. Fuera de los
  sitios precompilados el terreno de 20 m se lee bajo demanda y depende de un
  proxy o espejo con CORS (sección 6.4); sin él queda en 160 m u 800 m.
- El micro-relieve sub-píxel es estadístico; salvo la densidad de cráteres
  (Trask, 1966) sus parámetros son del equipo, no validados (sección 6.7).
- La verificación e2e (170 comprobaciones) no necesita red; la lectura del
  parche de 20 m en vivo (`scripts/verify_cog_stream.ts`, aparte) sí.
- Muestreo horario. Los eventos más cortos que una hora se promedian.
- La distancia del enlace es al centro de la Tierra, no a una estación concreta
  (±6400 km, 0,15 dB), y no se modela la visibilidad de la estación desde la
  Tierra: se asume una red con cobertura continua.
- El panel horizontal se supone nivelado; no se inclina con la pendiente.
- En la vista 3D el horizonte lejano se toma del lander y se aplica a todo el
  mosaico; los mapas de cobertura son indicativos lejos del lander. Los KPIs no
  usan esa aproximación: salen del perfil de horizonte completo.

## 11. Entorno de la sesión

La máquina no tenía Node.js. Se descargó el zip portable oficial v22.23.4 de
nodejs.org, verificado contra `SHASUMS256.txt`, y se descomprimió en
`C:\Users\JoseJ\tools\`. No se modificó el PATH del sistema ni se instaló nada
con privilegios. `run-dev.cmd` lo usa si no encuentra Node en el PATH.
Playwright descargó su Chromium en `%LOCALAPPDATA%\ms-playwright`.
