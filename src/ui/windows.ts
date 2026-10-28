/**
 * MapleStory-style windows: Equip (Q), Inventory (I) and Stats (C). Draggable by the title bar, never pause the game, close with the
 * X button or the key again. The Equip window shows the hero in the middle with the 17 v83 equipment frames around it (the ones the
 * game has items for are filled, the rest stay empty), hover shows a Maple item tooltip, double-click takes an item off. The
 * Inventory lists what the hero carries but does not wear (sim.bag); double-click or right-click wears it.
 * State lives in the sim; this reads it every frame and only touches the DOM when it changed. Pixel positions: layout.ts.
 */
import { CLASS_BY_KEY, JOB_BY_CODE } from '../game/data.ts';
import { plusOf, slotsLeft } from '../game/scrolls.ts';
import { BAG_SIZE, GEAR_SLOT_NAMES, JOB_BIT, describeBonus, itemBonus, totalBonus } from '../game/gear.ts';
import type { GearItem, GearStats } from '../game/gear.ts';
import type { Sim } from '../game/sim.ts';
import type { Avatar } from '../maple/avatar.ts';
import { frameIndexAt } from '../maple/avatar.ts';
import type { Look } from '../maple/avatar-core.ts';
import type { GearIcons } from '../render/gear-icons.ts';
import { EQUIP_FOOT, EQUIP_PREVIEW, EQUIP_SLOTS, EQUIP_W, INV_COLS, INV_FOOT, INV_ROWS, INV_TABS, INV_W, WINDOW_SIZE, clampWindow, invCell } from './layout.ts';
import type { WindowName } from './layout.ts';

export interface WindowHooks {
  /** true while a run is being played (keys do nothing on the menus) */
  active(): boolean;
  sim(): Sim;
  /** the hero's look including what it wears (for the preview), or null without avatar art */
  look(): Look | null;
  name(): string;
  autoEquip(on: boolean): void;
}

const TITLES: Record<WindowName, string> = { equip: 'Equip', inventory: 'Inventory', stats: 'Character Stats' };
const KEYS: Record<string, WindowName> = { q: 'equip', i: 'inventory', c: 'stats' };

const STAT_LINES: [keyof GearStats, string][] = [
  ['str', 'STR'], ['dex', 'DEX'], ['int', 'INT'], ['luk', 'LUK'], ['pad', 'WEAPON ATTACK'], ['mad', 'MAGIC ATTACK'], ['pdd', 'WEAPON DEF.'], ['mdd', 'MAGIC DEF.'], ['mhp', 'MaxHP'], ['mmp', 'MaxMP'], ['speed', 'SPEED'],
];
const JOB_NAMES: [number, string][] = [[1, 'Warrior'], [2, 'Magician'], [4, 'Bowman'], [8, 'Thief']];

