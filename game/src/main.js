// Neon Harbor: Vice Run — main integrator.
//
// Builds the single game state, wires every module (world, vehicles,
// pedestrians, police, combat, missions, save, audio, render, HUD, minimap)
// into one fixed-step loop, and owns the screens: title, play, pause, busted,
// wasted and complete. Mara Voss starts downtown with $250, fists and one job
// too many; everything else is the modules doing their jobs through `state`.
//
// ?shot=<title|chase|foot|mission>&seed=<n> stages a deterministic scene via
// shots.js, renders one real frame and sets document.title = 'shot-ready'
// instead of running the loop. window.__neonHarbor = { state } for debugging.
import * as ConfigModule from './config.js';
import * as RandomModule from './random.js';
import * as InputModule from './input.js';
import * as WorldModule from './world.js';
import * as VehiclesModule from './vehicles.js';
import * as PedsModule from './pedestrians.js';
import * as PoliceModule from './police.js';
import * as CombatModule from './combat.js';
import * as MissionsModule from './missions.js';
import * as SaveModule from './save.js';
import * as AudioModule from './audio.js';
import { drawScene } from './render.js';
import { drawHUD } from './hud.js';
import { stageShot } from './shots.js';

// ---------------------------------------------------------------- config ---
const CFG = ConfigModule || {};
const WORLD_W = CFG.WORLD_W ?? 3840;
const WORLD_H = CFG.WORLD_H ?? 2880;
const WATER_Y = CFG.WATER_Y ?? 2520;
const STEP = 1 / 60;
const MAX_FRAME = 0.25;

// ------------------------------------------------------------------- rng ---
function fallbackRng(seed) {
  let a = (seed | 0) || 1;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const makeRng = RandomModule.makeRng || RandomModule.createRandom || fallbackRng;

// ------------------------------------------------------------------- dom ---
const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const ctx = canvas.getContext('2d');
let viewW = window.innerWidth, viewH = window.innerHeight, dpr = 1;
function resize() {
  dpr = Math.min(1.5, window.devicePixelRatio || 1);
  viewW = window.innerWidth; viewH = window.innerHeight;
  canvas.width = Math.round(viewW * dpr);
  canvas.height = Math.round(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
}
window.addEventListener('resize', resize);
resize();

function announce(text) { if (statusEl) statusEl.textContent = text; }

// ------------------------------------------------------------- url / seed --
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 7;
// makeRng returns a generator object ({ next, range, int, pick, chance }).
// main's own fallback code calls rng() directly, so the local handle is a
// callable that also carries the generator's methods — siblings reading
// state.rng.next() / .range() / .int() get exactly what they expect.
const rngSource = makeRng(seed);
const rng = typeof rngSource === 'function'
  ? rngSource
  : Object.assign(function rng() { return rngSource.next(); }, rngSource);

// ----------------------------------------------------------------- input ---
// Contract: createInput(canvas) -> { keys, pressed, mouse, consume(code) }.
// If the module's shape differs, a local tracker provides the same surface.
function buildInput() {
  let raw = null;
  try { raw = typeof InputModule.createInput === 'function' ? InputModule.createInput(canvas) : null; } catch { raw = null; }
  if (raw && raw.keys && raw.mouse) return raw;
  const keys = new Set();
  const pressed = new Set();
  const mouse = { x: viewW / 2, y: viewH / 2, down: false };
  window.addEventListener('keydown', (e) => {
    if (!e.repeat) pressed.add(e.code);
    keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  canvas.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('pointerdown', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.down = true; });
  window.addEventListener('pointerup', () => { mouse.down = false; });
  return {
    keys, pressed, mouse,
    consume(code) { const had = pressed.has(code); pressed.delete(code); return had; },
  };
}
const input = buildInput();

function keyDown(code) {
  const k = input.keys;
  if (!k) return false;
  if (typeof k.has === 'function') return k.has(code);
  if (Array.isArray(k)) return k.includes(code);
  return !!k[code];
}
function pressedOnce(code) {
  if (typeof input.consume === 'function') {
    try { return !!input.consume(code); } catch { /* fall through */ }
  }
  const pr = input.pressed;
  if (pr && typeof pr.has === 'function' && pr.has(code)) { pr.delete(code); return true; }
  if (pr && pr[code]) { pr[code] = false; return true; }
  return false;
}
// Local mouse tracking always runs: main owns aim + firing even when the
// input module supplies its own mouse object.
const localMouse = { x: viewW / 2, y: viewH / 2, down: false };
canvas.addEventListener('pointermove', (e) => { localMouse.x = e.clientX; localMouse.y = e.clientY; });
canvas.addEventListener('pointerdown', (e) => { localMouse.x = e.clientX; localMouse.y = e.clientY; localMouse.down = true; });
window.addEventListener('pointerup', () => { localMouse.down = false; });
function mousePos() {
  const m = input.mouse;
  if (m && typeof m.x === 'number' && (m.x !== 0 || m.y !== 0)) return m;
  return localMouse;
}
function mouseDown() {
  const m = input.mouse;
  return !!((m && m.down) || localMouse.down);
}

// ----------------------------------------------------------------- audio ---
let audio = null;
try { audio = typeof AudioModule.createAudio === 'function' ? AudioModule.createAudio() : null; } catch { audio = null; }
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked || !audio) return;
  audioUnlocked = true;
  try { if (typeof audio.unlock === 'function') audio.unlock(); else if (typeof audio.resume === 'function') audio.resume(); } catch { /* silent */ }
}
window.addEventListener('pointerdown', unlockAudio, { once: false });
window.addEventListener('keydown', unlockAudio, { once: false });
const AUDIO_ALIASES = { shoot: 'shot', busted: 'bust', wasted: 'bust', steal: 'cash' };
function audioCall(method, ...args) {
  if (!audio) return;
  const fn = typeof audio[method] === 'function' ? audio[method]
    : (AUDIO_ALIASES[method] && typeof audio[AUDIO_ALIASES[method]] === 'function' ? audio[AUDIO_ALIASES[method]] : null);
  if (!fn) return;
  try { fn(...args); } catch { /* audio never breaks the game */ }
}

// ----------------------------------------------------------------- world ---
function fallbackWorld() {
  const xs = []; for (let x = 240; x <= 3600; x += 480) xs.push(x);
  const ys = []; for (let y = 240; y <= 2640; y += 480) ys.push(y);
  const buildings = [], palms = [], lamps = [];
  const names = ['Neon Harbor Precinct', 'St. Coral Hospital', 'Harbor Market', 'The Gilded Eel Club',
    'Voss Couriers Depot', 'Pier 9 Warehouse', 'Sunset Motel', 'City Garage', 'Azure Tower', 'Coral Plaza'];
  let ni = 0;
  const palette = ['#39415e', '#463a5e', '#2f4f5e', '#5e4639', '#3d5a3a', '#54486b'];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    if (ys[j] >= WATER_Y - 480 && j > 3) continue;
    const bx = xs[i] + 84, by = ys[j] + 84, bw = 300, bh = 300;
    if ((i + j) % 7 === 3) continue; // a park gap, drawn by parks below
    buildings.push({ x: bx + 20, y: by + 20, w: bw - 90, h: bh - 90, color: palette[(i * 3 + j) % palette.length], name: (i + j) % 4 === 0 ? names[ni++ % names.length] : undefined });
    buildings.push({ x: bx + 190, y: by + 170, w: 110, h: 110, color: palette[(i + j + 2) % palette.length] });
  }
  const parks = [{ x: xs[1] + 84, y: ys[1] + 84, w: 312, h: 312 }, { x: xs[4] + 84, y: ys[2] + 84, w: 312, h: 312 }];
  for (let x = 300; x < WORLD_W; x += 160) palms.push({ x, y: WATER_Y - 44 });
  for (const x of xs) for (let y = 360; y < WATER_Y - 60; y += 240) lamps.push({ x: x + 74, y });
  for (const y of ys) { if (y < WATER_Y) for (let x = 360; x < WORLD_W; x += 480) lamps.push({ x, y: y + 74 }); }
  const missionSpots = [
    { id: 'depot', name: 'Voss Couriers Depot', x: 730, y: 1210 },
    { id: 'market', name: 'Harbor Market', x: 1800, y: 1100 },
    { id: 'pier', name: 'Pier 9', x: 1930, y: 2440 },
    { id: 'club', name: 'The Gilded Eel Club', x: 2310, y: 730 },
    { id: 'precinct', name: 'Neon Harbor Precinct', x: 330, y: 330 },
    { id: 'hospital', name: 'St. Coral Hospital', x: 3540, y: 790 },
    { id: 'motel', name: 'Sunset Motel', x: 1210, y: 1930 },
    { id: 'garage', name: 'City Garage', x: 2650, y: 1690 },
  ];
  return { buildings, parks, palms, lamps, roadCentersX: xs, roadCentersY: ys, missionSpots, seed };
}
function buildWorld() {
  let w = null;
  try { w = typeof WorldModule.createWorld === 'function' ? WorldModule.createWorld(seed) : null; } catch { w = null; }
  if (w && Array.isArray(w.buildings)) return w;
  if (w && w.state && !Array.isArray(w.buildings)) return fallbackWorld(); // starter placeholder shape
  return fallbackWorld();
}
const world = buildWorld();
// Several modules (police, missions' van, combat) call the geometry helpers
// as methods on the world object — world.collideCircle(world, x, y, r) and
// friends — while world.js exports them as module functions. Attach method
// shims that forward the trailing arguments, so those callers really collide.
if (typeof world.collideCircle !== 'function' && typeof WorldModule.collideCircle === 'function') {
  world.collideCircle = (...a) => WorldModule.collideCircle(world, a[a.length - 3], a[a.length - 2], a[a.length - 1]);
}
if (typeof world.buildingAt !== 'function' && typeof WorldModule.buildingAt === 'function') {
  world.buildingAt = (...a) => WorldModule.buildingAt(world, a[a.length - 2], a[a.length - 1]);
}
if (typeof world.isInWater !== 'function' && typeof WorldModule.isInWater === 'function') {
  world.isInWater = (...a) => WorldModule.isInWater(world, a[a.length - 2], a[a.length - 1]);
}

