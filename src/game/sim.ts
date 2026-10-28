import {
  BERSERK_AFTER, BOSSES, BOSS_EVERY, LADDER, MAX_GEMS, MAX_PASSIVES, MAX_SKILLS, NOVA_CAST, NOVA_DAMAGE_FRAC, NOVA_EVERY,
  CLASS_BY_KEY, DEFAULT_CLASS, GEAR_BOSS_DROPS, GEAR_DROP_ELITE, GEAR_DROP_NORMAL, GEAR_ELITE_TIER, GEAR_OFFER_SECONDS, GEAR_PICKUP_LIFE, DRAIN_CAP, MISSILE_SPEED, NOVA_RADIUS, PASSIVES, PASSIVE_BY_KEY, PASSIVE_MAX_LEVEL, PLAYER_BASE, RECYCLE_DIST, RUN_LENGTH, SKILLS, SKILL_BY_KEY, SKILL_MAX_LEVEL, WEAKEN_FACTOR, skillDuration, SPAWN_INTERVAL, SPAWN_RING_MAX, SPAWN_RING_MIN, START_BANISHES, START_REROLLS, SUMMON_COUNT, SUMMON_EVERY,
  SUMMON_RING, TICK, aliveTarget, mesoValue, poolLo, progress, xpToNext,
} from './data.ts';
import { SpatialGrid } from './grid.ts';
import { Rng } from './rng.ts';
import { updateSkills, updateProjectiles, updateAreas } from './skills.ts';
import { GEAR_SLOTS, GearPool, itemScore, totalBonus } from './gear.ts';
import type { GearItem, GearSlot } from './gear.ts';
import { BAG, ELIXIR, GEAR, GEM, MESO, POTION } from './types.ts';
import type { ClassDef, SkillDef } from './data.ts';
import type { Area, Card, Enemy, PassiveState, Pickup, PickupKind, Projectile, SimEvent, SkillState } from './types.ts';

export { TICK };

const MAX_EVENTS = 6000;
const MAX_PICKUPS = 700;
const MAX_ENEMIES = 600;

export class Sim {
  rng: Rng;
  seed: number;
  t = 0;
  over = false;
  won = false;
  god = false;

  // player
  px = 0;
  py = 0;
  cls: ClassDef;
  hp = PLAYER_BASE.hp;
  maxHp = PLAYER_BASE.hp;
  /** sim time of the last non-summon skill that fired (the renderer plays the weapon's attack action) */
  lastFire = -99;
  facing = 1;
  /** key of the skill currently dealing damage; carried on 'hit' events so the renderer can pick hit art */
  curSkill = '';
  inputX = 0;
  inputY = 0;
  moving = false;
  damageTaken = 0;
  // derived stats
  might = 1;
  speed = PLAYER_BASE.speed;
  haste = 0;
  armor = 0;
  area = 1;
  magnet = PLAYER_BASE.magnet;
  growth = 1;
  regen = 0;
  crit = PLAYER_BASE.crit;

  level = 1;
  xp = 0;
  xpNeed = xpToNext(1);
  kills = 0;
  mesos = 0;
  bossKills = 0;
  bossesSpawned = 0;

  skills: SkillState[];
  passives: PassiveState[] = [];

  // gear (src/game/gear.ts): drops come from their own seeded stream so that they never shift the run's other random draws
  gearPool: GearPool;
  gender: 0 | 1 = 0;
  equipped: Partial<Record<GearSlot, GearItem>> = {};
  /** an unequipped pickup waiting for E (null = none) */
  gearOffer: { item: GearItem; until: number } | null = null;
  /** last equip / offer for the toast: seq counts up on every change */
  gearToast: { seq: number; item: GearItem; kind: 'equipped' | 'offer'; until: number } | null = null;
  /** equipped set changed: the renderer re-composites the hero when this counts up */
  gearVersion = 0;
  autoEquip = true;
  gearDrops = 0;
  private gearRng: Rng;

  offer: Card[] | null = null;
  pendingLevels = 0;
  rerolls = START_REROLLS;
  banishes = START_BANISHES;
  banished = new Set<string>();

  enemies: Enemy[] = [];
  pickups: Pickup[] = [];
  projectiles: Projectile[] = [];
  areas: Area[] = [];
  events: SimEvent[] = [];
  raidText = '';
  raidUntil = 0;

