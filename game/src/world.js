// Neon Harbor: Vice Run — the city itself.
//
// createWorld(seed) builds the static city of Neon Harbor: city blocks on a
// regular road grid, buildings inside the blocks (never on a road), parks,
// street props, parked-car and pedestrian spawn points, the harbour in the
// south, and the named mission locations. Everything is derived from one
// seed through the game's seeded RNG, so a seed always builds the same city.
//
// Geometry contract:
//   * Roads are ROAD_WIDTH wide, centred on ROAD_CENTERS_X / ROAD_CENTERS_Y.
//   * Buildings live in block interiors: the land between two neighbouring
//     roads, inset 26 units from every road edge, so there is always a
//     sidewalk / alley gap between a wall and the kerb.
//   * y >= WATER_Y is harbour water and blocks movement, except that the
//     boardwalk band BOARDWALK_Y..WATER_Y in front of it is solid ground.
//   * The horizontal "road" at y = 2640 lies in the bay: it is not built,
//     not drivable, and no buildings, spawns or props are placed on it.

import {
  WORLD_W, WORLD_H, ROAD_CENTERS_X, ROAD_CENTERS_Y, ROAD_WIDTH, ROAD_HALF,
  LAST_LAND_ROAD_Y, WATER_Y, BOARDWALK_Y, BOARDWALK_H, SIDEWALK_OFFSET, COLORS,
} from './config.js';
import { makeRng } from './random.js';

const BLOCK_MARGIN = 26; // building inset from a road edge
const EDGE_MARGIN = 14; // building inset from the world edge
const ALLEY = 14; // gap between two buildings sharing a block

// Named buildings, handed out to the largest footprints near the city
// centre and the harbour. All names are original to Neon Harbor.
const NAMED_BUILDINGS = [
  'Coral Crown Hotel', 'Marina Bank', 'Palm Court', 'Neon Arcade',
  'Harborview Suites', 'The Flamingo Rooms', 'Casa Del Mar', 'Voss Auto Works',
  'Sunset Records', 'Teal Tower', 'The Boardwalk Grand', 'Pelican Plaza',
  'Marlin Motors', 'Copa Cabana Club', 'Azure Insurance', 'Portside Gym',
  'The Gilded Gull', 'Vice Point Mall', 'Lagoon Cinemas', 'Hotel Meridian',
];

// District rectangles, checked in order by districtAt(). The harbour band
// wins over everything south of the boardwalk.
const DISTRICTS = [
  { name: 'Neon Harborfront', x: 0, y: BOARDWALK_Y, w: WORLD_W, h: WORLD_H - BOARDWALK_Y },
  { name: 'Palm Heights', x: 0, y: 0, w: 1920, h: 1200 },
  { name: 'Uptown Neon', x: 1920, y: 0, w: WORLD_W - 1920, h: 1200 },
  { name: 'Market District', x: 0, y: 1200, w: 1920, h: BOARDWALK_Y - 1200 },
  { name: 'Coral Bay', x: 1920, y: 1200, w: WORLD_W - 1920, h: BOARDWALK_Y - 1200 },
];

/** Accept a numeric seed or an RNG-like object and return an RNG object. */
function asRng(seed) {
  if (seed && typeof seed === 'object') {
    if (typeof seed.next === 'function'
      && typeof seed.range === 'function'
      && typeof seed.int === 'function'
      && typeof seed.pick === 'function'
      && typeof seed.chance === 'function') return seed;
    if (typeof seed === 'function' || typeof seed.next !== 'function') {
      // A bare function RNG (older style): wrap it with the helpers.
      const fn = typeof seed === 'function' ? seed : null;
      const nextFn = fn || (() => 0.5);
      return {
        next: nextFn,
        range: (a, b) => a + nextFn() * (b - a),
        int: (a, b) => a + Math.floor(nextFn() * (b - a + 1)),
        pick: (arr) => arr[Math.floor(nextFn() * arr.length)],
        chance: (p) => nextFn() < p,
      };
    }
    if (typeof seed.next === 'function') {
      const n = () => seed.next();
      return {
        next: n,
        range: (a, b) => a + n() * (b - a),
        int: (a, b) => a + Math.floor(n() * (b - a + 1)),
        pick: (arr) => arr[Math.floor(n() * arr.length)],
        chance: (p) => n() < p,
      };
    }
  }
  return makeRng(typeof seed === 'number' ? seed : 1986);
}

/** Land segments between neighbouring road edges along one axis. */
function segments(centers, limit) {
  const out = [];
  let prevRight = 0;
  for (const c of centers) {
    const left = c - ROAD_HALF;
    const right = c + ROAD_HALF;
    if (left > prevRight) out.push({ start: prevRight, end: Math.min(left, limit) });
    prevRight = Math.max(prevRight, right);
    if (prevRight >= limit) break;
  }
  if (prevRight < limit) out.push({ start: prevRight, end: limit });
  return out.filter((s) => s.end - s.start >= 70);
}

