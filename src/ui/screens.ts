import { BOSS_TOTAL } from '../game/data.ts';
import type { Sim } from '../game/sim.ts';
import { evolutionHint } from '../game/evolutions.ts';
import type { Card } from '../game/types.ts';
import type { Avatar } from '../maple/avatar.ts';
import { fmtTime } from './hud.ts';
import { canFullscreen, isTouch, toggleFullscreen } from './touch.ts';
import { LoginScreen, classic } from './login.ts';
import type { SaveData } from './save.ts';
import { theme } from './theme.ts';

export interface ScreenHandlers {
  /** opens character creation */
  start(): void;
  /** starts straight away with the last created character */
  quick(): void;
  resume(): void;
  quit(): void;
  retry(): void;
  menu(): void;
  pick(i: number): void;
  reroll(): void;
  banish(i: number): void;
  volume(v: number): void;
  /** opens the Monster Book */
  book(): void;
  /** opens the Henesys shop */
  shop(): void;
  pet(on: boolean): void;
  sfxVolume(v: number): void;
  mute(m: boolean): void;
}

export interface Results {
  won: boolean;
  time: number;
  level: number;
  kills: number;
  mesos: number;
  bosses: number;
  elites: number;
  best: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class Screens {
  private title: HTMLDivElement;
  private pause: HTMLDivElement;
  private levelup: HTMLDivElement;
  private results: HTMLDivElement;
  private cardsEl!: HTMLDivElement;
  private rerollBtn!: HTMLButtonElement;
  private luHead!: HTMLElement;
  private offerRef: Card[] | null = null;
  private offerSig = '';
  private h: ScreenHandlers;
  private icons: Record<string, string>;
  private quickBtn!: HTMLButtonElement;
  private petEl!: HTMLInputElement;
  private bestEl!: HTMLElement;
  private mesoEl!: HTMLElement;
  private volEl!: HTMLInputElement;
  private sfxVolEl!: HTMLInputElement;
  private muteEl!: HTMLButtonElement;
  private muted = false;
  /** the classic MapleStory login screen (null: the plain title window is used) */
  readonly login: LoginScreen | null = null;
  private titleExtra!: HTMLDivElement;

  constructor(parent: HTMLElement, h: ScreenHandlers, icons: Record<string, string>, avatar: Avatar | null = null) {
    this.h = h;
    this.icons = icons;
    this.title = this.buildTitle();
    if (classic()) this.login = new LoginScreen(parent, { create: () => h.start(), select: () => h.quick(), volume: (v) => h.volume(v), sfxVolume: (v) => h.sfxVolume(v), mute: (m) => h.mute(m), pet: (on) => h.pet(on) }, avatar);
    this.login?.addButton('Monster Book', () => h.book());
    this.login?.addButton('Henesys Shop', () => h.shop());
    this.pause = this.buildPause();
    this.levelup = this.buildLevelUp();
    this.results = el('div', 'screen results hidden');
    parent.append(this.title, this.pause, this.levelup, this.results);
  }

  private win(title: string, cls = ''): { root: HTMLDivElement; body: HTMLDivElement } {
    const root = el('div', 'screen hidden');
    const w = el('div', 'win ' + cls);
    w.appendChild(el('div', 'win-head', title));
    const body = el('div', 'win-body');
    w.appendChild(body);
    root.appendChild(w);
    return { root, body };
  }

  private btn(text: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'btn ' + cls, text);
    b.addEventListener('click', fn);
    return b;
  }

