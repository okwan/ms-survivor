/**
 * Map decorations from Map.wz (trees, bushes, flowers, signs...) scattered on a hashed grid at native pixel size.
 * They live in their own layer under pickups and entities and never block anything. Pooled sprites, no per-frame allocation.
 */
import { Container, Sprite } from 'pixi.js';
import { frameAt } from '../maple/art.ts';
import type { MapArt } from '../maple/art.ts';

const CELL = 250; // px
const CHANCE = 0.5;
const MAX_SPRITES = 260;

function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class DecorLayer {
  readonly layer = new Container();
  private sprites: Sprite[] = [];
  private cum: number[] = [];
  private totalW = 0;
  private art: MapArt;

  constructor(art: MapArt) {
    this.art = art;
    this.layer.sortableChildren = true;
    // softened weights, so one very common object (a lamp, a fence) does not drown the trees
    for (const o of art.objects) {
      this.totalW += Math.sqrt(o.weight);
      this.cum.push(this.totalW);
    }
    for (let i = 0; i < MAX_SPRITES; i++) {
      const s = new Sprite();
      s.visible = false;
      this.layer.addChild(s);
      this.sprites.push(s);
    }
  }

  /** camX/camY: world pixel under the screen centre; w/h: screen size in px; zoom: world scale. */
  update(camX: number, camY: number, zoom: number, time: number, w: number, h: number) {
    const art = this.art;
    const halfW = w / 2 / zoom, halfH = h / 2 / zoom;
    // an object is anchored at its foot and reaches up by maxH and sideways by maxW / 2
    const cx0 = Math.floor((camX - halfW - art.maxW / 2) / CELL), cx1 = Math.floor((camX + halfW + art.maxW / 2) / CELL);
    const cy0 = Math.floor((camY - halfH) / CELL), cy1 = Math.floor((camY + halfH + art.maxH) / CELL);
    let n = 0;
    for (let cy = cy0; cy <= cy1 && n < MAX_SPRITES; cy++) {
      for (let cx = cx0; cx <= cx1 && n < MAX_SPRITES; cx++) {
        const hs = hash2(cx, cy);
        if (hs > CHANCE) continue;
        const pick = hash2(cx + 17, cy + 31) * this.totalW;
        let k = 0;
        while (k < this.cum.length - 1 && pick > this.cum[k]) k++;
        const o = art.objects[k];
        const s = this.sprites[n++];
        const i = o.anim.tex.length > 1 ? frameAt(o.anim, time + hash2(cx + 5, cy + 9) * o.anim.total) : 0;
        const t = o.anim.tex[i];
        if (s.texture !== t) s.texture = t;
        s.anchor.set(o.anim.ax[i], o.anim.ay[i]);
        const gx = (cx + 0.1 + hash2(cx + 91, cy) * 0.8) * CELL;
        const gy = (cy + 0.1 + hash2(cx, cy + 57) * 0.8) * CELL;
        s.position.set(gx, gy);
        s.zIndex = gy;
        s.visible = true;
      }
    }
    for (; n < MAX_SPRITES; n++) this.sprites[n].visible = false;
  }
}
