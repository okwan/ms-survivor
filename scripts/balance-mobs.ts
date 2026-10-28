// Run: node --experimental-strip-types scripts/balance-mobs.ts [seeds=12] [classes=all]
// Compares the kiting bot (always card 0, sidestepping charges, shots and ailment circles) with and without the mob behaviours and ailments
// (Sim option `mobAi`): win rate, lowest HP, damage taken, boss kill times, and what the behaviours did. Informational (no asserts);
// test-mobs.ts has the checks.
import { botInput } from '../src/game/bot.ts';
import { BOSSES, CLASSES } from '../src/game/data.ts';
import { Sim } from '../src/game/sim.ts';

const seeds = Number(process.argv[2] ?? 12);
const only = process.argv[3];

interface Row { win: boolean; t: number; level: number; kills: number; ttk: { boss: number; s: number }[]; minHp: number; damageTaken: number; fired: number; hits: number; charges: number; ail: number; ailHits: number; shooters: number }

function play(seed: number, cls: string, mobAi: boolean): Row {
  const sim = new Sim(seed, cls, { mobAi });
  const spawnedAt: Record<number, number[]> = {};
  const ttk: Row['ttk'] = [];
  let ticks = 0, minHp = 1, ailHits = 0, shooters = 0;
  while (!sim.over && ticks < 900 * 60 + 10) {
    if (sim.offer) { sim.pick(0); continue; }
    const inp = botInput(sim, 1);
    sim.setInput(inp.x, inp.y);
    sim.tick();
    ticks++;
    minHp = Math.min(minHp, sim.hp / sim.maxHp);
    shooters = Math.max(shooters, sim.mobs.shooters);
    for (const ev of sim.events) {
      if (ev.type === 'bossSpawn') (spawnedAt[ev.boss] ??= []).push(sim.t);
      else if (ev.type === 'bossDeath') { const t0 = spawnedAt[ev.boss]?.shift(); if (t0 !== undefined) ttk.push({ boss: ev.boss, s: sim.t - t0 }); }
      else if (ev.type === 'ailHit' && ev.hit) ailHits++;
    }
    sim.events.length = 0;
  }
  return { win: sim.won, t: sim.t, level: sim.level, kills: sim.kills, ttk, minHp, damageTaken: sim.damageTaken, fired: sim.mobs.fired, hits: sim.mobs.hits, charges: sim.mobs.charges, ail: sim.ail.applied, ailHits, shooters };
}

const f = (n: number, d = 0) => n.toFixed(d);
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const classes = CLASSES.filter((c) => !only || c.key === only);
const tw = [0, 0];
let tn = 0;
for (const c of classes) {
  const rows = [false, true].map((on) => Array.from({ length: seeds }, (_, s) => play((s + 1) * 7919, c.key, on)));
  tn += seeds;
  console.log(c.name);
  [false, true].forEach((on, k) => {
    const r = rows[k];
    const w = r.filter((x) => x.win).length;
    tw[k] += w;
    const boss = BOSSES.map((_, b) => avg(r.flatMap((x) => x.ttk.filter((y) => y.boss === b).map((y) => y.s))));
    console.log(`  ${on ? 'with   ' : 'without'}  wins ${w}/${seeds}  survived ${f(avg(r.map((x) => x.t)))}s  level ${f(avg(r.map((x) => x.level)))}  lowest HP ${f(avg(r.map((x) => x.minHp)) * 100)}% (worst ${f(Math.min(...r.map((x) => x.minHp)) * 100)}%)  damage taken ${f(avg(r.map((x) => x.damageTaken)))}`);
    console.log(`           boss times ${boss.map((s, b) => `${BOSSES[b].name} ${f(s)}s`).join(', ')}`);
    if (on) console.log(`           shots ${f(avg(r.map((x) => x.fired)))} fired / ${f(avg(r.map((x) => x.hits)))} hit, most shooters at once ${f(Math.max(...r.map((x) => x.shooters)))}, charges ${f(avg(r.map((x) => x.charges)))}, ailments landed ${f(avg(r.map((x) => x.ail)), 1)} (${f(avg(r.map((x) => x.ailHits)), 1)} from boss circles)`);
  });
}
console.log(`TOTAL wins without ${tw[0]}/${tn}, with ${tw[1]}/${tn}`);
