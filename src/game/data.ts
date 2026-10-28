/** Static tables from docs/DESIGN.md. Pure data and tiny helpers, no DOM. */

export const PX_PER_YD = 20;
export const RUN_LENGTH = 900;
export const BOSS_EVERY = 135;
export const TICK = 1 / 60;
export const MAX_ALIVE = 280;
export const MAX_GEMS = 350;
export const SPAWN_INTERVAL = 0.12;
export const SPAWN_RING_MIN = 34;
export const SPAWN_RING_MAX = 42;
export const RECYCLE_DIST = 60;
export const PLAYER_BASE = { hp: 120, speed: 7, magnet: 4.5, radius: 0.7, crit: 0.05, critMult: 2 };
export const MAX_SKILLS = 6;
export const MAX_PASSIVES = 6;
export const SKILL_MAX_LEVEL = 8;
export const PASSIVE_MAX_LEVEL = 5;
/**
 * Character level makes every hit bigger, like stat points in MapleStory. Runs reach level 200+: the bonus grows with the square
 * root of levels gained (x1.6 at level 10, x2.2 at 40), and from level 40 on a steady +2% per level keeps every level band
 * visibly stronger (x3.6 at 80, x6.8 at 190).
 */
export const levelDamageMult = (level: number) => 1 + 0.2 * Math.sqrt(Math.max(0, level - 1)) + 0.02 * Math.max(0, level - 40);
/** Max HP gained per character level, up to level LEVEL_HP_CAP */
export const LEVEL_HP = 3;
export const LEVEL_HP_CAP = 90;
/**
 * Enemy health and contact damage grow with run progress p (0..1): x(1 + a p + b p^2). The quadratic term keeps the first minutes as
 * gentle as before (x1.4 health at 2 minutes) and makes the late game bite: health x11.5 and damage x12 at 15 minutes.
 */
export const ENEMY_HP_GROWTH = 2.5;
export const ENEMY_HP_GROWTH2 = 8.0;
export const ENEMY_DMG_GROWTH = 3.0;
export const ENEMY_DMG_GROWTH2 = 8.0;
/** Armor is a percentage with diminishing returns: armor / (armor + ARMOR_K) of every hit is absorbed, at most ARMOR_CAP (34 armor = -46%, 20 = -33%) */
export const ARMOR_K = 40;
export const ARMOR_CAP = 0.6;
export const armorReduction = (armor: number) => Math.min(ARMOR_CAP, Math.max(0, armor) / (Math.max(0, armor) + ARMOR_K));
/** damage that lands after armor: never below 1 */
export const mitigated = (dmg: number, armor: number) => Math.max(1, dmg * (1 - armorReduction(armor)));
export const enemyHpMult = (p: number) => 1 + ENEMY_HP_GROWTH * p + ENEMY_HP_GROWTH2 * p * p;
export const enemyDmgMult = (p: number) => 1 + ENEMY_DMG_GROWTH * p + ENEMY_DMG_GROWTH2 * p * p;
/**
 * Mob.wz info/speed is an offset in percent (0 normal, -100 slowest, positive faster): move speed = BASE_ENEMY_SPEED * (1 + speed / 100),
 * never below MIN_SPEED_FACTOR of the base and never above ENEMY_SPEED_CAP of the hero's base speed, so nothing outruns the hero.
 */
export const BASE_ENEMY_SPEED = 4.4;
export const MIN_SPEED_FACTOR = 0.3;
export const MAX_SPEED_FACTOR = 2;
export const ENEMY_SPEED_CAP = 0.95;
/** speed multiplier of a mob from its info/speed (or info/flySpeed for flyers) offset, and info/fs (a float multiplier) when no offset exists; undefined when the data has neither */
export function mobSpeedFactor(info: { speed?: number; flySpeed?: number; fs?: number }, flies = false): number | undefined {
  const off = flies && info.flySpeed !== undefined ? info.flySpeed : info.speed;
  let f: number | undefined;
  if (typeof off === 'number' && Number.isFinite(off)) f = 1 + off / 100;
  else if (typeof info.fs === 'number' && Number.isFinite(info.fs) && info.fs > 0) f = info.fs;
  if (f === undefined) return undefined;
  return Math.max(MIN_SPEED_FACTOR, Math.min(MAX_SPEED_FACTOR, f));
}
/** yd/s of an enemy: the hand-tuned `fallback` unless the manifest gave a factor, always at most ENEMY_SPEED_CAP of the hero's base speed */
export function enemySpeed(fallback: number, factor: number | undefined, heroSpeed: number): number {
  const v = factor === undefined ? fallback : BASE_ENEMY_SPEED * factor;
  return Math.min(v, ENEMY_SPEED_CAP * heroSpeed);
}
export const START_REROLLS = 2;
export const START_BANISHES = 2;

/** How a ladder mob moves (src/game/mobai.ts): walk straight at the hero, stop at range and shoot, or telegraph and dash */
export type Behave = 'walk' | 'ranged' | 'charge';
/** Ailments of the hero (src/game/ailments.ts) */
export const AIL_NONE = 0, AIL_SEAL = 1, AIL_DARKNESS = 2, AIL_WEAKNESS = 3, AIL_CURSE = 4, AIL_POISON = 5;

export interface MobDef {
  name: string;
  id: number;
  hp: number;
  speed: number;
  dmg: number;
  xp: number;
  big: boolean;
  behave: Behave;
  /** flyers ignore the crowding the walkers use and bob a little */
  fly: boolean;
  /** ranged mobs: the ailment (AIL_*) a shot carries with MOB_SHOT_AIL_CHANCE */
  shotAil: number;
}

/** per-tier behaviour by name: behave, fly, shot ailment (every other tier walks) */
const BEHAVE: Record<string, [Behave, boolean, number]> = {
  'Pig': ['charge', false, AIL_NONE],
  'Ribbon Pig': ['charge', false, AIL_NONE],
  'Axe Stump': ['charge', false, AIL_NONE],
  'Wild Boar': ['charge', false, AIL_NONE],
  'Fire Boar': ['charge', false, AIL_NONE],
  'Evil Eye': ['ranged', true, AIL_NONE],
  'Curse Eye': ['ranged', true, AIL_DARKNESS],
  'Jr. Boogie': ['ranged', true, AIL_NONE],
  'Lupin': ['ranged', false, AIL_NONE],
  'Wraith': ['ranged', true, AIL_CURSE],
};

