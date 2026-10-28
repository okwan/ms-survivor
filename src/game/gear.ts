/**
 * Equipment drops: items, the pool they are drawn from, and the stat mapping. Pure (no DOM).
 * The pool is built from the manifest the deploy-time extractor writes (scripts/fetch-maple-gear.ts); without one a small
 * built-in placeholder pool keeps drops, equipping and the stat effects working (the hero just does not change look).
 */
import {
  GEAR_DMG_PER_ATT, GEAR_DMG_PER_STAT, GEAR_MAX_TIER, GEAR_MHP_PER_HP, GEAR_PDD_PER_ARMOR, GEAR_SPEED_PER_POINT, GEAR_START_TIER, GEAR_TIER_DMG_CAP, GEAR_TIER_SECONDS,
  GEAR_UPTIER_CHANCE,
} from './data.ts';
import type { ClassKey } from './data.ts';
import type { Rng } from './rng.ts';

export type GearSlot = 'cap' | 'coat' | 'pants' | 'shoes' | 'glove' | 'cape' | 'shield' | 'weapon';
export const GEAR_SLOTS: GearSlot[] = ['cap', 'coat', 'pants', 'shoes', 'glove', 'cape', 'shield', 'weapon'];
export const GEAR_SLOT_NAMES: Record<GearSlot, string> = { cap: 'Cap', coat: 'Top', pants: 'Bottom', shoes: 'Shoes', glove: 'Gloves', cape: 'Cape', shield: 'Shield', weapon: 'Weapon' };
/** unequipped items a hero can carry */
export const BAG_SIZE = 24;
/** job bit of a class in an item's reqJob (0 = every class) */
export const JOB_BIT: Record<ClassKey, number> = { warrior: 1, magician: 2, bowman: 4, thief: 8 };
/** the stat that counts as "main" for each class */
export const MAIN_STAT: Record<ClassKey, 'str' | 'int' | 'dex' | 'luk'> = { warrior: 'str', magician: 'int', bowman: 'dex', thief: 'luk' };
/** reqLevel lower bounds of the item tiers 0..7 (the last one is 80-99; the extractor skips classic items from level 100 up) */
export const TIER_LEVELS = [0, 10, 20, 30, 40, 50, 60, 80];
/** highest reqLevel of an item the extractor keeps */
export const MAX_GEAR_LEVEL = 99;
export const tierOfLevel = (level: number) => {
  let t = 0;
  for (let i = 0; i < TIER_LEVELS.length; i++) if (level >= TIER_LEVELS[i]) t = i;
  return t;
};

/** the info/inc* values the game uses */
export interface GearStats {
  pad?: number;
  mad?: number;
  pdd?: number;
  mdd?: number;
  mhp?: number;
  mmp?: number;
  speed?: number;
  str?: number;
  dex?: number;
  int?: number;
  luk?: number;
}

export interface GearItem {
  /** 8-digit Character.wz id (or a placeholder id) */
  id: string;
  slot: GearSlot;
  name: string;
  level: number;
  /** reqJob bitmask, 0 = everyone */
  job: number;
  /** 0 male, 1 female, 2 either */
  gender: 0 | 1 | 2;
  tier: number;
  stats: GearStats;
  /** a one-piece coat: the pants are not drawn */
  long: boolean;
  /** upgrade slots from info/tuc (absent = DEFAULT_TUC in scrolls.ts) */
  tuc?: number;
  /** set on the worn copy of an item once scrolls were used on it (the pool's item is never changed) */
  up?: ItemUpgrade;
}

/** What scrolls did to a worn item: successes, slots still free, and the stats they added (uncapped, on top of `stats`). */
export interface ItemUpgrade {
  plus: number;
  left: number;
  stats: GearStats;
}

/** One entry of the manifest's gear block. */
export interface GearEntry {
  slot: GearSlot;
  name: string;
  level: number;
  job: number;
  /** gender, omitted = 2 */
  g?: 0 | 1 | 2;
  long?: boolean;
  /** info/tuc, the number of upgrade slots */
  tuc?: number;
  stats: GearStats;
  /** rectangle in the icon atlas and the icon's origin inside it; absent when the item has no info/icon */
  icon?: { x: number; y: number; w: number; h: number; ox: number; oy: number };
}
/** Manifest block (maple/manifest.json -> avatar.gear). Frame files of every item are avatar/<slot>-<id>.{png,json}. */
export interface GearManifest {
  items: Record<string, GearEntry>;
  /** icon atlas png, relative to maple/ */
  iconAtlas: string;
}

