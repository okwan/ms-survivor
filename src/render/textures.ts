import { Texture } from 'pixi.js';
import { BOSSES, LADDER, PASSIVES, SKILLS } from '../game/data.ts';
import { EVOLVED_SKILLS } from '../game/evolutions.ts';

/** Textures are drawn at RES x and displayed at 1/RES. */
export const RES = 2;

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const tex = (c: HTMLCanvasElement) => Texture.from(c);

export type Shape = 'snail' | 'mushroom' | 'stump' | 'slime' | 'pig' | 'eye' | 'boar' | 'golem' | 'drake' | 'other';
/** Placeholder shape chosen by mob name keyword. */
export function shapeFor(name: string): Shape {
  const n = name.toLowerCase();
  if (n.includes('snail') || n.includes('mano')) return 'snail';
  if (n.includes('mushroom') || n.includes('shroom') || n.includes('mushmom')) return 'mushroom';
  if (n.includes('stump')) return 'stump';
  if (n.includes('slime')) return 'slime';
  if (n.includes('pig')) return 'pig';
  if (n.includes('eye')) return 'eye';
  if (n.includes('boar')) return 'boar';
  if (n.includes('golem') || n.includes('zakum')) return 'golem';
  if (n.includes('drake') || n.includes('balrog')) return 'drake';
  return 'other';
}

interface Col { h: number; s: number; l: number }
function colorFor(name: string, shape: Shape, tier: number): Col {
  const n = name.toLowerCase();
  const base: Record<Shape, Col> = {
    snail: { h: 48, s: 70, l: 55 }, mushroom: { h: 18, s: 80, l: 52 }, stump: { h: 28, s: 45, l: 36 }, slime: { h: 150, s: 65, l: 52 },
    pig: { h: 340, s: 70, l: 70 }, eye: { h: 275, s: 45, l: 58 }, boar: { h: 25, s: 50, l: 38 }, golem: { h: 35, s: 12, l: 48 },
    drake: { h: 130, s: 50, l: 42 }, other: { h: (tier * 47) % 360, s: 55, l: 52 },
  };
  const c = { ...base[shape] };
  if (n.includes('blue')) { c.h = 208; c.s = 75; }
  else if (n.includes('red')) { c.h = 2; c.s = 75; }
  else if (n.includes('green')) { c.h = 122; c.s = 60; }
  else if (n.includes('orange')) { c.h = 28; c.s = 90; }
  else if (n.includes('fire')) { c.h = 10; c.s = 85; }
  else if (n.includes('zombie')) { c.h = 95; c.s = 28; }
  else if (n.includes('curse')) { c.h = 285; c.s = 55; }
  else if (n.includes('copper')) { c.h = 22; c.s = 65; }
  else if (n.includes('horny')) { c.h = 310; c.s = 50; }
  else if (n.includes('balrog')) { c.h = 355; c.s = 75; }
  else if (n.includes('king')) { c.h = 200; c.s = 70; }
  else if (n.includes('wraith')) { c.h = 230; c.s = 25; c.l = 70; }
  if (n.includes('dark')) { c.l *= 0.65; c.s *= 0.8; }
  return c;
}

function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number, r: number) {
  for (const dx of [-gap, gap]) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + dx, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(x + dx + r * 0.3, y + r * 0.1, r * 0.55, 0, 7); ctx.fill();
  }
}

