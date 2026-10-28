import type { Sim } from '../game/sim.ts';
import type { Card } from '../game/types.ts';
import { fmtTime } from './hud.ts';
import type { SaveData } from './save.ts';

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
  mute(m: boolean): void;
}

export interface Results {
  won: boolean;
  time: number;
  level: number;
  kills: number;
  mesos: number;
  bosses: number;
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
  private offerRef: Card[] | null = null;
  private offerSig = '';
  private h: ScreenHandlers;
  private icons: Record<string, string>;
  private quickBtn!: HTMLButtonElement;
  private bestEl!: HTMLElement;
  private mesoEl!: HTMLElement;
  private volEl!: HTMLInputElement;
  private muteEl!: HTMLButtonElement;
  private muted = false;

  constructor(parent: HTMLElement, h: ScreenHandlers, icons: Record<string, string>) {
    this.h = h;
    this.icons = icons;
    this.title = this.buildTitle();
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
    this.quickBtn = this.btn('Quick start', 'quick-start', () => this.h.quick());
    this.quickBtn.classList.add('hidden');
    body.appendChild(this.quickBtn);
    body.appendChild(this.btn('START', 'primary big', () => this.h.start()));
    const vol = el('label', 'volume', 'Volume ');
    this.volEl = el('input', '');
    this.volEl.type = 'range'; this.volEl.min = '0'; this.volEl.max = '1'; this.volEl.step = '0.05';
    this.volEl.addEventListener('input', () => this.h.volume(parseFloat(this.volEl.value)));
    vol.appendChild(this.volEl);
    this.muteEl = this.btn('Mute', 'mute', () => this.h.mute(!this.muted));
    vol.appendChild(this.muteEl);
    body.appendChild(vol);
    body.appendChild(el('p', 'hint', 'Move: WASD / arrow keys, or drag on the left half of a touch screen.<br>Skills fire automatically. Pause: Esc or P.'));
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
    w.appendChild(el('div', 'win-head', 'LEVEL UP!'));
    const body = el('div', 'win-body');
    this.cardsEl = el('div', 'cards');
    body.appendChild(this.cardsEl);
    const row = el('div', 'lu-row');
    this.rerollBtn = this.btn('Reroll', '', () => this.h.reroll());
    row.appendChild(this.rerollBtn);
    row.appendChild(el('span', 'hint', 'Keys 1-3 to choose. Banish removes a card from this run.'));
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

  setMuted(m: boolean) {
    this.muted = m;
    this.muteEl.textContent = m ? 'Unmute' : 'Mute';
  }

  showTitle(save: SaveData) {
    this.bestEl.textContent = save.bestTime > 0 ? fmtTime(save.bestTime) : '-';
    this.mesoEl.textContent = String(save.mesos);
    const ch = save.character;
    this.quickBtn.classList.toggle('hidden', !ch);
    if (ch) this.quickBtn.textContent = `Quick start: ${ch.name} the ${ch.cls[0].toUpperCase()}${ch.cls.slice(1)}`;
    this.volEl.value = String(save.settings.volume);
    this.setMuted(save.settings.muted);
    this.hideAll();
    this.title.classList.remove('hidden');
  }

  showPause(on: boolean) {
    this.pause.classList.toggle('hidden', !on);
  }

  hideAll() {
    for (const s of [this.title, this.pause, this.levelup, this.results]) s.classList.add('hidden');
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
    this.cardsEl.textContent = '';
    offer.forEach((c, i) => {
      const card = el('div', 'card ' + c.kind);
      const tag = c.isNew ? '<span class="tag new">NEW</span>' : c.kind === 'skill' || c.kind === 'passive' ? `<span class="tag">Lv ${c.from} &gt; ${c.to}</span>` : '';
      card.innerHTML = `<div class="key">${i + 1}</div><img src="${this.icons[c.key] ?? ''}" alt=""><h3>${c.name}</h3>${tag}<p>${c.desc}</p>`;
      const kind = el('div', 'kind', c.kind === 'skill' ? 'Skill' : c.kind === 'passive' ? 'Passive' : 'Bonus');
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
    this.rerollBtn.disabled = sim.rerolls <= 0;
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
      <tr><td>Bosses slain</td><td>${r.bosses} / 6</td></tr>
      <tr><td>Mesos earned</td><td>${r.mesos}</td></tr>`));
    const row = el('div', 'btnrow');
    row.append(this.btn('Retry', 'primary', () => this.h.retry()), this.btn('Menu', '', () => this.h.menu()));
    b.appendChild(row);
    w.appendChild(b);
    this.results.appendChild(w);
    this.results.classList.remove('hidden');
  }
}
