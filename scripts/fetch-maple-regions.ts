// Run regions of the deploy-time asset step (called from fetch-maple.ts): for each of the seven regions of a run one real field
// map is chosen (src/maple/region-data.ts lists the candidates) and its ground texture, nature decor, music and display name
// are extracted. Nothing is hardcoded about the real WZ contents beyond that list: the dominant tile set, the decor filter and the
// size classes are decided here from what the map actually uses, and every decision is logged ("maple: ..." plus ASCII previews)
// so the CI log shows what was picked. Never throws; a region without a usable map is null and the game reuses another.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BIG, Placements, clusterAt } from '../src/render/cluster.ts';
import { BIG_MIN_H, DECOR_CAP, DECOR_EXCLUDE, DECOR_INCLUDE, REGION_WANTS, SMALL_MAX_H, mapImagePath } from '../src/maple/region-data.ts';
import type { DecorSize, RegionEntry, RegionObj, RegionsSection } from '../src/maple/region-types.ts';
import { asciiPreview } from './png.mjs';
import { worldTools } from './fetch-maple-world.ts';
import type { Px, SetLike, WorldDeps } from './fetch-maple-world.ts';
import { childOf, decodeSound } from './wz-audio.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface RegionDeps extends Omit<WorldDeps, 'sets'> {
  sets: { Map: SetLike | null; String: SetLike | null; Sound: SetLike | null };
  sniffAudio: (b: Buffer) => { ext: string; data: Buffer; what: string };
}

export interface RegionsResult {
  manifest: { regions?: RegionsSection };
  bytes: number;
}

const MAX_OBJ_W = 480;
const MAX_OBJ_H = 520;
const MAX_ATLAS_H = 4096;
/** per size class, before leftover slots are filled by usage */
const QUOTA: Record<DecorSize, number> = { big: 5, medium: 5, small: 4 };
const isNum = (k: string) => /^\d+$/.test(k);

interface ObjRef { oS: string; l0: string; l1: string; l2: string; n: number }
interface MapInfo {
  tiles: number;
  tileSets: Map<string, number>;
  /** bsc variant usage per tile set */
  bsc: Map<string, Map<number, number>>;
  objs: Map<string, ObjRef>;
  bgm: string;
}

function analyse(root: Any): MapInfo {
  const info: MapInfo = { tiles: 0, tileSets: new Map(), bsc: new Map(), objs: new Map(), bgm: '' };
  const bgm = root.get('info/bgm')?.value;
  if (typeof bgm === 'string') info.bgm = bgm;
  for (const L of root.keys().filter(isNum)) {
    const layer = root.get(L);
    const tS = layer.get('info/tS')?.value;
    const tiles = layer.get('tile');
    for (const k of tiles?.keys() ?? []) {
      const t = tiles.get(k);
      info.tiles++;
      if (typeof tS !== 'string' || !tS) continue;
      info.tileSets.set(tS, (info.tileSets.get(tS) ?? 0) + 1);
      const no = t?.get('no')?.value;
      if (t?.get('u')?.value === 'bsc' && typeof no === 'number') {
        const m = info.bsc.get(tS) ?? info.bsc.set(tS, new Map()).get(tS)!;
        m.set(no, (m.get(no) ?? 0) + 1);
      }
    }
    const objs = layer.get('obj');
    for (const k of objs?.keys() ?? []) {
      const o = objs.get(k);
      const v = ['oS', 'l0', 'l1', 'l2'].map((n) => o?.get(n)?.value);
      if (v.some((x) => typeof x !== 'string' && typeof x !== 'number')) continue;
      const key = v.join('/');
      const e = info.objs.get(key) ?? { oS: String(v[0]), l0: String(v[1]), l1: String(v[2]), l2: String(v[3]), n: 0 };
      e.n++;
      info.objs.set(key, e);
    }
  }
  return info;
}

/** String.wz Map.img: <category>/<map id>/{streetName,mapName} -> id -> names */
function mapNames(d: RegionDeps): Map<number, { street: string; name: string }> {
  const out = new Map<number, { street: string; name: string }>();
  const img = d.sets.String?.image('Map.img');
  if (!img) {
    d.warn(`String.wz has no Map.img (images: ${d.sets.String?.names().slice(0, 12).join(' ') ?? 'String.wz missing'}); region banners stay empty`);
    return out;
  }
  for (const cat of img.root.keys()) {
    const c = img.root.get(cat);
    for (const id of c?.keys?.() ?? []) {
      if (!isNum(id)) continue;
      const n = c.get(id);
      const street = n?.get('streetName')?.value, name = n?.get('mapName')?.value;
      out.set(Number(id), { street: typeof street === 'string' ? street : '', name: typeof name === 'string' ? name : '' });
    }
  }
  d.log(`String.wz Map.img: ${img.root.keys().length} categories (${img.root.keys().slice(0, 8).join(' ')}), ${out.size} map names`);
  return out;
}

