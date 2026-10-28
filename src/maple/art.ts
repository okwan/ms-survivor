/**
 * Pixi-side loader for the art the deploy-time asset step wrote to maple/ (see scripts/fetch-maple.ts).
 * Every piece is optional: whatever fails to load is simply absent and the renderer keeps its placeholder for it.
 */
import { ImageSource, Rectangle, Texture } from 'pixi.js';
import { BOSSES, LADDER, PASSIVES, SKILLS } from '../game/data.ts';
import { EVOLVED_SKILLS } from '../game/evolutions.ts';
import type { FrameRec, MapleManifest } from './assets.ts';
import { buildItemArt } from './item-art.ts';
import type { ItemArt } from './item-art.ts';
import { buildRegionArt } from './region-art.ts';
import type { RegionArt } from './region-art.ts';
import type { UiPiece } from './world-types.ts';

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
  /** the ball a ranged mob shoots (Mob.wz attack1/info/ball), when the extractor found one */
  ball: Anim | null;
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

/** Damage digits of one colour: digits[i] for 0-9 of the large first-digit set (`first`) and the smaller rest set (`rest`). */
export interface DigitSet {
  first: Texture[];
  rest: Texture[];
  /** crit spark, when the set has one */
  effect: Texture | null;
}

/** Damage number sets by colour name: red (hits on enemies), cri (crits), violet (damage to the player), blue. */
export type DamageArt = Record<'red' | 'cri' | 'violet' | 'blue', DigitSet | null>;

export interface MapObjArt {
  anim: Anim;
  weight: number;
  w: number;
  h: number;
}

export interface MapArt {
  /** seamless ground tile, or null when the tile set could not be extracted */
  ground: Texture | null;
  /** average ground colour as 0xRRGGBB (renderer background) */
  groundColor: number;
  objects: MapObjArt[];
  /** largest decoration frame, used to widen the culling margin */
  maxW: number;
  maxH: number;
}

export interface UiArt {
  /** URL prefix of the piece PNGs (maple/) */
  base: string;
  /** only pieces whose PNG loaded */
  pieces: Record<string, UiPiece>;
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
  counts = { mobs: 0, skills: 0, icons: 0, objects: 0, digitSets: 0, uiPieces: 0 };
  map: MapArt | null = null;
  damage: DamageArt | null = null;
  /** LevelUp effect animation (origin at the player's feet) */
  levelUp: Anim | null = null;
  ui: UiArt | null = null;
  /** the seven run regions (ground, decor, banner names, music); empty when the manifest has none */
  regions: RegionArt[] = [];
  /** region tracks by region index (null: use the run track) */
  bgmRegions: (string | null)[] = [];
  /** sound effect URLs by key (see scripts/fetch-maple-sfx.ts) */
  sfx: Record<string, string> = {};
  /** potion / meso / scroll art, the pet and the enchant effect (null when the manifest has none) */
  items: ItemArt | null = null;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function makeAnim(source: ImageSource, frames: FrameRec[], action: string): Anim | null {
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
        ball: makeAnim(src, e.frames, 'ball'),
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
      [...SKILLS, ...EVOLVED_SKILLS].map(async (s) => {
        const a = await skillArt(s.id);
        if (a) art.skills.set(s.key, a);
      }),
    ),
    Promise.all([...SKILLS, ...EVOLVED_SKILLS].map((s) => icon(s.key, s.id)).concat(PASSIVES.map((p) => icon(p.key, p.id)))),
  ]);
  await buildWorldArt(m, base, art, atlas);
  art.regions = await buildRegionArt(m, base, atlas);
  art.bgmRegions = art.regions.map((r) => r.bgm);
  art.items = await buildItemArt(m, base, atlas);
  const gachaIcon = art.items?.gachaUrl();
  if (gachaIcon) art.icons.gacha = gachaIcon;
  const reviveIcon = art.items?.reviveUrl();
  if (reviveIcon) art.icons.revive = reviveIcon;
  for (let i = 0; i < 5; i++) {
    const u = art.items?.fieldUrl(i);
    if (u) art.icons['field' + i] = u;
  }
  for (const [k, v] of Object.entries(m.sfx ?? {})) art.sfx[k] = base + v;
  art.tiers = tiers;
  art.bosses = bosses;
  art.bgm = { run: m.bgm.run ? base + m.bgm.run : null, title: m.bgm.title ? base + m.bgm.title : null };
  return art;
}

