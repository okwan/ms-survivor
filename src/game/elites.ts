/**
 * Elite monsters (MapleStory's Elite Monster, Halls of Torment elites). From 0:45 on, about every 50 to 70 s one normal spawn is promoted:
 * 1.5x size, x(6 + 6p) HP, x1.3 damage, a tint and one affix. The sim keeps the schedule here (own seeded stream, so it never shifts the
 * run's other random draws); the spawner offers each fresh mob to `maybePromote`. No Elite appears while two or more bosses are alive (the
 * promotion waits). A slain Elite drops a Gachapon capsule with exactly one upgrade, a big meso bag, a scroll and a field item.
 * Pure (no DOM).
 */
import { BOSSES, ENEMY_SPEED_CAP, LADDER, PLAYER_BASE, mesoValue, progress } from './data.ts';
import { dropField } from './fieldItems.ts';
import { ELITE_CAPSULE } from './gachapon.ts';
import { Rng } from './rng.ts';
import type { Sim } from './sim.ts';
import { BAG, GACHA } from './types.ts';
import type { Enemy, Fire } from './types.ts';

export const AFFIX_SWIFT = 1, AFFIX_ARMORED = 2, AFFIX_SPLITTING = 3, AFFIX_BLAZING = 4, AFFIX_VAMPIRIC = 5;

export interface AffixDef {
  key: string;
  name: string;
  /** sprite tint of the Elite */
  tint: number;
  desc: string;
}
/** index = affix - 1 */
export const AFFIXES: AffixDef[] = [
  { key: 'swift', name: 'Swift', tint: 0x7fe8ff, desc: 'Moves 1.5x faster.' },
  { key: 'armored', name: 'Armored', tint: 0xb4b8c8, desc: 'Takes 40% less damage.' },
  { key: 'splitting', name: 'Splitting', tint: 0x9aff6a, desc: 'Splits into 4 mobs when it dies.' },
  { key: 'blazing', name: 'Blazing', tint: 0xff8a3a, desc: 'Leaves fire on the ground.' },
  { key: 'vampiric', name: 'Vampiric', tint: 0xe060ff, desc: 'Heals when it hits you.' },
];

/** first promotion time and the gap between promotions (range, seconds) */
export const ELITE_FIRST = 45;
export const ELITE_GAP_MIN = 50;
export const ELITE_GAP_MAX = 70;
/** drawn size (and hit radius) multiplier, HP multiplier 6 + 6p, damage multiplier, xp multiplier */
export const ELITE_SCALE = 1.5;
export const eliteHpMult = (p: number) => 6 + 6 * p;
export const ELITE_DMG = 1.6;
export const ELITE_XP = 2;
/** no Elite while this many bosses are alive */
export const ELITE_BOSS_LIMIT = 2;
export const SWIFT_SPEED = 1.5;
/** Armored: fraction of every hit that is ignored */
export const ARMOR_REDUCE = 0.4;
export const SPLIT_COUNT = 4;
/** Blazing: a fire patch every FIRE_EVERY s lasting FIRE_LIFE s; standing in one for FIRE_DELAY s starts burning, then a tick every FIRE_TICK s for FIRE_DMG of the Elite's damage */
export const FIRE_EVERY = 1;
export const FIRE_LIFE = 4;
export const FIRE_RADIUS = 1.5;
export const FIRE_DELAY = 0.6;
export const FIRE_TICK = 0.5;
export const FIRE_DMG = 0.5;
/** Vampiric: fraction of max HP healed when it hits the hero */
export const VAMP_HEAL = 0.03;
/** Elite loot: a meso bag worth ELITE_MESO x the tier's coin plus ELITE_MESO_BASE */
export const ELITE_MESO = 15;
export const ELITE_MESO_BASE = 20;
/** seconds of run time per step of the capsule's meso fallback (boss-number equivalent, at most 6) */
const CAPSULE_STEP = 150;

export class Elites {
  rng: Rng;
  nextAt = ELITE_FIRST;
  /** a promotion is due: the next fresh spawn becomes the Elite (it waits while two bosses are alive) */
  pending = false;
  spawned = 0;
  killed = 0;
  fires: Fire[] = [];
  private pool: Fire[] = [];
  private burnT = 0;

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x3c6ef372) >>> 0);
  }

  addFire(x: number, y: number, dmg: number) {
    const f = this.pool.pop() ?? { x: 0, y: 0, r: FIRE_RADIUS, t: 0, dmg: 0 };
    f.x = x; f.y = y; f.t = FIRE_LIFE; f.dmg = dmg;
    this.fires.push(f);
  }

  /** Fire patches burn down; the hero standing in one for FIRE_DELAY s takes a tick every FIRE_TICK s. */
  updateFires(sim: Sim, dt: number) {
    const fs = this.fires;
    let inside: Fire | null = null;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      f.t -= dt;
      if (f.t <= 0) {
        const last = fs.pop()!;
        if (last !== f) fs[i] = last;
        this.pool.push(f);
        continue;
      }
      const dx = f.x - sim.px, dy = f.y - sim.py;
      const rr = f.r + PLAYER_BASE.radius;
      if (dx * dx + dy * dy < rr * rr && (inside === null || f.dmg > inside.dmg)) inside = f;
    }
    if (!inside) { this.burnT = Math.max(0, this.burnT - dt * 2); return; }
    this.burnT += dt;
    if (this.burnT >= FIRE_DELAY) {
      this.burnT -= FIRE_TICK;
      sim.hurtPlayer(sim.mitigate(inside.dmg), sim.px, sim.py);
    }
  }
}

