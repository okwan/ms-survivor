import type { SkillKind } from './data.ts';

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
  big: boolean;
  add: boolean;
  alive: boolean;
  hitCd: number;
  slowT: number;
  flash: number;
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
}

export type PickupKind = 0 | 1 | 2 | 3 | 4;
export const GEM = 0, POTION = 1, MESO = 2, ELIXIR = 3, BAG = 4;

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  value: number;
  life: number;
  pulled: boolean;
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
  kind: 'skill' | 'passive' | 'elixir' | 'meso';
  key: string;
  name: string;
  isNew: boolean;
  from: number;
  to: number;
  desc: string;
}

export type SimEvent =
  | { type: 'hit'; x: number; y: number; amount: number; crit: boolean; boss: boolean }
  | { type: 'playerHit'; x: number; y: number; amount: number }
  | { type: 'death'; x: number; y: number; tier: number; boss: number; big: boolean }
  | { type: 'cast'; skill: string; kind: SkillKind; x: number; y: number; tx: number; ty: number; r: number; pts: number[] | null }
  | { type: 'novaHit'; x: number; y: number; r: number; hit: boolean }
  | { type: 'pickup'; kind: PickupKind; x: number; y: number; value: number }
  | { type: 'raid'; text: string }
  | { type: 'bossSpawn'; boss: number; name: string; x: number; y: number }
  | { type: 'bossDeath'; boss: number; name: string; x: number; y: number }
  | { type: 'levelUp'; level: number }
  | { type: 'end'; won: boolean };
