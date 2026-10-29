/**
 * Enhancement scrolls: the pool they are drawn from, success rates and what a success adds. Pure (no DOM).
 * The pool is built from the manifest the deploy-time extractor writes (scripts/fetch-maple-items.ts, from String.wz Consume.img);
 * without one a built-in table of invented scrolls keeps drops and upgrades working. A scroll is applied at once on pickup to the
 * equipped item of its slot (see Sim.useScroll): no inventory.
 */
import type { ClassKey } from './data.ts';
import { GEAR_SLOTS, MAIN_STAT } from './gear.ts';
import type { GearItem, GearSlot, GearStats } from './gear.ts';
import type { Rng } from './rng.ts';

/** drop chance per normal kill (bosses drop exactly SCROLL_BOSS_DROPS) */
export const SCROLL_DROP_NORMAL = 0.003;
export const SCROLL_BOSS_DROPS = 1;
export const SCROLL_PICKUP_LIFE = 90;
/** upgrade slots of an item without a `tuc` in the manifest */
export const DEFAULT_TUC = 7;
/** success rates (percent) a scroll can have, with the weight they are drawn at */
export const SCROLL_PCTS = [100, 60, 10] as const;
const PCT_WEIGHT: Record<number, number> = { 100: 3, 60: 5, 10: 2 };

export interface ScrollDef {
  /** Consume.img id, e.g. '2040000' (placeholders: 'ph...') */
  id: string;
  name: string;
  slot: GearSlot;
  /** weapon scrolls only: the class whose weapon it fits */
  wclass?: ClassKey;
  stat: keyof GearStats;
  /** success rate in percent: 10, 60 or 100 */
  pct: number;
  /** what a success adds to `stat` */
  gain: number;
}

/** One entry of the manifest's scroll table. */
export interface ScrollEntry {
  name: string;
  slot: GearSlot;
  wclass?: ClassKey;
  stat: keyof GearStats;
  pct: number;
}

/** Stat gained by a success: ATT / DEF +1, +2, +5 for 100 / 60 / 10 %, HP +5, +10, +20, other stats and speed +1, +2, +3. */
export function scrollGain(stat: keyof GearStats, pct: number): number {
  const i = pct >= 100 ? 0 : pct >= 60 ? 1 : 2;
  if (stat === 'pad' || stat === 'mad' || stat === 'pdd' || stat === 'mdd') return [1, 2, 5][i];
  if (stat === 'mhp' || stat === 'mmp') return [5, 10, 20][i];
  return [1, 2, 3][i];
}

export const slotsLeft = (it: GearItem): number => (it.up ? it.up.left : it.tuc ?? DEFAULT_TUC);
export const plusOf = (it: GearItem): number => it.up?.plus ?? 0;

/** Whether the stat of a scroll does anything for a class (ATT for the Magician is MAD, other classes' main stats do nothing). */
export function scrollUseful(d: ScrollDef, cls: ClassKey): boolean {
  switch (d.stat) {
    case 'pad': return cls !== 'magician';
    case 'mad': return cls === 'magician';
    case 'pdd': case 'mhp': case 'speed': return true;
    default: return d.stat === MAIN_STAT[cls];
  }
}

const SLOT_WORD: Record<GearSlot, string> = { cap: 'Helmet', coat: 'Overall Armor', pants: 'Bottomwear', shoes: 'Shoes', glove: 'Gloves', cape: 'Cape', shield: 'Shield', weapon: 'Weapon' };
const WEAPON_WORD: Record<ClassKey, string> = { warrior: 'One-Handed Sword', magician: 'Wand', bowman: 'Bow', thief: 'Dagger', pirate: 'Knuckle' };
const STAT_WORD: Partial<Record<keyof GearStats, string>> = { pad: 'ATT', mad: 'Magic Att', pdd: 'DEF', mdd: 'Magic Def', mhp: 'HP', mmp: 'MP', speed: 'Speed', str: 'STR', dex: 'DEX', int: 'INT', luk: 'LUK' };

export class ScrollPool {
  readonly defs: ScrollDef[];
  /** true when built from the manifest (real names), false for the built-in placeholders */
  readonly real: boolean;

