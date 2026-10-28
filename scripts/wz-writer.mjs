// A small WZ writer for tests: builds synthetic .wz archives (flat root of .img files) that scripts/wz.mjs can read.
// Not used at deploy time. Format knowledge mirrors scripts/wz.mjs.
//
//   const file = buildWz({ '0100100.img': { info: { speed: -10 }, stand: { 0: canvas(8, 8, px, { origin: vec(4, 8), delay: 120 }) } } });
//
// Tree values: number -> int, string -> string, plain object -> property (children in insertion order),
// and the helpers vec(), canvas(), uol(), sound(), short().
import { deflateSync } from 'node:zlib';
import { IVS, versionHash, wzKey } from './wz.mjs';

export const vec = (x, y) => ({ $: 'vec', x, y });
export const uol = (path) => ({ $: 'uol', path });
export const short = (v) => ({ $: 'short', v });
/** A canvas of w x h pixels (BGRA4444). `pixel(x, y)` returns [r, g, b, a]; `props` are its child properties (origin, delay...). */
export const canvas = (w, h, pixel, props = {}) => ({ $: 'canvas', w, h, pixel, props });
/** A Sound_DX8 node whose audio payload is `data` (a Buffer). */
/** `wfx`: an optional WAVEFORMATEX buffer for the media header (otherwise a 51-byte stand-in without one). */
export const sound = (data, ms = 1000, wfx = null) => ({ $: 'sound', data, ms, wfx });

class Writer {
  constructor(key) {
    this.key = key;
    this.parts = [];
    this.len = 0;
  }
  push(b) {
    this.parts.push(b);
    this.len += b.length;
  }
  u8(v) {
    this.push(Buffer.from([v & 0xff]));
  }
  i8(v) {
    const b = Buffer.alloc(1);
    b.writeInt8(v);
    this.push(b);
  }
  u16(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v);
    this.push(b);
  }
  i16(v) {
    const b = Buffer.alloc(2);
    b.writeInt16LE(v);
    this.push(b);
  }
  i32(v) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    this.push(b);
  }
  u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0);
    this.push(b);
  }
  cint(v) {
    if (v > 127 || v <= -128) {
      this.i8(-128);
      this.i32(v);
    } else this.i8(v);
  }
  str(s) {
    if (!s.length) return this.u8(0);
    const key = this.key;
    if ([...s].every((c) => c.charCodeAt(0) < 0x80)) {
      if (s.length > 127) {
        this.i8(-128);
        this.i32(s.length);
      } else this.i8(-s.length);
      let mask = 0xaa;
      for (let i = 0; i < s.length; i++) {
        this.u8(s.charCodeAt(i) ^ mask ^ key.at(i));
        mask = (mask + 1) & 0xff;
      }
    } else {
      if (s.length >= 127) {
        this.i8(127);
        this.i32(s.length);
      } else this.i8(s.length);
      let mask = 0xaaaa;
      for (let i = 0; i < s.length; i++) {
        this.u16((s.charCodeAt(i) ^ mask ^ ((key.at(i * 2 + 1) << 8) | key.at(i * 2))) & 0xffff);
        mask = (mask + 1) & 0xffff;
      }
    }
  }
  buf() {
    return Buffer.concat(this.parts);
  }
}

function canvas4444(w, h, pixel) {
  const raw = Buffer.alloc(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = pixel(i % w, (i / w) | 0);
    raw[i * 2] = ((g >> 4) << 4) | (b >> 4);
    raw[i * 2 + 1] = ((a >> 4) << 4) | (r >> 4);
  }
  return deflateSync(raw);
}

