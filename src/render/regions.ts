/**
 * Region scenery: the tiled ground and the clustered nature decor of the current region, cross-faded over FADE seconds when the
 * region changes. Two slots (front = the region being shown, back = the one fading out) each own a TilingSprite and a pool of decor
 * sprites, so a fade never allocates. Layout rules live in cluster.ts.
 */
import { Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { frameAt } from '../maple/art.ts';
import type { RegionArt } from '../maple/region-art.ts';
import { FADE, advanceFade, fadeView } from './fade.ts';
import { BIG, CLUSTER_CELL, MEDIUM, Placements, SMALL, TUFT_CELL, clusterAt, hash3, tuftAt } from './cluster.ts';

export { FADE };
const MAX_SPRITES = 360;
const SAT_MAX = 130;

/** Pooled decor sprites of one region. */
class RegionDecor {
  readonly layer = new Container();
  private sprites: Sprite[] = [];
  private pl = new Placements();
  private tu = new Placements();
  private scratch = new Placements();
  art: RegionArt | null = null;

  constructor() {
    this.layer.sortableChildren = true;
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
    let n = 0;
    if (art && (art.have.big || art.have.medium || art.have.small)) {
      const halfW = w / 2 / zoom + art.maxW / 2 + 8, halfH = h / 2 / zoom;
      const x0 = camX - halfW, x1 = camX + halfW, y0 = camY - halfH, y1 = camY + halfH + art.maxH + 8;
      const salt = art.index;
      const cx0 = Math.floor((x0 - SAT_MAX) / CLUSTER_CELL), cx1 = Math.floor((x1 + SAT_MAX) / CLUSTER_CELL);
      const cy0 = Math.floor((y0 - SAT_MAX) / CLUSTER_CELL), cy1 = Math.floor((y1 + SAT_MAX) / CLUSTER_CELL);
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          clusterAt(cx, cy, salt, art.have, this.pl);
          n = this.put(this.pl, n, art, salt, time, x0, x1, y0, y1);
        }
      const tuftCls = art.have.small ? SMALL : art.have.medium ? MEDIUM : BIG;
      const tx0 = Math.floor(x0 / TUFT_CELL), tx1 = Math.floor(x1 / TUFT_CELL);
      const ty0 = Math.floor(y0 / TUFT_CELL), ty1 = Math.floor(y1 / TUFT_CELL);
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          tuftAt(tx, ty, salt, tuftCls, this.tu, this.scratch);
          n = this.put(this.tu, n, art, salt, time, x0, x1, y0, y1);
        }
    }
    for (; n < MAX_SPRITES; n++) {
      if (!this.sprites[n].visible) break; // everything after the first hidden sprite was hidden last frame too
      this.sprites[n].visible = false;
    }
  }

  private put(pl: Placements, n: number, art: RegionArt, salt: number, time: number, x0: number, x1: number, y0: number, y1: number): number {
    for (let i = 0; i < pl.n && n < MAX_SPRITES; i++) {
      const x = pl.x[i], y = pl.y[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      let pool = art.bySize[pl.cls[i]];
      if (!pool.length) pool = art.bySize[art.have.big ? BIG : art.have.medium ? MEDIUM : SMALL];
      const o = pool[Math.min(pool.length - 1, Math.floor(pl.pick[i] * pool.length))];
      const s = this.sprites[n++];
      const f = o.anim.tex.length > 1 ? frameAt(o.anim, time + hash3(Math.floor(x), Math.floor(y), salt) * o.anim.total) : 0;
      const t = o.anim.tex[f];
      if (s.texture !== t) s.texture = t;
      s.anchor.set(o.anim.ax[f], o.anim.ay[f]);
      s.position.set(x, y);
      s.zIndex = y;
      s.visible = true;
    }
    return n;
  }
}

interface Slot {
  ground: TilingSprite;
  decor: RegionDecor;
  region: number;
}

export class RegionScenery {
  /** goes on the stage below the world */
  readonly groundLayer = new Container();
  /** goes into the world container, under entities */
  readonly decorLayer = new Container();
  private slots: [Slot, Slot];
  private front = 0;
  private cur = -1;
  private fade = 1;
  private regions: RegionArt[];
  private fallback: Texture;
  private fallbackColor: number;
  private setBackground: (c: number) => void;
  private bgColor = -1;

  constructor(regions: RegionArt[], fallback: Texture, fallbackColor: number, setBackground: (color: number) => void) {
    this.regions = regions;
    this.fallback = fallback;
    this.fallbackColor = fallbackColor;
    this.setBackground = setBackground;
    const mk = (): Slot => {
      const ground = new TilingSprite({ texture: fallback, width: 16, height: 16 });
      const decor = new RegionDecor();
      this.groundLayer.addChild(ground);
      this.decorLayer.addChild(decor.layer);
      return { ground, decor, region: -1 };
    };
    this.slots = [mk(), mk()];
  }

  private art(region: number): RegionArt {
    return this.regions[Math.max(0, Math.min(this.regions.length - 1, region))];
  }

  private assign(slot: Slot, region: number) {
    const r = this.art(region);
    slot.region = region;
    slot.ground.texture = r.ground ?? this.fallback;
    slot.decor.art = r;
  }

  private color(region: number): number {
    const r = this.art(region);
    return r.ground ? r.groundColor : this.fallbackColor;
  }

  /** camX/camY: world pixel under the screen centre; w/h: screen size in px. */
  update(region: number, dt: number, camX: number, camY: number, zoom: number, time: number, w: number, h: number) {
    if (region !== this.cur) {
      if (this.cur < 0) {
        this.assign(this.slots[this.front], region);
        this.fade = 1;
      } else {
        // the shown region becomes the back slot, fading out under the new one
        this.front ^= 1;
        this.assign(this.slots[this.front], region);
        this.fade = 0;
      }
      this.cur = region;
    }
    this.fade = advanceFade(this.fade, dt);
    const f = this.slots[this.front], b = this.slots[this.front ^ 1];
    const ox = w / 2 - camX * zoom, oy = h / 2 - camY * zoom;
    for (const s of [f, b]) {
      if (s.ground.width !== w) s.ground.width = w;
      if (s.ground.height !== h) s.ground.height = h;
      s.ground.tilePosition.set(ox, oy);
      s.ground.tileScale.set(zoom);
    }
    const v = fadeView(this.fade);
    const fading = v.fading;
    // the front slot may have been hidden while it was the back one: show it and keep it above the leaving ground
    f.ground.visible = f.decor.layer.visible = v.frontVisible;
    f.ground.alpha = f.decor.layer.alpha = v.frontAlpha;
    if (this.groundLayer.children[this.groundLayer.children.length - 1] !== f.ground) this.groundLayer.addChild(f.ground);
    b.ground.visible = b.decor.layer.visible = v.backVisible;
    b.ground.alpha = v.backGroundAlpha;
    b.decor.layer.alpha = v.backDecorAlpha;
    f.decor.update(camX, camY, zoom, time, w, h);
    if (fading) b.decor.update(camX, camY, zoom, time, w, h);
    // the clear colour follows the fade (it only shows where a ground texture has holes)
    const c = this.fade < 0.5 ? this.color(b.region) : this.color(f.region);
    if (c !== this.bgColor) {
      this.bgColor = c;
      this.setBackground(c);
    }
  }
}
