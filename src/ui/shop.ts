/**
 * The Henesys shop (title / character select / results): Rina's NPC shop window, in the style of the Equip and Inventory windows. One row
 * per permanent upgrade (src/game/meta.ts) with icon, name, rank pips, the next rank's effect, its price in mesos and a Buy button; the hero's
 * banked mesos sit at the bottom next to "Refund all" (two clicks, no dialog). Buying and refunding write the save at once.
 * Icons come from the same map as the level-up cards (skill / passive icons, item icons); a missing one is a plain tile. Rina's portrait is
 * the manifest's `npc` stand frame as a CSS background (no Pixi), else a silhouette.
 */
import { META, metaCost, metaSpent, buyMeta, refundMeta } from '../game/meta.ts';
import type { MetaKey } from '../game/meta.ts';
import type { NpcSection } from '../maple/items-types.ts';
import type { SaveData } from './save.ts';

/** keys of the icon map tried for each upgrade, in order (passives from Skill.wz, items from Item.wz); none: a plain tile */
const ICONS: Record<MetaKey, string[]> = {
  hp: ['improved_max_hp'], might: ['rage'], haste: ['sword_booster_fighter'], armor: ['iron_body'], speed: ['nimble_body'], magnet: ['keen_eyes'],
  growth: ['holy_symbol', 'field1'], greed: ['meso_up'], reroll: ['gacha'], banish: [], revive: ['revive'],
};
const PORTRAIT = 96;

export interface ShopHooks {
  /** the save the shop reads and changes (mesos, meta) */
  save(): SaveData;
  /** persists it */
  write(): void;
  /** the mesos or ranks changed (the menu shows the new total) */
  changed(): void;
  /** a sound cue: 'buy', 'refund' or 'deny' */
  sound(kind: 'buy' | 'refund' | 'deny'): void;
}

export class ShopPanel {
  private root: HTMLDivElement;
  private listEl: HTMLElement;
  private mesoEl: HTMLElement;
  private sayEl: HTMLElement;
  private refundBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private confirming = false;
  private rows = new Map<MetaKey, { row: HTMLElement; pips: HTMLElement; rank: HTMLElement; next: HTMLElement; price: HTMLElement; buy: HTMLButtonElement }>();

