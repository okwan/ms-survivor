// A small reader for pre-Big Bang MapleStory WZ archives (GMS v83 and friends).
// Written against the format as HaRepacker Resurrected (MapleLib) and the wz_reader crate read it:
// a PKG1 header, an encrypted version hash, encrypted directory names and offsets, and .img
// property trees whose Canvas nodes hold zlib-compressed pixels.
//
//   const wz = openWz(readFileSync('Mob.wz'));
//   const img = wz.image('0100100.img');          // the property tree of one .img
//   const png = encodePng(...canvasRgba(img.get('stand/0')));
import { createCipheriv } from 'node:crypto';
import { inflateSync, constants as zc } from 'node:zlib';

// The MapleStory AES-256 user key and the per-region IVs that seed the WZ key stream.
const USER_KEY = Buffer.from([
  0x13, 0, 0, 0, 0x08, 0, 0, 0, 0x06, 0, 0, 0, 0xb4, 0, 0, 0, 0x1b, 0, 0, 0, 0x0f, 0, 0, 0, 0x33, 0, 0, 0, 0x52, 0, 0, 0,
]);
export const IVS = {
  gms: [0x4d, 0x23, 0xc7, 0x2b],
  ems: [0xb9, 0x7d, 0x63, 0xe9],
  none: [0, 0, 0, 0],
};
const OFFSET_KEY = 0x581c3f6d;

/** The WZ key stream for an IV: AES-256 in OFB fashion, grown on demand. All zero for the zero IV. */
export function wzKey(iv) {
  let buf = Buffer.alloc(0);
  const zero = iv.every((b) => b === 0);
  const grow = (n) => {
    if (n <= buf.length) return;
    const size = Math.max(n, buf.length * 2, 0x10000);
    const next = Buffer.alloc(size);
    buf.copy(next);
    if (!zero) {
      const c = createCipheriv('aes-256-ecb', USER_KEY, null);
      c.setAutoPadding(false);
      let start = buf.length;
      if (start === 0) {
        c.update(Buffer.from([...iv, ...iv, ...iv, ...iv])).copy(next, 0);
        start = 16;
      }
      for (let i = start; i < size; i += 16) c.update(next.subarray(i - 16, i)).copy(next, i);
    }
    buf = next;
  };
  return {
    at(i) {
      grow(i + 1);
      return buf[i];
    },
    bytes(n) {
      grow(n);
      return buf.subarray(0, n);
    },
  };
}

/** The version hash for a client version, and the one-byte check the header stores. */
export function versionHash(version) {
  let h = 0;
  for (const ch of String(version)) h = (Math.imul(h, 32) + ch.charCodeAt(0) + 1) >>> 0;
  const check = 0xff ^ ((h >>> 24) & 0xff) ^ ((h >>> 16) & 0xff) ^ ((h >>> 8) & 0xff) ^ (h & 0xff);
  return { hash: h, check };
}

class Reader {
  constructor(buf, key) {
    this.buf = buf;
    this.key = key;
    this.pos = 0;
  }
  u8() {
    return this.buf[this.pos++];
  }
  i8() {
    return this.buf.readInt8(this.pos++);
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64LE(this.pos);
    this.pos += 8;
    return Number(v);
  }
  f32() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }
  bytes(n) {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  /** A compressed int: one signed byte, or -128 then an int32. */
  cint() {
    const b = this.i8();
    return b === -128 ? this.i32() : b;
  }
  clong() {
    const b = this.i8();
    return b === -128 ? this.i64() : b;
  }
  /** An encrypted string: positive length is UTF-16, negative is one byte per char. */
  str() {
    const small = this.i8();
    if (small === 0) return '';
    let out = '';
    if (small > 0) {
      const len = small === 127 ? this.i32() : small;
      let mask = 0xaaaa;
      for (let i = 0; i < len; i++) {
        const c = this.u16() ^ mask ^ ((this.key.at(i * 2 + 1) << 8) | this.key.at(i * 2));
        out += String.fromCharCode(c & 0xffff);
        mask = (mask + 1) & 0xffff;
      }
    } else {
      const len = small === -128 ? this.i32() : -small;
      let mask = 0xaa;
      for (let i = 0; i < len; i++) {
        out += String.fromCharCode(this.u8() ^ mask ^ this.key.at(i));
        mask = (mask + 1) & 0xff;
      }
    }
    return out;
  }
  strAt(offset) {
    const back = this.pos;
    this.pos = offset;
    const s = this.str();
    this.pos = back;
    return s;
  }
  /** A string inside an image: inline, or a back-reference relative to the image start. */
  strBlock(imgStart) {
    const t = this.u8();
    if (t === 0x00 || t === 0x73) return this.str();
    if (t === 0x01 || t === 0x1b) return this.strAt(imgStart + this.i32());
    throw new Error(`bad string block type 0x${t.toString(16)} at ${this.pos - 1}`);
  }
}

