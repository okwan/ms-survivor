// Run: node --experimental-strip-types scripts/test-gear.ts
// Gear in the pure sim (src/game/gear.ts): pool, stat mapping, drops, auto-equip / offers, the look overlay and the cap-hair rule.
import assert from 'node:assert/strict';
import { botInput } from '../src/game/bot.ts';
import { BOSS_EVERY, GEAR_BOSS_DROPS, PLAYER_BASE } from '../src/game/data.ts';
import { BAG_SIZE, GEAR_SLOTS, GearPool, itemBonus, itemScore, runTier, tierOfLevel } from '../src/game/gear.ts';
import type { GearManifest } from '../src/game/gear.ts';
import { Rng } from '../src/game/rng.ts';
import { Sim } from '../src/game/sim.ts';
import { GEAR } from '../src/game/types.ts';
import { defaultLook, hiddenHairLayers, lookItems } from '../src/maple/avatar-core.ts';
import type { ItemJson } from '../src/maple/avatar-core.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };
const near = (a: number, b: number, m: string) => { checks++; assert.ok(Math.abs(a - b) < 1e-9, `${m} (got ${a}, want ${b})`); };

// ---- tiers ----
eq([0, 9, 10, 29, 30, 59, 60, 120].map(tierOfLevel), [0, 0, 1, 2, 3, 5, 6, 6], 'level -> item tier');
eq([0, 119, 120, 239, 240, 700, 900].map(runTier), [0, 0, 1, 1, 2, 5, 6], 'run clock -> item tier (0 for two minutes, +1 per two, max 6)');

// ---- placeholder pool ----
const ph = GearPool.placeholder();
ok(!ph.real && ph.items.size > 50, 'placeholder pool exists without a manifest');
eq(GearPool.fromManifest(null).real, false, 'no manifest -> placeholder pool');
eq(GearPool.fromManifest({ items: {}, iconAtlas: '' }).real, false, 'an empty manifest -> placeholder pool');
for (const cls of ['warrior', 'magician', 'bowman', 'thief'] as const) {
  const rng = new Rng(5);
  const seen = new Set<string>();
  for (let t = 0; t < 900; t += 100) for (let i = 0; i < 60; i++) {
    const it = ph.roll(rng, cls, 0, t)!;
    ok(!!it, `${cls} rolls an item at ${t}s`);
    seen.add(it.slot);
    ok(it.slot !== 'shield' || cls === 'warrior', 'only the warrior gets shields');
    ok(it.slot !== 'weapon' || it.job === ({ warrior: 1, magician: 2, bowman: 4, thief: 8 })[cls], 'weapons are class weapons');
  }
  eq(seen.size, cls === 'warrior' ? 8 : 7, `${cls} sees every slot it can wear`);
}

// ---- bag: unequipped items are kept and can be worn from the inventory ----
{
  const s = new Sim(5, 'warrior');
  s.giveGear('phweapon1t6');
  eq(s.bag.length, 0, 'an equipped pickup is not in the bag');
  eq(s.giveGear('phweapon1t2'), 'offered', 'a worse weapon is offered');
  eq(s.bag.map((i) => i.id), ['phweapon1t2'], 'an unworn pickup goes to the bag');
  const v = s.bagVersion;
  ok(s.equipFromBag('phweapon1t2'), 'equipFromBag wears it');
  eq(s.equipped.weapon!.id, 'phweapon1t2', 'the bag item is worn');
  eq(s.bag.map((i) => i.id), ['phweapon1t6'], 'the replaced weapon swapped into the bag');
  ok(s.bagVersion > v && !s.equipFromBag('nope'), 'bag version counts up; unknown ids do nothing');
  ok(s.unequip('weapon') && !s.equipped.weapon && s.bag.length === 2, 'unequip moves the item into the bag');
  ok(!s.unequip('cape'), 'unequip of an empty slot does nothing');
  const t = new Sim(6, 'warrior');
  for (let i = 0; i < BAG_SIZE + 6; i++) { t.giveGear('phweapon1t6'); t.giveGear(i % 2 ? 'phcap0t1' : 'phcap0t0'); }
  ok(t.bag.length <= BAG_SIZE, `the bag never holds more than ${BAG_SIZE}`);
}

// ---- stat mapping ----
const sword0 = ph.get('phweapon1t0')!;
const sword6 = ph.get('phweapon1t6')!;
near(itemBonus(sword0, 'warrior').dmg, 0.1, 'tier 0 weapon: 12 att = 24% capped at +10%');
near(itemBonus(sword6, 'warrior').dmg, 0.7 + 0.12, 'tier 6 weapon: capped at +70%, plus 12 STR at 1% each');
const wand = ph.get('phweapon2t2')!;
near(itemBonus(wand, 'magician').dmg, Math.min(0.02 * wand.stats.mad!, 0.3) + 0.04, 'magician reads incMAD (and INT)');
near(itemBonus({ ...wand, stats: { pad: 100 } }, 'magician').dmg, 0, 'magician ignores incPAD');
const boots = ph.get('phshoes0t3')!;
const bb = itemBonus(boots, 'thief');
near(bb.armor, boots.stats.pdd! / 10, 'armor +1 per 10 PDD');
near(bb.speed, boots.stats.speed! * 0.005, 'speed +0.5% per point');
near(itemBonus(ph.get('phcoat0t4')!, 'thief').hp, ph.get('phcoat0t4')!.stats.mhp! / 5, 'max HP +1 per 5 MHP');
near(itemBonus(ph.get('phcape0t5')!, 'bowman').dmg, 0.05, 'main stat: DEX counts for the bowman, 1% per point');
near(itemBonus(ph.get('phcape0t5')!, 'warrior').dmg, 0.05, 'main stat: STR counts for the warrior');

