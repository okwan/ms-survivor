/**
 * MapleStory character compositing, pure TypeScript (no DOM, no Pixi) so that the Node-side extractor
 * (scripts/fetch-maple-character.ts, for its CI preview and logs) and the browser (src/maple/avatar.ts) share one implementation.
 *
 * Data model (what the extractor writes to maple/avatar/<slot>-<id>.json, next to <slot>-<id>.png):
 *   an ItemJson per equip / body part: actions -> frames -> layers. A layer is a canvas of the part with its origin, its "z" layer
 *   name and its map points ("navel", "neck", "hand", "brow"...), all relative to the canvas origin.
 *
 * Alignment (as the real client does it): the body canvas origin is the character origin (the feet). Every other layer is placed so
 * that one of its map points coincides with the same-named point already placed in the world:
 *   body navel/neck -> arm, coat, pants, shoes (navel) and head (neck); head brow -> face, hair, cap (brow); arm hand -> weapon (hand).
 * Draw order comes from Base.wz zmap.img, whose list order is front-most first (checked at run time, see zDepthTable).
 */
import { CLASSES } from '../game/data.ts';
import type { Stance } from '../game/data.ts';
import type { GearManifest, GearSlot } from '../game/gear.ts';

export type Slot = 'body' | 'head' | 'face' | 'hair' | 'coat' | 'pants' | 'shoes' | 'weapon' | 'cap' | 'glove' | 'cape' | 'shield';
/** draw/placement stages, in dependency order (cap, glove, cape and shield only ever come from equipped gear) */
export const SLOTS: Slot[] = ['body', 'head', 'face', 'hair', 'coat', 'pants', 'shoes', 'weapon', 'cap', 'glove', 'cape', 'shield'];
/** a record with an empty list for every slot */
export const emptyItems = (): Record<Slot, string[]> => ({ body: [], head: [], face: [], hair: [], coat: [], pants: [], shoes: [], weapon: [], cap: [], glove: [], cape: [], shield: [] });
export type Vec = [number, number];

/** One canvas of a frame inside the item's atlas. */
export interface LayerRec {
  /** name of the canvas inside the frame ("body", "arm", "hair", "hairOverHead", "mail", ...) */
  n: string;
  /** zmap layer name */
  z: string;
  /** rectangle in the atlas */
  x: number;
  y: number;
  w: number;
  h: number;
  /** canvas origin, measured from the rectangle's top-left */
  ox: number;
  oy: number;
  /** map points relative to the origin */
  m: Record<string, Vec>;
}
export interface FrameData {
  /** delay in ms */
  d: number;
  /** body frames: 0 hides the face */
  f?: number;
  l: LayerRec[];
}
export interface ItemJson {
  id: string;
  slot: Slot;
  size: [number, number];
  /** an action is its frames, or the name of an earlier action with identical frames */
  actions: Record<string, FrameData[] | string>;
  info?: Record<string, string | number>;
}
export interface AvatarManifest {
  version: number;
  /** Base.wz zmap.img layer names in file order */
  zmap: string[];
  /** extracted item ids (8 digits) per slot */
  items: Record<Slot, string[]>;
  actions: string[];
  /** folder under maple/ */
  dir: string;
  /** droppable equipment (their frame files are listed in `items` too); absent when none could be extracted */
  gear?: GearManifest;
}

/** Actions the extractor keeps (only those that exist in a part are written). */
export const AVATAR_ACTIONS = ['stand1', 'stand2', 'walk1', 'walk2', 'alert', 'swingO1', 'swingO2', 'swingO3', 'stabO1', 'stabO2', 'shoot1'];

// ---- looks -------------------------------------------------------------------------------------------------------

