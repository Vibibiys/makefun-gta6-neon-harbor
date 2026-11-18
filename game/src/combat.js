// combat.js — Weapons, bullets and street violence for Neon Harbor: Vice Run.
//
// The player fires with the mouse (state.input.mouse + state.mouseWorld),
// gang members shoot back through updateGang(), and bullets are plain
// objects in state.bullets: {x, y, vx, vy, life, from, damage}. Hits are
// resolved here against buildings (local point-in-rect test), peds,
// officers, cars and the player. Crimes are reported through
// state.onCrime(type, x, y) exactly as the shared contract specifies:
// 'shoot' for every trigger pull, 'kill' only for civilian/officer deaths
// (gang kills are counted in state.stats.kills and by missions instead).

export const WEAPONS = {
  fists: {
    id: 'fists', name: 'Fists', damage: 9, range: 54,
    rate: 0.32, cooldown: 0.32, spread: 0, pellets: 1,
    ammo: null, bulletSpeed: 0, automatic: false,
  },
  pistol: {
    id: 'pistol', name: 'Harbor Pistol', damage: 16, range: 660,
    rate: 0.24, cooldown: 0.24, spread: 0.022, pellets: 1,
    ammo: 'pistol', bulletSpeed: 980, automatic: false,
  },
  smg: {
    id: 'smg', name: 'Neon SMG', damage: 10, range: 580,
    rate: 0.09, cooldown: 0.09, spread: 0.075, pellets: 1,
    ammo: 'smg', bulletSpeed: 1020, automatic: true,
  },
  shotgun: {
    id: 'shotgun', name: 'Dockside Shotgun', damage: 9, range: 350,
    rate: 0.85, cooldown: 0.85, spread: 0.17, pellets: 6,
    ammo: 'shells', bulletSpeed: 840, automatic: false,
  },
};

const AMMO_TYPES = ['pistol', 'smg', 'shells'];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function ensureWeapons(state) {
  if (!state.weapons || typeof state.weapons !== 'object') {
    state.weapons = { owned: { fists: true }, ammo: { pistol: 0, smg: 0, shells: 0 } };
  }
  if (!state.weapons.owned) state.weapons.owned = { fists: true };
  if (!state.weapons.ammo) state.weapons.ammo = { pistol: 0, smg: 0, shells: 0 };
  for (const t of AMMO_TYPES) {
    if (typeof state.weapons.ammo[t] !== 'number') state.weapons.ammo[t] = 0;
  }
  state.weapons.owned.fists = true;
  const p = state.player;
  if (p) {
    if (!p.weapon || !WEAPONS[p.weapon]) p.weapon = 'fists';
    // Mirror the current weapon's reserve onto player.ammo for HUD/save code.
    const w = WEAPONS[p.weapon];
    p.ammo = w.ammo ? state.weapons.ammo[w.ammo] : Infinity;
  }
  return state.weapons;
}

/**
 * Give Mara a weapon (and optionally ammo for it). Equips it if she does not
 * already hold something stronger in hand; fists are always owned.
 */
export function giveWeapon(state, id, ammo = 0) {
  const w = WEAPONS[id];
  if (!w) return false;
  const inv = ensureWeapons(state);
  inv.owned[id] = true;
  if (w.ammo && ammo > 0) inv.ammo[w.ammo] += ammo;
  const p = state.player;
  if (p) {
    const order = ['fists', 'pistol', 'smg', 'shotgun'];
    if (order.indexOf(id) >= order.indexOf(p.weapon || 'fists')) p.weapon = id;
    p.ammo = WEAPONS[p.weapon].ammo ? inv.ammo[WEAPONS[p.weapon].ammo] : Infinity;
  }
  return true;
}

export function addAmmo(state, ammoType, amount) {
  const inv = ensureWeapons(state);
  if (inv.ammo[ammoType] === undefined) return;
  inv.ammo[ammoType] += amount;
  ensureWeapons(state); // refresh player.ammo mirror
}

function pushParticle(state, p) {
  if (!Array.isArray(state.particles)) state.particles = [];
  if (state.particles.length < 900) state.particles.push(p);
}

