// Run: node --experimental-strip-types scripts/test-mobs.ts
// Mob behaviours (src/game/mobai.ts) and the hero's ailments (src/game/ailments.ts): ranged mobs stop and shoot, shots hit and expire, the cap on
// shooters, the charge telegraph / dash / cooldown, flyers, Elites and event mobs, each ailment's effect and expiry, refresh instead of stacking,
// the cures, the boss ailment cast, the bot's sidesteps, `mobAi: false`, and determinism for a fixed seed.
import assert from 'node:assert/strict';
import { botInput } from '../src/game/bot.ts';
import {
  AIL_CURSE, AIL_DARKNESS, AIL_POISON, AIL_SEAL, AIL_WEAKNESS, BOSSES, BOSS_EVERY, CLASSES, LADDER,
} from '../src/game/data.ts';
import { AILMENTS, CURSE_GEM, HOLY_SYMBOL_FACTOR, POISON_FRAC, WEAKNESS_SPEED, applyAilment, cureAilments } from '../src/game/ailments.ts';
import { maybePromote } from '../src/game/elites.ts';
import { startSwarm } from '../src/game/events.ts';
import { FIELD_APPLE, FIELD_ELIXIR, useFieldItem } from '../src/game/fieldItems.ts';
import {
  AIL_CAST, AIL_EVERY, AIL_RADIUS, CHARGE_COOLDOWN, CHARGE_DASH_TIME, CHARGE_MAX, CHARGE_MIN, CHARGE_SPEED, CHARGE_TELEGRAPH_TIME, MAX_SHOOTERS, MOB_SHOT_AIL_CHANCE,
  RANGED_ADMIT, RANGED_FIRE, RANGED_STOP_MAX, RANGED_STOP_MIN, SHOT_DMG, SHOT_FIRST_MAX, SHOT_FIRST_MIN, SHOT_GAP_MAX, SHOT_GAP_MIN, SHOT_LIFE, SHOT_POSE, SHOT_SPEED_MAX, SHOT_SPEED_MIN,
} from '../src/game/mobai.ts';
import { Sim } from '../src/game/sim.ts';
import { BEH_CHARGE, BEH_RANGED, CHARGE_DASH, CHARGE_IDLE, CHARGE_TELEGRAPH, ELIXIR, EV_RING, EV_STAMPEDE, EV_TREASURE, GEM } from '../src/game/types.ts';
import type { Enemy, SimEvent } from '../src/game/types.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };
const near = (a: number, b: number, tol: number, m: string) => { checks++; assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b} +- ${tol})`); };

const tier = (name: string) => LADDER.findIndex((d) => d.name === name);
const LUPIN = tier('Lupin'), CURSE_EYE = tier('Curse Eye'), WRAITH = tier('Wraith'), EVIL_EYE = tier('Evil Eye'), PIG = tier('Pig'), SNAIL = tier('Snail');

/** a hero that cannot attack, standing still, so only what a test sets up happens (not immortal unless `god`) */
function quiet(seed = 1, cls = 'magician', opts: { mobAi?: boolean; god?: boolean } = {}) {
  const s = new Sim(seed, cls, { events: false, mobAi: opts.mobAi });
  s.skills = [];
  s.god = opts.god ?? true;
  return s;
}
const run = (s: Sim, seconds: number, each?: () => void) => {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n && !s.over; i++) {
    s.offer = null; s.pendingLevels = 0; // level-ups would pause the run; these tests are not about cards
    s.tick();
    // the spawner's own packs are not part of these scenes (a test's mobs are added by hand, as `add`)
    for (const e of s.enemies) if (!e.add && e.boss < 0) e.alive = false;
    each?.();
    s.events.length = 0;
  }
};
const mob = (s: Sim, t: number, x: number, y: number) => s.spawnEnemy(t, s.px + x, s.py + y, true);
const evOf = <T extends SimEvent['type']>(s: Sim, type: T) => s.events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const dist = (s: Sim, e: Enemy) => Math.hypot(e.x - s.px, e.y - s.py);
/** a mob that stays where it is and cannot hurt (a target or witness) */
const dummy = (s: Sim, x: number, y: number, hp = 1e9) => {
  const e = mob(s, SNAIL, x, y);
  e.speed = 0; e.dmg = 0; e.hitCd = 1e9; e.maxHp = e.hp = hp;
  return e;
};

// ---- tables ----
{
  const by = (b: string) => LADDER.filter((d) => d.behave === b).map((d) => d.name);
  eq(by('ranged'), ['Evil Eye', 'Curse Eye', 'Jr. Boogie', 'Lupin', 'Wraith'], 'ranged tiers: Evil Eye, Curse Eye, Jr. Boogie, Lupin, Wraith');
  eq(by('charge'), ['Pig', 'Ribbon Pig', 'Axe Stump', 'Wild Boar', 'Fire Boar'], 'charge tiers: Pig, Ribbon Pig, Axe Stump, Wild Boar, Fire Boar');
  ok(LADDER.length - by('ranged').length - by('charge').length === 20, 'the other twenty tiers walk');
  eq(LADDER.filter((d) => d.fly).map((d) => d.name), ['Evil Eye', 'Curse Eye', 'Jr. Boogie', 'Wraith'], 'flyers: the eyes, Jr. Boogie and Wraith');
  eq(LADDER.filter((d) => d.shotAil).map((d) => [d.name, d.shotAil]), [['Curse Eye', AIL_DARKNESS], ['Wraith', AIL_CURSE]], 'Curse Eye shoots Darkness, Wraith Curse');
  eq(BOSSES.map((b) => b.ailments), [[AIL_WEAKNESS], [AIL_POISON], [AIL_WEAKNESS], [AIL_CURSE], [AIL_SEAL], [AIL_DARKNESS, AIL_SEAL]], 'boss ailments: Mano Weakness, Mushmom Poison, King Slime Weakness, Zombie Mushmom Curse, Jr. Balrog Seal, Zakum Darkness + Seal');
  eq(AILMENTS.map((a) => a.seconds), [3, 5, 4, 8, 5], 'durations: Seal 3, Darkness 5, Weakness 4, Curse 8, Poison 5');
  eq(AILMENTS.map((a) => a.id), [AIL_SEAL, AIL_DARKNESS, AIL_WEAKNESS, AIL_CURSE, AIL_POISON], 'ailment ids line up with their table');
  eq(new Set(AILMENTS.map((a) => a.color)).size, 5, 'each ailment has its own colour');
  ok(SHOT_SPEED_MIN === 8 && SHOT_SPEED_MAX === 10 && SHOT_LIFE === 2 && MAX_SHOOTERS === 25 && AIL_EVERY === 16 && AIL_CAST === 1.2, 'the constants of the brief');
  const e = (() => { const s = quiet(); return mob(s, LUPIN, 30, 0); })();
  eq([e.behave, e.fly], [BEH_RANGED, false], 'a Lupin spawns as a ranged ground mob');
  const e2 = (() => { const s = quiet(); return mob(s, PIG, 30, 0); })();
  eq([e2.behave, e2.fly], [BEH_CHARGE, false], 'a Pig spawns as a charger');
  const e3 = (() => { const s = quiet(); return mob(s, WRAITH, 30, 0); })();
  eq([e3.behave, e3.fly], [BEH_RANGED, true], 'a Wraith spawns as a ranged flyer');
  const e4 = (() => { const s = quiet(undefined, undefined, { mobAi: false }); return mob(s, WRAITH, 30, 0); })();
  eq([e4.behave, e4.fly], [0, false], 'with mobAi off every mob is a plain walker');
}

// ---- ranged: stops at 9 to 12 yd, shoots every 2.5 to 3.5 s, shots hit ----
{
  const s = quiet();
  const e = mob(s, LUPIN, 20, 0);
  const dmg = e.dmg * SHOT_DMG;
  const fires: number[] = [];
  let last = 0, hurts: number[] = [];
  const shotSpeeds: number[] = [];
  run(s, 16, () => {
    if (s.mobs.fired !== last) {
      last = s.mobs.fired;
      fires.push(s.t);
      near(e.atk, SHOT_POSE, 0.02, 'the shooter holds its attack pose after a shot');
      const sh = s.mobs.shots[s.mobs.shots.length - 1];
      shotSpeeds.push(Math.hypot(sh.vx, sh.vy));
      // aimed at the hero's position right now: the velocity points at the hero
      near(Math.atan2(sh.vy, sh.vx), Math.atan2(s.py - sh.y, s.px - sh.x), 0.02, 'a shot flies at the hero');
    }
    for (const ev of s.events) if (ev.type === 'playerHit') hurts.push(ev.amount);
  });
  ok(e.shooter && s.mobs.shooters === 1, 'the Lupin became a shooter');
  const d = dist(s, e);
  ok(d <= e.bd && d >= e.bd - 0.2 && e.bd >= RANGED_STOP_MIN && e.bd <= RANGED_STOP_MAX, `it stopped ${d.toFixed(2)} yd away (stop distance ${e.bd.toFixed(2)}, between 9 and 12)`);
  ok(!e.moving, 'a shooter at range stands still');
  ok(fires.length >= 5, `it fired ${fires.length} shots in 16 s`);
  ok(fires[0] >= SHOT_FIRST_MIN && fires[0] <= SHOT_FIRST_MAX + 0.05, `the first shot came at ${fires[0].toFixed(2)} s`);
  for (let i = 1; i < fires.length; i++) {
    const gap = fires[i] - fires[i - 1];
    ok(gap >= SHOT_GAP_MIN - 0.03 && gap <= SHOT_GAP_MAX + 0.03, `gap ${gap.toFixed(2)} s is between 2.5 and 3.5`);
  }
  ok(new Set(fires.map((t, i) => i && (t - fires[i - 1]).toFixed(2))).size > 2, 'the gaps are jittered');
  for (const v of shotSpeeds) ok(v >= SHOT_SPEED_MIN - 0.01 && v <= SHOT_SPEED_MAX + 0.01, `shot speed ${v.toFixed(2)} yd/s is slow (8 to 10)`);
  ok(s.mobs.hits >= 4, `${s.mobs.hits} shots hit the standing hero`);
  ok(hurts.length === s.mobs.hits && hurts.every((a) => Math.abs(a - dmg) < 1e-6), `each shot hurt for the mob's damage x0.8 (${dmg.toFixed(2)})`);
  near(s.damageTaken, dmg * s.mobs.hits, 1e-6, 'damage taken is the shots');
}

