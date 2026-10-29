// Run: node --experimental-strip-types scripts/test-gacha.ts
// Boss Gachapon capsules and 4th-job evolutions (src/game/gachapon.ts, evolutions.ts): drops, upgrade rolls, upgrades applied, the Mastery Book
// evolution (recipes, replaced slot, never offered again), the Mastery Book fallback drop, card hints and weights, determinism, and balance.
import assert from 'node:assert/strict';
import { botInput } from '../src/game/bot.ts';
import { BOSSES, CLASSES, JOB_BY_CODE, PASSIVES, PASSIVE_BY_KEY, PASSIVE_MAX_LEVEL, MAX_PASSIVES, SKILLS, SKILL_BY_KEY, SKILL_MAX_LEVEL, jobOfId, unlockedJobs } from '../src/game/data.ts';
import { EVOLVED_SKILLS, EVOLUTION_PASSIVE_SLOTS, PARTNER_WEIGHT, RECIPES, cardWeight, evolutionHint, partnerSlotOpen, pickCard, readyRecipe } from '../src/game/evolutions.ts';
import { GACHA_MESOS, MASTERY_DROP, applyUpgrades, gachaOdds, rollGachaCount } from '../src/game/gachapon.ts';
import { Rng } from '../src/game/rng.ts';
import { Sim } from '../src/game/sim.ts';
import { BAG, ELIXIR, GACHA, MASTERY } from '../src/game/types.ts';
import type { Card, SimEvent } from '../src/game/types.ts';
import { WANTED_SKILLS } from '../src/maple/assets.ts';
import { HOLD_MS, OPEN_MS, REVEAL_MS, revealAt } from '../src/ui/gachapon.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };

const enemy = (over: Record<string, unknown> = {}) => ({ x: 3, y: 0, hp: 5, maxHp: 5, speed: 0, dmg: 0, r: 1, xp: 1, tier: 29, boss: -1, lead: true, big: false, add: false, alive: true, hitCd: 9, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, lastHit: -99, facing: 1, phase: 0, moving: false, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1, ...over });
const classOf = (skill: string) => CLASSES.find((c) => c.skills.includes(skill))!;

/** A hero of the class that owns recipe `r`'s 3rd job, with that job unlocked */
function hero(r: (typeof RECIPES)[number], seed = 1) {
  const cls = classOf(r.base);
  const job3 = jobOfId(SKILL_BY_KEY[r.base].id);
  const sim = new Sim(seed, cls.key);
  sim.branch = job3 - 1;
  sim.jobs = unlockedJobs(cls, sim.branch, 70);
  sim.level = 70;
  return sim;
}
const own = (sim: Sim, key: string, level: number) => {
  const s = sim.skills.find((o) => o.key === key);
  if (s) s.level = level; else sim.skills.push({ key, level, cd: 0 });
};
const ownPassive = (sim: Sim, key: string, level: number) => {
  const p = sim.passives.find((o) => o.key === key);
  if (p) p.level = level; else sim.passives.push({ key, level });
  sim.recalc();
};
const gachaEvents = (sim: Sim) => sim.events.filter((e): e is Extract<SimEvent, { type: 'gacha' }> => e.type === 'gacha');

// ---- odds and rolls ----
{
  eq(gachaOdds(0).map((p) => Math.round(p * 100)), [75, 22, 3], 'boss #1 odds: 75 / 22 / 3 %');
  eq(gachaOdds(1).map((p) => Math.round(p * 100)), [67, 28, 5], 'boss #2 shifts 6 % to 3 and 2 % to 5, taken from 1');
  for (let b = 0; b < BOSSES.length; b++) {
    const o = gachaOdds(b);
    ok(Math.abs(o[0] + o[1] + o[2] - 1) < 1e-9 && o[0] > 0 && o[1] > gachaOdds(Math.max(0, b - 1))[1] - 1e-9, `boss ${b + 1}: odds sum to 1 and grow`);
  }
  for (const b of [0, 5]) {
    const rng = new Rng(11 + b);
    const N = 30000, n = { 1: 0, 3: 0, 5: 0 } as Record<number, number>;
    for (let i = 0; i < N; i++) n[rollGachaCount(rng, b)]++;
    const o = gachaOdds(b);
    ok(Math.abs(n[1] / N - o[0]) < 0.012 && Math.abs(n[3] / N - o[1]) < 0.012 && Math.abs(n[5] / N - o[2]) < 0.008, `boss ${b + 1}: ${N} rolls ${(n[1] / N).toFixed(3)} / ${(n[3] / N).toFixed(3)} / ${(n[5] / N).toFixed(3)}`);
    ok(Object.keys(n).every((k) => [1, 3, 5].includes(Number(k)) ), 'only 1, 3 or 5 upgrades');
  }
}

