import type { SkillKind } from './data.ts';
import type { GearItem } from './gear.ts';
import type { ScrollDef } from './scrolls.ts';

export interface Enemy {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  r: number;
  xp: number;
  tier: number;
  /** -1 for normal mobs, else boss index 0..5 */
  boss: number;
  /** the boss a wave is named after (not a companion); only it drops a Gachapon capsule */
  lead: boolean;
  big: boolean;
  add: boolean;
  alive: boolean;
  hitCd: number;
  slowT: number;
  /** stun: no movement and no contact hits; root: no movement; weak: deals WEAKEN_FACTOR damage */
  stunT: number;
  rootT: number;
  weakT: number;
  flash: number;
  /** sim time of the last hit it took (the renderer shows its HP bar for a few seconds after) */
  lastHit: number;
  /** 1 faces right, -1 faces left */
  facing: number;
  /** walk-cycle phase offset for the renderer */
  phase: number;
  moving: boolean;
  berserk: boolean;
  age: number;
  novaT: number;
  /** remaining nova cast time, 0 when not casting */
  castT: number;
  summonT: number;
  idx: number;
  /** Elite affix 1..5 (src/game/elites.ts), 0 for a normal mob */
  elite: number;
  /** Event mark (src/game/events.ts, fieldItems.ts): 0 none, else stampede / ring / treasure mob or a breakable box */
  ev: number;
  /** event mobs: fixed march direction (stampede) or flee-angle offset as cos / sin (treasure) */
  vx: number;
  vy: number;
  /** event timer: seconds left of a treasure pig's run, the next fire patch of a Blazing elite */
  evT: number;
  /** Mob behaviour (src/game/mobai.ts): BEH_* (0 for bosses and event mobs), flyers skip the crowding, an admitted ranged mob is a shooter */
  behave: number;
  fly: boolean;
  shooter: boolean;
  /** behaviour state (charge: CHARGE_* phase) and its timer: seconds to the next shot, or left in the phase / cooldown */
  bS: number;
  bT: number;
  /** charge: locked dash direction; ranged: bd is the distance it stops at */
  bx: number;
  by: number;
  bd: number;
  /** seconds left of the attack pose (the renderer plays the mob's attack1) */
  atk: number;
  /** bosses: seconds to the next ailment cast and left of the current one (0 = not casting) */
  ailT: number;
  ailC: number;
}

/** Enemy.behave values */
export const BEH_WALK = 0, BEH_RANGED = 1, BEH_CHARGE = 2;
/** Enemy.bS values of a charging mob */
export const CHARGE_IDLE = 0, CHARGE_TELEGRAPH = 1, CHARGE_DASH = 2;

/** A projectile a ranged mob shot at the hero (pooled by src/game/mobai.ts) */
export interface EnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** seconds left */
  life: number;
  /** seconds since it was shot (the renderer animates the ball with it) */
  age: number;
  dmg: number;
  /** ladder tier of the shooter (picks the art) */
  tier: number;
  /** AIL_* it applies on a hit, 0 for none */
  ail: number;
}

export type PickupKind = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export const GEM = 0, POTION = 1, MESO = 2, ELIXIR = 3, BAG = 4, GEAR = 5, SCROLL = 6, GACHA = 7, MASTERY = 8, FIELD = 9;

/** Enemy.ev values */
export const EV_STAMPEDE = 1, EV_RING = 2, EV_TREASURE = 3, EV_BOX = 4;

/** A fire patch a Blazing elite left on the ground */
export interface Fire {
  x: number;
  y: number;
  r: number;
  /** seconds left */
  t: number;
  dmg: number;
}

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  value: number;
  life: number;
  pulled: boolean;
  /** a gem the 2x EXP Coupon vacuumed: it is not doubled */
  vac: boolean;
  /** the item of a GEAR pickup */
  item: GearItem | null;
  /** the scroll of a SCROLL pickup */
  scroll: ScrollDef | null;
}

