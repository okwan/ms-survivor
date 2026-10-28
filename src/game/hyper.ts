/**
 * Hyper Skills: a permanent talent tree per class, named after MapleStory's Hyper Skills and laid out like a WoW talent tree (shown by
 * src/ui/hyper.ts, saved by src/ui/save.ts). Each class has one column for its 1st job and one per 2nd-job branch (holding that branch's
 * 2nd and 3rd job skills). Every active skill of a column yields two nodes, generated from data.ts so the tree never drifts from the skills:
 * "<Skill> - Reinforce" (+8% damage per rank, 3 ranks) and one more chosen by the skill's kind: "Extra Target" (+1 target / projectile),
 * "Spread" (+10% area per rank, 2 ranks) or "Cooltime Reduce" (-6% cooldown per rank, 2 ranks). A skill sits in one row (its two nodes side
 * by side); row r needs 3 x r points spent in the whole tree, and the second node needs a rank of Reinforce.
 * Hyper SP is earned per class from the levels gained in runs with it (1 per HYPER_LEVELS_PER_SP, up to HYPER_SP_CAP) and spent a rank at a
 * time; Reset refunds everything for free. An evolved 4th-job skill (Mastery Book) keeps the bonuses of the skill it replaced. The sim gets a
 * per-skill modifier table (`hyperMods`) built once, so the hot loops only read it. Pure (no DOM).
 */
import { CLASSES, JOB_BY_CODE, SKILL_BY_KEY, jobOfId } from './data.ts';
import type { ClassDef, ClassKey, SkillDef } from './data.ts';
import { RECIPES } from './evolutions.ts';

/** Character levels gained (level - 1 of each run) per Hyper SP, and the most SP a class can ever have */
export const HYPER_LEVELS_PER_SP = 20;
export const HYPER_SP_CAP = 30;
/** Points that must be spent in the whole tree per row to unlock a row */
export const HYPER_ROW_POINTS = 3;
export const REINFORCE_PER = 0.08;
export const SPREAD_PER = 0.1;
export const COOLTIME_PER = 0.06;

