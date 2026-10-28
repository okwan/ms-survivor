// Run: node --experimental-strip-types scripts/test-events.ts
// Elites (src/game/elites.ts), swarm events (events.ts) and field items (fieldItems.ts): the elite schedule and affixes, elite drops, the
// stampede / ring / treasure events (spawn, march, despawn, never recycled), breakable boxes, every field item's effect, the bot's
// detours, determinism for a fixed seed, and that no Elite appears while two bosses are alive.
import assert from 'node:assert/strict';
import { botInput } from '../src/game/bot.ts';
import { BOSS_EVERY, CLASSES, LADDER, SKILL_BY_KEY, SKILL_MAX_LEVEL, SPAWN_RING_MAX, SPAWN_RING_MIN, aliveTarget, jobOfId, poolLo, progress, unlockedJobs } from '../src/game/data.ts';
import {
  AFFIXES, AFFIX_ARMORED, AFFIX_BLAZING, AFFIX_SPLITTING, AFFIX_SWIFT, AFFIX_VAMPIRIC, ARMOR_REDUCE, ELITE_BOSS_LIMIT, ELITE_DMG, ELITE_FIRST, ELITE_GAP_MAX, ELITE_GAP_MIN,
  ELITE_SCALE, FIRE_DELAY, FIRE_EVERY, SPLIT_COUNT, SWIFT_SPEED, VAMP_HEAL, eliteHpMult, eliteTitle, maybePromote,
} from '../src/game/elites.ts';
import {
  RING_COUNT, RING_RADIUS, STAMPEDE_MAX, STAMPEDE_MIN, STAMPEDE_SPEED, SWARM_BANNERS, SWARM_BOSS_MARGIN, SWARM_GAP_MAX, SWARM_GAP_MIN, TREASURE_COUNT, TREASURE_MESO_MULT,
  TREASURE_SECONDS, TREASURE_TIER, startSwarm,
} from '../src/game/events.ts';
import {
  APPLE_HEAL, BOX_GAP_MAX, BOX_GAP_MIN, BOX_MAX, CLOCK_BOSS_SLOW, CLOCK_SECONDS, COUPON_SECONDS, ELIXIR_DAMAGE, ELIXIR_SECONDS, FIELD_APPLE, FIELD_CLOCK, FIELD_COUPON, FIELD_ELIXIR,
  FIELD_ITEMS, FIELD_KEG, KEG_BOSS_FRAC, KEG_RADIUS, boxCount, rollFieldItem, useFieldItem,
} from '../src/game/fieldItems.ts';
import { ELITE_CAPSULE, applyUpgrades } from '../src/game/gachapon.ts';
import { RECIPES } from '../src/game/evolutions.ts';
import { Rng } from '../src/game/rng.ts';
import { Sim } from '../src/game/sim.ts';
import { BAG, EV_BOX, EV_RING, EV_STAMPEDE, EV_TREASURE, FIELD, GACHA, GEM, MESO } from '../src/game/types.ts';
import type { Enemy, SimEvent } from '../src/game/types.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };
const near = (a: number, b: number, tol: number, m: string) => { checks++; assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b} +- ${tol})`); };

/** a hero that cannot attack and cannot die, standing still, so only what a test sets up happens */
function quiet(seed = 1, cls = 'magician', events = true) {
  const s = new Sim(seed, cls, { events });
  s.skills = [];
  s.god = true;
  return s;
}
const run = (s: Sim, seconds: number, each?: () => void) => {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n && !s.over; i++) {
    s.offer = null; s.pendingLevels = 0; // level-ups would pause the run; these tests are not about cards
    s.tick();
    each?.();
    s.events.length = 0;
  }
};
const mob = (s: Sim, x: number, y: number, tier = 0) => {
  const e = s.spawnEnemy(tier, s.px + x, s.py + y, true);
  e.speed = 0; e.dmg = 0; e.hitCd = 1e9;
  return e;
};
const evOf = <T extends SimEvent['type']>(s: Sim, type: T) => s.events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
const count = (s: Sim, f: (e: Enemy) => boolean) => s.enemies.reduce((n, e) => n + (e.alive && f(e) ? 1 : 0), 0);

/** the bot plays seconds of the run; calls `each` after every tick (events are cleared afterwards) */
function bot(s: Sim, seconds: number, each?: () => void) {
  const end = Math.min(900, s.t + seconds);
  while (!s.over && s.t < end) {
    if (s.offer) { s.pick(0); continue; }
    const i = botInput(s, 1);
    s.setInput(i.x, i.y);
    s.tick();
    each?.();
    s.events.length = 0;
  }
}

// ---- tables ----
{
  eq(AFFIXES.map((a) => a.key), ['swift', 'armored', 'splitting', 'blazing', 'vampiric'], 'five affixes');
  eq(new Set(AFFIXES.map((a) => a.tint)).size, 5, 'each affix has its own tint');
  eq(FIELD_ITEMS.map((d) => d.weight), [35, 20, 20, 15, 10], 'field item weights: Apple 35, Coupon 20, Elixir 20, Clock 15, Keg 10');
  const rng = new Rng(5);
  const n = [0, 0, 0, 0, 0];
  const N = 40000;
  for (let i = 0; i < N; i++) n[rollFieldItem(rng)]++;
  FIELD_ITEMS.forEach((d, i) => near(n[i] / N, d.weight / 100, 0.01, `${d.name} drops about ${d.weight}% of the time`));
  eq(SWARM_BANNERS, { stampede: 'Snail stampede!', ring: 'You are surrounded!', treasure: 'Treasure Pigs! Catch them!' }, 'event banners');
  near(eliteHpMult(0), 6, 1e-9, 'Elite HP x6 at the start'); near(eliteHpMult(1), 12, 1e-9, 'x12 at the end');
}

// ---- elite schedule: first at 0:45 or later, one per 50 to 70 s ----
for (const seed of [3, 11, 29]) {
  const s = new Sim(seed, 'warrior');
  s.god = true;
  const at: number[] = [];
  const banners: string[] = [];
  bot(s, 900, () => {
    for (const e of s.events) if (e.type === 'elite') at.push(s.t);
    for (const e of s.events) if (e.type === 'raid' && /^An Elite/.test(e.text)) banners.push(e.text);
  });
  ok(at.length >= 11 && at.length <= 18, `seed ${seed}: ${at.length} Elites in 15 minutes`);
  ok(at[0] >= ELITE_FIRST - 0.01 && at[0] < ELITE_FIRST + 12, `seed ${seed}: the first Elite at ${at[0]?.toFixed(1)} s (from 0:45)`);
  let gapsOk = true;
  for (let i = 1; i < at.length; i++) { const g = at[i] - at[i - 1]; if (g < ELITE_GAP_MIN - 0.01 || g > ELITE_GAP_MAX + 20) gapsOk = false; }
  ok(gapsOk, `seed ${seed}: gaps between Elites ${at.slice(1).map((t, i) => (t - at[i]).toFixed(0)).join(' ')} s are 50 to 70 s (plus the wait for a spawn)`);
  eq(banners.length, at.length, `seed ${seed}: a banner for every Elite`);
  ok(banners.every((b) => /^An Elite .+ appears!$/.test(b)), `seed ${seed}: banner text "An Elite <Name> appears!" (${banners[0]})`);
}

// ---- promotion: stats and the affixes ----
function promoted(seed: number, tier: number, t: number, affix: number) {
  const s = quiet(seed);
  s.t = t;
  const base = s.spawnEnemy(tier, 10, 0, false);
  const baseHp = base.maxHp, baseDmg = base.dmg, baseR = base.r, baseSpeed = base.speed;
  s.enemies.length = 0;
  const e = s.spawnEnemy(tier, 10, 0, false);
  s.elites.pending = true;
  maybePromote(s, e);
  e.elite = affix;
  return { s, e, baseHp, baseDmg, baseR, baseSpeed };
}
{
  const { s, e, baseHp, baseDmg, baseR } = promoted(1, 7, 450, AFFIX_ARMORED);
  const p = progress(450);
  near(e.maxHp, baseHp * (6 + 6 * p), 1e-6, 'Elite HP is x(6 + 6p)');
  near(e.dmg, baseDmg * ELITE_DMG, 1e-9, 'Elite damage x1.3');
  near(e.r, baseR * ELITE_SCALE, 1e-9, 'Elite hit radius and drawn size x1.5');
  ok(e.big && e.elite > 0, 'an Elite counts as big (HP bar) and carries an affix');
  eq(s.elites.pending, false, 'the promotion is used up');
  eq(s.elites.spawned, 1, 'spawned counter');
  ok(s.t + ELITE_GAP_MIN - 1e-9 <= s.elites.nextAt && s.elites.nextAt <= s.t + ELITE_GAP_MAX + 1e-9, 'the next one is 50 to 70 s away');
  eq(eliteTitle(e), 'Elite Orange Mushroom', 'title "Elite Orange Mushroom"');
  eq(evOf(s, 'elite').length, 1, 'an elite event');
  eq(s.raidText, 'An Elite Orange Mushroom appears!', 'raid banner');
  ok(count(s, (x) => x.elite > 0) === 1, 'exactly one Elite alive');
}
{
  // every affix is rolled eventually
  const seen = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const s = quiet(100 + i);
    s.t = 100;
    const e = s.spawnEnemy(2, 5, 0, false);
    s.elites.pending = true;
    maybePromote(s, e);
    seen.add(e.elite);
  }
  eq([...seen].sort(), [1, 2, 3, 4, 5], 'all five affixes get rolled');
}
{
  // Swift: x1.5 speed (never past the hero's speed)
  let found = 0;
  for (let i = 0; i < 80 && !found; i++) {
    const q = quiet(300 + i);
    q.t = 200;
    const m = q.spawnEnemy(7, 10, 0, false);
    const sp0 = m.speed;
    q.elites.pending = true;
    maybePromote(q, m);
    if (m.elite === AFFIX_SWIFT) {
      found++;
      near(m.speed, Math.min(sp0 * SWIFT_SPEED, 0.95 * q.cls.speed), 1e-9, 'Swift: x1.5 speed (capped under the hero\'s speed)');
      ok(m.speed > sp0, 'Swift is faster');
    } else near(m.speed, sp0, 1e-9, 'other affixes keep the mob\'s speed');
  }
  eq(found, 1, 'found a Swift roll');
}
{
  // Armored: every hit does 40% less
  const { s, e } = promoted(3, 7, 300, AFFIX_ARMORED);
  const plain = s.spawnEnemy(7, 10, 1, false);
  plain.maxHp = plain.hp = e.maxHp = e.hp = 1e9;
  s.crit = 0;
  s.curSkill = 'magic_claw';
  s.hit(plain, 100);
  s.hit(e, 100);
  const lossPlain = 1e9 - plain.hp, lossElite = 1e9 - e.hp;
  eq(lossElite, Math.max(1, Math.round(lossPlain * (1 - ARMOR_REDUCE))), `Armored takes ${Math.round(ARMOR_REDUCE * 100)}% less (${lossElite} vs ${lossPlain})`);
  ok(lossElite < lossPlain, 'less damage than a plain mob');
}
{
  // Splitting: four normal mobs of its tier on death, and only then
  const { s, e } = promoted(4, 9, 300, AFFIX_SPLITTING);
  e.hp = 1;
  const before = s.enemies.length;
  s.curSkill = 'magic_claw';
  s.hit(e, 1000);
  eq(s.enemies.length - before, SPLIT_COUNT, 'Splitting: four mobs appear');
  const kids = s.enemies.filter((x) => x.alive && x !== e);
  ok(kids.length >= SPLIT_COUNT && kids.slice(-SPLIT_COUNT).every((k) => k.tier === 9 && !k.elite && k.boss < 0), 'they are normal mobs of the same tier');
  const { s: s2, e: e2 } = promoted(4, 9, 300, AFFIX_ARMORED);
  e2.hp = 1;
  const b2 = s2.enemies.length;
  s2.curSkill = 'magic_claw';
  s2.hit(e2, 1000);
  eq(s2.enemies.length, b2, 'other affixes do not split');
}
{
  // Blazing: a fire patch every second, standing in it hurts only after a short while, stepping out stops it
  const { s, e } = promoted(5, 9, 100, AFFIX_BLAZING);
  e.x = s.px + 12; e.y = s.py; e.speed = 0;
  e.evT = FIRE_EVERY;
  run(s, 3.6);
  const fires = s.elites.fires.length;
  ok(fires >= 3 && fires <= 4, `Blazing: ${fires} fire patches after 3.6 s (one per second)`);
  ok(s.elites.fires.every((f) => Math.abs(f.x - e.x) < 1e-6 && f.dmg > 0), 'patches lie where the Elite stood');
  s.hp = s.maxHp;
  s.god = false;
  s.enemies.length = 0;
  s.elites.fires.length = 0;
  s.elites.addFire(s.px, s.py, 12);
  const hp0 = s.hp;
  run(s, FIRE_DELAY - 0.15);
  eq(s.hp, hp0, 'standing in fire for a moment does not hurt yet');
  run(s, 0.4);
  ok(s.hp < hp0, 'then it burns');
  const hp1 = s.hp;
  run(s, 1.2);
  ok(s.hp < hp1, 'and keeps burning while you stand in it');
  s.hp = s.maxHp;
  s.px += 10;
  const hp2 = s.hp;
  run(s, 1);
  eq(s.hp, hp2, 'walking out of the fire stops the damage');
  run(s, 5);
  eq(s.elites.fires.length, 0, 'patches burn out');
}
{
  // Vampiric: heals 3% max HP when it hits the hero
  const { s, e } = promoted(6, 9, 100, AFFIX_VAMPIRIC);
  s.god = false;
  s.hp = s.maxHp;
  e.x = s.px + 0.3; e.y = s.py; e.hitCd = 0; e.speed = 0; e.dmg = 3;
  e.hp = e.maxHp * 0.5;
  const hp0 = e.hp;
  run(s, 0.1);
  ok(s.hp < s.maxHp, 'the Elite hit the hero');
  near(e.hp - hp0, e.maxHp * VAMP_HEAL, 1e-6, 'Vampiric heals 3% of its max HP per hit');
}

// ---- no Elite while two bosses live ----
{
  const s = quiet(8);
  s.t = BOSS_EVERY * 3 - 0.05;
  s.bossesSpawned = 2;
  s.elites.nextAt = 0;
  run(s, 0.2);
  eq(count(s, (e) => e.boss >= 0), 2, 'wave 3 brings two bosses');
  s.elites.pending = true;
  run(s, 6);
  eq(s.elites.spawned, 0, 'no Elite appears while two bosses are alive');
  eq(s.elites.pending, true, 'the promotion waits');
  const bosses = s.enemies.filter((e) => e.alive && e.boss >= 0);
  bosses[0].alive = false;
  run(s, 6);
  eq(s.elites.spawned, 1, 'with one boss left, the waiting Elite appears');
  eq(ELITE_BOSS_LIMIT, 2, 'the limit is two bosses');
}
for (const seed of [2, 6]) {
  const s = new Sim(seed, 'magician');
  s.god = true;
  let bad = 0;
  bot(s, 900, () => { for (const e of s.events) if (e.type === 'elite' && count(s, (x) => x.boss >= 0) >= 2) bad++; });
  eq(bad, 0, `seed ${seed}: no Elite promoted with two or more bosses alive in a whole run`);
}

// ---- elite loot ----
{
  const { s, e } = promoted(9, 12, 400, AFFIX_VAMPIRIC);
  s.curSkill = 'magic_claw';
  s.pickups.length = 0;
  const kills = s.kills, scrolls = s.scrollDrops;
  e.hp = 1;
  s.hit(e, 1e6);
  const caps = s.pickups.filter((p) => p.kind === GACHA);
  eq(caps.length, 1, 'a Gachapon capsule drops');
  ok(caps[0].value >= ELITE_CAPSULE, 'it is marked as an Elite capsule');
  const bag = s.pickups.find((p) => p.kind === BAG);
  ok(bag !== undefined && bag.value >= 50, `a big meso bag (${bag?.value})`);
  ok(s.pickups.some((p) => p.kind === FIELD), 'a field item drops');
  eq(s.scrollDrops - scrolls, 1, 'a guaranteed scroll');
  ok(s.pickups.some((p) => p.kind === 6), 'the scroll lies on the ground');
  eq(s.kills - kills, 1, 'it counts as a kill');
  eq(s.elites.killed, 1, 'Elites killed: 1');
  eq(s.snapshot().elitesKilled, 1, 'snapshot() counts it');
  // the capsule holds exactly one upgrade
  const t = new Sim(12, 'magician');
  t.skills = [{ key: 'magic_claw', level: 1, cd: 0 }];
  t.god = true;
  for (let i = 0; i < 30; i++) {
    t.dropPickup(GACHA, 0.1, 0, ELITE_CAPSULE + 2);
    t.tick();
  }
  const ge = t.events.filter((x): x is Extract<SimEvent, { type: 'gacha' }> => x.type === 'gacha');
  eq(ge.length, 30, 'thirty capsules opened');
  ok(ge.every((x) => x.count === 1 && x.results.length === 1 && x.elite === true), 'every Elite capsule holds exactly 1 upgrade');
  ok(t.skills[0].level > 1 || t.mesos > 0, 'the upgrade was applied');
  // a boss capsule next to it still rolls 1, 3 or 5
  const u = new Sim(13, 'magician');
  u.god = true;
  const counts = new Set<number>();
  for (let i = 0; i < 60; i++) { u.dropPickup(GACHA, 0.1, 0, 6); u.tick(); }
  for (const x of u.events) if (x.type === 'gacha') { counts.add(x.count); ok(!x.elite, 'boss capsules are not Elite capsules'); }
  ok(counts.has(1) && (counts.has(3) || counts.has(5)), 'boss capsules keep their 1 / 3 / 5 roll');
}
{
  // the Mastery Book still comes first when a recipe is ready, even from an Elite capsule
  const r = RECIPES[0];
  const cls = CLASSES.find((c) => c.skills.includes(r.base))!;
  const s = new Sim(3, cls.key);
  s.branch = jobOfId(SKILL_BY_KEY[r.base].id) - 1;
  s.jobs = unlockedJobs(cls, s.branch, 70);
  s.level = 70;
  s.skills.push({ key: r.base, level: SKILL_MAX_LEVEL, cd: 0 });
  s.passives.push({ key: r.partner, level: 1 });
  s.recalc();
  s.god = true;
  s.dropPickup(GACHA, 0.1, 0, ELITE_CAPSULE + 1);
  s.tick();
  const ge = s.events.find((x): x is Extract<SimEvent, { type: 'gacha' }> => x.type === 'gacha')!;
  eq(ge.results.length, 1, 'one upgrade');
  eq(ge.results[0].kind, 'evolve', 'the Elite capsule gives the Mastery Book first');
  eq(applyUpgrades(s, 1, 1)[0].kind === 'evolve', false, 'and the recipe is used up afterwards');
}

// ---- swarm events: stampede ----
{
  const s = quiet(14);
  s.t = 200;
  startSwarm(s, 'stampede');
  const col = s.enemies.filter((e) => e.ev === EV_STAMPEDE);
  ok(col.length >= STAMPEDE_MIN && col.length <= STAMPEDE_MAX, `stampede of ${col.length} mobs (30 to 50)`);
  eq(s.raidText, 'Snail stampede!', 'banner');
  ok(evOf(s, 'swarm').length === 1 && evOf(s, 'swarm')[0].kind === 'stampede', 'swarm event');
  const dir = { x: col[0].vx, y: col[0].vy };
  ok(Math.abs(dir.x) + Math.abs(dir.y) === 1 && col.every((e) => e.vx === dir.x && e.vy === dir.y), 'one fixed cardinal direction');
  ok(col.every((e) => e.add), 'marked as added on top of the target');
  const tiers = new Set(col.map((e) => e.tier));
  ok([...tiers].every((t) => LADDER[t].name.includes('Snail')), `Snails (${[...tiers].map((t) => LADDER[t].name).join(', ')})`);
  {
    const late = quiet(14);
    late.t = 700;
    startSwarm(late, 'stampede');
    ok(late.enemies.every((e) => e.tier === poolLo(700)), 'late in the run the column is the current low tier');
  }
  ok(col.every((e) => -((e.x - s.px) * dir.x + (e.y - s.py) * dir.y) >= 36), 'they start behind the hero, off screen');
  ok(col.every((e) => Math.abs((e.x - s.px) * dir.y - (e.y - s.py) * dir.x) < 22), 'the column is centred near the hero');
  const e0 = col[0], sp0 = e0.speed;
  const base = LADDER[e0.tier].speed;
  near(sp0, Math.min(base, 0.95 * s.cls.speed) * STAMPEDE_SPEED, 1.2, 'speed is 1.6x the mob\'s');
  ok(sp0 > base, 'faster than a normal Snail');
  // they cross the hero in a straight line, never turn, never get recycled, and are gone after the far edge
  const startAlong = (e: Enemy) => (e.x - s.px) * dir.x + (e.y - s.py) * dir.y;
  let back = 0, maxAlong = -99, off = 0;
  const lat0 = new Map(col.map((e) => [e, (e.x - s.px) * dir.y - (e.y - s.py) * dir.x]));
  let prev = startAlong(e0);
  const kills = s.kills;
  run(s, 60, () => {
    if (e0.alive && e0.ev === EV_STAMPEDE) { const a = startAlong(e0); if (a < prev - 1e-6) back++; prev = a; if (a > maxAlong) maxAlong = a; }
    for (const e of col) if (e.alive && e.ev === EV_STAMPEDE && Math.abs(((e.x - s.px) * dir.y - (e.y - s.py) * dir.x) - lat0.get(e)!) > 1e-6) off++;
  });
  eq(back, 0, 'a stampede mob never moves backwards (no recycling onto the ring)');
  eq(off, 0, 'they keep their lane: straight through, ignoring the hero');
  ok(maxAlong > 30, `they run past the hero to ${maxAlong.toFixed(0)} yd ahead`);
  eq(count(s, (e) => e.ev === EV_STAMPEDE), 0, 'the whole column has left after 60 s');
  eq(s.kills, kills, 'leaving is not killing (no loot)');
}
{
  // a stampede does not stop the normal spawner (it is added on top of the alive target)
  const s = quiet(15);
  s.t = 200;
  run(s, 20);
  const normal0 = count(s, (e) => !e.ev && e.boss < 0);
  startSwarm(s, 'stampede');
  run(s, 6);
  const normal1 = count(s, (e) => !e.ev && e.boss < 0);
  ok(normal1 >= normal0 - 2, `normal population unchanged by the stampede (${normal0} -> ${normal1}, target ${aliveTarget(s.t)})`);
}
{
  // hero running with a stampede cannot drag it along forever
  const s = quiet(16);
  s.t = 100;
  startSwarm(s, 'stampede');
  const dirx = s.enemies.find((e) => e.ev === EV_STAMPEDE)!;
  s.setInput(dirx.vx, dirx.vy);
  run(s, 70);
  eq(count(s, (e) => e.ev === EV_STAMPEDE), 0, 'even a hero running along with it loses the column in the end');
}

// ---- swarm events: closing ring ----
{
  const s = quiet(17);
  s.t = 400;
  s.enemies.length = 0;
  startSwarm(s, 'ring');
  const ring = s.enemies.filter((e) => e.ev === EV_RING);
  eq(ring.length, RING_COUNT, '40 mobs in the ring');
  eq(s.raidText, 'You are surrounded!', 'banner');
  ok(ring.every((e) => Math.abs(Math.hypot(e.x - s.px, e.y - s.py) - RING_RADIUS) < 1e-6), 'all at 18 yd');
  const angles = ring.map((e) => Math.atan2(e.y - s.py, e.x - s.px)).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
  ok(gap < (Math.PI * 2) / RING_COUNT + 0.01 && Math.PI * 2 - (angles[angles.length - 1] - angles[0]) < 0.2, 'a full ring, evenly spaced');
  const top = Math.min(29, poolLo(400) + 2);
  ok(ring.every((e) => e.tier === top), `the current top tier (${LADDER[top].name})`);
  const d0 = ring.map((e) => Math.hypot(e.x - s.px, e.y - s.py));
  s.skills = [];
  for (const e of ring) e.speed = LADDER[e.tier].speed;
  run(s, 2);
  const closer = ring.filter((e, i) => Math.hypot(e.x - s.px, e.y - s.py) < d0[i] - 3).length;
  ok(closer >= 36, `they walk inward (${closer} of 40 are 3 yd closer after 2 s)`);
}

// ---- swarm events: treasure pigs ----
{
  const s = quiet(18);
  s.t = 250;
  s.enemies.length = 0;
  startSwarm(s, 'treasure');
  const pigs = s.enemies.filter((e) => e.ev === EV_TREASURE);
  eq(pigs.length, TREASURE_COUNT, '12 pigs');
  eq(s.raidText, 'Treasure Pigs! Catch them!', 'banner');
  ok(pigs.every((e) => e.tier === TREASURE_TIER && LADDER[e.tier].name === 'Ribbon Pig'), 'Ribbon Pigs');
  ok(pigs.every((e) => e.speed >= s.cls.speed * 0.8), 'fast');
  ok(pigs.every((e) => e.evT === TREASURE_SECONDS), 'a 20 s run');
  const d0 = pigs.map((e) => Math.hypot(e.x - s.px, e.y - s.py));
  run(s, 3);
  const away = pigs.filter((e, i) => Math.hypot(e.x - s.px, e.y - s.py) > d0[i] + 8).length;
  ok(away >= 11, `they run away from the hero (${away} of 12 are 8 yd further after 3 s)`);
  run(s, 20);
  eq(count(s, (e) => e.ev === EV_TREASURE), 0, 'they vanish after 20 s');
  eq(s.pickups.filter((p) => p.kind === FIELD).length, 0, 'unkilled pigs drop nothing');
}
{
  const s = quiet(19);
  s.t = 250;
  s.enemies.length = 0;
  s.pickups.length = 0;
  startSwarm(s, 'treasure');
  const pig = s.enemies.find((e) => e.ev === EV_TREASURE)!;
  s.curSkill = 'magic_claw';
  s.hit(pig, 1e9);
  const meso = s.pickups.filter((p) => p.kind === MESO);
  ok(meso.some((p) => p.value === TREASURE_MESO_MULT * (1 + Math.floor(TREASURE_TIER / 3))), `a pig drops 5x mesos (${meso.map((p) => p.value).join(', ')})`);
  eq(s.pickups.filter((p) => p.kind === FIELD).length, 1, 'and a field item');
}

// ---- scheduler: 100 to 140 s apart, never within 15 s of a boss spawn ----
for (const seed of [4, 21, 37]) {
  const s = new Sim(seed, 'bowman');
  s.god = true;
  const at: { t: number; kind: string }[] = [];
  bot(s, 900, () => { for (const e of s.events) if (e.type === 'swarm') at.push({ t: s.t, kind: e.kind }); });
  ok(at.length >= 5 && at.length <= 9, `seed ${seed}: ${at.length} events in a run (${at.map((x) => x.kind[0] + Math.round(x.t)).join(' ')})`);
  ok(at[0].t >= SWARM_GAP_MIN - 0.01, `seed ${seed}: the first at ${at[0].t.toFixed(0)} s`);
  let gaps = true;
  for (let i = 1; i < at.length; i++) { const g = at[i].t - at[i - 1].t; if (g < SWARM_GAP_MIN - 0.01 || g > SWARM_GAP_MAX + 32) gaps = false; }
  ok(gaps, `seed ${seed}: gaps ${at.slice(1).map((x, i) => (x.t - at[i].t).toFixed(0)).join(' ')} s`);
  let near15 = 0;
  for (const x of at) for (let k = 1; k <= 6; k++) if (Math.abs(x.t - BOSS_EVERY * k) < SWARM_BOSS_MARGIN - 0.05) near15++;
  eq(near15, 0, `seed ${seed}: no event within ${SWARM_BOSS_MARGIN} s of a boss spawn`);
  ok(new Set(at.map((x) => x.kind)).size >= 2, `seed ${seed}: more than one kind of event`);
}
{
  // an event that comes due near a boss waits it out
  const s = quiet(5);
  s.t = BOSS_EVERY - 10;
  s.swarms.nextAt = BOSS_EVERY - 10;
  run(s, 1);
  eq(s.swarms.started.reduce((a, b) => a + b, 0), 0, 'no event 10 s before a boss');
  s.t = BOSS_EVERY - 0.02;
  run(s, 14);
  eq(s.swarms.started.reduce((a, b) => a + b, 0), 0, 'none for 15 s after the boss either');
  run(s, 3);
  eq(s.swarms.started.reduce((a, b) => a + b, 0), 1, 'then it starts');
}

// ---- boxes ----
{
  const s = quiet(22);
  eq(boxCount(s), 0, 'no box at the start');
  s.field.nextBox = 0;
  s.setInput(1, 0);
  run(s, 0.1);
  const box = s.enemies.find((e) => e.ev === EV_BOX)!;
  ok(box !== undefined, 'a box appears on schedule');
  const d = Math.hypot(box.x - s.px, box.y - s.py);
  ok(d >= SPAWN_RING_MIN - 1 && d <= SPAWN_RING_MAX + 1, `on the spawn ring (${d.toFixed(1)} yd)`);
  ok(Math.abs(Math.atan2(box.y - s.py, box.x - s.px)) < 1.0, 'ahead of the hero\'s movement');
  eq(box.maxHp, 1, '1 HP');
  ok(box.speed === 0 && box.dmg === 0 && box.add, 'does not move or attack');
  ok(s.field.nextBox - s.t >= BOX_GAP_MIN - 0.2 && s.field.nextBox - s.t <= BOX_GAP_MAX, 'the next box is 60 to 90 s away');
  // never more than three at once
  for (let i = 0; i < 8; i++) { s.field.nextBox = 0; run(s, 0.05); }
  eq(boxCount(s), BOX_MAX, `at most ${BOX_MAX} boxes on the map`);
  // a box far behind goes away
  s.setInput(0, 0);
  s.px += 200;
  run(s, 0.1);
  eq(boxCount(s), 0, 'boxes left far behind are removed');
  eq(s.field.boxesBroken, 0, 'they were not broken');
}
{
  // a hit breaks it and drops a field item; no kill, no gem
  const s = quiet(23);
  const box = s.spawnEnemy(0, 6, 3, true);
  box.maxHp = box.hp = 1; box.speed = 0; box.dmg = 0; box.ev = EV_BOX; box.evT = 100;
  const kills = s.kills;
  s.curSkill = 'magic_claw';
  s.hit(box, 1);
  ok(!box.alive, 'any hit breaks it');
  eq(s.kills, kills, 'not a kill');
  eq(s.pickups.filter((p) => p.kind === GEM).length, 0, 'no gem');
  const drop = s.pickups.filter((p) => p.kind === FIELD);
  eq(drop.length, 1, 'one field item');
  near(drop[0].x, box.x, 1e-9, 'at the box'); near(drop[0].y, box.y, 1e-9, 'at the box');
  ok(drop[0].life > 30, 'which stays a while');
  eq(s.field.boxesBroken, 1, 'counted');
  eq(evOf(s, 'box').length, 1, 'box event');
}
{
  // a real skill breaks it, and a box beside the hero deals no damage
  const s = new Sim(24, 'magician');
  s.god = false;
  const box = s.spawnEnemy(0, 4, 0, true);
  box.maxHp = box.hp = 1; box.speed = 0; box.dmg = 0; box.ev = EV_BOX; box.evT = 100; box.hitCd = 1e9;
  const x0 = box.x, y0 = box.y;
  run(s, 0.1);
  eq([box.x, box.y], [x0, y0], 'a box never moves');
  eq(s.hp, s.maxHp, 'nor hurts');
  run(s, 2);
  eq(s.field.boxesBroken, 1, 'Magic Claw broke the box');
  ok(s.pickups.some((p) => p.kind === FIELD), 'and it dropped a field item');
}

// ---- field items ----
function stage(seed = 31) {
  const s = quiet(seed);
  s.enemies.length = 0;
  return s;
}
{
  const s = stage();
  s.god = false;
  s.hp = s.maxHp * 0.4;
  useFieldItem(s, FIELD_APPLE, 0, 0);
  near(s.hp, s.maxHp * (0.4 + APPLE_HEAL), 1e-6, 'Apple heals 30% of max HP');
  useFieldItem(s, FIELD_APPLE, 0, 0);
  useFieldItem(s, FIELD_APPLE, 0, 0);
  eq(s.hp, s.maxHp, 'never past full');
  eq(evOf(s, 'fieldItem').length, 3, 'field item events');
}
{
  // Coupon: pulls every gem, gems worth 2x for 30 s
  const s = stage();
  for (let i = 0; i < 5; i++) s.dropPickup(GEM, 30 + i, -20, 10);
  const far = s.pickups.filter((p) => p.kind === GEM);
  ok(far.every((p) => !p.pulled), 'far gems are not pulled yet');
  useFieldItem(s, FIELD_COUPON, 0, 0);
  ok(far.every((p) => p.pulled), 'every gem on the map is pulled');
  eq(s.field.couponT, COUPON_SECONDS, '30 s of double gems');
  const xp0 = s.xp + (s.level - 1) * 1e6;
  run(s, 6);
  eq(s.pickups.filter((p) => p.kind === GEM).length, 0, 'all gems reached the hero');
  const gained = s.xp + (s.level - 1) * 1e6 - xp0;
  ok(gained > 0, 'xp gained');
  // exact: one gem collected with the buff
  const t = stage(32);
  t.dropPickup(GEM, 0.2, 0, 2);
  t.field.couponT = 10;
  const lv = t.level, x1 = t.xp;
  t.tick();
  ok(t.level === lv && Math.abs(t.xp - x1 - 4) < 1e-9, 'a gem of 2 is worth 4 with the Coupon');
  const u = stage(33);
  u.dropPickup(GEM, 0.2, 0, 2);
  u.tick();
  near(u.xp, 2, 1e-9, 'and 2 without it');
  // runs out
  const v = stage(34);
  useFieldItem(v, FIELD_COUPON, 0, 0);
  run(v, COUPON_SECONDS + 0.5);
  ok(v.field.couponT <= 0, 'the Coupon runs out');
  v.dropPickup(GEM, 0.2, 0, 2);
  const w0 = v.xp;
  v.tick();
  near(v.xp - w0, 2, 1e-9, 'gems are worth 1x again');
}
{
  // Elixir: +40% damage for 20 s
  const hitLoss = (s: Sim) => {
    const m = s.spawnEnemy(0, 3, 0, true);
    m.maxHp = m.hp = 1e9; m.speed = 0; m.dmg = 0;
    s.crit = 0;
    s.curSkill = 'magic_claw';
    s.hit(m, 1000);
    const loss = 1e9 - m.hp;
    m.alive = false;
    return loss;
  };
  const s = stage(35);
  const base = hitLoss(s);
  useFieldItem(s, FIELD_ELIXIR, 0, 0);
  eq(s.field.elixirT, ELIXIR_SECONDS, '20 s');
  near(hitLoss(s), base * ELIXIR_DAMAGE, 1, `Warrior Elixir: +40% damage (${base} -> ${hitLoss(s)})`);
  run(s, ELIXIR_SECONDS + 0.5);
  eq(hitLoss(s), base, 'back to normal after 20 s');
}
{
  // Clock: everything but bosses freezes for 5 s and cannot hurt; bosses are slowed
  const s = stage(36);
  s.god = false;
  s.hp = s.maxHp;
  const walker = s.spawnEnemy(2, 12, 0, true);
  walker.speed = 4; walker.dmg = 10; walker.hitCd = 0;
  const toucher = s.spawnEnemy(2, 0.4, 0, true);
  toucher.speed = 4; toucher.dmg = 10; toucher.hitCd = 0;
  useFieldItem(s, FIELD_CLOCK, 0, 0);
  eq(s.field.clockT, CLOCK_SECONDS, '5 s');
  const wx = walker.x;
  run(s, CLOCK_SECONDS - 0.4);
  eq(walker.x, wx, 'mobs stand still');
  eq(s.hp, s.maxHp, 'and a mob touching the hero does no damage');
  run(s, 1);
  ok(walker.x < wx, 'they move again afterwards');
  ok(s.hp < s.maxHp, 'and hit again');
  // bosses: half speed
  const disp = (clock: boolean) => {
    const b = new Sim(40, 'magician', { events: false });
    b.skills = []; b.god = true;
    b.t = BOSS_EVERY - 0.001;
    b.tick();
    const boss = b.enemies.find((e) => e.boss >= 0)!;
    if (clock) useFieldItem(b, FIELD_CLOCK, 0, 0);
    b.field.clockT = clock ? 5 : 0;
    const x0 = boss.x, y0 = boss.y;
    for (let i = 0; i < 60; i++) { b.tick(); if (clock) b.field.clockT = 5; }
    return Math.hypot(boss.x - x0, boss.y - y0);
  };
  const free = disp(false), slowed = disp(true);
  near(slowed / free, CLOCK_BOSS_SLOW, 0.06, `bosses are slowed 50% (${slowed.toFixed(2)} vs ${free.toFixed(2)} yd in a second)`);
}
{
  // Keg: kills non-boss, non-elite mobs within 20 yd (gems drop), 10% max HP to Elites and bosses in range
  const s = stage(37);
  const inside = [mob(s, 3, 0), mob(s, -10, 8, 3), mob(s, 0, -19, 5), mob(s, 14, 14, 1)];
  const outside = [mob(s, 21, 0), mob(s, 0, 25, 2)];
  const elite = mob(s, 8, 0, 4);
  elite.elite = AFFIX_ARMORED; elite.maxHp = elite.hp = 1000;
  const boss = mob(s, -6, -6, 29);
  boss.boss = 0; boss.maxHp = boss.hp = 2000;
  const farElite = mob(s, 30, 0, 4);
  farElite.elite = AFFIX_SWIFT; farElite.maxHp = farElite.hp = 1000;
  const box = mob(s, 2, 2, 0);
  box.ev = EV_BOX; box.maxHp = box.hp = 1; box.evT = 99;
  const kills = s.kills;
  useFieldItem(s, FIELD_KEG, 0, 0);
  ok(inside.every((e) => !e.alive), 'every plain mob within 20 yd is dead');
  ok(outside.every((e) => e.alive), 'mobs beyond 20 yd are fine');
  eq(s.kills - kills, inside.length, 'they count as kills');
  eq(s.pickups.filter((p) => p.kind === GEM).length, inside.length, 'and drop gems normally');
  ok(elite.alive && Math.abs(elite.hp - 1000 * (1 - KEG_BOSS_FRAC)) < 1e-6, 'an Elite in range loses 10% max HP');
  ok(boss.alive && Math.abs(boss.hp - 2000 * (1 - KEG_BOSS_FRAC)) < 1e-6, 'a boss in range loses 10% max HP');
  eq(farElite.hp, 1000, 'an Elite out of range is untouched');
  ok(box.alive, 'boxes are not blown up');
  eq(KEG_RADIUS, 20, 'radius 20 yd');
  // a hurt Elite can die from it
  const e2 = mob(s, 4, 0, 4);
  e2.elite = AFFIX_BLAZING; e2.maxHp = 100; e2.hp = 5;
  useFieldItem(s, FIELD_KEG, 0, 0);
  ok(!e2.alive && s.elites.killed === 1, 'an almost dead Elite dies to the blast and pays out');
}
{
  // pickup behaviour: touch only, no magnet, no pet
  const s = new Sim(41, 'magician', { pet: true });
  s.skills = []; s.god = true;
  s.dropPickup(FIELD, 3, 0, FIELD_APPLE, 60);
  const p = s.pickups.find((x) => x.kind === FIELD)!;
  run(s, 3);
  ok(!p.pulled && Math.abs(p.x - 3) < 1e-9, 'a field item inside the magnet range is not pulled in');
  eq(s.pet!.collected, 0, 'and the pet leaves it alone');
  s.px = 2.5;
  run(s, 0.1);
  ok(!s.pickups.includes(p), 'touching it collects it');
  eq(s.field.itemsUsed, 1, 'used');
  s.dropPickup(FIELD, 80, 0, FIELD_KEG, 2);
  run(s, 2.5);
  eq(s.pickups.filter((q) => q.kind === FIELD).length, 0, 'an item nobody touches vanishes');
}

// ---- bot: walks to field items and boxes when safe ----
{
  const s = quiet(42);
  s.skills = [{ key: 'magic_claw', level: 1, cd: 0 }];
  s.enemies.length = 0;
  s.dropPickup(FIELD, 15, 0, FIELD_APPLE, 60);
  let i = botInput(s, 1);
  ok(i.x > 0.8, 'the bot heads for a field item');
  s.pickups.length = 0;
  const box = s.spawnEnemy(0, 0, -25, true);
  box.speed = 0; box.dmg = 0; box.ev = EV_BOX; box.evT = 99;
  i = botInput(s, 1);
  ok(i.y < -0.8, 'and for a box when nothing threatens it');
  const wolf = s.spawnEnemy(5, 0, -3, false);
  wolf.speed = 0;
  i = botInput(s, 1);
  ok(i.y > 0, 'but flees an enemy first');
}

// ---- off switch, determinism, snapshot ----
{
  const s = new Sim(50, 'warrior', { events: false });
  s.god = true;
  bot(s, 300);
  ok(s.elites.spawned === 0 && s.swarms.started.every((n) => n === 0) && s.field.boxesBroken === 0 && !s.enemies.some((e) => e.ev || e.elite), 'events: false leaves the run as it was');
}
{
  const fp = (seed: number) => {
    const s = new Sim(seed, 'thief');
    s.god = true;
    const log: string[] = [];
    bot(s, 330, () => { for (const e of s.events) if (e.type === 'elite' || e.type === 'swarm' || e.type === 'box' || e.type === 'fieldItem') log.push(`${s.t.toFixed(2)}:${e.type}`); });
    return JSON.stringify([s.snapshot(), log, s.enemies.map((e) => [e.x.toFixed(3), e.y.toFixed(3), e.hp.toFixed(1), e.elite, e.ev]), s.pickups.length, s.elites.fires.length]);
  };
  const a = fp(60), b = fp(60), c = fp(61);
  eq(a, b, 'the same seed plays out identically (Elites, events, boxes, field items)');
  ok(a !== c, 'a different seed does not');
  ok(JSON.parse(a)[1].length > 5, 'the run had things happen in it');
  const snap = new Sim(1, 'magician').snapshot();
  ok('elitesKilled' in snap && 'swarms' in snap && 'field' in snap && Array.isArray(snap.elites), 'snapshot() carries Elite, swarm and field data');
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
  ok(s.won, `${c.name}: the bot wins a mortal run with Elites, events and field items (seed 7919)`);
  ok(s.elites.killed >= 8, `${c.name}: ${s.elites.killed} Elites slain`);
}

console.log(`test-events: ${checks} checks passed`);
