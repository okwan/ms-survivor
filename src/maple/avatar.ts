/**
 * Browser side of the player character: loads the per-item atlases the deploy step wrote to maple/avatar/, composites a look's layers
 * (alignment and z order from avatar-core.ts, shared with the Node extractor) into one canvas per action frame, and hands out
 * Pixi textures of those. Everything is built lazily and cached; a missing piece just leaves that layer out, and a look without
 * body and head is "not ready" so the renderer keeps the chibi placeholder.
 */
import { ImageSource, Rectangle, Texture } from 'pixi.js';
import { actionTiming, afterimageFile, compose, framesOf, lookItems, playable, SLOTS, stanceActions, zDepthTable } from './avatar-core.ts';
import type { AfterimageJson, AfterLevel, AvatarManifest, ItemJson, Look, Part, PlayFrame, Slot, StanceActions, ZTable } from './avatar-core.ts';
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

/** One frame of a weapon swing trail: texture, origin in texels and its own delay (ms). */
export interface AfterFrame {
  tex: Texture;
  ax: number;
  ay: number;
  d: number;
}
/** A loaded afterimage: frames per hero level / action / body frame index. */
export class Afterimage {
  /** by level 0..10: the level's table, or the nearest lower level's, or null */
  private lv: (Record<string, Record<string, AfterFrame[]>> | null)[] = [];
  constructor(json: AfterimageJson, img: HTMLImageElement) {
    const src = new ImageSource({ resource: img, scaleMode: 'nearest' });
    const built = new Map<AfterLevel, Record<string, Record<string, AfterFrame[]>>>();
    const resolve = (k: string): AfterLevel | null => {
      let v = json.levels[k];
      for (let i = 0; typeof v === 'string' && i < 11; i++) v = json.levels[v];
      return v && typeof v === 'object' ? v : null;
    };
    let prev: Record<string, Record<string, AfterFrame[]>> | null = null;
    for (let l = 0; l <= 10; l++) {
      const raw = resolve(String(l));
      if (raw) {
        let t = built.get(raw);
        if (!t) {
          t = {};
          for (const [a, byFrame] of Object.entries(raw)) {
            t[a] = {};
            for (const [bf, list] of Object.entries(byFrame))
              t[a][bf] = list.map((r) => ({ tex: new Texture({ source: src, frame: new Rectangle(r.x, r.y, r.w, r.h) }), ax: r.ox, ay: r.oy, d: Math.max(30, r.d || 100) }));
          }
          built.set(raw, t);
        }
        prev = t;
      }
      this.lv.push(prev);
    }
  }
  /** trail frames for the hero level (0..10), body action and body frame index; null when there is none */
  frames(level: number, action: string, index: number): AfterFrame[] | null {
    return this.lv[Math.max(0, Math.min(10, level))]?.[action]?.[index] ?? null;
  }
}

