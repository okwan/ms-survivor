/**
 * The v83 login map (UI.wz MapLogin.img): backgrounds from Map.wz Back/login.img and objects from Map.wz Obj/login.img placed
 * on one tall map; the client moves its camera between the login steps (title, world select, character select, creation).
 * Written by scripts/fetch-maple-login.ts as the `login` manifest section; laid out here by placements(), which both the
 * browser renderer (src/ui/login.ts) and the CI preview use. No side effects.
 */

export interface LoginSprite {
  /** PNG path relative to maple/ */
  src: string;
  w: number;
  h: number;
  /** WZ origin: the point of the image placed at the sprite's position */
  ox: number;
  oy: number;
  delay: number;
}

export interface LoginBack {
  frames: LoginSprite[];
  x: number;
  y: number;
  /** parallax in percent of the camera movement (0 = fixed to the screen, -100 = fixed to the map) */
  rx: number;
  ry: number;
  /** tiling distance (0 = the image size) */
  cx: number;
  cy: number;
  /** 0 normal, 1 h-tiled, 2 v-tiled, 3 tiled, 4 h-tiled + h-scroll, 5 v-tiled + v-scroll, 6 tiled + h-scroll, 7 tiled + v-scroll */
  type: number;
  /** opacity 0..255 */
  a: number;
  front: boolean;
  flip: boolean;
}

export interface LoginObj {
  frames: LoginSprite[];
  x: number;
  y: number;
  z: number;
  layer: number;
  flip: boolean;
  /** oS/l0/l1/l2, e.g. login/Title/logo/0 */
  path: string;
}

export interface LoginSection {
  /** the UI.wz image the scene came from */
  source: string;
  backs: LoginBack[];
  objs: LoginObj[];
  /** VR bounds of the map when given */
  bounds: { left: number; top: number; right: number; bottom: number } | null;
  /** camera centres of the login steps when they could be found from the map's objects */
  steps: Partial<Record<LoginStep, { x: number; y: number }>>;
}

export type LoginStep = 'title' | 'world' | 'select' | 'create';

export const VIEW_W = 800;
export const VIEW_H = 600;

export interface Placement {
  sprite: LoginSprite;
  /** screen position of the image's top-left corner */
  x: number;
  y: number;
  flip: boolean;
  alpha: number;
}

/** The frame of an animation at time t (ms), looping. */
export function frameAt(frames: LoginSprite[], t: number): LoginSprite {
  if (frames.length === 1) return frames[0];
  const total = frames.reduce((s, f) => s + f.delay, 0) || 1;
  let r = t % total;
  for (const f of frames) {
    if (r < f.delay) return f;
    r -= f.delay;
  }
  return frames[frames.length - 1];
}

/**
 * Everything to draw for a camera centred at (camX, camY) at time t, back to front, in screen pixels of an 800x600 view.
 * Backgrounds follow the client's parallax rule: screen = pos + rx * cam / 100 + half view, so rx 0 stays on the screen and
 * rx -100 moves with the map; scrolling types drift by rx (or ry) / 16 px per 1/60 s.
 */
export function placements(scene: LoginSection, camX: number, camY: number, t: number): Placement[] {
  const out: Placement[] = [];
  const hw = VIEW_W / 2, hh = VIEW_H / 2;
  const back = (b: LoginBack) => {
    const f = frameAt(b.frames, t);
    const cx = b.cx || f.w, cy = b.cy || f.h;
    const ht = b.type === 1 || b.type === 3 || b.type === 4 || b.type === 6 || b.type === 7;
    const vt = b.type === 2 || b.type === 3 || b.type === 5 || b.type === 6 || b.type === 7;
    const hScroll = b.type === 4 || b.type === 6;
    const vScroll = b.type === 5 || b.type === 7;
    let x = hScroll ? b.x - camX + hw + ((b.rx / 16) * t * 60) / 1000 : b.x + (b.rx * camX) / 100 + hw;
    let y = vScroll ? b.y - camY + hh + ((b.ry / 16) * t * 60) / 1000 : b.y + (b.ry * camY) / 100 + hh;
    x -= b.flip ? f.w - f.ox : f.ox;
    y -= f.oy;
    if (ht) x = (((x % cx) + cx) % cx) - cx;
    if (vt) y = (((y % cy) + cy) % cy) - cy;
    const nx = ht ? Math.ceil(VIEW_W / cx) + 2 : 1;
    const ny = vt ? Math.ceil(VIEW_H / cy) + 2 : 1;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const px = x + i * cx, py = y + j * cy;
        if (px > VIEW_W || py > VIEW_H || px + f.w < 0 || py + f.h < 0) continue;
        out.push({ sprite: f, x: px, y: py, flip: b.flip, alpha: b.a / 255 });
      }
  };
  for (const b of scene.backs) if (!b.front) back(b);
  for (const o of scene.objs) {
    const f = frameAt(o.frames, t);
    const x = o.x - camX + hw - (o.flip ? f.w - f.ox : f.ox);
    const y = o.y - camY + hh - f.oy;
    if (x > VIEW_W || y > VIEW_H || x + f.w < 0 || y + f.h < 0) continue;
    out.push({ sprite: f, x, y, flip: o.flip, alpha: 1 });
  }
  for (const b of scene.backs) if (b.front) back(b);
  return out;
}