export interface Projectile {
  skill: string;
  pierce: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  life: number;
  target: Enemy | null;
  splash: number;
  pierceLeft: number;
  hits: Enemy[];
  nHits: number;
  slow: boolean;
  speed: number;
}

export interface Area {
  skill: string;
  x: number;
  y: number;
  r: number;
  t: number;
  dur: number;
  tick: number;
  dmg: number;
}

export interface SkillState {
  key: string;
  level: number;
  cd: number;
}
export interface PassiveState {
  key: string;
  level: number;
}

export interface Card {
  kind: 'skill' | 'passive' | 'elixir' | 'meso' | 'job' | 'mastery';
  key: string;
  /** mastery cards: key of an owned skill whose icon the card shows */
  icon?: string;
  name: string;
  isNew: boolean;
  from: number;
  to: number;
  desc: string;
  /** job cards: the two signature skills or passives, with a one-line description each */
  sig?: { key: string; name: string; desc: string }[];
}

/** One upgrade of a Gachapon capsule (src/game/gachapon.ts): a skill or passive level, the Mastery Book evolution, or mesos when nothing is left to upgrade. */
export interface GachaResult {
  kind: 'skill' | 'passive' | 'evolve' | 'meso';
  /** skill / passive key (evolve: the evolved skill; meso: 'mesobag') */
  key: string;
  name: string;
  from: number;
  to: number;
  /** evolve: the base skill that was replaced */
  base?: string;
  baseName?: string;
  /** meso: the amount */
  amount?: number;
}

export type SimEvent =
  | { type: 'hit'; x: number; y: number; amount: number; crit: boolean; boss: boolean; skill: string; tier: number; bossIdx: number }
  | { type: 'playerHit'; x: number; y: number; amount: number }
  | { type: 'death'; x: number; y: number; tier: number; boss: number; big: boolean; facing: number }
  | { type: 'cast'; skill: string; kind: SkillKind; x: number; y: number; tx: number; ty: number; r: number; pts: number[] | null }
  /** a skill fired (not orbit summons): once per fire, from the hero toward its aim */
  | { type: 'attack'; skill: string; kind: SkillKind; x: number; y: number; tx: number; ty: number }
  | { type: 'novaHit'; x: number; y: number; r: number; hit: boolean }
  | { type: 'ailHit'; x: number; y: number; r: number; hit: boolean }
  | { type: 'ailment'; ail: number; name: string; text: string }
  | { type: 'pickup'; kind: PickupKind; x: number; y: number; value: number }
  | { type: 'drop'; x: number; y: number; id: string; name: string; boss: boolean; /** item tier of a gear drop; absent for scrolls */ tier?: number }
  | { type: 'equip'; id: string; slot: string; auto: boolean }
  | { type: 'raid'; text: string }
  | { type: 'bossSpawn'; boss: number; name: string; x: number; y: number }
  | { type: 'bossDeath'; boss: number; name: string; x: number; y: number }
  | { type: 'levelUp'; level: number }
  | { type: 'scroll'; ok: boolean; slot: string; name: string; plus: number }
  | { type: 'card'; mob: number; name: string; complete: boolean }
  | { type: 'jobAdvance'; job: number; name: string; level: number }
  | { type: 'gacha'; boss: number; count: number; results: GachaResult[]; /** dropped by an Elite: not a boss capsule */ elite?: boolean }
  | { type: 'evolve'; from: string; to: string; name: string }
  | { type: 'region'; region: number }
  | { type: 'revive'; x: number; y: number; r: number }
  | { type: 'elite'; name: string; affix: string; x: number; y: number }
  | { type: 'swarm'; kind: 'stampede' | 'ring' | 'treasure' }
  | { type: 'box'; x: number; y: number }
  | { type: 'fieldItem'; item: number; x: number; y: number }
  | { type: 'end'; won: boolean };

/** A short message for the hero (scroll results, new Monster Book cards); the UI shows the ones whose `until` is still ahead of sim.t. */
export interface Note {
  id: number;
  text: string;
  kind: 'good' | 'bad' | 'card' | 'info';
  until: number;
}
