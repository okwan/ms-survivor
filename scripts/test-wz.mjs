// Round-trip test for wz.mjs: writes a tiny synthetic v83-style WZ file (GMS key, version 83)
// with one mob image, then reads it back. Proves the reader is self-consistent; the CI probe
// proves it against a real client.
//
//   node scripts/test-wz.mjs
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { IVS, canvasRgba, openWz, versionHash, wzKey } from './wz.mjs';
import { asciiPreview, encodePng } from './png.mjs';

const key = wzKey(IVS.gms);
const VERSION = 83;
const { hash, check } = versionHash(VERSION);

class Writer {
  constructor() {
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
    const ascii = [...s].every((c) => c.charCodeAt(0) < 0x80);
    if (ascii) {
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

// ---- image body (offsets inside are relative to the image start)
function canvas4444(w, h, pixel) {
  const raw = Buffer.alloc(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = pixel(i % w, (i / w) | 0);
    raw[i * 2] = ((g >> 4) << 4) | (b >> 4);
    raw[i * 2 + 1] = ((a >> 4) << 4) | (r >> 4);
  }
  return deflateSync(raw);
}

function image() {
  const w = new Writer();
  const strOffsets = new Map();
  const block = (s) => {
    // the first time a name appears it is inline (0x00); later as a back-reference (0x01)
    if (strOffsets.has(s)) {
      w.u8(0x01);
      w.i32(strOffsets.get(s));
    } else {
      w.u8(0x00);
      strOffsets.set(s, w.len);
      w.str(s);
    }
  };
  const ext = (name, body) => {
    block(name);
    w.u8(0x09);
    const sizeAt = w.parts.length;
    w.u32(0);
    const start = w.len;
    body();
    const size = w.len - start;
    w.parts[sizeAt].writeUInt32LE(size);
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
  const vec = (name, x, y) =>
    ext(name, () => {
      kind('Shape2D#Vector2D');
      w.cint(x);
      w.cint(y);
    });

  w.u8(0x73);
  w.str('Property');
  w.u16(0);
  w.cint(3);
  ext('info', () => {
    kind('Property');
    w.u16(0);
    w.cint(3);
    block('speed');
    w.u8(0x03);
    w.cint(-10);
    block('name');
    w.u8(0x08);
    block('Snäil');
    block('bodyAttack');
    w.u8(0x02);
    w.i16(1);
  });
  ext('stand', () => {
    kind('Property');
    w.u16(0);
    w.cint(2);
    ext('0', () => {
      kind('Canvas');
      w.u8(0);
      w.u8(1);
      w.u16(0);
      w.cint(2);
      vec('origin', 12, 20);
      block('delay');
      w.u8(0x03);
      w.cint(180);
      const data = canvas4444(24, 20, (x, y) => (Math.hypot(x - 12, y - 10) < 8 ? [240, 120, 32, 255] : [0, 0, 0, 0]));
      w.cint(24);
      w.cint(20);
      w.cint(1);
      w.u8(0);
      w.i32(0);
      w.i32(data.length + 1);
      w.u8(0);
      w.push(data);
    });
    ext('1', () => {
      kind('UOL');
      w.u8(0);
      block('0');
    });
  });
  ext('move', () => {
    kind('Property');
    w.u16(0);
    w.cint(0);
  });
  return w.buf();
}

function encOffset(pos, fstart, target) {
  let off = ((pos - fstart) ^ 0xffffffff) >>> 0;
  off = Math.imul(off, hash) >>> 0;
  off = (off - 0x581c3f6d) >>> 0;
  const s = off & 0x1f;
  off = ((off << s) | (off >>> ((32 - s) & 31))) >>> 0;
  return (off ^ ((target - fstart * 2) >>> 0)) >>> 0;
}

function wzFile() {
  const fstart = 60;
  const img = image();
  const name = '0100100.img';
  // directory: count, type 4, name, size, checksum, offset
  const dir = new Writer();
  dir.cint(1);
  dir.u8(4);
  dir.str(name);
  dir.cint(img.length);
  dir.cint(0);
  const offsetPos = fstart + 2 + dir.len;
  const imgAt = offsetPos + 4;
  dir.u32(encOffset(offsetPos, fstart, imgAt));
  const head = Buffer.alloc(fstart + 2);
  head.write('PKG1', 0, 'latin1');
  head.write('Package file v1.0 Copyright 2002 Wizet, ZMS', 16, 'latin1');
  head.writeUInt16LE(check, fstart);
  const body = Buffer.concat([dir.buf(), img]);
  head.writeBigUInt64LE(BigInt(body.length + 2), 4);
  head.writeUInt32LE(fstart, 12);
  return Buffer.concat([head, body]);
}

const file = wzFile();
const wz = openWz(file);
assert.equal(wz.region, 'gms');
assert.equal(wz.version, VERSION);
assert.deepEqual(
  wz.root.map((e) => e.name),
  ['0100100.img'],
);
const img = wz.image('0100100.img');
assert.deepEqual(img.keys(), ['info', 'stand', 'move']);
assert.equal(img.get('info/speed').value, -10);
assert.equal(img.get('info/name').value, 'Snäil');
assert.equal(img.get('info/bodyAttack').value, 1);
const frame = img.get('stand/0');
assert.equal(frame.type, 'canvas');
assert.deepEqual(frame.get('origin').value, { x: 12, y: 20 });
assert.equal(frame.num('delay'), 180);
assert.equal(img.get('stand/1'), frame, 'UOL resolves to its target');
const [w, h, rgba] = canvasRgba(frame, wz.key);
assert.equal(w, 24);
assert.equal(h, 20);
const centre = (10 * 24 + 12) * 4;
assert.deepEqual([...rgba.subarray(centre, centre + 4)], [255, 119, 34, 255]);
assert.equal(rgba[3], 0);
const png = encodePng(w, h, rgba);
assert.equal(png.subarray(1, 4).toString(), 'PNG');
console.log(asciiPreview(w, h, rgba, 24));
console.log('test-wz: ok');
