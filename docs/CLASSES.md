# Classes

Oscar wants a MapleStory-style start: pick a class, then customize the character like the real
character creation screen. Four explorer classes. Skills and passives are the real ones of each
job (v83 Skill.wz ids, which also give the icons and effects); a skill's job is its id / 10000
(1001004 -> 100 Warrior, 1111005 -> 111 Crusader). Unverified ids are logged by the asset step
against String.wz Skill.img names, so a wrong id only costs its art. Max 6 owned skills and 6
passives, skill max level 8, passive max level 5, and the same level scaling as the Magician
(docs/DESIGN.md).

## Jobs

- Every class starts as its 1st job (Warrior 100, Magician 200, Bowman 300, Thief 400) with only 1st-job skills and passives.
  The start skill is the first skill of the class.
- Level 30: job advancement. The level-up dialog offers the class's 2nd jobs as cards (job name, two signature skills with a
  one-line description each). Warrior: Fighter / Page / Spearman. Magician: Fire/Poison Wizard / Ice/Lightning Wizard / Cleric.
  Bowman: Hunter / Crossbowman. Thief: Assassin / Bandit (the real game has two 2nd jobs for these classes).
  Picking one adds only that branch's 2nd-job skills and passives to the pool; 1st-job ones stay on offer.
  Bots and autopick take the first card. Plays the level-up effect and shows "Job Advancement! <job>".
- Level 70: automatic 3rd job of the same branch (Fighter -> Crusader, ...). Its skills and passives join the pool, same banner.
- Owned skills stay through advancement. No 4th job. Reroll and banish do not apply to the job card.
- Each level-up draw always contains at least one skill card while any skill can still be offered or upgraded
  (the pool of a single job is small and passives would otherwise crowd the skills out).
- A skill is only ever offered to its own class: the pool is the class's job skills filtered by the jobs unlocked so far.

## Class base stats

| class | HP | speed yd/s | crit | weapon (starter, Character.wz) | stance |
|---|---|---|---|---|---|
| Warrior | 160 | 6.8 | 5% | Sword 01302000 | one-handed swing |
| Magician | 120 | 7.0 | 5% | Wand 01372005 | one-handed swing |
| Bowman | 120 | 7.2 | 10% | Bow 01452002 | shoot |
| Thief | 120 | 7.5 | 8% | Dagger 01332005 | stab |

Passives are the real ones of each job and are listed with the jobs below. Stats: might = damage, haste = cooldown speed, armor = flat damage reduction per hit.

## New skill kinds

- **melee**: instant hits on the nearest `count` enemies within `range` (short, 3 to 5 yd) of the hero.
- **cone**: everything within `radius` and 100 degrees of the direction to the nearest enemy.
- **orbit**: a summon that circles the hero at 3 yd and zaps one enemy within `range` every `cooldown`
  (always on once owned; cooldown only paces the zaps).
- Extra effects: `slow(s)` on strike, melee and nova skills; `heal(h)` on nova (Heal: the hero regains h x damage multiplier per cast); `steal(p)` on melee (chance per hit that the enemy drops a meso pickup); `weaken(s)` enemies deal 0.7x for s seconds.
- Effects: `stun(s)` stops movement and contact hits; `root(s)` stops movement only; `drain(f)` heals
  the hero by f of damage dealt (capped at 2 HP per hit).

Skills and passives per job. New skills sit between the existing ones of their kind; 2nd-job ones are about 1.3x a 1st-job skill of the same kind and 3rd-job ones about 1.7x. The Warrior's Power Strike now splashes (radius 2) because the Warrior has only two active skills before level 70 on some branches.

## Warrior

### Warrior (100, 1st job, from the start)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| power_strike | Power Strike | 1001004 | melee | 18 | 0.9 | 4.5 | 2 | 1 | start skill |
| slash_blast | Slash Blast | 1001005 | cone | 14 | 1.6 | 0 | 6 | 1 |  |

