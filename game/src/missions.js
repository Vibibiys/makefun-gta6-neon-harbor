// missions.js — Mara Voss's story arc and side hustles in Neon Harbor.
//
// Six story missions (see MISSIONS) run as small step machines driven by
// updateMissions(): each step exposes an objective marker through
// state.missionState.objective {x, y, text} and completes on a simple,
// checkable condition — reach a spot, steal a car, drop tagged gangers,
// run checkpoints against the clock, carry a package, crack a vault van,
// or survive a four-star storm and vanish into the hideout. Finishing a
// mission pays cash, advances the arc, plays closing dialogue and asks
// main.js to save via state.requestSave().
//
// Side activities (updateSideActivities) are independent: taxi fares while
// Mara drives a taxi, and ten neon shards hidden at scenic ground spots.

import { makeCar } from './vehicles.js';
import { addHeat } from './police.js';
import { giveWeapon } from './combat.js';

export const MISSIONS = [
  { id: 'first-wheels', title: 'First Wheels', brief: 'No car, no crew, no name. Fix the first part: wheels.', pay: 150 },
  { id: 'hot-package', title: 'Hot Package', brief: 'A crate came in on the night tide. Sable wants it moved — quietly was not an option.', pay: 300 },
  { id: 'rival-colors', title: 'Rival Colors', brief: 'The Coral Vipers are taxing shops in the market. Mara sends a receipt.', pay: 450 },
  { id: 'night-run', title: 'Night Run', brief: 'Five corners, one clock, every light in the city watching. Drive it clean.', pay: 600 },
  { id: 'vault-van', title: 'Vault Van', brief: 'Harbor Trust moves its cash in an armored van. Vans stop. Everything stops, eventually.', pay: 900 },
  { id: 'harbor-king', title: 'Harbor King', brief: 'Dario Venn calls himself the Harbor King. Sixty seconds of storm, then the crown changes hands.', pay: 1500 },
];

/** Original dialogue, keyed by mission id. Lines play in order. */
export const DIALOGUE = {
  'first-wheels': {
    intro: [
      { speaker: 'Sable', text: 'Mara Voss. Heard you swim ashore with nothing but a temper.' },
      { speaker: 'Mara', text: 'And good taste in other people\u2019s cars. What do you need?' },
      { speaker: 'Sable', text: 'Start small. Get to Rook\u2019s garage, take whatever runs, bring it home.' },
    ],
    complete: [
      { speaker: 'Rook', text: 'She purrs, she leaks, she\u2019s yours. Try not to drown this one.' },
      { speaker: 'Mara', text: 'No promises, Rook. No promises.' },
    ],
  },
  'hot-package': {
    intro: [
      { speaker: 'Sable', text: 'Pier, midnight crate, no questions. The harbor watch will have plenty.' },
      { speaker: 'Mara', text: 'If it ticks, I\u2019m dropping it in the bay.' },
      { speaker: 'Sable', text: 'It doesn\u2019t tick. It just costs more than this neighborhood.' },
    ],
    complete: [
      { speaker: 'Sable', text: 'Uptown thanks you. The watch thanks nobody. Spend it slow.' },
    ],
  },
  'rival-colors': {
    intro: [
      { speaker: 'Sable', text: 'Vipers shook down old Chen\u2019s stall. Four of them, market side.' },
      { speaker: 'Mara', text: 'Four. And after?' },
      { speaker: 'Sable', text: 'After, the market breathes again. That\u2019s the whole sermon.' },
    ],
    complete: [
      { speaker: 'Chen', text: 'Miss Voss! The stalls fly your colors now. Neon, of course.' },
    ],
  },
  'night-run': {
    intro: [
      { speaker: 'Rook', text: 'Courier loop, five corners, timed. My nephew bet against you.' },
      { speaker: 'Mara', text: 'Your nephew is about to learn a family lesson.' },
    ],
    complete: [
      { speaker: 'Rook', text: 'Clean lines, no bent fenders. The kid\u2019s crying into his noodles.' },
    ],
  },
  'vault-van': {
    intro: [
      { speaker: 'Sable', text: 'Harbor Trust van, depot route, armor like a small building.' },
      { speaker: 'Mara', text: 'Buildings fall. Aim for the wheels and the nerve.' },
      { speaker: 'Sable', text: 'Stop it, walk up, take the day\u2019s takings. Simple as sin.' },
    ],
    complete: [
      { speaker: 'Sable', text: 'The Trust is drafting a statement. It starts with \u201cunprecedented\u201d.' },
    ],
  },
  'harbor-king': {
    intro: [
      { speaker: 'Dario Venn', text: 'Voss. My harbor, my toll. Walk away and keep the legs.' },
      { speaker: 'Mara', text: 'Sixty seconds, Dario. Let\u2019s see who the storm keeps.' },
      { speaker: 'Sable', text: 'Every siren in the city is coming. Survive it, then come home.' },
    ],
    complete: [
      { speaker: 'Sable', text: 'Venn\u2019s gone quiet. The harbor answers to a new name now.' },
      { speaker: 'Mara', text: 'Neon Harbor. Turns out it was never his. It was just waiting.' },
    ],
  },
};

