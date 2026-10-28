// The v83 login map for the title / world select / character select screens (called from buildAssets in scripts/fetch-maple.ts):
// UI.wz MapLogin.img is laid out like a field map (back/, 0..7/obj, 0..7/tile) and points into Map.wz Back/login.img and
// Obj/login.img. Every back, object and tile it places is written as a PNG under maple/login/ and listed in the `login`
// manifest section (src/maple/login-scene.ts) with its position, so the game redraws the real scene and moves the camera
// between the steps like the client did. The CI log gets the structure, the object groups with their extents and a
// base64 PNG of the whole map (LOGIN-MAP-PNG lines) for checking the layout. Never throws.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LoginBack, LoginObj, LoginSection, LoginSprite, LoginStep } from '../src/maple/login-scene.ts';
import { placements } from '../src/maple/login-scene.ts';
import { encodePng } from './png.mjs';
import type { SetLike } from './fetch-maple-world.ts';
import { canvasRgba } from './wz.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface LoginDeps {
  dist: string;
  sets: { Map: SetLike | null; UI: SetLike | null };
  log: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  canvasList: (node: Any) => Any[];
}

export interface LoginResult {
  manifest: { login?: LoginSection };
  bytes: number;
}

/** PNG budget for the whole scene */
const MAX_BYTES = 9_000_000;
const MAX_FRAMES = 24;
const isNum = (k: string) => /^\d+$/.test(k);
const byNum = (a: string, b: string) => Number(a) - Number(b);

interface Px { w: number; h: number; rgba: Buffer }

export function buildLogin(d: LoginDeps): LoginResult {
  const out: LoginResult = { manifest: {}, bytes: 0 };
  try {
    const s = new Login(d, out);
    const scene = s.run();
    if (scene) out.manifest.login = scene;
  } catch (e) {
    d.warn(`login scene: ${(e as Error).stack}`);
  }
  return out;
}

class Login {
  private written = new Map<object, LoginSprite>();
  private pixels = new Map<string, Px>();
  private images = new Map<string, { root: Any; key: Any } | null>();
  private skipped: string[] = [];
  private d: LoginDeps;
  private out: LoginResult;
  constructor(d: LoginDeps, out: LoginResult) {
    this.d = d;
    this.out = out;
  }

