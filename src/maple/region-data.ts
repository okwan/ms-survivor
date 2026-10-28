/**
 * What the deploy-time step looks for per run region and for sound effects (scripts/fetch-maple-regions.ts and
 * fetch-maple-sfx.ts import this). No DOM, no side effects.
 */
export interface RegionWant {
  /** map ids in order of preference: the first that exists and has tiles wins */
  candidates: number[];
  /** matches String.wz streetName or mapName (Ellinia maps have streetName "Victoria Road") and identifies the area when none of the candidates exists */
  street: RegExp;
  label: string;
  /** accept only a map whose String.wz streetName or mapName matches `street` (when String.wz names are available) */
  strict?: boolean;
}

export const REGION_WANTS: RegionWant[] = [
  { label: 'Henesys fields', candidates: [104040000, 104040001, 100010000, 100020000], street: /henesys/i },
  { label: 'Ellinia forest', candidates: [101010000, 101010001, 101010100, 101010101, 101020000, 101020100, 101030000, 101040000, 101000000], street: /ellinia|tree that grew/i, strict: true },
  { label: 'Perion rocks', candidates: [102010000, 102020000, 102030000, 102040000], street: /perion/i },
  { label: 'Sleepywood / Ant Tunnel', candidates: [105040300, 105040310, 105040000, 105040100, 105040200, 105070001, 105050000, 105050100], street: /sleepywood/i },
  { label: 'Kerning swamp', candidates: [107000000, 107000100, 107000200, 107000300, 103000000, 103000101, 103010000, 103020000], street: /kerning|swamp/i },
  { label: 'El Nath snow', candidates: [211040000, 211040100, 211040200, 211040300], street: /el nath/i },
  { label: "Zakum's area", candidates: [211042300, 280010000, 280020000, 280030000], street: /zakum|el nath/i },
];

/** A candidate map is acceptable only with a ground at least this bright (0.299R+0.587G+0.114B; pure black caves fail), this many decor objects, and a tile set no earlier region uses. */
export const MIN_GROUND_LUMA = 10;
/** accepted grounds darker than this are gamma-lifted to it at extraction (decor is lifted to DECOR_LIFT_TO when its average is below DECOR_DARK) */
export const GROUND_LIFT_TO = 70;
export const DECOR_DARK = 50;
export const DECOR_LIFT_TO = 60;
export const MIN_DECOR = 4;
/** the scan over a folder looks at no more than this many street-matching maps */
export const SCAN_CAP = 40;


/** Map image path for a map id: Map.wz/Map/Map<first digit>/<9 digits>.img */
export const mapImagePath = (id: number): string => `Map/Map${String(id).padStart(9, '0')[0]}/${String(id).padStart(9, '0')}.img`;

/** Decor filter: a path segment (oS, l0, l1 or l2) matching INCLUDE keeps an object, any segment matching EXCLUDE drops it. */
export const DECOR_INCLUDE = /nature|tree|grass|bush|flower|plant|rock|stone|mushroom|snow|ice|foot/i;
export const DECOR_EXCLUDE = /connect|ladder|rope|house|market|artificiality|sign|door|portal|street|lamp|fence/i;
/** Used when fewer than MIN_DECOR objects pass the nature filter: dungeon maps whose only scenery is `artificiality` or `acc` objects. */
export const DECOR_FALLBACK_INCLUDE = /artificiality|acc/i;
export const DECOR_FALLBACK_EXCLUDE = /connect|ladder|rope|house|sign|door|portal|lamp/i;
export const DECOR_CAP = 14;
export const BIG_MIN_H = 121;
export const SMALL_MAX_H = 45;

/** Weapon.img node names tried per class, in order (the real names are unverified; the extractor logs the keys it sees). */
export const WEAPON_SOUND_TYPES: Record<string, string[]> = {
  warrior: ['swordL', 'swordS', 'sword', 'swordOL'],
  magician: ['wand', 'staff', 'barehands'],
  bowman: ['bow'],
  thief: ['dagger', 'claw', 'tGlove', 'swordS'],
};

/** Game.img and UI.img sounds: manifest key -> [image, node names tried in order] */
export const GAME_SOUNDS: Record<string, [string, string[]]> = {
  'game.levelup': ['Game.img', ['LevelUp']],
  'game.pickup': ['Game.img', ['PickUpItem', 'PickUp']],
  'game.drop': ['Game.img', ['DropItem']],
  'game.portal': ['Game.img', ['Portal']],
  'ui.click': ['UI.img', ['BtMouseClick']],
  'ui.hover': ['UI.img', ['BtMouseOver']],
};

/** a single sound larger than this is skipped */
export const MAX_SFX_BYTES = 400 * 1024;