  private buildTitle(): HTMLDivElement {
    const { root, body } = this.win('MapleStory Survivor', 'title-win');
    body.appendChild(el('div', 'logo', '<span>Maple</span>Story<br><b>SURVIVOR</b>'));
    body.appendChild(el('p', 'tagline', 'Survive 15 minutes. Slay the bosses. Collect the mesos.'));
    const stats = el('div', 'stats');
    this.bestEl = el('span', '', '0:00');
    this.mesoEl = el('span', '', '0');
    stats.append(el('div', '', 'Best time: '), el('div', '', 'Banked mesos: '));
    stats.children[0].appendChild(this.bestEl);
    stats.children[1].appendChild(this.mesoEl);
    body.appendChild(stats);
    this.titleExtra = el('div', 'title-extra');
    body.appendChild(this.titleExtra);
    this.quickBtn = this.btn('Quick start', 'quick-start', () => this.h.quick());
    this.quickBtn.classList.add('hidden');
    body.appendChild(this.quickBtn);
    body.appendChild(this.btn('START', 'primary big', () => this.h.start()));
    body.appendChild(this.btn('Monster Book', 'book-btn', () => this.h.book()));
    body.appendChild(this.btn('Henesys Shop', 'book-btn', () => this.h.shop()));
    const petOpt = el('label', 'pet-opt', '<input type="checkbox"> Pet (follows you and picks up mesos and potions)');
    this.petEl = petOpt.querySelector('input')!;
    this.petEl.addEventListener('change', () => this.h.pet(this.petEl.checked));
    body.appendChild(petOpt);
    const vol = el('label', 'volume', 'Volume ');
    this.volEl = el('input', '');
    this.volEl.type = 'range'; this.volEl.min = '0'; this.volEl.max = '1'; this.volEl.step = '0.05';
    this.volEl.addEventListener('input', () => this.h.volume(parseFloat(this.volEl.value)));
    vol.appendChild(this.volEl);
    const sfxVol = el('label', 'volume', 'SFX ');
    this.sfxVolEl = el('input', '');
    this.sfxVolEl.type = 'range'; this.sfxVolEl.min = '0'; this.sfxVolEl.max = '1'; this.sfxVolEl.step = '0.05';
    this.sfxVolEl.addEventListener('input', () => this.h.sfxVolume(parseFloat(this.sfxVolEl.value)));
    sfxVol.appendChild(this.sfxVolEl);
    this.muteEl = this.btn('Mute', 'mute', () => this.h.mute(!this.muted));
    vol.appendChild(this.muteEl);
    body.appendChild(vol);
    body.appendChild(sfxVol);
    if (isTouch() && canFullscreen()) body.appendChild(this.btn('Fullscreen', 'fs-btn', () => void toggleFullscreen()));
    body.appendChild(el('p', 'hint', isTouch() ? 'Move: drag anywhere.<br>Skills fire automatically.' : 'Move: WASD / arrow keys, or drag on a touch screen.<br>Skills fire automatically. Pause: Esc or P.'));
    return root;
  }

  private buildPause(): HTMLDivElement {
    const { root, body } = this.win('Paused', 'small');
    body.append(this.btn('Resume', 'primary', () => this.h.resume()), this.btn('Quit to menu', '', () => this.h.quit()));
    return root;
  }

  private buildLevelUp(): HTMLDivElement {
    const root = el('div', 'screen levelup hidden');
    const w = el('div', 'win wide');
    this.luHead = el('div', 'win-head', 'LEVEL UP!');
    w.appendChild(this.luHead);
    const body = el('div', 'win-body');
    this.cardsEl = el('div', 'cards');
    body.appendChild(this.cardsEl);
    const row = el('div', 'lu-row');
    this.rerollBtn = this.btn('Reroll', '', () => this.h.reroll());
    row.appendChild(this.rerollBtn);
    row.appendChild(el('span', 'hint', (isTouch() ? 'Tap a card to choose.' : 'Keys 1-3 to choose.') + ' Banish removes a card from this run.'));
    body.appendChild(row);
    w.appendChild(body);
    root.appendChild(w);
    window.addEventListener('keydown', (e) => {
      if (this.levelup.classList.contains('hidden')) return;
      const i = ['1', '2', '3'].indexOf(e.key);
      if (i >= 0) this.h.pick(i);
    });
    return root;
  }

  /** An extra button on the title screen (both the classic signboard and the plain title), e.g. the Monster Book. */
  addTitleButton(label: string, fn: () => void) {
    this.titleExtra.appendChild(this.btn(label, '', fn));
    this.login?.addButton(label, fn);
  }

  /** which title screen is up: 'login' / 'select' (classic), 'title' (plain), or '' when none */
  titleState(): string {
    if (this.login?.visible) return this.login.state === 'select' ? 'select' : 'login';
    return this.title.classList.contains('hidden') ? '' : 'title';
  }

  setMuted(m: boolean) {
    this.login?.setMuted(m);
    this.muted = m;
    this.muteEl.textContent = m ? 'Unmute' : 'Mute';
  }

  showTitle(save: SaveData) {
    this.bestEl.textContent = save.bestTime > 0 ? fmtTime(save.bestTime) : '-';
    this.mesoEl.textContent = String(save.mesos);
    const ch = save.character;
    this.quickBtn.classList.toggle('hidden', !ch);
    if (ch) this.quickBtn.textContent = `Quick start: ${ch.name} the ${ch.cls[0].toUpperCase()}${ch.cls.slice(1)}`;
    this.petEl.checked = save.settings.pet;
    this.volEl.value = String(save.settings.volume);
    this.sfxVolEl.value = String(save.settings.sfxVolume);
    this.setMuted(save.settings.muted);
    this.hideAll();
    if (this.login) this.login.show(save);
    else this.title.classList.remove('hidden');
  }

  /** The banked mesos changed (the shop): the menu shows the new total. */
  refresh(save: SaveData) {
    this.mesoEl.textContent = String(save.mesos);
    this.login?.refresh(save);
  }