  run(): LoginSection | null {
    const { log, warn } = this.d;
    const ui = this.d.sets.UI, map = this.d.sets.Map;
    if (!ui || !map) { warn('login scene: UI.wz or Map.wz missing'); return null; }
    const uiNames = ui.names();
    log(`login scene: UI.wz images: ${uiNames.join(' ')}`);
    const cand = ['MapLogin.img', 'MapLogin1.img', 'MapLogin2.img'].filter((n) => uiNames.includes(n));
    const source = cand[0];
    if (!source) { warn(`login scene: UI.wz has no MapLogin.img (images with "login": ${uiNames.filter((n) => /login/i.test(n)).join(' ') || 'none'})`); return null; }
    const img = ui.image(source)!;
    const root = img.root;
    log(`login scene: ${source} top-level: ${root.keys().join(' ')}`);
    const info = root.get('info');
    if (info) log(`login scene: info ${info.keys().map((k: string) => `${k}=${info.get(k)?.value}`).join(' ')}`);
    const num = (n: Any, k: string, f = 0) => (typeof n?.get(k)?.value === 'number' ? n.get(k).value : f);
    const bounds = info && info.get('VRLeft') ? { left: num(info, 'VRLeft'), top: num(info, 'VRTop'), right: num(info, 'VRRight'), bottom: num(info, 'VRBottom') } : null;

    // ---- backgrounds
    const backs: LoginBack[] = [];
    const backNode = root.get('back');
    for (const k of (backNode?.keys() ?? []).filter(isNum).sort(byNum)) {
      const b = backNode.get(k);
      const bS = b.get('bS')?.value;
      const no = b.get('no')?.value;
      const ani = num(b, 'ani');
      const desc = `back ${k}: bS=${bS} no=${no} ani=${ani} x=${num(b, 'x')} y=${num(b, 'y')} rx=${num(b, 'rx')} ry=${num(b, 'ry')} cx=${num(b, 'cx')} cy=${num(b, 'cy')} type=${num(b, 'type')} a=${num(b, 'a', 255)} front=${num(b, 'front')} f=${num(b, 'f')}`;
      if (typeof bS !== 'string' || !bS || no === undefined) { log(`login scene: ${desc} (skipped: no image)`); continue; }
      const src = map.image(`Back/${bS}.img`);
      const node = src?.root.get(`${ani ? 'ani' : 'back'}/${no}`);
      const frames = node && src ? this.frames(node, src.key, `back.${bS}.${ani ? 'a' : 'b'}${no}`) : [];
      log(`login scene: ${desc} -> ${frames.length ? `${frames.length} frame(s) ${frames[0].w}x${frames[0].h} origin ${frames[0].ox},${frames[0].oy}` : 'NOT FOUND'}`);
      if (!frames.length) continue;
      backs.push({ frames, x: num(b, 'x'), y: num(b, 'y'), rx: num(b, 'rx'), ry: num(b, 'ry'), cx: num(b, 'cx'), cy: num(b, 'cy'), type: num(b, 'type'), a: num(b, 'a', 255), front: !!num(b, 'front'), flip: !!num(b, 'f') });
    }

    // ---- layers: objects then tiles, as the client draws them
    const objs: LoginObj[] = [];
    const groups = new Map<string, { n: number; x0: number; y0: number; x1: number; y1: number }>();
    for (const L of root.keys().filter(isNum).sort(byNum)) {
      const layer = root.get(L);
      const tS = layer.get('info/tS')?.value;
      const objNode = layer.get('obj');
      const tileNode = layer.get('tile');
      log(`login scene: layer ${L}: tS=${tS ?? '-'} objs=${objNode?.keys().length ?? 0} tiles=${tileNode?.keys().length ?? 0}`);
      const layerObjs: LoginObj[] = [];
      for (const k of (objNode?.keys() ?? []).sort(byNum)) {
        const o = objNode.get(k);
        const v = ['oS', 'l0', 'l1', 'l2'].map((n) => o.get(n)?.value);
        if (v.some((x) => x === undefined)) continue;
        const path = v.join('/');
        const src = this.image(map, `Obj/${v[0]}.img`);
        const node = src?.root.get(`${v[1]}/${v[2]}/${v[3]}`);
        const frames = node && src ? this.frames(node, src.key, `obj.${path.replace(/\//g, '.')}`) : [];
        if (!frames.length) { this.skipped.push(`obj ${path}`); continue; }
        const x = num(o, 'x'), y = num(o, 'y');
        layerObjs.push({ frames, x, y, z: num(o, 'z'), layer: Number(L), flip: !!num(o, 'f'), path });
        const gk = `${v[0]}/${v[1]}/${v[2]}`;
        const f = frames[0];
        const g = groups.get(gk) ?? { n: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        g.n++; g.x0 = Math.min(g.x0, x - f.ox); g.y0 = Math.min(g.y0, y - f.oy); g.x1 = Math.max(g.x1, x - f.ox + f.w); g.y1 = Math.max(g.y1, y - f.oy + f.h);
        groups.set(gk, g);
      }
      layerObjs.sort((a, b) => a.z - b.z);
      objs.push(...layerObjs);
      const layerTiles: (LoginObj & { zM: number })[] = [];
      for (const k of (tileNode?.keys() ?? []).sort(byNum)) {
        const t = tileNode.get(k);
        const u = t.get('u')?.value, no = t.get('no')?.value;
        if (typeof tS !== 'string' || u === undefined || no === undefined) continue;
        const src = this.image(map, `Tile/${tS}.img`);
        const node = src?.root.get(`${u}/${no}`);
        const frames = node && src ? this.frames(node, src.key, `tile.${tS}.${u}.${no}`) : [];
        if (!frames.length) { this.skipped.push(`tile ${tS}/${u}/${no}`); continue; }
        layerTiles.push({ frames, x: num(t, 'x'), y: num(t, 'y'), z: 0, zM: num(t, 'zM'), layer: Number(L), flip: false, path: `tile/${tS}/${u}/${no}` });
      }
      layerTiles.sort((a, b) => a.zM - b.zM);
      objs.push(...layerTiles.map(({ zM: _zM, ...t }) => t));
    }
    for (const [k, g] of [...groups].sort((a, b) => a[1].y0 - b[1].y0)) log(`login scene: group ${k} x${g.n} spans x ${g.x0}..${g.x1} y ${g.y0}..${g.y1}`);
    if (this.skipped.length) log(`login scene: skipped (${this.skipped.length}): ${this.skipped.slice(0, 30).join('; ')}`);
    if (!backs.length && !objs.length) { warn('login scene: nothing could be placed'); return null; }

    const steps = findSteps(groups, log);
    const scene: LoginSection = { source, backs, objs, bounds, steps, ui: this.loginUi(ui) };
    log(`login scene: ${backs.length} backs, ${objs.length} objects/tiles, ${this.written.size} images, ${(this.out.bytes / 1e6).toFixed(2)} MB; steps ${JSON.stringify(steps)}`);
    try {
      this.dumpSheet(scene.ui);
      this.dumpPreview(scene);
    } catch (e) {
      warn(`login scene preview: ${(e as Error).message}`);
    }
    return scene;
  }

  /**
   * Every canvas of Login.img's Title / Common / WorldSelect / CharSelect / NewChar trees (buttons with their states, the
   * world and channel buttons, the step labels, name tags...) keyed by its path, e.g. 'WorldSelect/BtWorld/0/normal/0'.
   */
  private loginUi(ui: SetLike): Record<string, LoginSprite> {
    const img = ui.image('Login.img');
    const res: Record<string, LoginSprite> = {};
    if (!img) return res;
    const walk = (node: Any, path: string, depth: number) => {
      if (!node || depth > 6 || /SoftKey|Pincode/.test(path)) return;
      if (node.type === 'canvas') {
        const [sp] = this.frames(node, img.key, `ui.${path.replace(/\//g, '.')}`);
        if (sp) res[path] = sp;
        return;
      }
      for (const k of node.keys()) walk(node.get(k), path ? `${path}/${k}` : k, depth + 1);
    };
    for (const top of ['Title', 'Common', 'WorldSelect', 'CharSelect', 'NewChar']) walk(img.root.get(top), top, 0);
    const keys = Object.keys(res);
    this.d.log(`login ui: ${keys.length} canvases`);
    for (let i = 0; i < keys.length; i += 12)
      this.d.log(`login ui: ${keys.slice(i, i + 12).map((k) => `${k} ${res[k].w}x${res[k].h}@${res[k].ox},${res[k].oy}`).join(' | ')}`);
    const logo = ui.image('Logo.img');
    if (logo) this.d.log(`login ui: Logo.img: ${logo.root.keys().join(' ')}`);
    return res;
  }

  private image(set: SetLike, path: string) {
    if (!this.images.has(path)) this.images.set(path, set.image(path));
    return this.images.get(path) ?? null;
  }

  /** The frames of a canvas or of a node with numbered canvases, each written once. */
  private frames(node: Any, key: Any, name: string): LoginSprite[] {
    const list = node.type === 'canvas' ? [node] : this.d.canvasList(node);
    const res: LoginSprite[] = [];
    for (const [i, c] of list.slice(0, MAX_FRAMES).entries()) {
      const known = this.written.get(c);
      if (known) { res.push(known); continue; }
      try {
        const [w, h, rgba] = canvasRgba(c, key);
        if (w < 1 || h < 1) continue;
        const rel = `login/${name}${list.length > 1 ? `.${i}` : ''}.png`.replace(/[^A-Za-z0-9_./-]/g, '_');
        const png = encodePng(w, h, rgba);
        if (this.out.bytes + png.length > MAX_BYTES) { this.skipped.push(`${rel} (budget)`); continue; }
        const path = join(this.d.dist, 'maple', rel);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, png);
        this.out.bytes += png.length;
        const o = c.get('origin')?.value;
        const sp: LoginSprite = { src: rel, w, h, ox: o?.x ?? 0, oy: o?.y ?? 0, delay: Math.max(30, typeof c.get('delay')?.value === 'number' ? c.get('delay').value : 100) };
        this.written.set(c, sp);
        this.pixels.set(rel, { w, h, rgba });
        res.push(sp);
      } catch (e) {
        this.d.warn(`login scene: cannot decode ${name}/${i}: ${(e as Error).message}`);
      }
    }
    return res;
  }

