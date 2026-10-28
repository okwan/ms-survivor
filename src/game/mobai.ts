/**
 * Mob behaviours (MapleStory mobs do more than walk at you) and the boss ailment cast. Ladder tiers carry a `behave` (data.ts):
 * - ranged: walks in until 9 to 12 yd from the hero, stops, and every 2.5 to 3.5 s (jittered) shoots one slow projectile (8 to 10 yd/s) at the
 *   hero's position at that moment. It hurts on touch (mob damage x0.8) and expires after about 2 s. Curse Eyes and Wraiths shoot an ailment
 *   with it (25%, decided when the shot leaves, so it can be drawn tinted). At most MAX_SHOOTERS ranged mobs shoot at once; the others walk.
 * - charge: walks normally; 6 to 12 yd away it stands still for 0.6 s (a line shows where it will go), dashes straight along it at 3x speed for
 *   0.7 s, then rests for 3 s. A hero who steps aside is missed.
 * Flyers (`fly`) skip the crowding the walkers use. Bosses, swarm-event mobs and boxes never use a behaviour; Elites keep the one of their tier.
 * A boss with an `ailments` mechanic (data.ts) casts every 16 s: 1.2 s of a big purple circle around itself, then every ailment of the boss
 * lands on a hero standing inside it. The sim keeps all of this behind `mobAi` (false = the old walk-only mobs, the baseline of balance-mobs.ts).
 * Own seeded random stream, so the run's other draws never shift. Pure (no DOM), no per-frame allocation (shots are pooled).
 */
import { LADDER, PLAYER_BASE, WEAKEN_FACTOR } from './data.ts';
import type { BossDef } from './data.ts';
import { AILMENTS, applyAilment } from './ailments.ts';
import { Rng } from './rng.ts';
import type { Sim } from './sim.ts';
import { BEH_CHARGE, BEH_RANGED, CHARGE_DASH, CHARGE_IDLE, CHARGE_TELEGRAPH } from './types.ts';
import type { Enemy, EnemyShot } from './types.ts';

/** ranged: a mob within RANGED_ADMIT yd may become a shooter (while fewer than MAX_SHOOTERS are); it stops RANGED_STOP_MIN..MAX yd away and shoots when within RANGED_FIRE yd */
export const MAX_SHOOTERS = 25;
export const RANGED_ADMIT = 26;
export const RANGED_STOP_MIN = 9;
export const RANGED_STOP_MAX = 12;
export const RANGED_FIRE = 20;
export const SHOT_GAP_MIN = 2.5;
export const SHOT_GAP_MAX = 3.5;
/** a mob that just stopped to shoot fires its first shot after this many seconds (range), so it gets to shoot before it is killed */
export const SHOT_FIRST_MIN = 0.6;
export const SHOT_FIRST_MAX = 1.4;
export const SHOT_SPEED_MIN = 8;
export const SHOT_SPEED_MAX = 10;
export const SHOT_LIFE = 2;
/** shot damage as a fraction of the mob's contact damage, shot radius in yd (the hero adds their own), chance a Curse Eye / Wraith shot carries its ailment */
export const SHOT_DMG = 0.8;
export const SHOT_RADIUS = 0.9;
export const MOB_SHOT_AIL_CHANCE = 0.25;
/** seconds the shooter holds its attack pose after a shot; shots alive at once at most */
export const SHOT_POSE = 0.5;
const MAX_SHOTS = 64;

/** charge: starts 6 to 12 yd from the hero, telegraphs for CHARGE_TELEGRAPH s, dashes CHARGE_DASH s at CHARGE_SPEED x its speed, then waits CHARGE_COOLDOWN s */
export const CHARGE_MIN = 6;
export const CHARGE_MAX = 12;
export const CHARGE_TELEGRAPH_TIME = 0.6;
export const CHARGE_DASH_TIME = 0.7;
export const CHARGE_SPEED = 3;
export const CHARGE_COOLDOWN = 3;

/** boss ailment mechanic: a cast every AIL_EVERY s (the first one that long after the boss appears), AIL_CAST s of warning, a circle of AIL_RADIUS yd */
export const AIL_EVERY = 16;
export const AIL_CAST = 1.2;
export const AIL_RADIUS = 8;

/** what the sim does with the mob this frame (mobBehave's answer) */
export const MOVE_WALK = 0, MOVE_HOLD = 1, MOVE_DASH = 2;

