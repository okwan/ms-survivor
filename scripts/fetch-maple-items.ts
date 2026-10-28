// Deploy-time extractor for items (called from buildAssets in scripts/fetch-maple.ts): Item.wz potion / elixir / meso / scroll icons,
// the pet's animations, the scroll table from String.wz Consume.img, and the enchant effect from Effect.wz. Writes
// items/icons.png, items/pet.png and effects/enchant.png under <dist>/maple/ and returns the "items" manifest section.
// Every lookup is defensive: a missing node logs its reason and the keys that do exist ("maple: items: ...") and that piece is skipped, so
// the game keeps today's look for it. Never throws.
//
// What it assumes about the real layout (not verifiable from the sandbox, hence the logging):
//   Item.wz/Consume/0200.img/<02000000>/info/icon           potions (8-digit zero-padded node names; unpadded is tried too)
//   Item.wz/Special/0900.img/<09000000>/info/iconRaw/0..3   meso art, animated (also tried: <id>/iconRaw/0..3, then info/icon)
//   Item.wz/Consume/0204.img/<02040000>/info/icon           scroll icons (image = first four digits of the 8-digit id)
//   Item.wz/Pet/5000000.img/{stand0, move, jump, ...}/<n>   canvases with origin / delay
//   String.wz/Consume.img/<2040000>/name, Pet.img/<5000000>/name   (searched at any depth, like the equip names)
//   Effect.wz/BasicEff.img/Enchant/{Success,Failure}/<n>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ClassKey } from '../src/game/data.ts';
import type { GearSlot, GearStats } from '../src/game/gear.ts';
import { SCROLL_PCTS } from '../src/game/scrolls.ts';
import type { ScrollEntry } from '../src/game/scrolls.ts';
import type { FrameRec } from '../src/maple/assets.ts';
import type { ItemIconKeys, ItemsSection } from '../src/maple/items-types.ts';
import type { AtlasRef } from '../src/maple/world-types.ts';
import { asciiPreview, encodePng } from './png.mjs';
import { canvasRgba } from './wz.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface SetLike {
  image(path: string): { root: Any; key: Any } | null;
  names(): string[];
}

export interface ItemsDeps {
  dist: string;
  sets: { Item: SetLike | null; String: SetLike | null; Effect: SetLike | null };
  log: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  canvasList: (node: Any) => Any[];
  packAtlas: (frames: Any[]) => { w: number; h: number; rgba: Buffer; recs: FrameRec[] } | null;
}

export interface ItemsResult {
  manifest: { items?: ItemsSection };
  bytes: number;
}

const PREVIEW_COLS = 28;
/** scrolls kept in the table */
export const MAX_SCROLLS = 30;
const POTIONS: [keyof ItemIconKeys, number][] = [['potionRed', 2000000], ['potionOrange', 2000001], ['potionWhite', 2000002], ['elixir', 2000004], ['elixirPower', 2000005]];
const MESOS: [keyof ItemIconKeys, number][] = [['mesoBronze', 9000000], ['mesoGold', 9000001], ['mesoBundle', 9000002], ['mesoBag', 9000003]];
/** Gachapon Ticket: Item.wz/Cash/0522.img/05220000/info/icon (the boss capsule) */
const GACHA_ID = 5220000;
const PET_IDS = [5000000, 5000001, 5000002, 5000004];
const PET_ACTIONS: [string, string[]][] = [['stand0', ['stand0', 'stand1', 'stand']], ['move', ['move', 'walk']], ['jump', ['jump']]];

export const id8 = (n: number) => String(n).padStart(8, '0');