  gemCount = 0;
  grid = new SpatialGrid(200, 200, 4, MAX_ENEMIES + 80);
  qbuf = new Int32Array(1024);
  qbuf2 = new Int32Array(1024);
  /** scratch results of nearestN */
  sel: Enemy[] = [];
  private candD = new Float64Array(1024);
  private spawnT = 0;
  private enemyPool: Enemy[] = [];
  private pickupPool: Pickup[] = [];
  private projPool: Projectile[] = [];
  private areaPool: Area[] = [];

  constructor(seed = 1, classKey: string = DEFAULT_CLASS, opts: { pool?: GearPool; gender?: 0 | 1; autoEquip?: boolean } = {}) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.gearRng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    this.gearPool = opts.pool ?? GearPool.placeholder();
    this.gender = opts.gender ?? 0;
    this.autoEquip = opts.autoEquip ?? true;
    this.cls = CLASS_BY_KEY[classKey] ?? CLASS_BY_KEY[DEFAULT_CLASS];
    this.skills = [{ key: this.cls.skills[0], level: 1, cd: 0.2 }];
    this.speed = this.cls.speed;
    this.crit = this.cls.crit;
    this.hp = this.maxHp = this.cls.hp;
  }

  // ---- events ----------------------------------------------------------------------------------
  emit(e: SimEvent) {
    if (this.events.length < MAX_EVENTS) this.events.push(e);
  }
  raid(text: string) {
    this.raidText = text;
    this.raidUntil = this.t + 3;
    this.emit({ type: 'raid', text });
  }

  // ---- derived stats ---------------------------------------------------------------------------
  recalc() {
    let might = 1, hpMul = 1, speed = 1, haste = 0, armor = 0, area = 1, magnet = 1, growth = 1, regen = 0, crit = this.cls.crit;
    for (const p of this.passives) {
      const d = PASSIVE_BY_KEY[p.key];
      const v = d.per * p.level;
      switch (d.stat) {
        case 'might': might += v; break;
        case 'maxHp': hpMul += v; break;
        case 'speed': speed += v; break;
        case 'haste': haste += v; break;
        case 'armor': armor += v; break;
        case 'area': area += v; break;
        case 'magnet': magnet += v; break;
        case 'growth': growth += v; break;
        case 'regen': regen += v; break;
        case 'crit': crit += v; break;
      }
    }
    const g = totalBonus(Object.values(this.equipped), this.cls.key);
    might += g.dmg;
    armor += g.armor;
    speed += g.speed;
    this.might = might;
    this.speed = this.cls.speed * speed;
    this.haste = haste;
    this.armor = armor;
    this.area = area;
    this.magnet = PLAYER_BASE.magnet * magnet;
    this.growth = growth;
    this.regen = regen;
    this.crit = crit;
    const newMax = this.cls.hp * hpMul + g.hp;
    if (newMax > this.maxHp) this.hp += newMax - this.maxHp;
    this.maxHp = newMax;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
  }

  // ---- queries ---------------------------------------------------------------------------------
  /** Fills sel with up to n living enemies nearest to (x,y) within range; returns count. */
  nearestN(x: number, y: number, range: number, n: number): number {
    const cnt = this.grid.query(x, y, range, this.qbuf);
    const r2 = range * range;
    let m = 0;
    for (let i = 0; i < cnt; i++) {
      const e = this.enemies[this.qbuf[i]];
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      this.qbuf[m] = this.qbuf[i];
      this.candD[m] = d2;
      m++;
    }
    let found = 0;
    for (; found < n && found < m; found++) {
      let best = found;
      for (let j = found + 1; j < m; j++) if (this.candD[j] < this.candD[best]) best = j;
      const bi = this.qbuf[best], bd = this.candD[best];
      this.qbuf[best] = this.qbuf[found];
      this.candD[best] = this.candD[found];
      this.qbuf[found] = bi;
      this.candD[found] = bd;
      this.sel[found] = this.enemies[bi];
    }
    return found;
  }

  countNear(x: number, y: number, r: number): number {
    const cnt = this.grid.query(x, y, r, this.qbuf2);
    const r2 = r * r;
    let c = 0;
    for (let i = 0; i < cnt; i++) {
      const e = this.enemies[this.qbuf2[i]];
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy <= r2) c++;
    }
    return c;
  }

  // ---- damage ----------------------------------------------------------------------------------
  hit(e: Enemy, base: number) {
    if (!e.alive) return;
    let amt = base * this.might;
    const crit = this.rng.next() < this.crit;
    if (crit) amt *= PLAYER_BASE.critMult;
    amt = Math.max(1, Math.round(amt));
    e.hp -= amt;
    e.flash = 0.08;
    this.emit({ type: 'hit', x: e.x, y: e.y - 0.5, amount: amt, crit, boss: e.boss >= 0, skill: this.curSkill });
    const def = SKILL_BY_KEY[this.curSkill];
    if (def !== undefined && (def.drain || def.stun || def.root || def.weaken)) this.applyEffects(e, def, amt);
    if (e.hp <= 0) this.kill(e);
  }

  /** drain, stun, root and weaken of the skill that dealt the hit (bosses cannot be stunned or rooted) */
  private applyEffects(e: Enemy, def: SkillDef, dealt: number) {
    if (def.drain) this.hp = Math.min(this.maxHp, this.hp + Math.min(DRAIN_CAP, dealt * def.drain));
    let lvl = 1;
    for (let i = 0; i < this.skills.length; i++) if (this.skills[i].key === def.key) { lvl = this.skills[i].level; break; }
    if (e.boss < 0) {
      if (def.stun) e.stunT = Math.max(e.stunT, skillDuration(def.stun, lvl));
      if (def.root) e.rootT = Math.max(e.rootT, skillDuration(def.root, lvl));
    }
    if (def.weaken) e.weakT = Math.max(e.weakT, skillDuration(def.weaken, lvl));
  }

  /** Damages everything within r of (x,y), optionally slowing; returns hit count. */
  areaDamage(x: number, y: number, r: number, base: number, slow = 0): number {
    const cnt = this.grid.query(x, y, r + 3.4, this.qbuf2);
    let n = 0;
    for (let i = 0; i < cnt; i++) {
      const e = this.enemies[this.qbuf2[i]];
      if (!e.alive) continue;
      const dx = e.x - x, dy = e.y - y;
      const rr = r + e.r;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (slow > 0) e.slowT = slow;
      this.hit(e, base);
      n++;
    }
    return n;
  }

  private kill(e: Enemy) {
    e.alive = false;
    this.kills++;
    this.emit({ type: 'death', x: e.x, y: e.y, tier: e.tier, boss: e.boss, big: e.big, facing: e.facing });
    const gv = e.xp * 2 * this.growth;
    if (e.boss >= 0) {
      this.bossKills++;
      const def = BOSSES[e.boss];
      this.emit({ type: 'bossDeath', boss: e.boss, name: def.name, x: e.x, y: e.y });
      this.raid(`${def.name} has been defeated!`);
      this.dropPickup(GEM, e.x, e.y, gv);
      this.dropPickup(ELIXIR, e.x + 1.2, e.y + 0.6, 1);
      this.dropPickup(BAG, e.x - 1.2, e.y + 0.6, 50 * (e.boss + 1));
      for (let k = 0; k < GEAR_BOSS_DROPS; k++) this.dropGear(e.x + (k === 0 ? 1.8 : -1.8), e.y - 0.4, true);
      return;
    }
    this.dropPickup(GEM, e.x, e.y, gv);
    if (this.rng.next() < 0.015) this.dropPickup(POTION, e.x, e.y, 0.25);
    if (this.rng.next() < 0.3) this.dropPickup(MESO, e.x, e.y, mesoValue(e.tier));
    if (this.gearRng.next() < (e.big || e.tier >= GEAR_ELITE_TIER ? GEAR_DROP_ELITE : GEAR_DROP_NORMAL)) this.dropGear(e.x, e.y, false);
  }

  /** Drops a piece of gear for this class at the current run tier. */
  private dropGear(x: number, y: number, boss: boolean) {
    const it = this.gearPool.roll(this.gearRng, this.cls.key, this.gender, this.t);
    if (!it) return;
    this.placeGear(it, x, y, boss);
  }

  private placeGear(it: GearItem, x: number, y: number, boss: boolean) {
    this.gearDrops++;
    const p = this.newPickup(GEAR, x, y, 0);
    p.item = it;
    p.life = GEAR_PICKUP_LIFE;
    this.pickups.push(p);
    this.emit({ type: 'drop', x, y, id: it.id, name: it.name, boss });
  }

  /** Test / bot hook: the item appears in the hero's bag as if picked up. Returns what happened. */
  giveGear(id: string): 'equipped' | 'offered' | 'unknown' {
    const it = this.gearPool.get(id);
    if (!it) return 'unknown';
    return this.gotGear(it);
  }

  /** Picked up: auto-equip a clear upgrade (setting on), else offer it for GEAR_OFFER_SECONDS. */
  private gotGear(it: GearItem): 'equipped' | 'offered' {
    const cur = this.equipped[it.slot];
    const better = !cur || itemScore(it, this.cls.key) > itemScore(cur, this.cls.key);
    if (better && (this.autoEquip || !cur)) {
      this.equip(it, true);
      return 'equipped';
    }
    this.gearOffer = { item: it, until: this.t + GEAR_OFFER_SECONDS };
    this.gearToast = { seq: (this.gearToast?.seq ?? 0) + 1, item: it, kind: 'offer', until: this.t + GEAR_OFFER_SECONDS };
    return 'offered';
  }

  equip(it: GearItem, auto = false) {
    this.equipped[it.slot] = it;
    if (this.gearOffer?.item.slot === it.slot) this.gearOffer = null;
    this.gearVersion++;
    this.gearToast = { seq: (this.gearToast?.seq ?? 0) + 1, item: it, kind: 'equipped', until: this.t + 3 };
    this.recalc();
    this.emit({ type: 'equip', id: it.id, slot: it.slot, auto });
  }

  /** E: wear the offered item. */
  equipOffer(): boolean {
    const o = this.gearOffer;
    if (!o || o.until < this.t) return false;
    this.gearOffer = null;
    this.equip(o.item, false);
    return true;
  }

  /** ids by slot and the summed bonus, for the equip window and the bot hook */
  gearSummary() {
    const ids: Partial<Record<GearSlot, string>> = {};
    for (const s of GEAR_SLOTS) if (this.equipped[s]) ids[s] = this.equipped[s]!.id;
    return { equipped: ids, totals: totalBonus(Object.values(this.equipped), this.cls.key), drops: this.gearDrops };
  }

  private newPickup(kind: PickupKind, x: number, y: number, value: number): Pickup {
    const p = this.pickupPool.pop() ?? { kind, x, y, value, life: 0, pulled: false, item: null };
    p.item = null;
    p.kind = kind; p.x = x; p.y = y; p.value = value; p.pulled = false;
    p.life = kind === POTION || kind === MESO ? 50 : 1e9;
    return p;
  }

  private dropPickup(kind: PickupKind, x: number, y: number, value: number) {
    if (kind === GEM) {
      if (this.gemCount >= MAX_GEMS) {
        let best: Pickup | null = null, bd = 1e18;
        for (let i = 0; i < this.pickups.length; i++) {
          const p = this.pickups[i];
          if (p.kind !== GEM) continue;
          const dx = p.x - x, dy = p.y - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = p; }
        }
        if (best) { best.value += value; return; }
      }
      this.gemCount++;
    } else if (this.pickups.length >= MAX_PICKUPS) {
      // drop the oldest expiring pickup to make room
      for (let i = 0; i < this.pickups.length; i++) {
        const k = this.pickups[i].kind;
        if (k === MESO || k === POTION) { this.removePickup(i); break; }
      }
    }
    this.pickups.push(this.newPickup(kind, x, y, value));
  }

  private removePickup(i: number) {
    const p = this.pickups[i];
    if (p.kind === GEM) this.gemCount--;
    const last = this.pickups.pop()!;
    if (last !== p) this.pickups[i] = last;
    this.pickupPool.push(p);
  }

  // ---- projectile / area allocation (used by skills.ts) -----------------------------------------
  newProjectile(): Projectile {
    const p = this.projPool.pop() ?? {
      speed: MISSILE_SPEED, skill: '', pierce: false, x: 0, y: 0, vx: 0, vy: 0, dmg: 0, life: 0, target: null, splash: 0, pierceLeft: 0,
      hits: new Array<Enemy>(16), nHits: 0, slow: false,
    };
    p.target = null; p.nHits = 0; p.splash = 0; p.slow = false; p.pierce = false; p.speed = MISSILE_SPEED;
    this.projectiles.push(p);
    return p;
  }
  freeProjectile(i: number) {
    const p = this.projectiles[i];
    const last = this.projectiles.pop()!;
    if (last !== p) this.projectiles[i] = last;
    p.target = null;
    this.projPool.push(p);
  }
  newArea(): Area {
    const a = this.areaPool.pop() ?? { skill: '', x: 0, y: 0, r: 0, t: 0, dur: 0, tick: 0, dmg: 0 };
    this.areas.push(a);
    return a;
  }
  freeArea(i: number) {
    const a = this.areas[i];
    const last = this.areas.pop()!;
    if (last !== a) this.areas[i] = last;
    this.areaPool.push(a);
  }

  // ---- enemies ---------------------------------------------------------------------------------
  private spawnEnemy(tier: number, x: number, y: number, add: boolean): Enemy {
    const d = LADDER[tier];
    const p = progress(this.t);
    const e = this.enemyPool.pop() ?? ({} as Enemy);
    e.x = x; e.y = y;
    e.maxHp = e.hp = d.hp * (1 + 0.75 * p);
    e.speed = d.speed;
    e.dmg = d.dmg * (1 + 0.9 * p);
    e.r = d.big ? 1.0 : 0.6;
    e.xp = d.xp;
    e.tier = tier; e.boss = -1; e.big = d.big; e.add = add; e.alive = true;
    e.hitCd = 0.5; e.slowT = 0; e.stunT = 0; e.rootT = 0; e.weakT = 0; e.flash = 0; e.facing = 1; e.phase = this.rng.next() * 6.28;
    e.moving = true; e.berserk = false; e.age = 0; e.novaT = 0; e.castT = 0; e.summonT = 0; e.idx = -1;
    this.enemies.push(e);
    return e;
  }

  private spawnBoss(n: number) {
    const def = BOSSES[n];
    const p = progress(this.t);
    const a = this.rng.range(0, Math.PI * 2);
    const dist = this.rng.range(SPAWN_RING_MIN, SPAWN_RING_MAX);
    const e = this.enemyPool.pop() ?? ({} as Enemy);
    e.x = this.px + Math.cos(a) * dist; e.y = this.py + Math.sin(a) * dist;
    e.maxHp = e.hp = def.hp * (1 + 0.75 * p);
    e.speed = def.speed;
    e.dmg = def.dmg * (1 + 0.9 * p);
    e.r = 1.6 * def.scale;
    e.xp = def.xp;
    e.tier = LADDER.length - 1; e.boss = n; e.big = true; e.add = false; e.alive = true;
    e.hitCd = 1.0; e.slowT = 0; e.stunT = 0; e.rootT = 0; e.weakT = 0; e.flash = 0; e.facing = 1; e.phase = 0; e.moving = true; e.berserk = false; e.age = 0;
    e.novaT = NOVA_EVERY; e.castT = 0; e.summonT = SUMMON_EVERY; e.idx = -1;
    this.enemies.push(e);
    this.emit({ type: 'bossSpawn', boss: n, name: def.name, x: e.x, y: e.y });
    this.raid(`${def.name} approaches!`);
  }

  /** Seconds until the next boss spawns, or -1 when all six are out. */
  nextBossIn(): number {
    if (this.bossesSpawned >= BOSSES.length) return -1;
    return BOSS_EVERY * (this.bossesSpawned + 1) - this.t;
  }
  /** Oldest living boss, or null. */
  activeBoss(): Enemy | null {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.alive && e.boss >= 0) return e;
    }
    return null;
  }

  private spawner(dt: number) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT += SPAWN_INTERVAL;
    if (this.spawnT < 0) this.spawnT = 0;
    const target = aliveTarget(this.t);
    const alive = this.enemies.length;
    if (alive >= target || alive >= MAX_ENEMIES - 20) return;
    const n = Math.min(4, target - alive);
    const lo = poolLo(this.t);
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(SPAWN_RING_MIN, SPAWN_RING_MAX);
    const cx = this.px + Math.cos(a) * d, cy = this.py + Math.sin(a) * d;
    for (let i = 0; i < n; i++) {
      this.spawnEnemy(lo + this.rng.int(3), cx + this.rng.range(-1.6, 1.6), cy + this.rng.range(-1.6, 1.6), false);
    }
  }

  private hurtPlayer(amount: number, x: number, y: number) {
    this.damageTaken += amount;
    this.emit({ type: 'playerHit', x, y, amount });
    if (this.god) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.finish(false);
    }
  }

  private finish(won: boolean) {
    if (this.over) return;
    this.over = true;
    this.won = won;
    this.offer = null;
    this.emit({ type: 'end', won });
  }

  private updateEnemies(dt: number) {
    const enemies = this.enemies;
    const px = this.px, py = this.py;
    const grid = this.grid;
    const buf = this.qbuf;
    const pr = PLAYER_BASE.radius;
    const mvx = this.inputX, mvy = this.inputY;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      e.age += dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.hitCd > 0) e.hitCd -= dt;
      let sp = e.speed;
      if (e.slowT > 0) { e.slowT -= dt; sp *= 0.5; }
      if (e.stunT > 0) e.stunT -= dt;
      if (e.rootT > 0) e.rootT -= dt;
      if (e.weakT > 0) e.weakT -= dt;
      let dx = px - e.x, dy = py - e.y;
      let d2 = dx * dx + dy * dy;

      // recycle far enemies back onto the spawn ring
      if (d2 > RECYCLE_DIST * RECYCLE_DIST) {
        const base = this.moving ? Math.atan2(mvy, mvx) + this.rng.range(-1.0, 1.0) : this.rng.range(0, Math.PI * 2);
        const dist = this.rng.range(SPAWN_RING_MIN, SPAWN_RING_MAX);
        e.x = px + Math.cos(base) * dist;
        e.y = py + Math.sin(base) * dist;
        dx = px - e.x; dy = py - e.y; d2 = dx * dx + dy * dy;
      }

      const isBoss = e.boss >= 0;
      let canMove = e.stunT <= 0 && e.rootT <= 0;
      if (isBoss) {
        const def = BOSSES[e.boss];
        if (def.berserk && !e.berserk && e.age >= BERSERK_AFTER) {
          e.berserk = true;
          e.dmg *= 2;
          e.speed *= 1.4;
          this.raid(`${def.name} goes berserk!`);
        }
        if (def.nova) {
          if (e.castT > 0) {
            canMove = false;
            e.castT -= dt;
            if (e.castT <= 0) {
              e.castT = 0;
              e.novaT = NOVA_EVERY;
              const inside = d2 < NOVA_RADIUS * NOVA_RADIUS;
              this.emit({ type: 'novaHit', x: e.x, y: e.y, r: NOVA_RADIUS, hit: inside });
              if (inside) this.hurtPlayer(this.maxHp * NOVA_DAMAGE_FRAC, px, py);
            }
          } else {
            e.novaT -= dt;
            if (e.novaT <= 0) {
              e.castT = NOVA_CAST;
              this.raid(`${def.name} is casting Ground Slam! Get out!`);
            }
          }
        }
        if (def.summon) {
          e.summonT -= dt;
          if (e.summonT <= 0) {
            e.summonT = SUMMON_EVERY;
            this.raid(`${def.name} calls for help!`);
            const top = poolLo(this.t) + 2;
            for (let k = 0; k < SUMMON_COUNT && enemies.length < MAX_ENEMIES + 40; k++) {
              const a = (k / SUMMON_COUNT) * Math.PI * 2;
              this.spawnEnemy(top, e.x + Math.cos(a) * SUMMON_RING, e.y + Math.sin(a) * SUMMON_RING, true);
            }
          }
        }
      }

      e.moving = false;
      if (canMove && d2 > 0.0001) {
        const inv = 1 / Math.sqrt(d2);
        const stepLen = sp * dt;
        if (d2 > (e.r + pr) * (e.r + pr) * 0.6) {
          e.x += dx * inv * stepLen;
          e.y += dy * inv * stepLen;
          e.moving = true;
        }
        if (dx > 0.15) e.facing = 1;
        else if (dx < -0.15) e.facing = -1;
      }

      // soft separation from neighbours
      if (!isBoss) {
        const cnt = grid.query(e.x, e.y, e.r + 1.0, buf);
        for (let k = 0; k < cnt; k++) {
          const j = buf[k];
          if (j === e.idx) continue;
          const o = enemies[j];
          if (!o.alive) continue;
          const ox = e.x - o.x, oy = e.y - o.y;
          const rr = e.r + o.r;
          const dd = ox * ox + oy * oy;
          if (dd >= rr * rr * 0.64) continue;
          const dist = Math.sqrt(dd) || 0.001;
          const push = (rr * 0.8 - dist) * (o.boss >= 0 ? 0.6 : 0.3);
          e.x += (ox / dist) * push;
          e.y += (oy / dist) * push;
        }
      }

      // contact
      dx = px - e.x; dy = py - e.y;
      const rr = e.r + pr;
      if (dx * dx + dy * dy < rr * rr && e.hitCd <= 0 && e.stunT <= 0) {
        e.hitCd = isBoss ? 1.0 : 1.3;
        this.hurtPlayer(Math.max(1, (e.weakT > 0 ? e.dmg * WEAKEN_FACTOR : e.dmg) - this.armor), px, py);
        if (this.over) return;
      }
    }
  }

  private updatePickups(dt: number) {
    const px = this.px, py = this.py;
    const m2 = this.magnet * this.magnet;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt;
      if (p.life <= 0) { this.removePickup(i); continue; }
      const dx = px - p.x, dy = py - p.y;
      const d2 = dx * dx + dy * dy;
      if (!p.pulled && d2 < m2) p.pulled = true;
      if (p.pulled) {
        const d = Math.sqrt(d2) || 0.001;
        const step = Math.min(d, (13 + this.speed) * dt);
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      if (d2 < 0.8 * 0.8) {
        this.collect(p);
        this.removePickup(i);
      }
    }
  }

  private collect(p: Pickup) {
    this.emit({ type: 'pickup', kind: p.kind, x: p.x, y: p.y, value: p.value });
    switch (p.kind) {
      case GEM: this.addXp(p.value); break;
      case POTION: this.hp = Math.min(this.maxHp, this.hp + this.maxHp * p.value); break;
      case ELIXIR: this.hp = this.maxHp; break;
      case MESO: case BAG: this.mesos += p.value; break;
      case GEAR: if (p.item) this.gotGear(p.item); break;
    }
  }

  // ---- levelling & cards -----------------------------------------------------------------------
  private addXp(v: number) {
    this.xp += v;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = xpToNext(this.level);
      this.pendingLevels++;
      this.emit({ type: 'levelUp', level: this.level });
    }
  }

  private candidates(exclude: Card[] | null): Card[] {
    const out: Card[] = [];
    const skip = (k: string) => this.banished.has(k) || (exclude !== null && exclude.some((c) => c.key === k));
    for (const s of SKILLS) {
      if (skip(s.key) || !this.cls.skills.includes(s.key)) continue;
      const own = this.skills.find((o) => o.key === s.key);
      if (own) {
        if (own.level < SKILL_MAX_LEVEL) out.push({ kind: 'skill', key: s.key, name: s.name, isNew: false, from: own.level, to: own.level + 1, desc: s.desc });
      } else if (this.skills.length < MAX_SKILLS) {
        out.push({ kind: 'skill', key: s.key, name: s.name, isNew: true, from: 0, to: 1, desc: s.desc });
      }
    }
    for (const p of PASSIVES) {
      if (skip(p.key) || (p.cls !== undefined && p.cls !== this.cls.key)) continue;
      const own = this.passives.find((o) => o.key === p.key);
      if (own) {
        if (own.level < PASSIVE_MAX_LEVEL) out.push({ kind: 'passive', key: p.key, name: p.name, isNew: false, from: own.level, to: own.level + 1, desc: p.desc });
      } else if (this.passives.length < MAX_PASSIVES) {
        out.push({ kind: 'passive', key: p.key, name: p.name, isNew: true, from: 0, to: 1, desc: p.desc });
      }
    }
    return out;
  }

  private fillers(): Card[] {
    return [
      { kind: 'elixir', key: 'elixir', name: 'Elixir', isNew: false, from: 0, to: 0, desc: 'Fully restores your HP.' },
      { kind: 'meso', key: 'mesobag', name: 'Meso Bag', isNew: false, from: 0, to: 0, desc: 'Gain 25 mesos.' },
    ];
  }

  private drawOffer(): Card[] {
    const pool = this.candidates(null);
    if (pool.length === 0) return this.fillers();
    const out: Card[] = [];
    while (out.length < 3 && pool.length > 0) out.push(pool.splice(this.rng.int(pool.length), 1)[0]);
    return out;
  }

  private openOffer() {
    if (this.offer || this.pendingLevels <= 0 || this.over) return;
    this.pendingLevels--;
    this.offer = this.drawOffer();
  }

  reroll(): boolean {
    if (!this.offer || this.rerolls <= 0) return false;
    this.rerolls--;
    this.offer = this.drawOffer();
    return true;
  }

  banish(i: number): boolean {
    if (!this.offer || this.banishes <= 0 || i < 0 || i >= this.offer.length) return false;
    const c = this.offer[i];
    if (c.kind === 'elixir' || c.kind === 'meso') return false;
    this.banishes--;
    this.banished.add(c.key);
    const pool = this.candidates(this.offer);
    if (pool.length > 0) this.offer[i] = pool[this.rng.int(pool.length)];
    else this.offer.splice(i, 1);
    if (this.offer.length === 0) this.offer = this.drawOffer();
    return true;
  }

  pick(i: number): boolean {
    const o = this.offer;
    if (!o || i < 0 || i >= o.length) return false;
    const c = o[i];
    this.offer = null;
    if (c.kind === 'skill') {
      const own = this.skills.find((s) => s.key === c.key);
      if (own) own.level++;
      else this.skills.push({ key: c.key, level: 1, cd: 0.3 });
    } else if (c.kind === 'passive') {
      const own = this.passives.find((s) => s.key === c.key);
      if (own) own.level++;
      else this.passives.push({ key: c.key, level: 1 });
      this.recalc();
    } else if (c.kind === 'elixir') {
      this.hp = this.maxHp;
    } else {
      this.mesos += 25;
    }
    this.openOffer();
    return true;
  }

  // ---- main tick -------------------------------------------------------------------------------
  setInput(x: number, y: number) {
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.inputX = x;
    this.inputY = y;
    this.moving = l > 0.05;
  }

  /** Advance one fixed step. Returns false (and does nothing) while a card offer is open or the run is over. */
  tick(dt = TICK): boolean {
    if (this.over) return false;
    this.openOffer();
    if (this.offer) return false;

    this.t += dt;
    if (this.t >= RUN_LENGTH) {
      this.t = RUN_LENGTH;
      this.finish(true);
      return true;
    }

    // player
    if (this.moving) {
      this.px += this.inputX * this.speed * dt;
      this.py += this.inputY * this.speed * dt;
      if (this.inputX > 0.1) this.facing = 1;
      else if (this.inputX < -0.1) this.facing = -1;
    }
    if (this.regen > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);

    // spatial index
    const enemies = this.enemies;
    this.grid.recenter(this.px, this.py);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      e.idx = i;
      if (e.alive) this.grid.insert(i, e.x, e.y);
    }

    // bosses on the clock
    while (this.bossesSpawned < BOSSES.length && this.t >= BOSS_EVERY * (this.bossesSpawned + 1)) {
      this.spawnBoss(this.bossesSpawned);
      this.bossesSpawned++;
    }
    this.spawner(dt);
    this.updateEnemies(dt);
    if (this.over) return true;

    updateSkills(this, dt);
    updateProjectiles(this, dt);
    updateAreas(this, dt);
    this.updatePickups(dt);

    // compact dead enemies
    let w = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.alive) enemies[w++] = e;
      else this.enemyPool.push(e);
    }
    enemies.length = w;

    this.openOffer();
    return true;
  }

  snapshot() {
    const b = this.activeBoss();
    return {
      cls: this.cls.key,
      elapsed: this.t,
      hp: this.hp,
      maxHp: this.maxHp,
      level: this.level,
      xp: this.xp,
      xpNeed: this.xpNeed,
      kills: this.kills,
      mesos: this.mesos,
      alive: this.enemies.length,
      x: this.px,
      y: this.py,
      boss: b ? { index: b.boss, name: BOSSES[b.boss].name, hp: b.hp, maxHp: b.maxHp, x: b.x, y: b.y, casting: b.castT > 0, berserk: b.berserk } : null,
      bossesSpawned: this.bossesSpawned,
      bossKills: this.bossKills,
      nextBossIn: this.nextBossIn(),
      skills: this.skills.map((s) => ({ key: s.key, level: s.level })),
      passives: this.passives.map((s) => ({ key: s.key, level: s.level })),
      offer: this.offer ? this.offer.map((c) => ({ key: c.key, name: c.name, isNew: c.isNew, from: c.from, to: c.to })) : null,
      rerolls: this.rerolls,
      banishes: this.banishes,
      over: this.over,
      won: this.won,
    };
  }
}
