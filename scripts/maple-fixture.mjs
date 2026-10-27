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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node --experimental-strip-types scripts/maple-fixture.mjs <dir> [--all]');
  await writeFixture(dir, { all: process.argv.includes('--all') });
  console.log('fixture written to', dir);
}