export class Avatar {
  readonly z: ZTable;
  private man: AvatarManifest;
  private base: string;
  private items = new Map<string, Loaded | null>();
  private pending = new Map<string, Promise<Loaded | null>>();
  private frames = new Map<string, AvatarFrame | null>();
  private textures = new Map<string, { tex: Texture; ax: number; ay: number }>();
  private plays = new Map<string, PlayFrame[] | null>();
  private afters = new Map<string, Afterimage | null | 'loading'>();

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
    await Promise.all(SLOTS.map((s) => (ids[s] ? this.load(s, ids[s]) : null)));
    return this.ready(look);
  }

  /** Start loading without waiting (used while the player flips through options). */
  prefetch(look: Look) {
    void this.ensureLook(look);
  }

  /** Whether the look is fully loaded and drawable (body and head present; other parts may be absent). */
  ready(look: Look): boolean {
    const ids = lookItems(look);
    for (const s of SLOTS) if (ids[s] && !this.items.has(`${s}-${ids[s]}`)) return false;
    return !!this.items.get(`body-${ids.body}`) && !!this.items.get(`head-${ids.head}`);
  }

  /** Parts of a look that are loaded. */
  parts(look: Look): Part[] {
    const ids = lookItems(look);
    const out: Part[] = [];
    for (const s of SLOTS) {
      const it = ids[s] ? this.items.get(`${s}-${ids[s]}`) : null;
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
    return stanceActions(stance, w?.json ?? null, this.man.seq);
  }

  /** Whether `action` is a skill sequence (magic1, savage...) rather than a base action. */
  isSeq(action: string): boolean {
    return !!this.man.seq && action in this.man.seq;
  }

  /** Frames to play for an action of the look (cached; the arrays are reused), or null if the body can play neither a base action nor a sequence of that name. */
  play(look: Look, action: string): PlayFrame[] | null {
    const key = `${lookItems(look).body}|${action}`;
    if (this.plays.has(key)) return this.plays.get(key)!;
    const b = this.items.get(`body-${lookItems(look).body}`);
    const out = b ? playable(action, b.json, this.man.seq) : null;
    if (b) this.plays.set(key, out);
    return out;
  }

  /** The weapon's swing trail name (info/afterImage), or '' */
  afterName(look: Look): string {
    const v = this.items.get(`weapon-${lookItems(look).weapon}`)?.json.info?.afterImage;
    return typeof v === 'string' ? v : '';
  }

  /** A weapon swing trail by name; loads lazily and returns null until it is there (or when the manifest has none). */
  afterimage(name: string): Afterimage | null {
    const c = this.afters.get(name);
    if (c === 'loading') return null;
    if (c !== undefined) return c;
    if (!name || !this.man.afterimages?.includes(name)) {
      this.afters.set(name, null);
      return null;
    }
    this.afters.set(name, 'loading');
    void (async () => {
      let out: Afterimage | null = null;
      try {
        const dir = this.base + this.man.dir;
        const [res, img] = await Promise.all([fetch(`${dir}${afterimageFile(name, 'json')}`), loadImage(`${dir}${afterimageFile(name, 'png')}`)]);
        if (res.ok && img) out = new Afterimage((await res.json()) as AfterimageJson, img);
      } catch {
        out = null;
      }
      this.afters.set(name, out);
    })();
    return null;
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

/** longest an attack animation plays (s); longer real animations are sped up to fit, shorter ones keep their real speed */
export const ATTACK_MAX = 0.6;

export interface PlayerFrame {
  tex: Texture;
  ax: number;
  ay: number;
  /** offset (px, art space: the art faces left), mirror and rotation (degrees) of a sequence frame */
  mx: number;
  my: number;
  flip: boolean;
  rot: number;
  /** the body action and frame index showing (the base action's, for a sequence) */
  action: string;
  index: number;
  /** counts up whenever a new body frame starts showing (also when the same frame plays twice) */
  serial: number;
  /** playback speed of the body animation (1 = real; above 1 when a long attack is compressed) */
  speed: number;
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
  private atk: PlayFrame[] | null = null;
  private atkT = 0;
  private atkSpeed = 1;
  private atkTotal = 0;
  private atkCycle = 0;
  private seenFire = -99;
  private lastKey = -1;
  private out: PlayerFrame = { tex: Texture.EMPTY, ax: 0, ay: 0, mx: 0, my: 0, flip: false, rot: 0, action: '', index: 0, serial: 0, speed: 1 };
  /** a changed look (new gear) still loading: the old one keeps being drawn until it is ready */
  private next: Look | null = null;

  constructor(readonly avatar: Avatar) {}

  set(look: Look, stance: Stance) {
    this.look = look;
    this.next = null;
    this.stanceKind = stance;
    this.ok = false;
    this.acts = null;
    this.atk = null;
    this.seenFire = -99;
  }

  /** Swaps to a changed look (equipped gear) without dropping back to the placeholder while its parts load. */
  change(look: Look) {
    if (!this.look || !this.ok) return this.set(look, this.stanceKind);
    this.next = look;
    this.avatar.prefetch(look);
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

  /** The hero's weapon swing trail name for the current look. */
  get afterName(): string {
    return this.look ? this.avatar.afterName(this.look) : '';
  }

  /** The play list for a new attack: the next playable skill action, else the weapon's normal attack. */
  private pickAttack(look: Look, a: StanceActions, skillActions: string[] | null): PlayFrame[] | null {
    const av = this.avatar;
    if (skillActions) {
      for (let n = 0; n < skillActions.length; n++) {
        const name = skillActions[(this.atkCycle + n) % skillActions.length];
        const p = av.play(look, name);
        // a base action the weapon lacks would draw the hero without its weapon
        if (p && (av.isSeq(name) || av.weaponHas(look, name))) {
          this.atkCycle += n + 1;
          return p;
        }
      }
    }
    for (let n = 0; n < a.attack.length; n++) {
      const p = av.play(look, a.attack[(this.atkCycle + n) % a.attack.length]);
      if (p) {
        this.atkCycle += n + 1;
        return p;
      }
    }
    return null;
  }

  /**
   * `lastFire` is the sim time of the last skill fire; a change starts an attack, playing one of that skill's body actions
   * (`skillActions`, from Skill.wz) or the weapon's normal attack.
   */
  frame(dt: number, moving: boolean, lastFire: number, skillActions: string[] | null = null): PlayerFrame | null {
    if (this.next && this.avatar.ready(this.next)) {
      this.look = this.next;
      this.next = null;
      this.acts = this.avatar.stance(this.look, this.stanceKind);
    }
    if (!this.look || !this.ready || !this.acts) return null;
    const a = this.acts;
    if (lastFire !== this.seenFire) {
      if (lastFire > -90) {
        this.atk = this.pickAttack(this.look, a, skillActions);
        this.atkT = 0;
        this.atkTotal = 0;
        if (this.atk) for (let i = 0; i < this.atk.length; i++) this.atkTotal += Math.max(30, this.atk[i].d || 100);
        this.atkTotal /= 1000;
        this.atkSpeed = this.atkTotal > ATTACK_MAX ? this.atkTotal / ATTACK_MAX : 1;
        this.lastKey = -1; // a new attack always starts a new frame, even if it is the same as the last one
      }
      this.seenFire = lastFire;
    }
    const o = this.out;
    if (this.atk) {
      this.atkT += dt * this.atkSpeed;
      if (this.atkT >= this.atkTotal) this.atk = null;
    }
    if (this.atk) {
      let ms = this.atkT * 1000;
      let i = 0;
      for (; i < this.atk.length - 1; i++) {
        const d = Math.max(30, this.atk[i].d || 100);
        if (ms < d) break;
        ms -= d;
      }
      const pf = this.atk[i];
      const f = this.avatar.texture(this.look, pf.a, pf.f);
      if (!f) return null;
      // lastKey: attack frames use 1000+step so they never equal a stand/walk frame
      const key = 1000 + i;
      if (key !== this.lastKey) { this.lastKey = key; o.serial++; }
      o.tex = f.tex; o.ax = f.ax; o.ay = f.ay;
      o.mx = pf.mx; o.my = pf.my; o.flip = pf.flip; o.rot = pf.rot;
      o.action = pf.a; o.index = pf.f; o.speed = this.atkSpeed;
      this.lastAction = '';
      return o;
    }
    const action = moving ? a.walk : a.stand;
    if (action !== this.lastAction) this.t = 0;
    else this.t += dt;
    this.lastAction = action;
    const delays = this.avatar.timing(this.look, action);
    if (!delays) return null;
    const idx = frameIndexAt(delays, this.t, true);
    const f = this.avatar.texture(this.look, action, idx);
    if (!f) return null;
    const key = (moving ? 1 : 0) * 100 + idx;
    if (key !== this.lastKey) { this.lastKey = key; o.serial++; }
    o.tex = f.tex; o.ax = f.ax; o.ay = f.ay;
    o.mx = 0; o.my = 0; o.flip = false; o.rot = 0;
    o.action = action; o.index = idx; o.speed = 1;
    return o;
  }
}
