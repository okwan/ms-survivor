// Deploy-time extractor for droppable equipment (called from extractAvatar in scripts/fetch-maple-character.ts).
// Reads the equip folders of Character.wz (Cap, Coat, Longcoat, Pants, Shoes, Glove, Cape, Shield, Weapon) and the item names of
// String.wz (Eqp.img/Eqp/<Category>/<id>/name), picks a few items per level tier and class from each item's own `info` node,
// writes their frame files like the other avatar items (avatar/<slot>-<id>.{png,json}) plus one icon atlas, and returns the
// "gear" block of the avatar manifest. Never throws; everything it chose or skipped is a `maple:` log line.
//
// What it assumes about Character.wz/<Folder>/<id>.img (not verifiable from the sandbox, hence the logging):
//   info/{icon, iconRaw, reqLevel, reqJob, cash, incPAD, incMAD, incPDD, incMDD, incMHP, incMMP, incSPEED, incSTR, incDEX, incINT,
//   incLUK, tuc, islot, vslot} (every key optional), and <action>/<frame>/<part> canvases like the other avatar items.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASSES } from '../src/game/data.ts';
import type { ClassKey } from '../src/game/data.ts';
import { GEAR_SLOTS, JOB_BIT, TIER_LEVELS, tierOfLevel } from '../src/game/gear.ts';
import type { GearEntry, GearManifest, GearSlot, GearStats } from '../src/game/gear.ts';
import { compose, defaultLook, itemFile, lookItems, rasterize, stanceActions } from '../src/maple/avatar-core.ts';
import type { Part, Slot, ZTable } from '../src/maple/avatar-core.ts';
import { asciiPreview, encodePng } from './png.mjs';
import { canvasRgba } from './wz.mjs';
import type { ExtractedItem, Logger, WzLike } from './fetch-maple-character.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** Pieces of fetch-maple-character.ts used here (passed in so that the two files do not import each other). */
export interface GearTools {
  extractItem(root: Any, key: Any, slot: Slot, id: string, problems: string[]): ExtractedItem | null;
  frameNodes(node: Any): Any[];
  shelfPack(items: { w: number; h: number; rgba: Buffer }[]): { w: number; h: number; pos: { x: number; y: number }[]; rgba: Buffer };
}

/** total items kept (the whole gear block is a few MB) */
export const MAX_GEAR_ITEMS = 320;
/** items picked per tier, slot, class and gender */
const PER_BUCKET = 2;

const FOLDERS: Record<string, { slot: GearSlot; long: boolean }> = {
  cap: { slot: 'cap', long: false },
  coat: { slot: 'coat', long: false },
  longcoat: { slot: 'coat', long: true },
  pants: { slot: 'pants', long: false },
  shoes: { slot: 'shoes', long: false },
  glove: { slot: 'glove', long: false },
  cape: { slot: 'cape', long: false },
  shield: { slot: 'shield', long: false },
  weapon: { slot: 'weapon', long: false },
};
/** Weapon type = id / 10000: sword 130, dagger 133, wand 137, staff 138, bow 145. The Thief uses the dagger (its stance is stab). */
const WEAPON_TYPES: Record<ClassKey, number[]> = { warrior: [130], magician: [137, 138], bowman: [145], thief: [133] };
const ALL_WEAPON_TYPES = new Set(Object.values(WEAPON_TYPES).flat());
const INC: Record<string, keyof GearStats> = {
  incPAD: 'pad', incMAD: 'mad', incPDD: 'pdd', incMDD: 'mdd', incMHP: 'mhp', incMMP: 'mmp', incSPEED: 'speed', incSTR: 'str', incDEX: 'dex', incINT: 'int', incLUK: 'luk',
};
/** armor slots (and the weapon) that must have every class considered; shields only for the Warrior */
const ARMOR: GearSlot[] = ['cap', 'coat', 'pants', 'shoes', 'glove', 'cape'];

interface Candidate {
  id: string;
  n: number;
  slot: GearSlot;
  folder: string;
  long: boolean;
  level: number;
  job: number;
  gender: 0 | 1 | 2;
  stats: GearStats;
  where: string;
  tuc: number;
}

/** classic items (the low ids of each thousand-block: 01002000..01002199) are preferred over the later event and novelty ones */
const classic = (n: number) => (n % 1000 < 200 ? 0 : 1);