  constructor(defs: ScrollDef[], real: boolean) {
    this.defs = defs;
    this.real = real;
  }

  static fromManifest(table: Record<string, ScrollEntry> | null | undefined): ScrollPool {
    if (!table || typeof table !== 'object') return ScrollPool.placeholder();
    const list: ScrollDef[] = [];
    for (const [id, e] of Object.entries(table)) {
      if (!e || !GEAR_SLOTS.includes(e.slot) || !SCROLL_PCTS.includes(e.pct as 10)) continue;
      if (typeof e.stat !== 'string') continue;
      list.push({ id, name: typeof e.name === 'string' && e.name ? e.name : `Scroll ${id}`, slot: e.slot, ...(e.wclass ? { wclass: e.wclass } : {}), stat: e.stat, pct: e.pct, gain: scrollGain(e.stat, e.pct) });
    }
    return list.length ? new ScrollPool(list, true) : ScrollPool.placeholder();
  }

  /** Invented scrolls for play without extracted names: every slot at 100 / 60 / 10 %, one weapon scroll per class. */
  static placeholder(): ScrollPool {
    const list: ScrollDef[] = [];
    const add = (slot: GearSlot, stat: keyof GearStats, pct: number, word: string, wclass?: ClassKey) =>
      list.push({ id: `phscroll${slot}${wclass ?? ''}${pct}`, name: `Scroll for ${word} for ${STAT_WORD[stat]} ${pct}%`, slot, ...(wclass ? { wclass } : {}), stat, pct, gain: scrollGain(stat, pct) });
    for (const pct of SCROLL_PCTS) {
      add('cap', 'pdd', pct, SLOT_WORD.cap);
      add('coat', 'mhp', pct, SLOT_WORD.coat);
      add('pants', 'pdd', pct, SLOT_WORD.pants);
      add('shoes', 'speed', pct, SLOT_WORD.shoes);
      add('glove', 'pdd', pct, SLOT_WORD.glove);
      add('cape', 'pdd', pct, SLOT_WORD.cape);
      add('shield', 'pdd', pct, SLOT_WORD.shield);
      for (const c of Object.keys(WEAPON_WORD) as ClassKey[]) add('weapon', c === 'magician' ? 'mad' : 'pad', pct, WEAPON_WORD[c], c);
    }
    return new ScrollPool(list, false);
  }

  /** Whether a scroll fits a class (weapon scrolls need the right weapon, shields are the Warrior's). */
  static fits(d: ScrollDef, cls: ClassKey): boolean {
    if (d.slot === 'weapon') return d.wclass === undefined || d.wclass === cls;
    return d.slot !== 'shield' || cls === 'warrior';
  }

  /**
   * Draws a scroll for a random slot of the hero's equipped gear that still has upgrade slots (any slot the class wears when
   * nothing qualifies), then a success rate by weight, then one of the scrolls of that slot and rate. Null when the pool has
   * nothing for the slot.
   */
  roll(rng: Rng, equipped: Partial<Record<GearSlot, GearItem>>, cls: ClassKey): ScrollDef | null {
    const wearable = GEAR_SLOTS.filter((s) => s !== 'shield' || cls === 'warrior');
    const open = wearable.filter((s) => equipped[s] && slotsLeft(equipped[s]!) > 0);
    const slots = open.length ? open : wearable;
    const slot = slots[rng.int(slots.length)];
    let of = this.defs.filter((d) => d.slot === slot && ScrollPool.fits(d, cls) && scrollUseful(d, cls));
    if (!of.length) of = this.defs.filter((d) => d.slot === slot && ScrollPool.fits(d, cls));
    if (!of.length) return null;
    const pcts = [...new Set(of.map((d) => d.pct))];
    let total = 0;
    for (const p of pcts) total += PCT_WEIGHT[p] ?? 1;
    let x = rng.next() * total;
    let pct = pcts[pcts.length - 1];
    for (const p of pcts) {
      x -= PCT_WEIGHT[p] ?? 1;
      if (x < 0) { pct = p; break; }
    }
    const ofPct = of.filter((d) => d.pct === pct);
    return ofPct[rng.int(ofPct.length)];
  }
}
