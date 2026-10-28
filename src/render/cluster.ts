/**
 * Where region decor goes. Pure maths (no Pixi, no allocation per call) so Node tests can check the rules:
 * a hashed grid of 700 px cells, ~45% of them hold a cluster (one big object in the middle, 2 to 5 medium/small ones within
 * 130 px of it), plus sparse single grass tufts on a 250 px grid. Nothing lies within 60 px of another anchor: cluster centres
 * stay in the middle 40% of their cell, so clusters never reach a neighbour's, and tufts keep out of their cell's cluster disc.
 */
export const CLUSTER_CELL = 700;
export const TUFT_CELL = 250;
export const CLUSTER_CHANCE = 0.45;
export const TUFT_CHANCE = 0.3;
export const MIN_GAP = 60;
const SAT_MIN = 60;
const SAT_MAX = 130;
const CENTER_LO = 0.3;
const CENTER_SPAN = 0.4;
/** tufts keep this far from the cluster centre of their enclosing cell: SAT_MAX + MIN_GAP */
const TUFT_KEEP_OUT = SAT_MAX + MIN_GAP;

/** size classes of a decoration; indexes into RegionArt.bySize */
export const BIG = 0, MEDIUM = 1, SMALL = 2;

export function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Reusable output: slot i holds a world position, a size class and a random number in 0..1 to pick the object with. */
export class Placements {
  readonly x = new Float32Array(8);
  readonly y = new Float32Array(8);
  readonly cls = new Uint8Array(8);
  readonly pick = new Float32Array(8);
  n = 0;
  add(x: number, y: number, cls: number, pick: number) {
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.cls[i] = cls; this.pick[i] = pick;
  }
}

/** Which size classes the region has objects for. */
export interface Have {
  big: boolean;
  medium: boolean;
  small: boolean;
}

/** Cluster centre of a cell, or false when the cell holds none. Writes the centre into out.x[0]/out.y[0]. */
function centre(cx: number, cy: number, salt: number, out: Placements): boolean {
  if (hash3(cx, cy, salt * 8 + 1) >= CLUSTER_CHANCE) return false;
  out.x[0] = (cx + CENTER_LO + hash3(cx, cy, salt * 8 + 2) * CENTER_SPAN) * CLUSTER_CELL;
  out.y[0] = (cy + CENTER_LO + hash3(cx, cy, salt * 8 + 3) * CENTER_SPAN) * CLUSTER_CELL;
  return true;
}

/** Fills `out` with the cluster of cell (cx, cy) (out.n = 0 for an empty cell). */
export function clusterAt(cx: number, cy: number, salt: number, have: Have, out: Placements): void {
  out.n = 0;
  if (!centre(cx, cy, salt, out)) return;
  const mx = out.x[0], my = out.y[0];
  const first = have.big ? BIG : have.medium ? MEDIUM : SMALL;
  out.add(mx, my, first, hash3(cx, cy, salt * 8 + 4));
  const n = 2 + Math.floor(hash3(cx, cy, salt * 8 + 5) * 4);
  for (let k = 0; k < n; k++) {
    const ang0 = hash3(cx, cy, salt * 8 + 16 + k) * Math.PI * 2;
    const rad = SAT_MIN + hash3(cx, cy, salt * 8 + 32 + k) * (SAT_MAX - SAT_MIN);
    const med = hash3(cx, cy, salt * 8 + 48 + k) < 0.5;
    const cls = med ? (have.medium ? MEDIUM : have.small ? SMALL : first) : have.small ? SMALL : have.medium ? MEDIUM : first;
    // try a few angles until nothing sits within MIN_GAP; give up on this satellite otherwise
    for (let t = 0; t < 4; t++) {
      const ang = ang0 + t * 1.7;
      const x = mx + Math.cos(ang) * rad, y = my + Math.sin(ang) * rad;
      let ok = true;
      for (let j = 0; j < out.n; j++) {
        const dx = out.x[j] - x, dy = out.y[j] - y;
        if (dx * dx + dy * dy < MIN_GAP * MIN_GAP) { ok = false; break; }
      }
      if (ok) {
        out.add(x, y, cls, hash3(cx, cy, salt * 8 + 64 + k));
        break;
      }
    }
  }
}

/** The tuft of 250 px cell (tx, ty), written as one placement; out.n = 0 when the cell has none. */
export function tuftAt(tx: number, ty: number, salt: number, cls: number, out: Placements, scratch: Placements): void {
  out.n = 0;
  if (hash3(tx, ty, salt * 8 + 6) >= TUFT_CHANCE) return;
  const x = (tx + 0.1 + hash3(tx, ty, salt * 8 + 7) * 0.8) * TUFT_CELL;
  const y = (ty + 0.1 + hash3(tx, ty, salt * 8 + 8) * 0.8) * TUFT_CELL;
  const cx = Math.floor(x / CLUSTER_CELL), cy = Math.floor(y / CLUSTER_CELL);
  if (centre(cx, cy, salt, scratch)) {
    const dx = scratch.x[0] - x, dy = scratch.y[0] - y;
    if (dx * dx + dy * dy < TUFT_KEEP_OUT * TUFT_KEEP_OUT) return;
  }
  out.add(x, y, cls, hash3(tx, ty, salt * 8 + 9));
}
