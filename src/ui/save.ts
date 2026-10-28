import { CLASS_BY_KEY, DIFFICULTIES, clampDifficulty } from '../game/data.ts';
import { sanitizeBook } from '../game/book.ts';
import { emptyMeta, sanitizeMeta } from '../game/meta.ts';
import type { MetaRanks } from '../game/meta.ts';
import type { BookData } from '../game/book.ts';
import { sanitizeLook } from '../maple/avatar-core.ts';
import type { Look } from '../maple/avatar-core.ts';

/** The last character the player created: offered as "Quick start" on the title screen. */
export interface SavedCharacter {
  cls: string;
  look: Look;
  name: string;
  /** level reached in its last run (shown on the character select stage) */
  level?: number;
}
export interface SaveData {
  mesos: number;
  bestTime: number;
  settings: { volume: number; sfxVolume: number; muted: boolean; autoEquip: boolean; pet: boolean; /** selected difficulty tier (<= cleared + 1) */ difficulty: number };
  /** highest difficulty tier won (-1: none yet); tier n + 1 is unlocked */
  cleared: number;
  character: SavedCharacter | null;
  /** Monster Book: kills per mob id, kept across runs (src/game/book.ts) */
  book: BookData;
  /** Henesys shop: ranks bought per upgrade (src/game/meta.ts) */
  meta: MetaRanks;
}
const KEY = 'maple-survivor-save-v1';
const DEFAULT: SaveData = { mesos: 0, bestTime: 0, settings: { volume: 0.7, sfxVolume: 0.8, muted: false, autoEquip: true, pet: true, difficulty: 0 }, cleared: -1, character: null, book: {}, meta: emptyMeta() };

function readCharacter(c: unknown): SavedCharacter | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Partial<SavedCharacter>;
  const def = typeof o.cls === 'string' ? CLASS_BY_KEY[o.cls] : undefined;
  if (!def) return null;
  const name = typeof o.name === 'string' ? o.name.replace(/[<>&"]/g, '').slice(0, 12).trim() : '';
  const level = typeof o.level === 'number' && o.level >= 1 ? Math.min(999, Math.floor(o.level)) : undefined;
  return { cls: def.key, look: sanitizeLook(o.look, def.weapon), name: name || 'Maple', ...(level ? { level } : {}) };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, settings: { ...DEFAULT.settings }, book: {}, meta: emptyMeta() };
    const o = JSON.parse(raw) as Partial<SaveData>;
    const cleared = typeof o.cleared === 'number' && Number.isFinite(o.cleared) ? Math.max(-1, Math.min(DIFFICULTIES.length - 1, Math.floor(o.cleared))) : -1;
    return {
      cleared,
      mesos: typeof o.mesos === 'number' ? o.mesos : 0,
      bestTime: typeof o.bestTime === 'number' ? o.bestTime : 0,
      settings: {
        volume: typeof o.settings?.volume === 'number' ? o.settings.volume : DEFAULT.settings.volume,
        sfxVolume: typeof o.settings?.sfxVolume === 'number' ? Math.max(0, Math.min(1, o.settings.sfxVolume)) : DEFAULT.settings.sfxVolume,
        muted: o.settings?.muted === true,
        autoEquip: o.settings?.autoEquip !== false,
        pet: o.settings?.pet !== false,
        difficulty: Math.min(clampDifficulty(o.settings?.difficulty), cleared + 1),
      },
      character: readCharacter(o.character),
      book: sanitizeBook(o.book),
      meta: sanitizeMeta(o.meta),
    };
  } catch {
    return { ...DEFAULT, settings: { ...DEFAULT.settings }, book: {}, meta: emptyMeta() };
  }
}

export function writeSave(s: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress simply is not kept */
  }
}