export type HyperKind = 'reinforce' | 'extra' | 'spread' | 'cooltime';
export interface HyperNode {
  /** `${skillKey}:${kind}`, the key saved and handed to the Sim */
  key: string;
  skill: string;
  kind: HyperKind;
  /** "Fire Arrow - Reinforce" */
  name: string;
  /** the part after the dash, for small tiles ("Reinforce", "Extra Target", "Spread", "Cooltime Reduce") */
  label: string;
  max: number;
  /** column index in the tree, row, and slot in the row (0 Reinforce, 1 the second node) */
  col: number;
  row: number;
  slot: 0 | 1;
  /** points that must be spent in the whole tree before this node can take a rank */
  reqPoints: number;
  /** key of the node that needs a rank first (the skill's Reinforce), or null */
  needs: string | null;
  /** effect of `n` ranks, e.g. "+16% damage" */
  text(n: number): string;
}
export interface HyperColumn {
  /** job codes whose skills the column holds (1st job, or 2nd and 3rd job of a branch) */
  jobs: number[];
  name: string;
  nodes: HyperNode[];
}
export interface HyperTree {
  cls: ClassKey;
  columns: HyperColumn[];
  /** every node, ordered by row then slot (the order ranks are replayed in to validate a save) */
  nodes: HyperNode[];
  byKey: Record<string, HyperNode>;
  rows: number;
  /** sum of the max ranks of all nodes */
  totalRanks: number;
}
/** Saved per class: lifetime levels gained, and the ranks by node key */
export interface HyperClass {
  levels: number;
  ranks: Record<string, number>;
}
export type HyperData = Record<ClassKey, HyperClass>;
/** What the Sim reads per skill: damage multiplier, extra targets, area multiplier, cooldown multiplier */
export interface HyperMods {
  dmg: number;
  count: number;
  area: number;
  cd: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The second node of a skill, chosen by what its kind does */
function secondKind(d: SkillDef): HyperKind {
  if (d.kind === 'nova' || d.kind === 'cone') return 'spread';
  if (d.count > 1 || d.kind === 'bolt' || d.kind === 'pierce' || d.kind === 'strike' || d.kind === 'ground' || d.kind === 'orbit' || d.kind === 'chain') return 'extra';
  return d.radius > 0 ? 'spread' : 'cooltime';
}

function makeNodes(d: SkillDef, col: number, row: number): HyperNode[] {
  const base = { skill: d.key, col, row, reqPoints: HYPER_ROW_POINTS * row };
  const reinforce: HyperNode = { ...base, key: `${d.key}:reinforce`, kind: 'reinforce', name: `${d.name} - Reinforce`, label: 'Reinforce', max: 3, slot: 0, needs: null, text: (n) => `+${pct(REINFORCE_PER * n)} damage` };
  const k = secondKind(d);
  const need = reinforce.key;
  const second: HyperNode =
    k === 'extra' ? { ...base, key: `${d.key}:extra`, kind: 'extra', name: `${d.name} - Extra Target`, label: 'Extra Target', max: 1, slot: 1, needs: need, text: (n) => `+${n} target${n === 1 ? '' : 's'}` }
    : k === 'spread' ? { ...base, key: `${d.key}:spread`, kind: 'spread', name: `${d.name} - Spread`, label: 'Spread', max: 2, slot: 1, needs: need, text: (n) => `+${pct(SPREAD_PER * n)} area` }
    : { ...base, key: `${d.key}:cooltime`, kind: 'cooltime', name: `${d.name} - Cooltime Reduce`, label: 'Cooltime Reduce', max: 2, slot: 1, needs: need, text: (n) => `-${pct(COOLTIME_PER * n)} cooldown` };
  return [reinforce, second];
}

function buildTree(c: ClassDef): HyperTree {
  const skillsOf = (job: number) => c.skills.map((k) => SKILL_BY_KEY[k]).filter((s) => jobOfId(s.id) === job);
  const groups: { jobs: number[]; name: string }[] = [{ jobs: [c.firstJob], name: JOB_BY_CODE[c.firstJob].name }];
  for (const b of c.branches) groups.push({ jobs: [b, b + 1], name: `${JOB_BY_CODE[b].name} / ${JOB_BY_CODE[b + 1].name}` });
  const columns: HyperColumn[] = groups.map((g, col) => {
    const nodes: HyperNode[] = [];
    // 1st job skills start at row 0, 2nd job at row 1, 3rd job at row 3; each skill takes the next row of its job
    g.jobs.forEach((job, tier) => {
      skillsOf(job).forEach((s, j) => nodes.push(...makeNodes(s, col, [0, 1, 3][g.jobs.length === 1 ? 0 : tier + 1] + j)));
    });
    return { ...g, nodes };
  });
  const nodes = columns.flatMap((x) => x.nodes).sort((a, b) => a.row - b.row || a.slot - b.slot || a.col - b.col);
  return {
    cls: c.key, columns, nodes, byKey: Object.fromEntries(nodes.map((n) => [n.key, n])),
    rows: nodes.reduce((m, n) => Math.max(m, n.row + 1), 0), totalRanks: nodes.reduce((s, n) => s + n.max, 0),
  };
}

export const HYPER_TREES = Object.fromEntries(CLASSES.map((c) => [c.key, buildTree(c)])) as Record<ClassKey, HyperTree>;

// ---- Hyper SP --------------------------------------------------------------------------------

export const emptyHyperClass = (): HyperClass => ({ levels: 0, ranks: {} });
export const emptyHyper = (): HyperData => Object.fromEntries(CLASSES.map((c) => [c.key, emptyHyperClass()])) as HyperData;

/** Hyper SP earned for `levels` lifetime levels gained with a class */
export const hyperEarned = (levels: number) => Math.min(HYPER_SP_CAP, Math.floor(Math.max(0, levels) / HYPER_LEVELS_PER_SP));
/** SP spent: the sum of the ranks */
export function hyperSpent(ranks: Record<string, number>): number {
  let s = 0;
  for (const k in ranks) s += ranks[k];
  return s;
}
export const hyperAvailable = (h: HyperClass) => hyperEarned(h.levels) - hyperSpent(h.ranks);

/** Why node `key` cannot take another rank now, or null when it can (the UI shows this text on a locked tile) */
export function hyperLock(cls: ClassKey, h: HyperClass, key: string): string | null {
  const n = HYPER_TREES[cls]?.byKey[key];
  if (!n) return 'Unknown skill';
  const have = h.ranks[key] ?? 0;
  if (have >= n.max) return 'Maxed';
  const spent = hyperSpent(h.ranks);
  if (spent < n.reqPoints) return `Needs ${n.reqPoints} points in this tree (${spent} spent)`;
  if (n.needs && (h.ranks[n.needs] ?? 0) < 1) return 'Needs Reinforce first';
  if (hyperAvailable(h) <= 0) return 'No Hyper SP left';
  return null;
}

/** Adds a rank to a node: the new data, or null when it is locked, maxed or there is no SP */
export function hyperAdd(cls: ClassKey, h: HyperClass, key: string): HyperClass | null {
  if (hyperLock(cls, h, key) !== null) return null;
  return { levels: h.levels, ranks: { ...h.ranks, [key]: (h.ranks[key] ?? 0) + 1 } };
}

/** Refunds every rank (free); the levels stay */
export const hyperReset = (h: HyperClass): HyperClass => ({ levels: h.levels, ranks: {} });

/** Banks the levels gained in a run: the new data and the SP it earned */
export function hyperGain(h: HyperClass, levels: number): { data: HyperClass; sp: number } {
  const add = Math.max(0, Math.floor(levels));
  const data = { levels: Math.min(1e9, h.levels + add), ranks: h.ranks };
  return { data, sp: hyperEarned(data.levels) - hyperEarned(h.levels) };
}

/** True when the ranks could have been bought one at a time under the gating rules (replayed in row order) */
function validRanks(tree: HyperTree, ranks: Record<string, number>): boolean {
  const state: Record<string, number> = {};
  let spent = 0;
  for (const n of tree.nodes) {
    const want = ranks[n.key] ?? 0;
    for (let r = 0; r < want; r++) {
      if (spent < n.reqPoints || (n.needs && !(state[n.needs] > 0))) return false;
      state[n.key] = (state[n.key] ?? 0) + 1;
      spent++;
    }
  }
  return true;
}

/** A clean copy of untrusted data: every class present, unknown nodes dropped, ranks whole and clamped; a class whose ranks break the gating or exceed its SP is refunded */
export function sanitizeHyper(raw: unknown): HyperData {
  const out = emptyHyper();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const c of CLASSES) {
    const v = o[c.key];
    if (!v || typeof v !== 'object') continue;
    const r = v as { levels?: unknown; ranks?: unknown };
    const levels = typeof r.levels === 'number' && Number.isFinite(r.levels) ? Math.max(0, Math.min(1e9, Math.floor(r.levels))) : 0;
    const ranks: Record<string, number> = {};
    const tree = HYPER_TREES[c.key];
    if (r.ranks && typeof r.ranks === 'object') {
      for (const n of tree.nodes) {
        const x = (r.ranks as Record<string, unknown>)[n.key];
        if (typeof x === 'number' && Number.isFinite(x) && x >= 1) ranks[n.key] = Math.min(n.max, Math.floor(x));
      }
    }
    out[c.key] = { levels, ranks: hyperSpent(ranks) <= hyperEarned(levels) && validRanks(tree, ranks) ? ranks : {} };
  }
  return out;
}

// ---- what the Sim uses -----------------------------------------------------------------------

const NONE: Record<string, HyperMods> = {};

/**
 * Per-skill modifiers for a class's ranks (unknown nodes and out-of-range ranks are ignored; gating is not checked here). Keyed by skill
 * key; an evolved 4th-job skill shares the entry of the skill it replaces. Skills with no ranks have no entry.
 */
export function hyperMods(cls: string, ranks?: Record<string, number>): Record<string, HyperMods> {
  const tree = HYPER_TREES[cls as ClassKey];
  if (!tree || !ranks) return NONE;
  const out: Record<string, HyperMods> = {};
  for (const n of tree.nodes) {
    const r = Math.min(n.max, Math.floor(ranks[n.key] ?? 0));
    if (!(r > 0)) continue;
    const m = (out[n.skill] ??= { dmg: 1, count: 0, area: 1, cd: 1 });
    if (n.kind === 'reinforce') m.dmg += REINFORCE_PER * r;
    else if (n.kind === 'extra') m.count += r;
    else if (n.kind === 'spread') m.area += SPREAD_PER * r;
    else m.cd -= COOLTIME_PER * r;
  }
  for (const r of RECIPES) if (out[r.base]) out[r.evolved] = out[r.base];
  return out;
}
