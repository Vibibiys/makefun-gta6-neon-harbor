// Neon Harbor: Vice Run — cars: factory, traffic, and player driving.
//
// A car is the shared shape from the contract:
//   { x, y, angle, speed, w, h, kind, color,
//     driver: 'traffic' | 'parked' | 'player' | 'police' | 'van',
//     hp, route: { axis: 'v' | 'h', dir, lane }, dead }
// angle is radians, 0 = east, positive clockwise on screen (+y is down);
// speed is signed units/second along the heading (negative = reversing);
// w is the length along the heading, h the width across it.
//
// Traffic drives on road centre lines with a right-hand lane offset, goes
// straight through most intersections, sometimes turns, and slows for a
// car ahead. Player driving is an arcade scalar-speed model: throttle,
// brake/reverse, speed-sensitive steering, a handbrake that trades grip
// for turn rate, and building/water collision through collideCircle().

import {
  ROAD_CENTERS_X, ROAD_CENTERS_Y, LAST_LAND_ROAD_Y, WATER_Y, TUNING, COLORS,
} from './config.js';
import { collideCircle, isInWater } from './world.js';
import { hashNoise } from './random.js';

/** Lane offset from a centre line for right-hand traffic. */
export function laneOffset(axis, dir) {
  // Facing south (+y) your right hand points west (-x); facing east (+x)
  // it points south (+y); and symmetrically for north and west.
  if (axis === 'v') return dir > 0 ? -28 : 28;
  return dir > 0 ? 28 : -28;
}

function axisOfAngle(angle) {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return c >= s ? 'h' : 'v';
}

function dirOfAngle(axis, angle) {
  if (axis === 'v') return Math.sin(angle) >= 0 ? 1 : -1;
  return Math.cos(angle) >= 0 ? 1 : -1;
}

/** Performance and size for a car kind; unknown kinds fall back to sedan. */
export function carStats(kind) {
  const table = TUNING.cars;
  const s = table[kind] || table.sedan;
  return {
    maxSpeed: s.maxSpeed, accel: s.accel, brake: s.brake,
    reverse: s.reverse, turn: s.turn, hp: s.hp, w: s.w, h: s.h,
  };
}

const TRAFFIC_KINDS = [
  'sedan', 'sedan', 'sedan', 'sedan', 'sedan', 'sedan',
  'taxi', 'taxi', 'sports', 'van', 'van', 'truck',
];

function defaultColor(kind, rng) {
  if (kind === 'taxi') return COLORS.taxiPaint;
  if (kind === 'police') return COLORS.policePaint;
  if (kind === 'van' && rng) return rng.pick(COLORS.vanPaints);
  if (rng) return rng.pick(COLORS.carPaints);
  return COLORS.carPaints[0];
}

/** Build one car of the shared shape. */
export function makeCar(x, y, angle, kind, color, driver) {
  const k = kind || 'sedan';
  const stats = carStats(k);
  const axis = axisOfAngle(angle || 0);
  const dir = dirOfAngle(axis, angle || 0);
  return {
    x, y,
    angle: angle || 0,
    speed: 0,
    w: stats.w,
    h: stats.h,
    kind: k,
    color: color || defaultColor(k, null),
    driver: driver || 'parked',
    hp: stats.hp,
    maxHp: stats.hp,
    route: { axis, dir, lane: laneOffset(axis, dir) },
    dead: false,
    // Private bookkeeping (underscore-prefixed, not part of the contract):
    _turnCd: 0, // seconds before this car may turn at an intersection again
    _seed: Math.floor(hashNoise(Math.round(x), Math.round(y)) * 1e9),
  };
}

/**
 * Spawn `count` traffic cars on the road grid. Each starts on a lane of a
 * random land road, clear of intersections and of cars already placed.
 */
export function spawnTraffic(world, rng, count) {
  const cars = [];
  const landY = ROAD_CENTERS_Y.filter((cy) => cy <= LAST_LAND_ROAD_Y);
  let guard = 0;
  while (cars.length < count && guard < count * 40) {
    guard += 1;
    const kind = rng.pick(TRAFFIC_KINDS);
    const vertical = rng.chance(0.5);
    const dir = rng.chance(0.5) ? 1 : -1;
    let x; let y; let angle;
    if (vertical) {
      const cx = rng.pick(ROAD_CENTERS_X);
      x = cx + laneOffset('v', dir);
      y = rng.range(90, 2380);
      angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (landY.some((cy) => Math.abs(y - cy) < 80)) continue;
    } else {
      const cy = rng.pick(landY);
      y = cy + laneOffset('h', dir);
      x = rng.range(90, 3750);
      angle = dir > 0 ? 0 : Math.PI;
      if (ROAD_CENTERS_X.some((cx) => Math.abs(x - cx) < 80)) continue;
    }
    if (cars.some((c) => Math.hypot(c.x - x, c.y - y) < 110)) continue;
    const car = makeCar(x, y, angle, kind, defaultColor(kind, rng), kind === 'van' ? 'van' : 'traffic');
    // Traffic starts rolling at cruise speed so the city is alive at t=0.
    car.speed = carStats(kind).maxSpeed * TUNING.traffic.cruiseFactor * rng.range(0.75, 1);
    cars.push(car);
  }
  return cars;
}

