/**
 * Pixi-side loader for the art the deploy-time asset step wrote to maple/ (see scripts/fetch-maple.ts).
 * Every piece is optional: whatever fails to load is simply absent and the renderer keeps its placeholder for it.
 */
import { ImageSource, Rectangle, Texture } from 'pixi.js';
import { BOSSES, LADDER, PASSIVES, SKILLS } from '../game/data.ts';
import type { FrameRec, MapleManifest } from './assets.ts';

/** A frame sequence. cum[i] is the time (s) at which frame i ends; origin anchors are per frame (ratios of the frame size). */
export interface Anim {
  tex: Texture[];
  ax: number[];
  ay: number[];
  cum: number[];
  total: number;
}

export interface MobArt {
  stand: Anim | null;
  move: Anim | null;
  hit: Anim | null;
  die: Anim | null;
  attack: Anim | null;
}

export interface SkillArt {
  ball: Anim | null;
  hit: Anim | null;
  effect: Anim | null;
}

/** Index of the frame showing at time t (seconds); loops, or holds the last frame when `loop` is false. */
export function frameAt(a: Anim, t: number, loop = true): number {
  const n = a.tex.length;
  if (n === 1) return 0;
  if (loop) t %= a.total;
  else if (t >= a.total) return n - 1;
  for (let i = 0; i < n; i++) if (t < a.cum[i]) return i;
  return n - 1;
}

export class MapleArt {
  /** by ladder tier index, null where the mob has no extracted art */
  tiers: (MobArt | null)[] = [];
  /** by boss index */
  bosses: (MobArt | null)[] = [];
  /** attack skills by key */
  skills = new Map<string, SkillArt>();
  /** icon URLs by skill/passive key */
  icons: Record<string, string> = {};
  bgm: { run: string | null; title: string | null } = { run: null, title: null };
  counts = { mobs: 0, skills: 0, icons: 0 };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function makeAnim(source: ImageSource, frames: FrameRec[], action: string): Anim | null {
  const list = frames.filter((f) => f.action === action).sort((a, b) => a.index - b.index);
  if (!list.length) return null;
  const a: Anim = { tex: [], ax: [], ay: [], cum: [], total: 0 };
  for (const f of list) {
    a.tex.push(new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
    a.ax.push(f.ox / f.w);
    a.ay.push(f.oy / f.h);
    a.total += Math.max(30, f.delay) / 1000;
    a.cum.push(a.total);
  }
  return a;
}

/** Loads every atlas and icon the manifest lists. Never throws; missing pieces are left null/absent. */
export async function buildArt(m: MapleManifest, base = 'maple/'): Promise<MapleArt> {
  const art = new MapleArt();
  const sources = new Map<string, Promise<ImageSource | null>>();
  const atlas = (path: string) => {
    let p = sources.get(path);
    if (!p) {
      p = loadImage(base + path).then((img) => (img ? new ImageSource({ resource: img, scaleMode: 'nearest' }) : null));
      sources.set(path, p);
    }
    return p;
  };

  const mobArt = async (id: number): Promise<MobArt | null> => {
    const e = m.mobs[String(id)];
    if (!e) return null;
    try {
      const src = await atlas(e.atlas);
      if (!src) return null;
      const a: MobArt = {
        stand: makeAnim(src, e.frames, 'stand'),
        move: makeAnim(src, e.frames, 'move'),
        hit: makeAnim(src, e.frames, 'hit1'),
        die: makeAnim(src, e.frames, 'die1'),
        attack: makeAnim(src, e.frames, 'attack1'),
      };
      if (!a.stand && !a.move) return null;
      art.counts.mobs++;
      return a;
    } catch {
      return null;
    }
  };

  const skillArt = async (id: number): Promise<SkillArt | null> => {
    const e = m.skills[String(id)];
    if (!e?.atlas) return null;
    try {
      const src = await atlas(e.atlas);
      if (!src) return null;
      const a: SkillArt = { ball: makeAnim(src, e.frames, 'ball'), hit: makeAnim(src, e.frames, 'hit'), effect: makeAnim(src, e.frames, 'effect') };
      if (!a.ball && !a.hit && !a.effect) return null;
      art.counts.skills++;
      return a;
    } catch {
      return null;
    }
  };

  const icon = async (key: string, id: number) => {
    const path = m.skills[String(id)]?.icon;
    if (!path) return;
    const img = await loadImage(base + path);
    if (img) {
      art.icons[key] = base + path;
      art.counts.icons++;
    }
  };

  const [tiers, bosses] = await Promise.all([
    Promise.all(LADDER.map((d) => mobArt(d.id))),
    Promise.all(BOSSES.map((d) => mobArt(d.id))),
    Promise.all(
      SKILLS.map(async (s) => {
        const a = await skillArt(s.id);
        if (a) art.skills.set(s.key, a);
      }),
    ),
    Promise.all([...SKILLS.map((s) => icon(s.key, s.id)), ...PASSIVES.map((p) => icon(p.key, p.id))]),
  ]);
  art.tiers = tiers;
  art.bosses = bosses;
  art.bgm = { run: m.bgm.run ? base + m.bgm.run : null, title: m.bgm.title ? base + m.bgm.title : null };
  return art;
}
