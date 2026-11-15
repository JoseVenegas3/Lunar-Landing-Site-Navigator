/**
 * Scenarios of the beginner tutorial, found with the real engine by
 * scripts/find-tutorial-scenarios.ts (2026-11-15). Do not edit by hand: run
 * `npm run find-scenarios`. The unit test src/beginner/__tests__/scenarios.test.ts
 * re-checks every condition against the engine. The measured values are kept
 * for the record (ARCHITECTURE.md, docs/guion-principiante.md); the narration
 * always reads the live values from the app.
 */
export const TUTORIAL_SCENARIOS = {
  "m0": {
    "siteId": "shackleton-ridge",
    "startMs": 1808848800000,
    "days": 14,
    "ok": true,
    "bestHour": 36,
    "p0W": 89.69276428222656,
    "pMaxW": 730.763427734375,
    "startPct": 12.273844157787952,
    "linkClosesH": 21
  },
  "m1": {
    "siteId": "im2-athena",
    "startMs": 1798934400000,
    "days": 14,
    "ok": true,
    "dark": true,
    "silent": true,
    "level": "nogo",
    "accepted": 10,
    "total": 121
  },
  "m2": {
    "siteId": "malapert-massif",
    "dxM": 350,
    "dyM": 414,
    "slopeDeg": 16.74412180933169,
    "tipP": 0.021259491192988665,
    "safeDxM": 254,
    "safeDyM": 446,
    "safeSlopeDeg": 0.7660163207681613,
    "safeTipP": 0.003488442509592209,
    "distanceM": 101.19288512538814,
    "score": 0.17755210356903176
  },
  "m3": {
    "siteId": "shackleton-ridge",
    "startMs": 1804464000000,
    "days": 14,
    "ok": true,
    "deathH": 309,
    "energyLowWh": 188653.8377224207,
    "energyHighWh": 229502.18862485886,
    "minBusLowC": -20.872172366533817,
    "minBusHighC": -0.10431631047970313
  },
  "m4": {
    "siteId": "shackleton-ridge",
    "startMs": 1798761600000,
    "days": 14,
    "relayRateMbps": 6.971467412751999,
    "ok": true,
    "directPct": 49.85163204747774,
    "relayPct": 100,
    "gapH": 167
  },
  "m5": {
    "siteId": "shackleton-ridge",
    "startMs": 1819497600000,
    "days": 14,
    "nominalPct": 35.01483679525222,
    "tiltedPct": 7.4183976261127595,
    "gimbalDeg": 20,
    "fixedPct": 35.01483679525222
  },
  "m7": {
    "siteId": "nobile-rim",
    "nowMs": 1819756800000,
    "days": 15,
    "energyWh": 4000,
    "baseSurvives": false,
    "baseLossH": 65,
    "move": {
      "eastM": 250,
      "northM": 0,
      "distanceM": 250,
      "minSocPct": 1.075
    }
  }
} as const;