function worldBuildingAt(x, y) {
  if (typeof WorldModule.buildingAt === 'function') {
    try { const r = WorldModule.buildingAt(world, x, y); if (r !== undefined) return r; } catch { /* next shape */ }
    try { const r = WorldModule.buildingAt(x, y); if (r !== undefined) return r; } catch { /* local check */ }
  }
  for (const b of world.buildings || []) {
    if (x > b.x - 6 && x < b.x + (b.w || 0) + 6 && y > b.y - 6 && y < b.y + (b.h || 0) + 6) return b;
  }
  return null;
}
function worldIsWater(x, y) {
  if (typeof WorldModule.isInWater === 'function') {
    try { const r = WorldModule.isInWater(world, x, y); if (typeof r === 'boolean') return r; } catch { /* next */ }
    try { const r = WorldModule.isInWater(x, y); if (typeof r === 'boolean') return r; } catch { /* local */ }
  }
  return y >= WATER_Y + 6;
}
function spotById(id, fx, fy) {
  const spots = world.missionSpots;
  if (Array.isArray(spots)) {
    const s = spots.find((m) => m && (m.id === id || m.name === id));
    return s ? { x: s.x, y: s.y } : { x: fx, y: fy };
  }
  if (spots && typeof spots === 'object' && spots[id]) return { x: spots[id].x, y: spots[id].y };
  return { x: fx, y: fy };
}

// ------------------------------------------------------------- save shim ---
const SAVE_KEY = 'neon-harbor.save.v1';
function saveGameFallback(data) {
  try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch { return false; }
}
function loadSaveFallback() {
  try { const raw = window.localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function hasSave() {
  if (typeof SaveModule.hasSave === 'function') { try { return !!SaveModule.hasSave(); } catch { /* fallback */ } }
  return loadSaveFallback() !== null;
}

// ------------------------------------------------------- fallback systems --
const FALLBACK_MISSIONS = [
  { title: 'First Run', spot: 'market', pay: 150, text: 'Pick up the package at Harbor Market', line: 'DISPATCH: Simple pickup at the market, Mara. In and out.' },
  { title: 'Hot Package', spot: 'club', pay: 200, text: 'Deliver the package to the Gilded Eel Club', line: 'DISPATCH: The club is waiting. Do not open the package.' },
  { title: 'Pier Pressure', spot: 'pier', pay: 275, text: 'Clear the pier and reach the warehouse', line: 'DISPATCH: Pier 9 went dark. See who is holding it.' },
  { title: 'Night Ledger', spot: 'garage', pay: 350, text: 'Collect the ledger from City Garage', line: 'DISPATCH: The garage has a ledger with our names in it. Bring it home.' },
  { title: 'Heat Wave', spot: 'motel', pay: 450, text: 'Meet the fixer at Sunset Motel', line: 'DISPATCH: Fixer at the motel. Half the city will follow you there.' },
  { title: 'Vice Run', spot: 'pier', pay: 700, text: 'Make the final run to Pier 9', line: 'DISPATCH: Last run, Mara. The boat leaves tonight — be on it.' },
];
function fallbackMissionState() {
  return { index: 0, phase: 0, t: 0, objective: null, cardT: 0, cardTitle: '', cardKicker: '', done: false, usingFallback: true };
}
function fallbackMissionBegin(state, idx) {
  const ms = state.missionState;
  const m = FALLBACK_MISSIONS[idx];
  if (!m) { ms.objective = null; ms.done = true; return; }
  const s = spotById(m.spot, 1800, 1100);
  ms.objective = { x: s.x, y: s.y, text: m.text };
  ms.cardT = 3.2; ms.cardTitle = m.title; ms.cardKicker = 'JOB ' + (idx + 1) + ' OF 6';
  state.dialogue = m.line; state.dialogueT = 6;
}
function fallbackUpdateMissions(state, dt) {
  const ms = state.missionState;
  if (ms.cardT > 0) ms.cardT -= dt;
  if (ms.done || state.screen !== 'play') return;
  if (!ms.objective) { fallbackMissionBegin(state, ms.index); return; }
  const d = Math.hypot(state.player.x - ms.objective.x, state.player.y - ms.objective.y);
  if (d < 48) {
    const m = FALLBACK_MISSIONS[ms.index];
    state.player.money += m.pay;
    state.stats.earned += m.pay;
    state.stats.missionsDone += 1;
    setMessage(state, 'Job done: ' + m.title + '  +$' + m.pay);
    ms.index += 1;
    ms.objective = null;
    state.requestSave();
    if (ms.index >= FALLBACK_MISSIONS.length) { ms.done = true; }
  }
}

// ------------------------------------------------------------------ state --
function setMessage(state, text, seconds = 4) { state.message = text; state.messageT = seconds; state.messageTimer = seconds; }

const state = {
  time: 30, // start mid-morning in the 240 s day cycle
  screen: 'title',
  world,
  rng,
  input,
  audio,
  player: {
    x: 760, y: 1240, angle: 0, hp: 100, armor: 0, money: 250,
    inCar: null, weapon: 'fists', ammo: { pistol: 0, smg: 0, shotgun: 0 },
    weaponsOwned: ['fists'],
  },
  wanted: { stars: 0, heat: 0, bust: 0, lastCrime: -99 },
  cars: [], peds: [], copCars: [], officers: [], bullets: [], particles: [], pickups: [],
  missionState: null,
  stats: { carsStolen: 0, kills: 0, earned: 0, missionsDone: 0 },
  message: null, messageT: 0, messageTimer: 0,
  dialogue: null, dialogueT: 0,
  mouseWorld: { x: 0, y: 0 },
  busted: false,
  camera: { x: 0, y: 0 },
  flash: 0,
  playElapsed: 0,
  muted: false,
  bustFine: 0,
  completedShown: false,
  fireCooldown: 0,
  crimeCooldown: 0,
  sideT: 20,
  onCrime(type, x, y) {
    const HEAT = { steal: 25, shoot: 12, kill: 45, hitped: 30, hitcar: 6 };
    const base = HEAT[type] || 5;
    let witnessed = false;
    for (const ped of state.peds) {
      if (ped.hp > 0 && Math.hypot(ped.x - x, ped.y - y) < 300) { witnessed = true; break; }
    }
    if (!witnessed) {
      for (const off of state.officers) {
        if (Math.hypot(off.x - x, off.y - y) < 300) { witnessed = true; break; }
      }
    }
    const inMissionZone = (type === 'kill' || type === 'shoot')
      && state.missionState && state.missionState.objective
      && Math.hypot(state.missionState.objective.x - x, state.missionState.objective.y - y) < 420;
    const amount = (witnessed || inMissionZone) ? base : base / 2;
    state.wanted.heat = Math.min(220, state.wanted.heat + amount);
    state.wanted.lastCrime = state.time;
    if (typeof PoliceModule.addHeat === 'function') {
      try { PoliceModule.addHeat(state, amount, x, y); } catch { /* local heat above stands */ }
    }
  },
  damagePlayer(n) {
    if (state.screen !== 'play' || n <= 0) return;
    const p = state.player;
    let remaining = n;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, n * 0.6);
      p.armor -= absorbed;
      remaining = n - absorbed;
    }
    p.hp -= remaining;
    state.flash = 1;
    if (p.hp < 0) p.hp = 0;
  },
  requestSave() {
    const data = {
      player: { x: state.player.x, y: state.player.y, hp: state.player.hp, armor: state.player.armor, money: state.player.money, weapon: state.player.weapon, ammo: { ...state.player.ammo }, weaponsOwned: [...state.player.weaponsOwned] },
      missionIndex: state.missionState ? state.missionState.index : 0,
      stats: { ...state.stats },
      time: state.time,
    };
    if (typeof SaveModule.saveGame === 'function') {
      try { SaveModule.saveGame(state, data); return; } catch { /* fallback below */ }
      try { SaveModule.saveGame(data); return; } catch { /* fallback below */ }
    }
    saveGameFallback(data);
  },
};

