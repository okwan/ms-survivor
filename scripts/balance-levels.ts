// Run: node --experimental-strip-types scripts/balance-levels.ts [seeds=4]
// Level-burst probe: the kiting bot plays each class; prints the biggest level jump in one tick and in any 10 s, the EXP banked on
// the field and the biggest single (merged) gem. Informational (no asserts); test-events.ts checks the XP guards.
import { botInput } from '../src/game/bot.ts';
import { CLASSES } from '../src/game/data.ts';
import { Sim } from '../src/game/sim.ts';
import { GEM } from '../src/game/types.ts';
const seeds = Number(process.argv[2] ?? 4);
for (const c of CLASSES) for (let s = 1; s <= seeds; s++) {
  const sim = new Sim(s * 7919, c.key, {});
  const hist: number[] = []; let win = { n: 0, t: 0 }; let ticks = 0, worst = { n: 0, t: 0, src: '' }, maxBank = 0, maxGem = 0;
  while (!sim.over && ticks < 900 * 60 + 10) {
    if (sim.offer) { sim.pick(0); continue; }
    const inp = botInput(sim, 1); sim.setInput(inp.x, inp.y);
    const lv = sim.level; sim.tick(); ticks++;
    let bank = 0; for (const p of (sim as any).pickups) if (p.kind === GEM) { bank += p.value; maxGem = Math.max(maxGem, p.value); }
    maxBank = Math.max(maxBank, bank);
    const src = sim.events.filter((e: any) => e.type === 'pickup' && e.kind === GEM).map((e: any) => Math.round(e.value)).sort((a, b) => b - a).slice(0, 3).join('/');
    if (sim.level - lv > worst.n) worst = { n: sim.level - lv, t: Math.round(sim.t), src };
    hist.push(sim.level); if (hist.length > 600) { const d = sim.level - hist.shift()!; if (d > win.n) win = { n: d, t: Math.round(sim.t) }; }
    sim.events.length = 0;
  }
  console.log(c.key, s, 'final', sim.level, 't', Math.round(sim.t), 'worst tick jump', worst, 'worst 10s', win, 'coupons', sim.field.itemsUsed, 'max field bank', Math.round(maxBank), 'max single gem', Math.round(maxGem));
}
