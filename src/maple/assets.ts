/**
 * Single source of truth for what the deploy-time asset step extracts (scripts/fetch-maple.ts imports this file)
 * and for the shape of the manifest it writes. Everything is derived from src/game/data.ts.
 * Mob ids are v83 Mob.wz image names; the asset step checks them against String.wz and logs MISMATCH/MISSING.
 * This module has no dependency on the DOM or Pixi and no side effects, so Node can import it.
 */
import { BOSSES, LADDER, PASSIVES, SKILLS } from '../game/data.ts';
import type { AtlasRef, EffectsSection, MapSection, UiSection } from './world-types.ts';

export const pad7 = (n: number) => String(n).padStart(7, '0');
export const pad3 = (n: number) => String(n).padStart(3, '0');

export interface WantedMob {
  id: number;
  /** name the game data expects, checked against String.wz */
  name: string;
  /** 'T00'..'T29' for the ladder, 'B1'..'B6' for bosses */
  tier: string;
}

/** Every ladder mob, then every boss, each id once. */
export const WANTED_MOBS: WantedMob[] = (() => {
  const seen = new Set<number>();
  const out: WantedMob[] = [];
  const add = (id: number, name: string, tier: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, tier });
  };
  LADDER.forEach((m, i) => add(m.id, m.name, 'T' + String(i).padStart(2, '0')));
  BOSSES.forEach((b, i) => add(b.id, b.name, 'B' + (i + 1)));
  return out;
})();

/** Mob animation nodes to extract (a flying mob's `fly` stands in for a missing `move`). */
export const MOB_ACTIONS = ['stand', 'move', 'hit1', 'die1', 'attack1'] as const;

export interface WantedSkill {
  id: number;
  key: string;
  name: string;
  passive: boolean;
  /** Skill.wz image holding the skill, e.g. '200.img' (id 2001005) or '000.img' (id 1001) */
  image: string;
  /** node name under <image>/skill, zero-padded to 7 digits */
  node: string;
}

export const WANTED_SKILLS: WantedSkill[] = [
  ...SKILLS.map((s) => ({ id: s.id, key: s.key, name: s.name, passive: false })),
  ...PASSIVES.map((p) => ({ id: p.id, key: p.key, name: p.name, passive: true })),
].map((s) => ({ ...s, image: pad3(Math.floor(s.id / 10000)) + '.img', node: pad7(s.id) }));

/** Skill animation nodes extracted into each skill's atlas (icon is written as its own PNG). */
export const SKILL_ANIMS = ['effect', 'ball', 'hit'] as const;

/** Background music: image and node inside Sound.wz. */
export const BGM_NODES = {
  run: { image: 'Bgm00.img', node: 'FloralLife' },
  title: { image: 'BgmUI.img', node: 'Title' },
};

/** The WZ archives needed (file stems). Later clients split them (Mob001.wz...), which the extractor also accepts. */
export const WZ_FILES = ['Mob', 'Skill', 'String', 'Sound', 'Map', 'Effect', 'UI'] as const;

// ---- legacy lists, kept for later milestones (UI, map art) -------------------------------------------------------
/** 'Mob/0100100.img' for every wanted mob. */
export const MOB_IMAGES: string[] = WANTED_MOBS.map((m) => `Mob/${pad7(m.id)}.img`);
export const SKILL_IMAGES: Record<string, string> = Object.fromEntries(WANTED_SKILLS.filter((s) => !s.passive).map((s) => [s.key, `Skill/${s.image}`]));
export const SKILL_JOB_IMAGES: string[] = Array.from(new Set(WANTED_SKILLS.map((s) => `Skill/${s.image}`)));
export const SKILL_IDS: number[] = WANTED_SKILLS.map((s) => s.id);
export const UI_IMAGES: string[] = ['UI/StatusBar.img', 'UI/UIWindow.img', 'UI/Login.img'];
export const BGM_IMAGES: string[] = ['Sound/BgmUI.img', 'Sound/Bgm00.img'];
export const MAP_IMAGES: string[] = ['Map/Back/grassySoil.img', 'Map/Tile/grassySoil.img'];

// ---- manifest ----------------------------------------------------------------------------------------------------
/** One animation frame inside an atlas. ox/oy is the origin (foot/pivot) measured from the frame's top-left. */
export interface FrameRec {
  action: string;
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** milliseconds */
  delay: number;
}

export interface MobEntry {
  name: string;
  /** PNG atlas path relative to maple/ */
  atlas: string;
  size: [number, number];
  frames: FrameRec[];
  /** maxHP, speed, level, bodyAttack... straight from info/, for reference */
  info: Record<string, number>;
}

export interface SkillEntry {
  /** atlas of effect/ball/hit frames, or null when the skill has none */
  atlas: string | null;
  size: [number, number] | null;
  /** standalone icon PNG (usable as <img src>), or null */
  icon: string | null;
  frames: FrameRec[];
}

export interface MapleManifest {
  version: number;
  source?: { mirror: string; region: string; wzVersion: number };
  /** keyed by mob id without leading zeros */
  mobs: Record<string, MobEntry>;
  /** keyed by skill id without leading zeros */
  skills: Record<string, SkillEntry>;
  bgm: { run: string | null; title: string | null };
  /** world/UI art from scripts/fetch-maple-world.ts, each absent when its .wz could not be read */
  map?: MapSection;
  damage?: AtlasRef;
  ui?: UiSection;
  effects?: EffectsSection;
}

/** Fetches maple/manifest.json. Returns null on any failure so the game falls back to placeholder art. */
export async function loadManifest(base = 'maple/'): Promise<MapleManifest | null> {
  try {
    const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<MapleManifest> | null;
    if (!data || typeof data !== 'object' || typeof data.version !== 'number') return null;
    return {
      version: data.version,
      source: data.source,
      mobs: data.mobs && typeof data.mobs === 'object' ? data.mobs : {},
      skills: data.skills && typeof data.skills === 'object' ? data.skills : {},
      bgm: { run: data.bgm?.run ?? null, title: data.bgm?.title ?? null },
      map: data.map,
      damage: data.damage,
      ui: data.ui,
      effects: data.effects,
    };
  } catch {
    return null;
  }
}
