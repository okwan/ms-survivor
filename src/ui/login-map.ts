/**
 * The real v83 login map: the scene of UI.wz MapLogin.img (see src/maple/login-scene.ts) drawn on an 800x600 canvas, with the camera
 * panning between the steps like the client (title -> world select -> character select -> creation) and Login.img's buttons, signboard
 * fields and name tag as a DOM overlay in the same coordinates. Used by Screens when the manifest has a `login` section; otherwise the
 * classic LoginScreen (login.ts) or the plain title window stays. Every screen position is in LAYOUT so it can be tuned from screenshots.
 */
import { CLASSES, CLASS_BY_KEY, DEFAULT_CLASS, SKILL_BY_KEY } from '../game/data.ts';
import type { ClassKey } from '../game/data.ts';
import { defaultLook, randomLook, sanitizeLook } from '../maple/avatar-core.ts';
import type { Look } from '../maple/avatar-core.ts';
import { ROWS, sanitizeName } from './create.ts';
import { frameIndexAt } from '../maple/avatar.ts';
import type { Avatar } from '../maple/avatar.ts';
import { VIEW_H, VIEW_W, frameAt, placements } from '../maple/login-scene.ts';
import type { LoginSection, LoginSprite, LoginStep } from '../maple/login-scene.ts';
import { fmtTime } from './hud.ts';
import type { LoginHandlers, LoginLike } from './login.ts';
import type { SaveData } from './save.ts';
import { isTouch } from './touch.ts';
import './login-map.css';

type Pt = readonly [number, number];

/** All positions in 800x600 screen pixels; [x, y] are top-left corners unless noted. Tune here, not in the code below. */
export const LAYOUT = {
  /** top-left of the signboards on screen at their step's camera (used when the scene has no such object) */
  titleBoard: [353, 203] as Pt,
  selectBoard: [587, 123] as Pt,
  /** milliseconds of the camera pan between steps */
  panMs: 900,
  /** relative to the title signboard */
  title: {
    id: { x: 119, y: 21, w: 140, h: 20 },
    pw: { x: 119, y: 51, w: 140, h: 20 },
    login: [269, 24] as Pt,
    idSave: [91, 93] as Pt,
    idLost: [175, 93] as Pt,
    pwLost: [265, 93] as Pt,
    newChar: [71, 138] as Pt,
    home: [169, 138] as Pt,
    quit: [268, 138] as Pt,
    /** controls hint: top of the line, centred */
    hintY: 449,
  },
  world: {
    step: [8, 8] as Pt,
    back: [8, 540] as Pt,
    /** unrolled scroll: top-left, ms per frame */
    scroll: [187, 95] as Pt,
    scrollMs: 90,
    /** world tabs: offset from the scroll, spacing; world ids 0..count-1 */
    tabs: { dx: 44, dy: 150, step: 29, count: 15 },
    /** channel panel: where its origin point goes */
    panel: [448, 356] as Pt,
    /** relative to the panel's top-left */
    name: [14, 10] as Pt,
    channels: { x: 14, y: 58, dx: 85, dy: 34, cols: 5, count: 20 },
    /** relative to a channel button */
    gauge: [46, 24] as Pt,
    go: [330, 206] as Pt,
  },
  select: {
    /** the chosen world's badge, then the step label */
    selectWorld: [8, 8] as Pt,
    step: [136, 8] as Pt,
    back: [8, 540] as Pt,
    /** the character's feet */
    feet: [330, 368] as Pt,
    /** top-left of the difficulty picker (below the character info table, above the copyright line at y 515) and its width */
    diff: [515, 417] as Pt,
    diffW: 190,
    /** name tag offset from the feet (centred) */
    tag: [0, 4] as Pt,
    /** relative to the CharSelect signboard */
    btSelect: [13, 18] as Pt,
    btNew: [13, 60] as Pt,
    btDelete: [13, 106] as Pt,
    /** charInfo's origin point, and the texts relative to its top-left */
    info: [560, 357] as Pt,
    /** value columns of the baked labels (JOB / LV. / STR / DEX left, FAME / INT / LUK right) and the line under WORLD RANKING */
    job: [37, 3] as Pt,
    level: [37, 21] as Pt,
    str: [37, 39] as Pt,
    dex: [37, 57] as Pt,
    fame: [127, 21] as Pt,
    int: [127, 39] as Pt,
    luk: [127, 57] as Pt,
    best: [6, 101] as Pt,
  },
  /** the v83 creator on the create step's map (screen coords at the create camera) */
  create: {
    /** unrolled scroll: top-left, ms per frame */
    scroll: [104, 112] as Pt,
    scrollMs: 70,
    /** first row relative to the scroll, row pitch */
    rows: [21, 18] as Pt,
    rowDy: 21,
    /** relative to a row */
    left: [68, 1] as Pt,
    right: [183, 1] as Pt,
    /** value field between the arrows, relative to a row: x, width, top, height */
    value: { x: 84, w: 98, y: 1, h: 16 },
    name: { x: 546, y: 181, w: 150, h: 20 },
    check: [650, 204] as Pt,
    /** status text under the name field */
    status: [548, 228] as Pt,
    /** top-left of the first stat value, row tops */
    stats: { x: 588, ys: [249, 267, 286, 306] },
    dice: [632, 248] as Pt,
    diceMs: 400,
    ok: [538, 372] as Pt,
    cancel: [622, 372] as Pt,
    /** the character's feet and scale */
    feet: [430, 343] as Pt,
    scale: 1,
    /** the class bubble (top-left) and its text padding / width */
    bubble: [338, 160] as Pt,
    /** text padding: the bubble art has a small character baked into its left side, so the text starts right of it */
    bubblePad: [9, 8, 8, 66] as [number, number, number, number],
    bubbleW: 113,
  },
  /** the extras dock (Continue, Monster Book, Henesys Shop, Hyper Skills, Options) lives outside the scaled stage, top-right of the window */
  dock: {
    /** margin from the window corner (plus the safe-area insets) */
    inset: 12,
    /** the side gutter beside the scaled stage under which the dock turns into 44px icon buttons */
    gutter: 150,
  },
};

/** Glyphs of the compact dock (24x24, currentColor); a button without one shows the first letter of its label. */
const DOCK_ICON: Record<string, string> = {
  'Monster Book': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 17h11M9 8h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  'Henesys Shop': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 10V7a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  'Hyper Skills': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z" fill="currentColor"/></svg>',
  Options: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  Continue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5-12-7.5z" fill="currentColor"/></svg>',
};

