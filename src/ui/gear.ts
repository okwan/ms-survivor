/**
 * Gear UI: the "Equipped X" / "press E to equip" toast and the E key; the Equip / Inventory / Stats windows live in windows.ts. Nothing here pauses
 * the game. State lives in the sim (src/game/gear.ts and sim.equipped); this reads it every frame and only touches the DOM on change.
 */
import { GEAR_SLOTS, describeBonus, itemBonus } from '../game/gear.ts';
import type { GearItem } from '../game/gear.ts';
import type { Sim } from '../game/sim.ts';
import type { Avatar } from '../maple/avatar.ts';
import type { Look, LookGear } from '../maple/avatar-core.ts';
import type { GearIcons } from '../render/gear-icons.ts';
import { GearWindows } from './windows.ts';

export interface GearUiHooks {
  /** true while a run is being played (keys do nothing on the menus) */
  active(): boolean;
  /** the "Auto-equip upgrades" checkbox changed */
  autoEquip(on: boolean): void;
  /** the sim to read; it is replaced on every run */
  sim(): Sim;
  /** the hero's look with what it wears (equip window preview) and its name */
  look(): Look | null;
  name(): string;
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
  readonly windows: GearWindows;
  private toastSeq = -1;
  private lastSim: Sim | null = null;

  constructor(parent: HTMLElement, private icons: GearIcons, private hooks: GearUiHooks, autoEquip: boolean, avatar: Avatar | null = null) {
    this.toast = document.createElement('div');
    this.toast.className = 'gear-toast';
    this.toast.style.display = 'none';
    this.toast.addEventListener('click', () => this.equipOffer());
    parent.appendChild(this.toast);
    this.windows = new GearWindows(parent, icons, avatar, hooks, autoEquip);

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (!this.hooks.active()) return;
      if (e.key.toLowerCase() === 'e') this.equipOffer();
    });
  }

  setAutoEquip(on: boolean) {
    this.windows.setAutoEquip(on);
  }

  /** Q: the equip window (kept for callers of the old API) */
  toggle(on: boolean) {
    this.windows.set('equip', on);
  }

  /** a new run: close the windows and forget the old toast */
  reset() {
    this.windows.closeAll();
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
    this.windows.update(sim);
  }
}
