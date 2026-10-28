/**
 * The Hyper Skills window (title / character select / results): the permanent talent tree of a class (src/game/hyper.ts), in the style of the
 * Henesys shop window. A tab per class, the Hyper SP left, one column per job branch with a row per skill; a skill is a small cell with its icon
 * and two tiles (Reinforce and the kind-specific node) showing rank x/max. Tap a tile to add a rank; a locked tile says why (needs N points in the
 * tree / needs Reinforce / no SP left) on the status line. Reset refunds everything at once. Every change writes the save. The grid scrolls both
 * ways, so it works on a narrow landscape phone. Icons come from the same map as the level-up cards (skill key); a missing one is a plain tile.
 */
import { CLASSES, CLASS_BY_KEY, SKILL_BY_KEY } from '../game/data.ts';
import type { ClassKey } from '../game/data.ts';
import { HYPER_LEVELS_PER_SP, HYPER_ROW_POINTS, HYPER_SP_CAP, HYPER_TREES, hyperAdd, hyperAvailable, hyperEarned, hyperLock, hyperReset, hyperSpent } from '../game/hyper.ts';
import type { HyperNode } from '../game/hyper.ts';
import type { SaveData } from './save.ts';

export interface HyperHooks {
  /** the save the window reads and changes (hyper) */
  save(): SaveData;
  /** persists it */
  write(): void;
  /** the class of the current hero (the tab shown first) */
  cls(): ClassKey;
  /** a sound cue: 'add', 'reset' or 'deny' */
  sound(kind: 'add' | 'reset' | 'deny'): void;
}