/** Serialise one property tree to an .img body (offsets inside are relative to the image start). */
export function buildImage(tree, key) {
  const w = new Writer(key);
  const strOffsets = new Map();
  // the first time a name appears it is inline (0x00); later as a back-reference (0x01)
  const block = (s) => {
    if (strOffsets.has(s)) {
      w.u8(0x01);
      w.i32(strOffsets.get(s));
    } else {
      w.u8(0x00);
      strOffsets.set(s, w.len);
      w.str(s);
    }
  };
  const kind = (k) => {
    if (strOffsets.has(k)) {
      w.u8(0x1b);
      w.i32(strOffsets.get(k));
    } else {
      w.u8(0x73);
      strOffsets.set(k, w.len);
      w.str(k);
    }
  };
  const ext = (name, body) => {
    block(name);
    w.u8(0x09);
    const sizeAt = w.parts.length;
    w.u32(0);
    const start = w.len;
    body();
    w.parts[sizeAt].writeUInt32LE(w.len - start);
  };
  const entries = (obj) => {
    const names = Object.keys(obj);
    w.cint(names.length);
    for (const name of names) value(name, obj[name]);
  };
  const value = (name, v) => {
    if (typeof v === 'number') {
      block(name);
      w.u8(0x03);
      w.cint(v);
    } else if (typeof v === 'string') {
      block(name);
      w.u8(0x08);
      block(v);
    } else if (v.$ === 'short') {
      block(name);
      w.u8(0x02);
      w.i16(v.v);
    } else if (v.$ === 'vec') {
      ext(name, () => {
        kind('Shape2D#Vector2D');
        w.cint(v.x);
        w.cint(v.y);
      });
    } else if (v.$ === 'uol') {
      ext(name, () => {
        kind('UOL');
        w.u8(0);
        block(v.path);
      });
    } else if (v.$ === 'sound') {
      ext(name, () => {
        kind('Sound_DX8');
        w.u8(0);
        w.cint(v.data.length);
        w.cint(v.ms);
        w.push(Buffer.alloc(51, 0x11)); // stand-in for the media type GUID block
        if (v.wfx) {
          w.u8(v.wfx.length);
          w.push(v.wfx);
        }
        w.push(v.data);
      });
    } else if (v.$ === 'canvas') {
      ext(name, () => {
        kind('Canvas');
        w.u8(0);
        const n = Object.keys(v.props).length;
        if (n) {
          w.u8(1);
          w.u16(0);
          entries(v.props);
        } else w.u8(0);
        const data = canvas4444(v.w, v.h, v.pixel);
        w.cint(v.w);
        w.cint(v.h);
        w.cint(1);
        w.u8(0);
        w.i32(0);
        w.i32(data.length + 1);
        w.u8(0);
        w.push(data);
      });
    } else {
      ext(name, () => {
        kind('Property');
        w.u16(0);
        entries(v);
      });
    }
  };
  w.u8(0x73);
  w.str('Property');
  w.u16(0);
  entries(tree);
  return w.buf();
}

/**
 * A complete .wz file holding the given { 'Name.img': tree } images. Keys with slashes ('Tile/grassySoil.img') become
 * nested directories, like the real Map.wz.
 */
export function buildWz(images, { iv = 'gms', version = 83 } = {}) {
  const key = wzKey(IVS[iv]);
  const { hash, check } = versionHash(version);
  const encOffset = (pos, fstart, target) => {
    let off = ((pos - fstart) ^ 0xffffffff) >>> 0;
    off = Math.imul(off, hash) >>> 0;
    off = (off - 0x581c3f6d) >>> 0;
    const s = off & 0x1f;
    off = ((off << s) | (off >>> ((32 - s) & 31))) >>> 0;
    return (off ^ ((target - fstart * 2) >>> 0)) >>> 0;
  };
  const fstart = 60;
  // directory tree: { dirs: Map(name -> node), imgs: [{ name, body }] }
  const mkNode = () => ({ dirs: new Map(), imgs: [] });
  const rootNode = mkNode();
  for (const path of Object.keys(images)) {
    const parts = path.split('/');
    let node = rootNode;
    for (const d of parts.slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, mkNode());
      node = node.dirs.get(d);
    }
    node.imgs.push({ name: parts.at(-1), body: buildImage(images[path], key) });
  }
  // entries of a directory: sub-directories first, then images; each prefix is everything but the 4-byte offset
  const prefixOf = (type, name, size) => {
    const p = new Writer(key);
    p.u8(type);
    p.str(name);
    p.cint(size);
    p.cint(0);
    return p.buf();
  };
  const prep = (node) => {
    node.entries = [
      ...[...node.dirs].map(([name, child]) => ({ child, prefix: prefixOf(3, name, 1) })),
      ...node.imgs.map((im) => ({ img: im, prefix: prefixOf(4, im.name, im.body.length) })),
    ];
    for (const d of node.dirs.values()) prep(d);
    const head = new Writer(key);
    head.cint(node.entries.length);
    node.len = head.len + node.entries.reduce((a, e) => a + e.prefix.length + 4, 0);
  };
  prep(rootNode);
  // layout: each directory, then its sub-directories, then its images
  let at = fstart + 2;
  const chunks = [];
  const place = (node) => {
    node.at = at;
    at += node.len;
    chunks.push(node);
    for (const e of node.entries) if (e.child) place(e.child);
    for (const e of node.entries)
      if (e.img) {
        e.img.at = at;
        at += e.img.body.length;
        chunks.push(e.img);
      }
  };
  place(rootNode);
  const bodies = chunks.map((c) => {
    if (c.body) return c.body;
    const dir = new Writer(key);
    dir.cint(c.entries.length);
    for (const e of c.entries) {
      dir.push(e.prefix);
      dir.u32(encOffset(c.at + dir.len, fstart, e.child ? e.child.at : e.img.at));
    }
    return dir.buf();
  });
  const out = Buffer.alloc(fstart + 2);
  out.write('PKG1', 0, 'latin1');
  out.write('Package file v1.0 Copyright 2002 Wizet, ZMS', 16, 'latin1');
  out.writeUInt16LE(check, fstart);
  const body = Buffer.concat(bodies);
  out.writeBigUInt64LE(BigInt(body.length + 2), 4);
  out.writeUInt32LE(fstart, 12);
  return Buffer.concat([out, body]);
}
