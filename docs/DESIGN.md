# MapleStory Survivor: game core design

The MVP from the playbook, on placeholder art. Real MapleStory art arrives later through a deploy-time
asset step (milestone 3) that reads the WZ paths and mob/skill ids listed in `src/maple/*.ts`.

## Rules that shape everything

- Top-down free roaming. No walls, no arena edges, no pathing. The ground repeats endlessly.
- No pausing shops. Pickups are instant on touch. The only pauses are level-up cards, the pause menu and the end screens.
- Fast from minute one; level 10 should arrive around 2 minutes.
- All motion is delta-time based. No per-frame allocation in hot loops; compare squared distances.
- The simulation is pure TypeScript with no DOM or Pixi imports, so Node can run it headlessly
  (`node --experimental-strip-types`). Rendering and UI read its state and drain its event queue.
- Mobs are side-view sprites that flip left/right to face their movement. Placeholder art follows the same rule.

## Units

World units are yards (Azeroth's unit). `PX_PER_YD = 20` at zoom 1. Player speed 7 yd/s is 140 px/s.

## Numbers (from azeroth-survivors-re `data.rs`; p = elapsed / 900, clamped 0..1)

| Knob | Value |
|---|---|
| Run length | 900 s. A boss wave every 135 s at 2:15, 4:30, 6:45, 9:00, 11:15, 13:30 (see Boss waves). Win at 15:00. |
| Enemy ladder | 30 tiers. `step = floor(p*30)`, `span = tiers-3`, `lo = min(span, max(0,step-1)*span/27)` (integer math), pool = tiers lo, lo+1, lo+2 |
| Alive target | `min(220, floor(14 + 225p))` |
| Spawner | every 0.12 s, if alive < target spawn a pack of up to 4 (never above target); ring 34 to 42 yd from the player at a random angle |
| Recycling | enemies farther than 60 yd from the player are moved back onto the spawn ring (ahead of the player's movement if moving) |
| Scaling | enemy HP x(1 + 2.5p + 4.5p^2) at spawn, damage x(1 + 0.9p + 0.6p^2); hero damage x(1 + 0.2·sqrt(level - 1) + 0.02·max(0, level - 40)), +3 max HP per level to 90. See Balance curve |
| Contact | an enemy touching the player hits for `max(1, dmg - armor)`, then waits 1.3 s (boss 1.0 s) |
| Player | HP 120, speed 7 yd/s, magnet 4.5 yd, hit radius 0.7 yd, crit 5% for x2 |
| XP | gem value = mob xp x 2.0 x growth. To next level: L<20: `5 + 10(L-1)`; L<40: `195 + 13(L-20)`; else `455 + 16(L-40)` |
| Gems | at most 350 on the ground; past that a new gem's value merges into the nearest existing gem |
| Heals | 1.5% of kills drop a Red Potion (heals 25% max HP); every boss drops an Elixir (full heal) |
| Mesos | 30% of kills drop a meso coin worth `1 + floor(tier/3)`; bosses drop a bag worth 50 x boss number. Banked at run end |
| Gachapon | the boss each wave is named after (not its companions) also drops a Gachapon capsule (see "Gachapon and evolutions"); it never expires and the pet leaves it alone |

### Enemy ladder (tier: name, v83 mob id, hp, speed yd/s, damage, xp, scale, big)

Health, damage and xp are The Barrens ladder; names and ids are classic Victoria Island mobs roughly in level order.
Mob ids are v83 Mob.wz image names (`0100100.img`); the asset step checks them against String.wz and logs any MISMATCH.

```
 0 Snail            100100   8  3.6  2  1
 1 Blue Snail       100101  10  4.4  2  1
 2 Shroom           120100  16  3.4  3  2
 3 Red Snail        130101  18  3.6  4  2
 4 Stump            130100  22  4.8  8  2
 5 Slime            210100  26  4.6  8  3
 6 Pig              1210100 36  4.0 10  3
 7 Orange Mushroom  1210102 40  4.0 11  3
 8 Ribbon Pig       1210101 34  5.0 10  3
 9 Green Mushroom   1110100 44  5.2 12  4
10 Dark Stump       1110101 70  3.3 14  5
11 Octopus          1120100 55  3.8 12  4
12 Horny Mushroom   2110200 60  5.0 13  4
13 Blue Mushroom    2220100 85  4.6 16  5
14 Evil Eye         2230100 75  5.4 15  5
15 Zombie Mushroom  2230101 90  4.2 16  6
16 Axe Stump        1130100 95  5.0 18  6
17 Jr. Necki        2130103 120 3.6 20  7
18 Wild Boar        2230102 150 4.0 22  8  big
19 Ligator          3110100 220 3.2 28 12  big
20 Curse Eye        3230100 160 5.6 24  8
21 Fire Boar        3210100 180 4.2 26 10  big
22 Jr. Boogie       3230300  90 6.0 18  5
23 Copper Drake     4130100 240 4.4 30 12  big
24 Lupin            3210800 200 6.0 30 10
25 Wraith           4230102 280 4.6 34 14
26 Stone Golem      5130101 300 4.6 36 14  big
27 Drake            5130100 420 3.4 42 24  big
28 Dark Stone Golem 5130102 380 4.4 44 22  big
29 Mixed Golem      5150000 360 5.0 40 20  big
```

Behaviours (see "Mob behaviours and ailments"): **ranged** Evil Eye, Curse Eye, Jr. Boogie, Lupin, Wraith (tiers 14, 20, 22, 24, 25); **charge** Pig, Ribbon Pig, Axe Stump, Wild Boar,
Fire Boar (tiers 6, 8, 16, 18, 21); **fly** Evil Eye, Curse Eye, Jr. Boogie, Wraith (no crowding, a hover bob). Every other tier walks.

Big mobs draw at 1.3x and use radius 1.0 yd; others 0.6 yd. Health, damage and xp read from the running peak
of the ladder, so no later tier is softer (Azeroth's `ladder()`).

### Bosses (in order)

| # | Name | mob id | HP | speed | dmg | xp | scale | mechanics |
|---|---|---|---|---|---|---|---|---|
| 1 | Mano | 2220000 | 900 | 5.2 | 20 | 60 | 1.6 | nova, ailment (Weakness) |
| 2 | Mushmom | 6130101 | 2400 | 5.4 | 32 | 120 | 1.6 | nova, summon, ailment (Poison) |
| 3 | King Slime | 9300003 | 6000 | 4.0 | 45 | 200 | 1.7 | summon, berserk, ailment (Weakness) |
| 4 | Zombie Mushmom | 6300005 | 11000 | 5.6 | 55 | 300 | 1.7 | nova, summon, berserk, ailment (Curse) |
| 5 | Jr. Balrog | 8130100 | 20000 | 5.0 | 70 | 400 | 1.8 | nova, summon, berserk, ailment (Seal) |
| 6 | Zakum | 8800000 | 42000 | 4.8 | 90 | 500 | 1.8 | nova, summon, berserk, ailment (Darkness + Seal) |

Boss radius `1.6 * scale` yd. A boss spawns on the ring with a raid warning. A NEXT BOSS countdown is always visible.

### Boss waves

The six boss times bring waves of 1, 1, 2, 2, 3 and 3 bosses (twelve in a run). A wave is the scheduled boss at full HP plus companions: the bosses
just below it on the ladder (wave 3: King Slime + Mushmom; wave 6: Zakum + Jr. Balrog + Zombie Mushmom) at 70% HP, spread evenly around the
spawn ring, with a "Boss wave!" banner. Every boss has its own HP bar; the HUD stacks the bars of the (up to) three oldest living ones, and
earlier bosses that are still alive stay in play. A boss drops 3 items (the first one tier above the run's item tier, 5% two above), one more
for every four bosses slain before it (max 5). The win condition is unchanged: survive 15:00.

### Enemy speed

Mob.wz `info/speed` is a percent offset (0 normal, -100 slowest); flyers use `info/flySpeed`; `info/fs` (a float multiplier) is the fallback.
The extractor writes `speed = clamp(1 + speed/100, 0.3, 2)` per mob in the manifest and logs `speed / flySpeed / fs` of every wanted mob; the Sim takes
`mobSpeeds: Record<mobId, factor>` and moves an enemy at `min(4.4 * factor, 0.95 * hero base speed)` yd/s. Without a table (or for a mob not in it) the
hand-tuned ladder speeds above apply.

Raid mechanics (each boss runs its own timers; a cast bar shows on the HUD while it casts):
- **nova**: every 10 s the boss stops, casts for 2.0 s and shows a growing danger circle of radius 9 yd centred on itself. When the cast ends, the player takes 35% of max HP if inside. Raid warning: "<Boss> is casting Ground Slam! Get out!".
- **summon**: every 14 s spawn 8 enemies of the current top tier in a ring of 4 yd around the boss. Warning "<Boss> calls for help!".
- **berserk**: 75 s after spawning the boss enrages: damage x2, speed x1.4, tinted red. Warning "<Boss> goes berserk!".
- **ailment**: every 16 s the boss stops, casts for 1.2 s and shows a purple danger circle of radius 8 yd around itself; when the cast ends every ailment of the boss lands on a hero inside (see below). Warning "<Boss> casts Seal!".

## Hero: Magician (and the other classes)

Starts with Magic Claw. Holds at most 6 skills (max level 8) and 6 passives (max level 5).
Skill ids are v83 Skill.wz ids, kept for the icons and effects. The skills and passives of every class, split by job
(1st job from the start, a 2nd job chosen at level 30, its 3rd job at level 70), are in docs/CLASSES.md.

Skill level scaling (Azeroth `Owned`): damage x(1 + 0.3(L-1)); cooldown x 0.93^(L-1), then x max(0.35, 1 - haste), floor 0.2 s;
count +1 at levels 3, 5 and 7; radius x(1 + 0.08(L-1)) x area; duration x(1 + 0.1(L-1)).

## Level-up cards

Every level opens a 3-card choice and pauses the run until a card is picked. Several pending levels open one after another.
Level 30 first opens a job card choice (docs/CLASSES.md). Offers come from the skills and passives of the jobs unlocked so far: new skills (while fewer than 6), upgrades of owned skills below max, new passives (while fewer than 6),
upgrades of owned passives below max; one of the three is always a skill card while any is available. Banished keys never return. When fewer than three cards are left, the rest are Masteries, so levelling never ends: Mastery (+8% damage), Vitality (+10% max HP, heals 25%), Swiftness (+4% move speed, up to +40%), Focus (+3% crit, up to +60%), Haste (+4% cooldown speed, up to +40%), Reach (+6% area), Magnet (+10% pickup range) and "Skill Mastery: <owned skill>" (+10% damage of that skill, no cap). Masteries stack, show an owned skill's icon, and cannot be banished; later Mastery slots sometimes (10%) turn into an Elixir (full heal) or Meso bag (+25 mesos), the first one never does.
Each run has 2 rerolls and 2 banishes (banish removes that card's key from the run and redraws the slot).
Cards show icon placeholder, name, "NEW" or "Lv N > N+1", and a one-line effect.

## Gachapon and evolutions

Both live in new files (`src/game/gachapon.ts`, `src/game/evolutions.ts`, UI in `src/ui/gachapon.ts`); `sim.ts` only has small hooks.
Neither pauses the run.

- **Capsule.** The boss a wave is named after drops a GACHA pickup (companions do not) (value = boss number) next to the Elixir and the meso bag. It does not expire, the pet never
  fetches it (the hero walks to it), the radar shows it as an orange square on its rim when it is far away. Icon: Gachapon Ticket
  (Item.wz `Cash/0522.img/05220000`, role `gacha`), else a drawn two-colour ball.
- **Roll.** On touch the sim's rng picks 1, 3 or 5 upgrades. Boss #1: 75 / 22 / 3 %; each later boss index adds 6 % to "3" and 2 % to "5", taken from "1"
  (boss #6: 35 / 52 / 13 %).
- **Upgrades**, one by one: the first is the Mastery Book evolution when a recipe is ready; otherwise +1 level to a random owned skill below max, else a random
  owned passive below max (stats recalculated), else 25 mesos x boss number. The sim emits `{ type: 'gacha', boss, count, results }`.
- **Reveal.** `GachaUi` shows a panel (the status-bar blue and white of the HUD pills) that ticks through the results one by one between 0.5 s and 2.5 s with
  icon and "Lv N > N+1", then fades; five upgrades get a larger "JACKPOT!" panel with a glow. A second capsule waits for the first. Sounds: `game.drop`
  (`game.levelup` for 5), a tick per result.
- **Evolutions.** There is no 4th job, so each 3rd job has one recipe (docs/CLASSES.md): the 3rd-job skill at SKILL_MAX_LEVEL AND the partner passive owned (any
  level). When ready, the next capsule's first upgrade is a Mastery Book: the base skill is REPLACED in its slot by the 4th-job skill at SKILL_MAX_LEVEL; the base
  key is banished for the run, the evolved key is not in the card pool, so neither is ever offered again. Banner and note: "Mastery Book! <Base> evolved into
  <Evolved>", plus the job-advancement effect (`evolve` event). Evolved skills are SkillDefs of the existing kinds with `evolved: true`; their ids are in
  `WANTED_SKILLS`, so the asset step extracts their icons and effects (a wrong id only logs MISMATCH).
- **Passive slot.** Passive slots are full long before level 70 (when the partner passives become available), so a hero who owns a recipe's skill may take that
  recipe's partner into one extra passive slot (7 passives at most; each 3rd job has exactly one recipe). The status bar shows seven passive icons.
- **Cards.** A maxed 3rd-job skill whose partner is not owned makes the partner passive twice as likely in offers. Cards of skills and passives in a recipe show
  "Evolves into <Evolved> with a Mastery Book" / "Evolves <Skill> with a Mastery Book".
- **Fallback.** Once the last boss has spawned (no capsule is left to come), a ready recipe drops a Mastery Book pickup from normal kills at 0.2 % per kill, one on
  the ground at most; touching it evolves like a capsule. Own seeded stream. In headless bot runs it is rarely needed (see timing below).
- **Timing** (headless bot, 10 branches x 3 seeds, god mode and mortal runs identical): level 70 at 6:54 to 7:50 (median 7:26; one slow Priest run 10:23). When the
  bot takes the recipe's skill and partner cards the skill is maxed at 7:22 to 9:10 (one run 10:37) and the evolution happens in the 9:00 boss's capsule (9:03 to
  9:41, one slow run 10:40) in all 30 runs. With plain first-card picks the skill is maxed at 8:40 to 10:40 in only 18 of 30 runs (the others never own it) and the evolution lands in the 9:00 or
  the 11:15 boss's capsule. So the fallback Mastery Book (after 13:30) is rarely needed; it covers players who max the skill late.
- **Balance** (one skill alone at max level, test-gacha): damage against a boss-sized target is x2.8 to x3.2 the base skill for the eight non-line skills and their
  crowd damage x2.9 to x3.6; the two line skills (Hurricane, Piercing Arrow) are x7.7 and x9.9 against a boss but only x0.3 and x0.7 against a dense crowd, since their
  bases (Arrow Rain's carpet, Arrow Eruption's strikes) are crowd or weak-on-bosses skills. Boss lifetimes in bot runs: Zakum 42 s average without evolutions, 30 s with.

## Henesys shop

Mesos banked at the end of a run (a quit counts too) are spent on permanent upgrades in Rina's shop in Henesys (VS PowerUps / Halls of Torment blessings).
The "Henesys Shop" button sits on the title / signboard, the character select stage and the results screen (`src/ui/shop.ts`). The window uses the Equip /
Inventory look (navy title bar, cream body, X to close, Esc closes): Rina's portrait and a speech line on the left, one row per upgrade on the right (icon,
name, rank pips and "Rank 2/5", the next rank's effect, price in mesos, Buy), the hero's banked mesos at the bottom with "Refund all". Refund needs a second click
("Yes, refund N", Cancel next to it); there are no `confirm()` dialogs. Buying and refunding write the save at once.

Rank r+1 costs `base x growth^r`, rounded to the nearest 10 (`metaCost` in `src/game/meta.ts`). A refund returns every meso spent at the current prices.

| key | name | per rank | max | base cost | growth | total cost |
|---|---|---|---|---|---|---|
| hp | Max HP | +8% max HP | 5 | 200 | 1.6 | 3160 |
| might | Might | +5% damage | 5 | 300 | 1.6 | 4750 |
| haste | Haste | +4% cooldown speed | 5 | 300 | 1.6 | 4750 |
| armor | Armor | +1 flat armor | 3 | 400 | 1.8 | 2420 |
| speed | Speed | +3% move speed | 3 | 250 | 1.6 | 1290 |
| magnet | Magnet | +12% pickup radius | 3 | 150 | 1.5 | 720 |
| growth | Growth | +4% EXP | 5 | 350 | 1.6 | 5550 |
| greed | Greed | +8% mesos | 5 | 250 | 1.6 | 3950 |
| reroll | Gachapon Ticket | +1 reroll per run | 3 | 500 | 2.0 | 3500 |
| banish | Trash Can | +1 banish per run | 3 | 500 | 2.0 | 3500 |
| revive | Safety Charm | one revive per run at 50% HP | 1 | 3000 | 1 | 3000 |

Everything costs 36570 mesos (`metaTotalCost()`).

- **Save.** `SaveData.meta` holds the rank per key; a save without it (or with junk in it) loads as all zeros, ranks are clamped to 0..max.
- **In the run.** `main.ts` passes `meta: save.meta` to the Sim. `recalc()` adds the ranks to the other sources: Might and Haste add to the passive and Mastery sums
  (Might is then scaled by the level bonus like the rest), Max HP adds to the +% max HP sum, Armor is flat, Speed, Magnet and Growth add to their sums. Rerolls and
  banishes start at `START_REROLLS + rank` / `START_BANISHES + rank`. Greed goes through `Sim.gainMesos()` (every meso source: coins, bags, Mastery meso bags, capsule
  and Mastery Book mesos); the fraction a pickup does not pay out carries over to the next one.
- **Safety Charm.** When a hit would kill the hero (not in god mode) and the charm is owned and unused, `hurtPlayer` calls `revive()` instead of ending the run:
  the hero comes back at 50% max HP with their ailments cured, no damage lands for 3 s, and a burst pushes every enemy within 9 yd out to 10 yd and stuns normal
  mobs for 1.5 s (bosses are pushed, not stunned). It emits `{ type: 'revive', x, y, r }` and the raid warning "Safety Charm activated!"; `playSimEvents` plays
  `game.levelup`. Once per run.
- **Art.** Icons are the level-up card icons: passives from Skill.wz (Improved MaxHP Increase, Rage, Sword Booster, Iron Body, Nimble Body, Keen Eyes, Holy Symbol, Meso Up),
  the Gachapon Ticket (Cash 5220000) and the Safety Charm (Cash 5130000, role `metaRevive` of the items icon atlas); Trash Can has no item and shows a plain tile, as does any icon that
  was not extracted. Rina's portrait is the `stand` frame of `Npc.wz` `1012100.img` (manifest `npc`, `scripts/fetch-maple-npc.ts`); the id is checked against String.wz
  `Npc.img/1012100/name` and, when that is not "Rina", the name is searched (a 1012xxx id first). Without art the shop shows a silhouette.
- **Balance** (`scripts/balance-meta.ts`, 12 seeds x 4 classes, the kiting bot, card 0, empty shop vs everything bought). The bot wins 48/48 either way, so the shop shows
  up in damage taken and kill speed, not in wins. The Safety Charm never fired (the bot never died):

| class | damage taken, empty > full | Zakum kill from its spawn, empty > full | mesos per run, empty > full |
|---|---|---|---|
| Warrior | 1401 > 925 | 48 s > 24 s | 27.8k > 44.9k |
| Magician | 82 > 18 | 8 s > 8 s | 21.0k > 34.0k |
| Bowman | 91 > 39 | 7 s > 11 s | 34.4k > 51.7k |
| Thief | 837 > 632 | 9 s > 12 s | 37.4k > 54.5k |

  A run banks about 30k mesos for the bot (20-37k), so the whole shop (36570) is about 1.2 runs of bot income. Kill times of the ranged classes are noise (a different
  build and a different fight position, 7-12 s); the Warrior melee bot halves its time. Human runs are shorter and poorer, but the prices are probably low by a factor of 10 or more.

## Elites, events and field items

Three systems in new files (`src/game/elites.ts`, `events.ts`, `fieldItems.ts`), each with its own seeded random stream so the run's other draws never shift;
`sim.ts` only has small hooks, and `new Sim(seed, cls, { events: false })` switches all three off (the baseline of `scripts/balance-events.ts`). None of it pauses the run.
Event mobs and boxes carry `Enemy.ev` (stampede / ring / treasure / box): the spawner does not count them against the alive target and the recycler leaves them alone.

- **Elites.** From 0:45, every 50 to 70 s one fresh normal spawn is promoted (it waits while 2 or more bosses are alive): 1.5x drawn size and hit radius, HP x(6 + 6p),
  damage x1.3, xp x2, counts as big (its HP bar is always up), a tint per affix, the name "Elite <Mob>" with the affix under it, and the banner "An Elite <Mob> appears!".
  One affix each: **Swift** (1.5x speed, still under the hero's), **Armored** (every hit does 40% less), **Splitting** (4 normal mobs of its tier on death, marked as adds),
  **Blazing** (a fire patch of 1.5 yd every second, lasting 4 s; standing in one for 0.6 s starts a burn of half the Elite's damage every 0.5 s), **Vampiric** (heals 3% max HP
  per hit on the hero). Kill loot: a Gachapon capsule with exactly one upgrade (`ELITE_CAPSULE + n` as the pickup value; the Mastery Book still comes first when a recipe is
  ready), a meso bag (20 + 15 x the tier's coin), a scroll, and a field item. Counted in the results ("Elites slain") and `snapshot().elitesKilled`. The radar shows Elites as
  purple dots.
- **Swarm events.** About every 100 to 140 s, never within 15 s of a boss spawn (it waits). **Snail stampede**: 30 to 50 Blue / Red Snails (the current low tier from tier 8 on)
  enter in a 12 wide column from one cardinal edge and march across at 1.6x speed ignoring the hero, then are removed past the far edge (40 yd, 45 s at most; no loot, no kill).
  **Closing Ring**: 40 mobs of the current top tier in a full ring at 18 yd, walking inward (a ring mob left far behind turns into a plain mob). **Treasure Swarm**: 12 Ribbon Pigs
  that run away from the hero (at 0.88x the hero's speed, each with its own sideways angle) for 20 s, then vanish; a killed pig drops 5x its coin, and every 4th pig killed (the first included) a field item.
- **Boxes and field items.** A breakable Maple box (an Enemy with 1 HP that never moves or attacks, so any skill that hits it breaks it) appears on the spawn ring ahead of the
  hero's movement every 60 to 90 s, at most 3 on the map, and drops one field item. Elites drop one too, and every 4th Treasure Pig. Field items are `FIELD` pickups (value = item): touch
  only (no magnet, no pet), gone after 75 s. Weights: Apple 35, 2x EXP Coupon 20, Warrior Elixir 20, Ludibrium Clock 15, Powder Keg 10.
  **Apple** heals 30% max HP. **Coupon** pulls every gem on the map to the hero and makes gems worth 2x for 30 s. **Warrior Elixir** +40% damage for 20 s. **Clock** freezes every
  non-boss mob (no movement, no contact damage) for 5 s and slows bosses 50%. **Powder Keg** kills every non-boss, non-Elite mob within 20 yd (normal gems and drops) and deals 10%
  max HP to Elites and bosses in range. Timed buffs show as small icons with the seconds left under the kills pill of the HUD.
- **Art.** `scripts/fetch-maple-items.ts` tries guessed Item.wz ids per field item (`FIELD_ICONS`: Apple 2010000 is sure, the rest are guesses) and logs every miss; the game draws
  placeholder icons (apple, ticket, bottle, clock, barrel, crate) for anything missing, so a wrong id costs nothing. Elites tint the mob's sprite; fire patches, boxes and the
  Powder Keg blast are drawn without any extracted art.
- **Balance** (`node --experimental-strip-types scripts/balance-events.ts 12`, kiting bot, 12 seeds x 4 classes, with vs without all three): see the table below.

| class | wins without / with | final level without / with | lowest HP (average) without / with | damage taken without / with | Zakum kill time without / with |
|---|---|---|---|---|---|
| Warrior | 12/12, 12/12 | 220 / 213 | 67% / 60% (worst 30%) | 547 / 1401 | 37 s / 48 s |
| Magician | 12/12, 12/12 | 267 / 275 | 89% / 87% | 25 / 82 | 11 s / 8 s |
| Bowman | 12/12, 12/12 | 254 / 260 | 92% / 90% | 24 / 91 | 9 s / 7 s |
| Thief | 12/12, 12/12 | 262 / 259 | 94% / 80% | 37 / 837 | 15 s / 9 s |

Per run with behaviours: 240 to 2170 shots fired (3 to 61 hit; the bot steps aside from most of them), 25 shooters at the most, 120 to 1450 charges and 0 to 5.6 ailments landed (from shots; the bot
never stood in a boss circle). Damage taken grows 3 to 23 times and the lowest HP falls for every class, most for the melee Warrior and the Thief, while all 48 runs are still won. The ranged classes
kill most shooters before they get a shot off and the bot dodges what is left, so a human who does not dodge feels this more than the numbers do (the bot's dodge is deliberately weak: a strong one
steers it away from the gems and starves it of EXP).

## Presentation (placeholder art, Pixi v8 WebGL, menus and HUD as a DOM overlay)

- Camera follows the player. Ground: a tiled grass texture generated at boot (two greens, a few flowers), repeating forever.
  Optionally scatter a few procedural decorations (bushes, signposts) on a hashed grid so movement reads.
- Mobs: generated textures per tier, colored blobs with eyes and a darker outline, sized from scale. Snails get a shell, mushrooms a cap
  (shape by name keyword: snail, mushroom/shroom, stump, slime, pig, eye, boar, golem, drake, other). Bob on a 2-frame walk cycle.
  Flip horizontally to face movement. White flash for 80 ms on hit. Fade and shrink on death.
- Bosses: the same generator at boss scale with a crown, plus an HP bar above them. Every other enemy shows a small green HP bar above its head for 3 s after its last hit.
- Player: a small chibi magician (robe, hat, staff) generated texture, flipped toward movement.
- Skills: simple VFX per kind (missile sprite, strike flash, expanding ring for nova, translucent circle for ground, lightning line for chain).
- Damage numbers: a pooled set (max ~120 live) of Pixi BitmapText or Text created once and reused; orange for normal, red-ish large for crits,
  purple for damage to the player. No per-frame text creation.
- HUD (DOM, MapleStory-ish blue/white status bar look): HP bar, EXP bar along the bottom, level, timer mm:ss, NEXT BOSS countdown,
  kills, mesos, the owned skill and passive icons with levels, boss HP bar and cast bar at the top while a boss lives,
  raid warning text in the centre for 3 s, and a small radar minimap (canvas, top right) with enemy dots, boss dot and pickups.
- Screens: title (Start, best time, banked mesos), level-up cards, pause (Esc or P: resume, quit), results (time survived, level, kills,
  mesos earned, bosses killed; Retry and Menu), victory at 15:00.
- Input: WASD and arrow keys; on touch devices a virtual joystick (touch anywhere on the left half, drag).
- Saves in localStorage (wrapped in try/catch): banked mesos, best time, settings (volume placeholder).

## Bot hooks

In dev builds and when the URL has `?bot`, expose `window.game` with:
`sim` (the live simulation), `start(seed?)`, `step(seconds)` (advance the sim headlessly in fixed 1/60 s ticks, auto-handling nothing),
`pick(i)`, `reroll()`, `banish(i)`, `setInput(x, y)`, `god(on)` (no damage taken, damage still recorded), `speed(mult)` (time scale),
`autopick(on)` (pick card 0 automatically), and `snapshot()` returning a plain object: elapsed, hp, maxHp, level, xp, kills, alive enemies,
boss info, owned skills and passives, pending card offer, over/won Also in the snapshot: `mob` (behaviours on, shooters, shots in flight, shots fired / landed, charges) and `ailments` (landed so far, seconds left by id), `gacha` (capsules and Mastery Books on the ground), `evolved` (evolved skill keys) and `evolutionReady` (the evolved key whose recipe is ready, or null).

## Assets (milestone 3)

`src/maple/assets.ts` is the single source of truth: the wanted mob ids (ladder + bosses, from `data.ts`), skill and passive ids,
BGM nodes and the manifest types. `scripts/fetch-maple.ts` (run in CI after `vite build`) imports it, gets Mob/Skill/String/Sound `.wz`
(download from the mirrors in `scripts/maple-sources.json`, `innoextract` then `7z`; cached in `.maple-cache/wz/`) and writes `dist/maple/`:

- `mobs/<id7>.png` atlas per mob (stand, move, hit1, die1, attack1, and `attack1/info/ball` as action `ball` when a ranged mob has one; `info/link` followed; `fly` stands in for a missing `move`), frame records
  `{action,index,x,y,w,h,ox,oy,delay}`, info (maxHP, speed, level, bodyAttack), name from String.wz.
- `skills/<id7>.png` atlas (effect, ball, hit) and `skills/<id7>-icon.png` per skill and passive.
- `bgm/run.mp3` (Bgm00.img/FloralLife) and `bgm/title.mp3` (BgmUI.img/Title), raw Sound_DX8 payload.
- `npc/shop.png` (Npc.wz, Rina's `stand` frames for the Henesys shop; see "Henesys shop") and the Safety Charm icon in `items/icons.png`.
- `manifest.json`: `{version, source:{mirror,region,wzVersion}, mobs, skills, bgm}`, paths relative to `maple/`.

The step never fails the build. The CI log has a mob table (tier, id, expected name, String.wz name, MISMATCH/MISSING), totals, missing
lists, per-skill lines, BGM header bytes and ASCII previews (Snail, Orange Mushroom, Mano, Zakum, Magic Claw icon).
`scripts/test-maple.ts` runs it against synthetic WZ files (`scripts/wz-writer.mjs`, `scripts/maple-fixture.mjs`); no Nexon data is in the repo.

In the game, `loadManifest()` + `buildArt()` run at boot (12 s cap). Everything is optional and falls back piece by piece:
mobs draw their real frames (move while walking, hit1 on damage, die1 on death, attack1 while a boss casts) at native size times the world zoom,
anchored at the WZ origin and mirrored so they face their travel direction (art faces left); sim radii are unchanged. Skill icons replace the
placeholder icons in the HUD and level-up cards; `ball` frames replace missiles, `hit` frames play on impact, `effect` frames on nova, ground and strike casts.
BGM (`src/maple/audio.ts`) plays the title track on the menu and FloralLife in runs, looped, after the first user gesture, with the saved volume
and a mute toggle (title screen button, HUD `M` button).

## Regions and sound effects

The run is split into 7 regions that change when each boss spawns (`regionAt` in `src/game/regions.ts`; the sim keeps `sim.region`
and emits a `region` event). Each region is built by the asset step from one real field map (`src/maple/region-data.ts` lists the
candidates): its dominant tile set as the ground, its nature objects as clustered decor (`src/render/cluster.ts`), its BGM and its
String.wz name for the map banner. The renderer cross-fades ground and decor over 2.5 s; music cross-fades over 1.5 s.
Sound effects come from Sound.wz (`scripts/fetch-maple-sfx.ts`, keys in `src/maple/region-types.ts`) and play through
`src/maple/sfx.ts`, which maps the sim's events to sounds; the sim itself stays free of audio. Everything degrades to the old look
and silence when the manifest lacks `regions` / `sfx`.

## Gear drops

Items come in 8 tiers by reqLevel (0-9, 10-19, ..., 60-79, 80-99; the extractor keeps classic items up to level 99, at most ~320 items). The run starts at item tier 1 and goes up one
tier every 90 s to tier 7 (at 9:00). A drop is the run's tier, 15% of the time one higher. Normal kills drop gear 0.8% of the time, big mobs and tier 18+ 2%.
Bosses drop 3 items (see Boss waves). Dropped gear glows and prints its name in a tier colour: grey (tiers 0-1), white (2-3), blue (4-5), purple (6), gold (7).

The extractor (scripts/fetch-maple-gear.ts) keeps at most ~320 items under a ~2 MB byte budget, with per-tier quotas (t0 24, t1 30, t2 34, t3-t7 46 each) so the late tiers always exist.
Buckets are (tier, slot, class, gender); each bucket's best item is taken first (clean items before ones flagged tuc 0 / notSale / exItem / setItemID / charmEXP / tradeBlock, then classic ids, then the highest reqLevel in the window).
An empty bucket borrows the nearest higher-level item (up to reqLevel 120, then lower ones) and the manifest entry carries a `tier` override. The CI log prints a per-slot scan table (scanned / candidates / clean per tier, the rejection reasons and sample items) and the kept per-slot per-tier table.

## Balance curve (scripts/balance-probe.ts)

`node --experimental-strip-types scripts/balance-probe.ts [seeds] [class]` (PROBE_GEAR=real: a pool with MapleStory-sized item stats; PROBE_SPEEDS=rand: random mob speeds) plays the kiting bot (always card 0) over seeds and prints, per class, the win rate, the
average time to kill each boss and the hero and mob numbers at minutes 1, 3, 5, 8, 12, 15. "dmg/hit" is the average base damage of the owned skills times the hero's damage
multiplier (level, passives, gear, Masteries). Targets and results (12 seeds x 4 classes, placeholder gear):

| minute | hero damage per hit vs minute 1 | mob HP (mid-ladder tier) | mob contact damage |
|---|---|---|---|
| 1 | x1 (24-45) | 19 | 3 |
| 3 | x2.3 | 60 | 12 |
| 5 | x4-6 | 163 | 19 |
| 8 | x9-12 | 343 | 30 |
| 12 | x23-33 | 1411 | 63 |
| 15 | x33-44 (850-1590) | 3360 | 110 |

Enemy HP and damage use a quadratic ramp so the first minutes stay as before and the late game keeps up with the hero (hits to kill a mob: 0.6 at minute 1, 1.5 at 8, 3 at 15). Bosses take 10-30 s of
fighting at the end for the ranged classes (the melee bot rarely stays next to a boss, so the Warrior takes longer). The bot wins about 96% of runs (it won 100% before).

## Classic MapleStory UI (src/ui)

- Title: `login.ts` builds the classic login screen (Map.wz `Back/login.img` sky, strip and drifting clouds, `Login.img` logo, signboard, `BtLogin`/`BtNew`) and the character select stage (name tag, level, job). It is used only when both real buttons were extracted; otherwise the plain title window stays. `Screens.addTitleButton(label, fn)` adds a button to either title (Monster Book slot).
- Status bar: `hud.ts`, laid out at 800x71 and scaled by `--sbs` (`layout.ts statusScale`: whole multiples when wide, shrinks to fit when narrow). HP red, MP blue (= average skill cooldown readiness), EXP along the bottom, tinted by class (warrior red, magician blue, bowman green, thief purple; the real gauge image is hue-rotated from its own base hue). Quick slots show the active skills with a cooldown overlay and the passives small.
- Windows: `windows.ts` Equip (Q), Inventory (I), Stats (C): draggable by the title, never pause, close with X or the key. Slot coordinates live in `layout.ts` (tested). The Inventory shows `sim.bag` (up to 24 unequipped items; `sim.equipFromBag(id)`, `sim.unequip(slot)`); double-click or right-click wears / takes off.
- `window.game.ui()` returns `{screen, windows}` for bot tests.
