/**
 * Finds the baked slot frames (recessed ~32x32 boxes) in a decoded window background such as UIWindow.img Equip/backgrnd and
 * Item/backgrnd, since the real client draws them into the image and has no per-slot nodes. Pure (no fs), so tests can run it on
 * synthetic canvases.
 *
 * A candidate square of side s (30..36) scores by its four outlines: for each side, the mean over the side's length of the luminance step
 * from the panel into the frame (so the outer outline, not an inner bevel, decides the position); the score is the weakest side. The interior must be calm (low gradient), so
 * long panel edges and the character area are not mistaken for frames. Candidates are taken best first and must not overlap an
 * accepted one;
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectOptions {
  minSize?: number;
  maxSize?: number;
  /** weakest outline (mean luminance step) that still counts */
  minEdge?: number;
  /** most texture (mean gradient) allowed inside */
  maxInner?: number;
}

export function detectSlots(rgba: Uint8Array | Buffer, w: number, h: number, o: DetectOptions = {}): Rect[] {
  const minS = o.minSize ?? 30, maxS = o.maxSize ?? 36, minEdge = o.minEdge ?? 14, maxInner = o.maxInner ?? 30;
  // luminance; see-through pixels read as mid grey so transparent margins do not look like frames
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    L[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 128 * (1 - a);
  }
  const at = (x: number, y: number) => L[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  // step magnitudes: horizontal edge strength at (x,y) (change down) and vertical edge strength (change right)
  const dy = new Float32Array(w * h), dx = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { dy[y * w + x] = Math.abs(at(x, y + 1) - at(x, y)); dx[y * w + x] = Math.abs(at(x + 1, y) - at(x, y)); }
  const D = (a: Float32Array, x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x]);
  const cand: { x: number; y: number; s: number; score: number }[] = [];
  for (let s = minS; s <= maxS; s++) {
    for (let y = 1; y + s < h; y++) {
      for (let x = 1; x + s < w; x++) {
        // the frame's outline is the step from the panel into the frame: between rows y-1/y (top), y+s-1/y+s (bottom), and the same for columns
        let top = 0, bot = 0, left = 0, right = 0;
        for (let i = 4; i < s - 4; i++) { top += D(dy, x + i, y - 1); bot += D(dy, x + i, y + s - 1); left += D(dx, x - 1, y + i); right += D(dx, x + s - 1, y + i); }
        top /= s - 8; bot /= s - 8; left /= s - 8; right /= s - 8;
        if (Math.min(top, bot, left, right) < minEdge) continue;
        const edge = Math.min(top, bot, left, right);
        if (edge < minEdge) continue;
        let tex = 0, n = 0;
        for (let yy = y + 5; yy < y + s - 5; yy++) for (let xx = x + 5; xx < x + s - 5; xx++) { tex += dx[yy * w + xx] + dy[yy * w + xx]; n++; }
        tex /= Math.max(1, n);
        if (tex > maxInner) continue;
        cand.push({ x, y, s, score: edge - tex * 0.5 });
      }
    }
  }
  cand.sort((a, b) => b.score - a.score);
  const out: { x: number; y: number; s: number; score: number }[] = [];
  const overlap = (a: { x: number; y: number; s: number }, b: { x: number; y: number; s: number }) => {
    const ox = Math.min(a.x + a.s, b.x + b.s) - Math.max(a.x, b.x), oy = Math.min(a.y + a.s, b.y + b.s) - Math.max(a.y, b.y);
    return ox > 0 && oy > 0 ? (ox * oy) / (Math.min(a.s, b.s) ** 2) : 0;
  };
  for (const c of cand) if (!out.some((a) => overlap(a, c) > 0.2)) out.push(c);
  return readingOrder(out.map((c) => ({ x: c.x, y: c.y, w: c.s, h: c.s })));
}

/** top to bottom, then left to right; rects whose tops are within 8 px count as one row */
export function readingOrder(rs: Rect[]): Rect[] {
  const sorted = [...rs].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Rect[] = [];
  for (let i = 0; i < sorted.length;) {
    const row = [sorted[i]];
    let j = i + 1;
    while (j < sorted.length && sorted[j].y - sorted[i].y <= 8) row.push(sorted[j++]);
    out.push(...row.sort((a, b) => a.x - b.x));
    i = j;
  }
  return out;
}

/** The whole background as text, two columns per 3 pixels wide and one row per 5: '#' on a detected frame outline, '+' in its corner, '.' dark, ',' mid, ' ' light. */
export function overlayAscii(rgba: Uint8Array | Buffer, w: number, h: number, rects: Rect[], sx = 3, sy = 5): string {
  const cols = Math.ceil(w / sx), rows = Math.ceil(h / sy);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const px = Math.min(w - 1, c * sx + 1), py = Math.min(h - 1, r * sy + 2);
      const hit = rects.findIndex((q) => px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h);
      const i = (py * w + px) * 4;
      const a = rgba[i + 3] / 255;
      const l = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * a;
      const base = a < 0.3 ? ' ' : l < 70 ? '.' : l < 160 ? ',' : ' ';
      line += hit >= 0 ? (base === ' ' ? 'o' : base === ',' ? 'O' : '#') : base;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