export interface Look {
  /** 0 male, 1 female */
  gender: 0 | 1;
  /** 0..4 */
  skin: number;
  face: number;
  /** hair style id with colour digit 0 (e.g. 30000) */
  hair: number;
  /** 0..7 */
  hairColor: number;
  top: number;
  bottom: number;
  shoes: number;
  /** Character.wz weapon id; set from the class */
  weapon: number;
  /** equipped gear (8-digit item ids per slot) drawn over the creation look; not saved with the character */
  gear?: LookGear;
}
/** `longcoat`: a one-piece coat is worn, so the pants are not drawn */
export type LookGear = Partial<Record<GearSlot, string>> & { longcoat?: boolean };

export const LOOK_OPTIONS = {
  skins: 5,
  skinNames: ['Light', 'Tan', 'Dark', 'Pale', 'Ashen'],
  faces: [[20000, 20001, 20002], [21000, 21001, 21002]],
  hairs: [[30000, 30020, 30030], [31000, 31040, 31050]],
  tops: [[1040002, 1040006], [1041002, 1041006]],
  bottoms: [[1060002, 1060006], [1061002, 1061008]],
  shoes: [1072001, 1072005],
  hairColors: ['Black', 'Red', 'Orange', 'Blonde', 'Green', 'Blue', 'Purple', 'Brown'],
  hairSwatch: ['#2b2b30', '#c8372d', '#e8832a', '#e8c54a', '#4aa84a', '#3a78d0', '#8a4ac0', '#7a4a28'],
};

export const pad8 = (n: number) => String(n).padStart(8, '0');

export function defaultLook(weapon: number, gender: 0 | 1 = 0): Look {
  const o = LOOK_OPTIONS;
  return { gender, skin: 0, face: o.faces[gender][0], hair: o.hairs[gender][0], hairColor: 0, top: o.tops[gender][0], bottom: o.bottoms[gender][0], shoes: o.shoes[0], weapon };
}

/** `rnd()` returns a float in [0,1). */
export function randomLook(rnd: () => number, weapon: number): Look {
  const o = LOOK_OPTIONS;
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length) % a.length];
  const gender = (rnd() < 0.5 ? 0 : 1) as 0 | 1;
  return {
    gender,
    skin: Math.floor(rnd() * o.skins) % o.skins,
    face: pick(o.faces[gender]),
    hair: pick(o.hairs[gender]),
    hairColor: Math.floor(rnd() * 8) % 8,
    top: pick(o.tops[gender]),
    bottom: pick(o.bottoms[gender]),
    shoes: pick(o.shoes),
    weapon,
  };
}

/** Coerces untrusted (saved) data to a valid look. */
export function sanitizeLook(v: unknown, weapon: number): Look {
  const d = defaultLook(weapon);
  if (!v || typeof v !== 'object') return d;
  const o = v as Partial<Look>;
  const g = (o.gender === 1 ? 1 : 0) as 0 | 1;
  const opt = LOOK_OPTIONS;
  const inList = (x: unknown, list: number[], dflt: number) => (typeof x === 'number' && list.includes(x) ? x : dflt);
  return {
    gender: g,
    skin: typeof o.skin === 'number' && o.skin >= 0 && o.skin < opt.skins ? Math.floor(o.skin) : 0,
    face: inList(o.face, opt.faces[g], opt.faces[g][0]),
    hair: inList(o.hair, opt.hairs[g], opt.hairs[g][0]),
    hairColor: typeof o.hairColor === 'number' && o.hairColor >= 0 && o.hairColor < 8 ? Math.floor(o.hairColor) : 0,
    top: inList(o.top, opt.tops[g], opt.tops[g][0]),
    bottom: inList(o.bottom, opt.bottoms[g], opt.bottoms[g][0]),
    shoes: inList(o.shoes, opt.shoes, opt.shoes[0]),
    weapon,
  };
}

