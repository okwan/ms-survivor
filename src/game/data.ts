/** Static tables from docs/DESIGN.md. Pure data and tiny helpers, no DOM. */

export const PX_PER_YD = 20;
export const RUN_LENGTH = 900;
export const BOSS_EVERY = 135;
export const TICK = 1 / 60;
export const MAX_ALIVE = 220;
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
export const START_REROLLS = 2;
export const START_BANISHES = 2;

export interface MobDef {
  name: string;
  id: number;
  hp: number;
  speed: number;
  dmg: number;
  xp: number;
  big: boolean;
}

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
    return { name, id, hp: ph, speed, dmg: pd, xp: px, big };
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
}
const B = (name: string, id: number, hp: number, speed: number, dmg: number, xp: number, scale: number, m: string): BossDef => ({
  name, id, hp, speed, dmg, xp, scale,
  nova: m.includes('nova'), summon: m.includes('summon'), berserk: m.includes('berserk'),
});
export const BOSSES: BossDef[] = [
  B('Mano', 2220000, 700, 5.2, 20, 60, 1.6, 'nova'),
  B('Mushmom', 6130101, 1800, 5.4, 32, 120, 1.6, 'nova summon'),
  B('King Slime', 9300003, 4200, 4.0, 45, 200, 1.7, 'summon berserk'),
  B('Zombie Mushmom', 6300005, 7000, 5.6, 55, 300, 1.7, 'nova summon berserk'),
  B('Jr. Balrog', 8130100, 12000, 5.0, 70, 400, 1.8, 'nova summon berserk'),
  B('Zakum', 8800000, 20000, 4.8, 90, 500, 1.8, 'nova summon berserk'),
];
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

export function aliveTarget(elapsed: number): number {
  return Math.min(MAX_ALIVE, Math.floor(14 + 225 * progress(elapsed)));
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
  /** melee / bolt: number of times each target is hit */
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
}
const S = (key: string, name: string, id: number, kind: SkillKind, element: Element, dmg: number, cd: number, range: number, radius: number, count: number, desc: string, extra: Partial<SkillDef> = {}): SkillDef =>
  ({ key, name, id, kind, element, dmg, cd, range, radius, count, desc, ...extra });