// ---- capsule drops on boss death, never expires, the pet leaves it alone ----
{
  const s = new Sim(5, 'magician', { pet: true });
  s.god = true;
  const boss = enemy({ boss: 2, big: true });
  s.enemies.push(boss);
  s.hit(boss, 1e6);
  const caps = s.pickups.filter((p) => p.kind === GACHA);
  eq(caps.length, 1, 'a boss drops one Gachapon capsule');
  eq(caps[0].value, 3, 'its value is the boss number');
  ok(s.pickups.some((p) => p.kind === ELIXIR) && s.pickups.some((p) => p.kind === BAG), 'the Elixir and the meso bag still drop');
  ok(caps[0].life > 1e8, 'the capsule never expires');
  // place it where the hero's magnet cannot reach but the pet's scan can: the pet must not fetch it
  caps[0].x = s.px + 6; caps[0].y = s.py;
  for (let i = 0; i < 60 * 20; i++) s.tick();
  ok(s.pickups.some((p) => p.kind === GACHA), 'still lying there after 20 s');
  ok(s.pet!.target?.kind !== GACHA, 'the pet never targets it');
  // a boss-wave companion drops none (only the boss the wave is named after does)
  const c = new Sim(7, 'magician');
  const comp = enemy({ boss: 1, big: true, lead: false });
  c.enemies.push(comp);
  c.hit(comp, 1e6);
  eq(c.pickups.filter((p) => p.kind === GACHA).length, 0, 'a boss-wave companion drops no capsule');
  // normal mobs drop none
  const t = new Sim(6, 'magician');
  const m = enemy();
  t.enemies.push(m);
  t.hit(m, 1e6);
  ok(!t.pickups.some((p) => p.kind === GACHA || p.kind === MASTERY), 'normal mobs drop no capsule');
  // every boss index drops it
  for (let b = 0; b < BOSSES.length; b++) {
    const u = new Sim(7, 'warrior');
    const e = enemy({ boss: b, big: true });
    u.enemies.push(e);
    u.hit(e, 1e6);
    eq(u.pickups.find((p) => p.kind === GACHA)?.value, b + 1, `boss ${b + 1} capsule`);
  }
}

