// Run: node --experimental-strip-types scripts/test-ui.ts
// Pure layout maths of the MapleStory-style windows and status bar (src/ui/layout.ts), and the Maple item tooltip data helpers.
import assert from 'node:assert/strict';
import { GEAR_SLOTS } from '../src/game/gear.ts';
import {
  EQUIP_FOOT, EQUIP_H, EQUIP_PREVIEW, EQUIP_SLOTS, EQUIP_W, INV_COLS, INV_FOOT, INV_H, INV_ROWS, INV_TABS, INV_W, SB_W, SLOT, WINDOW_SIZE, clampWindow, invCell, statusScale,
} from '../src/ui/layout.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };
type R = { x: number; y: number; w: number; h: number };
const inside = (r: R, w: number, h: number) => r.x >= 0 && r.y >= 24 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ---- equip window: 17 frames, all inside, none overlapping each other, the preview or the footer ----
eq(EQUIP_SLOTS.length, 17, 'the equip window has 17 slot frames');
eq(new Set(EQUIP_SLOTS.map((s) => s.pos)).size, 17, 'every frame has its own position name');
const rects = EQUIP_SLOTS.map((s) => ({ x: s.x, y: s.y, w: SLOT, h: SLOT }));
rects.forEach((r, i) => ok(inside(r, EQUIP_W, EQUIP_H), `slot ${EQUIP_SLOTS[i].pos} lies inside the window below the title bar`));
for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) ok(!overlap(rects[i], rects[j]), `slots ${EQUIP_SLOTS[i].pos} and ${EQUIP_SLOTS[j].pos} do not overlap`);
rects.forEach((r, i) => ok(!overlap(r, EQUIP_PREVIEW) && !overlap(r, EQUIP_FOOT), `slot ${EQUIP_SLOTS[i].pos} stays clear of the preview and the footer`));
ok(inside(EQUIP_PREVIEW, EQUIP_W, EQUIP_H) && inside(EQUIP_FOOT, EQUIP_W, EQUIP_H), 'preview and footer inside the window');
eq(EQUIP_SLOTS.filter((s) => s.gear).map((s) => s.gear).sort(), [...GEAR_SLOTS].sort(), 'every gear slot of the game has exactly one frame');
eq(EQUIP_SLOTS.filter((s) => !s.gear).length, 9, 'the other nine frames are show-only');
const at = (p: string) => EQUIP_SLOTS.find((s) => s.pos === p)!;
ok(at('cap').y < at('weapon').y, 'cap sits above the weapon row');
ok(at('ring1').x < EQUIP_PREVIEW.x && at('pendant').x > EQUIP_PREVIEW.x + EQUIP_PREVIEW.w, 'rings left and pendant right of the character');

// ---- inventory: 24 cells in a grid inside the window, tabs and meso line clear of them ----
eq(INV_COLS * INV_ROWS, 24, 'the inventory grid holds the bag size');
const cells = Array.from({ length: INV_COLS * INV_ROWS }, (_, i) => ({ ...invCell(i), w: SLOT, h: SLOT }));
cells.forEach((c, i) => ok(inside(c, INV_W, INV_H), `inventory cell ${i} inside`));
for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) ok(!overlap(cells[i], cells[j]), `cells ${i}/${j} do not overlap`);
INV_TABS.forEach((t, i) => ok(inside(t, INV_W, INV_H) && cells.every((c) => !overlap(t, c)), `tab ${i} inside and above the grid`));
ok(inside(INV_FOOT, INV_W, INV_H) && cells.every((c) => !overlap(INV_FOOT, c)), 'meso line below the grid');
eq([invCell(0).x, invCell(INV_COLS).x, invCell(INV_COLS).y > invCell(0).y], [invCell(0).x, invCell(0).x, true], 'second row starts at the first column, lower');

// ---- dragging keeps a window reachable ----
eq(clampWindow(-50, -20, 192, 292, 1000, 700), { x: 0, y: 0 }, 'cannot be dragged off the top-left');
eq(clampWindow(5000, 5000, 192, 292, 1000, 700), { x: 808, y: 660 }, 'the title strip stays on screen at the bottom-right');
eq(clampWindow(100, 120, 192, 292, 1000, 700), { x: 100, y: 120 }, 'a window in view stays put');
ok(Object.values(WINDOW_SIZE).every(([w, h]) => w > 100 && h > 100), 'window sizes sane');

