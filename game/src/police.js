// police.js — Wanted level & police response for Neon Harbor: Vice Run.
//
// Heat is the raw pressure number; stars are derived from it through fixed
// thresholds. Crimes call addHeat() (main.js routes state.onCrime into heat
// for the crimes it scores). updateWanted() cools heat down once Mara has
// kept her head down for a few seconds. updatePolice() spawns patrol cars on
// roads around the player, drives them with simple manual steering, puts
// officers on foot when they get close, lets high-star officers shoot, and
// fills the bust meter when the law is close enough to grab her.
//
// Everything here is defensive about optional state fields: main.js owns the
// state object, this module only reads/writes the documented slices.

import { makeCar } from './vehicles.js';

/** Heat needed to reach 0..5 stars (index = stars). */
export const HEAT_THRESHOLDS = [0, 20, 45, 80, 130, 200];

/** Patrol cars allowed per star level (index = stars). */
const COP_CAPS = [0, 1, 2, 3, 5, 7];

/** Road centre lines from the shared world contract. */
const ROAD_XS = [240, 720, 1200, 1680, 2160, 2640, 3120, 3600];
const ROAD_YS = [240, 720, 1200, 1680, 2160, 2640];

const WORLD_W = 3840;
const WORLD_H = 2880;
const WATER_Y = 2520;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(dx, dy);
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function ensureWanted(state) {
  if (!state.wanted) state.wanted = { stars: 0, heat: 0, bust: 0 };
  const w = state.wanted;
  if (typeof w.heat !== 'number') w.heat = 0;
  if (typeof w.stars !== 'number') w.stars = 0;
  if (typeof w.bust !== 'number') w.bust = 0;
  if (typeof w.sinceCrime !== 'number') w.sinceCrime = 999;
  if (typeof w.spawnTimer !== 'number') w.spawnTimer = 0;
  return w;
}

export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 0; i < HEAT_THRESHOLDS.length; i += 1) {
    if (heat >= HEAT_THRESHOLDS[i]) stars = i;
  }
  return stars;
}

/**
 * Add heat from a crime or scripted pressure. Resets the cool-down clock and
 * refreshes the star rating immediately.
 */
export function addHeat(state, amount) {
  const w = ensureWanted(state);
  if (!amount || amount <= 0) return w.stars;
  w.heat = Math.max(0, w.heat + amount);
  w.sinceCrime = 0;
  if (typeof state.time === 'number') w.lastCrime = state.time;
  w.stars = starsForHeat(w.heat);
  return w.stars;
}

/**
 * Heat decay: after a short grace period with no fresh crime, heat bleeds
 * off (faster at low heat, so the last star lingers a little). Stars always
 * follow heat. The bust meter itself is handled in updatePolice.
 */
export function updateWanted(state, dt) {
  const w = ensureWanted(state);
  w.sinceCrime += dt;
  const GRACE = 5;
  if (w.sinceCrime > GRACE && w.heat > 0) {
    const calm = w.sinceCrime - GRACE;
    const rate = 1.6 + Math.min(2.4, calm * 0.12) + (w.stars <= 1 ? 0.9 : 0);
    w.heat = Math.max(0, w.heat - rate * dt);
  }
  w.stars = starsForHeat(w.heat);
  if (w.stars === 0) {
    w.heat = Math.max(0, w.heat - 3 * dt);
  }
}

// ---------------------------------------------------------------------------
// World helpers (contract-shaped, tolerant of implementation differences)
// ---------------------------------------------------------------------------

function collideResolve(state, x, y, r, prevX, prevY) {
  const world = state.world;
  if (!world || typeof world.collideCircle !== 'function') return { x, y, hit: false };
  let res;
  try {
    res = world.collideCircle(world, x, y, r);
  } catch {
    return { x, y, hit: false };
  }
  if (res && typeof res === 'object') {
    if (typeof res.x === 'number' && typeof res.y === 'number') {
      return { x: res.x, y: res.y, hit: res.x !== x || res.y !== y };
    }
    if (res.hit || res.collided || res.collision || res.blocked) {
      return { x: prevX, y: prevY, hit: true };
    }
    return { x, y, hit: false };
  }
  if (res === true) return { x: prevX, y: prevY, hit: true };
  return { x, y, hit: false };
}

function inWater(state, x, y) {
  const world = state.world;
  if (world && typeof world.isInWater === 'function') {
    try {
      return !!world.isInWater(world, x, y);
    } catch {
      return false;
    }
  }
  return y >= WATER_Y;
}

