// Run: node --experimental-strip-types scripts/balance-probe.ts [seeds=8] [classes=all]
// Env: PROBE_DIFF=<0..3> plays on that difficulty tier.
// Balance probe: the kiting bot (always takes card 0, picks the job branch 0) plays each class over several seeds. Prints win rate, the
// hero's damage and the enemies' stats at minutes 1, 3, 5, 8, 12, 15, and the final level. Informational (no asserts).
import { botInput } from '../src/game/bot.ts';
import { GEAR_TIER_DMG_CAP, BOSSES, CLASSES, enemyDmgMult, enemyHpMult, LADDER, SKILL_BY_KEY, poolLo, progress, skillDmgMult } from '../src/game/data.ts';
import { GEAR_SLOTS, GearPool, JOB_BIT, MAIN_STAT, TIER_LEVELS, deriveGearStats, itemBonus } from '../src/game/gear.ts';
import type { GearItem, GearSlot, GearStats } from '../src/game/gear.ts';
import type { ClassKey } from '../src/game/data.ts';
import { Sim } from '../src/game/sim.ts';

const seeds = Number(process.argv[2] ?? 8);
const only = process.argv[3];
// PROBE_SPEEDS=rand: give every mob a pseudo-random Mob.wz speed factor in 0.3..1.7 (what the real table could do to the balance)
const mobSpeeds: Record<number, number> | undefined = process.env.PROBE_SPEEDS === 'rand'
  ? Object.fromEntries([...LADDER, ...BOSSES].map((d) => [d.id, 0.3 + (((d.id * 2654435761) >>> 0) % 1400) / 1000]))
  : undefined;
// PROBE_GEAR=real: a pool with MapleStory-sized stats instead of the placeholder items (stats grow with reqLevel like the real classic equipment: weapon attack
// ~10 + 1.1 L, armor PDD ~0.4-1.0 L, main stat up to L / 8 on a few slots, boots speed up to +15), two items per slot and tier (three per class for weapons)
function realPool(): GearPool {
  const list: GearItem[] = [];
  TIER_LEVELS.forEach((lo, t) => {
    for (const v of [0, 1]) {
      const L = Math.min(99, lo + 4 + v * 5 + (t === 7 ? 5 : 0));
      const mk = (slot: GearSlot, job: number, stats: GearStats, name: string) => list.push({ id: `rl${slot}${job}t${t}v${v}`, slot, name: `${name} L${L}`, level: L, job, gender: 2, tier: t, stats, long: false });
      const st = L / 8 | 0;
      mk('cap', 0, { pdd: 3 + L * 0.6 | 0, mhp: L > 40 ? L : 0, str: st / 2 | 0, dex: st / 2 | 0, int: st / 2 | 0, luk: st / 2 | 0 }, 'Cap');
      mk('coat', 0, { pdd: 5 + L | 0, str: st / 2 | 0, dex: st / 2 | 0, int: st / 2 | 0, luk: st / 2 | 0 }, 'Top');
      mk('pants', 0, { pdd: 4 + L * 0.7 | 0, str: st / 2 | 0, dex: st / 2 | 0, int: st / 2 | 0, luk: st / 2 | 0 }, 'Bottom');
      mk('shoes', 0, { pdd: 2 + L * 0.4 | 0, speed: 2 + L / 7 | 0, dex: st / 3 | 0 }, 'Shoes');
      mk('glove', 0, { pdd: 1 + L * 0.25 | 0, pad: L / 10 | 0, mad: L / 10 | 0, str: st / 3 | 0, dex: st / 3 | 0, int: st / 3 | 0, luk: st / 3 | 0 }, 'Gloves');
      mk('cape', 0, { pdd: 2 + L * 0.4 | 0, mhp: L > 30 ? L / 2 | 0 : 0, str: st, dex: st, int: st, luk: st }, 'Cape');
      mk('shield', JOB_BIT.warrior, { pdd: 5 + L * 0.8 | 0, mhp: L > 40 ? L : 0, str: st / 2 | 0 }, 'Shield');
      for (const c of Object.keys(JOB_BIT) as ClassKey[]) mk('weapon', JOB_BIT[c], { pad: 10 + L * 1.1 | 0, mad: 10 + L * 1.2 | 0, [MAIN_STAT[c]]: st }, c);
    }
  });
  return new GearPool(list, true);
}
// PROBE_GEAR=derived: a pool of items whose stats come from deriveGearStats (what the extractor gives equips with no inc* keys): per tier a level near the
// top of the window, one item per slot (a shield for the Warrior) and one weapon per class, every item requiring the class's main stat; the t7 weapon-cap
// check is printed too
function derivedPool(): GearPool {
  const list: GearItem[] = [];
  const wt: Record<ClassKey, number> = { warrior: 130, magician: 137, bowman: 145, thief: 133, pirate: 148 };
  TIER_LEVELS.forEach((lo, t) => {
    for (const v of [0, 1]) {
      const L = Math.min(99, lo + 4 + v * 5 + (t === 7 ? 5 : 0));
      const req = { str: 1, dex: 1, int: 1, luk: 1 };
      for (const slot of GEAR_SLOTS) {
        if (slot === 'weapon') {
          for (const c of Object.keys(JOB_BIT) as ClassKey[]) {
            const stats = deriveGearStats('weapon', L, { weaponType: wt[c], req: { [MAIN_STAT[c]]: 1 } });
            list.push({ id: `dv${c}t${t}v${v}`, slot, name: `${c} L${L}`, level: L, job: JOB_BIT[c], gender: 2, tier: t, stats, long: false });
            if (t === TIER_LEVELS.length - 1 && v === 1) console.log(`t7 ${c} weapon L${L}: ${JSON.stringify(stats)} -> dmg ${itemBonus(list[list.length - 1], c).dmg.toFixed(2)} (cap ${(GEAR_TIER_DMG_CAP * (t + 1)).toFixed(2)})`);
          }
        } else {
          list.push({ id: `dv${slot}t${t}v${v}`, slot, name: `${slot} L${L}`, level: L, job: slot === 'shield' ? JOB_BIT.warrior : 0, gender: 2, tier: t, stats: deriveGearStats(slot, L, { req }), long: false });
        }
      }
    }
  });
  return new GearPool(list, true);
}
const gearPool = process.env.PROBE_GEAR === 'real' ? realPool() : process.env.PROBE_GEAR === 'derived' ? derivedPool() : undefined;
const MINUTES = [1, 3, 5, 8, 12, 15];