export class HyperPanel {
  private root: HTMLDivElement;
  private tabsEl: HTMLElement;
  private spEl: HTMLElement;
  private gridEl: HTMLElement;
  private sayEl: HTMLElement;
  private resetBtn: HTMLButtonElement;
  private cls: ClassKey = 'magician';
  private tiles = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, private icons: Record<string, string>, private hooks: HyperHooks) {
    this.root = document.createElement('div');
    this.root.className = 'screen hyper hidden';
    this.root.innerHTML = `<div class="mwin mwin-hyper">
      <div class="mwin-title"><span>Hyper Skills</span><button class="mwin-x" title="Close"></button></div>
      <div class="hy-tabs"></div>
      <div class="hy-info"><span class="hy-sp"></span><button class="shop-btn hy-reset">Reset</button></div>
      <div class="hy-scroll"><div class="hy-grid"></div></div>
      <div class="hy-say"></div>
    </div>`;
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector<T>(s)!;
    this.tabsEl = q('.hy-tabs');
    this.spEl = q('.hy-sp');
    this.gridEl = q('.hy-grid');
    this.sayEl = q('.hy-say');
    this.resetBtn = q<HTMLButtonElement>('.hy-reset');
    for (const c of CLASSES) {
      const b = document.createElement('button');
      b.className = 'hy-tab';
      b.textContent = c.name;
      b.dataset.cls = c.key;
      b.addEventListener('click', () => this.open(c.key));
      this.tabsEl.appendChild(b);
    }
    q('.mwin-x').addEventListener('click', () => this.hide());
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.hide(); });
    this.resetBtn.addEventListener('click', () => this.reset());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.visible) this.hide(); });
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** the class whose tree is shown */
  get current(): ClassKey {
    return this.cls;
  }

  hide() {
    this.root.classList.add('hidden');
  }

  /** Opens the window on a class tab (default: the hero's class). */
  show(cls?: ClassKey) {
    this.open(cls ?? this.hooks.cls());
    this.root.classList.remove('hidden');
  }

  /** Builds the grid of one class: a row-label column, then one column per job branch with a cell per skill at its row. */
  private open(cls: ClassKey) {
    this.cls = HYPER_TREES[cls] ? cls : 'magician';
    const tree = HYPER_TREES[this.cls];
    this.say(`${CLASS_BY_KEY[this.cls].name}: earn 1 Hyper SP per ${HYPER_LEVELS_PER_SP} levels gained in runs. Tap a skill to rank it up.`);
    this.tabsEl.querySelectorAll<HTMLElement>('.hy-tab').forEach((t) => t.classList.toggle('on', t.dataset.cls === this.cls));
    this.gridEl.textContent = '';
    this.tiles.clear();
    this.gridEl.style.gridTemplateColumns = `34px repeat(${tree.columns.length}, minmax(142px, 1fr))`;
    const add = (cls: string, text: string, col: number, row: number) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      d.style.gridColumn = String(col);
      d.style.gridRow = String(row);
      this.gridEl.appendChild(d);
    };
    add('hy-corner', '', 1, 1);
    tree.columns.forEach((c, i) => add('hy-head', c.name, i + 2, 1));
    for (let r = 0; r < tree.rows; r++) add('hy-rowlabel', r === 0 ? '' : `${HYPER_ROW_POINTS * r}`, 1, r + 2);
    for (const c of tree.columns) {
      const bySkill = new Map<string, HyperNode[]>();
      for (const n of c.nodes) bySkill.set(n.skill, [...(bySkill.get(n.skill) ?? []), n]);
      for (const [skill, nodes] of bySkill) {
        const cell = document.createElement('div');
        cell.className = 'hy-cell';
        cell.style.gridColumn = String(nodes[0].col + 2);
        cell.style.gridRow = String(nodes[0].row + 2);
        const url = this.icons[skill] ?? '';
        cell.innerHTML = `<div class="hy-skill">${url ? `<img src="${url}" alt="">` : ''}<b>${SKILL_BY_KEY[skill].name}</b></div><div class="hy-tiles"></div>`;
        const tiles = cell.querySelector('.hy-tiles')!;
        for (const n of nodes) {
          const t = document.createElement('button');
          t.className = 'hy-tile';
          t.innerHTML = `<span class="hy-lbl">${n.label}</span><span class="hy-rk"></span>`;
          t.addEventListener('click', () => this.click(n));
          tiles.appendChild(t);
          this.tiles.set(n.key, t);
        }
        this.gridEl.appendChild(cell);
      }
    }
    this.render();
  }

  private say(text: string) {
    this.sayEl.textContent = text;
  }

  private click(n: HyperNode) {
    const s = this.hooks.save();
    const h = s.hyper[this.cls];
    const next = hyperAdd(this.cls, h, n.key);
    if (!next) {
      this.hooks.sound('deny');
      this.say(`${n.name}: ${hyperLock(this.cls, h, n.key)}`);
      return;
    }
    s.hyper[this.cls] = next;
    this.hooks.write();
    this.hooks.sound('add');
    const have = next.ranks[n.key];
    this.say(`${n.name} ${have}/${n.max}: ${n.text(have)}`);
    this.render();
  }

  private reset() {
    const s = this.hooks.save();
    const h = s.hyper[this.cls];
    const spent = hyperSpent(h.ranks);
    if (spent <= 0) { this.say('Nothing to reset.'); return; }
    s.hyper[this.cls] = hyperReset(h);
    this.hooks.write();
    this.hooks.sound('reset');
    this.say(`Reset: ${spent} Hyper SP refunded.`);
    this.render();
  }

  private render() {
    const h = this.hooks.save().hyper[this.cls];
    const tree = HYPER_TREES[this.cls];
    const earned = hyperEarned(h.levels);
    const left = hyperAvailable(h);
    const next = earned >= HYPER_SP_CAP ? 'maxed' : `${HYPER_LEVELS_PER_SP - (h.levels % HYPER_LEVELS_PER_SP)} levels to the next`;
    this.spEl.innerHTML = `Hyper SP <b>${left}</b> / ${earned} <i>(${next})</i>`;
    this.resetBtn.disabled = hyperSpent(h.ranks) <= 0;
    for (const n of tree.nodes) {
      const t = this.tiles.get(n.key);
      if (!t) continue;
      const have = h.ranks[n.key] ?? 0;
      const lock = hyperLock(this.cls, h, n.key);
      t.classList.toggle('on', have > 0);
      t.classList.toggle('maxed', have >= n.max);
      t.classList.toggle('locked', lock !== null && have < n.max);
      t.classList.toggle('ready', lock === null);
      t.title = lock && have < n.max ? `${n.name}\n${lock}` : `${n.name}\n${n.text(Math.max(1, have))}`;
      t.querySelector('.hy-rk')!.textContent = `${have}/${n.max}`;
    }
  }
}
