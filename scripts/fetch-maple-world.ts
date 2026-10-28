// World/UI part of the deploy-time asset step (called from fetch-maple.ts): Map.wz ground + decorations, Effect.wz damage
// digits and level-up effect, UI.wz status bar / cursor / windows / buttons. Every lookup is by name and defensive: when a
// node is missing the reason and the keys that do exist are logged ("maple: ...") and that piece is skipped, so the game
// falls back to its CSS/placeholder look for it. Never throws.
//
// Real layouts (MapleSaga GMS v62, see .wz-dump from CI):
//   Map.wz   Tile/<set>.img/{bsc,enH0,...}/<n>   Obj/<oS>.img/<l0>/<l1>/<l2>/<frame>   Map/Map1/100000000.img (Henesys)
//   Effect.wz BasicEff.img/{NoRed0,NoRed1,NoCri0,NoCri1,NoViolet0,NoViolet1,NoBlue0,NoBlue1,LevelUp}
//   UI.wz    StatusBar.img, Basic.img, Login.img, UIWindow.img
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FrameRec } from '../src/maple/assets.ts';
import type { AtlasRef, EffectsSection, MapObjItem, MapSection, UiPiece, UiSection } from '../src/maple/world-types.ts';
import { asciiPreview, encodePng } from './png.mjs';
import { canvasRgba } from './wz.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** What this module needs from fetch-maple.ts (passed in so the two files do not import each other). */
export interface WorldDeps {
  /** the dist directory; files go to <dist>/maple/... */
  dist: string;
  sets: { Map: SetLike | null; Effect: SetLike | null; UI: SetLike | null };
  log: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  canvasList: (node: Any) => Any[];
  packAtlas: (frames: Any[]) => { w: number; h: number; rgba: Buffer; recs: FrameRec[] } | null;
}
export interface SetLike {
  image(path: string): { root: Any; key: Any } | null;
  names(): string[];
}

export interface WorldResult {
  /** new top-level manifest keys: map, damage, ui, effects (only those that were extracted) */
  manifest: { map?: MapSection; damage?: AtlasRef; ui?: UiSection; effects?: EffectsSection };
  bytes: number;
}

const PREVIEW_COLS = 40;
const MAX_ATLAS_H = 4096;
const MAX_OBJECTS = 40;
/** objects larger than this are buildings/backdrops, not decorations */
const MAX_OBJ_W = 380;
const MAX_OBJ_H = 420;
const DAMAGE_SETS = ['NoRed0', 'NoRed1', 'NoCri0', 'NoCri1', 'NoViolet0', 'NoViolet1', 'NoBlue0', 'NoBlue1'];

export interface Px {
  w: number;
  h: number;
  rgba: Buffer;
  ox: number;
  oy: number;
  delay: number;
  hasDelay: boolean;
  id: object;
}

const isNum = (k: string) => /^\d+$/.test(k);

/** The helpers (PNG writing, canvas decoding, ground building) for other extractors such as fetch-maple-regions.ts. */
export function worldTools(d: WorldDeps): World {
  return new World(d, { manifest: {}, bytes: 0 });
}

export function buildWorld(d: WorldDeps): WorldResult {
  const out: WorldResult = { manifest: {}, bytes: 0 };
  const w = new World(d, out);
  w.run();
  return out;
}

export class World {
  d: WorldDeps;
  out: WorldResult;
  constructor(d: WorldDeps, out: WorldResult) {
    this.d = d;
    this.out = out;
  }

