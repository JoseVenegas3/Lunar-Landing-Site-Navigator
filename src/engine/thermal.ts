/**
 * Coupled electro-thermal survival model (requirement SyR-P4).
 *
 * A lander in topographic shadow does not simply stop charging: it radiates
 * its heat to a 60-90 K environment, and thermostat-controlled survival
 * heaters drain the battery to keep the bus above 0 degC. If the battery runs
 * out the bus keeps cooling and the cells freeze. The battery and the bus
 * temperature therefore have to be integrated together:
 *
 *   m c_p dT/dt = alpha A_abs S f_sun + Q_elec + Q_heater - eps sigma A_rad (T^4 - T_env^4)
 *   E(t + dt)   = clamp(E + (P_solar - P_load - Q_heater) dt, 0, E_max(T))
 *
 * All electrical power consumed inside the bus ends up as heat (Q_elec = P_load).
 */
import { SOLAR_CONSTANT_W_M2 } from './constants';
import { BatteryResult, PowerConfig } from './missionPhysics';

export const STEFAN_BOLTZMANN = 5.670374e-8; // W m^-2 K^-4
export const T_FREEZE_K = 273.15;
/** Li-ion electrolyte: irreversible damage below -20 degC. */
export const T_BATTERY_DEATH_K = 253.15;
/** Usable capacity starts to fall below -10 degC. */
export const T_DERATE_START_K = 263.15;
/** Share of the rated capacity still usable at -20 degC (typical Li-ion: 50-70 %). */
export const CAPACITY_AT_DEATH = 0.6;

export interface ThermalConfig {
  /** Thermal mass of the bus, m * c_p, J/K. */
  heatCapacityJK: number;
  /** Radiating area to space and ground, m2, and its infrared emissivity. */
  radiatorAreaM2: number;
  emissivity: number;
  /** Sun-absorbing area times solar absorptivity, m2. */
  absorbedAreaM2: number;
  /** Electrical power of the survival heaters when on, W. */
  heaterW: number;
  /** Thermostat: heaters switch on below this bus temperature and off 5 K above it, K. */
  heaterSetpointK: number;
  /** Highest bus temperature the thermal control lets the bus reach (louvres / radiator), K. */
  maxBusK: number;
  /** Radiative sink temperature of the surroundings in full sunlight and in shadow, K. */
  envLitK: number;
  envDarkK: number;
  /** Time constant with which the surface and the sink temperature follow the light, hours. */
  envTimeConstantH: number;
  initialBusK: number;
}

/**
 * Radiative surroundings of the bus (evolution E2). Without it the bus is
 * assumed to exchange heat with a single sink at the terrain temperature.
 */
export interface ThermalEnvironment {
  /** Sky view factor of a horizontal surface at the lander (horizonEngine.skyViewFactor), 0..1. */
  skyView: number;
  /** Share of the terrain the lander sees that is sunlit at each sample, 0..1. Defaults to the lander's own sunlit fraction. */
  terrainLit?: ArrayLike<number>;
}

/** Temperature of deep space as a radiative sink, K. */
export const T_SKY_K = 3;

/**
 * Fourth power of the effective sink temperature. The bus radiates in all
 * directions: its upper half sees the hemisphere above (sky where the terrain
 * leaves it open, terrain elsewhere) and its lower half sees the ground. The
 * share of its surroundings that is cold sky is therefore skyView / 2.
 */
export function sinkT4(skyView: number, terrainK: number): number {
  const sky = 0.5 * Math.min(1, Math.max(0, skyView));
  return sky * T_SKY_K ** 4 + (1 - sky) * terrainK ** 4;
}

