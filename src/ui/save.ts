export interface SaveData {
  mesos: number;
  bestTime: number;
  settings: { volume: number };
}
const KEY = 'maple-survivor-save-v1';
const DEFAULT: SaveData = { mesos: 0, bestTime: 0, settings: { volume: 0.7 } };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, settings: { ...DEFAULT.settings } };
    const o = JSON.parse(raw) as Partial<SaveData>;
    return {
      mesos: typeof o.mesos === 'number' ? o.mesos : 0,
      bestTime: typeof o.bestTime === 'number' ? o.bestTime : 0,
      settings: { volume: typeof o.settings?.volume === 'number' ? o.settings.volume : DEFAULT.settings.volume },
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