export class MobAi {
  rng: Rng;
  shots: EnemyShot[] = [];
  private pool: EnemyShot[] = [];
  /** ranged mobs that shoot right now (recounted by the sim every tick) */
  shooters = 0;
  fired = 0;
  hits = 0;
  charges = 0;

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x6a09e667) >>> 0);
  }

  newShot(): EnemyShot {
    const s = this.pool.pop() ?? { x: 0, y: 0, vx: 0, vy: 0, life: 0, age: 0, dmg: 0, tier: 0, ail: 0 };
    this.shots.push(s);
    return s;
  }
  freeShot(i: number) {
    const s = this.shots[i];
    const last = this.shots.pop()!;
    if (last !== s) this.shots[i] = last;
    this.pool.push(s);
  }
}

/** A fresh enemy (normal spawn or boss): clears the behaviour fields and gives a normal mob the behaviour of its tier. */
export function resetMob(sim: Sim, e: Enemy, boss: boolean) {
  e.behave = 0; e.fly = false; e.shooter = false; e.bS = 0; e.bT = 0; e.bx = 0; e.by = 0; e.bd = 0; e.atk = 0; e.ailT = 0; e.ailC = 0;
  if (!sim.mobAi) return;
  if (boss) { e.ailT = AIL_EVERY; return; }
  const d = LADDER[e.tier];
  e.fly = d.fly;
  if (d.behave === 'ranged') e.behave = BEH_RANGED;
  else if (d.behave === 'charge') {
    e.behave = BEH_CHARGE;
    // desynchronise a pack so they do not all rush on the same frame
    e.bT = sim.mobs.rng.range(0, CHARGE_COOLDOWN);
  }
}

/**
 * Upkeep of a behaving mob (never called for bosses or event mobs): decides how it moves this frame and starts its attacks.
 * (dx,dy) points at the hero and d2 is the squared distance.
 */
export function mobBehave(sim: Sim, e: Enemy, dt: number, d2: number, dx: number, dy: number, canMove: boolean): number {
  if (e.atk > 0) e.atk = Math.max(0, e.atk - dt);
  const m = sim.mobs;
  if (e.behave === BEH_RANGED) {
    if (!e.shooter) {
      if (!canMove || d2 > RANGED_ADMIT * RANGED_ADMIT || m.shooters >= MAX_SHOOTERS) return MOVE_WALK;
      e.shooter = true;
      m.shooters++;
      e.bd = m.rng.range(RANGED_STOP_MIN, RANGED_STOP_MAX);
      e.bT = m.rng.range(SHOT_FIRST_MIN, SHOT_FIRST_MAX);
    }
    if (!canMove) return MOVE_WALK;
    if (e.bT > 0) e.bT -= dt;
    if (e.bT <= 0 && d2 <= RANGED_FIRE * RANGED_FIRE) {
      shoot(sim, e, dx, dy, d2);
      e.bT = m.rng.range(SHOT_GAP_MIN, SHOT_GAP_MAX);
    }
    return d2 <= e.bd * e.bd ? MOVE_HOLD : MOVE_WALK;
  }
  // charge
  if (!canMove) {
    // stunned, rooted or frozen mid-rush: the rush is off
    if (e.bS !== CHARGE_IDLE) { e.bS = CHARGE_IDLE; e.bT = CHARGE_COOLDOWN; e.atk = 0; }
    return MOVE_WALK;
  }
  switch (e.bS) {
    case CHARGE_IDLE:
      if (e.bT > 0) e.bT -= dt;
      if (e.bT <= 0 && d2 >= CHARGE_MIN * CHARGE_MIN && d2 <= CHARGE_MAX * CHARGE_MAX) {
        const inv = 1 / Math.sqrt(d2);
        e.bx = dx * inv; e.by = dy * inv;
        e.bS = CHARGE_TELEGRAPH;
        e.bT = CHARGE_TELEGRAPH_TIME;
        e.atk = CHARGE_TELEGRAPH_TIME + CHARGE_DASH_TIME;
        e.facing = e.bx >= 0 ? 1 : -1;
        m.charges++;
      }
      return MOVE_WALK;
    case CHARGE_TELEGRAPH:
      e.bT -= dt;
      if (e.bT <= 0) { e.bS = CHARGE_DASH; e.bT = CHARGE_DASH_TIME; }
      return MOVE_HOLD;
    default:
      e.bT -= dt;
      if (e.bT <= 0) { e.bS = CHARGE_IDLE; e.bT = CHARGE_COOLDOWN; e.atk = 0; }
      return MOVE_DASH;
  }
}

