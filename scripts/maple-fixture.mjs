// Synthetic Mob/Skill/String/Sound .wz files (GMS key, version 83) for tests and for visual checks of the game.
// Contains no Nexon art: coloured blobs only.
//
//   node scripts/maple-fixture.mjs <dir> [--all] [--world]   # --all draws every mob and skill the game wants
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildWz, canvas, sound, uol, vec } from './wz-writer.mjs';

/** Colour as stored in a BGRA4444 canvas (4 bits per channel, scaled back up). */
export const q = (v) => (v >> 4) * 17;

/** A filled ellipse with two eyes, facing LEFT (like real Maple mobs): eyes sit on the left half. */
export function blob(w, h, [r, g, b], wiggle = 0) {
  return (x, y) => {
    const dx = (x - w / 2 + 0.5) / (w / 2);
    const dy = (y - h / 2 + 0.5 + wiggle) / (h / 2);
    if (dx * dx + dy * dy >= 1) return [0, 0, 0, 0];
    const ex = x - w * 0.3;
    const ey = y - h * 0.4;
    if (ex * ex + ey * ey < Math.max(2, w / 14) ** 2) return [255, 255, 255, 255];
    return [r, g, b, 255];
  };
}

const hue = (n, s = 0.6, l = 0.55) => {
  const h = ((n * 47) % 360) / 360;
  const f = (k) => {
    const a = s * Math.min(l, 1 - l);
    const kk = (k + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1))));
  };
  return [f(0), f(8), f(4)];
};

const frame = (w, h, col, delay, wiggle = 0, dx = 0) => canvas(w, h, blob(w, h, col, wiggle), { origin: vec((w >> 1) + dx, h), delay });
const seq = (n, make) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, make(i)]));

export const ID3_MP3 = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff))]);
/** WAVEFORMATEX for the sound header: tag 1 = PCM, 0x55 = MP3 (30-byte MPEGLAYER3WAVEFORMAT). */
export function wfx(tag, channels, rate, bits) {
  const b = Buffer.alloc(tag === 0x55 ? 30 : 18);
  b.writeUInt16LE(tag, 0);
  b.writeUInt16LE(channels, 2);
  b.writeUInt32LE(rate, 4);
  b.writeUInt32LE((rate * channels * bits) / 8, 8);
  b.writeUInt16LE((channels * bits) / 8, 12);
  b.writeUInt16LE(bits, 14);
  b.writeUInt16LE(b.length - 18, 16);
  return b;
}
export const mp3Sfx = (n = 2000, ms = 300) => sound(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.from(Array.from({ length: n }, (_, i) => (i * 11) & 0xff))]), ms, wfx(0x55, 2, 44100, 0));
/** 16-bit mono sine, as raw PCM in a node whose header says tag 1 */
export const pcmSfx = (samples = 2000, ms = 90) => {
  const b = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / 6) * 9000), i * 2);
  return sound(b, ms, wfx(1, 1, 22050, 16));
};

export const SYNC_MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 13) & 0xff))]);

function mobTree(col, w, h, { link, fly = false, attack = false, info = {}, still = false } = {}) {
  const info0 = { level: 1, maxHP: 10, speed: -10, bodyAttack: 1, ...info };
  if (link !== undefined) info0.link = link;
  if (link !== undefined) return { info: info0 };
  const t = { info: info0, stand: seq(2, (i) => frame(w, h, col, 200, i)), hit1: seq(1, () => frame(w, h, [255, 255, 255], 120, 0)), die1: seq(3, (i) => frame(w, h - i * 2, col.map((c) => c >> 1), 100)) };
  const walk = seq(still ? 0 : 4, (i) => frame(w + (i & 1), h, col, 110, 0, i & 1));
  if (!still) t[fly ? 'fly' : 'move'] = walk;
  if (attack) t.attack1 = seq(2, (i) => frame(w + 4, h, col, 150, i));
  return t;
}

// ---- synthetic Character.wz / Base.wz ------------------------------------------------------------------------------
// A tiny chibi built from flat shapes with the same structure as the real client: actions -> frames -> canvases with
// origin / z / map{navel,neck,hand,brow}; head, hair and clothes use UOL links; the layers only line up when the map-point
// alignment is done right. Faces left, like the real sprites.

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const SKIN = ['#f6d2b0', '#e4a878', '#a8704a', '#ece0dc', '#b4b4c0'].map(hex);
const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
const ell = (w, h, col, extra) => (x, y) => {
  const dx = (x - w / 2 + 0.5) / (w / 2);
  const dy = (y - h / 2 + 0.5) / (h / 2);
  if (dx * dx + dy * dy >= 1) return [0, 0, 0, 0];
  return extra?.(x, y) ?? [...col, 255];
};
const box = (w, h, col, edge = 0.78) => (x, y) => [...(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? shade(col, edge) : col), 255];
const cv = (w, h, pixel, ox, oy, z, map, extra = {}) => canvas(w, h, pixel, { origin: vec(ox, oy), z, map: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, vec(v[0], v[1])])), ...extra });

const ACTION_FRAMES = { stand1: 3, stand2: 3, walk1: 4, walk2: 4, alert: 3, swingO1: 3, swingO2: 3, swingO3: 3, stabO1: 2, stabO2: 2, shoot1: 3 };
const delayOf = (a) => (a.startsWith('stand') || a === 'alert' ? 500 : a.startsWith('walk') ? 180 : 150);
const isWalk = (a) => a.startsWith('walk');
/** per-frame body bob and arm swing so that frames visibly differ */
const bobOf = (a, i) => (a.startsWith('stand') ? [0, -1, 0][i % 3] : isWalk(a) ? [0, -1, 0, -1][i % 4] : 0);
const swingOf = (a, i) => (isWalk(a) ? [-2, 0, 2, 0][i % 4] : a.startsWith('swing') ? [3, -2, -4][i % 3] : a.startsWith('stab') ? [-3, -5][i % 2] : a === 'shoot1' ? [-3, -4, -3][i % 3] : 0);
const forFrames = (fn) =>
  Object.fromEntries(Object.entries(ACTION_FRAMES).map(([a, n]) => [a, Object.fromEntries(Array.from({ length: n }, (_, i) => [i, fn(a, i)]))]));

