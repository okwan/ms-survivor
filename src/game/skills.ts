import {
  CHAIN_FALLOFF, CONE_ANGLE, MISSILE_SPEED, ORBIT_RADIUS, ORBIT_SPIN, POISON_DURATION, POISON_TICK, SKILL_BY_KEY,
  skillCooldown, skillCount, skillDmgMult, skillDuration, skillRadius,
} from './data.ts';
import type { SkillDef } from './data.ts';
import type { Sim } from './sim.ts';
import type { Enemy, SkillState } from './types.ts';

const chainHit: Enemy[] = new Array<Enemy>(16);
const used: number[] = [];

export function updateSkills(sim: Sim, dt: number) {
  const list = sim.skills;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    o.cd -= dt;
    if (o.cd > 0) continue;
    const def = SKILL_BY_KEY[o.key];
    if (fire(sim, def, o)) {
      o.cd = skillCooldown(def, o.level, sim.haste);
      if (def.kind !== 'orbit') sim.lastFire = sim.t;
    }
    else o.cd = 0.1;
  }
}

function fire(sim: Sim, def: SkillDef, o: SkillState): boolean {
  sim.curSkill = def.key;
  const L = o.level;
  const dmg = def.dmg * skillDmgMult(L);
  const count = skillCount(def, L);
  const radius = skillRadius(def, L, sim.area);
  const px = sim.px, py = sim.py;
  switch (def.kind) {
    case 'bolt':
    case 'pierce': {
      const found = sim.nearestN(px, py, def.range, def.kind === 'pierce' ? 1 : count);
      if (found === 0) return false;
      for (let i = 0; i < count; i++) {
        const tgt = sim.sel[i % found];
        let ang = Math.atan2(tgt.y - py, tgt.x - px);
        if (def.kind === 'pierce' && count > 1) ang += (i - (count - 1) / 2) * 0.22;
        const p = sim.newProjectile();
        p.skill = def.key;
        p.x = px; p.y = py;
        const spd = def.missile ?? MISSILE_SPEED;
        p.speed = spd;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd;
        p.dmg = dmg;
        p.life = def.range / spd + 0.4;
        p.splash = radius;
        if (def.kind === 'pierce') {
          p.pierce = true;
          p.pierceLeft = (def.pierceBase ?? 3) + L;
          p.target = null;
        } else {
          p.target = tgt;
        }
      }
      return true;
    }
    case 'strike': {
      const found = sim.nearestN(px, py, def.range, count);
      if (found === 0) return false;
      // copy targets: areaDamage reuses query buffers but not sel
      for (let i = 0; i < found; i++) {
        const t = sim.sel[i];
        const tx = t.x, ty = t.y;
        sim.emit({ type: 'cast', skill: def.key, kind: 'strike', x: px, y: py, tx, ty, r: radius, pts: null });
        if (radius > 0) sim.areaDamage(tx, ty, radius, dmg, def.slow ? skillDuration(def.slow, L) : 0);
        else sim.hit(t, dmg);
      }
      return true;
    }
    case 'nova': {
      if (sim.countNear(px, py, radius) === 0) return false;
      sim.emit({ type: 'cast', skill: def.key, kind: 'nova', x: px, y: py, tx: px, ty: py, r: radius, pts: null });
      sim.areaDamage(px, py, radius, dmg, def.slow ? skillDuration(def.slow, L) : 0);
      if (def.heal) sim.hp = Math.min(sim.maxHp, sim.hp + def.heal * skillDmgMult(L));
      return true;
    }
    case 'ground': {
      const found = sim.nearestN(px, py, def.range, 24);
      if (found === 0) return false;
      used.length = 0;
      for (let n = 0; n < count; n++) {
        let bi = -1, bc = -1;
        for (let i = 0; i < found; i++) {
          const e = sim.sel[i];
          let skip = false;
          for (let u = 0; u < used.length; u += 2) {
            const dx = e.x - used[u], dy = e.y - used[u + 1];
            if (dx * dx + dy * dy < radius * radius) { skip = true; break; }
          }
          if (skip) continue;
          const c = sim.countNear(e.x, e.y, radius);
          if (c > bc) { bc = c; bi = i; }
        }
        if (bi < 0) break;
        const e = sim.sel[bi];
        used.push(e.x, e.y);
        const a = sim.newArea();
        a.skill = def.key;
        a.x = e.x; a.y = e.y; a.r = radius;
        a.dur = a.t = skillDuration(def.dur ?? POISON_DURATION, L);
        a.tick = POISON_TICK * 0.5;
        a.dmg = dmg;
        sim.emit({ type: 'cast', skill: def.key, kind: 'ground', x: px, y: py, tx: a.x, ty: a.y, r: radius, pts: null });
      }
      return true;
    }
    case 'chain': {
      if (sim.nearestN(px, py, def.range, 1) === 0) return false;
      let cur: Enemy | null = sim.sel[0];
      const pts: number[] = [px, py];
      let n = 0;
      while (cur && n < count) {
        chainHit[n] = cur;
        pts.push(cur.x, cur.y);
        sim.hit(cur, dmg * Math.max(0.1, 1 - CHAIN_FALLOFF * n));
        n++;
        if (n >= count) break;
        // nearest unhit living enemy within the jump radius
        const found = sim.nearestN(cur.x, cur.y, radius, n + 1);
        cur = null;
        for (let i = 0; i < found; i++) {
          const c = sim.sel[i];
          let seen = false;
          for (let k = 0; k < n; k++) if (chainHit[k] === c) { seen = true; break; }
          if (!seen) { cur = c; break; }
        }
      }
      sim.emit({ type: 'cast', skill: def.key, kind: 'chain', x: px, y: py, tx: pts[pts.length - 2], ty: pts[pts.length - 1], r: radius, pts });
      return true;
    }
    case 'melee': {
      const found = sim.nearestN(px, py, def.range, count);
      if (found === 0) return false;
      const hits = def.hits ?? 1;
      for (let i = 0; i < found; i++) {
        const t = sim.sel[i];
        sim.emit({ type: 'cast', skill: def.key, kind: 'melee', x: px, y: py, tx: t.x, ty: t.y, r: radius, pts: null });
        if (radius > 0) sim.areaDamage(t.x, t.y, radius, dmg);
        else for (let h = 0; h < hits; h++) sim.hit(t, dmg);
      }
      return true;
    }
    case 'cone': {
      if (sim.nearestN(px, py, radius, 1) === 0) return false;
      const t = sim.sel[0];
      const ang = Math.atan2(t.y - py, t.x - px);
      const half = CONE_ANGLE / 2;
      const cnt = sim.grid.query(px, py, radius + 3.4, sim.qbuf2);
      const hits = def.hits ?? 1;
      for (let i = 0; i < cnt; i++) {
        const e = sim.enemies[sim.qbuf2[i]];
        if (!e.alive) continue;
        const dx = e.x - px, dy = e.y - py;
        const rr = radius + e.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr * rr) continue;
        if (d2 > 1) {
          let da = Math.atan2(dy, dx) - ang;
          if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
          if (Math.abs(da) > half) continue;
        }
        for (let h = 0; h < hits; h++) sim.hit(e, dmg);
      }
      sim.emit({ type: 'cast', skill: def.key, kind: 'cone', x: px, y: py, tx: px + Math.cos(ang) * radius, ty: py + Math.sin(ang) * radius, r: radius, pts: null });
      return true;
    }
    case 'orbit': {
      const found = sim.nearestN(px, py, def.range, count);
      if (found === 0) return false;
      const a = sim.t * ORBIT_SPIN;
      const ox = px + Math.cos(a) * ORBIT_RADIUS, oy = py + Math.sin(a) * ORBIT_RADIUS;
      for (let i = 0; i < found; i++) {
        const t = sim.sel[i];
        sim.emit({ type: 'cast', skill: def.key, kind: 'orbit', x: ox, y: oy, tx: t.x, ty: t.y, r: 0, pts: null });
        sim.hit(t, dmg);
      }
      return true;
    }
  }
}