/** One step of a held or dashing mob (the sim calls it instead of walking at the hero) */
export function behaveStep(e: Enemy, mode: number, dx: number, stepLen: number) {
  if (mode === MOVE_DASH) {
    e.x += e.bx * stepLen * CHARGE_SPEED;
    e.y += e.by * stepLen * CHARGE_SPEED;
    e.moving = true;
    e.facing = e.bx >= 0 ? 1 : -1;
    return;
  }
  // holding (a shooter at range, a charger telegraphing): stand and face the hero (a telegraphing charger faces its line)
  if (e.bS === CHARGE_TELEGRAPH) return;
  if (dx > 0.15) e.facing = 1;
  else if (dx < -0.15) e.facing = -1;
}

/** The ranged mob shoots one projectile at the hero's position right now */
function shoot(sim: Sim, e: Enemy, dx: number, dy: number, d2: number) {
  const m = sim.mobs;
  if (m.shots.length >= MAX_SHOTS) return;
  const s = m.newShot();
  const spd = m.rng.range(SHOT_SPEED_MIN, SHOT_SPEED_MAX);
  // standing on the hero: shoot the way the mob faces
  const onTop = d2 < 0.0001, inv = onTop ? 0 : 1 / Math.sqrt(d2);
  s.x = e.x; s.y = e.y;
  s.vx = (onTop ? e.facing : dx * inv) * spd; s.vy = onTop ? 0 : dy * inv * spd;
  s.life = SHOT_LIFE; s.age = 0;
  s.dmg = (e.weakT > 0 ? e.dmg * WEAKEN_FACTOR : e.dmg) * SHOT_DMG;
  s.tier = e.tier;
  const ail = LADDER[e.tier].shotAil;
  s.ail = ail !== 0 && m.rng.next() < MOB_SHOT_AIL_CHANCE ? ail : 0;
  e.atk = SHOT_POSE;
  e.facing = dx >= 0 ? 1 : -1;
  m.fired++;
}

/** Shots fly, hit the hero or expire (they freeze with the Ludibrium Clock like every other mob) */
export function updateShots(sim: Sim, dt: number) {
  const m = sim.mobs;
  const shots = m.shots;
  if (shots.length === 0 || sim.field.clockT > 0) return;
  const px = sim.px, py = sim.py;
  const rr = (SHOT_RADIUS + PLAYER_BASE.radius) * (SHOT_RADIUS + PLAYER_BASE.radius);
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.life -= dt;
    s.age += dt;
    if (s.life <= 0) { m.freeShot(i); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const dx = px - s.x, dy = py - s.y;
    if (dx * dx + dy * dy > rr) continue;
    m.hits++;
    const ail = s.ail;
    sim.hurtPlayer(Math.max(1, s.dmg - sim.armor), px, py);
    if (ail !== 0) applyAilment(sim, ail);
    m.freeShot(i);
    if (sim.over) return;
  }
}

/**
 * A boss with an ailment mechanic: the cast timer runs, a cast shows the circle for AIL_CAST s (the boss stands still), then every ailment of
 * the boss lands if the hero is inside. The Ground Slam has priority (the timers wait while it casts). True while the boss is casting.
 */
export function bossAilment(sim: Sim, e: Enemy, def: BossDef, dt: number, d2: number): boolean {
  if (e.castT > 0) return false;
  if (e.ailC > 0) {
    e.ailC -= dt;
    if (e.ailC > 0) return true;
    e.ailC = 0;
    e.ailT = AIL_EVERY;
    const inside = d2 < AIL_RADIUS * AIL_RADIUS;
    sim.emit({ type: 'ailHit', x: e.x, y: e.y, r: AIL_RADIUS, hit: inside });
    if (inside) for (let i = 0; i < def.ailments.length; i++) applyAilment(sim, def.ailments[i]);
    return false;
  }
  e.ailT -= dt;
  if (e.ailT > 0) return false;
  e.ailC = AIL_CAST;
  sim.raid(`${def.name} casts ${def.ailments.map((a) => AILMENTS[a - 1].name).join(' and ')}!`);
  return true;
}