const ROAD_XS = [240, 720, 1200, 1680, 2160, 2640, 3120, 3600];
const ROAD_YS = [240, 720, 1200, 1680, 2160, 2640];
const NIGHT_RUN_CHECKPOINTS = [
  { x: 720, y: 720 }, { x: 1680, y: 720 }, { x: 2640, y: 1200 },
  { x: 2160, y: 2160 }, { x: 720, y: 2160 },
];

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

function say(state, speaker, text) {
  const ms = state.missionState;
  if (!ms) return;
  if (!Array.isArray(ms.data.dialogueQueue)) ms.data.dialogueQueue = [];
  ms.data.dialogueQueue.push({ speaker, text });
}

function sayLines(state, lines) {
  for (const line of lines || []) say(state, line.speaker, line.text);
}

function setMessage(state, text, seconds = 4) {
  state.message = text;
  state.messageTimer = seconds;
}

function setObjective(state, x, y, text) {
  state.missionState.objective = (x === null || x === undefined)
    ? null
    : { x, y, text };
}

function spot(state, name, fallback) {
  const s = state.world && state.world.missionSpots && state.world.missionSpots[name];
  return s ? { x: s.x, y: s.y } : fallback;
}

function requestSave(state) {
  if (typeof state.requestSave === 'function') {
    try { state.requestSave(); } catch { /* save is best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// State factory & mission start
// ---------------------------------------------------------------------------

export function createMissionState() {
  return { index: 0, step: 0, active: true, done: false, timer: null, data: {}, objective: null, markers: [] };
}

function ensureMissionState(state) {
  if (!state.missionState || typeof state.missionState !== 'object') {
    state.missionState = createMissionState();
  }
  const ms = state.missionState;
  if (!ms.data || typeof ms.data !== 'object') ms.data = {};
  if (!Array.isArray(ms.markers)) ms.markers = [];
  return ms;
}

function spawnGang(state, x, y, tag) {
  if (!Array.isArray(state.peds)) state.peds = [];
  const colors = ['#e0483e', '#ff7847', '#c22e5e', '#e0a03e'];
  const ped = {
    x, y, angle: Math.random() * Math.PI * 2, speed: 0,
    hp: 42, maxHp: 42, kind: 'gang',
    color: colors[state.peds.length % colors.length],
    state: 'idle', tx: x, ty: y, missionTag: tag,
    shootCd: 0.6 + Math.random() * 0.8, dead: false,
  };
  state.peds.push(ped);
  return ped;
}

function spawnParkedCar(state, x, y, kind, color) {
  if (!Array.isArray(state.cars)) state.cars = [];
  let car = null;
  try { car = makeCar(x, y, -Math.PI / 2, kind, color, 'parked'); } catch { car = null; }
  if (!car || typeof car !== 'object') {
    car = { x, y, angle: -Math.PI / 2, speed: 0, w: 76, h: 38, kind, color, driver: 'parked', hp: 110, dead: false };
  }
  state.cars.push(car);
  return car;
}

/**
 * Set up the mission at `index`: reset step data, queue intro dialogue,
 * spawn whatever the mission needs (gang, van, package, checkpoints).
 */
export function startMission(state, index) {
  const ms = ensureMissionState(state);
  const mission = MISSIONS[index];
  if (!mission) {
    ms.done = true;
    ms.active = false;
    ms.objective = null;
    return;
  }
  ms.index = index;
  ms.step = 0;
  ms.timer = null;
  ms.done = false;
  ms.active = true;
  ms.data = { started: true, dialogueQueue: [], kills: 0, carrying: false };
  ms.markers = [];
  ms.objective = null;

  sayLines(state, DIALOGUE[mission.id] && DIALOGUE[mission.id].intro);
  setMessage(state, `${mission.title} — ${mission.brief}`, 6);

  const S = (name, fb) => spot(state, name, fb);
  switch (mission.id) {
    case 'first-wheels': {
      const g = S('garage', { x: 720, y: 240 });
      spawnParkedCar(state, g.x + 70, g.y + 46, 'sedan', '#37c8d9');
      break;
    }
    case 'hot-package': {
      const pier = S('pier', { x: 1920, y: 2480 });
      if (!Array.isArray(state.pickups)) state.pickups = [];
      state.pickups.push({ x: pier.x, y: pier.y - 30, type: 'package', missionTag: mission.id });
      break;
    }
    case 'rival-colors': {
      const m = S('market', { x: 1680, y: 1200 });
      spawnGang(state, m.x - 60, m.y - 30, mission.id);
      spawnGang(state, m.x + 55, m.y + 20, mission.id);
      spawnGang(state, m.x + 10, m.y - 80, mission.id);
      spawnGang(state, m.x - 20, m.y + 75, mission.id);
      ms.data.gangTotal = 4;
      break;
    }
    case 'night-run': {
      ms.data.cpIndex = 0;
      ms.timer = 120;
      ms.markers = NIGHT_RUN_CHECKPOINTS.map((c) => ({ x: c.x, y: c.y, type: 'checkpoint', active: false }));
      break;
    }
    case 'vault-van': {
      const depot = S('depot', { x: 3120, y: 2160 });
      let van = null;
      try { van = makeCar(depot.x, depot.y, Math.PI, 'van', '#8b93a3', 'van'); } catch { van = null; }
      if (!van || typeof van !== 'object') {
        van = { x: depot.x, y: depot.y, angle: Math.PI, speed: 0, w: 92, h: 44, kind: 'van', color: '#8b93a3', driver: 'van', hp: 280, dead: false };
      }
      van.driver = 'van';
      van.hp = 280;
      van.maxHp = 280;
      van.route = [
        { x: 2640, y: 2160 }, { x: 2640, y: 1200 }, { x: 1200, y: 1200 },
        { x: 1200, y: 2160 }, { x: 2160, y: 2160 },
      ];
      van.routeIndex = 0;
      if (!Array.isArray(state.cars)) state.cars = [];
      state.cars.push(van);
      ms.data.van = van;
      break;
    }
    case 'harbor-king': {
      ms.timer = 60;
      // The storm: force at least four stars of heat.
      const w = state.wanted || { heat: 0 };
      const need = 130 - (w.heat || 0);
      if (need > 0) addHeat(state, need);
      else addHeat(state, 1); // refresh the crime clock so heat holds
      break;
    }
    default:
      break;
  }
}

function completeMission(state) {
  const ms = state.missionState;
  const mission = MISSIONS[ms.index];
  if (!mission) return;
  state.player.money += mission.pay;
  if (state.stats) {
    state.stats.earned += mission.pay;
    state.stats.missionsDone += 1;
  }
  sayLines(state, DIALOGUE[mission.id] && DIALOGUE[mission.id].complete);
  setMessage(state, `${mission.title} complete — $${mission.pay} paid.`, 5);

  // Story rewards: the crew arms Mara as the arc heats up.
  if (mission.id === 'first-wheels') giveWeapon(state, 'pistol', 36);
  if (mission.id === 'night-run') giveWeapon(state, 'smg', 60);
  if (mission.id === 'vault-van') giveWeapon(state, 'shotgun', 12);

  ms.index += 1;
  ms.step = 0;
  ms.timer = null;
  ms.markers = [];
  ms.objective = null;
  if (ms.index >= MISSIONS.length) {
    ms.done = true;
    ms.active = false;
    ms.data = {};
    setMessage(state, 'Story complete — Mara Voss runs Neon Harbor now. Side hustles stay open.', 7);
  } else {
    ms.data = { started: false, nextIn: 4, dialogueQueue: (ms.data && ms.data.dialogueQueue) || [] };
  }
  requestSave(state);
}

// ---------------------------------------------------------------------------
// Per-mission step logic. Each returns nothing; it advances ms.step or
// completes the mission, and always refreshes ms.objective.
// ---------------------------------------------------------------------------

function gotoStep(state, target, text, radius = 60) {
  const p = state.player;
  setObjective(state, target.x, target.y, text);
  state.missionState.markers = [{ x: target.x, y: target.y, type: 'goto', active: true }];
  return dist(p.x, p.y, target.x, target.y) <= radius;
}

function updateFirstWheels(state) {
  const ms = state.missionState;
  const garage = spot(state, 'garage', { x: 720, y: 240 });
  const hideout = spot(state, 'hideout', { x: 240, y: 2160 });
  if (ms.step === 0) {
    if (gotoStep(state, garage, 'Get to Rook\u2019s garage')) ms.step = 1;
  } else if (ms.step === 1) {
    setObjective(state, garage.x + 70, garage.y + 46, 'Steal a car — any car that runs');
    state.missionState.markers = [{ x: garage.x + 70, y: garage.y + 46, type: 'steal', active: true }];
    if (state.player.inCar) {
      ms.step = 2;
      say(state, 'Rook', 'That\u2019s my loaner! ...Fine. Bring her home in one piece.');
    }
  } else if (ms.step === 2) {
    if (gotoStep(state, hideout, 'Bring the car to the hideout', 75)) completeMission(state);
  }
}

function updateHotPackage(state) {
  const ms = state.missionState;
  const pier = spot(state, 'pier', { x: 1920, y: 2480 });
  const uptown = spot(state, 'uptown', { x: 3120, y: 240 });
  if (ms.step === 0) {
    if (gotoStep(state, pier, 'Reach the pier pickup', 70)) ms.step = 1;
  } else if (ms.step === 1) {
    setObjective(state, pier.x, pier.y - 30, 'Grab the crate');
    state.missionState.markers = [{ x: pier.x, y: pier.y - 30, type: 'pickup', active: true }];
    let carried = !!ms.data.carrying;
    if (!carried && Array.isArray(state.pickups)) {
      const i = state.pickups.findIndex((pk) => pk && pk.missionTag === 'hot-package');
      if (i >= 0 && dist(state.player.x, state.player.y, state.pickups[i].x, state.pickups[i].y) <= 46) {
        state.pickups.splice(i, 1);
        carried = true;
      } else if (i < 0 && dist(state.player.x, state.player.y, pier.x, pier.y) <= 120) {
        carried = true; // a generic pickup system already collected it nearby
      }
    }
    if (carried) {
      ms.data.carrying = true;
      ms.step = 2;
      // The whole harbor watch wakes up: two stars of instant heat.
      addHeat(state, 50);
      if (typeof state.onCrime === 'function') {
        try { state.onCrime('theft', state.player.x, state.player.y); } catch { /* noop */ }
      }
      setMessage(state, 'Package on board — every siren in the harbor just woke up.', 4);
    }
  } else if (ms.step === 2) {
    // Heat keeps simmering while the crate is hot.
    if (Math.random() < 0.008) addHeat(state, 4);
    if (gotoStep(state, uptown, 'Deliver the crate uptown', 70)) completeMission(state);
  }
}

function updateRivalColors(state) {
  const ms = state.missionState;
  const market = spot(state, 'market', { x: 1680, y: 1200 });
  const peds = Array.isArray(state.peds) ? state.peds : [];
  let alive = 0;
  let deadCounted = 0;
  for (const ped of peds) {
    if (!ped || ped.missionTag !== 'rival-colors') continue;
    if (ped.dead) {
      if (!ped._killCounted) { ped._killCounted = true; ms.data.kills += 1; }
      deadCounted += 1;
    } else alive += 1;
  }
  void deadCounted;
  const total = ms.data.gangTotal || 4;
  const remaining = Math.max(0, total - (ms.data.kills || 0));
  if (alive === 0 && remaining <= 0) {
    setObjective(state, null, null, '');
    completeMission(state);
    return;
  }
  setObjective(state, market.x, market.y, `Clear the Vipers from the market (${remaining} left)`);
  state.missionState.markers = [{ x: market.x, y: market.y, type: 'kill', active: true }];
}

function updateNightRun(state, dt) {
  const ms = state.missionState;
  ms.timer = (ms.timer === null || ms.timer === undefined ? 120 : ms.timer) - dt;
  if (ms.timer <= 0) {
    // Out of time: reset the loop, keep the mission.
    ms.data.cpIndex = 0;
    ms.timer = 120;
    setMessage(state, 'Clock died. Rook resets the loop — run it again, cleaner.', 4);
    say(state, 'Rook', 'Too slow, Voss. The corners aren\u2019t moving. You are.');
  }
  const idx = ms.data.cpIndex || 0;
  const cp = NIGHT_RUN_CHECKPOINTS[idx];
  ms.markers = NIGHT_RUN_CHECKPOINTS.map((c, i) => ({ x: c.x, y: c.y, type: 'checkpoint', active: i === idx }));
  setObjective(state, cp.x, cp.y, `Checkpoint ${idx + 1}/${NIGHT_RUN_CHECKPOINTS.length} — ${Math.max(0, Math.ceil(ms.timer))}s left`);
  if (dist(state.player.x, state.player.y, cp.x, cp.y) <= 78) {
    ms.data.cpIndex = idx + 1;
    ms.timer += 12; // each corner buys a little clock back
    if (ms.data.cpIndex >= NIGHT_RUN_CHECKPOINTS.length) completeMission(state);
    else setMessage(state, `Corner ${idx + 1} cleared — +12s.`, 2);
  }
}

function driveVan(state, van, dt) {
  if (!van || van.dead) return;
  const frac = (van.hp || 0) / (van.maxHp || 280);
  if (frac < 0.35) {
    van.speed = Math.max(0, (van.speed || 0) - 260 * dt);
    van.stopped = true;
    return;
  }
  van.stopped = false;
  const route = van.route || [];
  if (!route.length) return;
  const target = route[van.routeIndex % route.length];
  const d = dist(van.x, van.y, target.x, target.y);
  if (d < 60) van.routeIndex = (van.routeIndex + 1) % route.length;
  const desired = Math.atan2(target.y - van.y, target.x - van.x);
  let diff = desired - (van.angle || 0);
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  van.angle += clamp(diff, -1.9 * dt, 1.9 * dt);
  const cruise = 148;
  van.speed = Math.min(cruise, (van.speed || 0) + 170 * dt);
  const nx = van.x + Math.cos(van.angle) * van.speed * dt;
  const ny = van.y + Math.sin(van.angle) * van.speed * dt;
  const world = state.world;
  let blocked = false;
  if (world && typeof world.collideCircle === 'function') {
    try {
      const res = world.collideCircle(world, nx, ny, 24);
      if (res === true || (res && (res.hit || res.collided))) blocked = true;
      else if (res && typeof res.x === 'number' && (res.x !== nx || res.y !== ny)) { van.x = res.x; van.y = res.y; blocked = true; }
    } catch { blocked = false; }
  }
  if (!blocked) { van.x = nx; van.y = ny; }
  else van.speed *= 0.4;
}

function updateVaultVan(state, dt) {
  const ms = state.missionState;
  const depot = spot(state, 'depot', { x: 3120, y: 2160 });
  const van = ms.data.van;
  if (ms.step === 0) {
    if (gotoStep(state, depot, 'Get to the depot — the van rolls from there', 80)) ms.step = 1;
  } else if (ms.step === 1) {
    driveVan(state, van, dt);
    if (!van) { completeMission(state); return; }
    const frac = (van.hp || 0) / (van.maxHp || 280);
    setObjective(state, van.x, van.y, `Stop the vault van — armor ${Math.max(0, Math.ceil(frac * 100))}%`);
    state.missionState.markers = [{ x: van.x, y: van.y, type: 'van', active: true }];
    if (van.stopped || van.dead || frac < 0.35) {
      ms.step = 2;
      setMessage(state, 'The van\u2019s dead in the road. Walk up and take the takings.', 4);
    }
  } else if (ms.step === 2) {
    if (!van) { completeMission(state); return; }
    if (gotoStep(state, { x: van.x, y: van.y }, 'Loot the vault van', 78)) completeMission(state);
  }
}

function updateHarborKing(state, dt) {
  const ms = state.missionState;
  const hideout = spot(state, 'hideout', { x: 240, y: 2160 });
  if (ms.step === 0) {
    ms.timer = (ms.timer === null || ms.timer === undefined ? 60 : ms.timer) - dt;
    // Keep the storm at four stars or worse for the whole minute.
    const w = state.wanted;
    if (w && (w.stars || 0) < 4) addHeat(state, 130 - (w.heat || 0) + 6);
    setObjective(state, null, null, '');
    state.missionState.objective = {
      x: state.player.x, y: state.player.y,
      text: `Survive the storm — ${Math.max(0, Math.ceil(ms.timer))}s at four stars`,
    };
    state.missionState.markers = [];
    if (ms.timer <= 0) {
      ms.step = 1;
      say(state, 'Sable', 'Storm\u2019s breaking. Get home, Mara. Get home now.');
    }
  } else if (ms.step === 1) {
    if (gotoStep(state, hideout, 'Vanish into the hideout', 80)) completeMission(state);
  }
}

/**
 * Advance the current story mission by dt seconds. Auto-starts the pending
 * mission after a short breather, ticks dialogue, and keeps
 * state.missionState.objective fresh for the HUD.
 */
export function updateMissions(state, dt) {
  const ms = ensureMissionState(state);
  if (!state.player) return;

  // Dialogue ticker: show queued lines one at a time.
  if (state.dialogue && typeof state.dialogue.timer === 'number') {
    state.dialogue.timer -= dt;
    if (state.dialogue.timer <= 0) state.dialogue = null;
  }
  if (!state.dialogue) {
    const q = ms.data && ms.data.dialogueQueue;
    if (Array.isArray(q) && q.length) {
      const line = q.shift();
      state.dialogue = { speaker: line.speaker, text: line.text, timer: 4.5 };
    }
  }

  if (ms.done) { ms.objective = null; return; }

  if (!ms.data.started) {
    ms.data.nextIn = (ms.data.nextIn === undefined ? 0 : ms.data.nextIn) - dt;
    ms.objective = null;
    if (ms.data.nextIn <= 0) startMission(state, ms.index);
    return;
  }

  const mission = MISSIONS[ms.index];
  if (!mission) { ms.done = true; ms.active = false; ms.objective = null; return; }

  switch (mission.id) {
    case 'first-wheels': updateFirstWheels(state); break;
    case 'hot-package': updateHotPackage(state); break;
    case 'rival-colors': updateRivalColors(state); break;
    case 'night-run': updateNightRun(state, dt); break;
    case 'vault-van': updateVaultVan(state, dt); break;
    case 'harbor-king': updateHarborKing(state, dt); break;
    default: ms.objective = null; break;
  }
}

// ---------------------------------------------------------------------------
// Side activities: taxi fares + neon shards
// ---------------------------------------------------------------------------

function randomRoadPoint() {
  if (Math.random() < 0.5) {
    return {
      x: ROAD_XS[Math.floor(Math.random() * ROAD_XS.length)],
      y: 200 + Math.random() * 2150,
    };
  }
  return {
    x: 200 + Math.random() * 3350,
    y: ROAD_YS[Math.floor(Math.random() * (ROAD_YS.length - 1))],
  };
}

function getPlayerCar(state) {
  const p = state.player;
  if (p && p.inCar && typeof p.inCar === 'object') return p.inCar;
  if (state.playerCar) return state.playerCar;
  const all = [...(state.cars || []), ...(state.copCars || [])];
  return all.find((c) => c && c.driver === 'player') || null;
}

function shardSpots(state) {
  const S = (name, fb) => spot(state, name, fb);
  return [
    S('pier', { x: 1920, y: 2480 }),
    { x: 600, y: 2480 },
    { x: 3000, y: 2480 },
    S('market', { x: 1680, y: 1200 }),
    S('garage', { x: 720, y: 240 }),
    S('hospital', { x: 1200, y: 1680 }),
    S('precinct', { x: 2160, y: 720 }),
    S('uptown', { x: 3120, y: 240 }),
    S('depot', { x: 3120, y: 2160 }),
    S('hideout', { x: 240, y: 2160 }),
  ].map((s, i) => ({ x: s.x + (i % 3 - 1) * 55, y: s.y + 62, id: i }));
}

export function updateSideActivities(state, dt) {
  if (!state.player) return;
  if (!state.side || typeof state.side !== 'object') {
    state.side = {
      taxi: { phase: 'idle', cooldown: 2, marker: null, dest: null, fareTime: 0, fareDist: 0 },
      shards: { spawned: false, collected: 0, total: 10, done: false },
    };
  }
  const side = state.side;
  const p = state.player;

  // --- Neon shards ---------------------------------------------------------
  const shards = side.shards;
  if (!shards.spawned) {
    if (!Array.isArray(state.pickups)) state.pickups = [];
    for (const s of shardSpots(state)) {
      state.pickups.push({ x: s.x, y: s.y, type: 'shard', shardId: s.id });
    }
    shards.spawned = true;
  }
  if (!shards.done && Array.isArray(state.pickups)) {
    for (let i = state.pickups.length - 1; i >= 0; i -= 1) {
      const pk = state.pickups[i];
      if (!pk || pk.type !== 'shard') continue;
      if (dist(p.x, p.y, pk.x, pk.y) <= 40) {
        state.pickups.splice(i, 1);
        shards.collected += 1;
        if (state.audio && typeof state.audio.pickup === 'function') {
          try { state.audio.pickup(); } catch { /* noop */ }
        }
        if (shards.collected >= shards.total) {
          shards.done = true;
          p.money += 500;
          if (state.stats) state.stats.earned += 500;
          setMessage(state, 'All 10 neon shards found — a collector pays out $500.', 6);
          requestSave(state);
        } else {
          setMessage(state, `Neon shard ${shards.collected}/${shards.total}.`, 2.5);
        }
      }
    }
  }

  // --- Taxi fares ------------------------------------------------------------
  const taxi = side.taxi;
  const car = getPlayerCar(state);
  const drivingTaxi = !!(p.inCar && car && car.kind === 'taxi');

  if (taxi.phase === 'idle') {
    taxi.cooldown -= dt;
    if (drivingTaxi && taxi.cooldown <= 0) {
      taxi.marker = randomRoadPoint();
      taxi.phase = 'pickup';
      setMessage(state, 'A fare is waving you down — follow the marker.', 3.5);
    }
  } else if (taxi.phase === 'pickup') {
    if (!drivingTaxi) {
      taxi.phase = 'idle';
      taxi.cooldown = 3;
      taxi.marker = null;
      setMessage(state, 'Fare lost — stay in the cab to keep the meter running.', 3);
    } else if (taxi.marker && dist(p.x, p.y, taxi.marker.x, taxi.marker.y) <= 62) {
      taxi.dest = randomRoadPoint();
      taxi.fareDist = dist(taxi.marker.x, taxi.marker.y, taxi.dest.x, taxi.dest.y);
      taxi.fareTime = 0;
      taxi.phase = 'fare';
      setMessage(state, 'Passenger in. Drive the marker — fast pays better.', 3.5);
    }
  } else if (taxi.phase === 'fare') {
    taxi.fareTime += dt;
    if (!drivingTaxi) {
      taxi.phase = 'idle';
      taxi.cooldown = 3;
      taxi.dest = null;
      setMessage(state, 'Passenger bailed. No cab, no fare.', 3);
    } else if (taxi.dest && dist(p.x, p.y, taxi.dest.x, taxi.dest.y) <= 62) {
      const base = clamp(40 + taxi.fareDist * 0.045, 40, 120);
      const parTime = taxi.fareDist / 26;
      const bonus = taxi.fareTime < parTime ? Math.round(clamp((parTime - taxi.fareTime) * 0.5, 0, 30)) : 0;
      const pay = Math.round(base) + bonus;
      p.money += pay;
      if (state.stats) state.stats.earned += pay;
      if (state.audio && typeof state.audio.cash === 'function') {
        try { state.audio.cash(); } catch { /* noop */ }
      }
      setMessage(state, bonus > 0
        ? `Fare paid $${pay} (includes $${bonus} hurry bonus).`
        : `Fare paid $${pay}.`, 4);
      taxi.phase = 'idle';
      taxi.cooldown = 5 + Math.random() * 5;
      taxi.dest = null;
      taxi.marker = null;
    }
  }

  // Expose the active taxi target for the HUD without touching mission data.
  taxi.objective = taxi.phase === 'pickup' && taxi.marker
    ? { x: taxi.marker.x, y: taxi.marker.y, text: 'Taxi: pick up your fare' }
    : taxi.phase === 'fare' && taxi.dest
      ? { x: taxi.dest.x, y: taxi.dest.y, text: 'Taxi: drop off your passenger' }
      : null;
  void dt;
}