// shots: hit, miss, expire, armor, and the pool
{
  const s = quiet();
  const m = s.mobs;
  const mk = (x: number, y: number, vx: number, vy: number, ail = 0) => {
    const sh = m.newShot();
    sh.x = x; sh.y = y; sh.vx = vx; sh.vy = vy; sh.life = SHOT_LIFE; sh.age = 0; sh.dmg = 10; sh.tier = LUPIN; sh.ail = ail;
    return sh;
  };
  mk(-3, 0, 9, 0);
  run(s, 1);
  eq([m.shots.length, m.hits, s.damageTaken], [0, 1, 10], 'a shot that crosses the hero hits once and is gone');
  s.armor = 4;
  mk(-3, 0, 9, 0);
  run(s, 1);
  near(s.damageTaken, 16, 1e-9, 'armor takes 4 off a shot (min 1)');
  s.armor = 0;
  mk(-3, 3, 9, 0);
  run(s, 2.1);
  eq([m.shots.length, m.hits], [0, 2], 'a shot that passes 3 yd to the side misses and leaves');
  mk(5, 0, 9, 0);
  run(s, 1.9);
  eq(m.shots.length, 1, 'a shot flying away is still alive after 1.9 s');
  run(s, 0.2);
  eq([m.shots.length, m.hits], [0, 2], 'and expires after 2 s without hitting');
  const pooled = m.shots.length;
  for (let i = 0; i < 10; i++) { mk(40, 40, 1, 1); run(s, 2.1); }
  eq(pooled, m.shots.length, 'expired shots are freed (the pool is reused)');
  // a Clock freezes shots like every other mob
  mk(-3, 0, 9, 0);
  s.field.clockT = 1;
  run(s, 0.5);
  eq(m.shots.length, 1, 'shots freeze under the Ludibrium Clock');
  s.field.clockT = 0;
  run(s, 1);
  eq(m.shots.length, 0, 'and fly on afterwards');
}

