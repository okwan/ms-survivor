/**
 * Uniform spatial hash rebuilt every tick. Items are indices into the owner's array, stored as
 * intrusive linked lists so a rebuild allocates nothing. The grid is recentred on the player;
 * positions outside it clamp to the border cells (queries stay correct, only slower).
 */
export class SpatialGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  minX = 0;
  minY = 0;
  private halfW: number;
  private halfH: number;
  private head: Int32Array;
  private next: Int32Array;

  constructor(width: number, height: number, cell: number, capacity: number) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.halfW = width / 2;
    this.halfH = height / 2;
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
  }

  recenter(x: number, y: number) {
    this.minX = x - this.halfW;
    this.minY = y - this.halfH;
    this.head.fill(-1);
  }

  private clampX(v: number): number {
    return v < 0 ? 0 : v >= this.cols ? this.cols - 1 : v;
  }
  private clampY(v: number): number {
    return v < 0 ? 0 : v >= this.rows ? this.rows - 1 : v;
  }

  insert(i: number, x: number, y: number) {
    const cx = this.clampX(Math.floor((x - this.minX) / this.cell));
    const cy = this.clampY(Math.floor((y - this.minY) / this.cell));
    const c = cy * this.cols + cx;
    this.next[i] = this.head[c];
    this.head[c] = i;
  }

  /** Writes indices of items whose cell overlaps the circle into out; returns the count. */
  query(x: number, y: number, r: number, out: Int32Array): number {
    const cell = this.cell;
    const x0 = this.clampX(Math.floor((x - r - this.minX) / cell));
    const x1 = this.clampX(Math.floor((x + r - this.minX) / cell));
    const y0 = this.clampY(Math.floor((y - r - this.minY) / cell));
    const y1 = this.clampY(Math.floor((y + r - this.minY) / cell));
    let n = 0;
    const max = out.length;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        let i = this.head[cy * this.cols + cx];
        while (i !== -1) {
          if (n < max) out[n++] = i;
          i = this.next[i];
        }
      }
    }
    return n;
  }
}