/** Slot (and, for weapons, class) a scroll's "for <word>" names; null for words our gear does not have. */
export function scrollSlot(word: string): { slot: GearSlot; wclass?: ClassKey } | null {
  const w = word.toLowerCase();
  if (/two-?handed|crossbow|axe|mace|spear|pole|claw|knuckle|gun|blunt|\bbw\b/.test(w)) return null;
  if (/one-?handed sword/.test(w)) return { slot: 'weapon', wclass: 'warrior' };
  if (/\b(wand|staff)\b/.test(w)) return { slot: 'weapon', wclass: 'magician' };
  if (/\bbow\b/.test(w)) return { slot: 'weapon', wclass: 'bowman' };
  if (/\bdagger\b/.test(w)) return { slot: 'weapon', wclass: 'thief' };
  if (/\bcape\b/.test(w)) return { slot: 'cape' };
  if (/helmet|\bcap\b|\bhat\b/.test(w)) return { slot: 'cap' };
  if (/overall|topwear|\btop\b|\bcoat\b|longcoat/.test(w)) return { slot: 'coat' };
  if (/bottomwear|\bbottom\b|\bpants\b/.test(w)) return { slot: 'pants' };
  if (/shoes|boots/.test(w)) return { slot: 'shoes' };
  if (/glove/.test(w)) return { slot: 'glove' };
  if (/shield/.test(w)) return { slot: 'shield' };
  return null;
}

/** The GearStats key of a scroll's stat word; null for stats the game does not use (jump, accuracy, avoidability...). */
export function scrollStat(word: string, wclass?: ClassKey): keyof GearStats | null {
  const w = word.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^(magic att(ack)?|matt|m\.? ?att)$/.test(w)) return 'mad';
  if (/^(att(ack)?|weapon att(ack)?)$/.test(w)) return wclass === 'magician' ? 'mad' : 'pad';
  if (/^(magic def(ense)?|mdef)$/.test(w)) return 'mdd';
  if (/^(def(ense)?|weapon def(ense)?|physical def(ense)?)$/.test(w)) return 'pdd';
  if (w === 'hp') return 'mhp';
  if (w === 'mp') return 'mmp';
  if (w === 'speed') return 'speed';
  if (w === 'str' || w === 'dex' || w === 'int' || w === 'luk') return w;
  return null;
}

/** Parses "Scroll for One-Handed Sword for ATT 60%" (an optional prefix such as "Dark" is allowed; the rate must be 10, 60 or 100). */
export function parseScroll(name: string): ScrollEntry | null {
  const m = /scroll for (.+?) for (.+?)\s+(\d+)\s*%/i.exec(name);
  if (!m) return null;
  const sl = scrollSlot(m[1]);
  const pct = Number(m[3]);
  if (!sl || !(SCROLL_PCTS as readonly number[]).includes(pct)) return null;
  const stat = scrollStat(m[2], sl.wclass);
  if (!stat) return null;
  return { name: name.trim(), slot: sl.slot, ...(sl.wclass ? { wclass: sl.wclass } : {}), stat, pct };
}

/** Names under a String.wz image: every node with a `name` child whose key is a number, searched to a modest depth. */
function namesOf(img: Any, depth = 4): Map<number, string> {
  const out = new Map<number, string>();
  const walk = (node: Any, d: number) => {
    for (const k of node.keys()) {
      const c = node.child(k)?.resolve();
      if (!c?.children) continue;
      const nm = c.child('name')?.resolve()?.value;
      if (/^\d+$/.test(k) && typeof nm === 'string') out.set(Number(k), nm);
      else if (d < depth) walk(c, d + 1);
    }
  };
  walk(img.root, 0);
  return out;
}

interface Px {
  w: number;
  h: number;
  rgba: Buffer;
  ox: number;
  oy: number;
  delay: number;
  hasDelay: boolean;
  id: object;
}

class Items {
  bytes = 0;
  private d: ItemsDeps;
  constructor(d: ItemsDeps) {
    this.d = d;
  }

  private write(rel: string, w: number, h: number, rgba: Buffer): string {
    const path = join(this.d.dist, 'maple', rel);
    mkdirSync(dirname(path), { recursive: true });
    const png = encodePng(w, h, rgba);
    writeFileSync(path, png);
    this.bytes += png.length;
    return rel;
  }