// ---- ranged: only 25 shoot at once ----
{
  const s = quiet();
  const es: Enemy[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const e = mob(s, LUPIN, Math.cos(a) * 15, Math.sin(a) * 15);
    e.speed = 0;
    es.push(e);
  }
  run(s, 1);
  eq(s.mobs.shooters, MAX_SHOOTERS, 'with 40 Lupins around, exactly 25 are shooters');
  eq(es.filter((e) => e.shooter).length, MAX_SHOOTERS, 'and the flags agree');
  run(s, 8);
  eq(es.filter((e) => e.shooter).length, MAX_SHOOTERS, 'still 25 after 9 s (the others never join)');
  ok(s.mobs.fired > 25, `${s.mobs.fired} shots fired`);
  const first = es.find((e) => e.shooter)!;
  s.kill(first);
  run(s, 0.1);
  eq(s.mobs.shooters, MAX_SHOOTERS, 'when a shooter dies another takes its place');
  // a ranged mob out of the admit range simply walks
  const far = quiet();
  const w = mob(far, LUPIN, RANGED_ADMIT + 8, 0);
  run(far, 0.5);
  ok(!w.shooter && w.moving, 'a Lupin 34 yd away walks in and is not a shooter yet');
  ok(RANGED_FIRE > RANGED_STOP_MAX, 'shooters fire from where they stand');
}

// ---- charge: telegraph 0.6 s, dash 0.7 s at 3x, cooldown 3 s ----
{
  const s = quiet();
  const p = mob(s, PIG, 11, 0);
  p.dmg = 0; p.hitCd = 1e9; p.bT = 0;
  const speed = p.speed;
  const marks: { t: number; st: number }[] = [];
  let prev = p.bS, tele: { x: number; y: number } | null = null, dashStart: { x: number; y: number } | null = null, dashEnd: { x: number; y: number } | null = null;
  let nextTele = -1;
  run(s, 9, () => {
    if (p.bS !== prev) {
      marks.push({ t: s.t, st: p.bS });
      if (p.bS === CHARGE_TELEGRAPH && !tele) tele = { x: p.x, y: p.y };
      if (p.bS === CHARGE_DASH && !dashStart) dashStart = { x: p.x, y: p.y };
      if (prev === CHARGE_DASH && p.bS === CHARGE_IDLE && !dashEnd) dashEnd = { x: p.x, y: p.y };
      if (p.bS === CHARGE_TELEGRAPH && marks.length > 3 && nextTele < 0) nextTele = s.t;
      prev = p.bS;
    }
    // after the first dash the hero keeps 10 yd away so the cooldown is the only thing in the way of the next rush
    if (dashEnd) { s.px = p.x + 10; s.py = p.y; }
  });
  ok(tele !== null && dashStart !== null && dashEnd !== null, 'the Pig telegraphed, dashed and rested');
  eq(marks.slice(0, 3).map((m) => m.st), [CHARGE_TELEGRAPH, CHARGE_DASH, CHARGE_IDLE], 'telegraph, dash, idle in order');
  near(marks[1].t - marks[0].t, CHARGE_TELEGRAPH_TIME, 0.03, 'the telegraph lasts 0.6 s');
  near(marks[2].t - marks[1].t, CHARGE_DASH_TIME, 0.03, 'the dash lasts 0.7 s');
  ok(Math.hypot(dashStart!.x - tele!.x, dashStart!.y - tele!.y) < 1e-9, 'it stands still while it telegraphs');
  near(Math.hypot(dashEnd!.x - dashStart!.x, dashEnd!.y - dashStart!.y), speed * CHARGE_SPEED * CHARGE_DASH_TIME, 0.15, 'the dash covers 3x its speed for 0.7 s, in a straight line');
  near(dashEnd!.y, dashStart!.y, 1e-6, 'straight (the hero stood on its row)');
  ok(marks.length >= 4 && marks[3].st === CHARGE_TELEGRAPH, 'it rushed a second time');
  near(marks[3].t - marks[2].t, CHARGE_COOLDOWN, 0.06, 'after a cooldown of 3 s');
  ok(CHARGE_MIN === 6 && CHARGE_MAX === 12, 'it rushes from 6 to 12 yd');
}

