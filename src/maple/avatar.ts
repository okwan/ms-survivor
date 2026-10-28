/**
 * Browser side of the player character: loads the per-item atlases the deploy step wrote to maple/avatar/, composites a look's layers
 * (alignment and z order from avatar-core.ts, shared with the Node extractor) into one canvas per action frame, and hands out
 * Pixi textures of those. Everything is built lazily and cached; a missing piece just leaves that layer out, and a look without
 * body and head is "not ready" so the renderer keeps the chibi placeholder.
 */
import { ImageSource, Texture } from 'pixi.js';
import { actionTiming, compose, framesOf, lookItems, SLOTS, stanceActions, zDepthTable } from './avatar-core.ts';
import type { AvatarManifest, ItemJson, Look, Part, Slot, StanceActions, ZTable } from './avatar-core.ts';
import type { Stance } from '../game/data.ts';

interface Loaded {
  json: ItemJson;
  img: HTMLImageElement;
}

/** One composited frame: its canvas, the feet position inside it, and the playback info of the action. */
export interface AvatarFrame {
  canvas: HTMLCanvasElement;
  /** feet (character origin) measured from the canvas top-left */
  ax: number;
  ay: number;
  /** ms */
  delay: number;
  frames: number;
}

const MAX_CACHE = 500;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class Avatar {
  readonly z: ZTable;
  private man: AvatarManifest;
  private base: string;
  private items = new Map<string, Loaded | null>();
  private pending = new Map<string, Promise<Loaded | null>>();
  private frames = new Map<string, AvatarFrame | null>();
  private textures = new Map<string, { tex: Texture; ax: number; ay: number }>();

  constructor(man: AvatarManifest, base = 'maple/') {
    this.man = man;
    this.base = base;
    this.z = zDepthTable(man.zmap);
  }

  private has(slot: Slot, id: string) {
    return this.man.items[slot]?.includes(id) ?? false;
  }

  private load(slot: Slot, id: string): Promise<Loaded | null> {
    const key = `${slot}-${id}`;
    if (this.items.has(key)) return Promise.resolve(this.items.get(key)!);
    let p = this.pending.get(key);
    if (!p) {
      p = (async () => {
        let out: Loaded | null = null;
        if (this.has(slot, id)) {
          try {
            const dir = this.base + this.man.dir;
            const [res, img] = await Promise.all([fetch(`${dir}${key}.json`), loadImage(`${dir}${key}.png`)]);
            if (res.ok && img) out = { json: (await res.json()) as ItemJson, img };
          } catch {
            out = null;
          }
        }
        this.items.set(key, out);
        this.pending.delete(key);
        return out;
      })();
      this.pending.set(key, p);
    }
    return p;
  }

  /** Loads every item of the look. Resolves true when the look can be drawn (body and head present). */
  async ensureLook(look: Look): Promise<boolean> {
    const ids = lookItems(look);
    await Promise.all(SLOTS.map((s) => this.load(s, ids[s])));
    return this.ready(look);
  }

  /** Start loading without waiting (used while the player flips through options). */
  prefetch(look: Look) {
    void this.ensureLook(look);
  }

  /** Whether the look is fully loaded and drawable (body and head present; other parts may be absent). */
  ready(look: Look): boolean {
    const ids = lookItems(look);
    for (const s of SLOTS) if (!this.items.has(`${s}-${ids[s]}`)) return false;
    return !!this.items.get(`body-${ids.body}`) && !!this.items.get(`head-${ids.head}`);
  }

  /** Parts of a look that are loaded. */
  parts(look: Look): Part[] {
    const ids = lookItems(look);
    const out: Part[] = [];
    for (const s of SLOTS) {
      const it = this.items.get(`${s}-${ids[s]}`);
      if (it) out.push({ slot: s, item: it.json });
    }
    return out;
  }

  lookKey(look: Look): string {
    const i = lookItems(look);
    return SLOTS.map((s) => i[s]).join('.');
  }

  /** The actions a look's weapon provides for a class stance. */
  stance(look: Look, stance: Stance): StanceActions {
    const w = this.items.get(`weapon-${lookItems(look).weapon}`);
    return stanceActions(stance, w?.json ?? null);
  }

  /** Per-frame delays (ms) of an action, or null if the body lacks it. */
  timing(look: Look, action: string): number[] | null {
    const b = this.items.get(`body-${lookItems(look).body}`);
    return b ? actionTiming(b.json, action) : null;
  }

  /** Composites one frame (cached). Null when the look is not ready or the body lacks the action. */
  frame(look: Look, action: string, frame: number): AvatarFrame | null {
    if (!this.ready(look)) return null;
    const lk = this.lookKey(look);
    const key = `${lk}|${action}|${frame}`;
    if (this.frames.has(key)) return this.frames.get(key)!;
    let out: AvatarFrame | null = null;
    try {
      const parts = this.parts(look);
      const comp = compose(parts, action, frame, this.z);
      if (comp) {
        const ids = lookItems(look);
        const W = Math.max(1, Math.ceil(comp.maxX - comp.minX));
        const H = Math.max(1, Math.ceil(comp.maxY - comp.minY));
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        for (const p of comp.placed) {
          const it = this.items.get(`${p.slot}-${ids[p.slot]}`);
          if (!it) continue;
          const l = p.layer;
          ctx.drawImage(it.img, l.x, l.y, l.w, l.h, Math.round(p.x - comp.minX), Math.round(p.y - comp.minY), l.w, l.h);
        }
        out = { canvas, ax: Math.round(-comp.minX), ay: Math.round(-comp.minY), delay: comp.delay, frames: comp.frames };
      }
    } catch (e) {
      console.warn('avatar: composite failed', e);
    }
    if (this.frames.size >= MAX_CACHE) this.evict();
    this.frames.set(key, out);
    return out;
  }

  /** Pixi texture (and feet anchor in texels) of a frame. */
  texture(look: Look, action: string, frame: number): { tex: Texture; ax: number; ay: number; delay: number; frames: number } | null {
    const f = this.frame(look, action, frame);
    if (!f) return null;
    const key = `${this.lookKey(look)}|${action}|${frame}`;
    let t = this.textures.get(key);
    if (!t) {
      t = { tex: new Texture({ source: new ImageSource({ resource: f.canvas, scaleMode: 'nearest' }) }), ax: f.ax, ay: f.ay };
      this.textures.set(key, t);
    }
    return { ...t, delay: f.delay, frames: f.frames };
  }

  private evict() {
    // drop the oldest half; Map iterates in insertion order
    let n = this.frames.size >> 1;
    for (const k of this.frames.keys()) {
      if (n-- <= 0) break;
      this.frames.delete(k);
      const t = this.textures.get(k);
      if (t) {
        t.tex.destroy(true);
        this.textures.delete(k);
      }
    }
  }

  /** Does the weapon item provide an action (for tests and logs). */
  weaponHas(look: Look, action: string): boolean {
    const w = this.items.get(`weapon-${lookItems(look).weapon}`);
    return !!w && !!framesOf(w.json, action);
  }
}