/** Body part: torso/legs ('body') and an arm. Canvas origins are the feet / the shoulder; navel sits 9 px above the feet. */
function bodyTree(skin) {
  const col = SKIN[skin];
  return {
    info: { islot: 'Bd', vslot: 'Bd', cash: 0 },
    ...forFrames((a, i) => {
      const bob = bobOf(a, i);
      const sw = swingOf(a, i);
      return {
        body: cv(14, 20, (x, y) => (y > 12 && x > 5 && x < 8 ? [0, 0, 0, 0] : [...col, 255]), 7, 20, 'body', { navel: [0, -9 + bob], neck: [0, -18 + bob] }),
        arm: cv(5, 11, box(5, 11, col), 2, 0, 'arm', { navel: [6 - sw, 8 + bob], hand: [0, 10] }),
        delay: delayOf(a),
        face: a === 'swingO3' && i === 1 ? 0 : 1,
      };
    }),
  };
}
function headTree(skin) {
  const col = SKIN[skin];
  const head = cv(22, 20, ell(22, 20, col), 11, 10, 'head', { neck: [0, 9], brow: [0, -1], earOverHead: [-9, 0] }, { group: 'skin' });
  return { info: { islot: 'Hd', vslot: 'Hd', cash: 0 }, front: { head }, ...forFrames(() => ({ head: uol('../../front/head') })) };
}
function faceTree(id) {
  const blink = id % 3;
  const face = cv(12, 6, (x, y) => ((x === 2 || x === 8) && y >= 1 + (blink === 1 ? 1 : 0) && y <= 3 ? [30, 20, 40, 255] : x === 4 && y === 5 ? [190, 80, 80, 255] : [0, 0, 0, 0]), 6, 3, 'face', { brow: [0, -1] });
  return { info: { islot: 'Fc', vslot: 'Fc', cash: 1 }, default: { face } };
}
function hairTree(id) {
  const col = hex(['#2b2b30', '#c8372d', '#e8832a', '#e8c54a', '#4aa84a', '#3a78d0', '#8a4ac0', '#7a4a28'][id % 10 % 8]);
  const long = id % 10000 >= 1000; // the second and third styles of each gender are longer
  const hh = long ? 22 : 15;
  const base = ell(26, hh, col);
  // a cap over the top of the head (sides hang down for the long styles), leaving the face free
  const hair = cv(26, hh, (x, y) => (y > 9 && !(long && (x < 4 || x > 21)) ? [0, 0, 0, 0] : base(x, y)), 13, long ? 10 : 7, 'hair', { brow: [0, 5] });
  const over = cv(28, 6, ell(28, 6, shade(col, 1.15)), 14, 3, 'hairOverHead', { brow: [0, 9] });
  return {
    info: { islot: 'Hr', vslot: 'H1H2H3H4H5H6HfHsHb', cash: 1 },
    default: { hairOverHead: over, hair },
    ...forFrames(() => ({ hairOverHead: uol('../../default/hairOverHead'), hair: uol('../../default/hair') })),
  };
}
const tint = (id) => hex(['#d8433a', '#3a6fd8', '#3aa860', '#e0b030', '#8a4ac0', '#40a8b8'][(id >> 1) % 6]);
function coatTree(id) {
  const col = tint(id);
  return {
    info: { islot: 'Ma', vslot: 'Ma', cash: 0 },
    ...forFrames((a, i) => ({
      mail: cv(16, 11, box(16, 11, col), 8, 5, 'mailChest', { navel: [0, 0] }),
      mailArm: cv(5, 9, box(5, 9, shade(col, 0.9)), 2, 0, 'mailArm', { navel: [6 - swingOf(a, i), 8 + bobOf(a, i)] }),
    })),
  };
}
function pantsTree(id) {
  const col = tint(id + 5);
  return { info: { islot: 'Pn', vslot: 'Pn', cash: 0 }, ...forFrames((a, i) => ({ pants: cv(14, 9, box(14, 9, col), 7, 0, 'pants', { navel: [0, -1 + bobOf(a, i)] }) })) };
}
function shoesTree(id) {
  const col = tint(id + 3);
  return { info: { islot: 'So', vslot: 'So', cash: 0 }, ...forFrames((a, i) => ({ shoes: cv(16, 4, box(16, 4, shade(col, 0.7)), 8, 0, 'shoes', { navel: [0, -6 + bobOf(a, i)] }) })) };
}
/** Weapons point left of the hand; the bow is a tall arc, attacks tilt the blade. Only the actions the weapon type provides exist. */
function weaponTree(kind) {
  const acts = kind === 'bow' ? ['stand2', 'walk2', 'alert', 'shoot1', 'swingO1'] : kind === 'dagger' ? ['stand1', 'walk1', 'alert', 'stabO1', 'stabO2', 'swingO1'] : ['stand1', 'walk1', 'alert', 'swingO1', 'swingO2', 'swingO3', 'stabO1'];
  const t = { info: { islot: 'Wp', vslot: 'Wp', cash: 0, attackSpeed: 4 } };
  for (const a of acts) {
    t[a] = {};
    for (let i = 0; i < ACTION_FRAMES[a]; i++) {
      const up = a.startsWith('swing') ? [0, 1, 2][i % 3] : 0;
      let c;
      if (kind === 'bow') c = cv(8, 26, (x, y) => (x === Math.round(3 + Math.sin((y / 25) * Math.PI) * 3) ? [150, 90, 40, 255] : x === 7 ? [240, 240, 240, 255] : [0, 0, 0, 0]), 4, 13, 'weapon', { hand: [0, 0] });
      else if (up === 1) c = cv(5, 22, box(5, 22, kind === 'sword' ? [210, 220, 235] : [170, 120, 70]), 2, 20, 'weapon', { hand: [0, 0] });
      else if (up === 2) c = cv(22, 5, box(22, 5, kind === 'sword' ? [210, 220, 235] : [170, 120, 70]), 20, 2, 'weapon', { hand: [0, 0] });
      else if (kind === 'sword') c = cv(24, 5, (x) => (x > 6 ? [215, 225, 240, 255] : [120, 80, 40, 255]), 20, 2, 'weapon', { hand: [0, 0] });
      else if (kind === 'wand') c = cv(14, 3, (x) => (x < 3 ? [120, 200, 255, 255] : [150, 100, 60, 255]), 12, 1, 'weapon', { hand: [0, 0] });
      else c = cv(12, 3, (x) => (x > 5 ? [200, 205, 215, 255] : [90, 60, 40, 255]), 10, 1, 'weapon', { hand: [0, 0] });
      t[a][i] = i > 0 && up === 0 && a.startsWith('stand') ? uol('../0/weapon') : { weapon: c, delay: delayOf(a) };
      if (t[a][i].$ === 'uol') t[a][i] = { weapon: uol('../../0/weapon'), delay: delayOf(a) };
    }
  }
  return t;
}
const ZMAP = [
  'capOverHair', 'hairOverHead', 'accessoryEyeOverCap', 'cap', 'hair', 'accessoryEye', 'accessoryFace', 'face', 'hairShade', 'head', 'cape', 'mailArm', 'glove', 'hand', 'arm', 'weapon', 'shield',
  'weaponOverBody', 'mailChestTop', 'pantsOverMailChest', 'mailChest', 'shoesTop', 'shoesOverPants', 'pants', 'shoes', 'body', 'hairBelowBody', 'weaponBelowBody', 'backHair', 'backBody', 'backWeapon',
];

/** { Base, Character } image maps for buildWz, covering every item the avatar extractor wants. Pass `noWeapons`/`noHair` to test gaps. */
export async function characterImages({ noBase = false, skip = () => false } = {}) {
  const { wantedItems, SLOT_FOLDERS } = await import('../src/maple/avatar-core.ts');
  const want = wantedItems();
  const Character = {};
  const weaponKind = (id) => ({ 1302000: 'sword', 1372005: 'wand', 1452002: 'bow', 1332005: 'dagger' })[Number(id)] ?? 'sword';
  const put = (slot, id, tree, folderIndex = 0) => {
    if (skip(slot, id)) return;
    const folder = SLOT_FOLDERS[slot][folderIndex];
    Character[folder ? `${folder}/${id}.img` : `${id}.img`] = tree;
  };
  for (const id of want.body) put('body', id, bodyTree(Number(id) - 2000));
  for (const id of want.head) put('head', id, headTree(Number(id) - 12000));
  for (const id of want.face) put('face', id, faceTree(Number(id)));
  for (const id of want.hair) put('hair', id, hairTree(Number(id)));
  // the last top of each gender lives in Longcoat, as many one-piece items do
  want.coat.forEach((id, i) => put('coat', id, coatTree(Number(id)), i % 2 === 1 ? 1 : 0));
  for (const id of want.pants) put('pants', id, pantsTree(Number(id)));
  for (const id of want.shoes) put('shoes', id, shoesTree(Number(id)));
  for (const id of want.weapon) put('weapon', id, weaponTree(weaponKind(id)));
  const Base = noBase ? null : { 'zmap.img': Object.fromEntries(ZMAP.map((n) => [n, 0])), 'smap.img': Object.fromEntries(ZMAP.map((n) => [n, 'Bd'])) };
  return { Base, Character };
}

// ---- synthetic droppable equipment ----------------------------------------------------------------------------------
// Items with the real id ranges and info keys (reqLevel, reqJob, cash, inc*, icon, islot, vslot) so that the gear extractor's
// selection (tiers, classes, genders, skips) can be tested; they reuse the avatar part shapes above.

const infoOf = (tree, extra) => ({ ...tree, info: { ...tree.info, ...extra } });
const icon32 = (col) => canvas(32, 32, (x, y) => (x < 2 || y < 2 || x > 29 || y > 29 ? [0, 0, 0, 0] : [...col, 255]), { origin: vec(0, 32) });
function capTree(col, vslot) {
  return {
    info: { islot: 'Cp', vslot, cash: 0 },
    ...forFrames(() => ({ cap: cv(24, 8, box(24, 8, col), 12, 6, 'cap', { brow: [0, -5] }) })),
  };
}
function gloveTree(col) {
  return { info: { islot: 'Gv', vslot: 'Gv', cash: 0 }, ...forFrames((a, i) => ({ lGlove: cv(5, 4, box(5, 4, col), 2, 0, 'glove', { navel: [6 - swingOf(a, i), 17 + bobOf(a, i)] }) })) };
}
function capeTree(col) {
  return { info: { islot: 'Sr', vslot: 'Sr', cash: 0 }, ...forFrames((a, i) => ({ cape: cv(14, 16, box(14, 16, col), 7, 0, 'cape', { navel: [3, -6 + bobOf(a, i)] }) })) };
}
function shieldTree(col) {
  return { info: { islot: 'Si', vslot: 'Si', cash: 0 }, ...forFrames((a, i) => ({ shield: cv(10, 12, box(10, 12, col), 5, 6, 'shield', { navel: [-9 - swingOf(a, i), 2 + bobOf(a, i)] }) })) };
}
const LEVELS = [0, 10, 20, 30, 40, 50, 60, 80];