/** Item ids (8 digits, the .img names) a look is made of. */
export function lookItems(l: Look): Record<Slot, string> {
  const g = l.gear;
  if (g) {
    return {
      body: pad8(2000 + l.skin),
      head: pad8(12000 + l.skin),
      face: pad8(l.face),
      hair: pad8(l.hair + l.hairColor),
      coat: g.coat ?? pad8(l.top),
      pants: g.longcoat ? '' : (g.pants ?? pad8(l.bottom)),
      shoes: g.shoes ?? pad8(l.shoes),
      weapon: g.weapon ?? pad8(l.weapon),
      cap: g.cap ?? '',
      glove: g.glove ?? '',
      cape: g.cape ?? '',
      shield: g.shield ?? '',
    };
  }
  return {
    body: pad8(2000 + l.skin),
    head: pad8(12000 + l.skin),
    face: pad8(l.face),
    hair: pad8(l.hair + l.hairColor),
    coat: pad8(l.top),
    pants: pad8(l.bottom),
    shoes: pad8(l.shoes),
    weapon: pad8(l.weapon),
    cap: '',
    glove: '',
    cape: '',
    shield: '',
  };
}

/** Every item the extractor should produce. */
export function wantedItems(): Record<Slot, string[]> {
  const o = LOOK_OPTIONS;
  const out = emptyItems();
  for (let s = 0; s < o.skins; s++) {
    out.body.push(pad8(2000 + s));
    out.head.push(pad8(12000 + s));
  }
  for (const g of [0, 1]) {
    for (const f of o.faces[g]) out.face.push(pad8(f));
    for (const h of o.hairs[g]) for (let c = 0; c < 8; c++) out.hair.push(pad8(h + c));
    for (const t of o.tops[g]) out.coat.push(pad8(t));
    for (const b of o.bottoms[g]) out.pants.push(pad8(b));
  }
  for (const s of o.shoes) out.shoes.push(pad8(s));
  for (const c of CLASSES) out.weapon.push(pad8(c.weapon));
  return out;
}

/** Wz folder of a slot ('' = archive root); coats may live in Coat or Longcoat. */
export const SLOT_FOLDERS: Record<Slot, string[]> = {
  body: [''],
  head: [''],
  face: ['Face'],
  hair: ['Hair'],
  coat: ['Coat', 'Longcoat'],
  pants: ['Pants'],
  shoes: ['Shoes'],
  weapon: ['Weapon'],
  cap: ['Cap'],
  glove: ['Glove'],
  cape: ['Cape'],
  shield: ['Shield'],
};

export const itemFile = (slot: Slot, id: string, ext: 'json' | 'png') => `${slot}-${id}.${ext}`;

// ---- actions per weapon stance ----------------------------------------------------------------------------------

const STANCE_PREF: Record<Stance, { stand: string[]; walk: string[]; attack: string[] }> = {
  swing: { stand: ['stand1', 'stand2'], walk: ['walk1', 'walk2'], attack: ['swingO1', 'swingO2', 'swingO3', 'stabO1'] },
  shoot: { stand: ['stand2', 'stand1'], walk: ['walk2', 'walk1'], attack: ['shoot1', 'swingO1'] },
  stab: { stand: ['stand1', 'stand2'], walk: ['walk1', 'walk2'], attack: ['stabO1', 'stabO2', 'swingO1'] },
};
export interface StanceActions {
  stand: string;
  walk: string;
  attack: string[];
}
/** The actions a character with this stance uses, limited to those the weapon item (if loaded) provides. */
export function stanceActions(stance: Stance, weapon: ItemJson | null): StanceActions {
  const pref = STANCE_PREF[stance];
  const has = (a: string) => !weapon || a in weapon.actions;
  const first = (l: string[]) => l.find(has) ?? l[0];
  const attack = pref.attack.filter(has);
  return { stand: first(pref.stand), walk: first(pref.walk), attack: attack.length ? attack : [pref.attack[0]] };
}

// ---- z order -----------------------------------------------------------------------------------------------------

export interface ZTable {
  /** larger = drawn later (in front) */
  depth: Map<string, number>;
  /** the list had the front-most layer first (as zmap.img does) */
  frontFirst: boolean;
  fallback: number;
}

