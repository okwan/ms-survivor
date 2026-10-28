/** True on touch-first devices (coarse pointer or any touch points); false without a window (tests). */
export function isTouch(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  } catch {
    return false;
  }
}

/** True when the viewport is taller than wide (phone held upright). */
export function isPortrait(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.matchMedia('(orientation: portrait)').matches; } catch { return false; }
}

type FsDoc = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

/** Whether the page may go fullscreen (standard or webkit-prefixed API). */
export function canFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

/** Enters or leaves fullscreen; on entering, tries to lock landscape (failures ignored). */
export async function toggleFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      return;
    }
    const el = document.documentElement as FsEl;
    await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
    try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'); } catch { /* not supported or refused */ }
  } catch { /* fullscreen refused */ }
}
