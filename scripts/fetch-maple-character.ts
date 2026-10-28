// Deploy-time extractor for the player character (called from scripts/fetch-maple.ts): reads Character.wz and Base.wz and writes
// dist/maple/avatar/<slot>-<id>.{png,json} per item plus the "avatar" manifest block (zmap order, item lists).
// Never throws: every problem is a log line starting with "maple:" and the game falls back to its placeholder hero.
//
// Layout facts this relies on (from the CI dump of the MapleSaga v62 client; where the dump was not deep enough the code is
// defensive and logs what it finds):
//   Character.wz/00002000.img      body:  <action>/<frame>/{body,arm,hand,...: canvas, delay, face}; canvas = origin, z, map{navel,neck,hand..}
//   Character.wz/00012000.img      head:  front/head, and <action>/<frame>/head -> UOL ../../front/head
//   Character.wz/Face/*.img        face:  default/face (+ expression/frame/face)
//   Character.wz/Hair/*.img        hair:  default/{hair,hairOverHead,hairShade}, backDefault/{backHair,...}, <action>/<frame>/hair -> UOL ../../default/hair
//   Character.wz/{Coat,Longcoat,Pants,Shoes,Weapon}/*.img  <action>/<frame>/{mail,mailArm | pants | shoes | weapon}
//   Base.wz/zmap.img               layer names, front-most first
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASSES } from '../src/game/data.ts';
import { AVATAR_ACTIONS, SLOTS, emptyItems, SLOT_FOLDERS, compose, framesOf, itemFile, rasterize, stanceActions, wantedItems, zDepthTable, defaultLook, lookItems } from '../src/maple/avatar-core.ts';
import type { AvatarManifest, FrameData, ItemJson, LayerRec, Part, Placed, Slot, Vec } from '../src/maple/avatar-core.ts';
import { asciiPreview, encodePng } from './png.mjs';
import { canvasRgba } from './wz.mjs';
import { extractGear, previewGear } from './fetch-maple-gear.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** The part of fetch-maple.ts's WzSet used here. */
export interface WzLike {
  image(path: string): { root: Any; key: Any } | null;
  names(): string[];
}
export interface Logger {
  log(...a: unknown[]): void;
  warn(...a: unknown[]): void;
}

const isNum = (k: string) => /^\d+$/.test(k);
const byNum = (a: string, b: string) => Number(a) - Number(b);

interface Decoded {
  w: number;
  h: number;
  rgba: Buffer;
}
interface Pending {
  canvas: Any;
  dec: Decoded;
}
interface RawLayer {
  rec: LayerRec;
  canvas: Any;
}

function vecOf(p: Any): Vec | null {
  const v = p?.resolve?.()?.value;
  return v && typeof v.x === 'number' && typeof v.y === 'number' ? [v.x, v.y] : null;
}

/** Frame nodes of an action: its numbered children, or the node itself when it holds canvases directly (hair/face "default"). */
export function frameNodes(node: Any): Any[] {
  if (!node) return [];
  const n = node.resolve ? node.resolve() : node;
  if (!n?.children) return [];
  const nums = n.keys().filter(isNum).sort(byNum);
  const frames = nums.map((k: string) => n.child(k)?.resolve()).filter((f: Any) => f?.children);
  if (frames.length) return frames;
  for (const k of n.keys()) if (n.child(k)?.resolve()?.type === 'canvas') return [n];
  return [];
}

export function shelfPack(items: Decoded[]): { w: number; h: number; pos: { x: number; y: number }[]; rgba: Buffer } {
  const area = items.reduce((a, f) => a + (f.w + 1) * (f.h + 1), 0);
  const widest = Math.max(1, ...items.map((f) => f.w + 2));
  const W = Math.min(1024, Math.max(widest, 2 ** Math.ceil(Math.log2(Math.max(16, Math.sqrt(area * 1.3))))));
  const order = items.map((_, i) => i).sort((a, b) => items[b].h - items[a].h || items[b].w - items[a].w);
  const pos: { x: number; y: number }[] = new Array(items.length);
  let x = 1;
  let y = 1;
  let rowH = 0;
  for (const i of order) {
    const f = items[i];
    if (x + f.w + 1 > W) {
      x = 1;
      y += rowH + 1;
      rowH = 0;
    }
    pos[i] = { x, y };
    x += f.w + 1;
    rowH = Math.max(rowH, f.h);
  }
  const H = y + rowH + 1;
  const rgba = Buffer.alloc(W * H * 4);
  items.forEach((f, i) => {
    for (let r = 0; r < f.h; r++) f.rgba.copy(rgba, ((pos[i].y + r) * W + pos[i].x) * 4, r * f.w * 4, (r + 1) * f.w * 4);
  });
  return { w: W, h: H, pos, rgba };
}