function nearestRoadCoord(v, lines) {
  let best = lines[0];
  let bestD = Math.abs(v - best);
  for (const line of lines) {
    const d = Math.abs(v - line);
    if (d < bestD) {
      bestD = d;
      best = line;
    }
  }
  return best;
}

/**
 * Find a road position roughly `range` px from the player: try points on the
 * ring around the player snapped onto the road grid, keep the first that is
 * on dry land, clear of buildings and a sensible distance away.
 */
function roadSpawnNear(state, range) {
  const px = state.player.x;
  const py = state.player.y;
  for (let i = 0; i < 14; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const d = range * (0.85 + Math.random() * 0.35);
    let x = px + Math.cos(a) * d;
    let y = py + Math.sin(a) * d;
    // Snap onto a road: either a vertical road (snap x) or horizontal (snap y).
    if (Math.random() < 0.5) x = nearestRoadCoord(x, ROAD_XS);
    else y = nearestRoadCoord(y, ROAD_YS);
    x = clamp(x, 60, WORLD_W - 60);
    y = clamp(y, 60, 2400);
    const dd = dist(px, py, x, y);
    if (dd < 420 || dd > 1150) continue;
    if (inWater(state, x, y)) continue;
    const res = collideResolve(state, x, y, 26, x, y);
    if (res.hit) continue;
    return { x: res.x, y: res.y };
  }
  // Fallback: a random intersection a few blocks away.
  const ix = ROAD_XS[Math.floor(Math.random() * ROAD_XS.length)];
  const iy = ROAD_YS[Math.floor(Math.random() * (ROAD_YS.length - 1))];
  return { x: ix, y: iy };
}

function getPlayerCar(state) {
  const p = state.player;
  if (p && p.inCar && typeof p.inCar === 'object') return p.inCar;
  if (state.playerCar) return state.playerCar;
  const all = [...(state.cars || []), ...(state.copCars || [])];
  return all.find((c) => c && c.driver === 'player') || null;
}

function pushParticle(state, p) {
  if (!Array.isArray(state.particles)) state.particles = [];
  if (state.particles.length < 900) state.particles.push(p);
}

// ---------------------------------------------------------------------------
// Police cars
// ---------------------------------------------------------------------------

function spawnCopCar(state) {
  if (!Array.isArray(state.copCars)) state.copCars = [];
  const spot = roadSpawnNear(state, 700);
  const angle = Math.atan2(state.player.y - spot.y, state.player.x - spot.x);
  let car;
  try {
    car = makeCar(spot.x, spot.y, angle, 'police', '#dfe6ee', 'police');
  } catch {
    car = null;
  }
  if (!car || typeof car !== 'object') {
    car = {
      x: spot.x, y: spot.y, angle, speed: 0, w: 76, h: 38,
      kind: 'police', color: '#dfe6ee', driver: 'police', hp: 120, dead: false,
    };
  }
  car.driver = 'police';
  car.kind = car.kind || 'police';
  if (typeof car.hp !== 'number') car.hp = 120;
  car.maxHp = car.maxHp || car.hp;
  car.officerSpawned = false;
  state.copCars.push(car);
  return car;
}

function removeCopCar(state, car) {
  if (Array.isArray(state.copCars)) {
    const i = state.copCars.indexOf(car);
    if (i >= 0) state.copCars.splice(i, 1);
  }
  if (Array.isArray(state.cars)) {
    const i = state.cars.indexOf(car);
    if (i >= 0) state.cars.splice(i, 1);
  }
}

/**
 * Manual car steering shared by patrol cars: steer toward a target point,
 * accelerate up to a cruise speed, brake when the target is close (on-foot
 * pursuit), and let the world collision resolver keep the car out of
 * buildings and off the water.
 */
