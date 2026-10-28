// Run: node --experimental-strip-types scripts/balance-probe.ts [seeds=8] [classes=all]
// Balance probe: the kiting bot (always takes card 0, picks the job branch 0) plays each class over several seeds. Prints win rate, the
// hero's damage and the enemies' stats at minutes 1, 3, 5, 8, 12, 15, and the final level. Informational (no asserts).
import { botInput } from '../src/game/bot.ts';
import { BOSSES, CLASSES, enemyDmgMult, enemyHpMult, LADDER, SKILL_BY_KEY, poolLo, progress, skillDmgMult } from '../src/game/data.ts';
import { Sim } from '../src/game/sim.ts';

const seeds = Number(process.argv[2] ?? 8);
const only = process.argv[3];
// PROBE_SPEEDS=rand: give every mob a pseudo-random Mob.wz speed factor in 0.3..1.7 (what the real table could do to the balance)
const mobSpeeds: Record<number, number> | undefined = process.env.PROBE_SPEEDS === 'rand'
  ? Object.fromEntries([...LADDER, ...BOSSES].map((d) => [d.id, 0.3 + (((d.id * 2654435761) >>> 0) % 1400) / 1000]))
  : undefined;
const MINUTES = [1, 3, 5, 8, 12, 15];

interface Row { ttk: { boss: number; wave: number; s: number }[]; win: boolean; t: number; level: number; kills: number; snaps: Record<number, { might: number; hit: number; hp: number; maxHp: number; level: number; mobHp: number; mobDmg: number; bossKills: number; gear: number }> }

function play(seed: number, cls: string): Row {
  const sim = new Sim(seed, cls, { mobSpeeds });
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