// ---- touching the capsule: event, counts, upgrades applied ----
{
  const s = new Sim(21, 'magician');
  s.god = true;
  s.skills = [{ key: 'magic_claw', level: 1, cd: 0 }, { key: 'energy_bolt', level: 3, cd: 0 }];
  s.passives = [{ key: 'magic_guard', level: 1 }];
  s.recalc();
  const sum = () => s.skills.reduce((a, o) => a + o.level, 0) + s.passives.reduce((a, o) => a + o.level, 0);
  const before = sum();
  (s as any).dropPickup(GACHA, 0.2, 0, 1);
  s.tick();
  const ev = gachaEvents(s);
  eq(ev.length, 1, 'one gacha event on touch');
  ok([1, 3, 5].includes(ev[0].count) && ev[0].results.length === ev[0].count, `count ${ev[0].count} matches its results`);
  eq(ev[0].boss, 0, 'event carries the boss index');
  eq(sum() - before, ev[0].results.filter((r) => r.kind !== 'meso').length, 'every result raised one level');
  ok(ev[0].results.every((r) => r.kind === 'skill' && r.to === r.from + 1), 'owned skills come first');
  ok(!s.pickups.some((p) => p.kind === GACHA), 'the capsule is gone');
  ok(s.notes.some((n) => /Gachapon/.test(n.text)), 'a note announces it');

  // skills first, then passives, then mesos
  const a = new Sim(22, 'magician');
  a.skills = [{ key: 'magic_claw', level: SKILL_MAX_LEVEL - 1, cd: 0 }];
  a.passives = [{ key: 'magic_guard', level: PASSIVE_MAX_LEVEL - 1 }];
  const armor0 = a.armor;
  const res = applyUpgrades(a, 5, 2);
  eq(res.map((r) => r.kind), ['skill', 'passive', 'meso', 'meso', 'meso'], 'skill, then passive, then mesos once everything is maxed');
  eq(a.skills[0].level, SKILL_MAX_LEVEL, 'skill maxed');
  eq(a.passives[0].level, PASSIVE_MAX_LEVEL, 'passive maxed');
  ok(a.armor > armor0 - 1e-9 && a.armor === PASSIVE_BY_KEY.magic_guard.per * PASSIVE_MAX_LEVEL, 'passive upgrade recalculated the stats');
  eq(a.mesos, 3 * GACHA_MESOS * 3, 'mesos are 25 x boss number each');
  eq(res[2].amount, 75, 'meso result carries the amount');
  // never beyond max
  const b = new Sim(23, 'magician');
  b.skills[0].level = SKILL_MAX_LEVEL - 2;
  applyUpgrades(b, 5, 0);
  ok(b.skills[0].level === SKILL_MAX_LEVEL && b.mesos === 3 * GACHA_MESOS, 'levels stop at max, the rest becomes mesos');
}

