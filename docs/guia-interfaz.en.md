# Interface guide — CLPS Lunar Mission Browser v2.0

GISAT UdeC · NASA Space Apps 2026 · Lunar South Pole landing site navigator

This guide describes every button and panel of version 2.0, interface by interface, and how to use the application depending on who uses it: an engineer planning a mission, the general public or a teacher (tutorial mode and site cards), and a team facing an unplanned touchdown (Emergency mode).

> The figures come from this project's own physical model on the LRO LOLA terrain. They are meant to compare sites, dates and lander designs; they are not the certified prediction of a real mission. Thresholds labelled "engineering assumption" are choices of this tool.

## 1. Top bar

From left to right:

| Control | What it does |
|---|---|
| Brand | Name of the application and of the team. |
| Planner / Emergency | Switches the application mode (sections 2 and 10). |
| UTC clock and T+ | Date and time of the time cursor, and the time elapsed since touchdown. |
| Mission guide | Starts the tutorial mode (section 8). A notice with Start / Cancel comes first. |
| Export CSV | One click downloads the simulated telemetry of the mission on screen: 26 columns in SI units, one row per hour. |
| EN / ES | Language of the whole interface. |
| Guide (PDF) | Opens this guide in a new tab, in the active language. |

## 2. Planner: the console

The planner is the working view. The verdict is at the top; below it the 3-D view fills the screen and the panels float over it as glass trays that never resize it. The camera re-centres on the free area so the lander is never covered.

### 2.1 Verdict

One line in plain language: **GO**, **CAUTION** or **NO-GO**, with the main cause and the day it happens. When it is not green, **Optimise site and date** tries the 25 touchdown points within 200 m, then the following dates, and moves the lander to the first one that survives. It shows the before and after, how many missions it flew and how long it took. When nothing saves the mission, it says so.

### 2.2 Subsystem tabs

Five tabs span the whole width. Each brings its panels, its colour and what the 3-D scene emphasises. Switching tabs fades the interface to black, shows the icon of the subsystem and brings the console back with its layer applied (about one second; with the system "reduce motion" setting nothing moves: fades only).

| Tab | Colour | Left | Right | Bottom | 3-D scene |
|---|---|---|---|---|---|
| Overview | emerald | Sites and dates | Vitals, Landing windows | Mission windows | Shadows |
| Power / thermal | amber | Hardware: power and thermal | Energy and survival | Power and temperature, Mission windows | Sun hours, Sun shaft |
| Comms / RF | cyan | Hardware: radio and relays | Link budget | Horizon 360°, Mission windows | Earth view, Earth beam in focus |
| Terrain / landing | light grey | Attitude and tip-over | Emergency: survival | Horizon 360°, Mission windows | Slopes, escape arrow |
| Science | violet | Sites and dates | Suitability index, Engineering view | Detailed timeline | Shadows |

Every tray has a **(?)** with a one-sentence explanation and a **—** button that minimises it; the tab left on the edge opens it again.

### 2.3 3-D view

* **Drag** to orbit the camera; **scroll** to zoom.
* **Drag the lander** to move it inside the ±500 m dashed box. Every position is a new mission.
* **Double-click the terrain**: within ±500 m it moves the lander; farther away it creates a custom site. While the pointer moves, a reticle says what will happen: "Move the lander (X m)" or "Create a custom site here". North of 80° S the reticle turns red and a double-click shows "Outside the area". The hint at the bottom recalls this and is hidden with the **×** (remembered).
* **Orbit / Lander eye**: outside camera or from the lander mast.
* **Shadows / Sun hours / Earth view / Slope**: colour layer on the terrain, with its scale.
* **Legend**: explains every symbol of the scene.
* Top left: full site name, coordinates, height, slope and the lander offset (ΔE, ΔN), with **Return to nominal point** once it moved.
* The names of the landforms float above the skyline with their distance.

### 2.4 Time transport (in the 3-D view)

Bottom centre: **−1 h**, **Play / Pause**, **+1 h** and the rate: **1**, **24** or **72 h/s** (24 by default). To jump farther, drag along the timeline.

### 2.5 Telemetry