/** Draw one mob frame into a size x size canvas (units are canvas pixels). Mobs face right. */
function drawMob(ctx: CanvasRenderingContext2D, S: number, shape: Shape, c: Col, frame: number, name: string, boss: boolean) {
  const main = hsl(c.h, c.s, c.l), dark = hsl(c.h, c.s, c.l * 0.5), light = hsl(c.h, c.s, Math.min(90, c.l + 22));
  const bob = frame ? -S * 0.025 : 0;
  const sq = frame ? 0.96 : 1.0;
  ctx.lineWidth = S * 0.035;
  ctx.strokeStyle = dark;
  ctx.lineJoin = 'round';
  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(S / 2, S * 0.88, S * 0.34, S * 0.08, 0, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(S / 2, S * 0.86);
  ctx.scale(1 / sq, sq);
  ctx.translate(-S / 2, -S * 0.86 + bob);
  const fill = (col: string) => { ctx.fillStyle = col; ctx.fill(); ctx.stroke(); };
  switch (shape) {
    case 'snail': {
      ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.76, S * 0.4, S * 0.12, 0, 0, 7); fill(hsl(c.h + 20, c.s - 10, 68));
      // eye stalks
      ctx.beginPath(); ctx.moveTo(S * 0.8, S * 0.72); ctx.lineTo(S * 0.86, S * 0.52); ctx.moveTo(S * 0.7, S * 0.72); ctx.lineTo(S * 0.72, S * 0.52); ctx.stroke();
      eyes(ctx, S * 0.79, S * 0.5, S * 0.07, S * 0.05);
      ctx.beginPath(); ctx.arc(S * 0.38, S * 0.52, S * 0.27, 0, 7); fill(main);
      ctx.beginPath(); ctx.arc(S * 0.38, S * 0.52, S * 0.17, 0, 5.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(S * 0.4, S * 0.52, S * 0.08, 0, 4.5); ctx.stroke();
      break;
    }
    case 'mushroom': {
      ctx.beginPath(); ctx.roundRect(S * 0.32, S * 0.5, S * 0.36, S * 0.34, S * 0.1); fill('#f4e4c1');
      eyes(ctx, S * 0.52, S * 0.64, S * 0.07, S * 0.045);
      ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.5, S * 0.44, S * 0.34, 0, Math.PI, 0); ctx.closePath(); fill(main);
      ctx.fillStyle = light;
      for (const [x, y, r] of [[0.3, 0.38, 0.05], [0.55, 0.28, 0.06], [0.72, 0.42, 0.045]]) { ctx.beginPath(); ctx.arc(S * x, S * y, S * r, 0, 7); ctx.fill(); }
      break;
    }
    case 'stump': {
      ctx.beginPath(); ctx.roundRect(S * 0.24, S * 0.28, S * 0.52, S * 0.58, S * 0.08); fill(main);
      ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.29, S * 0.26, S * 0.07, 0, 0, 7); fill(light);
      ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.29, S * 0.12, S * 0.03, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.24, S * 0.5); ctx.lineTo(S * 0.1, S * 0.4); ctx.moveTo(S * 0.76, S * 0.5); ctx.lineTo(S * 0.9, S * 0.4); ctx.stroke();
      eyes(ctx, S * 0.52, S * 0.55, S * 0.09, S * 0.055);
      ctx.beginPath(); ctx.arc(S * 0.54, S * 0.7, S * 0.05, 0, Math.PI); ctx.stroke();
      break;
    }
    case 'slime': {
      ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.18);
      ctx.bezierCurveTo(S * 0.62, S * 0.4, S * 0.9, S * 0.55, S * 0.86, S * 0.76);
      ctx.quadraticCurveTo(S * 0.8, S * 0.86, S * 0.5, S * 0.86);
      ctx.quadraticCurveTo(S * 0.2, S * 0.86, S * 0.14, S * 0.76);
      ctx.bezierCurveTo(S * 0.1, S * 0.55, S * 0.38, S * 0.4, S * 0.5, S * 0.18);
      ctx.closePath(); ctx.globalAlpha = 0.92; fill(main); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(S * 0.38, S * 0.45, S * 0.06, S * 0.1, 0.5, 0, 7); ctx.fill();
      eyes(ctx, S * 0.52, S * 0.64, S * 0.1, S * 0.06);
      break;
    }
    case 'pig': {
      ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.6, S * 0.38, S * 0.26, 0, 0, 7); fill(main);
      ctx.beginPath(); ctx.moveTo(S * 0.58, S * 0.38); ctx.lineTo(S * 0.62, S * 0.22); ctx.lineTo(S * 0.72, S * 0.4); ctx.closePath(); fill(dark);
      ctx.beginPath(); ctx.ellipse(S * 0.84, S * 0.62, S * 0.1, S * 0.09, 0, 0, 7); fill(light);
      ctx.fillStyle = dark; ctx.fillRect(S * 0.82, S * 0.6, S * 0.02, S * 0.04); ctx.fillRect(S * 0.87, S * 0.6, S * 0.02, S * 0.04);
      eyes(ctx, S * 0.68, S * 0.52, S * 0.0001, S * 0.055);
      ctx.fillStyle = main; ctx.fillRect(S * 0.3, S * 0.8, S * 0.08, S * 0.07); ctx.fillRect(S * 0.6, S * 0.8, S * 0.08, S * 0.07);
      if (name.toLowerCase().includes('ribbon')) {
        ctx.fillStyle = '#ff3b6b';
        ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.36); ctx.lineTo(S * 0.38, S * 0.28); ctx.lineTo(S * 0.38, S * 0.44); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.36); ctx.lineTo(S * 0.62, S * 0.28); ctx.lineTo(S * 0.62, S * 0.44); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'eye': {
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.moveTo(S * 0.18, S * 0.5); ctx.lineTo(S * 0.02, S * 0.34); ctx.lineTo(S * 0.2, S * 0.62); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(S * 0.82, S * 0.5); ctx.lineTo(S * 0.98, S * 0.34); ctx.lineTo(S * 0.8, S * 0.62); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(S * 0.5, S * 0.52, S * 0.3, 0, 7); fill('#f4f0f0');
      ctx.beginPath(); ctx.arc(S * 0.58, S * 0.52, S * 0.15, 0, 7); fill(main);
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(S * 0.6, S * 0.52, S * 0.07, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(S * 0.63, S * 0.48, S * 0.03, 0, 7); ctx.fill();
      break;
    }
    case 'boar': {
      ctx.beginPath(); ctx.ellipse(S * 0.48, S * 0.58, S * 0.38, S * 0.24, 0, 0, 7); fill(main);
      ctx.fillStyle = dark; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(S * (0.22 + i * 0.1), S * 0.4); ctx.lineTo(S * (0.27 + i * 0.1), S * 0.28); ctx.lineTo(S * (0.32 + i * 0.1), S * 0.4); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(S * 0.84, S * 0.62, S * 0.11, S * 0.09, 0, 0, 7); fill(light);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(S * 0.8, S * 0.68); ctx.lineTo(S * 0.86, S * 0.5); ctx.lineTo(S * 0.88, S * 0.7); ctx.fill();
      eyes(ctx, S * 0.7, S * 0.5, S * 0.0001, S * 0.05);
      ctx.fillStyle = dark; ctx.fillRect(S * 0.26, S * 0.78, S * 0.08, S * 0.09); ctx.fillRect(S * 0.6, S * 0.78, S * 0.08, S * 0.09);
      break;
    }
    case 'golem': {
      ctx.beginPath(); ctx.roundRect(S * 0.26, S * 0.34, S * 0.48, S * 0.5, S * 0.05); fill(main);
      ctx.beginPath(); ctx.roundRect(S * 0.34, S * 0.14, S * 0.32, S * 0.26, S * 0.04); fill(light);
      ctx.beginPath(); ctx.roundRect(S * 0.06, S * 0.4, S * 0.18, S * 0.3, S * 0.04); fill(main);
      ctx.beginPath(); ctx.roundRect(S * 0.76, S * 0.4, S * 0.18, S * 0.3, S * 0.04); fill(main);
      ctx.fillStyle = '#ff9a2e'; ctx.fillRect(S * 0.4, S * 0.24, S * 0.07, S * 0.05); ctx.fillRect(S * 0.54, S * 0.24, S * 0.07, S * 0.05);
      ctx.strokeStyle = dark; ctx.beginPath(); ctx.moveTo(S * 0.4, S * 0.5); ctx.lineTo(S * 0.5, S * 0.6); ctx.lineTo(S * 0.6, S * 0.52); ctx.stroke();
      break;
    }
    case 'drake': {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(S * 0.3, S * 0.5); ctx.lineTo(S * 0.1, S * 0.2); ctx.lineTo(S * 0.5, S * 0.4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(S * 0.1, S * 0.7); ctx.quadraticCurveTo(S * 0.02, S * 0.8, S * 0.06, S * 0.9); ctx.lineTo(S * 0.3, S * 0.74); ctx.fill();
      ctx.beginPath(); ctx.ellipse(S * 0.46, S * 0.6, S * 0.3, S * 0.2, 0, 0, 7); fill(main);
      ctx.beginPath(); ctx.ellipse(S * 0.76, S * 0.46, S * 0.15, S * 0.11, 0, 0, 7); fill(main);
      ctx.fillStyle = '#f2e6a0'; ctx.beginPath(); ctx.moveTo(S * 0.72, S * 0.37); ctx.lineTo(S * 0.7, S * 0.22); ctx.lineTo(S * 0.78, S * 0.36); ctx.fill();
      eyes(ctx, S * 0.8, S * 0.44, S * 0.0001, S * 0.04);
      ctx.fillStyle = dark; ctx.fillRect(S * 0.34, S * 0.76, S * 0.08, S * 0.1); ctx.fillRect(S * 0.56, S * 0.76, S * 0.08, S * 0.1);
      break;
    }
    default: {
      ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.58, S * 0.3, S * 0.28, 0, 0, 7); fill(main);
      ctx.beginPath(); ctx.moveTo(S * 0.3, S * 0.38); ctx.lineTo(S * 0.34, S * 0.2); ctx.lineTo(S * 0.44, S * 0.34); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.7, S * 0.38); ctx.lineTo(S * 0.66, S * 0.2); ctx.lineTo(S * 0.56, S * 0.34); ctx.fill(); ctx.stroke();
      eyes(ctx, S * 0.52, S * 0.55, S * 0.1, S * 0.06);
      ctx.beginPath(); ctx.arc(S * 0.54, S * 0.7, S * 0.06, 0.1, Math.PI - 0.1); ctx.stroke();
    }
  }
  ctx.restore();
  if (boss) {
    // crown
    ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#8a5a00'; ctx.lineWidth = S * 0.025;
    const cx = S * 0.5, cy = S * 0.045 + bob, w = S * 0.3, h = S * 0.13;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy + h); ctx.lineTo(cx - w, cy); ctx.lineTo(cx - w / 2, cy + h * 0.5); ctx.lineTo(cx, cy - h * 0.15);
    ctx.lineTo(cx + w / 2, cy + h * 0.5); ctx.lineTo(cx + w, cy); ctx.lineTo(cx + w, cy + h); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8453c'; ctx.beginPath(); ctx.arc(cx, cy + h * 0.65, S * 0.022, 0, 7); ctx.fill();
  }
}