// ---- recipes: readiness, evolution, replacement ----
{
  eq(RECIPES.length, 12, 'twelve recipes, one per 3rd job');
  eq(EVOLVED_SKILLS.length, 12, 'twelve evolved skills');
  const thirdJobs = new Set(RECIPES.map((r) => jobOfId(SKILL_BY_KEY[r.base].id)));
  eq(thirdJobs.size, 12, 'each recipe has its own 3rd job');
  ok([...thirdJobs].every((j) => JOB_BY_CODE[j]?.tier === 3), 'every base skill is a 3rd-job skill');
  const ids = new Set([...SKILLS.map((x) => x.id), ...PASSIVES.map((x) => x.id)]);
  ok(EVOLVED_SKILLS.every((e) => e.evolved === true && !ids.has(e.id) && !SKILLS.some((x) => x.key === e.key)), 'evolved skills are flagged and are not in the card pool tables');
  ok(EVOLVED_SKILLS.every((e) => SKILL_BY_KEY[e.key] === e), 'evolved skills are registered by key');
  ok(RECIPES.every((r) => SKILL_BY_KEY[r.evolved]?.evolved && PASSIVE_BY_KEY[r.partner] && classOf(r.base).key === JOB_BY_CODE[jobOfId(PASSIVE_BY_KEY[r.partner].id)]?.cls), 'recipe keys exist and base and partner share a class');
  eq(EVOLVED_SKILLS.map((e) => e.id).sort(), [1121008, 1221009, 1321003, 2121007, 2221007, 2321008, 3121004, 3221001, 4121007, 4221007, 5121007, 5221004].sort(), 'v83 Skill.wz ids of the 4th-job skills');
  const wanted = new Set(WANTED_SKILLS.map((w) => w.key));
  ok(EVOLVED_SKILLS.every((e) => wanted.has(e.key)), 'the asset step extracts the evolved skills (WANTED_SKILLS)');
  eq(WANTED_SKILLS.find((w) => w.key === 'brandish')!.image, '112.img', 'evolved skill lives in its 4th-job image');
  eq(RECIPES.filter((r) => ['energy_blast', 'flamethrower'].includes(r.base)).map((r) => `${r.base}+${r.partner}>${r.evolved}`), ['energy_blast+energy_charge>barrage', 'flamethrower+gun_mastery>rapid_fire'], 'Pirate recipes: Marauder -> Buccaneer, Outlaw -> Corsair');
  eq(WANTED_SKILLS.find((w) => w.key === 'barrage')!.image, '512.img', 'Buccaneer skill lives in 512.img');

  for (const r of RECIPES) {
    const s = hero(r, 3);
    eq(readyRecipe(s), null, `${r.base}: not ready without the skill`);
    own(s, r.base, SKILL_MAX_LEVEL - 1);
    ownPassive(s, r.partner, 1);
    eq(readyRecipe(s), null, `${r.base}: not ready below max level`);
    own(s, r.base, SKILL_MAX_LEVEL);
    s.passives = [];
    eq(readyRecipe(s), null, `${r.base}: not ready without ${r.partner}`);
    ownPassive(s, r.partner, 1);
    eq(readyRecipe(s)?.evolved, r.evolved, `${r.base}: ready with ${r.partner} at level 1`);

    // the first upgrade of the next capsule is the evolution, even for a 1-upgrade capsule
    const slot = s.skills.findIndex((o) => o.key === r.base);
    const n = s.skills.length;
    const res = applyUpgrades(s, 1, 3);
    eq(res[0].kind, 'evolve', `${r.base}: the first upgrade is the Mastery Book`);
    eq(s.skills.length, n, `${r.base}: no extra slot used`);
    eq(s.skills[slot].key, r.evolved, `${r.base}: replaced in its slot`);
    eq(s.skills[slot].level, SKILL_MAX_LEVEL, `${r.evolved}: considered max level`);
    ok(!s.skills.some((o) => o.key === r.base), `${r.base}: gone`);
    ok(s.banished.has(r.base), `${r.base}: banished for the run`);
    eq(readyRecipe(s), null, `${r.base}: nothing left to evolve`);
    eq(res[0].base, r.base, 'result names the base skill');
    ok(s.notes.some((x) => x.text === `Mastery Book! ${SKILL_BY_KEY[r.base].name} evolved into ${SKILL_BY_KEY[r.evolved].name}`), `${r.evolved}: note text`);
    ok(s.raidText === `Mastery Book! ${SKILL_BY_KEY[r.base].name} evolved into ${SKILL_BY_KEY[r.evolved].name}` && s.raidUntil > s.t, `${r.evolved}: banner text`);
    ok(s.events.some((e) => e.type === 'evolve' && e.to === r.evolved), `${r.evolved}: evolve event`);
  }

  // the evolution comes first only once, then normal upgrades; capsules of 3 / 5 evolve then level others
  const r = RECIPES[0];
  const s = hero(r, 4);
  s.skills = [{ key: r.base, level: SKILL_MAX_LEVEL, cd: 0 }, { key: 'power_strike', level: 2, cd: 0 }];
  ownPassive(s, r.partner, 2);
  const res = applyUpgrades(s, 3, 0);
  eq(res.map((x) => x.kind), ['evolve', 'skill', 'skill'], 'evolution first, then ordinary skill levels');
  ok(res.slice(1).every((x) => x.key === 'power_strike'), 'the evolved skill is never levelled (already max)');
  eq(s.skills.find((o) => o.key === r.evolved)!.level, SKILL_MAX_LEVEL, 'still max');

  // never offered again: many level-up offers after the evolution
  const t = hero(r, 9);
  t.skills = [{ key: r.base, level: SKILL_MAX_LEVEL, cd: 0 }];
  ownPassive(t, r.partner, 1);
  applyUpgrades(t, 1, 0);
  t.pendingLevels = 300;
  const offered = new Set<string>();
  for (let i = 0; i < 300 && t.pendingLevels + (t.offer ? 1 : 0) > 0; i++) {
    (t as any).openOffer();
    if (!t.offer) break;
    for (const c of t.offer) offered.add(c.key);
    t.pick(0);
  }
  ok(offered.size > 3, `${offered.size} different cards were offered`);
  ok(!offered.has(r.base) && !offered.has(r.evolved), 'neither the base key nor the evolved key is ever offered');
  ok(t.skills.some((o) => o.key === r.evolved && o.level === SKILL_MAX_LEVEL), 'the evolved skill stays at max');
  // banish and reroll cannot bring it back either
  ok((t as any).candidates(null).every((c: Card) => c.key !== r.base && c.key !== r.evolved), 'candidates exclude both');
}