// name, id, hp, speed, dmg, xp, big
const L: [string, number, number, number, number, number, boolean][] = [
  ['Snail', 100100, 8, 3.6, 2, 1, false],
  ['Blue Snail', 100101, 10, 4.4, 2, 1, false],
  ['Shroom', 120100, 16, 3.4, 3, 2, false],
  ['Red Snail', 130101, 18, 3.6, 4, 2, false],
  ['Stump', 130100, 22, 4.8, 8, 2, false],
  ['Slime', 210100, 26, 4.6, 8, 3, false],
  ['Pig', 1210100, 36, 4.0, 10, 3, false],
  ['Orange Mushroom', 1210102, 40, 4.0, 11, 3, false],
  ['Ribbon Pig', 1210101, 34, 5.0, 10, 3, false],
  ['Green Mushroom', 1110100, 44, 5.2, 12, 4, false],
  ['Dark Stump', 1110101, 70, 3.3, 14, 5, false],
  ['Octopus', 1120100, 55, 3.8, 12, 4, false],
  ['Horny Mushroom', 2110200, 60, 5.0, 13, 4, false],
  ['Blue Mushroom', 2220100, 85, 4.6, 16, 5, false],
  ['Evil Eye', 2230100, 75, 5.4, 15, 5, false],
  ['Zombie Mushroom', 2230101, 90, 4.2, 16, 6, false],
  ['Axe Stump', 1130100, 95, 5.0, 18, 6, false],
  ['Jr. Necki', 2130103, 120, 3.6, 20, 7, false],
  ['Wild Boar', 2230102, 150, 4.0, 22, 8, true],
  ['Ligator', 3110100, 220, 3.2, 28, 12, true],
  ['Curse Eye', 3230100, 160, 5.6, 24, 8, false],
  ['Fire Boar', 3210100, 180, 4.2, 26, 10, true],
  ['Jr. Boogie', 3230300, 90, 6.0, 18, 5, false],
  ['Copper Drake', 4130100, 240, 4.4, 30, 12, true],
  ['Lupin', 3210800, 200, 6.0, 30, 10, false],
  ['Wraith', 4230102, 280, 4.6, 34, 14, false],
  ['Stone Golem', 5130101, 300, 4.6, 36, 14, true],
  ['Drake', 5130100, 420, 3.4, 42, 24, true],
  ['Dark Stone Golem', 5130102, 380, 4.4, 44, 22, true],
  ['Mixed Golem', 5150000, 360, 5.0, 40, 20, true],
];

/** Health, damage and xp read from the running peak of the ladder (Azeroth `ladder()`): no later tier is softer. */
export const LADDER: MobDef[] = (() => {
  let ph = 0,
    pd = 0,
    px = 0;
  return L.map(([name, id, hp, speed, dmg, xp, big]) => {
    ph = Math.max(ph, hp);
    pd = Math.max(pd, dmg);
    px = Math.max(px, xp);
    const [behave, fly, shotAil] = BEHAVE[name] ?? ['walk', false, AIL_NONE];
    return { name, id, hp: ph, speed, dmg: pd, xp: px, big, behave, fly, shotAil };
  });
})();
export const TIERS = LADDER.length;

export interface BossDef {
  name: string;
  id: number;
  hp: number;
  speed: number;
  dmg: number;
  xp: number;
  scale: number;
  nova: boolean;
  summon: boolean;
  berserk: boolean;
  /** ailment mechanic: the AIL_* ids its circle applies (empty = none) */
  ailments: number[];
}
const B = (name: string, id: number, hp: number, speed: number, dmg: number, xp: number, scale: number, m: string, ailments: number[] = []): BossDef => ({
  name, id, hp, speed, dmg, xp, scale,
  nova: m.includes('nova'), summon: m.includes('summon'), berserk: m.includes('berserk'), ailments,
});
export const BOSSES: BossDef[] = [
  B('Mano', 2220000, 1200, 5.2, 20, 60, 1.6, 'nova', [AIL_WEAKNESS]),
  B('Mushmom', 6130101, 8000, 5.4, 32, 120, 1.6, 'nova summon', [AIL_POISON]),
  B('King Slime', 9300003, 25000, 4.0, 45, 200, 1.7, 'summon berserk', [AIL_WEAKNESS]),
  B('Zombie Mushmom', 6300005, 45000, 5.6, 55, 300, 1.7, 'nova summon berserk', [AIL_CURSE]),
  B('Jr. Balrog', 8130100, 75000, 5.0, 70, 400, 1.8, 'nova summon berserk', [AIL_SEAL]),
  B('Zakum', 8800000, 150000, 4.8, 90, 500, 1.8, 'nova summon berserk', [AIL_DARKNESS, AIL_SEAL]),
];
/** bosses per boss time: from the 3rd boss on a wave brings companions (earlier-ladder bosses at BOSS_COMPANION_HP of their health) */
export const BOSS_WAVES = [1, 1, 2, 2, 3, 3];
export const BOSS_COMPANION_HP = 0.7;
/** bosses in a full run: the sum of the waves */
export const BOSS_TOTAL = BOSS_WAVES.reduce((a, b) => a + b, 0);
/** most boss health bars shown at once */
export const BOSS_BARS = 3;
export const NOVA_EVERY = 10;
export const NOVA_CAST = 2.0;
export const NOVA_RADIUS = 9;
export const NOVA_DAMAGE_FRAC = 0.35;
export const SUMMON_EVERY = 14;
export const SUMMON_COUNT = 8;
export const SUMMON_RING = 4;
export const BERSERK_AFTER = 75;

// ---- formulas ----------------------------------------------------------------------------------