// ---- stat mapping ------------------------------------------------------------------------------

/** What a set of items adds to the hero. */
export interface GearBonus {
  /** added to the damage multiplier (0.1 = +10%) */
  dmg: number;
  armor: number;
  hp: number;
  /** added to the move speed multiplier */
  speed: number;
}

/** The mapped value of one item for a class (see the constants in data.ts). */
export function itemBonus(it: GearItem, cls: ClassKey): GearBonus {
  const s = it.stats;
  let dmg = 0;
  if (it.slot === 'weapon') {
    const att = cls === 'magician' ? (s.mad ?? 0) : (s.pad ?? 0);
    dmg += Math.min(att * GEAR_DMG_PER_ATT, GEAR_TIER_DMG_CAP * (it.tier + 1));
  }
  dmg += (s[MAIN_STAT[cls]] ?? 0) * GEAR_DMG_PER_STAT;
  const b = {
    dmg,
    armor: (s.pdd ?? 0) / GEAR_PDD_PER_ARMOR,
    hp: (s.mhp ?? 0) / GEAR_MHP_PER_HP,
    speed: (s.speed ?? 0) * GEAR_SPEED_PER_POINT,
  };
  // scroll gains count in full (the weapon's tier cap only limits its base attack)
  const u = it.up?.stats;
  if (u) {
    b.dmg += ((cls === 'magician' ? u.mad : u.pad) ?? 0) * GEAR_DMG_PER_ATT + (u[MAIN_STAT[cls]] ?? 0) * GEAR_DMG_PER_STAT;
    b.armor += (u.pdd ?? 0) / GEAR_PDD_PER_ARMOR;
    b.hp += (u.mhp ?? 0) / GEAR_MHP_PER_HP;
    b.speed += (u.speed ?? 0) * GEAR_SPEED_PER_POINT;
  }
  return b;
}

/** Comparison score: the mapped values in display units (percent, points) added up. */
export function itemScore(it: GearItem, cls: ClassKey): number {
  const b = itemBonus(it, cls);
  return b.dmg * 100 + b.armor + b.hp + b.speed * 100;
}

export function totalBonus(items: Iterable<GearItem>, cls: ClassKey): GearBonus {
  const t: GearBonus = { dmg: 0, armor: 0, hp: 0, speed: 0 };
  for (const it of items) {
    const b = itemBonus(it, cls);
    t.dmg += b.dmg; t.armor += b.armor; t.hp += b.hp; t.speed += b.speed;
  }
  return t;
}

/** "+12% dmg / +3 armor" for toasts and the equip window; empty string when the item adds nothing */
export function describeBonus(b: GearBonus): string {
  const out: string[] = [];
  if (b.dmg > 0.0005) out.push(`+${Math.round(b.dmg * 100)}% dmg`);
  if (b.armor > 0.05) out.push(`+${+b.armor.toFixed(1)} armor`);
  if (b.hp > 0.05) out.push(`+${+b.hp.toFixed(1)} HP`);
  if (b.speed > 0.0005) out.push(`+${+(b.speed * 100).toFixed(1)}% speed`);
  return out.join(' / ');
}

// ---- pool --------------------------------------------------------------------------------------

/** Item tier of a run clock: GEAR_START_TIER at the start, then +1 every GEAR_TIER_SECONDS, at most GEAR_MAX_TIER. */
export function runTier(t: number): number {
  return Math.max(0, Math.min(GEAR_MAX_TIER, GEAR_START_TIER + Math.floor(t / GEAR_TIER_SECONDS)));
}

/** Drop glow / name colour by item tier: grey (tiers 0-1), white (2-3), blue (4-5), purple (6), gold (7). */
export const TIER_COLORS = [0x9aa0a6, 0x9aa0a6, 0xffffff, 0xffffff, 0x4aa3ff, 0x4aa3ff, 0xb35cff, 0xffd23a];
export const TIER_COLOR_NAMES = ['grey', 'grey', 'white', 'white', 'blue', 'blue', 'purple', 'gold'];
export const tierColor = (tier: number) => TIER_COLORS[Math.max(0, Math.min(TIER_COLORS.length - 1, tier | 0))];

export class GearPool {
  readonly items = new Map<string, GearItem>();
  /** true when built from the manifest (real items), false for the built-in placeholders */
  readonly real: boolean;
  private buckets = new Map<string, GearItem[]>();

  constructor(items: GearItem[], real: boolean) {
    this.real = real;
    for (const it of items) this.items.set(it.id, it);
  }