// Mission state from the missions module when present, else the local chain.
(function initMissions() {
  if (typeof MissionsModule.createMissionState === 'function') {
    try { state.missionState = MissionsModule.createMissionState(state) || MissionsModule.createMissionState(); } catch { state.missionState = null; }
  }
  if (!state.missionState || typeof state.missionState !== 'object') state.missionState = fallbackMissionState();
  if (!('index' in state.missionState)) state.missionState.index = 0;
  if (!('objective' in state.missionState)) state.missionState.objective = null;
  if (!('cardT' in state.missionState)) state.missionState.cardT = 0;
})();

// ------------------------------------------------------- spawning helpers --
function roadCenters(vertical) {
  const arr = vertical ? (world.roadCentersX || []) : (world.roadCentersY || []);
  if (arr.length) return arr;
  const out = [];
  if (vertical) for (let x = 240; x <= 3600; x += 480) out.push(x);
  else for (let y = 240; y <= 2640; y += 480) out.push(y);
  return out;
}
function makePlainCar(x, y, angle, kind, color) {
  if (typeof VehiclesModule.makeCar === 'function') {
    try { const c = VehiclesModule.makeCar(x, y, angle, kind); if (c && typeof c.x === 'number') { if (color) c.color = color; return c; } } catch { /* plain below */ }
    try { const c = VehiclesModule.makeCar({ x, y, angle, kind, color }); if (c && typeof c.x === 'number') return c; } catch { /* plain below */ }
  }
  return { x, y, angle, speed: 0, w: 52, h: 26, kind: kind || 'sedan', color: color || '#7a86a8', driver: null, hp: 100, dead: false };
}
function fallbackSpawnTraffic(count) {
  const kinds = ['sedan', 'taxi', 'hatch', 'van', 'sports'];
  const colors = ['#7a86a8', '#a87a7a', '#7aa88a', '#c9c9c9', '#ffd23e', '#4fc3f7', '#b089e8'];
  for (let i = 0; i < count; i++) {
    const vertical = rng() < 0.5;
    const centers = roadCenters(vertical);
    const c = centers[Math.floor(rng() * centers.length)];
    const along = 200 + rng() * (vertical ? 2100 : 3400);
    const dir = rng() < 0.5 ? 1 : -1;
    const lane = 26 * dir;
    const x = vertical ? c + lane : along;
    const y = vertical ? along : Math.min(c + lane, WATER_Y - 90);
    if (y >= WATER_Y) continue;
    const car = makePlainCar(x, y, vertical ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI), kinds[Math.floor(rng() * kinds.length)], colors[Math.floor(rng() * colors.length)]);
    car.driver = 'traffic';
    car.speed = 60 + rng() * 60;
    state.cars.push(car);
  }
}
function fallbackSpawnPeds(count) {
  const cols = ['#b08968', '#68a8b0', '#a8688a', '#8aa868', '#d0d0d0', '#e0a458'];
  for (let i = 0; i < count; i++) {
    const vertical = rng() < 0.5;
    const centers = roadCenters(vertical);
    const c = centers[Math.floor(rng() * centers.length)];
    const x = vertical ? c + (rng() < 0.5 ? -78 : 78) : 200 + rng() * 3400;
    const y = vertical ? 200 + rng() * 2100 : Math.min(c + (rng() < 0.5 ? -78 : 78), WATER_Y - 40);
    if (y >= WATER_Y) continue;
    state.peds.push({ x, y, angle: rng() * Math.PI * 2, speed: 26 + rng() * 30, hp: 50, kind: 'civilian', color: cols[Math.floor(rng() * cols.length)], state: 'walk', wanderT: rng() * 4 });
  }
}
function seedPickups() {
  if (state.pickups.length) return;
  const hosp = spotById('hospital', 3540, 790);
  const prec = spotById('precinct', 330, 330);
  const gar = spotById('garage', 2650, 1690);
  state.pickups.push(
    { x: hosp.x - 60, y: hosp.y + 40, type: 'health' },
    { x: prec.x + 90, y: prec.y + 60, type: 'armor' },
    { x: gar.x + 50, y: gar.y - 50, type: 'weapon', weapon: 'pistol' },
    { x: 1210, y: 730, type: 'ammo', weapon: 'pistol' },
    { x: 2170, y: 1210, type: 'shard' },
    { x: 730, y: 2170, type: 'shard' },
    { x: 3130, y: 730, type: 'shard' },
    { x: 1690, y: 1930, type: 'health' },
  );
}
function seedAmbient() {
  if (!state.cars.length) {
    let spawned = false;
    if (typeof VehiclesModule.spawnTraffic === 'function') {
      try { const r = VehiclesModule.spawnTraffic(state.world, state.rng, 14); if (Array.isArray(r) && r.length) { state.cars.push(...r); spawned = true; } } catch { /* next shape */ }
      if (!spawned) { try { const r = VehiclesModule.spawnTraffic(state, 14); if (Array.isArray(r) && r.length) { state.cars.push(...r); spawned = true; } } catch { /* fallback */ } }
      if (!spawned) { try { VehiclesModule.spawnTraffic(state); spawned = state.cars.length > 0; } catch { /* fallback */ } }
    }
    if (!state.cars.length) fallbackSpawnTraffic(14);
  }
  if (!state.peds.length) {
    let spawned = false;
    if (typeof PedsModule.spawnPeds === 'function') {
      try { const r = PedsModule.spawnPeds(state.world, state.rng, 22); if (Array.isArray(r) && r.length) { state.peds.push(...r); spawned = true; } } catch { /* next shape */ }
      if (!spawned) { try { const r = PedsModule.spawnPeds(state, 22); if (Array.isArray(r) && r.length) { state.peds.push(...r); spawned = true; } } catch { /* fallback */ } }
      if (!spawned) { try { PedsModule.spawnPeds(state); spawned = state.peds.length > 0; } catch { /* fallback */ } }
    }
    if (!state.peds.length) fallbackSpawnPeds(22);
  }
  seedPickups();
}
seedAmbient();