function whiteSilhouette(src: HTMLCanvasElement): HTMLCanvasElement {
  const [c, ctx] = canvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

export interface MobTex { frames: Texture[]; flash: Texture[]; /** display size in px at scale 1 */ size: number }

export const MOB_SIZE = 40;
export const BIG_SIZE = 54;

export interface Textures {
  mobs: MobTex[];
  bosses: MobTex[];
  player: Texture;
  ground: Texture;
  decos: Texture[];
  gems: Texture[];
  potion: Texture;
  elixir: Texture;
  meso: Texture;
  bag: Texture;
  /** Gachapon capsule and Mastery Book pickups (placeholders: the capsule is replaced by the Gachapon Ticket art when extracted) */
  gacha: Texture;
  book: Texture;
  /** field items (Apple, 2x EXP Coupon, Warrior Elixir, Ludibrium Clock, Powder Keg) and the breakable Maple box: placeholders for the extracted icons */
  field: Texture[];
  box: Texture;
  missiles: Record<string, Texture>;
  ring: Texture;
  disc: Texture;
  glow: Texture;
  bar: Texture;
  icons: Record<string, string>;
}

function mobTex(name: string, tier: number, size: number, boss: boolean): MobTex {
  const shape = shapeFor(name);
  const col = colorFor(name, shape, tier);
  const frames: Texture[] = [], flash: Texture[] = [];
  for (let f = 0; f < 2; f++) {
    const [c, ctx] = canvas(size * RES, size * RES);
    drawMob(ctx, size * RES, shape, col, f, name, boss);
    frames.push(tex(c));
    flash.push(tex(whiteSilhouette(c)));
  }
  return { frames, flash, size };
}

function drawPlayer(): Texture {
  const W = 48 * RES, H = 64 * RES;
  const [c, ctx] = canvas(W, H);
  const u = RES;
  ctx.scale(u, u);
  ctx.lineJoin = 'round'; ctx.lineWidth = 1.6; ctx.strokeStyle = '#1b2447';
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(24, 58, 14, 4, 0, 0, 7); ctx.fill();
  // staff (in front hand, right side)
  ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(38, 56); ctx.lineTo(38, 24); ctx.stroke();
  const g = ctx.createRadialGradient(38, 21, 1, 38, 21, 7); g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#7fd0ff'); g.addColorStop(1, 'rgba(90,160,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(38, 21, 7, 0, 7); ctx.fill();
  ctx.strokeStyle = '#1b2447'; ctx.lineWidth = 1.6;
  // robe
  ctx.fillStyle = '#3a5fd0';
  ctx.beginPath(); ctx.moveTo(14, 56); ctx.lineTo(18, 34); ctx.lineTo(30, 34); ctx.lineTo(34, 56); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f2c230'; ctx.fillRect(18, 42, 12, 3);
  // arm
  ctx.fillStyle = '#3a5fd0'; ctx.beginPath(); ctx.roundRect(29, 35, 9, 5, 2); ctx.fill(); ctx.stroke();
  // head
  ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(24, 25, 10, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#5a3a1e'; ctx.beginPath(); ctx.arc(24, 21, 10, Math.PI, 0); ctx.fill();
  // hat
  ctx.fillStyle = '#2b49b0';
  ctx.beginPath(); ctx.ellipse(24, 17, 14, 4, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14, 16); ctx.quadraticCurveTo(22, 2, 30, 0); ctx.lineTo(34, 16); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f2c230'; ctx.fillRect(15, 13, 18, 2.5);
  // face
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(28, 27, 1.5, 0, 7); ctx.arc(21, 27, 1.5, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,120,120,0.6)'; ctx.beginPath(); ctx.arc(31, 30, 2, 0, 7); ctx.fill();
  return tex(c);
}

function drawGround(): Texture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = '#4f9a3c'; ctx.fillRect(0, 0, S, S);
  const wrap = (x: number, y: number, fn: (x: number, y: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(x + ox, y + oy);
  };
  for (let i = 0; i < 120; i++) {
    const x = rnd() * S, y = rnd() * S, r = 12 + rnd() * 26;
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(88,170,62,0.45)' : 'rgba(52,120,44,0.35)';
    wrap(x, y, (xx, yy) => { ctx.beginPath(); ctx.ellipse(xx, yy, r, r * 0.7, rnd() * 3, 0, 7); ctx.fill(); });
  }
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S;
    ctx.strokeStyle = rnd() < 0.5 ? '#3f8a31' : '#6bb552'; ctx.lineWidth = 1.5;
    wrap(x, y, (xx, yy) => { ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 1, yy - 5); ctx.moveTo(xx + 3, yy); ctx.lineTo(xx + 5, yy - 4); ctx.stroke(); });
  }
  const petals = ['#ffffff', '#ffd84a', '#ff8fb1', '#b9a2ff'];
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S, y = rnd() * S, col = petals[i % 4];
    wrap(x, y, (xx, yy) => {
      ctx.fillStyle = col;
      for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(xx + Math.cos(k * 1.256) * 2.6, yy + Math.sin(k * 1.256) * 2.6, 1.8, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#e8a020'; ctx.beginPath(); ctx.arc(xx, yy, 1.5, 0, 7); ctx.fill();
    });
  }
  return tex(c);
}

