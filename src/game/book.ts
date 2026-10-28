/**
 * Monster Book: persistent kill counts per mob id (saved by src/ui/save.ts). A card is collected at 1 kill and complete at 5;
 * every complete card gives +1% damage for good, at most +25%. Pure (no DOM).
 */
export type BookData = Record<string, number>;

export const BOOK_COLLECTED = 1;
export const BOOK_COMPLETE = 5;
export const BOOK_BONUS_PER_CARD = 0.01;
export const BOOK_BONUS_CAP = 0.25;
/** counts above this are not kept (keeps the save small and sane) */
export const BOOK_MAX_KILLS = 99999;

export type CardTier = 'none' | 'grey' | 'gold';
export const cardTier = (kills: number): CardTier => (kills >= BOOK_COMPLETE ? 'gold' : kills >= BOOK_COLLECTED ? 'grey' : 'none');

export function bookCounts(book: BookData | null | undefined): { collected: number; complete: number } {
  let collected = 0, complete = 0;
  for (const v of Object.values(book ?? {})) {
    if (typeof v !== 'number') continue;
    if (v >= BOOK_COLLECTED) collected++;
    if (v >= BOOK_COMPLETE) complete++;
  }
  return { collected, complete };
}

/** Damage bonus as a fraction (0.07 = +7%). */
export function bookBonus(book: BookData | null | undefined): number {
  return Math.min(BOOK_BONUS_CAP, bookCounts(book).complete * BOOK_BONUS_PER_CARD);
}

/** A clean copy of untrusted data: numeric mob ids with positive integer counts. */
export function sanitizeBook(raw: unknown): BookData {
  const out: BookData = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{1,9}$/.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 1) continue;
    out[k] = Math.min(BOOK_MAX_KILLS, Math.floor(v));
  }
  return out;
}

/** Larger count per mob wins (merging a run's counts back into the save). */
export function mergeBook(a: BookData, b: BookData): BookData {
  const out: BookData = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return sanitizeBook(out);
}