// charge: range window, sidestep, stun, flee line
{
  const s = quiet();
  const near5 = mob(s, PIG, 5, 0), far13 = mob(s, PIG, 13, 0);
  near5.bT = far13.bT = 0; near5.speed = far13.speed = 0; near5.dmg = far13.dmg = 0; near5.hitCd = far13.hitCd = 1e9;
  run(s, 0.5);
  eq([near5.bS, far13.bS], [CHARGE_IDLE, CHARGE_IDLE], 'a Pig 5 yd away or 13 yd away does not rush');
  far13.x = s.px + 12; near5.x = s.px + 6.5;
  run(s, 0.1);
  eq([near5.bS, far13.bS], [CHARGE_TELEGRAPH, CHARGE_TELEGRAPH], 'within 6 to 12 yd it does');
  eq([near5.bx, near5.by], [-1, 0], 'its dash line is locked toward where the hero stood');
}
{
  // the hero steps aside during the telegraph and is missed; the dash does not turn
  const s = quiet();
  const p = mob(s, PIG, 11, 0);
  p.bT = 0;
  const hp = s.hp;
  s.god = false;
  run(s, 0.1);
  eq(p.bS, CHARGE_TELEGRAPH, 'telegraphing');
  const dir = [p.bx, p.by];
  s.py = 4;
  let minD = 99;
  while (p.bS !== CHARGE_IDLE && s.t < 3) { run(s, 1 / 60); minD = Math.min(minD, dist(s, p)); }
  eq([p.bx, p.by], dir, 'the dash does not follow the hero');
  ok(minD > 2.5, `it passed ${minD.toFixed(1)} yd from the hero who stepped aside`);
  eq(s.hp, hp, 'and missed');
  // a hero in the way is hit, once
  const t = quiet();
  const q = mob(t, PIG, 11, 0);
  q.bT = 0; t.god = false;
  const ev: number[] = [];
  run(t, 2.5, () => { for (const e of t.events) if (e.type === 'playerHit') ev.push(e.amount); });
  ok(ev.length >= 1, 'a hero who stays on the line gets hit by the rush');
}
{
  // a stun cancels the rush
  const s = quiet();
  const p = mob(s, PIG, 11, 0);
  p.bT = 0; p.dmg = 0;
  run(s, 0.1);
  eq(p.bS, CHARGE_TELEGRAPH, 'telegraphing');
  p.stunT = 1;
  run(s, 0.05);
  eq([p.bS, p.atk], [CHARGE_IDLE, 0], 'a stunned charger drops the rush');
  near(p.bT, CHARGE_COOLDOWN, 0.1, 'and rests');
}

// ---- flyers skip the crowding ----
{
  const s = quiet();
  const a = mob(s, SNAIL, 40, 0), b = mob(s, SNAIL, 40.05, 0);
  const c = mob(s, EVIL_EYE, 0, 40), d = mob(s, EVIL_EYE, 0.05, 40);
  for (const e of [a, b, c, d]) { e.speed = 0; e.dmg = 0; e.hitCd = 1e9; }
  c.bd = 0;
  run(s, 0.5);
  ok(Math.abs(a.x - b.x) > 0.3, 'two snails on top of each other are pushed apart');
  near(Math.abs(c.x - d.x), 0.05, 1e-6, 'two Evil Eyes are not (flyers ignore the crowding)');
}

// ---- Elites keep the behaviour of their tier; event mobs and bosses ignore behaviours ----
{
  const s = quiet();
  s.elites.pending = true;
  const e = mob(s, LUPIN, 20, 0);
  maybePromote(s, e);
  ok(e.elite > 0 && e.behave === BEH_RANGED, 'a promoted Lupin is still ranged');
  run(s, 5);
  ok(e.shooter && s.mobs.fired >= 1, 'and the Elite shoots');
}
{
  // top tiers include ranged mobs; a ring of them at 18 yd must not shoot, and treasure Ribbon Pigs (a charge tier) must not rush
  const s = quiet();
  s.t = 730; s.bossesSpawned = 6;
  startSwarm(s, 'ring');
  const ring = s.enemies.filter((e) => e.ev === EV_RING);
  ok(ring.length === 40 && ring.some((e) => e.behave === BEH_RANGED || e.behave === BEH_CHARGE), 'the ring has behaving tiers in it');
  const shooters0 = s.mobs.shooters;
  run(s, 3);
  eq([s.mobs.fired, s.mobs.shooters, shooters0], [0, 0, 0], 'ring mobs never shoot');
  ok(ring.every((e) => !e.shooter && e.bS === CHARGE_IDLE), 'nor charge');
  const t = quiet();
  startSwarm(t, 'treasure');
  const pigs = t.enemies.filter((e) => e.ev === EV_TREASURE);
  ok(pigs.length === 12 && pigs.every((e) => e.behave === BEH_CHARGE), 'treasure pigs are Ribbon Pigs');
  run(t, 5);
  eq(t.mobs.charges, 0, 'treasure pigs never rush');
  const u = quiet();
  startSwarm(u, 'stampede');
  run(u, 3);
  ok(u.enemies.filter((e) => e.ev === EV_STAMPEDE).length > 0 && u.mobs.charges === 0, 'stampede mobs march');
}
{
  // bosses have no behaviour
  const s = quiet();
  s.t = BOSS_EVERY - 0.01;
  run(s, 0.1);
  const b = s.activeBoss()!;
  eq([b.behave, b.fly], [0, false], 'a boss has no mob behaviour');
}

