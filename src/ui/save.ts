import { CLASS_BY_KEY } from '../game/data.ts';
import { sanitizeLook } from '../maple/avatar-core.ts';
import type { Look } from '../maple/avatar-core.ts';

/** The last character the player created: offered as "Quick start" on the title screen. */
export interface SavedCharacter {
  cls: string;
  look: Look;
  name: string;
}
export interface SaveData {
  mesos: number;
  bestTime: number;
  settings: { volume: number; sfxVolume: number; muted: boolean };
  character: SavedCharacter | null;
}
const KEY = 'maple-survivor-save-v1';
const DEFAULT: SaveData = { mesos: 0, bestTime: 0, settings: { volume: 0.7, sfxVolume: 0.8, muted: false }, character: null };

function readCharacter(c: unknown): SavedCharacter | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Partial<SavedCharacter>;
  const def = typeof o.cls === 'string' ? CLASS_BY_KEY[o.cls] : undefined;
  if (!def) return null;
  const name = typeof o.name === 'string' ? o.name.replace(/[<>&"]/g, '').slice(0, 12).trim() : '';
  return { cls: def.key, look: sanitizeLook(o.look, def.weapon), name: name || 'Maple' };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, settings: { ...DEFAULT.settings } };
    const o = JSON.parse(raw) as Partial<SaveData>;
    return {
      mesos: typeof o.mesos === 'number' ? o.mesos : 0,
      bestTime: typeof o.bestTime === 'number' ? o.bestTime : 0,
      settings: {
        volume: typeof o.settings?.volume === 'number' ? o.settings.volume : DEFAULT.settings.volume,
        sfxVolume: typeof o.settings?.sfxVolume === 'number' ? Math.max(0, Math.min(1, o.settings.sfxVolume)) : DEFAULT.settings.sfxVolume,
        muted: o.settings?.muted === true,
      },
      character: readCharacter(o.character),
    };
  } catch {
    return { ...DEFAULT, settings: { ...DEFAULT.settings } };
  }
}

export function writeSave(s: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress simply is not kept */
  }
}