const BASE = 'maple/';
const KEY = 'maple-survivor-login';
const LOGO = 'login/Title/logo/0';

/** the scene is rich enough for the map screen (the real title button and a background) */
export function mapLoginOk(s: LoginSection | null | undefined): s is LoginSection {
  return !!s && !!s.ui?.['Title/BtLogin/normal/0'] && s.backs.length > 0;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

interface BtnOpts {
  label?: string;
  shot?: string;
  disabled?: boolean;
}

interface Anim {
  el: HTMLElement;
  frames: LoginSprite[];
  apply(s: LoginSprite): void;
  cur: LoginSprite | null;
}

export class MapLogin implements LoginLike {
  readonly root: HTMLDivElement;
  readonly overlay = true;
  state: LoginStep = 'title';
  /** frames the select stage drew (tests) */
  drawn = 0;
  private scene: LoginSection;
  private steps: Record<LoginStep, { x: number; y: number }>;
  private ctx: CanvasRenderingContext2D;
  /** small copy of the scene behind the stage: blurred, it fills the letterbox bars */
  private bctx: CanvasRenderingContext2D | null;
  private frame = 0;
  private panels: Record<'title' | 'world' | 'select' | 'create', HTMLDivElement>;
  private dock: HTMLDivElement;
  private opts: HTMLDivElement;
  private muteBtn: HTMLButtonElement;
  private vol: HTMLInputElement;
  private sfxVol: HTMLInputElement;
  private petEl: HTMLInputElement;
  private idEl!: HTMLInputElement;
  private pwEl!: HTMLInputElement;
  private tabsEl = el('div', 'hidden');
  /** the difficulty picker's place on the select step */
  private diffSlot = el('div', 'ml-diff hidden');
  private contBtn: HTMLButtonElement;
  private chansEl = el('div');
  private tabs: HTMLButtonElement[] = [];
  private placeSel: ((i: number) => void) | null = null;
  private titleBoard: Pt;
  private selectBoard: Pt;
  private imgs = new Map<string, HTMLImageElement>();
  private anims: Anim[] = [];
  private cam = { x: 0, y: 0 };
  private pan: { from: { x: number; y: number }; to: { x: number; y: number }; t0: number; step: LoginStep; then?: () => void } | null = null;
  private shown = false;
  private raf = 0;
  private t0 = 0;
  private scrollT0 = 0;
  private tabsOn = false;
  private muted = false;
  private save: SaveData | null = null;
  private world: number | null = null;
  private channel = 0;
  // the map creator
  private cls: ClassKey = DEFAULT_CLASS;
  private look: Look = defaultLook(CLASS_BY_KEY[DEFAULT_CLASS].weapon);
  private cScrollT0 = 0;
  private cRows = false;
  private cDiceUntil = 0;
  private cRowEls = new Map<string, { text: HTMLElement; swatch: HTMLElement | null }>();
  private cStatEls: HTMLElement[] = [];
  private cBubble: HTMLElement | null = null;
  private cNameEl: HTMLInputElement | null = null;
  private cStatusEl: HTMLElement | null = null;
  private cStatusT = 0;
  private cClock0 = 0;
  /** the rolled STR / DEX / INT / LUK (cosmetic) */
  stats: number[] = [4, 4, 4, 13];

  constructor(parent: HTMLElement, private h: LoginHandlers, private avatar: Avatar | null, scene: LoginSection) {
    // the private-server logo of the extracted map is swapped for the real MapleStory logo, keeping its centre
    const ms = scene.ui['Title/MSTitle'];
    this.scene = ms
      ? { ...scene, objs: scene.objs.map((o) => {
          const f = o.frames[0];
          if (o.path !== LOGO || !f) return o;
          const cx = o.x - f.ox + f.w / 2, cy = o.y - f.oy + f.h / 2;
          return { ...o, frames: [ms], flip: false, x: Math.round(cx - ms.w / 2 + ms.ox), y: Math.round(cy - ms.h / 2 + ms.oy) };
        }) }
      : scene;
    this.steps = { title: { x: 0, y: 0 }, world: { x: 0, y: -600 }, select: { x: 0, y: -1200 }, create: { x: 0, y: -1800 }, ...scene.steps };
    this.titleBoard = this.boardAt('login/Title/signboard', 'title', LAYOUT.titleBoard);
    this.selectBoard = this.boardAt('login/CharSelect/signboard', 'select', LAYOUT.selectBoard);
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (s && Number.isInteger(s.world) && s.world >= 0) this.world = s.world;
      if (s && Number.isInteger(s.channel) && s.channel >= 0) this.channel = s.channel;
    } catch { /* private mode */ }

    const root = (this.root = el('div', 'screen mlogin hidden'));
    const backdrop = el('canvas', 'ml-backdrop');
    backdrop.width = 160;
    backdrop.height = 120;
    this.bctx = backdrop.getContext('2d');
    const stage = el('div', 'ml-stage');
    const canvas = el('canvas', 'ml-canvas');
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d')!;
    const ui = el('div', 'ml-ui');
    this.panels = { title: el('div', 'ml-panel hidden'), world: el('div', 'ml-panel hidden'), select: el('div', 'ml-panel hidden'), create: el('div', 'ml-panel hidden') };
    this.dock = el('div', 'ml-dock hidden');
    this.dock.style.cssText = `top:calc(${LAYOUT.dock.inset}px + env(safe-area-inset-top, 0px));right:calc(${LAYOUT.dock.inset}px + env(safe-area-inset-right, 0px))`;
    this.diffSlot.style.cssText = `left:${LAYOUT.select.diff[0]}px;top:${LAYOUT.select.diff[1]}px;width:${LAYOUT.select.diffW}px`;
    ui.append(this.panels.title, this.panels.world, this.panels.select, this.panels.create, this.diffSlot);
    stage.append(canvas, ui);
    // the dock is a child of the screen, not of the scaled stage: it keeps its size and never covers the scene art
    root.append(backdrop, stage, this.dock);

    // extras dock: Options (music / SFX / mute / pet), then whatever addButton adds above it
    this.opts = el('div', 'ml-opts hidden');
    this.vol = this.slider('Music', (v) => this.h.volume(v));
    this.sfxVol = this.slider('SFX', (v) => this.h.sfxVolume(v));
    this.muteBtn = this.dockBtn('Mute', () => this.h.mute(!this.muted));
    this.opts.appendChild(this.muteBtn);
    const petOpt = el('label', 'pet-opt', '<input type="checkbox"> Pet');
    petOpt.title = 'A pet follows you and picks up mesos and potions';
    this.petEl = petOpt.querySelector('input')!;
    this.petEl.addEventListener('change', () => this.h.pet(this.petEl.checked));
    this.opts.appendChild(petOpt);
    const optBtn = this.dockBtn('Options', () => this.opts.classList.toggle('hidden'));
    optBtn.classList.add('ml-optbtn');
    optBtn.dataset.shot = 'options';
    this.contBtn = this.dockBtn('Continue', () => this.h.continueRun());
    this.contBtn.classList.add('hidden', 'ml-continue', 'primary');
    this.dock.append(this.contBtn, optBtn, this.opts);

    this.buildTitle();
    parent.appendChild(root);

    // --ls scales the stage; when the side gutter beside the scaled stage is too narrow for the labelled dock it turns into icon buttons
    const fit = () => {
      const ls = Math.max(0.3, Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H));
      root.style.setProperty('--ls', String(ls));
      root.classList.toggle('ml-compact', (window.innerWidth - VIEW_W * ls) / 2 < LAYOUT.dock.gutter);
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', (e) => {
      if (!this.shown || this.pan || e.repeat || (e.key !== 'Enter' && e.key !== 'Escape')) return;
      const t = e.target as Element | null;
      if (t?.closest?.('input, textarea')) return;
      if (e.key === 'Escape') {
        if (this.state === 'world') this.worldBack();
        else if (this.state === 'select') this.goTo('world');
        else if (this.state === 'create') this.cCancel();
        return;
      }
      if (t?.closest?.('button, .ml-opts')) return;
      if (this.state === 'title') this.goTo('world');
      else if (this.state === 'world' && this.chansEl.childElementCount) this.goTo('select');
      else if (this.state === 'select' && this.save?.character) this.h.select();
    });
  }

  // ---------------------------------------------------------------- public surface (LoginLike)

  get visible() {
    return this.shown;
  }

  show(save: SaveData) {
    this.save = save;
    this.vol.value = String(save.settings.volume);
    this.sfxVol.value = String(save.settings.sfxVolume);
    this.setMuted(save.settings.muted);
    this.petEl.checked = save.settings.pet;
    this.refresh(save);
    if (this.shown) {
      // coming back from the creator: pan to where the player belongs instead of snapping
      const to: LoginStep = save.character ? 'select' : 'title';
      if (this.state !== to || this.pan) this.goTo(to);
      return;
    }
    this.shown = true;
    this.root.classList.remove('hidden');
    // fade in (cross-fades with the boot overlay)
    this.root.classList.remove('ml-in');
    void this.root.offsetWidth;
    this.root.classList.add('ml-in');
    this.t0 = performance.now();
    this.goTo('title', undefined, true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Redraws the saved character's name and the stats. */
  refresh(save: SaveData) {
    this.save = save;
    if (this.idEl) {
      const ch = save.character;
      this.idEl.value = ch ? ch.name : '';
      this.pwEl.value = ch ? '•'.repeat(6) : '';
    }
    if (this.shown && this.state === 'select' && !this.pan) this.buildSelect();
  }

  hide() {
    this.shown = false;
    this.pan = null;
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
  }

  showTitle() {
    this.goTo('title', undefined, !this.shown);
  }

  /** Jumps to the character select step. */
  showSelect() {
    this.goTo('select', undefined, true);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.muteBtn.textContent = m ? 'Unmute' : 'Mute';
  }

  mountDifficulty(e: HTMLElement) {
    this.diffSlot.appendChild(e);
  }

  /** Shows (label) or hides (null) the Continue button for a run in progress (top of the dock). */
  setContinue(label: string | null) {
    this.contBtn.classList.toggle('hidden', !label);
    if (label) { this.contBtn.querySelector('.ml-lbl')!.textContent = label; this.contBtn.setAttribute('aria-label', label); this.contBtn.title = label; }
  }

  /** Adds a button to the extras dock (e.g. the Monster Book). */
  addButton(label: string, fn: () => void): HTMLButtonElement {
    const b = this.dockBtn(label, fn);
    this.dock.insertBefore(b, this.opts.previousSibling);
    return b;
  }

  // ---------------------------------------------------------------- camera and steps

  /** Pans the camera to a step (cosine ease over LAYOUT.panMs); panels are hidden meanwhile and the target's panel appears on landing. */
  goTo(step: LoginStep, then?: () => void, instant = false) {
    const to = this.steps[step] ?? this.steps.title;
    this.pan = null;
    this.hidePanels();
    if (instant || (to.x === this.cam.x && to.y === this.cam.y)) {
      this.cam = { ...to };
      this.land(step, then);
      return;
    }
    this.pan = { from: { ...this.cam }, to, t0: performance.now(), step, then };
  }

  private land(step: LoginStep, then?: () => void) {
    this.pan = null;
    this.state = step;
    if (step === 'world') this.buildWorld();
    else if (step === 'select') this.buildSelect();
    else if (step === 'create') this.buildCreate();
    this.panels[step].classList.remove('hidden');
    this.dock.classList.toggle('hidden', step !== 'title' && step !== 'select');
    this.diffSlot.classList.toggle('hidden', step !== 'select');
    then?.();
  }

  private hidePanels() {
    for (const p of Object.values(this.panels)) p.classList.add('hidden');
    this.dock.classList.add('hidden');
    this.diffSlot.classList.add('hidden');
    this.opts.classList.add('hidden');
  }

  private startCreate() {
    if (this.pan) return;
    if (!this.u('NewChar/avatarSel/0/normal')) { this.goTo('create', () => this.h.create()); return; }
    this.goTo('create');
  }

  // ---------------------------------------------------------------- overlay helpers

  private u(key: string): LoginSprite | undefined {
    return this.scene.ui[key];
  }

  /** a button state image: Title/BtLogin/normal/0 or WorldSelect/channel/3/normal */
  private st(key: string, state: string): LoginSprite | undefined {
    return this.u(`${key}/${state}/0`) ?? this.u(`${key}/${state}`);
  }

  /** numbered frames key/0, key/1, ... */
  private seq(key: string): LoginSprite[] {
    const out: LoginSprite[] = [];
    for (let s = this.u(`${key}/0`); s; s = this.u(`${key}/${out.length}`)) out.push(s);
    return out;
  }

  /** absolute, because a url() inside a CSS custom property resolves against the stylesheet (assets/), not the page */
  private url(s: LoginSprite) {
    return `url("${new URL(BASE + s.src, document.baseURI).href}")`;
  }

  /** A <button> sized to the sprite, state images by CSS vars; missing states fall back to normal. Null when the sprite is missing. */
  private spriteBtn(parent: HTMLElement, key: string, x: number, y: number, fn?: () => void, o: BtnOpts = {}): HTMLButtonElement | null {
    const n = this.st(key, 'normal');
    if (!n) return null;
    const b = el('button', fn ? 'ml-btn' : 'ml-btn deco');
    b.type = 'button';
    b.style.cssText = `left:${x - n.ox}px;top:${y - n.oy}px;width:${n.w}px;height:${n.h}px`;
    b.style.setProperty('--n', this.url(n));
    const v = (name: string, state: string) => { const s = this.st(key, state); b.style.setProperty(name, s ? this.url(s) : 'var(--n)'); return s; };
    v('--h', 'mouseOver');
    v('--p', 'pressed');
    if (!v('--d', 'disabled')) b.classList.add('nod');
    b.setAttribute('aria-label', o.label ?? key.split('/').pop()!);
    if (o.shot) b.dataset.shot = o.shot;
    if (!fn) b.tabIndex = -1;
    else b.addEventListener('click', fn);
    b.disabled = !!o.disabled;
    parent.appendChild(b);
    return b;
  }

  /** A static piece with its origin at (x, y); clipW cuts it to that width (gauges). */
  private spriteImg(parent: HTMLElement, key: string, x: number, y: number, clipW?: number): HTMLDivElement | null {
    const s = this.u(key);
    if (!s) return null;
    const d = el('div', 'ml-img');
    d.style.cssText = `left:${x - s.ox}px;top:${y - s.oy}px;width:${clipW === undefined ? s.w : Math.max(0, Math.min(s.w, clipW))}px;height:${s.h}px;background-image:${this.url(s)};background-size:${s.w}px ${s.h}px`;
    parent.appendChild(d);
    return d;
  }

  private text(parent: HTMLElement, x: number, y: number, s: string): HTMLDivElement {
    const d = el('div', 'ml-txt');
    d.style.cssText = `left:${x}px;top:${y}px`;
    d.textContent = s;
    parent.appendChild(d);
    return d;
  }

  /** Plays frames on an element; apply() puts one frame on it. */
  private animate(e: HTMLElement, frames: LoginSprite[], apply: (s: LoginSprite) => void): Anim | null {
    if (!frames.length) return null;
    apply(frames[0]);
    if (frames.length < 2) return null;
    const a: Anim = { el: e, frames, apply, cur: frames[0] };
    this.anims.push(a);
    return a;
  }

  private dockBtn(label: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'btn pbtn');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    // label always; the glyph is shown instead of it in the compact dock (buttons without a glyph, like Mute in the options, stay text)
    if (label in DOCK_ICON) b.append(el('span', 'ml-ico', DOCK_ICON[label]), el('span', 'ml-lbl', label));
    else b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  private slider(label: string, fn: (v: number) => void): HTMLInputElement {
    const l = el('label', 'volume', `${label} `);
    const i = el('input');
    i.type = 'range'; i.min = '0'; i.max = '1'; i.step = '0.05';
    i.setAttribute('aria-label', label);
    i.addEventListener('input', () => fn(parseFloat(i.value)));
    l.appendChild(i);
    this.opts.appendChild(l);
    return i;
  }

  /** top-left on screen of the union of the objects under a path prefix, seen from a step's camera */
  private boardAt(prefix: string, step: LoginStep, fallback: Pt): Pt {
    const c = this.steps[step];
    let x = Infinity, y = Infinity;
    for (const o of this.scene.objs) {
      const f = o.frames[0];
      if (!f || !o.path.startsWith(prefix)) continue;
      x = Math.min(x, o.x - c.x + VIEW_W / 2 - (o.flip ? f.w - f.ox : f.ox));
      y = Math.min(y, o.y - c.y + VIEW_H / 2 - f.oy);
    }
    return Number.isFinite(x) ? [Math.round(x), Math.round(y)] : fallback;
  }

  // ---------------------------------------------------------------- step panels

  private buildTitle() {
    const P = this.panels.title, L = LAYOUT.title, [sx, sy] = this.titleBoard;
    const field = (r: { x: number; y: number; w: number; h: number }, label: string, placeholder: string) => {
      const i = el('input', 'ml-field');
      i.readOnly = true;
      i.tabIndex = -1;
      i.autocomplete = 'off';
      i.spellcheck = false;
      i.placeholder = placeholder;
      i.setAttribute('aria-label', label);
      i.style.cssText = `left:${sx + r.x}px;top:${sy + r.y}px;width:${r.w}px;height:${r.h}px`;
      P.appendChild(i);
      return i;
    };
    // the ID box is the character's name: typing renames the saved character (or names the next one to be created)
    const id = (this.idEl = field(L.id, 'Character name', 'Your name'));
    id.readOnly = false;
    id.tabIndex = 0;
    id.maxLength = 12;
    id.autocapitalize = 'words';
    id.enterKeyHint = 'go';
    id.addEventListener('focus', () => id.select());
    id.addEventListener('change', () => this.rename());
    id.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.repeat) { this.rename(); id.blur(); this.goTo('world'); }
    });
    this.pwEl = field(L.pw, 'Password', '');
    const at = (p: Pt): Pt => [sx + p[0], sy + p[1]];
    const btn = (key: string, p: Pt, label: string, fn?: () => void, shot?: string) => this.spriteBtn(P, key, ...at(p), fn, { label, shot });
    btn('Title/BtLogin', L.login, 'Log in', () => this.goTo('world'), 'login');
    btn('Title/BtLoginIDSave', L.idSave, 'Save ID');
    btn('Title/BtLoginIDLost', L.idLost, 'Forgot ID');
    btn('Title/BtPasswdLost', L.pwLost, 'Forgot password');
    btn('Title/BtNew', L.newChar, 'New character', () => this.startCreate(), 'new');
    btn('Title/BtHomePage', L.home, 'Home page');
    btn('Title/BtQuit', L.quit, 'Quit');
    const hint = el('p', 'ml-hint', isTouch() ? 'Move: drag anywhere. Skills fire automatically.' : 'Move: WASD / arrows or drag on touch. Skills fire automatically. Q equip, I items, C stats.');
    hint.style.top = L.hintY + 'px';
    P.appendChild(hint);
  }

  private buildWorld() {
    const P = this.panels.world, L = LAYOUT.world;
    P.textContent = '';
    this.tabs = [];
    this.placeSel = null;
    this.tabsOn = false;
    this.scrollT0 = performance.now();
    this.spriteImg(P, 'Common/step/1', ...L.step);
    this.spriteBtn(P, 'Common/BtStart', ...L.back, () => this.worldBack(), { label: 'Back' });
    this.tabsEl = el('div', 'hidden');
    this.chansEl = el('div');
    P.append(this.chansEl, this.tabsEl);
    const [tx, ty] = [L.scroll[0] + L.tabs.dx, L.scroll[1] + L.tabs.dy];
    for (let i = 0; i < L.tabs.count; i++) {
      const b = this.spriteBtn(this.tabsEl, `WorldSelect/BtWorld/${i}`, tx + i * L.tabs.step, ty, () => this.pickWorld(i), { label: `World ${i + 1}`, shot: this.tabs.length ? undefined : 'world' });
      if (b) { b.dataset.world = String(i); b.classList.toggle('on', i === this.world); this.tabs.push(b); }
    }
    if (!this.seq('WorldSelect/scroll/0').length) this.showTabs();
  }

  /** Back on the world step: closes the channel panel, else returns to the title. */
  private worldBack() {
    if (this.chansEl.childElementCount) { this.chansEl.textContent = ''; this.placeSel = null; this.showTabs(); }
    else this.goTo('title');
  }

  private showTabs() {
    this.tabsOn = true;
    this.tabsEl.classList.remove('hidden');
  }

  private pickWorld(i: number) {
    this.world = i;
    this.channel = 0;
    this.remember();
    for (const b of this.tabs) b.classList.toggle('on', b.dataset.world === String(i));
    // the channel panel covers the scroll; Back closes it and shows the worlds again
    this.tabsEl.classList.add('hidden');
    this.buildChannels();
  }

  private pickChannel(i: number) {
    this.channel = i;
    this.remember();
    this.placeSel?.(i);
  }

  private remember() {
    try { localStorage.setItem(KEY, JSON.stringify({ world: this.world, channel: this.channel })); } catch { /* private mode */ }
  }

  /** The channel panel of the chosen world: name, 20 channels with gauges, selection glow, Go. */
  private buildChannels() {
    const C = this.chansEl, L = LAYOUT.world;
    C.textContent = '';
    if (this.world === null) return;
    const bg = this.u('WorldSelect/chBackgrn');
    const px = L.panel[0] - (bg?.ox ?? 224), py = L.panel[1] - (bg?.oy ?? 116);
    this.spriteImg(C, 'WorldSelect/chBackgrn', L.panel[0], L.panel[1]);
    this.spriteImg(C, `WorldSelect/world/${this.world}`, px + L.name[0], py + L.name[1]);
    const ch = L.channels;
    const at = (i: number): Pt => [px + ch.x + (i % ch.cols) * ch.dx, py + ch.y + Math.floor(i / ch.cols) * ch.dy];
    for (let i = 0; i < ch.count; i++) {
      const [bx, by] = at(i);
      const b = this.spriteBtn(C, `WorldSelect/channel/${i}`, bx, by, () => this.pickChannel(i), { label: `Channel ${i + 1}` });
      if (!b) continue;
      b.addEventListener('dblclick', () => { this.pickChannel(i); this.goTo('select'); });
      this.spriteImg(C, 'WorldSelect/channel/chgauge', bx + L.gauge[0], by + L.gauge[1], Math.round((this.u('WorldSelect/channel/chgauge')?.w ?? 0) * (30 + ((i * 37 + 11) % 61)) / 100));
    }
    // the highlight on the chosen channel
    const frames = this.seq('WorldSelect/channel/chSelect');
    if (frames.length) {
      const e = el('div', 'ml-img');
      let ax = 0, ay = 0;
      const put = (s: LoginSprite) => {
        e.style.cssText = `left:${ax - s.ox}px;top:${ay - s.oy}px;width:${s.w}px;height:${s.h}px;background-image:${this.url(s)};background-size:${s.w}px ${s.h}px`;
      };
      const a = this.animate(e, frames, put);
      this.placeSel = (i) => { [ax, ay] = at(i); if (a) a.cur = null; put(frames[0]); };
      this.placeSel(this.channel);
      C.appendChild(e);
    }
    const go = this.spriteBtn(C, 'WorldSelect/BtGoworld', px + L.go[0], py + L.go[1], () => this.goTo('select'), { label: 'Enter world', shot: 'channel' });
    const gf = this.seq('WorldSelect/BtGoworld/normal');
    if (go) this.animate(go, gf, (s) => go.style.setProperty('--n', this.url(s)));
  }

  private buildSelect() {
    const P = this.panels.select, L = LAYOUT.select;
    P.textContent = '';
    const ch = this.save?.character ?? null;
    if (this.world !== null) this.spriteImg(P, `WorldSelect/world/${this.world}`, ...L.selectWorld);
    this.spriteImg(P, 'Common/step/2', ...L.step);
    this.spriteBtn(P, 'Common/BtStart', ...L.back, () => this.goTo('world'), { label: 'Back' });
    const [cx, cy] = this.selectBoard;
    this.spriteBtn(P, 'CharSelect/BtSelect', cx + L.btSelect[0], cy + L.btSelect[1], () => this.h.select(), { label: 'Select character', shot: 'select', disabled: !ch });
    this.spriteBtn(P, 'CharSelect/BtNew', cx + L.btNew[0], cy + L.btNew[1], () => this.startCreate(), { label: 'New character', shot: 'cnew' });
    this.spriteBtn(P, 'CharSelect/BtDelete', cx + L.btDelete[0], cy + L.btDelete[1], undefined, { label: 'Delete character', disabled: true });
    const info = this.u('CharSelect/charInfo');
    if (!info) return;
    this.spriteImg(P, 'CharSelect/charInfo', ...L.info);
    const ix = L.info[0] - info.ox, iy = L.info[1] - info.oy;
    const line = (p: Pt, s: string) => this.text(P, ix + p[0], iy + p[1], s).classList.add('ml-info');
    if (ch) {
      const def = CLASS_BY_KEY[ch.cls];
      const lv = ch.level ?? 1;
      line(L.job, def?.name ?? ch.cls);
      line(L.level, String(lv));
      // stats as a v83 auto-assign would leave them: every AP in the class's main stat, 4 in the rest
      const main = { warrior: 'str', magician: 'int', bowman: 'dex', thief: 'luk', pirate: 'str' }[ch.cls as string] ?? 'str';
      for (const k of ['str', 'dex', 'int', 'luk'] as const) line(L[k], String(k === main ? 4 + 5 * (lv - 1) : 4));
      line(L.fame, '0');
    }
    const s = this.save;
    line(L.best, `${s && s.bestTime > 0 ? `Best run ${fmtTime(s.bestTime)}` : 'No runs yet'} · ${(s?.mesos ?? 0).toLocaleString('en-US')} mesos`);
  }


  // ---------------------------------------------------------------- the creator (v83 NewChar on the create map)

  private roll() {
    // v83 dice: four stats >= 4 summing to 25; the class's main stat is forced to be the highest
    const v = [4, 4, 4, 4];
    for (let n = 9; n > 0; n--) v[Math.floor(Math.random() * 4)]++;
    const main = { warrior: 0, bowman: 1, magician: 2, thief: 3, pirate: 0 }[this.cls as string] ?? 0;
    const hi = v.indexOf(Math.max(...v));
    [v[main], v[hi]] = [v[hi], v[main]];
    this.stats = v;
    this.cStatEls.forEach((e, i) => (e.textContent = String(v[i])));
  }

  private classText(): string {
    const c = CLASS_BY_KEY[this.cls];
    return `${c.weaponName} (${c.name})`;
  }

  private cChanged() {
    this.look = sanitizeLook(this.look, CLASS_BY_KEY[this.cls].weapon);
    void this.avatar?.ensureLook(this.look);
    this.cRefresh();
  }

  private cRefresh() {
    for (const r of ROWS) {
      const e = this.cRowEls.get(r.key);
      if (!e) continue;
      e.text.textContent = r.text(this.look);
      if (e.swatch && r.swatch) e.swatch.style.background = r.swatch(this.look);
    }
    const w = this.cRowEls.get('class');
    if (w) w.text.textContent = this.classText();
    this.cClock0 = performance.now();
  }

  private cBlurb() {
    const b = this.cBubble;
    if (!b) return;
    const c = CLASS_BY_KEY[this.cls], sk = SKILL_BY_KEY[c.skills[0]];
    b.textContent = '';
    const t = el('b', '', c.name);
    t.style.display = 'block';
    b.append(t, el('div', '', c.blurb), el('div', 'ml-bubble-skill', `Start skill: ${sk?.name ?? c.skills[0]}`));
  }

  private cycleClass(dir: number) {
    const i = (CLASSES.findIndex((c) => c.key === this.cls) + dir + CLASSES.length) % CLASSES.length;
    this.cls = CLASSES[i].key;
    this.look.weapon = CLASS_BY_KEY[this.cls].weapon;
    this.roll();
    this.cBlurb();
    this.cChanged();
  }

  private cycleRow(key: string, dir: number) {
    if (key === 'class') return this.cycleClass(dir);
    const r = ROWS.find((x) => x.key === key);
    if (!r) return;
    const n = r.count(this.look);
    r.set(this.look, (r.get(this.look) + dir + n) % n);
    this.cChanged();
  }

  private cStatus(msg: string) {
    if (!this.cStatusEl) return;
    this.cStatusEl.textContent = msg;
    clearTimeout(this.cStatusT);
    this.cStatusT = window.setTimeout(() => { if (this.cStatusEl) this.cStatusEl.textContent = ''; }, 1800);
  }

  /** commits the ID box: renames the saved character, or keeps the name for the creator */
  private rename() {
    const n = sanitizeName(this.idEl.value);
    const ch = this.save?.character;
    if (!n) { this.idEl.value = ch?.name ?? ''; return; }
    this.idEl.value = n;
    this.typedName = n;
    if (ch && ch.name !== n) this.h.rename?.(n);
  }
  private typedName = '';

  private buildCreate() {
    const P = this.panels.create, L = LAYOUT.create;
    P.textContent = '';
    this.cRowEls.clear();
    this.cStatEls = [];
    this.cRows = false;
    this.cScrollT0 = performance.now();
    this.cDiceUntil = 0;
    const ch = this.save?.character;
    if (ch && CLASS_BY_KEY[ch.cls]) {
      this.cls = ch.cls as ClassKey;
      this.look = sanitizeLook(ch.look, CLASS_BY_KEY[this.cls].weapon);
    } else {
      this.cls = DEFAULT_CLASS;
      this.look = defaultLook(CLASS_BY_KEY[this.cls].weapon);
    }
    void this.avatar?.ensureLook(this.look);

    // rows (shown once the scroll has unrolled)
    const rowsEl = el('div', 'ml-crows hidden');
    P.appendChild(rowsEl);
    const keys = ['face', 'hair', 'hairColor', 'skin', 'top', 'bottom', 'shoes', 'class', 'gender'];
    keys.forEach((k, i) => {
      const x = L.scroll[0] + L.rows[0], y = L.scroll[1] + L.rows[1] + i * L.rowDy;
      this.spriteImg(rowsEl, `NewChar/avatarSel/${i}/normal`, x, y);
      const lab = ROWS.find((r) => r.key === k)?.label ?? k;
      const arrow = (side: 'Left' | 'Right', p: Pt, dir: number) => {
        const b = this.spriteBtn(rowsEl, `NewChar/Bt${side}`, x + p[0], y + p[1], () => this.cycleRow(k, dir), { label: `${dir < 0 ? 'Previous' : 'Next'} ${lab}` });
        b?.classList.add('ml-arrow');
      };
      arrow('Left', L.left, -1);
      arrow('Right', L.right, 1);
      const v = L.value;
      const box = el('div', 'ml-cval');
      box.style.cssText = `left:${x + v.x}px;top:${y + v.y}px;width:${v.w}px;height:${v.h}px`;
      box.dataset.row = k;
      const swatch = k === 'hairColor' ? el('i', 'ml-cswatch') : null;
      const text = el('span');
      if (swatch) box.appendChild(swatch);
      box.appendChild(text);
      rowsEl.appendChild(box);
      this.cRowEls.set(k, { text, swatch });
    });
    this.cRowsEl = rowsEl;

    // name
    const n = el('input', 'ml-cname');
    n.type = 'text';
    n.maxLength = 12;
    n.autocomplete = 'off';
    n.spellcheck = false;
    n.setAttribute('aria-label', 'Name of character');
    n.autocapitalize = 'words';
    n.enterKeyHint = 'done';
    n.placeholder = 'Name';
    n.addEventListener('focus', () => n.select());
    n.value = this.typedName || ch?.name || '';
    n.style.cssText = `left:${L.name.x}px;top:${L.name.y}px;width:${L.name.w}px;height:${L.name.h}px`;
    n.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.cCheck(); });
    P.appendChild(n);
    this.cNameEl = n;
    this.spriteBtn(P, 'NewChar/BtCheck', ...L.check, () => this.cCheck(), { label: 'Check name', shot: 'create-check' });
    this.cStatusEl = this.text(P, L.status[0], L.status[1], '');
    this.cStatusEl.classList.add('ml-cstatus');

    // stats and dice
    L.stats.ys.forEach((y) => {
      const t = this.text(P, L.stats.x, y, '');
      t.classList.add('ml-info');
      this.cStatEls.push(t);
    });
    const df = this.seq('NewChar/dice');
    this.diceFrames = df;
    this.diceAt = -1;
    this.diceBtn = null;
    if (df.length) {
      const d = el('button', 'ml-btn');
      d.type = 'button';
      d.setAttribute('aria-label', 'Roll dice');
      d.dataset.shot = 'dice';
      d.addEventListener('click', () => this.cDice());
      P.appendChild(d);
      this.diceBtn = d;
      this.cDiceFrame(0);
    }

    // buttons
    this.spriteBtn(P, 'NewChar/BtYes', ...L.ok, () => this.cOk(), { label: 'OK', shot: 'create-ok' });
    this.spriteBtn(P, 'NewChar/BtNo', ...L.cancel, () => this.cCancel(), { label: 'Cancel', shot: 'create-cancel' });

    // class bubble
    const bub = this.u('NewChar/charAlert');
    if (bub) {
      const b = el('div', 'ml-bubble');
      b.style.cssText = `left:${L.bubble[0]}px;top:${L.bubble[1]}px;width:${bub.w}px;height:${bub.h}px;background-image:${this.url(bub)};background-size:${bub.w}px ${bub.h}px;padding:${L.bubblePad.join('px ')}px;--bw:${L.bubbleW}px`;
      P.appendChild(b);
      this.cBubble = b;
    } else this.cBubble = null;
    this.roll();
    this.cBlurb();
    this.cRefresh();
  }
  private cRowsEl: HTMLElement | null = null;
  private diceFrames: LoginSprite[] = [];
  private diceAt = -1;
  private diceBtn: HTMLButtonElement | null = null;

  /** puts dice frame i on the button (each frame has its own origin) */
  private cDiceFrame(i: number) {
    const d = this.diceBtn, s = this.diceFrames[i], [x, y] = LAYOUT.create.dice;
    if (!d || !s || i === this.diceAt) return;
    this.diceAt = i;
    d.style.cssText = `left:${x - s.ox}px;top:${y - s.oy}px;width:${s.w}px;height:${s.h}px`;
    d.style.setProperty('--n', this.url(s));
    d.style.setProperty('--h', this.url(s));
    d.style.setProperty('--p', this.url(s));
  }

  private cDice() {
    this.roll();
    this.look = randomLook(Math.random, CLASS_BY_KEY[this.cls].weapon);
    this.cDiceUntil = performance.now() + LAYOUT.create.diceMs;
    this.cChanged();
  }

  private cCheck(): string {
    const n = sanitizeName(this.cNameEl?.value ?? '');
    if (this.cNameEl) this.cNameEl.value = n;
    this.cStatus(n ? 'OK!' : 'Enter a name');
    return n;
  }

  private cOk() {
    const name = this.cCheck();
    if (!name) { this.cNameEl?.focus(); return; }
    const cls = this.cls;
    const r = { cls, look: { ...sanitizeLook(this.look, CLASS_BY_KEY[cls].weapon) }, name };
    this.h.created ? this.h.created(r) : this.h.create();
  }

  private cCancel() {
    this.goTo(this.save?.character ? 'select' : 'title');
  }

  /** The create map's scroll, the rows once it has unrolled, and the character on the mushroom platform. */
  private drawCreate(now: number, t: number) {
    const L = LAYOUT.create, fr = this.seq('NewChar/scroll/0');
    if (fr.length) {
      const i = Math.max(0, Math.min(fr.length - 1, Math.floor((now - this.cScrollT0) / L.scrollMs)));
      this.blit(fr[i], L.scroll[0], L.scroll[1]);
      if (i === fr.length - 1 && !this.cRows) { this.cRows = true; this.cRowsEl?.classList.remove('hidden'); }
    } else if (!this.cRows) { this.cRows = true; this.cRowsEl?.classList.remove('hidden'); }
    // the dice frames play quickly while rolling, then rest on the first
    const n = this.diceFrames.length;
    if (n) this.cDiceFrame(now < this.cDiceUntil ? Math.floor(now / 60) % n : 0);
    const av = this.avatar;
    if (!av) return;
    if (!av.ready(this.look)) { void av.ensureLook(this.look); return; }
    const act = av.stance(this.look, CLASS_BY_KEY[this.cls].stance).stand;
    const f = av.frame(this.look, act, frameIndexAt(av.timing(this.look, act) ?? [500], (now - this.cClock0) / 1000, true));
    if (!f) return;
    const c = this.ctx, s = L.scale;
    c.save();
    c.translate(L.feet[0], 0);
    c.scale(-s, s);
    c.drawImage(f.canvas, -f.ax, L.feet[1] / s - f.ay);
    c.restore();
    this.drawn++;
    void t;
  }

  // ---------------------------------------------------------------- canvas

  /** the shared loader: one <img> per file, started once */
  private load(src: string): HTMLImageElement {
    let im = this.imgs.get(src);
    if (!im) {
      im = new Image();
      im.src = BASE + src;
      this.imgs.set(src, im);
    }
    return im;
  }

  private image(src: string): HTMLImageElement | null {
    const im = this.load(src);
    return im.complete && im.naturalWidth ? im : null;
  }

  /** Loads the title step's art (scene frames, Common/ and Title/ sprites) so the first show has no pop-in (waits 8 s at most), then the rest of the ui sprites in the background. */
  async preload(onProgress?: (frac: number) => void): Promise<void> {
    const need = new Set<string>();
    for (const b of this.scene.backs) for (const f of b.frames) need.add(f.src);
    for (const o of this.scene.objs) for (const f of o.frames) need.add(f.src);
    const rest = new Set<string>();
    for (const [k, s] of Object.entries(this.scene.ui)) (/^(Common|Title)\//.test(k) ? need : rest).add(s.src);
    for (const s of need) rest.delete(s);
    let done = 0;
    const one = async (src: string) => {
      const im = this.load(src);
      try { if (im.decode) await im.decode(); else if (!im.complete) await new Promise((r) => { im.onload = im.onerror = r; }); } catch { /* missing or undecodable: skipped */ }
      onProgress?.(++done / need.size);
    };
    await Promise.race([Promise.all([...need].map(one)), new Promise((r) => setTimeout(r, 8000))]);
    onProgress?.(1);
    for (const src of rest) this.load(src);
  }

  private blit(s: LoginSprite, x: number, y: number, flip = false, alpha = 1, cw = s.w) {
    const im = this.image(s.src);
    if (!im || cw <= 0) return;
    const c = this.ctx;
    c.globalAlpha = alpha;
    if (flip) {
      c.save();
      c.translate(Math.round(x + cw), Math.round(y));
      c.scale(-1, 1);
      c.drawImage(im, 0, 0, cw, s.h, 0, 0, cw, s.h);
      c.restore();
    } else c.drawImage(im, 0, 0, cw, s.h, Math.round(x), Math.round(y), cw, s.h);
    c.globalAlpha = 1;
  }

  private tick = () => {
    if (!this.shown) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    const p = this.pan;
    if (p) {
      const u = Math.min(1, (now - p.t0) / LAYOUT.panMs);
      const e = (1 - Math.cos(Math.PI * u)) / 2;
      this.cam = { x: p.from.x + (p.to.x - p.from.x) * e, y: p.from.y + (p.to.y - p.from.y) * e };
      if (u >= 1) { this.cam = { ...p.to }; this.land(p.step, p.then); }
    }
    const t = now - this.t0;
    this.anims = this.anims.filter((a) => a.el.isConnected);
    for (const a of this.anims) {
      const f = frameAt(a.frames, t);
      if (f !== a.cur) { a.cur = f; a.apply(f); }
    }
    this.draw(now, t);
    if (this.bctx && this.frame++ % 3 === 0) this.bctx.drawImage(this.ctx.canvas, 0, 0, 160, 120);
  };

  private draw(now: number, t: number) {
    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#000';
    c.fillRect(0, 0, VIEW_W, VIEW_H);
    for (const p of placements(this.scene, this.cam.x, this.cam.y, t)) this.blit(p.sprite, p.x, p.y, p.flip, p.alpha);
    if (!this.pan) {
      if (this.state === 'world') this.drawScroll(now);
      else if (this.state === 'select') this.drawSelect(t);
      else if (this.state === 'create') this.drawCreate(now, t);
    }
    const f = this.u('Common/frame');
    if (f) this.blit(f, VIEW_W / 2 - f.ox, VIEW_H / 2 - f.oy);
  }

  /** The scroll unrolling once (then staying open); the world tabs appear when it is done. */
  private drawScroll(now: number) {
    const L = LAYOUT.world, fr = this.seq('WorldSelect/scroll/0');
    if (!fr.length) return;
    const i = Math.max(0, Math.min(fr.length - 1, Math.floor((now - this.scrollT0) / L.scrollMs)));
    this.blit(fr[i], L.scroll[0], L.scroll[1]);
    if (i === fr.length - 1 && !this.tabsOn) this.showTabs();
  }

  /** The saved character on its stage (or the empty slot), glow under the feet, name tag below. */
  private drawSelect(t: number) {
    const L = LAYOUT.select, [fx, fy] = L.feet, ch = this.save?.character;
    if (!ch) {
      const e = this.u('CharSelect/character/1/0');
      if (e) this.blit(e, fx - e.ox, fy - e.oy);
      this.drawn++;
      return;
    }
    const glow = this.seq('CharSelect/character/0');
    if (glow.length) { const g = frameAt(glow, t); this.blit(g, fx - g.ox, fy - g.oy); }
    const av = this.avatar, c = this.ctx;
    let done = !av;
    if (av) {
      if (!av.ready(ch.look)) void av.ensureLook(ch.look);
      else {
        const act = av.stance(ch.look, CLASS_BY_KEY[ch.cls]?.stance ?? 'swing').stand;
        const f = av.frame(ch.look, act, frameIndexAt(av.timing(ch.look, act) ?? [500], t / 1000, true));
        if (f) {
          // the sprites face left; the select stage shows them looking right
          c.save();
          c.translate(fx, 0);
          c.scale(-1, 1);
          c.drawImage(f.canvas, -f.ax, fy - f.ay);
          c.restore();
          done = true;
        }
      }
    }
    // name tag: left | middle (tiled to the text) | right
    const a = this.u('CharSelect/nameTag/1/0'), m = this.u('CharSelect/nameTag/1/1'), b = this.u('CharSelect/nameTag/1/2');
    c.font = '12px Arial, sans-serif';
    c.textBaseline = 'middle';
    c.fillStyle = '#fff';
    const ty = fy + L.tag[1];
    if (a && m && b) {
      const tw = Math.ceil(c.measureText(ch.name).width);
      const x0 = Math.round(fx + L.tag[0] - (a.w + tw + b.w) / 2);
      this.blit(a, x0, ty);
      for (let x = 0; x < tw; x += m.w) this.blit(m, x0 + a.w + x, ty, false, 1, Math.min(m.w, tw - x));
      this.blit(b, x0 + a.w + tw, ty);
      c.textAlign = 'left';
      c.fillText(ch.name, x0 + a.w, ty + a.h / 2 + 1);
    } else {
      c.textAlign = 'center';
      c.fillText(ch.name, fx + L.tag[0], ty + 8);
    }
    c.textAlign = 'left';
    if (done) this.drawn++;
  }
}