  private px(node: Any, key: Any): Px | null {
    if (!node || node.type !== 'canvas') return null;
    try {
      const [w, h, rgba] = canvasRgba(node, key);
      if (w < 1 || h < 1) return null;
      const o = node.get('origin')?.value;
      return { w, h, rgba, ox: o?.x ?? 0, oy: o?.y ?? 0, delay: Math.max(1, node.num('delay', 100)), hasDelay: node.get('delay') !== undefined, id: node };
    } catch (e) {
      this.d.warn(`items: cannot decode canvas ${node.name}: ${(e as Error).message}`);
      return null;
    }
  }

  private raw(p: Px, action: string, index: number, delay = p.hasDelay ? p.delay : 100): Any {
    return { action, index, w: p.w, h: p.h, ox: p.ox, oy: p.oy, delay, rgba: p.rgba, id: p.id };
  }

  private preview(title: string, p: { w: number; h: number; rgba: Buffer } | null) {
    if (!p) return this.d.log(`items: preview ${title}: not available`);
    console.log(`--- ${title} ${p.w}x${p.h} ---\n${asciiPreview(p.w, p.h, p.rgba, Math.min(PREVIEW_COLS, Math.max(8, p.w)))}`);
  }

  /** The item node `id` (8 digits) of an Item.wz image, trying the padded and the plain number as node name. */
  private itemNode(root: Any, n: number): Any {
    return root.get(id8(n)) ?? root.get(String(n));
  }

  /** The frames of the first of `paths` (relative to an item node) that holds canvases. */
  private frames(img: { root: Any; key: Any }, node: Any, paths: string[]): { px: Px[]; from: string } | null {
    for (const p of paths) {
      const list = this.d.canvasList(node.get(p)).map((c: Any) => this.px(c, img.key)).filter((x: Px | null): x is Px => !!x);
      if (list.length) return { px: list, from: p };
    }
    return null;
  }

  run(): ItemsResult {
    const out: ItemsSection = {};
    this.step('icons', () => this.extractIcons(out));
    this.step('scrolls', () => this.extractScrolls(out));
    this.step('icon atlas', () => this.finishIcons(out));
    this.step('pet', () => this.extractPet(out));
    this.step('enchant', () => this.extractEnchant(out));
    return { manifest: Object.keys(out).length ? { items: out } : {}, bytes: this.bytes };
  }

  private step(name: string, fn: () => void) {
    try {
      fn();
    } catch (e) {
      this.d.warn(`items ${name}: ${(e as Error).stack}`);
    }
  }

  private iconFrames: Any[] = [];
  private scrollIcons = new Map<string, Px>();

  private imageOf(wz: SetLike, ...paths: string[]): { root: Any; key: Any; path: string } | null {
    for (const p of paths) {
      const i = wz.image(p);
      if (i) return { ...i, path: p };
    }
    return null;
  }