The **Telemetry** chip (open / closed, remembered between visits) shows what the lander would report at the time on the clock, in four groups:

* **Sun**: Sun visible (% of the disc) and Sun height.
* **Energy**: solar panels and battery.
* **Thermal**: electronics temperature and heaters.
* **Earth link**: Earth above the terrain, ground station, link margin (how much signal is left over the minimum) and data rate.

Green, amber and red follow thresholds defined in one place: battery below 40 % and 20 %, electronics below 0 °C and −20 °C, margin below 3 dB and 0 dB. Hovering a reading shows its explanation. Science adds the technical readings: solar azimuth, line-of-sight clearance, excess loss and Earth angles.

## 3. Overview panels

### 3.1 Sites and dates

A single landing scenario: **site** (five candidates, two real landings or custom coordinates), **window start** (UTC), **length** (1–180 days) and the **offset** east and north. It shows the site description, its coordinates, the distance to the brief coordinate and the terrain source (LRO LOLA and its resolution). Site names are always shown in full.

### 3.2 Vitals

Three large cards counted from the time on the clock: **continuous sunlight** left, **Earth link window** open or closed (and when it changes) and **time to freeze**.

### 3.3 Landing windows

Searches 30, 60, 90 or 180 days for the touchdown dates that work for an N-day mission and an approach heading. A date is accepted when the lander touches down in sunlight, the downlink closes, it survives the mission and the Sun is neither in front of nor directly behind the descent cameras. The colour strip shows every date; the list gives the windows with **Land then**; the table says why the others are rejected. The glare cone (±25°), the no-shadow cone (±15°) and the ellipse at least 50 % sunlit are fixed engineering assumption thresholds.

### 3.4 Compare (inside Landing windows)

The **Compare with another site or date** switch creates scenario B as a copy of the current one. It shows:

* **Shown in 3-D: A / B**, to pick which one is on screen.
* The controls of **scenario B** (site, date, window, offset) and the **Use the same window as A** shortcut.
* The **quick comparison**: four bars per scenario (solar energy, contact with the Earth, night survival and landing safety = 1 − P(tip-over)), with the slope apart.
* The full **KPI table**, with the marker on the better value of each row.

Switched off, B disappears from the 3-D view, the timeline and every table.

### 3.5 Mission windows (timeline)

Each row is the whole window: day/night, Earth visible and both at once (the "golden windows"). Dragging along it moves the time cursor.

## 4. Power / thermal

* **Hardware**: array and antenna height (2 m or a 10 m mast), array mount, area, efficiency, operating and survival loads, battery and depth-of-discharge limit. **Thermal control**: couple the battery to the bus temperature, heater power, radiating area, emissivity, thermal mass and shadow sink. **Advanced assumptions** (folded): heaters at 0 °C, capacity loss below −10 °C, frozen at −20 °C; engineering assumption.
* **Energy and survival**: whether it survives the window, lowest temperature, heater hours and energy, solar energy and peak, lowest charge, sky view factor and sunlit surrounding terrain. Flags a critical thermal death.
* **Power and temperature**: array power (amber fill), battery charge and bus temperature against time.

## 5. Comms / RF

* **Hardware**: DTE link (X or S band, antenna margin, station, transmit power, lander dish, bandwidth, link margin) and **relay satellites**: orbit preset, number of satellites and lander-to-relay rate.
* **Link budget**: gain, beamwidth, EIRP, free-space loss, G/T, C/N₀, achievable rate, Eb/N₀ and margin. **Ridges between the lander and the Earth**: diffraction over up to three ridges (Deygout). **Which station closes the link?**: enter the target rate or use the 10 / 100 / 1000 kbps chips; it gives the G/T and the equivalent dish needed.
* **Horizon 360°**: the skyline profile with the paths of the Sun and the Earth.

## 6. Terrain / landing

