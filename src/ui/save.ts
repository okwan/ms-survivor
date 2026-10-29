import { CLASS_BY_KEY, DIFFICULTIES, clampDifficulty } from '../game/data.ts';
import { sanitizeBook } from '../game/book.ts';
import { sanitizeRunSave } from '../game/runsave.ts';
import type { RunSave } from '../game/runsave.ts';
import { emptyMeta, sanitizeMeta } from '../game/meta.ts';
import type { MetaRanks } from '../game/meta.ts';
import { emptyHyper, sanitizeHyper } from '../game/hyper.ts';
import type { HyperData } from '../game/hyper.ts';
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
  settings: { volume: number; sfxVolume: number; muted: boolean; autoEquip: boolean; pet: boolean; /** damage meter shown (unset: on for desktop, off on touch) */ meter?: boolean; /** skill effects around the hero: all of them, or fewer and fainter (unset: full) */ effects?: 'full' | 'reduced'; /** selected difficulty tier (<= cleared + 1) */ difficulty: number };
  /** highest difficulty tier won (-1: none yet); tier n + 1 is unlocked */
  cleared: number;
  character: SavedCharacter | null;
  /** Monster Book: kills per mob id, kept across runs (src/game/book.ts) */
  book: BookData;
  /** Henesys shop: ranks bought per upgrade (src/game/meta.ts) */
  meta: MetaRanks;
  /** Hyper Skills: lifetime levels and ranks per class (src/game/hyper.ts) */
  hyper: HyperData;
}
const KEY = 'maple-survivor-save-v1';
const DEFAULT: SaveData = { mesos: 0, bestTime: 0, settings: { volume: 0.7, sfxVolume: 0.8, muted: false, autoEquip: true, pet: true, difficulty: 0 }, cleared: -1, character: null, book: {}, meta: emptyMeta(), hyper: emptyHyper() };

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
    if (!raw) return { ...DEFAULT, settings: { ...DEFAULT.settings }, book: {}, meta: emptyMeta(), hyper: emptyHyper() };
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
        ...(o.settings?.effects === 'reduced' ? { effects: 'reduced' as const } : {}),
        ...(typeof o.settings?.meter === 'boolean' ? { meter: o.settings.meter } : {}),
      },
      character: readCharacter(o.character),
      book: sanitizeBook(o.book),
      meta: sanitizeMeta(o.meta),
      hyper: sanitizeHyper(o.hyper),
    };
  } catch {
    return { ...DEFAULT, settings: { ...DEFAULT.settings }, book: {}, meta: emptyMeta(), hyper: emptyHyper() };
  }
}

export function writeSave(s: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress simply is not kept */
  }
}

/** A run in progress (src/game/runsave.ts) with the hero that plays it, so it resumes with the right look even after a new character was made. */
export interface StoredRun {
  run: RunSave;
  hero: SavedCharacter;
}
const RUN_KEY = 'maple-survivor-run-v1';

/** The saved run, or null when there is none or it is not valid. */
export function loadRun(): StoredRun | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { run?: unknown; hero?: unknown };
    const run = sanitizeRunSave(o.run);
    if (!run) return null;
    const hero = readCharacter({ ...(o.hero as object), cls: run.cls });
    return hero ? { run, hero } : null;
  } catch {
    return null;
  }
}

export function writeRun(r: StoredRun) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable: the run just cannot be resumed */
  }
}

export function clearRun() {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    /* nothing to clear */
  }
}