export function updateProjectiles(sim: Sim, dt: number) {
  const list = sim.projectiles;
  const enemies = sim.enemies;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    sim.curSkill = p.skill;
    p.life -= dt;
    if (p.life <= 0) { explodeIfSplash(sim, p); sim.freeProjectile(i); continue; }
    if (p.target) {
      if (p.target.alive) {
        const dx = p.target.x - p.x, dy = p.target.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx = (dx / d) * p.speed;
        p.vy = (dy / d) * p.speed;
      } else {
        p.target = null;
      }
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const cnt = sim.grid.query(p.x, p.y, 3.4, sim.qbuf);
    let dead = false;
    for (let k = 0; k < cnt && !dead; k++) {
      const e = enemies[sim.qbuf[k]];
      if (!e.alive) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const rr = e.r + 0.35;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (p.pierce) {
        let seen = false;
        for (let h = 0; h < p.nHits; h++) if (p.hits[h] === e) { seen = true; break; }
        if (seen) continue;
        if (p.nHits < p.hits.length) p.hits[p.nHits++] = e;
        sim.hit(e, p.dmg);
        if (--p.pierceLeft <= 0) dead = true;
      } else {
        if (p.splash > 0) explodeIfSplash(sim, p);
        else sim.hit(e, p.dmg);
        dead = true;
      }
    }
    if (dead) sim.freeProjectile(i);
  }
}

function explodeIfSplash(sim: Sim, p: { splash: number; x: number; y: number; dmg: number; skill: string; pierce: boolean }) {
  if (p.splash <= 0 || p.pierce) return;
  sim.curSkill = p.skill;
  sim.emit({ type: 'cast', skill: p.skill, kind: 'bolt', x: p.x, y: p.y, tx: p.x, ty: p.y, r: p.splash, pts: null });
  sim.areaDamage(p.x, p.y, p.splash, p.dmg);
}

export function updateAreas(sim: Sim, dt: number) {
  const list = sim.areas;
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    sim.curSkill = a.skill;
    a.t -= dt;
    a.tick -= dt;
    if (a.tick <= 0) {
      a.tick += POISON_TICK;
      sim.areaDamage(a.x, a.y, a.r, a.dmg);
    }
    if (a.t <= 0) sim.freeArea(i);
  }
}