// ------------------------------------------------------------ fx helpers ---
function burst(x, y, color, n, speed = 130, size = 3) {
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, s = speed * (0.3 + rng() * 0.7);
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45 + rng() * 0.4, max: 0.85, size, color });
  }
}
function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pt = state.particles[i];
    pt.life -= dt;
    if (pt.life <= 0) { state.particles.splice(i, 1); continue; }
    pt.x += (pt.vx || 0) * dt; pt.y += (pt.vy || 0) * dt;
    pt.vx *= 0.92; pt.vy *= 0.92;
  }
  if (state.particles.length > 420) state.particles.splice(0, state.particles.length - 420);
}

// -------------------------------------------------------- fallback logic ---
function fallbackTraffic(dt) {
  for (const car of state.cars) {
    if (car.dead || car === state.player.inCar || car.driver !== 'traffic') continue;
    const target = 95;
    car.speed += Math.sign(target - (car.speed || 0)) * 40 * dt;
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    // turn at intersections sometimes; wrap at world edge
    const nearX = roadCenters(true).some((c) => Math.abs(car.x - c) < 8);
    const nearY = roadCenters(false).some((c) => Math.abs(car.y - c) < 8);
    if (nearX && nearY && rng() < 0.006) car.angle += (rng() < 0.5 ? 1 : -1) * Math.PI / 2;
    if (car.x < 60) { car.x = 60; car.angle = 0; }
    if (car.x > WORLD_W - 60) { car.x = WORLD_W - 60; car.angle = Math.PI; }
    if (car.y < 60) { car.y = 60; car.angle = Math.PI / 2; }
    if (car.y > WATER_Y - 60) { car.y = WATER_Y - 60; car.angle = -Math.PI / 2; }
  }
}
function fallbackPeds(dt) {
  for (const ped of state.peds) {
    if (ped.hp <= 0 || ped.kind === 'gang') continue;
    if (ped.state === 'flee') {
      ped.x += Math.cos(ped.angle) * 150 * dt;
      ped.y += Math.sin(ped.angle) * 150 * dt;
      ped.wanderT -= dt;
      if (ped.wanderT <= 0) ped.state = 'walk';
      continue;
    }
    ped.wanderT = (ped.wanderT || 0) - dt;
    if (ped.wanderT <= 0) { ped.angle = rng() * Math.PI * 2; ped.wanderT = 2 + rng() * 4; }
    const nx = ped.x + Math.cos(ped.angle) * (ped.speed || 30) * dt;
    const ny = ped.y + Math.sin(ped.angle) * (ped.speed || 30) * dt;
    if (!worldBuildingAt(nx, ny) && ny < WATER_Y - 16) { ped.x = nx; ped.y = ny; }
    else ped.angle += Math.PI / 2;
  }
}
function fallbackWanted(dt) {
  const w = state.wanted;
  if (state.time - w.lastCrime > 6 && w.heat > 0) w.heat = Math.max(0, w.heat - 2.2 * dt * 10 * 0.22);
  w.stars = w.heat >= 150 ? 5 : w.heat >= 105 ? 4 : w.heat >= 68 ? 3 : w.heat >= 38 ? 2 : w.heat >= 14 ? 1 : 0;
  if (w.stars === 0) w.bust = Math.max(0, w.bust - 30 * dt);
}
function fallbackPolice(dt) {
  const w = state.wanted, p = state.player;
  const wantCars = w.stars === 0 ? 0 : Math.min(5, w.stars + 1);
  while (state.copCars.length < wantCars) {
    const a = rng() * Math.PI * 2;
    const car = makePlainCar(p.x + Math.cos(a) * 620, p.y + Math.sin(a) * 620, a + Math.PI, 'police', '#eef2f7');
    car.driver = 'cop'; car.speed = 0;
    state.copCars.push(car);
  }
  if (w.stars === 0 && state.copCars.length) state.copCars.splice(0, state.copCars.length);
  for (const car of state.copCars) {
    const d = Math.hypot(p.x - car.x, p.y - car.y);
    const want = Math.atan2(p.y - car.y, p.x - car.x);
    let diff = want - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
    const top = p.inCar ? 265 : 190;
    car.speed = Math.min(top, (car.speed || 0) + 190 * dt);
    if (d < 60) car.speed = Math.min(car.speed, 40);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
  }
  const wantOfficers = w.stars >= 2 ? Math.min(4, w.stars) : 0;
  while (state.officers.length < wantOfficers) {
    state.officers.push({ x: p.x + (rng() - 0.5) * 500, y: p.y + (rng() - 0.5) * 500, angle: 0, speed: 118, hp: 70, kind: 'officer', color: '#2b5cff', state: 'chase' });
  }
  if (w.stars === 0) state.officers.splice(0, state.officers.length);
  let nearCop = false;
  for (const off of state.officers) {
    const d = Math.hypot(p.x - off.x, p.y - off.y);
    if (d < 320) nearCop = true;
    if (d > 22) { off.angle = Math.atan2(p.y - off.y, p.x - off.x); off.x += Math.cos(off.angle) * off.speed * dt; off.y += Math.sin(off.angle) * off.speed * dt; }
  }
  for (const car of state.copCars) if (Math.hypot(p.x - car.x, p.y - car.y) < 90) nearCop = true;
  const playerSpeed = p.inCar ? Math.abs(p.inCar.speed || 0) : 0;
  if (w.stars > 0 && nearCop && playerSpeed < 30) w.bust = Math.min(100, w.bust + 20 * dt);
  else w.bust = Math.max(0, w.bust - 14 * dt);
}
function fallbackCombat(dt) {
  const p = state.player;
  state.fireCooldown -= dt;
  // weapon switching
  const slots = ['fists', 'pistol', 'smg', 'shotgun'];
  for (let i = 0; i < 4; i++) if (pressedOnce('Digit' + (i + 1)) && p.weaponsOwned.includes(slots[i])) p.weapon = slots[i];
  if (!p.inCar && mouseDown() && state.fireCooldown <= 0 && p.weapon !== 'fists') {
    const w = CombatModule.WEAPONS && CombatModule.WEAPONS[p.weapon];
    const rate = w && w.rate ? w.rate : (p.weapon === 'smg' ? 0.11 : p.weapon === 'shotgun' ? 0.8 : 0.32);
    if ((p.ammo[p.weapon] || 0) > 0) {
      p.ammo[p.weapon] -= 1;
      state.fireCooldown = rate;
      const pellets = p.weapon === 'shotgun' ? 5 : 1;
      for (let i = 0; i < pellets; i++) {
        const spread = (rng() - 0.5) * (p.weapon === 'shotgun' ? 0.30 : 0.045);
        const a = p.angle + spread;
        state.bullets.push({ x: p.x + Math.cos(p.angle) * 16, y: p.y + Math.sin(p.angle) * 16, vx: Math.cos(a) * 880, vy: Math.sin(a) * 880, life: 0.55, dmg: w && (w.damage || w.dmg) ? (w.damage || w.dmg) : (p.weapon === 'shotgun' ? 16 : 26), from: 'player' });
      }
      burst(p.x + Math.cos(p.angle) * 18, p.y + Math.sin(p.angle) * 18, '#ffd23e', 2, 60, 2);
      state.onCrime('shoot', p.x, p.y);
      audioCall('shoot', p.weapon);
    } else {
      state.fireCooldown = 0.25;
      setMessage(state, 'Out of ammo — find an ammo pickup.', 2);
    }
  }
  // bullets travel + hit
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.x += (b.vx || 0) * dt; b.y += (b.vy || 0) * dt;
    b.life -= dt;
    let dead = b.life <= 0 || worldBuildingAt(b.x, b.y);
    if (!dead && b.from === 'player') {
      for (const ped of [...state.peds, ...state.officers]) {
        if (ped.hp > 0 && Math.hypot(ped.x - b.x, ped.y - b.y) < 11) {
          ped.hp -= b.dmg || 25;
          burst(b.x, b.y, '#ff5566', 5, 110, 3);
          if (ped.hp <= 0) {
            state.stats.kills += 1;
            state.onCrime('kill', ped.x, ped.y);
            burst(ped.x, ped.y, '#c81e3a', 12, 150, 3);
          } else state.onCrime('hitped', ped.x, ped.y);
          dead = true; break;
        }
      }
      if (!dead) for (const car of [...state.cars, ...state.copCars]) {
        if (car !== p.inCar && Math.abs(car.x - b.x) < 30 && Math.abs(car.y - b.y) < 18) { car.hp -= b.dmg || 25; dead = true; break; }
      }
    }
    if (dead) state.bullets.splice(i, 1);
  }
  // gang pressure: nearby gang members close in and shove during missions
  for (const ped of state.peds) {
    if (ped.kind !== 'gang' || ped.hp <= 0) continue;
    const d = Math.hypot(p.x - ped.x, p.y - ped.y);
    if (d < 260 && d > 30 && !p.inCar) {
      ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
      ped.x += Math.cos(ped.angle) * 74 * dt;
      ped.y += Math.sin(ped.angle) * 74 * dt;
    }
  }
}