interface Row { ttk: { boss: number; wave: number; s: number }[]; win: boolean; t: number; level: number; kills: number; snaps: Record<number, { might: number; hit: number; hp: number; maxHp: number; level: number; mobHp: number; mobDmg: number; bossKills: number; gear: number }> }

function play(seed: number, cls: string): Row {
  const sim = new Sim(seed, cls, { mobSpeeds, difficulty: Number(process.env.PROBE_DIFF ?? 0), ...(gearPool ? { pool: gearPool } : {}) });
  const snaps: Row['snaps'] = {};
  const ttk: Row['ttk'] = [];
  const spawnedAt: Record<number, number[]> = {};
  let ticks = 0;
  while (!sim.over && ticks < 900 * 60 + 10) {
    if (sim.offer) { sim.pick(0); continue; }
    const inp = botInput(sim, 1);
    sim.setInput(inp.x, inp.y);
    sim.tick();
    ticks++;
    for (const ev of sim.events) {
      if (ev.type === 'bossSpawn') (spawnedAt[ev.boss] ??= []).push(sim.t);
      else if (ev.type === 'bossDeath') { const t0 = spawnedAt[ev.boss]?.shift(); if (t0 !== undefined) ttk.push({ boss: ev.boss, wave: Math.floor(t0 / 135), s: sim.t - t0 }); }
    }
    sim.events.length = 0;
    for (const m of MINUTES) {
      if (snaps[m] === undefined && sim.t >= m * 60) {
        // average base damage of the owned skills per single hit, times the live multiplier
        let base = 0;
        for (const s of sim.skills) { const d = SKILL_BY_KEY[s.key]; base += d.dmg * skillDmgMult(s.level); }
        base /= sim.skills.length;
        const p = progress(sim.t);
        const lo = poolLo(sim.t);
        const mid = LADDER[Math.min(LADDER.length - 1, lo + 1)];
        snaps[m] = { might: sim.might, hit: base * sim.might, hp: sim.hp, maxHp: sim.maxHp, level: sim.level, mobHp: mid.hp * enemyHpMult(p), mobDmg: mid.dmg * enemyDmgMult(p), bossKills: sim.bossKills, gear: sim.gearDrops };
      }
    }
  }
  return { ttk, win: sim.won, t: sim.t, level: sim.level, kills: sim.kills, snaps };
}

const f = (n: number, d = 0) => n.toFixed(d);
const classes = CLASSES.filter((c) => !only || c.key === only);
let wins = 0, total = 0;
for (const c of classes) {
  const rows: Row[] = [];
  for (let s = 1; s <= seeds; s++) rows.push(play(s * 7919, c.key));
  const w = rows.filter((r) => r.win).length;
  wins += w; total += rows.length;
  const deaths = rows.filter((r) => !r.win).map((r) => f(r.t) + 's');
  const avgT = rows.reduce((a, r) => a + r.t, 0) / rows.length;
  const lvl = rows.reduce((a, r) => a + r.level, 0) / rows.length;
  const byBoss = [0, 1, 2, 3, 4, 5].map((b) => { const v = rows.flatMap((r) => r.ttk.filter((x) => x.boss === b).map((x) => x.s)); return v.length ? `${BOSSES[b].name} ${f(v.reduce((a, x) => a + x, 0) / v.length, 0)}s (n=${v.length})` : `${BOSSES[b].name} -`; });
  console.log(`${c.name.padEnd(9)} wins ${w}/${rows.length}  avg survived ${f(avgT)}s  avg final level ${f(lvl, 1)}${deaths.length ? '  deaths at ' + deaths.join(', ') : ''}`);
  console.log('  time to kill a boss: ' + byBoss.join(', '));
  console.log('  min   lvl   might   dmg/hit   maxHP   mobHP  mobDmg  (avg of runs that reached it)');
  for (const m of MINUTES) {
    const ss = rows.map((r) => r.snaps[m]).filter(Boolean);
    if (!ss.length) { console.log(`  ${String(m).padStart(3)}   (none reached)`); continue; }
    const avg = (k: keyof (typeof ss)[0]) => ss.reduce((a, x) => a + (x[k] as number), 0) / ss.length;
    console.log(`  ${String(m).padStart(3)} ${f(avg('level')).padStart(5)} ${f(avg('might'), 2).padStart(7)} ${f(avg('hit'), 1).padStart(9)} ${f(avg('maxHp')).padStart(7)} ${f(avg('mobHp'), 0).padStart(7)} ${f(avg('mobDmg'), 0).padStart(7)}   n=${ss.length}`);
  }
}
console.log(`TOTAL wins ${wins}/${total} (${f((100 * wins) / total, 1)}%)`);
