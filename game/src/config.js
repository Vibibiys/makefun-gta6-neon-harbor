// Neon Harbor: Vice Run — shared configuration.
// Every module in the game reads its numbers and colours from here, so the
// city layout, the tuning and the palette can never drift apart between
// builders. This file has no imports and no side effects.
//
// Layout contract (shared by world, vehicles, pedestrians, render, combat):
//   * The world is WORLD_W x WORLD_H world units (pixels at zoom 1).
//   * Roads form a grid. Vertical roads are centred on ROAD_CENTERS_X and
//     horizontal roads on ROAD_CENTERS_Y, each ROAD_WIDTH wide.
//   * The south strip (y >= WATER_Y) is harbour water, except for the
//     boardwalk band BOARDWALK_Y .. WATER_Y where Mara can walk and drive
//     along the promenade but cannot enter the water itself.

export const WORLD_W = 3840;
export const WORLD_H = 2880;

export const ROAD_SPACING = 480;
export const ROAD_WIDTH = 120;
export const ROAD_HALF = ROAD_WIDTH / 2;

/** Centre lines of the vertical roads, west to east. */
export const ROAD_CENTERS_X = Object.freeze([
  240, 720, 1200, 1680, 2160, 2640, 3120, 3600,
]);

/** Centre lines of the horizontal roads, north to south. */
export const ROAD_CENTERS_Y = Object.freeze([
  240, 720, 1200, 1680, 2160, 2640,
]);

/** The last horizontal road that lies on dry land (2640 is out in the bay). */
export const LAST_LAND_ROAD_Y = 2160;

/** y of the waterline: everything at or below this is harbour water. */
export const WATER_Y = 2520;

/** The boardwalk / promenade band along the harbour. */
export const BOARDWALK_Y = 2440;
export const BOARDWALK_H = WATER_Y - BOARDWALK_Y;

/** Sidewalk offset from a road centre line: just outside the kerb. */
export const SIDEWALK_OFFSET = 78;

/** Fixed simulation step (seconds) used by the main loop. */
export const STEP = 1 / 60;

// ---------------------------------------------------------------------------
// Palette: sun-soaked neon. Hot sand and bleached concrete, teal water,
// coral and magenta signage, palm green, and a warm late-afternoon light
// over everything. Renderers should take colours from here (or from the
// per-building / per-car colours the world generator assigns, which are
// themselves drawn from these lists).
// ---------------------------------------------------------------------------

export const COLORS = Object.freeze({
  // Ground and city fabric.
  sand: '#e8c98a',
  sandLight: '#f4dcab',
  sandDark: '#c9a35f',
  concrete: '#b8b3a4',
  sidewalk: '#d8d0ba',
  sidewalkEdge: '#a89f83',
  asphalt: '#3d4148',
  asphaltDark: '#33373e',
  laneMarking: '#f7e9a0',
  kerb: '#efe8d2',
  grass: '#58a05a',
  grassDark: '#3f7f45',
  dirt: '#b08b57',

  // Water and harbour.
  water: '#1595a3',
  waterDeep: '#0d6e80',
  waterFoam: '#bdf3ec',
  boardwalk: '#c98d5f',
  boardwalkDark: '#a96f42',
  pierWood: '#9a6a44',

  // Neon signage and accents.
  coral: '#ff6b57',
  coralDark: '#d94a38',
  pink: '#ff4f9a',
  magenta: '#e83fd0',
  cyan: '#2ee6e0',
  teal: '#14b8a6',
  aqua: '#57f2d4',
  yellow: '#ffd23f',
  amber: '#ff9f1c',
  violet: '#8b5cf6',
  lime: '#a3e635',

  // Vegetation.
  palmGreen: '#2e9e4f',
  palmDark: '#1f7038',
  palmTrunk: '#8a6642',

  // People, vehicles and UI neutrals.
  skinTones: Object.freeze(['#f2c79b', '#e0aa72', '#c68642', '#9c6644', '#7a4a2b']),
  white: '#ffffff',
  offWhite: '#fdf6e3',
  black: '#14161a',
  shadow: 'rgba(20, 18, 10, 0.35)',
  blood: '#c0272d',
  muzzle: '#ffe27a',
  smoke: '#9aa0a6',
  explosion: '#ff8c42',

  // Building walls: pastel stucco washed by the sun, a few glass towers.
  buildingWalls: Object.freeze([
    '#f6d8a8', '#f2b8a0', '#f9e3c0', '#e8a2b4', '#a8d8d0',
    '#bcd8f0', '#f4e2b8', '#e0c8e8', '#f8c8a0', '#a0c8b8',
    '#f0d0d8', '#cfe0b0', '#e8e0c8', '#9fb8d8', '#f2c894',
  ]),
  buildingRoofs: Object.freeze([
    '#c96f4a', '#a8543a', '#d98a5f', '#8a9aa8', '#b0623f',
    '#7a8a99', '#c2503c', '#5f7a8a', '#a86a4a', '#94785a',
  ]),
  // Car paint: bright rental-fleet colours plus a few sober ones.
  carPaints: Object.freeze([
    '#ff6b57', '#ffd23f', '#2ee6e0', '#ff4f9a', '#57a8f2',
    '#a3e635', '#f2f2f2', '#c0c6cc', '#3d4148', '#8b5cf6',
    '#ff9f1c', '#14b8a6', '#e83fd0', '#f25c54', '#4f7dd9',
  ]),
  taxiPaint: '#ffd23f',
  policePaint: '#f4f6f8',
  policeTrim: '#1d3a8a',
  vanPaints: Object.freeze(['#e8e8e8', '#bcd8f0', '#f2b8a0', '#cfe0b0']),

  // Pedestrian clothing.
  clothing: Object.freeze([
    '#ff6b57', '#ffd23f', '#2ee6e0', '#ff4f9a', '#57a8f2',
    '#a3e635', '#f2f2f2', '#ff9f1c', '#14b8a6', '#e8a2b4',
    '#8b5cf6', '#f6d8a8', '#3f7f45', '#d94a38',
  ]),
  gangColors: Object.freeze(['#7c1d3f', '#5b21b6', '#991b1b']),
  officerUniform: '#1d3a5f',
});

