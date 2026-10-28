/**
 * The real v83 login map: the scene of UI.wz MapLogin.img (see src/maple/login-scene.ts) drawn on an 800x600 canvas, with the camera
 * panning between the steps like the client (title -> world select -> character select -> creation) and Login.img's buttons, signboard
 * fields and name tag as a DOM overlay in the same coordinates. Used by Screens when the manifest has a `login` section; otherwise the
 * classic LoginScreen (login.ts) or the plain title window stays. Every screen position is in LAYOUT so it can be tuned from screenshots.
 */
import { CLASS_BY_KEY } from '../game/data.ts';
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
    id: { x: 70, y: 78, w: 150, h: 20 },
    pw: { x: 70, y: 104, w: 150, h: 20 },
    login: [232, 76] as Pt,
    idSave: [56, 136] as Pt,
    idLost: [136, 136] as Pt,
    pwLost: [222, 136] as Pt,
    newChar: [48, 164] as Pt,
    home: [142, 164] as Pt,
    quit: [237, 164] as Pt,
    /** controls hint: top of the line, centred */
    hintY: 580,
  },
  world: {
    step: [8, 8] as Pt,
    back: [8, 540] as Pt,
    /** unrolled scroll: top-left, ms per frame */
    scroll: [143, 92] as Pt,
    scrollMs: 90,
    /** world tabs: offset from the scroll, spacing; world ids 0..count-1 */
    tabs: { dx: 42, dy: 150, step: 29, count: 15 },
    /** channel panel: where its origin point goes */
    panel: [400, 330] as Pt,
    /** relative to the panel's top-left */
    name: [14, 10] as Pt,
    channels: { x: 14, y: 58, dx: 85, dy: 34, cols: 5, count: 20 },
    /** relative to a channel button */
    gauge: [46, 24] as Pt,
    go: [330, 206] as Pt,
  },
  select: {
    selectWorld: [8, 8] as Pt,
    /** relative to selectWorld */
    worldName: [14, 6] as Pt,
    step: [162, 8] as Pt,
    back: [8, 540] as Pt,
    /** the character's feet */
    feet: [240, 365] as Pt,
    /** name tag offset from the feet (centred) */
    tag: [0, 4] as Pt,
    /** relative to the CharSelect signboard */
    btSelect: [16, 40] as Pt,
    btNew: [16, 80] as Pt,
    btDelete: [16, 122] as Pt,
    /** charInfo's origin point, and the texts relative to its top-left */
    info: [470, 470] as Pt,
    name: [60, 8] as Pt,
    job: [60, 30] as Pt,
    level: [60, 50] as Pt,
    best: [60, 70] as Pt,
    mesos: [60, 90] as Pt,
  },
  /** extras column: x, and the gap from the bottom of the stage; the column grows upwards */
  dock: { x: 650, bottom: 40, w: 140 },
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
  private panels: Record<'title' | 'world' | 'select', HTMLDivElement>;
  private dock: HTMLDivElement;
  private opts: HTMLDivElement;
  private muteBtn: HTMLButtonElement;
  private vol: HTMLInputElement;
  private sfxVol: HTMLInputElement;
  private petEl: HTMLInputElement;
  private idEl!: HTMLInputElement;
  private pwEl!: HTMLInputElement;
  private tabsEl = el('div', 'hidden');
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
    const stage = el('div', 'ml-stage');
    const canvas = el('canvas', 'ml-canvas');
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d')!;
    const ui = el('div', 'ml-ui');
    this.panels = { title: el('div', 'ml-panel hidden'), world: el('div', 'ml-panel hidden'), select: el('div', 'ml-panel hidden') };
    this.dock = el('div', 'ml-dock hidden');
    this.dock.style.cssText = `left:${LAYOUT.dock.x}px;bottom:${LAYOUT.dock.bottom}px;width:${LAYOUT.dock.w}px`;
    ui.append(this.panels.title, this.panels.world, this.panels.select, this.dock);
    stage.append(canvas, ui);
    root.appendChild(stage);

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
    optBtn.dataset.shot = 'options';
    this.dock.append(optBtn, this.opts);

    this.buildTitle();
    parent.appendChild(root);

    const fit = () => root.style.setProperty('--ls', String(Math.max(0.3, Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H))));
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', (e) => {
      if (!this.shown || this.pan || e.key !== 'Enter' || e.repeat) return;
      if ((e.target as Element | null)?.closest?.('button, .ml-opts')) return;
      if (this.state === 'title') this.goTo('world');
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

  /** Adds a button to the extras dock (e.g. the Monster Book). */
  addButton(label: string, fn: () => void): HTMLButtonElement {
    const b = this.dockBtn(label, fn);
    this.dock.insertBefore(b, this.opts);
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
    if (step !== 'create') this.panels[step].classList.remove('hidden');
    this.dock.classList.toggle('hidden', step !== 'title' && step !== 'select');
    then?.();
  }

  private hidePanels() {
    for (const p of Object.values(this.panels)) p.classList.add('hidden');
    this.dock.classList.add('hidden');
    this.opts.classList.add('hidden');
  }

  private startCreate() {
    if (this.pan) return;
    this.goTo('create', () => this.h.create());
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

  private url(s: LoginSprite) {
    return `url("${BASE}${s.src}")`;
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
    const b = el('button', 'btn pbtn', label);
    b.type = 'button';
    b.setAttribute('aria-label', label);
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
      i.placeholder = placeholder;
      i.setAttribute('aria-label', label);
      i.style.cssText = `left:${sx + r.x}px;top:${sy + r.y}px;width:${r.w}px;height:${r.h}px`;
      P.appendChild(i);
      return i;
    };
    this.idEl = field(L.id, 'ID', 'New player');
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
    this.spriteBtn(P, 'Common/BtStart', ...L.back, () => this.goTo('title'), { label: 'Back' });
    this.tabsEl = el('div', 'hidden');
    this.chansEl = el('div');
    P.append(this.chansEl, this.tabsEl);
    const [tx, ty] = [L.scroll[0] + L.tabs.dx, L.scroll[1] + L.tabs.dy];
    for (let i = 0; i < L.tabs.count; i++) {
      const b = this.spriteBtn(this.tabsEl, `WorldSelect/BtWorld/${i}`, tx + i * L.tabs.step, ty, () => this.pickWorld(i), { label: `World ${i + 1}`, shot: this.tabs.length ? undefined : 'world' });
      if (b) { b.dataset.world = String(i); b.classList.toggle('on', i === this.world); this.tabs.push(b); }
    }
    if (this.world !== null) this.buildChannels();
    if (!this.seq('WorldSelect/scroll/0').length) this.showTabs();
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
    const sw = this.spriteImg(P, 'Common/selectWorld', ...L.selectWorld);
    if (sw && this.world !== null) this.spriteImg(P, `WorldSelect/world/${this.world}`, parseFloat(sw.style.left) + this.u('Common/selectWorld')!.ox + L.worldName[0], parseFloat(sw.style.top) + this.u('Common/selectWorld')!.oy + L.worldName[1]);
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
    const line = (p: Pt, s: string) => this.text(P, ix + p[0], iy + p[1], s);
    if (ch) {
      line(L.name, ch.name);
      line(L.job, CLASS_BY_KEY[ch.cls]?.name ?? ch.cls);
      line(L.level, `Lv. ${ch.level ?? 1}`);
    }
    const s = this.save;
    line(L.best, `Best ${s && s.bestTime > 0 ? fmtTime(s.bestTime) : '-'}`);
    line(L.mesos, `Mesos ${s?.mesos ?? 0}`);
  }

  // ---------------------------------------------------------------- canvas

  private image(src: string): HTMLImageElement | null {
    let im = this.imgs.get(src);
    if (!im) {
      im = new Image();
      im.src = BASE + src;
      this.imgs.set(src, im);
    }
    return im.complete && im.naturalWidth ? im : null;
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
    }
    const f = this.u('Common/frame');
    if (f) this.blit(f, VIEW_W / 2 - f.ox, VIEW_H / 2 - f.oy);
  }

  /** The scroll unrolling once (then staying open); the world tabs appear when it is done. */
  private drawScroll(now: number) {
    const L = LAYOUT.world, fr = this.seq('WorldSelect/scroll/0');
    if (!fr.length) return;
    const i = Math.min(fr.length - 1, Math.floor((now - this.scrollT0) / L.scrollMs));
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
