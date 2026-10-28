import type { Sim } from './sim.ts';
import { EV_BOX, EV_TREASURE, FIELD, GACHA, GEM, MASTERY } from './types.ts';

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
    // boxes never attack and Treasure Pigs only run: neither is something to flee from
    if (!e.alive || e.ev === EV_BOX || e.ev === EV_TREASURE) continue;
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
  // quiet enough to detour for a box or a Treasure Pig
  const calm = fx * fx + fy * fy < 0.04;
  let best = 1e9, gx = 0, gy = 0;
  const ps = sim.pickups;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.kind === GEM || p.kind === 1 || p.kind === 3 || p.kind === GACHA || p.kind === MASTERY || p.kind === FIELD) {
      const dx = p.x - px, dy = p.y - py;
      const d2 = dx * dx + dy * dy;
      // capsules and Mastery Books are worth a longer walk and win over nearer gems
      const rare = p.kind === GACHA || p.kind === MASTERY || p.kind === FIELD;
      const score = rare ? d2 * 0.1 : d2;
      if (score < best && d2 < (rare ? 900 : 144)) { best = score; gx = dx; gy = dy; }
    }
  }
  // field items sit where the hero can reach them; breakable boxes (within 45 yd) and fleeing Treasure Pigs (within 20 yd) are worth a walk when calm
  if (calm) {
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (!e.alive || (e.ev !== EV_BOX && e.ev !== EV_TREASURE)) continue;
      const dx = e.x - px, dy = e.y - py;
      const d2 = dx * dx + dy * dy;
      const score = d2 * 0.1;
      if (score < best && d2 < (e.ev === EV_BOX ? 2025 : 400)) { best = score; gx = dx; gy = dy; }
    }
  }
  let x = 0, y = 0;
  if (best < 1e9) {
    const d = Math.hypot(gx, gy) || 1;
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

/** Card the bot takes from an open offer: a job (first branch), then skills, passives, Masteries (damage first), and only then fillers. */
export function botPick(sim: Sim): number {
  const o = sim.offer;
  if (!o || o.length === 0) return 0;
  const rank = (c: (typeof o)[number]) => {
    switch (c.kind) {
      case 'job': return 0;
      case 'skill': return 1;
      case 'passive': return 2;
      case 'mastery': return c.key === 'mastery' || c.key.startsWith('skill_mastery:') ? 3 : 4;
      case 'elixir': return sim.hp < sim.maxHp * 0.5 ? 3.5 : 6;
      default: return 5;
    }
  };
  let best = 0;
  for (let i = 1; i < o.length; i++) if (rank(o[i]) < rank(o[best])) best = i;
  return best;
}
