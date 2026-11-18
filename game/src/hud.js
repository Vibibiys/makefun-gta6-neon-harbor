// Heads-up display: every overlay is drawn on the canvas — money and clock,
// wanted stars with the bust meter, health / armour / weapon, the objective
// line, message and dialogue boxes, the mission title card, the controls hint
// and the minimap. No DOM is touched from here.
import { drawMinimap } from './minimap.js';
import * as CombatModule from './combat.js';

const WEAPON_NAMES = { fists: 'Fists', pistol: 'Pistol', smg: 'SMG', shotgun: 'Shotgun' };

function clockText(state) {
  // 240 s day, starting at 08:00. 10 s of game time = 1 city hour.
  const totalMin = Math.floor((((state.time || 0) % 240) / 240) * 24 * 60 + 8 * 60) % (24 * 60);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function weaponLabel(state) {
  const p = state.player;
  const w = p.weapon || 'fists';
  const name = (CombatModule.WEAPONS && CombatModule.WEAPONS[w] && CombatModule.WEAPONS[w].name)
    || WEAPON_NAMES[w] || w;
  if (w === 'fists') return name;
  // Ammo lives in two shapes: the contract's per-weapon map on player.ammo,
  // and combat.js's mirror where player.ammo is the current reserve number
  // (with the full reserve in state.weapons.ammo, shotgun shells as 'shells').
  let ammo = 0;
  if (typeof p.ammo === 'number' && Number.isFinite(p.ammo)) ammo = p.ammo;
  else if (p.ammo && typeof p.ammo[w] === 'number') ammo = p.ammo[w];
  else if (state.weapons && state.weapons.ammo) {
    const type = (CombatModule.WEAPONS && CombatModule.WEAPONS[w] && CombatModule.WEAPONS[w].ammo) || w;
    if (typeof state.weapons.ammo[type] === 'number') ammo = state.weapons.ammo[type];
  }
  return `${name}  ·  ${ammo}`;
}

function bar(ctx, x, y, w, h, frac, fill, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? line + ' ' + word : word;
    if (ctx.measureText(trial).width > maxW && line) { lines.push(line); line = word; }
    else line = trial;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export function drawHUD(ctx, state, W, H) {
  const p = state.player;
  const t = state.time || 0;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ---------- top-left: money + clock ----------
  ctx.fillStyle = 'rgba(7,10,18,0.62)';
  ctx.fillRect(12, 12, 188, 62);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
  ctx.strokeRect(12.5, 12.5, 188, 62);
  ctx.textAlign = 'left';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillStyle = '#7dff9a';
  ctx.fillText('$' + Math.max(0, Math.floor(p.money || 0)).toLocaleString('en-US'), 24, 42);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = '#cfe3ff';
  ctx.fillText('NEON HARBOR  ·  ' + clockText(state), 24, 64);

  // ---------- top-right: stars, bust meter, minimap ----------
  const mapSize = Math.max(110, Math.min(168, Math.floor(W * 0.16)));
  const mapX = W - mapSize - 14;
  const stars = state.wanted ? state.wanted.stars : 0;
  ctx.textAlign = 'right';
  ctx.font = '22px system-ui, sans-serif';
  const bust = state.wanted ? (state.wanted.bust || 0) : 0;
  const flashing = bust > 0 && Math.floor(t * 5) % 2 === 0;
  for (let i = 0; i < 5; i++) {
    const filled = i < stars;
    ctx.fillStyle = filled ? (flashing ? '#ffffff' : '#ffd23e') : 'rgba(255,255,255,0.22)';
    ctx.fillText('★', W - 14 - (4 - i) * 24, 34);
  }
  if (bust > 0) {
    // Bust arrives on two scales: police.js fills 0..1, main's fallback 0..100.
    const bustFrac = bust > 1 ? bust / 100 : bust;
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = '#ff8896';
    ctx.fillText('BUSTED', mapX, 52);
    bar(ctx, mapX + 46, 44, mapSize - 46, 9, bustFrac, '#ff4455', 'rgba(255,255,255,0.14)');
  }
  drawMinimap(ctx, state, mapX, 62, mapSize);

  // ---------- bottom-left: health, armour, weapon ----------
  const bx = 14, bw = 210;
  let by = H - 74;
  ctx.fillStyle = 'rgba(7,10,18,0.55)';
  ctx.fillRect(bx - 4, by - 8, bw + 8, 68);
  ctx.textAlign = 'left';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillStyle = '#ffb3ba';
  ctx.fillText('HEALTH', bx, by + 2);
  bar(ctx, bx + 52, by - 6, bw - 52, 10, (p.hp || 0) / 100, p.hp > 30 ? '#37e08b' : '#ff4455', 'rgba(255,255,255,0.14)');
  by += 20;
  ctx.fillStyle = '#a9d4ff';
  ctx.fillText('ARMOR', bx, by + 2);
  bar(ctx, bx + 52, by - 6, bw - 52, 10, (p.armor || 0) / 100, '#57b6ff', 'rgba(255,255,255,0.14)');
  by += 22;
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillStyle = '#f2f5ff';
  ctx.fillText(weaponLabel(state), bx, by + 4);
  if (p.inCar) {
    ctx.fillStyle = '#ffd23e';
    ctx.textAlign = 'right';
    ctx.fillText('IN VEHICLE', bx + bw, by + 4);
    ctx.textAlign = 'left';
  }

  // ---------- bottom-center: objective + distance ----------
  const obj = state.missionState && state.missionState.objective;
  if (obj && obj.text) {
    const dist = Math.round(Math.hypot(p.x - obj.x, p.y - obj.y));
    const label = obj.text + '  —  ' + dist + 'm';
    ctx.font = '600 15px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 32;
    const ox = (W - tw) / 2, oy = H - 108;
    ctx.fillStyle = 'rgba(7,10,18,0.68)';
    ctx.fillRect(ox, oy, tw, 30);
    ctx.strokeStyle = 'rgba(255,210,62,0.55)'; ctx.strokeRect(ox + 0.5, oy + 0.5, tw - 1, 29);
    ctx.fillStyle = '#ffd23e';
    ctx.textAlign = 'center';
    ctx.fillText(label, W / 2, oy + 20);
    // off-screen direction arrow
    if (state.camera) {
      const sx = obj.x - state.camera.x, sy = obj.y - state.camera.y;
      if (sx < 0 || sx > W || sy < 0 || sy > H) {
        const cx = Math.max(26, Math.min(W - 26, sx)), cy = Math.max(90, Math.min(H - 130, sy));
        const a = Math.atan2(obj.y - p.y, obj.x - p.x);
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = '#ffd23e';
        ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---------- message / dialogue box ----------
  // Dialogue arrives in two shapes: missions.js queues objects
  // {speaker, text, timer} (its own ticker counts `timer` down), while
  // shots/main use a plain "SPEAKER: text" string counted by dialogueT.
  // Messages likewise count down on messageT (main) or messageTimer
  // (missions). Normalise all of them here.
  const dlg = state.dialogue;
  let speaker = '', body = null, showBox = false;
  if (dlg && typeof dlg === 'object' && typeof dlg.text === 'string') {
    speaker = String(dlg.speaker || '').toUpperCase();
    body = dlg.text;
    showBox = body.length > 0 && (typeof dlg.timer !== 'number' || dlg.timer > 0 || (state.dialogueT || 0) > 0);
  } else if (typeof dlg === 'string' && dlg) {
    body = dlg;
    showBox = (state.dialogueT || 0) > 0;
    const colon = body.indexOf(':');
    if (colon > 0 && colon < 14) { speaker = body.slice(0, colon).trim().toUpperCase(); body = body.slice(colon + 1).trim(); }
  }
  if (!showBox && state.message) {
    speaker = '';
    body = String(state.message);
    showBox = (state.messageT || 0) > 0 || (state.messageTimer || 0) > 0;
  }
  if (showBox && body) {
    const isDispatch = speaker === 'DISPATCH';
    const accent = speaker === 'MARA' ? '#ff2d78' : isDispatch ? '#37e6e0' : '#ffd23e';
    ctx.font = '15px system-ui, sans-serif';
    const lines = wrapText(ctx, body, Math.min(560, W - 120));
    const boxW = Math.min(620, W - 60);
    const boxH = 34 + lines.length * 20 + (speaker ? 18 : 0);
    const boxX = (W - boxW) / 2, boxY = H - 108 - boxH - 10;
    ctx.fillStyle = 'rgba(7,10,18,0.82)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = accent;
    ctx.fillRect(boxX, boxY, 4, boxH);
    let ty = boxY + 24;
    ctx.textAlign = 'left';
    if (speaker) {
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(speaker, boxX + 16, ty);
      ty += 18;
    }
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillStyle = '#eef3ff';
    for (const line of lines) { ctx.fillText(line, boxX + 16, ty); ty += 20; }
  }

  // ---------- mission title card ----------
  const ms = state.missionState;
  if (ms && ms.cardT > 0 && ms.cardTitle) {
    // Cards are set with cardT = 3.5 (main) or 3.2 (fallback): fade in over
    // the first half-second, out over the last 0.7 s.
    const fadeIn = ms.cardT > 3.0 ? Math.max(0, (3.5 - ms.cardT) / 0.5) : 1;
    const alpha = Math.max(0, Math.min(1, fadeIn, ms.cardT / 0.7));
    ctx.globalAlpha = alpha;
    const cy = H * 0.30;
    ctx.fillStyle = 'rgba(7,10,18,0.72)';
    ctx.fillRect(W / 2 - 280, cy - 44, 560, 92);
    ctx.fillStyle = '#ff2d78';
    ctx.fillRect(W / 2 - 280, cy - 44, 560, 3);
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = '#37e6e0';
    ctx.fillText(ms.cardKicker || 'NEW JOB', W / 2, cy - 16);
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(ms.cardTitle, W / 2, cy + 20);
    ctx.globalAlpha = 1;
  }

  // ---------- controls hint, first 20 s of play ----------
  const elapsed = typeof state.playElapsed === 'number' ? state.playElapsed : t;
  if (state.screen === 'play' && elapsed < 20) {
    ctx.globalAlpha = elapsed > 17 ? Math.max(0, (20 - elapsed) / 3) : 1;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(230,238,255,0.85)';
    ctx.fillText('WASD move · E car · Mouse aim · Click fire · Esc pause · K save', W - 14, H - 16);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}
