// Dev tool: prints the property trees of selected WZ images so code can be written against real layouts.
//
//   node scripts/dump-wz.mjs <dir with .wz files> 'Character.wz:00002000.img:3' 'UI.wz:*' ...
// Each spec is file:image:depth; image '*' lists the archive's image paths instead.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWz } from './wz.mjs';

const [dir, ...specs] = process.argv.slice(2);
const files = new Map();
const open = (name) => {
  if (!files.has(name)) {
    const real = readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase());
    files.set(name, real ? openWz(readFileSync(join(dir, real))) : null);
  }
  return files.get(name);
};

function show(p, depth, indent, out) {
  for (const k of p.keys()) {
    const c = p.child(k);
    let v = '';
    if (c.type === 'canvas') v = `canvas ${c.value.width}x${c.value.height} fmt${c.value.format}+${c.value.format2}`;
    else if (c.type === 'vector') v = `(${c.value.x},${c.value.y})`;
    else if (c.type === 'sound') v = `sound ${c.value.ms}ms ${c.value.data.length}B`;
    else if (c.type === 'uol') v = `-> ${c.value}`;
    else if (c.type !== 'property' && c.type !== 'convex') v = JSON.stringify(c.value);
    const n = c.children ? ` [${c.children.size}]` : '';
    out.push(`${indent}${k}: ${c.type}${n} ${v}`.trimEnd());
    if (out.length > 400) return;
    if (c.children && depth > 1) show(c, depth - 1, indent + '  ', out);
  }
}

for (const spec of specs) {
  const [file, image, depthStr] = spec.split(':');
  console.log(`===== ${spec}`);
  try {
    const wz = open(file);
    if (!wz) {
      console.log(`(no ${file})`);
      continue;
    }
    if (image.endsWith('*')) {
      const prefix = image.slice(0, -1);
      const paths = [...wz.walk()].map((e) => e.path).filter((p) => p.startsWith(prefix));
      console.log(`${paths.length} images: ${paths.slice(0, 300).join(' ')}`);
      continue;
    }
    const out = [];
    show(wz.image(image), Number(depthStr ?? 3), '  ', out);
    console.log(out.slice(0, 400).join('\n'));
    if (out.length > 400) console.log('  ... (truncated)');
  } catch (e) {
    console.log(`error: ${e.message}`);
  }
}