export function xpToNext(level: number): number {
  if (level < 20) return 5 + 10 * (level - 1);
  if (level < 40) return 195 + 13 * (level - 20);
  return 455 + 16 * (level - 40);
}

export function progress(elapsed: number): number {
  const p = elapsed / RUN_LENGTH;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** First tier of the 3-tier enemy pool at elapsed seconds (integer math as in the spec). */
export function poolLo(elapsed: number): number {
  const p = progress(elapsed);
  const step = Math.floor(p * 30);
  const span = TIERS - 3;
  return Math.min(span, Math.floor((Math.max(0, step - 1) * span) / 27));
}

/** the alive target: 24 at the start, +360 over the run, capped at MAX_ALIVE (reached at 11:07) */
export function aliveTarget(elapsed: number): number {
  return Math.min(MAX_ALIVE, Math.floor(24 + 360 * progress(elapsed)));
}

export function mesoValue(tier: number): number {
  return 1 + Math.floor(tier / 3);
}

// ---- skills & passives -------------------------------------------------------------------------

/** seconds a Cold Beam slow lasts at level 1 */
export const SLOW_DURATION = 2.5;

export type SkillKind = 'bolt' | 'pierce' | 'strike' | 'ground' | 'nova' | 'chain' | 'melee' | 'cone' | 'orbit';
export type Element = 'arcane' | 'fire' | 'ice' | 'lightning' | 'poison';

export interface SkillDef {
  key: string;
  name: string;
  id: number;
  kind: SkillKind;
  element: Element;
  dmg: number;
  cd: number;
  range: number;
  radius: number;
  count: number;
  desc: string;
  /** missile speed in yd/s (bolt, pierce); default MISSILE_SPEED */
  missile?: number;
  /** melee / bolt / cone: number of times each target is hit */
  hits?: number;
  /** pierce: enemies passed = pierceBase + level (default 3) */
  pierceBase?: number;
  /** ground: area duration in seconds (default POISON_DURATION) */
  dur?: number;
  /** status effects, base seconds (scaled like a duration by skill level) */
  stun?: number;
  root?: number;
  slow?: number;
  /** fraction of damage dealt healed to the hero, capped at DRAIN_CAP per hit */
  drain?: number;
  /** enemies hit deal WEAKEN_FACTOR damage for this many seconds */
  weaken?: number;
  /** nova: heals the hero by this much per cast (scaled like damage by skill level) */
  heal?: number;
  /** melee: chance per hit that the enemy drops a meso pickup */
  steal?: number;
  /** a 4th-job skill from a Mastery Book (src/game/evolutions.ts): replaces its base skill, always at SKILL_MAX_LEVEL, never offered on cards */
  evolved?: true;
}
const S = (key: string, name: string, id: number, kind: SkillKind, element: Element, dmg: number, cd: number, range: number, radius: number, count: number, desc: string, extra: Partial<SkillDef> = {}): SkillDef =>
  ({ key, name, id, kind, element, dmg, cd, range, radius, count, desc, ...extra });

// ---- skills by job (docs/CLASSES.md) ------------------------------------------------------------
// The job of a skill or passive is its id / 10000 (1001004 -> 100 Warrior, 1111005 -> 111 Crusader). Every skill id is a v83 Skill.wz id.

const WARRIOR_SKILLS: SkillDef[] = [
  // Warrior (1st job)
  S('power_strike', 'Power Strike', 1001004, 'melee', 'fire', 18, 0.9, 4.5, 2, 1, 'A heavy blow that hurts the enemies around the target.'),
  S('slash_blast', 'Slash Blast', 1001005, 'cone', 'fire', 14, 1.6, 0, 6, 1, 'Slashes everything in front of you.'),
  // Fighter, Page, Spearman: Final Attack, a follow-up swing around the hero
  S('final_attack_fighter', 'Final Attack: Sword/Axe', 1100002, 'melee', 'fire', 22, 1.2, 4.5, 3, 1, 'A follow-up swing that hits the enemies around the target.'),
  S('final_attack_page', 'Final Attack: Sword/Blunt', 1200002, 'melee', 'ice', 22, 1.2, 4.5, 3, 1, 'A follow-up swing that hits the enemies around the target.'),
  S('final_attack_spearman', 'Final Attack: Spear', 1300002, 'melee', 'lightning', 22, 1.2, 4.5, 3, 1, 'A follow-up thrust that hits the enemies around the target.'),
  // Page
  S('threaten', 'Threaten', 1201006, 'nova', 'arcane', 6, 4.5, 0, 7, 1, 'A glare that weakens the hits of everything around you.', { weaken: 4 }),
  // White Knight
  S('charge_blow', 'Charged Blow', 1211002, 'melee', 'lightning', 30, 3.0, 5, 2.5, 1, 'A stunning blow with splash damage.', { stun: 1.0 }),
  S('ice_charge', 'Ice Charge', 1211005, 'strike', 'ice', 26, 3.2, 8, 3, 1, 'A frozen blow that slows enemies.', { slow: 2 }),
  // Crusader
  S('coma', 'Coma', 1111005, 'melee', 'arcane', 12, 1.4, 5, 0, 3, 'Stuns up to three nearby enemies.', { stun: 0.5 }),
  S('panic', 'Panic', 1111003, 'cone', 'poison', 22, 3.5, 0, 8, 1, 'Weakens the hits of enemies in front.', { weaken: 4 }),
  S('shout', 'Shout', 1111008, 'nova', 'lightning', 10, 5.0, 0, 7, 1, 'A roar that stuns everything around you.', { stun: 1.5 }),
  // Dragon Knight
  S('spear_crusher', 'Spear Crusher', 1311001, 'melee', 'arcane', 9, 1.0, 5.5, 0, 3, 'Thrusts twice into nearby enemies.', { hits: 2 }),
  S('dragon_roar', 'Dragon Roar', 1311006, 'nova', 'fire', 30, 7.0, 0, 10, 1, 'A mighty roar that blasts all around.'),
  S('dragon_fury', 'Dragon Fury', 1311003, 'cone', 'fire', 26, 3.0, 0, 8, 1, 'Sweeps the spear through everything in front.'),
  S('sacrifice', 'Sacrifice', 1311005, 'melee', 'fire', 55, 6.0, 5, 2, 1, 'One enormous blow to the nearest enemy.'),
];
const MAGICIAN_SKILLS: SkillDef[] = [
  // Magician (1st job)
  { key: 'magic_claw', name: 'Magic Claw', id: 2001005, kind: 'bolt', element: 'arcane', dmg: 10, cd: 1.2, range: 22, radius: 0, count: 2, desc: 'Fires magic claws at the nearest enemies.' },
  { key: 'energy_bolt', name: 'Energy Bolt', id: 2001004, kind: 'pierce', element: 'arcane', dmg: 14, cd: 2.0, range: 24, radius: 0, count: 1, desc: 'A bolt that pierces through enemies.' },
  // Fire/Poison Wizard
  { key: 'fire_arrow', name: 'Fire Arrow', id: 2101004, kind: 'bolt', element: 'fire', dmg: 20, cd: 2.4, range: 26, radius: 3.5, count: 1, desc: 'Explodes on impact for area damage.' },
  S('poison_breath', 'Poison Breath', 2101005, 'bolt', 'poison', 15, 2.0, 22, 2.5, 1, 'A venomous bolt that bursts on impact.'),
  // Fire/Poison Mage
  { key: 'explosion', name: 'Explosion', id: 2111002, kind: 'nova', element: 'fire', dmg: 16, cd: 4.0, range: 0, radius: 7, count: 1, desc: 'Blasts everything around you.' },
  { key: 'poison_mist', name: 'Poison Mist', id: 2111003, kind: 'ground', element: 'poison', dmg: 7, cd: 8.0, range: 20, radius: 6, count: 1, desc: 'Poison cloud on the thickest crowd.' },
  // Ice/Lightning Wizard
  { key: 'cold_beam', name: 'Cold Beam', id: 2201004, kind: 'strike', element: 'ice', dmg: 22, cd: 2.6, range: 20, radius: 2.5, count: 1, desc: 'Instant frost blast that slows enemies.', slow: SLOW_DURATION },
  { key: 'thunder_bolt', name: 'Thunder Bolt', id: 2201005, kind: 'strike', element: 'lightning', dmg: 12, cd: 3.0, range: 10, radius: 0, count: 4, desc: 'Strikes the nearest enemies instantly.' },
  // Ice/Lightning Mage
  S('ice_strike', 'Ice Strike', 2211002, 'nova', 'ice', 24, 5.0, 0, 7, 1, 'A freezing burst that slows everything around you.', { slow: 2.5 }),
  S('thunder_spear', 'Thunder Spear', 2211003, 'pierce', 'lightning', 24, 2.4, 26, 0, 1, 'A spear of lightning that pierces enemies.'),
  // Cleric
  S('holy_arrow', 'Holy Arrow', 2301005, 'bolt', 'lightning', 14, 1.5, 24, 0, 1, 'A holy arrow at the nearest enemy.'),
  S('heal', 'Heal', 2301002, 'nova', 'arcane', 9, 4.0, 0, 6, 1, 'Holy light that hurts the undead around you and heals you.', { heal: 4 }),
  // Priest
  S('shining_ray', 'Shining Ray', 2311004, 'nova', 'lightning', 26, 4.8, 0, 8, 1, 'A blinding ray that blasts everything around you.'),
  S('summon_dragon', 'Summon Dragon', 2311006, 'orbit', 'fire', 22, 1.4, 14, 0, 1, 'A dragon circles you and strikes enemies.'),
  S('doom', 'Doom', 2311005, 'strike', 'poison', 16, 5.0, 16, 4, 1, 'A curse that roots enemies in place.', { root: 2.5 }),
];
const BOWMAN_SKILLS: SkillDef[] = [
  // Bowman (1st job)
  S('arrow_blow', 'Arrow Blow', 3001004, 'bolt', 'arcane', 12, 1.0, 24, 0, 1, 'Shoots the nearest enemy.', { missile: 36 }),
  S('double_shot', 'Double Shot', 3001005, 'bolt', 'arcane', 8, 1.3, 24, 0, 2, 'Fires arrows at the nearest enemies.'),
  // Hunter
  S('arrow_bomb', 'Arrow Bomb', 3101005, 'bolt', 'fire', 16, 2.6, 24, 3.5, 1, 'An exploding arrow that stuns.', { stun: 0.8 }),
  S('knockback_hunter', 'Power Knock-Back', 3101003, 'cone', 'arcane', 18, 2.0, 0, 8, 1, 'A powerful shot that staggers enemies in front.', { stun: 0.4 }),
  // Ranger
  S('arrow_rain', 'Arrow Rain', 3111004, 'ground', 'arcane', 8, 8.0, 22, 6, 1, 'Rains arrows on the thickest crowd.', { dur: 4 }),
  S('strafe', 'Strafe', 3111006, 'bolt', 'arcane', 7, 2.0, 24, 0, 4, 'A volley at the nearest enemies.'),
  S('silver_hawk', 'Silver Hawk', 3111005, 'orbit', 'lightning', 14, 1.2, 14, 0, 1, 'A hawk circles you and strikes enemies.'),
  S('inferno', 'Inferno', 3111003, 'strike', 'fire', 26, 3.6, 18, 4, 1, 'A fire arrow that bursts on the enemy.'),
  // Crossbowman
  S('iron_arrow', 'Iron Arrow', 3201005, 'pierce', 'arcane', 18, 2.2, 26, 0, 1, 'An arrow that pierces many enemies.'),
  S('knockback_xbow', 'Power Knock-Back', 3201003, 'cone', 'arcane', 20, 2.2, 0, 8, 1, 'A powerful bolt that staggers enemies in front.', { stun: 0.4 }),
  // Sniper
  S('blizzard', 'Blizzard', 3211003, 'strike', 'ice', 24, 4.0, 20, 4, 1, 'Freezing storm that slows enemies.', { slow: 2 }),
  S('arrow_eruption', 'Arrow Eruption', 3211004, 'strike', 'arcane', 12, 3.0, 20, 2, 3, 'Arrows erupt under the nearest enemies.'),
  S('golden_eagle', 'Golden Eagle', 3211005, 'orbit', 'lightning', 16, 1.1, 14, 0, 1, 'An eagle circles you and strikes enemies.'),
  S('strafe_sniper', 'Strafe', 3211006, 'bolt', 'arcane', 8, 2.2, 24, 0, 4, 'A volley of bolts at the nearest enemies.'),
];
const THIEF_SKILLS: SkillDef[] = [
  // Thief (1st job)
  S('lucky_seven', 'Lucky Seven', 4001344, 'bolt', 'arcane', 20.7, 0.9, 22, 0, 2, 'Throws stars at the nearest enemies.'),
  S('double_stab', 'Double Stab', 4001334, 'melee', 'arcane', 23, 0.8, 4, 0, 1, 'Two quick stabs.', { hits: 2 }),
  S('disorder', 'Disorder', 4001002, 'melee', 'poison', 18.4, 1.6, 4, 0, 1, 'A stab that weakens the enemy.', { weaken: 3 }),
  // Assassin
  S('drain', 'Drain', 4101005, 'melee', 'poison', 32.2, 2.0, 4.5, 0, 2, 'Steals life from nearby enemies.', { drain: 0.2 }),
  // Hermit
  S('avenger', 'Avenger', 4111005, 'pierce', 'arcane', 46, 2.0, 26, 0, 1, 'A star that pierces through enemies.', { pierceBase: 4 }),
  S('shadow_web', 'Shadow Web', 4111003, 'strike', 'poison', 13.8, 6.0, 12, 5, 1, 'Roots enemies in a web.', { root: 3 }),
  S('shadow_meso', 'Shadow Meso', 4111004, 'bolt', 'fire', 32.2, 2.0, 22, 3, 1, 'A meso that explodes on impact.'),
  // Bandit
  S('savage_blow', 'Savage Blow', 4201005, 'melee', 'fire', 13.8, 1.2, 4.5, 0, 1, 'Six savage strikes.', { hits: 6 }),
  S('steal', 'Steal', 4201004, 'melee', 'arcane', 32.2, 1.2, 4.5, 0, 1, 'A stab that sometimes makes the enemy drop mesos.', { steal: 0.3 }),
  // Chief Bandit
  S('meso_explosion', 'Meso Explosion', 4211006, 'nova', 'fire', 46, 5.0, 0, 8, 1, 'Mesos explode around you.'),
  S('band_of_thieves', 'Band of Thieves', 4211004, 'cone', 'poison', 36.8, 3.0, 0, 8, 1, 'Your band rushes the enemies ahead.'),
  S('assaulter', 'Assaulter', 4211002, 'melee', 'arcane', 103.5, 5.0, 7, 0, 1, 'Dash in and strike the nearest enemy.'),
];
export const SKILLS: SkillDef[] = [...MAGICIAN_SKILLS, ...WARRIOR_SKILLS, ...BOWMAN_SKILLS, ...THIEF_SKILLS];
export const SKILL_BY_KEY: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.key, s]));

