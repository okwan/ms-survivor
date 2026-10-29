// Run: node --experimental-strip-types scripts/test-hyper.ts
// Hyper Skills (src/game/hyper.ts): the generated trees, gating, Hyper SP maths, sanitising untrusted data, what the ranks do to the Sim
// (damage, targets, area, cooldown), evolved skills keeping the bonus, and a seeded god-mode bot run that deals more damage with Reinforce.
import assert from 'node:assert/strict';
import { botInput, botPick } from '../src/game/bot.ts';
import { CLASSES, SKILLS, SKILL_BY_KEY, jobOfId, skillCooldown } from '../src/game/data.ts';
import type { ClassKey } from '../src/game/data.ts';
import { RECIPES } from '../src/game/evolutions.ts';
import {
  COOLTIME_PER, HYPER_LEVELS_PER_SP, HYPER_ROW_POINTS, HYPER_SP_CAP, HYPER_TREES, REINFORCE_PER, SPREAD_PER, emptyHyper, hyperAdd, hyperAvailable,
  hyperEarned, hyperGain, hyperLock, hyperMods, hyperReset, hyperSpent, sanitizeHyper,
} from '../src/game/hyper.ts';
import type { HyperClass } from '../src/game/hyper.ts';
import { Sim } from '../src/game/sim.ts';
import type { Enemy } from '../src/game/types.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };
const near = (a: number, b: number, m: string) => { checks++; assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${m} (got ${a}, want ${b})`); };
const enemy = (x: number, y: number): Enemy => ({ x, y, hp: 1e9, maxHp: 1e9, speed: 0, dmg: 0, r: 0.6, xp: 1, tier: 0, boss: -1, lead: false, big: false, add: false, alive: true, hitCd: 9, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, lastHit: -99, facing: 1, phase: 0, moving: false, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1, elite: 0, ev: 0, vx: 0, vy: 0 } as unknown as Enemy);
/** a class's data with `sp` Hyper SP worth of levels and no ranks */
const withSp = (sp: number): HyperClass => ({ levels: sp * HYPER_LEVELS_PER_SP, ranks: {} });
/** buys ranks in the given order, asserting each one is allowed */
function buy(cls: ClassKey, h: HyperClass, keys: string[]): HyperClass {
  for (const k of keys) { const n = hyperAdd(cls, h, k); assert.ok(n, `could not buy ${k}: ${hyperLock(cls, h, k)}`); h = n; }
  return h;
}

// ---- the trees are generated from the skills ----
eq(CLASSES.map((c) => c.key), ['warrior', 'magician', 'bowman', 'thief', 'pirate'], 'five classes');
const shape: Record<string, string> = {};
for (const c of CLASSES) {
  const t = HYPER_TREES[c.key];
  ok(t, `${c.key} has a tree`);
  eq(t.columns.length, 1 + c.branches.length, `${c.key}: the 1st job column plus one per 2nd job branch`);
  eq(t.columns[0].jobs, [c.firstJob], `${c.key}: first column is the 1st job`);
  eq(t.columns.slice(1).map((x) => x.jobs[0]), c.branches, `${c.key}: one column per branch, in order`);
  const colSkills = new Set<string>();
  for (const col of t.columns) {
    for (const n of col.nodes) {
      const d = SKILL_BY_KEY[n.skill];
      ok(d && c.skills.includes(n.skill), `${n.key} maps to a real skill of ${c.key}`);
      ok(col.jobs.includes(jobOfId(d.id)), `${n.key} sits in the column of its job`);
      ok(n.key === `${n.skill}:${n.kind}` && n.name.startsWith(d.name + ' - '), `${n.key} has a stable key and a Maple-style name (${n.name})`);
      ok(n.reqPoints === HYPER_ROW_POINTS * n.row, `${n.key} row gating is 3 x row`);
      colSkills.add(n.skill);
    }
  }
  eq([...colSkills].sort(), [...c.skills].sort(), `${c.key}: every skill of the class is in the tree`);
  eq(t.nodes.length, c.skills.length * 2, `${c.key}: two nodes per skill`);
  eq(new Set(t.nodes.map((n) => n.key)).size, t.nodes.length, `${c.key}: node keys are unique`);
  for (const n of t.nodes) {
    if (n.kind === 'reinforce') eq([n.max, n.slot, n.needs], [3, 0, null], `${n.key}: Reinforce is 3 ranks, first slot, no prerequisite`);
    else eq([n.slot, n.needs], [1, `${n.skill}:reinforce`], `${n.key}: the second node needs Reinforce`);
    if (n.kind === 'extra') eq(n.max, 1, `${n.key}: Extra Target is one rank`);
    if (n.kind === 'spread') ok(n.max === 2 && SKILL_BY_KEY[n.skill].radius > 0, `${n.key}: Spread is two ranks on an area skill`);
    if (n.kind === 'cooltime') eq(n.max, 2, `${n.key}: Cooltime Reduce is two ranks`);
  }
  // no two skills share a cell, rows start at 0 and nothing is unreachable with the SP cap
  const cells = t.nodes.map((n) => `${n.col}/${n.row}/${n.slot}`);
  eq(new Set(cells).size, cells.length, `${c.key}: no two nodes share a grid cell`);
  ok(Math.min(...t.nodes.map((n) => n.row)) === 0 && t.nodes.every((n) => n.reqPoints <= HYPER_SP_CAP), `${c.key}: rows start at 0 and every row is reachable at the SP cap`);
  ok(t.totalRanks > HYPER_SP_CAP * 1.5, `${c.key}: the cap fills well under the whole tree (${HYPER_SP_CAP} of ${t.totalRanks})`);
  shape[c.key] = `${t.columns.map((x) => x.nodes.length).join('+')} nodes, ${t.totalRanks} ranks`;
}
ok(SKILLS.every((s) => HYPER_TREES[CLASSES.find((c) => c.skills.includes(s.key))!.key].byKey[`${s.key}:reinforce`]), 'every skill in data.ts has a Reinforce node');
console.log('  trees:', JSON.stringify(shape));
// the kind picks the second node
const kindOf = (k: string) => HYPER_TREES[CLASSES.find((c) => c.skills.includes(k))!.key].nodes.find((n) => n.skill === k && n.slot === 1)!.kind;
eq([kindOf('magic_claw'), kindOf('explosion'), kindOf('slash_blast'), kindOf('double_stab'), kindOf('power_strike')], ['extra', 'spread', 'spread', 'cooltime', 'spread'], 'multi-target skills get Extra Target, area skills Spread, single hits Cooltime Reduce');

// ---- Hyper SP ----
eq([0, 19, 20, 39, 40, 59, 70, 600, 5000].map(hyperEarned), [0, 0, 1, 1, 2, 2, 3, 30, 30], 'SP: 1 per 20 levels, capped');
eq(hyperEarned(-5), 0, 'negative levels earn nothing');
{
  const g = hyperGain({ levels: 15, ranks: { a: 1 } }, 69);
  eq([g.data.levels, g.sp], [84, 4], 'a 70-level run on 15 banked levels earns 4 SP (84 levels)');
  eq(hyperGain({ levels: 0, ranks: {} }, 0).sp, 0, 'zero levels earn nothing');
  eq(hyperGain({ levels: 0, ranks: {} }, 19).sp, 0, 'a short run earns nothing yet');
  eq(hyperGain(g.data, 15).sp, 0, 'levels carry over between runs');
  eq(hyperGain({ levels: 19, ranks: {} }, 1).sp, 1, 'the carried levels complete an SP');
  eq(hyperGain({ levels: 590, ranks: {} }, 200).sp, 1, 'the last SP below the cap (29 -> 30)');
  eq(hyperGain({ levels: 600, ranks: {} }, 400).sp, 0, 'at the cap nothing more');
}

// ---- buying, gating and reset ----
const T = HYPER_TREES.magician;
const mc = 'magic_claw';
{
  let h = withSp(10);
  eq(hyperAvailable(h), 10, '10 SP to spend');
  ok(hyperLock('magician', h, `${mc}:extra`)!.includes('Reinforce'), 'the second node is locked until Reinforce has a rank');
  eq(hyperAdd('magician', h, `${mc}:extra`), null, 'cannot buy it');
  h = buy('magician', h, [`${mc}:reinforce`, `${mc}:extra`]);
  eq([h.ranks[`${mc}:reinforce`], h.ranks[`${mc}:extra`], hyperSpent(h.ranks), hyperAvailable(h)], [1, 1, 2, 8], 'two ranks bought');
  eq(hyperLock('magician', h, `${mc}:extra`), 'Maxed', 'Extra Target has one rank');
  h = buy('magician', h, [`${mc}:reinforce`, `${mc}:reinforce`]);
  eq(hyperAdd('magician', h, `${mc}:reinforce`), null, 'Reinforce stops at 3');
  // a row-3 node needs 9 points spent
  const row3 = T.nodes.find((n) => n.row === 3 && n.slot === 0)!;
  ok(hyperLock('magician', h, row3.key)!.startsWith('Needs 9 points'), 'row 3 needs 9 points in the tree');
  near(hyperAvailable(h), 6, '6 SP left after 4 ranks');
  // fill rows 0-2 with the cheapest nodes until 9 are spent, then row 3 opens
  const early = T.nodes.filter((n) => n.row < 3 && n.key !== `${mc}:reinforce` && n.key !== `${mc}:extra`);
  for (const n of early) {
    for (let r = 0; r < n.max && hyperSpent(h.ranks) < 9; r++) { const x = hyperAdd('magician', h, n.key); if (x) h = x; }
  }
  eq(hyperSpent(h.ranks), 9, 'nine points spent in rows 0-2');
  eq(hyperLock('magician', h, row3.key), null, 'row 3 is open now');
  eq(hyperAdd('magician', h, 'nope:reinforce'), null, 'an unknown node is refused');
  // the spent points never exceed the SP
  let g = withSp(1);
  g = buy('magician', g, [`${mc}:reinforce`]);
  eq(hyperLock('magician', g, `${mc}:reinforce`), 'No Hyper SP left', 'out of SP');
  const r = hyperReset(h);
  eq([r.ranks, r.levels, hyperAvailable(r)], [{}, h.levels, 10], 'reset refunds every rank, keeps the levels');
  eq(Object.keys(h.ranks).length > 0, true, 'reset does not touch the input');
}

// ---- sanitising untrusted data ----
eq(sanitizeHyper(undefined), emptyHyper(), 'no data: empty');
eq(sanitizeHyper('x'), emptyHyper(), 'a non-object: empty');
eq(sanitizeHyper([1, 2]), emptyHyper(), 'an array: empty');
{
  const good = buy('magician', withSp(5), [`${mc}:reinforce`, `${mc}:reinforce`, `${mc}:extra`]);
  eq(sanitizeHyper({ magician: good }).magician, good, 'a valid class round-trips');
  eq(sanitizeHyper(JSON.parse(JSON.stringify({ magician: good }))).magician, good, 'and through JSON');
  const bad = (ranks: unknown, levels: unknown = 2000) => sanitizeHyper({ magician: { levels, ranks } }).magician;
  eq(bad({ [`${mc}:reinforce`]: 99 }).ranks, { [`${mc}:reinforce`]: 3 }, 'ranks clamp to the max');
  eq(bad({ [`${mc}:reinforce`]: 2.9 }).ranks, { [`${mc}:reinforce`]: 2 }, 'whole numbers');
  eq(bad({ [`${mc}:reinforce`]: -3, [`${mc}:extra`]: 'x', 'junk:reinforce': 3, __proto__: 5 }).ranks, {}, 'negative, non-numeric and unknown nodes are dropped');
  eq(bad({ [`${mc}:extra`]: 1 }).ranks, {}, 'Extra Target without Reinforce breaks the gating: refunded');
  const row3 = T.nodes.find((n) => n.row === 3 && n.slot === 0)!.key;
  eq(bad({ [row3]: 1 }).ranks, {}, 'a row-3 node with nothing under it breaks the gating: refunded');
  eq(bad({ [`${mc}:reinforce`]: 3, [`${mc}:extra`]: 1 }, 20).ranks, {}, 'more ranks than SP earned: refunded');
  eq(bad({ [`${mc}:reinforce`]: 3, [`${mc}:extra`]: 1 }, 80).ranks, { [`${mc}:reinforce`]: 3, [`${mc}:extra`]: 1 }, 'with 4 SP it is fine');
  eq(bad({}, NaN).levels, 0, 'bad levels become 0');
  eq(bad({}, -50).levels, 0, 'negative levels become 0');
  eq(bad({}, Infinity).levels, 0, 'infinite levels become 0');
  eq(sanitizeHyper({ magician: 7, warrior: null, bowman: { levels: 'a', ranks: 5 }, thief: { levels: 40 }, wizard: {} }).thief, { levels: 40, ranks: {} }, 'garbage classes are emptied, unknown classes ignored');
  eq(Object.keys(sanitizeHyper({ wizard: {} })).sort(), ['bowman', 'magician', 'pirate', 'thief', 'warrior'], 'always the five classes');
  // a tree that changed (a node renamed) loses only the unknown ranks
  eq(bad({ [`${mc}:reinforce`]: 2, 'old_skill:reinforce': 3 }).ranks, { [`${mc}:reinforce`]: 2 }, 'a removed skill\'s ranks are dropped, the rest kept');
}

// ---- modifiers ----
{
  eq(hyperMods('magician', undefined), {}, 'no ranks: no modifiers');
  eq(hyperMods('nope', { a: 1 }), {}, 'unknown class: none');
  const m = hyperMods('magician', { [`${mc}:reinforce`]: 3, [`${mc}:extra`]: 1, 'explosion:spread': 2, 'fire_arrow:reinforce': 99, 'junk:x': 3 });
  near(m[mc].dmg, 1 + 3 * REINFORCE_PER, 'three Reinforce ranks: +24% damage');
  eq([m[mc].count, m[mc].area, m[mc].cd], [1, 1, 1], 'and +1 target');
  near(m.explosion.area, 1 + 2 * SPREAD_PER, 'Spread: +20% area');
  near(m.fire_arrow.dmg, 1 + 3 * REINFORCE_PER, 'out of range ranks clamp (fire_arrow reinforce 99 -> 3)');
  near(hyperMods('thief', { 'double_stab:cooltime': 2 }).double_stab.cd, 1 - 2 * COOLTIME_PER, 'Cooltime Reduce: -12% cooldown');
  eq(m.junk, undefined, 'unknown skills ignored');
  // a mage with an evolved Brandish-like recipe: every recipe's evolved key shares the base's entry
  for (const r of RECIPES) {
    const cls = CLASSES.find((c) => c.skills.includes(r.base))!;
    const mm = hyperMods(cls.key, { [`${r.base}:reinforce`]: 2 });
    ok(mm[r.base] && mm[r.evolved] === mm[r.base], `${r.evolved} keeps the Hyper bonuses of ${r.base}`);
    eq(hyperMods(cls.key, {})[r.evolved], undefined, `${r.evolved} has none without ranks`);
  }
}

// ---- the Sim ----
const maxReinforce = (cls: ClassKey, skill: string) => ({ [`${skill}:reinforce`]: 3 });
{
  // damage of one hit: same seed, same rng stream, so the only difference is the multiplier
  const hitAmount = (hyper: Record<string, number> | undefined, skill: string) => {
    const s = new Sim(5, 'magician', hyper ? { hyper } : {});
    s.curSkill = skill;
    const e = enemy(100, 0);
    s.hit(e, 100);
    const ev = s.events.find((x) => x.type === 'hit') as { amount: number } | undefined;
    return ev!.amount;
  };
  const base = hitAmount(undefined, mc), boosted = hitAmount(maxReinforce('magician', mc), mc);
  ok(boosted > base, `max Reinforce hits harder (${boosted} vs ${base})`);
  near(boosted / base, 1 + 3 * REINFORCE_PER, 'by exactly +24% (before rounding)');
  eq(hitAmount(maxReinforce('magician', mc), 'energy_bolt'), base, 'another skill is untouched');
  eq(hitAmount({ 'energy_bolt:reinforce': 3 }, mc), base, 'ranks of another skill do not leak');
  // evolved skill: the bonus follows the replaced base skill
  const evo = (hyper?: Record<string, number>) => {
    const s = new Sim(5, 'magician', hyper ? { hyper } : {});
    s.curSkill = 'meteor_shower';
    s.hit(enemy(100, 0), 1000);
    return (s.events.find((x) => x.type === 'hit') as { amount: number }).amount;
  };
  ok(evo({ 'explosion:reinforce': 3 }) > evo(), 'Meteor Shower (evolved from Explosion) keeps Explosion\'s Reinforce');
  eq(evo({ 'poison_mist:reinforce': 3 }), evo(), 'but not another skill\'s');
  // cooldown, count and area as skills.ts reads them
  const s = new Sim(7, 'magician', { hyper: { 'magic_claw:extra': 1, 'magic_claw:reinforce': 1, 'magic_claw:cooltime': 2, 'explosion:spread': 2 } });
  ok(s.hyper.magic_claw.count === 1 && s.hyper.explosion?.area === 1 + 2 * SPREAD_PER, 'the sim holds the table');
  eq(new Sim(7, 'magician').hyper, {}, 'a normal sim has no modifiers');
  // magic claw: extra target = one more projectile per cast (fires at a nearby enemy)
  const cast = (hyper?: Record<string, number>) => {
    const sim = new Sim(9, 'magician', hyper ? { hyper } : {});
    sim.enemies.push(enemy(5, 0));
    sim.skills[0].cd = 0;
    sim.tick();
    return sim.projectiles.length;
  };
  eq(cast({ 'magic_claw:extra': 1, 'magic_claw:reinforce': 1 }) - cast(), 1, 'Extra Target adds a projectile to Magic Claw');
  const d = SKILL_BY_KEY[mc];
  near(skillCooldown(d, 1, 0) * (1 - 2 * COOLTIME_PER), skillCooldown(d, 1, 0) * 0.88, 'cooldown multiplier maths');
}

// ---- a seeded god-mode bot run: more damage with Reinforce on the start skill ----
{
  const run = (cls: ClassKey, hyper?: Record<string, number>) => {
    const s = new Sim(31, cls, hyper ? { hyper } : {});
    s.god = true;
    let dmg = 0;
    for (let i = 0; i < 90 * 60 && !s.over; i++) {
      if (s.offer) { s.pick(botPick(s)); continue; }
      const b = botInput(s, 1);
      s.setInput(b.x, b.y);
      s.tick();
      for (const e of s.events) if (e.type === 'hit') dmg += e.amount;
      s.events.length = 0;
    }
    return { dmg, kills: s.kills, json: JSON.stringify(s.snapshot()) };
  };
  for (const c of CLASSES) {
    const start = c.skills[0];
    const a = run(c.key), b = run(c.key, maxReinforce(c.key, start)), b2 = run(c.key, maxReinforce(c.key, start));
    ok(b.dmg > a.dmg, `${c.key}: max Reinforce on ${start} deals more over 90 s (${Math.round(b.dmg)} vs ${Math.round(a.dmg)})`);
    eq(b.json, b2.json, `${c.key}: same seed and ranks give the same run`);
    eq(run(c.key, {}).json, a.json, `${c.key}: empty ranks are the same as none`);
  }
}

console.log(`test-hyper: ok (${checks} checks)`);
