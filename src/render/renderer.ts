import { Application, BitmapFont, BitmapText, Container, Graphics, Sprite, Text, TilingSprite, Texture } from 'pixi.js';
import { BOSSES, NOVA_RADIUS, ORBIT_RADIUS, ORBIT_SPIN, PX_PER_YD, SKILL_BY_KEY } from '../game/data.ts';
import type { Stance } from '../game/data.ts';
import type { Sim } from '../game/sim.ts';
import { AFFIXES, ELITE_SCALE, eliteTitle } from '../game/elites.ts';
import { FIELD_ITEMS, KEG_RADIUS } from '../game/fieldItems.ts';
import { BAG, ELIXIR, EV_BOX, EV_TREASURE, FIELD, GACHA, GEAR, GEM, MASTERY, MESO, POTION, SCROLL } from '../game/types.ts';
import type { Area, Enemy, Pickup, Projectile, SimEvent } from '../game/types.ts';
import { frameAt } from '../maple/art.ts';
import { ItemArt } from '../maple/item-art.ts';
import { AvatarPlayer } from '../maple/avatar.ts';
import type { Avatar } from '../maple/avatar.ts';
import type { Look } from '../maple/avatar-core.ts';
import { tierColor } from '../game/gear.ts';
import type { GearIcons } from './gear-icons.ts';
import type { Anim, MapleArt, MobArt } from '../maple/art.ts';
import { DamageNumbers } from './damage.ts';
import { DecorLayer } from './decor.ts';
import { RegionScenery } from './regions.ts';
import { RES, buildTextures } from './textures.ts';
import type { MobTex, Textures } from './textures.ts';

const PX = PX_PER_YD;
const MAX_DMG_NUMBERS = 120;
const MAX_VFX = 110;
const MAX_GHOSTS = 100;
const MAX_ANIMFX = 60;
const MAX_FIRES = 48;
/** Maple mobs stand with their feet this many radii below the sim position (the hit circle sits on the body) */
const FOOT = 0.7;
const MAX_DECOS = 90;
const DECO_CELL = 14; // yards
const SCALE = 1 / RES;
/** the hero's feet stand this many px below the sim position (the hit circle is centred on the body) */
const HERO_FOOT = 10;
/** seconds an enemy's HP bar stays up after its last hit */
const HP_BAR_SECONDS = 3;

interface EnemyView {
  sp: Sprite; stamp: number; barBg: Sprite | null; barFg: Sprite | null; tex: MobTex | null; flashing: boolean;
  /** real-art state: current mob art, animation, time in it, remaining hit1 time */
  art: MobArt | null; act: Anim | null; t: number; hitT: number; flashPrev: boolean;
  /** Elites: the name plate over the head ("Elite Orange Mushroom" and the affix) and the text it shows */
  title: Text | null; titleKey: string;
}
interface DmgNum { t: BitmapText; life: number; vy: number; active: boolean; max: number }
interface Vfx { sp: Sprite; active: boolean; t: number; dur: number; s0: number; s1: number; a0: number; a1: number; x: number; y: number; vy: number }
interface Ghost { sp: Sprite; active: boolean; t: number; s: number; anim: Anim | null; age: number }
interface AnimFx { sp: Sprite; active: boolean; anim: Anim | null; t: number }
/** the real level-up effect: plays once on the player, following them */
interface FollowFx { sp: Sprite; active: boolean; t: number; pending: boolean }