export type PassiveStat = 'might' | 'maxHp' | 'speed' | 'haste' | 'armor' | 'area' | 'magnet' | 'growth' | 'regen' | 'crit';
export interface PassiveDef {
  key: string;
  name: string;
  id: number;
  stat: PassiveStat;
  per: number;
  desc: string;
  /** a second effect per level (Bless: armor and crit) */
  also?: { stat: PassiveStat; per: number };
}
const PS = (key: string, name: string, id: number, stat: PassiveStat, per: number, desc: string, also?: PassiveDef['also']): PassiveDef =>
  ({ key, name, id, stat, per, desc, ...(also ? { also } : {}) });
const D = {
  might: (p: number) => `+${Math.round(p * 100)}% damage`,
  haste: (p: number) => `+${Math.round(p * 100)}% cooldown speed`,
  armor: '+1 armor',
  crit: (p: number) => `+${Math.round(p * 100)}% crit chance`,
};
export const PASSIVES: PassiveDef[] = [
  // Warrior
  PS('improved_hp_recovery', 'Improved HP Recovery', 1000000, 'regen', 1, '+1 HP per second'),
  PS('improved_max_hp', 'Improved MaxHP Increase', 1000001, 'maxHp', 0.2, '+20% max HP'),
  PS('endure', 'Endure', 1000002, 'armor', 1, D.armor),
  PS('iron_body', 'Iron Body', 1001003, 'armor', 1, D.armor),
  PS('rage', 'Rage', 1101006, 'might', 0.15, D.might(0.15)),
  PS('power_guard_fighter', 'Power Guard', 1101007, 'armor', 1, D.armor),
  PS('sword_booster_fighter', 'Sword Booster', 1101004, 'haste', 0.08, D.haste(0.08)),
  PS('combo_attack', 'Combo Attack', 1111002, 'might', 0.08, D.might(0.08)),
  PS('power_guard_page', 'Power Guard', 1201007, 'armor', 1, D.armor),
  PS('sword_booster_page', 'Sword Booster', 1201004, 'haste', 0.08, D.haste(0.08)),
  PS('fire_charge', 'Fire Charge', 1211003, 'might', 0.08, D.might(0.08)),
  PS('hyper_body', 'Hyper Body', 1301007, 'maxHp', 0.2, '+20% max HP'),
  PS('iron_will', 'Iron Will', 1301006, 'armor', 1, D.armor),
  PS('spear_booster', 'Spear Booster', 1301004, 'haste', 0.08, D.haste(0.08)),
  // Magician
  PS('improved_mp_recovery', 'Improved MP Recovery', 2000000, 'haste', 0.05, D.haste(0.05)),
  PS('improved_max_mp', 'Improved MaxMP Increase', 2000001, 'area', 0.08, '+8% area'),
  PS('magic_guard', 'Magic Guard', 2001002, 'armor', 1, D.armor),
  PS('magic_armor', 'Magic Armor', 2001003, 'maxHp', 0.1, '+10% max HP'),
  PS('meditation_fp', 'Meditation', 2101001, 'might', 0.08, D.might(0.08)),
  PS('mp_eater_fp', 'MP Eater', 2100000, 'regen', 0.4, '+0.4 HP per second'),
  PS('element_amp_fp', 'Element Amplification', 2110001, 'might', 0.1, D.might(0.1)),
  PS('spell_booster_fp', 'Spell Booster', 2111005, 'haste', 0.08, D.haste(0.08)),
  PS('meditation_il', 'Meditation', 2201001, 'might', 0.08, D.might(0.08)),
  PS('mp_eater_il', 'MP Eater', 2200000, 'regen', 0.4, '+0.4 HP per second'),
  PS('element_amp_il', 'Element Amplification', 2210001, 'might', 0.1, D.might(0.1)),
  PS('spell_booster_il', 'Spell Booster', 2211005, 'haste', 0.08, D.haste(0.08)),
  PS('bless', 'Bless', 2301004, 'armor', 1, '+1 armor and +2% crit chance', { stat: 'crit', per: 0.02 }),
  PS('invincible', 'Invincible', 2301003, 'armor', 1, D.armor),
  PS('holy_symbol', 'Holy Symbol', 2311003, 'growth', 0.08, '+8% experience'),
  // Bowman
  PS('blessing_of_amazon', 'Blessing of Amazon', 3000000, 'might', 0.1, D.might(0.1)),
  PS('critical_shot', 'Critical Shot', 3000001, 'crit', 0.04, D.crit(0.04)),
  PS('eye_of_amazon', 'The Eye of Amazon', 3000002, 'magnet', 0.4, '+40% pickup range'),
  PS('focus', 'Focus', 3001003, 'armor', 1, '+1 armor and +3% crit chance', { stat: 'crit', per: 0.03 }),
  PS('soul_arrow_hunter', 'Soul Arrow: Bow', 3101004, 'might', 0.08, D.might(0.08)),
  PS('bow_booster', 'Bow Booster', 3101002, 'haste', 0.08, D.haste(0.08)),
  PS('final_attack_hunter', 'Final Attack: Bow', 3100001, 'crit', 0.04, D.crit(0.04)),
  PS('mortal_blow_ranger', 'Mortal Blow', 3110001, 'crit', 0.04, D.crit(0.04)),
  PS('soul_arrow_xbow', 'Soul Arrow: Crossbow', 3201004, 'might', 0.08, D.might(0.08)),
  PS('xbow_booster', 'Crossbow Booster', 3201002, 'haste', 0.08, D.haste(0.08)),
  PS('final_attack_xbow', 'Final Attack: Crossbow', 3200001, 'crit', 0.04, D.crit(0.04)),
  PS('mortal_blow_sniper', 'Mortal Blow', 3210001, 'crit', 0.04, D.crit(0.04)),
  // Thief
  PS('nimble_body', 'Nimble Body', 4000000, 'speed', 0.1, '+10% move speed'),
  PS('keen_eyes', 'Keen Eyes', 4000001, 'magnet', 0.4, '+40% pickup range'),
  PS('dark_sight', 'Dark Sight', 4001003, 'armor', 1, D.armor),
  PS('haste_assassin', 'Haste', 4101004, 'speed', 0.1, '+10% move speed'),
  PS('critical_throw', 'Critical Throw', 4100001, 'crit', 0.04, D.crit(0.04)),
  PS('claw_booster', 'Claw Booster', 4101003, 'haste', 0.08, D.haste(0.08)),
  PS('shadow_partner', 'Shadow Partner', 4111002, 'might', 0.08, D.might(0.08)),
  PS('meso_up', 'Meso Up', 4111001, 'growth', 0.08, '+8% experience'),
  PS('haste_bandit', 'Haste', 4201003, 'speed', 0.1, '+10% move speed'),
  PS('dagger_booster', 'Dagger Booster', 4201002, 'haste', 0.1, D.haste(0.1)),
  PS('meso_guard', 'Meso Guard', 4211005, 'armor', 1, D.armor),
];
export const PASSIVE_BY_KEY: Record<string, PassiveDef> = Object.fromEntries(PASSIVES.map((p) => [p.key, p]));