// ---- equipping and effects on a live sim ----
{
  const s = new Sim(3, 'warrior');
  const base = { might: s.might, armor: s.armor, maxHp: s.maxHp, speed: s.speed };
  eq(s.giveGear('phweapon1t0'), 'equipped', 'an item for an empty slot is equipped');
  near(s.might, base.might + 0.1, 'the weapon raised the damage multiplier');
  eq(s.giveGear('phweapon1t0'), 'offered', 'an equal item is not an upgrade: offered');
  ok(s.gearOffer?.item.id === 'phweapon1t0' && s.gearToast?.kind === 'offer', 'offer and toast recorded');
  eq(s.giveGear('phweapon1t6'), 'equipped', 'a better item replaces it');
  near(s.might, base.might + itemBonus(sword6, 'warrior').dmg, 'only the new weapon counts');
  eq(s.gearOffer, null, 'equipping clears the offer for that slot');
  eq(s.giveGear('phweapon1t2'), 'offered', 'a worse item is offered, not worn');
  eq(s.equipped.weapon!.id, 'phweapon1t6', 'the better weapon stays');
  ok(s.equipOffer(), 'E equips the offer');
  eq(s.equipped.weapon!.id, 'phweapon1t2', 'the offered item is now worn');
  s.t += 7;
  s.giveGear('phweapon1t6'); // back to the better one
  s.giveGear('phweapon1t2');
  s.t += 7;
  eq(s.equipOffer(), false, 'an offer older than six seconds is gone');
  s.giveGear('phshoes0t3');
  s.giveGear('phcoat0t4');
  s.giveGear('phcape0t5');
  const hpBefore = s.hp;
  ok(s.armor > base.armor, 'armor grew from PDD');
  ok(Math.abs(s.speed - s.cls.speed * (1 + itemBonus(boots, 'warrior').speed)) < 1e-9 || s.speed > base.speed, 'move speed grew');
  ok(s.maxHp > base.maxHp && s.hp >= hpBefore, 'max HP grew from MHP');
  eq(Object.keys(s.gearSummary().equipped).sort(), ['cape', 'coat', 'shoes', 'weapon'], 'summary lists the worn slots');
  eq(s.giveGear('nope'), 'unknown', 'an unknown id is refused');
  // damage actually changes: the same hit does more
  const e = { x: 1, y: 0, hp: 1e6, maxHp: 1e6, speed: 0, dmg: 0, r: 0.6, xp: 0, tier: 0, boss: -1, big: false, add: false, alive: true, hitCd: 9, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, facing: 1, phase: 0, moving: false, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1 };
  s.enemies.push(e);
  s.crit = 0;
  s.hit(e, 100);
  const dealt = 1e6 - e.hp;
  const plain = new Sim(3, 'warrior');
  plain.crit = 0;
  const e2 = { ...e, hp: 1e6, x: 1 };
  plain.enemies.push(e2);
  plain.hit(e2, 100);
  ok(dealt > 1e6 - e2.hp && Math.round(100 * s.might) === dealt, `gear damage ${dealt} vs plain ${1e6 - e2.hp}`);
  eq(plain.might, 1, 'a sim without gear is unchanged');
  eq(plain.maxHp, plain.cls.hp, 'a sim without gear keeps the class HP');
}
{
  // auto-equip off: upgrades are offered, but an empty slot is still filled
  const s = new Sim(4, 'magician', { autoEquip: false });
  eq(s.giveGear('phweapon2t0'), 'equipped', 'empty slot is filled even with auto-equip off');
  eq(s.giveGear('phweapon2t4'), 'offered', 'with auto-equip off an upgrade is only offered');
  ok(s.equipOffer() && s.equipped.weapon!.id === 'phweapon2t4', 'and E wears it');
  ok(itemScore(ph.get('phweapon2t4')!, 'magician') > itemScore(ph.get('phweapon2t0')!, 'magician'), 'score orders the tiers');
}