export function jobText(mask: number): string {
  if (!mask) return 'ALL CLASSES';
  const names = JOB_NAMES.filter(([b]) => mask & b).map(([, n]) => n);
  return names.length === JOB_NAMES.length ? 'ALL CLASSES' : names.join(', ').toUpperCase();
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

/** The Maple item tooltip as HTML: yellow name, REQ lines, stat list, upgrade slots and the mapped game bonus. */
export function itemTooltip(it: GearItem, sim: Sim, worn?: GearItem): string {
  const plus = plusOf(it) ? ` (+${plusOf(it)})` : '';
  const ok = (a: boolean) => (a ? 'ok' : 'bad');
  const reqJob = !it.job || !!(it.job & JOB_BIT[sim.cls.key]);
  let h = `<div class="tip-name">${esc(it.name)}${plus}</div>`;
  h += `<div class="tip-sep"></div><div class="tip-req">`;
  h += `<div class="${ok(sim.level >= it.level)}">REQ LEV : ${it.level}</div>`;
  h += `<div class="${ok(reqJob)}">${esc(jobText(it.job))}</div>`;
  h += `<div class="tip-slot">${esc(GEAR_SLOT_NAMES[it.slot].toUpperCase())}</div></div><div class="tip-sep"></div><div class="tip-stats">`;
  for (const [k, label] of STAT_LINES) {
    const v = (it.stats[k] ?? 0) + (it.up?.stats[k] ?? 0);
    if (v) h += `<div>${label} : ${k === 'speed' || v < 0 ? '' : '+'}${v}</div>`;
  }
  h += `<div>Upgrades Available : ${slotsLeft(it)}</div>`;
  h += `</div>`;
  const b = describeBonus(itemBonus(it, sim.cls.key));
  h += `<div class="tip-game">${esc(b || 'No bonus for your class')}</div>`;
  if (worn && worn !== it) {
    const d = (x: GearItem) => totalBonus([x], sim.cls.key);
    const diff = Math.round((d(it).dmg - d(worn).dmg) * 100);
    const arm = +(d(it).armor - d(worn).armor).toFixed(1);
    const parts = [diff ? `${diff > 0 ? '+' : ''}${diff}% dmg` : '', arm ? `${arm > 0 ? '+' : ''}${arm} armor` : ''].filter(Boolean);
    if (parts.length) h += `<div class="tip-cmp">vs worn: ${parts.join(' / ')}</div>`;
  }
  return h;
}

interface Win {
  name: WindowName;
  el: HTMLDivElement;
  open: boolean;
  x: number;
  y: number;
}

export class GearWindows {
  private wins = new Map<WindowName, Win>();
  private tip: HTMLDivElement;
  private z = 20;
  private lastSim: Sim | null = null;
  private seen = { gear: -1, bag: -1 };
  private slotEls = new Map<string, HTMLDivElement>();
  private cells: HTMLDivElement[] = [];
  private tab = 0;
  private tabEls: HTMLElement[] = [];
  private totalsEl!: HTMLElement;
  private autoEl!: HTMLInputElement;
  private preview!: HTMLCanvasElement;
  private previewMs = 0;
  private statsEl!: HTMLElement;
  private statsSig = '';
  private mesoEl!: HTMLElement;
  private invBody!: HTMLElement;

  constructor(parent: HTMLElement, private icons: GearIcons, private avatar: Avatar | null, private hooks: WindowHooks, autoEquip: boolean) {
    this.tip = document.createElement('div');
    this.tip.className = 'mtip';
    this.tip.style.display = 'none';
    this.buildEquip(parent);
    this.buildInventory(parent);
    this.buildStats(parent);
    parent.appendChild(this.tip);
    this.autoEl.checked = autoEquip;
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!this.hooks.active()) return;
      const w = KEYS[e.key.toLowerCase()];
      if (w) this.toggle(w);
    });
    window.addEventListener('resize', () => this.wins.forEach((w) => this.place(w, w.x, w.y)));
  }

  // ---- window shell -------------------------------------------------------------------------------------------------

  private shell(parent: HTMLElement, name: WindowName, x: number, y: number): Win {
    const [w, h] = WINDOW_SIZE[name];
    const el = document.createElement('div');
    el.className = `mwin mwin-${name}`;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.display = 'none';
    el.innerHTML = `<div class="mwin-title"><span>${TITLES[name]}</span><button class="mwin-x" title="Close"></button></div>`;
    parent.appendChild(el);
    const win: Win = { name, el, open: false, x, y };
    this.wins.set(name, win);
    el.addEventListener('pointerdown', () => { el.style.zIndex = String(++this.z); });
    el.querySelector('.mwin-x')!.addEventListener('click', () => this.set(name, false));
    // drag by the title bar
    const bar = el.querySelector<HTMLElement>('.mwin-title')!;
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const dx = e.clientX - win.x, dy = e.clientY - win.y;
      bar.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => this.place(win, m.clientX - dx, m.clientY - dy);
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    this.place(win, x, y);
    return win;
  }

  private place(win: Win, x: number, y: number) {
    const [w, h] = WINDOW_SIZE[win.name];
    const p = clampWindow(x, y, w, h, window.innerWidth, window.innerHeight);
    win.x = p.x;
    win.y = p.y;
    win.el.style.left = p.x + 'px';
    win.el.style.top = p.y + 'px';
  }

  private bindTip(el: HTMLElement, html: () => string) {
    el.addEventListener('pointerenter', (e) => {
      const h = html();
      if (!h) return;
      this.tip.innerHTML = h;
      this.tip.style.display = '';
      this.moveTip(e);
    });
    el.addEventListener('pointermove', (e) => this.moveTip(e));
    el.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
  }

  private moveTip(e: PointerEvent) {
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > window.innerWidth) x = e.clientX - w - 10;
    if (y + h > window.innerHeight) y = window.innerHeight - h - 4;
    this.tip.style.left = Math.max(0, x) + 'px';
    this.tip.style.top = Math.max(0, y) + 'px';
  }

  // ---- public ---------------------------------------------------------------------------------------------------------

  set(name: WindowName, on: boolean) {
    const w = this.wins.get(name)!;
    if (w.open === on) return;
    w.open = on;
    w.el.style.display = on ? '' : 'none';
    if (on) { w.el.style.zIndex = String(++this.z); this.seen = { gear: -1, bag: -1 }; this.statsSig = ''; }
    else this.tip.style.display = 'none';
  }

  toggle(name: WindowName) {
    this.set(name, !this.wins.get(name)!.open);
  }

  isOpen(name: WindowName) {
    return !!this.wins.get(name)?.open;
  }

  /** open windows, topmost last, with their position (bot tests) */
  list(): { name: WindowName; x: number; y: number }[] {
    return [...this.wins.values()].filter((w) => w.open).sort((a, b) => Number(a.el.style.zIndex) - Number(b.el.style.zIndex)).map((w) => ({ name: w.name, x: w.x, y: w.y }));
  }

  closeAll() {
    for (const n of this.wins.keys()) this.set(n, false);
    this.lastSim = null;
  }

  setAutoEquip(on: boolean) {
    this.autoEl.checked = on;
  }

  // ---- equip --------------------------------------------------------------------------------------------------------------

  private buildEquip(parent: HTMLElement) {
    const win = this.shell(parent, 'equip', 12, 64);
    const body = document.createElement('div');
    body.className = 'mwin-body';
    win.el.appendChild(body);
    for (const s of EQUIP_SLOTS) {
      const d = document.createElement('div');
      d.className = 'eqs empty' + (s.gear ? '' : ' show');
      d.style.left = s.x + 'px';
      d.style.top = s.y + 'px';
      d.dataset.pos = s.pos;
      d.dataset.label = s.label;
      body.appendChild(d);
      this.slotEls.set(s.pos, d);
      if (s.gear) {
        const g = s.gear;
        this.bindTip(d, () => { const it = this.hooks.sim().equipped[g]; return it ? itemTooltip(it, this.hooks.sim()) : ''; });
        d.addEventListener('dblclick', () => { if (this.hooks.active()) this.hooks.sim().unequip(g); });
        d.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.hooks.active()) this.hooks.sim().unequip(g); });
      }
    }
    this.preview = document.createElement('canvas');
    this.preview.className = 'eq-preview';
    this.preview.width = EQUIP_PREVIEW.w;
    this.preview.height = EQUIP_PREVIEW.h;
    this.preview.style.left = EQUIP_PREVIEW.x + 'px';
    this.preview.style.top = EQUIP_PREVIEW.y + 'px';
    body.appendChild(this.preview);
    const foot = document.createElement('div');
    foot.className = 'eq-foot';
    Object.assign(foot.style, { left: EQUIP_FOOT.x + 'px', top: EQUIP_FOOT.y + 'px', width: EQUIP_FOOT.w + 'px', height: EQUIP_FOOT.h + 'px' });
    foot.innerHTML = `<div class="gear-totals"></div><label class="gear-auto"><input type="checkbox"> Auto-equip upgrades</label>`;
    body.appendChild(foot);
    this.totalsEl = foot.querySelector('.gear-totals')!;
    this.autoEl = foot.querySelector('input')!;
    this.autoEl.addEventListener('change', () => this.hooks.autoEquip(this.autoEl.checked));
  }

  private refreshEquip(sim: Sim) {
    for (const s of EQUIP_SLOTS) {
      if (!s.gear) continue;
      const el = this.slotEls.get(s.pos)!;
      const it = sim.equipped[s.gear];
      el.classList.toggle('empty', !it);
      el.innerHTML = it ? `<img alt="" src="${this.icons.url(it)}">${plusOf(it) ? `<b class="plus">+${plusOf(it)}</b>` : ''}` : '';
    }
    const b = totalBonus(Object.values(sim.equipped), sim.cls.key);
    this.totalsEl.textContent = describeBonus(b) || 'Nothing equipped yet.';
  }

  private drawPreview(now: number) {
    const av = this.avatar, look = this.hooks.look();
    const cv = this.preview;
    if (now - this.previewMs < 120) return;
    this.previewMs = now;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath();
    ctx.ellipse(cv.width / 2, cv.height - 12, 26, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!av || !look) return;
    if (!av.ready(look)) { void av.ensureLook(look); return; }
    const sim = this.hooks.sim();
    const act = av.stance(look, CLASS_BY_KEY[sim.cls.key].stance).stand;
    const delays = av.timing(look, act) ?? [500];
    const f = av.frame(look, act, frameIndexAt(delays, now / 1000, true));
    if (!f) return;
    const s = 2;
    // the sprite faces left; mirror it so the hero looks into the window like in Maple's equip preview
    ctx.save();
    ctx.translate(Math.round(cv.width / 2), 0);
    ctx.scale(-1, 1);
    ctx.drawImage(f.canvas, Math.round(-f.ax * s), Math.round(cv.height - 14 - f.ay * s), f.canvas.width * s, f.canvas.height * s);
    ctx.restore();
  }

  // ---- inventory ------------------------------------------------------------------------------------------------------------

  private buildInventory(parent: HTMLElement) {
    const win = this.shell(parent, 'inventory', 12 + EQUIP_W + 10, 64);
    const body = document.createElement('div');
    body.className = 'mwin-body';
    win.el.appendChild(body);
    ['Equip', 'Use', 'Etc'].forEach((label, i) => {
      const t = document.createElement('button');
      t.className = 'invtab' + (i === 0 ? ' on' : '');
      t.dataset.tab = String(i);
      t.textContent = label;
      const r = INV_TABS[i];
      Object.assign(t.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      t.addEventListener('click', () => { this.tab = i; this.seen.bag = -1; });
      body.appendChild(t);
      this.tabEls.push(t);
    });
    this.invBody = document.createElement('div');
    this.invBody.className = 'inv-body';
    body.appendChild(this.invBody);
    for (let i = 0; i < INV_COLS * INV_ROWS; i++) {
      const c = document.createElement('div');
      c.className = 'invc';
      const p = invCell(i);
      c.style.left = p.x + 'px';
      c.style.top = p.y + 'px';
      c.dataset.i = String(i);
      this.invBody.appendChild(c);
      this.cells.push(c);
      this.bindTip(c, () => {
        const it = this.bagItem(i);
        return it ? itemTooltip(it, this.hooks.sim(), this.hooks.sim().equipped[it.slot]) : '';
      });
      c.addEventListener('dblclick', () => this.wear(i));
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.wear(i); });
    }
    const foot = document.createElement('div');
    foot.className = 'inv-foot';
    Object.assign(foot.style, { left: INV_FOOT.x + 'px', top: INV_FOOT.y + 'px', width: INV_FOOT.w + 'px', height: INV_FOOT.h + 'px' });
    foot.innerHTML = '<i class="coin"></i><span></span>';
    body.appendChild(foot);
    this.mesoEl = foot.querySelector('span')!;
  }

  private bagItem(i: number): GearItem | undefined {
    return this.tab === 0 ? this.hooks.sim().bag[i] : undefined;
  }

  private wear(i: number) {
    const it = this.bagItem(i);
    if (it && this.hooks.active()) this.hooks.sim().equipFromBag(it.id);
  }

  private refreshInventory(sim: Sim) {
    this.tabEls.forEach((t, i) => t.classList.toggle('on', i === this.tab));
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      const it = this.tab === 0 && i < BAG_SIZE ? sim.bag[i] : undefined;
      c.classList.toggle('full', !!it);
      c.innerHTML = it ? `<img alt="" src="${this.icons.url(it)}">` : '';
    }
    this.invBody.dataset.tab = String(this.tab);
    this.mesoEl.textContent = `${sim.mesos.toLocaleString('en-US')} mesos`;
    if (this.tab === 1) this.cells[0].innerHTML = '<span class="inv-note">Potions heal on pickup.</span>';
    if (this.tab === 2) this.cells[0].innerHTML = `<span class="inv-note">${sim.mesos} mesos</span>`;
  }

  // ---- stats ----------------------------------------------------------------------------------------------------------------

  private buildStats(parent: HTMLElement) {
    this.shell(parent, 'stats', 12 + EQUIP_W + INV_W + 20, 64).el.insertAdjacentHTML('beforeend', '<div class="mwin-body"><div class="stat-rows"></div></div>');
    this.statsEl = this.wins.get('stats')!.el.querySelector('.stat-rows')!;
  }

  private refreshStats(sim: Sim) {
    const job = JOB_BY_CODE[sim.jobs[sim.jobs.length - 1]]?.name ?? sim.cls.name;
    const rows: [string, string][] = [
      ['Name', this.hooks.name()],
      ['Class', job],
      ['Level', String(sim.level)],
      ['HP', `${Math.ceil(sim.hp)} / ${Math.round(sim.maxHp)}`],
      ['EXP', `${Math.floor(sim.xp)} / ${sim.xpNeed}`],
      ['Damage', `${Math.round(sim.might * 100)}%`],
      ['Armor', String(+sim.armor.toFixed(1))],
      ['Speed', `${+sim.speed.toFixed(1)} yd/s`],
      ['Crit', `${Math.round(sim.crit * 100)}%`],
      ['Magnet', `${+sim.magnet.toFixed(1)} yd`],
      ['Kills', String(sim.kills)],
      ['Mesos', String(sim.mesos)],
    ];
    const sig = rows.map((r) => r[1]).join('|');
    if (sig === this.statsSig) return;
    this.statsSig = sig;
    this.statsEl.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  }

  // ---- per frame ----------------------------------------------------------------------------------------------------------

  update(sim: Sim) {
    if (sim !== this.lastSim) {
      this.lastSim = sim;
      this.seen = { gear: -1, bag: -1 };
      this.statsSig = '';
    }
    if (this.isOpen('equip')) {
      if (this.seen.gear !== sim.gearVersion + sim.upgradeVersion) { this.seen.gear = sim.gearVersion + sim.upgradeVersion; this.refreshEquip(sim); }
      this.drawPreview(performance.now());
    }
    if (this.isOpen('inventory') && this.seen.bag !== sim.bagVersion + sim.gearVersion) { this.seen.bag = sim.bagVersion + sim.gearVersion; this.refreshInventory(sim); }
    if (this.isOpen('inventory') && this.tab === 2) this.cells[0].innerHTML = `<span class="inv-note">${sim.mesos} mesos</span>`;
    if (this.isOpen('stats')) this.refreshStats(sim);
  }
}