  private extractIcons(out: ItemsSection) {
    const wz = this.d.sets.Item;
    const { log, warn } = this.d;
    if (!wz) {
      warn('items: Item.wz is not available: potions, mesos, scrolls and the pet keep the placeholder look');
      return;
    }
    const names = wz.names();
    log(`items: Item.wz has ${names.length} images; folders: ${[...new Set(names.map((n) => n.split('/')[0]))].slice(0, 12).join(' ')}; Consume ${names.filter((n) => /^consume\//i.test(n)).length}, Special ${names.filter((n) => /^special\//i.test(n)).length}, Pet ${names.filter((n) => /^pet\//i.test(n)).length}`);
    const keys: ItemIconKeys = {};
    const got: string[] = [];
    const frames: Any[] = [];
    // potions and elixirs: info/icon
    const cons = new Map<string, { root: Any; key: Any } | null>();
    for (const [role, n] of POTIONS) {
      const path = `Consume/${id8(n).slice(0, 4)}.img`;
      if (!cons.has(path)) cons.set(path, wz.image(path));
      const img = cons.get(path);
      if (!img) { log(`items: ${role} ${n}: ${path} not found`); continue; }
      const node = this.itemNode(img.root, n);
      if (!node) { log(`items: ${role} ${n}: no node in ${path}; its keys: ${img.root.keys().slice(0, 20).join(',')}`); continue; }
      const fr = this.frames(img, node, ['info/icon', 'info/iconRaw', 'icon']);
      if (!fr) { log(`items: ${role} ${n}: no icon canvas; node children: ${node.keys().join(',')}; info: ${node.get('info')?.keys().join(',') ?? '-'}`); continue; }
      frames.push(this.raw(fr.px[0], id8(n), 0));
      keys[role] = id8(n);
      got.push(`${role}=${n}(${fr.px[0].w}x${fr.px[0].h} ${fr.from})`);
      if (role === 'potionRed') this.preview('Red Potion icon', fr.px[0]);
      if (role === 'elixirPower') this.preview('Power Elixir icon', fr.px[0]);
    }
    // the Gachapon Ticket (Cash/0522.img): the boss capsule; absent art leaves the drawn two-colour ball
    {
      const path = `Cash/${id8(GACHA_ID).slice(0, 4)}.img`;
      const img = wz.image(path);
      const node = img ? this.itemNode(img.root, GACHA_ID) : null;
      const fr = img && node ? this.frames(img, node, ['info/icon', 'info/iconRaw', 'icon']) : null;
      if (fr) {
        frames.push(this.raw(fr.px[0], id8(GACHA_ID), 0));
        keys.gacha = id8(GACHA_ID);
        got.push(`gacha=${GACHA_ID}(${fr.px[0].w}x${fr.px[0].h} ${fr.from})`);
        this.preview('Gachapon Ticket icon', fr.px[0]);
      } else log(`items: gacha ${GACHA_ID}: ${!img ? `${path} not found` : !node ? `no node in ${path}; its keys: ${img.root.keys().slice(0, 20).join(',')}` : `no icon canvas; node children: ${node.keys().join(',')}`}; the drawn capsule stays`);
    }
    // mesos: animated iconRaw
    const spec = this.imageOf(wz, 'Special/0900.img');
    if (!spec) log(`items: Special/0900.img not found (Special images: ${names.filter((n) => /^special\//i.test(n)).slice(0, 12).join(' ') || 'none'})`);
    else {
      log(`items: Special/0900.img nodes: ${spec.root.keys().slice(0, 12).join(',')}`);
      for (const [role, n] of MESOS) {
        const node = this.itemNode(spec.root, n);
        if (!node) { log(`items: ${role} ${n}: no node in Special/0900.img`); continue; }
        const fr = this.frames(spec, node, ['info/iconRaw', 'iconRaw', 'info/icon', 'icon']);
        if (!fr) { log(`items: ${role} ${n}: no canvases; node children: ${node.keys().join(',')}; info: ${node.get('info')?.keys().join(',') ?? '-'}`); continue; }
        const noDelay = fr.px.every((p) => !p.hasDelay);
        fr.px.forEach((p, i) => frames.push(this.raw(p, id8(n), i, noDelay ? 120 : p.delay)));
        keys[role] = id8(n);
        got.push(`${role}=${n}(${fr.px.length} frames ${fr.px[0].w}x${fr.px[0].h} ${fr.from}${noDelay ? ', no delays -> 120 ms' : ''})`);
        if (role === 'mesoBronze' || role === 'mesoBag') this.preview(`${role} ${n} frame 0`, fr.px[0]);
      }
    }
    this.iconFramesAdd(frames);
    log(`items: icons found: ${got.join('; ') || 'none'}`);
    this.keys = keys;
  }

  private keys: ItemIconKeys = {};
  private iconFramesAdd(f: Any[]) {
    this.iconFrames.push(...f);
  }

