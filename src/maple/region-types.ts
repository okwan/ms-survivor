/**
 * Manifest sections written by scripts/fetch-maple-regions.ts and scripts/fetch-maple-sfx.ts: one real field map per run region
 * (ground, nature decor, music, display name) and the sound effects. Type-only module, no side effects.
 */
import type { AtlasRef } from './world-types.ts';

/** decor size classes, by the tallest frame: big > 120 px (trees, rocks), small <= 45 px (tufts, flowers), medium between */
export type DecorSize = 'big' | 'medium' | 'small';

export interface RegionObj {
  /** frame action name inside the region's atlas */
  key: string;
  w: number;
  h: number;
  size: DecorSize;
}

export interface RegionEntry {
  /** region index 0..6 */
  index: number;
  /** the field map this region was built from */
  mapId: number;
  /** String.wz names for the banner, e.g. 'Henesys' / 'Hunting Ground I' (empty when String.wz lacks them) */
  street: string;
  name: string;
  tileSet: string;
  /** seamless ground texture and its average colour */
  ground: { image: string; w: number; h: number; avg: [number, number, number] } | null;
  /** nature decor of the map; null when none could be extracted */
  objects: (AtlasRef & { items: RegionObj[] }) | null;
  /** track for this region, relative to maple/ (regions sharing a track share the file) */
  bgm: string | null;
}

export interface RegionsSection {
  /** length 7; null where no map could be found for the region (the runtime reuses the nearest earlier region) */
  list: (RegionEntry | null)[];
}

/** sfx: key -> file relative to maple/. Keys: mob.<id>.{damage,die,attack}, skill.<id>.{use,hit}, weapon.<class>.attack, game.{levelup,pickup,drop,portal}, ui.{click,hover} */
export type SfxSection = Record<string, string>;
