/**
 * Boss Gachapon capsules (from Vampire Survivors treasure chests). Every boss drops a GACHA pickup; touching it rolls how many upgrades
 * the capsule holds (1, 3 or 5, with better odds after each boss) and applies them one by one: the Mastery Book evolution first when a
 * recipe is ready (src/game/evolutions.ts), then +1 level to a random owned skill below max, else a random owned passive below max, else
 * mesos. The sim only emits a 'gacha' event with the results; the UI reveals them over a few seconds without pausing the run.
 * After the last boss has spawned, a ready recipe can also drop a Mastery Book from a normal kill (low chance, one on the ground at most).
 * The fallback roll has its own seeded stream so it never shifts the run's other random draws. Pure (no DOM).
 */
import { BOSSES, PASSIVE_BY_KEY, PASSIVE_MAX_LEVEL, SKILL_BY_KEY, SKILL_MAX_LEVEL } from './data.ts';
import { evolve, readyRecipe } from './evolutions.ts';
import type { Sim } from './sim.ts';
import type { Rng } from './rng.ts';
import { GACHA, MASTERY } from './types.ts';
import type { GachaResult } from './types.ts';

/** upgrades in a capsule */
export const GACHA_COUNTS = [1, 3, 5] as const;
/** mesos per boss number when a capsule upgrade has nothing left to level */
export const GACHA_MESOS = 25;
/** chance per normal kill that a ready recipe drops a Mastery Book once no boss is left to come */
export const MASTERY_DROP = 0.002;

/** An Elite's capsule has value ELITE_CAPSULE + n (n = boss-number equivalent for the meso fallback) and holds exactly one upgrade */
export const ELITE_CAPSULE = 100;

/** Odds of [1, 3, 5] upgrades for boss index n: boss #1 is 75 / 22 / 3 %, each later boss moves 6 % to 3 and 2 % to 5 (taken from 1) */
export function gachaOdds(boss: number): [number, number, number] {
  const p3 = 0.22 + 0.06 * boss, p5 = 0.03 + 0.02 * boss;
  return [1 - p3 - p5, p3, p5];
}

/** Rolls the number of upgrades for boss index n with `rng` */
export function rollGachaCount(rng: Rng, boss: number): number {
  const [, p3, p5] = gachaOdds(boss);
  const r = rng.next();
  return r < p5 ? 5 : r < p5 + p3 ? 3 : 1;
}

/** +1 level to a random owned skill below max (null when none) */
function upgradeSkill(sim: Sim): GachaResult | null {
  const pool: number[] = [];
  for (let i = 0; i < sim.skills.length; i++) if (sim.skills[i].level < SKILL_MAX_LEVEL) pool.push(i);
  if (pool.length === 0) return null;
  const o = sim.skills[pool[sim.rng.int(pool.length)]];
  o.level++;
  return { kind: 'skill', key: o.key, name: SKILL_BY_KEY[o.key].name, from: o.level - 1, to: o.level };
}

/** +1 level to a random owned passive below max (null when none); stats are recalculated */
function upgradePassive(sim: Sim): GachaResult | null {
  const pool: number[] = [];
  for (let i = 0; i < sim.passives.length; i++) if (sim.passives[i].level < PASSIVE_MAX_LEVEL) pool.push(i);
  if (pool.length === 0) return null;
  const o = sim.passives[pool[sim.rng.int(pool.length)]];
  o.level++;
  sim.recalc();
  return { kind: 'passive', key: o.key, name: PASSIVE_BY_KEY[o.key].name, from: o.level - 1, to: o.level };
}

/** Applies `count` upgrades; the first is the Mastery Book evolution when a recipe is ready */
export function applyUpgrades(sim: Sim, count: number, boss: number): GachaResult[] {
  const out: GachaResult[] = [];
  for (let i = 0; i < count; i++) {
    let r: GachaResult | null = null;
    if (i === 0) { const rec = readyRecipe(sim); if (rec) r = evolve(sim, rec); }
    r ??= upgradeSkill(sim) ?? upgradePassive(sim);
    if (!r) {
      const amount = GACHA_MESOS * (boss + 1);
      sim.mesos += amount;
      r = { kind: 'meso', key: 'mesobag', name: 'Meso Bag', from: 0, to: 0, amount };
    }
    out.push(r);
  }
  return out;
}

/** The hero touched the capsule of boss index n (an Elite's capsule always holds exactly one upgrade): roll and apply the upgrades, and tell the UI */
export function openGacha(sim: Sim, boss: number, elite = false) {
  const count = elite ? 1 : rollGachaCount(sim.rng, boss);
  const results = applyUpgrades(sim, count, boss);
  sim.emit({ type: 'gacha', boss, count, results, ...(elite ? { elite: true } : {}) });
  sim.note(`${elite ? 'Elite' : BOSSES[boss]?.name ?? 'Boss'} Gachapon: ${count} upgrade${count > 1 ? 's' : ''}!`, 'good', 3);
}

/** The hero touched a Mastery Book: evolves the ready recipe (mesos when nothing is ready any more) */
export function useMasteryBook(sim: Sim) {
  const rec = readyRecipe(sim);
  const r = rec ? evolve(sim, rec) : null;
  if (!r) { sim.mesos += GACHA_MESOS; sim.note(`Mastery Book: +${GACHA_MESOS} mesos`, 'info'); }
}

/** After a normal kill at (x,y): once no boss is left to come, a ready recipe may drop a Mastery Book (at most one lying around) */
export function maybeDropMastery(sim: Sim, x: number, y: number) {
  if (sim.bossesSpawned < BOSSES.length || !readyRecipe(sim)) return;
  for (let i = 0; i < sim.pickups.length; i++) if (sim.pickups[i].kind === MASTERY) return;
  if (sim.gachaRng.next() < MASTERY_DROP) sim.dropPickup(MASTERY, x, y, 1);
}

/** Boss index n died at (x,y): its capsule (value = boss number) */
export function dropGacha(sim: Sim, boss: number, x: number, y: number) {
  sim.dropPickup(GACHA, x, y, boss + 1);
}