  /** A contact sheet of the labelled Login.img pieces (rows of the creator, info boards, buttons) as a base64 PNG (LOGIN-UI-PNG lines). */
  private dumpSheet(ui: Record<string, LoginSprite>) {
    const keys = Object.keys(ui).filter((k) => /^(NewChar\/(avatarSel\/\d+\/normal|statTb|charAlert|BtCheck\/normal\/0|BtYes\/normal\/0|BtNo\/normal\/0|dice\/0|scroll\/0\/3)|CharSelect\/(charInfo1|icon\/job\/\d)|Common\/(selectWorld|Bt\w+\/normal\/0)|WorldSelect\/BtWorld\/[0-9]\/normal\/0)$/.test(k));
    const items = keys.map((k) => ({ k, px: this.pixels.get(ui[k].src) })).filter((x) => x.px);
    const W = 520, gap = 4;
    let x = 0, y = 0, rowH = 0;
    const pos: [number, number][] = [];
    for (const it of items) {
      if (x + it.px!.w > W) { x = 0; y += rowH + gap; rowH = 0; }
      pos.push([x, y]);
      x += it.px!.w + gap;
      rowH = Math.max(rowH, it.px!.h);
    }
    const H = y + rowH;
    if (!items.length || H > 2000) return;
    const all = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { all[i * 4] = 90; all[i * 4 + 1] = 90; all[i * 4 + 2] = 110; all[i * 4 + 3] = 255; }
    items.forEach((it, n) => {
      const px = it.px!, [ox, oy] = pos[n];
      for (let yy = 0; yy < px.h; yy++)
        for (let xx = 0; xx < px.w; xx++) {
          const s = (yy * px.w + xx) * 4, a = px.rgba[s + 3] / 255, o = ((oy + yy) * W + ox + xx) * 4;
          for (let c = 0; c < 3; c++) all[o + c] = px.rgba[s + c] * a + all[o + c] * (1 - a);
        }
    });
    this.d.log(`login ui sheet (left to right, top to bottom): ${items.map((it, n) => `${it.k}@${pos[n].join(',')}`).join(' ')}`);
    const b64 = encodePng(W, H, all).toString('base64');
    for (let i = 0; i < b64.length; i += 3000) console.log(`LOGIN-UI-PNG ${b64.slice(i, i + 3000)}`);
  }

