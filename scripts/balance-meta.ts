// Run: node --experimental-strip-types scripts/balance-meta.ts [seeds=12] [classes=all]
// Henesys shop balance: the kiting bot (always takes card 0, like balance-probe.ts) plays each class over several seeds with an empty shop and with
// every rank bought. Prints win rate, damage taken, time survived, the time to kill Zakum (from its spawn at 13:30), the mesos a run banks, and what
// the whole shop costs in runs. Informational (no asserts).
import { botInput } from '../src/game/bot.ts';
import { BOSSES, CLASSES } from '../src/game/data.ts';
import { META, emptyMeta, metaTotalCost } from '../src/game/meta.ts';
import type { MetaRanks } from '../src/game/meta.ts';
import { Sim } from '../src/game/sim.ts';

const seeds = Number(process.argv[2] ?? 12);
const only = process.argv[3];
const ZAKUM = BOSSES.length - 1;
const full = Object.fromEntries(META.map((d) => [d.key, d.max])) as MetaRanks;

interface Row { win: boolean; t: number; taken: number; zakum: number | null; mesos: number; level: number; revived: boolean }

function play(seed: number, cls: string, meta: MetaRanks): Row {
  const sim = new Sim(seed, cls, { meta });
  let ticks = 0, spawned = -1, zakum: number | null = null;
  while (!sim.over && ticks < 900 * 60 + 10) {
    if (sim.offer) { sim.pick(0); continue; }
    const inp = botInput(sim, 1);
    sim.setInput(inp.x, inp.y);
    sim.tick();
    ticks++;
    for (const ev of sim.events) {
      if (ev.type === 'bossSpawn' && ev.boss === ZAKUM) spawned = sim.t;
      else if (ev.type === 'bossDeath' && ev.boss === ZAKUM && spawned >= 0 && zakum === null) zakum = sim.t - spawned;
    }
    sim.events.length = 0;
  }
  return { win: sim.won, t: sim.t, taken: sim.damageTaken, zakum, mesos: sim.mesos, level: sim.level, revived: sim.reviveUsed };
}

const f = (n: number, d = 0) => n.toFixed(d);
const avg = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN);
const classes = CLASSES.filter((c) => !only || c.key === only);
const none = emptyMeta();
let mesosNone = 0, mesosFull = 0, n = 0;
console.log(`Shop total: ${metaTotalCost()} mesos. ${seeds} seeds per class; "empty" vs "full" shop.`);
console.log('class      shop   wins   survived   dmg taken   dmg/s   Zakum kill (n)    mesos/run   level   revived');
for (const c of classes) {
  const seedList = Array.from({ length: seeds }, (_, i) => (i + 1) * 7919);
  const a = seedList.map((s) => play(s, c.key, none));
  const b = seedList.map((s) => play(s, c.key, full));
  for (const [label, rows] of [['empty', a], ['full', b]] as const) {
    const z = rows.filter((r) => r.zakum !== null).map((r) => r.zakum as number);
    console.log(`${c.name.padEnd(10)} ${label.padEnd(6)} ${String(rows.filter((r) => r.win).length).padStart(2)}/${rows.length}  ${f(avg(rows.map((r) => r.t))).padStart(7)}s  ${f(avg(rows.map((r) => r.taken))).padStart(9)}  ${f(avg(rows.map((r) => r.taken / r.t)), 1).padStart(6)}   ${(z.length ? f(avg(z)) + 's' : '-').padStart(6)} (${z.length})        ${f(avg(rows.map((r) => r.mesos))).padStart(6)}    ${f(avg(rows.map((r) => r.level)), 1).padStart(5)}   ${rows.filter((r) => r.revived).length}`);
  }
  mesosNone += a.reduce((x, r) => x + r.mesos, 0);
  mesosFull += b.reduce((x, r) => x + r.mesos, 0);
  n += a.length;
}
const perRun = mesosNone / n;
console.log(`A typical run banks ${f(perRun)} mesos with an empty shop (${f(mesosFull / n)} with a full one, Greed included): the whole shop is ${f(metaTotalCost() / perRun, 1)} runs of income.`);
