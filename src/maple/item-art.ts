/**
 * Pixi-side loader for the item art the deploy-time step wrote (manifest `items`, scripts/fetch-maple-items.ts): potion / elixir /
 * meso pickup art, scroll icons, the pet's animations and the enchant effect. Everything is optional; an empty ItemArt (no manifest)
 * answers null for every lookup and the renderer keeps its placeholder pickups. Placeholder textures for scrolls and the pet are
 * drawn here so that those still show without extracted art.
 */
import { ImageSource, Texture } from 'pixi.js';
import type { ScrollDef } from '../game/scrolls.ts';
import { makeAnim } from './art.ts';
import type { Anim } from './art.ts';
import type { MapleManifest } from './assets.ts';
import type { ItemIconKeys } from './items-types.ts';

export interface PetArt {
  name: string;
  stand: Anim | null;
  move: Anim | null;
  jump: Anim | null;
}

const SCROLL_SIZE = 40;
const ROLE_NAMES: Record<string, string> = {
  potionRed: 'potion.red', potionOrange: 'potion.orange', potionWhite: 'potion.white', elixir: 'elixir', elixirPower: 'elixir.power',
  mesoBronze: 'meso.bronze', mesoGold: 'meso.gold', mesoBundle: 'meso.bundle', mesoBag: 'meso.bag', gacha: 'gacha',
  fieldApple: 'field.apple', fieldCoupon: 'field.coupon', fieldElixir: 'field.elixir', fieldClock: 'field.clock', fieldKeg: 'field.keg',
};
const FIELD_ROLES = ['fieldApple', 'fieldCoupon', 'fieldElixir', 'fieldClock', 'fieldKeg'] as const;

export class ItemArt {
  /** icon keys that loaded, for the bot hook: 'potion.red', 'meso.bronze', 'scroll.2040000', 'pet.move', 'enchant.success' ... */
  keys: string[] = [];
  private icons = new Map<string, Anim>();
  private scrollIcons = new Map<string, Anim>();
  private roles: ItemIconKeys = {};
  pet: PetArt | null = null;
  enchantSuccess: Anim | null = null;
  enchantFailure: Anim | null = null;
  private scrollTexs = new Map<string, Texture>();
  private fallbackScroll: Texture | null = null;
  private fallbackPet: Texture | null = null;

  /** @internal filled by buildItemArt */
  setIcons(roles: ItemIconKeys, icons: Map<string, Anim>, scrollIcons: Map<string, Anim>) {
    this.roles = roles;
    this.icons = icons;
    this.scrollIcons = scrollIcons;
  }

  private role(k: keyof ItemIconKeys): Anim | null {
    const id = this.roles[k];
    return (id && this.icons.get(id)) || null;
  }

