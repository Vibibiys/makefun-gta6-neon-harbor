// Neon Harbor renderer: draws the whole top-down city and every entity onto the
// canvas in world space. Plain canvas calls only — no images, no libraries.
// The camera follows Mara (or her car), clamped to the world, and anything
// outside the current view is culled before it is drawn.
import * as ConfigModule from './config.js';

const CFG = ConfigModule || {};
export const WORLD_W = CFG.WORLD_W ?? 3840;
export const WORLD_H = CFG.WORLD_H ?? 2880;
const WATER_Y = CFG.WATER_Y ?? 2520;
const ROAD_W = CFG.ROAD_W ?? CFG.ROAD_WIDTH ?? 120;
const COLORS = CFG.COLORS || {};

function roadCentersX(world) {
  if (world && Array.isArray(world.roadCentersX) && world.roadCentersX.length) return world.roadCentersX;
  if (Array.isArray(CFG.ROAD_CENTERS_X)) return CFG.ROAD_CENTERS_X;
  const out = [];
  for (let x = 240; x <= 3600; x += 480) out.push(x);
  return out;
}
function roadCentersY(world) {
  if (world && Array.isArray(world.roadCentersY) && world.roadCentersY.length) return world.roadCentersY;
  if (Array.isArray(CFG.ROAD_CENTERS_Y)) return CFG.ROAD_CENTERS_Y;
  const out = [];
  for (let y = 240; y <= 2640; y += 480) out.push(y);
  return out;
}

// Day cycle: state.time seconds over a 240 s loop -> 0 dawn, .25 day, .55 dusk, .8 night.
export function dayPhase(state) {
  const t = ((state.time || 0) % 240 + 240) % 240;
  return t / 240;
}
export function isNight(state) {
  const p = dayPhase(state);
  return p > 0.72 || p < 0.06;
}
export function isDusk(state) {
  const p = dayPhase(state);
  return (p >= 0.5 && p <= 0.72) || (p >= 0.0 && p < 0.14);
}

function focusOf(state) {
  const p = state.player;
  if (p.inCar) return p.inCar;
  return p;
}

export function getCamera(state, W, H) {
  const f = focusOf(state);
  let cx = f.x - W / 2;
  let cy = f.y - H / 2;
  cx = Math.max(0, Math.min(WORLD_W - W, cx));
  cy = Math.max(0, Math.min(WORLD_H - H, cy));
  if (W >= WORLD_W) cx = (WORLD_W - W) / 2;
  if (H >= WORLD_H) cy = (WORLD_H - H) / 2;
  return { x: cx, y: cy };
}

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function inView(x, y, m, view) {
  return x > view.x - m && x < view.x + view.w + m && y > view.y - m && y < view.y + view.h + m;
}

function drawCar(ctx, state, car, view, t) {
  if (!inView(car.x, car.y, 90, view)) return;
  if (car.dead && car.hp !== undefined && car.hp <= -999) return;
  const w = car.w || 52, h = car.h || 26;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle || 0);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  rr(ctx, -w / 2 + 3, -h / 2 + 4, w, h, 7); ctx.fill();
  const body = car.kind === 'police' ? '#eef2f7' : (car.color || '#888');
  ctx.fillStyle = body;
  rr(ctx, -w / 2, -h / 2, w, h, 7); ctx.fill();
  if (car.kind === 'police') {
    ctx.fillStyle = '#1d4ed8';
    rr(ctx, -w * 0.18, -h / 2, w * 0.36, h, 3); ctx.fill();
    // light bar flashing red / blue
    const flash = Math.floor(t * 6) % 2 === 0;
    ctx.fillStyle = flash ? '#ff3355' : '#274bff';
    ctx.fillRect(-7, -h / 2 + 3, 6, h - 6);
    ctx.fillStyle = flash ? '#274bff' : '#ff3355';
    ctx.fillRect(1, -h / 2 + 3, 6, h - 6);
  }
  if (car.kind === 'taxi') {
    ctx.fillStyle = '#ffd23e';
    rr(ctx, -w / 2, -h / 2, w, h, 7); ctx.fill();
    ctx.fillStyle = '#141414';
    ctx.font = 'bold 7px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', 0, 0);
  }
  // cabin / windshield
  ctx.fillStyle = 'rgba(16,24,38,0.88)';
  rr(ctx, -w * 0.16, -h * 0.36, w * 0.30, h * 0.72, 4); ctx.fill();
  ctx.fillStyle = 'rgba(140,220,255,0.55)';
  ctx.fillRect(w * 0.10, -h * 0.32, 3, h * 0.64);
  // headlights at dusk / night
  if (isNight(state) || isDusk(state)) {
    ctx.fillStyle = 'rgba(255,244,180,0.20)';
    ctx.beginPath();
    ctx.moveTo(w / 2, -6); ctx.lineTo(w / 2 + 46, -16); ctx.lineTo(w / 2 + 46, 16); ctx.lineTo(w / 2, 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.fillRect(w / 2 - 2, -8, 3, 5); ctx.fillRect(w / 2 - 2, 3, 3, 5);
  }
  // damage smoke tint
  if (typeof car.hp === 'number' && car.hp < 35) {
    ctx.fillStyle = 'rgba(30,30,30,0.35)';
    rr(ctx, w * 0.18, -h * 0.3, w * 0.28, h * 0.6, 4); ctx.fill();
  }
  ctx.restore();
}

