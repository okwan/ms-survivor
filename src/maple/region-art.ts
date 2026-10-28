/**
 * Pixi-side loader for the per-region art (manifest `regions`, see scripts/fetch-maple-regions.ts): ground texture, decor
 * animations grouped by size class, music and banner names. A region the extractor could not build reuses the nearest earlier
 * one (or the first), so the runtime always has seven.
 */
import { ImageSource, Texture } from 'pixi.js';
import { REGION_WANTS } from './region-data.ts';
import type { RegionEntry } from './region-types.ts';
import type { MapleManifest } from './assets.ts';
import { makeAnim } from './art.ts';
import type { Anim } from './art.ts';
import type { Have } from '../render/cluster.ts';

export interface DecorObj {
  anim: Anim;
  w: number;
  h: number;
}

export interface RegionArt {
  index: number;
  /** banner lines (street name over map name) */
  street: string;
  name: string;
  /** null: the renderer's default ground */
  ground: Texture | null;
  groundColor: number;
  /** decor by size class: [big, medium, small] */
  bySize: [DecorObj[], DecorObj[], DecorObj[]];
  have: Have;
  /** largest decor frame, for culling margins */
  maxW: number;
  maxH: number;
  /** track URL, or null for the run track */
  bgm: string | null;
}

/** Never throws. Returns seven regions, or [] when the manifest has none. */
export async function buildRegionArt(m: MapleManifest, base: string, atlas: (path: string) => Promise<ImageSource | null>): Promise<RegionArt[]> {
  const list = m.regions?.list;
  if (!list?.length) return [];
  const built: (RegionArt | null)[] = await Promise.all(
    REGION_WANTS.map(async (_, i) => {
      const e: RegionEntry | null | undefined = list[i];
      if (!e) return null;
      try {
        return await one(e, base, atlas);
      } catch {
        return null;
      }
    }),
  );
  const first = built.find((r) => r);
  if (!first) return [];
  const out: RegionArt[] = [];
  let last: RegionArt = first;
  built.forEach((r, i) => {
    if (r) {
      last = r;
      out.push(r);
    } else {
      // reuse the look of the nearest earlier region, but keep the area's own name for the banner
      const street = REGION_WANTS[i].label.split(' / ')[0];
      out.push({ ...last, index: i, street, name: '' });
    }
  });
  return out;
}

async function one(e: RegionEntry, base: string, atlas: (path: string) => Promise<ImageSource | null>): Promise<RegionArt> {
  const a: RegionArt = {
    index: e.index,
    street: e.street,
    name: e.name,
    ground: null,
    groundColor: 0x4f9a3c,
    bySize: [[], [], []],
    have: { big: false, medium: false, small: false },
    maxW: 0,
    maxH: 0,
    bgm: e.bgm ? base + e.bgm : null,
  };
  if (e.ground) {
    const src = await atlas(e.ground.image);
    if (src) {
      a.ground = new Texture({ source: src });
      const [r, g, b] = e.ground.avg;
      a.groundColor = (r << 16) | (g << 8) | b;
    }
  }
  if (e.objects) {
    const src = await atlas(e.objects.atlas);
    if (src)
      for (const it of e.objects.items) {
        const anim = makeAnim(src, e.objects.frames, it.key);
        if (!anim) continue;
        a.bySize[it.size === 'big' ? 0 : it.size === 'medium' ? 1 : 2].push({ anim, w: it.w, h: it.h });
        a.maxW = Math.max(a.maxW, ...anim.tex.map((t) => t.width));
        a.maxH = Math.max(a.maxH, ...anim.tex.map((t) => t.height));
      }
  }
  a.have = { big: a.bySize[0].length > 0, medium: a.bySize[1].length > 0, small: a.bySize[2].length > 0 };
  return a;
}