// ---- ailments: effects, expiry, refresh ----
{
  // Seal: skills stop firing, cooldowns keep ticking
  const s = quiet();
  s.skills = [{ key: 'magic_claw', level: 1, cd: 2 }];
  dummy(s, 3, 0);
  applyAilment(s, AIL_SEAL);
  near(s.ail.left[AIL_SEAL], 3, 1e-9, 'Seal lasts 3 s');
  let hits = 0;
  run(s, 1, () => { hits += evOf(s, 'hit').length; });
  near(s.skills[0].cd, 1, 0.03, 'the cooldown ticked while sealed');
  run(s, 1.9, () => { hits += evOf(s, 'hit').length; });
  eq(hits, 0, 'nothing fired for the 2.9 s of Seal');
  run(s, 1, () => { hits += evOf(s, 'hit').length; });
  ok(hits > 0 && !s.ail.seal, 'it fires again once the Seal is over');
}
{
  // Darkness: crit chance 0
  const s = quiet();
  s.skills = [{ key: 'magic_claw', level: 1, cd: 0 }];
  s.crit = 1;
  dummy(s, 3, 0);
  const crits: boolean[] = [];
  run(s, 2, () => { for (const e of evOf(s, 'hit')) crits.push(e.crit); });
  ok(crits.length > 2 && crits.every((c) => c), 'with crit chance 100% every hit crits');
  crits.length = 0;
  applyAilment(s, AIL_DARKNESS);
  near(s.ail.left[AIL_DARKNESS], 5, 1e-9, 'Darkness lasts 5 s');
  run(s, 4.9, () => { for (const e of evOf(s, 'hit')) crits.push(e.crit); });
  ok(crits.length > 4 && crits.every((c) => !c), `no crits for the ${crits.length} hits under Darkness`);
  crits.length = 0;
  run(s, 1, () => { for (const e of evOf(s, 'hit')) crits.push(e.crit); });
  ok(crits.length > 0 && crits.every((c) => c), 'crits are back when it ends');
}
{
  // Weakness: speed x0.6 for 4 s
  const s = quiet();
  s.setInput(1, 0);
  const x0 = s.px;
  run(s, 1);
  near(s.px - x0, s.speed, 0.05, 'a second of running covers the hero speed');
  applyAilment(s, AIL_WEAKNESS);
  near(s.ail.left[AIL_WEAKNESS], 4, 1e-9, 'Weakness lasts 4 s');
  const x1 = s.px;
  run(s, 1);
  near(s.px - x1, s.speed * WEAKNESS_SPEED, 0.05, 'under Weakness the hero covers 0.6 of that');
  run(s, 3.1);
  const x2 = s.px;
  run(s, 1);
  near(s.px - x2, s.speed, 0.05, 'and the full speed after 4 s');
}
{
  // Curse: gems worth 50% for 8 s
  const s = quiet();
  s.dropPickup(GEM, s.px, s.py, 4);
  run(s, 0.05);
  near(s.xp, 4, 1e-9, 'a gem of 4 gives 4 xp');
  s.xp = 0;
  applyAilment(s, AIL_CURSE);
  near(s.ail.left[AIL_CURSE], 8, 1e-9, 'Curse lasts 8 s');
  s.dropPickup(GEM, s.px, s.py, 4);
  run(s, 0.05);
  near(s.xp, 4 * CURSE_GEM, 1e-9, 'a cursed hero gets half');
  run(s, 8);
  s.xp = 0;
  s.dropPickup(GEM, s.px, s.py, 4);
  run(s, 0.05);
  near(s.xp, 4, 1e-9, 'full xp after 8 s');
}
{
  // Poison: 1% max HP per second for 5 s, never kills
  const s = quiet(1, 'magician', { god: false });
  const max = s.maxHp;
  applyAilment(s, AIL_POISON);
  near(s.ail.left[AIL_POISON], 5, 1e-9, 'Poison lasts 5 s');
  run(s, 2);
  near(max - s.hp, max * POISON_FRAC * 2, 0.02, '2 s of Poison cost 2% of max HP');
  run(s, 3.1);
  near(max - s.hp, max * POISON_FRAC * 5, 0.05, 'and 5 s cost 5%');
  const lost = s.hp;
  run(s, 2);
  eq(s.hp, lost, 'nothing after it ends');
  near(s.damageTaken, max * 0.05, 0.05, 'it counts as damage taken');
  const low = quiet(1, 'magician', { god: false });
  low.hp = 1.4;
  applyAilment(low, AIL_POISON);
  run(low, 6);
  ok(!low.over && low.hp === 1, 'Poison stops at 1 HP and cannot kill');
  const g = quiet();
  applyAilment(g, AIL_POISON);
  run(g, 2);
  eq(g.hp, g.maxHp, 'a god-mode hero loses nothing');
}
{
  // no stacking: applying again refreshes to the full time
  const s = quiet();
  applyAilment(s, AIL_WEAKNESS);
  run(s, 3);
  near(s.ail.left[AIL_WEAKNESS], 1, 0.03, '1 s of Weakness left after 3');
  applyAilment(s, AIL_WEAKNESS);
  near(s.ail.left[AIL_WEAKNESS], 4, 1e-9, 'applying again refreshes to 4 s, not 5');
  s.setInput(1, 0);
  const x = s.px;
  run(s, 1);
  near(s.px - x, s.speed * WEAKNESS_SPEED, 0.05, 'and the speed is x0.6, not x0.36');
  applyAilment(s, AIL_SEAL);
  applyAilment(s, AIL_CURSE);
  eq(s.ail.count, 3, 'different ailments run side by side');
  eq(s.ail.applied, 4, 'four were landed');
  // the Holy Symbol halves them
  const h = quiet();
  h.passives.push({ key: 'holy_symbol', level: 1 });
  applyAilment(h, AIL_CURSE);
  near(h.ail.left[AIL_CURSE], 8 * HOLY_SYMBOL_FACTOR, 1e-9, 'the Holy Symbol halves an ailment');
  // the floating text event
  const e = quiet();
  applyAilment(e, AIL_SEAL);
  const ev = evOf(e, 'ailment')[0];
  eq([ev.ail, ev.text], [AIL_SEAL, 'SEALED!'], 'an ailment event carries the floating text');
}