/** Plays an action: index of the frame showing at time t (s) given per-frame delays in ms; loops or holds the last frame. */
export function frameIndexAt(delays: number[], t: number, loop: boolean, speed = 1): number {
  let total = 0;
  for (const d of delays) total += d;
  let ms = t * 1000 * speed;
  if (loop) ms %= total;
  else if (ms >= total) return delays.length - 1;
  for (let i = 0; i < delays.length; i++) {
    if (ms < delays[i]) return i;
    ms -= delays[i];
  }
  return delays.length - 1;
}

/** how long a weapon attack action plays when a skill fires (s); longer real animations are sped up to fit */
export const ATTACK_TIME = 0.4;

export interface PlayerFrame {
  tex: Texture;
  ax: number;
  ay: number;
}

/**
 * Picks the frame of the hero for this render tick: attack action right after a skill fired, else walk while moving, else stand.
 * Allocation-free once warm.
 */
export class AvatarPlayer {
  private look: Look | null = null;
  private stanceKind: Stance = 'swing';
  private acts: StanceActions | null = null;
  private ok = false;
  private t = 0;
  private lastAction = '';
  private atkT = 99;
  private atkAction = '';
  private atkCycle = 0;
  private seenFire = -99;
  private out: PlayerFrame = { tex: Texture.EMPTY, ax: 0, ay: 0 };

  constructor(readonly avatar: Avatar) {}

  set(look: Look, stance: Stance) {
    this.look = look;
    this.stanceKind = stance;
    this.ok = false;
    this.acts = null;
    this.atkT = 99;
    this.seenFire = -99;
  }

  /** Whether frames can be produced (the look finished loading). */
  get ready(): boolean {
    if (!this.look) return false;
    if (!this.ok) {
      if (!this.avatar.ready(this.look)) return false;
      this.ok = true;
      this.acts = this.avatar.stance(this.look, this.stanceKind);
    }
    return true;
  }

  /** `lastFire` is the sim time of the last skill fire; a change starts an attack. */
  frame(dt: number, moving: boolean, lastFire: number): PlayerFrame | null {
    if (!this.look || !this.ready || !this.acts) return null;
    const a = this.acts;
    if (lastFire !== this.seenFire) {
      if (lastFire > -90) {
        this.atkT = 0;
        this.atkAction = a.attack[this.atkCycle++ % a.attack.length];
        this.lastAction = ''; // restart the animation even if the same action plays twice in a row
      }
      this.seenFire = lastFire;
    }
    const attacking = this.atkT < ATTACK_TIME && this.avatar.timing(this.look, this.atkAction) !== null;
    if (attacking) this.atkT += dt;
    const action = attacking ? this.atkAction : moving ? a.walk : a.stand;
    if (action !== this.lastAction) this.t = 0;
    else this.t += dt;
    this.lastAction = action;
    const delays = this.avatar.timing(this.look, action);
    if (!delays) return null;
    let speed = 1;
    if (attacking) {
      const total = delays.reduce((s, x) => s + x, 0) / 1000;
      if (total > ATTACK_TIME) speed = total / ATTACK_TIME;
    }
    const idx = frameIndexAt(delays, this.t, !attacking, speed);
    const f = this.avatar.texture(this.look, action, idx);
    if (!f) return null;
    this.out.tex = f.tex;
    this.out.ax = f.ax;
    this.out.ay = f.ay;
    return this.out;
  }
}