// ---- Mastery Book fallback drop ----
{
  const r = RECIPES[3];
  const mk = (spawned: number) => {
    const s = hero(r, 12);
    s.skills = [{ key: r.base, level: SKILL_MAX_LEVEL, cd: 0 }];
    ownPassive(s, r.partner, 1);
    s.bossesSpawned = spawned;
    (s as any).gachaRng = { next: () => 0 };
    return s;
  };
  const kill = (s: Sim) => { const e = enemy(); s.enemies.push(e); s.hit(e, 1e6); };
  const early = mk(5);
  for (let i = 0; i < 20; i++) kill(early);
  ok(!early.pickups.some((p) => p.kind === MASTERY), 'no Mastery Book drop while a boss is still to come');
  const late = mk(6);
  for (let i = 0; i < 20; i++) kill(late);
  eq(late.pickups.filter((p) => p.kind === MASTERY).length, 1, 'once no boss is left, a ready recipe drops one Mastery Book (never two on the ground)');
  const notReady = mk(6);
  notReady.passives = [];
  for (let i = 0; i < 20; i++) kill(notReady);
  ok(!notReady.pickups.some((p) => p.kind === MASTERY), 'no drop while the recipe is not ready');
  const book = late.pickups.find((p) => p.kind === MASTERY)!;
  book.x = late.px; book.y = late.py;
  late.tick();
  eq(late.skills[0].key, r.evolved, 'touching the Mastery Book evolves the skill');
  ok(!late.pickups.some((p) => p.kind === MASTERY), 'the book is gone');
  // a real rate: about MASTERY_DROP per kill
  const rate = mk(6);
  (rate as any).gachaRng = new Rng(99);
  let drops = 0, kills = 0;
  for (let i = 0; i < 20000; i++) {
    kill(rate);
    kills++;
    const k = rate.pickups.findIndex((p) => p.kind === MASTERY);
    if (k >= 0) { drops++; (rate as any).removePickup(k); }
    rate.enemies.length = 0;
  }
  ok(Math.abs(drops / kills - MASTERY_DROP) < 0.0012, `fallback drop rate ${(drops / kills * 100).toFixed(2)} % per kill (want ${MASTERY_DROP * 100} %)`);
}