export interface ExtractedItem {
  json: ItemJson;
  atlas: { w: number; h: number; rgba: Buffer };
  bytes: number;
  summary: string;
}

/** Reads one part image into an ItemJson + atlas. Exported for the tests. */
export function extractItem(root: Any, key: Any, slot: Slot, id: string, problems: string[]): ExtractedItem | null {
  const decoded = new Map<Any, Decoded | null>();
  const decode = (c: Any): Decoded | null => {
    if (decoded.has(c)) return decoded.get(c)!;
    let d: Decoded | null = null;
    try {
      const [w, h, rgba] = canvasRgba(c, key);
      if (w > 0 && h > 0) d = { w, h, rgba };
    } catch (e) {
      problems.push(`${(e as Error).message}`);
    }
    decoded.set(c, d);
    return d;
  };

  const wantActions = slot === 'face' || slot === 'hair' ? ['default', ...AVATAR_ACTIONS] : AVATAR_ACTIONS;
  const raw = new Map<string, { delay: number; face?: number; layers: RawLayer[] }[]>();
  const counts: string[] = [];
  for (const action of wantActions) {
    const node = root.get(action);
    const fns = frameNodes(node);
    if (!fns.length) continue;
    const frames = fns.map((fn: Any) => {
      const layers: RawLayer[] = [];
      for (const name of fn.keys()) {
        const c = fn.child(name)?.resolve();
        if (!c || c.type !== 'canvas') continue;
        const d = decode(c);
        if (!d) continue;
        const o = c.get('origin')?.value;
        const map: Record<string, Vec> = {};
        const mp = c.get('map');
        for (const mk of mp?.keys?.() ?? []) {
          const v = vecOf(mp.child(mk));
          if (v) map[mk] = v;
        }
        const zv = c.get('z')?.value;
        layers.push({
          canvas: c,
          rec: { n: name, z: typeof zv === 'string' && zv ? zv : name, x: 0, y: 0, w: d.w, h: d.h, ox: o?.x ?? 0, oy: o?.y ?? 0, m: map },
        });
      }
      const delay = fn.num ? fn.num('delay', 100) : 100;
      const face = slot === 'body' && typeof fn.get('face')?.value === 'number' ? (fn.get('face').value as number) : undefined;
      return { delay, face, layers };
    });
    const nonEmpty = frames.filter((f: Any) => f.layers.length);
    if (!nonEmpty.length) continue;
    raw.set(action, nonEmpty);
    counts.push(`${action}:${nonEmpty.length}`);
  }
  if (!raw.size) return null;

  // pack every distinct canvas once
  const canv: Any[] = [];
  const dec: Decoded[] = [];
  for (const frames of raw.values())
    for (const f of frames)
      for (const l of f.layers)
        if (!canv.includes(l.canvas)) {
          canv.push(l.canvas);
          dec.push(decoded.get(l.canvas)!);
        }
  const atlas = shelfPack(dec);
  const actions: Record<string, FrameData[] | string> = {};
  const seen = new Map<string, string>();
  for (const [action, frames] of raw) {
    const out: FrameData[] = frames.map((f) => ({
      d: Math.round(f.delay),
      ...(f.face !== undefined ? { f: f.face } : {}),
      l: f.layers.map((l) => {
        const p = atlas.pos[canv.indexOf(l.canvas)];
        return { ...l.rec, x: p.x, y: p.y };
      }),
    }));
    const sig = JSON.stringify(out);
    const same = seen.get(sig);
    if (same) actions[action] = same;
    else {
      seen.set(sig, action);
      actions[action] = out;
    }
  }
  const info: Record<string, string | number> = {};
  for (const k of ['islot', 'vslot', 'attackSpeed', 'cash']) {
    const v = root.get(`info/${k}`)?.value;
    if (typeof v === 'string' || typeof v === 'number') info[k] = v;
  }
  const png = encodePng(atlas.w, atlas.h, atlas.rgba);
  const json: ItemJson = { id, slot, size: [atlas.w, atlas.h], actions, info };
  return { json, atlas: { w: atlas.w, h: atlas.h, rgba: atlas.rgba }, bytes: png.length + JSON.stringify(json).length, summary: `${counts.join(' ')} -> ${atlas.w}x${atlas.h}` };
}

const describeLayer = (l: LayerRec) => `${l.n}[z=${l.z} ${l.w}x${l.h} origin=${l.ox},${l.oy} map=${Object.entries(l.m).map(([k, v]) => `${k}:${v[0]},${v[1]}`).join(' ') || '-'}]`;