/** Header fields of a WZ file. */
export function readHeader(buf) {
  if (buf.toString('latin1', 0, 4) !== 'PKG1') throw new Error('not a WZ file (no PKG1 magic)');
  const fileSize = Number(buf.readBigUInt64LE(4));
  const fstart = buf.readUInt32LE(12);
  const copyright = buf.toString('latin1', 16, fstart).replace(/\0.*$/s, '');
  return { fileSize, fstart, copyright, encVersion: buf.readUInt16LE(fstart) };
}

function decodeOffset(r, fstart, hash) {
  let off = ((r.pos - fstart) ^ 0xffffffff) >>> 0;
  off = Math.imul(off, hash) >>> 0;
  off = (off - OFFSET_KEY) >>> 0;
  const s = off & 0x1f;
  off = ((off << s) | (off >>> ((32 - s) & 31))) >>> 0;
  off = (off ^ r.u32()) >>> 0;
  return (off + fstart * 2) >>> 0;
}

function readDirectory(r, h, hash, offset) {
  r.pos = offset;
  const count = r.cint();
  if (count < 0 || count > 100000) throw new Error(`bad directory entry count ${count} at ${offset}`);
  const entries = [];
  for (let i = 0; i < count; i++) {
    let type = r.u8();
    let name;
    if (type === 1) {
      r.i32();
      r.i16();
      decodeOffset(r, h.fstart, hash);
      continue;
    } else if (type === 2) {
      const so = r.i32();
      const back = r.pos;
      r.pos = h.fstart + so;
      type = r.u8();
      name = r.str();
      r.pos = back;
    } else if (type === 3 || type === 4) {
      name = r.str();
    } else {
      throw new Error(`bad directory entry type ${type} at ${r.pos - 1}`);
    }
    const size = r.cint();
    const checksum = r.cint();
    const off = decodeOffset(r, h.fstart, hash);
    entries.push({ type: type === 3 ? 'dir' : 'img', name, size, checksum, offset: off });
  }
  return entries;
}