// ---- card hints, weights, the evolution passive slot ----
{
  for (const r of RECIPES) {
    eq(evolutionHint(r.base), `Evolves into ${SKILL_BY_KEY[r.evolved].name} with a Mastery Book`, `${r.base}: hint`);
    eq(evolutionHint(r.partner), `Evolves ${SKILL_BY_KEY[r.base].name} with a Mastery Book`, `${r.partner}: hint`);
  }
  eq(evolutionHint('magic_claw'), null, 'no hint for other cards');
  const r = RECIPES[0];
  const s = hero(r, 14);
  own(s, r.base, SKILL_MAX_LEVEL - 1);
  eq(cardWeight(s, r.partner), 1, 'no extra weight while the skill is not maxed');
  own(s, r.base, SKILL_MAX_LEVEL);
  eq(cardWeight(s, r.partner), PARTNER_WEIGHT, 'extra weight once the skill is maxed and the partner is missing');
  ownPassive(s, r.partner, 1);
  eq(cardWeight(s, r.partner), 1, 'none once the partner is owned');
  s.passives = [];
  // pickCard prefers the partner
  const pool = (): Card[] => [
    { kind: 'passive', key: r.partner, name: 'p', isNew: true, from: 0, to: 1, desc: '' },
    { kind: 'passive', key: 'rage', name: 'q', isNew: true, from: 0, to: 1, desc: '' },
    { kind: 'skill', key: 'power_strike', name: 's', isNew: true, from: 0, to: 1, desc: '' },
  ];
  let first = 0;
  for (let i = 0; i < 8000; i++) if (pickCard(s, pool()) === 0) first++;
  ok(Math.abs(first / 8000 - 0.5) < 0.03, `the partner is picked ${(first / 80).toFixed(1)} % of the time (want 50 % vs 33 % unweighted)`);
  const f = hero(r, 40);
  own(f, r.base, 2);
  eq(pickCard(f, pool()), new Rng(40).int(3), 'without a boosted card pickCard is exactly rng.int');

  // full passive slots: only the partner may take the extra slot, and only if the recipe's skill is owned
  const t = hero(r, 15);
  t.skills = [{ key: 'power_strike', level: 8, cd: 0 }];
  t.passives = ['endure', 'iron_body', 'improved_hp_recovery', 'improved_max_hp', 'rage', 'sword_booster_fighter'].map((key) => ({ key, level: 5 }));
  eq(t.passives.length, MAX_PASSIVES, 'six passives');
  ok(!partnerSlotOpen(t, r.partner, MAX_PASSIVES), 'closed while the recipe skill is not owned');
  ok(!(t as any).candidates(null).some((c: Card) => c.key === r.partner), 'partner not offered then');
  own(t, r.base, 3);
  ok(partnerSlotOpen(t, r.partner, MAX_PASSIVES), 'open once the recipe skill is owned');
  ok((t as any).candidates(null).some((c: Card) => c.key === r.partner && c.isNew), 'the partner is offered although the slots are full');
  ok(!(t as any).candidates(null).some((c: Card) => c.kind === 'passive' && c.isNew && c.key !== r.partner), 'no other new passive is');
  t.offer = [{ kind: 'passive', key: r.partner, name: '', isNew: true, from: 0, to: 1, desc: '' }];
  t.pick(0);
  eq(t.passives.length, MAX_PASSIVES + EVOLUTION_PASSIVE_SLOTS, 'the partner took the extra slot');
  ok((t as any).candidates(null).every((c: Card) => !(c.kind === 'passive' && c.isNew)), 'no further new passives');
}

// ---- reveal timing (UI helper) ----
{
  eq(revealAt(0, 1), OPEN_MS, 'a single result shows after the capsule opens');
  eq(revealAt(4, 5), REVEAL_MS, 'the last of five shows at 2.5 s');
  const ts = [0, 1, 2, 3, 4].map((i) => revealAt(i, 5));
  ok(ts.every((t, i) => i === 0 || t > ts[i - 1]), 'results reveal one after another');
  ok(HOLD_MS > 0 && REVEAL_MS === 2500, 'about 2.5 s of reveal');
}

// ---- determinism, snapshot ----
function scripted(seed: number) {
  const r = RECIPES[4];
  const s = hero(r, seed);
  s.skills = [{ key: r.base, level: SKILL_MAX_LEVEL, cd: 0 }, { key: 'magic_claw', level: 3, cd: 0 }, { key: 'energy_bolt', level: 1, cd: 0 }];
  ownPassive(s, r.partner, 1);
  ownPassive(s, 'magic_guard', 2);
  const log: unknown[] = [];
  for (let b = 0; b < BOSSES.length; b++) {
    (s as any).dropPickup(GACHA, s.px, s.py, b + 1);
    s.tick();
    for (const e of s.events) if (e.type === 'gacha' || e.type === 'evolve') log.push(e);
    s.events.length = 0;
  }
  log.push(s.snapshot());
  return JSON.stringify(log);
}
{
  eq(scripted(77), scripted(77), 'same seed, same capsules');
  ok(scripted(77) !== scripted(78), 'a different seed rolls differently');
  const snap = JSON.parse(scripted(77)).pop();
  ok(Array.isArray(snap.evolved) && snap.evolved.includes('blizzard_mage'), 'snapshot lists the evolved skills');
  eq(snap.gacha, 0, 'snapshot counts capsules on the ground');
  const s = new Sim(1, 'magician');
  eq(s.snapshot().evolutionReady, null, 'snapshot: no evolution ready at the start');
}

