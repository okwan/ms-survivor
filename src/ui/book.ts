/**
 * The Monster Book panel (title screen): a grid of every wanted mob with its stand frame, name and kill count. Uncollected cards are
 * dark silhouettes with "???"; 1-4 kills are grey, 5 are gold (complete). Each complete card gives +1% damage (cap +25%).
 * Mob art comes from the manifest's mob atlases as CSS backgrounds (no Pixi); without a manifest the cards show a plain blob.
 */
import { BOOK_BONUS_CAP, BOOK_COMPLETE, bookBonus, bookCounts, cardTier } from '../game/book.ts';
import type { BookData } from '../game/book.ts';
import { WANTED_MOBS } from '../maple/assets.ts';
import type { MapleManifest } from '../maple/assets.ts';

const CELL = 72;

export class BookPanel {
  private root: HTMLDivElement;
  private bonusEl: HTMLElement;
  private gridEl: HTMLElement;

  constructor(parent: HTMLElement, private mobs: MapleManifest['mobs'], private base = 'maple/') {
    this.root = document.createElement('div');
    this.root.className = 'screen book hidden';
    this.root.innerHTML = `<div class="win wide"><div class="win-head">Monster Book</div>
      <div class="win-body"><div class="book-bonus"></div><div class="book-grid"></div>
      <div class="hint">1 kill collects a card, ${BOOK_COMPLETE} kills complete it. Each complete card: +1% damage (max +${Math.round(BOOK_BONUS_CAP * 100)}%).</div>
      <button class="btn primary book-close">Close</button></div></div>`;
    this.bonusEl = this.root.querySelector('.book-bonus')!;
    this.gridEl = this.root.querySelector('.book-grid')!;
    this.root.querySelector('.book-close')!.addEventListener('click', () => this.hide());
    parent.appendChild(this.root);
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(book: BookData) {
    const { collected, complete } = bookCounts(book);
    this.bonusEl.textContent = `Book bonus +${Math.round(bookBonus(book) * 100)}% damage  (${complete} complete, ${collected} / ${WANTED_MOBS.length} collected)`;
    this.gridEl.textContent = '';
    for (const m of WANTED_MOBS) {
      const kills = book[String(m.id)] ?? 0;
      const tier = cardTier(kills);
      const card = document.createElement('div');
      card.className = `book-card ${tier}`;
      const art = document.createElement('div');
      art.className = 'book-art';
      const e = this.mobs[String(m.id)];
      const f = e?.frames.find((x) => x.action === 'stand' && x.index === 0) ?? e?.frames.find((x) => x.action === 'move');
      if (e && f) {
        const k = Math.min(1, (CELL - 8) / Math.max(f.w, f.h));
        const sprite = document.createElement('div');
        sprite.className = 'book-sprite';
        sprite.style.cssText = `width:${f.w}px;height:${f.h}px;background:url("${this.base + e.atlas}") -${f.x}px -${f.y}px;transform:translate(-50%,-50%) scale(${k.toFixed(3)})`;
        art.appendChild(sprite);
      } else {
        const blob = document.createElement('div');
        blob.className = 'book-blob';
        art.appendChild(blob);
      }
      const name = document.createElement('b');
      name.textContent = tier === 'none' ? '???' : e?.name ?? m.name;
      const count = document.createElement('span');
      count.textContent = tier === 'none' ? '' : tier === 'gold' ? `${kills} kills` : `${kills} / ${BOOK_COMPLETE}`;
      card.append(art, name, count);
      this.gridEl.appendChild(card);
    }
    this.root.classList.remove('hidden');
  }
}
