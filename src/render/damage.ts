/**
 * MapleStory damage numbers from Effect.wz BasicEff.img: the first digit comes from the larger "1" set, the rest from the
 * "0" set, digits overlap slightly, and the number floats up and fades. Pooled: Containers and Sprites are created once.
 */
import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { DamageArt, DigitSet } from '../maple/art.ts';

const POOL = 90;
const MAX_DIGITS = 9;
/** pixels each digit slides under the previous one */
const OVERLAP = 3;

interface Num {
  box: Container;
  digits: Sprite[];
  effect: Sprite;
  active: boolean;
  life: number;
  max: number;
  vy: number;
}

export type DamageKind = 'red' | 'cri' | 'violet' | 'blue';

export class DamageNumbers {
  readonly layer = new Container();
  private pool: Num[] = [];
  private next = 0;
  private art: DamageArt;

  constructor(art: DamageArt) {
    this.art = art;
    for (let i = 0; i < POOL; i++) {
      const box = new Container();
      box.visible = false;
      const effect = new Sprite();
      effect.visible = false;
      box.addChild(effect);
      const digits: Sprite[] = [];
      for (let d = 0; d < MAX_DIGITS; d++) {
        const s = new Sprite();
        s.anchor.set(0, 1);
        s.visible = false;
        box.addChild(s);
        digits.push(s);
      }
      this.layer.addChild(box);
      this.pool.push({ box, digits, effect, active: false, life: 0, max: 1, vy: 0 });
    }
  }

  has(kind: DamageKind): boolean {
    return !!this.art[kind];
  }

  /** x/y in world pixels: the point the number rises from (bottom centre of the digits). */
  spawn(x: number, y: number, amount: number, kind: DamageKind) {
    const set: DigitSet | null = this.art[kind] ?? this.art.red;
    if (!set) return;
    const n = this.pool[this.next];
    this.next = (this.next + 1) % POOL;
    const v = Math.max(0, Math.round(amount));
    const str = v > 999999999 ? '999999999' : String(v);
    let total = 0;
    for (let i = 0; i < MAX_DIGITS; i++) {
      const s = n.digits[i];
      if (i >= str.length) { s.visible = false; continue; }
      const tex: Texture = (i === 0 ? set.first : set.rest)[str.charCodeAt(i) - 48];
      s.texture = tex;
      s.position.set(total, 0);
      s.visible = true;
      total += tex.width - OVERLAP;
    }
    total += OVERLAP;
    for (let i = 0; i < str.length; i++) n.digits[i].x -= total / 2;
    const crit = kind === 'cri';
    if (set.effect && crit) {
      const e = n.effect;
      e.texture = set.effect;
      e.anchor.set(0.5, 0.5);
      e.position.set(-total / 2 + set.effect.width * 0.25, -n.digits[0].texture.height * 0.95);
      e.visible = true;
    } else n.effect.visible = false;
    n.box.position.set(x, y);
    n.box.alpha = 1;
    n.box.scale.set(1.3);
    n.box.visible = true;
    n.active = true;
    n.life = n.max = crit ? 1.0 : 0.8;
    n.vy = crit ? -95 : -75;
  }

  update(dt: number) {
    const decay = Math.exp(-3.2 * dt);
    for (let i = 0; i < POOL; i++) {
      const n = this.pool[i];
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) { n.active = false; n.box.visible = false; continue; }
      n.box.y += n.vy * dt;
      n.vy *= decay;
      const age = n.max - n.life;
      // quick pop from 1.3x to 1x, then hold; fade over the last 45% of the life
      const sc = age < 0.12 ? 1.3 - 0.3 * (age / 0.12) : 1;
      if (n.box.scale.x !== sc) n.box.scale.set(sc);
      const k = n.life / n.max;
      n.box.alpha = k > 0.45 ? 1 : k / 0.45;
    }
  }
}
