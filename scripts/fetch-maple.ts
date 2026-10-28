// Deploy-time asset step: gets MapleStory's Mob/Skill/String/Sound .wz files, converts the art and music the game
// lists in src/maple/assets.ts into PNG atlases + mp3 + manifest.json under <dist>/maple/. Nothing from Nexon is
// ever committed; this runs in CI only.
//
//   node --experimental-strip-types scripts/fetch-maple.ts dist              # download (or reuse .maple-cache), extract, convert
//   node --experimental-strip-types scripts/fetch-maple.ts dist path/to/wz   # use a folder that already holds the .wz files
//
// It NEVER fails the build: every error becomes a warning and the game keeps its placeholder art.
import { execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { mobSpeedFactor } from '../src/game/data.ts';
import { BGM_NODES, MOB_ACTIONS, SKILL_ANIMS, WANTED_MOBS, WANTED_SKILLS, WZ_FILES, pad7 } from '../src/maple/assets.ts';
import type { FrameRec, MapleManifest, MobEntry, SkillEntry } from '../src/maple/assets.ts';
import { extractAvatar } from './fetch-maple-character.ts';
import { buildRegions } from './fetch-maple-regions.ts';
import { buildSfx } from './fetch-maple-sfx.ts';
import { buildItems } from './fetch-maple-items.ts';
import { buildWorld } from './fetch-maple-world.ts';
import { asciiPreview, encodePng } from './png.mjs';
import { canvasRgba, openWz } from './wz.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const log = (...a: unknown[]) => console.log('maple:', ...a);
const warn = (...a: unknown[]) => {
  console.log('maple: WARN', ...a);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=maple assets::${a.join(' ').replace(/\n/g, ' ')}`);
};

const MAX_ATLAS_W = 2048;
const MAX_ATLAS_H = 4096;
const PAD = 1;
/** frames of these actions are dropped first when a mob's atlas would be taller than MAX_ATLAS_H */
const DROP_ORDER = ['attack1', 'hit1'];
const PREVIEW_MOBS = [100100, 1210102, 2220000, 8800000];
const PREVIEW_COLS = 40;

// ---- WZ access ---------------------------------------------------------------------------------------------------

function findFiles(dir: string, re: RegExp, depth = 0): string[] {
  const out: string[] = [];
  if (depth > 8 || !existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...findFiles(p, re, depth + 1));
    else if (re.test(name)) out.push(p);
  }
  return out;
}

interface OpenImage {
  root: Any;
  key: Any;
}

/** All .wz files of one family (Mob.wz, or Mob001.wz...) opened together; images are looked up by path, case-insensitively. */
class WzSet {
  stem: string;
  files: { path: string; wz: Any; index: Map<string, string> }[] = [];
  region = '';
  version = 0;
  constructor(stem: string) {
    this.stem = stem;
  }
  static open(dir: string, stem: string): WzSet | null {
    const set = new WzSet(stem);
    const paths = findFiles(dir, new RegExp(`^${stem}\\d*\\.wz$`, 'i')).sort();
    for (const path of paths) {
      try {
        const wz = openWz(readFileSync(path));
        const index = new Map<string, string>();
        for (const e of wz.walk()) index.set(e.path.toLowerCase(), e.path);
        set.files.push({ path, wz, index });
        if (!set.region) {
          set.region = wz.region;
          set.version = wz.version;
        }
        log(`${basename(path)}: ${(statSync(path).size / 1e6).toFixed(1)} MB, key ${wz.region}, version ${wz.version}, ${index.size} images`);
      } catch (e) {
        warn(`cannot open ${path}: ${(e as Error).message}`);
      }
    }
    return set.files.length ? set : null;
  }
  names(): string[] {
    return this.files.flatMap((f) => [...f.index.values()]);
  }
  image(path: string): OpenImage | null {
    for (const f of this.files) {
      const real = f.index.get(path.toLowerCase());
      if (!real) continue;
      try {
        return { root: f.wz.image(real), key: f.wz.key };
      } catch (e) {
        warn(`cannot parse ${this.stem}.wz/${real}: ${(e as Error).message}`);
      }
    }
    return null;
  }
}

const isNum = (k: string) => /^\d+$/.test(k);
const byNum = (a: string, b: string) => Number(a) - Number(b);

/** The canvases of an animation node, in order: the node itself, its numbered canvas children, or (for skill `hit`) the first numbered sub-node's. */
function canvasList(node: Any): Any[] {
  if (!node) return [];
  if (node.type === 'canvas') return [node];
  const nums = node.keys().filter(isNum).sort(byNum);
  const direct = nums.map((k: string) => node.get(k)).filter((n: Any) => n?.type === 'canvas');
  if (direct.length) return direct;
  for (const k of nums) {
    const sub = node.get(k);
    if (!sub || sub.type === 'canvas') continue;
    const l = sub
      .keys()
      .filter(isNum)
      .sort(byNum)
      .map((x: string) => sub.get(x))
      .filter((n: Any) => n?.type === 'canvas');
    if (l.length) return l;
  }
  return [];
}

interface RawFrame {
  action: string;
  index: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  delay: number;
  rgba: Buffer;
  /** identity of the source canvas, so UOL-shared frames are stored once */
  id: object;
}

function decodeFrames(list: Any[], key: Any, action: string, problems: string[]): RawFrame[] {
  const out: RawFrame[] = [];
  list.forEach((c, index) => {
    try {
      const [w, h, rgba] = canvasRgba(c, key);
      if (w < 1 || h < 1) return;
      const o = c.get('origin')?.value;
      out.push({ action, index, w, h, ox: o?.x ?? 0, oy: o?.y ?? 0, delay: Math.max(1, c.num('delay', 100)), rgba, id: c });
    } catch (e) {
      problems.push(`${action}/${index}: ${(e as Error).message}`);
    }
  });
  return out;
}

// ---- atlas packing -----------------------------------------------------------------------------------------------

interface Atlas {
  w: number;
  h: number;
  rgba: Buffer;
  recs: FrameRec[];
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Simple shelf packing (tallest first, rows left to right) into an atlas at most 2048 wide; identical source canvases share a slot. */
export function packAtlas(frames: RawFrame[]): Atlas | null {
  if (!frames.length) return null;
  const uniq = [...new Map(frames.map((f) => [f.id, f])).values()];
  const area = uniq.reduce((a, f) => a + (f.w + PAD) * (f.h + PAD), 0);
  const maxFrameW = Math.max(...uniq.map((f) => f.w));
  const W = Math.max(maxFrameW + 2 * PAD, Math.min(MAX_ATLAS_W, nextPow2(Math.ceil(Math.sqrt(area * 1.25)))));
  const order = [...uniq].sort((a, b) => b.h - a.h || b.w - a.w);
  const pos = new Map<object, { x: number; y: number }>();
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const f of order) {
    if (x + f.w + PAD > W) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    pos.set(f.id, { x, y });
    x += f.w + PAD;
    rowH = Math.max(rowH, f.h);
  }
  const H = y + rowH + PAD;
  const rgba = Buffer.alloc(W * H * 4);
  for (const f of uniq) {
    const p = pos.get(f.id)!;
    for (let row = 0; row < f.h; row++) f.rgba.copy(rgba, ((p.y + row) * W + p.x) * 4, row * f.w * 4, (row + 1) * f.w * 4);
  }
  const recs: FrameRec[] = frames.map((f) => {
    const p = pos.get(f.id)!;
    return { action: f.action, index: f.index, x: p.x, y: p.y, w: f.w, h: f.h, ox: f.ox, oy: f.oy, delay: f.delay };
  });
  return { w: W, h: H, rgba, recs };
}

/** Packs, dropping low-priority actions while the atlas would exceed the height limit. Returns what was dropped. */
function packLimited(frames: RawFrame[]): { atlas: Atlas | null; dropped: string[] } {
  let use = frames;
  const dropped: string[] = [];
  for (let i = 0; ; i++) {
    const atlas = packAtlas(use);
    if (!atlas || atlas.h <= MAX_ATLAS_H || i >= DROP_ORDER.length) return { atlas, dropped };
    dropped.push(DROP_ORDER[i]);
    use = use.filter((f) => f.action !== DROP_ORDER[i]);
  }
}

function writePng(path: string, w: number, h: number, rgba: Buffer): number {
  mkdirSync(dirname(path), { recursive: true });
  const png = encodePng(w, h, rgba);
  writeFileSync(path, png);
  return png.length;
}

// ---- mobs --------------------------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function linkChain(mobs: WzSet, id: number): OpenImage[] {
  const chain: OpenImage[] = [];
  const seen = new Set<number>();
  let cur: number | null = id;
  while (cur !== null && !seen.has(cur) && chain.length < 5) {
    seen.add(cur);
    const img = mobs.image(`${pad7(cur)}.img`);
    if (!img) {
      if (chain.length) warn(`mob ${id}: linked image ${pad7(cur)}.img is missing`);
      break;
    }
    chain.push(img);
    const link = img.root.get('info/link')?.value;
    cur = link === undefined || link === null || link === '' || Number(link) === 0 ? null : Number(link);
    if (cur !== null && Number.isNaN(cur)) cur = null;
  }
  return chain;
}

interface Report {
  mobsOk: number;
  mobsMissing: string[];
  mobsMismatch: string[];
  mobsNoName: string[];
  mobFrames: number;
  skillsOk: number;
  skillsMissing: string[];
  skillFrames: number;
  bytes: number;
  bgm: { run: string | null; title: string | null };
  tableLines: string[];
}

function extractMobs(mobs: WzSet | null, strings: WzSet | null, dist: string, report: Report): Record<string, MobEntry> {
  const out: Record<string, MobEntry> = {};
  const nameImg = strings?.image('Mob.img') ?? null;
  if (strings && !nameImg) warn(`String.wz has no Mob.img (images: ${strings.names().slice(0, 30).join(' ')})`);
  const previews = new Map<number, { w: number; h: number; rgba: Buffer }>();
  const head = ['tier', 'id', 'expected', 'String.wz', 'flag', 'frames'];
  const rows: string[][] = [];

  for (const want of WANTED_MOBS) {
    const sName: string | undefined = nameImg?.root.get(`${want.id}/name`)?.value;
    const flags: string[] = [];
    if (nameImg) {
      if (sName === undefined) {
        flags.push('MISSING');
        report.mobsNoName.push(`${want.id} ${want.name}`);
      } else if (norm(sName) !== norm(want.name)) {
        flags.push('MISMATCH');
        report.mobsMismatch.push(`${want.id} expected "${want.name}" got "${sName}"`);
      }
    }
    let summary = 'no Mob.wz image';
    try {
      const chain = mobs ? linkChain(mobs, want.id) : [];
      if (chain.length) {
        const problems: string[] = [];
        const frames: RawFrame[] = [];
        const counts: string[] = [];
        for (const action of MOB_ACTIONS) {
          let list: Any[] = [];
          let key: Any = null;
          let from = action as string;
          for (const src of action === 'move' ? ['move', 'fly'] : [action]) {
            for (const img of chain) {
              list = canvasList(img.root.get(src));
              if (list.length) {
                key = img.key;
                from = src;
                break;
              }
            }
            if (list.length) break;
          }
          if (!list.length) continue;
          const dec = decodeFrames(list, key, action, problems);
          frames.push(...dec);
          counts.push(`${action}${from !== action ? `(${from})` : ''}:${dec.length}`);
        }
        for (const p of problems.slice(0, 3)) warn(`mob ${want.id} ${want.name}: ${p}`);
        const { atlas, dropped } = packLimited(frames);
        if (dropped.length) warn(`mob ${want.id} ${want.name}: atlas too tall, dropped ${dropped.join(', ')}`);
        if (atlas && (frames.some((f) => f.action === 'stand') || frames.some((f) => f.action === 'move'))) {
          const kept = atlas.recs.filter((r) => !dropped.includes(r.action));
          const rel = `mobs/${pad7(want.id)}.png`;
          report.bytes += writePng(join(dist, 'maple', rel), atlas.w, atlas.h, atlas.rgba);
          const info: Record<string, number> = {};
          for (const img of [...chain].reverse()) {
            const inf = img.root.get('info');
            for (const k of inf?.keys() ?? []) {
              const v = inf.get(k)?.value;
              if (typeof v === 'number' && k !== 'link') info[k] = v;
            }
          }
          // speed: info/speed (percent offset) or info/flySpeed for flyers, info/fs as a float multiplier; logged for every wanted mob so a CI log shows the real layout
          const raw = (k: string) => {
            for (const img of chain) {
              const v = img.root.get(`info/${k}`)?.value;
              if (v !== undefined && v !== null && v !== '') return Number(v);
            }
            return undefined;
          };
          const rawNum = (k: string) => { const v = raw(k); return v === undefined || Number.isNaN(v) ? undefined : v; };
          const sp = { speed: rawNum('speed'), flySpeed: rawNum('flySpeed'), fs: rawNum('fs') };
          const flies = chain.some((img) => img.root.get('fly')) && !chain.some((img) => img.root.get('move'));
          const factor = mobSpeedFactor(sp, flies);
          log(`mob speed ${want.id} ${want.name}: speed=${sp.speed ?? '-'} flySpeed=${sp.flySpeed ?? '-'} fs=${sp.fs ?? '-'} ${flies ? '(flyer)' : ''} -> factor ${factor === undefined ? 'none (hand-tuned speed kept)' : factor.toFixed(2)}`);
          out[String(want.id)] = { name: sName ?? want.name, atlas: rel, size: [atlas.w, atlas.h], frames: kept, info, ...(factor !== undefined ? { speed: Math.round(factor * 100) / 100 } : {}) };
          report.mobsOk++;
          report.mobFrames += kept.length;
          summary = `${counts.join(' ')} -> ${atlas.w}x${atlas.h}${chain.length > 1 ? ` (link ${chain.length - 1})` : ''}`;
          const st = frames.find((f) => f.action === 'stand') ?? frames[0];
          if (PREVIEW_MOBS.includes(want.id) && st) previews.set(want.id, { w: st.w, h: st.h, rgba: st.rgba });
        } else {
          summary = 'no stand/move frames';
          report.mobsMissing.push(`${want.id} ${want.name} (no usable frames)`);
        }
      } else {
        report.mobsMissing.push(`${want.id} ${want.name}`);
      }
    } catch (e) {
      summary = 'error: ' + (e as Error).message;
      warn(`mob ${want.id} ${want.name}: ${(e as Error).stack}`);
      report.mobsMissing.push(`${want.id} ${want.name} (error)`);
    }
    rows.push([want.tier, String(want.id), want.name, sName ?? '-', flags.join(',') || 'ok', summary]);
  }

  const widths = head.map((h, i) => Math.max(h.length, ...rows.slice(0, 80).map((r) => (i < 5 ? r[i].length : 0))));
  const fmt = (r: string[]) => r.map((c, i) => (i < 5 ? c.padEnd(widths[i]) : c)).join('  ');
  report.tableLines.push(fmt(head), ...rows.map(fmt));
  log('mob table (tier, id, expected name from data.ts, name in String.wz, flag, extracted frames):');
  for (const l of report.tableLines) console.log('  ' + l);

  for (const id of PREVIEW_MOBS) {
    const p = previews.get(id);
    const nm = WANTED_MOBS.find((m) => m.id === id)?.name ?? '?';
    if (!p) log(`preview ${nm} (${id}): not available`);
    else console.log(`--- ${nm} (${id}) stand/0 ${p.w}x${p.h} ---\n${asciiPreview(p.w, p.h, p.rgba, PREVIEW_COLS)}`);
  }
  return out;
}

// ---- skills ------------------------------------------------------------------------------------------------------

function extractSkills(skillWz: WzSet | null, dist: string, report: Report): Record<string, SkillEntry> {
  const out: Record<string, SkillEntry> = {};
  const images = new Map<string, OpenImage | null>();
  let claw: { w: number; h: number; rgba: Buffer } | null = null;
  for (const want of WANTED_SKILLS) {
    try {
      if (!images.has(want.image)) {
        const img = skillWz?.image(want.image) ?? null;
        images.set(want.image, img);
        if (!img) warn(`Skill.wz has no ${want.image}${skillWz ? ` (first images: ${skillWz.names().slice(0, 20).join(' ')})` : ''}`);
      }
      const img = images.get(want.image);
      const node = img?.root.get(`skill/${want.node}`);
      if (!img || !node) {
        report.skillsMissing.push(`${want.id} ${want.name} (${want.image}/skill/${want.node})`);
        log(`skill ${want.id} ${want.name}: MISSING (${want.image}/skill/${want.node}${img ? ', node absent' : ', image absent'})`);
        continue;
      }
      const problems: string[] = [];
      let icon: string | null = null;
      let iconDesc = 'none';
      const iconFrames = decodeFrames(canvasList(node.get('icon')), img.key, 'icon', problems);
      if (iconFrames.length) {
        const f = iconFrames[0];
        icon = `skills/${pad7(want.id)}-icon.png`;
        report.bytes += writePng(join(dist, 'maple', icon), f.w, f.h, f.rgba);
        iconDesc = `${f.w}x${f.h}`;
        if (want.key === 'magic_claw') claw = { w: f.w, h: f.h, rgba: f.rgba };
      }
      const frames: RawFrame[] = [];
      const counts: string[] = [];
      for (const a of SKILL_ANIMS) {
        const dec = decodeFrames(canvasList(node.get(a)), img.key, a, problems);
        frames.push(...dec);
        counts.push(`${a}:${dec.length}`);
      }
      for (const p of problems.slice(0, 3)) warn(`skill ${want.id} ${want.name}: ${p}`);
      const { atlas, dropped } = packLimited(frames);
      if (dropped.length) warn(`skill ${want.id}: atlas too tall, dropped ${dropped.join(', ')}`);
      if (!icon && !atlas) {
        report.skillsMissing.push(`${want.id} ${want.name} (node has no icon or frames; children: ${node.keys().join(',')})`);
        log(`skill ${want.id} ${want.name}: MISSING (node children: ${node.keys().join(',') || '-'})`);
        continue;
      }
      let rel: string | null = null;
      if (atlas) {
        rel = `skills/${pad7(want.id)}.png`;
        report.bytes += writePng(join(dist, 'maple', rel), atlas.w, atlas.h, atlas.rgba);
        report.skillFrames += atlas.recs.length;
      }
      out[String(want.id)] = { atlas: rel, size: atlas ? [atlas.w, atlas.h] : null, icon, frames: atlas ? atlas.recs : [] };
      report.skillsOk++;
      log(`skill ${want.id} ${want.name}: icon ${iconDesc}, ${counts.join(' ')}${atlas ? `, atlas ${atlas.w}x${atlas.h}` : ''}`);
    } catch (e) {
      warn(`skill ${want.id} ${want.name}: ${(e as Error).stack}`);
      report.skillsMissing.push(`${want.id} ${want.name} (error)`);
    }
  }
  if (claw) console.log(`--- Magic Claw icon ${claw.w}x${claw.h} ---\n${asciiPreview(claw.w, claw.h, claw.rgba, PREVIEW_COLS)}`);
  else log('preview Magic Claw icon: not available');
  return out;
}

// ---- music -------------------------------------------------------------------------------------------------------

const hex = (b: Buffer, n = 8) => [...b.subarray(0, n)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const isSync = (b: Buffer, i: number) => b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0 && ((b[i + 1] >> 3) & 3) !== 1 && ((b[i + 1] >> 1) & 3) !== 0;

/** Sniffs the audio container; trims leading junk if a tag or frame sync follows within the first 4 KB. */
export function sniffAudio(data: Buffer): { ext: string; data: Buffer; what: string } {
  const head = data.toString('latin1', 0, 4);
  if (head.startsWith('ID3')) return { ext: 'mp3', data, what: 'ID3 tag' };
  if (isSync(data, 0)) return { ext: 'mp3', data, what: 'MPEG frame sync' };
  if (head === 'RIFF') return { ext: 'wav', data, what: 'RIFF/WAV' };
  if (head === 'OggS') return { ext: 'ogg', data, what: 'Ogg' };
  for (let i = 1; i < Math.min(4096, data.length - 4); i++) {
    if (data.toString('latin1', i, i + 3) === 'ID3') return { ext: 'mp3', data: data.subarray(i), what: `ID3 tag after ${i} junk bytes` };
    if (isSync(data, i)) return { ext: 'mp3', data: data.subarray(i), what: `MPEG frame sync after ${i} junk bytes` };
  }
  return { ext: 'mp3', data, what: 'UNRECOGNISED (written as .mp3 anyway)' };
}

function extractBgm(sound: WzSet | null, dist: string, report: Report): { run: string | null; title: string | null } {
  const out: { run: string | null; title: string | null } = { run: null, title: null };
  for (const slot of ['run', 'title'] as const) {
    const want = BGM_NODES[slot];
    try {
      if (!sound) {
        warn(`bgm ${slot}: Sound.wz not available`);
        continue;
      }
      const img = sound.image(want.image);
      if (!img) {
        const bgmImages = sound.names().filter((n) => /bgm/i.test(n));
        warn(`bgm ${slot}: Sound.wz has no ${want.image}; BGM images: ${bgmImages.join(' ') || '(none)'}; all (${sound.names().length}): ${sound.names().slice(0, 40).join(' ')}`);
        continue;
      }
      const keys: string[] = img.root.keys();
      const k = keys.find((x) => x === want.node) ?? keys.find((x) => x.toLowerCase() === want.node.toLowerCase());
      const node = k ? img.root.get(k) : null;
      if (!node || node.type !== 'sound') {
        warn(`bgm ${slot}: ${want.image} has no sound node "${want.node}"; available (${keys.length}): ${keys.join(', ')}`);
        continue;
      }
      const raw: Buffer = node.value.data;
      if (!raw.length) {
        warn(`bgm ${slot}: ${want.image}/${want.node} has no audio data`);
        continue;
      }
      const s = sniffAudio(raw);
      const rel = `bgm/${slot}.${s.ext}`;
      mkdirSync(join(dist, 'maple', 'bgm'), { recursive: true });
      writeFileSync(join(dist, 'maple', rel), s.data);
      report.bytes += s.data.length;
      out[slot] = rel;
      log(`bgm ${slot}: ${want.image}/${want.node} -> ${rel}, ${(s.data.length / 1e6).toFixed(2)} MB, ${node.value.ms} ms, first bytes ${hex(s.data)}, ${s.what}`);
    } catch (e) {
      warn(`bgm ${slot}: ${(e as Error).stack}`);
    }
  }
  return out;
}

// ---- driver ------------------------------------------------------------------------------------------------------

export interface BuildResult {
  manifest: MapleManifest | null;
  report: Report;
}

/** Reads the four WZ families from wzDir and writes <distDir>/maple/. Never throws. */
export function buildAssets(distDir: string, wzDir: string, mirror: string): BuildResult {
  const report: Report = { mobsOk: 0, mobsMissing: [], mobsMismatch: [], mobsNoName: [], mobFrames: 0, skillsOk: 0, skillsMissing: [], skillFrames: 0, bytes: 0, bgm: { run: null, title: null }, tableLines: [] };
  try {
    const t0 = Date.now();
    rmSync(join(distDir, 'maple'), { recursive: true, force: true });
    const sets: Record<string, WzSet | null> = {};
    for (const stem of WZ_FILES) {
      sets[stem] = WzSet.open(wzDir, stem);
      if (!sets[stem]) warn(`${stem}.wz not found or unreadable in ${wzDir}`);
    }
    const mobs = extractMobs(sets.Mob, sets.String, distDir, report);
    const skills = extractSkills(sets.Skill, distDir, report);
    report.bgm = extractBgm(sets.Sound, distDir, report);
    const av = extractAvatar(sets.Character, sets.Base, join(distDir, 'maple'), { log, warn }, sets.String);
    report.bytes += av.bytes;

    const world = buildWorld({ dist: distDir, sets: { Map: sets.Map, Effect: sets.Effect, UI: sets.UI }, log, warn, canvasList, packAtlas });
    report.bytes += world.bytes;
    const regions = buildRegions({ dist: distDir, sets: { Map: sets.Map, String: sets.String, Sound: sets.Sound }, log, warn, canvasList, packAtlas, sniffAudio });
    const sfx = buildSfx({ dist: distDir, sound: sets.Sound, log, warn, sniffAudio });
    const items = buildItems({ dist: distDir, sets: { Item: sets.Item, String: sets.String, Effect: sets.Effect }, log, warn, canvasList, packAtlas });
    report.bytes += regions.bytes + sfx.bytes + items.bytes;

    const primary = sets.Mob ?? sets.Skill ?? sets.Sound ?? sets.String;
    const manifest: MapleManifest = {
      version: 1,
      source: { mirror, region: primary?.region ?? 'unknown', wzVersion: primary?.version ?? 0 },
      mobs,
      skills,
      bgm: report.bgm,
      ...(av.manifest ? { avatar: av.manifest } : {}),
      ...world.manifest,
      ...regions.manifest,
      ...sfx.manifest,
      ...items.manifest,
    };
    log(`totals: mobs ${report.mobsOk}/${WANTED_MOBS.length} (${report.mobFrames} frames), skills+passives ${report.skillsOk}/${WANTED_SKILLS.length} (${report.skillFrames} animation frames), bgm run=${report.bgm.run ?? 'none'} title=${report.bgm.title ?? 'none'}, ${(report.bytes / 1e6).toFixed(2)} MB written in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (report.mobsMissing.length) log(`missing mobs (${report.mobsMissing.length}): ${report.mobsMissing.join('; ')}`);
    if (report.mobsNoName.length) log(`mobs missing from String.wz (${report.mobsNoName.length}): ${report.mobsNoName.join('; ')}`);
    if (report.mobsMismatch.length) log(`mob NAME MISMATCHES (${report.mobsMismatch.length}): ${report.mobsMismatch.join('; ')}`);
    if (report.skillsMissing.length) log(`missing skills (${report.skillsMissing.length}): ${report.skillsMissing.join('; ')}`);

    if (!report.mobsOk && !report.skillsOk && !report.bgm.run && !report.bgm.title && !av.manifest && !Object.keys(world.manifest).length && !Object.keys(regions.manifest).length && !Object.keys(sfx.manifest).length && !Object.keys(items.manifest).length) {
      warn('nothing could be extracted; no manifest written, the game keeps placeholder art');
      return { manifest: null, report };
    }
    writeFileSync(join(distDir, 'maple', 'manifest.json'), JSON.stringify(manifest));
    log(`wrote ${join(distDir, 'maple', 'manifest.json')} (source ${mirror}, ${manifest.source!.region} v${manifest.source!.wzVersion})`);
    writeSummary(report);
    return { manifest, report };
  } catch (e) {
    warn(`asset conversion failed: ${(e as Error).stack}`);
    return { manifest: null, report };
  }
}