export const DEFAULT_THERMAL: ThermalConfig = {
  heatCapacityJK: 120_000, // ~150 kg of structure and avionics at ~800 J/kg/K
  radiatorAreaM2: 0.5,
  emissivity: 0.5, // multilayer-insulated bus with an exposed radiator
  absorbedAreaM2: 0.15,
  heaterW: 80,
  heaterSetpointK: T_FREEZE_K,
  maxBusK: 313.15,
  envLitK: 230,
  envDarkK: 70,
  envTimeConstantH: 4,
  initialBusK: 293.15,
};

/** Usable battery capacity as a fraction of the rated one at bus temperature T. */
export function capacityFraction(tBusK: number): number {
  if (tBusK >= T_DERATE_START_K) return 1;
  if (tBusK <= T_BATTERY_DEATH_K) return CAPACITY_AT_DEATH;
  return CAPACITY_AT_DEATH + ((1 - CAPACITY_AT_DEATH) * (tBusK - T_BATTERY_DEATH_K)) / (T_DERATE_START_K - T_BATTERY_DEATH_K);
}

/** Heat the bus radiates at temperature T towards a sink at T_env, W. */
export function radiatedW(cfg: ThermalConfig, tBusK: number, tEnvK: number): number {
  return cfg.emissivity * STEFAN_BOLTZMANN * cfg.radiatorAreaM2 * (tBusK ** 4 - tEnvK ** 4);
}

export interface ElectroThermalResult extends BatteryResult {
  /** Bus temperature at the end of each sample, K (keeps cooling after the lander is lost). */
  tBusK: Float32Array;
  /** Temperature of the terrain around the lander, K. */
  tEnvK: Float32Array;
  /** Mean heater power over each sample, W. */
  heaterW: Float32Array;
  heaterWh: number;
  heaterHours: number;
  /** Lowest bus temperature while the lander was alive, K (-20 degC when it froze). */
  minBusK: number;
  /** Sample at which the bus fell to -20 degC (battery frozen), or -1. */
  thermalDeathIndex: number;
  /** Hours from the window start to the loss of the lander (frozen or thermally dead), or the window length. */
  survivalHours: number;
}

const SUBSTEPS_PER_HOUR = 10;

/**
 * Integrate battery energy and bus temperature together over a power series
 * sampled every `stepHours`.
 *
 * Load policy (same as the uncoupled model): the lander runs its operating
 * load only while the array covers it and otherwise hibernates on the survival
 * load. Heaters follow the thermostat and are fed from the array first, then
 * from the battery. When the bus reaches -20 degC the battery is declared
 * frozen: the lander is lost and stays lost for the rest of the window.
 */