/** The car directly ahead of `car` in its lane, within `dist`, or null. */
function carAhead(car, state, dist) {
  if (!state || !state.cars) return null;
  let best = null;
  let bestGap = dist;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  for (const other of state.cars) {
    if (other === car || other.dead) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const ahead = dx * fx + dy * fy;
    if (ahead <= 4 || ahead > dist) continue;
    const side = Math.abs(-dx * fy + dy * fx);
    if (side > 20) continue;
    if (ahead < bestGap) { bestGap = ahead; best = other; }
  }
  return best;
}

/** Snap a traffic car onto a (possibly new) route through an intersection. */
function setRoute(car, axis, dir, crossCenter) {
  car.route.axis = axis;
  car.route.dir = dir;
  car.route.lane = laneOffset(axis, dir);
  if (axis === 'v') {
    car.x = crossCenter + car.route.lane;
    car.angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  } else {
    car.y = crossCenter + car.route.lane;
    car.angle = dir > 0 ? 0 : Math.PI;
  }
}

/**
 * Advance one traffic car. Parked and player-driven cars are ignored;
 * police cars are driven by police.js and are also ignored here.
 */
export function updateTrafficCar(car, state, dt) {
  if (!car || car.dead || dt <= 0) return;
  if (car.driver !== 'traffic' && car.driver !== 'van') return;
  const world = state ? state.world : null;
  if (world && isInWater(world, car.x, car.y)) { car.speed = 0; return; }

  const stats = carStats(car.kind);
  const cruise = stats.maxSpeed * TUNING.traffic.cruiseFactor;
  car._turnCd = Math.max(0, (car._turnCd || 0) - dt);

  // Follow: match a slower car ahead, stop behind a stopped one.
  let desired = cruise;
  const ahead = carAhead(car, state, TUNING.traffic.followDistance + Math.max(0, car.speed) * 0.25);
  if (ahead) {
    const gap = Math.hypot(ahead.x - car.x, ahead.y - car.y);
    if (gap < TUNING.traffic.followBrakeDistance) desired = 0;
    else desired = Math.min(desired, Math.max(0, ahead.speed));
  }
  // A wanted player barrelling at traffic makes it get out of the way a
  // little faster — mostly flavour, but it sells the chase.
  if (state && state.wanted && state.wanted.stars >= 3 && state.player) {
    const d = Math.hypot(state.player.x - car.x, state.player.y - car.y);
    if (d < 190) desired = cruise * 1.25;
  }

  if (car.speed < desired) car.speed = Math.min(desired, car.speed + stats.accel * 0.7 * dt);
  else car.speed = Math.max(desired, car.speed - stats.brake * dt);

  const stepX = Math.cos(car.angle) * car.speed * dt;
  const stepY = Math.sin(car.angle) * car.speed * dt;
  const fromX = car.x;
  const fromY = car.y;
  car.x += stepX;
  car.y += stepY;

  // --- Intersections: crossing a cross-road centre is the turn decision. --
  if (car._turnCd <= 0 && car.speed > 20) {
    if (car.route.axis === 'v') {
      for (const cy of ROAD_CENTERS_Y) {
        if (cy > LAST_LAND_ROAD_Y) continue;
        const crossed = (fromY - cy) * (car.y - cy) <= 0 && Math.abs(car.y - cy) < Math.abs(stepY) + 2;
        if (!crossed) continue;
        const atGridEdge = cy === ROAD_CENTERS_Y[0] || cy === LAST_LAND_ROAD_Y;
        const roll = hashNoise(car._seed, Math.round(car.x) * 31 + Math.round(cy));
        if (atGridEdge || roll < TUNING.traffic.turnChance) {
          // Turn east or west; at the grid's north/south edge we must turn,
          // and the choice is biased back into the city.
          let dir = roll < 0.5 ? 1 : -1;
          if (car.x <= ROAD_CENTERS_X[0] + 1) dir = 1;
          if (car.x >= ROAD_CENTERS_X[ROAD_CENTERS_X.length - 1] - 1) dir = -1;
          car.y = cy;
          setRoute(car, 'h', dir, cy);
          car._turnCd = 1.2;
        }
        break;
      }
    } else {
      for (const cx of ROAD_CENTERS_X) {
        const crossed = (fromX - cx) * (car.x - cx) <= 0 && Math.abs(car.x - cx) < Math.abs(stepX) + 2;
        if (!crossed) continue;
        const atGridEdge = cx === ROAD_CENTERS_X[0] || cx === ROAD_CENTERS_X[ROAD_CENTERS_X.length - 1];
        const roll = hashNoise(car._seed, Math.round(cy0(car)) * 17 + Math.round(cx));
        if (atGridEdge || roll < TUNING.traffic.turnChance) {
          let dir = roll < 0.5 ? 1 : -1;
          // Never turn south off the last land road into the harbour, and
          // never north off the top road out of the city.
          if (car.y >= LAST_LAND_ROAD_Y - 1 && dir > 0) dir = -1;
          if (car.y <= ROAD_CENTERS_Y[0] + 1 && dir < 0) dir = 1;
          car.x = cx;
          setRoute(car, 'v', dir, cx);
          car._turnCd = 1.2;
        }
        break;
      }
    }
  }

  // Hard safety net: a southbound car that somehow reaches the last land
  // road turns along it instead of driving into the bay.
  if (car.route.axis === 'v' && car.route.dir > 0 && car.y > LAST_LAND_ROAD_Y + 30) {
    car.y = LAST_LAND_ROAD_Y;
    setRoute(car, 'h', car.x < 1920 ? 1 : -1, LAST_LAND_ROAD_Y);
    car._turnCd = 1.2;
  }
  if (car.x < 30 || car.x > 3810 || car.y < 30 || car.y > WATER_Y - 20) {
    car.x = Math.min(3810, Math.max(30, car.x));
    car.y = Math.min(WATER_Y - 20, Math.max(30, car.y));
    if (car.speed > 0) car.speed = Math.min(car.speed, cruise);
  }
}