// ---- Masteries: endless upgrades once the skill and passive slots are maxed or full -------------------------

export type MasteryKey = 'mastery' | 'vitality' | 'swiftness' | 'focus' | 'haste' | 'reach' | 'magnet';
export interface MasteryDef {
  key: MasteryKey;
  name: string;
  /** stat gained per stack (fraction) */
  per: number;
  /** most the stacks can add in total (Infinity = no cap) */
  cap: number;
  desc: string;
}
export const MASTERIES: MasteryDef[] = [
  { key: 'mastery', name: 'Mastery', per: 0.08, cap: Infinity, desc: '+8% damage. Stacks forever.' },
  { key: 'vitality', name: 'Vitality', per: 0.1, cap: Infinity, desc: '+10% max HP and heals 25%.' },
  { key: 'swiftness', name: 'Swiftness', per: 0.04, cap: 0.4, desc: '+4% move speed (max +40%).' },
  { key: 'focus', name: 'Focus', per: 0.03, cap: 0.6, desc: '+3% crit chance (max +60%).' },
  { key: 'haste', name: 'Haste', per: 0.04, cap: 0.4, desc: '+4% cooldown speed (max +40%).' },
  { key: 'reach', name: 'Reach', per: 0.06, cap: Infinity, desc: '+6% area.' },
  { key: 'magnet', name: 'Magnet', per: 0.1, cap: Infinity, desc: '+10% pickup range.' },
];
export const MASTERY_BY_KEY: Record<string, MasteryDef> = Object.fromEntries(MASTERIES.map((m) => [m.key, m]));
/** most stacks of a mastery (Infinity when uncapped) */
export const masteryMax = (m: MasteryDef) => (m.cap === Infinity ? Infinity : Math.round(m.cap / m.per));
/** Skill Mastery: damage per stack for the one skill, uncapped */
export const SKILL_MASTERY_PER = 0.1;
export const SKILL_MASTERY_PREFIX = 'skill_mastery:';
export const VITALITY_HEAL = 0.25;
/** chance that a Mastery card slot after the first turns into an Elixir or Meso Bag instead */
export const MASTERY_FILLER_CHANCE = 0.1;