// ------------------------------------------------------------- player step -
function stepPlayerOnFoot(dt) {
  const p = state.player;
  let mx = 0, my = 0;
  if (keyDown('KeyW') || keyDown('ArrowUp')) my -= 1;
  if (keyDown('KeyS') || keyDown('ArrowDown')) my += 1;
  if (keyDown('KeyA') || keyDown('ArrowLeft')) mx -= 1;
  if (keyDown('KeyD') || keyDown('ArrowRight')) mx += 1;
  const sprint = keyDown('ShiftLeft') || keyDown('ShiftRight');
  const speed = sprint ? 268 : 172;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    const nx = p.x + (mx / len) * speed * dt;
    const ny = p.y + (my / len) * speed * dt;
    if (!worldBuildingAt(nx, p.y) && !worldIsWater(nx, p.y)) p.x = nx;
    if (!worldBuildingAt(p.x, ny) && !worldIsWater(p.x, ny)) p.y = ny;
    p.x = Math.max(14, Math.min(WORLD_W - 14, p.x));
    p.y = Math.max(14, Math.min(WORLD_H - 14, p.y));
  }
  // face the mouse
  p.angle = Math.atan2(state.mouseWorld.y - p.y, state.mouseWorld.x - p.x);
  // enter a car
  if (pressedOnce('KeyE')) {
    let best = null, bestD = 62;
    for (const car of [...state.cars, ...state.copCars]) {
      if (car.dead) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    if (best) {
      const wasTraffic = best.driver === 'traffic';
      const wasParked = best.driver === 'parked' || best.driver == null;
      if (wasTraffic) {
        state.peds.push({ x: best.x + 20, y: best.y + 18, angle: Math.atan2(best.y - p.y, best.x - p.x) + Math.PI, speed: 150, hp: 50, kind: 'civilian', color: '#d0d0d0', state: 'flee', wanderT: 2.5 });
        state.onCrime('steal', best.x, best.y);
        state.stats.carsStolen += 1;
        setMessage(state, 'Car stolen — heat is on.', 2.5);
        audioCall('steal');
      } else if (wasParked || best.driver === 'cop' || best.kind === 'police') {
        state.onCrime('steal', best.x, best.y);
        state.stats.carsStolen += 1;
        setMessage(state, 'Car stolen — heat is on.', 2.5);
      }
      best.driver = 'player';
      p.inCar = best;
      p.x = best.x; p.y = best.y;
    }
  }
}
function stepPlayerDriving(dt) {
  const p = state.player;
  const car = p.inCar;
  if (!car || car.dead) { p.inCar = null; return; }
  if (pressedOnce('KeyE') || pressedOnce('KeyF')) {
    car.speed = 0;
    if (car.driver === 'player') car.driver = 'parked';
    p.inCar = null;
    p.x = car.x + Math.cos(car.angle + Math.PI / 2) * 30;
    p.y = car.y + Math.sin(car.angle + Math.PI / 2) * 30;
    if (worldBuildingAt(p.x, p.y)) { p.x = car.x - Math.cos(car.angle + Math.PI / 2) * 30; p.y = car.y - Math.sin(car.angle + Math.PI / 2) * 30; }
    return;
  }
  let handled = false;
  if (typeof VehiclesModule.drivePhysics === 'function') {
    try { VehiclesModule.drivePhysics(car, input, dt, state.world); handled = true; } catch { handled = false; }
    if (!handled) { try { VehiclesModule.drivePhysics(car, input, dt); handled = true; } catch { handled = false; } }
    if (!handled) { try { VehiclesModule.drivePhysics(state, car, input, dt); handled = true; } catch { handled = false; } }
  }
  if (!handled) {
    const stats = (typeof VehiclesModule.carStats === 'function' && VehiclesModule.carStats(car.kind)) || null;
    const top = stats && stats.topSpeed ? stats.topSpeed : (car.kind === 'sports' ? 330 : car.kind === 'police' ? 310 : 235);
    const accel = stats && stats.accel ? stats.accel : 210;
    if (keyDown('KeyW') || keyDown('ArrowUp')) car.speed = Math.min(top, (car.speed || 0) + accel * dt);
    else if (keyDown('KeyS') || keyDown('ArrowDown')) car.speed = Math.max(-110, (car.speed || 0) - accel * 0.8 * dt);
    else car.speed = (car.speed || 0) * (1 - Math.min(1, 0.7 * dt));
    const steer = (keyDown('KeyA') || keyDown('ArrowLeft') ? -1 : 0) + (keyDown('KeyD') || keyDown('ArrowRight') ? 1 : 0);
    if (steer && Math.abs(car.speed) > 4) car.angle += steer * 2.1 * dt * Math.sign(car.speed) * Math.min(1, Math.abs(car.speed) / 120);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    car.x = Math.max(30, Math.min(WORLD_W - 30, car.x));
    car.y = Math.max(30, Math.min(WATER_Y - 26, car.y));
    if (worldBuildingAt(car.x, car.y)) { car.x -= Math.cos(car.angle) * car.speed * dt; car.y -= Math.sin(car.angle) * car.speed * dt; car.speed *= -0.25; }
  }
  p.x = car.x; p.y = car.y; p.angle = car.angle;
  // collisions with other cars + peds
  state.crimeCooldown -= dt;
  for (const other of [...state.cars, ...state.copCars]) {
    if (other === car || other.dead) continue;
    if (Math.abs(other.x - car.x) < 46 && Math.abs(other.y - car.y) < 32 && Math.hypot(other.x - car.x, other.y - car.y) < 46) {
      if (typeof VehiclesModule.carHit === 'function') { try { VehiclesModule.carHit(car, other); } catch { /* local below */ } }
      other.hp -= Math.abs(car.speed) * 0.05;
      car.speed *= 0.55;
      burst((car.x + other.x) / 2, (car.y + other.y) / 2, '#ffb84d', 6, 120, 3);
      if (state.crimeCooldown <= 0) { state.onCrime('hitcar', car.x, car.y); state.crimeCooldown = 1.2; }
    }
  }
  for (const ped of state.peds) {
    if (ped.hp > 0 && Math.hypot(ped.x - car.x, ped.y - car.y) < 26 && Math.abs(car.speed) > 30) {
      ped.hp = 0; state.stats.kills += 1;
      state.onCrime('kill', ped.x, ped.y);
      burst(ped.x, ped.y, '#c81e3a', 10, 140, 3);
    }
  }
}