// ---- status bar scale: whole numbers when wide, shrinks to fit when narrow ----
eq([statusScale(SB_W), statusScale(1280), statusScale(1600), statusScale(2500)], [1, 1, 2, 3], 'integer scales for wide windows');
ok(Math.abs(statusScale(400) - 0.5) < 1e-9 && statusScale(360) * SB_W <= 360, 'a phone-width window shrinks the bar to fit');

// ---- real-window mapping from detected frame rectangles ----
import { mapEquip, mapInventory } from '../src/ui/realwin.ts';
import { EQUIP_FIXTURE_RECTS, ITEM_FIXTURE_HEADER_RECTS, ITEM_FIXTURE_RECTS } from './maple-fixture.mjs';
// the 26 frames the detector found on the REAL Equip/backgrnd (175x304) in CI (x, y, size)
const REAL_EQUIP = ([[38, 35, 32], [38, 68, 32], [70, 71, 34], [104, 68, 33], [137, 68, 32], [39, 100, 34], [71, 101, 33], [103, 101, 33], [136, 100, 36], [5, 134, 33], [38, 134, 32], [70, 137, 33], [104, 134, 33], [136, 134, 33], [5, 167, 32], [38, 166, 33], [71, 167, 32], [104, 167, 32], [137, 167, 32], [3, 199, 35], [38, 199, 31], [72, 201, 32], [104, 199, 34], [5, 233, 32], [38, 233, 32], [71, 233, 32]] as number[][]).map(([x, y, s]) => ({ x, y, w: s, h: s }));
const ov = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4;
for (const [label, rects] of [['real CI rects', REAL_EQUIP], ['fixture rects', EQUIP_FIXTURE_RECTS]] as const) {
  const re = mapEquip(rects)!;
  ok(re, `${label}: map to the Equip window`);
  const rs = (p: string) => re.slots.find((s) => s.pos === p)!;
  eq(re.slots.length, 22, `${label}: the four character-area frames are dropped, 22 slots remain`);
  for (const p of ['cap', 'coat', 'pants', 'shoes', 'weapon', 'glove', 'cape', 'shield']) ok(rs(p), `${label}: ${p} has a frame`);
  eq(new Set(re.slots.map((s) => `${s.x},${s.y}`)).size, re.slots.length, `${label}: every slot has its own frame`);
  ok(re.slots.every((a, i) => re.slots.every((b, j) => i === j || !ov(a, b))), `${label}: no two slots overlap`);
  ok(rs('weapon').y > rs('cap').y && rs('shoes').y > rs('coat').y && rs('pants').y === rs('weapon').y + 33 || rs('pants').y > rs('coat').y, `${label}: lower body below upper body`);
  ok(re.slots.every((s) => !(s.x > 62 && s.x < 100 && s.y > 60 && s.y < 130)), `${label}: nothing is left in the character area`);
  ok(re.preview.x >= 60 && re.preview.x + re.preview.w <= 140 && re.preview.y < 75 && re.preview.y + re.preview.h <= 134, `${label}: the preview covers the dropped area (${JSON.stringify(re.preview)})`);
}
eq(mapEquip(EQUIP_FIXTURE_RECTS.slice(0, 6)), null, 'too few frames: fall back to the CSS skin');
eq(mapEquip(ITEM_FIXTURE_RECTS), null, 'an inventory grid is not the equip window');
const ri = mapInventory([...ITEM_FIXTURE_HEADER_RECTS, ...ITEM_FIXTURE_RECTS])!;
eq([ri.cells.length, ri.cells[0].x, ri.cells[0].y, ri.cells[4].y > ri.cells[0].y, ri.cells[3].x > ri.cells[0].x], [24, 8, 50, true, true], 'bag cells: header frames above y 40 are ignored, 24 in reading order');
eq(mapInventory(EQUIP_FIXTURE_RECTS), null, 'five columns are not an inventory');

console.log(`test-ui: ok (${checks} checks)`);