  /** Renders the camera view at each step at half size, as one base64 PNG in the log. */
  private dumpPreview(scene: LoginSection) {
    const views: [string, number, number][] = Object.entries(scene.steps).map(([k, p]) => [k, p!.x, p!.y]);
    const S = 2;
    const W = 800 / S, H = 600 / S;
    const all = Buffer.alloc(W * H * views.length * 4);
    views.forEach(([, cx, cy], vi) => {
      for (const p of placements(scene, cx, cy, 0)) {
        const px = this.pixels.get(p.sprite.src);
        if (!px) continue;
        for (let yy = 0; yy < H; yy++) {
          const sy = yy * S - p.y;
          if (sy < 0 || sy >= px.h) continue;
          for (let xx = 0; xx < W; xx++) {
            let sx = xx * S - p.x;
            if (sx < 0 || sx >= px.w) continue;
            if (p.flip) sx = px.w - 1 - sx;
            const s = (Math.floor(sy) * px.w + Math.floor(sx)) * 4;
            const a = (px.rgba[s + 3] / 255) * p.alpha;
            if (!a) continue;
            const o = ((vi * H + yy) * W + xx) * 4;
            for (let c = 0; c < 3; c++) all[o + c] = px.rgba[s + c] * a + all[o + c] * (1 - a);
            all[o + 3] = 255;
          }
        }
      }
    });
    this.d.log(`login scene preview views (top to bottom): ${views.map(([k, x, y]) => `${k}@${x},${y}`).join(' ')}`);
    const b64 = encodePng(W, H * views.length, all).toString('base64');
    for (let i = 0; i < b64.length; i += 3000) console.log(`LOGIN-MAP-PNG ${b64.slice(i, i + 3000)}`);
    console.log('LOGIN-MAP-PNG-END');
  }
}

/** Camera centres of the steps from the object groups named after them (Obj/login.img/<Title|WorldSelect|CharSelect|NewChar>). */
function findSteps(groups: Map<string, { x0: number; y0: number; x1: number; y1: number }>, log: (...a: unknown[]) => void): LoginSection['steps'] {
  const want: [LoginStep, RegExp][] = [['title', /^title$/i], ['world', /^worldselect$/i], ['select', /^charselect$/i], ['create', /^newchar$/i]];
  const steps: LoginSection['steps'] = {};
  for (const [step, re] of want) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [k, g] of groups) {
      const l0 = k.split('/')[1] ?? '';
      if (!re.test(l0)) continue;
      x0 = Math.min(x0, g.x0); y0 = Math.min(y0, g.y0); x1 = Math.max(x1, g.x1); y1 = Math.max(y1, g.y1);
    }
    if (!Number.isFinite(x0)) continue;
    // the client's camera rows are one 800x600 screen apart (title at 0,0, then 600 px further up per step): snap to them
    steps[step] = { x: 0, y: Math.round((y0 + y1) / 2 / 600) * 600 || 0 };
    log(`login scene: step ${step} from objects spanning x ${x0}..${x1} y ${y0}..${y1}`);
  }
  return steps;
}
