/**
 * Literal WZ paths the game wants once the deploy-time asset step exists (milestone 3).
 * Mob ids are v83 Mob.wz image names and are unverified until the asset step reads String.wz.
 * This module has no dependency on the simulation and no side effects.
 */
import { BOSSES, LADDER, PASSIVES, SKILLS } from '../game/data.ts';

const pad7 = (n: number) => String(n).padStart(7, '0');

/** 'Mob/0100100.img' for every ladder mob, then every boss. */
export const MOB_IMAGES: string[] = [...LADDER.map((m) => `Mob/${pad7(m.id)}.img`), ...BOSSES.map((b) => `Mob/${pad7(b.id)}.img`)];

/** Job images in Skill.wz that hold each skill's icon and effect nodes ('Skill/200.img' = Magician (1st job)). */
export const SKILL_IMAGES: Record<string, string> = Object.fromEntries(
  SKILLS.map((s) => [s.key, `Skill/${Math.floor(s.id / 10000)}.img`]),
);
/** Distinct Skill.wz job images needed by skills and passives. */
export const SKILL_JOB_IMAGES: string[] = Array.from(
  new Set([...SKILLS.map((s) => Math.floor(s.id / 10000)), ...PASSIVES.filter((p) => p.id >= 1000000).map((p) => Math.floor(p.id / 10000))]),
)
  .sort((a, b) => a - b)
  .map((j) => `Skill/${j}.img`);

/** Skill ids (for icon/effect nodes inside the job images above). */
export const SKILL_IDS: number[] = [...SKILLS.map((s) => s.id), ...PASSIVES.map((p) => p.id)];

export const UI_IMAGES: string[] = ['UI/StatusBar.img', 'UI/UIWindow.img', 'UI/Login.img'];
export const BGM_IMAGES: string[] = ['Sound/BgmUI.img', 'Sound/Bgm00.img'];
export const MAP_IMAGES: string[] = ['Map/Back/grassySoil.img', 'Map/Tile/grassySoil.img'];

export interface MapleManifest {
  version: number;
  [key: string]: unknown;
}

/** Fetches maple/manifest.json. Returns null on any failure so the game falls back to placeholder art. */
export async function loadManifest(): Promise<MapleManifest | null> {
  try {
    const res = await fetch('maple/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== 'object' || typeof (data as MapleManifest).version !== 'number') return null;
    return data as MapleManifest;
  } catch {
    return null;
  }
}
