// Brightening of dark region art at extraction time: a per-channel gamma lift (c' = 255 * (c / 255) ^ g, g < 1) chosen so the
// average colour reaches a target luminance. Gentler than a flat multiply: darks rise most, highlights barely move.
export const lumaOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The exponent that takes `avg` to `target` luminance (1 when it is already there). */
export function gammaFor(avg: number[], target: number): number {
  const at = (g: number) => lumaOf(...(avg.map((c) => 255 * Math.pow(Math.max(c, 0.5) / 255, g)) as [number, number, number]));
  if (at(1) >= target) return 1;
  let lo = 0.1, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function liftColor(avg: number[], g: number): [number, number, number] {
  return avg.map((c) => Math.round(255 * Math.pow(Math.max(c, 0.5) / 255, g))) as [number, number, number];
}

/** Lifts the RGB of an RGBA buffer in place (alpha untouched). */
export function liftRgba(rgba: Buffer, g: number) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, g));
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = lut[rgba[i]];
    rgba[i + 1] = lut[rgba[i + 1]];
    rgba[i + 2] = lut[rgba[i + 2]];
  }
}
