/**
 * The Gachapon reveal (sim event 'gacha', src/game/gachapon.ts): a panel under the banner that ticks through the capsule's upgrades one by
 * one over about 2.5 s with each icon and "Lv N > N+1", then fades. It never pauses the run (pointer-events none, timers on the wall clock).
 * A capsule that opens while another is still showing waits its turn. Five upgrades get a bigger "JACKPOT!" flourish.
 */
import type { GachaResult } from '../game/types.ts';

/** ms before the first result appears (the capsule shakes), and the time at which the last result appears */
export const OPEN_MS = 500;
export const REVEAL_MS = 2500;
/** ms the finished panel stays up before it fades */
export const HOLD_MS = 1800;
const FADE_MS = 500;

/** ms after the panel appears at which result i of n is revealed: evenly from OPEN_MS to REVEAL_MS */
export function revealAt(i: number, n: number): number {
  return n <= 1 ? OPEN_MS : OPEN_MS + (i * (REVEAL_MS - OPEN_MS)) / (n - 1);
}

export interface GachaShow {
  boss: number;
  count: number;
  results: GachaResult[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class GachaUi {
  private root: HTMLDivElement;
  private title: HTMLDivElement;
  private list: HTMLDivElement;
  private queue: GachaShow[] = [];
  private timers: number[] = [];
  private busy = false;
  private icons: Record<string, string>;
  /** called as each result is revealed (the caller plays a tick sound) */
  onReveal: (i: number, r: GachaResult) => void = () => {};

  constructor(parent: HTMLElement, icons: Record<string, string>) {
    this.icons = icons;
    this.root = el('div', 'gacha');
    const ball = el('div', 'gacha-ball');
    if (icons.gacha) ball.innerHTML = `<img alt="" src="${icons.gacha}">`;
    this.title = el('div', 'gacha-title');
    this.list = el('div', 'gacha-list');
    this.root.append(ball, this.title, this.list);
    parent.appendChild(this.root);
  }

  /** Drops everything on screen and in the queue (a new run, the title screen) */
  reset() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.length = 0;
    this.queue.length = 0;
    this.busy = false;
    this.root.className = 'gacha';
    this.list.textContent = '';
  }

  show(ev: GachaShow) {
    this.queue.push({ boss: ev.boss, count: ev.count, results: ev.results.slice() });
    if (!this.busy) this.next();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private next() {
    const ev = this.queue.shift();
    if (!ev) { this.busy = false; return; }
    this.busy = true;
    const n = ev.results.length;
    this.list.textContent = '';
    this.title.textContent = n >= 5 ? 'JACKPOT! 5 UPGRADES!' : n > 1 ? `GACHAPON! ${n} UPGRADES!` : 'GACHAPON!';
    this.root.className = `gacha show opening${n >= 5 ? ' jackpot' : ''}`;
    ev.results.forEach((r, i) => this.later(revealAt(i, n), () => {
      this.root.classList.remove('opening');
      this.list.appendChild(this.row(r));
      this.onReveal(i, r);
    }));
    const done = revealAt(n - 1, n) + HOLD_MS;
    this.later(done, () => this.root.classList.add('fade'));
    this.later(done + FADE_MS, () => { this.root.className = 'gacha'; this.next(); });
  }

  private row(r: GachaResult): HTMLDivElement {
    const row = el('div', `grow ${r.kind}`);
    const img = r.kind === 'meso' ? this.icons.mesobag : this.icons[r.key];
    const pic = el('img', '');
    pic.alt = '';
    if (img) pic.src = img;
    const text = el('div', 'gtext');
    const name = el('b', '');
    const sub = el('span', '');
    if (r.kind === 'evolve') {
      name.textContent = 'Mastery Book!';
      sub.textContent = `${r.baseName ?? ''} > ${r.name}`;
    } else if (r.kind === 'meso') {
      name.textContent = 'Meso Bag';
      sub.textContent = `+${r.amount ?? 0} mesos`;
    } else {
      name.textContent = r.name;
      sub.textContent = `Lv ${r.from} > ${r.to}`;
    }
    text.append(name, sub);
    row.append(pic, text);
    return row;
  }
}