function cy0(car) { return car.y; }

// ---------------------------------------------------------------------------
// Player driving.
// ---------------------------------------------------------------------------

/** Read a control from any of the input shapes the game passes around. */
function control(input, codes, props) {
  if (!input) return false;
  if (input.keys && typeof input.keys.has === 'function') {
    for (const c of codes) if (input.keys.has(c)) return true;
  }
  for (const p of props) if (input[p]) return true;
  return false;
}

/**
 * Drive the player's car for one step.
 *
 * `input` may be the createInput() object (its keys Set is read), a plain
 * { up, down, left, right, handbrake } object, or null (the car coasts).
 * Collisions with buildings and water go through collideCircle(); a hard
 * correction costs speed and hull. Returns the impact speed of any wall
 * hit this step (0 for none) so callers can play a crunch and add heat.
 */
export function drivePhysics(car, input, dt, world) {
  if (!car || car.dead || dt <= 0) return 0;
  const stats = carStats(car.kind);
  const up = control(input, ['KeyW', 'ArrowUp'], ['up', 'forward', 'accelerate']);
  const down = control(input, ['KeyS', 'ArrowDown'], ['down', 'back', 'brake']);
  const left = control(input, ['KeyA', 'ArrowLeft'], ['left']);
  const right = control(input, ['KeyD', 'ArrowRight'], ['right']);
  const handbrake = control(input, ['Space', 'ShiftLeft', 'ShiftRight'], ['handbrake', 'drift']);

  // Throttle / brake / reverse.
  if (up) {
    car.speed += stats.accel * dt;
  } else if (down) {
    if (car.speed > 12) car.speed -= stats.brake * dt;
    else car.speed -= stats.accel * 0.55 * dt; // pull away in reverse
  } else {
    // Engine braking and rolling drag.
    const drag = 26 + Math.abs(car.speed) * 0.12;
    if (car.speed > 0) car.speed = Math.max(0, car.speed - drag * dt);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + drag * dt);
  }
  if (handbrake) {
    const grip = 300;
    if (car.speed > 0) car.speed = Math.max(0, car.speed - grip * dt);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + grip * dt);
  }
  car.speed = Math.min(stats.maxSpeed, Math.max(-stats.reverse, car.speed));

  // Steering: authority grows with speed, fades at the very top end, and
  // flips in reverse like a real wheel. The handbrake trades grip for yaw.
  const steer = (right ? 1 : 0) - (left ? 1 : 0);
  if (steer !== 0 && car.speed !== 0) {
    const speedRatio = Math.min(1, Math.abs(car.speed) / 120);
    const topEndFade = 1 - 0.35 * Math.max(0, (Math.abs(car.speed) / stats.maxSpeed) - 0.7) / 0.3;
    const driftBoost = handbrake ? 1.75 : 1;
    const direction = car.speed >= 0 ? 1 : -1;
    car.angle += steer * stats.turn * speedRatio * topEndFade * driftBoost * direction * dt;
  }

  // Integrate, then let the city push back.
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  let impact = 0;
  if (world) {
    const radius = Math.max(11, car.h * 0.72);
    const fixed = collideCircle(world, nx, ny, radius);
    const correction = Math.hypot(fixed.x - nx, fixed.y - ny);
    if (correction > 1.5) {
      impact = Math.abs(car.speed) * (correction > 6 ? 1 : 0.5);
      if (Math.abs(car.speed) > 110 && correction > 4) {
        car.hp -= (Math.abs(car.speed) - 100) * 0.06;
        if (car.hp <= 0) { car.hp = 0; car.dead = true; }
      }
      car.speed *= correction > 6 ? 0.35 : 0.7;
    }
    car.x = fixed.x;
    car.y = fixed.y;
  } else {
    car.x = nx;
    car.y = ny;
  }
  return impact;
}

