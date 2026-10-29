/**
 * The classic MapleStory login screen, built from UI.wz (Login.img) and Map.wz (Back/login.img) pieces: the sky backdrop with slow clouds,
 * the logo, the signboard with the Play / New Character buttons (and a slot for more, e.g. the Monster Book), then the character select
 * stage (last character with a name tag: name, level, job). Only used when the real button art was extracted (see classic()); without
 * it Screens keeps the plain title window.
 */
import type { CreateResult } from './create.ts';
import { CLASS_BY_KEY } from '../game/data.ts';
import { frameIndexAt } from '../maple/avatar.ts';
import type { Avatar } from '../maple/avatar.ts';
import { fmtTime } from './hud.ts';
import { isTouch } from './touch.ts';
import type { SaveData } from './save.ts';
import { theme } from './theme.ts';

export interface LoginHandlers {
  /** open character creation */
  create(): void;
  /** the map creator finished: start the run with this character */
  created?(r: CreateResult): void;
  /** start the run with the saved character */
  select(): void;
  /** renames the saved character (typed into the ID box of the login map) */
  rename?(name: string): void;
  /** resume the saved run in progress */
  continueRun(): void;
  volume(v: number): void;
  sfxVolume(v: number): void;
  mute(m: boolean): void;
  pet(on: boolean): void;
}

/** the classic layout needs at least the two real title buttons */
export function classic(): boolean {
  return theme.has('login.btLogin.normal') && theme.has('login.btNew.normal');
}

const STAGE_W = 800;
const STAGE_H = 600;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export type LoginState = 'title' | 'select';

/** What Screens needs from a login screen: the classic LoginScreen or the map-based MapLogin (src/ui/login-map.ts). */
export interface LoginLike {
  readonly root: HTMLDivElement;
  readonly state: string;
  readonly visible: boolean;
  /** frames the select stage drew (tests) */
  drawn: number;
  /** stays on screen behind the character creator (Screens.hideAll({ keepLogin })) */
  readonly overlay?: boolean;
  show(save: SaveData): void;
  refresh(save: SaveData): void;
  hide(): void;
  showTitle(): void;
  showSelect(): void;
  setMuted(m: boolean): void;
  addButton(label: string, fn: () => void): unknown;
  /** Shows (label) or hides (null) the Continue button for a run in progress. */
  setContinue(label: string | null): void;
  /** places the difficulty picker */
  mountDifficulty(el: HTMLElement): void;
}

export class LoginScreen implements LoginLike {
  readonly root: HTMLDivElement;
  state: LoginState = 'title';
  private stage: HTMLDivElement;
  private titlePane: HTMLDivElement;
  private selectPane: HTMLDivElement;
  private board: HTMLDivElement;
  private optionsPane: HTMLDivElement;
  private statsEl: HTMLElement;
  private nameEl: HTMLElement;
  private infoEl: HTMLElement;
  private canvas: HTMLCanvasElement;
  private vol: HTMLInputElement;
  private sfxVol: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private muted = false;
  private raf = 0;
  private shown = false;
  private save: SaveData | null = null;
  private playBtn: HTMLButtonElement;
  private contBtn: HTMLButtonElement;
  private petEl!: HTMLInputElement;
  private selectBtns!: HTMLDivElement;
  /** frames the select stage drew (tests) */
  drawn = 0;

