# Classes

Oscar wants a MapleStory-style start: pick a class, then customize the character like the real
character creation screen. Four explorer classes. Each class has 8 auto-cast skills (start with the
first), max 6 owned, max level 8, and the same level scaling as the Magician (docs/DESIGN.md).
Skill ids are Skill.wz ids for icons/effects; unverified ids are logged by the asset step against
String.wz Skill.img names, so a wrong id only costs its art.

## Class base stats

| class | HP | speed yd/s | crit | weapon (starter, Character.wz) | stance |
|---|---|---|---|---|---|
| Warrior | 160 | 6.8 | 5% | Sword 01302000 | one-handed swing |
| Magician | 120 | 7.0 | 5% | Wand 01372005 | one-handed swing |
| Bowman | 120 | 7.2 | 10% | Bow 01452002 | shoot |
| Thief | 120 | 7.5 | 8% | Dagger 01332005 | stab |

The class stat passive is named per class (Strength / Intelligence / Dexterity / Luck, same effect:
+10% damage per level). The armor passive is named per class (Iron Body 1000003 / Magic Guard 2001002 /
Focus 3001003 / Dark Sight 4001003, same effect: +1 flat armor per level). The other 8 passives stay shared.

## New skill kinds

- **melee**: instant hits on the nearest `count` enemies within `range` (short, 3 to 5 yd) of the hero.
- **cone**: everything within `radius` and 100 degrees of the direction to the nearest enemy.
- **orbit**: a summon that circles the hero at 3 yd and zaps one enemy within `range` every `cooldown`
  (always on once owned; cooldown only paces the zaps).
- Effects: `stun(s)` stops movement and contact hits; `root(s)` stops movement only; `drain(f)` heals
  the hero by f of damage dealt (capped at 2 HP per hit).

## Warrior

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| power_strike | Power Strike | 1001004 | melee | 18 | 0.9 | 4.5 | 0 | 1 | start skill |
| slash_blast | Slash Blast | 1001005 | cone | 14 | 1.6 | 0 | 6 | 1 | |
| charge_blow | Charged Blow | 1211002 | melee | 30 | 3.0 | 5 | 2.5 | 1 | splash, stun 1.0 s |
| coma | Coma | 1111005 | melee | 12 | 1.4 | 5 | 0 | 3 | stun 0.5 s |
| panic | Panic | 1111003 | cone | 22 | 3.5 | 0 | 8 | 1 | weakens hits (enemy damage x0.7 for 4 s) |
| shout | Shout | 1111008 | nova | 10 | 5.0 | 0 | 7 | 1 | stun 1.5 s |
| dragon_roar | Dragon Roar | 1311006 | nova | 30 | 7.0 | 0 | 10 | 1 | |
| spear_crusher | Spear Crusher | 1311001 | melee | 9 | 1.0 | 5.5 | 0 | 3 | hits each target 2 times |

## Magician

Unchanged from docs/DESIGN.md (Magic Claw start).

## Bowman

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| arrow_blow | Arrow Blow | 3001004 | bolt | 12 | 1.0 | 24 | 0 | 1 | start skill, missile 36 yd/s |
| double_shot | Double Shot | 3001005 | bolt | 8 | 1.3 | 24 | 0 | 2 | |
| arrow_bomb | Arrow Bomb | 3101005 | bolt | 16 | 2.6 | 24 | 3.5 | 1 | splash, stun 0.8 s |
| iron_arrow | Iron Arrow | 3201005 | pierce | 18 | 2.2 | 26 | 0 | 1 | passes 3 + level |
| strafe | Strafe | 3111006 | bolt | 7 | 2.0 | 24 | 0 | 4 | |
| arrow_rain | Arrow Rain | 3111004 | ground | 8 | 8.0 | 22 | 6 | 1 | ticks 0.5 s for 4 s |
| silver_hawk | Silver Hawk | 3111005 | orbit | 14 | 1.2 | 14 | 0 | 1 | |
| blizzard | Blizzard | 3211003 | strike | 24 | 4.0 | 20 | 4 | 1 | splash, slow 50% 2 s |

## Thief

| key | name | id | kind | dmg | cd | range | radius | count | other |
|---|---|---|---|---|---|---|---|---|---|
| lucky_seven | Lucky Seven | 4001344 | bolt | 9 | 0.9 | 22 | 0 | 2 | start skill, throwing star missile |
| double_stab | Double Stab | 4001334 | melee | 10 | 0.8 | 4 | 0 | 1 | hits 2 times |
| savage_blow | Savage Blow | 4201005 | melee | 6 | 1.2 | 4.5 | 0 | 1 | hits 6 times |
| avenger | Avenger | 4111005 | pierce | 20 | 2.0 | 26 | 0 | 1 | passes 4 + level |
| shadow_web | Shadow Web | 4111003 | strike | 6 | 6.0 | 12 | 5 | 1 | splash, root 3 s |
| meso_explosion | Meso Explosion | 4211006 | nova | 20 | 5.0 | 0 | 8 | 1 | |
| band_of_thieves | Band of Thieves | 4211004 | cone | 16 | 3.0 | 0 | 8 | 1 | |
| drain | Drain | 4101005 | melee | 14 | 2.0 | 4.5 | 0 | 2 | drain 0.2 |

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