/** { Character: {'Cap/01002000.img': tree...}, Eqp: String.wz Eqp.img/Eqp tree } */
export function gearImages() {
  const Character = {};
  const Eqp = {};
  const add = (folder, cat, id, tree, name, info) => {
    const full = String(id).padStart(8, '0');
    Character[`${folder}/${full}.img`] = infoOf(tree, { icon: icon32(tint(id)), tuc: 7, ...info });
    (Eqp[cat] ??= {})[String(id)] = { name };
  };
  LEVELS.forEach((lv, t) => {
    const lvl = { reqLevel: lv, reqJob: 0, cash: 0 };
    add('Cap', 'Cap', 1002000 + t, capTree(tint(t), 'CpH1H5'), `Test Cap ${t}`, { ...lvl, incPDD: 3 + t });
    add('Cap', 'Cap', 1003000 + t, capTree(tint(t + 1), 'CpH1H2H3H4H5H6HfHsHb'), `Test Helm ${t}`, { ...lvl, reqJob: 1, incPDD: 6 + t, incMHP: 10 });
    add('Coat', 'Top', 1040100 + t, coatTree(1040100 + t), `Test Shirt ${t}`, { ...lvl, incPDD: 5 + t });
    add('Coat', 'Top', 1041100 + t, coatTree(1041100 + t), `Test Blouse ${t}`, { ...lvl, incPDD: 5 + t });
    add('Pants', 'Bottom', 1060100 + t, pantsTree(1060100 + t), `Test Pants ${t}`, { ...lvl, incPDD: 4 + t });
    add('Pants', 'Bottom', 1061100 + t, pantsTree(1061100 + t), `Test Skirt ${t}`, { ...lvl, incPDD: 4 + t });
    add('Shoes', 'Shoes', 1072100 + t, shoesTree(1072100 + t), `Test Boots ${t}`, { ...lvl, incPDD: 2 + t, incSPEED: t });
    add('Shoes', 'Shoes', 1072200 + t, shoesTree(1072200 + t), `Test Sandals ${t}`, { ...lvl, reqJob: 8, incPDD: 2, incSPEED: 2 * t });
    // gloves and capes have no items at tiers 5 and 6: those tiers must borrow the nearest higher ones
    if (t < 5 || t === 7) add('Glove', 'Glove', 1082100 + t, gloveTree(tint(t + 2)), `Test Gloves ${t}`, { ...lvl, incPDD: 1 + t });
    if (t < 5 || t === 7) add('Cape', 'Cape', 1102100 + t, capeTree(tint(t + 3)), `Test Cape ${t}`, { ...lvl, incPDD: 2 + t, incMDD: t });
    add('Shield', 'Shield', 1092100 + t, shieldTree(tint(t + 4)), `Test Shield ${t}`, { ...lvl, reqJob: 1, incPDD: 5 + t });
    add('Weapon', 'Weapon', 1302100 + t, weaponTree('sword'), `Test Sword ${t}`, { ...lvl, reqJob: 1, incPAD: 15 + 3 * t });
    add('Weapon', 'Weapon', 1372100 + t, weaponTree('wand'), `Test Wand ${t}`, { ...lvl, reqJob: 2, incMAD: 20 + 3 * t, incINT: t });
    add('Weapon', 'Weapon', 1452100 + t, weaponTree('bow'), `Test Bow ${t}`, { ...lvl, reqJob: 4, incPAD: 15 + 3 * t });
    add('Weapon', 'Weapon', 1332100 + t, weaponTree('dagger'), `Test Dagger ${t}`, { ...lvl, reqJob: 8, incPAD: 12 + 3 * t });
  });
  // a tier with no clean gloves / capes at all: only a notSale glove at level 95 and gloves / capes of level 105-115 exist above them
  add('Glove', 'Glove', 1082300, gloveTree(tint(9)), 'Rare Gloves', { reqLevel: 95, reqJob: 0, cash: 0, incPDD: 9, notSale: 1, tuc: 0 });
  add('Glove', 'Glove', 1082301, gloveTree(tint(8)), 'Far Gloves', { reqLevel: 105, reqJob: 0, cash: 0, incPDD: 10 });
  add('Glove', 'Glove', 1082302, gloveTree(tint(7)), 'Farther Gloves', { reqLevel: 112, reqJob: 0, cash: 0, incPDD: 11 });
  add('Cape', 'Cape', 1102300, capeTree(tint(8)), 'Far Cape', { reqLevel: 110, reqJob: 0, cash: 0, incPDD: 12 });
  add('Cape', 'Cape', 1102301, capeTree(tint(6)), 'Farther Cape', { reqLevel: 115, reqJob: 0, cash: 0, incPDD: 13 });
  // one-piece coat for the Magician at tier 3, in Longcoat/
  add('Longcoat', 'Overall', 1052000, coatTree(1052000), 'Test Robe', { reqLevel: 30, reqJob: 2, cash: 0, incPDD: 12, incMDD: 12, vslot: 'MaPn' });
  // items the selection must skip
  add('Cap', 'Cap', 1009998, capTree(tint(1), 'CpH1H5'), 'Cash Cap', { reqLevel: 0, reqJob: 0, cash: 1 });
  add('Cap', 'Cap', 1009997, capTree(tint(2), 'CpH1H5'), 'Pirate Cap', { reqLevel: 0, reqJob: 16, cash: 0 });
  // novelty items the drop filters must reject: no tuc, an event flag, no stats
  add('Cap', 'Cap', 1002999, capTree(tint(3), 'CpH1H5'), 'No Slots Cap', { reqLevel: 30, reqJob: 0, cash: 0, incPDD: 50, tuc: 0 });
  add('Cap', 'Cap', 1002998, capTree(tint(3), 'CpH1H5'), 'Event Cap', { reqLevel: 30, reqJob: 0, cash: 0, incPDD: 50, timeLimited: 1 });
  add('Cap', 'Cap', 1002997, capTree(tint(3), 'CpH1H5'), 'Statless Cap', { reqLevel: 30, reqJob: 0, cash: 0, tuc: 0 });
  add('Weapon', 'Weapon', 1432000, weaponTree('sword'), 'Test Spear', { reqLevel: 0, reqJob: 1, cash: 0, incPAD: 99 });
  add('Shield', 'Shield', 1092002, shieldTree(tint(1)), 'Mage Shield', { reqLevel: 0, reqJob: 2, cash: 0, incPDD: 3 });
  // equips without any inc* key (most of the real client): wearable ones (tuc or price) get derived stats
  add('Glove', 'Glove', 1082400, gloveTree(tint(5)), 'Plain Gloves', { reqLevel: 60, reqJob: 0, cash: 0, reqDEX: 50, price: 800 });
  add('Cape', 'Cape', 1102400, capeTree(tint(4)), 'Plain Cape', { reqLevel: 50, reqJob: 0, cash: 0, price: 500 });
  add('Cape', 'Cape', 1102401, capeTree(tint(2)), 'Plainer Cape', { reqLevel: 60, reqJob: 0, cash: 0, tuc: 5 });
  add('Weapon', 'Weapon', 1332400, weaponTree('dagger'), 'Plain Dagger', { reqLevel: 60, reqJob: 8, cash: 0, reqDEX: 50, reqLUK: 30, price: 5000 });
  add('Shoes', 'Shoes', 1072400, shoesTree(1072400), 'Plain Boots', { reqLevel: 50, reqJob: 0, cash: 0, price: 900 });
  add('Cap', 'Cap', 1002996, capTree(tint(6), 'CpH1H5'), 'Worthless Cap', { reqLevel: 30, reqJob: 0, cash: 0, tuc: 0 });
  const noWalk = capTree(tint(5), 'CpH1H5');
  for (const a of ['walk1', 'walk2']) delete noWalk[a];
  add('Cap', 'Cap', 1009999, noWalk, 'Unwalkable Cap', { reqLevel: 0, reqJob: 0, cash: 0 });
  return { Character, Eqp };
}

/**
 * Writes Mob.wz, Skill.wz, String.wz and Sound.wz into `dir`.
 * Default: a handful of entries that exercise links, fly, UOL frames, big frames, name mismatches and missing nodes.
 * `all`: every mob and skill the game lists, so the built game can be viewed with "real" art.
 */