  constructor(parent: HTMLElement, private icons: Record<string, string>, npc: NpcSection | null, private hooks: ShopHooks, private base = 'maple/') {
    this.root = document.createElement('div');
    this.root.className = 'screen shop hidden';
    this.root.innerHTML = `<div class="mwin mwin-shop">
      <div class="mwin-title"><span>Henesys Shop</span><button class="mwin-x" title="Close"></button></div>
      <div class="mwin-surface">
        <div class="shop-body">
          <div class="shop-npc"><div class="shop-portrait"></div><b>Rina</b><i>Henesys</i><p class="shop-say"></p></div>
          <div class="shop-list"></div>
        </div>
        <div class="shop-foot"><span class="shop-mesos"></span><span class="shop-refund-row"><button class="shop-btn shop-refund">Refund all</button><button class="shop-btn shop-cancel">Cancel</button></span></div>
      </div>
    </div>`;
    this.listEl = this.root.querySelector('.shop-list')!;
    this.mesoEl = this.root.querySelector('.shop-mesos')!;
    this.sayEl = this.root.querySelector('.shop-say')!;
    this.refundBtn = this.root.querySelector('.shop-refund')!;
    this.cancelBtn = this.root.querySelector('.shop-cancel')!;
    this.buildPortrait(this.root.querySelector('.shop-portrait')!, npc);
    for (const d of META) this.buildRow(d.key);
    this.root.querySelector('.mwin-x')!.addEventListener('click', () => this.hide());
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.hide(); });
    this.refundBtn.addEventListener('click', () => this.refund());
    this.cancelBtn.addEventListener('click', () => { this.confirming = false; this.say('Changed your mind? Good choice.'); this.render(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.visible) this.hide(); });
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
    this.confirming = false;
  }

  show() {
    this.confirming = false;
    this.say('Welcome to Henesys! Whatever you buy here stays with you for good.');
    this.render();
    this.root.classList.remove('hidden');
  }

  private say(text: string) {
    this.sayEl.textContent = text;
  }

  private buildPortrait(el: HTMLElement, npc: NpcSection | null) {
    const f = npc?.frames.find((x) => x.action === 'stand' && x.index === 0) ?? npc?.frames[0];
    if (!npc || !f) {
      el.classList.add('silhouette');
      return;
    }
    // the sprite is scaled to fit the frame and stands on its bottom edge
    const k = Math.min(2, (PORTRAIT - 8) / Math.max(f.w, f.h));
    const sprite = document.createElement('div');
    sprite.className = 'shop-sprite';
    sprite.style.cssText = `width:${f.w}px;height:${f.h}px;background:url("${this.base + npc.atlas}") -${f.x}px -${f.y}px;transform:translate(-50%,0) scale(${k.toFixed(3)})`;
    el.appendChild(sprite);
  }

  private iconUrl(key: MetaKey): string {
    for (const k of ICONS[key]) if (this.icons[k]) return this.icons[k];
    return '';
  }

  private buildRow(key: MetaKey) {
    const d = META.find((x) => x.key === key)!;
    const row = document.createElement('div');
    row.className = 'shop-row';
    const url = this.iconUrl(key);
    row.innerHTML = `<div class="shop-icon">${url ? `<img src="${url}" alt="">` : `<span>${d.name[0]}</span>`}</div>
      <div class="shop-info"><b>${d.name}</b><div class="shop-rank"><span class="shop-pips"></span><span class="shop-rk"></span></div><em class="shop-next"></em></div>
      <div class="shop-buycol"><span class="shop-price"></span><button class="shop-btn shop-buy">Buy</button></div>`;
    const q = <T extends HTMLElement>(s: string) => row.querySelector<T>(s)!;
    const pips = q('.shop-pips');
    for (let i = 0; i < d.max; i++) pips.appendChild(document.createElement('i'));
    const buy = q<HTMLButtonElement>('.shop-buy');
    buy.addEventListener('click', () => this.buy(key));
    this.rows.set(key, { row, pips, rank: q('.shop-rk'), next: q('.shop-next'), price: q('.shop-price'), buy });
    this.listEl.appendChild(row);
  }

  private buy(key: MetaKey) {
    const s = this.hooks.save();
    const r = buyMeta(s.mesos, s.meta, key);
    if (!r) {
      this.hooks.sound('deny');
      this.say(s.meta[key] >= META.find((d) => d.key === key)!.max ? 'That one is fully upgraded already.' : 'You need more mesos for that.');
      return;
    }
    s.mesos = r.mesos;
    s.meta = r.ranks;
    this.hooks.write();
    this.hooks.changed();
    this.hooks.sound('buy');
    this.say('Thank you! Good luck out there.');
    this.render();
  }

  /** Refund all: the first click asks, the second gives every meso spent back. */
  private refund() {
    const s = this.hooks.save();
    const spent = metaSpent(s.meta);
    if (spent <= 0) {
      this.say('You have not bought anything yet.');
      return;
    }
    if (!this.confirming) {
      this.confirming = true;
      this.say(`Give everything back for ${spent} mesos?`);
      this.render();
      return;
    }
    const r = refundMeta(s.mesos, s.meta);
    s.mesos = r.mesos;
    s.meta = r.ranks;
    this.confirming = false;
    this.hooks.write();
    this.hooks.changed();
    this.hooks.sound('refund');
    this.say(`Here are your ${spent} mesos. Come again!`);
    this.render();
  }

  private render() {
    const s = this.hooks.save();
    this.mesoEl.innerHTML = `<span class="shop-coin"></span>Mesos <b>${s.mesos}</b>`;
    for (const d of META) {
      const r = this.rows.get(d.key)!;
      const have = s.meta[d.key];
      const maxed = have >= d.max;
      const cost = maxed ? 0 : metaCost(d.key, have);
      r.row.classList.toggle('maxed', maxed);
      r.row.classList.toggle('poor', !maxed && s.mesos < cost);
      [...r.pips.children].forEach((p, i) => p.classList.toggle('on', i < have));
      r.rank.textContent = d.max === 1 ? (have ? 'Owned' : 'Not owned') : `Rank ${have}/${d.max}`;
      r.next.textContent = maxed ? d.text(have) : have ? `Next: ${d.text(have + 1)}` : `Rank 1: ${d.text(1)}`;
      r.price.textContent = maxed ? 'MAX' : `${cost} mesos`;
      r.buy.disabled = maxed || s.mesos < cost;
      r.buy.textContent = maxed ? 'Maxed' : 'Buy';
    }
    const spent = metaSpent(s.meta);
    this.refundBtn.disabled = spent <= 0;
    this.refundBtn.textContent = this.confirming ? `Yes, refund ${spent}` : 'Refund all';
    this.refundBtn.classList.toggle('confirm', this.confirming);
    this.cancelBtn.classList.toggle('hidden', !this.confirming);
  }
}