const NAME_OK = /^[\w.\- #()&']{1,64}$/;

function tryOpen(buf, h, key, version) {
  const { hash, check } = versionHash(version);
  if (check !== h.encVersion) return null;
  const r = new Reader(buf, key);
  const root = readDirectory(r, h, hash, h.fstart + 2);
  if (!root.length) return null;
  for (const e of root) {
    if (!NAME_OK.test(e.name)) return null;
    if (e.offset < h.fstart || e.offset >= buf.length) return null;
    if (e.type === 'img' && e.offset + e.size > buf.length) return null;
  }
  // an image must start with its property header, a directory with a sane count
  const img = root.find((e) => e.type === 'img');
  if (img && ![0x73, 0x1b, 0x01].includes(buf[img.offset])) return null;
  return { hash, root, reader: r };
}

/**
 * Open a WZ archive held in memory. Tries each region IV and each client version whose hash
 * matches the header, and keeps the first that decodes to a sane directory.
 */
export function openWz(buf, { versions, ivs } = {}) {
  const h = readHeader(buf);
  const tries = [];
  for (const [ivName, iv] of Object.entries(ivs ?? IVS)) {
    const key = wzKey(iv);
    for (const v of versions ?? range(1, 1000)) {
      let ok = null;
      try {
        ok = tryOpen(buf, h, key, v);
      } catch {
        ok = null;
      }
      if (ok) return new WzFile(buf, h, key, ivName, v, ok);
      tries.push(`${ivName}/v${v}`);
    }
  }
  throw new Error(`could not decode WZ directory (header version check ${h.encVersion}, tried ${tries.length} combinations)`);
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

class WzFile {
  constructor(buf, header, key, region, version, opened) {
    this.buf = buf;
    this.header = header;
    this.key = key;
    this.region = region;
    this.version = version;
    this.hash = opened.hash;
    this.r = opened.reader;
    this.root = opened.root;
    this.dirs = new Map([['', opened.root]]);
  }
  /** Entries of a directory path such as '' or 'Back'. */
  list(path = '') {
    if (this.dirs.has(path)) return this.dirs.get(path);
    const parts = path.split('/');
    const parent = this.list(parts.slice(0, -1).join('/'));
    const e = parent.find((x) => x.type === 'dir' && x.name === parts.at(-1));
    if (!e) throw new Error(`no directory ${path}`);
    const entries = readDirectory(this.r, this.header, this.hash, e.offset);
    this.dirs.set(path, entries);
    return entries;
  }
  /** Every image path in the archive. */
  *walk(path = '') {
    for (const e of this.list(path)) {
      const p = path ? `${path}/${e.name}` : e.name;
      if (e.type === 'dir') yield* this.walk(p);
      else yield { path: p, ...e };
    }
  }
  entry(path) {
    const parts = path.split('/');
    const e = this.list(parts.slice(0, -1).join('/')).find((x) => x.name === parts.at(-1));
    if (!e) throw new Error(`no entry ${path}`);
    return e;
  }
  /** Parse one .img into a property tree. */
  image(path) {
    const e = this.entry(path);
    return parseImage(new Reader(this.buf, this.key), e.offset, path);
  }
}

/** A node of an image's property tree. `value` holds the data; `children` the named sub-properties. */
export class Prop {
  constructor(name, type, value, parent) {
    this.name = name;
    this.type = type;
    this.value = value;
    this.parent = parent;
    this.children = null;
  }
  child(name) {
    return this.children?.get(name);
  }
  /** Follow a slash path, resolving UOL links on the way. */
  get(path) {
    let node = this;
    for (const part of String(path).split('/')) {
      if (!node) return undefined;
      node = part === '..' ? node.parent : node.resolve().child(part);
    }
    return node?.resolve();
  }
  resolve(depth = 0) {
    if (this.type !== 'uol' || depth > 8) return this;
    let node = this.parent;
    for (const part of this.value.split('/')) {
      if (!node) return undefined;
      node = part === '..' ? node.parent : node.child(part);
    }
    return node?.resolve(depth + 1);
  }
  keys() {
    return this.children ? [...this.children.keys()] : [];
  }
  /** A child's value as a number, for int/short/float children such as delay. */
  num(name, fallback = 0) {
    const c = this.get(name);
    return typeof c?.value === 'number' ? c.value : fallback;
  }
}

function parseImage(r, offset, name) {
  r.pos = offset;
  const t = r.u8();
  if (t !== 0x73) throw new Error(`${name}: image header 0x${t.toString(16)}, expected 0x73`);
  const kind = r.str();
  const zero = r.u16();
  if (kind !== 'Property' || zero !== 0) throw new Error(`${name}: image kind ${JSON.stringify(kind)}`);
  const root = new Prop(name, 'property', null, null);
  root.children = parseList(r, offset, root);
  return root;
}

function parseList(r, imgStart, parent) {
  const count = r.cint();
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const name = r.strBlock(imgStart);
    const t = r.u8();
    let p;
    switch (t) {
      case 0x00:
        p = new Prop(name, 'null', null, parent);
        break;
      case 0x02:
      case 0x0b:
        p = new Prop(name, 'short', r.i16(), parent);
        break;
      case 0x03:
      case 0x13:
        p = new Prop(name, 'int', r.cint(), parent);
        break;
      case 0x14:
        p = new Prop(name, 'long', r.clong(), parent);
        break;
      case 0x04: {
        const f = r.u8();
        p = new Prop(name, 'float', f === 0x80 ? r.f32() : 0, parent);
        break;
      }
      case 0x05:
        p = new Prop(name, 'double', r.f64(), parent);
        break;
      case 0x08:
        p = new Prop(name, 'string', r.strBlock(imgStart), parent);
        break;
      case 0x09: {
        const len = r.u32();
        const end = r.pos + len;
        p = parseExtended(r, imgStart, end, name, parent);
        r.pos = end;
        break;
      }
      default:
        throw new Error(`unknown property type 0x${t.toString(16)} for ${name} at ${r.pos - 1}`);
    }
    out.set(name, p);
  }
  return out;
}

function parseExtended(r, imgStart, end, name, parent) {
  const t = r.u8();
  let kind;
  if (t === 0x01 || t === 0x1b) kind = r.strAt(imgStart + r.i32());
  else if (t === 0x00 || t === 0x73) kind = r.str();
  else throw new Error(`bad extended type 0x${t.toString(16)} for ${name}`);
  switch (kind) {
    case 'Property': {
      r.pos += 2;
      const p = new Prop(name, 'property', null, parent);
      p.children = parseList(r, imgStart, p);
      return p;
    }
    case 'Canvas': {
      r.pos += 1;
      const p = new Prop(name, 'canvas', null, parent);
      if (r.u8() === 1) {
        r.pos += 2;
        p.children = parseList(r, imgStart, p);
      }
      const width = r.cint();
      const height = r.cint();
      const format = r.cint();
      const format2 = r.u8();
      r.pos += 4;
      const len = r.i32() - 1;
      r.pos += 1;
      p.value = { width, height, format, format2, data: len > 0 ? r.bytes(len) : Buffer.alloc(0) };
      return p;
    }
    case 'Shape2D#Vector2D':
      return new Prop(name, 'vector', { x: r.cint(), y: r.cint() }, parent);
    case 'Shape2D#Convex2D': {
      const p = new Prop(name, 'convex', null, parent);
      p.children = new Map();
      const n = r.cint();
      for (let i = 0; i < n; i++) p.children.set(String(i), parseExtended(r, imgStart, 0, String(i), p));
      return p;
    }
    case 'Sound_DX8': {
      r.pos += 1;
      const dataLen = r.cint();
      const ms = r.cint();
      // the header (a media type GUID block and WAVEFORMATEX) sits between; the audio is the tail
      const data = end && dataLen > 0 && dataLen <= end - r.pos ? r.buf.subarray(end - dataLen, end) : Buffer.alloc(0);
      return new Prop(name, 'sound', { ms, data }, parent);
    }
    case 'UOL': {
      r.pos += 1;
      const s = r.strBlock(imgStart);
      return new Prop(name, 'uol', s, parent);
    }
    default:
      throw new Error(`unknown extended property ${JSON.stringify(kind)} for ${name}`);
  }
}

// ------------------------------------------------------------------ pixels

const ZLIB_HEADERS = new Set([0x9c78, 0xda78, 0x0178, 0x5e78]);

function inflate(data) {
  return inflateSync(data, { finishFlush: zc.Z_SYNC_FLUSH });
}

/** The raw pixel bytes of a canvas: plain zlib, or (in list-encrypted files) XOR'd zlib blocks. */
export function canvasBytes(canvas, key) {
  const { data } = canvas;
  if (data.length >= 2 && ZLIB_HEADERS.has(data.readUInt16LE(0))) return inflate(data);
  const parts = [];
  let pos = 0;
  while (pos + 4 <= data.length) {
    const n = data.readInt32LE(pos);
    pos += 4;
    if (n <= 0 || pos + n > data.length) break;
    const block = Buffer.from(data.subarray(pos, pos + n));
    for (let i = 0; i < n; i++) block[i] ^= key.at(i);
    parts.push(block);
    pos += n;
  }
  return inflate(Buffer.concat(parts));
}

/** Decode a canvas property to [width, height, RGBA pixels]. */
export function canvasRgba(prop, key) {
  const c = prop.value;
  const { width: w, height: h } = c;
  const src = canvasBytes(c, key);
  const out = Buffer.alloc(w * h * 4);
  const fmt = c.format + c.format2;
  switch (fmt) {
    case 1: // BGRA4444
      for (let i = 0; i < w * h && i * 2 + 1 < src.length; i++) {
        const lo = src[i * 2];
        const hi = src[i * 2 + 1];
        out[i * 4] = (hi & 0x0f) * 17;
        out[i * 4 + 1] = (lo >> 4) * 17;
        out[i * 4 + 2] = (lo & 0x0f) * 17;
        out[i * 4 + 3] = (hi >> 4) * 17;
      }
      break;
    case 2: // BGRA8888
      for (let i = 0; i < w * h && i * 4 + 3 < src.length; i++) {
        out[i * 4] = src[i * 4 + 2];
        out[i * 4 + 1] = src[i * 4 + 1];
        out[i * 4 + 2] = src[i * 4];
        out[i * 4 + 3] = src[i * 4 + 3];
      }
      break;
    case 513: // RGB565
      for (let i = 0; i < w * h && i * 2 + 1 < src.length; i++) put565(out, i, src.readUInt16LE(i * 2));
      break;
    case 517: {
      // RGB565, one colour per 16x16 block
      const bw = Math.ceil(w / 16);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const b = ((y >> 4) * bw + (x >> 4)) * 2;
          if (b + 1 < src.length) put565(out, y * w + x, src.readUInt16LE(b));
        }
      break;
    }
    case 1026: // DXT3
      decodeDxt(src, w, h, out, false);
      break;
    case 2050: // DXT5
      decodeDxt(src, w, h, out, true);
      break;
    default:
      throw new Error(`unsupported canvas format ${c.format}+${c.format2}`);
  }
  return [w, h, out];
}