/** Inset a block segment pair into a buildable rectangle. */
function blockRect(sx, sy) {
  const x0 = sx.start === 0 ? sx.start + EDGE_MARGIN : sx.start + BLOCK_MARGIN;
  const x1 = sx.end >= WORLD_W ? sx.end - EDGE_MARGIN : sx.end - BLOCK_MARGIN;
  const y0 = sy.start === 0 ? sy.start + EDGE_MARGIN : sy.start + BLOCK_MARGIN;
  const y1 = sy.end >= BOARDWALK_Y ? sy.end - BLOCK_MARGIN : sy.end - BLOCK_MARGIN;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function districtNameAt(x, y) {
  for (const d of DISTRICTS) {
    if (x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) return d.name;
  }
  return 'Neon Harbor';
}

export function createWorld(seed) {
  const rng = asRng(seed);
  const buildings = [];
  const parks = [];
  const props = [];
  const parkedSpawns = [];
  const pedSpawns = [];

  const xSegs = segments(ROAD_CENTERS_X, WORLD_W);
  const ySegs = segments(ROAD_CENTERS_Y, BOARDWALK_Y);

  // --- Buildings and parks, block by block. -------------------------------
  const parkBlockChance = 0.1;
  for (const sy of ySegs) {
    for (const sx of xSegs) {
      const rect = blockRect(sx, sy);
      if (rect.w < 90 || rect.h < 90) continue;

      // A few blocks stay green: a park with palms instead of buildings.
      const nearHarbor = rect.y + rect.h > 2000;
      if (!nearHarbor && rng.chance(parkBlockChance)) {
        parks.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        const palms = rng.int(2, 4);
        for (let i = 0; i < palms; i += 1) {
          props.push({
            x: rng.range(rect.x + 18, rect.x + rect.w - 18),
            y: rng.range(rect.y + 18, rect.y + rect.h - 18),
            kind: 'palm',
          });
        }
        if (rng.chance(0.7)) {
          props.push({
            x: rng.range(rect.x + 20, rect.x + rect.w - 20),
            y: rng.range(rect.y + 20, rect.y + rect.h - 20),
            kind: 'bench',
          });
        }
        continue;
      }

      // Subdivide: a big block holds two buildings side by side or stacked;
      // a long edge block holds two along its long side; a small block
      // holds one. Every split leaves an alley between the buildings.
      const footprints = [];
      if (rect.w >= 250 && rect.h >= 250) {
        if (rng.chance(0.5)) {
          const wA = (rect.w - ALLEY) * rng.range(0.42, 0.58);
          footprints.push({ x: rect.x, y: rect.y, w: wA, h: rect.h });
          footprints.push({ x: rect.x + wA + ALLEY, y: rect.y, w: rect.w - wA - ALLEY, h: rect.h });
        } else {
          const hA = (rect.h - ALLEY) * rng.range(0.42, 0.58);
          footprints.push({ x: rect.x, y: rect.y, w: rect.w, h: hA });
          footprints.push({ x: rect.x, y: rect.y + hA + ALLEY, w: rect.w, h: rect.h - hA - ALLEY });
        }
      } else if (rect.h >= 250 && rect.w >= 105) {
        const hA = (rect.h - ALLEY) * rng.range(0.42, 0.58);
        footprints.push({ x: rect.x, y: rect.y, w: rect.w, h: hA });
        footprints.push({ x: rect.x, y: rect.y + hA + ALLEY, w: rect.w, h: rect.h - hA - ALLEY });
      } else if (rect.w >= 250 && rect.h >= 105) {
        const wA = (rect.w - ALLEY) * rng.range(0.42, 0.58);
        footprints.push({ x: rect.x, y: rect.y, w: wA, h: rect.h });
        footprints.push({ x: rect.x + wA + ALLEY, y: rect.y, w: rect.w - wA - ALLEY, h: rect.h });
      } else {
        footprints.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      }

      for (const f of footprints) {
        // Shrink most footprints a touch so neighbouring buildings do not
        // all share exactly the same wall line.
        const inset = rng.range(0, 10);
        const b = {
          x: f.x + inset,
          y: f.y + inset,
          w: f.w - inset * 2,
          h: f.h - inset * 2,
          color: rng.pick(COLORS.buildingWalls),
          roof: rng.pick(COLORS.buildingRoofs),
          name: null,
          district: districtNameAt(f.x + f.w / 2, f.y + f.h / 2),
          height: rng.range(18, 64),
          floors: 0,
        };
        b.floors = Math.max(2, Math.round(b.height / 11));
        buildings.push(b);
      }
    }
  }

  // Name the largest buildings, preferring ones near the middle of the map.
  const byProminence = [...buildings].sort((a, b) => {
    const score = (q) => (q.w * q.h) / (1 + Math.hypot(q.x + q.w / 2 - WORLD_W / 2, q.y + q.h / 2 - 1300) / 1600);
    return score(b) - score(a);
  });
  for (let i = 0; i < Math.min(NAMED_BUILDINGS.length, byProminence.length); i += 1) {
    byProminence[i].name = NAMED_BUILDINGS[i];
  }

  // --- Street props. --------------------------------------------------------
  // Lamps stand on the kerbs of every land road, staggered along them.
  for (const cx of ROAD_CENTERS_X) {
    for (let y = 110; y < BOARDWALK_Y; y += 235) {
      const side = ((y / 235) | 0) % 2 === 0 ? -1 : 1;
      props.push({ x: cx + side * (ROAD_HALF + 9), y: y + rng.range(-8, 8), kind: 'lamp' });
    }
  }
  for (const cy of ROAD_CENTERS_Y) {
    if (cy > LAST_LAND_ROAD_Y) continue;
    for (let x = 340; x < WORLD_W - 60; x += 260) {
      const side = ((x / 260) | 0) % 2 === 0 ? 1 : -1;
      props.push({ x: x + rng.range(-8, 8), y: cy + side * (ROAD_HALF + 9), kind: 'lamp' });
    }
  }
  // Palms line the boardwalk and dot the harbour end of the avenues.
  for (let x = 70; x < WORLD_W; x += rng.range(120, 210)) {
    props.push({ x, y: BOARDWALK_Y + rng.range(14, 30), kind: 'palm' });
    if (rng.chance(0.45)) props.push({ x: x + rng.range(24, 60), y: WATER_Y - rng.range(12, 26), kind: 'bench' });
  }
  for (const cx of ROAD_CENTERS_X) {
    props.push({ x: cx - SIDEWALK_OFFSET, y: rng.range(2260, 2380), kind: 'palm' });
    props.push({ x: cx + SIDEWALK_OFFSET, y: rng.range(2260, 2380), kind: 'palm' });
  }
  // Crates cluster near the depot end of the harbour and behind the market.
  for (let i = 0; i < 26; i += 1) {
    const nearDepot = rng.chance(0.6);
    props.push({
      x: nearDepot ? rng.range(3420, 3780) : rng.range(1020, 1560),
      y: nearDepot ? rng.range(2280, 2410) : rng.range(820, 1080),
      kind: 'crate',
    });
  }

  // --- Parked car spawns: at the kerb of a road, clear of intersections. ---
  const parkedKinds = ['sedan', 'sedan', 'sedan', 'taxi', 'sports', 'van', 'truck'];
  let parkedGuard = 0;
  while (parkedSpawns.length < 30 && parkedGuard < 300) {
    parkedGuard += 1;
    const vertical = rng.chance(0.55);
    if (vertical) {
      const cx = rng.pick(ROAD_CENTERS_X);
      const laneSide = rng.chance(0.5) ? -1 : 1;
      const y = rng.range(120, 2320);
      if (ROAD_CENTERS_Y.some((cy) => cy <= LAST_LAND_ROAD_Y && Math.abs(y - cy) < 95)) continue;
      parkedSpawns.push({
        x: cx + laneSide * 40,
        y,
        angle: laneSide < 0 ? -Math.PI / 2 : Math.PI / 2,
        kind: rng.pick(parkedKinds),
        color: null, // filled below, taxis and vans have their own paints
      });
    } else {
      const cy = rng.pick(ROAD_CENTERS_Y.filter((v) => v <= LAST_LAND_ROAD_Y));
      const laneSide = rng.chance(0.5) ? -1 : 1;
      const x = rng.range(120, WORLD_W - 120);
      if (ROAD_CENTERS_X.some((cx) => Math.abs(x - cx) < 95)) continue;
      parkedSpawns.push({
        x,
        y: cy + laneSide * 40,
        angle: laneSide < 0 ? Math.PI : 0,
        kind: rng.pick(parkedKinds),
        color: null,
      });
    }
  }
  for (const s of parkedSpawns) {
    s.color = s.kind === 'taxi' ? COLORS.taxiPaint
      : s.kind === 'van' ? rng.pick(COLORS.vanPaints)
        : rng.pick(COLORS.carPaints);
  }

  // --- Pedestrian spawns: on sidewalks, just outside the kerb. ------------
  for (let i = 0; i < 90; i += 1) {
    const vertical = rng.chance(0.5);
    if (vertical) {
      const cx = rng.pick(ROAD_CENTERS_X);
      pedSpawns.push({
        x: cx + (rng.chance(0.5) ? -1 : 1) * SIDEWALK_OFFSET + rng.range(-6, 6),
        y: rng.range(60, BOARDWALK_Y - 30),
      });
    } else {
      const cy = rng.pick(ROAD_CENTERS_Y.filter((v) => v <= LAST_LAND_ROAD_Y));
      pedSpawns.push({
        x: rng.range(60, WORLD_W - 60),
        y: cy + (rng.chance(0.5) ? -1 : 1) * SIDEWALK_OFFSET + rng.range(-6, 6),
      });
    }
  }
  // A boardwalk crowd enjoying the harbour.
  for (let i = 0; i < 14; i += 1) {
    pedSpawns.push({ x: rng.range(80, WORLD_W - 80), y: rng.range(BOARDWALK_Y + 18, WATER_Y - 18) });
  }

  // --- Mission locations, each snapped onto a road or the boardwalk. -------
  const missionSpots = {
    garage: { x: 720, y: 1480, label: 'Voss Auto Works — garage' },
    pier: { x: 2640, y: 2480, label: 'Neon Harbor pier' },
    market: { x: 1680, y: 950, label: 'Market District stalls' },
    precinct: { x: 2160, y: 1200, label: 'Neon Harbor precinct' },
    hospital: { x: 3120, y: 950, label: 'Coral Bay hospital' },
    hideout: { x: 240, y: 1960, label: 'Old warehouse hideout' },
    uptown: { x: 3360, y: 240, label: 'Uptown Neon strip' },
    depot: { x: 3600, y: 1960, label: 'Harbor freight depot' },
  };

  const world = {
    seed: typeof seed === 'number' ? seed : null,
    width: WORLD_W,
    height: WORLD_H,
    buildings,
    parks,
    water: { y: WATER_Y, x: 0, w: WORLD_W, h: WORLD_H - WATER_Y },
    boardwalk: { x: 0, y: BOARDWALK_Y, w: WORLD_W, h: BOARDWALK_H },
    props,
    parkedSpawns,
    pedSpawns,
    districts: DISTRICTS.map((d) => ({ ...d })),
    missionSpots,
    districtAt(x, y) {
      return districtNameAt(x, y);
    },
  };
  return world;
}

// ---------------------------------------------------------------------------
// Geometry helpers (also used by vehicles, pedestrians, combat, police).
// ---------------------------------------------------------------------------

/** True when (x, y) is on a road surface on dry land. */
export function isOnRoad(world, x, y) {
  if (y >= WATER_Y) return false;
  if (x < 0 || x > WORLD_W || y < 0) return false;
  for (const cx of ROAD_CENTERS_X) if (Math.abs(x - cx) <= ROAD_HALF) return true;
  for (const cy of ROAD_CENTERS_Y) {
    if (cy > LAST_LAND_ROAD_Y) continue;
    if (Math.abs(y - cy) <= ROAD_HALF) return true;
  }
  return false;
}

/** True when (x, y) is in the harbour water. */
export function isInWater(world, x, y) {
  return y >= (world && world.water ? world.water.y : WATER_Y);
}

/** The building containing (x, y), or null. */
export function buildingAt(world, x, y) {
  if (!world || !world.buildings) return null;
  for (const b of world.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

/**
 * Push a circle of radius r centred at (x, y) out of every building and out
 * of the water, and clamp it inside the world. Returns a fresh { x, y } —
 * the input point is never mutated, so callers can measure how far the
 * correction moved them (a big correction at speed means a crash).
 * Buildings are resolved over two passes so corners where two buildings
 * meet in an alley settle instead of jittering.
 */
export function collideCircle(world, x, y, r) {
  let px = Math.min(WORLD_W - r, Math.max(r, x));
  let py = y;

  // Water blocks: nothing that collides as a circle may cross the waterline.
  const waterY = world && world.water ? world.water.y : WATER_Y;
  if (py + r > waterY) py = waterY - r;
  py = Math.min(WORLD_H - r, Math.max(r, py));

  if (world && world.buildings) {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const b of world.buildings) {
        const left = b.x - r;
        const right = b.x + b.w + r;
        const top = b.y - r;
        const bottom = b.y + b.h + r;
        if (px <= left || px >= right || py <= top || py >= bottom) continue;
        // Inside the expanded box: leave by the shallowest side.
        const toLeft = px - left;
        const toRight = right - px;
        const toTop = py - top;
        const toBottom = bottom - py;
        const min = Math.min(toLeft, toRight, toTop, toBottom);
        if (min === toLeft) px = left;
        else if (min === toRight) px = right;
        else if (min === toTop) py = top;
        else py = bottom;
      }
    }
  }

  // A building push must never shove the circle into the water or outside.
  px = Math.min(WORLD_W - r, Math.max(r, px));
  if (py + r > waterY) py = waterY - r;
  py = Math.min(WORLD_H - r, Math.max(r, py));
  return { x: px, y: py };
}
