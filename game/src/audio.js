// audio.js — All-synthesized sound for Neon Harbor: Vice Run.
//
// No audio assets exist in this game: every effect is oscillators and shaped
// noise through WebAudio, and the music is a small step-sequenced bassline
// with a neon arp on top. createAudio() returns the engine/siren/effects
// API main.js drives. Nothing makes a sound (or throws) before unlock() has
// created a context from a user gesture, and every method is a safe no-op
// in headless or muted contexts.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  let engine = null; // {osc, osc2, gain, filter}
  let siren = null; // {osc, lfo, lfoGain, gain}
  let musicTimer = null;
  let musicStep = 0;
  let musicOn = false;

  const api = {
    muted: false,
    unlock, setEngine, setSiren, shot, hit, pickup, cash, bust,
    setMusic, toggleMute,
  };

  function ac() {
    if (ctx) return ctx;
    try {
      const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
        || (typeof globalThis !== 'undefined' && globalThis.AudioContext);
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = api.muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // One shared white-noise buffer for shots, hits and wind.
      const len = Math.floor(ctx.sampleRate * 0.6);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  /** Create/resume the context. Call from a user gesture. */
  function unlock() {
    const c = ac();
    if (!c) return false;
    try {
      if (c.state === 'suspended') void c.resume();
    } catch { /* resume is best-effort */ }
    return true;
  }

  function ready() {
    return !!(ctx && master && !api.muted);
  }

  // --- tiny synth helpers -----------------------------------------------------

  function tone({ freq = 440, freqEnd = null, type = 'sine', t = 0, dur = 0.15, vol = 0.2 }) {
    if (!ready()) return;
    try {
      const t0 = ctx.currentTime + t;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch { /* a failed voice must never break the game */ }
  }

  function noise({ t = 0, dur = 0.12, vol = 0.25, freq = 1800, q = 0.8, type = 'bandpass' }) {
    if (!ready() || !noiseBuf) return;
    try {
      const t0 = ctx.currentTime + t;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start(t0, Math.random() * 0.3);
      src.stop(t0 + dur + 0.02);
    } catch { /* noop */ }
  }

  // --- one-shot effects ---------------------------------------------------------

  /** kind: 'pistol' | 'smg' | 'shotgun' | 'fists' | anything else. */
  function shot(kind) {
    if (!ready()) return;
    if (kind === 'shotgun') {
      noise({ dur: 0.28, vol: 0.5, freq: 700, type: 'lowpass' });
      tone({ freq: 130, freqEnd: 45, type: 'square', dur: 0.2, vol: 0.3 });
    } else if (kind === 'smg') {
      noise({ dur: 0.07, vol: 0.32, freq: 2400 });
      tone({ freq: 320, freqEnd: 120, type: 'square', dur: 0.06, vol: 0.16 });
    } else if (kind === 'fists') {
      noise({ dur: 0.06, vol: 0.18, freq: 500, type: 'lowpass' });
    } else {
      noise({ dur: 0.11, vol: 0.38, freq: 1900 });
      tone({ freq: 240, freqEnd: 80, type: 'square', dur: 0.1, vol: 0.22 });
    }
  }

  function hit() {
    if (!ready()) return;
    noise({ dur: 0.08, vol: 0.22, freq: 900 });
    tone({ freq: 190, freqEnd: 70, type: 'triangle', dur: 0.12, vol: 0.25 });
  }

  function pickup() {
    if (!ready()) return;
    tone({ freq: 660, type: 'sine', dur: 0.09, vol: 0.2 });
    tone({ freq: 990, type: 'sine', t: 0.07, dur: 0.14, vol: 0.2 });
  }

  function cash() {
    if (!ready()) return;
    tone({ freq: 880, type: 'triangle', dur: 0.08, vol: 0.2 });
    tone({ freq: 1174, type: 'triangle', t: 0.06, dur: 0.08, vol: 0.2 });
    tone({ freq: 1568, type: 'triangle', t: 0.12, dur: 0.16, vol: 0.22 });
  }

  function bust() {
    if (!ready()) return;
    tone({ freq: 620, freqEnd: 620, type: 'square', dur: 0.16, vol: 0.16 });
    tone({ freq: 440, type: 'square', t: 0.18, dur: 0.16, vol: 0.16 });
    tone({ freq: 620, type: 'square', t: 0.36, dur: 0.16, vol: 0.16 });
    tone({ freq: 220, freqEnd: 55, type: 'sawtooth', t: 0.5, dur: 0.5, vol: 0.28 });
    noise({ t: 0.5, dur: 0.4, vol: 0.15, freq: 400, type: 'lowpass' });
  }

  // --- engine loop ---------------------------------------------------------------

  function setEngine(on, speedRatio = 0) {
    if (!ctx || !master) return;
    try {
      if (on && !engine) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 320;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        osc.start();
        osc2.start();
        engine = { osc, osc2, gain, filter };
      }
      if (engine) {
        const t = ctx.currentTime;
        const r = Math.max(0, Math.min(1.2, speedRatio || 0));
        engine.osc.frequency.setTargetAtTime(48 + r * 130, t, 0.06);
        engine.osc2.frequency.setTargetAtTime(24 + r * 66, t, 0.06);
        engine.filter.frequency.setTargetAtTime(280 + r * 700, t, 0.08);
        engine.gain.gain.setTargetAtTime(on && !api.muted ? 0.055 + r * 0.03 : 0, t, 0.09);
        if (!on) {
          const dead = engine;
          engine = null;
          setTimeout(() => {
            try { dead.osc.stop(); dead.osc2.stop(); } catch { /* already stopped */ }
          }, 250);
        }
      }
    } catch { engine = null; }
  }

  // --- siren loop ------------------------------------------------------------------

  function setSiren(on, stars = 0) {
    if (!ctx || !master) return;
    try {
      if (on && !siren) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 840;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 0.55;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 130;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(master);
        osc.start();
        lfo.start();
        siren = { osc, lfo, lfoGain, gain };
      }
      if (siren) {
        const t = ctx.currentTime;
        const vol = on && !api.muted ? 0.012 + Math.min(5, stars || 1) * 0.005 : 0;
        siren.gain.gain.setTargetAtTime(vol, t, 0.15);
        siren.lfo.frequency.setTargetAtTime(0.45 + (stars || 1) * 0.09, t, 0.2);
        if (!on) {
          const dead = siren;
          siren = null;
          setTimeout(() => {
            try { dead.osc.stop(); dead.lfo.stop(); } catch { /* already stopped */ }
          }, 400);
        }
      }
    } catch { siren = null; }
  }

  // --- music: sequenced bassline + arp --------------------------------------------

  // A-minor harbor groove: bass roots and a pentatonic arp, 8th notes.
  const BASS = [55, 0, 55, 55, 0, 65.41, 0, 49, 55, 0, 55, 55, 0, 82.41, 73.42, 65.41];
  const ARP = [220, 261.63, 329.63, 392, 329.63, 261.63, 293.66, 349.23];

  function musicTick() {
    if (!musicOn || !ready()) return;
    const step = musicStep;
    musicStep = (musicStep + 1) % 64;
    const bass = BASS[step % BASS.length];
    if (bass) tone({ freq: bass, type: 'triangle', dur: 0.21, vol: 0.30 });
    if (step % 2 === 0) {
      const note = ARP[(step / 2) % ARP.length];
      tone({ freq: note, type: 'sine', dur: 0.18, vol: 0.07 });
    }
    if (step % 8 === 4) noise({ dur: 0.03, vol: 0.05, freq: 6000, type: 'highpass' });
    if (step % 16 === 0) tone({ freq: 110, freqEnd: 40, type: 'sine', dur: 0.22, vol: 0.32 });
  }

  function setMusic(on) {
    musicOn = !!on;
    if (musicOn && !musicTimer) {
      if (!ctx) ac();
      musicStep = 0;
      musicTimer = setInterval(musicTick, 215);
    } else if (!musicOn && musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  function toggleMute() {
    api.muted = !api.muted;
    if (master && ctx) {
      try { master.gain.setTargetAtTime(api.muted ? 0 : 0.5, ctx.currentTime, 0.03); } catch { /* noop */ }
    }
    if (api.muted) {
      if (engine) setEngine(false, 0);
      if (siren) setSiren(false, 0);
    }
    return api.muted;
  }

  return api;
}
