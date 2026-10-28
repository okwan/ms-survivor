// Run: node --experimental-strip-types scripts/test-meter.ts
import { Sim } from '../src/game/sim.ts';
import { botInput, botPick } from '../src/game/bot.ts';
import { CLASSES, SKILL_BY_KEY } from '../src/game/data.ts';
import { DamageMeter, compact } from '../src/game/meter.ts';

let failed = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failed++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg);
}
const eq = (a: unknown, b: unknown, msg: string) => ok(a === b, `${msg} (got ${a}, want ${b})`);

console.log('-- compact()');
eq(compact(0), '0', '0'); eq(compact(950), '950', '950'); eq(compact(999.4), '999', '999.4'); eq(compact(1000), '1k', '1000');
eq(compact(12345), '12.3k', '12345'); eq(compact(123456), '123k', '123456'); eq(compact(999999), '1000k', '999999');
eq(compact(4.5e6), '4.5M', '4.5M'); eq(compact(2.5e9), '2.5B', '2.5B'); eq(compact(NaN), '0', 'NaN'); eq(compact(-5), '0', 'negative');

console.log('-- DamageMeter unit');
{
  const m = new DamageMeter();
  m.add('a', 100, false, 0); m.add('a', 50, true, 1); m.add('b', 300, false, 2); m.add('c', 0, false, 2);
  eq(m.total, 450, 'total'); eq(m.sorted()[0].key, 'b', 'sorted by damage'); eq(Object.keys(m.rows).length, 2, 'zero-damage adds no row');
  eq(m.rows.a.hits, 2, 'hits'); eq(m.rows.a.crits, 1, 'crits'); eq(m.rows.b.first, 2, 'first hit time');
  eq(m.recentDps(2), 450 / 2, 'recent dps divides by elapsed time early on');
  eq(m.recentDps(6), 300 / 5, 'old buckets drop out of the 5 s window');
  eq(m.recentDps(100), 0, 'stale buckets ignored');
  eq(m.runDps(9), 50, 'run dps'); eq(m.rowDps(m.rows.b, 12), 30, 'row dps'); eq(m.rowDps(m.rows.b, 2.2), 300, 'row dps floor of 1 s');
  ok(Number.isFinite(new DamageMeter().recentDps(0)), 'recentDps(0) finite');
}

console.log('-- sim runs');
function run(seed: number, cls: string, secs: number) {
  const sim = new Sim(seed, cls);
  sim.god = true;
  for (let i = 0; i < secs * 60 && !sim.over; i++) {
    if (sim.offer) { sim.pick(botPick(sim)); continue; }
    const inp = botInput(sim, 1);
    sim.setInput(inp.x, inp.y);
    sim.tick();
    if (i % 60 === 0) sim.events.length = 0;
  }
  return sim;
}
for (const c of CLASSES) {
  const a = run(777, c.key, 90), b = run(777, c.key, 90), m = a.meter;
  console.log(`  ${c.key}: total ${compact(m.total)}, ${m.sorted().length} sources, ${compact(m.recentDps(a.t))}/s recent`);
  ok(m.total > 0, `${c.key}: damage recorded`);
  const sum = m.sorted().reduce((s, r) => s + r.dmg, 0);
  ok(Math.abs(sum - m.total) <= 1e-6 * Math.max(1, m.total), `${c.key}: rows sum to total`);
  ok(m.sorted().every((r) => !!SKILL_BY_KEY[r.key] || r.key === 'keg' || r.key === 'other'), `${c.key}: every source is a skill, keg or other (${Object.keys(m.rows).join(',')})`);
  ok(m.sorted().every((r) => r.hits >= r.crits && r.crits >= 0 && r.dmg > 0 && r.first >= 0 && r.first <= a.t), `${c.key}: hits >= crits, sane first-hit time`);
  ok([m.recentDps(a.t), m.runDps(a.t), ...m.sorted().map((r) => m.rowDps(r, a.t))].every((v) => Number.isFinite(v) && v >= 0), `${c.key}: dps values finite and >= 0`);
  eq(a.meter.total, b.meter.total, `${c.key}: same seed, same meter total`);
  eq(a.kills + ':' + a.level, b.kills + ':' + b.level, `${c.key}: same seed, same kills and level`);
}

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall meter tests passed');
