/**
 * Henesys shop: permanent meta-progression bought with banked mesos (saved by src/ui/save.ts, shown by src/ui/shop.ts). Each upgrade has
 * ranks; the ranks the hero owns are handed to the Sim at run start (`meta` option), which folds them into its stats in recalc(). Rank
 * r+1 costs base x growth^r mesos, rounded to the nearest 10. Pure (no DOM).
 */
export type MetaKey = 'hp' | 'might' | 'haste' | 'armor' | 'speed' | 'magnet' | 'growth' | 'greed' | 'reroll' | 'banish' | 'revive';
export type MetaRanks = Record<MetaKey, number>;

export interface MetaDef {
  key: MetaKey;
  name: string;
  /** effect of one rank (a fraction for percentages, else a count) */
  per: number;
  max: number;
  base: number;
  growth: number;
  /** text of the effect at `n` ranks, e.g. "+16% max HP" */
  text(n: number): string;
}

/** Safety Charm (revive): the hero comes back with this fraction of max HP, is untouchable for REVIVE_INVULN seconds, and a burst pushes every enemy within REVIVE_RADIUS yd away and stuns it */
export const REVIVE_HP = 0.5;
export const REVIVE_INVULN = 3;
export const REVIVE_RADIUS = 9;
export const REVIVE_STUN = 1.5;

const pct = (v: number) => `+${Math.round(v * 100)}%`;
const plural = (n: number, w: string) => `+${n} ${w}${n === 1 ? '' : 's'}`;

export const META: MetaDef[] = [
  { key: 'hp', name: 'Max HP', per: 0.08, max: 5, base: 200, growth: 1.6, text: (n) => `${pct(0.08 * n)} max HP` },
  { key: 'might', name: 'Might', per: 0.05, max: 5, base: 300, growth: 1.6, text: (n) => `${pct(0.05 * n)} damage` },
  { key: 'haste', name: 'Haste', per: 0.04, max: 5, base: 300, growth: 1.6, text: (n) => `${pct(0.04 * n)} cooldown speed` },
  { key: 'armor', name: 'Armor', per: 1, max: 3, base: 400, growth: 1.8, text: (n) => `+${n} armor` },
  { key: 'speed', name: 'Speed', per: 0.03, max: 3, base: 250, growth: 1.6, text: (n) => `${pct(0.03 * n)} move speed` },
  { key: 'magnet', name: 'Magnet', per: 0.12, max: 3, base: 150, growth: 1.5, text: (n) => `${pct(0.12 * n)} pickup radius` },
  { key: 'growth', name: 'Growth', per: 0.04, max: 5, base: 350, growth: 1.6, text: (n) => `${pct(0.04 * n)} EXP` },
  { key: 'greed', name: 'Greed', per: 0.08, max: 5, base: 250, growth: 1.6, text: (n) => `${pct(0.08 * n)} mesos` },
  { key: 'reroll', name: 'Gachapon Ticket', per: 1, max: 3, base: 500, growth: 2, text: (n) => `${plural(n, 'reroll')} per run` },
  { key: 'banish', name: 'Trash Can', per: 1, max: 3, base: 500, growth: 2, text: (n) => `${plural(n, 'banish')} per run` },
  { key: 'revive', name: 'Safety Charm', per: 1, max: 1, base: 3000, growth: 1, text: (n) => (n > 0 ? `One revive per run at ${Math.round(REVIVE_HP * 100)}% HP` : 'No revive') },
];
export const META_BY_KEY = Object.fromEntries(META.map((d) => [d.key, d])) as Record<MetaKey, MetaDef>;

export const emptyMeta = (): MetaRanks => Object.fromEntries(META.map((d) => [d.key, 0])) as MetaRanks;

/** Mesos for rank `rank` + 1 of an upgrade (rank = ranks owned now), rounded to the nearest 10. */
export function metaCost(key: MetaKey, rank: number): number {
  const d = META_BY_KEY[key];
  return Math.round((d.base * Math.pow(d.growth, rank)) / 10) * 10;
}

/** Mesos for every rank of one upgrade, or of the whole shop. */
export function metaTotalCost(key?: MetaKey): number {
  let sum = 0;
  for (const d of key ? [META_BY_KEY[key]] : META) for (let r = 0; r < d.max; r++) sum += metaCost(d.key, r);
  return sum;
}

/** Mesos spent on the ranks owned. */
export function metaSpent(ranks: Partial<MetaRanks>): number {
  let sum = 0;
  for (const d of META) for (let r = 0; r < Math.min(d.max, ranks[d.key] ?? 0); r++) sum += metaCost(d.key, r);
  return sum;
}

/** A clean copy of untrusted data: every key present, whole numbers from 0 to the upgrade's max (missing or odd values become 0). */
export function sanitizeMeta(raw: unknown): MetaRanks {
  const out = emptyMeta();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const d of META) {
    const v = o[d.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = Math.max(0, Math.min(d.max, Math.floor(v)));
  }
  return out;
}

/** Buys the next rank: the new mesos and ranks, or null when the upgrade is maxed or the hero cannot afford it. */
export function buyMeta(mesos: number, ranks: MetaRanks, key: MetaKey): { mesos: number; ranks: MetaRanks } | null {
  const d = META_BY_KEY[key];
  const r = ranks[key];
  if (!d || r >= d.max) return null;
  const cost = metaCost(key, r);
  if (mesos < cost) return null;
  return { mesos: mesos - cost, ranks: { ...ranks, [key]: r + 1 } };
}

/** Gives back every meso spent (the ranks go to 0). */
export function refundMeta(mesos: number, ranks: MetaRanks): { mesos: number; ranks: MetaRanks } {
  return { mesos: mesos + metaSpent(ranks), ranks: emptyMeta() };
}