// ---------------------------------------------------------------- pickups --
function updatePickups(dt) {
  const p = state.player;
  for (const pk of state.pickups) {
    if (pk.taken) { pk.respawn = (pk.respawn || 60) - dt; if (pk.respawn <= 0) { pk.taken = false; } continue; }
    const d = Math.hypot(pk.x - p.x, pk.y - p.y);
    if (d > 26) continue;
    if (pk.type === 'shard' || pk.type === 'money') { p.money += 25; state.stats.earned += 25; setMessage(state, 'Cash shard +$25', 2); audioCall('pickup'); }
    else if (pk.type === 'health') { if (p.hp >= 100) continue; p.hp = Math.min(100, p.hp + 40); setMessage(state, 'Patched up +40', 2); audioCall('pickup'); }
    else if (pk.type === 'armor') { p.armor = Math.min(100, p.armor + 50); setMessage(state, 'Armour +50', 2); audioCall('pickup'); }
    else if (pk.type === 'ammo') {
      const w = pk.weapon || (p.weapon !== 'fists' ? p.weapon : 'pistol');
      const ammoType = w === 'shotgun' ? 'shells' : w;
      let fed = false;
      if (typeof CombatModule.addAmmo === 'function') { try { CombatModule.addAmmo(state, ammoType, 18); fed = true; } catch { fed = false; } }
      if (!fed && p.ammo && typeof p.ammo === 'object') p.ammo[w] = (p.ammo[w] || 0) + 18;
      setMessage(state, 'Ammo +18 (' + w + ')', 2); audioCall('pickup');
    }
    else if (pk.type === 'weapon') {
      const w = pk.weapon || 'pistol';
      let granted = false;
      if (typeof CombatModule.giveWeapon === 'function') { try { CombatModule.giveWeapon(state, w, 24); granted = true; } catch { granted = false; } }
      if (!granted) {
        if (Array.isArray(p.weaponsOwned) && !p.weaponsOwned.includes(w)) p.weaponsOwned.push(w);
        p.weapon = w;
        if (p.ammo && typeof p.ammo === 'object') p.ammo[w] = (p.ammo[w] || 0) + 24;
      } else if (Array.isArray(p.weaponsOwned) && !p.weaponsOwned.includes(w)) p.weaponsOwned.push(w);
      setMessage(state, 'Picked up: ' + w.toUpperCase(), 3); audioCall('pickup');
    } else continue;
    burst(pk.x, pk.y, '#ffd23e', 8, 100, 3);
    pk.taken = true; pk.respawn = pk.type === 'shard' ? 45 : 75;
  }
  // side activity: fresh shards drift in over time
  state.sideT -= dt;
  if (state.sideT <= 0) {
    state.sideT = 40;
    const xs = roadCenters(true), ys = roadCenters(false);
    state.pickups.push({ x: xs[Math.floor(rng() * xs.length)] + 70, y: Math.min(ys[Math.floor(rng() * ys.length)] + 70, WATER_Y - 60), type: 'shard' });
  }
}

