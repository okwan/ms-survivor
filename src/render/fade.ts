/**
 * Cross-fade state of the region scenery (see regions.ts). Pure, no pixi: the front slot (the region being shown) is always
 * visible and always on top, fading in from alpha 0; the back slot (the region leaving) stays opaque underneath until the front
 * is complete and is only shown while the fade runs. Regression: the front slot's ground used to keep the `visible = false` it got
 * while it was a hidden back slot, so after the first boss the whole ground vanished and only the clear colour was left.
 */
export const FADE = 2.5;

export interface FadeView {
  /** progress 0..1 (1 = settled) */
  fade: number;
  fading: boolean;
  frontVisible: boolean;
  frontAlpha: number;
  backVisible: boolean;
  /** the back ground stays opaque beneath the fading-in front; only its decor fades out */
  backGroundAlpha: number;
  backDecorAlpha: number;
}

/** Advances the fade by dt seconds, clamped to 0..1 (non-finite values settle it). */
export function advanceFade(fade: number, dt: number, dur = FADE): number {
  const f = fade + dt / dur;
  return Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 1;
}

export function fadeView(fade: number): FadeView {
  const f = Number.isFinite(fade) ? Math.max(0, Math.min(1, fade)) : 1;
  const fading = f < 1;
  return { fade: f, fading, frontVisible: true, frontAlpha: f, backVisible: fading, backGroundAlpha: 1, backDecorAlpha: 1 - f };
}