export async function writeFixture(dir, { all = false, noTitle = false, character = true, items = false, npc = '' } = {}) {
  mkdirSync(dir, { recursive: true });
  const { WANTED_MOBS, WANTED_SKILLS } = await import('../src/maple/assets.ts');
  const mobs = {};
  const names = {};
  if (all) {
    WANTED_MOBS.forEach((m, i) => {
      const boss = m.tier.startsWith('B');
      const w = boss ? 120 + 14 * i : 26 + (i % 6) * 5;
      const h = boss ? 110 + 12 * i : 24 + (i % 5) * 5;
      mobs[String(m.id).padStart(7, '0') + '.img'] = mobTree(hue(i), w, h, { attack: boss, info: { level: i + 1, maxHP: 10 * (i + 1) } });
      names[m.id] = { name: m.name };
    });
  } else {
    mobs['0100100.img'] = mobTree([240, 120, 32], 24, 20, { info: { maxHP: 8 } });
    // an extra UOL frame that must share the first frame's atlas slot
    mobs['0100100.img'].stand[2] = uol('0');
    mobs['0100101.img'] = mobTree([60, 120, 240], 24, 20, { link: 100100, info: { maxHP: 10, level: 2 } });
    mobs['0120100.img'] = mobTree([200, 40, 40], 30, 28, { fly: true, attack: true });
    mobs['8800000.img'] = { info: { level: 140, maxHP: 20000 }, stand: seq(6, (i) => canvas(500, 300, blob(500, 300, [90, 90, 120 + i * 16]), { origin: vec(250, 300), delay: 150 })) };
    names[100100] = { name: 'Snail' };
    names[100101] = { name: 'Blue Snail' };
    names[120100] = { name: 'Mushroom' }; // game data says "Shroom": a MISMATCH on purpose
  }

  const skillTree = (col, { full = false, iconOnly = false } = {}) => {
    const icon = canvas(32, 32, blob(32, 32, col), { origin: vec(0, 32) });
    const t = { icon, iconMouseOver: canvas(32, 32, blob(32, 32, col.map((c) => Math.min(255, c + 40))), { origin: vec(0, 32) }) };
    if (!iconOnly) {
      t.effect = seq(3, (i) => canvas(40 + i * 4, 40, blob(40 + i * 4, 40, col), { origin: vec(20, 20), delay: 90 }));
      t.ball = seq(full ? 4 : 2, (i) => canvas(30, 14, blob(30, 14, col, i - 1), { origin: vec(15, 7), delay: 70 }));
      t.hit = { 0: seq(full ? 5 : 2, (i) => canvas(36 + i * 3, 36 + i * 3, blob(36 + i * 3, 36 + i * 3, col), { origin: vec(18 + ((i * 3) >> 1), 18 + ((i * 3) >> 1)), delay: 60 })) };
    }
    return t;
  };
  const skillImgs = {};
  const add = (img, id, tree) => {
    skillImgs[img] ??= { skill: {} };
    skillImgs[img].skill[String(id).padStart(7, '0')] = tree;
  };
  if (all) {
    WANTED_SKILLS.forEach((s, i) => add(s.image, s.id, skillTree(hue(i * 3 + 1, 0.7, 0.5), { full: true, iconOnly: s.passive })));
  } else {
    add('200.img', 2001005, skillTree([120, 80, 240])); // Magic Claw: everything
    add('210.img', 2101004, skillTree([240, 100, 40], { iconOnly: true })); // Fire Arrow: icon only
    add('100.img', 1000000, skillTree([60, 200, 90], { iconOnly: true })); // Improved HP Recovery: a 1st-job passive
  }

  const sounds = {
    'Bgm00.img': { FloralLife: sound(ID3_MP3, 90000), Henesys: sound(SYNC_MP3, 1000) },
    'BgmUI.img': noTitle ? { Login: sound(SYNC_MP3, 1000), WorldSelect: sound(SYNC_MP3, 1000) } : { Title: sound(SYNC_MP3, 60000) },
  };

  // sound effects: layout as expected from Sound.wz (Mob.img/<7-digit id>/{Damage,Die,Attack1}, Skill.img/<skill id>/{Use,Hit}, ...)
  const boss = WANTED_MOBS.find((m) => m.tier === 'B1');
  sounds['Mob.img'] = {
    '0100100': { Damage: mp3Sfx(), Die: pcmSfx() },
    '0100101': { Damage: mp3Sfx(1500) },
    [String(boss.id).padStart(7, '0')]: { Damage: mp3Sfx(), Die: mp3Sfx(3000, 800), Attack1: pcmSfx(3000) },
    '0120100': { Move: mp3Sfx() }, // no Damage/Die: logged
  };
  sounds['Skill.img'] = { '2001005': { Use: mp3Sfx(), Hit: pcmSfx(1200) }, '2101004': { Use: mp3Sfx() } };
  sounds['Game.img'] = { LevelUp: pcmSfx(6000, 270), PickUpItem: mp3Sfx(), DropItem: mp3Sfx(), Portal: pcmSfx(3000) };
  sounds['UI.img'] = { BtMouseClick: mp3Sfx(), BtMouseOver: mp3Sfx(900), DlgNotice: mp3Sfx() };
  sounds['Weapon.img'] = {
    swordL: { Attack: mp3Sfx() },
    wand: { Attack: pcmSfx(2500) },
    bow: { Attack: sound(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(500000, 7)]), 9000, wfx(0x55, 2, 44100, 0)) }, // over 400 KB: skipped
  };
  const strings = {
    'Mob.img': names,
    'Map.img': {
      victoria: {
        104040000: { streetName: 'Henesys', mapName: 'Hunting Ground I' },
        101010000: { streetName: 'Victoria Road', mapName: 'The Field North of Ellinia' },
        102000100: { streetName: 'Perion', mapName: 'Rocky Hill' },
        105040300: { streetName: 'Victoria Road', mapName: 'The Forest of Sleepywood' },
        107000000: { streetName: 'Victoria Road', mapName: 'The Swamp of Despair I' },
        107000100: { streetName: 'Victoria Road', mapName: 'The Swamp of Despair II' },
        107000200: { streetName: 'Victoria Road', mapName: 'The Swamp of Despair III' },
      },
    },
  };

  if (items) writeItemFixture(dir, strings);
  if (npc) writeNpcFixture(dir, strings, npc);
  writeFileSync(join(dir, 'Mob.wz'), buildWz(mobs));
  writeFileSync(join(dir, 'Skill.wz'), buildWz(skillImgs));
  writeFileSync(join(dir, 'String.wz'), buildWz(strings));
  writeFileSync(join(dir, 'Sound.wz'), buildWz(sounds));
  if (character) {
    const { Base, Character } = await characterImages();
    const gear = gearImages();
    writeFileSync(join(dir, 'Base.wz'), buildWz(Base));
    writeFileSync(join(dir, 'Character.wz'), buildWz({ ...Character, ...gear.Character }));
    writeFileSync(join(dir, 'String.wz'), buildWz({ ...strings, 'Eqp.img': { Eqp: gear.Eqp } }));
  }
}

// ---- synthetic Map.wz / Effect.wz / UI.wz (real layout names, invented pixels) -------------------------------------

const GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
  '/': '001001010100100', '%': '101001010100101', '[': '110100100100110', ']': '011001001001011',
};

/** A 3x5 digit glyph drawn at `scale` with a 1px... outline; returns a pixel function and its size. */
export function glyph(ch, scale, fill, edge, pad = 2) {
  const bits = GLYPHS[ch] ?? GLYPHS[0];
  const w = 3 * scale + pad * 2;
  const h = 5 * scale + pad * 2;
  const on = (gx, gy) => gx >= 0 && gy >= 0 && gx < 3 && gy < 5 && bits[gy * 3 + gx] === '1';
  const at = (x, y) => on(Math.floor((x - pad) / scale), Math.floor((y - pad) / scale));
  const px = (x, y) => {
    if (at(x, y)) return [...fill, 255];
    for (let dy = -pad; dy <= pad; dy++) for (let dx = -pad; dx <= pad; dx++) if ((dx || dy) && Math.hypot(dx, dy) <= pad + 0.2 && at(x + dx, y + dy)) return [...edge, 255];
    return [0, 0, 0, 0];
  };
  return { w, h, px };
}