// ---------------------------------------------------------------------------
// Car-to-car contact.
// ---------------------------------------------------------------------------

/**
 * Simple circle collision between two cars: separate them, trade the
 * closing part of their speeds, dent both hulls, and (when `state` is
 * given) throw sparks into state.particles. Returns true on contact.
 */
export function carHit(a, b, state) {
  if (!a || !b || a === b || a.dead || b.dead) return false;
  const ra = a.w * 0.42;
  const rb = b.w * 0.42;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = ra + rb;
  if (dist >= minDist || dist === 0) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  // Separate by overlap, the heavier (longer) car giving less ground.
  const total = a.w + b.w;
  a.x -= nx * overlap * (b.w / total);
  a.y -= ny * overlap * (b.w / total);
  b.x += nx * overlap * (a.w / total);
  b.y += ny * overlap * (a.w / total);

  // Velocities along the contact normal, traded with some loss.
  const avx = Math.cos(a.angle) * a.speed;
  const avy = Math.sin(a.angle) * a.speed;
  const bvx = Math.cos(b.angle) * b.speed;
  const bvy = Math.sin(b.angle) * b.speed;
  const aNormal = avx * nx + avy * ny;
  const bNormal = bvx * nx + bvy * ny;
  const closing = aNormal - bNormal;
  if (closing > 0) {
    const restitution = 0.35;
    const impulse = closing * (0.5 + restitution * 0.5);
    // Fold the traded normal speed back into each car's scalar speed by
    // projecting onto its own heading.
    const aDot = Math.cos(a.angle) * nx + Math.sin(a.angle) * ny;
    const bDot = Math.cos(b.angle) * nx + Math.sin(b.angle) * ny;
    a.speed -= impulse * Math.sign(aDot || 1) * Math.min(1, Math.abs(aDot) + 0.35);
    b.speed += impulse * Math.sign(bDot || 1) * Math.min(1, Math.abs(bDot) + 0.35);

    const damage = Math.max(0, closing - 40) * 0.09;
    a.hp -= damage;
    b.hp -= damage;
    if (a.hp <= 0) { a.hp = 0; a.dead = true; a.speed = 0; }
    if (b.hp <= 0) { b.hp = 0; b.dead = true; b.speed = 0; }

    if (state && state.particles) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const count = Math.min(14, 5 + Math.floor(closing / 28));
      for (let i = 0; i < count; i += 1) {
        const spread = hashNoise(Math.round(mx) + i * 7, Math.round(my) + i * 13) * Math.PI * 2;
        const spd = 60 + hashNoise(i * 3, Math.round(closing)) * 190;
        state.particles.push({
          x: mx, y: my,
          vx: Math.cos(spread) * spd,
          vy: Math.sin(spread) * spd - 30,
          life: 0.3 + hashNoise(i, 99) * 0.4,
          color: i % 3 === 0 ? COLORS.yellow : COLORS.explosion,
          size: 2 + (i % 3),
        });
      }
    }
  }
  return true;
}