// Level scaling (Azeroth `Owned`)
export const skillDmgMult = (L: number) => 1 + 0.3 * (L - 1);
export function skillCooldown(def: SkillDef, L: number, haste: number): number {
  return Math.max(0.2, def.cd * Math.pow(0.93, L - 1) * Math.max(0.35, 1 - haste));
}
export const skillCount = (def: SkillDef, L: number) => def.count + (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0) + (L >= 7 ? 1 : 0);
export const skillRadius = (def: SkillDef, L: number, area: number) => def.radius * (1 + 0.08 * (L - 1)) * area;
export const skillDuration = (base: number, L: number) => base * (1 + 0.1 * (L - 1));

// Tuning constants for the skill kinds (SLOW_DURATION is declared above SKILLS)
export const MISSILE_SPEED = 30;
export const POISON_DURATION = 5;
export const POISON_TICK = 0.5;
export const SLOW_FACTOR = 0.5;
export const CHAIN_FALLOFF = 0.1;
export const DRAIN_CAP = 2;
export const WEAKEN_FACTOR = 0.7;
export const ORBIT_RADIUS = 3;
/** radians per second of an orbiting summon */
export const ORBIT_SPIN = 2.4;
export const CONE_ANGLE = (100 * Math.PI) / 180;

// ---- classes (docs/CLASSES.md) -----------------------------------------------------------------