  private extractScrolls(out: ItemsSection) {
    const { log, warn } = this.d;
    const strings = this.d.sets.String;
    const wz = this.d.sets.Item;
    const sImg = strings?.image('Consume.img') ?? null;
    if (!sImg) {
      warn(`items: String.wz Consume.img not found${strings ? ` (images: ${strings.names().slice(0, 12).join(' ')})` : ' (no String.wz)'}; scrolls use invented names`);
      this.finishIcons(out);
      return;
    }
    const names = namesOf(sImg);
    log(`items: String.wz Consume.img has ${names.size} item names (first: ${[...names].slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ')})`);
    const all = [...names].filter(([k]) => k >= 2040000 && k <= 2049999).sort((a, b) => a[0] - b[0]);
    const parsed: { id: number; e: ScrollEntry }[] = [];
    const rejected: string[] = [];
    for (const [id, name] of all) {
      const e = parseScroll(name);
      if (e) parsed.push({ id, e });
      else if (/scroll for/i.test(name)) rejected.push(`${id} "${name}"`);
    }
    log(`items: ${all.length} names in 2040000-2049999, ${parsed.length} parse as "Scroll for <slot> for <stat> <10|60|100>%"; ${rejected.length} other "scroll for" names skipped (e.g. ${rejected.slice(0, 6).join('; ') || '-'})`);
    if (!parsed.length) {
      warn(`items: no usable scroll names (first names: ${all.slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ') || 'none in range'}); scrolls use invented names`);
      this.finishIcons(out);
      return;
    }
    // icons for every parsed scroll (chosen later): Consume/<first four digits>.img/<id>/info/icon
    const imgs = new Map<string, { root: Any; key: Any } | null>();
    const iconOf = (id: number): Px | null => {
      if (!wz) return null;
      const path = `Consume/${id8(id).slice(0, 4)}.img`;
      if (!imgs.has(path)) imgs.set(path, wz.image(path));
      const img = imgs.get(path);
      const node = img ? this.itemNode(img.root, id) : null;
      if (!img || !node) return null;
      return this.frames(img, node, ['info/icon', 'info/iconRaw', 'icon'])?.px[0] ?? null;
    };
    // groups of (slot, weapon class); each yields the first of every rate with the preferred stat first, then the rest
    const groups = new Map<string, { id: number; e: ScrollEntry; icon: Px | null }[]>();
    for (const p of parsed) {
      const g = `${p.e.slot}/${p.e.wclass ?? ''}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push({ ...p, icon: null });
    }
    const order: { id: number; e: ScrollEntry; icon: Px | null }[][] = [];
    for (const [g, list] of groups) {
      const pref = g.startsWith('weapon') ? ['pad', 'mad'] : ['pdd'];
      for (const x of list) x.icon = iconOf(x.id);
      const rank = (x: { id: number; e: ScrollEntry; icon: Px | null }) => (pref.includes(x.e.stat) ? 0 : 1) * 2 + (x.icon ? 0 : 1);
      const sorted = [...list].sort((a, b) => rank(a) - rank(b) || a.id - b.id);
      const first: typeof sorted = [];
      for (const pct of SCROLL_PCTS) {
        const f = sorted.find((x) => x.e.pct === pct);
        if (f) first.push(f);
      }
      order.push([...first, ...sorted.filter((x) => !first.includes(x))]);
    }
    const chosen: { id: number; e: ScrollEntry; icon: Px | null }[] = [];
    for (let round = 0; chosen.length < MAX_SCROLLS && order.some((o) => o.length > round); round++) {
      for (const o of order) if (o[round] && chosen.length < MAX_SCROLLS) chosen.push(o[round]);
    }
    const table: Record<string, ScrollEntry> = {};
    let noIcon = 0;
    log('items: scroll table (id | name | slot | stat | pct):');
    for (const c of chosen) {
      table[String(c.id)] = c.e;
      if (c.icon) this.scrollIcons.set(String(c.id), c.icon);
      else noIcon++;
      log(`items: ${c.id} | ${c.e.name} | ${c.e.slot}${c.e.wclass ? '(' + c.e.wclass + ')' : ''} | ${c.e.stat} | ${c.e.pct}`);
    }
    log(`items: ${chosen.length} scrolls chosen from ${parsed.length} (${noIcon} without an icon: shown as a plain scroll)`);
    const first = chosen.find((c) => c.icon);
    this.preview(first ? `scroll icon ${first.id}` : 'scroll icon', first?.icon ?? null);
    out.scrolls = table;
    this.finishIcons(out);
  }

  /** packs the potion / meso / scroll frames into items/icons.png (once; also called when no scroll table could be built) */
  private finishIcons(out: ItemsSection) {
    if (out.icons || this.packed) return;
    this.packed = true;
    const frames = [...this.iconFrames];
    for (const [id, p] of this.scrollIcons) frames.push(this.raw(p, id8(Number(id)), 0));
    if (!frames.length) {
      this.d.warn('items: no item icons could be extracted; pickups keep the placeholder look');
      return;
    }
    const atlas = this.d.packAtlas(frames);
    if (!atlas) return;
    const rel = this.write('items/icons.png', atlas.w, atlas.h, atlas.rgba);
    out.icons = { atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs };
    out.keys = this.keys;
    this.d.log(`items: icon atlas ${rel} ${atlas.w}x${atlas.h}, ${atlas.recs.length} frames (${Object.keys(this.keys).length} potion/meso roles, ${this.scrollIcons.size} scroll icons)`);
  }
  private packed = false;

  private extractPet(out: ItemsSection) {
    const wz = this.d.sets.Item;
    const { log, warn } = this.d;
    if (!wz) return;
    let found: { root: Any; key: Any; path: string; n: number } | null = null;
    const tried: string[] = [];
    for (const n of PET_IDS) {
      const img = this.imageOf(wz, `Pet/${n}.img`, `Pet/${id8(n)}.img`);
      tried.push(`${n}:${img ? 'yes' : 'no'}`);
      if (img) { found = { ...img, n }; break; }
    }
    if (!found) {
      warn(`items: no pet image (${tried.join(' ')}; Pet images: ${wz.names().filter((x) => /^pet\//i.test(x)).slice(0, 12).join(' ') || 'none'}); no pet art`);
      return;
    }
    log(`items: pet ${found.n} (${found.path}) keys: ${found.root.keys().join(',')}`);
    const raws: Any[] = [];
    const actions: string[] = [];
    for (const [action, srcs] of PET_ACTIONS) {
      const src = srcs.find((s) => this.d.canvasList(found!.root.get(s)).length > 0);
      if (!src) { log(`items: pet action ${action}: none of ${srcs.join('/')} has canvases`); continue; }
      const list = this.d.canvasList(found.root.get(src)).map((c: Any) => this.px(c, found!.key)).filter((x: Px | null): x is Px => !!x);
      if (!list.length) continue;
      list.forEach((p, i) => raws.push(this.raw(p, action, i)));
      actions.push(action);
      log(`items: pet ${action} <- ${src}: ${list.length} frames ${list.slice(0, 3).map((p) => `${p.w}x${p.h}@(${p.ox},${p.oy})`).join(' ')}${list.length > 3 ? ' ...' : ''}, delays ${list.map((p) => (p.hasDelay ? p.delay : '-')).join(',')}`);
      if (action === 'stand0') this.preview(`pet ${found.n} stand0/0`, list[0]);
    }
    if (!actions.includes('stand0') && !actions.includes('move')) {
      warn(`items: pet ${found.n} has no stand/move frames; no pet art`);
      return;
    }
    const atlas = this.d.packAtlas(raws);
    if (!atlas) return;
    const sImg = this.d.sets.String?.image('Pet.img');
    const nm = sImg ? namesOf(sImg).get(found.n) : undefined;
    if (!nm) log(`items: String.wz Pet.img has no name for ${found.n}${sImg ? ` (keys: ${sImg.root.keys().slice(0, 10).join(',')})` : ' (no Pet.img)'}; using "Brown Kitty"`);
    const rel = this.write('items/pet.png', atlas.w, atlas.h, atlas.rgba);
    out.pet = { id: String(found.n), name: nm ?? 'Brown Kitty', atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs, actions };
    log(`items: pet atlas ${rel} ${atlas.w}x${atlas.h}, ${atlas.recs.length} frames, name "${out.pet.name}"`);
  }

  private extractEnchant(out: ItemsSection) {
    const wz = this.d.sets.Effect;
    const { log, warn } = this.d;
    if (!wz) return;
    const img = wz.image('BasicEff.img');
    if (!img) { warn(`items: Effect.wz has no BasicEff.img (images: ${wz.names().join(' ')})`); return; }
    const keyOf = (node: Any, want: string): string | undefined => node.keys().find((k: string) => k.toLowerCase() === want.toLowerCase());
    const ek = keyOf(img.root, 'Enchant');
    if (!ek) {
      warn(`items: BasicEff.img has no Enchant (keys: ${img.root.keys().join(' ')}); scrolls show a plain flash instead`);
      return;
    }
    const enchant = img.root.get(ek);
    log(`items: BasicEff.img/${ek} children: ${enchant.keys().join(',')}`);
    const raws: Any[] = [];
    for (const [action, word] of [['success', 'Success'], ['failure', 'Failure']] as const) {
      const k = keyOf(enchant, word);
      if (!k) { warn(`items: Enchant has no ${word} (children: ${enchant.keys().join(',')})`); continue; }
      const list = this.d.canvasList(enchant.get(k)).map((c: Any) => this.px(c, img.key)).filter((x: Px | null): x is Px => !!x);
      if (!list.length) { warn(`items: Enchant/${k} has no canvases (children: ${enchant.get(k).keys().join(',')})`); continue; }
      const noDelay = list.every((p) => !p.hasDelay);
      list.forEach((p, i) => raws.push(this.raw(p, action, i, noDelay ? 80 : p.delay)));
      log(`items: enchant ${action} <- ${k}: ${list.length} frames ${list.slice(0, 3).map((p) => `${p.w}x${p.h}`).join(',')}, origin of frame 0 (${list[0].ox},${list[0].oy}), ${noDelay ? 'no delays in WZ -> 80 ms' : 'WZ delays'}`);
      this.preview(`enchant ${action} frame 0`, list[0]);
    }
    if (!raws.length) return;
    const atlas = this.d.packAtlas(raws);
    if (!atlas) return;
    const rel = this.write('effects/enchant.png', atlas.w, atlas.h, atlas.rgba);
    out.enchant = { atlas: rel, size: [atlas.w, atlas.h], frames: atlas.recs } as AtlasRef;
    log(`items: enchant atlas ${rel} ${atlas.w}x${atlas.h}`);
  }
}

/** Never throws. */
export function buildItems(d: ItemsDeps): ItemsResult {
  const it = new Items(d);
  try {
    const r = it.run();
    d.log(`items totals: icons ${r.manifest.items?.icons ? r.manifest.items.icons.frames.length + ' frames' : 'none'}, scrolls ${r.manifest.items?.scrolls ? Object.keys(r.manifest.items.scrolls).length : 0}, pet ${r.manifest.items?.pet ? r.manifest.items.pet.name : 'none'}, enchant ${r.manifest.items?.enchant ? 'yes' : 'none'}, ${(r.bytes / 1e6).toFixed(2)} MB`);
    return r;
  } catch (e) {
    d.warn(`items extraction failed: ${(e as Error).stack}`);
    return { manifest: {}, bytes: 0 };
  }
}
