// Neon Harbor: Vice Run — pedestrians.
//
// A ped is the shared shape from the contract:
//   { x, y, angle, speed, hp, kind: 'civilian' | 'gang' | 'officer',
//     color, state: 'walk' | 'flee' | 'fight' | 'down', tx, ty }
// (tx, ty) is the point the ped is currently walking toward.
//
// This module owns civilians: spawning them on sidewalks and the boardwalk,
// wandering them along the kerbs, and making them flee danger — gunfire, a
// car moving fast nearby, a speeding wanted player, or being clipped by a
// car (which puts them down and reports the crime through
// state.onCrime('hitped', x, y)). Gang members and officers are fought and
// commanded by combat.js / police.js; updatePed only gives them the basic
// flee / down behaviour so they never stand still in traffic.

import { TUNING, COLORS, SIDEWALK_OFFSET, ROAD_CENTERS_X, ROAD_CENTERS_Y, LAST_LAND_ROAD_Y, BOARDWALK_Y, WATER_Y, WORLD_W } from './config.js';
import { collideCircle } from './world.js';
import { hashNoise } from './random.js';

const PED_RADIUS = TUNING.peds.radius;

/** Spawn `count` civilians on sidewalks and the boardwalk. */
export function spawnPeds(world, rng, count) {
  const peds = [];
  const spawns = world && world.pedSpawns ? world.pedSpawns : [];
  for (let i = 0; i < count; i += 1) {
    let x; let y;
    if (spawns.length > 0) {
      const s = spawns[rng.int(0, spawns.length - 1)];
      x = s.x + rng.range(-14, 14);
      y = s.y + rng.range(-14, 14);
    } else {
      const cx = rng.pick(ROAD_CENTERS_X);
      x = cx + (rng.chance(0.5) ? -1 : 1) * SIDEWALK_OFFSET;
      y = rng.range(80, BOARDWALK_Y - 40);
    }
    if (world) {
      const fixed = collideCircle(world, x, y, PED_RADIUS);
      x = fixed.x; y = fixed.y;
    }
    const ped = {
      x, y,
      angle: rng.range(0, Math.PI * 2),
      speed: 0,
      hp: TUNING.peds.hp,
      kind: 'civilian',
      color: rng.pick(COLORS.clothing),
      skin: rng.pick(COLORS.skinTones),
      state: 'walk',
      tx: x, ty: y,
      // Private bookkeeping: a per-ped sequence counter feeding hashNoise,
      // so wander choices are deterministic without carrying an RNG.
      _seq: rng.int(1, 1e9),
      _fleeT: 0,
      _dangerX: 0,
      _dangerY: 0,
    };
    pickWanderTarget(ped, world);
    peds.push(ped);
  }
  return peds;
}

/**
 * Choose a new wander target: a point further along the same sidewalk (or
 * along the boardwalk), so civilians stroll the kerbs instead of cutting
 * through buildings. Falls back to a short hop in a random direction,
 * corrected out of buildings by collideCircle.
 */