function driveToward(state, car, tx, ty, cruise, dt, stopRange) {
  const dx = tx - car.x;
  const dy = ty - car.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const desired = Math.atan2(dy, dx);
  const diff = wrapAngle(desired - car.angle);
  const turnRate = 2.7;
  car.angle += clamp(diff, -turnRate * dt, turnRate * dt);

  let targetSpeed = cruise;
  if (stopRange > 0 && d < stopRange + 60) {
    targetSpeed = Math.min(cruise, Math.max(0, (d - stopRange) * 1.6));
  }
  // Slow for sharp turns so cars swing wide instead of spinning.
  if (Math.abs(diff) > 1.1) targetSpeed = Math.min(targetSpeed, cruise * 0.35);

  const accel = targetSpeed > (car.speed || 0) ? 300 : 520;
  if ((car.speed || 0) < targetSpeed) car.speed = Math.min(targetSpeed, (car.speed || 0) + accel * dt);
  else car.speed = Math.max(targetSpeed, (car.speed || 0) - accel * dt);

  const prevX = car.x;
  const prevY = car.y;
  let nx = car.x + Math.cos(car.angle) * car.speed * dt;
  let ny = car.y + Math.sin(car.angle) * car.speed * dt;
  if (inWater(state, nx, ny)) {
    car.speed *= 0.4;
    car.angle += 1.8 * dt; // nose away from the harbour
    nx = car.x;
    ny = car.y;
  }
  const res = collideResolve(state, nx, ny, Math.max(18, (car.h || 36) / 2), prevX, prevY);
  car.x = res.x;
  car.y = res.y;
  if (res.hit) {
    car.speed *= 0.35;
    // Nudge the nose toward the target so the car slides off the wall.
    car.angle += clamp(diff, -1, 1) * 1.6 * dt;
  }
  car.x = clamp(car.x, 24, WORLD_W - 24);
  car.y = clamp(car.y, 24, WORLD_H - 24);
  return d;
}

// ---------------------------------------------------------------------------
// Officers on foot
// ---------------------------------------------------------------------------

function spawnOfficer(state, car) {
  if (!Array.isArray(state.officers)) state.officers = [];
  const side = Math.random() < 0.5 ? -1 : 1;
  const ox = car.x + Math.cos(car.angle + Math.PI / 2) * 30 * side;
  const oy = car.y + Math.sin(car.angle + Math.PI / 2) * 30 * side;
  const officer = {
    x: ox, y: oy, angle: car.angle, speed: 0,
    hp: 34, maxHp: 34, kind: 'officer', color: '#2c4a7c',
    state: 'chase', tx: ox, ty: oy,
    shootCd: 0.6 + Math.random() * 0.9, dead: false,
  };
  state.officers.push(officer);
  return officer;
}

