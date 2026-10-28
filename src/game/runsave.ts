/**
 * Mid-run checkpoint: the build of the hero (level, xp, skills, passives, gear, jobs, rerolls) plus the run clock, enough to
 * resume a run after closing the tab. Deliberately NOT a world dump: enemies, pickups, projectiles, the spatial grid and the
 * RNG streams are not saved, the resumed run starts with a fresh wave around the hero. Pure (no DOM); storage is src/ui/save.ts.
 *
 * Bosses: `bossesSpawned` is saved as the number of waves that are cleared, a wave being cleared once its lead boss is dead. A wave
 * whose lead was still alive is spawned again, whole, right after the resume (the tick loop spawns while t >= BOSS_EVERY*(n+1)), so a
 * partly killed multi-boss wave comes back at full strength; companions of an already dead lead are lost. If a later wave was
 * already cleared by then (they are 135 s apart, so rare) it is spawned and rewarded again. `bossKills` is not touched.
 * Kept so timed events do not replay: the elite, swarm and field-box schedules and counters. Shop (meta) ranks are not stored: they come
 * from the main save when the Sim is constructed. Not saved: enemies, pickups, an open gear offer, timed buffs (coupon, elixir, ailments).
 * An open card offer is simply drawn again from `pendingLevels` / `pendingJob`.
 */
import {
  BOSSES, BOSS_EVERY, DIFFICULTIES, CLASS_BY_KEY, MASTERIES, MASTERY_BY_KEY, MAX_PASSIVES, MAX_SKILLS, PASSIVE_BY_KEY, PASSIVE_MAX_LEVEL, RUN_LENGTH, SKILL_BY_KEY, SKILL_MAX_LEVEL,
  START_BANISHES, START_REROLLS, masteryMax, unlockedJobs, xpToNext,
} from './data.ts';
import type { MasteryKey } from './data.ts';
import { RECIPES } from './evolutions.ts';
import { sanitizeBook } from './book.ts';
import type { BookData } from './book.ts';
import { BAG_SIZE, GEAR_SLOTS } from './gear.ts';
import type { GearItem, GearSlot, GearStats, ItemUpgrade } from './gear.ts';
import { regionAt } from './regions.ts';
import type { Sim } from './sim.ts';

/** A worn item: the pool id plus what scrolls did to it (the rest is rebuilt from the GearPool). */
export interface SavedGear {
  id: string;
  up?: ItemUpgrade;
}

export interface RunSave {
  v: 1;
  seed: number;
  cls: string;
  /** difficulty tier the run is played on (DIFFICULTIES index; missing = Normal) */
  difficulty?: number;
  /** run clock in seconds */
  t: number;
  level: number;
  xp: number;
  hp: number;
  kills: number;
  mesos: number;
  mesoCarry: number;
  reviveUsed: boolean;
  /** boss waves fully cleared (see the header) */
  bossesSpawned: number;
  bossKills: number;
  damageTaken: number;
  gearDrops: number;
  scrollDrops: number;
  skills: { key: string; level: number }[];
  passives: { key: string; level: number }[];
  equipped: Partial<Record<GearSlot, SavedGear>>;
  /** unequipped items carried, oldest first */
  bag: SavedGear[];
  masteryLv: Record<string, number>;
  skillMastery: Record<string, number>;
  /** schedules and counters of elites, swarm events and field boxes */
  elites: { nextAt: number; pending: boolean; spawned: number; killed: number };
  swarms: { nextAt: number; started: number[]; pigsKilled: number };
  field: { nextBox: number; boxesBroken: number; itemsUsed: number };
  branch: number;
  pendingLevels: number;
  pendingJob: boolean;
  rerolls: number;
  banishes: number;
  banished: string[];
  /** the run's Monster Book (the save's book at the start plus this run's kills) */
  book: BookData;
  /** Date.now() at capture */
  savedAt: number;
}