const MAGICIAN_SKILLS: SkillDef[] = [
  { key: 'magic_claw', name: 'Magic Claw', id: 2001005, kind: 'bolt', element: 'arcane', dmg: 10, cd: 1.2, range: 22, radius: 0, count: 2, desc: 'Fires magic claws at the nearest enemies.' },
  { key: 'energy_bolt', name: 'Energy Bolt', id: 2001004, kind: 'pierce', element: 'arcane', dmg: 14, cd: 2.0, range: 24, radius: 0, count: 1, desc: 'A bolt that pierces through enemies.' },
  { key: 'fire_arrow', name: 'Fire Arrow', id: 2101004, kind: 'bolt', element: 'fire', dmg: 20, cd: 2.4, range: 26, radius: 3.5, count: 1, desc: 'Explodes on impact for area damage.' },
  { key: 'cold_beam', name: 'Cold Beam', id: 2201004, kind: 'strike', element: 'ice', dmg: 22, cd: 2.6, range: 20, radius: 2.5, count: 1, desc: 'Instant frost blast that slows enemies.', slow: SLOW_DURATION },
  { key: 'thunder_bolt', name: 'Thunder Bolt', id: 2201005, kind: 'strike', element: 'lightning', dmg: 12, cd: 3.0, range: 10, radius: 0, count: 4, desc: 'Strikes the nearest enemies instantly.' },
  { key: 'poison_mist', name: 'Poison Mist', id: 2111003, kind: 'ground', element: 'poison', dmg: 7, cd: 8.0, range: 20, radius: 6, count: 1, desc: 'Poison cloud on the thickest crowd.' },
  { key: 'explosion', name: 'Explosion', id: 2111002, kind: 'nova', element: 'fire', dmg: 16, cd: 4.0, range: 0, radius: 7, count: 1, desc: 'Blasts everything around you.' },
  { key: 'chain_lightning', name: 'Chain Lightning', id: 2221006, kind: 'chain', element: 'lightning', dmg: 18, cd: 3.2, range: 18, radius: 8, count: 4, desc: 'Arcs between nearby enemies.' },
];
const WARRIOR_SKILLS: SkillDef[] = [
  S('power_strike', 'Power Strike', 1001004, 'melee', 'fire', 18, 0.9, 4.5, 0, 1, 'A heavy blow to the nearest enemy.'),
  S('slash_blast', 'Slash Blast', 1001005, 'cone', 'fire', 14, 1.6, 0, 6, 1, 'Slashes everything in front of you.'),
  S('charge_blow', 'Charged Blow', 1211002, 'melee', 'lightning', 30, 3.0, 5, 2.5, 1, 'A stunning blow with splash damage.', { stun: 1.0 }),
  S('coma', 'Coma', 1111005, 'melee', 'arcane', 12, 1.4, 5, 0, 3, 'Stuns up to three nearby enemies.', { stun: 0.5 }),
  S('panic', 'Panic', 1111003, 'cone', 'poison', 22, 3.5, 0, 8, 1, 'Weakens the hits of enemies in front.', { weaken: 4 }),
  S('shout', 'Shout', 1111008, 'nova', 'lightning', 10, 5.0, 0, 7, 1, 'A roar that stuns everything around you.', { stun: 1.5 }),
  S('dragon_roar', 'Dragon Roar', 1311006, 'nova', 'fire', 30, 7.0, 0, 10, 1, 'A mighty roar that blasts all around.'),
  S('spear_crusher', 'Spear Crusher', 1311001, 'melee', 'arcane', 9, 1.0, 5.5, 0, 3, 'Thrusts twice into nearby enemies.', { hits: 2 }),
];
const BOWMAN_SKILLS: SkillDef[] = [
  S('arrow_blow', 'Arrow Blow', 3001004, 'bolt', 'arcane', 12, 1.0, 24, 0, 1, 'Shoots the nearest enemy.', { missile: 36 }),
  S('double_shot', 'Double Shot', 3001005, 'bolt', 'arcane', 8, 1.3, 24, 0, 2, 'Fires arrows at the nearest enemies.'),
  S('arrow_bomb', 'Arrow Bomb', 3101005, 'bolt', 'fire', 16, 2.6, 24, 3.5, 1, 'An exploding arrow that stuns.', { stun: 0.8 }),
  S('iron_arrow', 'Iron Arrow', 3201005, 'pierce', 'arcane', 18, 2.2, 26, 0, 1, 'An arrow that pierces many enemies.'),
  S('strafe', 'Strafe', 3111006, 'bolt', 'arcane', 7, 2.0, 24, 0, 4, 'A volley at the nearest enemies.'),
  S('arrow_rain', 'Arrow Rain', 3111004, 'ground', 'arcane', 8, 8.0, 22, 6, 1, 'Rains arrows on the thickest crowd.', { dur: 4 }),
  S('silver_hawk', 'Silver Hawk', 3111005, 'orbit', 'lightning', 14, 1.2, 14, 0, 1, 'A hawk circles you and strikes enemies.'),
  S('blizzard', 'Blizzard', 3211003, 'strike', 'ice', 24, 4.0, 20, 4, 1, 'Freezing storm that slows enemies.', { slow: 2 }),
];
const THIEF_SKILLS: SkillDef[] = [
  S('lucky_seven', 'Lucky Seven', 4001344, 'bolt', 'arcane', 9, 0.9, 22, 0, 2, 'Throws stars at the nearest enemies.'),
  S('double_stab', 'Double Stab', 4001334, 'melee', 'arcane', 10, 0.8, 4, 0, 1, 'Two quick stabs.', { hits: 2 }),
  S('savage_blow', 'Savage Blow', 4201005, 'melee', 'fire', 6, 1.2, 4.5, 0, 1, 'Six savage strikes.', { hits: 6 }),
  S('avenger', 'Avenger', 4111005, 'pierce', 'arcane', 20, 2.0, 26, 0, 1, 'A star that pierces through enemies.', { pierceBase: 4 }),
  S('shadow_web', 'Shadow Web', 4111003, 'strike', 'poison', 6, 6.0, 12, 5, 1, 'Roots enemies in a web.', { root: 3 }),
  S('meso_explosion', 'Meso Explosion', 4211006, 'nova', 'fire', 20, 5.0, 0, 8, 1, 'Mesos explode around you.'),
  S('band_of_thieves', 'Band of Thieves', 4211004, 'cone', 'poison', 16, 3.0, 0, 8, 1, 'Your band rushes the enemies ahead.'),
  S('drain', 'Drain', 4101005, 'melee', 'poison', 14, 2.0, 4.5, 0, 2, 'Steals life from nearby enemies.', { drain: 0.2 }),
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
  /** class-named passives are only offered to that class */
  cls?: ClassKey;
}
export const PASSIVES: PassiveDef[] = [
  { key: 'int', name: 'Intelligence', id: 2000000, stat: 'might', per: 0.1, desc: '+10% damage' },
  { key: 'hyper_body', name: 'Hyper Body', id: 1301007, stat: 'maxHp', per: 0.2, desc: '+20% max HP' },
  { key: 'haste', name: 'Haste', id: 4101004, stat: 'speed', per: 0.1, desc: '+10% move speed' },
  { key: 'meditation', name: 'Meditation', id: 2101001, stat: 'haste', per: 0.08, desc: '+8% cooldown speed' },
  { key: 'magic_guard', name: 'Magic Guard', id: 2001002, stat: 'armor', per: 1, desc: '+1 armor' },
  { key: 'element_amp', name: 'Element Amplification', id: 2110001, stat: 'area', per: 0.1, desc: '+10% area' },
  { key: 'pet_pickup', name: 'Item Pickup', id: 8, stat: 'magnet', per: 0.4, desc: '+40% pickup range' },
  { key: 'holy_symbol', name: 'Holy Symbol', id: 2311003, stat: 'growth', per: 0.08, desc: '+8% experience' },
  { key: 'recovery', name: 'Recovery', id: 1001, stat: 'regen', per: 0.5, desc: '+0.5 HP per second' },
  { key: 'sharp_eyes', name: 'Sharp Eyes', id: 3121002, stat: 'crit', per: 0.05, desc: '+5% crit chance' },
  // class-named copies of the stat and armor passives (same effects as Intelligence and Magic Guard)
  { key: 'str', name: 'Strength', id: 1000000, stat: 'might', per: 0.1, desc: '+10% damage', cls: 'warrior' },
  { key: 'iron_body', name: 'Iron Body', id: 1001003, stat: 'armor', per: 1, desc: '+1 armor', cls: 'warrior' },
  { key: 'dex', name: 'Dexterity', id: 3000000, stat: 'might', per: 0.1, desc: '+10% damage', cls: 'bowman' },
  { key: 'focus', name: 'Focus', id: 3001003, stat: 'armor', per: 1, desc: '+1 armor', cls: 'bowman' },
  { key: 'luk', name: 'Luck', id: 4000000, stat: 'might', per: 0.1, desc: '+10% damage', cls: 'thief' },
  { key: 'dark_sight', name: 'Dark Sight', id: 4001003, stat: 'armor', per: 1, desc: '+1 armor', cls: 'thief' },
];
// the Magician's own: Intelligence and Magic Guard
for (const p of PASSIVES) if (p.key === 'int' || p.key === 'magic_guard') p.cls = 'magician';
export const PASSIVE_BY_KEY: Record<string, PassiveDef> = Object.fromEntries(PASSIVES.map((p) => [p.key, p]));

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
  /** skill keys in card order; the first is the start skill */
  skills: string[];
  /** keys of the class-named stat and armor passives */
  statPassive: string;
  armorPassive: string;
  blurb: string;
  /** bot flees enemies closer than this (yd): short for melee classes */
  botReach: number;
}
const skillsOf = (list: SkillDef[]) => list.map((s) => s.key);
export const CLASSES: ClassDef[] = [
  { key: 'warrior', name: 'Warrior', hp: 160, speed: 6.8, crit: 0.05, weapon: 1302000, weaponName: 'Sword', stance: 'swing', skills: skillsOf(WARRIOR_SKILLS), statPassive: 'str', armorPassive: 'iron_body', blurb: 'Tough front-liner. Cuts, stuns and roars.', botReach: 2.6 },
  { key: 'magician', name: 'Magician', hp: 120, speed: 7.0, crit: 0.05, weapon: 1372005, weaponName: 'Wand', stance: 'swing', skills: skillsOf(MAGICIAN_SKILLS), statPassive: 'int', armorPassive: 'magic_guard', blurb: 'Fragile but deadly spells from afar.', botReach: 6.5 },
  { key: 'bowman', name: 'Bowman', hp: 120, speed: 7.2, crit: 0.1, weapon: 1452002, weaponName: 'Bow', stance: 'shoot', skills: skillsOf(BOWMAN_SKILLS), statPassive: 'dex', armorPassive: 'focus', blurb: 'Fast and precise. Arrows, hawks and blizzards.', botReach: 6.5 },
  { key: 'thief', name: 'Thief', hp: 120, speed: 7.5, crit: 0.08, weapon: 1332005, weaponName: 'Dagger', stance: 'stab', skills: skillsOf(THIEF_SKILLS), statPassive: 'luk', armorPassive: 'dark_sight', blurb: 'Quickest hero. Stars, stabs and stolen life.', botReach: 3.4 },
];
export const CLASS_BY_KEY: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.key, c]));
export const DEFAULT_CLASS: ClassKey = 'magician';
/** Start skill key of a class */
export const startSkill = (c: ClassDef) => c.skills[0];

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
/** drop chances per kill: normal mobs, elite (big or high tier) mobs; bosses always drop GEAR_BOSS_DROPS items */
export const GEAR_DROP_NORMAL = 0.004;
export const GEAR_DROP_ELITE = 0.01;
export const GEAR_BOSS_DROPS = 2;
/** mobs from this ladder tier up count as elite for gear drops */
export const GEAR_ELITE_TIER = 18;
/** chance that a drop is one item tier above the run's current tier */
export const GEAR_UPTIER_CHANCE = 0.15;
/** run seconds per item tier step (tier 0 for the first step, max tier 6) */
export const GEAR_TIER_SECONDS = 120;
export const GEAR_MAX_TIER = 6;
/** seconds an "Equip? press E" offer stays up */
export const GEAR_OFFER_SECONDS = 6;
export const GEAR_PICKUP_LIFE = 90;
