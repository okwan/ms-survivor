/**
 * 4th-job evolutions (from Vampire Survivors): one per 3rd job. A recipe is ready when the 3rd-job skill is at SKILL_MAX_LEVEL and its partner
 * passive is owned (any level). The next Gachapon capsule then opens with a Mastery Book (src/game/gachapon.ts) that REPLACES the base skill
 * in its slot with the 4th-job skill at SKILL_MAX_LEVEL. The base key is banished for the run, so it never returns to the card pool, and the
 * evolved keys are not in SKILLS, so they are never offered either. Evolved skills are plain SkillDefs of the existing kinds. Pure (no DOM).
 */
import { PASSIVE_BY_KEY, SKILL_BY_KEY, SKILL_MAX_LEVEL, SLOW_DURATION } from './data.ts';
import type { SkillDef } from './data.ts';
import type { Sim } from './sim.ts';
import type { Card, GachaResult } from './types.ts';

export interface Recipe {
  /** the 3rd-job skill key that is replaced */
  base: string;
  /** the passive key that has to be owned */
  partner: string;
  /** the 4th-job skill key */
  evolved: string;
}

const E = (key: string, name: string, id: number, kind: SkillDef['kind'], element: SkillDef['element'], dmg: number, cd: number, range: number, radius: number, count: number, desc: string, extra: Partial<SkillDef> = {}): SkillDef =>
  ({ key, name, id, kind, element, dmg, cd, range, radius, count, desc, ...extra, evolved: true });

// v83 Skill.wz ids (4th job codes 112, 122, 132, 212, 222, 232, 312, 322, 412, 422, 512, 522). A wrong id only costs the art; the asset step logs it as MISMATCH.
export const EVOLVED_SKILLS: SkillDef[] = [
  E('brandish', 'Brandish', 1121008, 'cone', 'fire', 26, 2.8, 0, 9, 1, 'Two huge sweeps through everything in front. Weakens.', { hits: 2, weaken: 4 }),
  E('blast', 'Blast', 1221009, 'melee', 'lightning', 84, 3.0, 6, 2.8, 1, 'One colossal blow to the nearest enemy. Stuns.', { stun: 1.2 }),
  E('rush', 'Rush', 1321003, 'cone', 'fire', 62, 2.2, 0, 11, 1, 'A dragon charge that staggers everything in a wide cone.', { stun: 0.6 }),
  E('meteor_shower', 'Meteor Shower', 2121007, 'ground', 'fire', 9, 5.0, 22, 4.5, 2, 'Meteors rain on the thickest crowds.', { dur: 2 }),
  E('blizzard_mage', 'Blizzard', 2221007, 'nova', 'ice', 52, 4.0, 0, 10, 1, 'A huge blizzard that slows everything around you.', { slow: SLOW_DURATION }),
  E('genesis', 'Genesis', 2321008, 'nova', 'lightning', 70, 4.4, 0, 12, 1, 'A pillar of holy light that engulfs the field.'),
  E('hurricane', 'Hurricane', 3121004, 'pierce', 'arcane', 11, 0.5, 26, 0, 2, 'A rapid stream of arrows that pierce enemies.', { pierceBase: 8, missile: 40 }),
  E('piercing_arrow', 'Piercing Arrow', 3221001, 'pierce', 'arcane', 20, 2.0, 34, 0, 1, 'A long arrow that pierces a whole line of enemies.', { pierceBase: 8, missile: 44 }),
  E('triple_throw', 'Triple Throw', 4121007, 'bolt', 'arcane', 65, 1.5, 24, 1.1, 3, 'Three exploding stars at the nearest enemies.'),
  E('boomerang_step', 'Boomerang Step', 4221007, 'melee', 'arcane', 54, 2.0, 7, 2.0, 5, 'A dashing combo that hits many enemies around you.'),
  E('barrage', 'Barrage', 5121007, 'melee', 'arcane', 30, 1.6, 6, 0, 1, 'A six-punch barrage on the nearest enemy.', { hits: 6 }),
  E('rapid_fire', 'Rapid Fire', 5221004, 'pierce', 'arcane', 10, 0.45, 26, 0, 2, 'A stream of bullets that pierce enemies.', { pierceBase: 6, missile: 42 }),
];

export const RECIPES: Recipe[] = [
  { base: 'panic', partner: 'combo_attack', evolved: 'brandish' },
  { base: 'charge_blow', partner: 'fire_charge', evolved: 'blast' },
  { base: 'dragon_fury', partner: 'hyper_body', evolved: 'rush' },
  { base: 'explosion', partner: 'element_amp_fp', evolved: 'meteor_shower' },
  { base: 'ice_strike', partner: 'element_amp_il', evolved: 'blizzard_mage' },
  { base: 'shining_ray', partner: 'holy_symbol', evolved: 'genesis' },
  { base: 'arrow_rain', partner: 'mortal_blow_ranger', evolved: 'hurricane' },
  { base: 'arrow_eruption', partner: 'mortal_blow_sniper', evolved: 'piercing_arrow' },
  { base: 'avenger', partner: 'shadow_partner', evolved: 'triple_throw' },
  { base: 'meso_explosion', partner: 'meso_guard', evolved: 'boomerang_step' },
  { base: 'energy_blast', partner: 'energy_charge', evolved: 'barrage' },
  { base: 'flamethrower', partner: 'gun_mastery', evolved: 'rapid_fire' },
];

