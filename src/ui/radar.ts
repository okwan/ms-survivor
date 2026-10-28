import type { Sim } from '../game/sim.ts';
import { GEM, MESO } from '../game/types.ts';
import { theme } from './theme.ts';

const SIZE = 120;
const RANGE = 60; // yards from centre to edge

export class Radar {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(root: HTMLElement) {
    this.el = document.createElement('canvas');
    this.el.className = 'radar';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.el.width = SIZE * dpr;
    this.el.height = SIZE * dpr;
    this.el.style.width = this.el.style.height = SIZE + 'px';
    this.ctx = this.el.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    root.appendChild(this.el);
  }

  draw(sim: Sim) {
    const c = this.ctx;
    const h = SIZE / 2;
    const k = (h - 3) / RANGE;
    // MapleStory minimap look (square, dark glass, yellow marker) when the real UI art is on; the round radar otherwise
    const sq = theme.active;
    c.clearRect(0, 0, SIZE, SIZE);
    c.fillStyle = sq ? 'rgba(8,12,24,0.7)' : 'rgba(14,30,60,0.62)';
    c.beginPath();
    if (sq) c.rect(0, 0, SIZE, SIZE); else c.arc(h, h, h - 1, 0, 7);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1;
    c.beginPath();
    if (sq) { c.moveTo(h, 0); c.lineTo(h, SIZE); c.moveTo(0, h); c.lineTo(SIZE, h); } else c.arc(h, h, (h - 3) * 0.5, 0, 7);
    c.stroke();
    c.save();
    c.beginPath();
    if (sq) c.rect(1, 1, SIZE - 2, SIZE - 2); else c.arc(h, h, h - 2, 0, 7);
    c.clip();
    const px = sim.px, py = sim.py;
    const ps = sim.pickups;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const x = h + (p.x - px) * k, y = h + (p.y - py) * k;
      if (x < 0 || y < 0 || x > SIZE || y > SIZE) continue;
      c.fillStyle = p.kind === GEM ? '#5ab4ff' : p.kind === MESO ? '#ffd23a' : '#ff7ad0';
      c.fillRect(x - 1, y - 1, p.kind === GEM ? 2 : 3, p.kind === GEM ? 2 : 3);
    }
    const es = sim.enemies;
    c.fillStyle = '#ff4a3a';
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.boss >= 0) continue;
      const x = h + (e.x - px) * k, y = h + (e.y - py) * k;
      if (x < 0 || y < 0 || x > SIZE || y > SIZE) continue;
      c.fillRect(x - 1, y - 1, 2.2, 2.2);
    }
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.boss < 0) continue;
      let dx = (e.x - px) * k, dy = (e.y - py) * k;
      const l = Math.hypot(dx, dy), max = h - 7;
      if (l > max) { dx = (dx / l) * max; dy = (dy / l) * max; }
      c.fillStyle = '#ffd23a'; c.strokeStyle = '#7a2a00'; c.lineWidth = 1.2;
      c.beginPath(); c.arc(h + dx, h + dy, 4.2, 0, 7); c.fill(); c.stroke();
    }
    c.restore();
    c.fillStyle = sq ? '#ffe600' : '#fff'; c.strokeStyle = '#1b2447';
    c.beginPath(); c.arc(h, h, 3.2, 0, 7); c.fill(); c.stroke();
    if (!sq) {
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2;
      c.beginPath(); c.arc(h, h, h - 1, 0, 7); c.stroke();
    }
  }
}
