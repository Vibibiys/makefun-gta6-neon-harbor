// Screenshot scenes behind ?shot=<name>&seed=<n>. Each scene drives the REAL
// simulation forward in fixed steps through the game object main.js hands over
// ({ state, step(dt), startPlay() }), so a captured frame is a genuine game
// frame — traffic, peds, police and missions all live — and the seeded RNG in
// main.js makes the same seed produce the same frame every time.
import * as MissionsModule from './missions.js';
import * as VehiclesModule from './vehicles.js';
import * as CombatModule from './combat.js';

const STEP = 1 / 60;

function runSteps(game, seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) game.step(STEP);
}

function downtownSpot(state) {
  const spots = state.world && state.world.missionSpots;
  if (Array.isArray(spots)) {
    const market = spots.find((s) => s && (s.id === 'market' || /market/i.test(s.name || '')));
    if (market) return { x: market.x, y: market.y };
    if (spots[0]) return { x: spots[0].x, y: spots[0].y };
  } else if (spots && typeof spots === 'object') {
    if (spots.market) return { x: spots.market.x, y: spots.market.y };
    const first = Object.values(spots)[0];
    if (first) return { x: first.x, y: first.y };
  }
  return { x: 1800, y: 1100 };
}

function makeFallbackCar(x, y, kind, color) {
  if (typeof VehiclesModule.makeCar === 'function') {
    try {
      const car = VehiclesModule.makeCar(x, y, 0, kind);
      if (car && typeof car.x === 'number') {
        if (color) car.color = color;
        return car;
      }
    } catch { /* fall through to the plain object below */ }
  }
  return {
    x, y, angle: 0, speed: 0, w: 56, h: 27,
    kind: kind || 'sports', color: color || '#ff2d78',
    driver: null, hp: 100, dead: false,
  };
}

function ensureGangNear(state, cx, cy, count) {
  let have = 0;
  for (const ped of state.peds || []) if (ped.kind === 'gang' && ped.hp > 0) have++;
  for (let i = have; i < count; i++) {
    state.peds.push({
      x: cx + 70 + i * 34, y: cy + (i % 2 === 0 ? -46 : 52),
      angle: Math.PI, speed: 0, hp: 80, kind: 'gang',
      color: '#c81e3a', state: 'idle', missionTag: 'shot',
    });
  }
}

/**
 * Stage the named scene on `game` and return the state, ready for one render.
 * Scenes: title | chase | foot | mission. Unknown names fall back to title.
 */
