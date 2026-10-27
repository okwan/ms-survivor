// Milestone 1 probe: find a GMS v83 client from CI, pull Mob.wz out of it and decode one mob.
// Prints what it finds (candidate sources, the WZ header, the mob's frames as ASCII) and writes
// sample PNGs to <outDir>. Exits 0 either way; the log is the result.
//
//   node scripts/probe-maple.mjs probe-out                 # search the mirrors
//   node scripts/probe-maple.mjs probe-out path/to/Mob.wz  # decode a local file
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { canvasRgba, openWz } from './wz.mjs';
import { asciiPreview, encodePng } from './png.mjs';

const outDir = process.argv[2] ?? 'probe-out';
const localFile = process.argv[3];
const cacheDir = process.env.MAPLE_CACHE ?? '.maple-cache';
const MAX_BYTES = Number(process.env.MAPLE_MAX_BYTES ?? 6e9);
const MOB = process.env.MAPLE_PROBE_MOB ?? '0100100.img'; // Snail
mkdirSync(outDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const log = (...a) => console.log('probe:', ...a);
const summary = [];
const note = (s) => {
  summary.push(s);
  log(s);
};

const ARCHIVE_EXT = /\.(zip|7z|rar|exe|iso)$/i;
const SEARCHES = [
  'maplestory v83',
  'maplestory v0.83',
  'maplestory gms 83',
  'MapleGlobal v83',
  'maplestory client 2009',
  'maplestory wz',
  'heavenms',
  'maplestory localhost',
  'maplestory setup',
];

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(40 * 60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const t0 = Date.now();
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  log(`downloaded ${url} (${(statSync(dest).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return dest;
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

/** archive.org items that might hold a v83 client, with their candidate files ranked. */
async function searchArchiveOrg() {
  const ids = new Map();
  for (const q of SEARCHES) {
    try {
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&rows=40&output=json`;
      const docs = (await getJson(url)).response?.docs ?? [];
      log(`search "${q}": ${docs.length} items`);
      for (const d of docs) if (!ids.has(d.identifier)) ids.set(d.identifier, d.title);
    } catch (e) {
      log(`search "${q}" failed: ${e.message}`);
    }
  }
  const candidates = [];
  for (const [id, title] of [...ids].slice(0, 120)) {
    try {
      const meta = await getJson(`https://archive.org/metadata/${encodeURIComponent(id)}`);
      const files = meta.files ?? [];
      const wz = files.filter((f) => /\.wz$/i.test(f.name));
      const arch = files.filter((f) => ARCHIVE_EXT.test(f.name) && Number(f.size ?? 0) < MAX_BYTES);
      if (!wz.length && !arch.length) continue;
      log(`item ${id} "${title}": ${wz.length} .wz, ${arch.length} archives`);
      for (const f of [...wz, ...arch].slice(0, 25)) log(`    ${f.name} ${(Number(f.size ?? 0) / 1e6).toFixed(1)} MB`);
      const text = `${id} ${title}`.toLowerCase();
      const v83 = /v?0?\.?83\b|v83|heaven|cosmic/.test(text) ? 10 : 0;
      for (const f of wz.filter((f) => /(^|\/)mob\.wz$/i.test(f.name)))
        candidates.push({ score: 100 + v83, kind: 'wz', url: `https://archive.org/download/${id}/${enc(f.name)}`, label: `${id}/${f.name}`, size: Number(f.size) });
      for (const f of arch) {
        const name = f.name.toLowerCase();
        const s = v83 + (/maple/.test(name) ? 5 : 0) + (/83/.test(name) ? 5 : 0) + (/\.zip$/.test(name) ? 2 : 0);
        candidates.push({ score: s, kind: 'archive', id, file: f.name, url: `https://archive.org/download/${id}/${enc(f.name)}`, label: `${id}/${f.name}`, size: Number(f.size ?? 0) });
      }
    } catch (e) {
      log(`metadata ${id} failed: ${e.message}`);
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.size - b.size);
}

/** archive.org serves single files from inside a zip: list it, and fetch Mob.wz alone if present. */
async function mobFromZipListing(c) {
  if (!/\.zip$/i.test(c.file)) return null;
  try {
    const res = await fetch(`${c.url}/`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return null;
    const html = await res.text();
    const paths = [...html.matchAll(/href="([^"]+?\.wz)"/gi)].map((m) => decodeURIComponent(m[1]));
    log(`zip listing ${c.label}: ${paths.length} .wz files ${paths.slice(0, 30).map((p) => p.split('/').pop()).join(' ')}`);
    const mob = paths.find((p) => /(^|\/)mob\.wz$/i.test(p));
    if (!mob) return null;
    const url = mob.startsWith('http') ? mob : mob.startsWith('/') ? `https://archive.org${mob}` : `${c.url}/${mob}`;
    note(`Mob.wz inside zip: ${url}`);
    return await download(url, join(cacheDir, 'Mob.wz'));
  } catch (e) {
    log(`zip listing ${c.label} failed: ${e.message}`);
    return null;
  }
}

function findFile(dir, re) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      const f = findFile(p, re);
      if (f) return f;
    } else if (re.test(name)) return p;
  }
  return null;
}