const intOf = (v: unknown): number => (typeof v === 'number' ? Math.round(v) : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? parseInt(v, 10) : 0);

/** Coat, Longcoat and Pants ids carry the gender in the thousands digit: 0 male, 1 female, 2 unisex (others: treated as unisex). */
export function genderOfId(n: number): 0 | 1 | 2 {
  const cat = Math.floor(n / 10000);
  if (cat !== 104 && cat !== 105 && cat !== 106) return 2;
  const g = Math.floor(n / 1000) % 10;
  return g === 0 ? 0 : g === 1 ? 1 : 2;
}

/** Whether a class may use an item with this reqJob bitmask (0 = everyone; 16, pirates, matches none of the four). */
export const jobFits = (job: number, cls: ClassKey) => job === 0 || (job & JOB_BIT[cls]) !== 0;

/** names of all equips: String.wz Eqp.img/Eqp/<Category>/<id>/name, searching the whole Eqp subtree */
function equipNames(strings: WzLike | null, lg: Logger): Map<number, string> {
  const out = new Map<number, string>();
  const img = strings?.image('Eqp.img');
  if (!img) {
    lg.warn(`gear: String.wz Eqp.img not found${strings ? ` (images: ${strings.names().slice(0, 12).join(' ')})` : ' (no String.wz)'}; items get generic names`);
    return out;
  }
  const walk = (node: Any, depth: number) => {
    for (const k of node.keys()) {
      const c = node.child(k)?.resolve();
      if (!c?.children) continue;
      const nm = c.child('name')?.resolve()?.value;
      if (/^\d+$/.test(k) && typeof nm === 'string') out.set(Number(k), nm);
      else if (depth < 4) walk(c, depth + 1);
    }
  };
  walk(img.root, 0);
  lg.log(`gear: String.wz Eqp.img has ${out.size} equip names (first: ${[...out].slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ')})`);
  return out;
}

export interface GearResult {
  manifest: GearManifest | null;
  bytes: number;
  /** extracted frame files by `${slot}/${id}` */
  items: Map<string, ExtractedItem>;
  /** chosen ids per avatar slot */
  ids: Partial<Record<Slot, string[]>>;
}

/** tiny deterministic scatter so that when the cap bites, every tier / slot / class keeps something */
const scatter = (a: number, b: number) => (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 1, 40503)) >>> 0;