export type ClassKey = 'warrior' | 'magician' | 'bowman' | 'thief';
/** weapon stance: which character action plays when a skill fires */
export type Stance = 'swing' | 'shoot' | 'stab';

// ---- jobs --------------------------------------------------------------------------------------
/** Level at which the hero picks a 2nd job, and the level of the automatic 3rd job of the same branch */
export const JOB2_LEVEL = 30;
export const JOB3_LEVEL = 70;
export interface JobDef {
  /** v83 job code: 100 Warrior, 110 Fighter, 111 Crusader... A 3rd job is its 2nd job + 1 */
  code: number;
  name: string;
  cls: ClassKey;
  tier: 1 | 2 | 3;
  blurb: string;
  /** two signature skill or passive keys, shown on the job card */
  sig: [string, string];
}
const JOB_LIST: JobDef[] = [
  { code: 100, name: 'Warrior', cls: 'warrior', tier: 1, blurb: 'A fresh Warrior.', sig: ['power_strike', 'slash_blast'] },
  { code: 110, name: 'Fighter', cls: 'warrior', tier: 2, blurb: 'Raw strength and sword mastery.', sig: ['rage', 'power_guard_fighter'] },
  { code: 111, name: 'Crusader', cls: 'warrior', tier: 3, blurb: 'Stuns and panics whole crowds.', sig: ['coma', 'shout'] },
  { code: 120, name: 'Page', cls: 'warrior', tier: 2, blurb: 'A guarding knight with elemental blades.', sig: ['threaten', 'power_guard_page'] },
  { code: 121, name: 'White Knight', cls: 'warrior', tier: 3, blurb: 'Charged blows of fire and ice.', sig: ['charge_blow', 'ice_charge'] },
  { code: 130, name: 'Spearman', cls: 'warrior', tier: 2, blurb: 'Tough spear fighter with Hyper Body.', sig: ['hyper_body', 'iron_will'] },
  { code: 131, name: 'Dragon Knight', cls: 'warrior', tier: 3, blurb: 'Dragon-powered spear attacks.', sig: ['dragon_roar', 'sacrifice'] },
  { code: 200, name: 'Magician', cls: 'magician', tier: 1, blurb: 'A fresh Magician.', sig: ['magic_claw', 'energy_bolt'] },
  { code: 210, name: 'Fire/Poison Wizard', cls: 'magician', tier: 2, blurb: 'Fire and venom.', sig: ['fire_arrow', 'poison_breath'] },
  { code: 211, name: 'Fire/Poison Mage', cls: 'magician', tier: 3, blurb: 'Explosions and poison clouds.', sig: ['explosion', 'poison_mist'] },
  { code: 220, name: 'Ice/Lightning Wizard', cls: 'magician', tier: 2, blurb: 'Frost and thunder.', sig: ['cold_beam', 'thunder_bolt'] },
  { code: 221, name: 'Ice/Lightning Mage', cls: 'magician', tier: 3, blurb: 'Freezing bursts and lightning spears.', sig: ['ice_strike', 'thunder_spear'] },
  { code: 230, name: 'Cleric', cls: 'magician', tier: 2, blurb: 'Holy magic that also heals.', sig: ['holy_arrow', 'heal'] },
  { code: 231, name: 'Priest', cls: 'magician', tier: 3, blurb: 'Holy rays and a summoned dragon.', sig: ['shining_ray', 'summon_dragon'] },
  { code: 300, name: 'Bowman', cls: 'bowman', tier: 1, blurb: 'A fresh Bowman.', sig: ['arrow_blow', 'double_shot'] },
  { code: 310, name: 'Hunter', cls: 'bowman', tier: 2, blurb: 'Bow master with bombs and knock-back.', sig: ['arrow_bomb', 'knockback_hunter'] },
  { code: 311, name: 'Ranger', cls: 'bowman', tier: 3, blurb: 'Arrow rain and a silver hawk.', sig: ['arrow_rain', 'silver_hawk'] },
  { code: 320, name: 'Crossbowman', cls: 'bowman', tier: 2, blurb: 'Piercing bolts from a crossbow.', sig: ['iron_arrow', 'knockback_xbow'] },
  { code: 321, name: 'Sniper', cls: 'bowman', tier: 3, blurb: 'Blizzards and a golden eagle.', sig: ['blizzard', 'golden_eagle'] },
  { code: 400, name: 'Thief', cls: 'thief', tier: 1, blurb: 'A fresh Thief.', sig: ['lucky_seven', 'double_stab'] },
  { code: 410, name: 'Assassin', cls: 'thief', tier: 2, blurb: 'Quick claw fighter who steals life.', sig: ['drain', 'haste_assassin'] },
  { code: 411, name: 'Hermit', cls: 'thief', tier: 3, blurb: 'Avengers, webs and a shadow partner.', sig: ['avenger', 'shadow_web'] },
  { code: 420, name: 'Bandit', cls: 'thief', tier: 2, blurb: 'Dagger fighter who steals mesos.', sig: ['savage_blow', 'steal'] },
  { code: 421, name: 'Chief Bandit', cls: 'thief', tier: 3, blurb: 'Meso explosions and a big Assaulter.', sig: ['meso_explosion', 'assaulter'] },
];
export const JOBS: JobDef[] = JOB_LIST;
export const JOB_BY_CODE: Record<number, JobDef> = Object.fromEntries(JOBS.map((j) => [j.code, j]));
/** the job a skill or passive belongs to */
export const jobOfId = (id: number) => Math.floor(id / 10000);