export function simulateElectroThermalTimeline(
  power: PowerConfig, thermal: ThermalConfig, powerW: ArrayLike<number>, sunFraction: ArrayLike<number>, stepHours: number,
  env?: ThermalEnvironment,
): ElectroThermalResult {
  const n = powerW.length;
  const socWh = new Float32Array(n), loadW = new Float32Array(n);
  const tBusK = new Float32Array(n), tEnvK = new Float32Array(n), heaterW = new Float32Array(n);
  const sub = Math.max(1, Math.round(SUBSTEPS_PER_HOUR * stepHours));
  const dtH = stepHours / sub, dtS = dtH * 3600;
  const cap = power.batteryCapacityWh;
  const dodFloor = cap * (1 - power.maxDepthOfDischarge);

  let e = cap * Math.min(1, Math.max(0, power.initialSoc));
  let t = thermal.initialBusK;
  const lit0 = n > 0 ? (env?.terrainLit ? env.terrainLit[0] : sunFraction[0]) : 0;
  let tEnv = thermal.envDarkK + (thermal.envLitK - thermal.envDarkK) * lit0;
  const k = thermal.emissivity * STEFAN_BOLTZMANN * thermal.radiatorAreaM2;
  let heaterOn = false, dead = false;
  let generatedWh = 0, consumedWh = 0, unmetWh = 0, heaterWh = 0, heaterHours = 0, minE = e, minT = t;
  let hoursBelowDod = 0, hoursDepleted = 0, thermalDeathIndex = -1, lostAt = -1;

  for (let i = 0; i < n; i++) {
    const gen = powerW[i], frac = sunFraction[i];
    const terrainFrac = env?.terrainLit ? env.terrainLit[i] : frac;
    generatedWh += gen * stepHours;
    let heaterSum = 0, loadSum = 0, depletedSub = 0;
    for (let s = 0; s < sub; s++) {
      // Surroundings follow the light with a first-order lag.
      const envEq = thermal.envDarkK + (thermal.envLitK - thermal.envDarkK) * terrainFrac;
      tEnv += ((envEq - tEnv) * dtH) / thermal.envTimeConstantH;

      let load = 0, heater = 0;
      if (!dead) {
        load = gen >= power.baseLoadW ? power.baseLoadW : power.survivalLoadW;
        if (t < thermal.heaterSetpointK) heaterOn = true;
        else if (t > thermal.heaterSetpointK + 5) heaterOn = false;
        heater = heaterOn ? thermal.heaterW : 0;
      }
      // Energy actually available this sub-step: array output plus what the battery can give.
      const wanted = (load + heater) * dtH;
      const supply = gen * dtH + e;
      let served = wanted;
      if (wanted > supply) {
        served = supply;
        unmetWh += wanted - supply;
        depletedSub++;
        // Electronics are served first; the heaters take what is left.
        const loadServed = Math.min(load * dtH, supply);
        heater = (supply - loadServed) / dtH;
        load = loadServed / dtH;
      }
      if (dead) {
        // A frozen battery does not come back when the Sun returns.
        e = 0;
      } else {
        const net = gen * dtH - served;
        e = net >= 0 ? e + net * power.chargeEfficiency : e + net;
        const eMax = cap * capacityFraction(t);
        if (e > eMax) e = eMax;
        if (e < 0) e = 0;
      }
      consumedWh += served;
      heaterWh += heater * dtH;
      if (heater > 0) heaterHours += dtH;
      heaterSum += heater;
      loadSum += load;

      const qIn = thermal.absorbedAreaM2 * SOLAR_CONSTANT_W_M2 * frac + load + heater;
      const out = env ? k * (t ** 4 - sinkT4(env.skyView, tEnv)) : radiatedW(thermal, t, tEnv);
      t += ((qIn - out) * dtS) / thermal.heatCapacityJK;
      if (t > thermal.maxBusK) t = thermal.maxBusK;
      if (!dead && t <= T_BATTERY_DEATH_K) {
        dead = true;
        thermalDeathIndex = i;
        e = 0;
      }
      // After the loss the hulk keeps cooling, which says nothing about the mission: stop tracking the minimum.
      if (t < minT && t >= T_BATTERY_DEATH_K - 1) minT = t;
      if (e < minE) minE = e;
    }
    if (depletedSub > 0 || dead) hoursDepleted += dead ? stepHours : (depletedSub / sub) * stepHours;
    if ((depletedSub === sub || dead) && lostAt < 0 && (dead || gen <= 0)) lostAt = i;
    if (e < dodFloor - 1e-6) hoursBelowDod += stepHours;
    socWh[i] = e;
    loadW[i] = loadSum / sub;
    heaterW[i] = heaterSum / sub;
    tBusK[i] = t;
    tEnvK[i] = tEnv;
  }

  const survives = thermalDeathIndex < 0 && hoursDepleted === 0;
  return {
    socWh, loadW, generatedWh, consumedWh, unmetWh,
    minSocFraction: cap > 0 ? minE / cap : 0,
    hoursBelowDod, hoursDepleted, survives, dodAlert: hoursBelowDod > 0,
    tBusK, tEnvK, heaterW, heaterWh, heaterHours, minBusK: minT, thermalDeathIndex,
    survivalHours: (thermalDeathIndex >= 0 ? thermalDeathIndex : lostAt >= 0 ? lostAt : n) * stepHours,
  };
}