  showPause(on: boolean) {
    this.pause.classList.toggle('hidden', !on);
  }

  hideAll() {
    for (const s of [this.title, this.pause, this.levelup, this.results]) s.classList.add('hidden');
    this.login?.hide();
    this.offerRef = null;
    this.offerSig = '';
  }

  /** Call every frame: shows/hides the card screen from sim state and rebuilds only when the offer changes. */
  syncLevelUp(sim: Sim) {
    const offer = sim.offer;
    if (!offer || sim.over) {
      if (this.offerRef) { this.levelup.classList.add('hidden'); this.offerRef = null; this.offerSig = ''; }
      return;
    }
    const sig = offer.map((c) => c.key).join(',') + '|' + sim.rerolls + sim.banishes + '|' + sim.level;
    if (offer === this.offerRef && sig === this.offerSig) return;
    this.offerRef = offer;
    this.offerSig = sig;
    this.levelup.classList.remove('hidden');
    const job = offer[0]?.kind === 'job';
    this.luHead.innerHTML = job ? `JOB ADVANCEMENT! Lv ${sim.level}` : theme.has('lv.0') ? `LEVEL UP! ${theme.lv(sim.level)}` : 'LEVEL UP!';
    this.cardsEl.textContent = '';
    offer.forEach((c, i) => {
      const card = el('div', 'card ' + c.kind);
      if (c.kind === 'job') {
        const sig = (c.sig ?? []).map((s) => `<div class="sig"><img src="${this.icons[s.key] ?? ''}" alt=""><div><b>${s.name}</b><span>${s.desc}</span></div></div>`).join('');
        card.innerHTML = `<div class="key">${i + 1}</div><h3>${c.name}</h3><p>${c.desc}</p>${sig}<div class="kind">Job advancement</div>`;
        card.addEventListener('click', () => this.h.pick(i));
        this.cardsEl.appendChild(card);
        return;
      }
      const hint = c.kind === 'skill' || c.kind === 'passive' ? evolutionHint(c.key) : null;
      const tag = c.isNew ? '<span class="tag new">NEW</span>' : c.kind === 'skill' || c.kind === 'passive' ? `<span class="tag">Lv ${c.from} &gt; ${c.to}</span>` : c.kind === 'mastery' ? `<span class="tag">x${c.from} &gt; x${c.to}</span>` : '';
      card.innerHTML = `<div class="key">${i + 1}</div><img src="${this.icons[c.icon ?? c.key] ?? ''}" alt=""><h3>${c.name}</h3>${tag}<p>${c.desc}</p>${hint ? `<p class="hint">${hint}</p>` : ''}`;
      const kind = el('div', 'kind', c.kind === 'skill' ? 'Skill' : c.kind === 'passive' ? 'Passive' : c.kind === 'mastery' ? 'Mastery' : 'Bonus');
      card.appendChild(kind);
      card.addEventListener('click', () => this.h.pick(i));
      if (c.kind === 'skill' || c.kind === 'passive') {
        const b = el('button', 'banish', `Banish (${sim.banishes})`);
        b.disabled = sim.banishes <= 0;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); this.h.banish(i); });
        card.appendChild(b);
      }
      this.cardsEl.appendChild(card);
    });
    this.rerollBtn.textContent = `Reroll (${sim.rerolls})`;
    this.rerollBtn.disabled = sim.rerolls <= 0 || job;
  }

  showResults(r: Results) {
    this.hideAll();
    this.results.innerHTML = '';
    const w = el('div', 'win small');
    w.appendChild(el('div', 'win-head ' + (r.won ? 'victory' : 'defeat'), r.won ? 'VICTORY!' : 'You Died'));
    const b = el('div', 'win-body');
    b.appendChild(el('p', 'tagline', r.won ? 'You survived the full 15 minutes!' : 'The monsters got you this time.'));
    b.appendChild(el('table', 'res', `
      <tr><td>Time survived</td><td>${fmtTime(r.time)}${r.best ? ' <em>NEW BEST</em>' : ''}</td></tr>
      <tr><td>Level</td><td>${r.level}</td></tr>
      <tr><td>Monsters slain</td><td>${r.kills}</td></tr>
      <tr><td>Bosses slain</td><td>${r.bosses} / ${BOSS_TOTAL}</td></tr>
      <tr><td>Elites slain</td><td>${r.elites}</td></tr>
      <tr><td>Mesos earned</td><td>${r.mesos}</td></tr>`));
    const row = el('div', 'btnrow');
    row.append(this.btn('Retry', 'primary', () => this.h.retry()), this.btn('Menu', '', () => this.h.menu()));
    b.append(row, this.btn('Henesys Shop', 'res-shop', () => this.h.shop()));
    w.appendChild(b);
    this.results.appendChild(w);
    this.results.classList.remove('hidden');
  }
}