function burst(state, x, y, n, color, speed, life, size, type) {
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    pushParticle(state, {
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: life * (0.5 + Math.random() * 0.5), maxLife: life,
      size: size * (0.6 + Math.random() * 0.7), color, type: type || 'spark',
    });
  }
}

function crime(state, type, x, y) {
  if (typeof state.onCrime === 'function') {
    try { state.onCrime(type, x, y); } catch { /* main owns crime scoring */ }
  }
}

function audioShot(state, kind) {
  if (state.audio && typeof state.audio.shot === 'function') {
    try { state.audio.shot(kind); } catch { /* audio is best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// Hit tests
// ---------------------------------------------------------------------------

/** Local point-in-building test against world.buildings rectangles. */
export function pointInBuilding(world, x, y) {
  if (!world) return false;
  if (typeof world.buildingAt === 'function') {
    try {
      if (world.buildingAt(world, x, y)) return true;
    } catch { /* fall through to rect scan */ }
  }
  const buildings = world.buildings || [];
  for (const b of buildings) {
    if (!b) continue;
    const w = b.w !== undefined ? b.w : b.width;
    const h = b.h !== undefined ? b.h : b.height;
    if (w === undefined || h === undefined) continue;
    // Buildings may be stored by centre or by top-left corner.
    if (b.cx !== undefined || b.center) {
      if (Math.abs(x - b.x) <= w / 2 && Math.abs(y - b.y) <= h / 2) return true;
    } else if (x >= b.x && x <= b.x + w && y >= b.y && y <= b.y + h) {
      return true;
    }
  }
  return false;
}

function pointInCar(car, x, y) {
  const w = (car.w || 76) / 2 + 3;
  const h = (car.h || 38) / 2 + 3;
  const dx = x - car.x;
  const dy = y - car.y;
  const c = Math.cos(-(car.angle || 0));
  const s = Math.sin(-(car.angle || 0));
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= w && Math.abs(ly) <= h;
}

function getPlayerCar(state) {
  const p = state.player;
  if (p && p.inCar && typeof p.inCar === 'object') return p.inCar;
  if (state.playerCar) return state.playerCar;
  const all = [...(state.cars || []), ...(state.copCars || [])];
  return all.find((c) => c && c.driver === 'player') || null;
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * Apply damage to a ped/officer. `byPlayer` marks player-caused damage for
 * stats/crime reporting. Returns true if the ped died from this hit.
 */
export function damagePed(state, ped, damage, byPlayer, angle = 0) {
  if (!ped || ped.dead) return false;
  ped.hp -= damage;
  burst(state, ped.x, ped.y, 3, ped.kind === 'officer' ? '#7fa8e0' : '#e0483e', 90, 0.3, 3, 'hit');
  if (ped.kind === 'civilian') ped.state = 'flee';
  else ped.state = 'aggro';
  if (ped.hp > 0) return false;

  ped.dead = true;
  ped.hp = 0;
  ped.deathTimer = 6;
  burst(state, ped.x, ped.y, 12, '#c22e2e', 150, 0.55, 3, 'hit');

  if (byPlayer) {
    if (ped.kind === 'gang') {
      if (state.stats) state.stats.kills += 1;
      // Street justice still rattles the neighbourhood a little.
      crime(state, 'gangKill', ped.x, ped.y);
      // Gangers sometimes drop loose ammo.
      if (Math.random() < 0.3 && Array.isArray(state.pickups)) {
        const types = ['pistol', 'smg', 'shells'];
        state.pickups.push({
          x: ped.x, y: ped.y, type: 'ammo',
          ammoType: types[Math.floor(Math.random() * types.length)],
          amount: 6 + Math.floor(Math.random() * 8),
        });
      }
    } else {
      // Civilian or officer down: a real crime, reported as a kill.
      if (state.stats) state.stats.kills += 1;
      crime(state, 'kill', ped.x, ped.y);
    }
  }
  void angle;
  return true;
}

function damageCar(state, car, damage, byPlayer) {
  if (!car || car.dead) return;
  car.hp -= damage;
  burst(state, car.x, car.y, 2, '#ffb347', 80, 0.25, 2, 'spark');
  if (car.hp <= 0) {
    car.hp = 0;
    car.dead = true;
    car.speed = 0;
    burst(state, car.x, car.y, 26, '#ff7a2f', 240, 0.8, 5, 'explosion');
    burst(state, car.x, car.y, 14, '#3a3f4a', 90, 1.1, 7, 'smoke');
    if (byPlayer) crime(state, 'explosion', car.x, car.y);
  }
}

// ---------------------------------------------------------------------------
// Player attacks
// ---------------------------------------------------------------------------

function meleeAttack(state) {
  const p = state.player;
  const w = WEAPONS.fists;
  p.fireCd = w.cooldown;
  const targets = [...(state.peds || []), ...(state.officers || [])];
  let best = null;
  let bestD = Infinity;
  for (const ped of targets) {
    if (!ped || ped.dead) continue;
    const d = dist(p.x, p.y, ped.x, ped.y);
    if (d <= w.range + 12 && d < bestD) { best = ped; bestD = d; }
  }
  // A swing at a car dents it and definitely counts as trouble.
  if (!best) {
    const cars = [...(state.cars || []), ...(state.copCars || [])];
    for (const car of cars) {
      if (car && !car.dead && pointInCar(car, p.x + Math.cos(p.angle) * 30, p.y + Math.sin(p.angle) * 30)) {
        damageCar(state, car, w.damage, true);
        crime(state, 'assault', p.x, p.y);
        return;
      }
    }
    burst(state, p.x + Math.cos(p.angle) * 22, p.y + Math.sin(p.angle) * 22, 2, '#cfd8e3', 40, 0.15, 2, 'swing');
    return;
  }
  damagePed(state, best, w.damage, true, p.angle);
  crime(state, 'assault', p.x, p.y);
  audioShot(state, 'fists');
}

function playerShoot(state) {
  const p = state.player;
  const inv = ensureWeapons(state);
  const w = WEAPONS[p.weapon] || WEAPONS.fists;
  if (!w.ammo) { meleeAttack(state); return; }
  if (inv.ammo[w.ammo] <= 0) {
    p.fireCd = 0.28;
    state.message = `Out of ${w.ammo} — find ammo or switch weapons.`;
    state.messageTimer = 2;
    return;
  }
  inv.ammo[w.ammo] -= 1;
  p.ammo = inv.ammo[w.ammo];
  p.fireCd = w.cooldown;
  state.lastShotTime = typeof state.time === 'number' ? state.time : performanceNow(state);

  const mw = state.mouseWorld || { x: p.x + Math.cos(p.angle) * 100, y: p.y + Math.sin(p.angle) * 100 };
  const base = Math.atan2(mw.y - p.y, mw.x - p.x);
  p.angle = base;
  if (!Array.isArray(state.bullets)) state.bullets = [];
  for (let i = 0; i < w.pellets; i += 1) {
    const a = base + (Math.random() - 0.5) * 2 * w.spread + (w.pellets > 1 ? (i - (w.pellets - 1) / 2) * 0.045 : 0);
    state.bullets.push({
      x: p.x + Math.cos(base) * 18,
      y: p.y + Math.sin(base) * 18,
      vx: Math.cos(a) * w.bulletSpeed,
      vy: Math.sin(a) * w.bulletSpeed,
      life: w.range / w.bulletSpeed,
      from: 'player', damage: w.damage, kind: p.weapon,
    });
  }
  pushParticle(state, {
    x: p.x + Math.cos(base) * 22, y: p.y + Math.sin(base) * 22,
    vx: 0, vy: 0, life: 0.05, maxLife: 0.05, size: 6, color: '#ffe9a3', type: 'muzzle',
  });
  crime(state, 'shoot', p.x, p.y);
  audioShot(state, p.weapon);
}

function performanceNow(state) {
  state._clock = (state._clock || 0);
  return state._clock;
}

// ---------------------------------------------------------------------------
// Bullet simulation
// ---------------------------------------------------------------------------

function stepBullet(state, b, dt) {
  b.life -= dt;
  if (b.life <= 0) return false;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < 0 || b.y < 0 || b.x > 3840 || b.y > 2880) return false;

  if (pointInBuilding(state.world, b.x, b.y)) {
    burst(state, b.x, b.y, 3, '#ffd76a', 110, 0.25, 2, 'spark');
    return false;
  }

  const p = state.player;

  if (b.from === 'player') {
    // Peds and officers.
    const targets = [...(state.peds || []), ...(state.officers || [])];
    for (const ped of targets) {
      if (!ped || ped.dead) continue;
      if (dist(b.x, b.y, ped.x, ped.y) <= 14) {
        damagePed(state, ped, b.damage, true, Math.atan2(b.vy, b.vx));
        return false;
      }
    }
    // Cars (including patrol cars and mission vehicles).
    const cars = [...(state.cars || []), ...(state.copCars || [])];
    for (const car of cars) {
      if (!car || car.dead) continue;
      if (car.driver === 'player') continue;
      if (pointInCar(car, b.x, b.y)) {
        damageCar(state, car, b.damage, true);
        return false;
      }
    }
  } else {
    // Enemy bullet vs the player.
    if (p.inCar) {
      const car = getPlayerCar(state);
      if (car && pointInCar(car, b.x, b.y)) {
        damageCar(state, car, b.damage * 0.7, false);
        if (Math.random() < 0.22 && typeof state.damagePlayer === 'function') {
          state.damagePlayer(Math.max(1, Math.round(b.damage * 0.35)));
        }
        return false;
      }
    } else if (dist(b.x, b.y, p.x, p.y) <= 15) {
      if (typeof state.damagePlayer === 'function') state.damagePlayer(b.damage);
      burst(state, p.x, p.y, 4, '#e0483e', 90, 0.3, 3, 'hit');
      return false;
    }
    // Enemy bullets can wing bystanders too (no crime attribution).
    for (const ped of state.peds || []) {
      if (!ped || ped.dead || ped.kind === 'gang') continue;
      if (dist(b.x, b.y, ped.x, ped.y) <= 13) {
        damagePed(state, ped, b.damage, false);
        return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main combat update
// ---------------------------------------------------------------------------

export function updateCombat(state, dt) {
  const p = state.player;
  if (!p) return;
  ensureWeapons(state);
  if (typeof p.fireCd !== 'number') p.fireCd = 0;
  p.fireCd = Math.max(0, p.fireCd - dt);
  state._clock = (state._clock || 0) + dt;

  // --- Player attack input ---------------------------------------------------
  const mouse = (state.input && state.input.mouse) || {};
  const down = !!mouse.down;
  const clicked = !!mouse.clicked || (down && !state._prevMouseDown);
  state._prevMouseDown = down;

  if (!p.inCar && p.fireCd <= 0) {
    const w = WEAPONS[p.weapon] || WEAPONS.fists;
    if (w.id === 'fists') {
      if (clicked) meleeAttack(state);
    } else if (w.automatic ? down : clicked) {
      playerShoot(state);
    }
  }

  // --- Bullets -----------------------------------------------------------------
  if (Array.isArray(state.bullets)) {
    for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
      if (!stepBullet(state, state.bullets[i], dt)) state.bullets.splice(i, 1);
    }
  }

  // --- Corpse cleanup ------------------------------------------------------------
  for (const listName of ['peds', 'officers']) {
    const list = state[listName];
    if (!Array.isArray(list)) continue;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const ped = list[i];
      if (ped && ped.dead) {
        ped.deathTimer = (ped.deathTimer !== undefined ? ped.deathTimer : 6) - dt;
        if (ped.deathTimer <= 0) list.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Gang AI (also used for mission muscle)
// ---------------------------------------------------------------------------

/**
 * One gang member's brain. Gang peds hang idle until the player is close and
 * either a mission is live, the ped is already aggro, or shots were just
 * fired nearby — then they close to rifle range (120–170px) and shoot.
 */
export function updateGang(ped, state, dt) {
  if (!ped || ped.dead) return;
  const p = state.player;
  if (!p) return;
  if (typeof ped.shootCd !== 'number') ped.shootCd = 0.5 + Math.random();
  ped.shootCd -= dt;

  const d = dist(ped.x, ped.y, p.x, p.y);
  const recentShot = typeof state.lastShotTime === 'number'
    && ((typeof state.time === 'number' ? state.time : state._clock || 0) - state.lastShotTime) < 4;
  const missionActive = !!(state.missionState && state.missionState.active && !state.missionState.done);
  const hostile = ped.state === 'aggro' || (d < 260 && (missionActive || recentShot));

  if (!hostile) {
    // Idle: drift toward a loiter point if one was assigned.
    ped.state = ped.state === 'aggro' ? 'idle' : (ped.state || 'idle');
    if (typeof ped.tx === 'number' && typeof ped.ty === 'number') {
      const td = dist(ped.x, ped.y, ped.tx, ped.ty);
      if (td > 12) {
        const a = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
        ped.angle = a;
        ped.x += Math.cos(a) * 34 * dt;
        ped.y += Math.sin(a) * 34 * dt;
        ped.speed = 34;
      } else ped.speed = 0;
    } else ped.speed = 0;
    return;
  }

  ped.state = 'aggro';
  ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);

  // Keep fighting distance: approach past 170, back off inside 110, strafe between.
  let mx = 0;
  let my = 0;
  const speed = 104;
  if (d > 170) {
    mx = Math.cos(ped.angle);
    my = Math.sin(ped.angle);
  } else if (d < 110) {
    mx = -Math.cos(ped.angle);
    my = -Math.sin(ped.angle);
  } else {
    const strafeDir = ped.strafeDir || (ped.strafeDir = Math.random() < 0.5 ? -1 : 1);
    if (Math.random() < dt * 0.25) ped.strafeDir = -strafeDir;
    mx = Math.cos(ped.angle + Math.PI / 2) * strafeDir * 0.6;
    my = Math.sin(ped.angle + Math.PI / 2) * strafeDir * 0.6;
  }
  const nx = ped.x + mx * speed * dt;
  const ny = ped.y + my * speed * dt;
  // Buildings block gang movement via the same point test bullets use:
  // only step if the destination is not inside a building footprint.
  if (!pointInBuilding(state.world, nx, ny)) {
    ped.x = clamp(nx, 16, 3824);
    ped.y = clamp(ny, 16, 2500);
  }
  ped.speed = (mx || my) ? speed : 0;

  // Shoot: aimed bursts with distance-based spread, through state.bullets.
  if (d < 300 && ped.shootCd <= 0 && !p.inCar) {
    ped.shootCd = 0.75 + Math.random() * 0.6;
    if (!Array.isArray(state.bullets)) state.bullets = [];
    const spread = 0.05 + d / 3000;
    const a = ped.angle + (Math.random() - 0.5) * 2 * spread;
    state.bullets.push({
      x: ped.x + Math.cos(ped.angle) * 16,
      y: ped.y + Math.sin(ped.angle) * 16,
      vx: Math.cos(a) * 800, vy: Math.sin(a) * 800,
      life: 0.42, from: 'enemy', damage: 7, kind: 'gang',
    });
    pushParticle(state, {
      x: ped.x + Math.cos(ped.angle) * 18, y: ped.y + Math.sin(ped.angle) * 18,
      vx: 0, vy: 0, life: 0.05, maxLife: 0.05, size: 5, color: '#ffb37a', type: 'muzzle',
    });
    crime(state, 'shoot', ped.x, ped.y);
  } else if (d < 300 && ped.shootCd <= 0 && p.inCar) {
    // Shooting at a moving car: bullets fly, the car soaks most of it.
    ped.shootCd = 0.9 + Math.random() * 0.6;
    if (!Array.isArray(state.bullets)) state.bullets = [];
    const a = ped.angle + (Math.random() - 0.5) * 0.16;
    state.bullets.push({
      x: ped.x + Math.cos(ped.angle) * 16,
      y: ped.y + Math.sin(ped.angle) * 16,
      vx: Math.cos(a) * 800, vy: Math.sin(a) * 800,
      life: 0.42, from: 'enemy', damage: 6, kind: 'gang',
    });
  }
}