  private step<T>(name: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      this.d.warn(`${name}: ${(e as Error).stack}`);
      return undefined;
    }
  }

  run() {
    const t0 = Date.now();
    const { sets } = this.d;
    for (const stem of ['Map', 'Effect', 'UI'] as const) if (!sets[stem]) this.d.warn(`${stem}.wz is not available: its part of the world/UI art is skipped`);
    const map = this.step('map', () => this.extractMap());
    if (map) this.out.manifest.map = map;
    const dmg = this.step('damage', () => this.extractDamage());
    if (dmg) this.out.manifest.damage = dmg;
    const fx = this.step('effects', () => this.extractEffects());
    if (fx) this.out.manifest.effects = fx;
    const ui = this.step('ui', () => this.extractUi());
    if (ui) this.out.manifest.ui = ui;
    this.d.log(
      `world totals: map ${map ? `ground ${map.ground ? 'yes' : 'no'}, ${map.objects?.items.length ?? 0} objects` : 'none'}, damage ${dmg ? new Set(dmg.frames.map((f) => f.action.split('.')[0])).size + ' sets' : 'none'}, level-up ${fx?.levelUp ? fx.levelUp.frames.length + ' frames' : 'none'}, ui ${ui ? Object.keys(ui.pieces).length + ' pieces' : 'none'}, ${(this.out.bytes / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
  }

  // ---- helpers -----------------------------------------------------------------------------------------------------

  write(rel: string, wd: number, ht: number, rgba: Buffer): string {
    const path = join(this.d.dist, 'maple', rel);
    mkdirSync(dirname(path), { recursive: true });
    const png = encodePng(wd, ht, rgba);
    writeFileSync(path, png);
    this.out.bytes += png.length;
    return rel;
  }

  px(node: Any, key: Any): Px | null {
    if (!node || node.type !== 'canvas') return null;
    try {
      const [w, h, rgba] = canvasRgba(node, key);
      if (w < 1 || h < 1) return null;
      const o = node.get('origin')?.value;
      const hasDelay = node.get('delay') !== undefined;
      return { w, h, rgba, ox: o?.x ?? 0, oy: o?.y ?? 0, delay: Math.max(1, node.num('delay', 100)), hasDelay, id: node };
    } catch (e) {
      this.d.warn(`cannot decode canvas ${node.name}: ${(e as Error).message}`);
      return null;
    }
  }

  private describe(node: Any, depth = 1): string {
    if (!node) return '(missing)';
    const parts: string[] = [];
    for (const k of node.keys().slice(0, 40)) {
      const c = node.get(k);
      if (!c) continue;
      let s = `${k}:${c.type === 'canvas' ? `${c.value.width}x${c.value.height}` : c.type}`;
      if (depth > 1 && c.type !== 'canvas' && c.children) s += `{${this.describe(c, depth - 1)}}`;
      parts.push(s);
    }
    return parts.join(' ') + (node.keys().length > 40 ? ` ...(+${node.keys().length - 40})` : '');
  }

  private raw(px: Px, action: string, index: number): Any {
    return { action, index, w: px.w, h: px.h, ox: px.ox, oy: px.oy, delay: px.hasDelay ? px.delay : 100, rgba: px.rgba, id: px.id };
  }

  preview(title: string, p: { w: number; h: number; rgba: Buffer } | null) {
    if (!p) return this.d.log(`preview ${title}: not available`);
    console.log(`--- ${title} ${p.w}x${p.h} ---\n${asciiPreview(p.w, p.h, p.rgba, PREVIEW_COLS)}`);
  }

  // ---- Map.wz ------------------------------------------------------------------------------------------------------

  private extractMap(): MapSection | undefined {
    const wz = this.d.sets.Map;
    if (!wz) return undefined;
    const { log, warn } = this.d;
    const names = wz.names();
    log(`Map.wz: ${names.length} images; Tile ${names.filter((n) => /^tile\//i.test(n)).length}, Obj ${names.filter((n) => /^obj\//i.test(n)).length}, Back ${names.filter((n) => /^back\//i.test(n)).length}`);

    // which tile set and which objects Henesys uses
    const townPath = 'Map/Map1/100000000.img';
    const town = wz.image(townPath);
    const tileUse = new Map<string, number>();
    const bscUse = new Map<number, number>();
    const objUse = new Map<string, { oS: string; l0: string; l1: string; l2: string; n: number }>();
    if (!town) {
      warn(`${townPath} not found (Map1 images: ${names.filter((n) => /^map\/map1\//i.test(n)).slice(0, 8).join(' ')}); using grassySoil and no object list`);
    } else {
      log(`${townPath} top-level: ${town.root.keys().join(' ')}`);
      for (const L of town.root.keys().filter(isNum)) {
        const layer = town.root.get(L);
        const tS: string | undefined = layer.get('info/tS')?.value;
        const tiles = layer.get('tile');
        const objs = layer.get('obj');
        const nt = tiles?.keys().length ?? 0;
        log(`  layer ${L}: tS=${tS ?? '-'} tiles=${nt} objs=${objs?.keys().length ?? 0}`);
        for (const k of tiles?.keys() ?? []) {
          const t = tiles.get(k);
          const u = t?.get('u')?.value;
          const useSet = tS ?? '';
          if (useSet) tileUse.set(useSet, (tileUse.get(useSet) ?? 0) + 1);
          if (u === 'bsc' && typeof t.get('no')?.value === 'number') bscUse.set(t.get('no').value, (bscUse.get(t.get('no').value) ?? 0) + 1);
        }
        for (const k of objs?.keys() ?? []) {
          const o = objs.get(k);
          const oS = o?.get('oS')?.value;
          const l0 = o?.get('l0')?.value;
          const l1 = o?.get('l1')?.value;
          const l2 = o?.get('l2')?.value;
          if ([oS, l0, l1, l2].some((s) => typeof s !== 'string' && typeof s !== 'number')) continue;
          const key = `${oS}/${l0}/${l1}/${l2}`;
          const e = objUse.get(key) ?? { oS: String(oS), l0: String(l0), l1: String(l1), l2: String(l2), n: 0 };
          e.n++;
          objUse.set(key, e);
        }
      }
    }
    const ranked = [...tileUse].sort((a, b) => b[1] - a[1]);
    const tileSet = ranked[0]?.[0] || 'grassySoil';
    log(`tile set chosen: ${tileSet} (usage: ${ranked.map(([k, n]) => `${k}=${n}`).join(', ') || 'unknown'}); bsc variants used: ${[...bscUse].map(([k, n]) => `${k}x${n}`).join(' ') || '-'}`);

    const section: MapSection = { tileSet, ground: this.buildGround(wz, tileSet, bscUse), objects: null };
    section.objects = this.buildObjects(wz, objUse);
    return section.ground || section.objects ? section : undefined;
  }

  /** `file` is the PNG path under maple/ (regions write one ground per region) */
  buildGround(wz: SetLike, tileSet: string, bscUse: Map<number, number>, file = 'map/ground.png'): MapSection['ground'] {
    const { log, warn } = this.d;
    const img = wz.image(`Tile/${tileSet}.img`);
    if (!img) {
      warn(`Tile/${tileSet}.img missing (Tile images: ${wz.names().filter((n) => /^tile\//i.test(n)).slice(0, 12).join(' ')})`);
      return null;
    }
    const pieces = img.root.keys();
    log(`tile pieces of ${tileSet}: ` + pieces.map((k: string) => {
      const l = this.d.canvasList(img.root.get(k));
      return `${k}[${l.length}${l[0] ? ` ${l[0].value.width}x${l[0].value.height}` : ''}]`;
    }).join(' '));
    let list = this.d.canvasList(img.root.get('bsc'));
    if (!list.length) {
      // fall back to the piece with the most full-size variants
      const best = pieces.map((k: string) => ({ k, l: this.d.canvasList(img.root.get(k)) })).filter((x: Any) => x.l.length && x.l[0].value.width >= 30 && x.l[0].value.height >= 30).sort((a: Any, b: Any) => b.l.length - a.l.length)[0];
      if (!best) {
        warn(`tile set ${tileSet} has no usable base tiles`);
        return null;
      }
      warn(`tile set ${tileSet} has no "bsc"; using "${best.k}" instead`);
      list = best.l;
    }
    const tiles = list.map((c: Any) => this.px(c, img.key)).filter((p: Px | null): p is Px => !!p);
    if (!tiles.length) return null;
    const cw = tiles[0].w;
    const ch = tiles[0].h;
    // average colour of everything opaque: also the fill under any transparent holes and the renderer's background colour
    let r = 0, g = 0, b = 0, n = 0;
    for (const t of tiles)
      for (let i = 0; i < t.w * t.h; i++) {
        if (t.rgba[i * 4 + 3] < 200) continue;
        r += t.rgba[i * 4]; g += t.rgba[i * 4 + 1]; b += t.rgba[i * 4 + 2]; n++;
      }
    const avg: [number, number, number] = n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [79, 154, 60];
    const cov = tiles.map((t) => {
      let o = 0;
      for (let i = 0; i < t.w * t.h; i++) if (t.rgba[i * 4 + 3] >= 200) o++;
      return Math.round((100 * o) / (t.w * t.h));
    });
    log(`ground: ${tiles.length} bsc tiles ${tiles.map((t) => `${t.w}x${t.h}`).join(',')}, opaque ${cov.join('/')}%, average colour rgb(${avg.join(',')})`);

    // 4 x 4 grid of weighted-random variants: tiles are drawn on a w x h grid in the game, so this repeats seamlessly
    const COLS = 4, ROWS = 4;
    const W = cw * COLS, H = ch * ROWS;
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = avg[0]; rgba[i * 4 + 1] = avg[1]; rgba[i * 4 + 2] = avg[2]; rgba[i * 4 + 3] = 255; }
    const weights = tiles.map((_, i) => 1 + (bscUse.get(i) ?? 0));
    const total = weights.reduce((a, x) => a + x, 0);
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) / 16777216;
    let prev = -1;
    for (let cy = 0; cy < ROWS; cy++)
      for (let cx = 0; cx < COLS; cx++) {
        let v = 0;
        for (let tries = 0; tries < 6; tries++) {
          let x = rnd() * total;
          v = 0;
          while (v < tiles.length - 1 && (x -= weights[v]) > 0) v++;
          if (v !== prev || tiles.length === 1) break;
        }
        prev = v;
        const t = tiles[v];
        for (let y = 0; y < Math.min(ch, t.h); y++)
          for (let x = 0; x < Math.min(cw, t.w); x++) {
            const s = (y * t.w + x) * 4;
            const a = t.rgba[s + 3];
            if (!a) continue;
            const o = ((cy * ch + y) * W + cx * cw + x) * 4;
            for (let c = 0; c < 3; c++) rgba[o + c] = (t.rgba[s + c] * a + rgba[o + c] * (255 - a)) / 255;
          }
      }
    const image = this.write(file, W, H, rgba);
    this.preview(`ground tile (${tileSet}/bsc/0)`, tiles[0]);
    log(`ground texture ${image} ${W}x${H}`);
    return { image, w: W, h: H, avg };
  }

  private buildObjects(wz: SetLike, objUse: Map<string, { oS: string; l0: string; l1: string; l2: string; n: number }>): MapSection['objects'] {
    const { log, warn } = this.d;
    const ranked = [...objUse.values()].sort((a, b) => b.n - a.n);
    log(`Henesys uses ${ranked.length} distinct objects; most used: ${ranked.slice(0, 12).map((o) => `${o.oS}/${o.l0}/${o.l1}/${o.l2}x${o.n}`).join(' ')}`);
    const picked: { item: MapObjItem; frames: Px[]; key: Any }[] = [];
    const images = new Map<string, { root: Any; key: Any } | null>();
    const skipped: string[] = [];
    for (const o of ranked) {
      if (picked.length >= MAX_OBJECTS) break;
      const path = `Obj/${o.oS}.img`;
      if (!images.has(path)) images.set(path, wz.image(path));
      const img = images.get(path);
      if (!img) { skipped.push(`${o.oS} (no image)`); continue; }
      const node = img.root.get(`${o.l0}/${o.l1}/${o.l2}`);
      if (!node) {
        skipped.push(`${o.oS}/${o.l0}/${o.l1}/${o.l2} (no node; ${o.oS} top: ${img.root.keys().slice(0, 8).join(',')})`);
        continue;
      }
      const frames = this.d.canvasList(node).map((c: Any) => this.px(c, img.key)).filter((p: Px | null): p is Px => !!p);
      if (!frames.length) { skipped.push(`${o.oS}/${o.l0}/${o.l1}/${o.l2} (no canvases; children ${node.keys().slice(0, 8).join(',')})`); continue; }
      const mw = Math.max(...frames.map((f) => f.w));
      const mh = Math.max(...frames.map((f) => f.h));
      if (mw > MAX_OBJ_W || mh > MAX_OBJ_H) { skipped.push(`${o.oS}/${o.l0}/${o.l1}/${o.l2} (${mw}x${mh} too big)`); continue; }
      if (mw < 10 || mh < 10) { skipped.push(`${o.oS}/${o.l0}/${o.l1}/${o.l2} (${mw}x${mh} too small)`); continue; }
      picked.push({ item: { key: `${o.oS}.${o.l0}.${o.l1}.${o.l2}`, weight: o.n, w: frames[0].w, h: frames[0].h }, frames, key: img.key });
    }
    if (skipped.length) log(`objects skipped (${skipped.length}): ${skipped.slice(0, 25).join('; ')}${skipped.length > 25 ? ' ...' : ''}`);
    if (!picked.length) {
      warn('no Henesys objects could be extracted; map decorations keep the placeholder look');
      return null;
    }
    // pack; if the atlas gets too tall drop the least used objects
    let use = picked;
    let atlas = this.d.packAtlas(use.flatMap((p) => p.frames.map((f, i) => this.raw(f, p.item.key, i))));
    while (atlas && atlas.h > MAX_ATLAS_H && use.length > 1) {
      use = use.slice(0, -1);
      atlas = this.d.packAtlas(use.flatMap((p) => p.frames.map((f, i) => this.raw(f, p.item.key, i))));
    }
    if (!atlas) return null;
    if (use.length < picked.length) warn(`object atlas too tall: kept ${use.length} of ${picked.length}`);
    const rel = this.write('map/objects.png', atlas.w, atlas.h, atlas.rgba);
    for (const p of use) log(`object ${p.item.key}: ${p.frames.length} frame(s) ${p.frames[0].w}x${p.frames[0].h}, used ${p.item.weight}x`);
    log(`objects atlas ${rel} ${atlas.w}x${atlas.h}, ${use.length} objects, ${atlas.recs.length} frames`);
    const tree = use.find((p) => /tree/i.test(p.item.key)) ?? [...use].sort((a, b) => b.frames[0].h - a.frames[0].h)[0];
    this.preview(`object ${tree.item.key}`, tree.frames[0]);
    return { atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs, items: use.map((p) => p.item) };
  }

  // ---- Effect.wz ---------------------------------------------------------------------------------------------------

  private basicEff() {
    const wz = this.d.sets.Effect;
    if (!wz) return null;
    const img = wz.image('BasicEff.img');
    if (!img) this.d.warn(`Effect.wz has no BasicEff.img (images: ${wz.names().join(' ')})`);
    return img;
  }

  private extractDamage(): AtlasRef | undefined {
    const img = this.basicEff();
    if (!img) return undefined;
    const { log, warn } = this.d;
    log(`BasicEff.img keys: ${img.root.keys().join(' ')}`);
    const frames: Any[] = [];
    const found: string[] = [];
    let seven: Px | null = null;
    for (const set of DAMAGE_SETS) {
      const node = img.root.get(set);
      if (!node) {
        found.push(`${set}:MISSING`);
        continue;
      }
      let digits = 0;
      for (let i = 0; i < 10; i++) {
        const p = this.px(node.get(String(i)), img.key);
        if (!p) continue;
        frames.push(this.raw(p, set, i));
        digits++;
        if (set === 'NoRed1' && i === 7) seven = p;
      }
      const extras: string[] = [];
      for (const k of node.keys().filter((x: string) => !isNum(x))) {
        const p = this.px(node.get(k), img.key);
        if (p) { frames.push(this.raw(p, `${set}.${k}`, 0)); extras.push(`${k}=${p.w}x${p.h}`); }
      }
      found.push(`${set}:${digits}${extras.length ? '+' + extras.join('+') : ''}`);
      if (digits < 10) warn(`${set} has only ${digits} digit canvases (children: ${node.keys().join(',')})`);
    }
    log(`damage digit sets: ${found.join(' ')}`);
    const hasRed = frames.some((f) => f.action === 'NoRed0') && frames.some((f) => f.action === 'NoRed1');
    if (!hasRed) warn('NoRed0/NoRed1 incomplete: damage numbers keep the text look');
    const atlas = frames.length ? this.d.packAtlas(frames) : null;
    if (!atlas) return undefined;
    const rel = this.write('damage/digits.png', atlas.w, atlas.h, atlas.rgba);
    log(`damage atlas ${rel} ${atlas.w}x${atlas.h}, ${atlas.recs.length} glyphs`);
    this.preview('NoRed1 digit 7', seven);
    return { atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs };
  }

  private extractEffects(): EffectsSection | undefined {
    const img = this.basicEff();
    if (!img) return undefined;
    const { log, warn } = this.d;
    const node = img.root.get('LevelUp');
    if (!node) {
      warn('BasicEff.img has no LevelUp');
      return undefined;
    }
    const frames = this.d.canvasList(node).map((c: Any) => this.px(c, img.key)).filter((p: Px | null): p is Px => !!p);
    if (!frames.length) {
      warn(`LevelUp has no canvases (children ${node.keys().join(',')})`);
      return undefined;
    }
    // frames without a delay of their own would play at the 100 ms default: the real effect is quicker
    const noDelay = frames.every((f) => !f.hasDelay);
    const raw = frames.map((f, i) => ({ ...this.raw(f, 'levelUp', i), delay: noDelay ? 70 : f.delay }));
    const atlas = this.d.packAtlas(raw);
    if (!atlas) return undefined;
    const rel = this.write('effects/levelup.png', atlas.w, atlas.h, atlas.rgba);
    log(`level-up effect ${rel} ${atlas.w}x${atlas.h}: ${frames.length} frames ${frames.slice(0, 4).map((f) => `${f.w}x${f.h}`).join(',')}..., origin of frame 0 (${frames[0].ox},${frames[0].oy}), ${noDelay ? 'no delays in WZ -> 70 ms' : 'WZ delays'}`);
    return { levelUp: { atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs } };
  }

  // ---- UI.wz -------------------------------------------------------------------------------------------------------

  private extractUi(): UiSection | undefined {
    const wz = this.d.sets.UI;
    if (!wz) return undefined;
    const { log, warn } = this.d;
    const pieces: Record<string, UiPiece> = {};
    const missing: string[] = [];
    const add = (name: string, p: Px, meta?: Record<string, number>, rgba: Buffer = p.rgba, w = p.w, h = p.h) => {
      pieces[name] = { src: this.write(`ui/${name}.png`, w, h, rgba), w, h, ox: p.ox, oy: p.oy, ...(meta ? { meta } : {}) };
    };
    /** first canvas of a node (itself, or its first numbered canvas child) */
    const first = (img: Any, path: string): Px | null => {
      const l = this.d.canvasList(img.root.get(path));
      return l[0] ? this.px(l[0], img.key) : null;
    };
    const take = (img: Any, path: string, name: string) => {
      const p = first(img, path);
      if (p) add(name, p);
      else missing.push(`${name} (${path})`);
      return p;
    };

    // ---- StatusBar.img
    const sb = wz.image('StatusBar.img');
    if (!sb) warn(`UI.wz has no StatusBar.img (images: ${wz.names().join(' ')})`);
    else {
      log(`StatusBar.img: ${sb.root.keys().join(' ')}`);
      log(`  base: ${this.describe(sb.root.get('base'))}`);
      log(`  gauge: ${this.describe(sb.root.get('gauge'))}`);
      const bg = take(sb, 'base/backgrnd', 'sb.backgrnd');
      take(sb, 'base/backgrnd2', 'sb.backgrnd2');
      take(sb, 'base/quickSlot', 'sb.quickSlot');
      take(sb, 'base/chat', 'sb.chat');
      const bar = take(sb, 'gauge/bar', 'sb.gaugeBar');
      take(sb, 'gauge/graduation', 'sb.gaugeGrad');
      take(sb, 'gauge/gray', 'sb.gray');
      take(sb, 'gauge/tempExp', 'sb.tempExp');
      for (let i = 0; i < 10; i++) take(sb, `number/${i}`, `sb.n.${i}`);
      for (const k of ['slash', 'percent', 'Lbracket', 'Rbracket']) take(sb, `number/${k}`, `sb.n.${k}`);
      this.buttonStates(sb, 'BtMenu', 'sb.menu', pieces, missing);
      if (bg) this.statusStrip(bg, add);
      if (bar) this.gaugeBands(bar, add);
      if (bg) {
        // the left 160 px, so 40 columns show real detail
        const cw = Math.min(160, bg.w), crop = Buffer.alloc(cw * bg.h * 4);
        for (let y = 0; y < bg.h; y++) bg.rgba.copy(crop, y * cw * 4, y * bg.w * 4, (y * bg.w + cw) * 4);
        this.preview('status bar background (left 160px)', { w: cw, h: bg.h, rgba: crop });
      } else this.preview('status bar background', null);
    }

    // ---- Basic.img
    const basic = wz.image('Basic.img');
    if (!basic) warn('UI.wz has no Basic.img');
    else {
      log(`Basic.img Cursor: ${this.describe(basic.root.get('Cursor'), 2)}`);
      for (const n of ['0', '1']) {
        const c = this.d.canvasList(basic.root.get(`Cursor/${n}`))[0];
        const p = c ? this.px(c, basic.key) : null;
        if (p) add(`cur.${n}`, p);
        else missing.push(`cur.${n} (Cursor/${n}: ${this.describe(basic.root.get(`Cursor/${n}`))})`);
      }
      for (const k of basic.root.get('LevelNo')?.keys() ?? []) {
        const c = basic.root.get(`LevelNo/${k}`);
        const p = c ? this.px(c, basic.key) : null;
        if (p) add(`lv.${k}`, p);
      }
      if (!pieces['lv.0']) missing.push('lv.0.. (Basic.img LevelNo)');
      // 3-part windows: t (top) + c (centre, stretched) + s (bottom), stacked into one image
      for (const [src, name] of [['Notice2', 'win.notice2'], ['Notice3', 'win.notice3'], ['YesNo2', 'win.yesno2'], ['YesNo3', 'win.yesno3']] as const) {
        const t = first(basic, `${src}/t`), c = first(basic, `${src}/c`), s = first(basic, `${src}/s`);
        if (!t || !c || !s) { missing.push(`${name} (Basic.img ${src}/t,c,s: ${this.describe(basic.root.get(src))})`); continue; }
        const W = Math.max(t.w, c.w, s.w), H = t.h + c.h + s.h;
        const rgba = Buffer.alloc(W * H * 4);
        let y = 0;
        for (const part of [t, c, s]) {
          for (let row = 0; row < part.h; row++) part.rgba.copy(rgba, ((y + row) * W) * 4, row * part.w * 4, (row + 1) * part.w * 4);
          y += part.h;
        }
        add(name, t, { top: t.h, mid: c.h, bottom: s.h, partW: W }, rgba, W, H);
      }
      take(basic, 'Notice/backgrnd', 'win.noticeBg');
      for (const [src, name] of [['BtOK', 'btn.ok'], ['BtCancel', 'btn.cancel'], ['BtYes', 'btn.yes'], ['BtNo', 'btn.no']] as const) this.blankButton(basic, src, name, pieces, missing);
      this.buttonStates(basic, 'BtClose', 'btn.close', pieces, missing);
      for (const [k, name] of [['left', 'sl.left'], ['mid', 'sl.mid'], ['right', 'sl.right'], ['thumbNormal', 'sl.thumb'], ['thumbMouseOver', 'sl.thumbHover']] as const) take(basic, `Slider/${k}`, name);
    }

    // ---- Login.img (title logo)
    const login = wz.image('Login.img');
    if (!login) warn('UI.wz has no Login.img');
    else {
      take(login, 'Title/MSTitle', 'title.logo');
    }

    // ---- UIWindow.img: only logged, so the next CI run shows what frames exist
    const uiw = wz.image('UIWindow.img');
    if (uiw) {
      for (const k of ['Stat', 'Skill', 'Item', 'Equip', 'ToolTip', 'MiniMap', 'GameMenu', 'Notice', 'UtilDlgEx']) log(`UIWindow.img ${k}: ${this.describe(uiw.root.get(k), 2)}`);
      take(uiw, 'Stat/backgrnd', 'uiw.stat');
    } else warn('UI.wz has no UIWindow.img');

    const names = Object.keys(pieces);
    log(`UI pieces found (${names.length}): ${names.join(' ')}`);
    log(`UI pieces missing (${missing.length}): ${missing.join('; ') || '-'}`);
    return names.length ? { pieces } : undefined;
  }

  /** normal / mouseOver / pressed / disabled of a button node, stored as <name>.normal, .hover, .pressed, .disabled */
  private buttonStates(img: Any, src: string, name: string, pieces: Record<string, UiPiece>, missing: string[]) {
    const node = img.root.get(src);
    if (!node) { missing.push(`${name} (${src})`); return; }
    for (const [state, suffix] of [['normal', 'normal'], ['mouseOver', 'hover'], ['pressed', 'pressed'], ['disabled', 'disabled']] as const) {
      const c = this.d.canvasList(node.get(state))[0];
      const p = c ? this.px(c, img.key) : null;
      if (!p) { if (state === 'normal') missing.push(`${name}.${suffix} (${src}/${state}: ${this.describe(node.get(state))})`); continue; }
      pieces[`${name}.${suffix}`] = { src: this.write(`ui/${name}.${suffix}.png`, p.w, p.h, p.rgba), w: p.w, h: p.h, ox: p.ox, oy: p.oy };
    }
  }

  /**
   * A button without its label: MapleStory buttons have the text baked in, so keep the left and right caps and one
   * column from just inside the left cap (stretched by border-image in CSS). Stored as cap | column | cap.
   */
  private blankButton(img: Any, src: string, name: string, pieces: Record<string, UiPiece>, missing: string[]) {
    const node = img.root.get(src);
    if (!node) { missing.push(`${name} (${src})`); return; }
    for (const [state, suffix] of [['normal', 'normal'], ['mouseOver', 'hover'], ['pressed', 'pressed'], ['disabled', 'disabled']] as const) {
      const c = this.d.canvasList(node.get(state))[0];
      const p = c ? this.px(c, img.key) : null;
      if (!p) { if (state === 'normal') missing.push(`${name}.${suffix} (${src}/${state}: ${this.describe(node.get(state))})`); continue; }
      const cap = Math.max(2, Math.min(8, Math.round(p.w * 0.16)));
      if (p.w < cap * 2 + 3) continue;
      const fillX = cap + 1;
      const W = cap * 2 + 1;
      const rgba = Buffer.alloc(W * p.h * 4);
      for (let y = 0; y < p.h; y++) {
        const row = y * p.w * 4;
        p.rgba.copy(rgba, y * W * 4, row, row + cap * 4);
        p.rgba.copy(rgba, (y * W + cap) * 4, row + fillX * 4, row + fillX * 4 + 4);
        p.rgba.copy(rgba, (y * W + cap + 1) * 4, row + (p.w - cap) * 4, row + p.w * 4);
      }
      pieces[`${name}.${suffix}`] = { src: this.write(`ui/${name}.${suffix}.png`, W, p.h, rgba), w: W, h: p.h, ox: 0, oy: 0, meta: { cap, srcW: p.w } };
    }
  }

  /** A one-pixel-wide slice of the status bar background from a flat part (the least changing column), repeated sideways in CSS. */
  private statusStrip(bg: Px, add: (name: string, p: Px, meta?: Record<string, number>, rgba?: Buffer, w?: number, h?: number) => void) {
    const { w, h, rgba } = bg;
    const diff = (x: number, y: number) => {
      let s = 0;
      for (let r = 0; r < h; r++) for (let c = 0; c < 4; c++) s += Math.abs(rgba[(r * w + x) * 4 + c] - rgba[(r * w + y) * 4 + c]);
      return s;
    };
    let bestX = -1, best = Infinity;
    for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x++) {
      let opaque = true;
      for (let r = 0; r < h && opaque; r++) if (rgba[(r * w + x) * 4 + 3] < 250) opaque = false;
      if (!opaque) continue;
      const s = diff(x, x - 1) + diff(x, x + 1);
      if (s < best) { best = s; bestX = x; }
    }
    if (bestX < 0) { this.d.log('status bar: no fully opaque flat column; sb.fill skipped'); return; }
    const col = Buffer.alloc(h * 4);
    for (let r = 0; r < h; r++) rgba.copy(col, r * 4, (r * w + bestX) * 4, (r * w + bestX) * 4 + 4);
    add('sb.fill', { ...bg, w: 1, h }, { x: bestX, diff: best }, col, 1, h);
    this.d.log(`status bar: flat column x=${bestX} (neighbour difference ${best}) -> sb.fill 1x${h}`);
  }

  /** Finds the red / blue / yellow-green bands (rows) of the combined gauge image and stores each as its own strip. */
  private gaugeBands(bar: Px, add: (name: string, p: Px, meta?: Record<string, number>, rgba?: Buffer, w?: number, h?: number) => void) {
    const { w, h, rgba } = bar;
    const cls: string[] = [];
    for (let y = 0; y < h; y++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (rgba[o + 3] < 200) continue;
        r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++;
      }
      if (n < w * 0.1) { cls.push('none'); continue; }
      r /= n; g /= n; b /= n;
      cls.push(classify(r, g, b));
    }
    // run-length summary for the CI log
    const runs: string[] = [];
    for (let y = 0, s = 0; y <= h; y++) if (y === h || cls[y] !== cls[s]) { runs.push(`${s}-${y - 1}:${cls[s]}`); s = y; }
    this.d.log(`gauge/bar ${w}x${h} row classes: ${runs.join(' ')}`);
    for (const [klass, name] of [['red', 'sb.hp'], ['blue', 'sb.mp'], ['yellow', 'sb.exp'], ['green', 'sb.expGreen']] as const) {
      let bestS = -1, bestL = 0;
      for (let y = 0, s = 0; y <= h; y++) if (y === h || cls[y] !== cls[s]) { if (cls[s] === klass && y - s > bestL) { bestL = y - s; bestS = s; } s = y; }
      if (bestL < 3) continue;
      const strip = Buffer.alloc(w * bestL * 4);
      rgba.copy(strip, 0, bestS * w * 4, (bestS + bestL) * w * 4);
      add(name, { ...bar, w, h: bestL }, { y: bestS }, strip, w, bestL);
      this.d.log(`gauge band ${klass}: rows ${bestS}-${bestS + bestL - 1} -> ${name} ${w}x${bestL}`);
    }
  }
}

function classify(r: number, g: number, b: number): string {
  if (Math.max(r, g, b) < 60) return 'dark';
  if (r > g * 1.4 && r > b * 1.4) return 'red';
  if (b > r * 1.2 && b >= g * 0.95) return 'blue';
  if (r > b * 1.5 && g > b * 1.5 && g > r * 0.65) return 'yellow';
  if (g > r * 1.1 && g > b * 1.3) return 'green';
  return 'other';
}