const classOf = (h: number): DecorSize => (h >= BIG_MIN_H ? 'big' : h <= SMALL_MAX_H ? 'small' : 'medium');

/** Draws frame `f` with its origin at (x, y) over an opaque RGBA canvas. */
function blit(dst: Buffer, W: number, H: number, f: Px, x: number, y: number) {
  const x0 = Math.round(x - f.ox), y0 = Math.round(y - f.oy);
  for (let j = 0; j < f.h; j++) {
    const dy = y0 + j;
    if (dy < 0 || dy >= H) continue;
    for (let i = 0; i < f.w; i++) {
      const dx = x0 + i;
      if (dx < 0 || dx >= W) continue;
      const s = (j * f.w + i) * 4, o = (dy * W + dx) * 4, a = f.rgba[s + 3];
      if (!a) continue;
      for (let c = 0; c < 3; c++) dst[o + c] = (f.rgba[s + c] * a + dst[o + c] * (255 - a)) / 255;
    }
  }
}

export function buildRegions(d: RegionDeps): RegionsResult {
  const res: RegionsResult = { manifest: {}, bytes: 0 };
  const wz = d.sets.Map;
  if (!wz) {
    d.warn('Map.wz is not available: no run regions, the game keeps the single ground');
    return res;
  }
  const tools = worldTools({ ...d, sets: { Map: wz, Effect: null, UI: null } });
  const names = mapNames(d);
  const mapPaths = wz.names().filter((n) => /^map\/map\d\/\d{9}\.img$/i.test(n));
  d.log(`regions: Map.wz holds ${mapPaths.length} field maps`);
  const list: (RegionEntry | null)[] = [];
  const bgmFiles = new Map<string, string | null>();

  REGION_WANTS.forEach((want, index) => {
    try {
      list.push(region(index));
    } catch (e) {
      d.warn(`region ${index} ${want.label}: ${(e as Error).stack}`);
      list.push(null);
    }
  });

  function region(index: number): RegionEntry | null {
    const want = REGION_WANTS[index];
    let id = 0;
    let img: { root: Any; key: Any } | null = null;
    let info: MapInfo | null = null;
    const tried: string[] = [];
    for (const c of want.candidates) {
      const im = wz!.image(mapImagePath(c));
      if (!im) { tried.push(`${c} absent`); continue; }
      const inf = analyse(im.root);
      if (!inf.tiles) { tried.push(`${c} no tiles (keys ${im.root.keys().slice(0, 10).join(',')})`); continue; }
      id = c; img = im; info = inf;
      break;
    }
    if (!img || !info) {
      // scan for the first map of the area: String.wz street name, lowest id first
      const hits = mapPaths
        .map((p) => ({ p, id: Number(p.slice(-13, -4)) }))
        .filter((m) => want.street.test(names.get(m.id)?.street ?? ''))
        .sort((a, b) => a.id - b.id);
      d.log(`region ${index} ${want.label}: candidates failed (${tried.join('; ')}); street scan found ${hits.length} maps${hits.length ? ` (${hits.slice(0, 6).map((h) => h.id).join(' ')})` : ''}`);
      for (const h of hits) {
        const im = wz!.image(h.p);
        const inf = im ? analyse(im.root) : null;
        if (im && inf?.tiles) { id = h.id; img = im; info = inf; break; }
      }
    }
    if (!img || !info) {
      d.warn(`region ${index} ${want.label}: no map with tiles found; the game reuses another region here`);
      return null;
    }

    const nm = names.get(id) ?? { street: '', name: '' };
    const ranked = [...info.tileSets].sort((a, b) => b[1] - a[1]);
    d.log(`region ${index} ${want.label}: map ${id} "${nm.street}" / "${nm.name}", top-level ${img.root.keys().join(' ')}; tile sets ${ranked.map(([k, n]) => `${k}=${n}`).join(' ') || '-'} of ${info.tiles} tiles`);

    // ground from the dominant tile set that actually has a usable bsc piece
    let tileSet = ranked[0]?.[0] ?? 'grassySoil';
    let ground: RegionEntry['ground'] = null;
    for (const [ts] of ranked.length ? ranked : ([['grassySoil', 0]] as [string, number][])) {
      ground = tools.buildGround(wz!, ts, info.bsc.get(ts) ?? new Map(), `map/region-${index}-ground.png`);
      if (ground) { tileSet = ts; break; }
    }
    if (!ground) d.warn(`region ${index}: no ground for tile sets ${ranked.map((r) => r[0]).join(',') || '(none)'}; the renderer keeps its default ground here`);

    const objects = decor(index, wz!, info, ground?.avg ?? [79, 154, 60]);
    const bgm = music(index, info.bgm);
    const entry: RegionEntry = { index, mapId: id, street: nm.street, name: nm.name, tileSet, ground, objects, bgm };
    d.log(
      `region ${index} => map ${id}, "${nm.street}" / "${nm.name}", tS ${tileSet}, ${info.tiles} tiles, objects [${
        objects?.items.map((o) => `${o.key} ${o.w}x${o.h} ${o.size}`).join('; ') ?? 'none'
      }], bgm ${info.bgm || '-'}${bgm ? ` -> ${bgm}` : ''}`,
    );
    return entry;
  }

  function decor(index: number, wz: SetLike, info: MapInfo, avg: number[]): RegionEntry['objects'] {
    const ranked = [...info.objs.values()].sort((a, b) => b.n - a.n);
    // what the map offers, so a filter that is wrong for the real data shows up in the log
    const paths = new Map<string, number>();
    for (const o of ranked) paths.set(`${o.oS}/${o.l0}/${o.l1}`, (paths.get(`${o.oS}/${o.l0}/${o.l1}`) ?? 0) + o.n);
    d.log(`region ${index}: ${ranked.length} distinct objects; oS/l0/l1 seen: ${[...paths].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${k}x${n}`).join(' ') || '-'}`);
    const keep = ranked.filter((o) => {
      const segs = [o.oS, o.l0, o.l1, o.l2];
      return segs.some((s) => DECOR_INCLUDE.test(s)) && !segs.some((s) => DECOR_EXCLUDE.test(s));
    });
    d.log(`region ${index}: filter keeps ${keep.length} of ${ranked.length} objects`);

    const images = new Map<string, { root: Any; key: Any } | null>();
    const skipped: string[] = [];
    const cand: { ref: ObjRef; key: string; frames: Px[]; size: DecorSize; w: number; h: number }[] = [];
    for (const o of keep) {
      const path = `Obj/${o.oS}.img`;
      if (!images.has(path)) images.set(path, wz.image(path));
      const im = images.get(path);
      const id = `${o.oS}/${o.l0}/${o.l1}/${o.l2}`;
      if (!im) { skipped.push(`${id} (no image)`); continue; }
      const node = im.root.get(`${o.l0}/${o.l1}/${o.l2}`);
      if (!node) { skipped.push(`${id} (no node; ${o.oS} top: ${im.root.keys().slice(0, 8).join(',')})`); continue; }
      const frames = d.canvasList(node).map((c: Any) => tools.px(c, im.key)).filter((p: Px | null): p is Px => !!p);
      if (!frames.length) { skipped.push(`${id} (no canvases; children ${node.keys().slice(0, 8).join(',')})`); continue; }
      const mw = Math.max(...frames.map((f) => f.w)), mh = Math.max(...frames.map((f) => f.h));
      if (mw > MAX_OBJ_W || mh > MAX_OBJ_H) { skipped.push(`${id} (${mw}x${mh} too big)`); continue; }
      if (mw < 8 || mh < 8) { skipped.push(`${id} (${mw}x${mh} too small)`); continue; }
      cand.push({ ref: o, key: `${o.oS}.${o.l0}.${o.l1}.${o.l2}`, frames, size: classOf(mh), w: frames[0].w, h: frames[0].h });
    }
    if (skipped.length) d.log(`region ${index}: objects skipped (${skipped.length}): ${skipped.slice(0, 20).join('; ')}${skipped.length > 20 ? ' ...' : ''}`);
    // per size class quota by usage, then the leftover slots by usage
    const picked: typeof cand = [];
    const count: Record<DecorSize, number> = { big: 0, medium: 0, small: 0 };
    for (const c of cand) if (count[c.size] < QUOTA[c.size]) { picked.push(c); count[c.size]++; }
    for (const c of cand) if (picked.length < DECOR_CAP && !picked.includes(c)) picked.push(c);
    picked.length = Math.min(picked.length, DECOR_CAP);
    if (!picked.length) {
      d.warn(`region ${index}: no usable nature decor (${keep.length} passed the filter); the region has ground only`);
      return null;
    }
    let use = picked;
    const pack = () => d.packAtlas(use.flatMap((p) => p.frames.map((f, i) => ({ action: p.key, index: i, w: f.w, h: f.h, ox: f.ox, oy: f.oy, delay: f.hasDelay ? f.delay : 100, rgba: f.rgba, id: f.id }))));
    let atlas = pack();
    while (atlas && atlas.h > MAX_ATLAS_H && use.length > 1) {
      use = use.slice(0, -1);
      atlas = pack();
    }
    if (!atlas) return null;
    const rel = tools.write(`map/region-${index}-objects.png`, atlas.w, atlas.h, atlas.rgba);
    d.log(`region ${index}: decor atlas ${rel} ${atlas.w}x${atlas.h}, ${use.length} objects (${use.filter((u) => u.size === 'big').length} big, ${use.filter((u) => u.size === 'medium').length} medium, ${use.filter((u) => u.size === 'small').length} small), ${atlas.recs.length} frames`);
    const items: RegionObj[] = use.map((u) => ({ key: u.key, w: u.w, h: u.h, size: u.size }));
    preview(index, use, avg);
    return { atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs, items };
  }

  /** ASCII picture of one decor cluster as the game lays it out */
  function preview(index: number, use: { frames: Px[]; size: DecorSize }[], avg: number[]) {
    const have = { big: use.some((u) => u.size === 'big'), medium: use.some((u) => u.size === 'medium'), small: use.some((u) => u.size === 'small') };
    const by = (s: DecorSize) => use.filter((u) => u.size === s);
    const pool = [by('big'), by('medium'), by('small')];
    const pl = new Placements();
    let cx = 0;
    for (; cx < 60; cx++) { clusterAt(cx, 0, index, have, pl); if (pl.n >= 3) break; }
    if (pl.n < 1) return;
    const W = 460, H = 380;
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = avg[0]; rgba[i * 4 + 1] = avg[1]; rgba[i * 4 + 2] = avg[2]; rgba[i * 4 + 3] = 255; }
    const order = [...Array(pl.n).keys()].sort((a, b) => pl.y[a] - pl.y[b]);
    for (const i of order) {
      const g = pool[pl.cls[i]].length ? pool[pl.cls[i]] : use;
      const o = g[Math.min(g.length - 1, Math.floor(pl.pick[i] * g.length))];
      blit(rgba, W, H, o.frames[0], W / 2 + (pl.x[i] - pl.x[0]), 250 + (pl.y[i] - pl.y[0]));
    }
    console.log(`--- region ${index} decor cluster (${pl.n} objects) ${W}x${H} ---\n${asciiPreview(W, H, rgba, 46)}`);
  }

  function music(index: number, bgm: string): string | null {
    if (!bgm) return null;
    if (bgmFiles.has(bgm)) return bgmFiles.get(bgm)!;
    let out: string | null = null;
    try {
      const [a, b] = bgm.split('/');
      const sound = d.sets.Sound;
      const img = sound && (sound.image(`${a}.img`) ?? sound.image(a));
      const node = img && b ? childOf(img.root, [b]) : null;
      if (!node || node.type !== 'sound') {
        d.warn(`region ${index} bgm "${bgm}": ${!sound ? 'Sound.wz missing' : !img ? `no image ${a}.img (BGM images: ${sound.names().filter((n) => /bgm/i.test(n)).join(' ') || 'none'})` : `no sound node "${b}"; has ${img.root.keys().slice(0, 40).join(', ')}`}`);
      } else {
        const s = decodeSound(node, d.sniffAudio);
        if (s) {
          const rel = `bgm/region-${index}.${s.ext}`;
          const path = join(d.dist, 'maple', rel);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, s.data);
          res.bytes += s.data.length;
          out = rel;
          d.log(`region ${index} bgm ${bgm} -> ${rel}, ${(s.data.length / 1e6).toFixed(2)} MB, ${s.what}`);
        }
      }
    } catch (e) {
      d.warn(`region ${index} bgm "${bgm}": ${(e as Error).stack}`);
    }
    bgmFiles.set(bgm, out);
    return out;
  }

  res.bytes += tools.out.bytes;
  const found = list.filter((r): r is RegionEntry => !!r);
  d.log(`regions totals: ${found.length}/${REGION_WANTS.length} regions, ground ${found.filter((r) => r.ground).length}, decor ${found.filter((r) => r.objects).length}, bgm ${found.filter((r) => r.bgm).length} (${new Set(found.map((r) => r.bgm).filter(Boolean)).size} distinct)`);
  if (found.length) res.manifest.regions = { list };
  return res;
}