/**
 * Extracts the avatar items. Returns the manifest block (or null when no body and head could be read) and the bytes written.
 * `outDir` is the maple/ folder (avatar files go to <outDir>/avatar/).
 */
export function extractAvatar(character: WzLike | null, base: WzLike | null, outDir: string, lg: Logger, strings: WzLike | null = null): { manifest: AvatarManifest | null; bytes: number; previewPng: Buffer | null } {
  const { log, warn } = lg;
  let bytes = 0;
  try {
    if (!character) {
      warn('avatar: Character.wz not available; the hero keeps the placeholder look');
      return { manifest: null, bytes, previewPng: null };
    }
    // ---- zmap / smap ----
    let zmap: string[] = [];
    const zimg = base?.image('zmap.img');
    if (zimg) {
      zmap = zimg.root.keys();
      const t = zDepthTable(zmap);
      const names = ['hairOverHead', 'face', 'head', 'hair', 'arm', 'weapon', 'mailChest', 'pants', 'shoes', 'body', 'backHair'];
      log(`avatar: zmap.img has ${zmap.length} layers, ${t.frontFirst ? 'front-most first' : 'back-most first (REVERSED)'}; indices ${names.map((n) => `${n}=${zmap.indexOf(n)}`).join(' ')}`);
      log(`avatar: zmap first 12: ${zmap.slice(0, 12).join(' ')}`);
      const simg = base?.image('smap.img');
      if (simg) log(`avatar: smap.img slots: ${['hair', 'hairOverHead', 'cap', 'face', 'mailChest', 'pants', 'shoes', 'weapon', 'arm', 'body', 'head'].map((n) => `${n}=${simg.root.get(n)?.value ?? '-'}`).join(' ')}`);
    } else {
      warn(`avatar: Base.wz zmap.img not found${base ? ` (images: ${base.names().slice(0, 12).join(' ')})` : ' (no Base.wz)'}; using a built-in layer order`);
      zmap = FALLBACK_ZMAP;
    }
    const z = zDepthTable(zmap);

    // ---- items ----
    const want = wantedItems();
    const have = emptyItems();
    const loaded = new Map<string, ExtractedItem>();
    const missing: string[] = [];
    const dir = join(outDir, 'avatar');
    mkdirSync(dir, { recursive: true });
    const layerLogged = new Set<Slot>();
    for (const slot of SLOTS) {
      for (const id of want[slot]) {
        let found: { root: Any; key: Any } | null = null;
        let where = '';
        for (const folder of SLOT_FOLDERS[slot]) {
          where = folder ? `${folder}/${id}.img` : `${id}.img`;
          found = character.image(where);
          if (found) break;
        }
        if (!found) {
          missing.push(`${slot}/${id}`);
          continue;
        }
        try {
          const problems: string[] = [];
          const it = extractItem(found.root, found.key, slot, id, problems);
          for (const p of problems.slice(0, 2)) warn(`avatar ${where}: ${p}`);
          if (!it) {
            missing.push(`${slot}/${id} (no frames; children: ${found.root.keys().slice(0, 12).join(',')})`);
            continue;
          }
          writeFileSync(join(dir, itemFile(slot, id, 'png')), encodePng(it.atlas.w, it.atlas.h, it.atlas.rgba));
          writeFileSync(join(dir, itemFile(slot, id, 'json')), JSON.stringify(it.json));
          bytes += it.bytes;
          have[slot].push(id);
          loaded.set(`${slot}/${id}`, it);
          log(`avatar ${slot} ${id} (${where}): ${it.summary}`);
          if (!layerLogged.has(slot)) {
            layerLogged.add(slot);
            const fr = framesOf(it.json, 'stand1') ?? framesOf(it.json, 'default');
            if (fr) log(`avatar layers of ${slot} ${id} ${framesOf(it.json, 'stand1') ? 'stand1' : 'default'}/0: ${fr[0].l.map(describeLayer).join(' ')}`);
          }
        } catch (e) {
          warn(`avatar ${slot} ${id}: ${(e as Error).stack}`);
          missing.push(`${slot}/${id} (error)`);
        }
      }
    }
    const total = SLOTS.reduce((a, s) => a + have[s].length, 0);
    const wanted = SLOTS.reduce((a, s) => a + want[s].length, 0);
    log(`avatar: ${total}/${wanted} items extracted (${SLOTS.map((s) => `${s} ${have[s].length}/${want[s].length}`).join(', ')}), ${(bytes / 1e6).toFixed(2)} MB`);
    if (missing.length) log(`avatar: missing ${missing.length}: ${missing.slice(0, 60).join('; ')}${missing.length > 60 ? ' ...' : ''}`);
    if (!have.body.length || !have.head.length) {
      warn('avatar: no body or no head could be extracted; the hero keeps the placeholder look');
      return { manifest: null, bytes, previewPng: null };
    }
    const manifest: AvatarManifest = { version: 1, zmap, items: have, actions: AVATAR_ACTIONS, dir: 'avatar/' };

    // ---- droppable equipment (scripts/fetch-maple-gear.ts): its frame files join the item lists, its block is manifest.gear ----
    const gear = extractGear({ extractItem, frameNodes, shelfPack }, character, strings, dir, { log, warn }, loaded);
    bytes += gear.bytes;
    if (gear.manifest) {
      manifest.gear = gear.manifest;
      for (const [slot, ids] of Object.entries(gear.ids)) have[slot as Slot].push(...ids);
      for (const [k, v] of gear.items) loaded.set(k, v);
    }

    // ---- composite previews (same code as the browser) ----
    let previewPng: Buffer | null = null;
    try {
      for (const c of CLASSES) {
        const look = defaultLook(c.weapon);
        const ids = lookItems(look);
        const parts: Part[] = [];
        for (const slot of SLOTS) {
          const it = loaded.get(`${slot}/${ids[slot]}`);
          if (it) parts.push({ slot, item: it.json });
          else if (slot === 'weapon' || slot === 'coat') log(`avatar preview ${c.name}: ${slot} ${ids[slot]} not extracted`);
        }
        const wpn = parts.find((p) => p.slot === 'weapon')?.item ?? null;
        const st = stanceActions(c.stance, wpn);
        for (const action of [st.stand, st.walk, st.attack[0]]) {
          const comp = compose(parts, action, 0, z);
          if (!comp) {
            log(`avatar preview ${c.name} ${action}: body has no such action`);
            continue;
          }
          const anchored = comp.placed.filter((p) => p.anchor).length;
          log(`avatar preview ${c.name} ${action}/0: ${comp.placed.length} layers (${anchored} aligned by a map point, ${comp.placed.length - anchored} by origin), bbox x ${comp.minX.toFixed(0)}..${comp.maxX.toFixed(0)} y ${comp.minY.toFixed(0)}..${comp.maxY.toFixed(0)} relative to the feet, ${comp.frames} frames`);
        }
        if (c.key === 'warrior') {
          const comp = compose(parts, st.stand, 0, z);
          if (comp) {
            log('avatar preview warrior stand1/0 layers, back to front:');
            for (const p of comp.placed as Placed[]) log(`  ${p.slot.padEnd(6)} ${p.layer.n.padEnd(14)} z=${p.layer.z.padEnd(14)} depth=${String(p.depth).padStart(3)} at ${p.x.toFixed(0)},${p.y.toFixed(0)} ${p.layer.w}x${p.layer.h} by ${p.anchor ?? 'origin'}`);
            const r = rasterize(comp, (p) => {
              const it = loaded.get(`${p.slot}/${ids[p.slot]}`);
              return it ? { w: it.atlas.w, data: it.atlas.rgba } : null;
            });
            console.log(`--- warrior look stand1/0 ${r.w}x${r.h} (feet at ${r.ax.toFixed(0)},${r.ay.toFixed(0)}) ---\n${asciiPreview(r.w, r.h, Buffer.from(r.rgba), Math.min(80, r.w))}`);
            previewPng = encodePng(r.w, r.h, Buffer.from(r.rgba));
          }
        }
      }
      previewGear(gear, loaded, z, { log, warn });
    } catch (e) {
      warn(`avatar preview: ${(e as Error).stack}`);
    }
    return { manifest, bytes, previewPng };
  } catch (e) {
    warn(`avatar extraction failed: ${(e as Error).stack}`);
    return { manifest: null, bytes, previewPng: null };
  }
}

/** Used only when Base.wz is missing: the relevant layers of the real zmap, front-most first. */
export const FALLBACK_ZMAP = [
  'capOverHair', 'hairOverHead', 'cap', 'hair', 'accessoryEye', 'accessoryFace', 'accessoryEar', 'face', 'hairShade', 'head', 'cape', 'mailArm', 'glove', 'hand', 'arm', 'weapon', 'shield',
  'weaponOverBody', 'mailChestTop', 'pantsOverMailChest', 'mailChest', 'shoesTop', 'shoesOverPants', 'pants', 'shoes', 'body', 'hairBelowBody', 'weaponBelowBody', 'backHair', 'backWeapon',
];