function drawPed(ctx, ped, view, isOfficer) {
  if (!inView(ped.x, ped.y, 30, view)) return;
  const body = isOfficer ? '#2b5cff' : (ped.kind === 'gang' ? '#c81e3a' : (ped.color || '#b08968'));
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(ped.x + 2, ped.y + 3, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(ped.x, ped.y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2c9a0';
  ctx.beginPath(); ctx.arc(ped.x, ped.y, 4.2, 0, Math.PI * 2); ctx.fill();
  // facing tick
  const a = ped.angle || 0;
  ctx.strokeStyle = body; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ped.x, ped.y);
  ctx.lineTo(ped.x + Math.cos(a) * 11, ped.y + Math.sin(a) * 11); ctx.stroke();
  if (typeof ped.hp === 'number' && ped.hp < 40 && ped.hp > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(ped.x - 10, ped.y - 16, 20, 3);
    ctx.fillStyle = '#ff5566'; ctx.fillRect(ped.x - 10, ped.y - 16, 20 * Math.max(0, ped.hp) / 100, 3);
  }
}

export function drawScene(ctx, state, W, H) {
  const world = state.world || {};
  const t = state.time || 0;
  const cam = getCamera(state, W, H);
  state.camera = cam;
  const view = { x: cam.x, y: cam.y, w: W, h: H };
  const xs = roadCentersX(world), ys = roadCentersY(world);

  ctx.save();
  ctx.fillStyle = COLORS.ground || '#232733';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(-cam.x, -cam.y);

  // ---- parks (under roads) ----
  const parks = world.parks || [];
  ctx.fillStyle = COLORS.park || '#1e4d33';
  for (const pk of parks) {
    if (!inView(pk.x + (pk.w || 0) / 2, pk.y + (pk.h || 0) / 2, Math.max(pk.w || 0, pk.h || 0), view)) continue;
    ctx.fillRect(pk.x, pk.y, pk.w, pk.h);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(pk.x + 8, pk.y + 8, Math.max(0, pk.w - 16), 6);
    ctx.fillStyle = COLORS.park || '#1e4d33';
  }

  // ---- city blocks base ----
  ctx.fillStyle = COLORS.block || '#2b2f3d';
  ctx.fillRect(Math.max(0, view.x), Math.max(0, view.y), Math.min(WORLD_W, view.w + 2), Math.min(WATER_Y, view.h + 2) > 0 ? view.h + 2 : 0);
  // simpler: fill visible land area
  ctx.fillRect(view.x, view.y, view.w, Math.max(0, WATER_Y - view.y));

  // ---- sidewalks (light apron around roads) ----
  ctx.fillStyle = COLORS.sidewalk || '#3a3f52';
  for (const x of xs) ctx.fillRect(x - ROAD_W / 2 - 10, view.y, ROAD_W + 20, Math.max(0, WATER_Y - view.y));
  for (const y of ys) { if (y < WATER_Y) ctx.fillRect(view.x, y - ROAD_W / 2 - 10, view.w, ROAD_W + 20); }

  // ---- roads ----
  ctx.fillStyle = COLORS.road || '#171a24';
  for (const x of xs) ctx.fillRect(x - ROAD_W / 2, view.y, ROAD_W, Math.max(0, WATER_Y - view.y));
  for (const y of ys) { if (y < WATER_Y) ctx.fillRect(view.x, y - ROAD_W / 2, view.w, ROAD_W); }
  // lane dashes
  ctx.fillStyle = 'rgba(255,209,62,0.75)';
  for (const x of xs) {
    for (let y = Math.floor(view.y / 36) * 36; y < Math.min(WATER_Y, view.y + view.h); y += 36) {
      if (ys.some((cy) => Math.abs(y - cy) < ROAD_W / 2 + 8)) continue;
      ctx.fillRect(x - 2, y, 4, 18);
    }
  }
  for (const y of ys) {
    if (y >= WATER_Y) continue;
    for (let x = Math.floor(view.x / 36) * 36; x < view.x + view.w; x += 36) {
      if (xs.some((cx) => Math.abs(x - cx) < ROAD_W / 2 + 8)) continue;
      ctx.fillRect(x, y - 2, 18, 4);
    }
  }
  // crosswalks at intersections
  ctx.fillStyle = 'rgba(240,244,255,0.55)';
  for (const x of xs) for (const y of ys) {
    if (y >= WATER_Y || !inView(x, y, 110, view)) continue;
    for (let i = -2; i <= 2; i++) {
      ctx.fillRect(x - ROAD_W / 2 - 16, y + i * 11 - 3, 12, 6);
      ctx.fillRect(x + ROAD_W / 2 + 4, y + i * 11 - 3, 12, 6);
      ctx.fillRect(x + i * 11 - 3, y - ROAD_W / 2 - 16, 6, 12);
      ctx.fillRect(x + i * 11 - 3, y + ROAD_W / 2 + 4, 6, 12);
    }
  }

  // ---- boardwalk / beach ----
  ctx.fillStyle = COLORS.sand || '#8a6f4d';
  ctx.fillRect(view.x, WATER_Y - 70, view.w, 70);
  ctx.fillStyle = 'rgba(60,42,20,0.5)';
  for (let x = Math.floor(view.x / 28) * 28; x < view.x + view.w; x += 28) ctx.fillRect(x, WATER_Y - 70, 3, 70);
  ctx.fillStyle = COLORS.beach || '#c2a878';
  ctx.fillRect(view.x, WATER_Y - 14, view.w, 14);

  // ---- water (animated waves) ----
  const wy = Math.max(WATER_Y, view.y);
  ctx.fillStyle = COLORS.water || '#0b3556';
  ctx.fillRect(view.x, wy, view.w, view.y + view.h - wy);
  ctx.strokeStyle = 'rgba(120,220,255,0.35)'; ctx.lineWidth = 2;
  for (let row = 0; row < 9; row++) {
    const yy = WATER_Y + 22 + row * 38;
    if (yy < view.y - 10 || yy > view.y + view.h + 10) continue;
    ctx.beginPath();
    for (let x = view.x; x <= view.x + view.w; x += 24) {
      const yy2 = yy + Math.sin(x * 0.02 + t * 1.6 + row * 1.3) * 4;
      if (x === view.x) ctx.moveTo(x, yy2); else ctx.lineTo(x, yy2);
    }
    ctx.stroke();
  }

  // ---- props: palms + lamps ----
  // world.props is a flat list of { x, y, kind } in the shipped world; older
  // shapes (world.palms / world.lamps arrays) are honoured too.
  const propList = Array.isArray(world.props) ? world.props : [];
  const palms = world.palms || propList.filter((pr) => pr.kind === 'palm');
  const lamps = world.lamps || propList.filter((pr) => pr.kind === 'lamp');
  ctx.lineWidth = 2;
  for (const p of palms) {
    const px = p.x ?? p[0], py = p.y ?? p[1];
    if (!inView(px, py, 30, view)) continue;
    ctx.strokeStyle = '#2f9e5f';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      ctx.beginPath(); ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9 - 3, px + Math.cos(a) * 15, py + Math.sin(a) * 15 + 3);
      ctx.stroke();
    }
    ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
  }
  const night = isNight(state);
  for (const l of lamps) {
    const lx = l.x ?? l[0], ly = l.y ?? l[1];
    if (!inView(lx, ly, 60, view)) continue;
    if (night) {
      const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 52);
      g.addColorStop(0, 'rgba(255,214,120,0.30)'); g.addColorStop(1, 'rgba(255,214,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, ly, 52, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#ffd678'; ctx.beginPath(); ctx.arc(lx, ly, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#59617a'; ctx.fillRect(lx - 1, ly, 2, 7);
  }

  // ---- buildings ----
  const buildings = world.buildings || [];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const b of buildings) {
    const bw = b.w || 120, bh = b.h || 120;
    if (!inView(b.x + bw / 2, b.y + bh / 2, Math.max(bw, bh), view)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(b.x + 7, b.y + 9, bw, bh);
    ctx.fillStyle = b.color || COLORS.building || '#39415e';
    ctx.fillRect(b.x, b.y, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(b.x, b.y, bw, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(b.x, b.y + bh - 12, bw, 12);
    // roof details + lit windows at night
    ctx.fillStyle = night ? 'rgba(255,214,120,0.75)' : 'rgba(160,220,255,0.30)';
    const cols = Math.max(1, Math.floor(bw / 26)), rows = Math.max(1, Math.floor(bh / 26));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (((i * 7 + j * 13 + (b.x | 0)) % 5) === 0) ctx.fillRect(b.x + 10 + i * 26, b.y + 12 + j * 26, 9, 7);
    }
    if (b.name) {
      const f = focusOf(state);
      const d = Math.hypot(f.x - (b.x + bw / 2), f.y - (b.y + bh / 2));
      if (d < 460) {
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(5,8,16,0.65)';
        const tw = ctx.measureText(b.name).width + 14;
        ctx.fillRect(b.x + bw / 2 - tw / 2, b.y + bh / 2 - 11, tw, 22);
        ctx.fillStyle = '#eaf6ff';
        ctx.fillText(b.name, b.x + bw / 2, b.y + bh / 2 + 1);
      }
    }
  }

  // ---- pickups (glow) ----
  for (const pk of state.pickups || []) {
    if (pk.taken || pk.active === false) continue;
    if (!inView(pk.x, pk.y, 40, view)) continue;
    const pulse = 1 + Math.sin(t * 5 + pk.x) * 0.18;
    const col = pk.type === 'health' ? '#37e08b' : pk.type === 'armor' ? '#57b6ff'
      : pk.type === 'ammo' ? '#ffb84d' : pk.type === 'weapon' ? '#ff5d7a' : '#ffd23e';
    ctx.fillStyle = col + '44';
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 17 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 6.5 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b0e18';
    ctx.font = 'bold 8px system-ui, sans-serif';
    const glyph = pk.type === 'health' ? '+' : pk.type === 'armor' ? 'A' : pk.type === 'ammo' ? '•' : pk.type === 'weapon' ? 'W' : '$';
    ctx.fillText(glyph, pk.x, pk.y + 0.5);
  }

  // ---- mission objective marker ----
  const obj = state.missionState && state.missionState.objective;
  if (obj && typeof obj.x === 'number') {
    const pulse = 1 + Math.sin(t * 4.5) * 0.22;
    ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(obj.x, obj.y, 26 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,210,62,0.45)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(obj.x, obj.y, 40 * pulse, 0, Math.PI * 2); ctx.stroke();
    const grad = ctx.createLinearGradient(obj.x, obj.y - 190, obj.x, obj.y);
    grad.addColorStop(0, 'rgba(255,210,62,0)'); grad.addColorStop(1, 'rgba(255,210,62,0.30)');
    ctx.fillStyle = grad; ctx.fillRect(obj.x - 7, obj.y - 190, 14, 190);
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.arc(obj.x, obj.y, 5, 0, Math.PI * 2); ctx.fill();
  }

  // ---- peds, officers, cars ----
  for (const ped of state.peds || []) { if (ped.hp === undefined || ped.hp > 0) drawPed(ctx, ped, view, false); }
  for (const off of state.officers || []) { if (off.hp === undefined || off.hp > 0) drawPed(ctx, off, view, true); }
  for (const car of state.cars || []) drawCar(ctx, state, car, view, t);
  for (const car of state.copCars || []) drawCar(ctx, state, { ...car, kind: 'police' }, view, t);

  // ---- player on foot ----
  const p = state.player;
  if (!p.inCar) {
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 4, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff2d78'; // Mara's jacket
    ctx.beginPath(); ctx.arc(p.x, p.y, 9.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffe9f3'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(p.angle || 0) * 14, p.y + Math.sin(p.angle || 0) * 14); ctx.stroke();
    if (p.weapon && p.weapon !== 'fists') {
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(p.angle || 0) * 17, p.y + Math.sin(p.angle || 0) * 17); ctx.stroke();
    }
  }

  // ---- bullets (tracers) ----
  ctx.lineWidth = 2;
  for (const b of state.bullets || []) {
    const vx = b.vx || Math.cos(b.angle || 0) * 900, vy = b.vy || Math.sin(b.angle || 0) * 900;
    ctx.strokeStyle = b.from === 'cop' || b.enemy ? 'rgba(255,120,120,0.9)' : 'rgba(255,236,160,0.95)';
    ctx.beginPath(); ctx.moveTo(b.x - vx * 0.016, b.y - vy * 0.016); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // ---- particles ----
  for (const pt of state.particles || []) {
    const life = pt.max ? Math.max(0, pt.life / pt.max) : 1;
    ctx.globalAlpha = Math.min(1, life);
    ctx.fillStyle = pt.color || '#ffd23e';
    ctx.beginPath(); ctx.arc(pt.x, pt.y, (pt.size || 3) * (0.5 + life * 0.5), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // ---- day-cycle sky tint (screen space) ----
  const ph = dayPhase(state);
  let tint = null, alpha = 0;
  if (ph < 0.10) { tint = '255,150,90'; alpha = 0.13 * (1 - ph / 0.10) + 0.03; }        // dawn
  else if (ph < 0.48) { tint = '120,200,255'; alpha = 0.04; }                              // day
  else if (ph < 0.66) { tint = '255,110,70'; alpha = 0.16; }                               // dusk
  else { tint = '8,12,48'; alpha = 0.34; }                                                 // night
  ctx.fillStyle = `rgba(${tint},${alpha.toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);

  // ---- damage flash ----
  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,40,60,${(Math.min(1, state.flash) * 0.28).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }
}