/**
 * zmap.img lists layers front-most first ("face" before "head" before "body"). The orientation is detected from those three
 * well-known names rather than assumed, so a reversed reader would not flip the character inside out.
 */
export function zDepthTable(zmap: string[]): ZTable {
  const iHead = zmap.indexOf('head');
  const iBody = zmap.indexOf('body');
  const frontFirst = iHead < 0 || iBody < 0 ? true : iHead < iBody;
  const n = zmap.length;
  const depth = new Map<string, number>();
  zmap.forEach((name, i) => depth.set(name, frontFirst ? n - i : i));
  return { depth, frontFirst, fallback: depth.get('body') ?? n / 2 };
}

// ---- placement ---------------------------------------------------------------------------------------------------

/** which map point to align a layer by, first match wins */
const ANCHOR_PRIORITY = ['navel', 'neck', 'brow', 'hand', 'handMove'];

export interface Part {
  slot: Slot;
  item: ItemJson;
}
export interface Placed {
  slot: Slot;
  layer: LayerRec;
  /** top-left of the layer relative to the character origin (feet) */
  x: number;
  y: number;
  depth: number;
  /** the map point this layer was aligned by, or null when none matched (placed by its origin) */
  anchor: string | null;
}
export interface Composition {
  placed: Placed[];
  /** ms of the body frame */
  delay: number;
  /** number of frames of this action (body) */
  frames: number;
  /** bounding box relative to the character origin */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function framesOf(item: ItemJson, action: string): FrameData[] | null {
  let v = item.actions[action];
  for (let i = 0; typeof v === 'string' && i < 4; i++) v = item.actions[v];
  return Array.isArray(v) && v.length ? v : null;
}

/** Frames for hair/face style parts that carry a single "default" pose. */
function partFrames(part: Part, action: string): FrameData[] | null {
  return framesOf(part.item, action) ?? framesOf(part.item, 'default');
}

/**
 * Which hair layers a worn cap hides. A cap always covers the top of the hair (hairOverHead) and shows the rest; the cap's
 * vslot is a run of two-letter codes ("CpH1H5"), where H5 also takes the hair behind the head and a cap that lists nearly every
 * H code (a full helmet) hides all hair. The real meaning of each code is only partly known; the extractor logs the strings seen.
 */
export function hiddenHairLayers(cap: ItemJson | undefined): Set<string> {
  const out = new Set<string>();
  if (!cap) return out;
  out.add('hairOverHead');
  const codes = String(cap.info?.vslot ?? '').match(/.{1,2}/g) ?? [];
  const h = codes.filter((c) => /^H[0-9a-z]$/.test(c));
  if (h.includes('H5')) out.add('backHair');
  if (h.length >= 6) for (const n of ['hair', 'hairShade', 'backHair', 'hairBelowBody']) out.add(n);
  return out;
}

/**
 * Places every layer of every part for one action and body-frame index. `parts` should hold at most one part per slot.
 * A part without the action (and without a 'default') contributes nothing; hair and faces use their 'default' pose.
 */
export function compose(parts: Part[], action: string, frame: number, z: ZTable): Composition | null {
  const body = parts.find((p) => p.slot === 'body');
  const bodyFrames = body ? framesOf(body.item, action) : null;
  if (!body || !bodyFrames) return null;
  const bf = bodyFrames[((frame % bodyFrames.length) + bodyFrames.length) % bodyFrames.length];
  const showFace = bf.f !== 0;

  const world = new Map<string, Vec>();
  const placed: Placed[] = [];
  const bySlot = new Map<Slot, Part>();
  for (const p of parts) bySlot.set(p.slot, p);
  const hideHair = hiddenHairLayers(bySlot.get('cap')?.item);

  for (const slot of SLOTS) {
    const part = bySlot.get(slot);
    if (!part) continue;
    if (slot === 'face' && !showFace) continue;
    let fd: FrameData | undefined;
    if (slot === 'body') fd = bf;
    else {
      const fr = partFrames(part, action);
      if (!fr) continue;
      fd = fr[Math.min(frame, fr.length - 1)];
    }
    // layers named like the slot ("body", "head") go first so that the slot's own points are in the world before the rest
    const layers = [...fd.l].sort((a, b) => (b.n === slot ? 1 : 0) - (a.n === slot ? 1 : 0));
    for (const l of layers) {
      if (slot === 'hair' && hideHair.size && (hideHair.has(l.n) || hideHair.has(l.z))) continue;
      let ox: number;
      let oy: number;
      let anchor: string | null = null;
      if (slot === 'body' && l.n === 'body') {
        ox = 0;
        oy = 0;
      } else {
        const keys = Object.keys(l.m);
        const ordered = [...ANCHOR_PRIORITY.filter((k) => k in l.m), ...keys.filter((k) => !ANCHOR_PRIORITY.includes(k))];
        anchor = ordered.find((k) => world.has(k)) ?? null;
        if (anchor) {
          const w = world.get(anchor)!;
          ox = w[0] - l.m[anchor][0];
          oy = w[1] - l.m[anchor][1];
        } else {
          ox = 0;
          oy = 0;
        }
      }
      for (const k of Object.keys(l.m)) if (!world.has(k)) world.set(k, [ox + l.m[k][0], oy + l.m[k][1]]);
      const depth = z.depth.get(l.z) ?? z.depth.get(l.n) ?? z.fallback;
      placed.push({ slot, layer: l, x: ox - l.ox, y: oy - l.oy, depth, anchor });
    }
  }
  // back to front; stable for equal depth (parts keep their slot order)
  const order = placed.map((p, i) => ({ p, i })).sort((a, b) => a.p.depth - b.p.depth || a.i - b.i);
  const sorted = order.map((o) => o.p);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of sorted) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.layer.w);
    maxY = Math.max(maxY, p.y + p.layer.h);
  }
  if (!sorted.length) return null;
  return { placed: sorted, delay: bf.d, frames: bodyFrames.length, minX, minY, maxX, maxY };
}