/** Download a whole archive and pull Mob.wz out with 7z (zip, 7z, rar, many installers) or innoextract. */
async function mobFromArchive(c) {
  if (c.size > MAX_BYTES) return null;
  const dir = mkdtempSync(join(tmpdir(), 'maple-'));
  const file = join(dir, c.file?.split('/').pop() ?? 'archive.bin');
  await download(c.url, file);
  const x = join(dir, 'x');
  try {
    const list = execFileSync('7z', ['l', file], { maxBuffer: 1 << 28 }).toString();
    const wzLines = list.split('\n').filter((l) => /\.wz\s*$/i.test(l));
    log(`7z lists ${wzLines.length} .wz entries in ${c.label}`);
    for (const l of wzLines.slice(0, 40)) log(`    ${l.trim()}`);
    execFileSync('7z', ['x', '-y', `-o${x}`, file, '-r', 'Mob.wz', 'mob.wz', '*.cab', '*.zip', '*.7z'], { stdio: 'ignore' });
  } catch (e) {
    log(`7z on ${c.label}: ${e.message.split('\n')[0]}`);
  }
  let mob = existsSync(x) ? findFile(x, /^mob\.wz$/i) : null;
  if (!mob && /\.exe$/i.test(file)) {
    try {
      execFileSync('innoextract', ['-s', '-I', 'Mob.wz', '-d', join(dir, 'inno'), file], { stdio: 'ignore' });
      mob = findFile(join(dir, 'inno'), /^mob\.wz$/i);
    } catch (e) {
      log(`innoextract on ${c.label}: ${e.message.split('\n')[0]}`);
    }
  }
  // archives nested one level (a zip of a 7z, or InstallShield cabs)
  if (!mob && existsSync(x)) {
    for (const inner of readdirSync(x, { recursive: true }).map(String).filter((n) => /\.(cab|zip|7z)$/i.test(n)).slice(0, 10)) {
      try {
        execFileSync('7z', ['x', '-y', `-o${x}/n`, join(x, inner), '-r', 'Mob.wz', 'mob.wz'], { stdio: 'ignore' });
      } catch {}
    }
    if (existsSync(`${x}/n`)) mob = findFile(`${x}/n`, /^mob\.wz$/i);
  }
  if (mob) note(`Mob.wz extracted from ${c.label} (${(statSync(mob).size / 1e6).toFixed(1)} MB)`);
  return mob;
}

/** Public Google Drive folders the private-server projects point to; listed with gdown if present. */
const DRIVE_FOLDERS = [
  'https://drive.google.com/drive/folders/0BzDsHSr-0V4MYVJ0TWIxd05hYUk', // HeavenMS
  'https://drive.google.com/drive/folders/1hgnb92MGL6xqEp9szEMBh0K9pSJcJ6IT', // Cosmic
];

function listDrive() {
  const out = [];
  for (const url of DRIVE_FOLDERS) {
    try {
      const py = `import gdown,json,sys\nfs=gdown.download_folder(url=sys.argv[1],skip_download=True,quiet=True,remaining_ok=True) or []\nprint(json.dumps([{'id':f.id,'path':f.path} for f in fs]))`;
      const json = execFileSync('python3', ['-c', py, url], { maxBuffer: 1 << 24, timeout: 300_000 }).toString();
      const files = JSON.parse(json.trim().split('\n').pop());
      log(`drive ${url}: ${files.length} files`);
      for (const f of files.slice(0, 80)) log(`    ${f.path}`);
      out.push(...files);
    } catch (e) {
      log(`drive ${url}: ${e.message.split('\n')[0]}`);
    }
  }
  return out;
}