function drawDecos(): Texture[] {
  const out: Texture[] = [];
  // bush
  let [c, ctx] = canvas(64 * RES, 48 * RES);
  ctx.scale(RES, RES);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(32, 42, 26, 5, 0, 0, 7); ctx.fill();
  for (const [x, y, r, col] of [[20, 30, 14, '#2f7a34'], [44, 30, 14, '#2f7a34'], [32, 22, 16, '#3c9440'], [30, 32, 12, '#47a84a']] as [number, number, number, string][]) {
    ctx.fillStyle = col; ctx.strokeStyle = '#1e5a26'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#e8453c'; for (const [x, y] of [[26, 24], [38, 30], [32, 18]]) { ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); }
  out.push(tex(c));
  // signpost
  [c, ctx] = canvas(40 * RES, 64 * RES);
  ctx.scale(RES, RES);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(20, 58, 12, 3.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#7a5230'; ctx.fillRect(18, 22, 5, 36);
  ctx.fillStyle = '#c99b5b'; ctx.strokeStyle = '#5b3a1c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(4, 8, 32, 18, 3); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#5b3a1c'; ctx.beginPath(); ctx.moveTo(10, 14); ctx.lineTo(30, 14); ctx.moveTo(10, 20); ctx.lineTo(26, 20); ctx.stroke();
  out.push(tex(c));
  // rock
  [c, ctx] = canvas(44 * RES, 32 * RES);
  ctx.scale(RES, RES);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(22, 27, 17, 4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#8d949c'; ctx.strokeStyle = '#4c5258'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(4, 26); ctx.lineTo(9, 10); ctx.lineTo(22, 4); ctx.lineTo(35, 11); ctx.lineTo(40, 26); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(12, 12); ctx.lineTo(22, 7); ctx.lineTo(20, 14); ctx.fill();
  out.push(tex(c));
  return out;
}

function drawGem(h: number, big: boolean): Texture {
  const S = (big ? 22 : 16) * RES;
  const [c, ctx] = canvas(S, S);
  ctx.translate(S / 2, S / 2);
  const r = S * 0.42;
  ctx.fillStyle = hsl(h, 85, 58); ctx.strokeStyle = hsl(h, 80, 28); ctx.lineWidth = S * 0.06; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.8, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.lineTo(r * 0.35, -r * 0.1); ctx.lineTo(0, 0); ctx.lineTo(-r * 0.35, -r * 0.1); ctx.fill();
  return tex(c);
}

function drawBottle(liquid: string, big: boolean): Texture {
  const S = (big ? 28 : 22) * RES;
  const [c, ctx] = canvas(S, S);
  ctx.scale(S / 22, S / 22);
  ctx.lineWidth = 1.3; ctx.strokeStyle = '#3a2a2a'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#e8d9b0'; ctx.fillRect(9, 2, 4, 4); ctx.strokeRect(9, 2, 4, 4);
  ctx.fillStyle = liquid; ctx.beginPath(); ctx.arc(11, 14, 6.5, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillRect(9.5, 5, 3, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(8.6, 12, 1.6, 0, 7); ctx.fill();
  return tex(c);
}

function drawMeso(bag: boolean): Texture {
  const S = (bag ? 30 : 18) * RES;
  const [c, ctx] = canvas(S, S);
  ctx.scale(S / 18, S / 18);
  ctx.lineWidth = 1.2; ctx.strokeStyle = '#8a5a00';
  if (bag) {
    ctx.fillStyle = '#b9824a'; ctx.beginPath(); ctx.ellipse(9, 11, 6.5, 5.5, 0, 0, 7); ctx.fill(); ctx.strokeStyle = '#5b3a1c'; ctx.stroke();
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(9, 10, 2.6, 0, 7); ctx.fill(); ctx.strokeStyle = '#8a5a00'; ctx.stroke();
    ctx.fillStyle = '#b9824a'; ctx.strokeStyle = '#5b3a1c'; ctx.beginPath(); ctx.moveTo(5, 6); ctx.lineTo(13, 6); ctx.lineTo(11, 4); ctx.lineTo(7, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(9, 9, 6.5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffeb8a'; ctx.beginPath(); ctx.arc(9, 9, 4, 0, 7); ctx.fill(); ctx.stroke();
  }
  return tex(c);
}

/** A two-colour capsule ball: red top half, cream bottom half, a seam and a highlight (the placeholder for the Gachapon Ticket icon) */
export function gachaCanvas(S: number): HTMLCanvasElement {
  const [c, ctx] = canvas(S, S);
  ctx.scale(S / 34, S / 34);
  ctx.lineWidth = 1.6; ctx.strokeStyle = '#3a1a1a';
  ctx.fillStyle = '#f4ecd0'; ctx.beginPath(); ctx.arc(17, 17, 12.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8383c'; ctx.beginPath(); ctx.arc(17, 17, 12.5, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(17, 17, 12.5, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4.5, 17); ctx.lineTo(29.5, 17); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.ellipse(12.5, 11, 3.2, 2, -0.6, 0, 7); ctx.fill();
  return c;
}

function drawBook(): Texture {
  const S = 26 * RES;
  const [c, ctx] = canvas(S, S);
  ctx.scale(S / 26, S / 26);
  ctx.lineWidth = 1.3; ctx.strokeStyle = '#2a1a4a'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#7a4ad8'; ctx.beginPath(); ctx.roundRect(4, 3, 18, 20, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f4ecd0'; ctx.fillRect(7, 5, 13, 16); ctx.strokeRect(7, 5, 13, 16);
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.moveTo(13.5, 8); ctx.lineTo(15, 12); ctx.lineTo(19, 12.4); ctx.lineTo(16, 15); ctx.lineTo(17, 19); ctx.lineTo(13.5, 16.8); ctx.lineTo(10, 19); ctx.lineTo(11, 15); ctx.lineTo(8, 12.4); ctx.lineTo(12, 12); ctx.closePath(); ctx.fill();
  return tex(c);
}

/** The five field items drawn on a 28-unit canvas of S pixels (also the HUD buff icons): apple, coupon, elixir bottle, clock, powder keg */
export function fieldCanvas(item: number, S: number): HTMLCanvasElement {
  const [c, ctx] = canvas(S, S);
  ctx.scale(S / 28, S / 28);
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#2a1a1a'; ctx.lineJoin = 'round';
  switch (item) {
    case 0: // Apple
      ctx.fillStyle = '#e8383c'; ctx.beginPath(); ctx.arc(11, 16, 8, 0, 7); ctx.arc(17, 16, 8, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4fa83a'; ctx.beginPath(); ctx.ellipse(17, 6, 5, 2.6, -0.5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(8.5, 13, 2.2, 3.2, 0.4, 0, 7); ctx.fill();
      break;
    case 1: // 2x EXP Coupon
      ctx.fillStyle = '#5ab4ff'; ctx.beginPath(); ctx.roundRect(2, 7, 24, 15, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('2x', 14, 19);
      break;
    case 2: // Warrior Elixir
      ctx.fillStyle = '#e8d9b0'; ctx.fillRect(11, 2, 6, 6); ctx.strokeRect(11, 2, 6, 6);
      ctx.fillStyle = '#ff9a3a'; ctx.beginPath(); ctx.arc(14, 18, 8.5, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillRect(12, 7, 4, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(10.5, 16, 2, 0, 7); ctx.fill();
      break;
    case 3: // Ludibrium Clock
      ctx.fillStyle = '#b58cff'; ctx.beginPath(); ctx.arc(14, 15, 11, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f4ecd0'; ctx.beginPath(); ctx.arc(14, 15, 8, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(14, 15); ctx.lineTo(14, 9); ctx.moveTo(14, 15); ctx.lineTo(18.5, 17); ctx.stroke();
      ctx.fillStyle = '#b58cff'; ctx.beginPath(); ctx.arc(7, 5, 3.2, 0, 7); ctx.arc(21, 5, 3.2, 0, 7); ctx.fill(); ctx.stroke();
      break;
    default: // Powder Keg
      ctx.fillStyle = '#8a5a2a'; ctx.beginPath(); ctx.ellipse(14, 16, 10, 10.5, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#3a2410'; ctx.beginPath(); ctx.moveTo(4.5, 12); ctx.lineTo(23.5, 12); ctx.moveTo(4.5, 20); ctx.lineTo(23.5, 20); ctx.stroke();
      ctx.strokeStyle = '#2a1a1a'; ctx.beginPath(); ctx.moveTo(14, 6); ctx.quadraticCurveTo(17, 3, 20, 4); ctx.stroke();
      ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(20.5, 3.8, 2.2, 0, 7); ctx.fill();
  }
  return c;
}

/** The breakable Maple box: a wooden crate with metal corners */
function drawBox(): Texture {
  const S = 34 * RES;
  const [c, ctx] = canvas(S, S);
  ctx.scale(S / 34, S / 34);
  ctx.lineWidth = 1.8; ctx.strokeStyle = '#4a2a10'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#c8924a'; ctx.beginPath(); ctx.roundRect(4, 7, 26, 22, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#a8742e'; ctx.fillRect(4, 14, 26, 3); ctx.strokeRect(4, 14, 26, 3);
  ctx.beginPath(); ctx.moveTo(4, 7); ctx.lineTo(30, 29); ctx.moveTo(30, 7); ctx.lineTo(4, 29); ctx.strokeStyle = '#8a5a22'; ctx.stroke();
  ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#4a2a10'; ctx.beginPath(); ctx.arc(17, 18, 3.2, 0, 7); ctx.fill(); ctx.stroke();
  return tex(c);
}

function radial(size: number, stops: [number, string][]): Texture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return tex(c);
}

function drawMissiles(): Record<string, Texture> {
  const out: Record<string, Texture> = {};
  let [c, ctx] = canvas(28 * RES, 16 * RES);
  ctx.scale(RES, RES);
  // magic claw: cyan crescent with trail
  let g = ctx.createLinearGradient(0, 8, 28, 8); g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(1, 'rgba(160,230,255,0.9)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(20, 3); ctx.lineTo(20, 13); ctx.fill();
  ctx.fillStyle = '#e8fbff'; ctx.strokeStyle = '#3aa0e8'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(20, 8, 6, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#6cc4ff'; ctx.beginPath(); ctx.moveTo(18, 3); ctx.lineTo(27, 8); ctx.lineTo(18, 13); ctx.lineTo(21, 8); ctx.fill();
  out.magic_claw = tex(c);
  // energy bolt: blue orb
  [c, ctx] = canvas(34 * RES, 20 * RES); ctx.scale(RES, RES);
  g = ctx.createLinearGradient(0, 10, 34, 10); g.addColorStop(0, 'rgba(80,120,255,0)'); g.addColorStop(1, 'rgba(120,170,255,0.8)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(24, 2); ctx.lineTo(24, 18); ctx.fill();
  const rg = ctx.createRadialGradient(25, 10, 1, 25, 10, 9); rg.addColorStop(0, '#fff'); rg.addColorStop(0.5, '#7aa8ff'); rg.addColorStop(1, 'rgba(60,100,255,0)');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(25, 10, 9, 0, 7); ctx.fill();
  out.energy_bolt = tex(c);
  // fire arrow
  [c, ctx] = canvas(36 * RES, 16 * RES); ctx.scale(RES, RES);
  g = ctx.createLinearGradient(0, 8, 36, 8); g.addColorStop(0, 'rgba(255,90,0,0)'); g.addColorStop(1, 'rgba(255,170,40,0.95)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(26, 2); ctx.lineTo(26, 14); ctx.fill();
  ctx.fillStyle = '#ffe9a0'; ctx.strokeStyle = '#d2400c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(24, 2); ctx.lineTo(35, 8); ctx.lineTo(24, 14); ctx.closePath(); ctx.fill(); ctx.stroke();
  out.fire_arrow = tex(c);
  return out;
}

function drawRing(): Texture {
  const S = 128 * RES / 2;
  const [c, ctx] = canvas(S, S);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = S * 0.045;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - S * 0.03, 0, 7); ctx.stroke();
  ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - S * 0.03, 0, 7); ctx.fill();
  return tex(c);
}

const SKILL_COLORS: Record<string, string> = { arcane: '#8e63e8', fire: '#f2761c', ice: '#38b6e8', lightning: '#e8c81c', poison: '#3fae4a' };
const PASSIVE_COLOR = '#4b78c8';

function iconDataUrl(label: string, color: string, shape: number): string {
  const S = 48;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, color); g.addColorStop(1, '#10162c');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(1, 1, S - 2, S - 2, 9); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.stroke();
  // glyph
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.save(); ctx.translate(S / 2, S / 2 - 3);
  switch (shape % 6) {
    case 0: ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = (i / 10) * 6.283 - 1.57; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.fill(); break;
    case 1: ctx.beginPath(); ctx.moveTo(-4, -14); ctx.lineTo(8, -14); ctx.lineTo(1, -2); ctx.lineTo(9, -2); ctx.lineTo(-7, 15); ctx.lineTo(-2, 2); ctx.lineTo(-9, 2); ctx.closePath(); ctx.fill(); break;
    case 2: ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(3, -2, 8, 0, 7); ctx.fill(); break;
    case 3: ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(12, 0); ctx.lineTo(0, 14); ctx.lineTo(-12, 0); ctx.closePath(); ctx.fill(); break;
    case 4: ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill(); break;
    default: ctx.fillRect(-12, -3, 24, 6); ctx.fillRect(-3, -12, 6, 24);
  }
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = '#10162c'; ctx.lineWidth = 3;
  ctx.strokeText(label, S / 2, S - 5); ctx.fillText(label, S / 2, S - 5);
  return c.toDataURL();
}

function abbreviate(name: string): string {
  const w = name.split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export function buildTextures(): Textures {
  const mobs = LADDER.map((m, i) => mobTex(m.name, i, m.big ? BIG_SIZE : MOB_SIZE, false));
  const bosses = BOSSES.map((b) => mobTex(b.name, 29, Math.round(1.6 * b.scale * 2 * 20 * 1.3), true));
  const icons: Record<string, string> = {};
  [...SKILLS, ...EVOLVED_SKILLS].forEach((s, i) => { icons[s.key] = iconDataUrl(abbreviate(s.name), SKILL_COLORS[s.element], i); });
  PASSIVES.forEach((p, i) => { icons[p.key] = iconDataUrl(abbreviate(p.name), PASSIVE_COLOR, i + 3); });
  icons.elixir = iconDataUrl('EX', '#d0e8ff', 2);
  icons.mesobag = iconDataUrl('$', '#c89020', 3);
  icons.gacha = gachaCanvas(48).toDataURL();
  for (let i = 0; i < 5; i++) icons['field' + i] = fieldCanvas(i, 48).toDataURL();
  const [bc, bctx] = canvas(2, 2);
  bctx.fillStyle = '#fff'; bctx.fillRect(0, 0, 2, 2);
  return {
    mobs, bosses,
    player: drawPlayer(),
    ground: drawGround(),
    decos: drawDecos(),
    gems: [drawGem(210, false), drawGem(125, false), drawGem(280, true), drawGem(45, true)],
    potion: drawBottle('#e8383c', false),
    elixir: drawBottle('#7fd8ff', true),
    meso: drawMeso(false),
    bag: drawMeso(true),
    gacha: tex(gachaCanvas(34 * RES)),
    book: drawBook(),
    field: [0, 1, 2, 3, 4].map((i) => tex(fieldCanvas(i, 28 * RES))),
    box: drawBox(),
    missiles: drawMissiles(),
    ring: drawRing(),
    disc: radial(64, [[0, 'rgba(255,255,255,1)'], [0.7, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)']]),
    glow: radial(64, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]),
    bar: tex(bc),
    icons,
  };
}