// the sim, skills.ts and the UI look skills up by key
for (const s of EVOLVED_SKILLS) SKILL_BY_KEY[s.key] = s;

/**
 * Passive slots are full long before the 3rd job arrives at level 70, so a recipe's partner passive would never fit. A hero who owns the
 * recipe's skill may take its partner into one extra slot (each 3rd job has exactly one recipe, so it is one slot at most).
 */
export const EVOLUTION_PASSIVE_SLOTS = 1;

/** Extra card weight of the partner passive of a maxed 3rd-job skill that the hero does not own yet */
export const PARTNER_WEIGHT = 2;

/** True when passive `key` may be taken as a NEW passive although the passive slots are full: the extra evolution slot is free and the hero owns the recipe's skill */
export function partnerSlotOpen(sim: Sim, key: string, slots: number): boolean {
  if (sim.passives.length >= slots + EVOLUTION_PASSIVE_SLOTS) return false;
  for (let i = 0; i < RECIPES.length; i++) {
    if (RECIPES[i].partner === key) return sim.skills.some((s) => s.key === RECIPES[i].base);
  }
  return false;
}

/** The first recipe that is ready to evolve (base skill maxed, partner passive owned), or null */
export function readyRecipe(sim: Sim): Recipe | null {
  for (let i = 0; i < RECIPES.length; i++) {
    const r = RECIPES[i];
    let maxed = false;
    for (let k = 0; k < sim.skills.length; k++) if (sim.skills[k].key === r.base && sim.skills[k].level >= SKILL_MAX_LEVEL) { maxed = true; break; }
    if (!maxed) continue;
    for (let k = 0; k < sim.passives.length; k++) if (sim.passives[k].key === r.partner) return r;
  }
  return null;
}

/** Replaces the base skill with its evolution at SKILL_MAX_LEVEL and announces it. Null when the base skill is not owned. */
export function evolve(sim: Sim, r: Recipe): GachaResult | null {
  const i = sim.skills.findIndex((s) => s.key === r.base);
  if (i < 0) return null;
  const from = SKILL_BY_KEY[r.base], to = SKILL_BY_KEY[r.evolved];
  sim.skills[i] = { key: r.evolved, level: SKILL_MAX_LEVEL, cd: 0.3 };
  // the base key never returns to the card pool
  sim.banished.add(r.base);
  sim.raid(`Mastery Book! ${from.name} evolved into ${to.name}`);
  sim.note(`Mastery Book! ${from.name} evolved into ${to.name}`, 'good', 4);
  sim.emit({ type: 'evolve', from: r.base, to: r.evolved, name: to.name });
  return { kind: 'evolve', key: r.evolved, name: to.name, from: SKILL_MAX_LEVEL, to: SKILL_MAX_LEVEL, base: r.base, baseName: from.name };
}

/** Hint line of a level-up card for a skill or passive that is part of a recipe, else null */
export function evolutionHint(key: string): string | null {
  for (let i = 0; i < RECIPES.length; i++) {
    const r = RECIPES[i];
    if (r.base === key) return `Evolves into ${SKILL_BY_KEY[r.evolved].name} with a Mastery Book`;
    if (r.partner === key) return `Evolves ${SKILL_BY_KEY[r.base].name} with a Mastery Book`;
  }
  return null;
}

/** Card weight of a passive key: PARTNER_WEIGHT while its recipe's 3rd-job skill is maxed and the passive is not owned yet, else 1 */
export function cardWeight(sim: Sim, key: string): number {
  if (!PASSIVE_BY_KEY[key]) return 1;
  for (let i = 0; i < RECIPES.length; i++) {
    const r = RECIPES[i];
    if (r.partner !== key) continue;
    if (sim.passives.some((p) => p.key === key)) return 1;
    return sim.skills.some((s) => s.key === r.base && s.level >= SKILL_MAX_LEVEL) ? PARTNER_WEIGHT : 1;
  }
  return 1;
}

/** Index into `pool` of the next card to offer: uniform, except that partner passives weigh PARTNER_WEIGHT. Draws one number from the sim's rng either way. */
export function pickCard(sim: Sim, pool: Card[]): number {
  let total = 0;
  for (let i = 0; i < pool.length; i++) total += pool[i].kind === 'passive' ? cardWeight(sim, pool[i].key) : 1;
  if (total === pool.length) return sim.rng.int(pool.length);
  let r = sim.rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= pool[i].kind === 'passive' ? cardWeight(sim, pool[i].key) : 1;
    if (r < 0) return i;
  }
  return pool.length - 1;
}