const savedGear = (it: GearItem): SavedGear => (it.up ? { id: it.id, up: { plus: it.up.plus, left: it.up.left, stats: { ...it.up.stats } } } : { id: it.id });
const STAT_KEYS: (keyof GearStats)[] = ['pad', 'mad', 'pdd', 'mdd', 'mhp', 'mmp', 'speed', 'str', 'dex', 'int', 'luk'];
const MAX_COUNT = 1e9;

/** Snapshot of the hero's build and the run clock. */
export function captureRun(sim: Sim): RunSave {
  const equipped: RunSave['equipped'] = {};
  for (const s of GEAR_SLOTS) {
    const it = sim.equipped[s];
    if (it) equipped[s] = savedGear(it);
  }
  let cleared = sim.bossesSpawned;
  for (const e of sim.enemies) if (e.alive && e.boss >= 0 && e.lead && e.boss < cleared) cleared = e.boss;
  return {
    v: 1, seed: sim.seed, cls: sim.cls.key, difficulty: sim.difficulty, t: sim.t, level: sim.level, xp: sim.xp, hp: sim.hp, kills: sim.kills, mesos: sim.mesos,
    mesoCarry: sim.mesoCarry, reviveUsed: sim.reviveUsed, bossesSpawned: cleared, bossKills: sim.bossKills, damageTaken: sim.damageTaken, gearDrops: sim.gearDrops, scrollDrops: sim.scrollDrops,
    skills: sim.skills.map((s) => ({ key: s.key, level: s.level })),
    passives: sim.passives.map((p) => ({ key: p.key, level: p.level })),
    equipped, bag: sim.bag.map(savedGear), masteryLv: { ...sim.masteryLv }, skillMastery: { ...sim.skillMastery },
    elites: { nextAt: sim.elites.nextAt, pending: sim.elites.pending, spawned: sim.elites.spawned, killed: sim.elites.killed },
    swarms: { nextAt: sim.swarms.nextAt, started: [...sim.swarms.started], pigsKilled: sim.swarms.pigsKilled },
    field: { nextBox: sim.field.nextBox, boxesBroken: sim.field.boxesBroken, itemsUsed: sim.field.itemsUsed },
    branch: sim.branch, pendingLevels: sim.pendingLevels, pendingJob: sim.pendingJob,
    rerolls: sim.rerolls, banishes: sim.banishes, banished: [...sim.banished], book: { ...sim.book }, savedAt: Date.now(),
  };
}

const num = (v: unknown, lo: number, hi: number, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def);
const int = (v: unknown, lo: number, hi: number, def: number): number => Math.floor(num(v, lo, hi, def));

function sanitizeUp(raw: unknown): ItemUpgrade | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Partial<ItemUpgrade>;
  const stats: GearStats = {};
  if (o.stats && typeof o.stats === 'object') {
    for (const k of STAT_KEYS) {
      const v = (o.stats as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) stats[k] = Math.max(-1000, Math.min(1000, v));
    }
  }
  return { plus: int(o.plus, 0, 50, 0), left: int(o.left, 0, 50, 0), stats };
}

function sanitizeGear(raw: unknown): SavedGear | null {
  const g = raw as { id?: unknown; up?: unknown } | null;
  if (!g || typeof g.id !== 'string' || g.id.length > 32) return null;
  const up = sanitizeUp(g.up);
  return up ? { id: g.id, up } : { id: g.id };
}

const sanitizeCounts = (raw: unknown, valid: (k: string) => boolean, max: (k: string) => number): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (valid(k) && typeof v === 'number') out[k] = int(v, 0, max(k), 0);
  return out;
};

function sanitizeLevels(raw: unknown, valid: (k: string) => boolean, max: number, maxLevel: number): { key: string; level: number }[] {
  const out: { key: string; level: number }[] = [];
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (out.length >= max) break;
    const o = r as { key?: unknown; level?: unknown } | null;
    if (!o || typeof o.key !== 'string' || !valid(o.key) || out.some((x) => x.key === o.key)) continue;
    out.push({ key: o.key, level: int(o.level, 1, maxLevel, 1) });
  }
  return out;
}

