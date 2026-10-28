// Run: node --experimental-strip-types scripts/test-runsave.ts
import { Sim } from '../src/game/sim.ts';
import { botInput } from '../src/game/bot.ts';
import { captureRun, restoreRun, sanitizeRunSave } from '../src/game/runsave.ts';
import { BOSS_EVERY, RUN_LENGTH } from '../src/game/data.ts';
import { GEAR_SLOTS } from '../src/game/gear.ts';

let failed = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg);
}

function advance(sim: Sim, until: number) {
  while (!sim.over && sim.t < until) {
    if (sim.offer) { sim.pick(0); continue; }
    const b = botInput(sim);
    sim.setInput(b.x, b.y);
    sim.tick();
    if (sim.events.length > 4000) sim.events.length = 0;
  }
  sim.events.length = 0;
}

const gearIds = (s: Sim) => GEAR_SLOTS.map((k) => s.equipped[k]?.id ?? '-').join(',');
const upSig = (s: Sim) => GEAR_SLOTS.map((k) => JSON.stringify(s.equipped[k]?.up ?? null)).join('|');

for (const cls of ['warrior', 'magician']) {
  console.log(`-- ${cls}: capture / restore`);
  const a = new Sim(7, cls);
  a.god = true;
  advance(a, 300);
  const raw = captureRun(a);
  const data = sanitizeRunSave(JSON.parse(JSON.stringify(raw)));
  ok(data !== null, 'round-trip sanitizes');
  const b = new Sim(7, cls);
  ok(restoreRun(b, data!), 'restoreRun accepts');
  ok(b.level === a.level && b.level > 5, `level ${b.level}`);
  ok(Math.abs(b.xp - a.xp) < 1e-9 && b.xpNeed === a.xpNeed, 'xp');
  ok(JSON.stringify(b.skills.map((s) => [s.key, s.level])) === JSON.stringify(a.skills.map((s) => [s.key, s.level])), 'skills');
  ok(JSON.stringify(b.passives) === JSON.stringify(a.passives), 'passives');
  ok(gearIds(b) === gearIds(a) && upSig(b) === upSig(a), `gear ${gearIds(b)}`);
  ok(JSON.stringify(b.jobs) === JSON.stringify(a.jobs) && b.branch === a.branch, `jobs ${b.jobs}`);
  ok(b.t === a.t && b.mesos === a.mesos && b.kills === a.kills && b.region === a.region, 't/mesos/kills/region');
  ok(JSON.stringify(b.masteryLv) === JSON.stringify(a.masteryLv) && JSON.stringify(b.skillMastery) === JSON.stringify(a.skillMastery), 'masteries');
  ok(b.bag.map((i) => i.id).join() === a.bag.map((i) => i.id).join() && b.reviveUsed === a.reviveUsed && b.mesoCarry === a.mesoCarry, `bag ${b.bag.length}, revive, carry`);
  ok(JSON.stringify(b.swarms.started) === JSON.stringify(a.swarms.started) && b.swarms.nextAt === a.swarms.nextAt && b.elites.killed === a.elites.killed && b.elites.nextAt === a.elites.nextAt && b.field.nextBox === a.field.nextBox, 'event schedules');
  ok(b.rerolls === a.rerolls && b.banishes === a.banishes && [...b.banished].join() === [...a.banished].join(), 'rerolls/banishes');
  ok(Math.abs(b.maxHp - a.maxHp) < 1e-6 && Math.abs(b.might - a.might) < 1e-9 && b.hp <= b.maxHp, 'derived stats match');
  b.god = true;
  advance(b, 330);
  ok(!b.over && b.t >= 330, 'resumed sim ticks on');
}

console.log('-- boss respawn');
{
  const a = new Sim(3, 'warrior');
  a.god = true;
  advance(a, BOSS_EVERY + 5);
  ok(a.bossesSpawned === 1 && a.activeBoss() !== null, 'boss 0 is alive');
  const data = sanitizeRunSave(JSON.parse(JSON.stringify(captureRun(a))))!;
  ok(data.bossesSpawned === 0, 'uncleared wave saved as not spawned');
  const b = new Sim(3, 'warrior');
  restoreRun(b, data);
  b.god = true;
  advance(b, b.t + 1);
  ok(b.bossesSpawned === 1 && b.activeBoss()?.boss === 0, 'boss 0 respawns on resume');
  ok(b.bossKills === a.bossKills, 'no extra boss rewards');
  // a cleared wave stays cleared
  for (const e of a.enemies) if (e.boss >= 0) e.alive = false;
  ok(captureRun(a).bossesSpawned === 1, 'cleared wave stays cleared');
}

console.log('-- sanitize');
{
  const good = JSON.parse(JSON.stringify(captureRun(new Sim(1, 'thief'))));
  ok(sanitizeRunSave(good) !== null, 'fresh run save is valid');
  for (const g of [null, undefined, 5, 'x', [], {}, { v: 2 }, { ...good, cls: 'nope' }, { ...good, t: -1 }, { ...good, t: RUN_LENGTH }, { ...good, t: 'a' }, { ...good, v: 0 }]) {
    ok(sanitizeRunSave(g) === null, `rejects ${JSON.stringify(g)?.slice(0, 40)}`);
  }
  const bad = sanitizeRunSave({
    ...good, level: 1e12, xp: -5, hp: NaN, mesos: -3, rerolls: 1e9, bossesSpawned: 99, skills: [{ key: 'bogus', level: 3 }, { key: good.skills[0].key, level: 99 }],
    passives: [{ key: 'bogus', level: 1 }], equipped: { cap: { id: 5 }, coat: { id: 'zzz', up: { plus: 1e9, left: -4, stats: { pad: 1e9, evil: 3 } } } }, banished: ['x', 5],
  })!;
  ok(bad.level === 999 && bad.xp === 0 && bad.hp === 1 && bad.mesos === 0 && bad.rerolls === 99 && bad.bossesSpawned === 0, 'numbers clamped');
  ok(bad.skills.length === 1 && bad.skills[0].level === 8 && bad.passives.length === 0, 'unknown keys dropped, levels clamped');
  ok(!bad.equipped.cap && bad.equipped.coat?.up?.plus === 50 && bad.equipped.coat.up.stats.pad === 1000 && bad.banished.length === 0, 'gear fields clamped');
  const w = new Sim(1, 'warrior');
  ok(!restoreRun(w, good), 'wrong class refuses to restore');
  const c = new Sim(1, 'thief');
  restoreRun(c, bad);
  ok(c.hp <= c.maxHp && c.hp >= 1 && !c.equipped.coat, 'unknown gear id dropped, hp clamped');
}

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('runsave: all ok');
