// Run: node --experimental-strip-types scripts/balance-difficulty.ts [seeds=4] [classes=all]
// Difficulty probe: each class plays with the kiting bot and standing still (no input, always card 0). Prints how long each survives,
// damage taken per minute, the hero's armor and the average hit that lands. Informational (no asserts).
import { botInput } from '../src/game/bot.ts';
import { CLASSES } from '../src/game/data.ts';
import { Sim } from '../src/game/sim.ts';

const seeds = Number(process.argv[2] ?? 4);
const only = process.argv[3];
const MINUTES = [1, 2, 3, 5, 8, 12, 15];

function play(seed: number, cls: string, still: boolean) {
  const sim = new Sim(seed, cls);
  const taken: number[] = [];
  const armor: number[] = [];
  let hits = 0, sum = 0, ticks = 0;
  while (!sim.over && ticks < 900 * 60 + 10) {
    if (sim.offer) { sim.pick(0); continue; }
    if (still) sim.setInput(0, 0);
    else { const inp = botInput(sim, 1); sim.setInput(inp.x, inp.y); }
    const hp0 = sim.hp;
    sim.tick();
    ticks++;
    for (const ev of sim.events) if (ev.type === 'playerHit') { hits++; sum += ev.amount; }
    sim.events.length = 0;
    const m = Math.floor(sim.t / 60);
    taken[m] = (taken[m] ?? 0) + Math.max(0, hp0 - sim.hp);
    armor[m] = sim.armor;
  }
  return { t: sim.t, won: sim.won, level: sim.level, taken, armor, avgHit: hits ? sum / hits : 0, hits };
}

const f = (n: number, d = 0) => n.toFixed(d);
for (const c of CLASSES.filter((x) => !only || x.key === only)) {
  for (const still of [false, true]) {
    const rows = [];
    for (let s = 1; s <= seeds; s++) rows.push(play(s * 7919, c.key, still));
    const w = rows.filter((r) => r.won).length;
    const avgT = rows.reduce((a, r) => a + r.t, 0) / rows.length;
    const hit = rows.reduce((a, r) => a + r.avgHit, 0) / rows.length;
    const per = MINUTES.map((m) => { const v = rows.map((r) => r.taken[m - 1]).filter((x) => x !== undefined); return v.length ? f(v.reduce((a, x) => a + x, 0) / v.length) : '-'; });
    const arm = MINUTES.map((m) => { const v = rows.map((r) => r.armor[m - 1]).filter((x) => x !== undefined); return v.length ? f(v.reduce((a, x) => a + x, 0) / v.length, 1) : '-'; });
    console.log(`${c.name.padEnd(9)} ${still ? 'still' : 'kite '} wins ${w}/${rows.length} avg survived ${f(avgT)}s deaths [${rows.filter((r) => !r.won).map((r) => f(r.t)).join(', ')}] avg hit ${f(hit, 1)}`);
    console.log(`   dmg taken in minute ${MINUTES.join('/')}: ${per.join(' / ')}   armor: ${arm.join(' / ')}`);
  }
}
