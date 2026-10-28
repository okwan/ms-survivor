/**
 * MapleStory-style "New Character" window: step 1 picks a class (four cards), step 2 customises the look with left/right
 * pickers, a dice randomiser, a name box and a live animated preview of the composited character; "Start" begins the run.
 *
 * Markup is deliberately plain with clear class names (create-*, class-card, pick-row, arrow...) so a later skin can restyle it.
 * Works without avatar data: the preview then says so and the look is still saved (the game keeps its placeholder hero).
 */
import './create.css';
import { CLASSES, CLASS_BY_KEY, DEFAULT_CLASS } from '../game/data.ts';
import type { ClassDef, ClassKey } from '../game/data.ts';
import { frameIndexAt } from '../maple/avatar.ts';
import type { Avatar } from '../maple/avatar.ts';
import { LOOK_OPTIONS, defaultLook, randomLook, sanitizeLook } from '../maple/avatar-core.ts';
import type { Look } from '../maple/avatar-core.ts';

export interface CreateResult {
  cls: ClassKey;
  look: Look;
  name: string;
}
export interface CreateOptions {
  avatar: Avatar | null;
  /** start-skill icons by skill key */
  icons: Record<string, string>;
  onStart(r: CreateResult): void;
  onBack(): void;
}

/** the name as the game stores it */
export const sanitizeName = (n: string) => n.replace(/[<>&"]/g, '').trim().slice(0, 12);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export interface Row {
  key: string;
  label: string;
  /** number of choices at the current look */
  count(l: Look): number;
  get(l: Look): number;
  set(l: Look, i: number): void;
  text(l: Look): string;
  swatch?(l: Look): string;
}

const opt = LOOK_OPTIONS;
export const ROWS: Row[] = [
  {
    key: 'gender', label: 'Gender', count: () => 2, get: (l) => l.gender, text: (l) => (l.gender ? 'Female' : 'Male'),
    set(l, i) {
      // switching gender swaps to that gender's first face, hair, top and bottom
      const g = i as 0 | 1;
      l.gender = g; l.face = opt.faces[g][0]; l.hair = opt.hairs[g][0]; l.top = opt.tops[g][0]; l.bottom = opt.bottoms[g][0];
    },
  },
  { key: 'skin', label: 'Skin', count: () => opt.skins, get: (l) => l.skin, set: (l, i) => (l.skin = i), text: (l) => opt.skinNames[l.skin] },
  { key: 'face', label: 'Face', count: (l) => opt.faces[l.gender].length, get: (l) => opt.faces[l.gender].indexOf(l.face), set: (l, i) => (l.face = opt.faces[l.gender][i]), text: (l) => `Face ${opt.faces[l.gender].indexOf(l.face) + 1}` },
  { key: 'hair', label: 'Hair', count: (l) => opt.hairs[l.gender].length, get: (l) => opt.hairs[l.gender].indexOf(l.hair), set: (l, i) => (l.hair = opt.hairs[l.gender][i]), text: (l) => `Style ${opt.hairs[l.gender].indexOf(l.hair) + 1}` },
  { key: 'hairColor', label: 'Hair colour', count: () => 8, get: (l) => l.hairColor, set: (l, i) => (l.hairColor = i), text: (l) => opt.hairColors[l.hairColor], swatch: (l) => opt.hairSwatch[l.hairColor] },
  { key: 'top', label: 'Top', count: (l) => opt.tops[l.gender].length, get: (l) => opt.tops[l.gender].indexOf(l.top), set: (l, i) => (l.top = opt.tops[l.gender][i]), text: (l) => `Top ${opt.tops[l.gender].indexOf(l.top) + 1}` },
  { key: 'bottom', label: 'Bottom', count: (l) => opt.bottoms[l.gender].length, get: (l) => opt.bottoms[l.gender].indexOf(l.bottom), set: (l, i) => (l.bottom = opt.bottoms[l.gender][i]), text: (l) => `Bottom ${opt.bottoms[l.gender].indexOf(l.bottom) + 1}` },
  { key: 'shoes', label: 'Shoes', count: () => opt.shoes.length, get: (l) => opt.shoes.indexOf(l.shoes), set: (l, i) => (l.shoes = opt.shoes[i]), text: (l) => `Shoes ${opt.shoes.indexOf(l.shoes) + 1}` },
];


export class CreateScreen {
  readonly root: HTMLDivElement;
  private o: CreateOptions;
  private step: 1 | 2 = 1;
  private cls: ClassKey = DEFAULT_CLASS;
  private look: Look;
  private name = 'Maple';
  private cardsEl: HTMLDivElement;
  private stepOne: HTMLDivElement;
  private stepTwo: HTMLDivElement;
  private headEl: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private statusEl: HTMLDivElement;
  private nameEl: HTMLInputElement;
  private valueEls = new Map<string, { value: HTMLElement; swatch: HTMLElement | null }>();
  private cardCanvases = new Map<ClassKey, HTMLCanvasElement>();
  private raf = 0;
  private last = 0;
  private clock = 0;
  private shown = false;
  /** for tests: number of preview frames drawn */
  drawn = 0;

  constructor(parent: HTMLElement, o: CreateOptions) {
    this.o = o;
    this.look = defaultLook(CLASS_BY_KEY[this.cls].weapon);
    const root = (this.root = el('div', 'screen create hidden'));
    const win = el('div', 'win create-win');
    this.headEl = el('div', 'win-head create-head');
    const body = el('div', 'win-body create-body');

    // step 1: class
    this.stepOne = el('div', 'create-step create-step-class');
    this.stepOne.appendChild(el('p', 'create-lead', 'Choose your class'));
    this.cardsEl = el('div', 'create-classes');
    for (const c of CLASSES) this.cardsEl.appendChild(this.buildCard(c));
    this.stepOne.appendChild(this.cardsEl);
    const row1 = el('div', 'create-buttons');
    row1.append(this.btn('Back', 'create-back', () => this.o.onBack()), this.btn('Next', 'primary create-next', () => this.goStep(2)));
    this.stepOne.appendChild(row1);

    // step 2: customise
    this.stepTwo = el('div', 'create-step create-step-look hidden');
    const layout = el('div', 'create-layout');
    const left = el('div', 'create-preview');
    this.canvas = el('canvas', 'create-canvas');
    this.canvas.width = 200;
    this.canvas.height = 230;
    this.statusEl = el('div', 'create-status', '');
    const dice = this.btn('⚄ Random', 'create-dice', () => this.randomise());
    dice.title = 'Randomise the look';
    this.nameEl = el('input', 'create-name');
    this.nameEl.type = 'text';
    this.nameEl.maxLength = 12;
    this.nameEl.placeholder = 'Name';
    this.nameEl.value = this.name;
    this.nameEl.autocomplete = 'off';
    this.nameEl.spellcheck = false;
    this.nameEl.addEventListener('input', () => (this.name = this.nameEl.value));
    left.append(this.canvas, this.statusEl, el('label', 'create-namelabel', 'Name'), this.nameEl, dice);
    const right = el('div', 'create-pickers');
    for (const r of ROWS) right.appendChild(this.buildRow(r));
    layout.append(left, right);
    const row2 = el('div', 'create-buttons');
    row2.append(this.btn('Back', 'create-back', () => this.goStep(1)), this.btn('Start', 'primary create-start', () => this.start()));
    this.stepTwo.append(layout, row2);

    body.append(this.stepOne, this.stepTwo);
    win.append(this.headEl, body);
    root.appendChild(win);
    parent.appendChild(root);
    window.addEventListener('keydown', (e) => {
      if (!this.shown) return;
      if (e.key === 'Escape') { if (this.step === 2) this.goStep(1); else this.o.onBack(); }
      else if (e.key === 'Enter' && this.step === 2 && document.activeElement?.tagName !== 'BUTTON') this.start();
    });
  }

  private btn(text: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el('button', 'btn ' + cls, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }

  private buildCard(c: ClassDef): HTMLElement {
    const card = el('button', 'class-card');
    card.type = 'button';
    card.dataset.cls = c.key;
    const cv = el('canvas', 'class-art');
    cv.width = 90;
    cv.height = 110;
    this.cardCanvases.set(c.key, cv);
    const icon = el('img', 'class-skill');
    icon.alt = '';
    icon.dataset.skill = c.skills[0];
    card.append(
      cv,
      el('h3', 'class-name', c.name),
      el('p', 'class-blurb', c.blurb),
      el('div', 'class-weapon', `${c.weaponName}`),
      el('div', 'class-stats', `HP ${c.hp} &middot; Speed ${c.speed} &middot; Crit ${Math.round(c.crit * 100)}%`),
    );
    const sk = el('div', 'class-start');
    sk.append(icon, el('span', '', 'Start skill'));
    card.appendChild(sk);
    card.addEventListener('click', () => this.pickClass(c.key));
    return card;
  }

  private buildRow(r: Row): HTMLElement {
    const row = el('div', 'pick-row');
    row.dataset.row = r.key;
    const prev = this.btn('◀', 'arrow arrow-left', () => this.cycle(r, -1));
    const next = this.btn('▶', 'arrow arrow-right', () => this.cycle(r, 1));
    prev.setAttribute('aria-label', `Previous ${r.label}`);
    next.setAttribute('aria-label', `Next ${r.label}`);
    const val = el('div', 'pick-value');
    const swatch = r.swatch ? el('i', 'pick-swatch') : null;
    const text = el('span', 'pick-text');
    if (swatch) val.appendChild(swatch);
    val.appendChild(text);
    row.append(el('label', 'pick-label', r.label), prev, val, next);
    this.valueEls.set(r.key, { value: text, swatch });
    return row;
  }

  // ---- state ----------------------------------------------------------------------------------------------------
  private cycle(r: Row, dir: number) {
    const n = r.count(this.look);
    const i = (r.get(this.look) + dir + n) % n;
    r.set(this.look, i);
    this.changed();
  }

  private pickClass(c: ClassKey) {
    this.cls = c;
    this.look.weapon = CLASS_BY_KEY[c].weapon;
    this.refreshCards();
    this.changed();
    this.goStep(2);
  }

  private randomise() {
    const l = randomLook(Math.random, CLASS_BY_KEY[this.cls].weapon);
    this.look = l;
    this.changed();
  }

  private changed() {
    this.look = sanitizeLook(this.look, CLASS_BY_KEY[this.cls].weapon);
    this.refreshRows();
    this.o.avatar?.prefetch(this.look);
    this.clock = 0;
  }

  private refreshRows() {
    for (const r of ROWS) {
      const v = this.valueEls.get(r.key)!;
      v.value.textContent = r.text(this.look);
      if (v.swatch && r.swatch) v.swatch.style.background = r.swatch(this.look);
    }
  }

  private refreshCards() {
    for (const card of this.cardsEl.children) card.classList.toggle('selected', (card as HTMLElement).dataset.cls === this.cls);
  }

  private goStep(s: 1 | 2) {
    this.step = s;
    this.stepOne.classList.toggle('hidden', s !== 1);
    this.stepTwo.classList.toggle('hidden', s !== 2);
    const c = CLASS_BY_KEY[this.cls];
    this.headEl.textContent = s === 1 ? 'New Character — Choose a Class' : `New Character — ${c.name}`;
    this.root.dataset.step = String(s);
    if (s === 2) {
      this.refreshRows();
      this.o.avatar?.prefetch(this.look);
    }
  }

  private start() {
    const name = sanitizeName(this.name) || 'Maple';
    this.o.onStart({ cls: this.cls, look: { ...sanitizeLook(this.look, CLASS_BY_KEY[this.cls].weapon) }, name });
  }

  // ---- show / hide --------------------------------------------------------------------------------------------------
  show(initial?: { cls: string; look: Look; name: string } | null) {
    if (initial && CLASS_BY_KEY[initial.cls]) {
      this.cls = initial.cls as ClassKey;
      this.look = sanitizeLook(initial.look, CLASS_BY_KEY[this.cls].weapon);
      this.name = initial.name;
      this.nameEl.value = this.name;
    }
    this.refreshCards();
    this.refreshRows();
    // skill icons are looked up now because real art may have replaced the placeholders after construction
    for (const img of this.cardsEl.querySelectorAll<HTMLImageElement>('img.class-skill')) img.src = this.o.icons[img.dataset.skill!] ?? '';
    this.goStep(1);
    this.root.classList.remove('hidden');
    this.shown = true;
    this.loadCards();
    this.last = performance.now();
    this.clock = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  hide() {
    this.shown = false;
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
  }

  get visible() {
    return this.shown;
  }

  /** Draws each class card's character (default look, its own weapon) once its parts have loaded. */
  private loadCards() {
    const av = this.o.avatar;
    if (!av) return;
    for (const c of CLASSES) {
      const look = { ...defaultLook(c.weapon), skin: 0 };
      void av.ensureLook(look).then((ok) => {
        const cv = this.cardCanvases.get(c.key);
        if (!ok || !cv) return;
        const a = av.stance(look, c.stance);
        const f = av.frame(look, a.stand, 0);
        if (!f) return;
        const ctx = cv.getContext('2d')!;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.imageSmoothingEnabled = false;
        const s = 2;
        ctx.drawImage(f.canvas, Math.round(cv.width / 2 - f.ax * s + 8), Math.round(cv.height - 10 - f.ay * s), f.canvas.width * s, f.canvas.height * s);
      });
    }
  }

  // ---- live preview ---------------------------------------------------------------------------------------------------
  private tick(now: number) {
    if (!this.shown) return;
    this.raf = requestAnimationFrame((t) => this.tick(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.step !== 2) return;
    this.clock += dt;
    this.drawPreview();
  }

  private drawPreview() {
    const cv = this.canvas;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingEnabled = false;
    // ground ellipse
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath();
    ctx.ellipse(cv.width / 2, cv.height - 22, 34, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    const av = this.o.avatar;
    if (!av) {
      this.statusEl.textContent = 'Preview needs the Maple art (not in this build).';
      return;
    }
    if (!av.ready(this.look)) {
      this.statusEl.textContent = 'Loading...';
      void av.ensureLook(this.look);
      return;
    }
    const cls = CLASS_BY_KEY[this.cls];
    const acts = av.stance(this.look, cls.stance);
    // cycle: walk 3 s, stand 1.6 s, attack once
    const cyc = this.clock % 5.2;
    let action = acts.walk;
    let t = cyc;
    let loop = true;
    if (cyc >= 3 && cyc < 4.6) { action = acts.stand; t = cyc - 3; }
    else if (cyc >= 4.6) { action = acts.attack[0]; t = cyc - 4.6; loop = false; }
    const delays = av.timing(this.look, action) ?? [100];
    const idx = frameIndexAt(delays, t, loop);
    const f = av.frame(this.look, action, idx);
    if (!f) {
      this.statusEl.textContent = '';
      return;
    }
    this.statusEl.textContent = '';
    const s = Math.max(2, Math.min(5, Math.floor(170 / Math.max(1, f.ay + 4))));
    // the character faces left; a walking character drifts in place, so just show it facing left
    ctx.drawImage(f.canvas, Math.round(cv.width / 2 - f.ax * s + 14), Math.round(cv.height - 22 - f.ay * s), f.canvas.width * s, f.canvas.height * s);
    this.drawn++;
  }

  /** current selection (for tests) */
  get selection(): CreateResult {
    return { cls: this.cls, look: { ...this.look }, name: this.name };
  }
}
