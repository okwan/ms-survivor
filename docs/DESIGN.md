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
| Run length | 900 s. Boss every 135 s: six bosses at 2:15, 4:30, 6:45, 9:00, 11:15, 13:30. Win at 15:00. |
| Enemy ladder | 30 tiers. `step = floor(p*30)`, `span = tiers-3`, `lo = min(span, max(0,step-1)*span/27)` (integer math), pool = tiers lo, lo+1, lo+2 |
| Alive target | `min(220, floor(14 + 225p))` |
| Spawner | every 0.12 s, if alive < target spawn a pack of up to 4 (never above target); ring 34 to 42 yd from the player at a random angle |
| Recycling | enemies farther than 60 yd from the player are moved back onto the spawn ring (ahead of the player's movement if moving) |
| Scaling | enemy HP x(1 + 3p) at spawn, damage x(1 + 0.9p); hero damage x(1 + 0.2·sqrt(level - 1)), +3 max HP per level to 60 |
| Contact | an enemy touching the player hits for `max(1, dmg - armor)`, then waits 1.3 s (boss 1.0 s) |
| Player | HP 120, speed 7 yd/s, magnet 4.5 yd, hit radius 0.7 yd, crit 5% for x2 |
| XP | gem value = mob xp x 2.0 x growth. To next level: L<20: `5 + 10(L-1)`; L<40: `195 + 13(L-20)`; else `455 + 16(L-40)` |
| Gems | at most 350 on the ground; past that a new gem's value merges into the nearest existing gem |
| Heals | 1.5% of kills drop a Red Potion (heals 25% max HP); every boss drops an Elixir (full heal) |
| Mesos | 30% of kills drop a meso coin worth `1 + floor(tier/3)`; bosses drop a bag worth 50 x boss number. Banked at run end |

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

Big mobs draw at 1.3x and use radius 1.0 yd; others 0.6 yd. Health, damage and xp read from the running peak
of the ladder, so no later tier is softer (Azeroth's `ladder()`).

### Bosses (in order)

| # | Name | mob id | HP | speed | dmg | xp | scale | mechanics |
|---|---|---|---|---|---|---|---|---|
| 1 | Mano | 2220000 | 700 | 5.2 | 20 | 60 | 1.6 | nova |
| 2 | Mushmom | 6130101 | 1800 | 5.4 | 32 | 120 | 1.6 | nova, summon |
| 3 | King Slime | 9300003 | 4200 | 4.0 | 45 | 200 | 1.7 | summon, berserk |
| 4 | Zombie Mushmom | 6300005 | 7000 | 5.6 | 55 | 300 | 1.7 | nova, summon, berserk |
| 5 | Jr. Balrog | 8130100 | 12000 | 5.0 | 70 | 400 | 1.8 | nova, summon, berserk |
| 6 | Zakum | 8800000 | 20000 | 4.8 | 90 | 500 | 1.8 | nova, summon, berserk |

Boss radius `1.6 * scale` yd. A boss spawns on the ring with a raid warning. A NEXT BOSS countdown is always visible.

Raid mechanics (each boss runs its own timers; a cast bar shows on the HUD while it casts):
- **nova**: every 10 s the boss stops, casts for 2.0 s and shows a growing danger circle of radius 9 yd centred on itself. When the cast ends, the player takes 35% of max HP if inside. Raid warning: "<Boss> is casting Ground Slam! Get out!".
- **summon**: every 14 s spawn 8 enemies of the current top tier in a ring of 4 yd around the boss. Warning "<Boss> calls for help!".
- **berserk**: 75 s after spawning the boss enrages: damage x2, speed x1.4, tinted red. Warning "<Boss> goes berserk!".

## Hero: Magician

Starts with Magic Claw. Holds at most 6 skills (max level 8) and 6 passives (max level 5).
Skill ids are v83 Skill.wz ids, kept for the icons and effects later.

Skill level scaling (Azeroth `Owned`): damage x(1 + 0.3(L-1)); cooldown x 0.93^(L-1), then x max(0.35, 1 - haste), floor 0.2 s;
count +1 at levels 3, 5 and 7; radius x(1 + 0.08(L-1)) x area; duration x(1 + 0.1(L-1)).

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| magic_claw | Magic Claw | 2001005 | bolt | 10 | 1.2 | 22 | 0 | 2 | missile 30 yd/s at the nearest `count` enemies |
| energy_bolt | Energy Bolt | 2001004 | pierce | 14 | 2.0 | 24 | 0 | 1 | missile that passes through 3 + level enemies |
| fire_arrow | Fire Arrow | 2101004 | bolt | 20 | 2.4 | 26 | 3.5 | 1 | explodes on hit, splash radius |
| cold_beam | Cold Beam | 2201004 | strike | 22 | 2.6 | 20 | 2.5 | 1 | instant, splash, slows to 50% for 2.5 s |
| thunder_bolt | Thunder Bolt | 2201005 | strike | 12 | 3.0 | 10 | 0 | 4 | instant hits on the nearest `count` within range |
| poison_mist | Poison Mist | 2111003 | ground | 7 | 8.0 | 20 | 6 | 1 | area at the densest enemy, ticks every 0.5 s for 5 s |
| explosion | Explosion | 2111002 | nova | 16 | 4.0 | 0 | 7 | 1 | everything around the hero |
| chain_lightning | Chain Lightning | 2221006 | chain | 18 | 3.2 | 18 | 8 | 4 | jumps to the nearest unhit enemy within radius, -10% per jump |

Passives:

| key | name | id | stat | per level |
|---|---|---|---|---|
| int | Intelligence | 2000000 | might (damage x) | +10% |
| hyper_body | Hyper Body | 1301007 | max HP | +20% |
| haste | Haste | 4101004 | move speed | +10% |
| meditation | Meditation | 2101001 | haste (cooldown) | +8% |
| magic_guard | Magic Guard | 2001002 | armor (flat) | +1 |
| element_amp | Element Amplification | 2110001 | area | +10% |
| pet_pickup | Item Pickup | 8 | magnet | +40% |
| holy_symbol | Holy Symbol | 2311003 | growth (xp) | +8% |
| recovery | Recovery | 1001 | regen HP/s | +0.5 |
| sharp_eyes | Sharp Eyes | 3121002 | crit | +5% |

## Level-up cards

Every level opens a 3-card choice and pauses the run until a card is picked. Several pending levels open one after another.
Offers come from: new skills (while fewer than 6), upgrades of owned skills below max, new passives (while fewer than 6),
upgrades of owned passives below max. Banished keys never return. If nothing is left, offer "Elixir" (full heal) and "Meso bag" (+25 mesos).
Each run has 2 rerolls and 2 banishes (banish removes that card's key from the run and redraws the slot).
Cards show icon placeholder, name, "NEW" or "Lv N > N+1", and a one-line effect.

## Presentation (placeholder art, Pixi v8 WebGL, menus and HUD as a DOM overlay)

- Camera follows the player. Ground: a tiled grass texture generated at boot (two greens, a few flowers), repeating forever.
  Optionally scatter a few procedural decorations (bushes, signposts) on a hashed grid so movement reads.
- Mobs: generated textures per tier, colored blobs with eyes and a darker outline, sized from scale. Snails get a shell, mushrooms a cap
  (shape by name keyword: snail, mushroom/shroom, stump, slime, pig, eye, boar, golem, drake, other). Bob on a 2-frame walk cycle.
  Flip horizontally to face movement. White flash for 80 ms on hit. Fade and shrink on death.
- Bosses: the same generator at boss scale with a crown, plus an HP bar above them.
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
boss info, owned skills and passives, pending card offer, over/won.

## Assets (milestone 3)

`src/maple/assets.ts` is the single source of truth: the wanted mob ids (ladder + bosses, from `data.ts`), skill and passive ids,
BGM nodes and the manifest types. `scripts/fetch-maple.ts` (run in CI after `vite build`) imports it, gets Mob/Skill/String/Sound `.wz`
(download from the mirrors in `scripts/maple-sources.json`, `innoextract` then `7z`; cached in `.maple-cache/wz/`) and writes `dist/maple/`:

- `mobs/<id7>.png` atlas per mob (stand, move, hit1, die1, attack1; `info/link` followed; `fly` stands in for a missing `move`), frame records
  `{action,index,x,y,w,h,ox,oy,delay}`, info (maxHP, speed, level, bodyAttack), name from String.wz.
- `skills/<id7>.png` atlas (effect, ball, hit) and `skills/<id7>-icon.png` per skill and passive.
- `bgm/run.mp3` (Bgm00.img/FloralLife) and `bgm/title.mp3` (BgmUI.img/Title), raw Sound_DX8 payload.
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
