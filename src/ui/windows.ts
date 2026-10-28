/**
 * MapleStory-style windows: Equip (Q), Inventory (I) and Stats (C). Draggable by the title bar, never pause the game, close with the
 * X button or the key again. The Equip window shows the hero in the middle with the 17 v83 equipment frames around it (the ones the
 * game has items for are filled, the rest stay empty), hover shows a Maple item tooltip, double-click takes an item off. The
 * Inventory lists what the hero carries but does not wear (sim.bag); double-click or right-click wears it.
 * State lives in the sim; this reads it every frame and only touches the DOM when it changed. Pixel positions: layout.ts.
 */
import { CLASS_BY_KEY, JOB_BY_CODE, armorReduction } from '../game/data.ts';
import { plusOf, slotsLeft } from '../game/scrolls.ts';
import { BAG_SIZE, GEAR_SLOT_NAMES, JOB_BIT, describeBonus, itemBonus, totalBonus } from '../game/gear.ts';
import type { GearItem, GearSlot, GearStats } from '../game/gear.ts';
import type { Sim } from '../game/sim.ts';
import type { Avatar } from '../maple/avatar.ts';
import { frameIndexAt } from '../maple/avatar.ts';
import type { Look } from '../maple/avatar-core.ts';
import type { GearIcons } from '../render/gear-icons.ts';
import { EQUIP_FOOT, EQUIP_PREVIEW, EQUIP_SLOTS, INV_COLS, INV_FOOT, INV_ROWS, INV_TABS, SLOT, WINDOW_SIZE, clampWindow, invCell } from './layout.ts';
import type { WindowName } from './layout.ts';
import { mapEquip, mapInventory } from './realwin.ts';
import type { RealEquip, RealInventory } from './realwin.ts';
import { theme } from './theme.ts';

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
  /** the cell whose tooltip a touch tap pinned */
  private pinned: HTMLElement | null = null;
  /** pointer type of the latest press: touch long-press and double-tap fire contextmenu / dblclick, which the tap-again flow replaces */
  private lastPtr = 'mouse';
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
  /** real UI.wz backgrounds with detected slot frames (null: the CSS windows are used) */
  private realEq: RealEquip | null = null;
  private realInv: RealInventory | null = null;
  private sizes: Record<WindowName, [number, number]> = { equip: [...WINDOW_SIZE.equip], inventory: [...WINDOW_SIZE.inventory], stats: [...WINDOW_SIZE.stats] };
  private equipSlots: { pos: string; label: string; gear: GearSlot | null; x: number; y: number; w: number; h: number }[] = [];

  constructor(parent: HTMLElement, private icons: GearIcons, private avatar: Avatar | null, private hooks: WindowHooks, autoEquip: boolean) {
    this.tip = document.createElement('div');
    this.tip.className = 'mtip';
    this.tip.style.display = 'none';
    const P = theme.art?.pieces ?? {};
    if (P['uiw.equip']) {
      this.realEq = mapEquip(P['uiw.equip'].rects);
      if (this.realEq) this.sizes.equip = [P['uiw.equip'].w, P['uiw.equip'].h];
    }
    if (P['uiw.item']) {
      this.realInv = mapInventory(P['uiw.item'].rects);
      if (this.realInv) this.sizes.inventory = [P['uiw.item'].w, P['uiw.item'].h];
    }
    if (P['uiw.stat']) this.sizes.stats = [P['uiw.stat'].w, P['uiw.stat'].h];
    console.info(`maple windows: equip ${this.realEq ? `real (${this.realEq.slots.length} frames)` : 'css'}, inventory ${this.realInv ? `real (${this.realInv.cells.length} cells)` : 'css'}, stats ${P['uiw.stat'] ? 'real' : 'css'}`);
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
    window.addEventListener('pointerdown', (e) => {
      this.lastPtr = e.pointerType;
      if (this.pinned && e.pointerType === 'touch' && !(e.target instanceof Node && this.pinned.contains(e.target))) this.unpin();
    }, true);
    window.addEventListener('resize', () => this.wins.forEach((w) => this.place(w, w.x, w.y)));
  }

  // ---- window shell -------------------------------------------------------------------------------------------------

  private shell(parent: HTMLElement, name: WindowName, x: number, y: number): Win {
    const [w, h] = this.sizes[name];
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

  /** Skins a window with a real UI.wz background piece. */
  private skin(win: Win, piece: string) {
    win.el.classList.add('real');
    win.el.style.backgroundImage = `url("${theme.url(piece)}")`;
  }

  private place(win: Win, x: number, y: number) {
    const [w, h] = this.sizes[win.name];
    const p = clampWindow(x, y, w, h, window.innerWidth, window.innerHeight);
    win.x = p.x;
    win.y = p.y;
    win.el.style.left = p.x + 'px';
    win.el.style.top = p.y + 'px';
  }

  /** Mouse: hover tooltip. Touch: first tap pins the tooltip and selects the cell, a second tap on it runs `act`. */
  private bindTip(el: HTMLElement, html: () => string, act?: () => void) {
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch') return;
      const h = html();
      if (!h) return;
      this.tip.innerHTML = h;
      this.tip.style.display = '';
      this.moveTip(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') this.moveTip(e); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.tip.style.display = 'none'; });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (this.pinned === el) { this.unpin(); act?.(); return; }
      this.unpin();
      const h = html();
      if (!h) return;
      this.pinned = el;
      el.classList.add('sel');
      this.tip.innerHTML = h;
      this.tip.style.display = '';
      this.pinTip(el);
    });
  }

  /** Hides a tooltip pinned by a touch tap and clears the cell's selection. */
  private unpin() {
    if (!this.pinned) return;
    this.pinned.classList.remove('sel');
    this.pinned = null;
    this.tip.style.display = 'none';
  }

  /** Puts the pinned tooltip beside the cell (right, else left), clamped to the viewport. */
  private pinTip(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    let x = r.right + 6;
    if (x + w > window.innerWidth) x = r.left - w - 6;
    const y = Math.min(r.top, window.innerHeight - h - 4);
    this.tip.style.left = Math.max(0, Math.min(x, window.innerWidth - w)) + 'px';
    this.tip.style.top = Math.max(0, y) + 'px';
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
    else { this.unpin(); this.tip.style.display = 'none'; }
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
    const real = this.realEq;
    if (real) this.skin(win, 'uiw.equip');
    this.equipSlots = real ? real.slots : EQUIP_SLOTS.map((s) => ({ ...s, w: SLOT, h: SLOT }));
    const pv = real ? real.preview : EQUIP_PREVIEW;
    for (const s of this.equipSlots) {
      const d = document.createElement('div');
      d.className = 'eqs empty' + (s.gear ? '' : ' show');
      d.style.left = s.x + 'px';
      d.style.top = s.y + 'px';
      d.style.width = s.w + 'px';
      d.style.height = s.h + 'px';
      d.dataset.pos = s.pos;
      d.dataset.label = s.label;
      body.appendChild(d);
      this.slotEls.set(s.pos, d);
      if (s.gear) {
        const g = s.gear;
        const off = () => { if (this.hooks.active()) this.hooks.sim().unequip(g); };
        this.bindTip(d, () => { const it = this.hooks.sim().equipped[g]; return it ? itemTooltip(it, this.hooks.sim()) : ''; }, off);
        d.addEventListener('dblclick', () => { if (this.lastPtr !== 'touch') off(); });
        d.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.lastPtr !== 'touch') off(); });
      }
    }
    this.preview = document.createElement('canvas');
    this.preview.className = 'eq-preview';
    this.preview.width = pv.w;
    this.preview.height = pv.h;
    this.preview.style.left = pv.x + 'px';
    this.preview.style.top = pv.y + 'px';
    body.appendChild(this.preview);
    const foot = document.createElement('div');
    foot.className = 'eq-foot';
    // the real background has no room for the totals: they hang below the window
    if (real) Object.assign(foot.style, { left: '0', top: this.sizes.equip[1] + 3 + 'px', width: this.sizes.equip[0] + 'px', height: '44px' });
    else Object.assign(foot.style, { left: EQUIP_FOOT.x + 'px', top: EQUIP_FOOT.y + 'px', width: EQUIP_FOOT.w + 'px', height: EQUIP_FOOT.h + 'px' });
    foot.innerHTML = `<div class="gear-totals"></div><label class="gear-auto"><input type="checkbox"> Auto-equip upgrades</label>`;
    body.appendChild(foot);
    this.totalsEl = foot.querySelector('.gear-totals')!;
    this.autoEl = foot.querySelector('input')!;
    this.autoEl.addEventListener('change', () => this.hooks.autoEquip(this.autoEl.checked));
  }

  private refreshEquip(sim: Sim) {
    this.unpin();
    for (const s of this.equipSlots) {
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
    const win = this.shell(parent, 'inventory', 12 + this.sizes.equip[0] + 10, 64);
    const body = document.createElement('div');
    body.className = 'mwin-body';
    win.el.appendChild(body);
    const real = this.realInv;
    if (real) this.skin(win, 'uiw.item');
    const realTabs = !!real && theme.has('item.tab.on.0') && theme.has('item.tab.off.0');
    if (realTabs) {
      // five Maple tabs (Equip, Use, Setup, Etc, Cash) above the grid; only Equip, Use and Etc are ours
      const first = real!.cells[0];
      const tw = theme.art!.pieces['item.tab.on.0'].w, th = theme.art!.pieces['item.tab.on.0'].h;
      const mine = [0, 1, -1, 2, -1];
      mine.forEach((ours, k) => {
        const t = document.createElement('button');
        t.className = 'invtab real' + (ours === 0 ? ' on' : '');
        if (ours >= 0) t.dataset.tab = String(ours);
        t.disabled = ours < 0;
        t.dataset.img = String(k);
        t.title = ['Equip', 'Use', 'Setup', 'Etc', 'Cash'][k];
        Object.assign(t.style, { left: first.x - 3 + k * tw + 'px', top: Math.max(26, first.y - th - 3) + 'px', width: tw + 'px', height: th + 'px' });
        if (ours >= 0) t.addEventListener('click', () => { this.tab = ours; this.seen.bag = -1; });
        body.appendChild(t);
        if (ours >= 0) this.tabEls.push(t);
      });
    }
    if (!realTabs) ['Equip', 'Use', 'Etc'].forEach((label, i) => {
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
    const nCells = real ? real.cells.length : INV_COLS * INV_ROWS;
    for (let i = 0; i < nCells; i++) {
      const c = document.createElement('div');
      c.className = 'invc';
      const p = real ? real.cells[i] : invCell(i);
      c.style.left = p.x + 'px';
      c.style.top = p.y + 'px';
      if (real) { c.style.width = real.cells[i].w + 'px'; c.style.height = real.cells[i].h + 'px'; }
      c.dataset.i = String(i);
      this.invBody.appendChild(c);
      this.cells.push(c);
      this.bindTip(c, () => {
        const it = this.bagItem(i);
        return it ? itemTooltip(it, this.hooks.sim(), this.hooks.sim().equipped[it.slot]) : '';
      }, () => this.wear(i));
      c.addEventListener('dblclick', () => { if (this.lastPtr !== 'touch') this.wear(i); });
      c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (this.lastPtr !== 'touch') this.wear(i); });
    }
    const foot = document.createElement('div');
    foot.className = 'inv-foot';
    if (real) Object.assign(foot.style, { left: '0', top: this.sizes.inventory[1] + 3 + 'px', width: this.sizes.inventory[0] + 'px', height: '22px' });
    else Object.assign(foot.style, { left: INV_FOOT.x + 'px', top: INV_FOOT.y + 'px', width: INV_FOOT.w + 'px', height: INV_FOOT.h + 'px' });
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
    this.unpin();
    this.tabEls.forEach((t, i) => t.classList.toggle('on', i === this.tab));
    // the real tab art: the enabled image on the open tab, the disabled one elsewhere (Setup and Cash are never open)
    this.wins.get('inventory')!.el.querySelectorAll<HTMLElement>('.invtab.real').forEach((t) => {
      const k = t.dataset.img!;
      const on = t.classList.contains('on');
      const pick = (kind: string) => (theme.has(`item.tab.${kind}.${k}`) ? `item.tab.${kind}.${k}` : `item.tab.${kind}.0`);
      t.style.backgroundImage = `url("${theme.url(pick(on ? 'on' : 'off'))}")`;
    });
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
    const win = this.shell(parent, 'stats', 12 + this.sizes.equip[0] + this.sizes.inventory[0] + 20, 64);
    if (theme.has('uiw.stat')) this.skin(win, 'uiw.stat');
    win.el.insertAdjacentHTML('beforeend', '<div class="mwin-body"><div class="stat-rows"></div></div>');
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
      ['Armor', `${+sim.armor.toFixed(1)} (-${Math.round(armorReduction(sim.armor) * 100)}% dmg)`],
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