// ---- evolved skills fire and are stronger than their base (balance) ----
function dps(cls: string, key: string, crowd: number, rad = 0.6): number {
  const sim = new Sim(9, cls);
  (sim as any).spawner = () => {};
  sim.god = true;
  sim.skills = [{ key, level: SKILL_MAX_LEVEL, cd: 0 }];
  sim.crit = 0;
  const rng = new Rng(77);
  const dummy = (x: number, y: number, r: number) => enemy({ x, y, hp: 1e12, maxHp: 1e12, r });
  if (crowd === 0) sim.enemies.push(dummy(4, 0, rad));
  else for (let i = 0; i < crowd; i++) { const a = rng.range(0, 6.283), d = 12 * Math.sqrt(rng.next()); sim.enemies.push(dummy(Math.cos(a) * d, Math.sin(a) * d, 0.6)); }
  let total = 0;
  for (let t = 0; t < 1800; t++) {
    sim.tick();
    for (const e of sim.events) if (e.type === 'hit') total += e.amount;
    sim.events.length = 0;
  }
  return total / 30;
}
{
  const LINE = new Set(['hurricane', 'piercing_arrow', 'rapid_fire']);
  for (const r of RECIPES) {
    const cls = classOf(r.base).key;
    const b1 = dps(cls, r.base, 0, 2.9), e1 = dps(cls, r.evolved, 0, 2.9);
    const b2 = dps(cls, r.base, 50), e2 = dps(cls, r.evolved, 50);
    console.log(`  ${r.base.padEnd(15)} -> ${r.evolved.padEnd(14)} vs boss x${(e1 / b1).toFixed(2)} (${b1.toFixed(0)} -> ${e1.toFixed(0)}), vs crowd x${(e2 / b2).toFixed(2)} (${b2.toFixed(0)} -> ${e2.toFixed(0)})`);
    ok(e1 > 0 && e2 > 0, `${r.evolved} deals damage`);
    ok(e1 / b1 >= 2.4 && e1 / b1 <= 10.5, `${r.evolved}: a clear but not absurd spike against a boss (x${(e1 / b1).toFixed(2)})`);
    ok(LINE.has(r.evolved) ? e2 / b2 >= 0.25 : e2 / b2 >= 2.4 && e2 / b2 <= 4.2, `${r.evolved}: crowd power x${(e2 / b2).toFixed(2)}`);
  }
}

// ---- a bot run: capsules get collected, the evolution happens, nothing throws ----
{
  const r = RECIPES[9];
  const s2 = new Sim(31, 'thief');
  s2.god = true;
  let evolved = -1, caps = 0;
  for (let i = 0; i < 700 * 60 && !s2.over; i++) {
    if (s2.offer) {
      let k = 0;
      if (s2.offer[0].kind === 'job') k = 1;
      else { const w = s2.offer.findIndex((c) => c.key === r.base || c.key === r.partner); if (w >= 0) k = w; }
      s2.pick(k);
      continue;
    }
    const inp = botInput(s2, 1);
    s2.setInput(inp.x, inp.y);
    s2.tick();
    for (const e of s2.events) { if (e.type === 'gacha') caps++; if (e.type === 'evolve' && evolved < 0) evolved = s2.t; }
    s2.events.length = 0;
  }
  ok(caps >= 3, `the bot collected ${caps} capsules by 11:40`);
  ok(evolved > 0, `the bot evolved Meso Explosion at ${evolved.toFixed(0)} s`);
  ok(s2.skills.every((o) => o.level <= SKILL_MAX_LEVEL) && s2.passives.length <= MAX_PASSIVES + EVOLUTION_PASSIVE_SLOTS, 'slot limits held');
}

console.log(`test-gacha: ok (${checks} checks)`);
