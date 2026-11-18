// save.js — localStorage persistence for Neon Harbor: Vice Run.
//
// One key, one JSON blob, everything guarded: private windows, headless
// screenshot runs and locked-down browsers can all refuse storage, and the
// game must never crash because saving failed. Wanted level is deliberately
// NOT saved — loading a game always starts Mara clean.

export const SAVE_KEY = 'neon-harbor-save-v1';

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }
  return null;
}

/**
 * Snapshot the save-worthy slice of state. Returns true when the blob was
 * actually written.
 */
export function saveGame(state) {
  const store = storage();
  if (!store || !state || !state.player) return false;
  try {
    const p = state.player;
    const weapons = state.weapons && typeof state.weapons === 'object'
      ? {
        owned: { ...(state.weapons.owned || { fists: true }) },
        ammo: { ...(state.weapons.ammo || {}) },
      }
      : { owned: { fists: true, [p.weapon || 'fists']: true }, ammo: {} };
    const data = {
      version: 1,
      savedAt: Date.now(),
      money: p.money || 0,
      missionIndex: state.missionState ? state.missionState.index : 0,
      missionsDone: state.missionState ? !!state.missionState.done : false,
      stats: state.stats
        ? {
          carsStolen: state.stats.carsStolen || 0,
          kills: state.stats.kills || 0,
          earned: state.stats.earned || 0,
          missionsDone: state.stats.missionsDone || 0,
        }
        : { carsStolen: 0, kills: 0, earned: 0, missionsDone: 0 },
      weapons,
      weapon: p.weapon || 'fists',
      player: {
        x: p.x, y: p.y, angle: p.angle || 0,
        hp: p.hp, armor: p.armor || 0,
      },
    };
    store.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Read and validate the saved blob, or return null. */
export function loadSave() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (typeof data.money !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function hasSave() {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave() {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a loaded blob to a live state: money, mission progress, stats,
 * weapons/ammo and Mara's position. Wanted is cleared, transient entities
 * are left for main.js to rebuild, and the mission machine is reset so the
 * saved mission restarts cleanly from its first step.
 */
export function applySave(state, data) {
  if (!state || !data || typeof data !== 'object') return false;
  const p = state.player;
  if (!p) return false;
  try {
    if (typeof data.money === 'number') p.money = data.money;
    if (data.player && typeof data.player === 'object') {
      if (typeof data.player.x === 'number') p.x = data.player.x;
      if (typeof data.player.y === 'number') p.y = data.player.y;
      if (typeof data.player.angle === 'number') p.angle = data.player.angle;
      if (typeof data.player.hp === 'number') p.hp = data.player.hp;
      if (typeof data.player.armor === 'number') p.armor = data.player.armor;
    }
    p.inCar = null;

    if (data.stats && state.stats) {
      state.stats.carsStolen = data.stats.carsStolen || 0;
      state.stats.kills = data.stats.kills || 0;
      state.stats.earned = data.stats.earned || 0;
      state.stats.missionsDone = data.stats.missionsDone || 0;
    }

    if (data.weapons && typeof data.weapons === 'object') {
      state.weapons = {
        owned: { fists: true, ...(data.weapons.owned || {}) },
        ammo: { pistol: 0, smg: 0, shells: 0, ...(data.weapons.ammo || {}) },
      };
    }
    if (data.weapon) p.weapon = data.weapon;
    const w = state.weapons;
    if (w && w.ammo) {
      const ammoFor = { pistol: 'pistol', smg: 'smg', shotgun: 'shells' }[p.weapon];
      p.ammo = ammoFor ? (w.ammo[ammoFor] || 0) : Infinity;
    }

    if (state.missionState) {
      state.missionState.index = typeof data.missionIndex === 'number' ? data.missionIndex : 0;
      state.missionState.step = 0;
      state.missionState.timer = null;
      state.missionState.data = {};
      state.missionState.markers = [];
      state.missionState.objective = null;
      state.missionState.done = !!data.missionsDone;
      state.missionState.active = !state.missionState.done;
    }

    // A loaded game always starts clean with the law.
    if (state.wanted) {
      state.wanted.stars = 0;
      state.wanted.heat = 0;
      state.wanted.bust = 0;
      state.wanted.sinceCrime = 999;
    }
    state.busted = false;
    if (Array.isArray(state.copCars)) state.copCars = [];
    if (Array.isArray(state.officers)) state.officers = [];
    if (Array.isArray(state.bullets)) state.bullets = [];
    return true;
  } catch {
    return false;
  }
}
