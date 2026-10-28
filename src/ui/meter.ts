import { SKILL_BY_KEY } from '../game/data.ts';
import { FIELD_ITEMS, FIELD_KEG } from '../game/fieldItems.ts';
import { compact } from '../game/meter.ts';
import type { Sim } from '../game/sim.ts';
import { isTouch } from './touch.ts';

export { compact };

/** Display name and icon (a key of the HUD icon map, '' = none) of a damage source: a skill key, 'keg' (Powder Keg) or anything else. */
export function sourceInfo(key: string, icons: Record<string, string>): { name: string; icon: string } {
  const sk = SKILL_BY_KEY[key];
  if (sk) return { name: sk.name, icon: icons[key] ?? '' };
  if (key === 'keg') return { name: FIELD_ITEMS[FIELD_KEG].name, icon: icons['field' + FIELD_KEG] ?? '' };
  return { name: key && key !== 'other' ? key : 'Other', icon: '' };
}

/** Bar colour by rank: distinct hues that read on bright and dark maps (the bar sits under white outlined text) */
export const BAR_COLORS = ['#e0562e', '#e89b22', '#4aa3e8', '#58b84a', '#a46ad8', '#d9559a'];

export const METER_ROWS = 6, METER_MIN_MS = 250;

interface Row { el: HTMLDivElement; bar: HTMLElement; img: HTMLImageElement; nm: HTMLElement; val: HTMLElement; pct: HTMLElement; dps: HTMLElement; c: string[] }

export interface MeterHooks {
  /** hotkey only works while this is true (a run is in progress) */
  active(): boolean;
  /** the player toggled the panel (save the choice) */
  toggled(on: boolean): void;
}

/** Live damage meter in the HUD (top-left under the kills pill and buffs); T or the DPS button toggles it. */
export class MeterPanel {
  readonly el: HTMLDivElement;
  private title: HTMLElement;
  private sum: HTMLElement;
  private body: HTMLElement;
  private rows: Row[] = [];
  private cache = new Map<HTMLElement, string>();
  private last = -1e9;
  private shown = false;
  on: boolean;

  constructor(parent: HTMLElement, private icons: Record<string, string>, private btn: HTMLButtonElement, private hooks: MeterHooks, on = !isTouch()) {
    this.on = on;
    const e = (this.el = document.createElement('div'));
    e.className = 'meter';
    e.style.display = 'none';
    e.innerHTML = '<div class="mt-title"><span>Damage</span><b></b></div><div class="mt-body"></div>';
    this.title = e.firstElementChild as HTMLElement;
    this.sum = this.title.querySelector('b')!;
    this.body = e.lastElementChild as HTMLElement;
    parent.appendChild(e);
    btn.addEventListener('click', () => this.toggle());
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey || ev.key.toLowerCase() !== 't') return;
      const t = ev.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (this.hooks.active()) this.toggle();
    });
    this.syncBtn();
  }

  toggle() {
    this.on = !this.on;
    this.syncBtn();
    this.hooks.toggled(this.on);
    this.last = -1e9;
  }

  private syncBtn() { this.btn.classList.toggle('on', this.on); }

  private set(el: HTMLElement, v: string) { if (this.cache.get(el) !== v) { this.cache.set(el, v); el.textContent = v; } }

  private makeRow(): Row {
    const el = document.createElement('div');
    el.className = 'mt-row';
    el.innerHTML = '<i class="mt-bar"></i><img alt=""><span class="mt-nm"></span><b class="mt-v"></b><u class="mt-pct"></u><em class="mt-dps"></em>';
    this.body.appendChild(el);
    const q = (s: string) => el.querySelector(s) as HTMLElement;
    return { el, bar: q('.mt-bar'), img: q('img') as HTMLImageElement, nm: q('.mt-nm'), val: q('.mt-v'), pct: q('.mt-pct'), dps: q('.mt-dps'), c: ['', '', ''] };
  }

  /** call every frame; refreshes at most 4x per second and only touches the DOM for what changed */
  update(sim: Sim) {
    const now = performance.now();
    if (now - this.last < METER_MIN_MS) return;
    this.last = now;
    const m = sim.meter;
    const show = this.on && m.total > 0;
    if (show !== this.shown) { this.shown = show; this.el.style.display = show ? '' : 'none'; }
    if (!show) return;
    const t = sim.t;
    this.set(this.sum, `${compact(m.total)}  ${compact(m.recentDps(t))}/s`);
    const sorted = m.sorted(), n = Math.min(METER_ROWS, sorted.length), top = sorted[0].dmg;
    while (this.rows.length < n) this.rows.push(this.makeRow());
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (i >= n) { if (r.c[0] !== 'x') { r.c[0] = 'x'; r.el.style.display = 'none'; } continue; }
      if (r.c[0] === 'x') { r.c[0] = ''; r.el.style.display = ''; }
      const s = sorted[i], info = sourceInfo(s.key, this.icons);
      if (r.c[0] !== s.key) {
        r.c[0] = s.key;
        r.img.src = info.icon;
        r.img.style.visibility = info.icon ? '' : 'hidden';
        r.bar.style.background = BAR_COLORS[i];
        this.set(r.nm, info.name);
      }
      const w = `${Math.max(2, Math.round((s.dmg / top) * 100))}%`;
      if (r.c[1] !== w) { r.c[1] = w; r.bar.style.width = w; }
      const bc = BAR_COLORS[i];
      if (r.c[2] !== bc) { r.c[2] = bc; r.bar.style.background = bc; }
      this.set(r.val, compact(s.dmg));
      this.set(r.pct, `${Math.round((s.dmg / m.total) * 100)}%`);
      this.set(r.dps, compact(m.rowDps(s, t)) + '/s');
    }
  }
}
