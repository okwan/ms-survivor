/**
 * Pixel layout of the MapleStory-style windows (Equip, Inventory, Stat) and the status bar. Pure numbers, no DOM, so tests can check
 * that every slot sits inside its window. Coordinates are CSS px at scale 1 from the window's top-left; the windows are scaled as a
 * whole by CSS.
 *
 * The Equip grid follows the v83 window: rings down the left edge, cap on top, pendant / face / eye / ear accessories down the right
 * edge, the character in the middle, then weapon, top, belt, glove, cape and shield, bottom, shoes, medal, pet.
 */
import type { GearSlot } from '../game/gear.ts';

export const SLOT = 32;
const STEP = 36;
const X0 = 8;
const Y0 = 30;

/** every Maple equip position; the ones the game has items for carry its GearSlot, the rest are empty frames */
export type EquipPos =
  | GearSlot
  | 'ring1' | 'ring2' | 'pendant' | 'face' | 'eye' | 'earring' | 'belt' | 'medal' | 'pet';

export interface SlotRect {
  pos: EquipPos;
  /** the hint shown in an empty frame */
  label: string;
  x: number;
  y: number;
  /** the game slot this frame holds, or null for show-only frames */
  gear: GearSlot | null;
}

const cell = (c: number, r: number) => ({ x: X0 + c * STEP, y: Y0 + r * STEP });
const S = (pos: EquipPos, label: string, c: number, r: number, gear: GearSlot | null = null): SlotRect => ({ pos, label, ...cell(c, r), gear });

export const EQUIP_W = 192;
export const EQUIP_H = 306;

/** 17 frames: 11 used by the game, 6 for show */
export const EQUIP_SLOTS: SlotRect[] = [
  S('ring1', 'Ring', 0, 0), S('cap', 'Cap', 2, 0, 'cap'), S('pendant', 'Neck', 4, 0),
  S('ring2', 'Ring', 0, 1), S('face', 'Face', 4, 1),
  S('eye', 'Eye', 4, 2),
  S('earring', 'Ear', 4, 3),
  S('weapon', 'Weapon', 0, 4, 'weapon'), S('coat', 'Top', 1, 4, 'coat'), S('belt', 'Belt', 2, 4), S('glove', 'Glove', 3, 4, 'glove'), S('cape', 'Cape', 4, 4, 'cape'),
  S('shield', 'Shield', 0, 5, 'shield'), S('pants', 'Bottom', 1, 5, 'pants'), S('shoes', 'Shoes', 2, 5, 'shoes'), S('medal', 'Medal', 3, 5), S('pet', 'Pet', 4, 5),
];

/** where the character is drawn: the empty area in the middle, between the side columns */
export const EQUIP_PREVIEW = { x: X0 + STEP, y: Y0 + STEP, w: 3 * STEP - 4, h: 3 * STEP - 4 };
/** the totals line at the bottom of the window */
export const EQUIP_FOOT = { x: 8, y: Y0 + 6 * STEP + 4, w: EQUIP_W - 16, h: EQUIP_H - (Y0 + 6 * STEP + 4) - 8 };

export const INV_COLS = 4;
export const INV_ROWS = 6;
export const INV_W = 176;
export const INV_H = 322;
/** tab strip: three tabs (Equip, Use, Etc) */
export const INV_TABS = [0, 1, 2].map((i) => ({ x: 10 + i * 52, y: 28, w: 50, h: 20 }));
const INV_X0 = 16;
const INV_Y0 = 56;
export function invCell(i: number): { x: number; y: number } {
  return { x: INV_X0 + (i % INV_COLS) * STEP, y: INV_Y0 + Math.floor(i / INV_COLS) * STEP };
}
/** the meso line at the bottom of the inventory */
export const INV_FOOT = { x: 10, y: INV_Y0 + INV_ROWS * STEP + 6, w: INV_W - 20, h: 22 };

export const STAT_W = 172;
export const STAT_H = 336;

/** Window sizes by name, for the drag clamp and tests. */
export const WINDOW_SIZE = { equip: [EQUIP_W, EQUIP_H], inventory: [INV_W, INV_H], stats: [STAT_W, STAT_H] } as const;
export type WindowName = keyof typeof WINDOW_SIZE;

/** Keeps a window fully on screen (a 24 px title strip is always reachable). */
export function clampWindow(x: number, y: number, w: number, h: number, vw: number, vh: number): { x: number; y: number } {
  return { x: Math.max(0, Math.min(vw - w, x)), y: Math.max(0, Math.min(vh - Math.min(h, 40), y)) };
}

/** Status bar logical size; the bar is laid out at 800 px wide and scaled to the window. */
export const SB_W = 800;
export const SB_H = 71;
/** Integer scale where possible: whole multiples when the window is wider than 2 bars, otherwise a fraction that fits. */
export function statusScale(viewW: number): number {
  const f = viewW / SB_W;
  return f >= 2 ? Math.floor(f) : Math.min(1, f);
}
