// Synthetic Mob/Skill/String/Sound .wz files (GMS key, version 83) for tests and for visual checks of the game.
// Contains no Nexon art: coloured blobs only.
//
//   node scripts/maple-fixture.mjs <dir> [--all]   # --all draws every mob and skill the game wants
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

/**
 * Writes Mob.wz, Skill.wz, String.wz and Sound.wz into `dir`.
 * Default: a handful of entries that exercise links, fly, UOL frames, big frames, name mismatches and missing nodes.
 * `all`: every mob and skill the game lists, so the built game can be viewed with "real" art.
 */
export async function writeFixture(dir, { all = false, noTitle = false, character = true } = {}) {
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
    add('000.img', 1001, skillTree([60, 200, 90], { iconOnly: true })); // Recovery: id < 10000, zero-padded node 0001001
  }

  const sounds = {
    'Bgm00.img': { FloralLife: sound(ID3_MP3, 90000), Henesys: sound(SYNC_MP3, 1000) },
    'BgmUI.img': noTitle ? { Login: sound(SYNC_MP3, 1000), WorldSelect: sound(SYNC_MP3, 1000) } : { Title: sound(SYNC_MP3, 60000) },
  };

  writeFileSync(join(dir, 'Mob.wz'), buildWz(mobs));
  writeFileSync(join(dir, 'Skill.wz'), buildWz(skillImgs));
  writeFileSync(join(dir, 'String.wz'), buildWz({ 'Mob.img': names }));
  writeFileSync(join(dir, 'Sound.wz'), buildWz(sounds));
  if (character) {
    const { Base, Character } = await characterImages();
    writeFileSync(join(dir, 'Base.wz'), buildWz(Base));
    writeFileSync(join(dir, 'Character.wz'), buildWz(Character));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node --experimental-strip-types scripts/maple-fixture.mjs <dir> [--all]');
  await writeFixture(dir, { all: process.argv.includes('--all') });
  console.log('fixture written to', dir);
}