Passives: Improved HP Recovery 1000000 (+1 HP per second), Improved MaxHP Increase 1000001 (+20% max HP), Endure 1000002 (+1 armor), Iron Body 1001003 (+1 armor).

### Fighter (110, 2nd job, choose at level 30)

Passives: Rage 1101006 (+15% damage), Power Guard 1101007 (+1 armor), Sword Booster 1101004 (+8% cooldown speed).

### Crusader (111, 3rd job, automatic at level 70 after Fighter)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| coma | Coma | 1111005 | melee | 12 | 1.4 | 5 | 0 | 3 | stun 0.5 s |
| panic | Panic | 1111003 | cone | 22 | 3.5 | 0 | 8 | 1 | weaken 4 s |
| shout | Shout | 1111008 | nova | 10 | 5 | 0 | 7 | 1 | stun 1.5 s |

Passives: Combo Attack 1111002 (+8% damage).

### Page (120, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| threaten | Threaten | 1201006 | nova | 6 | 4.5 | 0 | 7 | 1 | weaken 4 s |

Passives: Power Guard 1201007 (+1 armor), Sword Booster 1201004 (+8% cooldown speed).

### White Knight (121, 3rd job, automatic at level 70 after Page)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| charge_blow | Charged Blow | 1211002 | melee | 30 | 3 | 5 | 2.5 | 1 | stun 1 s |
| ice_charge | Ice Charge | 1211005 | strike | 26 | 3.2 | 8 | 3 | 1 | slow 2 s |

Passives: Fire Charge 1211003 (+8% damage).

### Spearman (130, 2nd job, choose at level 30)

Passives: Hyper Body 1301007 (+20% max HP), Iron Will 1301006 (+1 armor), Spear Booster 1301004 (+8% cooldown speed).

### Dragon Knight (131, 3rd job, automatic at level 70 after Spearman)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| spear_crusher | Spear Crusher | 1311001 | melee | 9 | 1 | 5.5 | 0 | 3 | 2 hits per target |
| dragon_roar | Dragon Roar | 1311006 | nova | 30 | 7 | 0 | 10 | 1 |  |
| dragon_fury | Dragon Fury | 1311003 | cone | 26 | 3 | 0 | 8 | 1 |  |
| sacrifice | Sacrifice | 1311005 | melee | 55 | 6 | 5 | 2 | 1 |  |

## Magician

### Magician (200, 1st job, from the start)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| magic_claw | Magic Claw | 2001005 | bolt | 10 | 1.2 | 22 | 0 | 2 | start skill |
| energy_bolt | Energy Bolt | 2001004 | pierce | 14 | 2 | 24 | 0 | 1 |  |

Passives: Improved MP Recovery 2000000 (+5% cooldown speed), Improved MaxMP Increase 2000001 (+8% area), Magic Guard 2001002 (+1 armor), Magic Armor 2001003 (+10% max HP).

### Fire/Poison Wizard (210, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| fire_arrow | Fire Arrow | 2101004 | bolt | 20 | 2.4 | 26 | 3.5 | 1 | splash |
| poison_breath | Poison Breath | 2101005 | bolt | 15 | 2 | 22 | 2.5 | 1 | splash |

Passives: Meditation 2101001 (+8% damage), MP Eater 2100000 (+0.4 HP per second).

### Fire/Poison Mage (211, 3rd job, automatic at level 70 after Fire/Poison Wizard)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| explosion | Explosion | 2111002 | nova | 16 | 4 | 0 | 7 | 1 |  |
| poison_mist | Poison Mist | 2111003 | ground | 7 | 8 | 20 | 6 | 1 |  |

Passives: Element Amplification 2110001 (+10% damage), Spell Booster 2111005 (+8% cooldown speed).

### Ice/Lightning Wizard (220, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| cold_beam | Cold Beam | 2201004 | strike | 22 | 2.6 | 20 | 2.5 | 1 | slow 2.5 s |
| thunder_bolt | Thunder Bolt | 2201005 | strike | 12 | 3 | 10 | 0 | 4 |  |