function updateOfficer(state, officer, dt) {
  const p = state.player;
  const d = dist(officer.x, officer.y, p.x, p.y);
  officer.angle = Math.atan2(p.y - officer.y, p.x - officer.x);

  // Movement: close in, but keep a small personal-space ring.
  const speed = 118;
  if (d > 30) {
    const step = Math.min(speed * dt, d - 24);
    const nx = officer.x + Math.cos(officer.angle) * step;
    const ny = officer.y + Math.sin(officer.angle) * step;
    if (!inWater(state, nx, ny)) {
      const res = collideResolve(state, nx, ny, 12, officer.x, officer.y);
      officer.x = res.x;
      officer.y = res.y;
    }
    officer.speed = speed;
  } else {
    officer.speed = 0;
  }

  // Shooting at 3+ stars: tracer fire with distance-based accuracy.
  if (state.wanted.stars >= 3 && d < 330 && d > 34 && !p.inCar) {
    officer.shootCd -= dt;
    if (officer.shootCd <= 0) {
      officer.shootCd = 0.85 + Math.random() * 0.7;
      const hitChance = clamp(0.52 - d / 1100, 0.1, 0.46);
      const tx = p.x + (Math.random() - 0.5) * 26;
      const ty = p.y + (Math.random() - 0.5) * 26;
      const ta = Math.atan2(ty - officer.y, tx - officer.x);
      const tSpeed = 950;
      pushParticle(state, {
        x: officer.x, y: officer.y,
        vx: Math.cos(ta) * tSpeed, vy: Math.sin(ta) * tSpeed,
        life: d / tSpeed, maxLife: d / tSpeed,
        size: 2, color: '#ffd76a', type: 'tracer',
      });
      pushParticle(state, {
        x: officer.x + Math.cos(officer.angle) * 14,
        y: officer.y + Math.sin(officer.angle) * 14,
        vx: 0, vy: 0, life: 0.05, maxLife: 0.05,
        size: 5, color: '#ffe9a3', type: 'muzzle',
      });
      if (Math.random() < hitChance && typeof state.damagePlayer === 'function') {
        state.damagePlayer(4 + Math.random() * 5);
      }
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Main police update
// ---------------------------------------------------------------------------

export function updatePolice(state, dt) {
  const w = ensureWanted(state);
  if (!Array.isArray(state.copCars)) state.copCars = [];
  if (!Array.isArray(state.officers)) state.officers = [];
  const p = state.player;
  const cap = COP_CAPS[clamp(w.stars, 0, 5)] || 0;

  // --- Spawning -------------------------------------------------------------
  w.spawnTimer -= dt;
  if (w.stars > 0 && state.copCars.length < cap && w.spawnTimer <= 0) {
    spawnCopCar(state);
    w.spawnTimer = 1.1 + Math.random() * 0.5;
  }

  // --- Cars -----------------------------------------------------------------
  const playerCar = getPlayerCar(state);
  const playerSpeed = p.inCar
    ? Math.abs((playerCar && playerCar.speed) || p.speed || 0)
    : 0;
  const cruise = 232 + w.stars * 24;

  for (let i = state.copCars.length - 1; i >= 0; i -= 1) {
    const car = state.copCars[i];
    if (!car) { state.copCars.splice(i, 1); continue; }
    const d = dist(car.x, car.y, p.x, p.y);

    // Despawn: wrecked cars vanish once far away; all cars leave when the
    // heat is gone and they are out of sight.
    if (d > 1500 || (w.stars === 0 && d > 430) || (car.dead && d > 700)) {
      removeCopCar(state, car);
      continue;
    }
    if (car.dead) { car.speed = 0; continue; }

    if (w.stars === 0) {
      // No heat: patrol away from the player and fade out via despawn range.
      driveToward(state, car, car.x + Math.cos(car.angle) * 300, car.y + Math.sin(car.angle) * 300, 120, dt, 0);
      continue;
    }

    // Pursuit: chase the player's position; if she is driving, aim at a lead
    // point so patrol cars cut her off and ram rather than trail forever.
    let tx = p.x;
    let ty = p.y;
    if (p.inCar && playerCar) {
      tx += Math.cos(playerCar.angle || 0) * (playerCar.speed || 0) * 0.35;
      ty += Math.sin(playerCar.angle || 0) * (playerCar.speed || 0) * 0.35;
    }
    const stopRange = p.inCar ? 0 : 84; // on foot: pull up and get out
    driveToward(state, car, tx, ty, cruise, dt, stopRange);

    // Officers bail out when close, or when the car is stopped nearby.
    const officerCap = Math.min(10, w.stars * 2 + 1);
    if (!car.officerSpawned && state.officers.length < officerCap) {
      const slow = Math.abs(car.speed || 0) < 46;
      if ((d < 175 && slow) || d < 90) {
        spawnOfficer(state, car);
        if (w.stars >= 2 && state.officers.length < officerCap) spawnOfficer(state, car);
        car.officerSpawned = true;
      }
    }
  }

  // --- Officers ---------------------------------------------------------------
  let nearestOfficer = Infinity;
  for (let i = state.officers.length - 1; i >= 0; i -= 1) {
    const officer = state.officers[i];
    if (!officer || officer.dead || officer.hp <= 0) {
      state.officers.splice(i, 1);
      continue;
    }
    const d = dist(officer.x, officer.y, p.x, p.y);
    if (d > 1500 || (w.stars === 0 && d > 460)) {
      state.officers.splice(i, 1);
      continue;
    }
    if (w.stars === 0) {
      // Heat gone: officers walk back toward their car / off screen.
      officer.state = 'leave';
      officer.x += Math.cos(officer.angle) * 40 * dt;
      officer.y += Math.sin(officer.angle) * 40 * dt;
      continue;
    }
    const dd = updateOfficer(state, officer, dt);
    if (dd < nearestOfficer) nearestOfficer = dd;
  }

  // --- Bust meter -------------------------------------------------------------
  let grabbed = false;
  if (w.stars > 0) {
    if (!p.inCar && nearestOfficer <= 46) grabbed = true;
    if (p.inCar && playerSpeed < 12) {
      for (const car of state.copCars) {
        if (car && !car.dead && dist(car.x, car.y, p.x, p.y) <= 70) {
          grabbed = true;
          break;
        }
      }
      if (!grabbed && nearestOfficer <= 40) grabbed = true;
    }
  }
  if (grabbed) w.bust = Math.min(1, w.bust + dt / 2.2);
  else w.bust = Math.max(0, w.bust - dt * (w.stars === 0 ? 0.9 : 0.35));

  if (w.bust >= 1 && !state.busted) {
    state.busted = true;
    state.screen = 'busted'; // main.js shows the busted screen & fine
  }
}
