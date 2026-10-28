/**
 * Gear UI: the "Equipped X" / "press E to equip" toast, the equip window (Q, like MapleStory's) and the E key. Nothing here pauses
 * the game. State lives in the sim (src/game/gear.ts and sim.equipped); this reads it every frame and only touches the DOM on change.
 */
import { GEAR_SLOTS, GEAR_SLOT_NAMES, describeBonus, itemBonus, totalBonus } from '../game/gear.ts';
import type { GearItem, GearSlot } from '../game/gear.ts';
import { plusOf, slotsLeft } from '../game/scrolls.ts';
import type { Sim } from '../game/sim.ts';
import type { LookGear } from '../maple/avatar-core.ts';
import type { GearIcons } from '../render/gear-icons.ts';

export interface GearUiHooks {
  /** true while a run is being played (keys do nothing on the menus) */
  active(): boolean;
  /** the "Auto-equip upgrades" checkbox changed */
  autoEquip(on: boolean): void;
  /** the sim to read; it is replaced on every run */
  sim(): Sim;
}

/** What the hero wears, as the avatar's look overlay. */
export function lookGearOf(sim: Sim): LookGear {
  const g: LookGear = {};
  for (const s of GEAR_SLOTS) {
    const it = sim.equipped[s];
    if (it) g[s] = it.id;
  }
  g.longcoat = !!sim.equipped.coat?.long;
  return g;
}

export class GearUi {
  private toast: HTMLDivElement;
  private win: HTMLDivElement;
  private slotEls = new Map<GearSlot, HTMLDivElement>();
  private totalsEl: HTMLElement;
  private autoEl: HTMLInputElement;
  private open = false;
  private toastSeq = -1;
  private winVersion = -1;
  private lastSim: Sim | null = null;

  constructor(parent: HTMLElement, private icons: GearIcons, private hooks: GearUiHooks, autoEquip: boolean) {
    this.toast = document.createElement('div');
    this.toast.className = 'gear-toast';
    this.toast.style.display = 'none';
    this.toast.addEventListener('click', () => this.equipOffer());
    this.win = document.createElement('div');
    this.win.className = 'gear-win win';
    this.win.style.display = 'none';
    this.win.innerHTML = `<div class="win-head">Equip <button class="gear-x" title="Close (Q)">x</button></div>
      <div class="win-body"><div class="gear-grid"></div><div class="gear-totals"></div>
      <label class="gear-auto"><input type="checkbox"> Auto-equip upgrades</label>
      <div class="hint">Q: this window. E: equip the item offered by the toast. The game keeps running.</div></div>`;
    const grid = this.win.querySelector('.gear-grid')!;
    for (const s of GEAR_SLOTS) {
      const d = document.createElement('div');
      d.className = 'gear-slot empty';
      d.dataset.slot = s;
      grid.appendChild(d);
      this.slotEls.set(s, d);
    }
    this.totalsEl = this.win.querySelector('.gear-totals')!;
    this.autoEl = this.win.querySelector('input')!;
    this.autoEl.checked = autoEquip;
    this.autoEl.addEventListener('change', () => this.hooks.autoEquip(this.autoEl.checked));
    this.win.querySelector('.gear-x')!.addEventListener('click', () => this.toggle(false));
    parent.append(this.toast, this.win);

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!this.hooks.active()) return;
      const k = e.key.toLowerCase();
      if (k === 'q') this.toggle(!this.open);
      else if (k === 'e') this.equipOffer();
    });
  }

  setAutoEquip(on: boolean) {
    this.autoEl.checked = on;
  }

  toggle(on: boolean) {
    this.open = on;
    this.win.style.display = on ? '' : 'none';
    this.winVersion = -1;
  }

  /** a new run: close the window and forget the old toast */
  reset() {
    this.toggle(false);
    this.toast.style.display = 'none';
    this.toastSeq = -1;
    this.lastSim = null;
  }

  private equipOffer() {
    if (this.hooks.active()) this.hooks.sim().equipOffer();
  }

  private statLine(it: GearItem, sim: Sim) {
    return describeBonus(itemBonus(it, sim.cls.key));
  }

  update(sim: Sim) {
    if (sim !== this.lastSim) {
      this.lastSim = sim;
      this.toastSeq = -1;
      this.winVersion = -1;
    }
    // toast: shown while its time lasts; an offer disappears once taken (gearOffer cleared) or expired
    const tt = sim.gearToast;
    let show = false;
    if (tt) {
      show = sim.t < tt.until && (tt.kind === 'equipped' || sim.gearOffer?.item === tt.item);
      if (show && tt.seq !== this.toastSeq) {
        this.toastSeq = tt.seq;
        const line = this.statLine(tt.item, sim);
        this.toast.className = `gear-toast ${tt.kind}`;
        this.toast.innerHTML = `<img alt="" src="${this.icons.url(tt.item)}"><span><b></b><em></em></span>`;
        this.toast.querySelector('b')!.textContent = tt.kind === 'equipped' ? `Equipped ${tt.item.name}` : tt.item.name;
        this.toast.querySelector('em')!.textContent = tt.kind === 'equipped' ? line : `${line || 'no bonus'} - press E to equip`;
      }
    }
    this.toast.style.display = show ? '' : 'none';

    if (this.open && this.winVersion !== sim.gearVersion + sim.upgradeVersion) {
      this.winVersion = sim.gearVersion + sim.upgradeVersion;
      for (const s of GEAR_SLOTS) {
        const el = this.slotEls.get(s)!;
        const it = sim.equipped[s];
        el.classList.toggle('empty', !it);
        el.title = it ? `${it.name}${plusOf(it) ? ` +${plusOf(it)}` : ''} (Lv ${it.level}) ${this.statLine(it, sim)} - ${slotsLeft(it)} upgrade slots left` : GEAR_SLOT_NAMES[s];
        el.innerHTML = it ? `<img alt="" src="${this.icons.url(it)}">${plusOf(it) ? `<b class="plus">+${plusOf(it)}</b>` : ''}` : '';
        el.dataset.name = GEAR_SLOT_NAMES[s];
      }
      const b = totalBonus(Object.values(sim.equipped), sim.cls.key);
      this.totalsEl.textContent = describeBonus(b) || 'Nothing equipped yet.';
    }
  }
}
