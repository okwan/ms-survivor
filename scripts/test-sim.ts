// Run: node --experimental-strip-types scripts/test-sim.ts
import { Sim } from '../src/game/sim.ts';
import { botInput } from '../src/game/bot.ts';
import { BOSSES, BOSS_EVERY, CLASSES, CLASS_BY_KEY, MAX_ALIVE, PASSIVES, SKILLS, aliveTarget, poolLo, xpToNext, LADDER } from '../src/game/data.ts';

let failed = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg);
}
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} (got ${a}, want ${b})`);

console.log('-- data checks');
eq(xpToNext(1), 5, 'xp L1'); eq(xpToNext(2), 15, 'xp L2'); eq(xpToNext(19), 185, 'xp L19');
eq(xpToNext(20), 195, 'xp L20'); eq(xpToNext(39), 195 + 13 * 19, 'xp L39'); eq(xpToNext(40), 455, 'xp L40'); eq(xpToNext(50), 455 + 160, 'xp L50');
eq(LADDER.length, 30, 'ladder has 30 tiers');
eq(poolLo(0), 0, 'pool lo @0s'); eq(poolLo(30), 0, 'pool lo @30s (step 1)'); eq(poolLo(60), 1, 'pool lo @60s (step 2)');
eq(poolLo(450), 14, 'pool lo @450s (step 15)'); eq(poolLo(870), 27, 'pool lo @870s'); eq(poolLo(900), 27, 'pool lo @900s (tiers 27-29)');
eq(aliveTarget(0), 14, 'alive target @0'); eq(aliveTarget(450), 126, 'alive target @450'); eq(aliveTarget(900), 220, 'alive target @900 capped');
eq(LADDER[11].hp, 70, 'peak hp: Octopus reads Dark Stump peak');

const lvlTimes: Record<string, number> = {};
function run(label: string, god: boolean, seed: number, cls = 'magician') {
  console.log(`-- ${label} (${cls}, seed ${seed}, god=${god})`);
  const sim = new Sim(seed, cls);
  sim.god = god;
  let lvl10 = -1;
  let maxAlive = 0, maxNonAdd = 0;
  const bossAt: number[] = [];
  const t0 = performance.now();
  let lastWall = t0;
  let nextPrint = 60;
  let ticks = 0;
  const seenBoss = new Set<number>();
  while (!sim.over && ticks < 900 * 60 + 10) {
    if (sim.offer) { sim.pick(0); continue; } // autopick
    const inp = botInput(sim, 1);
    sim.setInput(inp.x, inp.y);
    sim.tick();
    ticks++;
    if (lvl10 < 0 && sim.level >= 10) lvl10 = sim.t;
    let na = 0;
    for (const e of sim.enemies) { if (!e.add && e.boss < 0) na++; if (e.boss >= 0 && !seenBoss.has(e.boss)) { seenBoss.add(e.boss); bossAt[e.boss] = sim.t; } }
    if (sim.enemies.length > maxAlive) maxAlive = sim.enemies.length;
    if (na > maxNonAdd) maxNonAdd = na;
    if (ticks % 60 === 0) sim.events.length = 0;
    if (sim.t >= nextPrint) {
      const now = performance.now();
      console.log(`  t=${sim.t.toFixed(0).padStart(3)}s lvl=${sim.level} hp=${sim.hp.toFixed(0)}/${sim.maxHp.toFixed(0)} alive=${sim.enemies.length} kills=${sim.kills} ms/sim-sec=${((now - lastWall) / 60).toFixed(2)}`);
      lastWall = now;
      nextPrint += 60;
    }
  }
  const wall = performance.now() - t0;
  console.log(`  ended t=${sim.t.toFixed(1)} won=${sim.won} level=${sim.level} kills=${sim.kills} mesos=${sim.mesos} bossKills=${sim.bossKills} damageTaken=${sim.damageTaken.toFixed(0)}`);
  console.log(`  perf: ${wall.toFixed(0)} ms wall, ${(wall / Math.max(1, sim.t)).toFixed(2)} ms per simulated second`);
  lvlTimes[cls] = lvl10;
  console.log(`  level 10 reached at ${lvl10.toFixed(1)} s; boss spawns at [${bossAt.map((t) => t.toFixed(2)).join(', ')}]`);
  ok(lvl10 >= 60 && lvl10 <= 240, `level 10 between 60 and 240 s (${lvl10.toFixed(1)})`);
  ok(maxNonAdd <= MAX_ALIVE, `non-add enemies never exceed ${MAX_ALIVE} (max ${maxNonAdd}, total incl. adds ${maxAlive})`);
  return { sim, bossAt };
}

// god run: must win and see all six bosses on schedule
{
  const { sim, bossAt } = run('god run', true, 12345);
  ok(sim.won && sim.over, 'god run reaches 900 s and reports won');
  eq(bossAt.length, 6, 'six bosses spawned');
  for (let i = 0; i < 6; i++) {
    const want = BOSS_EVERY * (i + 1);
    ok(bossAt[i] !== undefined && bossAt[i] >= want && bossAt[i] < want + 0.1, `${BOSSES[i].name} spawned at ${want}s (got ${bossAt[i]?.toFixed(2)})`);
  }
}
// every class: seeded god-mode run must win without exceptions
for (const c of CLASSES) {
  if (c.key === 'magician') continue;
  const { sim, bossAt } = run(`god run ${c.name}`, true, 4242, c.key);
  ok(sim.won && sim.over, `${c.name} god run reaches 900 s and reports won`);
  eq(bossAt.length, 6, `${c.name}: six bosses spawned`);
}
console.log('-- level 10 (god-mode bot runs): ' + CLASSES.map((c) => `${c.name} ${lvlTimes[c.key]?.toFixed(1)} s`).join(', '));
console.log('-- class kits');
eq(CLASSES.length, 4, 'four classes');
for (const c of CLASSES) {
  eq(c.skills.length, 8, `${c.name} has 8 skills`);
  ok(c.skills.every((k) => SKILLS.some((s) => s.key === k)), `${c.name} skill keys exist`);
  ok(PASSIVES.some((p) => p.key === c.statPassive && p.cls === c.key) && PASSIVES.some((p) => p.key === c.armorPassive && p.cls === c.key), `${c.name} has its class-named passives`);
  const s0 = new Sim(1, c.key);
  eq(s0.maxHp, c.hp, `${c.name} base HP`); eq(s0.speed, c.speed, `${c.name} base speed`); eq(s0.skills[0].key, c.skills[0], `${c.name} starts with ${c.skills[0]}`);
  // offers never contain another class's skills or passives
  const keys = new Set<string>();
  for (let i = 0; i < 60; i++) { s0.offer = null; s0.pendingLevels = 1; s0.tick(); for (const cd of s0.offer ?? []) keys.add(cd.key); s0.offer = null; }
  const foreign = [...keys].filter((k) => (SKILLS.find((s) => s.key === k) && !c.skills.includes(k)) || PASSIVES.find((p) => p.key === k && p.cls !== undefined && p.cls !== c.key));
  eq(foreign.length, 0, `${c.name} is only offered its own cards`);
}
{
  // effects: stun stops contact hits, root stops movement, drain heals (capped), weaken lowers damage
  const w = new Sim(5, 'warrior');
  w.recalc();
  const spawn = (x: number) => {
    const e = { x, y: 0, hp: 1e6, maxHp: 1e6, speed: 4, dmg: 10, r: 0.6, xp: 1, tier: 0, boss: -1, big: false, add: false, alive: true, hitCd: 0, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, facing: 1, phase: 0, moving: true, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1 };
    w.enemies.push(e);
    return e;
  };
  const e1 = spawn(1);
  w.curSkill = 'coma';
  w.hit(e1, 5);
  ok(e1.stunT > 0.4, 'coma stuns the target');
  const hp0 = w.hp;
  w.tick();
  eq(w.hp, hp0, 'a stunned enemy deals no contact damage');
  eq(e1.moving, false, 'a stunned enemy does not move');
  const t = new Sim(6, 'thief');
  const e2 = { ...e1, stunT: 0, x: 2 };
  t.enemies.push(e2);
  t.hp = 50;
  t.curSkill = 'drain';
  t.hit(e2, 1000);
  ok(t.hp - 50 > 1.99 && t.hp - 50 <= 2.0001, 'drain heals at most 2 HP per hit');
  t.curSkill = 'shadow_web';
  t.hit(e2, 1);
  ok(e2.rootT > 2.9, 'shadow web roots');
  t.curSkill = 'panic';
  t.hit(e2, 1);
  ok(e2.weakT > 3.9, 'panic weakens');
}

// normal run: informational
run('normal run', false, 777);

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
