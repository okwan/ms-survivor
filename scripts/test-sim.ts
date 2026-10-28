// Run: node --experimental-strip-types scripts/test-sim.ts
import { Sim } from '../src/game/sim.ts';
import { botInput } from '../src/game/bot.ts';
import { BOSSES, BOSS_EVERY, CLASSES, CLASS_BY_KEY, JOBS, JOB_BY_CODE, MAX_ALIVE, MAX_PASSIVES, MAX_SKILLS, PASSIVES, SKILLS, aliveTarget, jobOfId, poolLo, xpToNext, LADDER } from '../src/game/data.ts';

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
ok(new Set(SKILLS.map((s) => s.key)).size === SKILLS.length && new Set(PASSIVES.map((p) => p.key)).size === PASSIVES.length, 'skill keys and passive keys are unique');
{
  const ids = [...SKILLS.map((s) => s.id), ...PASSIVES.map((p) => p.id)];
  ok(new Set(ids).size === ids.length, 'skill and passive ids are unique');
  ok(!SKILLS.some((s) => s.key === 'chain_lightning'), 'no 4th-job skills');
  ok([...SKILLS.map((s) => s.id), ...PASSIVES.map((p) => p.id)].every((id) => JOB_BY_CODE[jobOfId(id)] !== undefined), 'every skill and passive belongs to a job');
  ok(JOBS.every((j) => j.sig.every((k) => SKILLS.some((s) => s.key === k) || PASSIVES.some((p) => p.key === k))), 'job signature keys exist');
}
for (const c of CLASSES) {
  ok(c.skills.length >= 8, `${c.name} has ${c.skills.length} skills`);
  ok(c.skills.every((k) => SKILLS.some((s) => s.key === k)), `${c.name} skill keys exist`);
  const own = (id: number) => JOB_BY_CODE[jobOfId(id)]?.cls === c.key;
  ok(c.skills.every((k) => own(SKILLS.find((s) => s.key === k)!.id)), `${c.name} skills belong to ${c.name} jobs`);
  ok(c.branches.every((b) => JOB_BY_CODE[b]?.tier === 2 && JOB_BY_CODE[b + 1]?.tier === 3 && JOB_BY_CODE[b].cls === c.key), `${c.name} branches have a 2nd and a 3rd job`);
  const s0 = new Sim(1, c.key);
  eq(s0.maxHp, c.hp, `${c.name} base HP`); eq(s0.speed, c.speed, `${c.name} base speed`); eq(s0.skills[0].key, c.skills[0], `${c.name} starts with ${c.skills[0]}`);
}
// job advancement: every class and branch, god-mode bot, picks the card chosen below
function jobRun(clsKey: string, branchIdx: number) {
  const c = CLASS_BY_KEY[clsKey];
  const sim = new Sim(99, clsKey);
  sim.god = true;
  const seen: Record<string, Set<number>> = { pre: new Set(), mid: new Set(), post: new Set() };
  let t30 = -1, t70 = -1, jobOffers = 0, advances = 0, jobOfferLevel = 0;
  const jobsSeen: string[] = [];
  let ticks = 0;
  while (!sim.over && sim.level < 72 && ticks < 900 * 60) {
    if (sim.offer) {
      const job = sim.offer[0].kind === 'job';
      if (job) { jobOffers++; jobOfferLevel = sim.level; eq(sim.offer.map((x) => x.key).join(), c.branches.join(), `${c.name}: job offer lists the class's 2nd jobs`); }
      else {
        const phase = sim.level < 30 ? 'pre' : sim.level < 70 ? 'mid' : 'post';
        for (const x of sim.offer) if (x.kind === 'skill' || x.kind === 'passive') seen[phase].add(jobOfId((x.kind === 'skill' ? SKILLS.find((s) => s.key === x.key)! : PASSIVES.find((p) => p.key === x.key)!).id));
      }
      sim.pick(job ? branchIdx : 0);
      continue;
    }
    const inp = botInput(sim, 1);
    sim.setInput(inp.x, inp.y);
    sim.tick();
    ticks++;
    if (t30 < 0 && sim.level >= 30) t30 = sim.t;
    if (t70 < 0 && sim.level >= 70) t70 = sim.t;
    for (const e of sim.events) if (e.type === 'jobAdvance') { advances++; jobsSeen.push(e.name); }
    sim.events.length = 0;
  }
  const b = c.branches[branchIdx];
  const label = `${c.name} -> ${JOB_BY_CODE[b].name}`;
  ok(sim.skills.length <= MAX_SKILLS && sim.passives.length <= MAX_PASSIVES, `${label}: at most ${MAX_SKILLS} skills and ${MAX_PASSIVES} passives`);
  ok(t30 > 0 && t70 > 0, `${label}: reached level 30 (${t30.toFixed(0)} s) and 70 (${t70.toFixed(0)} s)`);
  eq(jobOffers, 1, `${label}: one job choice`);
  eq(jobOfferLevel, 30, `${label}: job choice at level 30`);
  eq(jobsSeen.join(' > '), `${JOB_BY_CODE[b].name} > ${JOB_BY_CODE[b + 1].name}`, `${label}: 2nd then 3rd job advancement events`);
  eq(sim.jobs.join(), [c.firstJob, b, b + 1].join(), `${label}: unlocked jobs`);
  ok([...seen.pre].every((j) => j === c.firstJob), `${label}: only 1st-job cards before level 30 (${[...seen.pre]})`);
  ok([...seen.mid].every((j) => j === c.firstJob || j === b) && seen.mid.has(b), `${label}: only 1st job and ${b} cards from 30 to 69 (${[...seen.mid]})`);
  ok([...seen.post].every((j) => j === c.firstJob || j === b || j === b + 1) && seen.post.has(b + 1), `${label}: 3rd job cards join at 70 (${[...seen.post]})`);
  ok(sim.skills.every((s) => c.skills.includes(s.key)) && sim.passives.every((p) => JOB_BY_CODE[jobOfId(PASSIVES.find((q) => q.key === p.key)!.id)].cls === c.key), `${label}: no card of another class owned`);
}
console.log('-- job advancement');
for (const c of CLASSES) for (let i = 0; i < c.branches.length; i++) jobRun(c.key, i);
{
  // effects: stun stops contact hits, root stops movement, drain heals (capped), weaken lowers damage
  const w = new Sim(5, 'warrior');
  w.recalc();
  const spawn = (x: number) => {
    const e = { x, y: 0, hp: 1e6, maxHp: 1e6, speed: 4, dmg: 10, r: 0.6, xp: 1, tier: 0, boss: -1, big: false, add: false, alive: true, hitCd: 0, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, lastHit: -99, facing: 1, phase: 0, moving: true, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1 };
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
  eq(e2.lastHit, t.t, 'a hit stamps lastHit (HP bar shows for 3 s)');
  t.curSkill = 'steal';
  const mesos0 = t.pickups.length;
  for (let i = 0; i < 100; i++) t.hit(e2, 1);
  ok(t.pickups.length > mesos0, 'steal sometimes drops mesos');
  // Heal: the nova heals the hero
  const m = new Sim(8, 'magician');
  m.jobs.push(230);
  m.skills.push({ key: 'heal', level: 1, cd: 0 });
  m.hp = 50;
  m.enemies.push({ ...e1, x: 2, stunT: 0 });
  m.tick();
  ok(m.hp > 50, 'heal restores hero HP when it fires');
  t.curSkill = 'panic';
  t.hit(e2, 1);
  ok(e2.weakT > 3.9, 'panic weakens');
}

// normal run: informational
run('normal run', false, 777);

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
