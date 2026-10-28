/** One damage source (a skill key, 'keg' or 'other') and what it dealt this run. */
export interface MeterRow { key: string; dmg: number; hits: number; crits: number; /** sim time of its first hit */ first: number }

const BUCKETS = 10, BUCKET_S = 0.5, WINDOW_S = BUCKETS * BUCKET_S;

/** Damage meter: damage actually dealt per source, plus a rolling DPS. Pure bookkeeping (no rng), called on every hit. */
export class DamageMeter {
  rows: Record<string, MeterRow> = {};
  total = 0;
  private stamp = new Int32Array(BUCKETS).fill(-1);
  private sum = new Float64Array(BUCKETS);

  add(key: string, amt: number, crit: boolean, t: number) {
    if (!(amt > 0)) return;
    let r = this.rows[key];
    if (r === undefined) r = this.rows[key] = { key, dmg: 0, hits: 0, crits: 0, first: t };
    r.dmg += amt; r.hits++; if (crit) r.crits++;
    this.total += amt;
    const idx = Math.floor(t / BUCKET_S), b = idx % BUCKETS;
    if (this.stamp[b] !== idx) { this.stamp[b] = idx; this.sum[b] = 0; }
    this.sum[b] += amt;
  }

  /** rows by damage, highest first */
  sorted(): MeterRow[] { return Object.values(this.rows).sort((a, b) => b.dmg - a.dmg); }

  /** damage per second over the last 5 s (buckets older than that are ignored) */
  recentDps(t: number): number {
    const cur = Math.floor(t / BUCKET_S);
    let s = 0;
    for (let b = 0; b < BUCKETS; b++) { const st = this.stamp[b]; if (st > cur - BUCKETS && st <= cur) s += this.sum[b]; }
    return s / Math.max(0.5, Math.min(WINDOW_S, t));
  }

  runDps(t: number): number { return this.total / Math.max(1, t); }

  /** a source's damage per second since its first hit */
  rowDps(r: MeterRow, t: number): number { return r.dmg / Math.max(1, t - r.first); }
}

/** Compact number: 950, 12.3k, 4.5M */
export function compact(n: number): string {
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) { const v = n / 1e3; return (v >= 99.95 ? Math.round(v) : Math.round(v * 10) / 10) + 'k'; }
  if (n < 1e9) { const v = n / 1e6; return (v >= 99.95 ? Math.round(v) : Math.round(v * 10) / 10) + 'M'; }
  const v = n / 1e9;
  return (v >= 99.95 ? Math.round(v) : Math.round(v * 10) / 10) + 'B';
}
