/**
 * Field items (from Vampire Survivors floor pickups): breakable Maple boxes and the five items they, Elites and Treasure Pigs drop.
 * A box is an Enemy with `ev = EV_BOX` (1 HP, never moves or attacks, no gem), so every skill that can hit a mob can break it; it drops one
 * field item. A field item is a FIELD pickup (value = item index): it works on touch only (the magnet and the pet leave it alone).
 * Timed buffs live in `sim.field`. Drop rolls and box placement have their own seeded stream so they never shift the run's other random
 * draws. Pure (no DOM).
 */
import { SPAWN_RING_MAX, SPAWN_RING_MIN } from './data.ts';
import { Rng } from './rng.ts';
import type { Sim } from './sim.ts';
import { EV_BOX, FIELD, GEM } from './types.ts';

export const FIELD_APPLE = 0, FIELD_COUPON = 1, FIELD_ELIXIR = 2, FIELD_CLOCK = 3, FIELD_KEG = 4;

export interface FieldItemDef {
  key: string;
  name: string;
  /** drop weight */
  weight: number;
  desc: string;
  /** placeholder colour (icon, buff chip) */
  color: string;
}
export const FIELD_ITEMS: FieldItemDef[] = [
  { key: 'apple', name: 'Apple', weight: 35, desc: 'Heals 30% of your max HP.', color: '#e8383c' },
  { key: 'coupon', name: '2x EXP Coupon', weight: 20, desc: 'Pulls every gem to you; gems are worth 2x for 30 s.', color: '#5ab4ff' },
  { key: 'elixir', name: 'Warrior Elixir', weight: 20, desc: '+40% damage for 20 s.', color: '#ff9a3a' },
  { key: 'clock', name: 'Ludibrium Clock', weight: 15, desc: 'Freezes every mob for 5 s; bosses are slowed 50%.', color: '#b58cff' },
  { key: 'keg', name: 'Powder Keg', weight: 10, desc: 'Blows up every mob within 20 yd; bosses and Elites lose 10% max HP.', color: '#8a5a2a' },
];
const WEIGHT_TOTAL = FIELD_ITEMS.reduce((a, d) => a + d.weight, 0);

/** seconds between boxes (range; the first one comes after one gap); at most BOX_MAX on the map; a box nobody breaks goes after BOX_LIFE */
export const BOX_GAP_MIN = 60;
export const BOX_GAP_MAX = 90;
export const BOX_MAX = 3;
export const BOX_LIFE = 150;
export const BOX_RADIUS = 0.9;
/** seconds a dropped field item lies on the ground */
export const FIELD_LIFE = 75;

export const APPLE_HEAL = 0.3;
export const COUPON_SECONDS = 30;
export const COUPON_GEM_MULT = 2;
export const ELIXIR_SECONDS = 20;
export const ELIXIR_DAMAGE = 1.4;
export const CLOCK_SECONDS = 5;
export const CLOCK_BOSS_SLOW = 0.5;
export const KEG_RADIUS = 20;
export const KEG_BOSS_FRAC = 0.1;

/** Timed buffs (seconds left), the box schedule and run counters */
export class FieldState {
  rng: Rng;
  nextBox: number;
  couponT = 0;
  elixirT = 0;
  clockT = 0;
  boxesBroken = 0;
  itemsUsed = 0;

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x7f4a7c15) >>> 0);
    this.nextBox = this.rng.range(BOX_GAP_MIN, BOX_GAP_MAX);
  }
}

/** Weighted pick of a field item index */
export function rollFieldItem(rng: Rng): number {
  let r = rng.next() * WEIGHT_TOTAL;
  for (let i = 0; i < FIELD_ITEMS.length; i++) {
    r -= FIELD_ITEMS[i].weight;
    if (r < 0) return i;
  }
  return 0;
}

/** Drops one random field item at (x,y) */
export function dropField(sim: Sim, x: number, y: number) {
  sim.dropPickup(FIELD, x, y, rollFieldItem(sim.field.rng), FIELD_LIFE);
}

/** Living boxes on the map */
export function boxCount(sim: Sim): number {
  let n = 0;
  const es = sim.enemies;
  for (let i = 0; i < es.length; i++) if (es[i].alive && es[i].ev === EV_BOX) n++;
  return n;
}

/** Timers: buffs run down, and a new box appears on the spawn ring ahead of the hero's movement every 60 to 90 s (at most BOX_MAX). */
export function updateField(sim: Sim, dt: number) {
  const f = sim.field;
  if (f.couponT > 0) f.couponT -= dt;
  if (f.elixirT > 0) f.elixirT -= dt;
  if (f.clockT > 0) f.clockT -= dt;
  if (sim.t < f.nextBox) return;
  f.nextBox = sim.t + f.rng.range(BOX_GAP_MIN, BOX_GAP_MAX);
  if (boxCount(sim) >= BOX_MAX) return;
  const a = sim.moving ? Math.atan2(sim.inputY, sim.inputX) + f.rng.range(-0.9, 0.9) : f.rng.range(0, Math.PI * 2);
  const d = f.rng.range(SPAWN_RING_MIN, SPAWN_RING_MAX);
  const e = sim.spawnEnemy(0, sim.px + Math.cos(a) * d, sim.py + Math.sin(a) * d, true);
  e.maxHp = e.hp = 1;
  e.speed = 0; e.dmg = 0; e.xp = 0; e.r = BOX_RADIUS; e.big = false; e.hitCd = 1e9;
  e.ev = EV_BOX;
  e.evT = BOX_LIFE;
}

/** A box was hit: it breaks and drops one field item (no kill, no gem) */
export function breakBox(sim: Sim, e: { x: number; y: number }) {
  sim.field.boxesBroken++;
  sim.emit({ type: 'box', x: e.x, y: e.y });
  dropField(sim, e.x, e.y);
}

/** The hero touched a field item at (x,y) */
export function useFieldItem(sim: Sim, item: number, x: number, y: number) {
  const f = sim.field;
  f.itemsUsed++;
  const def = FIELD_ITEMS[item];
  if (!def) return;
  sim.emit({ type: 'fieldItem', item, x, y });
  sim.note(`${def.name}!`, 'good', 2);
  switch (item) {
    case FIELD_APPLE:
      sim.hp = Math.min(sim.maxHp, sim.hp + sim.maxHp * APPLE_HEAL);
      break;
    case FIELD_COUPON: {
      f.couponT = COUPON_SECONDS;
      const ps = sim.pickups;
      for (let i = 0; i < ps.length; i++) if (ps[i].kind === GEM) ps[i].pulled = true;
      break;
    }
    case FIELD_ELIXIR:
      f.elixirT = ELIXIR_SECONDS;
      break;
    case FIELD_CLOCK:
      f.clockT = CLOCK_SECONDS;
      break;
    case FIELD_KEG: {
      const r2 = KEG_RADIUS * KEG_RADIUS;
      const es = sim.enemies, n = es.length;
      for (let i = 0; i < n; i++) {
        const e = es[i];
        if (!e.alive || e.ev === EV_BOX) continue;
        const dx = e.x - sim.px, dy = e.y - sim.py;
        if (dx * dx + dy * dy > r2) continue;
        if (e.boss < 0 && !e.elite) { e.hp = 0; sim.kill(e); } else sim.hurt(e, e.maxHp * KEG_BOSS_FRAC);
      }
      break;
    }
  }
}