// ---- drops ----
{
  // boss kills always drop two items, which are picked up like the other drops
  const s = new Sim(9, 'bowman');
  const boss = { x: 3, y: 0, hp: 5, maxHp: 5, speed: 0, dmg: 0, r: 1, xp: 1, tier: 29, boss: 0, big: true, add: false, alive: true, hitCd: 9, slowT: 0, stunT: 0, rootT: 0, weakT: 0, flash: 0, facing: 1, phase: 0, moving: false, berserk: false, age: 0, novaT: 0, castT: 0, summonT: 0, idx: -1 };
  s.enemies.push(boss);
  s.crit = 0;
  s.hit(boss, 1e6);
  const gearPickups = s.pickups.filter((p) => p.kind === GEAR);
  ok(gearPickups.length >= GEAR_BOSS_DROPS, `a boss drops ${GEAR_BOSS_DROPS} items (got ${gearPickups.length})`);
  ok(s.events.filter((e) => e.type === 'drop' && e.boss).length === GEAR_BOSS_DROPS, 'boss drops announce their names');
  ok(gearPickups.every((p) => p.item && p.item.job === 0 || p.item!.job === 4), 'drops fit the bowman');
  for (let i = 0; i < 240; i++) s.tick();
  ok(Object.keys(s.equipped).length >= 1, 'the dropped items were picked up and worn');
}
{
  // rate over a seeded run: ~0.4% of normal kills, ~1% of big ones
  let kills = 0, drops = 0, bosses = 0;
  for (const seed of [11, 12]) {
    const s = new Sim(seed, 'warrior');
    s.god = true;
    for (let i = 0; i < 480 * 60 && !s.over; i++) {
      if (s.offer) { s.pick(0); continue; }
      const inp = botInput(s, 1);
      s.setInput(inp.x, inp.y);
      s.tick();
    }
    kills += s.kills; drops += s.gearDrops; bosses += s.bossKills;
  }
  const normal = drops - GEAR_BOSS_DROPS * bosses;
  const rate = normal / (kills - bosses);
  ok(kills > 500, `enough kills to measure (${kills})`);
  ok(rate > 0.0015 && rate < 0.02, `drop rate ${(rate * 100).toFixed(2)}% of ${kills} kills is within 0.15%..2% (${normal} drops)`);
}
{
  // determinism and independence from the run's other random draws
  const a = new Sim(21, 'thief');
  const b = new Sim(21, 'thief');
  const ra: string[] = [], rb: string[] = [];
  for (let i = 0; i < 20; i++) {
    ra.push(a.gearPool.roll((a as any).gearRng, 'thief', 0, 300)!.id);
    rb.push(b.gearPool.roll((b as any).gearRng, 'thief', 0, 300)!.id);
  }
  eq(ra, rb, 'same seed, same drops');
}

// ---- manifest pool, genders, look overlay ----
const man: GearManifest = {
  iconAtlas: '',
  items: {
    '01040100': { slot: 'coat', name: 'Shirt', level: 5, job: 0, g: 0, stats: { pdd: 5 } },
    '01041100': { slot: 'coat', name: 'Blouse', level: 5, job: 0, g: 1, stats: { pdd: 5 } },
    '01052000': { slot: 'coat', name: 'Robe', level: 5, job: 2, long: true, stats: { pdd: 9 } },
    '01302100': { slot: 'weapon', name: 'Sword', level: 5, job: 1, stats: { pad: 20 } },
  },
};
const mp = GearPool.fromManifest(man);
ok(mp.real, 'a manifest builds a real pool');
eq(mp.eligible('warrior', 0, 0).map((i) => i.id).sort(), ['01040100', '01302100'], 'warrior male: shirt + sword');
eq(mp.eligible('warrior', 1, 0).map((i) => i.id).sort(), ['01041100', '01302100'], 'warrior female: blouse + sword');
eq(mp.eligible('magician', 0, 0).map((i) => i.id).sort(), ['01040100', '01052000'], 'magician: shirt + robe, no sword');
eq(mp.eligible('warrior', 0, 1), [], 'other tiers are empty');
eq(mp.roll(new Rng(1), 'warrior', 0, 1000)!.tier, 0, 'a tier without items falls back to a lower one');

const look = defaultLook(1302000);
eq(lookItems(look).cap, '', 'no cap by default');
const dressed = lookItems({ ...look, gear: { cap: '01002003', coat: '01052000', longcoat: true, weapon: '01302103' } });
eq([dressed.cap, dressed.coat, dressed.pants, dressed.weapon, dressed.shoes], ['01002003', '01052000', '', '01302103', '01072001'], 'gear overrides the look; a longcoat drops the pants');
eq(lookItems({ ...look, gear: {} }).coat, '01040002', 'an empty overlay keeps the creation clothes');

const capJson = (vslot: string): ItemJson => ({ id: '1', slot: 'cap', size: [1, 1], actions: {}, info: { vslot } });
eq([...hiddenHairLayers(undefined)], [], 'no cap hides nothing');
eq([...hiddenHairLayers(capJson('CpH1H5'))].sort(), ['backHair', 'hairOverHead'], 'CpH1H5 hides the top and back hair');
ok(hiddenHairLayers(capJson('CpH1H2H3H4H5H6HfHsHb')).has('hair'), 'a full helmet hides all hair');
eq([...hiddenHairLayers(capJson('Cp'))], ['hairOverHead'], 'any cap hides hairOverHead');
ok(PLAYER_BASE.hp > 0 && BOSS_EVERY > 0 && GEAR_SLOTS.length === 8, 'constants sane');
console.log(`test-gear: ok (${checks} checks)`);
