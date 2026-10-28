// Run: node --experimental-strip-types scripts/test-sfx.ts
// Sound effect rules that need no audio device: the throttle and the sim-event -> sound mapping.
import assert from 'node:assert/strict';
import { BOSSES, LADDER } from '../src/game/data.ts';
import { Sim } from '../src/game/sim.ts';
import type { SimEvent } from '../src/game/types.ts';
import { VoiceLimiter, playSimEvents } from '../src/maple/sfx.ts';
import type { PlayOpts, SfxLike } from '../src/maple/sfx.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };

// throttle: 45 ms per key, 4 per key, 14 overall, pickup 80 ms
const l = new VoiceLimiter();
ok(l.tryStart('a', 0), 'first play starts');
ok(!l.tryStart('a', 30), 'same key within 45 ms is refused');
ok(l.tryStart('a', 50), 'same key after 45 ms starts');
ok(l.tryStart('a', 100) && l.tryStart('a', 150), 'third and fourth voice');
ok(!l.tryStart('a', 200), 'a fifth voice of one key is refused');
l.end('a');
ok(l.tryStart('a', 250), 'a finished voice frees a slot');
ok(l.tryStart('game.pickup', 1000) && !l.tryStart('game.pickup', 1060) && l.tryStart('game.pickup', 1085), 'pickup interval is 80 ms');
const g = new VoiceLimiter();
let started = 0;
for (let i = 0; i < 30; i++) if (g.tryStart('k' + i, 0)) started++;
eq(started, 14, 'at most 14 voices overall');

// event mapping with a fake player holding some keys
const played: [string, PlayOpts | undefined][] = [];
const have = new Set<string>();
const fake: SfxLike = { has: (k) => have.has(k), play: (k, o) => { played.push([k, o]); } };
const keys = () => played.map((p) => p[0]);
const mob0 = LADDER[0].id, boss0 = BOSSES[0].id;
const ev = (e: SimEvent) => e;

have.add('skill.2001005.use').add('skill.2001005.hit').add(`mob.${mob0}.damage`).add(`mob.${mob0}.die`).add(`mob.${boss0}.die`).add('weapon.warrior.attack');
playSimEvents(fake, [
  ev({ type: 'cast', skill: 'magic_claw', kind: 'bolt', x: 0, y: 0, tx: 0, ty: 0, r: 0, pts: null }),
  ev({ type: 'cast', skill: 'magic_claw', kind: 'bolt', x: 0, y: 0, tx: 0, ty: 0, r: 0, pts: null }),
  ev({ type: 'hit', x: 0, y: 0, amount: 5, crit: false, boss: false, skill: 'magic_claw', tier: 0, bossIdx: -1 }),
  ev({ type: 'hit', x: 0, y: 0, amount: 5, crit: false, boss: false, skill: 'unknown_skill', tier: 0, bossIdx: -1 }),
  ev({ type: 'death', x: 0, y: 0, tier: 0, boss: -1, big: false, facing: 1 }),
  ev({ type: 'death', x: 0, y: 0, tier: 29, boss: 0, big: true, facing: 1 }),
  ev({ type: 'bossSpawn', boss: 0, name: 'x', x: 0, y: 0 }),
  ev({ type: 'levelUp', level: 2 }),
  ev({ type: 'pickup', kind: 0, x: 0, y: 0, value: 1 }),
  ev({ type: 'region', region: 1 }),
], 'warrior');
eq(keys(), ['skill.2001005.use', 'skill.2001005.hit', `mob.${mob0}.damage`, `mob.${mob0}.die`, `mob.${boss0}.die`, `mob.${boss0}.die`, 'game.levelup', 'game.pickup', 'game.portal'], 'bolt volley plays once; hit prefers the skill sound, else the mob damage; boss spawn falls back to die');
eq(played[2][1]?.volume, 0.5, 'hits are quiet');
eq(played[3][1]?.volume, 0.6, 'deaths at 0.6');
eq(played[5][1]?.volume, 1, 'boss sounds are loud');
played.length = 0;
playSimEvents(fake, [ev({ type: 'cast', skill: 'power_strike', kind: 'melee', x: 0, y: 0, tx: 0, ty: 0, r: 1, pts: null })], 'warrior');
eq(keys(), ['weapon.warrior.attack'], 'a melee skill without a use sound falls back to the class weapon sound');

// the sim fires 'region' at each boss time, carries tier on hits, and exposes the region
const sim = new Sim(7);
sim.god = true;
const seen: number[] = [];
for (let i = 0; i < 60 * 300; i++) {
  sim.tick(1 / 60);
  for (const e of sim.events) if (e.type === 'region') seen.push(e.region);
  sim.events.length = 0;
  if (sim.offer) sim.pick(0);
}
eq(seen, [1, 2], 'region events at 2:15 and 4:30');
eq(sim.region, 2, 'sim.region follows run time');
eq(sim.snapshot().region, 2, 'snapshot carries the region');

console.log(`test-sfx: ok (${checks} checks)`);
