// Sound_DX8 payloads -> playable files. The node header (scripts/wz.mjs `header`) is 51 bytes of media-type GUIDs, one length
// byte and then a WAVEFORMATEX: tag 0x55 is MP3 (the payload is written as-is), tag 1 is PCM (a RIFF/WAVE header is prepended).
// Anything else, or a header that cannot be read, falls back to sniffing the payload itself.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface WaveFormat {
  tag: number;
  channels: number;
  rate: number;
  bits: number;
  blockAlign: number;
}

export interface DecodedSound {
  ext: 'mp3' | 'wav' | 'ogg';
  data: Buffer;
  /** human-readable description for the log */
  what: string;
  fmt: WaveFormat | null;
}

/** WAVEFORMATEX out of a sound node's header, or null. Tolerates a wrong length byte by taking everything after offset 52. */
export function waveFormat(header: Buffer | undefined): WaveFormat | null {
  if (!header || header.length < 52 + 16) return null;
  let wfx = header.subarray(52, 52 + header[51]);
  if (wfx.length < 16) wfx = header.subarray(52);
  if (wfx.length < 16) return null;
  return { tag: wfx.readUInt16LE(0), channels: wfx.readUInt16LE(2), rate: wfx.readUInt32LE(4), blockAlign: wfx.readUInt16LE(12), bits: wfx.readUInt16LE(14) };
}

/** A RIFF/WAVE file around raw PCM samples. */
export function pcmToWav(pcm: Buffer, f: WaveFormat): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1');
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8, 'latin1');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(f.channels, 22);
  h.writeUInt32LE(f.rate, 24);
  const align = f.blockAlign || (f.channels * f.bits) / 8;
  h.writeUInt32LE(f.rate * align, 28);
  h.writeUInt16LE(align, 32);
  h.writeUInt16LE(f.bits, 34);
  h.write('data', 36, 'latin1');
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** `sniff` is sniffAudio from fetch-maple.ts (passed in so the files do not import each other). */
export function decodeSound(node: Any, sniff: (b: Buffer) => { ext: string; data: Buffer; what: string }): DecodedSound | null {
  const raw: Buffer | undefined = node?.value?.data;
  if (!raw || !raw.length) return null;
  const fmt = waveFormat(node.value.header);
  if (fmt?.tag === 1 && raw.toString('latin1', 0, 4) !== 'RIFF' && fmt.channels >= 1 && fmt.rate >= 4000 && fmt.bits >= 8) {
    return { ext: 'wav', data: pcmToWav(raw, fmt), what: `PCM ${fmt.channels}ch ${fmt.rate} Hz ${fmt.bits} bit`, fmt };
  }
  const s = sniff(raw);
  const ext = s.ext === 'wav' || s.ext === 'ogg' ? s.ext : 'mp3';
  return { ext, data: s.data, what: `${fmt ? `tag 0x${fmt.tag.toString(16)} ${fmt.channels}ch ${fmt.rate} Hz, ` : 'no wave format, '}${s.what}`, fmt };
}

/** Child of `node` whose name matches one of `names` (case-insensitive, in the order given), or null. */
export function childOf(node: Any, names: string[]): Any {
  if (!node || !node.keys) return null;
  const keys: string[] = node.keys();
  for (const n of names) {
    const k = keys.find((x) => x === n) ?? keys.find((x) => x.toLowerCase() === n.toLowerCase());
    if (k !== undefined) return node.get(k);
  }
  return null;
}