/** Backwards-friendly alias: some render code calls the palette PALETTE. */
export const PALETTE = COLORS;

// ---------------------------------------------------------------------------
// Tuning. Distances are world units, speeds are units per second, times are
// seconds, angles are radians (0 = east, positive angles turn clockwise on
// screen because +y points down).
// ---------------------------------------------------------------------------

export const TUNING = Object.freeze({
  player: Object.freeze({
    walkSpeed: 175,
    runSpeed: 265,
    radius: 13,
    hp: 100,
    armor: 0,
    // Time Mara stays invulnerable after taking a hit, so one burst or one
    // collision cannot delete her in a single frame.
    hurtCooldown: 0.35,
    enterCarRange: 58,
    startMoney: 120,
  }),

  camera: Object.freeze({
    followLerp: 7.5,
    lookAhead: 0.35,
  }),

  // Per-kind car performance. w is the car's length along its heading and
  // h its width across it; vehicles.js reads these through carStats().
  cars: Object.freeze({
    sedan: Object.freeze({ maxSpeed: 285, accel: 165, brake: 340, reverse: 95, turn: 2.7, hp: 100, w: 46, h: 21 }),
    taxi: Object.freeze({ maxSpeed: 275, accel: 160, brake: 340, reverse: 95, turn: 2.7, hp: 100, w: 46, h: 21 }),
    sports: Object.freeze({ maxSpeed: 430, accel: 265, brake: 380, reverse: 110, turn: 3.1, hp: 80, w: 47, h: 20 }),
    truck: Object.freeze({ maxSpeed: 210, accel: 105, brake: 280, reverse: 70, turn: 1.9, hp: 190, w: 66, h: 27 }),
    van: Object.freeze({ maxSpeed: 235, accel: 120, brake: 300, reverse: 80, turn: 2.1, hp: 150, w: 58, h: 25 }),
    police: Object.freeze({ maxSpeed: 395, accel: 240, brake: 370, reverse: 105, turn: 3.0, hp: 130, w: 48, h: 21 }),
  }),

  traffic: Object.freeze({
    // Traffic cruises well below each car's top speed and keeps a gap.
    cruiseFactor: 0.52,
    followDistance: 62,
    followBrakeDistance: 34,
    turnChance: 0.3,
  }),

  peds: Object.freeze({
    walkSpeed: 52,
    fleeSpeed: 172,
    radius: 11,
    hp: 30,
    fleeMemory: 2.6,
  }),

  // Wanted system: heat is earned per crime, decays over time, and maps to
  // stars through the thresholds. police.js / missions may refine the
  // numbers at runtime, but these are the shared defaults.
  wanted: Object.freeze({
    thresholds: Object.freeze([0, 12, 32, 62, 105, 160]),
    maxStars: 5,
    heatDecayPerSecond: 0.55,
    heatDecayHiddenPerSecond: 2.4,
    crimeHeat: Object.freeze({
      hitped: 14,
      carjack: 12,
      theft: 8,
      shot: 6,
      kill: 22,
      copkill: 45,
      collision: 3,
      property: 5,
      mission: 10,
    }),
    bustRadius: 46,
    bustFillPerSecond: 0.55,
    bustDrainPerSecond: 0.9,
  }),

  combat: Object.freeze({
    bulletSpeed: 880,
    bulletLife: 0.85,
    particleGravity: 260,
  }),

  economy: Object.freeze({
    carjackPayout: 0,
    deliveryBase: 150,
    stashBase: 220,
  }),
});

/** Convenience flat exports some modules prefer to a nested lookup. */
export const PLAYER_SPEED = TUNING.player.walkSpeed;
export const PLAYER_RUN_SPEED = TUNING.player.runSpeed;
export const WANTED_THRESHOLDS = TUNING.wanted.thresholds;