/** Validates untrusted data (a parsed localStorage value): clamps numbers, drops unknown keys; null when it cannot be a run in progress. */
export function sanitizeRunSave(raw: unknown): RunSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.cls !== 'string') return null;
  const cls = CLASS_BY_KEY[o.cls];
  if (!cls || typeof o.t !== 'number' || !Number.isFinite(o.t) || o.t < 0 || o.t >= RUN_LENGTH) return null;
  const skills = sanitizeLevels(o.skills, (k) => !!SKILL_BY_KEY[k] && (cls.skills.includes(k) || RECIPES.some((r) => r.evolved === k && cls.skills.includes(r.base))), MAX_SKILLS, SKILL_MAX_LEVEL);
  if (skills.length === 0) skills.push({ key: cls.skills[0], level: 1 });
  const passives = sanitizeLevels(o.passives, (k) => !!PASSIVE_BY_KEY[k], MAX_PASSIVES, PASSIVE_MAX_LEVEL);
  const equipped: RunSave['equipped'] = {};
  const eq = o.equipped && typeof o.equipped === 'object' ? (o.equipped as Record<string, unknown>) : {};
  for (const s of GEAR_SLOTS) {
    const g = sanitizeGear(eq[s]);
    if (g) equipped[s] = g;
  }
  const bag: SavedGear[] = [];
  if (Array.isArray(o.bag)) for (const r of o.bag) { const g = sanitizeGear(r); if (g && bag.length < BAG_SIZE) bag.push(g); }
  const sub = (k: string): Record<string, unknown> => (o[k] && typeof o[k] === 'object' ? (o[k] as Record<string, unknown>) : {});
  const el = sub('elites'), sw = sub('swarms'), fd = sub('field');
  const started = [0, 1, 2].map((i) => int(Array.isArray(sw.started) ? sw.started[i] : 0, 0, 9999, 0));
  const branch = typeof o.branch === 'number' && cls.branches.includes(o.branch) ? o.branch : 0;
  return {
    v: 1, seed: int(o.seed, 0, 4294967295, 1), cls: cls.key, difficulty: int(o.difficulty, 0, DIFFICULTIES.length - 1, 0), t: o.t, level: int(o.level, 1, 999, 1), xp: num(o.xp, 0, MAX_COUNT, 0),
    hp: num(o.hp, 1, MAX_COUNT, 1), kills: int(o.kills, 0, MAX_COUNT, 0), mesos: int(o.mesos, 0, MAX_COUNT, 0),
    bossesSpawned: int(o.bossesSpawned, 0, Math.min(BOSSES.length, Math.floor(o.t / BOSS_EVERY)), 0),
    bossKills: int(o.bossKills, 0, BOSSES.length, 0), damageTaken: num(o.damageTaken, 0, MAX_COUNT, 0),
    gearDrops: int(o.gearDrops, 0, MAX_COUNT, 0), scrollDrops: int(o.scrollDrops, 0, MAX_COUNT, 0),
    mesoCarry: num(o.mesoCarry, 0, 1, 0), reviveUsed: o.reviveUsed === true,
    skills, passives, equipped, bag, branch,
    masteryLv: sanitizeCounts(o.masteryLv, (k) => !!MASTERY_BY_KEY[k], (k) => Math.min(9999, masteryMax(MASTERY_BY_KEY[k]))),
    skillMastery: sanitizeCounts(o.skillMastery, (k) => !!SKILL_BY_KEY[k], () => 9999),
    elites: { nextAt: num(el.nextAt, 0, 1e6, 0), pending: el.pending === true, spawned: int(el.spawned, 0, 99999, 0), killed: int(el.killed, 0, 99999, 0) },
    swarms: { nextAt: num(sw.nextAt, 0, 1e6, 0), started, pigsKilled: int(sw.pigsKilled, 0, 99999, 0) },
    field: { nextBox: num(fd.nextBox, 0, 1e6, 0), boxesBroken: int(fd.boxesBroken, 0, 99999, 0), itemsUsed: int(fd.itemsUsed, 0, 99999, 0) },
    pendingLevels: int(o.pendingLevels, 0, 999, 0), pendingJob: o.pendingJob === true && branch === 0,
    rerolls: int(o.rerolls, 0, 99, START_REROLLS), banishes: int(o.banishes, 0, 99, START_BANISHES),
    banished: Array.isArray(o.banished) ? o.banished.filter((k): k is string => typeof k === 'string' && (!!SKILL_BY_KEY[k] || !!PASSIVE_BY_KEY[k])).slice(0, 64) : [],
    book: sanitizeBook(o.book), savedAt: num(o.savedAt, 0, 8.64e15, 0),
  };
}

