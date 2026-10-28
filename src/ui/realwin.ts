/**
 * The Equip and Inventory windows drawn on the real UI.wz backgrounds. The slot frames are baked into the background images, so the
 * extractor detects their rectangles (scripts/slot-detect.ts, stored as piece.rects) and this maps them to our slots. Pure (no DOM).
 * Returns null whenever the detection does not look like the window we expect, and the CSS-drawn windows are used instead.
 */
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

const cy = (r: R) => r.y + r.h / 2;

/** Groups values that lie within tol of the group's first member; returns the group index of each value (groups ordered by position). */
function cluster(vals: number[], tol: number): number[] {
  const order = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const groups: number[] = [];
  let start = -Infinity, g = -1;
  const out = new Array<number>(vals.length);
  for (const o of order) {
    if (o.v - start > tol) { g++; start = o.v; groups.push(o.v); }
    out[o.i] = g;
  }
  return out;
}

/**
 * The real v62/v83 Equip background (175x304) has a 5-column lattice of frames, 33 px apart (x 5, 38, 71, 104, 137), the lower four
 * rows holding the slot grid and the upper rows flanking the character, whose area (the two middle columns above the grid) the
 * detector also reports as frames (the doll's edges). Slots by (column, row) of that lattice, rows counted from the top frame row
 * after the character area's frames are dropped:
 */
const LATTICE: Record<string, { pos: SlotRect['pos']; label: string; gear: SlotRect['gear'] }> = {
  '1,0': { pos: 'cap', label: 'Cap', gear: 'cap' },
  '1,1': { pos: 'face', label: 'Face', gear: null },
  '1,2': { pos: 'eye', label: 'Eye', gear: null },
  '4,1': { pos: 'earring', label: 'Ear', gear: null },
  '4,2': { pos: 'pendant', label: 'Neck', gear: null },
  '0,3': { pos: 'ring1', label: 'Ring', gear: null },
  '1,3': { pos: 'coat', label: 'Top', gear: 'coat' },
  '2,3': { pos: 'glove', label: 'Glove', gear: 'glove' },
  '3,3': { pos: 'cape', label: 'Cape', gear: 'cape' },
  '4,3': { pos: 'belt', label: 'Belt', gear: null },
  '0,4': { pos: 'weapon', label: 'Weapon', gear: 'weapon' },
  '1,4': { pos: 'pants', label: 'Bottom', gear: 'pants' },
  '2,4': { pos: 'shoes', label: 'Shoes', gear: 'shoes' },
  '3,4': { pos: 'shield', label: 'Shield', gear: 'shield' },
  '4,4': { pos: 'ring2', label: 'Ring', gear: null },
  '0,5': { pos: 'ring3', label: 'Ring', gear: null },
  '1,5': { pos: 'ring4', label: 'Ring', gear: null },
  '2,5': { pos: 'medal', label: 'Medal', gear: null },
  '3,5': { pos: 'pet', label: 'Pet', gear: null },
  '0,6': { pos: 'extra1', label: '', gear: null },
  '1,6': { pos: 'extra2', label: '', gear: null },
  '2,6': { pos: 'extra3', label: '', gear: null },
};

/**
 * Maps the detected frames to Equip slots. Steps: (1) cluster into a 5-column lattice (otherwise null); (2) find the grid start, the
 * first row with all five columns, and drop frames of the two middle columns above it, which are the character area, not slots;
 * (3) rows of the rest are counted from the top and looked up in LATTICE. The five core gear frames must exist, or null (CSS skin).
 */
export function mapEquip(rects: R[] | undefined): RealEquip | null {
  if (!rects || rects.length < 12 || rects.length > 40) return null;
  const colOf = cluster(rects.map((r) => r.x), 14);
  const ncols = Math.max(...colOf) + 1;
  if (ncols !== 5) return null;
  const rowOf0 = cluster(rects.map(cy), 14);
  const counts = new Map<number, Set<number>>();
  rects.forEach((_, i) => { if (!counts.has(rowOf0[i])) counts.set(rowOf0[i], new Set()); counts.get(rowOf0[i])!.add(colOf[i]); });
  const gridRow = [...counts].filter(([, c]) => c.size === 5).map(([r]) => r).sort((a, b) => a - b)[0];
  if (gridRow === undefined) return null;
  const keep = rects.map((_, i) => !(rowOf0[i] < gridRow && (colOf[i] === 2 || colOf[i] === 3)));
  const kept = rects.filter((_, i) => keep[i]);
  const kcol = colOf.filter((_, i) => keep[i]);
  const krow = cluster(kept.map(cy), 14);
  const slots: RealSlot[] = [];
  kept.forEach((r, i) => {
    const t = LATTICE[`${kcol[i]},${krow[i]}`];
    if (t) slots.push({ ...t, x: r.x, y: r.y, w: r.w, h: r.h });
  });
  const have = new Set(slots.map((s) => s.pos));
  if (!['cap', 'coat', 'pants', 'shoes', 'weapon', 'glove', 'cape', 'shield'].every((p) => have.has(p as SlotRect['pos']))) return null;
  // the character area: the dropped middle columns above the grid, or the gap between the flanking columns
  const dropped = rects.filter((_, i) => !keep[i]);
  const flank = slots.filter((s) => s.y < Math.min(...rects.filter((_, i) => rowOf0[i] === gridRow).map((r) => r.y)));
  const x0 = flank.length ? Math.max(...flank.filter((s) => s.x < 60).map((s) => s.x + s.w), 0) + 3 : 0;
  const x1 = flank.length ? Math.min(...flank.filter((s) => s.x > 100).map((s) => s.x), 9999) - 3 : 0;
  const y1 = Math.min(...rects.filter((_, i) => rowOf0[i] === gridRow).map((r) => r.y)) - 3;
  const y0 = Math.min(...(dropped.length ? dropped : flank).map((r) => r.y), y1 - 80);
  const preview = x1 > x0 + 30 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 62, y: 30, w: 72, h: y1 - 30 };
  if (preview.h < 40) return null;
  // two slots must never overlap each other
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4) return null;
  }
  return { slots, preview };
}

/**
 * The bag cells: frames of the four dominant x-columns (at least 3 frames each), ignoring anything above y 40 (tab / header false
 * positives), in reading order, at most 24.
 */
export function mapInventory(rects: R[] | undefined): RealInventory | null {
  if (!rects) return null;
  const body = rects.filter((r) => r.y >= 40);
  if (body.length < 8) return null;
  const col = cluster(body.map((r) => r.x), 8);
  const n = new Map<number, number>();
  col.forEach((c) => n.set(c, (n.get(c) ?? 0) + 1));
  const good = [...n].filter(([, k]) => k >= 3).map(([c]) => c);
  if (good.length !== 4) return null;
  const cells = body.filter((_, i) => good.includes(col[i])).sort((a, b) => Math.round(a.y / 12) - Math.round(b.y / 12) || a.x - b.x).slice(0, 24);
  return cells.length >= 8 ? { cells: cells.map((r) => ({ ...r })) } : null;
}