/** "Elite Orange Mushroom" */
export function eliteTitle(e: { tier: number }): string {
  return `Elite ${LADDER[e.tier].name}`;
}

/** Schedule: a promotion becomes due at nextAt; fire patches run. */
export function updateElites(sim: Sim, dt: number) {
  const s = sim.elites;
  if (!s.pending && sim.t >= s.nextAt) s.pending = true;
  s.updateFires(sim, dt);
}

/** Living bosses (stops at `limit`) */
function bossesAlive(sim: Sim, limit: number): number {
  let n = 0;
  const es = sim.enemies;
  for (let i = 0; i < es.length && n < limit; i++) if (es[i].alive && es[i].boss >= 0) n++;
  return n;
}

/** Offered each fresh normal spawn by the spawner: becomes the Elite when one is due (and fewer than two bosses live). */
export function maybePromote(sim: Sim, e: Enemy) {
  const s = sim.elites;
  if (!s.pending || bossesAlive(sim, ELITE_BOSS_LIMIT) >= ELITE_BOSS_LIMIT) return;
  s.pending = false;
  s.spawned++;
  s.nextAt = sim.t + s.rng.range(ELITE_GAP_MIN, ELITE_GAP_MAX);
  const affix = 1 + s.rng.int(AFFIXES.length);
  e.elite = affix;
  e.maxHp = e.hp = e.maxHp * eliteHpMult(progress(sim.t));
  e.dmg *= ELITE_DMG;
  e.r *= ELITE_SCALE;
  e.xp *= ELITE_XP;
  e.big = true;
  e.evT = FIRE_EVERY;
  if (affix === AFFIX_SWIFT) e.speed = Math.min(e.speed * SWIFT_SPEED, ENEMY_SPEED_CAP * sim.cls.speed);
  const a = AFFIXES[affix - 1];
  sim.emit({ type: 'elite', name: eliteTitle(e), affix: a.key, x: e.x, y: e.y });
  sim.raid(`An Elite ${LADDER[e.tier].name} appears!`);
}

/** Damage an Elite takes from a hit (Armored ignores part of it) */
export function eliteDamage(e: Enemy, amt: number): number {
  return e.elite === AFFIX_ARMORED ? Math.max(1, Math.round(amt * (1 - ARMOR_REDUCE))) : amt;
}

/** Per-frame upkeep of a living Elite: Blazing leaves a fire patch every second */
export function eliteTick(sim: Sim, e: Enemy, dt: number) {
  if (e.elite !== AFFIX_BLAZING) return;
  e.evT -= dt;
  if (e.evT <= 0) {
    e.evT += FIRE_EVERY;
    sim.elites.addFire(e.x, e.y, e.dmg * FIRE_DMG);
  }
}

/** The Elite hit the hero (Vampiric heals) */
export function eliteContact(e: Enemy) {
  if (e.elite === AFFIX_VAMPIRIC) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * VAMP_HEAL);
}

/** The Elite died at its spot: Splitting spawns 4 mobs of its tier; the loot is a one-upgrade capsule, a meso bag, a scroll and a field item. */
export function eliteKilled(sim: Sim, e: Enemy) {
  sim.elites.killed++;
  if (e.elite === AFFIX_SPLITTING && sim.enemies.length < 560) {
    for (let k = 0; k < SPLIT_COUNT; k++) {
      const a = (k / SPLIT_COUNT) * Math.PI * 2 + 0.7;
      sim.spawnEnemy(e.tier, e.x + Math.cos(a) * 1.3, e.y + Math.sin(a) * 1.3, true);
    }
  }
  sim.dropPickup(GACHA, e.x, e.y + 1.2, ELITE_CAPSULE + Math.min(BOSSES.length - 1, Math.floor(sim.t / CAPSULE_STEP)));
  sim.dropPickup(BAG, e.x - 1.2, e.y + 0.6, ELITE_MESO_BASE + ELITE_MESO * mesoValue(e.tier));
  sim.dropScroll(e.x + 1.2, e.y + 0.6);
  dropField(sim, e.x, e.y - 1.2);
}
