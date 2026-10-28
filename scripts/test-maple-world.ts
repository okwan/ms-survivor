// Run: node --experimental-strip-types scripts/test-maple-world.ts
// Synthetic Map/Effect/UI .wz files with the real layout names -> scripts/fetch-maple.ts -> manifest sections map, damage, ui, effects.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { MapleManifest } from '../src/maple/assets.ts';
import { EQUIP_FIXTURE_RECTS, ITEM_FIXTURE_HEADER_RECTS, ITEM_FIXTURE_RECTS, writeFixture, writeWorldFixture } from './maple-fixture.mjs';

const root = mkdtempSync(join(tmpdir(), 'test-maple-world-'));
let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };

function png(file: string) {
  const b = readFileSync(file);
  let pos = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('latin1', pos + 4, pos + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(pos + 8); h = b.readUInt32BE(pos + 12); }
    else if (type === 'IDAT') idat.push(b.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(rgba, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return { w, h, rgba };
}

function run(name: string, wz: string) {
  const dist = join(root, name);
  const r = spawnSync('node', ['--experimental-strip-types', '--no-warnings', 'scripts/fetch-maple.ts', dist, wz], { encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  const mf = join(dist, 'maple', 'manifest.json');
  return { dist, out, m: existsSync(mf) ? (JSON.parse(readFileSync(mf, 'utf8')) as MapleManifest) : null };
}

try {
  const wz = join(root, 'wz');
  await writeFixture(wz);
  writeWorldFixture(wz);
  const { dist, out, m } = run('main', wz);
  ok(m, 'manifest written');
  const maple = (p: string) => join(dist, 'maple', p);

  // ground
  const g = m!.map!.ground!;
  eq([g.w, g.h], [360, 240], 'ground is a 4x4 grid of 90x60 bsc tiles');
  const gp = png(maple(g.image));
  eq([gp.w, gp.h], [360, 240], 'ground PNG size');
  let opaque = true;
  for (let i = 3; i < gp.rgba.length; i += 4) if (gp.rgba[i] !== 255) opaque = false;
  ok(opaque, 'ground is fully opaque');
  eq(m!.map!.tileSet, 'grassySoil', 'tile set read from the town layers (tS)');
  ok(/tile set chosen: grassySoil/.test(out) && /ground tile/.test(out), 'log names the tile set and previews a ground tile');

  // objects: tree/bush/flowers/sign/fence kept, house too big, ghost has no node
  const o = m!.map!.objects!;
  const keys = o.items.map((i) => i.key).sort();
  eq(keys, ['acc1.flower.a.0', 'acc1.flower.b.0', 'acc1.nature.bush.0', 'acc1.nature.tree.0', 'etc.fence.a.0', 'signboard.sign.a.0'], 'decorations extracted, buildings and absent nodes skipped');
  eq(o.frames.filter((f) => f.action === 'acc1.flower.a.0').length, 3, 'animated object keeps its frames');
  eq(o.frames.filter((f) => f.action === 'acc1.nature.tree.0').map((f) => f.delay), [400, 400], 'object frame delays');
  const tree = o.items.find((i) => i.key === 'acc1.nature.tree.0')!;
  eq([tree.w, tree.h, tree.weight], [90, 130, 30], 'tree size and usage weight');
  eq(png(maple(o.atlas)).w, o.size[0], 'object atlas size matches the manifest');
  ok(/too big/.test(out) && /no node/.test(out), 'log explains skipped objects');

  // damage digits
  const d = m!.damage!;
  for (const set of ['NoRed0', 'NoRed1', 'NoCri0', 'NoCri1', 'NoViolet0', 'NoViolet1']) eq(d.frames.filter((f) => f.action === set).length, 10, `${set} has ten digits`);
  ok(d.frames.some((f) => f.action === 'NoCri1.effect'), 'crit effect sprite kept');
  ok(d.frames.some((f) => f.action === 'NoRed0.Miss'), 'Miss sprite kept');
  const r0 = d.frames.find((f) => f.action === 'NoRed0' && f.index === 0)!;
  const r1 = d.frames.find((f) => f.action === 'NoRed1' && f.index === 0)!;
  ok(r1.h > r0.h, 'the "1" set is the larger one');
  ok(/NoRed1 digit 7/.test(out), 'log previews NoRed1 digit 7');

  // level-up effect
  const lu = m!.effects!.levelUp!;
  eq(lu.frames.length, 12, 'LevelUp frames');
  ok(lu.frames.every((f) => f.delay === 70), 'LevelUp without WZ delays plays at 70 ms');

  // UI
  const p = m!.ui!.pieces;
  for (const n of ['sb.backgrnd', 'sb.fill', 'sb.hp', 'sb.mp', 'sb.n.0', 'sb.n.9', 'sb.n.slash', 'sb.menu.normal', 'cur.0', 'lv.0', 'lv.blank', 'win.notice2', 'btn.ok.normal', 'btn.cancel.hover', 'btn.close.normal', 'sl.thumb', 'title.logo']) ok(p[n], `ui piece ${n}`);
  eq([p['sb.fill'].w, p['sb.fill'].h], [1, 71], 'status bar strip is one column');
  eq([p['sb.hp'].w, p['sb.hp'].h], [340, 14], 'HP band is the red rows of gauge/bar');
  eq(p['win.notice2'].meta, { top: 40, mid: 20, bottom: 47, partW: 258 }, 'window frame is t+c+s stacked');
  const bb = p['btn.ok.normal'];
  eq([bb.w, bb.h, bb.meta!.cap], [2 * bb.meta!.cap + 1, 20, bb.meta!.cap], 'blank button is cap | column | cap');
  eq(p['cur.0'].ox, 1, 'cursor origin kept');
  ok(existsSync(maple(p['sb.hp'].src)) && existsSync(maple(p['title.logo'].src)), 'ui PNGs exist');
  ok(/UI pieces missing \(0\)/.test(out) && /status bar background/.test(out), 'log lists found/missing UI pieces and previews the bar');

  // classic title screen, status bar extras, equip / inventory / stat windows
  for (const n of ['login.signboard', 'login.btLogin.normal', 'login.btLogin.hover', 'login.btNew.pressed', 'login.btHome.normal', 'login.btQuit.normal', 'cs.btSelect.normal', 'cs.btNew.normal', 'cs.btDelete.normal', 'cs.info', 'login.frame', 'cs.world',
    'login.back.back0', 'login.back.back1', 'login.back.back2', 'login.back.back3',
    'sb.lvn.0', 'sb.lvn.9', 'sb.shop.normal', 'sb.short.hover', 'sb.chatBtn.normal', 'uiw.equip', 'uiw.equip2', 'uiw.equip3', 'uiw.item', 'uiw.stat', 'item.tab.on.0', 'item.tab.off.2', 'equip.close.normal', 'item.close.pressed', 'stat.close.normal', 'tip.n']) ok(p[n], `ui piece ${n}`);
  eq([p['login.back.back0'].w, p['login.back.back0'].h], [400, 300], 'the largest backdrop layer is the sky');
  eq(p['login.back.back0'].meta, { rank: 0 }, 'layers are ranked by area');
  ok(!p['sb.claim.normal'] && !p['login.logo'], 'absent optional nodes are simply missing');
  ok(/Back\/login\.img: back ani/.test(out) && /login backdrop layer 1: back0 400x300/.test(out) && /Login\.img CharSelect:/.test(out) && /UIWindow\.img Equip:/.test(out) && /--- login button/.test(out), 'log shows the Login/Back/UIWindow keys and previews');
  ok(/UI extra \(login\/equip\/inventory\) pieces: \d+/.test(out), 'log reports the extra pieces and byte total');
  const extraBytes = Object.entries(p).filter(([n]) => /^(login|cs|uiw|item|equip|stat|tip)/.test(n)).reduce((a, [, v]) => a + readFileSync(maple(v.src)).length, 0);
  ok(extraBytes < 1_500_000, `extra UI atlas stays under 1.5 MB (${extraBytes})`);

  // baked slot frames are found in the window backgrounds (known rectangles in the fixture, within 1 px)
  const near = (found: { x: number; y: number; w: number; h: number }[] | undefined, want: { x: number; y: number; w: number; h: number }[], label: string) => {
    ok(found && found.length === want.length, `${label}: ${found?.length} frames found, ${want.length} expected`);
    for (const w of want) ok(found!.some((f) => Math.abs(f.x - w.x) <= 1 && Math.abs(f.y - w.y) <= 1 && Math.abs(f.w - w.w) <= 2), `${label}: frame at ${w.x},${w.y} found`);
  };
  near(p['uiw.equip'].rects, EQUIP_FIXTURE_RECTS, 'equip');
  near(p['uiw.item'].rects, [...ITEM_FIXTURE_HEADER_RECTS, ...ITEM_FIXTURE_RECTS], 'item');
  eq([p['uiw.equip'].w, p['uiw.equip'].h, p['uiw.item'].w, p['uiw.item'].h], [175, 304, 175, 289], 'window backgrounds keep their size');
  ok(/uiw\.equip: 175x304, 26 slot frames detected/.test(out) && /uiw\.item: 175x289, 26 slot frames/.test(out) && /uiw\.equip slot overlay/.test(out), 'log lists the rects and prints the overlay');

  // run regions
  const rg = m!.regions!.list;
  eq(rg.length, 7, 'one slot per region');
  eq(rg.map((r) => r?.mapId ?? null), [104040000, 101010000, 102000100, 105040300, 107000200, null, null], 'candidates first, street-name scan next, null when nothing exists');
  const g0 = rg[0]!, g1 = rg[1]!;
  eq([g0.street, g0.name, g0.tileSet], ['Henesys', 'Hunting Ground I', 'grassySoil'], 'region 0 names and dominant tile set');
  eq(g1.tileSet, 'ancientForest', 'tile-less Ellinia borrows its preferred set, not the greener forestGreen nor the see-through blackTile');
  ok(0.299 * g1.ground!.avg[0] + 0.587 * g1.ground!.avg[1] + 0.114 * g1.ground!.avg[2] > 60 && g1.ground!.avg[1] > g1.ground!.avg[0], 'its dark ground is lifted but stays green');
  ok(/borrowing preferred tile set ancientForest/.test(out) && /top 5 by greenness: forestGreen/.test(out) && /borrowed 2 from Obj\.wz/.test(out), 'log shows the borrowed set, the top 5 and the borrowed decor');
  eq(g0.objects!.items.map((i) => `${i.key}:${i.size}`).sort(), ['acc1.flower.a.0:small', 'acc1.flower.b.0:small', 'acc1.nature.bush.0:small', 'acc1.nature.tree.0:big'], 'region 0 keeps nature decor only, with size classes');
  eq(g1.objects!.items.map((i) => `${i.key}:${i.size}`).sort(), ['acc1.nature.tree.0:big', 'acc2.nature.rock.a:medium', 'acc3.ancientForest.nature.a:medium', 'acc3.ancientForest.nature.b:small'], 'region 1 decor: its own nature objects plus the borrowed acc3 set, signboard dropped');
  ok(existsSync(maple(g0.ground!.image)) && existsSync(maple(g0.objects!.atlas)) && g0.ground!.image !== g1.ground!.image, 'per-region ground and atlas PNGs');
  eq(png(maple(g1.objects!.atlas)).w, g1.objects!.size[0], 'region atlas size matches');
  eq([g0.bgm, g1.bgm, rg[2]!.bgm], ['bgm/region-0.mp3', 'bgm/region-1.mp3', 'bgm/region-0.mp3'], 'regions sharing a track share the file');
  const luma = (a: number[]) => 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
  ok(luma(rg[3]!.ground!.avg) > 60 && luma(rg[4]!.ground!.avg) > 60, 'dim grounds (darkWood, swamp) are brightened toward luma 70');
  ok(existsSync(maple(g1.bgm!)), 'region bgm file written');
  ok(/region 3 .*candidate 105040300 .*ACCEPTED/.test(out) && /gamma lift/.test(out) && /region 4 .*candidate 107000000 .*already used/.test(out) && /region 4 .*candidate 107000100 .*too dark/.test(out) && /region 2 .*scanning 1 maps/.test(out) && /region 2 .*candidate 102000100 .*ACCEPTED/.test(out) && /oS\/l0\/l1 seen/.test(out) && /region 0 decor cluster/.test(out), 'log shows the scan, the object paths and a cluster preview');

  // sound effects: MP3 as is, PCM wrapped into a WAV, the oversized one skipped
  const sf = m!.sfx!;
  eq(sf['mob.100100.damage'], 'sfx/mob.100100.damage.mp3', 'MP3 sound keeps its container');
  eq(sf['mob.100100.die'], 'sfx/mob.100100.die.wav', 'PCM sound becomes a wav');
  const wav = readFileSync(maple(sf['mob.100100.die']));
  eq([wav.toString('latin1', 0, 4), wav.toString('latin1', 8, 12), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt16LE(34), wav.length], ['RIFF', 'WAVE', 1, 22050, 16, 44 + 4000], 'wav header from the WAVEFORMATEX');
  const mp3 = readFileSync(maple(sf['mob.100100.damage']));
  ok(mp3[0] === 0xff && mp3.length === 2004, 'mp3 bytes untouched');
  ok(sf['mob.2220000.attack'] && sf['skill.2001005.use'] && sf['skill.2001005.hit'] && sf['skill.2101004.use'] && !sf['skill.2101004.hit'], 'boss attack, skill use/hit keys');
  ok(sf['game.levelup']?.endsWith('.wav') && sf['game.pickup'] && sf['game.drop'] && sf['game.portal'] && sf['ui.click'] && sf['ui.hover'], 'game and ui sounds');
  ok(sf['weapon.warrior.attack'] && sf['weapon.magician.attack'] && !sf['weapon.bowman.attack'] && !sf['weapon.thief.attack'], 'one weapon sound per class that has one; 400 KB limit applies');
  ok(/format tag 0x55/.test(out) && /format tag 0x1/.test(out) && /sfx totals: 17 sounds/.test(out) && /over the 400 KB limit/.test(out) && /no Damage\/Die sound/.test(out), 'log shows format tags, totals and skips');

  // the login map (UI.wz MapLogin.img + Back/login.img + Obj/login.img)
  const lg = m!.login!;
  ok(lg && lg.backs.length >= 2 && lg.objs.length >= 2, 'login section has backs and objects');
  eq(lg.backs[1].frames.length, 2, 'animated login back keeps its frames');
  ok(lg.objs.every((ob) => ob.frames.every((f) => existsSync(maple(f.src)) && f.src.startsWith('login/'))) && lg.backs.every((b) => b.frames.every((f) => existsSync(maple(f.src)))), 'login PNGs written under maple/login/');
  eq(lg.steps.title, { x: 0, y: 0 }, 'title step at the map origin');
  eq(lg.steps.select, { x: 0, y: -1200 }, 'select step one screen row up');
  ok(lg.ui['Title/BtLogin/normal/0'] && lg.ui['Common/frame'] && lg.ui['WorldSelect/BtWorld/0/normal/0'], 'Login.img canvases keyed by path');

  // old sections are untouched
  ok(Object.keys(m!.mobs).length >= 3 && m!.bgm.run, 'mobs and bgm still extracted');

  // no Map/Effect/UI .wz at all: only the old sections, no crash
  const old = join(root, 'wz-old');
  await writeFixture(old);
  const r = run('old', old);
  ok(r.m && !r.m.map && !r.m.damage && !r.m.ui && !r.m.effects && !r.m.regions, 'without the new .wz files the manifest has no world sections');
  ok(/Map\.wz is not available/.test(r.out), 'missing Map.wz is logged');

  // no town image and no NoRed digits: defaults and fallbacks
  const part = join(root, 'wz-part');
  await writeFixture(part);
  writeWorldFixture(part, { noTown: true, noRedDigits: true, noUi: true });
  const q = run('part', part);
  ok(q.m!.map!.ground && q.m!.map!.tileSet === 'grassySoil' && !q.m!.map!.objects, 'no town: grassySoil ground, no objects');
  ok(!q.m!.damage!.frames.some((f) => f.action === 'NoRed0') && q.m!.damage!.frames.some((f) => f.action === 'NoCri0'), 'missing NoRed sets are skipped, others kept');
  ok(!q.m!.ui, 'no UI.wz content: no ui section');
  ok(q.m!.regions && q.m!.regions.list[0] && q.m!.sfx, 'regions and sfx do not depend on the Henesys town image');
  ok(/NoRed0:MISSING/.test(q.out) && /BasicEff\.img keys/.test(q.out), 'log lists BasicEff keys and missing sets');

  console.log(`test-maple-world: ok (${checks} checks)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
