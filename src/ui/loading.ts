/**
 * The boot loading screen (#boot in index.html, painted before the bundle loads) and the black veil used for scene changes.
 * Loading maps the boot stages onto one bar: progress eases toward the stage's target and never goes backwards.
 */

export class Loading {
  private root: HTMLElement;
  private fill: HTMLElement;
  private txt: HTMLElement;
  private pct: HTMLElement;
  private shown = 0;
  private target = 0;
  private from = 0;
  private to = 0;
  private raf = 0;
  private last = 0;
  private done = false;

  constructor() {
    let r = document.getElementById('boot');
    if (!r) {
      r = document.createElement('div');
      r.id = 'boot';
      r.innerHTML = '<div class="bt-col"><div class="bt-track"><div class="bt-fill"></div></div><div class="bt-status"><span class="bt-txt"></span><span class="bt-pct">0%</span></div></div>';
      document.body.prepend(r);
    }
    this.root = r;
    this.fill = r.querySelector<HTMLElement>('.bt-fill')!;
    this.txt = r.querySelector<HTMLElement>('.bt-txt')!;
    this.pct = r.querySelector<HTMLElement>('.bt-pct')!;
    document.documentElement.classList.add('booting');
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Starts a stage: shows its label; the bar goes to `from` and creeps toward `to` while the stage runs. */
  stage(label: string, from: number, to: number) {
    this.txt.textContent = label;
    this.from = from;
    this.to = to;
    this.target = Math.max(this.target, from);
  }

  /** Fraction 0..1 within the current stage. */
  progress(frac: number) {
    const f = Math.max(0, Math.min(1, frac));
    this.target = Math.max(this.target, this.from + (this.to - this.from) * f);
  }

  /** Replaces the status text. */
  note(text: string) {
    this.txt.textContent = text;
  }

  /** Fills the bar, fades the overlay out and removes it. */
  async finish(): Promise<void> {
    this.done = true;
    this.target = 1;
    const t0 = performance.now();
    while (this.shown < 0.995 && performance.now() - t0 < 1200) await new Promise((r) => setTimeout(r, 30));
    this.set(1);
    cancelAnimationFrame(this.raf);
    this.root.classList.add('out');
    await new Promise((r) => setTimeout(r, 450));
    this.root.remove();
    document.documentElement.classList.remove('booting');
  }

  private set(v: number) {
    this.shown = Math.max(this.shown, Math.min(1, v));
    this.fill.style.width = this.shown * 100 + '%';
    this.pct.textContent = Math.round(this.shown * 100) + '%';
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    // while a stage runs the target creeps asymptotically toward its end so the bar never visibly stalls
    if (!this.done && this.to > this.from) {
      const cap = this.to - 0.02;
      if (this.target < cap) this.target += (cap - this.target) * Math.min(1, dt * 0.5);
    }
    if (this.target > this.shown) this.set(this.shown + (this.target - this.shown) * Math.min(1, dt * 6) + 0.0005);
  };
}

let veiling = false;

/** Fades the screen to black, runs `fn` at full black, then fades back and removes itself. Calls while one runs are ignored. */
export function veil(fn: () => void, inMs = 220, outMs = 360): void {
  if (veiling) return;
  veiling = true;
  const v = document.createElement('div');
  v.style.cssText = `position:fixed;inset:0;z-index:90;background:#000;opacity:0;pointer-events:auto;transition:opacity ${inMs}ms ease-in`;
  document.body.appendChild(v);
  void v.offsetWidth;
  v.style.opacity = '1';
  setTimeout(() => {
    try { fn(); } finally {
      v.style.transition = `opacity ${outMs}ms ease-out`;
      v.style.opacity = '0';
      setTimeout(() => { v.remove(); veiling = false; }, outMs);
    }
  }, inMs);
}