export function pickWanderTarget(ped, world) {
  ped._seq = (ped._seq || 1) + 1;
  const roll = hashNoise(ped._seq, 11);
  const along = (hashNoise(ped._seq, 23) - 0.5) * 520;

  // On the boardwalk: stroll east-west along the promenade.
  if (ped.y >= BOARDWALK_Y - 6) {
    ped.tx = Math.min(WORLD_W - 30, Math.max(30, ped.x + along));
    ped.ty = Math.min(WATER_Y - 16, Math.max(BOARDWALK_Y + 14, ped.y + (roll - 0.5) * 30));
    return;
  }

  // Find the nearest road and walk parallel to it on the ped's own side.
  let bestV = null; let bestVDist = Infinity;
  for (const cx of ROAD_CENTERS_X) {
    const d = Math.abs(ped.x - cx);
    if (d < bestVDist) { bestVDist = d; bestV = cx; }
  }
  let bestH = null; let bestHDist = Infinity;
  for (const cy of ROAD_CENTERS_Y) {
    if (cy > LAST_LAND_ROAD_Y) continue;
    const d = Math.abs(ped.y - cy);
    if (d < bestHDist) { bestHDist = d; bestH = cy; }
  }
  if (bestV !== null && bestVDist <= bestHDist) {
    const side = ped.x < bestV ? -1 : 1;
    ped.tx = bestV + side * SIDEWALK_OFFSET;
    ped.ty = Math.min(BOARDWALK_Y - 24, Math.max(30, ped.y + along));
  } else if (bestH !== null) {
    const side = ped.y < bestH ? -1 : 1;
    ped.tx = Math.min(WORLD_W - 30, Math.max(30, ped.x + along));
    ped.ty = bestH + side * SIDEWALK_OFFSET;
  } else {
    ped.tx = ped.x + along * 0.4;
    ped.ty = ped.y + (roll - 0.5) * 200;
  }
  if (world) {
    const fixed = collideCircle(world, ped.tx, ped.ty, PED_RADIUS);
    ped.tx = fixed.x; ped.ty = fixed.y;
  }
}

/**
 * The nearest danger a ped can perceive, or null. Danger is: any bullet
 * close by, any car moving fast close by, or the player — on foot with a
 * weapon out at 2+ stars, or driving — closing in quickly.
 */
function senseDanger(ped, state) {
  if (!state) return null;
  let danger = null;
  let best = Infinity;
  const consider = (x, y, radius) => {
    const d = Math.hypot(x - ped.x, y - ped.y);
    if (d < radius && d < best) { best = d; danger = { x, y }; }
  };

  if (state.bullets) {
    for (const b of state.bullets) consider(b.x, b.y, 150);
  }
  if (state.cars) {
    for (const car of state.cars) {
      if (car.dead) continue;
      if (Math.abs(car.speed) > 95) consider(car.x, car.y, 120);
      else if (Math.abs(car.speed) > 30) consider(car.x, car.y, 44);
    }
  }
  if (state.copCars) {
    for (const car of state.copCars) {
      if (!car.dead && Math.abs(car.speed) > 130) consider(car.x, car.y, 90);
    }
  }
  const p = state.player;
  if (p) {
    const stars = state.wanted ? state.wanted.stars : 0;
    if (p.inCar) {
      const car = p.inCar;
      if (Math.abs(car.speed || 0) > 120) consider(p.x, p.y, 130);
    } else if (stars >= 2) {
      consider(p.x, p.y, 105);
    } else if (p.weapon && p.weapon !== 'fists') {
      consider(p.x, p.y, 55);
    }
  }
  // A fresh gunshot anywhere nearby (combat stamps state.lastShot).
  if (state.lastShot && state.time - state.lastShot.time < 1.2) {
    consider(state.lastShot.x, state.lastShot.y, 240);
  }
  return danger;
}

/**
 * Check car contact for one ped. A fast hit knocks the ped down and fires
 * the crime hook exactly once (the ped is 'down' afterwards, so it cannot
 * re-trigger); a slow nudge just steps the ped aside.
 */
function checkCarContact(ped, state) {
  if (!state || ped.state === 'down') return;
  const lists = [];
  if (state.cars) lists.push(state.cars);
  if (state.copCars) lists.push(state.copCars);
  for (const list of lists) {
    for (const car of list) {
      if (car.dead) continue;
      const reach = car.w * 0.5 + PED_RADIUS - 2;
      const dx = ped.x - car.x;
      const dy = ped.y - car.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      const speed = Math.abs(car.speed);
      if (speed > 42) {
        ped.state = 'down';
        ped.speed = 0;
        ped.hp -= Math.min(ped.hp, 10 + speed * 0.09);
        // Thrown clear of the car along the car's heading.
        ped.x += Math.cos(car.angle) * 16 + dx * 0.4;
        ped.y += Math.sin(car.angle) * 16 + dy * 0.4;
        if (state.particles) {
          for (let i = 0; i < 7; i += 1) {
            const a = hashNoise(ped._seq + i, 5) * Math.PI * 2;
            state.particles.push({
              x: ped.x, y: ped.y,
              vx: Math.cos(a) * (40 + i * 14),
              vy: Math.sin(a) * (40 + i * 14),
              life: 0.45,
              color: COLORS.coral,
              size: 2 + (i % 3),
            });
          }
        }
        if (typeof state.onCrime === 'function') state.onCrime('hitped', ped.x, ped.y);
        return;
      }
      if (speed > 4) {
        // Low-speed nudge: step away from the car and start fleeing it.
        const d = Math.max(6, Math.hypot(dx, dy));
        ped.x += (dx / d) * 9;
        ped.y += (dy / d) * 9;
        ped.state = 'flee';
        ped._fleeT = 0.8;
        ped._dangerX = car.x;
        ped._dangerY = car.y;
      }
    }
  }
}

