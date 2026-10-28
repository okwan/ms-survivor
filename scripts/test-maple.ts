// Run: node --experimental-strip-types scripts/test-maple.ts
// Builds synthetic Mob/Skill/String/Sound .wz files, runs the extractor (scripts/fetch-maple.ts) on them and checks
// the manifest, atlases, link/fly/UOL handling, missing-mob handling and the mp3 passthrough.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { WANTED_MOBS, WANTED_SKILLS } from '../src/maple/assets.ts';
import type { FrameRec, MapleManifest } from '../src/maple/assets.ts';
import { wantedItems } from '../src/maple/avatar-core.ts';
import { sniffAudio } from './fetch-maple.ts';
import { ID3_MP3, SYNC_MP3, q, writeFixture } from './maple-fixture.mjs';

const root = mkdtempSync(join(tmpdir(), 'test-maple-'));
let checks = 0;
const ok = (cond: unknown, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};
const eq = (a: unknown, b: unknown, msg: string) => {
  checks++;
  assert.deepEqual(a, b, msg);
};

/** Minimal PNG decoder for what png.mjs writes (8-bit RGBA, filter 0). */
function decodePng(file: string) {
  const b = readFileSync(file);
  eq(b.subarray(1, 4).toString(), 'PNG', `${file} is a PNG`);
  let pos = 8;
  let w = 0;
  let h = 0;
  const idat: Buffer[] = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('latin1', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(rgba, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  const px = (x: number, y: number) => [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
  return { w, h, rgba, px };
}

function extract(name: string, localDir: string) {
  const dist = join(root, name);
  const r = spawnSync('node', ['--experimental-strip-types', '--no-warnings', 'scripts/fetch-maple.ts', dist, localDir], { encoding: 'utf8' });
  return { dist, out: r.stdout + r.stderr, status: r.status };
}

const manifestOf = (dist: string) => JSON.parse(readFileSync(join(dist, 'maple', 'manifest.json'), 'utf8')) as MapleManifest;

function checkAtlas(dist: string, atlas: string, size: [number, number], frames: FrameRec[]) {
  const png = decodePng(join(dist, 'maple', atlas));
  eq([png.w, png.h], size, `${atlas} PNG size matches the manifest`);
  ok(png.w <= 2048, `${atlas} is at most 2048 wide`);
  const rects = new Map<string, FrameRec>();
  for (const f of frames) {
    ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= png.w && f.y + f.h <= png.h, `${atlas} ${f.action}/${f.index} inside the atlas`);
    rects.set(`${f.x},${f.y},${f.w},${f.h}`, f);
  }
  const list = [...rects.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${atlas} frames ${i} and ${j} do not overlap`);
    }
  return png;
}

try {
  // ---- main fixture ----------------------------------------------------------------------------------------------
  const fx = join(root, 'wz');
  await writeFixture(fx);
  const run = extract('dist', fx);
  eq(run.status, 0, 'extractor exits 0');
  const m = manifestOf(run.dist);
  eq(m.version, 1, 'manifest version');
  eq([m.source?.region, m.source?.wzVersion], ['gms', 83], 'source region and WZ version');
  ok(m.source?.mirror.startsWith('local:'), 'source mirror is the local dir');
  eq(Object.keys(m.mobs).sort(), ['100100', '100101', '120100', '8800000'], 'only the mobs present in Mob.wz are in the manifest');
  ok(!existsSync(join(run.dist, 'maple', 'mobs', '1210100.png')), 'no atlas for a missing mob (Pig)');

  // Snail: all actions, UOL frame shares a slot, origin and delay carried over
  const snail = m.mobs['100100'];
  eq(snail.name, 'Snail', 'name from String.wz');
  eq([snail.info.maxHP, snail.info.speed, snail.info.level, snail.info.bodyAttack], [8, -10, 1, 1], 'info values');
  eq(snail.speed, 0.9, 'speed factor from info/speed -10 (1 + speed / 100)');
  ok(/mob speed 100100 Snail: speed=-10 flySpeed=- fs=- .*factor 0\.90/.test(run.out), 'the log shows speed / flySpeed / fs of every wanted mob');
  const count = (frames: FrameRec[], a: string) => frames.filter((f) => f.action === a).length;
  eq(['stand', 'move', 'hit1', 'die1', 'attack1'].map((a) => count(snail.frames, a)), [3, 4, 1, 3, 0], 'Snail frame counts per action');
  const s0 = snail.frames.find((f) => f.action === 'stand' && f.index === 0)!;
  const s2 = snail.frames.find((f) => f.action === 'stand' && f.index === 2)!;
  eq([s2.x, s2.y], [s0.x, s0.y], 'UOL frame reuses the same atlas slot');
  eq([s0.w, s0.h, s0.ox, s0.oy, s0.delay], [24, 20, 12, 20, 200], 'frame size, origin and delay');
  const sp = checkAtlas(run.dist, snail.atlas, snail.size, snail.frames);
  eq(sp.px(s0.x + 12, s0.y + 12), [q(240), q(120), q(32), 255], 'atlas pixel inside the blob has the source colour');
  eq(sp.px(s0.x, s0.y)[3], 0, 'atlas pixel in the frame corner is transparent');
  const packed = new Set(snail.frames.map((f) => `${f.x},${f.y}`)).size;
  eq(packed, snail.frames.length - 1, 'one slot shared, the rest unique');

  // Blue Snail links to the Snail: frames come from the linked image, its own info wins
  const blue = m.mobs['100101'];
  eq(blue.name, 'Blue Snail', 'linked mob keeps its own name');
  eq(blue.frames.length, snail.frames.length, 'linked mob resolves the target animations');
  eq([blue.info.maxHP, blue.info.level, blue.info.speed], [10, 2, -10], 'own info overrides, missing info comes from the link');
  eq(blue.speed, 0.9, 'a linked mob gets a speed factor too');
  ok(blue.atlas !== snail.atlas && existsSync(join(run.dist, 'maple', blue.atlas)), 'linked mob gets its own atlas file');

  // Shroom: flying mob (fly stands in for move) with attack1
  const shroom = m.mobs['120100'];
  eq([count(shroom.frames, 'move'), count(shroom.frames, 'attack1'), count(shroom.frames, 'stand')], [4, 2, 2], 'fly becomes move, attack1 kept');
  checkAtlas(run.dist, shroom.atlas, shroom.size, shroom.frames);

  // Zakum: big frames still pack within 2048 wide
  const zak = m.mobs['8800000'];
  eq(zak.frames.length, 6, 'Zakum frames');
  const zp = checkAtlas(run.dist, zak.atlas, zak.size, zak.frames);
  ok(zp.w === 2048 && zp.h >= 600, 'Zakum atlas wraps rows at 2048');

  // Skills
  eq(Object.keys(m.skills).sort(), ['1000000', '2001005', '2101004'].sort(), 'only skills present in Skill.wz');
  const claw = m.skills['2001005'];
  eq(claw.icon, 'skills/2001005-icon.png', 'icon path');
  const icon = decodePng(join(run.dist, 'maple', claw.icon!));
  eq([icon.w, icon.h], [32, 32], 'icon PNG is 32x32');
  eq(['effect', 'ball', 'hit'].map((a) => count(claw.frames, a)), [3, 2, 2], 'effect/ball/hit frames (hit read from hit/0)');
  checkAtlas(run.dist, claw.atlas!, claw.size!, claw.frames);
  eq(m.skills['1000000'].atlas, null, 'icon-only skill has no atlas');
  ok(m.skills['1000000'].icon && existsSync(join(run.dist, 'maple', m.skills['1000000'].icon!)), 'Improved HP Recovery found at node 1000000 in 100.img');
  eq(WANTED_SKILLS.find((s) => s.key === 'improved_hp_recovery')!.node, '1000000', 'job skill node name is 7 digits');

  // BGM passthrough
  eq(m.bgm, { run: 'bgm/run.mp3', title: 'bgm/title.mp3' }, 'bgm paths');
  ok(readFileSync(join(run.dist, 'maple', 'bgm', 'run.mp3')).equals(ID3_MP3), 'run mp3 bytes pass through unchanged (ID3)');
  ok(readFileSync(join(run.dist, 'maple', 'bgm', 'title.mp3')).equals(SYNC_MP3), 'title mp3 bytes pass through unchanged (MPEG sync)');

  // Log output the CI reader relies on
  ok(/120100\s+Shroom\s+Mushroom\s+MISMATCH/.test(run.out), 'log table flags the MISMATCH');
  ok(/8800000\s+Zakum\s+-\s+MISSING/.test(run.out), 'log table flags the name MISSING in String.wz');
  ok(/mob NAME MISMATCHES \(1\): 120100 expected "Shroom" got "Mushroom"/.test(run.out), 'mismatch summary line');
  ok(/missing mobs \(32\): .*1210100 Pig/.test(run.out), 'missing mobs list');
  ok(/--- Snail \(100100\) stand\/0 24x20 ---\n\s+=+/.test(run.out), 'ASCII preview of the Snail');
  ok(/--- Magic Claw icon 32x32 ---/.test(run.out), 'ASCII preview of the Magic Claw icon');
  ok(/totals: mobs 4\/36 .*bgm run=bgm\/run.mp3 title=bgm\/title.mp3/.test(run.out), 'totals line');
  ok(/first bytes 49 44 33/.test(run.out) && /ID3 tag/.test(run.out) && /MPEG frame sync/.test(run.out), 'bgm sniff is logged');

  // ---- avatar (Character.wz / Base.wz) ---------------------------------------------------------------------------
  const av = m.avatar!;
  ok(!!av, 'manifest has the avatar block');
  const want = wantedItems();
  for (const slot of ['body', 'head', 'face', 'hair', 'coat', 'pants', 'shoes', 'weapon'] as const) eq(av.items[slot].slice(0, want[slot].length), want[slot], `all ${slot} avatar items extracted (gear items follow them)`);
  ok(av.zmap.indexOf('face') < av.zmap.indexOf('head') && av.zmap.indexOf('head') < av.zmap.indexOf('body'), 'zmap order kept (front-most first)');
  const bodyJson = JSON.parse(readFileSync(join(run.dist, 'maple', 'avatar', 'body-00002000.json'), 'utf8'));
  eq(Object.keys(bodyJson.actions).sort(), ['alert', 'shoot1', 'stabO1', 'stabO2', 'stand1', 'stand2', 'swingO1', 'swingO2', 'swingO3', 'walk1', 'walk2'], 'body actions');
  eq(bodyJson.actions.walk1.length, 4, 'walk1 has 4 frames');
  const l0 = bodyJson.actions.stand1[0].l.find((l: { n: string }) => l.n === 'body');
  eq([l0.z, l0.ox, l0.oy, l0.m.navel, l0.m.neck], ['body', 7, 20, [0, -9], [0, -18]], 'layer z, origin and map points');
  const headJson = JSON.parse(readFileSync(join(run.dist, 'maple', 'avatar', 'head-00012000.json'), 'utf8'));
  eq(headJson.actions.walk1[0].l[0].n, 'head', 'head frames resolve the UOL to front/head');
  const hairJson = JSON.parse(readFileSync(join(run.dist, 'maple', 'avatar', 'hair-00030003.json'), 'utf8'));
  eq(hairJson.actions.default[0].l.map((l: { n: string }) => l.n).sort(), ['hair', 'hairOverHead'], 'hair default layers');
  const ap = decodePng(join(run.dist, 'maple', 'avatar', 'body-00002000.png'));
  ok(ap.w <= 1024 && ap.rgba.some((v, i) => i % 4 === 3 && v > 0), 'avatar atlas PNG has pixels');
  ok(existsSync(join(run.dist, 'maple', 'avatar', 'coat-01041006.png')), 'a coat stored in Longcoat/ is found');
  ok(/maple: avatar: zmap.img has 31 layers, front-most first/.test(run.out), 'zmap log line');
  ok(/avatar: 78\/78 items extracted/.test(run.out), 'avatar totals line');
  ok(/avatar preview Warrior stand1\/0: 11 layers/.test(run.out), 'composite preview log');
  ok(/--- warrior look stand1\/0 \d+x\d+ \(feet at/.test(run.out), 'ASCII preview of the composited character');

  // ---- gear (scripts/fetch-maple-gear.ts) --------------------------------------------------------------------------
  const gear = av.gear!;
  ok(!!gear && gear.iconAtlas === 'avatar/gear-icons.png', 'avatar block has the gear block with an icon atlas');
  const gi = gear.items;
  const ids = Object.keys(gi);
  ok(ids.length > 60 && ids.length <= 320, `gear items extracted (${ids.length})`);
  for (const skip of ['01002999', '01002998', '01002997', '01009998', '01009997', '01009999', '01432000', '01092002']) ok(!(skip in gi), `${skip} (no tuc, event flag, no stats, cash, pirate-only, no walk frames, spear, mage shield) is skipped`);
  eq(gi['01302103'], { slot: 'weapon', name: 'Test Sword 3', level: 30, job: 1, tuc: 7, stats: { pad: 24 }, icon: gi['01302103'].icon }, 'a sword: name from String.wz, level, job, stats from info/inc*');
  eq(gi['01372103'].stats, { mad: 29, int: 3 }, 'wand stats: incMAD and incINT map to mad / int');
  eq(gi['01072103'].stats, { pdd: 5, speed: 3 }, 'boots stats: incPDD, incSPEED');
  eq([gi['01040103'].g, gi['01041103'].g, gi['01060103'].g, gi['01061103'].g], [0, 1, 0, 1], 'gendered coats and pants carry their gender');
  eq(gi['01002003'].g, undefined, 'caps are unisex');
  eq([gi['01052000'].slot, gi['01052000'].long], ['coat', true], 'a Longcoat is a coat slot item marked long');
  ok(Object.values(gi).every((e) => e.slot !== 'shield' || e.job === 1 || e.job === 0), 'shields are warrior (or all-class) only');
  ok(Object.values(gi).every((e) => e.slot !== 'weapon' || [1, 2, 4, 8, 0].includes(e.job)), 'weapons have one class job');
  const perBucket = new Map<string, number>();
  for (const e of Object.values(gi)) if (e.slot === 'weapon' && e.job === 8) perBucket.set(String(Math.floor(e.level / 10)), (perBucket.get(String(Math.floor(e.level / 10))) ?? 0) + 1);
  ok([...perBucket.values()].every((n) => n <= 2), 'at most two thief weapons per level tier');
  for (const slot of ['cap', 'glove', 'cape', 'shield'] as const) ok(av.items[slot].length >= 7 && av.items[slot].every((id) => existsSync(join(run.dist, 'maple', 'avatar', `${slot}-${id}.json`)) && existsSync(join(run.dist, 'maple', 'avatar', `${slot}-${id}.png`))), `${slot} frame files are written and listed in the avatar items`);
  eq(new Set(av.items.weapon).size, av.items.weapon.length, 'no item is listed twice');
  const capFrames = JSON.parse(readFileSync(join(run.dist, 'maple', 'avatar', 'cap-01002003.json'), 'utf8'));
  eq([capFrames.info.vslot, capFrames.actions.stand1[0].l[0].z, capFrames.actions.stand1[0].l[0].m.brow], ['CpH1H5', 'cap', [0, -5]], 'cap frames keep vslot, z and the brow map point');
  const icons = decodePng(join(run.dist, 'maple', 'avatar', 'gear-icons.png'));
  const ic = gi['01302103'].icon!;
  ok(ic.x + ic.w <= icons.w && ic.y + ic.h <= icons.h && ic.w === 32 && icons.px(ic.x + 8, ic.y + 8)[3] > 0, 'the icon rectangle in the atlas holds the item icon');
  ok(/gear: scanned \d+ equip images/.test(run.out) && /gear: vslot values seen: .*CpH1H5/.test(run.out) && /gear: info keys seen: .*incPDD/.test(run.out), 'gear scan logs the info keys and vslots seen');
  ok(/gear: \d+ items extracted \(cap \d+, coat \d+/.test(run.out) && /gear: id \| slot \| name \| reqLevel \| reqJob/.test(run.out) && /gear: 01302103 \| weapon \| Test Sword 3 \| 30 \| 1/.test(run.out), 'gear totals and table are logged');
  ok(/gear preview Warrior stand1\/0: \d+ layers; wearing cap=\d+ .*shield=/.test(run.out) && /gear preview Thief/.test(run.out) && /--- Magician in a tier-3 set/.test(run.out), 'tier-3 set previews are logged for every class');

  // ---- no Character.wz: no avatar block, everything else unchanged -------------------------------------------------
  const fxNo = join(root, 'wz-nochar');
  await writeFixture(fxNo, { character: false });
  const runNo = extract('dist-nochar', fxNo);
  eq(runNo.status, 0, 'extractor exits 0 without Character.wz');
  eq(manifestOf(runNo.dist).avatar, undefined, 'no avatar block without Character.wz');
  ok(/Character.wz not available/.test(runNo.out), 'missing Character.wz is logged');

  // ---- missing Title node: logged with the available names, manifest still valid -------------------------------------
  const fx2 = join(root, 'wz2');
  await writeFixture(fx2, { noTitle: true });
  const run2 = extract('dist2', fx2);
  eq(run2.status, 0, 'extractor exits 0 with a missing bgm node');
  const m2 = manifestOf(run2.dist);
  eq([m2.bgm.run, m2.bgm.title], ['bgm/run.mp3', null], 'missing Title node leaves bgm.title null');
  ok(/bgm title: BgmUI.img has no sound node "Title"; available \(2\): Login, WorldSelect/.test(run2.out), 'available node names are logged');

  // ---- nothing to extract: warns, exits 0, writes no manifest -------------------------------------------------------
  const empty = join(root, 'empty');
  mkdirSync(empty);
  const run3 = extract('dist3', empty);
  eq(run3.status, 0, 'extractor exits 0 with no WZ files');
  ok(!existsSync(join(run3.dist, 'maple', 'manifest.json')), 'no manifest when nothing was extracted');
  ok(/WARN/.test(run3.out) && /placeholder art/.test(run3.out), 'warns and leaves placeholder art');

  // ---- a corrupt WZ must not crash the step -------------------------------------------------------------------------
  const bad = join(root, 'bad');
  mkdirSync(bad);
  const r4 = spawnSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(join(bad, 'Mob.wz'))}, Buffer.from('PKG1garbage'.repeat(10)))`]);
  eq(r4.status, 0, 'wrote corrupt Mob.wz');
  const run4 = extract('dist4', bad);
  eq(run4.status, 0, 'extractor exits 0 on a corrupt WZ');
  ok(/WARN/.test(run4.out), 'corrupt WZ is a warning');

  // ---- audio sniffing and the wanted lists --------------------------------------------------------------------------
  const junk = Buffer.concat([Buffer.alloc(20, 0x11), SYNC_MP3]);
  const sn = sniffAudio(junk);
  ok(sn.data.equals(SYNC_MP3) && /after 20 junk/.test(sn.what), 'leading junk before an MPEG frame is trimmed');
  eq(sniffAudio(Buffer.from('RIFF....WAVE')).ext, 'wav', 'RIFF is written as .wav');
  eq(WANTED_MOBS.length, 36, '30 ladder mobs + 6 bosses are wanted');
  eq(new Set(WANTED_MOBS.map((w) => w.id)).size, 36, 'mob ids are unique');
  console.log(`test-maple: ok (${checks} checks)`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
