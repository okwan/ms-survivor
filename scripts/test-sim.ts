// Run: node --experimental-strip-types scripts/test-sim.ts
import { Sim } from '../src/game/sim.ts';
import { EVOLUTION_PASSIVE_SLOTS, partnerSlotOpen } from '../src/game/evolutions.ts';
import { botInput, botPick } from '../src/game/bot.ts';
import { BASE_ENEMY_SPEED, BOSSES, BOSS_COMPANION_HP, BOSS_EVERY, BOSS_TOTAL, BOSS_WAVES, CLASSES, enemyDmgMult, enemyHpMult, ENEMY_SPEED_CAP, MASTERIES, MASTERY_BY_KEY, SKILL_MASTERY_PER, enemySpeed, masteryMax, mobSpeedFactor, progress, SPAWN_RING_MAX, SPAWN_RING_MIN, LEVEL_HP, LEVEL_HP_CAP, levelDamageMult, CLASS_BY_KEY, JOBS, JOB_BY_CODE, MAX_ALIVE, MAX_PASSIVES, MAX_SKILLS, PASSIVES, SKILLS, aliveTarget, jobOfId, poolLo, xpToNext, LADDER } from '../src/game/data.ts';

let failed = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg);
}
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} (got ${a}, want ${b})`);
const near0 = (a: number | undefined, b: number, msg: string) => ok(a !== undefined && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg} (got ${a}, want ${b})`);
const near = near0;

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
  ok(lvl10 >= 45 && lvl10 <= 240, `level 10 between 45 and 240 s (${lvl10.toFixed(1)})`);
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
  while (!sim.over && (sim.level < 72 || sim.offer || sim.pendingLevels > 0) && ticks < 900 * 60) {
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
  ok(sim.skills.length <= MAX_SKILLS && sim.passives.length <= MAX_PASSIVES + EVOLUTION_PASSIVE_SLOTS, `${label}: at most ${MAX_SKILLS} skills and ${MAX_PASSIVES} passives (+${EVOLUTION_PASSIVE_SLOTS} for an evolution partner)`);
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

// ---- endless upgrades: Mastery cards ----
console.log('-- masteries');
/** a hero with every skill and passive of its unlocked jobs at max level and all slots full: nothing is left to offer */
function maxedSim(clsKey: string, seed = 31) {
  const c = CLASS_BY_KEY[clsKey];
  const s = new Sim(seed, clsKey);
  s.branch = c.branches[0];
  s.jobs = [c.firstJob, c.branches[0], c.branches[0] + 1];
  s.level = 80;
  s.skills = [];
  for (const k of c.skills) {
    const d = SKILLS.find((x) => x.key === k)!;
    if (s.jobs.includes(jobOfId(d.id)) && s.skills.length < MAX_SKILLS) s.skills.push({ key: k, level: 8, cd: 0 });
  }
  for (const p of PASSIVES) if (JOB_BY_CODE[jobOfId(p.id)]?.cls === clsKey && s.jobs.includes(jobOfId(p.id)) && s.passives.length < MAX_PASSIVES) s.passives.push({ key: p.key, level: 5 });
  // and the extra slot a recipe partner may take, so nothing at all is left to offer
  for (const p of PASSIVES) if (!s.passives.some((o) => o.key === p.key) && partnerSlotOpen(s, p.key, MAX_PASSIVES)) s.passives.push({ key: p.key, level: 5 });
  s.recalc();
  return s;
}
for (const c of CLASSES) {
  const s = maxedSim(c.key);
  let masteryCards = 0, offers = 0, fillers = 0;
  for (let i = 0; i < 40; i++) {
    s.pendingLevels = 1;
    s.tick();
    ok(s.offer !== null && s.offer.length >= 1, `${c.name}: level-up ${i + 1} after maxing everything still offers cards`);
    const o = s.offer!;
    if (o.some((x) => x.kind === 'mastery')) masteryCards++;
    fillers += o.filter((x) => x.kind === 'elixir' || x.kind === 'meso').length;
    ok(o.every((x) => x.kind === 'mastery' || x.kind === 'elixir' || x.kind === 'meso'), `${c.name}: only Mastery or filler cards when everything is maxed`);
    ok(new Set(o.map((x) => x.key)).size === o.length, `${c.name}: no duplicate cards in an offer`);
    ok(o.filter((x) => x.kind === 'mastery').every((x) => !!x.icon && s.skills.some((sk) => sk.key === x.icon)), `${c.name}: Mastery cards borrow an owned skill's icon`);
    offers++;
    s.pick(botPick(s));
  }
  ok(masteryCards === offers, `${c.name}: all ${offers} offers after maxing contained a Mastery card`);
  ok(fillers < offers * 0.9, `${c.name}: elixir / meso fillers are the exception (${fillers} in ${offers} offers)`);
  ok(s.maxHp > 0 && s.might > 1, `${c.name}: masteries kept the hero growing`);
}
{
  const s = maxedSim('warrior', 7);
  const card = (key: string) => ({ kind: 'mastery' as const, key, name: key, isNew: false, from: 0, to: 1, desc: '' });
  const m0 = s.might, hp0 = s.maxHp, sp0 = s.speed, cr0 = s.crit, ha0 = s.haste, ar0 = s.area, mg0 = s.magnet;
  s.offer = [card('mastery')]; s.pick(0);
  near(s.might - m0, 0.08 * levelDamageMult(s.level), 'Mastery adds +8% damage on the base (before the level multiplier)');
  s.hp = s.maxHp * 0.4;
  const before = s.hp;
  s.offer = [card('vitality')]; s.pick(0);
  near(s.maxHp - hp0, 0.1 * (s.cls.hp + LEVEL_HP * (Math.min(s.level, LEVEL_HP_CAP) - 1)), 'Vitality adds +10% max HP');
  ok(s.hp > before + 0.2 * s.maxHp, 'Vitality heals about 25% of max HP');
  for (let i = 0; i < 14; i++) { s.offer = [card('swiftness')]; s.pick(0); }
  near(s.speed / sp0, 1.4, 'Swiftness stops at +40% move speed');
  for (let i = 0; i < 30; i++) { s.offer = [card('focus')]; s.pick(0); s.offer = [card('haste')]; s.pick(0); }
  near(s.crit - cr0, 0.6, 'Focus stops at +60% crit');
  near(s.haste - ha0, 0.4, 'Haste stops at +40% cooldown speed');
  s.offer = [card('reach')]; s.pick(0); s.offer = [card('magnet')]; s.pick(0);
  near(s.area - ar0, 0.06, 'Reach +6% area'); near(s.magnet / mg0, 1.1, 'Magnet +10% pickup range');
  ok(masteryMax(MASTERY_BY_KEY.swiftness) === 10 && masteryMax(MASTERY_BY_KEY.focus) === 20 && masteryMax(MASTERY_BY_KEY.haste) === 10 && masteryMax(MASTERY_BY_KEY.mastery) === Infinity, 'cap stacks: swiftness 10, focus 20, haste 10, the rest uncapped');
  // capped masteries are no longer offered; the others always are
  s.pendingLevels = 1; s.tick();
  ok(s.offer!.every((x) => !['swiftness', 'focus', 'haste'].includes(x.key)), 'capped Masteries drop out of the offers');
  s.offer = null;
  // Skill Mastery: +10% damage for one skill only, stacking
  const sk = s.skills[0].key, other = s.skills[1].key;
  const e = { x: 1, y: 0, hp: 1e9, maxHp: 1e9, speed: 0, dmg: 0, r: 0.6, xp: 0, tier: 0, boss: -1, big: false, add: false, alive: true, hitCd: 9, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, lastHit: -99, facing: 1, phase: 0, moving: false, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1 };
  s.enemies.push(e);
  s.crit = 0;
  const dmg = (k: string) => { const h = e.hp; s.curSkill = k; s.hit(e, 1000); return h - e.hp; };
  const d0 = dmg(sk), o0 = dmg(other);
  s.offer = [{ kind: 'mastery', key: 'skill_mastery:' + sk, icon: sk, name: 'Skill Mastery', isNew: false, from: 0, to: 1, desc: '' }]; s.pick(0);
  s.offer = [{ kind: 'mastery', key: 'skill_mastery:' + sk, icon: sk, name: 'Skill Mastery', isNew: false, from: 1, to: 2, desc: '' }]; s.pick(0);
  ok(Math.abs(dmg(sk) / d0 - (1 + 2 * SKILL_MASTERY_PER)) < 0.01, `Skill Mastery x2 gives +20% to ${sk} (${dmg(sk)} vs ${d0})`);
  ok(Math.abs(dmg(other) / o0 - 1) < 0.01, 'other skills are unchanged');
  ok(s.offer === null && s.maxHp > 0, 'state stays valid');
  // banishing a Mastery is refused; rerolls still work
  s.pendingLevels = 1; s.tick();
  const b = s.banishes;
  ok(s.offer!.every((_, i) => !s.banish(i)) && s.banishes === b, 'Mastery cards cannot be banished');
  ok(s.reroll() && s.offer!.some((x) => x.kind === 'mastery'), 'rerolling a Mastery offer gives Mastery cards again');
}
{
  // a partly maxed hero (one card left to upgrade) gets that card plus Masteries
  const s = maxedSim('magician', 12);
  s.skills[0].level = 7;
  s.pendingLevels = 1; s.tick();
  const o = s.offer!;
  ok(o.length === 3 && o.some((x) => x.kind === 'skill') && o.some((x) => x.kind === 'mastery'), 'a short pool is topped up with Masteries');
}
{
  const s = new Sim(3, 'thief');
  s.offer = [
    { kind: 'mastery', key: 'mastery', icon: 'lucky_seven', name: 'Mastery', isNew: false, from: 0, to: 1, desc: '' },
    { kind: 'skill', key: 'double_stab', name: 'Double Stab', isNew: true, from: 0, to: 1, desc: '' },
    { kind: 'elixir', key: 'elixir', name: 'Elixir', isNew: false, from: 0, to: 0, desc: '' },
  ];
  eq(botPick(s), 1, 'the bot takes a skill over a Mastery and an Elixir');
  s.offer = [{ ...s.offer[2] }, { ...s.offer[0] }];
  eq(botPick(s), 1, 'the bot takes a Mastery over an Elixir at full HP');
}

// ---- real mob speeds ----
console.log('-- mob speeds');
{
  near0(mobSpeedFactor({ speed: 0 }), 1, 'speed 0 -> normal');
  near0(mobSpeedFactor({ speed: -50 }), 0.5, 'speed -50 -> half');
  near0(mobSpeedFactor({ speed: 20 }), 1.2, 'speed +20 -> 1.2x');
  near0(mobSpeedFactor({ speed: -100 }), 0.3, 'speed -100 floors at 0.3');
  near0(mobSpeedFactor({ speed: 900 }), 2, 'huge speed is clamped to 2');
  near0(mobSpeedFactor({ speed: -30, flySpeed: 40 }, true), 1.4, 'a flyer reads flySpeed');
  near0(mobSpeedFactor({ speed: -30, flySpeed: 40 }, false), 0.7, 'a walker reads speed');
  near0(mobSpeedFactor({ fs: 1.3 }), 1.3, 'fs is a float multiplier when there is no offset');
  eq(mobSpeedFactor({}), undefined, 'no speed data -> undefined (hand-tuned speed stays)');
  eq(enemySpeed(4, undefined, 7), 4, 'no factor: the hand-tuned speed');
  near0(enemySpeed(4, 0.5, 7), BASE_ENEMY_SPEED * 0.5, 'factor: BASE_ENEMY_SPEED x factor');
  near0(enemySpeed(4, 2, 7), ENEMY_SPEED_CAP * 7, 'clamped to 95% of the hero base speed');
  const ids = [LADDER[0].id, LADDER[1].id, LADDER[2].id];
  const s = new Sim(5, 'warrior', { mobSpeeds: { [ids[0]]: 0.3, [ids[1]]: 2 } });
  s.god = true;
  const seen: Record<number, number> = {};
  for (let i = 0; i < 60 * 12; i++) { s.tick(); for (const e of s.enemies) if (e.boss < 0 && !e.add) seen[e.tier] = e.speed; if (seen[0] !== undefined && seen[1] !== undefined && seen[2] !== undefined) break; }
  near0(seen[0], BASE_ENEMY_SPEED * 0.3, 'Snail speed comes from the table');
  near0(seen[1], ENEMY_SPEED_CAP * CLASS_BY_KEY.warrior.speed, 'a too-fast mob is clamped below the hero speed');
  eq(seen[2], LADDER[2].speed, 'a mob missing from the table keeps its hand-tuned speed');
  const d = new Sim(5, 'warrior');
  d.god = true;
  for (let i = 0; i < 60 * 4; i++) d.tick();
  ok(d.enemies.filter((e) => e.boss < 0).every((e) => e.speed === LADDER[e.tier].speed), 'no table: every enemy keeps its hand-tuned speed');
  const bs = new Sim(5, 'warrior', { mobSpeeds: { [BOSSES[0].id]: 0.5 } });
  bs.god = true;
  bs.t = BOSS_EVERY - 0.01;
  bs.tick();
  near0(bs.enemies.find((e) => e.boss === 0)!.speed, BASE_ENEMY_SPEED * 0.5, 'bosses use the table too when it has them');
}

// ---- boss waves ----
console.log('-- boss waves');
{
  eq(BOSS_WAVES.join(), '1,1,2,2,3,3', 'waves are 1,1,2,2,3,3');
  eq(BOSS_TOTAL, 12, 'twelve bosses in a full run');
  const s = new Sim(8, 'warrior');
  s.god = true;
  for (let n = 0; n < 6; n++) {
    s.enemies.length = 0;
    s.t = BOSS_EVERY * (n + 1) - 0.01;
    s.events.length = 0;
    s.tick();
    const bosses = s.enemies.filter((e) => e.boss >= 0);
    eq(bosses.length, BOSS_WAVES[n], `wave ${n + 1} brings ${BOSS_WAVES[n]} boss(es)`);
    eq(bosses.map((e) => e.boss).sort().join(), Array.from({ length: BOSS_WAVES[n] }, (_, k) => n - k).sort().join(), `wave ${n + 1}: the scheduled boss plus the ones just below it`);
    const main = bosses.find((e) => e.boss === n)!;
    const p = progress(s.t);
    near0(main.maxHp, BOSSES[n].hp * enemyHpMult(p), `wave ${n + 1}: the scheduled boss has full HP`);
    for (const c of bosses.filter((e) => e !== main)) near0(c.maxHp, BOSSES[c.boss].hp * enemyHpMult(p) * BOSS_COMPANION_HP, `wave ${n + 1}: ${BOSSES[c.boss].name} companion at 70% HP`);
    ok(bosses.every((e) => { const d = Math.hypot(e.x - s.px, e.y - s.py); return d >= SPAWN_RING_MIN - 0.5 && d <= SPAWN_RING_MAX + 0.5; }), `wave ${n + 1}: bosses stand on the screen-edge ring`);
    if (bosses.length > 1) {
      const angs = bosses.map((e) => Math.atan2(e.y - s.py, e.x - s.px));
      let minGap = 9;
      for (let i = 0; i < angs.length; i++) for (let j = i + 1; j < angs.length; j++) { let d = Math.abs(angs[i] - angs[j]); d = Math.min(d, 2 * Math.PI - d); minGap = Math.min(minGap, d); }
      ok(minGap > 1.0, `wave ${n + 1}: the bosses are spread around the ring (min gap ${minGap.toFixed(2)} rad)`);
    }
    eq(s.events.filter((e) => e.type === 'bossSpawn').length, BOSS_WAVES[n], `wave ${n + 1}: one bossSpawn event per boss`);
    eq(s.activeBosses().length, Math.min(3, BOSS_WAVES[n]), `wave ${n + 1}: the HUD gets up to three bars`);
    ok(n < 2 || s.raidText.startsWith('Boss wave!'), `wave ${n + 1}: "Boss wave!" banner`);
  }
  eq(s.bossesSpawned, 6, 'six waves on the clock');
}

// normal run: informational
run('normal run', false, 777);

console.log(failed === 0 ? 'ALL OK' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