/**
 * Advance one pedestrian by dt seconds. `state` is the shared game state;
 * state.world supplies the city for collision and wander targets.
 */
export function updatePed(ped, state, dt) {
  if (!ped || dt <= 0) return;
  const world = state ? state.world : null;

  if (ped.state === 'down') {
    ped.speed = 0;
    return;
  }
  if (ped.hp <= 0) {
    ped.hp = 0;
    ped.state = 'down';
    ped.speed = 0;
    return;
  }

  checkCarContact(ped, state);
  if (ped.state === 'down') return;

  const danger = senseDanger(ped, state);
  if (danger) {
    ped.state = 'flee';
    ped._fleeT = TUNING.peds.fleeMemory;
    ped._dangerX = danger.x;
    ped._dangerY = danger.y;
  } else if (ped.state === 'flee') {
    ped._fleeT -= dt;
    if (ped._fleeT <= 0) {
      ped.state = 'walk';
      pickWanderTarget(ped, world);
    }
  }

  // Non-civilians: combat.js / police.js own fighting and orders. Here
  // they only flee danger (above) or hold position.
  if (ped.kind !== 'civilian' && ped.state !== 'flee') {
    ped.speed = 0;
    return;
  }
  if (ped.state === 'fight') { ped.speed = 0; return; }

  let moveX = 0;
  let moveY = 0;
  let speed = 0;

  if (ped.state === 'flee') {
    const dx = ped.x - (ped._dangerX || ped.x);
    const dy = ped.y - (ped._dangerY || ped.y);
    const d = Math.hypot(dx, dy) || 1;
    moveX = dx / d;
    moveY = dy / d;
    speed = TUNING.peds.fleeSpeed;
    // Run for a visible target point so renderers can draw intent.
    ped.tx = ped.x + moveX * 120;
    ped.ty = ped.y + moveY * 120;
  } else {
    // Walk toward (tx, ty); pick a fresh target on arrival.
    const dx = ped.tx - ped.x;
    const dy = ped.ty - ped.y;
    const d = Math.hypot(dx, dy);
    if (d < 9) {
      pickWanderTarget(ped, world);
      ped.speed = 0;
      return;
    }
    moveX = dx / d;
    moveY = dy / d;
    speed = TUNING.peds.walkSpeed * (0.8 + hashNoise(ped._seq, 37) * 0.45);
  }

  ped.speed = speed;
  ped.angle = Math.atan2(moveY, moveX);
  let nx = ped.x + moveX * speed * dt;
  let ny = ped.y + moveY * speed * dt;
  if (world) {
    const fixed = collideCircle(world, nx, ny, PED_RADIUS);
    // A fleeing ped pushed sideways by a building should slide, not stick:
    // collideCircle already returns the shallowest exit, which gives the
    // slide for free. If fully blocked while walking, retarget.
    if (ped.state === 'walk'
      && Math.hypot(fixed.x - ped.x, fixed.y - ped.y) < speed * dt * 0.2) {
      pickWanderTarget(ped, world);
    }
    nx = fixed.x;
    ny = fixed.y;
  }
  ped.x = nx;
  ped.y = ny;
}
