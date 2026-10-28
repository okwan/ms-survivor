/**
 * The pet: follows the hero ~1.2 tiles behind, and every ~0.6 s picks the nearest meso / potion lying within 6 tiles of the hero,
 * runs to it at 1.6x the hero's speed and collects it (the sim marks the pickup collected when the pet reaches it). Purely visual
 * otherwise. Position lives here, in the sim; the renderer only draws it. Pure (no DOM).
 */
import { BAG, ELIXIR, MESO, POTION } from './types.ts';
import type { Pickup } from './types.ts';
import type { Sim } from './sim.ts';

export const PET_LAG = 1.2;
export const PET_SPEED_MULT = 1.6;
export const PET_SCAN_EVERY = 0.6;
export const PET_REACH = 6;
/** the pet is pulled back onto this circle around the hero, so it never strays further than 10 tiles */
export const PET_LEASH = 9.5;
const ARRIVE = 0.45;

export class Pet {
  x: number;
  y: number;
  /** 1 faces right, -1 faces left */
  facing = 1;
  moving = false;
  /** pickups collected so far this run */
  collected = 0;
  target: Pickup | null = null;
  private scanT = 0;

  constructor(x: number, y: number) {
    this.x = x - PET_LAG;
    this.y = y;
  }

  update(sim: Sim, dt: number) {
    const hx = sim.px, hy = sim.py;
    // a target that is gone (picked up, expired and recycled) or too far from the hero is dropped
    if (this.target) {
      const t = this.target;
      const dx = t.x - hx, dy = t.y - hy;
      if (dx * dx + dy * dy > (PET_REACH + 2) * (PET_REACH + 2) || sim.pickups.indexOf(t) < 0) this.target = null;
    }
    this.scanT -= dt;
    if (!this.target && this.scanT <= 0) {
      this.scanT = PET_SCAN_EVERY;
      this.target = this.pickTarget(sim);
    }

    const speed = sim.speed * PET_SPEED_MULT;
    let gx: number, gy: number;
    if (this.target) {
      gx = this.target.x; gy = this.target.y;
    } else {
      gx = hx - sim.facing * PET_LAG; gy = hy;
    }
    const dx = gx - this.x, dy = gy - this.y;
    const d = Math.hypot(dx, dy);
    this.moving = false;
    if (d > (this.target ? ARRIVE * 0.5 : 0.12)) {
      const step = Math.min(d, speed * dt);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
      this.moving = step > 1e-4;
      if (dx > 0.02) this.facing = 1;
      else if (dx < -0.02) this.facing = -1;
    }
    if (this.target && Math.hypot(this.target.x - this.x, this.target.y - this.y) <= ARRIVE) {
      if (sim.collectByPet(this.target)) this.collected++;
      this.target = null;
    }
    // leash
    const lx = this.x - hx, ly = this.y - hy;
    const ld = Math.hypot(lx, ly);
    if (ld > PET_LEASH) {
      this.x = hx + (lx / ld) * PET_LEASH;
      this.y = hy + (ly / ld) * PET_LEASH;
    }
  }

  /** nearest (to the pet) meso / bag / potion / elixir within PET_REACH of the hero that the hero's magnet has not taken */
  private pickTarget(sim: Sim): Pickup | null {
    let best: Pickup | null = null, bd = 1e18;
    const r2 = PET_REACH * PET_REACH;
    const ps = sim.pickups;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.kind !== MESO && p.kind !== BAG && p.kind !== POTION && p.kind !== ELIXIR) continue;
      if (p.pulled) continue;
      const hx = p.x - sim.px, hy = p.y - sim.py;
      if (hx * hx + hy * hy > r2) continue;
      const dx = p.x - this.x, dy = p.y - this.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