Passives: Meditation 2201001 (+8% damage), MP Eater 2200000 (+0.4 HP per second).

### Ice/Lightning Mage (221, 3rd job, automatic at level 70 after Ice/Lightning Wizard)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| ice_strike | Ice Strike | 2211002 | nova | 24 | 5 | 0 | 7 | 1 | slow 2.5 s |
| thunder_spear | Thunder Spear | 2211003 | pierce | 24 | 2.4 | 26 | 0 | 1 |  |

Passives: Element Amplification 2210001 (+10% damage), Spell Booster 2211005 (+8% cooldown speed).

### Cleric (230, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| holy_arrow | Holy Arrow | 2301005 | bolt | 14 | 1.5 | 24 | 0 | 1 |  |
| heal | Heal | 2301002 | nova | 9 | 4 | 0 | 6 | 1 | heals 4 HP per cast |

Passives: Bless 2301004 (+1 armor and +2% crit chance), Invincible 2301003 (+1 armor).

### Priest (231, 3rd job, automatic at level 70 after Cleric)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| shining_ray | Shining Ray | 2311004 | nova | 26 | 4.8 | 0 | 8 | 1 |  |
| summon_dragon | Summon Dragon | 2311006 | orbit | 22 | 1.4 | 14 | 0 | 1 |  |
| doom | Doom | 2311005 | strike | 16 | 5 | 16 | 4 | 1 | root 2.5 s |

Passives: Holy Symbol 2311003 (+8% experience).

## Bowman

### Bowman (300, 1st job, from the start)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| arrow_blow | Arrow Blow | 3001004 | bolt | 12 | 1 | 24 | 0 | 1 | start skill, missile 36 yd/s |
| double_shot | Double Shot | 3001005 | bolt | 8 | 1.3 | 24 | 0 | 2 |  |

Passives: Blessing of Amazon 3000000 (+10% damage), Critical Shot 3000001 (+4% crit chance), The Eye of Amazon 3000002 (+40% pickup range), Focus 3001003 (+1 armor and +3% crit chance).

### Hunter (310, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| arrow_bomb | Arrow Bomb | 3101005 | bolt | 16 | 2.6 | 24 | 3.5 | 1 | stun 0.8 s, splash |
| knockback_hunter | Power Knock-Back | 3101003 | cone | 18 | 2 | 0 | 8 | 1 | stun 0.4 s |

Passives: Soul Arrow: Bow 3101004 (+8% damage), Bow Booster 3101002 (+8% cooldown speed), Final Attack: Bow 3100001 (+4% crit chance).

### Ranger (311, 3rd job, automatic at level 70 after Hunter)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| arrow_rain | Arrow Rain | 3111004 | ground | 8 | 8 | 22 | 6 | 1 | lasts 4 s |
| strafe | Strafe | 3111006 | bolt | 7 | 2 | 24 | 0 | 4 |  |
| silver_hawk | Silver Hawk | 3111005 | orbit | 14 | 1.2 | 14 | 0 | 1 |  |
| inferno | Inferno | 3111003 | strike | 26 | 3.6 | 18 | 4 | 1 |  |

Passives: Mortal Blow 3110001 (+4% crit chance).

### Crossbowman (320, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| iron_arrow | Iron Arrow | 3201005 | pierce | 18 | 2.2 | 26 | 0 | 1 |  |
| knockback_xbow | Power Knock-Back | 3201003 | cone | 20 | 2.2 | 0 | 8 | 1 | stun 0.4 s |

Passives: Soul Arrow: Crossbow 3201004 (+8% damage), Crossbow Booster 3201002 (+8% cooldown speed), Final Attack: Crossbow 3200001 (+4% crit chance).