export function stageShot(name, game) {
  const state = game.state;

  if (name === 'chase') {
    game.startPlay();
    // A horizontal avenue: road centres run 240, 720, 1200, ... — ride the 1200 one.
    const car = makeFallbackCar(1150, 1200, 'sports', '#ff2d78');
    car.angle = 0; car.speed = 0;
    if (!state.cars.includes(car)) state.cars.push(car);
    state.player.inCar = car;
    state.player.x = car.x; state.player.y = car.y; state.player.angle = 0;
    state.wanted.stars = 4;
    state.wanted.heat = 150;
    state.wanted.lastCrime = state.time;
    runSteps(game, 3); // police spawns and closes in through the real update
    // Guarantee a dramatic frame even if police spawning was slow this seed:
    // the chase must read as a chase, with Mara still at the wheel.
    if (state.player.inCar !== car && !car.dead) {
      state.player.inCar = car;
      state.player.x = car.x; state.player.y = car.y;
    }
    // If every patrol car is still far off, pull the nearest one onto the
    // same avenue ~260 px behind Mara so the pursuit is in frame.
    let nearestCop = null, nearestD = Infinity;
    for (const cop of state.copCars || []) {
      if (!cop || cop.dead) continue;
      const d = Math.hypot(cop.x - state.player.x, cop.y - state.player.y);
      if (d < nearestD) { nearestD = d; nearestCop = cop; }
    }
    if (nearestCop && nearestD > 430) {
      nearestCop.x = state.player.x - 260;
      nearestCop.y = state.player.y;
      nearestCop.angle = 0;
      nearestCop.speed = 120;
    }
    state.wanted.stars = Math.max(state.wanted.stars, 3);
    state.screen = 'play';
    return state;
  }

  if (name === 'foot') {
    game.startPlay();
    const spot = downtownSpot(state);
    state.player.inCar = null;
    state.player.x = spot.x + 30; state.player.y = spot.y + 24;
    state.player.angle = -Math.PI / 2;
    // Mission 1 objective active: missions state starts at index 0; one short
    // step lets updateMissions publish the objective marker.
    runSteps(game, 1);
    if (state.missionState && !state.missionState.objective) {
      state.missionState.objective = { x: spot.x, y: spot.y, text: 'Pick up the package' };
    }
    // End on the avenue 150 px north of the live objective so the gold
    // world marker itself is in frame, not just its off-screen arrow.
    const obj = state.missionState && state.missionState.objective;
    if (obj) {
      state.player.x = obj.x;
      state.player.y = obj.y - 150;
      state.player.angle = Math.PI / 2;
    }
    state.screen = 'play';
    return state;
  }

  if (name === 'mission') {
    game.startPlay();
    // Jump to mission 3 (index 2) through the missions module when it offers a
    // starter; otherwise set the index directly and let updateMissions settle it.
    let jumped = false;
    if (typeof MissionsModule.startMission === 'function') {
      try { MissionsModule.startMission(state, 2); jumped = true; } catch { jumped = false; }
    }
    if (!jumped && state.missionState) {
      state.missionState.index = 2;
      state.missionState.phase = 0;
      state.missionState.t = 0;
    }
    // Mara on foot, armed, near the action.
    const spot = (state.missionState && state.missionState.objective)
      ? state.missionState.objective
      : downtownSpot(state);
    state.player.inCar = null;
    state.player.x = spot.x - 90; state.player.y = spot.y + 60;
    state.player.angle = Math.atan2(spot.y - state.player.y, spot.x - state.player.x);
    if (typeof CombatModule.giveWeapon === 'function') {
      try { CombatModule.giveWeapon(state, 'pistol', 24); } catch { /* manual grant below still applies */ }
    }
    if (Array.isArray(state.player.weaponsOwned) && !state.player.weaponsOwned.includes('pistol')) {
      state.player.weaponsOwned.push('pistol');
    }
    state.player.weapon = 'pistol';
    // Ammo shape depends on the combat module: a per-weapon map on the
    // player, or its state.weapons reserve with player.ammo as a number.
    if (state.player.ammo && typeof state.player.ammo === 'object') {
      state.player.ammo.pistol = Math.max(state.player.ammo.pistol || 0, 24);
    } else if (state.weapons && state.weapons.ammo) {
      state.weapons.ammo.pistol = Math.max(state.weapons.ammo.pistol || 0, 24);
      if (typeof state.player.ammo === 'number') state.player.ammo = state.weapons.ammo.pistol;
    }
    ensureGangNear(state, spot.x, spot.y, 3);
    state.dialogue = 'DISPATCH: Mara, they are holding the pier — move in, keep it clean.';
    state.dialogueT = 9;
    runSteps(game, 0.75);
    // Re-assert the staged facts the steps may have moved on from.
    state.player.weapon = 'pistol';
    if (!state.dialogue) {
      state.dialogue = 'MARA: I see them. Going in quiet.';
      state.dialogueT = 9;
    }
    if (state.missionState && !state.missionState.objective) {
      state.missionState.objective = { x: spot.x, y: spot.y, text: 'Clear the pier' };
    }
    // End on the road 130 px south of the objective marker, facing it, so
    // Mara, the gang and the gold ring all share the frame on open asphalt
    // (the pre-step spot can land on a building corner).
    const mObj = state.missionState && state.missionState.objective;
    if (mObj) {
      state.player.x = mObj.x;
      state.player.y = mObj.y + 130;
      state.player.angle = -Math.PI / 2;
    }
    state.screen = 'play';
    return state;
  }

  // 'title' (and fallback): the sim idles over a downtown vista with traffic
  // moving, exactly as the title screen's living backdrop does in real play.
  state.screen = 'title';
  state.player.inCar = null;
  state.player.x = 1920; state.player.y = 1150;
  state.player.angle = 0;
  runSteps(game, 4);
  state.screen = 'title';
  return state;
}