/** `known`: already extracted avatar items by `${slot}/${id}` (basic clothes sit in the same folders); they are reused, not written twice. */
export function extractGear(tools: GearTools, character: WzLike, strings: WzLike | null, dir: string, lg: Logger, known: Map<string, ExtractedItem> = new Map()): GearResult {
  const { log, warn } = lg;
  const none: GearResult = { manifest: null, bytes: 0, items: new Map(), ids: {} };
  try {
    // ---- scan every equip image's info node ----
    const names = equipNames(strings, lg);
    const cands: Candidate[] = [];
    const seen = { images: 0, cash: 0, noFrames: 0, pirate: 0, noInfo: 0, unreadable: 0, noTuc: 0, flagged: 0, noStats: 0 };
    const infoKeys = new Map<string, number>();
    const vslots = new Map<string, number>();
    const islots = new Map<string, number>();
    const perFolder = new Map<string, number>();
    for (const path of character.names()) {
      const m = /^(cap|coat|longcoat|pants|shoes|glove|cape|shield|weapon)\/(\d+)\.img$/i.exec(path);
      if (!m) continue;
      const f = FOLDERS[m[1].toLowerCase()];
      const n = Number(m[2]);
      if (f.slot === 'weapon' && !ALL_WEAPON_TYPES.has(Math.floor(n / 10000))) continue;
      perFolder.set(m[1], (perFolder.get(m[1]) ?? 0) + 1);
      let img: { root: Any; key: Any } | null = null;
      try {
        img = character.image(path);
      } catch {
        img = null;
      }
      if (!img) {
        seen.unreadable++;
        continue;
      }
      seen.images++;
      const root = img.root;
      const info = root.get('info');
      if (!info?.children) {
        seen.noInfo++;
        continue;
      }
      for (const k of info.keys()) infoKeys.set(k, (infoKeys.get(k) ?? 0) + 1);
      const val = (k: string) => info.get(k)?.value;
      const vs = String(val('vslot') ?? '');
      const is = String(val('islot') ?? '');
      vslots.set(vs, (vslots.get(vs) ?? 0) + 1);
      islots.set(is, (islots.get(is) ?? 0) + 1);
      if (intOf(val('cash')) === 1) {
        seen.cash++;
        continue;
      }
      const has = (a: string) => tools.frameNodes(root.get(a)).length > 0;
      // armor needs stand1 and walk1; weapons may use the 2 variants (bows stand with stand2)
      const walks = f.slot === 'weapon' ? has('walk1') || has('walk2') : has('walk1');
      const stands = f.slot === 'weapon' ? has('stand1') || has('stand2') : has('stand1');
      if (!stands || !walks) {
        seen.noFrames++;
        continue;
      }
      const job = intOf(val('reqJob'));
      if (job === 16) {
        seen.pirate++;
        continue;
      }
      const stats: GearStats = {};
      for (const [k, to] of Object.entries(INC)) {
        const v = intOf(val(k));
        if (v) stats[to] = v;
      }
      // a normal drop item: upgradeable (tuc > 0), not an event / limited / set / untradeable novelty, and with a stat that counts
      if (intOf(val('tuc')) <= 0) {
        seen.noTuc++;
        continue;
      }
      if (['timeLimited', 'notSale', 'exItem', 'setItemID', 'charmEXP'].some((k) => intOf(val(k)) !== 0) || intOf(val('tradeBlock')) === 1) {
        seen.flagged++;
        continue;
      }
      const hasStat = f.slot === 'weapon' ? !!(stats.pad || (stats.mad && [137, 138].includes(Math.floor(n / 10000)))) : Object.keys(stats).length > 0;
      if (!hasStat) {
        seen.noStats++;
        continue;
      }
      cands.push({ id: m[2].padStart(8, '0'), n, slot: f.slot, folder: m[1], long: f.long, level: intOf(val('reqLevel')), job, gender: genderOfId(n), stats, where: path, tuc: intOf(val('tuc')) });
    }
    log(`gear: scanned ${seen.images} equip images (${[...perFolder].map(([k, v]) => `${k} ${v}`).join(', ')}); skipped ${seen.cash} cash, ${seen.noFrames} without stand/walk frames, ${seen.pirate} pirate-only, ${seen.noInfo} without info, ${seen.unreadable} unreadable; filters removed ${seen.noTuc} with tuc <= 0, ${seen.flagged} flagged timeLimited/notSale/exItem/setItemID/charmEXP/tradeBlock, ${seen.noStats} without a usable inc* stat; ${cands.length} candidates`);
    const top = (m: Map<string, number>, k = 40) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([s, c]) => `${s || '(none)'}x${c}`).join(' ');
    log(`gear: info keys seen: ${top(infoKeys, 60)}`);
    log(`gear: islot values seen: ${top(islots)}`);
    log(`gear: vslot values seen: ${top(vslots)}`);
    if (!cands.length) {
      warn('gear: no usable equipment found; drops use placeholder items and the hero keeps its look');
      return none;
    }

    // ---- selection: buckets of (tier, slot, class, gender), two lowest ids each ----
    const byLevel = cands.map((c) => ({ c, tier: tierOfLevel(c.level) }));
    interface Pick { c: Candidate; key: number }
    const picks: Pick[] = [];
    const chosenIds = new Set<string>();
    let bi = 0;
    const classes = CLASSES.map((c) => c.key as ClassKey);
    for (let tier = 0; tier < TIER_LEVELS.length; tier++) {
      for (const slot of GEAR_SLOTS) {
        for (const cls of classes) {
          if (slot === 'shield' && cls !== 'warrior') continue;
          for (const gender of (slot === 'weapon' || slot === 'shield' ? [2] : ARMOR.includes(slot) ? [0, 1] : [2]) as (0 | 1 | 2)[]) {
            bi++;
            const pool = byLevel
              .filter(({ c, tier: t }) => {
                if (t !== tier || c.slot !== slot || !jobFits(c.job, cls)) return false;
                if (slot === 'weapon') return WEAPON_TYPES[cls].includes(Math.floor(c.n / 10000));
                return gender === 2 || c.gender === 2 || c.gender === gender;
              })
              .map((x) => x.c)
              .sort((a, b) => classic(a.n) - classic(b.n) || a.n - b.n);
            pool.slice(0, PER_BUCKET).forEach((c, rank) => {
              // tier 3 first-picks come first (the CI preview needs a full set), then the rest of rank 0, then rank 1; spread inside a rank
              const lead = tier === 3 && rank === 0 ? 0 : 1 + rank;
              picks.push({ c, key: lead * 4294967296 + scatter(tier, bi) });
            });
          }
        }
      }
    }
    picks.sort((a, b) => a.key - b.key);
    const chosen: Candidate[] = [];
    let overCap = 0;
    for (const p of picks) {
      if (chosenIds.has(p.c.id)) continue;
      if (chosen.length >= MAX_GEAR_ITEMS) {
        overCap++;
        continue;
      }
      chosenIds.add(p.c.id);
      chosen.push(p.c);
    }
    if (overCap) log(`gear: ${overCap} more candidate picks were dropped by the ${MAX_GEAR_ITEMS} item cap`);

    // ---- extract frames and icons ----
    const items = new Map<string, ExtractedItem>();
    const entries: Record<string, GearEntry> = {};
    const icons: { id: string; w: number; h: number; rgba: Buffer; ox: number; oy: number }[] = [];
    const ids: Partial<Record<Slot, string[]>> = {};
    let bytes = 0;
    const failed: string[] = [];
    let noIcon = 0;
    for (const c of chosen) {
      const img = character.image(c.where);
      if (!img) {
        failed.push(`${c.id} (gone)`);
        continue;
      }
      try {
        const problems: string[] = [];
        const old = known.get(`${c.slot}/${c.id}`);
        const it = old ?? tools.extractItem(img.root, img.key, c.slot, c.id, problems);
        for (const p of problems.slice(0, 1)) warn(`gear ${c.where}: ${p}`);
        if (!it) {
          failed.push(`${c.id} (no frames)`);
          continue;
        }
        if (!old) {
          writeFileSync(join(dir, itemFile(c.slot, c.id, 'png')), encodePng(it.atlas.w, it.atlas.h, it.atlas.rgba));
          writeFileSync(join(dir, itemFile(c.slot, c.id, 'json')), JSON.stringify(it.json));
          bytes += it.bytes;
          items.set(`${c.slot}/${c.id}`, it);
          (ids[c.slot] ??= []).push(c.id);
        }
        const entry: GearEntry = {
          slot: c.slot, name: names.get(c.n) ?? `Item ${c.n}`, level: c.level, job: c.job, ...(c.gender !== 2 ? { g: c.gender } : {}), ...(c.long ? { long: true } : {}), tuc: c.tuc, stats: c.stats,
        };
        entries[c.id] = entry;
        // the icon (info/icon, 32x32-ish) with its origin
        const ic = img.root.get('info/icon');
        let hadIcon = false;
        if (ic?.type === 'canvas') {
          try {
            const [w, h, rgba] = canvasRgba(ic, img.key);
            if (w > 0 && h > 0) {
              const o = ic.get('origin')?.value;
              icons.push({ id: c.id, w, h, rgba, ox: o?.x ?? 0, oy: o?.y ?? 0 });
              hadIcon = true;
            }
          } catch (e) {
            warn(`gear icon ${c.where}: ${(e as Error).message}`);
          }
        }
        if (!hadIcon) noIcon++;
      } catch (e) {
        warn(`gear ${c.where}: ${(e as Error).stack}`);
        failed.push(`${c.id} (error)`);
      }
    }
    if (failed.length) log(`gear: ${failed.length} chosen items could not be extracted: ${failed.slice(0, 30).join('; ')}`);
    if (!Object.keys(entries).length) {
      warn('gear: none of the chosen items could be extracted; drops use placeholder items');
      return none;
    }
    let iconAtlas = '';
    if (icons.length) {
      const atlas = tools.shelfPack(icons);
      icons.forEach((ic, i) => {
        entries[ic.id].icon = { x: atlas.pos[i].x, y: atlas.pos[i].y, w: ic.w, h: ic.h, ox: ic.ox, oy: ic.oy };
      });
      const png = encodePng(atlas.w, atlas.h, atlas.rgba);
      writeFileSync(join(dir, 'gear-icons.png'), png);
      bytes += png.length;
      iconAtlas = 'avatar/gear-icons.png';
      log(`gear: icon atlas ${atlas.w}x${atlas.h} with ${icons.length} icons`);
    }
    if (noIcon) log(`gear: ${noIcon} items have no info/icon (shown as plain squares)`);

    // ---- report ----
    const perSlot = GEAR_SLOTS.map((s) => `${s} ${Object.values(entries).filter((e) => e.slot === s).length}`).join(', ');
    log(`gear: ${Object.keys(entries).length} items extracted (${perSlot}), ${bytes} bytes (${(bytes / 1e6).toFixed(2)} MB), cap ${MAX_GEAR_ITEMS}`);
    log('gear: id | slot | name | reqLevel | reqJob | gender | stats');
    const rows = Object.entries(entries).slice(0, 40);
    for (const [id, e] of rows) {
      log(`gear: ${id} | ${e.slot}${e.long ? '(long)' : ''} | ${e.name} | ${e.level} | ${e.job} | ${e.g ?? '-'} | ${Object.entries(e.stats).map(([k, v]) => `${k}${v}`).join(' ') || '-'}`);
    }
    const manifest: GearManifest = { items: entries as Record<string, GearEntry>, iconAtlas };
    return { manifest, bytes, items, ids };
  } catch (e) {
    warn(`gear extraction failed: ${(e as Error).stack}`);
    return none;
  }
}

