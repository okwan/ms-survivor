// Run: node --experimental-strip-types scripts/test-meta.ts
// Henesys shop (src/game/meta.ts): the cost curve, buying and refunding, save migration, what each rank does to the Sim's stats,
// reroll / banish counts, the Safety Charm revive (once and only once), Greed, and determinism.
import assert from 'node:assert/strict';
import { botInput, botPick } from '../src/game/bot.ts';
import { MASTERY_BY_KEY, PLAYER_BASE, START_BANISHES, START_REROLLS } from '../src/game/data.ts';
import { META, META_BY_KEY, REVIVE_HP, REVIVE_INVULN, REVIVE_RADIUS, buyMeta, emptyMeta, metaCost, metaSpent, metaTotalCost, refundMeta, sanitizeMeta } from '../src/game/meta.ts';
import type { MetaKey, MetaRanks } from '../src/game/meta.ts';
import { Sim } from '../src/game/sim.ts';
import type { Enemy } from '../src/game/types.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };
const near = (a: number, b: number, m: string) => { checks++; assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${m} (got ${a}, want ${b})`); };
const only = (key: MetaKey, n: number): MetaRanks => ({ ...emptyMeta(), [key]: n });
const full = (): MetaRanks => Object.fromEntries(META.map((d) => [d.key, d.max])) as MetaRanks;

// ---- the table and the cost curve: rank r+1 costs base x growth^r, to the nearest 10 ----
eq(META.map((d) => [d.key, d.max, d.base, d.growth]), [
  ['hp', 5, 3000, 1.6], ['might', 5, 4500, 1.6], ['haste', 5, 4500, 1.6], ['armor', 3, 6000, 1.8], ['speed', 3, 3750, 1.6], ['magnet', 3, 2250, 1.5],
  ['growth', 5, 5250, 1.6], ['greed', 5, 3750, 1.6], ['reroll', 3, 7500, 2], ['banish', 3, 7500, 2], ['revive', 1, 45000, 1],
], 'the eleven upgrades with their ranks, base costs and growth');
eq([0, 1, 2, 3, 4].map((r) => metaCost('hp', r)), [3000, 4800, 7680, 12290, 19660], 'Max HP: 3000 x 1.6^r rounded to 10');
eq([0, 1, 2].map((r) => metaCost('armor', r)), [6000, 10800, 19440], 'Armor: 6000 x 1.8^r');
eq([0, 1, 2].map((r) => metaCost('magnet', r)), [2250, 3380, 5060], 'Magnet: 2250 x 1.5^r');
eq([0, 1, 2].map((r) => metaCost('reroll', r)), [7500, 15000, 30000], 'Gachapon Ticket doubles');
eq(metaCost('revive', 0), 45000, 'Safety Charm 45000');
for (const d of META) for (let r = 0; r < d.max; r++) ok(metaCost(d.key, r) % 10 === 0 && metaCost(d.key, r) >= metaCost(d.key, Math.max(0, r - 1)), `${d.key} rank ${r + 1} cost is a multiple of 10 and never falls`);
eq(META.reduce((a, d) => a + metaTotalCost(d.key), 0), metaTotalCost(), 'the total is the sum of the upgrades');
eq(metaSpent(full()), metaTotalCost(), 'full ranks have spent the total');
console.log(`  everything in the shop costs ${metaTotalCost()} mesos`);

// ---- buying and refunding ----
const start = { mesos: 15000, ranks: emptyMeta() };
let r1 = buyMeta(start.mesos, start.ranks, 'hp')!;
eq([r1.mesos, r1.ranks.hp], [12000, 1], 'buying Max HP rank 1 costs 3000');
r1 = buyMeta(r1.mesos, r1.ranks, 'hp')!;
eq([r1.mesos, r1.ranks.hp], [7200, 2], 'rank 2 costs 4800');
eq(buyMeta(4500, r1.ranks, 'hp'), null, 'too few mesos: refused');
eq(start.ranks.hp, 0, 'the input ranks are not changed');
eq(buyMeta(7680, r1.ranks, 'hp')!.mesos, 0, 'exact change buys rank 3 (7680)');
eq(buyMeta(1e9, full(), 'hp'), null, 'a maxed upgrade cannot be bought');
eq(buyMeta(1e9, emptyMeta(), 'nope' as MetaKey), null, 'an unknown key is refused');
const charm = buyMeta(47000, emptyMeta(), 'revive')!;
eq([charm.mesos, charm.ranks.revive], [2000, 1], 'the Safety Charm is one purchase');
const refunded = refundMeta(0, full());
eq([refunded.mesos, metaSpent(refunded.ranks)], [metaTotalCost(), 0], 'refund gives back everything and clears the ranks');
let bank = 300000;
let ranks = emptyMeta();
for (const k of ['hp', 'hp', 'might', 'revive', 'greed'] as MetaKey[]) { const b = buyMeta(bank, ranks, k)!; bank = b.mesos; ranks = b.ranks; }
eq(bank + metaSpent(ranks), 300000, 'mesos + spent is conserved while buying');
const back = refundMeta(bank, ranks);
eq([back.mesos, back.ranks], [300000, emptyMeta()], 'a refund restores the starting mesos exactly');
eq(refundMeta(7, emptyMeta()).mesos, 7, 'refund with nothing bought changes nothing');

// ---- sanitising and the save ----
eq(sanitizeMeta(undefined), emptyMeta(), 'no data: all zeros');
eq(sanitizeMeta({ hp: 9, might: -2, haste: 2.9, armor: 'x', speed: NaN, revive: 1, junk: 5 }), { ...emptyMeta(), hp: 5, haste: 2, revive: 1 }, 'ranks are clamped to 0..max, whole numbers, junk dropped');
eq(sanitizeMeta('hello'), emptyMeta(), 'a non-object is ignored');
{
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const { loadSave, writeSave } = await import('../src/ui/save.ts');
  eq(loadSave().meta, emptyMeta(), 'a fresh save has no ranks');
  store.set('maple-survivor-save-v1', JSON.stringify({ mesos: 500, bestTime: 12 }));
  const old = loadSave();
  eq([old.mesos, old.meta], [500, emptyMeta()], 'an old save without a shop loads with every rank 0');
  store.set('maple-survivor-save-v1', JSON.stringify({ mesos: 5, meta: { hp: 2, greed: 99 } }));
  eq(loadSave().meta, { ...emptyMeta(), hp: 2, greed: 5 }, 'a partial or oversized shop is repaired');
  const sv = loadSave();
  sv.meta = buyMeta(1e6, sv.meta, 'might')!.ranks;
  writeSave(sv);
  eq(loadSave().meta.might, 1, 'ranks survive a save round trip');
  (globalThis as any).localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  eq(loadSave().meta, emptyMeta(), 'blocked storage still loads the defaults');
  writeSave(sv);
  ok(true, 'and writing to blocked storage does not throw');
}

// ---- what each rank does to the Sim ----
for (const cls of ['warrior', 'magician']) {
  const base = new Sim(7, cls);
  const withMeta = (m: Partial<MetaRanks>) => new Sim(7, cls, { meta: m });
  eq([base.maxHp, base.might, base.haste, base.armor], [base.cls.hp, 1, 0, 0], `${cls}: the baseline stats`);
  for (let n = 1; n <= 5; n++) {
    near(withMeta({ hp: n }).maxHp, base.cls.hp * (1 + 0.08 * n), `${cls}: Max HP rank ${n} is +${8 * n}%`);
    near(withMeta({ hp: n }).hp, base.cls.hp * (1 + 0.08 * n), `${cls}: and the run starts at full HP`);
    near(withMeta({ might: n }).might, 1 + 0.05 * n, `${cls}: Might rank ${n} is +${5 * n}% damage`);
    near(withMeta({ haste: n }).haste, 0.04 * n, `${cls}: Haste rank ${n} is +${4 * n}% cooldown speed`);
    near(withMeta({ growth: n }).growth, 1 + 0.04 * n, `${cls}: Growth rank ${n} is +${4 * n}% EXP`);
  }
  for (let n = 1; n <= 3; n++) {
    near(withMeta({ armor: n }).armor, n, `${cls}: Armor rank ${n} is +${n} armor`);
    near(withMeta({ speed: n }).speed, base.cls.speed * (1 + 0.03 * n), `${cls}: Speed rank ${n} is +${3 * n}% move speed`);
    near(withMeta({ magnet: n }).magnet, PLAYER_BASE.magnet * (1 + 0.12 * n), `${cls}: Magnet rank ${n} is +${12 * n}% pickup radius`);
  }
  const all = new Sim(7, cls, { meta: full() });
  near(all.maxHp, base.cls.hp * 1.4, `${cls}: a full shop stacks (max HP)`);
  near(all.might, 1.25, `${cls}: (damage)`);
  near(all.speed, base.cls.speed * 1.09, `${cls}: (speed)`);
}
{
  // ranks stack with the other sources and are scaled by the level bonus like them
  const s = new Sim(3, 'warrior', { meta: only('might', 2) });
  s.masteryLv.mastery = 1;
  s.recalc();
  near(s.might, 1 + 0.1 + MASTERY_BY_KEY.mastery.per, 'shop damage adds to Mastery');
  s.level = 5;
  s.recalc();
  ok(s.might > 1.18, 'and the level bonus applies on top');
  const b = new Sim(5, 'bowman');
  b.recalc();
  eq([b.maxHp, b.speed, b.magnet, b.crit], [b.cls.hp, b.cls.speed, PLAYER_BASE.magnet, b.cls.crit], 'with no ranks recalc() changes nothing');
}

// ---- rerolls and banishes ----
{
  const s = new Sim(1, 'magician');
  eq([s.rerolls, s.banishes], [START_REROLLS, START_BANISHES], 'no ranks: the usual rerolls and banishes');
  const t = new Sim(1, 'magician', { meta: { reroll: 3, banish: 2 } });
  eq([t.rerolls, t.banishes], [START_REROLLS + 3, START_BANISHES + 2], 'ranks add rerolls and banishes');
  eq(t.snapshot().rerolls, START_REROLLS + 3, 'the snapshot shows them');
  const u = new Sim(1, 'magician', { meta: { reroll: 1, banish: 1 } });
  u.pendingLevels = 1;
  u.tick();
  ok(!!u.offer, 'a level-up opens the cards');
  let used = 0;
  while (u.reroll()) used++;
  eq(used, START_REROLLS + 1, 'every reroll can be used');
  let banished = 0;
  for (let guard = 0; guard < 20 && u.offer && u.banishes > 0; guard++) if (u.offer.some((c, i) => (c.kind === 'skill' || c.kind === 'passive') && u.banish(i))) banished++;
  eq(banished, START_BANISHES + 1, 'and every banish');
  eq(new Sim(1, 'magician', { meta: { reroll: 99 } }).rerolls, START_REROLLS + META_BY_KEY.reroll.max, 'an oversized rank is clamped');
}

// ---- Greed ----
{
  const s = new Sim(1, 'warrior', { meta: only('greed', 5) });
  for (let i = 0; i < 100; i++) s.gainMesos(1);
  eq(s.mesos, 140, '100 single mesos with Greed 5 (+40%) pay 140: the fractions carry over');
  const t = new Sim(1, 'warrior');
  for (let i = 0; i < 100; i++) t.gainMesos(1);
  eq(t.mesos, 100, 'no Greed: exact');
  const u = new Sim(1, 'warrior', { meta: only('greed', 1) });
  u.gainMesos(50);
  eq(u.mesos, 54, 'a 50 meso bag is +8% = 54');
}

// ---- Safety Charm ----
const enemy = (x: number, y: number, boss = -1): Enemy => ({ x, y, hp: 100, maxHp: 100, speed: 0, dmg: 0, r: 0.6, xp: 1, tier: 0, boss, lead: false, big: false, add: false, alive: true, hitCd: 9, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, lastHit: -99, facing: 1, phase: 0, moving: false, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1, elite: 0, ev: 0, vx: 0, vy: 0 } as unknown as Enemy);
{
  const none = new Sim(9, 'warrior');
  none.hurtPlayer(1e6, 0, 0);
  ok(none.over && !none.won && none.hp === 0, 'without the charm a lethal hit ends the run');
  const s = new Sim(9, 'warrior', { meta: only('revive', 1) });
  const close = enemy(2, 0), far = enemy(30, 0), boss = enemy(0, 3, 0), onTop = enemy(0, 0);
  s.enemies.push(close, far, boss, onTop);
  s.events.length = 0;
  s.hurtPlayer(1e6, 0, 0);
  ok(!s.over, 'the lethal hit does not end the run');
  near(s.hp, s.maxHp * REVIVE_HP, 'the hero is back at 50% HP');
  eq(s.reviveUsed, true, 'the charm is used up');
  eq(s.events.filter((e) => e.type === 'revive').length, 1, 'one revive event');
  eq(s.raidText, 'Safety Charm activated!', 'and the raid warning the HUD shows');
  ok(Math.hypot(close.x - s.px, close.y - s.py) > REVIVE_RADIUS, 'the burst pushes a nearby enemy out of the radius');
  ok(close.stunT > 0 && boss.stunT === 0, 'it stuns normal mobs but not bosses');
  ok(Math.hypot(boss.x - s.px, boss.y - s.py) > REVIVE_RADIUS, 'a boss is pushed too');
  eq([far.x, far.y], [30, 0], 'a far enemy stays');
  ok(Number.isFinite(onTop.x) && Math.hypot(onTop.x, onTop.y) > REVIVE_RADIUS, 'an enemy exactly on the hero is pushed out too');
  // untouchable for a moment: more hits do nothing and do not trigger it again
  const hp = s.hp, taken = s.damageTaken;
  s.hurtPlayer(1e6, 0, 0);
  s.hurtPlayer(1e6, 0, 0);
  eq([s.hp, s.over, s.damageTaken], [hp, false, taken], 'hits during the invulnerability are ignored');
  eq(s.events.filter((e) => e.type === 'revive').length, 1, 'still one event');
  for (let i = 0; i < Math.ceil((REVIVE_INVULN + 0.1) * 60); i++) s.tick();
  eq(s.reviveT, 0, 'the invulnerability runs out');
  ok(!s.over, 'the run goes on');
  s.hp = s.maxHp;
  s.hurtPlayer(1e6, 0, 0);
  ok(s.over && !s.won, 'the second lethal hit ends the run: the charm works once only');
  eq(s.events.filter((e) => e.type === 'revive').length, 1, 'and there is no second revive event');
}
{
  // a non-lethal hit does not spend the charm; god mode does not either
  const g = new Sim(9, 'warrior', { meta: only('revive', 1) });
  g.hurtPlayer(10, 0, 0);
  eq([g.reviveUsed, g.hp], [false, g.maxHp - 10], 'a non-lethal hit leaves the charm alone');
  const h = new Sim(9, 'warrior', { meta: only('revive', 1) });
  h.god = true;
  h.hurtPlayer(1e6, 0, 0);
  eq([h.reviveUsed, h.over], [false, false], 'god mode does not spend it');
}
{
  // in a real run with the bot, dropping to 1 HP now and then: the charm fires at most once
  const s = new Sim(11, 'magician', { meta: only('revive', 1) });
  let revives = 0;
  for (let i = 0; i < 900 * 60 && !s.over; i++) {
    if (s.offer) { s.pick(botPick(s)); continue; }
    const b = botInput(s, 1);
    s.setInput(b.x, b.y);
    s.tick();
    if (i % 600 === 0) s.hp = Math.min(s.hp, 1);
    for (const e of s.events) if (e.type === 'revive') revives++;
    s.events.length = 0;
  }
  ok(revives <= 1, `over a whole run the charm fires at most once (${revives})`);
}

// ---- determinism ----
{
  const run = (meta?: Partial<MetaRanks>) => {
    const s = new Sim(21, 'thief', meta ? { meta } : {});
    for (let i = 0; i < 120 * 60 && !s.over; i++) {
      if (s.offer) { s.pick(botPick(s)); continue; }
      const b = botInput(s, 1);
      s.setInput(b.x, b.y);
      s.tick();
      s.events.length = 0;
    }
    return JSON.stringify(s.snapshot());
  };
  eq(run(full()), run(full()), 'the same seed and ranks give the same run');
  eq(run(emptyMeta()), run(), 'all-zero ranks are the same as no shop');
  ok(run(full()) !== run(), 'a full shop changes the run');
}

console.log(`test-meta: ok (${checks} checks)`);
