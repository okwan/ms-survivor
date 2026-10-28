// Deploy-time extractor for the Henesys shop keeper's portrait (called from buildAssets in scripts/fetch-maple.ts): Npc.wz
// Npc/<id>.img/stand/<n> -> npc/shop.png + the "npc" manifest section. The NPC is Rina, id 1012100 (likely, not verifiable from the
// sandbox): the id is checked against String.wz Npc.img/<id>/name and, when that name is not "Rina", the name is searched instead
// (a Henesys id, 1012xxx, first). With no String.wz the candidate id is used unchecked. Every miss logs the reason and leaves the shop
// on its placeholder silhouette. Never throws.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FrameRec } from '../src/maple/assets.ts';
import type { NpcSection } from '../src/maple/items-types.ts';
import { asciiPreview, encodePng } from './png.mjs';
import { namesOf } from './fetch-maple-items.ts';
import type { SetLike } from './fetch-maple-world.ts';
import { canvasRgba } from './wz.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface NpcDeps {
  dist: string;
  sets: { Npc: SetLike | null; String: SetLike | null };
  log: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  canvasList: (node: Any) => Any[];
  packAtlas: (frames: Any[]) => { w: number; h: number; rgba: Buffer; recs: FrameRec[] } | null;
}

export interface NpcResult {
  manifest: { npc?: NpcSection };
  bytes: number;
}

export const SHOP_NPC_ID = 1012100;
export const SHOP_NPC_NAME = 'Rina';
/** animations tried for the portrait, in order */
const STANDS = ['stand', 'stand0', 'say', 'speak'];
const MAX_FRAMES = 12;

/** The NPC id to extract and why: the candidate when String.wz names it Rina, else the Rina found by name, else null (a reason is logged). */
export function pickNpc(names: Map<number, string> | null, log: (...a: unknown[]) => void): number | null {
  if (!names) {
    log(`npc: no String.wz Npc.img; using ${SHOP_NPC_ID} unchecked`);
    return SHOP_NPC_ID;
  }
  const want = SHOP_NPC_NAME.toLowerCase();
  const nm = names.get(SHOP_NPC_ID);
  if (nm?.toLowerCase() === want) {
    log(`npc: ${SHOP_NPC_ID} is "${nm}" in String.wz`);
    return SHOP_NPC_ID;
  }
  log(`npc: MISMATCH ${SHOP_NPC_ID} is ${nm === undefined ? 'missing from' : `"${nm}" in`} String.wz Npc.img (${names.size} names); searching for "${SHOP_NPC_NAME}"`);
  const hits = [...names].filter(([, v]) => v.trim().toLowerCase() === want).map(([k]) => k).sort((a, b) => Number(String(b).startsWith('1012')) - Number(String(a).startsWith('1012')) || a - b);
  if (!hits.length) {
    log(`npc: no NPC named "${SHOP_NPC_NAME}" (first names: ${[...names].slice(0, 6).map(([k, v]) => `${k}=${v}`).join(', ')}); the shop shows a silhouette`);
    return null;
  }
  log(`npc: "${SHOP_NPC_NAME}" found as ${hits.join(', ')}; using ${hits[0]}`);
  return hits[0];
}

/** Never throws. */
export function buildNpc(d: NpcDeps): NpcResult {
  const res: NpcResult = { manifest: {}, bytes: 0 };
  try {
    const wz = d.sets.Npc;
    if (!wz) {
      d.warn('npc: Npc.wz is not available: the Henesys shop shows a silhouette instead of Rina');
      return res;
    }
    const sImg = d.sets.String?.image('Npc.img') ?? null;
    if (d.sets.String && !sImg) d.log(`npc: String.wz has no Npc.img (images: ${d.sets.String.names().slice(0, 12).join(' ')})`);
    const id = pickNpc(sImg ? namesOf(sImg) : null, d.log);
    if (id === null) return res;
    const img = wz.image(`${id}.img`) ?? wz.image(`Npc/${id}.img`) ?? wz.image(`${String(id).padStart(7, '0')}.img`);
    if (!img) {
      d.warn(`npc: no ${id}.img in Npc.wz (images: ${wz.names().slice(0, 12).join(' ') || 'none'}); the shop shows a silhouette`);
      return res;
    }
    d.log(`npc: ${id}.img keys: ${img.root.keys().slice(0, 16).join(',')}`);
    let src = STANDS.find((s) => d.canvasList(img.root.get(s)).length > 0);
    if (!src) src = img.root.keys().find((k: string) => k !== 'info' && d.canvasList(img.root.get(k)).length > 0);
    if (!src) {
      d.warn(`npc: ${id}.img has no animation with canvases (keys: ${img.root.keys().join(',')}); the shop shows a silhouette`);
      return res;
    }
    const raws: Any[] = [];
    let first: { w: number; h: number; rgba: Buffer } | null = null;
    for (const node of d.canvasList(img.root.get(src)).slice(0, MAX_FRAMES)) {
      try {
        const [w, h, rgba] = canvasRgba(node, img.key);
        if (w < 1 || h < 1) continue;
        const o = node.get('origin')?.value;
        const hasDelay = node.get('delay') !== undefined;
        raws.push({ action: 'stand', index: raws.length, w, h, ox: o?.x ?? 0, oy: o?.y ?? 0, delay: hasDelay ? Math.max(1, node.num('delay', 100)) : 150, rgba, id: node });
        first ??= { w, h, rgba };
      } catch (e) {
        d.warn(`npc: cannot decode canvas ${node.name}: ${(e as Error).message}`);
      }
    }
    if (!raws.length || !first) {
      d.warn(`npc: ${id}.img/${src} has no decodable canvas; the shop shows a silhouette`);
      return res;
    }
    console.log(`--- npc ${id} ${src}/0 ${first.w}x${first.h} ---\n${asciiPreview(first.w, first.h, first.rgba, Math.min(28, Math.max(8, first.w)))}`);
    const atlas = d.packAtlas(raws);
    if (!atlas) return res;
    const rel = 'npc/shop.png';
    const path = join(d.dist, 'maple', rel);
    mkdirSync(dirname(path), { recursive: true });
    const png = encodePng(atlas.w, atlas.h, atlas.rgba);
    writeFileSync(path, png);
    res.bytes = png.length;
    res.manifest = { npc: { id: String(id), name: sImg ? namesOf(sImg).get(id) ?? SHOP_NPC_NAME : SHOP_NPC_NAME, atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs } };
    d.log(`npc: ${id} ${src} <- ${raws.length} frames, atlas ${rel} ${atlas.w}x${atlas.h}`);
  } catch (e) {
    d.warn(`npc extraction failed: ${(e as Error).stack}`);
    return { manifest: {}, bytes: 0 };
  }
  return res;
}