export interface ClassDef {
  key: ClassKey;
  name: string;
  hp: number;
  speed: number;
  crit: number;
  /** Character.wz weapon id */
  weapon: number;
  weaponName: string;
  stance: Stance;
  /** every skill key of the class in card order; the first is the start skill */
  skills: string[];
  /** 1st job code, and the 2nd job codes the hero chooses from at JOB2_LEVEL */
  firstJob: number;
  branches: number[];
  blurb: string;
  /** bot flees enemies closer than this (yd): short for melee classes */
  botReach: number;
}
const skillsOf = (list: SkillDef[]) => list.map((s) => s.key);
export const CLASSES: ClassDef[] = [
  { key: 'warrior', name: 'Warrior', hp: 160, speed: 6.8, crit: 0.05, weapon: 1302000, weaponName: 'Sword', stance: 'swing', skills: skillsOf(WARRIOR_SKILLS), firstJob: 100, branches: [110, 120, 130], blurb: 'Tough front-liner. Cuts, stuns and roars.', botReach: 2.6 },
  { key: 'magician', name: 'Magician', hp: 120, speed: 7.0, crit: 0.05, weapon: 1372005, weaponName: 'Wand', stance: 'swing', skills: skillsOf(MAGICIAN_SKILLS), firstJob: 200, branches: [210, 220, 230], blurb: 'Fragile but deadly spells from afar.', botReach: 6.5 },
  { key: 'bowman', name: 'Bowman', hp: 120, speed: 7.2, crit: 0.1, weapon: 1452002, weaponName: 'Bow', stance: 'shoot', skills: skillsOf(BOWMAN_SKILLS), firstJob: 300, branches: [310, 320], blurb: 'Fast and precise. Arrows, hawks and blizzards.', botReach: 6.5 },
  { key: 'thief', name: 'Thief', hp: 150, speed: 7.5, crit: 0.08, weapon: 1332005, weaponName: 'Dagger', stance: 'stab', skills: skillsOf(THIEF_SKILLS), firstJob: 400, branches: [410, 420], blurb: 'Quickest hero. Stars, stabs and stolen life.', botReach: 3.4 },
];
export const CLASS_BY_KEY: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.key, c]));
export const DEFAULT_CLASS: ClassKey = 'magician';
/** Start skill key of a class */
export const startSkill = (c: ClassDef) => c.skills[0];
/** Jobs a hero who took 2nd job `branch` (0 = not yet) has at `level`: the 1st job, the branch at JOB2_LEVEL, its 3rd job at JOB3_LEVEL */
export function unlockedJobs(c: ClassDef, branch: number, level: number): number[] {
  const out = [c.firstJob];
  if (branch > 0) {
    out.push(branch);
    if (level >= JOB3_LEVEL) out.push(branch + 1);
  }
  return out;
}

// ---- gear (src/game/gear.ts) -------------------------------------------------------------------

/** weapon attack (incPAD, or incMAD for the Magician) -> damage, per point; a weapon is capped at GEAR_TIER_DMG_CAP per item tier step */
export const GEAR_DMG_PER_ATT = 0.02;
export const GEAR_TIER_DMG_CAP = 0.1;
/** the class's main stat (STR / INT / DEX / LUK) -> damage per point */
export const GEAR_DMG_PER_STAT = 0.01;
/** incPDD points per armor point */
export const GEAR_PDD_PER_ARMOR = 10;
/** incMHP points per max HP */
export const GEAR_MHP_PER_HP = 5;
/** incSPEED points -> move speed fraction per point */
export const GEAR_SPEED_PER_POINT = 0.005;
/** drop chances per kill: normal mobs, elite (big or high tier) mobs; bosses always drop GEAR_BOSS_DROPS items (one tier above the run tier) */
export const GEAR_DROP_NORMAL = 0.008;
export const GEAR_DROP_ELITE = 0.02;
export const GEAR_BOSS_DROPS = 3;
/** a boss kill adds one more drop per this many bosses slain before it (bossKills 1..4: 3 drops, 5..8: 4, ...) */
export const GEAR_BOSS_DROP_STEP = 4;
export const GEAR_BOSS_DROPS_MAX = 5;
/** chance that the guaranteed "rare" boss drop is two item tiers above the run tier instead of one */
export const GEAR_RARE_CHANCE = 0.05;
/** mobs from this ladder tier up count as elite for gear drops */
export const GEAR_ELITE_TIER = 18;
/** chance that a normal drop is one item tier above the run's current tier */
export const GEAR_UPTIER_CHANCE = 0.15;
/** run seconds per item tier step; the run starts at tier GEAR_START_TIER and the tier tops out at GEAR_MAX_TIER (after 540 s) */
export const GEAR_TIER_SECONDS = 90;
export const GEAR_START_TIER = 1;
export const GEAR_MAX_TIER = 7;
/** seconds an "Equip? press E" offer stays up */
export const GEAR_OFFER_SECONDS = 6;
export const GEAR_PICKUP_LIFE = 90;