const digitSet = (scale, fill, edge, extras = {}) => {
  const t = {};
  for (let i = 0; i < 10; i++) {
    const g = glyph(i, scale, fill, edge);
    t[i] = canvas(g.w, g.h, g.px, { origin: vec(0, g.h) });
  }
  return { ...t, ...extras };
};

/** Slot frames of the synthetic Equip / Item backgrounds (the detector in slot-detect.ts must find these). Same grid as src/ui/layout.ts. */
export const EQUIP_FIXTURE_RECTS = (() => {
  // the real Equip background's lattice: 5 columns x 7 rows, 33 px apart; which cells hold frames (the middle columns of the upper rows are the character area)
  const cells = [[1, 0], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [0, 5], [1, 5], [2, 5], [3, 5], [0, 6], [1, 6], [2, 6]];
  return cells.map(([c, r]) => ({ x: 5 + c * 33, y: 35 + r * 33, w: 32, h: 32 }));
})();
export const ITEM_FIXTURE_HEADER_RECTS = [{ x: 8, y: 6, w: 32, h: 32 }, { x: 80, y: 6, w: 32, h: 32 }];
export const ITEM_FIXTURE_RECTS = Array.from({ length: 24 }, (_, i) => ({ x: 8 + (i % 4) * 36, y: 50 + Math.floor(i / 4) * 34, w: 32, h: 32 }));
/** a window background: gradient panel, a title bar, and recessed dark frames with a light bevel at the given rects */
const windowBg = (w, h, rects, top, bottom) => (x, y) => {
  for (const r of rects) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      const lx = x - r.x, ly = y - r.y;
      if (lx === 0 || ly === 0 || lx === r.w - 1 || ly === r.h - 1) return [16, 20, 42, 255];
      if (lx === 1 || ly === 1) return [20, 26, 52, 255];
      if (lx === r.w - 2 || ly === r.h - 2) return [120, 130, 170, 255];
      return [46, 54, 86, 255];
    }
  }
  if (y < 24) return [60, 72, 118, 255];
  return panel(w, h, top, bottom)(x, y);
};

