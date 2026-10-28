import type { Sim } from './sim.ts';
import { GEM } from './types.ts';

/**
 * Simple kiting bot: flee close enemies (with a sideways bias so it circles), otherwise
 * collect the nearest pickup. Returns a unit vector in a reused object.
 */
const out = { x: 0, y: 0 };
export function botInput(sim: Sim, spin = 1): { x: number; y: number } {
  let fx = 0, fy = 0;
  const px = sim.px, py = sim.py;
  const es = sim.enemies;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    if (!e.alive) continue;
    const dx = px - e.x, dy = py - e.y;
    const reach = e.boss >= 0 ? sim.cls.botReach + 4.5 : sim.cls.botReach;
    const d2 = dx * dx + dy * dy;
    if (d2 > reach * reach) continue;
    const d = Math.sqrt(d2) || 0.01;
    const k = 1 - d / reach;
    const w = (k * k * (e.boss >= 0 ? 3 : 1)) / d;
    fx += dx * w;
    fy += dy * w;
  }
  let best = 1e9, gx = 0, gy = 0;
  const ps = sim.pickups;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.kind === GEM || p.kind === 1 || p.kind === 3) {
      const dx = p.x - px, dy = p.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < best && d2 < 144) { best = d2; gx = dx; gy = dy; }
    }
  }
  let x = 0, y = 0;
  if (best < 1e9) {
    const d = Math.sqrt(best) || 1;
    x += gx / d;
    y += gy / d;
  } else {
    x = Math.cos(sim.t * 0.4) * 0.4;
    y = Math.sin(sim.t * 0.4) * 0.4;
  }
  x += fx * 2.2 - fy * 0.6 * spin;
  y += fy * 2.2 + fx * 0.6 * spin;
  const l = Math.hypot(x, y) || 1;
  out.x = x / l;
  out.y = y / l;
  return out;
}