/** Number of frames and per-frame delays (ms) of an action, from the body. */
export function actionTiming(body: ItemJson, action: string): number[] | null {
  const f = framesOf(body, action);
  return f ? f.map((x) => Math.max(30, x.d || 100)) : null;
}

// ---- Node-side rasteriser (CI preview, tests) ---------------------------------------------------------------------

/** Source-over blit of the composition onto a fresh RGBA buffer; `atlasOf` gives each item's decoded atlas. */
export function rasterize(c: Composition, atlasOf: (p: Placed) => { w: number; data: Uint8Array } | null) {
  const W = Math.max(1, Math.ceil(c.maxX - c.minX));
  const H = Math.max(1, Math.ceil(c.maxY - c.minY));
  const out = new Uint8Array(W * H * 4);
  for (const p of c.placed) {
    const atlas = atlasOf(p);
    if (!atlas) continue;
    const dx = Math.round(p.x - c.minX);
    const dy = Math.round(p.y - c.minY);
    for (let yy = 0; yy < p.layer.h; yy++) {
      const ty = dy + yy;
      if (ty < 0 || ty >= H) continue;
      for (let xx = 0; xx < p.layer.w; xx++) {
        const tx = dx + xx;
        if (tx < 0 || tx >= W) continue;
        const s = ((p.layer.y + yy) * atlas.w + p.layer.x + xx) * 4;
        const a = atlas.data[s + 3];
        if (!a) continue;
        const d = (ty * W + tx) * 4;
        const da = out[d + 3];
        const oa = a + (da * (255 - a)) / 255;
        for (let k = 0; k < 3; k++) out[d + k] = (atlas.data[s + k] * a + (out[d + k] * da * (255 - a)) / 255) / oa;
        out[d + 3] = oa;
      }
    }
  }
  return { w: W, h: H, rgba: out, ax: -c.minX, ay: -c.minY };
}
