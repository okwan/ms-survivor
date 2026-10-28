// Run: node --experimental-strip-types scripts/test-decor.ts
// Region decor layout rules: clusters, one big per cluster, 60 px gaps, determinism.
import assert from 'node:assert/strict';
import { BIG, CLUSTER_CELL, MEDIUM, MIN_GAP, Placements, SMALL, TUFT_CELL, clusterAt, tuftAt } from '../src/render/cluster.ts';
import { FADE, advanceFade, fadeView } from '../src/render/fade.ts';
import { REGION_COUNT, regionAt } from '../src/game/regions.ts';

let checks = 0;
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };

// region clock: one region per boss interval
ok(regionAt(0) === 0 && regionAt(134.9) === 0 && regionAt(135) === 1 && regionAt(899) === REGION_COUNT - 1 && regionAt(900) === REGION_COUNT - 1, 'region follows the boss clock');

const have = { big: true, medium: true, small: true };
const salt = 3;
const N = 40;
const pts: { x: number; y: number; cls: number }[] = [];
let clusters = 0, cells = 0;
const cl = new Placements(), tu = new Placements(), scratch = new Placements();
for (let cy = -N; cy < N; cy++)
  for (let cx = -N; cx < N; cx++) {
    cells++;
    clusterAt(cx, cy, salt, have, cl);
    if (!cl.n) continue;
    clusters++;
    let big = 0;
    for (let i = 0; i < cl.n; i++) {
      if (cl.cls[i] === BIG) big++;
      pts.push({ x: cl.x[i], y: cl.y[i], cls: cl.cls[i] });
      if (i) ok(Math.hypot(cl.x[i] - cl.x[0], cl.y[i] - cl.y[0]) <= 131, 'satellites stay within 130 px of the centre');
      ok(Math.floor(cl.x[i] / CLUSTER_CELL) === cx || i > 0, 'centre inside its cell');
    }
    ok(big === 1, 'exactly one big object per cluster');
    ok(cl.n >= 2 && cl.n <= 6, 'cluster has a centre and up to five satellites');
  }
const rate = clusters / cells;
ok(rate > 0.4 && rate < 0.5, `about 45% of cells hold a cluster (${rate.toFixed(3)})`);
const nClusterPts = pts.length;
const T = N * Math.round(CLUSTER_CELL / TUFT_CELL);
let tufts = 0;
for (let ty = -T; ty < T; ty++)
  for (let tx = -T; tx < T; tx++) {
    tuftAt(tx, ty, salt, SMALL, tu, scratch);
    if (tu.n) { tufts++; pts.push({ x: tu.x[0], y: tu.y[0], cls: SMALL }); }
  }
ok(tufts > 0 && pts.length > nClusterPts, 'tufts are placed');

// nothing within MIN_GAP of anything else (bucket by 100 px cells)
const grid = new Map<string, number[]>();
pts.forEach((p, i) => {
  const k = `${Math.floor(p.x / 100)},${Math.floor(p.y / 100)}`;
  (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
});
let worst = Infinity;
pts.forEach((p, i) => {
  const gx = Math.floor(p.x / 100), gy = Math.floor(p.y / 100);
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const j of grid.get(`${gx + a},${gy + b}`) ?? []) if (j > i) worst = Math.min(worst, Math.hypot(pts[j].x - p.x, pts[j].y - p.y));
});
ok(worst >= MIN_GAP - 0.01, `no two anchors closer than ${MIN_GAP} px (closest ${worst.toFixed(1)})`);

// deterministic, and a region without big objects centres on a medium one
clusterAt(5, 5, salt, have, cl);
const a = [...cl.x.slice(0, cl.n)];
clusterAt(5, 5, salt, have, cl);
ok(JSON.stringify(a) === JSON.stringify([...cl.x.slice(0, cl.n)]), 'layout is deterministic');
for (let cx = 0; cx < 40; cx++) {
  clusterAt(cx, 0, salt, { big: false, medium: true, small: true }, cl);
  if (cl.n) { ok(cl.cls[0] === MEDIUM, 'no big objects: a medium one is the centre'); break; }
}
// region cross-fade (regression: after a boss the front ground stayed hidden and the whole map showed only the clear colour)
{
  let f = 0;
  for (let i = 0; i < 100; i++) {
    const v = fadeView(f);
    ok(v.frontVisible && v.frontAlpha >= 0 && v.frontAlpha <= 1, `front ground is always visible (fade ${f.toFixed(2)})`);
    ok(v.backVisible === (f < 1) && v.backGroundAlpha === 1, 'the leaving ground stays opaque beneath while fading');
    f = advanceFade(f, FADE / 20);
  }
  ok(f === 1 && fadeView(f).frontAlpha === 1 && !fadeView(f).backVisible, 'the fade settles with only the front region visible and opaque');
  ok(fadeView(NaN).frontVisible && fadeView(NaN).frontAlpha === 1 && advanceFade(0, NaN) === 1, 'a broken fade value settles instead of hiding the map');
  ok(advanceFade(0.5, -10) === 0 && advanceFade(0.5, 100) === 1, 'the fade is clamped to 0..1');
}
console.log(`test-decor: ok (${checks} checks, ${clusters} clusters, ${tufts} tufts, closest ${worst.toFixed(0)} px)`);
