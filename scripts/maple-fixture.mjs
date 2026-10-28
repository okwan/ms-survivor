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

/**
 * Writes Mob.wz, Skill.wz, String.wz and Sound.wz into `dir`.
 * Default: a handful of entries that exercise links, fly, UOL frames, big frames, name mismatches and missing nodes.
 * `all`: every mob and skill the game lists, so the built game can be viewed with "real" art.
 */
export async function writeFixture(dir, { all = false, noTitle = false } = {}) {
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
  const mapImgs = { 'Tile/grassySoil.img': tile, 'Tile/darkMountain.img': { bsc: { 0: canvas(8, 8, solid([30, 30, 30])) } }, ...objs };
  if (!noTown) mapImgs['Map/Map1/100000000.img'] = town;
  mapImgs['Back/grassySoil.img'] = { back: { 0: canvas(16, 16, solid([200, 230, 255])) } };
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
  writeFileSync(join(dir, 'Effect.wz'), buildWz({ 'BasicEff.img': { ...sets, LevelUp: levelUp }, 'ItemEff.img': { 0: {} } }));

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
  const login = { Title: { MSTitle: canvas(397, 219, (x, y) => ((x - 198) ** 2 / 190 ** 2 + (y - 109) ** 2 / 100 ** 2 < 1 ? (y > 80 && y < 140 ? [255, 160, 40, 255] : [60, 120, 220, 255]) : [0, 0, 0, 0]), { origin: vec(198, 109) }) }, Common: { frame: canvas(8, 8, solid([0, 0, 0])) } };
  writeFileSync(join(dir, 'UI.wz'), buildWz({ 'StatusBar.img': statusBar, 'Basic.img': basic, 'Login.img': login, 'UIWindow.img': { Stat: { backgrnd: canvas(172, 290, panel(172, 290, [230, 230, 240], [200, 200, 220])) } } }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node --experimental-strip-types scripts/maple-fixture.mjs <dir> [--all] [--world]');
  await writeFixture(dir, { all: process.argv.includes('--all') });
  if (process.argv.includes('--world')) writeWorldFixture(dir);
  console.log('fixture written to', dir);
}
