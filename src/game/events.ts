/**
 * Swarm events (Vampire Survivors map events): every 100 to 140 s, and never within 15 s of a boss spawn, one of three things happens
 * (seeded, own random stream so the run's other draws never shift). The mobs are added on top of the alive target and carry an `ev`
 * mark, so the spawner does not count them and the recycler leaves them alone:
 * - Snail Stampede: a 30 to 50 strong column enters from one screen edge, marches straight across at 1.6x speed ignoring the hero, and
 *   is removed (no loot, no kill) once past the far edge.
 * - Closing Ring: 40 mobs of the current top tier appear in a full ring at 18 yd around the hero and walk inward like any mob.
 * - Treasure Swarm: 12 fast Ribbon Pigs run away from the hero for 20 s, then vanish; each drops 5x mesos, and every 4th one a field item.
 * Pure (no DOM).
 */
import { BOSS_EVERY, RECYCLE_DIST, mesoValue, poolLo } from './data.ts';
import { dropField } from './fieldItems.ts';
import { Rng } from './rng.ts';
import type { Sim } from './sim.ts';
import { EV_BOX, EV_RING, EV_STAMPEDE, EV_TREASURE, MESO } from './types.ts';
import type { Enemy } from './types.ts';

export type SwarmKind = 'stampede' | 'ring' | 'treasure';
export const SWARM_KINDS: SwarmKind[] = ['stampede', 'ring', 'treasure'];

/** seconds between events (range), and the margin around every boss spawn in which none starts */
export const SWARM_GAP_MIN = 100;
export const SWARM_GAP_MAX = 140;
export const SWARM_BOSS_MARGIN = 15;
/** no event starts with this many enemies already alive (the pool is bounded) */
const SWARM_ROOM = 380;

export const STAMPEDE_MIN = 30;
export const STAMPEDE_MAX = 50;
export const STAMPEDE_SPEED = 1.6;
/** the column starts this far behind the hero (just off screen), is 12 mobs wide, and is removed once this far past the hero or after STAMPEDE_MAX_AGE s */
export const STAMPEDE_START = 38;
export const STAMPEDE_EXIT = 40;
export const STAMPEDE_MAX_AGE = 45;
const STAMPEDE_WIDE = 12;
export const RING_COUNT = 40;
export const RING_RADIUS = 18;
export const TREASURE_COUNT = 12;
export const TREASURE_TIER = 8;
export const TREASURE_SECONDS = 20;
export const TREASURE_MESO_MULT = 5;
/** only every 4th Treasure Pig killed (the first included) drops a field item, so a swarm is not a flood of them */
export const TREASURE_FIELD_EVERY = 4;
/** pig speed as a fraction of the hero's base speed (the hero is a little faster, so a chase is slow) */
export const TREASURE_SPEED = 0.88;

export const SWARM_BANNERS: Record<SwarmKind, string> = {
  stampede: 'Snail stampede!',
  ring: 'You are surrounded!',
  treasure: 'Treasure Pigs! Catch them!',
};

export class Swarms {
  rng: Rng;
  nextAt: number;
  /** events started so far, by kind index in SWARM_KINDS */
  started = [0, 0, 0];
  /** Treasure Pigs killed so far this run */
  pigsKilled = 0;

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x1b873593) >>> 0);
    this.nextAt = this.rng.range(SWARM_GAP_MIN, SWARM_GAP_MAX);
  }
}

/** Starts the due event unless a boss spawned, or is about to spawn, within SWARM_BOSS_MARGIN s (it then waits). */
export function updateSwarms(sim: Sim) {
  const s = sim.swarms;
  if (sim.t < s.nextAt || sim.enemies.length > SWARM_ROOM) return;
  if (sim.bossesSpawned > 0 && sim.t - BOSS_EVERY * sim.bossesSpawned < SWARM_BOSS_MARGIN) return;
  const nb = sim.nextBossIn();
  if (nb >= 0 && nb < SWARM_BOSS_MARGIN) return;
  s.nextAt = sim.t + s.rng.range(SWARM_GAP_MIN, SWARM_GAP_MAX);
  const k = s.rng.int(SWARM_KINDS.length);
  s.started[k]++;
  startSwarm(sim, SWARM_KINDS[k]);
}

