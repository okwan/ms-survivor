/**
 * The Equip and Inventory windows drawn on the real UI.wz backgrounds. The slot frames are baked into the background images, so the
 * extractor detects their rectangles (scripts/slot-detect.ts, stored as piece.rects) and this maps them to our slots. Pure (no DOM).
 * Returns null whenever the detection does not look like the window we expect, and the CSS-drawn windows are used instead.
 */
import { EQUIP_SLOTS, SLOT } from './layout.ts';
import type { SlotRect } from './layout.ts';

export interface R {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RealSlot extends Omit<SlotRect, 'x' | 'y'> {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface RealEquip {
  slots: RealSlot[];
  /** the character area between the side columns */
  preview: R;
}
export interface RealInventory {
  /** the bag cells in reading order (24) */
  cells: R[];
}

const cx = (r: R) => r.x + r.w / 2;
const cy = (r: R) => r.y + r.h / 2;

/** Template position of every Maple slot inside the grid's bounding box, 0..1 on both axes. */
function template() {
  const xs = EQUIP_SLOTS.map((s) => s.x), ys = EQUIP_SLOTS.map((s) => s.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return EQUIP_SLOTS.map((s) => ({ s, u: (s.x - x0) / (x1 - x0), v: (s.y - y0) / (y1 - y0), col: Math.round((s.x - x0) / 36), row: Math.round((s.y - y0) / 36) }));
}

/**
 * Matches detected frames to the 17 Equip slots by where they sit inside the group's bounding box (nearest first, each frame and
 * slot used once, at most 0.22 away). At least 10 must match; the rest of the slots simply have no frame.
 */
export function mapEquip(rects: R[] | undefined): RealEquip | null {
  if (!rects || rects.length < 10 || rects.length > 30) return null;
  const x0 = Math.min(...rects.map(cx)), x1 = Math.max(...rects.map(cx)), y0 = Math.min(...rects.map(cy)), y1 = Math.max(...rects.map(cy));
  if (x1 - x0 < 60 || y1 - y0 < 80) return null;
  const tpl = template();
  const pairs: { i: number; j: number; d: number }[] = [];
  rects.forEach((r, i) => tpl.forEach((t, j) => {
    const d = Math.hypot((cx(r) - x0) / (x1 - x0) - t.u, (cy(r) - y0) / (y1 - y0) - t.v);
    if (d <= 0.22) pairs.push({ i, j, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const usedR = new Set<number>(), usedT = new Set<number>();
  const slots: RealSlot[] = [];
  const cols = new Map<number, number>();
  for (const p of pairs) {
    if (usedR.has(p.i) || usedT.has(p.j)) continue;
    usedR.add(p.i); usedT.add(p.j);
    const r = rects[p.i], t = tpl[p.j];
    slots.push({ pos: t.s.pos, label: t.s.label, gear: t.s.gear, x: r.x, y: r.y, w: r.w, h: r.h });
    cols.set(p.j, t.col);
  }
  if (slots.length < 10) return null;
  // every gear slot of the game needs a frame, or items would have nowhere to show
  const have = new Set(slots.map((s) => s.pos));
  const need = EQUIP_SLOTS.filter((s) => s.gear && ['weapon', 'coat', 'pants', 'shoes', 'cap'].includes(s.pos));
  if (need.some((s) => !have.has(s.pos))) return null;
  // the character area: between the left and right columns, from the second row to the fourth
  const inCol = (c: number) => [...cols].filter(([, col]) => col === c).map(([j]) => slots.find((s) => s.pos === tpl[j].s.pos)!);
  const left = inCol(0), right = inCol(4);
  const rows = (n: number) => [...cols].filter(([j]) => tpl[j].row === n).map(([j]) => slots.find((s) => s.pos === tpl[j].s.pos)!);
  const r1 = rows(1), r3 = rows(3);
  const px0 = left.length ? Math.max(...left.map((s) => s.x + s.w)) + 3 : x0 + SLOT + 4;
  const px1 = right.length ? Math.min(...right.map((s) => s.x)) - 3 : x1 - SLOT / 2 - 4;
  const py0 = r1.length ? Math.min(...r1.map((s) => s.y)) : y0 + SLOT + 4;
  const py1 = r3.length ? Math.max(...r3.map((s) => s.y + s.h)) : py0 + 3 * SLOT;
  if (px1 - px0 < 30 || py1 - py0 < 40) return null;
  return { slots, preview: { x: px0, y: py0, w: px1 - px0, h: py1 - py0 } };
}

/** Four columns of frames in reading order: needs at least 8 frames in 4 x-columns; the first 24 are the bag cells. */
export function mapInventory(rects: R[] | undefined): RealInventory | null {
  if (!rects || rects.length < 8) return null;
  const xs: number[] = [];
  for (const r of rects) if (!xs.some((x) => Math.abs(x - r.x) <= 8)) xs.push(r.x);
  if (xs.length !== 4) return null;
  return { cells: rects.slice(0, 24).map((r) => ({ ...r })) };
}
