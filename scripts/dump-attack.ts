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

  // 1. our skills: action + child keys
  log('=== our skills: action values and node children ===');
  for (const s of [...SKILLS, ...EVOLVED_SKILLS]) {
    const img = skill?.get(String(Math.floor(s.id / 10000)).padStart(3, '0') + '.img');
    const n = img?.get(`skill/${pad7(s.id)}`);
    if (!n) { log(`${s.id} ${s.name}: MISSING`); continue; }
    const act = n.get('action');
    const acts = act ? (act.type === 'string' ? [act.value] : act.keys().map((k: string) => act.get(k)?.value)) : [];
    const anim = ['effect', 'effect0', 'effect1', 'ball', 'hit', 'prepare', 'keydown', 'keydownend', 'special', 'affected', 'mob', 'tile', 'screen', 'repeat']
      .filter((k) => n.get(k))
      .map((k) => {
        const c = n.get(k);
        const nums = c.keys().filter((x: string) => /^\d+$/.test(x));
        return `${k}(${nums.length}${c.get('0')?.type !== 'canvas' && c.get('0') ? ' sub' : ''})`;
      });
    log(`${s.id} ${s.key} "${s.name}" action=[${acts.join(',')}] kids=[${n.keys().join(',')}] anims=${anim.join(' ')}`);
  }

  // 2. some skill node structures in depth
  for (const id of [1001004, 1001005, 2001005, 3001004, 4001344, 4001334]) {
    const img = skill?.get(String(Math.floor(id / 10000)).padStart(3, '0') + '.img');
    log(`--- tree of skill ${id} ---`);
    for (const l of show(img?.get(`skill/${pad7(id)}`), 0, 2, '  ', 8)) console.log(l);
  }

  // 3. body actions
  const body = ch?.get('00002000.img');
  log(`body 00002000 actions: ${body?.keys().join(',')}`);

  // 4. weapons: class weapons + some gear weapons of each type, info + action list
  const weaponIds = CLASSES.map((c) => pad8(c.weapon));
  const names = ch?.names ?? [];
  const wnames = names.filter((n) => /^Weapon\//i.test(n));
  for (const t of ['130', '131', '132', '133', '137', '138', '140', '141', '142', '143', '144', '145', '146', '147', '148', '149']) {
    const ofType = wnames.filter((n) => new RegExp(`^Weapon/0${t}`, 'i').test(n));
    log(`weapon type ${t}: ${ofType.length} items, first ${ofType.slice(0, 6).join(' ')}`);
    if (ofType[0]) weaponIds.push(ofType[0].replace(/^Weapon\//i, '').replace('.img', ''));
  }
  const afters = new Set<string>();
  for (const id of weaponIds) {
    const img = ch?.get(`Weapon/${id}.img`);
    if (!img) { log(`weapon ${id}: missing`); continue; }
    const info = img.get('info');
    const iv: string[] = [];
    for (const k of info?.keys() ?? []) {
      const v = info.get(k)?.value;
      if (typeof v === 'string' || typeof v === 'number') iv.push(`${k}=${v}`);
    }
    const ai = info?.get('afterImage')?.value;
    if (typeof ai === 'string') afters.add(ai);
    log(`weapon ${id}: info{${iv.join(' ')}} actions=[${img.keys().filter((k: string) => k !== 'info').join(',')}]`);
  }

  // 5. afterimages
  const aiNames = names.filter((n) => /^Afterimage\//i.test(n));
  log(`Afterimage images: ${aiNames.join(' ')}`);
  for (const a of [...afters].slice(0, 4)) {
    const img = ch?.get(`Afterimage/${a}.img`);
    log(`--- tree of Afterimage/${a}.img ---`);
    for (const l of show(img, 0, 3, '  ', 6)) console.log(l);
  }

  // 6. pirate skills
  for (const job of ['500', '510', '511', '512', '520', '521', '522']) {
    const img = skill?.get(`${job}.img`);
    if (!img) { log(`Skill ${job}.img: MISSING`); continue; }
    const ids = img.get('skill')?.keys() ?? [];
    log(`=== Skill ${job}.img: ${ids.length} skills ===`);
    for (const id of ids) {
      const n = img.get(`skill/${id}`);
      const act = n.get('action');
      const acts = act ? (act.type === 'string' ? [act.value] : act.keys().map((k: string) => act.get(k)?.value)) : [];
      const anims = ['effect', 'ball', 'hit', 'prepare', 'keydown', 'special', 'affected'].filter((k) => n.get(k)).join(',');
      const lv = n.get('level')?.keys().length ?? 0;
      log(`${id} "${nameOf(id)}" action=[${acts.join(',')}] anims=${anims} levels=${lv} icon=${n.get('icon') ? 'y' : 'n'}`);
    }
  }
  // passives present?
  log(`passives: ${PASSIVES.length}`);
} catch (e) {
  log('error', (e as Error).stack);
}
