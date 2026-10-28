/**
 * Manifest sections written by scripts/fetch-maple-world.ts: map ground and decorations (Map.wz), damage digits and the
 * level-up effect (Effect.wz) and UI pieces (UI.wz). Type-only module, no side effects.
 */
import type { FrameRec } from './assets.ts';

export interface AtlasRef {
  /** PNG path relative to maple/ */
  atlas: string;
  size: [number, number];
  frames: FrameRec[];
}

export interface MapObjItem {
  /** frame action name inside the atlas, e.g. 'acc1.nature.tree.0' */
  key: string;
  /** how often Henesys uses it (scatter weight) */
  weight: number;
  /** size of the first frame in pixels */
  w: number;
  h: number;
}

export interface MapSection {
  tileSet: string;
  /** one seamlessly repeating, fully opaque ground tile built from the tile set's base fill pieces */
  ground: { image: string; w: number; h: number; avg: [number, number, number] } | null;
  objects: (AtlasRef & { items: MapObjItem[] }) | null;
}

/** One standalone UI PNG. ox/oy is the WZ origin. `meta` carries piece-specific numbers (slice sizes, bar offsets...). */
export interface UiPiece {
  src: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  meta?: Record<string, number>;
  /** baked slot frames found in a window background (reading order), see scripts/slot-detect.ts */
  rects?: { x: number; y: number; w: number; h: number }[];
}

export interface UiSection {
  pieces: Record<string, UiPiece>;
}

export interface EffectsSection {
  levelUp?: AtlasRef;
}