// -------------------------------------------------------------------- step -
function step(dt) {
  state.time += dt;
  if (state.messageT > 0) state.messageT -= dt;
  if (state.messageTimer > 0) state.messageTimer -= dt;
  if (state.dialogueT > 0) state.dialogueT -= dt;
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.4);
  // mouse world from the last camera
  const mp = mousePos();
  state.mouseWorld.x = state.camera.x + mp.x;
  state.mouseWorld.y = state.camera.y + mp.y;

  const playing = state.screen === 'play';
  if (playing) state.playElapsed += dt;

  // ambient city always lives (title backdrop included)
  if (typeof VehiclesModule.updateTrafficCar === 'function' && state.screen !== 'play') {
    // module traffic is driven inside the play update below; title uses fallback drift
  }
  if (playing) {
    if (state.player.inCar) stepPlayerDriving(dt);
    else stepPlayerOnFoot(dt);

    // weapon switching: combat.js owns the inventory (state.weapons.owned)
    // and does not read the Digit keys itself, so handle 1-4 here and keep
    // player.weaponsOwned mirrored for save/HUD code.
    if (typeof CombatModule.ensureWeapons === 'function') {
      try {
        const inv = CombatModule.ensureWeapons(state);
        const slots = ['fists', 'pistol', 'smg', 'shotgun'];
        state.player.weaponsOwned = slots.filter((s) => inv.owned[s]);
        for (let i = 0; i < 4; i++) {
          if (pressedOnce('Digit' + (i + 1)) && inv.owned[slots[i]]) {
            state.player.weapon = slots[i];
            CombatModule.ensureWeapons(state); // refresh the player.ammo mirror
          }
        }
      } catch { /* the fallback combat below handles switching instead */ }
    }

    // combat (module first, local rules as fallback)
    let combatDone = false;
    if (typeof CombatModule.updateCombat === 'function') {
      try { CombatModule.updateCombat(state, dt); combatDone = true; } catch { combatDone = false; }
    }
    if (!combatDone) fallbackCombat(dt);
    if (typeof CombatModule.updateGang === 'function') {
      try { for (const ped of state.peds) { if (ped.kind === 'gang') CombatModule.updateGang(ped, state, dt); } } catch { /* gang optional */ }
    }

    // traffic (the player's own car is driven in stepPlayerDriving, not here)
    let trafficDone = false;
    if (typeof VehiclesModule.updateTrafficCar === 'function') {
      try { for (const car of state.cars) { if (car !== state.player.inCar) VehiclesModule.updateTrafficCar(car, state, dt); } trafficDone = state.cars.length > 0; } catch { trafficDone = false; }
    }
    if (!trafficDone) fallbackTraffic(dt);

    // pedestrians
    let pedsDone = false;
    if (typeof PedsModule.updatePed === 'function') {
      try { for (const ped of state.peds) PedsModule.updatePed(ped, state, dt); pedsDone = state.peds.length > 0; } catch { pedsDone = false; }
    }
    if (!pedsDone) fallbackPeds(dt);

    // wanted + police
    let wantedDone = false;
    if (typeof PoliceModule.updateWanted === 'function') { try { PoliceModule.updateWanted(state, dt); wantedDone = true; } catch { wantedDone = false; } }
    if (!wantedDone) fallbackWanted(dt);
    let policeDone = false;
    if (typeof PoliceModule.updatePolice === 'function') { try { PoliceModule.updatePolice(state, dt); policeDone = true; } catch { policeDone = false; } }
    if (!policeDone) fallbackPolice(dt);

    // missions + side activities
    const doneBefore = state.stats.missionsDone;
    if (state.missionState && state.missionState.usingFallback) fallbackUpdateMissions(state, dt);
    else if (typeof MissionsModule.updateMissions === 'function') {
      try { MissionsModule.updateMissions(state, dt); } catch { try { MissionsModule.updateMissions(state.missionState, state, dt); } catch { /* missions optional */ } }
      if (state.missionState && state.missionState.cardT > 0) state.missionState.cardT -= dt;
    }
    if (typeof MissionsModule.updateSideActivities === 'function') { try { MissionsModule.updateSideActivities(state, dt); } catch { /* optional */ } }
    if (state.stats.missionsDone > doneBefore) state.requestSave();

    // Mission title cards: missions.js never sets cardT/cardTitle, so watch
    // for a mission becoming active and raise the card here, once per index.
    const msNow = state.missionState;
    if (msNow && !msNow.usingFallback && !msNow.done && msNow.data && msNow.data.started
      && typeof msNow.index === 'number' && state._cardShownFor !== msNow.index) {
      state._cardShownFor = msNow.index;
      const list = MissionsModule.MISSIONS;
      const mNow = Array.isArray(list) ? list[msNow.index] : null;
      if (mNow) {
        msNow.cardTitle = mNow.title;
        msNow.cardKicker = 'MISSION ' + (msNow.index + 1) + ' OF ' + list.length;
        msNow.cardT = 3.5;
      }
    }

    updatePickups(dt);

    // busted / wasted / complete transitions. Bust arrives on two scales:
    // main's fallback fills 0..100, police.js fills 0..1 and itself flips
    // state.busted + screen when full — accept either so the fine, the
    // announcement and the sound are applied exactly once here.
    if (playing && (state.wanted.bust >= 100 || (state.busted && state.wanted.bust >= 1))) {
      state.busted = true;
      state.bustFine = 100 + state.wanted.stars * 75;
      state.screen = 'busted';
      announce('Busted. Fine $' + state.bustFine + '. Press Enter.');
      audioCall('busted');
    } else if (state.player.hp <= 0 && state.screen === 'play') {
      state.screen = 'wasted';
      announce('Wasted. Press Enter to wake up at the hospital.');
      audioCall('wasted');
    } else if (state.stats.missionsDone >= 6 && !state.completedShown && state.screen === 'play') {
      state.completedShown = true;
      state.screen = 'complete';
      state.requestSave();
      announce('All jobs complete. Press Enter to keep roaming Neon Harbor.');
    }
  } else if (state.screen === 'title') {
    fallbackTraffic(dt);
    fallbackPeds(dt);
  }
  updateParticles(dt);

  // audio context: engine + sirens follow the scene
  if (audio) {
    const speedAbs = state.player.inCar ? Math.abs(state.player.inCar.speed || 0) : 0;
    const ctxObj = { inCar: !!state.player.inCar, speed: speedAbs, stars: state.wanted.stars, screen: state.screen, muted: state.muted };
    if (typeof audio.setEngine === 'function' || typeof audio.setSiren === 'function') {
      if (typeof audio.setEngine === 'function') { try { audio.setEngine(ctxObj.inCar && state.screen === 'play', Math.min(1, speedAbs / 300)); } catch { /* ignore */ } }
      if (typeof audio.setSiren === 'function') { try { audio.setSiren(state.wanted.stars > 0 && state.screen === 'play', state.wanted.stars); } catch { /* ignore */ } }
    } else if (typeof audio.update === 'function') { try { audio.update(ctxObj, dt); } catch { /* ignore */ } }
    else {
      if (typeof audio.engine === 'function') { try { audio.engine(ctxObj.speed, ctxObj.inCar); } catch { /* ignore */ } }
      if (typeof audio.siren === 'function') { try { audio.siren(state.wanted.stars > 0 && state.screen === 'play'); } catch { /* ignore */ } }
    }
  }
}

// -------------------------------------------------------------- start play -
function startPlay(fresh = true) {
  if (fresh) {
    state.player.hp = 100;
    state.playElapsed = 0;
  }
  state.screen = 'play';
  state.busted = false;
  if (state.missionState && state.missionState.usingFallback && !state.missionState.objective && !state.missionState.done) {
    fallbackMissionBegin(state, state.missionState.index || 0);
  }
  announce('Playing Neon Harbor: Vice Run.');
}
function continueGame() {
  let data = null;
  if (typeof SaveModule.loadSave === 'function') { try { data = SaveModule.loadSave(); } catch { data = null; } }
  if (!data) data = loadSaveFallback();
  if (!data) { startPlay(true); return; }
  let applied = false;
  if (typeof SaveModule.applySave === 'function') { try { SaveModule.applySave(state, data); applied = true; } catch { applied = false; } }
  if (!applied) {
    const d = data.player || data;
    if (typeof d.x === 'number') state.player.x = d.x;
    if (typeof d.y === 'number') state.player.y = d.y;
    if (typeof d.hp === 'number') state.player.hp = d.hp;
    if (typeof d.armor === 'number') state.player.armor = d.armor;
    if (typeof d.money === 'number') state.player.money = d.money;
    if (d.ammo) state.player.ammo = { ...state.player.ammo, ...d.ammo };
    if (Array.isArray(d.weaponsOwned)) state.player.weaponsOwned = d.weaponsOwned;
    if (d.weapon) state.player.weapon = d.weapon;
    if (data.stats) state.stats = { ...state.stats, ...data.stats };
    if (state.missionState && typeof data.missionIndex === 'number') state.missionState.index = data.missionIndex;
    if (typeof data.time === 'number') state.time = data.time;
  }
  state.screen = 'play';
  announce('Save loaded. Playing.');
}
function resolveBusted() {
  const p = state.player;
  p.money = Math.max(0, p.money - state.bustFine);
  const prec = spotById('precinct', 330, 330);
  if (p.inCar) p.inCar = null;
  p.x = prec.x + 60; p.y = prec.y + 60;
  p.hp = Math.max(p.hp, 60);
  state.wanted.stars = 0; state.wanted.heat = 0; state.wanted.bust = 0;
  state.copCars.splice(0, state.copCars.length);
  state.officers.splice(0, state.officers.length);
  state.busted = false;
  state.screen = 'play';
  setMessage(state, 'Released. Fine paid: $' + state.bustFine, 4);
}
function resolveWasted() {
  const p = state.player;
  const fee = Math.floor(p.money * 0.10);
  p.money -= fee;
  const hosp = spotById('hospital', 3540, 790);
  if (p.inCar) p.inCar = null;
  p.x = hosp.x - 40; p.y = hosp.y + 40;
  p.hp = 100;
  state.wanted.stars = 0; state.wanted.heat = 0; state.wanted.bust = 0;
  state.copCars.splice(0, state.copCars.length);
  state.officers.splice(0, state.officers.length);
  state.screen = 'play';
  setMessage(state, 'Hospital bill: $' + fee, 4);
}
function toggleMute() {
  state.muted = !state.muted;
  if (audio) {
    if (typeof audio.setMuted === 'function') { try { audio.setMuted(state.muted); } catch { /* ignore */ } }
    else audio.muted = state.muted;
  }
  setMessage(state, state.muted ? 'Muted' : 'Sound on', 1.5);
}