/** Starts one event now (also the test hook) */
export function startSwarm(sim: Sim, kind: SwarmKind) {
  const rng = sim.swarms.rng;
  const lo = poolLo(sim.t);
  if (kind === 'stampede') {
    const n = STAMPEDE_MIN + rng.int(STAMPEDE_MAX - STAMPEDE_MIN + 1);
    // Blue / Red Snails while the ladder is low, else the current low tier
    const tier = lo < 8 ? (rng.next() < 0.5 ? 1 : 3) : lo;
    const dir = rng.int(4);
    const vx = dir === 0 ? 1 : dir === 1 ? -1 : 0, vy = dir === 2 ? 1 : dir === 3 ? -1 : 0;
    const off = rng.range(-6, 6);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / STAMPEDE_WIDE), col = i % STAMPEDE_WIDE;
      const lat = off + (col - (STAMPEDE_WIDE - 1) / 2) * 1.3, back = STAMPEDE_START + row * 1.6;
      const e = sim.spawnEnemy(tier, sim.px - vx * back - vy * lat, sim.py - vy * back + vx * lat, true);
      e.ev = EV_STAMPEDE;
      e.vx = vx; e.vy = vy;
      e.speed *= STAMPEDE_SPEED;
      if (vx !== 0) e.facing = vx;
    }
  } else if (kind === 'ring') {
    const top = Math.min(lo + 2, 29);
    for (let i = 0; i < RING_COUNT; i++) {
      const a = (i / RING_COUNT) * Math.PI * 2;
      const e = sim.spawnEnemy(top, sim.px + Math.cos(a) * RING_RADIUS, sim.py + Math.sin(a) * RING_RADIUS, true);
      e.ev = EV_RING;
      e.hitCd = 1;
    }
  } else {
    for (let i = 0; i < TREASURE_COUNT; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(9, 14), b = rng.range(-0.6, 0.6);
      const e = sim.spawnEnemy(TREASURE_TIER, sim.px + Math.cos(a) * d, sim.py + Math.sin(a) * d, true);
      e.ev = EV_TREASURE;
      e.vx = Math.cos(b); e.vy = Math.sin(b);
      e.evT = TREASURE_SECONDS;
      e.speed = TREASURE_SPEED * sim.cls.speed;
      e.hitCd = 1e9;
    }
  }
  sim.emit({ type: 'swarm', kind });
  sim.raid(SWARM_BANNERS[kind]);
}

/**
 * Upkeep of an event enemy or box, given the vector (dx,dy) to the hero. True when it left play (not killed: no loot).
 * A ring mob that got far away becomes a plain mob (the recycler then moves it onto the spawn ring like any other).
 */
export function eventUpkeep(e: Enemy, dt: number, dx: number, dy: number, d2: number): boolean {
  const far = d2 > RECYCLE_DIST * RECYCLE_DIST;
  switch (e.ev) {
    case EV_STAMPEDE:
      // dx,dy point at the hero, so the distance travelled past the hero along the march is -(d . v)
      return far || e.age > STAMPEDE_MAX_AGE || -(dx * e.vx + dy * e.vy) > STAMPEDE_EXIT;
    case EV_TREASURE:
      e.evT -= dt;
      return e.evT <= 0 || far;
    case EV_BOX:
      e.evT -= dt;
      return e.evT <= 0 || far;
    case EV_RING:
      if (far) e.ev = 0;
      return false;
    default:
      return false;
  }
}

/** One step of a march (stampede) or a flight (treasure pig); (dx,dy) points at the hero and inv = 1 / its length */
export function eventStep(e: Enemy, dx: number, dy: number, inv: number, stepLen: number) {
  if (e.ev === EV_STAMPEDE) {
    e.x += e.vx * stepLen;
    e.y += e.vy * stepLen;
    e.moving = true;
    if (e.vx !== 0) e.facing = e.vx;
    return;
  }
  // away from the hero, turned by this pig's own angle (vx = cos, vy = sin) so the herd scatters
  const ax = -dx * inv, ay = -dy * inv;
  const mx = ax * e.vx - ay * e.vy, my = ax * e.vy + ay * e.vx;
  e.x += mx * stepLen;
  e.y += my * stepLen;
  e.moving = true;
  if (mx > 0.15) e.facing = 1;
  else if (mx < -0.15) e.facing = -1;
}

/** A Treasure Pig was killed: 5x the coin, and a field item from every TREASURE_FIELD_EVERY-th pig */
export function treasureKilled(sim: Sim, e: Enemy) {
  sim.dropPickup(MESO, e.x, e.y, mesoValue(e.tier) * TREASURE_MESO_MULT);
  if (sim.swarms.pigsKilled++ % TREASURE_FIELD_EVERY === 0) dropField(sim, e.x, e.y + 0.6);
}
