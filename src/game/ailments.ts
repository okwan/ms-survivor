/**
 * Ailments of the hero (MapleStory's mob skills: Seal, Darkness, Weakness, Curse, Poison). They come from boss ailment circles and from the
 * shots of Curse Eyes and Wraiths (src/game/mobai.ts), show as chips with a countdown on the HUD and as a short floating text, and never
 * stack: applying one again refreshes its timer. A cleric's Heal, an Elixir (pickup or card) or an Apple cures them all; the Holy Symbol
 * passive halves their length. The sim reads `sim.ail` where an ailment changes a rule (skills, crits, speed, gems); Poison runs here.
 * Pure (no DOM).
 */
import { AIL_CURSE, AIL_DARKNESS, AIL_POISON, AIL_SEAL, AIL_WEAKNESS } from './data.ts';
import type { Sim } from './sim.ts';

export interface AilmentDef {
  id: number;
  key: string;
  name: string;
  /** floating text when it lands */
  text: string;
  seconds: number;
  /** chip and floating text colour */
  color: string;
  desc: string;
}
/** index = id - 1 */
export const AILMENTS: AilmentDef[] = [
  { id: AIL_SEAL, key: 'seal', name: 'Seal', text: 'SEALED!', seconds: 3, color: '#e8d03a', desc: 'Your skills cannot fire.' },
  { id: AIL_DARKNESS, key: 'darkness', name: 'Darkness', text: 'DARKNESS!', seconds: 5, color: '#8a6ad8', desc: 'No critical hits, and the screen goes dark.' },
  { id: AIL_WEAKNESS, key: 'weakness', name: 'Weakness', text: 'WEAKNESS!', seconds: 4, color: '#5ab4ff', desc: 'You move 40% slower.' },
  { id: AIL_CURSE, key: 'curse', name: 'Curse', text: 'CURSED!', seconds: 8, color: '#62c84e', desc: 'EXP gems are worth half.' },
  { id: AIL_POISON, key: 'poison', name: 'Poison', text: 'POISONED!', seconds: 5, color: '#b0e04a', desc: 'You lose 1% max HP per second, but never your last HP.' },
];

/** hero speed factor under Weakness, gem value factor under Curse, max HP fraction per second lost to Poison */
export const WEAKNESS_SPEED = 0.6;
export const CURSE_GEM = 0.5;
export const POISON_FRAC = 0.01;
/** the Holy Symbol passive shortens every ailment by this factor */
export const HOLY_SYMBOL_FACTOR = 0.5;

export class Ailments {
  /** seconds left by AIL_* id (slot 0 is unused) */
  left = [0, 0, 0, 0, 0, 0];
  /** ailments landed so far this run */
  applied = 0;

  get seal() { return this.left[AIL_SEAL] > 0; }
  get dark() { return this.left[AIL_DARKNESS] > 0; }
  get weak() { return this.left[AIL_WEAKNESS] > 0; }
  get curse() { return this.left[AIL_CURSE] > 0; }
  get poison() { return this.left[AIL_POISON] > 0; }
  /** how many are running */
  get count() {
    let n = 0;
    for (let i = 1; i < this.left.length; i++) if (this.left[i] > 0) n++;
    return n;
  }
}

/** Seconds an ailment lasts on the hero (the Holy Symbol halves it) */
export function ailmentSeconds(sim: Sim, id: number): number {
  const def = AILMENTS[id - 1];
  if (!def) return 0;
  return sim.passives.some((p) => p.key === 'holy_symbol') ? def.seconds * HOLY_SYMBOL_FACTOR : def.seconds;
}

/** Puts an ailment on the hero: a running one is refreshed to the full time, never extended or stacked. */
export function applyAilment(sim: Sim, id: number) {
  const def = AILMENTS[id - 1];
  if (!def || sim.over) return;
  sim.ail.left[id] = ailmentSeconds(sim, id);
  sim.ail.applied++;
  sim.emit({ type: 'ailment', ail: id, name: def.name, text: def.text });
}

/** Elixir, Apple and the cleric's Heal: every ailment ends. True when there was one. */
export function cureAilments(sim: Sim): boolean {
  const a = sim.ail;
  const had = a.count > 0;
  for (let i = 1; i < a.left.length; i++) a.left[i] = 0;
  return had;
}

/** Timers run down; Poison drains 1% of max HP per second but stops at 1 HP (and does nothing in god mode). */
export function updateAilments(sim: Sim, dt: number) {
  const a = sim.ail;
  for (let i = 1; i < a.left.length; i++) if (a.left[i] > 0) a.left[i] -= dt;
  if (a.left[AIL_POISON] > 0 && !sim.god && sim.hp > 1) {
    const lose = Math.min(sim.hp - 1, sim.maxHp * POISON_FRAC * dt);
    sim.hp -= lose;
    sim.damageTaken += lose;
  }
}