// ---- world, damage numbers, effects and UI (scripts/fetch-maple-world.ts) ------------------------------------------

const COLORS = [['red', 'NoRed'], ['cri', 'NoCri'], ['violet', 'NoViolet'], ['blue', 'NoBlue']] as const;

function digitTextures(source: ImageSource, frames: FrameRec[], action: string): Texture[] | null {
  const out: Texture[] = [];
  for (let i = 0; i < 10; i++) {
    const f = frames.find((x) => x.action === action && x.index === i);
    if (!f) return null;
    out.push(new Texture({ source, frame: new Rectangle(f.x, f.y, f.w, f.h) }));
  }
  return out;
}

/** Never throws: each part that fails to load stays null/absent. */
async function buildWorldArt(m: MapleManifest, base: string, art: MapleArt, atlas: (path: string) => Promise<ImageSource | null>): Promise<void> {
  try {
    if (m.map) {
      const mp: MapArt = { ground: null, groundColor: 0x4f9a3c, objects: [], maxW: 0, maxH: 0 };
      if (m.map.ground) {
        const src = await atlas(m.map.ground.image);
        if (src) {
          mp.ground = new Texture({ source: src });
          const [r, g, b] = m.map.ground.avg;
          mp.groundColor = (r << 16) | (g << 8) | b;
        }
      }
      const o = m.map.objects;
      if (o) {
        const src = await atlas(o.atlas);
        if (src)
          for (const it of o.items) {
            const anim = makeAnim(src, o.frames, it.key);
            if (!anim) continue;
            mp.objects.push({ anim, weight: Math.max(1, it.weight), w: it.w, h: it.h });
            mp.maxW = Math.max(mp.maxW, ...anim.tex.map((t) => t.width));
            mp.maxH = Math.max(mp.maxH, ...anim.tex.map((t) => t.height));
          }
      }
      art.counts.objects = mp.objects.length;
      if (mp.ground || mp.objects.length) art.map = mp;
    }
  } catch {
    /* placeholders stay */
  }
  try {
    if (m.damage) {
      const src = await atlas(m.damage.atlas);
      if (src) {
        const dmg = { red: null, cri: null, violet: null, blue: null } as DamageArt;
        for (const [name, prefix] of COLORS) {
          const rest = digitTextures(src, m.damage.frames, prefix + '0');
          const first = digitTextures(src, m.damage.frames, prefix + '1');
          if (!rest && !first) continue;
          const eff = m.damage.frames.find((f) => f.action === `${prefix}1.effect` || f.action === `${prefix}0.effect`);
          dmg[name] = {
            first: (first ?? rest)!,
            rest: (rest ?? first)!,
            effect: eff ? new Texture({ source: src, frame: new Rectangle(eff.x, eff.y, eff.w, eff.h) }) : null,
          };
          art.counts.digitSets++;
        }
        if (dmg.red) art.damage = dmg;
      }
    }
  } catch {
    /* text numbers stay */
  }
  try {
    const lu = m.effects?.levelUp;
    if (lu) {
      const src = await atlas(lu.atlas);
      if (src) art.levelUp = makeAnim(src, lu.frames, 'levelUp');
    }
  } catch {
    /* the ring effect stays */
  }
  try {
    if (m.ui) {
      const pieces: Record<string, UiPiece> = {};
      await Promise.all(
        Object.entries(m.ui.pieces).map(async ([name, p]) => {
          if (await loadImage(base + p.src)) pieces[name] = p;
        }),
      );
      art.counts.uiPieces = Object.keys(pieces).length;
      if (art.counts.uiPieces) art.ui = { base, pieces };
    }
  } catch {
    /* CSS look stays */
  }
}
