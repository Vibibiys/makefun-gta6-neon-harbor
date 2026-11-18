// Minimap: a north-up, rounded-square overview of Neon Harbor drawn from the
// same world data as the main view. Roads become light lines on a dark panel,
// the harbour is a blue block to the south, and live blips show Mara, the
// objective, police, mission pickups and active gang members.
import * as ConfigModule from './config.js';

const CFG = ConfigModule || {};
const WORLD_W = CFG.WORLD_W ?? 3840;
const WORLD_H = CFG.WORLD_H ?? 2880;
const WATER_Y = CFG.WATER_Y ?? 2520;

function roadCentersX(world) {
  if (world && Array.isArray(world.roadCentersX) && world.roadCentersX.length) return world.roadCentersX;
  const out = [];
  for (let x = 240; x <= 3600; x += 480) out.push(x);
  return out;
}
function roadCentersY(world) {
  if (world && Array.isArray(world.roadCentersY) && world.roadCentersY.length) return world.roadCentersY;
  const out = [];
  for (let y = 240; y <= 2640; y += 480) out.push(y);
  return out;
}

export function drawMinimap(ctx, state, x, y, size) {
  const world = state.world || {};
  const t = state.time || 0;
  const sx = size / WORLD_W, sy = size / WORLD_H;
  const mx = (wx) => x + wx * sx;
  const my = (wy) => y + wy * sy;

  ctx.save();
  // rounded panel with clip
  const r = 12;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + size, y, x + size, y + size, r);
  ctx.arcTo(x + size, y + size, x, y + size, r);
  ctx.arcTo(x, y + size, x, y, r);
  ctx.arcTo(x, y, x + size, y, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,14,24,0.86)';
  ctx.fill();
  ctx.clip();

  // land + water
  ctx.fillStyle = '#232839';
  ctx.fillRect(x, y, size, WATER_Y * sy);
  ctx.fillStyle = '#0e4a73';
  ctx.fillRect(x, y + WATER_Y * sy, size, size - WATER_Y * sy);

  // building dots, faint
  ctx.fillStyle = 'rgba(200,215,255,0.20)';
  for (const b of world.buildings || []) {
    ctx.fillRect(mx(b.x), my(b.y), Math.max(2, (b.w || 100) * sx), Math.max(2, (b.h || 100) * sy));
  }

  // simplified roads
  ctx.strokeStyle = 'rgba(190,200,225,0.55)';
  ctx.lineWidth = Math.max(1.5, 120 * sx * 0.55);
  for (const cx of roadCentersX(world)) {
    ctx.beginPath(); ctx.moveTo(mx(cx), y); ctx.lineTo(mx(cx), y + WATER_Y * sy); ctx.stroke();
  }
  for (const cy of roadCentersY(world)) {
    if (cy >= WATER_Y) continue;
    ctx.beginPath(); ctx.moveTo(x, my(cy)); ctx.lineTo(x + size, my(cy)); ctx.stroke();
  }

  // mission pickups (cyan)
  ctx.fillStyle = '#37e6e0';
  for (const pk of state.pickups || []) {
    if (pk.taken || pk.active === false) continue;
    ctx.beginPath(); ctx.arc(mx(pk.x), my(pk.y), 2.4, 0, Math.PI * 2); ctx.fill();
  }

  // gang blips (red) while a mission is active
  const missionActive = !!(state.missionState && state.missionState.objective);
  if (missionActive) {
    ctx.fillStyle = '#ff4455';
    for (const ped of state.peds || []) {
      if (ped.kind !== 'gang' || (ped.hp !== undefined && ped.hp <= 0)) continue;
      ctx.beginPath(); ctx.arc(mx(ped.x), my(ped.y), 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // police blips, flashing blue/red while wanted
  const stars = state.wanted ? state.wanted.stars : 0;
  const flash = Math.floor(t * 4) % 2 === 0;
  for (const car of state.copCars || []) {
    ctx.fillStyle = stars > 0 ? (flash ? '#ff4455' : '#3f7bff') : '#3f7bff';
    ctx.beginPath(); ctx.arc(mx(car.x), my(car.y), 3, 0, Math.PI * 2); ctx.fill();
  }
  for (const off of state.officers || []) {
    ctx.fillStyle = stars > 0 ? (flash ? '#3f7bff' : '#ff4455') : '#7ea6ff';
    ctx.beginPath(); ctx.arc(mx(off.x), my(off.y), 2.4, 0, Math.PI * 2); ctx.fill();
  }

  // objective (gold, pulsing)
  const obj = state.missionState && state.missionState.objective;
  if (obj && typeof obj.x === 'number') {
    const pr = 4.5 + Math.sin(t * 5) * 1.4;
    ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx(obj.x), my(obj.y), pr + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath(); ctx.arc(mx(obj.x), my(obj.y), 3.2, 0, Math.PI * 2); ctx.fill();
  }

  // player (white arrow)
  const p = state.player;
  const px = mx(p.x), py = my(p.y);
  const ang = p.inCar ? (p.inCar.angle || 0) : (p.angle || 0);
  ctx.save();
  ctx.translate(px, py); ctx.rotate(ang);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(6, 0); ctx.lineTo(-4.5, -4); ctx.lineTo(-4.5, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,45,120,0.9)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();

  ctx.restore();

  // border + north label (outside the clip)
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + size, y, x + size, y + size, r);
  ctx.arcTo(x + size, y + size, x, y + size, r);
  ctx.arcTo(x, y + size, x, y, r);
  ctx.arcTo(x, y, x + size, y, r);
  ctx.closePath(); ctx.stroke();
  ctx.fillStyle = 'rgba(235,242,255,0.85)';
  ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('N', x + size - 12, y + 5);
}
