/**
 * Icons of droppable gear: cut from the extractor's icon atlas (maple/avatar/gear-icons.png) into small canvases, as data URLs for
 * the DOM windows and as glowing Pixi textures for the pickups on the ground. Items without an icon (placeholder pool, or no
 * info/icon) get a coloured square with the slot's letter, so drops stay visible without any extracted art.
 */
import { ImageSource, Texture } from 'pixi.js';
import { GEAR_SLOTS } from '../game/gear.ts';
import type { GearItem, GearManifest, GearSlot } from '../game/gear.ts';

const SLOT_COLOR: Record<GearSlot, string> = { cap: '#e8b04a', coat: '#d8584a', pants: '#4a78d8', shoes: '#8a6a4a', glove: '#d86aa8', cape: '#9a58d8', shield: '#5ab8a8', weapon: '#c8d0e0' };
const SLOT_LETTER: Record<GearSlot, string> = { cap: 'C', coat: 'T', pants: 'B', shoes: 'S', glove: 'G', cape: 'P', shield: 'D', weapon: 'W' };
const SIZE = 36;
const GLOW = 52;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class GearIcons {
  private atlas: HTMLImageElement | null = null;
  private man: GearManifest | null;
  private urls = new Map<string, string>();
  private texs = new Map<string, Texture>();

  constructor(man: GearManifest | null, private base = 'maple/') {
    this.man = man;
  }

  /** Loads the atlas (if any). Never rejects; icons fall back to coloured squares. */
  async load(): Promise<void> {
    if (this.man?.iconAtlas) this.atlas = await loadImage(this.base + this.man.iconAtlas);
  }

  /** The icon centred on a SIZE x SIZE canvas (no glow). */
  private draw(it: GearItem, size: number, glow: boolean): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const mid = size / 2;
    if (glow) {
      const grad = g.createRadialGradient(mid, mid, 2, mid, mid, mid);
      grad.addColorStop(0, 'rgba(255,236,140,0.85)');
      grad.addColorStop(1, 'rgba(255,236,140,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    const e = this.man?.items[it.id]?.icon;
    if (this.atlas && e && e.w > 0) {
      const k = Math.min(1, (SIZE - 4) / Math.max(e.w, e.h));
      const w = Math.round(e.w * k);
      const h = Math.round(e.h * k);
      g.drawImage(this.atlas, e.x, e.y, e.w, e.h, Math.round(mid - w / 2), Math.round(mid - h / 2), w, h);
    } else {
      const s = SIZE - 10;
      g.fillStyle = SLOT_COLOR[it.slot];
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect(mid - s / 2, mid - s / 2, s, s, 5);
      g.fill();
      g.stroke();
      g.fillStyle = '#1a2036';
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(SLOT_LETTER[it.slot], mid, mid + 1);
    }
    return c;
  }

  /** data URL for <img> (cached) */
  url(it: GearItem): string {
    let u = this.urls.get(it.id);
    if (u === undefined) {
      u = this.draw(it, SIZE, false).toDataURL();
      this.urls.set(it.id, u);
    }
    return u;
  }

  /** glowing texture for a ground pickup (cached) */
  texture(it: GearItem): Texture {
    let t = this.texs.get(it.id);
    if (!t) {
      t = new Texture({ source: new ImageSource({ resource: this.draw(it, GLOW, true), scaleMode: 'nearest' }) });
      this.texs.set(it.id, t);
    }
    return t;
  }

  /** an empty-slot placeholder for the equip window */
  static slotLetter(s: GearSlot): string {
    return SLOT_LETTER[s];
  }
  static readonly slots = GEAR_SLOTS;
}