### Sniper (321, 3rd job, automatic at level 70 after Crossbowman)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| blizzard | Blizzard | 3211003 | strike | 24 | 4 | 20 | 4 | 1 | slow 2 s |
| arrow_eruption | Arrow Eruption | 3211004 | strike | 12 | 3 | 20 | 2 | 3 |  |
| golden_eagle | Golden Eagle | 3211005 | orbit | 16 | 1.1 | 14 | 0 | 1 |  |
| strafe_sniper | Strafe | 3211006 | bolt | 8 | 2.2 | 24 | 0 | 4 |  |

Passives: Mortal Blow 3210001 (+4% crit chance).

## Thief

### Thief (400, 1st job, from the start)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| lucky_seven | Lucky Seven | 4001344 | bolt | 9 | 0.9 | 22 | 0 | 2 | start skill |
| double_stab | Double Stab | 4001334 | melee | 10 | 0.8 | 4 | 0 | 1 | 2 hits per target |
| disorder | Disorder | 4001002 | melee | 8 | 1.6 | 4 | 0 | 1 | weaken 3 s |

Passives: Nimble Body 4000000 (+10% move speed), Keen Eyes 4000001 (+40% pickup range), Dark Sight 4001003 (+1 armor).

### Assassin (410, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| drain | Drain | 4101005 | melee | 14 | 2 | 4.5 | 0 | 2 | drain 0.2 |

Passives: Haste 4101004 (+10% move speed), Critical Throw 4100001 (+4% crit chance), Claw Booster 4101003 (+8% cooldown speed).

### Hermit (411, 3rd job, automatic at level 70 after Assassin)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| avenger | Avenger | 4111005 | pierce | 20 | 2 | 26 | 0 | 1 | passes 4 + level |
| shadow_web | Shadow Web | 4111003 | strike | 6 | 6 | 12 | 5 | 1 | root 3 s |
| shadow_meso | Shadow Meso | 4111004 | bolt | 14 | 2 | 22 | 3 | 1 | splash |

Passives: Shadow Partner 4111002 (+8% damage), Meso Up 4111001 (+8% experience).

### Bandit (420, 2nd job, choose at level 30)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| savage_blow | Savage Blow | 4201005 | melee | 6 | 1.2 | 4.5 | 0 | 1 | 6 hits per target |
| steal | Steal | 4201004 | melee | 14 | 1.2 | 4.5 | 0 | 1 | 30% mesos per hit |

Passives: Haste 4201003 (+10% move speed), Dagger Booster 4201002 (+10% cooldown speed).

### Chief Bandit (421, 3rd job, automatic at level 70 after Bandit)

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| meso_explosion | Meso Explosion | 4211006 | nova | 20 | 5 | 0 | 8 | 1 |  |
| band_of_thieves | Band of Thieves | 4211004 | cone | 16 | 3 | 0 | 8 | 1 |  |
| assaulter | Assaulter | 4211002 | melee | 45 | 5 | 7 | 0 | 1 |  |

Passives: Meso Guard 4211005 (+1 armor).


## Character creation

Like the real game's New Character window: choose a class first (four large cards with the class's
weapon and its start skill icon), then customise: gender, skin (5 tones), face (3 per gender), hair
(3 styles per gender), hair colour (8: black, red, orange, blonde, green, blue, purple, brown = last
digit 0-7 of the hair id), top, bottom and shoes (2 starter options each), and a name. A dice button
randomises. The live preview shows the composited character walking. Saved in localStorage as the
default look for the next run; "Start" goes straight in.

Starter items (Character.wz ids):
- Male hair 30000, 30020, 30030; female 31000, 31040, 31050.
- Male face 20000, 20001, 20002; female 21000, 21001, 21002.
- Skin: body 00002000 + n, head 00012000 + n, n = 0..4.
- Male top 01040002, 01040006; female 01041002, 01041006.
- Male bottom 01060002, 01060006; female 01061002, 01061008.
- Shoes 01072001, 01072005 (both genders).
