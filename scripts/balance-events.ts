// Run: node --experimental-strip-types scripts/balance-events.ts [seeds=8] [classes=all]
// Compares the kiting bot (always card 0) with and without the Elites, swarm events and field items (Sim option `events`): win rate, average
// time survived, boss kill times, final level, and what the extras did. Informational (no asserts); test-events.ts has the checks.
import { botInput } from '../src/game/bot.ts';
import { BOSSES, CLASSES } from '../src/game/data.ts';
import { Sim } from '../src/game/sim.ts';

const seeds = Number(process.argv[2] ?? 8);
const only = process.argv[3];

interface Row { win: boolean; t: number; level: number; kills: number; ttk: { boss: number; s: number }[]; minHp: number; elites: number; spawned: number; swarms: number[]; boxes: number; used: number; damageTaken: number }

function play(seed: number, cls: string, events: boolean): Row {
  const sim = new Sim(seed, cls, { events });
  const spawnedAt: Record<number, number[]> = {};
  const ttk: Row['ttk'] = [];
  let ticks = 0, minHp = 1;
  while (!sim.over && ticks < 900 * 60 + 10) {
    if (sim.offer) { sim.pick(0); continue; }
    const inp = botInput(sim, 1);
    sim.setInput(inp.x, inp.y);
    sim.tick();
    ticks++;
    minHp = Math.min(minHp, sim.hp / sim.maxHp);
    for (const ev of sim.events) {
      if (ev.type === 'bossSpawn') (spawnedAt[ev.boss] ??= []).push(sim.t);
      else if (ev.type === 'bossDeath') { const t0 = spawnedAt[ev.boss]?.shift(); if (t0 !== undefined) ttk.push({ boss: ev.boss, s: sim.t - t0 }); }
    }
    sim.events.length = 0;
  }
  return { win: sim.won, t: sim.t, level: sim.level, kills: sim.kills, ttk, minHp, elites: sim.elites.killed, spawned: sim.elites.spawned, swarms: sim.swarms.started, boxes: sim.field.boxesBroken, used: sim.field.itemsUsed, damageTaken: sim.damageTaken };
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
    console.log(`  ${on ? 'with   ' : 'without'}  wins ${w}/${seeds}  survived ${f(avg(r.map((x) => x.t)))}s  level ${f(avg(r.map((x) => x.level)))}  kills ${f(avg(r.map((x) => x.kills)))}  lowest HP ${f(avg(r.map((x) => x.minHp)) * 100)}%  damage taken ${f(avg(r.map((x) => x.damageTaken)))}`);
    console.log(`           boss times ${boss.map((s, b) => `${BOSSES[b].name} ${f(s)}s`).join(', ')}`);
    if (on) console.log(`           elites ${f(avg(r.map((x) => x.spawned)), 1)} spawned / ${f(avg(r.map((x) => x.elites)), 1)} killed; swarms per run: ${f(avg(r.map((x) => x.swarms[0])), 1)} stampede, ${f(avg(r.map((x) => x.swarms[1])), 1)} ring, ${f(avg(r.map((x) => x.swarms[2])), 1)} treasure; boxes ${f(avg(r.map((x) => x.boxes)), 1)}, field items used ${f(avg(r.map((x) => x.used)), 1)}`);
  });
}
console.log(`TOTAL wins without ${tw[0]}/${tn}, with ${tw[1]}/${tn}`);