function put565(out, i, v) {
  out[i * 4] = (((v >> 11) & 31) * 255 + 15) / 31;
  out[i * 4 + 1] = (((v >> 5) & 63) * 255 + 31) / 63;
  out[i * 4 + 2] = ((v & 31) * 255 + 15) / 31;
  out[i * 4 + 3] = 255;
}

function rgb565(v) {
  return [(((v >> 11) & 31) * 255 + 15) / 31 | 0, (((v >> 5) & 63) * 255 + 31) / 63 | 0, ((v & 31) * 255 + 15) / 31 | 0];
}

function decodeDxt(src, w, h, out, dxt5) {
  let p = 0;
  for (let by = 0; by < h; by += 4)
    for (let bx = 0; bx < w; bx += 4) {
      if (p + 16 > src.length) return;
      const alpha = new Uint8Array(16);
      if (dxt5) {
        const a0 = src[p];
        const a1 = src[p + 1];
        const table = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) table.push(((7 - i) * a0 + i * a1) / 7 | 0);
        else {
          for (let i = 1; i < 5; i++) table.push(((5 - i) * a0 + i * a1) / 5 | 0);
          table.push(0, 255);
        }
        let bits = 0n;
        for (let i = 0; i < 6; i++) bits |= BigInt(src[p + 2 + i]) << BigInt(8 * i);
        for (let i = 0; i < 16; i++) alpha[i] = table[Number((bits >> BigInt(3 * i)) & 7n)];
      } else {
        for (let i = 0; i < 16; i++) alpha[i] = ((src[p + (i >> 1)] >> ((i & 1) * 4)) & 0x0f) * 17;
      }
      const c0 = src.readUInt16LE(p + 8);
      const c1 = src.readUInt16LE(p + 10);
      const cols = [rgb565(c0), rgb565(c1)];
      cols.push(cols[0].map((v, k) => (2 * v + cols[1][k]) / 3 | 0), cols[0].map((v, k) => (v + 2 * cols[1][k]) / 3 | 0));
      const idx = src.readUInt32LE(p + 12);
      for (let i = 0; i < 16; i++) {
        const x = bx + (i & 3);
        const y = by + (i >> 2);
        if (x >= w || y >= h) continue;
        const c = cols[(idx >> (2 * i)) & 3];
        const o = (y * w + x) * 4;
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
        out[o + 3] = alpha[i];
      }
      p += 16;
    }
}
