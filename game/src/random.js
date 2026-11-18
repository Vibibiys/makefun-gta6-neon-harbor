// Neon Harbor: Vice Run — deterministic seeded randomness.
//
// The whole city is generated from one seed so a given seed always builds
// the same Neon Harbor: same buildings, same parked cars, same traffic.
// The generator below is a mulberry32-style counter generator written for
// this game: a 32-bit state advanced by an odd increment, then scrambled
// with two xorshift-multiply rounds. It is fast, has a full 2^32 period
// for the state, and is good enough for game placement (not cryptography).

/**
 * Create a seeded RNG.
 *
 * @param {number} seed any integer; 0 is remapped so it is not a dead state.
 * @returns {{next: function(): number,
 *            range: function(number, number): number,
 *            int: function(number, number): number,
 *            pick: function(Array): *,
 *            chance: function(number): boolean,
 *            sign: function(): number,
 *            shuffle: function(Array): Array,
 *            fork: function(): object}}
 */
export function makeRng(seed) {
  let state = (typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0;
  if (state === 0) state = 0x9e3779b9;

  // One step of the generator: returns a float in [0, 1).
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [a, b). With no usable span, returns a. */
  function range(a, b) {
    if (!(b > a)) return a;
    return a + next() * (b - a);
  }

  /** Integer in [a, b] inclusive (bounds are swapped if given backwards). */
  function int(a, b) {
    let lo = Math.ceil(Math.min(a, b));
    let hi = Math.floor(Math.max(a, b));
    if (hi < lo) { lo = hi = Math.floor(a); }
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  /** A uniformly chosen element, or undefined for an empty array. */
  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(next() * arr.length)];
  }

  /** True with probability p (clamped to [0, 1]). */
  function chance(p) {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return next() < p;
  }

  /** +1 or -1, equally likely. */
  function sign() {
    return next() < 0.5 ? -1 : 1;
  }

  /** In-place Fisher–Yates shuffle driven by this RNG; returns the array. */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * A child RNG seeded from this one's stream. Handy when one subsystem
   * (say, traffic) should not disturb another subsystem's sequence.
   */
  function fork() {
    return makeRng(Math.floor(next() * 4294967296));
  }

  return { next, range, int, pick, chance, sign, shuffle, fork };
}

/**
 * Compatibility alias for code written against a bare-function RNG style:
 * returns a plain function f() in [0, 1) with the helper methods attached.
 */
export function createRandom(seed) {
  const rng = makeRng(seed);
  const fn = () => rng.next();
  fn.range = rng.range;
  fn.int = rng.int;
  fn.pick = rng.pick;
  fn.chance = rng.chance;
  return fn;
}

/**
 * Deterministic hash noise in [0, 1) from two numbers. Used for per-entity
 * decisions (a car's turn at an intersection, a ped's next wander target)
 * where carrying an RNG instance around would be awkward: the same inputs
 * always give the same answer, so behaviour stays reproducible.
 */
export function hashNoise(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