function writeSummary(r: Report) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  try {
    const md = [
      '## Maple assets',
      `- mobs ${r.mobsOk}/${WANTED_MOBS.length}, skills ${r.skillsOk}/${WANTED_SKILLS.length}, bgm run=${r.bgm.run ?? 'none'} title=${r.bgm.title ?? 'none'}, ${(r.bytes / 1e6).toFixed(1)} MB`,
      r.mobsMismatch.length ? `- name mismatches: ${r.mobsMismatch.join('; ')}` : '- no mob name mismatches',
      r.mobsMissing.length ? `- missing mobs: ${r.mobsMissing.join('; ')}` : '- no missing mobs',
      r.skillsMissing.length ? `- missing skills: ${r.skillsMissing.join('; ')}` : '- no missing skills',
      '',
      '```',
      ...r.tableLines,
      '```',
      '',
    ].join('\n');
    writeFileSync(f, md, { flag: 'a' });
  } catch {
    /* summary is optional */
  }
}

// ---- getting the .wz files ---------------------------------------------------------------------------------------

function run(cmd: string, args: string[], timeout = 45 * 60_000): string {
  return execFileSync(cmd, args, { maxBuffer: 1 << 28, timeout, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function logListing(cmd: string, args: string[]) {
  try {
    const lines = run(cmd, args, 5 * 60_000).split('\n');
    const wz = lines.filter((l) => /\.wz\b/i.test(l));
    log(`${cmd} listing: ${lines.length} lines, ${wz.length} mention .wz; first 60 lines:`);
    for (const l of lines.slice(0, 60)) console.log('  | ' + l);
    if (wz.length) {
      log('.wz lines:');
      for (const l of wz.slice(0, 40)) console.log('  | ' + l);
    }
  } catch (e) {
    log(`${cmd} listing failed: ${String((e as Error).message).split('\n')[0]}`);
  }
}

async function download(url: string, dest: string): Promise<void> {
  const t0 = Date.now();
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let got = 0;
  const rs = Readable.fromWeb(res.body as Any);
  rs.on('data', (c: Buffer) => (got += c.length));
  const tick = setInterval(() => log(`downloading ${basename(dest)}: ${(got / 1e6).toFixed(0)}${total ? ` / ${(total / 1e6).toFixed(0)}` : ''} MB`), 15_000);
  try {
    await pipeline(rs, createWriteStream(dest));
  } finally {
    clearInterval(tick);
  }
  log(`downloaded ${url}: ${(statSync(dest).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

function present(wzDir: string): string[] {
  return WZ_FILES.filter((n) => findFiles(wzDir, new RegExp(`^${n}\\d*\\.wz$`, 'i')).length);
}

/** Pulls the wanted .wz files out of an installer/archive into wzDir, innoextract first, then 7z. */
function extractWz(archive: string, wzDir: string, cacheDir: string) {
  mkdirSync(wzDir, { recursive: true });
  const tmp = mkdtempSync(join(cacheDir, 'x-'));
  const names = WZ_FILES.map((n) => `${n}.wz`);
  const harvest = () => {
    for (const n of WZ_FILES) {
      if (findFiles(wzDir, new RegExp(`^${n}\\.wz$`, 'i')).length) continue;
      const hit = findFiles(tmp, new RegExp(`^${n}\\.wz$`, 'i'))[0];
      if (hit) {
        copyFileSync(hit, join(wzDir, `${n}.wz`));
        log(`extracted ${n}.wz (${(statSync(hit).size / 1e6).toFixed(1)} MB) from ${hit.slice(tmp.length + 1)}`);
      }
    }
  };
  try {
    try {
      log(`innoextract ${names.join(' ')} from ${basename(archive)}`);
      run('innoextract', ['-s', ...names.flatMap((n) => ['-I', n]), '-d', join(tmp, 'inno'), archive]);
    } catch (e) {
      warn(`innoextract failed: ${String((e as Error).message).split('\n')[0]}`);
    }
    harvest();
    let missing = WZ_FILES.filter((n) => !present(wzDir).includes(n));
    if (missing.length) {
      logListing('innoextract', ['-l', archive]);
      try {
        log(`7z x ${missing.join(' ')}`);
        run('7z', ['x', '-y', `-o${join(tmp, '7z')}`, archive, '-r', ...missing.map((n) => `${n}.wz`)]);
      } catch (e) {
        warn(`7z failed: ${String((e as Error).message).split('\n')[0]}`);
        logListing('7z', ['l', archive]);
      }
      harvest();
      missing = WZ_FILES.filter((n) => !present(wzDir).includes(n));
      if (missing.length) warn(`still missing after extraction: ${missing.join(', ')}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function mirrorList(): string[] {
  const urls: string[] = [];
  const env = process.env.MAPLE_ARCHIVE_URL?.trim();
  if (env) urls.push(env);
  try {
    const cfg = JSON.parse(readFileSync(new URL('./maple-sources.json', import.meta.url), 'utf8'));
    for (const m of cfg.mirrors ?? []) if (m?.url && !urls.includes(m.url)) urls.push(m.url);
  } catch (e) {
    warn(`cannot read maple-sources.json: ${(e as Error).message}`);
  }
  return urls;
}

async function acquire(cacheDir: string): Promise<{ wzDir: string; mirror: string } | null> {
  const wzDir = join(cacheDir, 'wz');
  const marker = join(wzDir, '.source.json');
  mkdirSync(cacheDir, { recursive: true });
  const have = present(wzDir);
  // reuse the cache only when it holds every listed file: a cache from before a name was added to the list re-extracts
  const readMirror = () => {
    let mirror = 'cache';
    try {
      mirror = JSON.parse(readFileSync(marker, 'utf8')).mirror ?? mirror;
    } catch {
      /* marker is optional */
    }
    return mirror;
  };
  if (have.length === WZ_FILES.length) {
    const mirror = readMirror();
    log(`reusing cached WZ files in ${wzDir}: ${have.join(', ')} (from ${mirror})`);
    return { wzDir, mirror };
  }
  if (have.length) log(`cached WZ files ${have.join(', ')} lack ${WZ_FILES.filter((n) => !have.includes(n)).join(', ')}: fetching the client again`);
  for (const url of mirrorList()) {
    const file = join(cacheDir, basename(new URL(url).pathname) || 'client.bin');
    try {
      log(`trying mirror ${url}`);
      await download(url, file);
      extractWz(file, wzDir, cacheDir);
      const got = present(wzDir);
      if (got.includes('Mob')) writeFileSync(join(wzDir, '.source.json'), JSON.stringify({ mirror: url, at: new Date().toISOString() }));
      // a mirror that leaves files missing (e.g. one that ships loose .img instead of .wz) falls through to the next one
      if (got.length === WZ_FILES.length) return { wzDir, mirror: url };
      warn(`${url} left ${WZ_FILES.filter((n) => !got.includes(n)).join(', ')} missing; trying the next mirror`);
    } catch (e) {
      warn(`mirror ${url} failed: ${(e as Error).message}`);
    } finally {
      // keep only the small .wz files in the cache, never the multi-GB installer
      rmSync(file, { force: true });
    }
  }
  const got = present(wzDir);
  if (got.includes('Mob')) {
    warn(`could not fetch ${WZ_FILES.filter((n) => !got.includes(n)).join(', ')}; using what was extracted (${got.join(', ')})`);
    return { wzDir, mirror: readMirror() };
  }
  return null;
}

async function main() {
  const distDir = process.argv[2] ?? 'dist';
  const localDir = process.argv[3];
  const cacheDir = process.env.MAPLE_CACHE ?? '.maple-cache';
  let src: { wzDir: string; mirror: string } | null;
  if (localDir) {
    src = { wzDir: localDir, mirror: `local:${resolve(localDir)}` };
    log(`using local WZ folder ${localDir}`);
  } else {
    src = await acquire(cacheDir);
  }
  if (!src) {
    warn('no client could be downloaded from any mirror; the game keeps placeholder art');
    return;
  }
  buildAssets(distDir, src.wzDir, src.mirror);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .catch((e) => warn(`asset step failed: ${(e as Error).stack ?? e}`))
    .finally(() => process.exit(0));
}
