// Run: node --experimental-strip-types scripts/test-sim.ts
import { Sim } from '../src/game/sim.ts';
import { botInput } from '../src/game/bot.ts';
import { BOSSES, BOSS_EVERY, MAX_ALIVE, aliveTarget, poolLo, xpToNext, LADDER } from '../src/game/data.ts';

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

function run(label: string, god: boolean, seed: number) {
  console.log(`-- ${label} (seed ${seed}, god=${god})`);
  const sim = new Sim(seed);
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
// normal run: informational
run('normal run', false, 777);

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