function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  tex: Textures;
  app: Application;
  zoom = 1;
  private w = 0;
  private h = 0;
  private ground: TilingSprite;
  private world = new Container();
  private groundFx = new Container();
  private entities = new Container();
  private fxLayer = new Container();
  private topLayer = new Container();
  private playerSp: Sprite;
  private hero: AvatarPlayer | null = null;
  private gearIcons: GearIcons | null = null;
  private orbitSp: Sprite[] = [];
  private decoSprites: Sprite[] = [];
  private enemyViews = new Map<Enemy, EnemyView>();
  private viewPool: EnemyView[] = [];
  private pickupViews = new Map<Pickup, { sp: Sprite; stamp: number; glow: Sprite | null }>();
  /** tier-coloured glow under dropped gear */
  private glowFx = new Container();
  private glowPool: Sprite[] = [];
  private pickupPool: Sprite[] = [];
  private projViews = new Map<Projectile, { sp: Sprite; stamp: number; t: number }>();
  private projPool: Sprite[] = [];
  private areaViews = new Map<Area, { sp: Sprite; stamp: number }>();
  private areaPool: Sprite[] = [];
  /** fire patches of Blazing Elites: a glowing disc and a bright rim each */
  private fires: { fill: Sprite; ring: Sprite }[] = [];
  private dmg: DmgNum[] = [];
  private dmgNext = 0;
  private vfx: Vfx[] = [];
  private vfxNext = 0;
  private ghosts: Ghost[] = [];
  private ghostNext = 0;
  private animFx: AnimFx[] = [];
  private animFxNext = 0;
  private art: MapleArt | null;
  /** MapleStory world/damage art; null members fall back to the placeholder look */
  private decor: DecorLayer | null = null;
  /** per-region ground and decor (replaces the single ground and `decor` when the manifest has regions) */
  private scenery: RegionScenery | null = null;
  private dmgNums: DamageNumbers | null = null;
  private levelFx: FollowFx | null = null;
  /** potion / meso / scroll art, the pet and the enchant effect (empty when there is no manifest) */
  private itemArt: ItemArt;
  private petSp: Sprite;
  private petTag: Container;
  private petAct: Anim | null = null;
  private petT = 0;
  private petJump = 0;
  private petCollected = 0;
  private danger: { fill: Sprite; ring: Sprite }[] = [];
  private stamp = 0;
  private time = 0;
  private hurt = 0;
  camX = 0;
  camY = 0;

  constructor(app: Application, art: MapleArt | null = null) {
    this.app = app;
    this.art = art;
    this.tex = buildTextures();
    this.itemArt = art?.items ?? new ItemArt();
    if (art) Object.assign(this.tex.icons, art.icons);
    const tx = this.tex;
    const mapArt = art?.map ?? null;
    this.ground = new TilingSprite({ texture: mapArt?.ground ?? tx.ground, width: 16, height: 16 });
    if (mapArt?.ground) app.renderer.background.color = mapArt.groundColor;
    app.stage.addChild(this.ground);
    app.stage.addChild(this.world);
    this.entities.sortableChildren = true;
    if (mapArt?.objects.length) this.decor = new DecorLayer(mapArt);
    if (art?.regions.length) {
      this.decor = null;
      this.ground.visible = false;
      this.scenery = new RegionScenery(art.regions, mapArt?.ground ?? tx.ground, mapArt?.ground ? mapArt.groundColor : 0x4f9a3c, (c) => { app.renderer.background.color = c; });
      app.stage.addChildAt(this.scenery.groundLayer, 0);
      this.world.addChild(this.scenery.decorLayer);
    }
    if (this.decor) this.world.addChild(this.decor.layer);
    this.world.addChild(this.glowFx, this.groundFx, this.entities, this.fxLayer, this.topLayer);

    for (let i = 0; i < MAX_DECOS; i++) {
      const s = new Sprite(tx.decos[0]);
      s.anchor.set(0.5, 0.85); s.scale.set(SCALE); s.visible = false;
      this.entities.addChild(s);
      this.decoSprites.push(s);
    }
    this.playerSp = new Sprite(tx.player);
    this.playerSp.anchor.set(0.5, 0.9);
    this.entities.addChild(this.playerSp);
    this.petSp = new Sprite(this.itemArt.placeholderPet());
    this.petSp.anchor.set(0.5, 0.95);
    this.petSp.visible = false;
    this.entities.addChild(this.petSp);
    this.petTag = new Container();
    this.petTag.visible = false;
    this.topLayer.addChild(this.petTag);
    const petName = this.itemArt.pet?.name ?? 'Brown Kitty';
    const label = new Text({ text: petName, style: { fontFamily: 'Arial', fontSize: 11, fontWeight: 'bold', fill: 0xffffff } });
    label.anchor.set(0.5, 0);
    const plate = new Graphics();
    plate.roundRect(-label.width / 2 - 4, 0, label.width + 8, label.height + 2, 4).fill({ color: 0x10182c, alpha: 0.7 });
    label.position.set(0, 1);
    this.petTag.addChild(plate, label);
    for (let i = 0; i < 2; i++) {
      const o = new Sprite(tx.glow);
      o.anchor.set(0.5); o.visible = false; o.tint = 0xe8f0ff; o.scale.set(0.5);
      this.fxLayer.addChild(o);
      this.orbitSp.push(o);
    }

    BitmapFont.install({
      name: 'dmgfont',
      style: { fontFamily: 'Arial', fontSize: 30, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x2a1500, width: 6 } },
      chars: [['0', '9'], ['A', 'Z'], '!', '-', '+', '.', ' '],
    });
    for (let i = 0; i < MAX_DMG_NUMBERS; i++) {
      const t = new BitmapText({ text: '0', style: { fontFamily: 'dmgfont', fontSize: 18 } });
      t.anchor.set(0.5); t.visible = false;
      this.topLayer.addChild(t);
      this.dmg.push({ t, life: 0, vy: 0, active: false, max: 1 });
    }
    for (let i = 0; i < MAX_VFX; i++) {
      const sp = new Sprite(tx.ring);
      sp.anchor.set(0.5); sp.visible = false;
      this.fxLayer.addChild(sp);
      this.vfx.push({ sp, active: false, t: 0, dur: 1, s0: 1, s1: 1, a0: 1, a1: 0, x: 0, y: 0, vy: 0 });
    }
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const sp = new Sprite(tx.mobs[0].frames[0]);
      sp.anchor.set(0.5, 0.75); sp.visible = false;
      this.entities.addChild(sp);
      this.ghosts.push({ sp, active: false, t: 0, s: 1, anim: null, age: 0 });
    }
    for (let i = 0; i < MAX_ANIMFX; i++) {
      const sp = new Sprite(tx.disc);
      sp.visible = false;
      this.fxLayer.addChild(sp);
      this.animFx.push({ sp, active: false, anim: null, t: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const fill = new Sprite(tx.disc), ring = new Sprite(tx.ring);
      fill.anchor.set(0.5); ring.anchor.set(0.5);
      fill.tint = 0xff2a2a; ring.tint = 0xff5a3a;
      fill.visible = ring.visible = false;
      this.fxLayer.addChild(fill, ring);
      this.danger.push({ fill, ring });
    }
    for (let i = 0; i < MAX_FIRES; i++) {
      const fill = new Sprite(tx.disc), ring = new Sprite(tx.ring);
      fill.anchor.set(0.5); ring.anchor.set(0.5);
      fill.tint = 0xff4a10; ring.tint = 0xffb030;
      fill.visible = ring.visible = false;
      this.groundFx.addChild(fill, ring);
      this.fires.push({ fill, ring });
    }
    if (art?.damage) {
      this.dmgNums = new DamageNumbers(art.damage);
      this.topLayer.addChild(this.dmgNums.layer);
    }
    if (art?.levelUp) {
      const sp = new Sprite(art.levelUp.tex[0]);
      sp.visible = false;
      this.fxLayer.addChild(sp);
      this.levelFx = { sp, active: false, t: 0, pending: false };
    }
    this.resize();
  }

  resize() {
    this.w = this.app.screen.width;
    this.h = this.app.screen.height;
    this.zoom = Math.min(this.w, this.h) < 560 ? 0.8 : 1;
    this.ground.width = this.w;
    this.ground.height = this.h;
  }

  /** Sets the hero's real-art look (null look or avatar = chibi placeholder). The look may still be loading; the placeholder shows until it is ready. */
  setHero(avatar: Avatar | null, look: Look | null, stance: Stance) {
    if (!avatar || !look) { this.hero = null; return; }
    this.hero = new AvatarPlayer(avatar);
    this.hero.set(look, stance);
  }

  /** The hero put on or took off gear: same character, changed look (the old one is drawn until the new parts are loaded). */
  setLook(look: Look) {
    this.hero?.change(look);
  }

  setGearIcons(g: GearIcons) {
    this.gearIcons = g;
  }

  // ---- pools ------------------------------------------------------------------------------------
  private getView(): EnemyView {
    const v = this.viewPool.pop();
    if (v) { v.sp.visible = true; return v; }
    const sp = new Sprite(this.tex.mobs[0].frames[0]);
    sp.anchor.set(0.5, 0.82);
    this.entities.addChild(sp);
    return { sp, stamp: 0, barBg: null, barFg: null, tex: null, flashing: false, art: null, act: null, t: 0, hitT: 0, flashPrev: false, title: null, titleKey: '' };
  }

  private releaseView(v: EnemyView) {
    v.sp.visible = false;
    v.art = null; v.act = null; v.tex = null; v.hitT = 0; v.flashPrev = false;
    if (v.barBg) { v.barBg.visible = false; v.barFg!.visible = false; }
    if (v.title) v.title.visible = false;
    this.viewPool.push(v);
  }

  private ensureBar(v: EnemyView) {
    if (v.barBg) return;
    const bg = new Sprite(this.tex.bar), fg = new Sprite(this.tex.bar);
    bg.tint = 0x1a0000; fg.tint = 0xe83a3a;
    bg.height = 8; fg.height = 6;
    bg.anchor.set(0.5, 0.5); fg.anchor.set(0, 0.5);
    this.topLayer.addChild(bg, fg);
    v.barBg = bg; v.barFg = fg;
  }

  private spawnVfx(tex: Texture, x: number, y: number, dur: number, s0: number, s1: number, a0: number, a1: number, tint: number, vy = 0): Vfx {
    const v = this.vfx[this.vfxNext];
    this.vfxNext = (this.vfxNext + 1) % MAX_VFX;
    v.sp.texture = tex; v.sp.tint = tint; v.sp.visible = true; v.sp.rotation = 0; v.sp.anchor.set(0.5);
    v.active = true; v.t = 0; v.dur = dur; v.s0 = s0; v.s1 = s1; v.a0 = a0; v.a1 = a1; v.x = x * PX; v.y = y * PX; v.vy = vy;
    v.sp.position.set(v.x, v.y);
    v.sp.scale.set(s0);
    v.sp.alpha = a0;
    return v;
  }

  /** Expanding ring/disc sized in yards of radius. */
  private ringFx(tex: Texture, x: number, y: number, r: number, dur: number, tint: number, a0 = 0.9) {
    const px = tex.width;
    this.spawnVfx(tex, x, y, dur, (r * 0.2 * PX * 2) / px, (r * PX * 2) / px, a0, 0, tint);
  }

  private lineFx(x0: number, y0: number, x1: number, y1: number, dur: number, tint: number, thick: number) {
    const dx = (x1 - x0) * PX, dy = (y1 - y0) * PX;
    const len = Math.hypot(dx, dy);
    const v = this.spawnVfx(this.tex.bar, x0, y0, dur, 1, 1, 1, 0, tint);
    v.sp.anchor.set(0, 0.5);
    v.sp.rotation = Math.atan2(dy, dx);
    v.sp.scale.set(len / 2, thick / 2);
    v.s0 = v.s1 = -1; // marks a line: keep scale
  }

  /** Plays a real-art frame sequence once, anchored at its origin, at pixel position (x, y). */
  private spawnAnim(a: Anim, x: number, y: number) {
    const f = this.animFx[this.animFxNext];
    this.animFxNext = (this.animFxNext + 1) % MAX_ANIMFX;
    f.anim = a; f.t = 0; f.active = true;
    f.sp.texture = a.tex[0];
    f.sp.anchor.set(a.ax[0], a.ay[0]);
    f.sp.position.set(x, y);
    f.sp.visible = true;
  }

  private number(x: number, y: number, text: string, tint: number, size: number, life = 0.75) {
    const d = this.dmg[this.dmgNext];
    this.dmgNext = (this.dmgNext + 1) % MAX_DMG_NUMBERS;
    const t = d.t;
    t.text = text;
    t.tint = tint;
    t.scale.set(size / 18);
    t.position.set(x * PX + (Math.random() - 0.5) * 14, y * PX - 14);
    t.alpha = 1;
    t.visible = true;
    d.active = true; d.life = d.max = life; d.vy = -42;
  }

  // ---- events -----------------------------------------------------------------------------------
  private handle(sim: Sim, e: SimEvent) {
    const tx = this.tex;
    switch (e.type) {
      case 'hit': {
        const ha = this.art?.skills.get(e.skill)?.hit;
        if (ha) this.spawnAnim(ha, e.x * PX, e.y * PX);
        if (this.dmgNums) this.dmgNums.spawn(e.x * PX + (Math.random() - 0.5) * 16, e.y * PX - 24, e.amount, e.crit ? 'cri' : 'red');
        else if (e.crit) this.number(e.x, e.y, e.amount + '!', 0xff5a4a, 27, 0.9);
        else this.number(e.x, e.y, String(e.amount), e.boss ? 0xffb060 : 0xff9a2e, 17);
        break;
      }
      case 'playerHit':
        if (this.dmgNums) this.dmgNums.spawn(e.x * PX, e.y * PX - 46, e.amount, 'violet');
        else this.number(e.x, e.y - 1.2, '-' + Math.round(e.amount), 0xc070ff, 24, 1.0);
        this.hurt = 0.25;
        break;
      case 'death': {
        const g = this.ghosts[this.ghostNext];
        this.ghostNext = (this.ghostNext + 1) % MAX_GHOSTS;
        const ma = this.art ? (e.boss >= 0 ? this.art.bosses[e.boss] : this.art.tiers[e.tier]) : null;
        g.sp.tint = 0xffffff;
        g.sp.zIndex = e.y * PX;
        g.sp.alpha = 0.9; g.sp.visible = true;
        g.active = true;
        if (ma?.die) {
          // real art: play die1 once where the mob stood, native size, facing as it was
          const r = e.boss >= 0 ? 1.6 * BOSSES[e.boss].scale : e.big ? 1.0 : 0.6;
          g.anim = ma.die; g.age = 0;
          g.t = Math.min(e.boss >= 0 ? 2.5 : 1.2, ma.die.total + 0.15);
          g.sp.texture = ma.die.tex[0];
          g.sp.anchor.set(ma.die.ax[0], ma.die.ay[0]);
          g.sp.position.set(e.x * PX, e.y * PX + r * PX * FOOT);
          g.sp.scale.set(-e.facing, 1);
          g.sp.alpha = 1;
        } else {
          const mt = e.boss >= 0 ? tx.bosses[e.boss] : tx.mobs[e.tier];
          g.anim = null;
          g.sp.texture = mt.flash[0];
          g.sp.anchor.set(0.5, 0.75);
          g.sp.position.set(e.x * PX, e.y * PX);
          g.s = SCALE;
          g.sp.scale.set(SCALE);
          g.t = e.boss >= 0 ? 0.7 : 0.28;
        }
        if (e.boss >= 0) this.ringFx(tx.ring, e.x, e.y, 10, 0.8, 0xffd23a);
        break;
      }
      case 'cast': {
        const def = SKILL_BY_KEY[e.skill];
        const ef = this.art?.skills.get(e.skill)?.effect;
        if (ef) {
          if (e.kind === 'nova') this.spawnAnim(ef, e.x * PX, e.y * PX);
          else if (e.kind === 'ground' || e.kind === 'strike') this.spawnAnim(ef, e.tx * PX, e.ty * PX);
        }
        const el = def?.element;
        const tint = el === 'fire' ? 0xff7a2a : el === 'ice' ? 0x6fd6ff : el === 'lightning' ? 0xffe84a : el === 'poison' ? 0x62d85e : 0xb58cff;
        if (e.kind === 'bolt') this.ringFx(tx.disc, e.x, e.y, e.r, 0.3, tint, 0.8);
        else if (e.kind === 'nova') this.ringFx(tx.ring, e.x, e.y, e.r, 0.45, tint, 0.95);
        else if (e.kind === 'melee') {
          this.lineFx(e.x, e.y - 0.6, e.tx, e.ty - 0.4, 0.14, 0xffffff, 6);
          this.ringFx(tx.glow, e.tx, e.ty, e.r > 0 ? e.r : 1.3, 0.25, tint, 0.9);
        } else if (e.kind === 'cone') {
          const ang = Math.atan2(e.ty - e.y, e.tx - e.x);
          for (let k = -1; k <= 1; k++) {
            const a = ang + k * 0.6;
            this.lineFx(e.x, e.y - 0.4, e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r - 0.4, 0.22, tint, 8);
          }
          this.ringFx(tx.disc, e.x + Math.cos(ang) * e.r * 0.6, e.y + Math.sin(ang) * e.r * 0.6, e.r * 0.45, 0.28, tint, 0.55);
        } else if (e.kind === 'orbit') {
          this.lineFx(e.x, e.y - 0.7, e.tx, e.ty - 0.4, 0.16, tint, 4);
          this.ringFx(tx.glow, e.tx, e.ty, 1.4, 0.25, 0xffffff, 0.85);
        }
        else if (e.kind === 'strike') {
          if (e.skill === 'thunder_bolt') {
            this.lineFx(e.tx, e.ty - 9, e.tx, e.ty, 0.18, tint, 5);
            this.ringFx(tx.glow, e.tx, e.ty, 1.6, 0.25, 0xffffff, 0.9);
          } else {
            this.lineFx(e.x, e.y - 0.6, e.tx, e.ty - 0.4, 0.22, tint, 7);
            this.ringFx(tx.disc, e.tx, e.ty, e.r, 0.35, tint, 0.65);
          }
        } else if (e.kind === 'ground') this.ringFx(tx.ring, e.tx, e.ty, e.r, 0.4, tint, 0.8);
        else if (e.kind === 'chain' && e.pts) {
          const p = e.pts;
          for (let i = 2; i < p.length; i += 2) {
            this.lineFx(p[i - 2], p[i - 1] - (i === 2 ? 0.6 : 0.3), p[i], p[i + 1] - 0.3, 0.25, tint, 4);
            this.ringFx(tx.glow, p[i], p[i + 1], 1.4, 0.25, 0xffffff, 0.8);
          }
        }
        break;
      }
      case 'novaHit':
        this.ringFx(tx.ring, e.x, e.y, e.r, 0.5, e.hit ? 0xff3030 : 0xffa070, 1);
        break;
      case 'levelUp':
        if (this.levelFx && this.art?.levelUp) {
          // the real effect carries its own "LEVEL UP!" lettering; it starts once the card dialog is closed, so it is seen
          this.levelFx.pending = true;
          this.ringFx(tx.ring, sim.px, sim.py, 5, 0.7, 0xffe060, 0.6);
          break;
        }
        this.ringFx(tx.ring, sim.px, sim.py, 5, 0.7, 0xffe060, 1);
        this.number(sim.px, sim.py - 2.4, 'LEVEL UP!', 0xffe060, 24, 1.2);
        break;
      case 'scroll': {
        const a = e.ok ? this.itemArt.enchantSuccess : this.itemArt.enchantFailure;
        if (a) this.spawnAnim(a, sim.px * PX, sim.py * PX - 24);
        else this.ringFx(tx.glow, sim.px, sim.py - 0.8, 2.4, 0.55, e.ok ? 0x6aff7a : 0xff5a5a, 0.9);
        break;
      }
      case 'jobAdvance':
        // the level-up effect again; the "Job Advancement!" banner is the sim's raid text
        if (this.levelFx) this.levelFx.pending = true;
        this.ringFx(tx.ring, sim.px, sim.py, 6, 0.9, 0xffd23a, 0.8);
        break;
      case 'evolve':
        // the job-advancement effect again; the "Mastery Book! ... evolved into ..." banner is the sim's raid text
        if (this.levelFx) this.levelFx.pending = true;
        this.ringFx(tx.ring, sim.px, sim.py, 6, 0.9, 0xb070ff, 0.8);
        break;
      case 'gacha':
        this.ringFx(tx.glow, sim.px, sim.py, 4, 0.6, 0xff9a3a, 0.9);
        break;
      case 'elite':
        this.ringFx(tx.ring, e.x, e.y, 7, 0.9, AFFIXES.find((a) => a.key === e.affix)?.tint ?? 0xffffff, 0.9);
        break;
      case 'box':
        this.ringFx(tx.glow, e.x, e.y, 2.2, 0.4, 0xffd890, 0.9);
        break;
      case 'fieldItem': {
        const d = FIELD_ITEMS[e.item];
        if (!d) break;
        this.number(sim.px, sim.py - 2.2, d.name.toUpperCase(), parseInt(d.color.slice(1), 16), 15, 1.6);
        if (e.item === 4) { this.ringFx(tx.ring, sim.px, sim.py, KEG_RADIUS, 0.7, 0xffa030, 1); this.ringFx(tx.disc, sim.px, sim.py, KEG_RADIUS, 0.5, 0xff7a20, 0.45); }
        else if (e.item === 3) this.ringFx(tx.ring, sim.px, sim.py, 12, 0.9, 0xb58cff, 0.9);
        else this.ringFx(tx.glow, sim.px, sim.py, 3.5, 0.6, parseInt(d.color.slice(1), 16), 0.9);
        break;
      }
      case 'drop':
        // the item's name floats up in its tier colour (grey, white, blue, purple, gold); a boss drop stays up longer
        if (e.tier === undefined) {
          if (e.boss) this.number(e.x, e.y - 1.4, e.name.toUpperCase(), 0xffe9a0, 15, 2.2);
          break;
        }
        this.number(e.x, e.y - 1.4, e.name.toUpperCase(), tierColor(e.tier), e.boss ? 15 : 13, e.boss ? 2.2 : 1.6);
        if (e.tier >= 4) this.ringFx(tx.ring, e.x, e.y, 2.2, 0.6, tierColor(e.tier), 0.9);
        break;
      case 'pickup':
        if (e.kind === MESO || e.kind === BAG) this.number(e.x, e.y - 0.6, '+' + e.value, 0xffd23a, 15, 0.7);
        else if (e.kind === POTION || e.kind === ELIXIR) this.ringFx(tx.glow, e.x, e.y, 2.5, 0.4, 0xff6a6a, 0.9);
        else if (e.kind === GACHA || e.kind === MASTERY) this.ringFx(tx.glow, e.x, e.y, 3, 0.5, 0xffc060, 0.9);
        break;
      default:
        break;
    }
  }

  // ---- frame -------------------------------------------------------------------------------------
  render(sim: Sim, dt: number) {
    this.time += dt;
    this.stamp++;
    const stamp = this.stamp;
    const tx = this.tex;
    const z = this.zoom;

    // events first (drained here)
    const evs = sim.events;
    for (let i = 0; i < evs.length; i++) this.handle(sim, evs[i]);
    evs.length = 0;

    // camera (smoothed slightly)
    this.camX = sim.px * PX;
    this.camY = sim.py * PX;
    const ox = this.w / 2 - this.camX * z, oy = this.h / 2 - this.camY * z;
    this.world.position.set(ox, oy);
    this.world.scale.set(z);
    this.ground.tilePosition.set(ox, oy);
    this.ground.tileScale.set(z);

    // decorations on a hashed grid
    if (this.scenery) this.scenery.update(sim.region, dt, sim.px * PX, sim.py * PX, z, this.time, this.w, this.h);
    if (this.decor) this.decor.update(sim.px * PX, sim.py * PX, z, this.time, this.w, this.h);
    const halfW = this.w / 2 / z / PX + 3, halfH = this.h / 2 / z / PX + 3;
    const cx0 = Math.floor((sim.px - halfW) / DECO_CELL), cx1 = Math.floor((sim.px + halfW) / DECO_CELL);
    const cy0 = Math.floor((sim.py - halfH) / DECO_CELL), cy1 = Math.floor((sim.py + halfH) / DECO_CELL);
    let di = 0;
    for (let cy = cy0; cy <= cy1 && di < MAX_DECOS && !this.decor && !this.scenery; cy++) {
      for (let cx = cx0; cx <= cx1 && di < MAX_DECOS; cx++) {
        const h = hash2(cx, cy);
        if (h > 0.42) continue;
        const s = this.decoSprites[di++];
        const kind = h < 0.26 ? 0 : h < 0.34 ? 2 : 1;
        s.texture = tx.decos[kind];
        const gx = (cx + 0.15 + hash2(cx + 91, cy) * 0.7) * DECO_CELL * PX, gy = (cy + 0.15 + hash2(cx, cy + 57) * 0.7) * DECO_CELL * PX;
        s.position.set(gx, gy);
        s.zIndex = gy;
        s.visible = true;
      }
    }
    for (; di < MAX_DECOS; di++) this.decoSprites[di].visible = false;

    // player: composited Maple character (native pixel size, art faces left) or the chibi placeholder
    const ps = this.playerSp;
    ps.zIndex = sim.py * PX;
    const hf = this.hero?.frame(dt, sim.moving, sim.lastFire) ?? null;
    if (hf) {
      if (ps.texture !== hf.tex) ps.texture = hf.tex;
      ps.anchor.set(hf.ax / hf.tex.frame.width, hf.ay / hf.tex.frame.height);
      ps.position.set(sim.px * PX, sim.py * PX + HERO_FOOT);
      ps.scale.set(sim.facing >= 0 ? -1 : 1, 1);
    } else {
      if (ps.texture !== tx.player) ps.texture = tx.player;
      ps.anchor.set(0.5, 0.9);
      ps.position.set(sim.px * PX, sim.py * PX);
      const bob = sim.moving ? Math.abs(Math.sin(this.time * 12)) * 3 : Math.sin(this.time * 3) * 1;
      ps.y -= bob;
      ps.scale.set(SCALE * (sim.facing >= 0 ? 1 : -1), SCALE);
    }
    if (this.hurt > 0) { this.hurt -= dt; ps.tint = 0xff8080; } else ps.tint = 0xffffff;
    ps.visible = !sim.over || sim.won;

    this.renderPet(sim, dt);

    // orbiting summons (Silver Hawk): always on once owned
    let oi = 0;
    for (let i = 0; i < sim.skills.length && oi < this.orbitSp.length; i++) {
      if (SKILL_BY_KEY[sim.skills[i].key]?.kind !== 'orbit') continue;
      const o = this.orbitSp[oi++];
      const a = sim.t * ORBIT_SPIN;
      o.visible = true;
      o.position.set((sim.px + Math.cos(a) * ORBIT_RADIUS) * PX, (sim.py + Math.sin(a) * ORBIT_RADIUS) * PX - 14);
      o.tint = 0xdfe8ff;
    }
    for (; oi < this.orbitSp.length; oi++) this.orbitSp[oi].visible = false;

    // enemies
    const enemies = sim.enemies;
    const frameN = Math.floor(this.time * 7);
    let dng = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      let v = this.enemyViews.get(e);
      if (!v) { v = this.getView(); this.enemyViews.set(e, v); }
      v.stamp = stamp;
      const boss = e.boss >= 0;
      const sp = v.sp;
      if (e.ev === EV_BOX) { this.drawBox(v, e); continue; }
      const es = e.elite ? ELITE_SCALE : 1;
      const ma = this.art ? (boss ? this.art.bosses[e.boss] : this.art.tiers[e.tier]) : null;
      let footY = e.y * PX;
      let barTop = e.r * PX * 1.9;
      if (ma) {
        // real art: native pixel size (the world container already applies the zoom), feet near the hit circle's lower edge
        footY += e.r * PX * FOOT;
        barTop = Math.max(e.r * PX * 1.2, this.animateMob(v, e, ma, dt) * es - e.r * PX * FOOT);
        sp.scale.set(-e.facing * es, es); // Maple sprites face left
      } else {
        if (v.art) { v.art = null; v.act = null; v.tex = null; sp.anchor.set(0.5, 0.82); }
        const mt = boss ? tx.bosses[e.boss] : tx.mobs[e.tier];
        const flash = e.flash > 0;
        const fr = e.moving ? (frameN + ((e.phase * 3) | 0)) & 1 : 0;
        if (v.tex !== mt || v.flashing !== flash || v.sp.texture !== (flash ? mt.flash[fr] : mt.frames[fr])) {
          v.tex = mt; v.flashing = flash;
          v.sp.texture = flash ? mt.flash[fr] : mt.frames[fr];
        }
        sp.scale.set(SCALE * e.facing * es, SCALE * es);
      }
      sp.position.set(e.x * PX, footY);
      sp.zIndex = e.y * PX;
      sp.tint = e.elite ? AFFIXES[e.elite - 1].tint : e.ev === EV_TREASURE ? 0xffd23a : e.berserk ? 0xff6a6a : e.slowT > 0 ? 0xa8dcff : 0xffffff;
      if (!boss && e.big && (e.elite || sim.t - e.lastHit < HP_BAR_SECONDS)) {
        // Maple-style bar over the head of big mobs for a few seconds after the last hit (small mobs die too fast to need one)
        this.ensureBar(v);
        const bw = Math.max(26, e.r * PX * 1.6);
        const by = e.y * PX - barTop - 4;
        v.barBg!.tint = 0x101820; v.barFg!.tint = e.elite ? AFFIXES[e.elite - 1].tint : 0x6fd13a;
        v.barBg!.height = 6; v.barFg!.height = 4;
        v.barBg!.visible = v.barFg!.visible = true;
        v.barBg!.width = bw + 2; v.barBg!.position.set(e.x * PX, by);
        v.barFg!.width = Math.max(0, (e.hp / e.maxHp) * bw); v.barFg!.position.set(e.x * PX - bw / 2, by);
      } else if (v.barBg && !boss) {
        v.barBg.visible = v.barFg!.visible = false;
      }
      if (e.elite) this.drawTitle(v, e, e.y * PX - barTop - 14);
      else if (v.title) v.title.visible = false;
      if (boss) {
        this.ensureBar(v);
        const bw = Math.max(70, e.r * PX * 2, ma ? sp.texture.frame.width * 0.45 : 0);
        const by = e.y * PX - barTop - 10;
        v.barBg!.tint = 0x1a0000; v.barFg!.tint = 0xe83a3a;
        v.barBg!.height = 8; v.barFg!.height = 6;
        v.barBg!.visible = v.barFg!.visible = true;
        v.barBg!.width = bw + 4; v.barBg!.position.set(e.x * PX, by);
        v.barFg!.width = Math.max(0, (e.hp / e.maxHp) * bw); v.barFg!.position.set(e.x * PX - bw / 2, by);
        if (e.castT > 0 && dng < this.danger.length) {
          const d = this.danger[dng++];
          const full = (NOVA_RADIUS * PX * 2) / d.ring.texture.width;
          const prog = 1 - e.castT / 2;
          d.ring.visible = d.fill.visible = true;
          d.ring.position.set(e.x * PX, e.y * PX); d.fill.position.set(e.x * PX, e.y * PX);
          d.ring.scale.set(full); d.ring.alpha = 0.55 + 0.4 * Math.sin(this.time * 16);
          d.fill.scale.set(full * prog * (d.ring.texture.width / d.fill.texture.width));
          d.fill.alpha = 0.3;
        }
      }
    }
    for (; dng < this.danger.length; dng++) { this.danger[dng].ring.visible = false; this.danger[dng].fill.visible = false; }
    for (const [k, v] of this.enemyViews) {
      if (v.stamp !== stamp) { this.enemyViews.delete(k); this.releaseView(v); }
    }

    // pickups
    const ps2 = sim.pickups;
    for (let i = 0; i < ps2.length; i++) {
      const p = ps2[i];
      let v = this.pickupViews.get(p);
      if (!v) {
        const sp = this.pickupPool.pop() ?? this.topSprite(this.groundFx);
        sp.visible = true;
        v = { sp, stamp, glow: null };
        this.pickupViews.set(p, v);
      }
      v.stamp = stamp;
      const sp = v.sp;
      let t: Texture;
      let scale = SCALE;
      const ia = this.itemArt;
      switch (p.kind) {
        case GEM: t = tx.gems[p.value < 6 ? 0 : p.value < 20 ? 1 : p.value < 80 ? 2 : 3]; break;
        case POTION: { const r = ia.potion(p.value); t = r ?? tx.potion; if (r) scale = 1; break; }
        case ELIXIR: { const r = ia.elixir(); t = r ?? tx.elixir; if (r) scale = 1; break; }
        case MESO: case BAG: {
          // the coin art spins like in the game
          const a = p.kind === MESO ? ia.meso(p.value) : ia.bag();
          if (a) { t = a.tex[frameAt(a, this.time + p.x)]; scale = 1; } else t = p.kind === MESO ? tx.meso : tx.bag;
          break;
        }
        case GEAR: t = (p.item && this.gearIcons?.texture(p.item)) || tx.bag; scale = 1; break;
        case SCROLL: t = p.scroll ? ia.scrollTexture(p.scroll) : ia.placeholderScroll(); scale = 1; break;
        case GACHA: { const r = ia.gacha(); t = r ?? tx.gacha; scale = r ? 1.25 : SCALE; break; }
        case MASTERY: t = tx.book; break;
        case FIELD: { const r = ia.field(p.value); t = r ?? tx.field[p.value] ?? tx.bag; scale = r ? 1 : SCALE; break; }
        default: t = tx.bag;
      }
      if (sp.texture !== t) sp.texture = t;
      sp.scale.set(scale);
      sp.position.set(p.x * PX, p.y * PX - 8 + Math.sin(this.time * 4 + p.x) * 2);
      if ((p.kind === GEAR && p.item) || p.kind === FIELD) {
        let g = v.glow;
        if (!g) {
          g = this.glowPool.pop() ?? this.glowSprite();
          v.glow = g;
        }
        g.visible = true;
        g.tint = p.item ? tierColor(p.item.tier) : parseInt(FIELD_ITEMS[p.value]?.color.slice(1) ?? 'ffffff', 16);
        g.position.set(sp.x, sp.y + 4);
        g.scale.set((p.item ? 0.9 + 0.08 * p.item.tier : 1.1) + 0.08 * Math.sin(this.time * 5 + p.x));
      }
    }
    for (const [k, v] of this.pickupViews) {
      if (v.stamp !== stamp) {
        this.pickupViews.delete(k);
        v.sp.visible = false;
        this.pickupPool.push(v.sp);
        if (v.glow) { v.glow.visible = false; this.glowPool.push(v.glow); v.glow = null; }
      }
    }

    // projectiles
    const pr = sim.projectiles;
    for (let i = 0; i < pr.length; i++) {
      const p = pr[i];
      let v = this.projViews.get(p);
      if (!v) {
        const sp = this.projPool.pop() ?? this.topSprite(this.topLayer);
        sp.anchor.set(0.85, 0.5);
        sp.visible = true;
        v = { sp, stamp, t: 0 };
        this.projViews.set(p, v);
      }
      v.stamp = stamp;
      const ball = this.art?.skills.get(p.skill)?.ball;
      if (ball) {
        // real art faces left: mirror for rightward flight, rotate by the remaining angle
        v.t += dt;
        const i = frameAt(ball, v.t);
        if (v.sp.texture !== ball.tex[i]) v.sp.texture = ball.tex[i];
        v.sp.anchor.set(ball.ax[i], ball.ay[i]);
        const a = Math.atan2(p.vy, p.vx);
        if (p.vx < 0) { v.sp.scale.set(1, 1); v.sp.rotation = a < 0 ? a + Math.PI : a - Math.PI; }
        else { v.sp.scale.set(-1, 1); v.sp.rotation = a; }
      } else {
        const t = tx.missiles[p.skill] ?? tx.missiles.magic_claw;
        if (v.sp.texture !== t) v.sp.texture = t;
        v.sp.anchor.set(0.85, 0.5);
        v.sp.scale.set(SCALE * 1.2);
        v.sp.rotation = Math.atan2(p.vy, p.vx);
      }
      v.sp.position.set(p.x * PX, p.y * PX - 16);
    }
    for (const [k, v] of this.projViews) {
      if (v.stamp !== stamp) { this.projViews.delete(k); v.sp.visible = false; this.projPool.push(v.sp); }
    }

    // areas (poison mist)
    const ar = sim.areas;
    for (let i = 0; i < ar.length; i++) {
      const a = ar[i];
      let v = this.areaViews.get(a);
      if (!v) {
        const sp = this.areaPool.pop() ?? this.topSprite(this.groundFx);
        sp.texture = tx.disc; sp.tint = 0x4fd05a; sp.visible = true;
        v = { sp, stamp };
        this.areaViews.set(a, v);
      }
      v.stamp = stamp;
      const s = (a.r * PX * 2) / tx.disc.width;
      v.sp.scale.set(s * (1 + 0.03 * Math.sin(this.time * 6 + a.x)));
      v.sp.position.set(a.x * PX, a.y * PX);
      v.sp.alpha = Math.min(0.42, a.t * 0.5);
    }
    for (const [k, v] of this.areaViews) {
      if (v.stamp !== stamp) { this.areaViews.delete(k); v.sp.visible = false; this.areaPool.push(v.sp); }
    }

    // fire patches of Blazing Elites: a flickering disc with a bright rim, fading out in the last half second
    const fires = sim.elites.fires;
    let fi = 0;
    for (; fi < fires.length && fi < MAX_FIRES; fi++) {
      const f = fires[fi], v = this.fires[fi];
      const k = (f.r * PX * 2) / tx.disc.width;
      const a = Math.min(1, f.t * 2);
      v.fill.visible = v.ring.visible = true;
      v.fill.position.set(f.x * PX, f.y * PX); v.ring.position.set(f.x * PX, f.y * PX);
      v.fill.scale.set(k * (1 + 0.06 * Math.sin(this.time * 14 + f.x))); v.ring.scale.set(k * (tx.disc.width / tx.ring.width));
      v.fill.alpha = (0.45 + 0.12 * Math.sin(this.time * 11 + f.y)) * a; v.ring.alpha = 0.9 * a;
    }
    for (; fi < MAX_FIRES; fi++) this.fires[fi].fill.visible = this.fires[fi].ring.visible = false;

    // transient fx
    for (let i = 0; i < MAX_VFX; i++) {
      const f = this.vfx[i];
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { f.active = false; f.sp.visible = false; f.sp.anchor.set(0.5); continue; }
      if (f.s0 >= 0) f.sp.scale.set(f.s0 + (f.s1 - f.s0) * Math.sqrt(k));
      f.sp.alpha = f.a0 + (f.a1 - f.a0) * k;
    }
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const g = this.ghosts[i];
      if (!g.active) continue;
      g.t -= dt;
      if (g.t <= 0) { g.active = false; g.sp.visible = false; continue; }
      if (g.anim) {
        g.age += dt;
        const k = frameAt(g.anim, g.age, false);
        g.sp.texture = g.anim.tex[k];
        g.sp.anchor.set(g.anim.ax[k], g.anim.ay[k]);
        g.sp.alpha = Math.min(1, g.t * 6);
        continue;
      }
      g.sp.alpha = Math.min(1, g.t * 4);
      g.sp.scale.set(g.s * (0.6 + 0.4 * Math.min(1, g.t * 4)), g.s * (1 + 0.1 * (1 - Math.min(1, g.t * 4))));
    }
    for (let i = 0; i < MAX_ANIMFX; i++) {
      const f = this.animFx[i];
      if (!f.active) continue;
      f.t += dt;
      const a = f.anim!;
      if (f.t >= a.total) { f.active = false; f.sp.visible = false; continue; }
      const k = frameAt(a, f.t, false);
      f.sp.texture = a.tex[k];
      f.sp.anchor.set(a.ax[k], a.ay[k]);
    }
    this.dmgNums?.update(dt);
    const lf = this.levelFx;
    if (lf?.pending && (!sim.offer || sim.over)) { lf.pending = false; lf.active = true; lf.t = 0; lf.sp.visible = true; }
    if (lf?.active && this.art?.levelUp) {
      const a = this.art.levelUp;
      lf.t += dt;
      if (lf.t >= a.total) { lf.active = false; lf.sp.visible = false; }
      else {
        const k = frameAt(a, lf.t, false);
        lf.sp.texture = a.tex[k];
        lf.sp.anchor.set(a.ax[k], a.ay[k]);
        lf.sp.position.set(sim.px * PX, sim.py * PX + 6);
      }
    }
    for (let i = 0; i < MAX_DMG_NUMBERS; i++) {
      const d = this.dmg[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) { d.active = false; d.t.visible = false; continue; }
      d.t.y += d.vy * dt;
      d.vy *= 0.94;
      d.t.alpha = Math.min(1, (d.life / d.max) * 2.2);
    }
  }

  /** The pet behind the hero: move while travelling, stand otherwise, a hop after each pickup; the drawn cat without art. */
  private renderPet(sim: Sim, dt: number) {
    const pet = sim.pet;
    const sp = this.petSp;
    if (!pet || (sim.over && !sim.won)) { sp.visible = false; this.petTag.visible = false; return; }
    if (pet.collected !== this.petCollected) { this.petCollected = pet.collected; this.petJump = 0.35; }
    const pa = this.itemArt.pet;
    let a: Anim | null = null;
    if (pa) {
      if (this.petJump > 0 && pa.jump) a = pa.jump;
      else a = (pet.moving ? pa.move ?? pa.stand : pa.stand ?? pa.move) ?? null;
    }
    this.petJump = Math.max(0, this.petJump - dt);
    const fx = pet.x * PX, fy = pet.y * PX + HERO_FOOT;
    if (a) {
      if (a !== this.petAct) { this.petAct = a; this.petT = 0; } else this.petT += dt;
      const i = frameAt(a, this.petT);
      if (sp.texture !== a.tex[i]) sp.texture = a.tex[i];
      sp.anchor.set(a.ax[i], a.ay[i]);
      sp.scale.set(pet.facing >= 0 ? -1 : 1, 1); // extracted sprites face left
      sp.position.set(fx, fy);
    } else {
      const ph = this.itemArt.placeholderPet();
      if (sp.texture !== ph) sp.texture = ph;
      sp.anchor.set(0.5, 0.95);
      sp.scale.set(pet.facing >= 0 ? -1 : 1, 1);
      sp.position.set(fx, fy - (pet.moving ? Math.abs(Math.sin(this.time * 14)) * 3 : 0));
    }
    sp.zIndex = Math.min(pet.y * PX, sim.py * PX) - 1;
    sp.visible = true;
    this.petTag.position.set(fx, fy + 2);
    this.petTag.visible = true;
  }

  /** A breakable Maple box: the drawn crate, no bars */
  private drawBox(v: EnemyView, e: Enemy) {
    const sp = v.sp, t = this.tex.box;
    if (v.art) { v.art = null; v.act = null; v.tex = null; }
    if (sp.texture !== t) sp.texture = t;
    sp.anchor.set(0.5, 0.75);
    sp.scale.set(SCALE);
    sp.position.set(e.x * PX, e.y * PX);
    sp.zIndex = e.y * PX;
    sp.tint = e.flash > 0 ? 0xffb0b0 : 0xffffff;
    if (v.barBg) v.barBg.visible = v.barFg!.visible = false;
    if (v.title) v.title.visible = false;
  }

  /** An Elite's name plate: "Elite Orange Mushroom" over its affix, in the affix's colour (the text changes only when the Elite does) */
  private drawTitle(v: EnemyView, e: Enemy, y: number) {
    let t = v.title;
    if (!t) {
      t = v.title = new Text({ text: '', style: { fontFamily: 'Arial', fontSize: 12, fontWeight: 'bold', fill: 0xffffff, align: 'center', stroke: { color: 0x10182c, width: 3 } } });
      t.anchor.set(0.5, 1);
      this.topLayer.addChild(t);
    }
    const a = AFFIXES[e.elite - 1];
    const key = e.tier + ':' + e.elite;
    if (v.titleKey !== key) {
      v.titleKey = key;
      t.text = `${eliteTitle(e)}\n${a.name}`;
      t.tint = a.tint;
    }
    t.visible = true;
    t.position.set(e.x * PX, y);
  }

  /** Picks and sets the current frame of a real-art mob; returns the frame's origin height in px (sprite top above the foot). */
  private animateMob(v: EnemyView, e: Enemy, ma: MobArt, dt: number): number {
    if (v.art !== ma) { v.art = ma; v.act = null; v.hitT = 0; v.flashPrev = false; v.tex = null; }
    const flash = e.flash > 0;
    if (flash && !v.flashPrev && ma.hit) v.hitT = Math.min(0.35, Math.max(0.2, ma.hit.total));
    v.flashPrev = flash;
    let a: Anim;
    if (v.hitT > 0 && ma.hit) { v.hitT -= dt; a = ma.hit; }
    else if (e.castT > 0 && ma.attack) a = ma.attack;
    else a = (e.moving ? ma.move ?? ma.stand : ma.stand ?? ma.move)!;
    if (a !== v.act) { v.act = a; v.t = a === ma.hit ? 0 : e.phase * 0.2; } else v.t += dt;
    const i = frameAt(a, v.t, a !== ma.hit);
    const t = a.tex[i];
    if (v.sp.texture !== t) v.sp.texture = t;
    v.sp.anchor.set(a.ax[i], a.ay[i]);
    return a.ay[i] * t.frame.height;
  }

  private glowSprite(): Sprite {
    const sp = new Sprite(this.tex.glow);
    sp.anchor.set(0.5);
    sp.alpha = 1;
    this.glowFx.addChild(sp);
    return sp;
  }

  private topSprite(layer: Container): Sprite {
    const sp = new Sprite(this.tex.gems[0]);
    sp.anchor.set(0.5);
    layer.addChild(sp);
    return sp;
  }

  /** Name of the boss def for HUD convenience. */
  bossName(i: number) { return BOSSES[i].name; }
}