// ---- cures ----
{
  const all = (s: Sim) => { for (const a of AILMENTS) applyAilment(s, a.id); eq(s.ail.count, 5, 'all five are on'); };
  let s = quiet();
  all(s);
  s.dropPickup(ELIXIR, s.px, s.py, 1);
  run(s, 0.05);
  eq(s.ail.count, 0, 'an Elixir pickup cures everything');
  s = quiet();
  all(s);
  useFieldItem(s, FIELD_APPLE, s.px, s.py);
  eq(s.ail.count, 0, 'an Apple cures everything');
  s = quiet();
  all(s);
  s.offer = [{ kind: 'elixir', key: 'elixir', name: 'Elixir', isNew: false, from: 0, to: 0, desc: '' }];
  s.pick(0);
  eq(s.ail.count, 0, 'the Elixir level-up card cures everything');
  s = quiet();
  all(s);
  useFieldItem(s, FIELD_ELIXIR, s.px, s.py);
  eq(s.ail.count, 5, 'a Warrior Elixir (a damage buff) does not');
  s = quiet(1, 'magician');
  s.skills = [{ key: 'heal', level: 1, cd: 0 }];
  dummy(s, 1, 0);
  all(s);
  run(s, 0.05);
  eq(s.ail.count, 5, 'a sealed cleric cannot Heal');
  s.ail.left[AIL_SEAL] = 0;
  run(s, 0.05);
  eq(s.ail.count, 0, 'the cleric Heal cures everything when it fires');
  ok(!cureAilments(s), 'curing with nothing to cure says so');
}

// ---- Curse Eye / Wraith shots carry their ailment about 25% of the time; others never ----
{
  const sample = (t: number) => {
    const s = quiet();
    s.px = 0; s.py = 0;
    for (let i = 0; i < MAX_SHOOTERS; i++) { const a = (i / MAX_SHOOTERS) * Math.PI * 2; const e = mob(s, t, Math.cos(a) * 15, Math.sin(a) * 15); e.speed = 0; }
    let n = 0, withAil = 0, kind = 0;
    run(s, 100, () => {
      for (const sh of s.mobs.shots) if (sh.age < 0.02) { n++; if (sh.ail) { withAil++; kind = sh.ail; } }
    });
    return { n, withAil, kind };
  };
  for (const [t, ail, name] of [[CURSE_EYE, AIL_DARKNESS, 'Curse Eye'], [WRAITH, AIL_CURSE, 'Wraith']] as const) {
    const r = sample(t);
    ok(r.n > 500, `${r.n} ${name} shots sampled`);
    near(r.withAil / r.n, MOB_SHOT_AIL_CHANCE, 0.05, `${name} shots carry an ailment 25% of the time`);
    eq(r.kind, ail, `${name}: the ailment is ${AILMENTS[ail - 1].name}`);
  }
  for (const t of [LUPIN, EVIL_EYE]) {
    const r = sample(t);
    ok(r.n > 500 && r.withAil === 0, `${LADDER[t].name} shots carry no ailment`);
  }
  // landing: a Darkness shot that hits applies it, a plain shot does not
  const s = quiet();
  const a = s.mobs.newShot();
  a.x = -2; a.y = 0; a.vx = 9; a.vy = 0; a.life = 2; a.age = 0; a.dmg = 5; a.tier = CURSE_EYE; a.ail = AIL_DARKNESS;
  run(s, 0.5);
  ok(s.ail.dark, 'a Darkness shot that hits darkens the hero');
  const t = quiet();
  const b = t.mobs.newShot();
  b.x = -2; b.y = 0; b.vx = 9; b.vy = 0; b.life = 2; b.age = 0; b.dmg = 5; b.tier = CURSE_EYE; b.ail = 0;
  run(t, 0.5);
  eq(t.ail.count, 0, 'a plain shot does not');
}

