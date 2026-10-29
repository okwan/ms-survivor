// One-off CI probe: prints the Skill.wz / Character.wz facts the attack animation work needs (skill actions, afterimages,
// weapon actions, Pirate skills and weapons). Reads the cached .wz files; prints "dump:" lines; never fails.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { openWz } from './wz.mjs';
import { SKILLS, PASSIVES, CLASSES } from '../src/game/data.ts';
import { EVOLVED_SKILLS } from '../src/game/evolutions.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const log = (...a: unknown[]) => console.log('dump:', ...a);
const dir = join(process.env.MAPLE_CACHE ?? '.maple-cache', 'wz');

function open(stem: string): { get(p: string): Any; names: string[] } | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((n) => new RegExp(`^${stem}\\d*\\.wz$`, 'i').test(n));
  const sets = files.map((f) => {
    const wz = openWz(readFileSync(join(dir, f)));
    const idx = new Map<string, string>();
    for (const e of wz.walk()) idx.set(e.path.toLowerCase(), e.path);
    return { wz, idx };
  });
  return {
    names: sets.flatMap((s) => [...s.idx.values()]),
    get(p: string) {
      for (const s of sets) {
        const real = s.idx.get(p.toLowerCase());
        if (real) return s.wz.image(real);
      }
      return null;
    },
  };
}

function show(node: Any, depth: number, maxDepth: number, pad = '', maxKids = 14): string[] {
  if (!node) return [];
  const out: string[] = [];
  const keys = node.keys();
  for (const k of keys.slice(0, maxKids)) {
    const c = node.child(k);
    let v = '';
    if (c.type === 'canvas') {
      const o = c.get('origin')?.value;
      v = ` canvas${o ? ` origin(${o.x},${o.y})` : ''} kids[${c.keys().join(',')}]`;
    } else if (c.type === 'uol') v = ` -> ${c.value}`;
    else if (c.type === 'vector') v = ` (${c.value?.x},${c.value?.y})`;
    else if (c.value !== null && c.value !== undefined && typeof c.value !== 'object') v = ` = ${JSON.stringify(c.value)}`;
    out.push(`${pad}${k} [${c.type}]${v}`);
    if (depth < maxDepth && c.type !== 'canvas' && c.type !== 'uol') out.push(...show(c, depth + 1, maxDepth, pad + '  ', maxKids));
  }
  if (keys.length > maxKids) out.push(`${pad}... ${keys.length - maxKids} more: ${keys.slice(maxKids, maxKids + 40).join(',')}`);
  return out;
}

const pad7 = (n: number) => String(n).padStart(7, '0');
const pad8 = (n: number | string) => String(n).padStart(8, '0');

try {
  const skill = open('Skill');
  const str = open('String');
  const ch = open('Character');
  const strSkill = str?.get('Skill.img');
  const nameOf = (id: string) => strSkill?.get(`${id}/name`)?.value ?? '?';

  const body = ch?.get('00002000.img');
  for (const a of ['swingO1', 'alert', 'savage', 'magic1', 'magic3', 'alert2', 'alert3', 'avenger', 'assaulter', 'prone2', 'brandish1', 'blast', 'rush', 'meteor', 'straight', 'doublefire', 'somersault', 'backspin', 'fist', 'shot']) {
    log(`--- body action ${a} ---`);
    for (const l of show(body?.get(a), 0, 1, '  ', 30)) console.log(l);
  }
  for (const a of ['knuckle', 'gun', 'swordOS']) {
    const img = ch?.get(`Afterimage/${a}.img`);
    log(`--- Afterimage/${a}.img levels: ${img?.keys().join(',')}; level 0 actions: ${img?.get('0')?.keys().join(',')}`);
  }
  const head = ch?.get('00012000.img');
  log(`head actions: ${head?.keys().join(',')}`);
  log(`head savage/0: ${head?.get('savage/0')?.keys().join(',')}`);
  // passives present?
  log(`passives: ${PASSIVES.length}`);
} catch (e) {
  log('error', (e as Error).stack);
}