// ------------------------------------------------------------ frame input --
function handleScreenKeys() {
  if (state.screen === 'title') {
    if (pressedOnce('Enter') || pressedOnce('NumpadEnter')) startPlay(true);
    else if (pressedOnce('KeyC') && hasSave()) continueGame();
    else if (pressedOnce('KeyM')) toggleMute();
    return;
  }
  if (state.screen === 'play') {
    if (pressedOnce('Escape') || pressedOnce('KeyP')) { state.screen = 'pause'; announce('Paused.'); }
    else if (pressedOnce('KeyK')) { state.requestSave(); setMessage(state, 'Saved.', 2); }
    else if (pressedOnce('KeyM')) toggleMute();
    return;
  }
  if (state.screen === 'pause') {
    if (pressedOnce('Escape') || pressedOnce('KeyP') || pressedOnce('Enter')) { state.screen = 'play'; announce('Playing.'); }
    return;
  }
  if (state.screen === 'busted') { if (pressedOnce('Enter')) resolveBusted(); return; }
  if (state.screen === 'wasted') { if (pressedOnce('Enter')) resolveWasted(); return; }
  if (state.screen === 'complete') { if (pressedOnce('Enter')) { state.screen = 'play'; setMessage(state, 'Free roam — Neon Harbor is yours.', 4); } return; }
}

// ----------------------------------------------------------------- render --
function panel(title, lines, accent = '#ff2d78') {
  const w = Math.min(620, viewW - 40), h = 120 + lines.length * 30;
  const x = (viewW - w) / 2, y = (viewH - h) / 2;
  ctx.fillStyle = 'rgba(5,8,16,0.78)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, w, 4);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText(title, viewW / 2, y + 58);
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = '#cfe3ff';
  lines.forEach((line, i) => ctx.fillText(line, viewW / 2, y + 96 + i * 30));
}
function renderFrame() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScene(ctx, state, viewW, viewH);
  if (state.screen === 'play' || state.screen === 'pause') drawHUD(ctx, state, viewW, viewH);

  if (state.screen === 'title') {
    const grad = ctx.createLinearGradient(0, 0, 0, viewH);
    grad.addColorStop(0, 'rgba(4,6,14,0.55)');
    grad.addColorStop(0.5, 'rgba(4,6,14,0.18)');
    grad.addColorStop(1, 'rgba(4,6,14,0.66)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, viewW, viewH);
    ctx.textAlign = 'center';
    ctx.font = 'bold 21px system-ui, sans-serif';
    ctx.fillStyle = '#37e6e0';
    ctx.fillText('M A R A   V O S S   T A K E S   O N E   J O B   T O O   M A N Y', viewW / 2, viewH * 0.24);
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.fillStyle = '#ff2d78';
    ctx.fillText('NEON HARBOR', viewW / 2 + 3, viewH * 0.24 + 86 + 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('NEON HARBOR', viewW / 2, viewH * 0.24 + 86);
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23e';
    ctx.fillText('V I C E   R U N', viewW / 2, viewH * 0.24 + 132);
    ctx.font = '600 19px system-ui, sans-serif';
    ctx.fillStyle = '#eef3ff';
    const menuY = viewH * 0.62;
    ctx.fillText('ENTER — Start', viewW / 2, menuY);
    if (hasSave()) ctx.fillText('C — Continue', viewW / 2, menuY + 30);
    ctx.fillText('M — ' + (state.muted ? 'Unmute' : 'Mute'), viewW / 2, menuY + (hasSave() ? 60 : 30));
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(207,227,255,0.8)';
    ctx.fillText('WASD move · E enter car · Mouse aim · Click fire · Esc pause · K save', viewW / 2, viewH - 26);
  } else if (state.screen === 'pause') {
    ctx.fillStyle = 'rgba(4,6,14,0.45)';
    ctx.fillRect(0, 0, viewW, viewH);
    panel('PAUSED', ['Esc / P / Enter — Resume', 'Your progress autosaves when a job completes.'], '#37e6e0');
  } else if (state.screen === 'busted') {
    drawHUD(ctx, state, viewW, viewH);
    ctx.fillStyle = 'rgba(10,10,30,0.5)';
    ctx.fillRect(0, 0, viewW, viewH);
    panel('BUSTED', ['Neon Harbor PD got their courier.', 'Fine: $' + state.bustFine + ' — you wake up at the precinct.', 'ENTER — Continue'], '#3f7bff');
  } else if (state.screen === 'wasted') {
    drawHUD(ctx, state, viewW, viewH);
    ctx.fillStyle = 'rgba(40,4,10,0.52)';
    ctx.fillRect(0, 0, viewW, viewH);
    panel('WASTED', ['St. Coral Hospital patches Mara up.', 'The bill is 10% of her cash.', 'ENTER — Continue'], '#ff4455');
  } else if (state.screen === 'complete') {
    drawHUD(ctx, state, viewW, viewH);
    ctx.fillStyle = 'rgba(4,10,8,0.5)';
    ctx.fillRect(0, 0, viewW, viewH);
    panel('VICE RUN COMPLETE', [
      'Mara made the boat. Neon Harbor keeps the change.',
      'Jobs done: ' + state.stats.missionsDone + '  ·  Earned: $' + state.stats.earned + '  ·  Cars stolen: ' + state.stats.carsStolen + '  ·  Cash: $' + Math.floor(state.player.money),
      'ENTER — Free roam',
    ], '#ffd23e');
  }
}

// -------------------------------------------------------------------- run --
const gameFacade = { state, step, startPlay: () => startPlay(true) };
window.__neonHarbor = { state, step, startPlay: gameFacade.startPlay };

if (shotName) {
  // Deterministic screenshot: stage through the real sim, paint once, done.
  state.player.x = 1920; state.player.y = 1150;
  stageShot(shotName, gameFacade);
  requestAnimationFrame(() => {
    renderFrame();
    document.title = 'shot-ready';
    window.__shotReady = true;
    announce('Neon Harbor screenshot scene: ' + shotName);
  });
} else {
  announce('Neon Harbor: Vice Run. Press Enter to start.');
  let last = performance.now();
  let accumulator = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleScreenKeys();
    let n = 0;
    while (accumulator >= STEP && n < 8) {
      if (state.screen !== 'pause' && state.screen !== 'busted' && state.screen !== 'wasted' && state.screen !== 'complete') step(STEP);
      else state.time += 0; // frozen screens: world holds still
      accumulator -= STEP;
      n++;
    }
    if (n === 8) accumulator = 0;
    renderFrame();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'play') { state.screen = 'pause'; announce('Paused.'); }
  });
  requestAnimationFrame(frame);
}