  constructor(parent: HTMLElement, private h: LoginHandlers, private avatar: Avatar | null) {
    const root = (this.root = el('div', 'screen login hidden'));
    root.appendChild(this.backdrop());
    this.stage = el('div', 'login-stage');
    root.appendChild(this.stage);

    // ---- title pane: logo, signboard, buttons
    this.titlePane = el('div', 'login-pane login-title');
    const logo = el('div', 'login-logo');
    this.titlePane.appendChild(logo);
    this.board = el('div', 'login-board');
    this.statsEl = el('div', 'login-stats');
    this.board.appendChild(this.statsEl);
    this.playBtn = this.button('Play', 'pb-play', () => this.onPlay());
    this.playBtn.title = 'Play';
    const newBtn = this.button('New Character', 'pb-new', () => this.h.create());
    newBtn.title = 'New Character';
    this.contBtn = this.button('Continue', 'login-continue', () => this.h.continueRun());
    this.contBtn.classList.add('hidden');
    const row = el('div', 'login-btns');
    row.append(this.contBtn, this.playBtn, newBtn);
    const extra = el('div', 'login-extra');
    row.appendChild(extra);
    this.board.appendChild(row);
    this.board.appendChild(this.button('Options', 'login-opt', () => this.optionsPane.classList.toggle('hidden')));
    this.optionsPane = el('div', 'login-options hidden');
    this.vol = this.slider('Music', (v) => this.h.volume(v));
    this.sfxVol = this.slider('SFX', (v) => this.h.sfxVolume(v));
    this.muteBtn = this.button('Mute', 'login-mute', () => this.h.mute(!this.muted));
    this.optionsPane.appendChild(this.muteBtn);
    const petOpt = el('label', 'pet-opt', '<input type="checkbox"> Pet');
    petOpt.title = 'A pet follows you and picks up mesos and potions';
    this.petEl = petOpt.querySelector('input')!;
    this.petEl.addEventListener('change', () => this.h.pet(this.petEl.checked));
    this.optionsPane.appendChild(petOpt);
    this.board.appendChild(this.optionsPane);
    this.board.appendChild(el('p', 'login-hint', isTouch() ? 'Move: drag anywhere.<br>Skills fire automatically.' : 'Move: WASD / arrows or drag on touch.<br>Skills fire automatically. Q equip, I items, C stats.'));
    this.titlePane.appendChild(this.board);

    // ---- select pane: the last character on a stage, name tag, buttons
    this.selectPane = el('div', 'login-pane login-select hidden');
    const frame = el('div', 'cs-frame');
    this.canvas = el('canvas', 'cs-canvas');
    this.canvas.width = 220;
    this.canvas.height = 260;
    const tag = el('div', 'cs-tag');
    this.nameEl = el('b', 'cs-name');
    this.infoEl = el('span', 'cs-info');
    tag.append(this.nameEl, this.infoEl);
    frame.append(this.canvas, tag);
    const btns = el('div', 'login-btns cs-btns');
    btns.append(
      this.button('Select', 'pb-select', () => this.h.select()),
      this.button('New Character', 'pb-cnew', () => this.h.create()),
      this.button('Back', 'cs-back', () => this.showTitle()),
    );
    this.selectBtns = btns;
    this.selectPane.append(frame, btns);
    this.stage.append(this.titlePane, this.selectPane);
    parent.appendChild(root);

    const fit = () => root.style.setProperty('--ls', String(Math.max(0.3, Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H))));
    fit();
    window.addEventListener('resize', fit);
  }

  private button(label: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el('button', `btn pbtn ${cls}`, label);
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  private slider(label: string, fn: (v: number) => void): HTMLInputElement {
    const l = el('label', 'volume', `${label} `);
    const i = el('input');
    i.type = 'range'; i.min = '0'; i.max = '1'; i.step = '0.05';
    i.addEventListener('input', () => fn(parseFloat(i.value)));
    l.appendChild(i);
    this.optionsPane?.appendChild(l);
    return i;
  }

  /** Sky, ocean and drifting clouds from the extracted Back/login.img layers; a plain gradient sky when there are none. */
  private backdrop(): HTMLDivElement {
    const bd = el('div', 'login-back');
    const names = theme.names('login.back.').sort((a, b) => (theme.art!.pieces[a].meta?.rank ?? 99) - (theme.art!.pieces[b].meta?.rank ?? 99));
    const pieces = theme.art?.pieces ?? {};
    if (names.length) {
      bd.style.setProperty('--sky', `url("${theme.url(names[0])}")`);
      bd.classList.add('has-sky');
    }
    let clouds = 0;
    names.slice(1).forEach((n) => {
      const p = pieces[n];
      const layer = el('div');
      layer.style.backgroundImage = `url("${theme.url(n)}")`;
      layer.style.width = p.w + 'px';
      layer.style.height = p.h + 'px';
      if (p.w >= 300 && p.h <= 260) {
        // a wide strip (sea / horizon): along the bottom
        layer.className = 'login-strip';
        layer.style.width = '';
        layer.style.backgroundSize = 'auto 100%';
      } else {
        // a cloud: drifts across at its own height and speed
        layer.className = 'login-cloud';
        layer.style.top = 4 + ((clouds * 23) % 38) + '%';
        layer.style.animationDuration = 90 + clouds * 37 + 's';
        layer.style.animationDelay = -(clouds * 41) + 's';
        clouds++;
      }
      bd.appendChild(layer);
    });
    return bd;
  }

  private onPlay() {
    if (this.save?.character) this.showSelect();
    else this.h.create();
  }

  /** Adds a button to the signboard (e.g. the Monster Book from another branch). */
  addButton(label: string, fn: () => void): HTMLButtonElement {
    const b = this.button(label, 'login-extra-btn', fn);
    this.board.querySelector('.login-extra')!.appendChild(b);
    // the same button on the character select stage
    this.selectBtns.appendChild(this.button(label, 'login-extra-btn', fn));
    return b;
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.muteBtn.textContent = m ? 'Unmute' : 'Mute';
  }

  get visible() {
    return this.shown;
  }

  mountDifficulty(el: HTMLElement) {
    this.board.insertBefore(el, this.board.querySelector('.login-btns'));
  }

  /** Shows (label) or hides (null) the Continue button for a run in progress. */
  setContinue(label: string | null) {
    this.contBtn.classList.toggle('hidden', !label);
    if (label) { this.contBtn.textContent = label; this.contBtn.setAttribute('aria-label', label); this.contBtn.title = label; }
  }

  show(save: SaveData) {
    this.save = save;
    this.vol.value = String(save.settings.volume);
    this.sfxVol.value = String(save.settings.sfxVolume);
    this.setMuted(save.settings.muted);
    this.petEl.checked = save.settings.pet;
    this.refresh(save);
    this.shown = true;
    this.root.classList.remove('hidden');
    this.showTitle();
  }

  /** Redraws the best time and banked mesos line. */
  refresh(save: SaveData) {
    this.statsEl.innerHTML = `<div>Best time <b>${save.bestTime > 0 ? fmtTime(save.bestTime) : '-'}</b></div><div>Banked mesos <b>${save.mesos}</b></div>`;
  }

  hide() {
    this.shown = false;
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
  }

  showTitle() {
    this.state = 'title';
    this.titlePane.classList.remove('hidden');
    this.selectPane.classList.add('hidden');
    this.optionsPane.classList.add('hidden');
    cancelAnimationFrame(this.raf);
  }

  showSelect() {
    const ch = this.save?.character;
    if (!ch) return this.h.create();
    this.state = 'select';
    this.titlePane.classList.add('hidden');
    this.selectPane.classList.remove('hidden');
    const def = CLASS_BY_KEY[ch.cls];
    this.nameEl.textContent = ch.name;
    this.infoEl.textContent = `Lv. ${ch.level ?? 1}  ${def?.name ?? ch.cls}`;
    cancelAnimationFrame(this.raf);
    const tick = (now: number) => {
      if (!this.shown || this.state !== 'select') return;
      this.raf = requestAnimationFrame(tick);
      this.draw(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private draw(now: number) {
    const ch = this.save?.character;
    const cv = this.canvas;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath();
    ctx.ellipse(cv.width / 2, cv.height - 22, 54, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    const av = this.avatar;
    if (!av || !ch) return;
    if (!av.ready(ch.look)) { void av.ensureLook(ch.look); return; }
    const act = av.stance(ch.look, CLASS_BY_KEY[ch.cls]?.stance ?? 'swing').stand;
    const f = av.frame(ch.look, act, frameIndexAt(av.timing(ch.look, act) ?? [500], now / 1000, true));
    if (!f) return;
    const s = 3;
    // the sprites face left; the select stage shows them looking right, towards the buttons
    ctx.save();
    ctx.translate(Math.round(cv.width / 2), 0);
    ctx.scale(-1, 1);
    ctx.drawImage(f.canvas, Math.round(-f.ax * s), Math.round(cv.height - 22 - f.ay * s), f.canvas.width * s, f.canvas.height * s);
    ctx.restore();
    this.drawn++;
  }
}