  static fromManifest(m: GearManifest | null | undefined): GearPool {
    if (!m || !m.items || typeof m.items !== 'object') return GearPool.placeholder();
    const list: GearItem[] = [];
    for (const [id, e] of Object.entries(m.items)) {
      if (!e || !GEAR_SLOTS.includes(e.slot)) continue;
      const level = typeof e.level === 'number' ? e.level : 0;
      list.push({
        id, slot: e.slot, name: typeof e.name === 'string' && e.name ? e.name : `Item ${id}`, level, job: e.job | 0,
        gender: e.g === 0 || e.g === 1 ? e.g : 2, tier: tierOfLevel(level), stats: e.stats ?? {}, long: !!e.long,
        ...(typeof e.tuc === 'number' && e.tuc >= 0 ? { tuc: Math.floor(e.tuc) } : {}),
      });
    }
    return list.length ? new GearPool(list, true) : GearPool.placeholder();
  }

  /** A few invented items per class, slot and tier, for play without extracted art. */
  static placeholder(): GearPool {
    const list: GearItem[] = [];
    const mats = ['Bronze', 'Iron', 'Steel', 'Silver', 'Mithril', 'Gold', 'Orihalcon', 'Dragon'];
    const wnames: Record<ClassKey, string> = { warrior: 'Sword', magician: 'Wand', bowman: 'Bow', thief: 'Dagger' };
    for (let t = 0; t <= GEAR_MAX_TIER; t++) {
      const level = TIER_LEVELS[t];
      const base = (slot: GearSlot, name: string, job: number, stats: GearStats): GearItem => ({
        id: `ph${slot}${job}t${t}`, slot, name: `${mats[t]} ${name}`, level, job, gender: 2, tier: t, stats, long: false,
      });
      list.push(base('cap', 'Cap', 0, { pdd: 3 + 3 * t, mhp: 5 * t }));
      list.push(base('coat', 'Tunic', 0, { pdd: 6 + 5 * t, mhp: 10 * t }));
      list.push(base('pants', 'Trousers', 0, { pdd: 4 + 4 * t }));
      list.push(base('shoes', 'Boots', 0, { pdd: 2 + 2 * t, speed: 1 + t }));
      list.push(base('glove', 'Gloves', 0, { pdd: 1 + t, pad: 1 + t, mad: 1 + t }));
      list.push(base('cape', 'Cape', 0, { pdd: 2 + 2 * t, str: t, dex: t, int: t, luk: t }));
      list.push(base('shield', 'Shield', JOB_BIT.warrior, { pdd: 5 + 5 * t, mhp: 15 * t }));
      for (const c of Object.keys(JOB_BIT) as ClassKey[]) {
        list.push(base('weapon', wnames[c], JOB_BIT[c], { pad: 12 + 7 * t, mad: 14 + 8 * t, [MAIN_STAT[c]]: 2 * t }));
      }
    }
    return new GearPool(list, false);
  }

  get(id: string): GearItem | undefined {
    return this.items.get(id);
  }

  /** Items a class and gender may wear at an item tier. */
  eligible(cls: ClassKey, gender: 0 | 1, tier: number): GearItem[] {
    const key = `${cls}.${gender}.${tier}`;
    let b = this.buckets.get(key);
    if (!b) {
      const bit = JOB_BIT[cls];
      b = [];
      for (const it of this.items.values()) {
        if (it.tier !== tier) continue;
        if (it.job !== 0 && !(it.job & bit)) continue;
        if (it.gender !== 2 && it.gender !== gender) continue;
        if (it.slot === 'shield' && cls !== 'warrior') continue;
        b.push(it);
      }
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Draws a drop: a slot (uniformly among the slots that have items), then an item of it. The tier is the run tier plus `boost`
   * (default: one higher with chance GEAR_UPTIER_CHANCE); if that tier has nothing for this class the next lower one is used.
   */
  roll(rng: Rng, cls: ClassKey, gender: 0 | 1, runT: number, boost = -1): GearItem | null {
    let tier = runTier(runT);
    if (boost >= 0) tier = Math.min(GEAR_MAX_TIER, tier + boost);
    else if (rng.next() < GEAR_UPTIER_CHANCE) tier = Math.min(GEAR_MAX_TIER, tier + 1);
    for (let t = tier; t >= 0; t--) {
      const all = this.eligible(cls, gender, t);
      if (!all.length) continue;
      const slots = GEAR_SLOTS.filter((s) => all.some((i) => i.slot === s));
      const slot = slots[rng.int(slots.length)];
      const of = all.filter((i) => i.slot === slot);
      return of[rng.int(of.length)];
    }
    return null;
  }
}