const rnd = (x, y, s = 0) => {
  let h = (Math.imul(x + s * 131, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const grassPx = (s) => (x, y) => {
  const n = rnd(x, y, s);
  const blade = rnd(x >> 1, y >> 2, s + 9) > 0.86;
  const base = [70 + n * 30, 150 + n * 40, 56 + n * 20];
  return blade ? [96, 190, 70, 255] : [...base.map((c) => c | 0), 255];
};

/** tree: trunk + round canopy, `sway` shifts the canopy */
const treePx = (w, h, sway) => (x, y) => {
  const cx = w / 2 + sway;
  const cy = h * 0.35;
  if ((x - cx) ** 2 / (w * 0.46) ** 2 + (y - cy) ** 2 / (h * 0.34) ** 2 < 1) return [40 + rnd(x, y) * 30, 120 + rnd(y, x) * 40, 40, 255];
  if (Math.abs(x - w / 2) < w * 0.08 && y > h * 0.5) return [110, 70, 40, 255];
  return [0, 0, 0, 0];
};
const bushPx = (w, h) => (x, y) => ((x - w / 2) ** 2 / (w / 2) ** 2 + (y - h * 0.7) ** 2 / (h * 0.35) ** 2 < 1 ? [50, 140 + rnd(x, y) * 40, 60, 255] : [0, 0, 0, 0]);
const flowerPx = (w, h, c) => (x, y) => (Math.hypot(x - w / 2, y - 4) < 4 ? [...c, 255] : Math.abs(x - w / 2) < 1 && y > 4 ? [40, 130, 40, 255] : [0, 0, 0, 0]);
const boardPx = (w, h) => (x, y) => (y < h * 0.6 ? [150, 100, 55, 255] : Math.abs(x - w / 2) < 2 ? [100, 70, 40, 255] : [0, 0, 0, 0]);
const fencePx = (w, h) => (x, y) => ((x % 14 < 5 && y > 2) || (y > 8 && y < 13) ? [170, 120, 70, 255] : [0, 0, 0, 0]);
const solid = (c) => () => [...c, 255];

const objFrame = (w, h, px, delay) => canvas(w, h, px, { origin: vec(w >> 1, h), ...(delay ? { delay } : {}) });

/** Gradient panel with a light border (windows, bars, buttons). */
const panel = (w, h, top, bottom, edge = [30, 30, 50]) => (x, y) => {
  if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [...edge, 255];
  const k = y / h;
  return [0, 1, 2].map((c) => (top[c] * (1 - k) + bottom[c] * k) | 0).concat(255);
};

/**
 * Writes Map.wz, Effect.wz and UI.wz with the real layout names (Tile/grassySoil.img, Obj/*.img, Map/Map1/100000000.img,
 * BasicEff.img NoRed0.., StatusBar.img, Basic.img...) holding invented pixels. `noDigits`/`noTown` drop pieces to test fallbacks.
 */
/** The scroll names of the item fixture: some parse, some must be rejected (two-handed, dark, odd stat, no slot, out of range). */
export const FIXTURE_SCROLLS = {
  2040000: 'Scroll for Helmet for DEF 100%',
  2040001: 'Scroll for Helmet for DEF 60%',
  2040002: 'Scroll for Helmet for DEF 10%',
  2040100: 'Scroll for Overall Armor for DEX 60%',
  2040200: 'Scroll for Gloves for ATT 60%',
  2040300: 'Scroll for Shoes for Speed 60%',
  2040400: 'Scroll for Cape for Magic Def 60%',
  2040500: 'Scroll for Bottomwear for DEF 100%',
  2040600: 'Scroll for Shield for HP 60%',
  2041000: 'Scroll for One-Handed Sword for ATT 100%',
  2041001: 'Scroll for One-Handed Sword for ATT 60%',
  2041002: 'Scroll for One-Handed Sword for ATT 10%',
  2041003: 'Scroll for Wand for Magic Att 60%',
  2041004: 'Scroll for Bow for ATT 60%',
  2041005: 'Scroll for Dagger for ATT 60%',
  2041006: 'Scroll for Two-handed Sword for ATT 60%',
  2041007: 'Dark Scroll for Helmet for DEF 70%',
  2041008: 'Scroll for Helmet for Jump 60%',
  2041009: 'Clean Slate Scroll 1%',
  2050000: 'Scroll for Cap for DEF 60%',
};
/** Item.wz (potions, mesos, scrolls, a pet) and the String.wz names that go with it; adds Consume.img and Pet.img to `strings`. */
export function writeItemFixture(dir, strings) {
  const ico = (col) => canvas(32, 32, (x, y) => (x < 2 || y < 2 || x > 29 || y > 29 ? [0, 0, 0, 0] : [...col, 255]), { origin: vec(0, 32) });
  const potion = (col) => ({ info: { icon: ico(col), price: 50 } });
  const meso = (i, col, delay) => canvas(28, 28, blob(28, 28, col, i - 1), { origin: vec(14, 28), ...(delay ? { delay } : {}) });
  const frames4 = (col, delay) => seq(4, (i) => meso(i, col, delay));
  const scrolls = {};
  for (const id of Object.keys(FIXTURE_SCROLLS)) {
    if (Number(id) === 2040002 || Number(id) >= 2050000) continue; // no icon for 2040002: shown plain
    scrolls[String(id).padStart(8, '0')] = { info: { icon: ico(hue(Number(id))), price: 100 } };
  }
  const kitty = (w, col, delay) => canvas(w, 28, blob(w, 28, col), { origin: vec(w >> 1, 28), delay });
  writeFileSync(join(dir, 'Item.wz'), buildWz({
    'Consume/0200.img': { '02000000': potion([230, 60, 60]), '02000001': potion([240, 150, 50]), '02000002': potion([240, 240, 240]), '02000004': potion([120, 200, 240]), '02000005': potion([180, 90, 220]) },
    'Consume/0204.img': scrolls,
    'Cash/0522.img': { '05220000': potion([255, 150, 60]) },
    'Cash/0513.img': { '05130000': potion([90, 200, 230]) },
    'Special/0900.img': {
      '09000000': { info: { icon: ico([200, 120, 60]), iconRaw: frames4([200, 120, 60]) } },
      '09000001': { info: { icon: ico([240, 200, 60]), iconRaw: frames4([240, 200, 60], 100) } },
      '09000002': { info: { icon: ico([240, 220, 120]), iconRaw: frames4([240, 220, 120], 100) } },
      // iconRaw directly under the item: the extractor tries that layout too
      '09000003': { iconRaw: frames4([250, 230, 90], 100), info: { icon: ico([250, 230, 90]) } },
    },
    'Pet/5000000.img': {
      info: { icon: ico([240, 150, 70]) },
      stand0: seq(2, (i) => kitty(30 + i, [240, 150, 70], 400)),
      move: seq(4, (i) => kitty(32 + (i & 1), [240, 150, 70], 120)),
      jump: seq(1, () => kitty(30, [240, 160, 80], 200)),
      hungry: seq(1, () => kitty(30, [150, 150, 150], 200)),
    },
  }));
  strings['Consume.img'] = Object.fromEntries(Object.entries(FIXTURE_SCROLLS).map(([id, name]) => [id, { name }]));
  strings['Pet.img'] = { 5000000: { name: 'Brown Kitty' }, 5000001: { name: 'Black Kitty' } };
}

/**
 * Npc.wz (Rina's stand frames) and the String.wz Npc.img names. `variant`: 'rina' = 1012100 is Rina; 'moved' = 1012100 is someone else and
 * Rina is 1012101 (found by name); 'absent' = nobody is named Rina; 'nostring' = Rina's image only, no Npc.img in String.wz.
 */
export function writeNpcFixture(dir, strings, variant = 'rina') {
  const stand = (col, n = 3) => ({ info: { speak: {} }, stand: seq(n, (i) => canvas(40 + i, 64, blob(40 + i, 64, col), { origin: vec(20, 64), delay: 200 })), say: seq(1, () => canvas(40, 64, blob(40, 64, col), { origin: vec(20, 64) })) });
  const imgs = { '1012100.img': stand([230, 150, 160]) };
  if (variant === 'moved') imgs['1012101.img'] = stand([120, 200, 140], 2);
  writeFileSync(join(dir, 'Npc.wz'), buildWz(imgs));
  if (variant === 'nostring') return;
  strings['Npc.img'] = {
    1012100: { name: variant === 'rina' ? 'Rina' : variant === 'moved' ? 'Mr. Smith' : 'Maria' },
    1012101: { name: variant === 'moved' ? 'Rina' : 'Pan' },
    1012102: { name: 'Rini' },
  };
}

export function writeWorldFixture(dir, { noTown = false, noRedDigits = false, noUi = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const bsc = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [i, canvas(90, 60, grassPx(i), { origin: vec(0, 0), z: 0 })]));
  const edge = (h) => Object.fromEntries([0, 1].map((i) => [i, canvas(90, h, grassPx(i + 7), { origin: vec(0, 20), z: i })]));
  const tile = { info: {}, bsc, enH0: edge(38), enH1: edge(25), edU: edge(37) };

  const objs = {
    'Obj/acc1.img': {
      nature: {
        tree: { 0: { 0: objFrame(90, 130, treePx(90, 130, -2), 400), 1: objFrame(90, 130, treePx(90, 130, 2), 400) } },
        bush: { 0: objFrame(56, 34, bushPx(56, 34)) },
      },
      flower: { a: { 0: {} }, b: { 0: objFrame(14, 16, flowerPx(14, 16, [255, 120, 200])) } },
    },
    'Obj/signboard.img': { sign: { a: { 0: objFrame(34, 44, boardPx(34, 44)) } } },
    'Obj/etc.img': { fence: { a: { 0: objFrame(98, 32, fencePx(98, 32)) } } },
    'Obj/house.img': { home: { big: { 0: objFrame(520, 400, solid([180, 90, 70])) } } },
  };
  // flower/a/0 is an animation node: numbered canvases directly under l2
  objs['Obj/acc1.img'].flower.a[0] = { 0: objFrame(14, 16, flowerPx(14, 16, [255, 80, 80]), 150), 1: objFrame(14, 16, flowerPx(14, 16, [255, 200, 80]), 150), 2: objFrame(14, 16, flowerPx(14, 16, [255, 80, 80]), 150) };

  const refs = [
    ['acc1', 'nature', 'tree', '0', 30],
    ['acc1', 'nature', 'bush', '0', 22],
    ['acc1', 'flower', 'a', '0', 40],
    ['acc1', 'flower', 'b', '0', 25],
    ['signboard', 'sign', 'a', '0', 5],
    ['etc', 'fence', 'a', '0', 12],
    ['house', 'home', 'big', '0', 3],
    ['acc1', 'nature', 'ghost', '0', 4], // node absent: logged and skipped
  ];
  const mkObj = (r, i) => ({ oS: r[0], l0: r[1], l1: r[2], l2: r[3], x: i * 10, y: 0, z: 0 });
  const objList = {};
  let n = 0;
  for (const r of refs) for (let k = 0; k < r[4]; k++) objList[n] = mkObj(r, n++);
  const tiles = {};
  for (let i = 0; i < 60; i++) tiles[i] = { u: 'bsc', no: i % 3, x: i * 90, y: 0, zM: 0 };
  const town = {
    info: { town: 1, bgm: 'Bgm00/FloralLife', mapMark: 'Henesys' },
    0: { info: { tS: 'grassySoil' }, tile: tiles, obj: objList },
    1: { info: { tS: 'grassySoil' }, tile: {}, obj: {} },
    foothold: {},
  };
  const mapImgs = { 'Tile/grassySoil.img': tile, 'Tile/darkMountain.img': { bsc: { 0: canvas(8, 8, solid([90, 110, 100])) } }, 'Tile/forestGreen.img': { bsc: { 0: canvas(8, 8, solid([60, 150, 60])) } }, 'Tile/ancientForest.img': { bsc: { 0: canvas(8, 8, solid([25, 48, 22])) } }, 'Tile/blackTile.img': { bsc: { 0: canvas(8, 8, () => [0, 0, 0, 0]) } }, 'Tile/darkWood.img': { bsc: { 0: canvas(8, 8, solid([35, 26, 7])) } }, 'Tile/swamp.img': { bsc: { 0: canvas(8, 8, solid([40, 41, 38])) } }, 'Tile/dryRock.img': { bsc: { 0: canvas(8, 8, solid([170, 130, 90])) } }, 'Tile/darkCave.img': { bsc: { 0: canvas(8, 8, solid([0, 0, 0])) } }, ...objs };
  if (!noTown) mapImgs['Map/Map1/100000000.img'] = town;
  // run regions: 0 and 1 are candidates, 2 is found by its String.wz street name (no candidate exists), 3 to 6 have no map at all
  objs['Obj/acc2.img'] = { nature: { rock: { a: { 0: objFrame(80, 50, bushPx(80, 50)) } } } };
  mapImgs['Obj/acc2.img'] = objs['Obj/acc2.img'];
  // supplementary decor a tile-less map borrows: acc*/<borrowed tile set>/nature
  mapImgs['Obj/acc3.img'] = { ancientForest: { nature: { a: { 0: objFrame(60, 90, treePx(60, 90, 0)) }, b: { 0: objFrame(30, 30, bushPx(30, 30)) } } } };
  const regionMap = (tS, refs, bgm, n = 40, noTiles = false) => {
    const list = {};
    let k = 0;
    for (const r of refs) for (let i = 0; i < r[4]; i++) list[k] = mkObj(r, k++);
    const t = {};
    for (let i = 0; i < n; i++) t[i] = { u: 'bsc', no: i % 2, x: i * 90, y: 0, zM: 0 };
    return { info: { bgm, mapMark: 'None' }, 0: { info: { tS }, tile: t, obj: list }, 1: { info: { tS: 'grassySoil' }, tile: noTiles ? {} : { 0: { u: 'enH0', no: 0, x: 0, y: 0 } }, obj: {} }, foothold: {} };
  };
  const natureRefs = [['acc1', 'nature', 'tree', '0', 20], ['acc1', 'nature', 'bush', '0', 15], ['acc1', 'flower', 'a', '0', 12], ['acc1', 'flower', 'b', '0', 6], ['etc', 'fence', 'a', '0', 30], ['house', 'home', 'big', '0', 9], ['etc', 'connect', 'ladder', '0', 7]];
  mapImgs['Map/Map1/104040000.img'] = regionMap('grassySoil', natureRefs, 'Bgm00/FloralLife');
  mapImgs['Map/Map1/101010000.img'] = regionMap('darkMountain', [['acc1', 'nature', 'tree', '0', 12], ['acc2', 'nature', 'rock', 'a', 9], ['signboard', 'sign', 'a', '0', 5]], 'Bgm00/Henesys', 0, true); // Ellinia: no tiles at all, borrows ancientForest
  mapImgs['Map/Map1/102000100.img'] = regionMap('dryRock', natureRefs.slice(0, 4), 'Bgm00/FloralLife');
  // region 3: Sleepywood by map name; region 4: first two candidates are rejected on purpose (tile set in use, pure black)
  mapImgs['Map/Map1/105040300.img'] = regionMap('darkWood', natureRefs.slice(0, 4), 'Bgm00/Henesys'); // dim: accepted and brightened
  mapImgs['Map/Map1/107000000.img'] = regionMap('grassySoil', natureRefs.slice(0, 4), 'Bgm00/Henesys'); // tile set already used
  mapImgs['Map/Map1/107000100.img'] = regionMap('darkCave', natureRefs.slice(0, 4), 'Bgm00/Henesys'); // black
  mapImgs['Map/Map1/107000200.img'] = regionMap('swamp', natureRefs.slice(0, 4), 'Bgm00/Henesys'); // dim: accepted and brightened
  mapImgs['Back/grassySoil.img'] = { back: { 0: canvas(16, 16, solid([200, 230, 255])) } };
  if (!noUi) {
    // the classic login backdrop: a sky gradient, a sea strip and two clouds (invented pixels)
    const cloud = (w, h) => (x, y) => (((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2 < 1 ? [255, 255, 255, 230] : [0, 0, 0, 0]);
    mapImgs['Back/login.img'] = {
      back: {
        0: canvas(400, 300, (x, y) => [90 + (y >> 2), 160 + (y >> 2), 255 - (y >> 3), 255], { origin: vec(200, 150) }),
        1: canvas(400, 60, (x, y) => [30, 100 + ((x + y) % 8) * 3, 170, 255], { origin: vec(200, 30) }),
        2: canvas(120, 40, cloud(120, 40), { origin: vec(60, 20) }),
        3: canvas(90, 30, cloud(90, 30), { origin: vec(45, 15) }),
      },
      ani: { 0: { 0: canvas(60, 20, cloud(60, 20), { origin: vec(30, 10), delay: 200 }), 1: canvas(60, 20, cloud(60, 20), { origin: vec(30, 10), delay: 200 }) } },
    };
    // the login map's objects (UI.wz MapLogin.img places these)
    mapImgs['Obj/login.img'] = {
      Title: { signboard: { 0: canvas(180, 200, panel(180, 200, [150, 100, 55], [100, 66, 36]), { origin: vec(0, 0) }) } },
      CharSelect: { signboard: { 0: canvas(130, 200, panel(130, 200, [150, 100, 55], [100, 66, 36]), { origin: vec(0, 0) }) } },
    };
  }
  writeFileSync(join(dir, 'Map.wz'), buildWz(mapImgs));

  const red = [255, 130, 50], redEdge = [90, 20, 10];
  const sets = {
    NoRed0: digitSet(5, red, redEdge, { Miss: canvas(98, 38, solid([200, 200, 200]), { origin: vec(0, 38) }) }),
    NoRed1: digitSet(6, red, redEdge),
    NoCri0: digitSet(6, [255, 240, 120], [150, 30, 20]),
    NoCri1: digitSet(7, [255, 255, 160], [170, 20, 10], { effect: canvas(62, 57, (x, y) => (Math.hypot(x - 31, y - 28) < 28 && (x + y) % 9 < 3 ? [255, 90, 40, 255] : [0, 0, 0, 0]), { origin: vec(10, 50) }) }),
    NoViolet0: digitSet(5, [200, 140, 255], [50, 20, 90], { Miss: canvas(98, 38, solid([160, 120, 220]), { origin: vec(0, 38) }) }),
    NoViolet1: digitSet(6, [210, 160, 255], [50, 20, 90]),
    NoBlue0: digitSet(5, [120, 190, 255], [10, 40, 110]),
    NoBlue1: digitSet(6, [140, 210, 255], [10, 40, 110]),
  };
  if (noRedDigits) {
    delete sets.NoRed0;
    delete sets.NoRed1;
  }
  const levelUp = {};
  for (let i = 0; i < 12; i++) {
    const w = 90 + i * 12, h = 70 + i * 14;
    levelUp[i] = canvas(w, h, (x, y) => {
      const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2));
      return d < 1 && d > 0.55 - i * 0.02 ? [255, 235, 90, Math.round(255 * (1 - i / 14))] : [0, 0, 0, 0];
    }, { origin: vec(w >> 1, h - 10) });
  }
  const burst = (n, col) => seq(n, (i) => canvas(70, 70, (x, y) => (Math.hypot(x - 35, y - 35) < 10 + i * 5 && Math.hypot(x - 35, y - 35) > i * 3 ? [...col, 220 - i * 20] : [0, 0, 0, 0]), { origin: vec(35, 35) }));
  writeFileSync(join(dir, 'Effect.wz'), buildWz({ 'BasicEff.img': { ...sets, LevelUp: levelUp, Enchant: { Success: burst(6, [120, 255, 120]), Failure: burst(5, [255, 90, 90]) } }, 'ItemEff.img': { 0: {} } }));

  if (noUi) return;
  const num = (c, w = 5, h = 7) => canvas(w, h, (x, y) => ((x + y) % 3 === 0 || x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0]), { origin: vec(0, 0) });
  const bg = (x, y) => {
    const well = (x > 200 && x < 540 && ((y > 18 && y < 34) || (y > 38 && y < 54))) ? [20, 24, 36, 255] : null;
    return well ?? (y === 0 ? [150, 160, 190, 255] : y < 3 ? [90, 100, 135, 255] : [58 + (y >> 3), 66 + (y >> 3), 96 + (y >> 2), 255]);
  };
  const state = (w, h, a, b) => ({ normal: { 0: canvas(w, h, panel(w, h, a, b), { origin: vec(0, 0) }) }, pressed: { 0: canvas(w, h, panel(w, h, b, a), { origin: vec(0, 0) }) }, disabled: { 0: canvas(w, h, panel(w, h, [120, 120, 120], [80, 80, 80]), { origin: vec(0, 0) }) }, mouseOver: { 0: canvas(w, h, panel(w, h, a.map((c) => c + 30), b.map((c) => c + 30)), { origin: vec(0, 0) }) } });
  const textBtn = (a, b) => {
    // a gradient button with a white 'label' blob in the middle (so the blank-button cut has something to cut out)
    const mk = (a2, b2) => canvas(44, 20, (x, y) => (x > 14 && x < 30 && y > 6 && y < 14 ? [255, 255, 255, 255] : panel(44, 20, a2, b2)(x, y)), { origin: vec(0, 0) });
    return { normal: { 0: mk(a, b) }, pressed: { 0: mk(b, a) }, disabled: { 0: mk([120, 120, 120], [80, 80, 80]) }, mouseOver: { 0: mk(a.map((c) => Math.min(255, c + 30)), b.map((c) => Math.min(255, c + 30))) }, keyFocused: { 0: mk(a, b) } };
  };
  const bar = (x, y) => (y < 14 ? [230 - y * 6, 40, 40, 255] : y > 15 ? [40, 90, 230 - (y - 16) * 5, 255] : [0, 0, 0, 0]);
  const arrow = (x, y) => (x <= y / 1.6 && x >= 0 && y < 20 && x < 12 ? ((x === 0 || y === 19 || Math.abs(x - y / 1.6) < 1.2) ? [0, 0, 0, 255] : [255, 255, 255, 255]) : [0, 0, 0, 0]);
  const win3 = (w, a, b) => ({ t: canvas(w, 40, panel(w, 40, a, b), { origin: vec(0, 0) }), c: canvas(w, 20, (x, y) => (x === 0 || x === w - 1 ? [30, 30, 50, 255] : [...b, 255]), { origin: vec(0, 0) }), s: canvas(w, 47, panel(w, 47, b, a), { origin: vec(0, 0) }) });
  const statusBar = {
    base: {
      backgrnd: canvas(800, 71, bg, { origin: vec(0, 71) }),
      backgrnd2: canvas(570, 71, bg, { origin: vec(0, 71) }),
      quickSlot: canvas(151, 80, panel(151, 80, [70, 80, 110], [40, 46, 70]), { origin: vec(0, 80) }),
      chatTarget: canvas(81, 20, solid([40, 40, 60])),
      chat: canvas(566, 5, solid([20, 20, 30])),
    },
    gauge: { graduation: canvas(340, 31, (x, y) => (x % 34 === 0 ? [255, 255, 255, 120] : [0, 0, 0, 0]), { origin: vec(0, 0) }), bar: canvas(340, 31, bar, { origin: vec(0, 0) }), gray: canvas(1, 16, solid([40, 40, 40])), tempExp: canvas(1, 16, solid([220, 200, 60])) },
    BtMenu: state(40, 20, [120, 150, 220], [50, 80, 160]),
    number: { ...Object.fromEntries([...'0123456789'].map((c) => [c, num(c)])), slash: num('/', 7, 7), percent: num('%', 7, 7), Lbracket: num('[', 2, 9), Rbracket: num(']', 2, 9) },
  };
  const lvno = Object.fromEntries([...'0123456789'].map((c) => [c, canvas(11, 13, (x, y) => ((x + y) % 2 === 0 ? [255, 240, 140, 255] : [200, 140, 40, 255]), { origin: vec(0, 0) })]));
  lvno.blank = canvas(11, 13, solid([0, 0, 0]));
  const basic = {
    Cursor: { 0: { 0: canvas(14, 20, arrow, { origin: vec(1, 1) }) }, 1: { 0: canvas(14, 20, (x, y) => { const p = arrow(x, y); return p[3] && p[0] === 255 ? [255, 220, 120, 255] : p; }, { origin: vec(1, 1) }) } },
    LevelNo: lvno,
    Notice: { backgrnd: canvas(264, 132, panel(264, 132, [220, 225, 240], [180, 190, 215])) },
    Notice2: win3(258, [225, 230, 245], [200, 208, 228]),
    Notice3: win3(266, [245, 235, 210], [225, 210, 175]),
    YesNo2: win3(258, [225, 230, 245], [200, 208, 228]),
    YesNo3: win3(266, [245, 235, 210], [225, 210, 175]),
    BtOK: textBtn([255, 190, 70], [220, 120, 20]),
    BtCancel: textBtn([130, 170, 230], [50, 90, 180]),
    BtYes: textBtn([255, 190, 70], [220, 120, 20]),
    BtNo: textBtn([130, 170, 230], [50, 90, 180]),
    BtClose: state(14, 14, [200, 90, 90], [140, 30, 30]),
    Slider: { left: canvas(3, 8, solid([60, 70, 100])), mid: canvas(1, 8, solid([70, 80, 115])), right: canvas(3, 8, solid([60, 70, 100])), thumbNormal: canvas(22, 14, panel(22, 14, [255, 200, 90], [220, 130, 30])), thumbMouseOver: canvas(22, 14, panel(22, 14, [255, 220, 120], [240, 150, 40])) },
  };
  const bigBtn = (a, b) => ({ normal: { 0: canvas(120, 36, panel(120, 36, a, b), { origin: vec(0, 0) }) }, pressed: { 0: canvas(120, 36, panel(120, 36, b, a), { origin: vec(0, 0) }) }, disabled: { 0: canvas(120, 36, panel(120, 36, [120, 120, 120], [80, 80, 80]), { origin: vec(0, 0) }) }, mouseOver: { 0: canvas(120, 36, panel(120, 36, a.map((c) => Math.min(255, c + 30)), b.map((c) => Math.min(255, c + 30))), { origin: vec(0, 0) }) } });
  const login = {
    Title: {
      MSTitle: canvas(397, 219, (x, y) => ((x - 198) ** 2 / 190 ** 2 + (y - 109) ** 2 / 100 ** 2 < 1 ? (y > 80 && y < 140 ? [255, 160, 40, 255] : [60, 120, 220, 255]) : [0, 0, 0, 0]), { origin: vec(198, 109) }),
      signboard: canvas(180, 200, panel(180, 200, [150, 100, 55], [100, 66, 36]), { origin: vec(0, 0) }),
      BtLogin: bigBtn([255, 190, 70], [220, 120, 20]),
      BtNew: bigBtn([130, 170, 230], [50, 90, 180]),
      BtHomePage: bigBtn([140, 200, 140], [60, 130, 70]),
      BtQuit: bigBtn([220, 130, 130], [150, 50, 50]),
    },
    CharSelect: {
      BtSelect: bigBtn([255, 190, 70], [220, 120, 20]),
      BtNew: bigBtn([130, 170, 230], [50, 90, 180]),
      BtDelete: bigBtn([220, 130, 130], [150, 50, 50]),
      charInfo: canvas(140, 70, panel(140, 70, [40, 50, 90], [20, 28, 56]), { origin: vec(0, 0) }),
    },
    WorldSelect: { BtWorld: { 0: { normal: { 0: canvas(26, 95, panel(26, 95, [255, 190, 70], [220, 120, 20]), { origin: vec(0, 0) }) } } } },
    Common: { frame: canvas(8, 8, solid([0, 0, 0])), selectWorld: canvas(60, 30, panel(60, 30, [200, 200, 220], [140, 140, 170])) },
  };
  // the v83 login map: a sky + a scrolling strip, the title signboard at the origin and the character select signboard one step further up
  const lb = (o) => ({ bS: 'login', no: 0, ani: 0, x: 0, y: 0, rx: 0, ry: 0, cx: 0, cy: 0, type: 0, a: 255, front: 0, f: 0, ...o });
  const lo = (l0, x, y) => ({ oS: 'login', l0, l1: 'signboard', l2: '0', x, y, z: 0, f: 0 });
  const mapLogin = {
    info: { VRLeft: -400, VRTop: -2000, VRRight: 400, VRBottom: 300 },
    back: { 0: lb({ rx: -100, ry: -100 }), 1: lb({ ani: 1, type: 4, rx: 10 }) },
    0: { info: {}, obj: { 0: lo('Title', 0, 0), 1: lo('CharSelect', 20, -1250) } },
  };
  const slotFrame = canvas(32, 32, panel(32, 32, [30, 38, 70], [60, 72, 120], [10, 10, 20]), { origin: vec(0, 0) });
  const tab = (on) => canvas(30, 18, panel(30, 18, on ? [255, 230, 150] : [150, 150, 170], on ? [230, 170, 60] : [100, 100, 130]), { origin: vec(0, 0) });
  const uiwindow = {
    Stat: { backgrnd: canvas(175, 299, panel(175, 299, [230, 225, 210], [200, 195, 175])), BtClose: state(14, 14, [200, 90, 90], [140, 30, 30]) },
    Equip: { backgrnd: canvas(175, 304, windowBg(175, 304, EQUIP_FIXTURE_RECTS, [210, 205, 190], [180, 175, 155]), { origin: vec(0, 0) }), backgrnd2: canvas(184, 26, solid([120, 130, 170])), backgrnd3: canvas(184, 20, solid([100, 110, 150])), BtClose: state(14, 14, [200, 90, 90], [140, 30, 30]), slot: slotFrame },
    Item: {
      backgrnd: canvas(175, 289, windowBg(175, 289, [...ITEM_FIXTURE_HEADER_RECTS, ...ITEM_FIXTURE_RECTS], [220, 215, 200], [185, 180, 160]), { origin: vec(0, 0) }),
      Tab: { enabled: { 0: tab(true), 1: tab(true), 2: tab(true) }, disabled: { 0: tab(false), 1: tab(false), 2: tab(false) } },
      BtClose: state(14, 14, [200, 90, 90], [140, 30, 30]),
    },
    ToolTip: { Item: { n: canvas(8, 8, solid([20, 20, 50])), c: canvas(4, 4, solid([20, 20, 50])) } },
  };
  Object.assign(statusBar, {
    lvNumber: Object.fromEntries([...'0123456789'].map((c) => [c, canvas(9, 12, (x, y) => ((x + y) % 2 === 0 ? [255, 255, 255, 255] : [200, 160, 40, 255]), { origin: vec(0, 0) })])),
    BtShop: state(32, 20, [230, 190, 90], [170, 120, 30]),
    BtShort: state(32, 20, [120, 190, 140], [50, 120, 70]),
    BtChat: state(32, 20, [150, 150, 190], [80, 80, 130]),
  });
  writeFileSync(join(dir, 'UI.wz'), buildWz({ 'StatusBar.img': statusBar, 'Basic.img': basic, 'Login.img': login, 'UIWindow.img': uiwindow, 'MapLogin.img': mapLogin }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node --experimental-strip-types scripts/maple-fixture.mjs <dir> [--all] [--world]');
  await writeFixture(dir, { all: process.argv.includes('--all') });
  if (process.argv.includes('--world')) writeWorldFixture(dir);
  console.log('fixture written to', dir);
}