/**
 * ASCII previews of one composited look per class wearing a tier-3 set (cap, coat, pants, shoes, glove, weapon), through the same
 * compose() as the browser. `loaded` holds the base avatar items and the gear items by `${slot}/${id}`.
 */
export function previewGear(gear: GearResult, loaded: Map<string, ExtractedItem>, z: ZTable, lg: Logger) {
  const { log, warn } = lg;
  if (!gear.manifest) return;
  try {
    const pool = Object.entries(gear.manifest.items).sort((a, b) => a[0].localeCompare(b[0]));
    for (const c of CLASSES) {
      const cls = c.key as ClassKey;
      const look = defaultLook(c.weapon);
      const base = lookItems(look);
      const wear: Partial<Record<GearSlot, string>> = {};
      for (const slot of GEAR_SLOTS) {
        const fits = pool.filter(([, e]) => e.slot === slot && jobFits(e.job, cls) && (e.g === undefined || e.g === 0) && (slot !== 'shield' || cls === 'warrior'));
        const at3 = fits.filter(([, e]) => tierOfLevel(e.level) === 3);
        const pick = (at3.length ? at3 : fits.filter(([, e]) => tierOfLevel(e.level) <= 3).slice(-1))[0];
        if (pick) wear[slot] = pick[0];
      }
      const dress = { ...look, gear: { ...wear, longcoat: wear.coat ? !!gear.manifest.items[wear.coat].long : false } };
      const ids = lookItems(dress);
      const parts: Part[] = [];
      for (const slot of Object.keys(ids) as Slot[]) {
        const it = ids[slot] ? loaded.get(`${slot}/${ids[slot]}`) : null;
        if (it) parts.push({ slot, item: it.json });
      }
      const wpn = parts.find((p) => p.slot === 'weapon')?.item ?? null;
      const st = stanceActions(c.stance, wpn);
      const comp = compose(parts, st.stand, 0, z);
      const worn = Object.entries(wear).map(([s, id]) => `${s}=${id} "${gear.manifest!.items[id].name}"`).join(', ');
      if (!comp) {
        log(`gear preview ${c.name}: no ${st.stand} composition (${worn})`);
        continue;
      }
      const cap = parts.find((p) => p.slot === 'cap');
      log(`gear preview ${c.name} ${st.stand}/0: ${comp.placed.length} layers; wearing ${worn || 'nothing'}${cap ? `; cap vslot "${cap.item.info?.vslot ?? ''}", hair layers shown: ${comp.placed.filter((p) => p.slot === 'hair').map((p) => p.layer.n).join(',') || 'none'}` : ''}`);
      const r = rasterize(comp, (p) => {
        const it = loaded.get(`${p.slot}/${ids[p.slot]}`);
        return it ? { w: it.atlas.w, data: it.atlas.rgba } : null;
      });
      console.log(`--- ${c.name} in a tier-3 set, ${st.stand}/0 ${r.w}x${r.h} ---\n${asciiPreview(r.w, r.h, Buffer.from(r.rgba), Math.min(70, r.w))}`);
    }
  } catch (e) {
    warn(`gear preview: ${(e as Error).stack}`);
  }
}
