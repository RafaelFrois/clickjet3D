/**
 * Every gameplay number lives here so the game can be re-balanced without touching
 * systems. Ranges are [start, end] and are interpolated by the difficulty level (0..1).
 */
export type Range = readonly [number, number];

export const BALANCE = {
  /** Seconds at the start of a run with coins only. */
  grace: 2.2,

  /** Difficulty level = 1 - exp(-t / tau). ~0.25 @20s, ~0.58 @60s, ~0.82 @120s. */
  difficultyTau: 70,
  stages: { midAt: 20, finalAt: 75 },

  player: {
    maxSpeed: 11,
    /** Exponential velocity response (1/s). High = arcade, precise, almost no inertia. */
    response: 15,
    /** Two circles along the fuselage (nose / tail) — fair, matches the visual. */
    colliderRadius: 0.34,
    colliderOffset: 0.3,
    pickupRadius: 0.72,
    /** Pointer "fly to" arrive gain: speed = min(max, dist * gain). */
    arriveGain: 6,
    /** Relative touch drag may move a bit faster than the stick (finger precision). */
    touchSpeedMul: 1.6,
    startZ: 3,
  },

  /** World cruise speed: passive objects stream toward the camera (sense of flight). */
  flow: [2.6, 4.3] as Range,

  score: {
    yellow: 5,
    rainbow: 10,
    comboWindow: 1.3,
    comboPickupsPerLevel: 4,
    comboMax: 3,
  },

  powerUp: {
    duration: 5,
    rate: 10,
    bigDuration: 8,
    bigRate: 20,
    firstDelay: [10, 14] as Range,
    interval: [16, 24] as Range,
    speed: [5.2, 6.8] as Range,
    radius: 0.62,
    bigRadius: 1.0,
  },

  coins: {
    interval: [1.45, 1.05] as Range,
    maxActive: 40,
    rainbowChance: [0.1, 0.2] as Range,
    /** Chance that a coin wave is placed around a hazard (risk vs reward). */
    riskChance: [0.08, 0.35] as Range,
    radius: 0.42,
  },

  meteors: {
    firstAt: 4.5,
    interval: [3.4, 0.95] as Range,
    burstMax: [1, 3] as Range,
    /** Telegraph time (warning line + edge marker) before a meteor enters. */
    warn: [1.15, 0.8] as Range,
    laneSpacing: 3.4,
    sizes: {
      S: { radius: 0.45, speed: [13, 16] as Range },
      M: { radius: 0.7, speed: [10.5, 13] as Range },
      L: { radius: 1.05, speed: [8, 10] as Range },
    },
    sizeWeightsStart: { S: 0.6, M: 0.35, L: 0.05 },
    sizeWeightsEnd: { S: 0.35, M: 0.4, L: 0.25 },
    /** How much a meteor aims at the player (0 = random lane, 1 = straight at them). */
    aim: [0.15, 0.6] as Range,
  },

  rocks: {
    firstAt: 2.2,
    maxActive: [2, 7] as Range,
    interval: [3.6, 1.5] as Range,
    scale: [0.75, 1.55] as Range,
    /** Minimum free corridor left between rocks in the same horizontal band. */
    minGap: 3.4,
    bandHeight: 3.2,
  },

  aliens: {
    firstAt: 9,
    maxActive: [1, 4] as Range,
    interval: [7.5, 3.2] as Range,
    speed: [1.8, 3.4] as Range,
    lungeChance: [0, 0.45] as Range,
    lungeSpeed: 7.5,
    lungeTelegraph: 0.55,
    lifetime: [11, 18] as Range,
    headRadius: 0.62,
  },

  chaser: {
    firstAt: 7.5,
    warn: 1.4,
    /** Always slower than the player (max 11) so escaping is always possible. */
    speed: [4.6, 8.1] as Range,
    accel: [7, 12] as Range,
    lead: [0, 0.35] as Range,
    minSpawnDistance: 11,
    radius: 0.5,
    entryRamp: 2,
  },

  events: {
    firstAt: 28,
    interval: [30, 46] as Range,
  },

  fairness: {
    /** No hazard may spawn/enter closer than this to the player. */
    safeRadius: 5.5,
  },
} as const;

export type MeteorSize = keyof typeof BALANCE.meteors.sizes;