/**
 * Applies a (sanitized) save onto a freshly constructed Sim of the same class and options. False (sim untouched) on a class mismatch.
 * Gear ids missing from the sim's GearPool are dropped. Positions, enemies and RNG streams stay as the fresh sim has them.
 */
export function restoreRun(sim: Sim, data: RunSave): boolean {
  if (data.v !== 1 || data.cls !== sim.cls.key) return false;
  sim.t = data.t;
  sim.region = regionAt(data.t);
  sim.level = data.level;
  sim.xp = data.xp;
  sim.xpNeed = xpToNext(data.level);
  sim.kills = data.kills;
  sim.mesos = data.mesos;
  sim.bossKills = data.bossKills;
  sim.bossesSpawned = data.bossesSpawned;
  sim.damageTaken = data.damageTaken;
  sim.gearDrops = data.gearDrops;
  sim.scrollDrops = data.scrollDrops;
  sim.skills = data.skills.map((s) => ({ key: s.key, level: s.level, cd: 0.3 }));
  sim.passives = data.passives.map((p) => ({ key: p.key, level: p.level }));
  sim.equipped = {};
  for (const s of GEAR_SLOTS) {
    const g = data.equipped[s];
    const base = g && sim.gearPool.get(g.id);
    if (g && base && base.slot === s) sim.equipped[s] = (g.up ? { ...base, up: g.up } : { ...base }) as GearItem;
  }
  sim.bag = [];
  for (const g of data.bag) {
    const base = sim.gearPool.get(g.id);
    if (base) sim.bag.push((g.up ? { ...base, up: g.up } : { ...base }) as GearItem);
  }
  sim.bagVersion++;
  sim.gearVersion++;
  sim.upgradeVersion++;
  for (const m of MASTERIES) sim.masteryLv[m.key as MasteryKey] = data.masteryLv[m.key] ?? 0;
  sim.skillMastery = { ...data.skillMastery };
  sim.mesoCarry = data.mesoCarry;
  sim.reviveUsed = data.reviveUsed;
  sim.elites.nextAt = data.elites.nextAt; sim.elites.pending = data.elites.pending; sim.elites.spawned = data.elites.spawned; sim.elites.killed = data.elites.killed;
  sim.swarms.nextAt = data.swarms.nextAt; sim.swarms.started = [...data.swarms.started]; sim.swarms.pigsKilled = data.swarms.pigsKilled;
  sim.field.nextBox = data.field.nextBox; sim.field.boxesBroken = data.field.boxesBroken; sim.field.itemsUsed = data.field.itemsUsed;
  sim.branch = data.branch;
  sim.jobs = unlockedJobs(sim.cls, data.branch, data.level);
  sim.pendingLevels = data.pendingLevels;
  sim.pendingJob = data.pendingJob;
  sim.rerolls = data.rerolls;
  sim.banishes = data.banishes;
  sim.banished = new Set(data.banished);
  sim.book = { ...data.book };
  sim.hp = 1;
  sim.recalc();
  sim.hp = Math.min(sim.maxHp, Math.max(1, data.hp));
  return true;
}