// ---- boss ailment cast ----
{
  const s = quiet();
  s.t = BOSS_EVERY - 0.01;
  s.px = 0; s.py = 0;
  run(s, 0.1);
  const mano = s.activeBoss()!;
  eq(BOSSES[mano.boss].name, 'Mano', 'Mano is the first boss');
  mano.x = 3; mano.y = 0; // right next to the hero
  mano.novaT = 1e9; // only the ailment is of interest here
  near(mano.ailT, AIL_EVERY, 0.2, 'its ailment timer starts at 16 s');
  const raids: string[] = [];
  let cast0 = -1, hit: SimEvent | null = null;
  run(s, 17.6, () => {
    for (const e of s.events) {
      if (e.type === 'raid') raids.push(e.text);
      if (e.type === 'ailHit') hit = e;
    }
    if (cast0 < 0 && mano.ailC > 0) { cast0 = s.t; mano.x = 3; mano.y = 0; }
    mano.x = 3; mano.y = 0; // it would walk up; keep the geometry simple (it stops to cast anyway)
  });
  ok(raids.includes('Mano casts Weakness!'), 'raid warning: "Mano casts Weakness!"');
  ok(cast0 - BOSS_EVERY >= 15.9 && cast0 - BOSS_EVERY <= 16.3, `the cast started ${(cast0 - BOSS_EVERY).toFixed(2)} s after the boss appeared`);
  ok(hit !== null && (hit as Extract<SimEvent, { type: 'ailHit' }>).hit && (hit as Extract<SimEvent, { type: 'ailHit' }>).r === AIL_RADIUS, 'the circle landed with the hero inside');
  ok(s.ail.weak, 'the hero is weakened');
  eq(s.ail.count, 1, 'by Weakness only');
  // outside the circle: nothing
  const t = quiet();
  t.t = BOSS_EVERY - 0.01;
  run(t, 0.1);
  const m2 = t.activeBoss()!;
  m2.novaT = 1e9; m2.speed = 0;
  m2.x = t.px + AIL_RADIUS + 3; m2.y = t.py;
  let outside: Extract<SimEvent, { type: 'ailHit' }> | null = null;
  run(t, 18, () => { for (const e of t.events) if (e.type === 'ailHit') outside = e; });
  ok(outside !== null && !(outside as Extract<SimEvent, { type: 'ailHit' }>).hit, 'a hero outside the circle is not hit');
  eq(t.ail.count, 0, 'and gets nothing');
  // the boss stands still while it casts
  const u = quiet();
  u.t = BOSS_EVERY - 0.01;
  u.px = 0; u.py = 0;
  run(u, 0.1);
  const m3 = u.activeBoss()!;
  m3.novaT = 1e9;
  m3.ailT = 0.01;
  run(u, 0.1);
  ok(m3.ailC > 0, 'casting');
  const bx = m3.x, by = m3.y;
  run(u, 0.5);
  eq([m3.x, m3.y], [bx, by], 'the boss does not move while it casts');
  run(u, 1);
  ok(m3.ailC === 0 && m3.ailT > AIL_EVERY - 1 && m3.ailT <= AIL_EVERY, 'the next cast is 16 s after the last one lands');
}
{
  // Zakum brings Darkness and Seal; each boss lands its own
  const s = quiet();
  s.t = BOSS_EVERY * 6 - 0.01;
  s.bossesSpawned = 5;
  s.px = 0; s.py = 0;
  run(s, 0.1);
  const bosses = s.enemies.filter((e) => e.boss >= 0);
  eq(bosses.map((b) => BOSSES[b.boss].name).sort(), ['Jr. Balrog', 'Zakum', 'Zombie Mushmom'], 'a Zakum wave: Zakum, Jr. Balrog, Zombie Mushmom');
  for (const b of bosses) { b.novaT = 1e9; b.summonT = 1e9; b.speed = 0; b.x = 0; b.y = 0; b.ailT = b.boss === 5 ? 0.01 : 1e9; }
  const raids: string[] = [];
  run(s, 2, () => { for (const e of s.events) if (e.type === 'raid') raids.push(e.text); });
  ok(raids.includes('Zakum casts Darkness and Seal!'), 'raid warning: "Zakum casts Darkness and Seal!"');
  ok(s.ail.dark && s.ail.seal && s.ail.count === 2, 'Zakum lands Darkness and Seal together');
  const t = quiet();
  t.t = BOSS_EVERY * 5 - 0.01;
  t.bossesSpawned = 4;
  run(t, 0.1);
  for (const b of t.enemies.filter((e) => e.boss >= 0)) { b.novaT = 1e9; b.summonT = 1e9; b.speed = 0; b.x = 0; b.y = 0; b.ailT = b.boss === 4 ? 0.01 : 1e9; }
  run(t, 2);
  ok(t.ail.seal && t.ail.count === 1, 'Jr. Balrog lands Seal');
  // the Ground Slam has priority: the ailment timer waits while it casts
  const u = quiet();
  u.t = BOSS_EVERY - 0.01;
  run(u, 0.1);
  const m = u.activeBoss()!;
  m.castT = 1; m.ailT = 0.01;
  run(u, 0.5);
  eq(m.ailC, 0, 'no ailment cast starts during a Ground Slam');
  near(m.ailT, 0.01, 0.001, 'its timer waits');
}

