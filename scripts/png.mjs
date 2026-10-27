// Minimal RGBA PNG encoder and an ASCII preview for CI logs.
import { crc32, deflateSync } from 'node:zlib';

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A character-cell picture of an RGBA image, `cols` wide, shaded by luminance where opaque. */
export function asciiPreview(w, h, rgba, cols = 48) {
  const ramp = ' .:-=+*#%@';
  const sx = Math.max(1, w / cols);
  const sy = sx * 2;
  const lines = [];
  for (let y = 0; y < h; y += sy) {
    let line = '';
    for (let x = 0; x < w; x += sx) {
      const o = ((y | 0) * w + (x | 0)) * 4;
      const a = rgba[o + 3];
      if (a < 64) line += ' ';
      else {
        const l = (0.3 * rgba[o] + 0.59 * rgba[o + 1] + 0.11 * rgba[o + 2]) / 255;
        line += ramp[Math.min(ramp.length - 1, 1 + Math.floor((1 - l) * (ramp.length - 1)))];
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}
