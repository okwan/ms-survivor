// Sound effects part of the deploy-time asset step (called from fetch-maple.ts): Sound.wz Mob.img / Skill.img / Game.img / UI.img /
// Weapon.img -> sfx/<key>.mp3|wav + a `sfx` map in the manifest. The expected layout is
//   Mob.img/<7-digit mob id>/{Damage,Die,Attack1}   Skill.img/<skill id>/{Use,Hit}   Game.img/{LevelUp,PickUpItem,DropItem,Portal}
//   UI.img/{BtMouseClick,BtMouseOver}               Weapon.img/<type>/Attack
// but nothing here is verified against the real files, so every miss logs the keys that do exist. Never throws.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WANTED_MOBS, WANTED_SKILLS, pad7 } from '../src/maple/assets.ts';
import { GAME_SOUNDS, MAX_SFX_BYTES, WEAPON_SOUND_TYPES } from '../src/maple/region-data.ts';
import type { SfxSection } from '../src/maple/region-types.ts';
import type { SetLike } from './fetch-maple-world.ts';
import { childOf, decodeSound } from './wz-audio.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export interface SfxDeps {
  dist: string;
  sound: SetLike | null;
  log: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  sniffAudio: (b: Buffer) => { ext: string; data: Buffer; what: string };
}

export interface SfxResult {
  manifest: { sfx?: SfxSection };
  bytes: number;
}

export function buildSfx(d: SfxDeps): SfxResult {
  const res: SfxResult = { manifest: {}, bytes: 0 };
  const sfx: SfxSection = {};
  let skippedBig = 0, formats = 0;
  const tags = new Map<string, number>();
  try {
    const sound = d.sound;
    if (!sound) {
      d.warn('Sound.wz is not available: no sound effects');
      return res;
    }
    const imgNames = sound.names();
    d.log(`sfx: Sound.wz has ${imgNames.length} images: ${imgNames.slice(0, 50).join(' ')}${imgNames.length > 50 ? ' ...' : ''}`);
    const image = (name: string) => {
      const im = sound.image(name);
      if (im) d.log(`sfx: ${name} has ${im.root.keys().length} keys: ${im.root.keys().slice(0, 14).join(' ')}${im.root.keys().length > 14 ? ' ...' : ''}`);
      else d.warn(`sfx: Sound.wz has no ${name} (images: ${imgNames.filter((n) => !/^bgm/i.test(n)).slice(0, 30).join(' ') || 'none'})`);
      return im;
    };

    const save = (key: string, node: Any, what: string): boolean => {
      if (!node || node.type !== 'sound') return false;
      const s = decodeSound(node, d.sniffAudio);
      if (!s) return false;
      if (s.data.length > MAX_SFX_BYTES) {
        skippedBig++;
        d.log(`sfx ${key}: ${what} is ${(s.data.length / 1024).toFixed(0)} KB, over the ${MAX_SFX_BYTES / 1024} KB limit: skipped`);
        return false;
      }
      const rel = `sfx/${key}.${s.ext}`;
      const path = join(d.dist, 'maple', rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, s.data);
      res.bytes += s.data.length;
      sfx[key] = rel;
      const tag = s.fmt ? `0x${s.fmt.tag.toString(16)}` : 'none';
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
      if (formats++ < 6) d.log(`sfx ${key}: ${what} -> ${rel}, ${s.what}, ${s.fmt ? `format tag ${tag}, ${s.fmt.channels} ch, ${s.fmt.rate} Hz` : 'no WAVEFORMATEX'}, ${s.data.length} bytes, ${node.value.ms} ms`);
      return true;
    };
    /** the node for an entity id: zero-padded to 7 digits, or plain */
    const entity = (root: Any, id: number) => root.get(pad7(id)) ?? root.get(String(id)) ?? null;

    // mobs
    const mobImg = image('Mob.img');
    if (mobImg) {
      let withSound = 0;
      const missing: string[] = [];
      for (const m of WANTED_MOBS) {
        const n = entity(mobImg.root, m.id);
        if (!n) { missing.push(`${m.id} ${m.name}`); continue; }
        const boss = m.tier.startsWith('B');
        const a = save(`mob.${m.id}.damage`, childOf(n, ['Damage']), `${m.name} Damage`);
        const b = save(`mob.${m.id}.die`, childOf(n, ['Die']), `${m.name} Die`);
        if (boss) save(`mob.${m.id}.attack`, childOf(n, ['Attack1', 'Attack']), `${m.name} Attack1`);
        if (a || b) withSound++;
        else d.log(`sfx mob ${m.id} ${m.name}: no Damage/Die sound; children ${n.keys().join(',') || '-'}`);
      }
      d.log(`sfx: mobs with sounds ${withSound}/${WANTED_MOBS.length}${missing.length ? `; no Mob.img node for ${missing.join(', ')}` : ''}`);
    }

    // skills
    const skillImg = image('Skill.img');
    if (skillImg) {
      let withSound = 0;
      const missing: string[] = [];
      for (const s of WANTED_SKILLS) {
        if (s.passive) continue;
        const n = entity(skillImg.root, s.id);
        if (!n) { missing.push(String(s.id)); continue; }
        const a = save(`skill.${s.id}.use`, childOf(n, ['Use']), `${s.name} Use`);
        const b = save(`skill.${s.id}.hit`, childOf(n, ['Hit']), `${s.name} Hit`);
        if (a || b) withSound++;
        else d.log(`sfx skill ${s.id} ${s.name}: no Use/Hit sound; children ${n.keys().join(',') || '-'}`);
      }
      d.log(`sfx: skills with sounds ${withSound}/${WANTED_SKILLS.filter((s) => !s.passive).length}${missing.length ? `; no Skill.img node for ${missing.join(' ')} (sample keys: ${skillImg.root.keys().slice(0, 8).join(' ')})` : ''}`);
    }

    // game and UI sounds
    const images = new Map<string, { root: Any } | null>();
    for (const [key, [img, nodes]] of Object.entries(GAME_SOUNDS)) {
      if (!images.has(img)) images.set(img, image(img));
      const im = images.get(img);
      if (!im) continue;
      if (!save(key, childOf(im.root, nodes), `${img}/${nodes[0]}`)) d.warn(`sfx ${key}: no sound node ${nodes.join('|')} in ${img}; has ${im.root.keys().slice(0, 40).join(', ')}`);
    }

    // one weapon attack sound per class
    const weapon = image('Weapon.img');
    if (weapon) {
      for (const [cls, types] of Object.entries(WEAPON_SOUND_TYPES)) {
        const t = childOf(weapon.root, types);
        const node = t && (childOf(t, ['Attack', 'Attack1', 'Swing']) ?? t.keys().map((k: string) => t.get(k)).find((c: Any) => c?.type === 'sound'));
        if (!save(`weapon.${cls}.attack`, node, `Weapon.img/${types.join('|')}/Attack`)) d.warn(`sfx weapon.${cls}.attack: none of ${types.join(',')} usable; Weapon.img has ${weapon.root.keys().slice(0, 40).join(', ')}${t ? `; ${t.name} has ${t.keys().join(',')}` : ''}`);
      }
    }
  } catch (e) {
    d.warn(`sfx: ${(e as Error).stack}`);
  }
  const n = Object.keys(sfx).length;
  d.log(`sfx totals: ${n} sounds, ${(res.bytes / 1e6).toFixed(2)} MB, ${skippedBig} skipped as too big, format tags ${[...tags].map(([k, c]) => `${k}x${c}`).join(' ') || '-'}`);
  if (n) res.manifest.sfx = sfx;
  return res;
}