async function findMobWz() {
  const cached = join(cacheDir, 'Mob.wz');
  if (existsSync(cached) && statSync(cached).size > 1e6) {
    note(`using cached ${cached}`);
    return cached;
  }
  const override = process.env.MAPLE_ARCHIVE_URL;
  if (override) {
    note(`trying MAPLE_ARCHIVE_URL ${override}`);
    try {
      if (/\.wz$/i.test(override)) return await download(override, cached);
      const m = await mobFromArchive({ url: override, file: override.split('/').pop(), label: override, size: 0 });
      if (m) return m;
    } catch (e) {
      log(`override failed: ${e.message}`);
    }
  }
  const cands = await searchArchiveOrg();
  note(`${cands.length} archive.org candidates`);
  for (const c of cands.slice(0, 15)) log(`  [${c.score}] ${c.kind} ${c.label} ${(c.size / 1e6).toFixed(0)} MB`);
  for (const c of cands.filter((c) => c.kind === 'wz').slice(0, 3)) {
    try {
      note(`direct Mob.wz ${c.label}`);
      return await download(c.url, cached);
    } catch (e) {
      log(`${c.label}: ${e.message}`);
    }
  }
  for (const c of cands.filter((c) => c.kind === 'archive').slice(0, 6)) {
    const m = await mobFromZipListing(c);
    if (m) return m;
  }
  let budget = Number(process.env.MAPLE_DOWNLOAD_BUDGET ?? 8e9);
  for (const c of cands.filter((c) => c.kind === 'archive' && c.score > 0).slice(0, 4)) {
    if (c.size > budget) continue;
    budget -= c.size;
    try {
      const m = await mobFromArchive(c);
      if (m) return m;
    } catch (e) {
      log(`${c.label}: ${e.message}`);
    }
  }
  const drive = listDrive();
  const mob = drive.find((f) => /(^|\/)mob\.wz$/i.test(f.path));
  if (mob) {
    try {
      execFileSync('python3', ['-c', 'import gdown,sys;gdown.download(id=sys.argv[1],output=sys.argv[2],quiet=False)', mob.id, cached], { stdio: 'inherit', timeout: 1_800_000 });
      if (existsSync(cached)) {
        note(`Mob.wz from Google Drive ${mob.path}`);
        return cached;
      }
    } catch (e) {
      log(`drive download failed: ${e.message.split('\n')[0]}`);
    }
  }
  return null;
}

function decode(path) {
  const buf = readFileSync(path);
  const wz = openWz(buf);
  note(`Mob.wz: ${(buf.length / 1e6).toFixed(1)} MB, "${wz.header.copyright}", region key ${wz.region}, version ${wz.version}`);
  const imgs = [...wz.walk()];
  note(`${imgs.length} images; first: ${imgs.slice(0, 8).map((e) => e.path).join(' ')}`);
  const pick = imgs.find((e) => e.path === MOB) ?? imgs[0];
  let img = wz.image(pick.path);
  const link = img.get('info/link')?.value;
  if (link) {
    log(`${pick.path} links to ${link}`);
    img = wz.image(`${String(link).padStart(7, '0')}.img`);
  }
  note(`${pick.path}: ${img.keys().join(', ')}`);
  const info = img.get('info');
  if (info) log(`info: ${info.keys().map((k) => `${k}=${JSON.stringify(info.get(k)?.value ?? '…')}`).join(' ')}`);
  let shown = 0;
  for (const action of img.keys()) {
    const anim = img.get(action);
    const frames = anim.keys().filter((k) => /^\d+$/.test(k));
    if (!frames.length) continue;
    const descr = [];
    for (const f of frames) {
      const fr = anim.get(f);
      if (fr?.type !== 'canvas') continue;
      try {
        const [w, h, rgba] = canvasRgba(fr, wz.key);
        writeFileSync(join(outDir, `${pick.path.replace('.img', '')}-${action}-${f}.png`), encodePng(w, h, rgba));
        const o = fr.get('origin')?.value;
        descr.push(`${f}:${w}x${h} fmt${fr.value.format}+${fr.value.format2} origin ${o?.x},${o?.y} delay ${fr.num('delay', 100)}`);
        if (shown < 3 && f === '0') {
          shown++;
          console.log(`--- ${pick.path} ${action}/0 ---\n${asciiPreview(w, h, rgba, 48)}`);
        }
      } catch (e) {
        descr.push(`${f}: ${e.message}`);
      }
    }
    log(`${action}: ${descr.join(' | ')}`);
  }
  note(`decoded ${pick.path}; PNGs in ${outDir}`);
}

try {
  const mob = localFile ?? (await findMobWz());
  if (!mob) note('RESULT: no Mob.wz found on any mirror');
  else {
    decode(mob);
    note('RESULT: ok');
  }
} catch (e) {
  note(`RESULT: failed: ${e.stack}`);
}
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## Maple probe\n\n${summary.map((s) => `- ${s}`).join('\n')}\n`, { flag: 'a' });