* **Attitude and tip-over**: presets (nominal, IM-1, IM-2, SLIM, resting on the slope), roll, pitch, yaw, antenna beamwidth and gimbal range, and their penalties. Tip-over probability over the ellipse against touchdown speed. **Replay a real landing**: always warns that the model does not reproduce the loss of IM-2 Athena (it came to rest in a small crater in shadow that the 20 m terrain does not contain). **Neighbouring asset**: plume keep-out radius and mutual shadowing.
* **Emergency: survival**: the same flow as the Emergency mode (section 10). No date: **Evaluate from now** (or any value entered) sets the start to the current hour for one lunar night (15 days; also 3 or 7).

## 7. Science

* **Suitability index** from 0 to 100, synthesized: sunlight, Earth view, slope, roughness, proximity to permanently shadowed regions, FeO and gravity, with the weight and source of each criterion. Orbital data of the site (Diviner temperatures, stable ice, PSR).
* **Engineering view**: the full KPI table and the **terrain uncertainty** (RMS height error, correlation length, N terrain variants, probability of surviving and P10/P50/P90 bands). In this console the timeline is the **detailed** one: Sun, battery, Earth visible, downlink per station, relay and simultaneous operations.

## 8. Tutorial mode (Mission guide)

A notice explains that the application will change tabs, site and date by itself. With **Start**, a fixed 10-step sequence drives the interface: 3-D view, double-click, time transport, the five tabs, landing windows and comparison, Emergency mode and Export. Each step spotlights the control it talks about. **Right arrow** goes on, **left arrow** goes back and **Esc** leaves. When it is left or finished, the application returns exactly to where you were. On the first visit, a card in the bottom-right corner offers the same tour or skipping it.

## 9. Candidate site cards (public and teachers)

In Overview > Sites and dates, under the scenario, one card for each of the five candidate sites with three meters: sunlight and contact with the Earth (0–100 % of the window) and longest night (full bar = what the battery can bridge in hibernation). A click selects the site. The Explorer mode of version 2.0 was retired: its tour is covered by the tutorial mode and its status tiles by the vitals.

## 10. Emergency mode

For a lander already on the surface somewhere unplanned. It asks only what matters and evaluates from **now** over the next 15 days (one lunar night; also 3 or 7):

1. **Current position**: click on the polar map or paste the coordinates (for example −84.79, 29.20). Any point south of 80° S is accepted.
2. **Energy available**: Wh left in the battery and minimum survival load.
3. **Current tilt** (optional, folded): roll, pitch, or "We came to rest on the slope".

It answers first with a plain-language headline: **SURVIVES**, **SURVIVES IF…** or **DOES NOT SURVIVE**, with date and time (UTC and T+). Right under it, the **Way out** block says whether there is a way out and gives the options computed with the engine: stay and cut the load, move up to 500 m and wait for the next sunlight; when none works, it says what would be missing. The loss criterion is the engine's: battery empty with no sunlight or, with the thermal model, bus below −20 °C. Then come the terrain source and resolution, the time until the bus freezes and **where to move**: the grid of 25 points within 200 m (each cell is a full mission), the escape vector and **Move the lander there**. The green arrow on the terrain is the same vector. The hazards under the 20 m pixel (LOLA + fractal micro-relief: micro-shadows and rocks) are always shown; they are statistical, not a map.

## 11. Uses by user

**Mission engineer.** Set site and date in Overview, size power and thermal in Power, check the link in Comms, review attitude, tip-over and escape in Terrain and validate everything in Science > Engineering view. Use Landing windows to pick the date and Compare to decide between two sites or two dates. Export the CSV for the ground-station tools.

**Public and teachers.** The tutorial and the site cards explain the physics of the south pole without jargon: the grazing Sun, the long shadows, the Earth hiding behind the mountains and why a few hundred metres change a lander's fate.

**Team in an emergency.** Emergency mode (or Terrain > Emergency: survival) answers in order: where we are, how long we have and where to move, from now.

## 12. Sources and limits

* Terrain: LRO LOLA (Barker et al., 2023), 20 m/px around the sites; the rest of the cap at lower resolution.
* Ephemerides: astronomy-engine. Stations: DSN (Goldstone, Madrid, Canberra).
* The descent trajectory, the fuel and the navigation errors are not modelled. The default vehicle is illustrative.
* The Deygout formula and the micro-relief parameters were written without checking them against the cited standard or literature.