  /** Red Potion, or White Potion for a bigger heal */
  potion(value: number): Texture | null {
    const a = (value >= 0.5 ? this.role('potionWhite') : null) ?? this.role('potionRed') ?? this.role('potionOrange');
    return a?.tex[0] ?? null;
  }
  /** Power Elixir (the Elixir when that is all there is) */
  elixir(): Texture | null {
    return (this.role('elixirPower') ?? this.role('elixir'))?.tex[0] ?? null;
  }
  /** meso coin by value (bronze for small piles, gold from 4 up); animated */
  meso(value: number): Anim | null {
    return (value >= 4 ? this.role('mesoGold') ?? this.role('mesoBronze') : this.role('mesoBronze') ?? this.role('mesoGold')) ?? null;
  }
  bag(): Anim | null {
    return this.role('mesoBag') ?? this.role('mesoBundle');
  }
  /** Gachapon Ticket icon for the boss capsule (null: the renderer draws a two-colour ball) */
  gacha(): Texture | null {
    return this.role('gacha')?.tex[0] ?? null;
  }
  /** Icon of field item n (Apple, Coupon, Elixir, Clock, Keg), null when it was not extracted (the renderer draws a placeholder) */
  field(n: number): Texture | null {
    return this.role(FIELD_ROLES[n])?.tex[0] ?? null;
  }
  /** The field item icon as a data URL for the HUD buff chips (null without the art) */
  fieldUrl(n: number): string | null {
    return this.urlOf(this.field(n));
  }
  /** The same icon as a data URL for the DOM reveal panel (null without the art) */
  gachaUrl(): string | null {
    return this.urlOf(this.gacha());
  }
  private urlOf(t: Texture | null): string | null {
    const src = t?.source.resource as CanvasImageSource | undefined;
    if (!t || !src) return null;
    try {
      const f = t.frame;
      const c = document.createElement('canvas');
      c.width = f.width; c.height = f.height;
      c.getContext('2d')!.drawImage(src, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
      return c.toDataURL();
    } catch {
      return null;
    }
  }

  /** Glowing texture for a scroll lying on the ground (cached); its own icon when extracted, else a drawn scroll. */
  scrollTexture(d: ScrollDef): Texture {
    let t = this.scrollTexs.get(d.id);
    if (!t) {
      const icon = this.scrollIcons.get(d.id);
      t = new Texture({ source: new ImageSource({ resource: drawScroll(icon ? icon.tex[0] : null), scaleMode: 'nearest' }) });
      this.scrollTexs.set(d.id, t);
    }
    return t;
  }

  /** The drawn scroll, for the pickup of a scroll without an icon of its own. */
  placeholderScroll(): Texture {
    return (this.fallbackScroll ??= new Texture({ source: new ImageSource({ resource: drawScroll(null), scaleMode: 'nearest' }) }));
  }

  /** A small orange cat (faces left like the extracted sprites) for play without the pet's art. */
  placeholderPet(): Texture {
    if (!this.fallbackPet) {
      const c = document.createElement('canvas');
      c.width = 40; c.height = 34;
      const g = c.getContext('2d')!;
      g.fillStyle = '#e8923c';
      g.strokeStyle = '#7a4010';
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(20, 22, 13, 9, 0, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(11, 14, 8, 7, 0, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(5, 9); g.lineTo(6, 2); g.lineTo(11, 8); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(12, 8); g.lineTo(17, 2); g.lineTo(17, 10); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#222';
      g.fillRect(7, 13, 2, 3); g.fillRect(13, 13, 2, 3);
      g.strokeStyle = '#e8923c'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(32, 20); g.quadraticCurveTo(40, 14, 36, 8); g.stroke();
      this.fallbackPet = new Texture({ source: new ImageSource({ resource: c, scaleMode: 'nearest' }) });
    }
    return this.fallbackPet;
  }
}

/** A scroll icon (or a drawn parchment roll) centred on a canvas with a soft glow, like the gear drops. */
function drawScroll(icon: Texture | null): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SCROLL_SIZE;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const mid = SCROLL_SIZE / 2;
  const grad = g.createRadialGradient(mid, mid, 2, mid, mid, mid);
  grad.addColorStop(0, 'rgba(160,230,255,0.8)');
  grad.addColorStop(1, 'rgba(160,230,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, SCROLL_SIZE, SCROLL_SIZE);
  const src = icon?.source.resource as CanvasImageSource | undefined;
  if (icon && src) {
    const f = icon.frame;
    const k = Math.min(1, (SCROLL_SIZE - 6) / Math.max(f.width, f.height));
    const w = Math.round(f.width * k), h = Math.round(f.height * k);
    g.drawImage(src, f.x, f.y, f.width, f.height, Math.round(mid - w / 2), Math.round(mid - h / 2), w, h);
  } else {
    g.fillStyle = '#f3e3b0';
    g.strokeStyle = '#8a6a30';
    g.lineWidth = 2;
    g.beginPath(); g.roundRect(mid - 9, mid - 12, 18, 24, 3); g.fill(); g.stroke();
    g.fillStyle = '#b84a3a';
    g.fillRect(mid - 11, mid - 4, 22, 5);
    g.strokeStyle = '#8a6a30'; g.lineWidth = 1;
    for (const y of [-8, 8]) { g.beginPath(); g.moveTo(mid - 5, mid + y); g.lineTo(mid + 5, mid + y); g.stroke(); }
  }
  return c;
}

/** Never throws; whatever fails to load stays absent. Null when the manifest has no items section. */
export async function buildItemArt(m: MapleManifest, _base: string, atlas: (path: string) => Promise<ImageSource | null>): Promise<ItemArt | null> {
  const sec = m.items;
  if (!sec) return null;
  const art = new ItemArt();
  try {
    if (sec.icons && sec.keys) {
      const src = await atlas(sec.icons.atlas);
      if (src) {
        const icons = new Map<string, Anim>();
        const ids = new Set(sec.icons.frames.map((f) => f.action));
        for (const id of ids) {
          const a = makeAnim(src, sec.icons.frames, id);
          if (a) icons.set(id, a);
        }
        const scrolls = new Map<string, Anim>();
        for (const sid of Object.keys(sec.scrolls ?? {})) {
          const a = icons.get(sid.padStart(8, '0'));
          if (a) { scrolls.set(sid, a); art.keys.push(`scroll.${sid}`); }
        }
        art.setIcons(sec.keys, icons, scrolls);
        for (const [role, id] of Object.entries(sec.keys)) if (icons.has(id as string)) art.keys.push(ROLE_NAMES[role] ?? role);
      }
    }
  } catch {
    /* placeholder pickups stay */
  }
  try {
    const p = sec.pet;
    if (p) {
      const src = await atlas(p.atlas);
      if (src) {
        const pet: PetArt = { name: p.name || 'Brown Kitty', stand: makeAnim(src, p.frames, 'stand0'), move: makeAnim(src, p.frames, 'move'), jump: makeAnim(src, p.frames, 'jump') };
        if (pet.stand || pet.move) {
          art.pet = pet;
          for (const k of ['stand', 'move', 'jump'] as const) if (pet[k]) art.keys.push(`pet.${k}`);
        }
      }
    }
  } catch {
    /* the drawn cat stays */
  }
  try {
    const e = sec.enchant;
    if (e) {
      const src = await atlas(e.atlas);
      if (src) {
        art.enchantSuccess = makeAnim(src, e.frames, 'success');
        art.enchantFailure = makeAnim(src, e.frames, 'failure');
        if (art.enchantSuccess) art.keys.push('enchant.success');
        if (art.enchantFailure) art.keys.push('enchant.failure');
      }
    }
  } catch {
    /* a plain flash stays */
  }
  return art;
}