// ---- mobAi: false is the old game ----
{
  const s = quiet(1, 'magician', { mobAi: false });
  const l = mob(s, LUPIN, 20, 0), p = mob(s, PIG, 11, 0);
  s.t = BOSS_EVERY - 0.01;
  run(s, 20);
  eq([s.mobs.fired, s.mobs.charges, s.mobs.shooters, l.shooter, p.bS], [0, 0, 0, false, CHARGE_IDLE], 'no shots, no charges');
  const b = s.activeBoss()!;
  eq([b.ailC, s.ail.applied], [0, 0], 'no boss ailment casts');
  const f = mob(s, EVIL_EYE, 0, 40);
  ok(!f.fly, 'no flyers');
}

// ---- the bot sidesteps ----
{
  const s = quiet();
  const p = mob(s, PIG, -8, 0);
  p.bS = CHARGE_TELEGRAPH; p.bx = 1; p.by = 0; p.speed = 0; p.bT = 1;
  s.py = 0.5; // slightly below the line
  let i = botInput(s, 1);
  ok(Math.abs(i.y) > 0.8 && i.y > 0, `the bot steps off the charge line (${i.x.toFixed(2)}, ${i.y.toFixed(2)})`);
  s.py = -0.5;
  i = botInput(s, 1);
  ok(i.y < -0.8, 'to the side it is already on');
  p.bS = CHARGE_IDLE;
  s.py = 0;
  const sh = s.mobs.newShot();
  sh.x = -6; sh.y = 0; sh.vx = 9; sh.vy = 0; sh.life = 2; sh.age = 0; sh.dmg = 1; sh.tier = LUPIN; sh.ail = 0;
  s.py = 0.2;
  i = botInput(s, 1);
  ok(Math.abs(i.y) > 0.8, 'and out of the way of an incoming shot');
  s.mobs.freeShot(0);
  // out of a boss's ailment circle
  const t = quiet();
  t.t = BOSS_EVERY - 0.01;
  run(t, 0.1);
  const b = t.activeBoss()!;
  b.x = t.px + 3; b.y = t.py; b.ailC = 1; b.speed = 0; b.novaT = 1e9;
  i = botInput(t, 1);
  ok(i.x < -0.5, 'the bot runs out of the circle of a casting boss');
}

// ---- determinism ----
{
  const fp = (seed: number) => {
    const s = new Sim(seed, 'warrior');
    s.god = true;
    // minute 10:40, where the pool holds Curse Eyes, Fire Boars and Jr. Boogies: shots, ailments and charges all happen
    s.t = 640; s.bossesSpawned = 6;
    const log: string[] = [];
    const end = 700;
    while (!s.over && s.t < end) {
      if (s.offer) { s.pick(0); continue; }
      const i = botInput(s, 1);
      s.setInput(i.x, i.y);
      s.tick();
      for (const e of s.events) if (e.type === 'ailment' || e.type === 'ailHit') log.push(`${s.t.toFixed(2)}:${e.type}`);
      s.events.length = 0;
    }
    return JSON.stringify([s.snapshot(), log, s.enemies.map((e) => [e.x.toFixed(3), e.y.toFixed(3), e.hp.toFixed(1), e.bS, e.bT.toFixed(3), e.shooter]), s.mobs.shots.map((x) => [x.x.toFixed(3), x.y.toFixed(3)])]);
  };
  const a = fp(60), b = fp(60), c = fp(61);
  eq(a, b, 'the same seed plays out identically (shots, charges, ailments)');
  ok(a !== c, 'a different seed does not');
  const snap = JSON.parse(a)[0];
  ok(snap.mob.fired > 5 && snap.mob.charges > 5, `the run had ${snap.mob.fired} shots and ${snap.mob.charges} charges in it`);
  // the main random stream is not shifted: the same spawns with the behaviours off
  const off = new Sim(60, 'warrior', { mobAi: false }), on = new Sim(60, 'warrior');
  for (let i = 0; i < 600; i++) { off.tick(); on.tick(); }
  eq(off.enemies.map((e) => [e.tier, e.add]).slice(0, 5), on.enemies.map((e) => [e.tier, e.add]).slice(0, 5), 'behaviours use their own random stream (the spawns are the same)');
  const sn = new Sim(1, 'magician').snapshot();
  ok('mob' in sn && 'ailments' in sn && sn.mob.on, 'snapshot() carries mob and ailment data');
}

// ---- balance: the bot still wins with all of it, for all four classes ----
for (const c of CLASSES) {
  const s = new Sim(7919, c.key);
  let ticks = 0;
  while (!s.over && ticks < 900 * 60 + 10) {
    if (s.offer) { s.pick(0); continue; }
    const i = botInput(s, 1);
    s.setInput(i.x, i.y);
    s.tick();
    ticks++;
    s.events.length = 0;
  }
  ok(s.won, `${c.name}: the bot wins a mortal run with behaviours and ailments (seed 7919)`);
  ok(s.mobs.fired > 0 && s.mobs.charges > 0, `${c.name}: ${s.mobs.fired} shots and ${s.mobs.charges} charges`);
}

console.log(`test-mobs: ${checks} checks passed`);
