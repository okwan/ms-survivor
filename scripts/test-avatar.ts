// Run: node --experimental-strip-types scripts/test-avatar.ts
// Alignment and z-order math of the character compositor (src/maple/avatar-core.ts) on hand-made items.
import assert from 'node:assert/strict';
import { compose, zDepthTable, stanceActions, lookItems, defaultLook, sanitizeLook, wantedItems } from '../src/maple/avatar-core.ts';
import type { FrameData, ItemJson, LayerRec, Slot } from '../src/maple/avatar-core.ts';

let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => { checks++; assert.deepEqual(a, b, m); };
const ok = (c: unknown, m: string) => { checks++; assert.ok(c, m); };

const layer = (n: string, z: string, w: number, h: number, ox: number, oy: number, m: Record<string, [number, number]>): LayerRec => ({ n, z, x: 0, y: 0, w, h, ox, oy, m });
const item = (slot: Slot, frames: FrameData[], extra: Record<string, FrameData[] | string> = {}): ItemJson => ({ id: '0', slot, size: [1, 1], actions: { stand1: frames, ...extra } });
const fr = (...l: LayerRec[]): FrameData => ({ d: 100, l });

const body = item('body', [fr(layer('body', 'body', 14, 20, 7, 20, { navel: [0, -9], neck: [0, -18] }), layer('arm', 'arm', 5, 11, 2, 0, { navel: [6, 8], hand: [0, 10] }))]);
const head = item('head', [fr(layer('head', 'head', 22, 20, 11, 10, { neck: [0, 9], brow: [0, -1] }))]);
const face = item('face', [], { default: [fr(layer('face', 'face', 12, 6, 6, 3, { brow: [0, -1] }))] });
const hair = item('hair', [], { default: [fr(layer('hair', 'hair', 26, 15, 13, 7, { brow: [0, 5] }), layer('hairOverHead', 'hairOverHead', 28, 6, 14, 3, { brow: [0, 9] }))] });
const sword = item('weapon', [fr(layer('weapon', 'weapon', 24, 5, 20, 2, { hand: [0, 0] }))]);
const parts = [body, head, face, hair, sword].map((item) => ({ slot: item.slot, item }));
// real zmap order: front-most first
const zmap = ['hairOverHead', 'hair', 'face', 'head', 'arm', 'weapon', 'body'];
const z = zDepthTable(zmap);
ok(z.frontFirst, 'zmap with head before body is detected as front-most first');
eq(zDepthTable([...zmap].reverse()).frontFirst, false, 'a reversed list is detected too');

const c = compose(parts, 'stand1', 0, z)!;
const by = (n: string) => c.placed.find((p) => p.layer.n === n)!;
const world = (n: string, key: string) => { const p = by(n); return [p.x + p.layer.ox + p.layer.m[key][0], p.y + p.layer.oy + p.layer.m[key][1]]; };
eq([by('body').x + 7, by('body').y + 20], [0, 0], 'body origin is the character origin (feet)');
eq(world('head', 'neck'), world('body', 'neck'), 'head neck lands on the body neck');
eq(world('face', 'brow'), world('head', 'brow'), 'face brow lands on the head brow');
eq(world('hair', 'brow'), world('head', 'brow'), 'hair brow lands on the head brow');
eq(world('hairOverHead', 'brow'), world('head', 'brow'), 'hairOverHead brow lands on the head brow');
eq(world('arm', 'navel'), world('body', 'navel'), 'arm navel lands on the body navel');
eq(world('weapon', 'hand'), world('arm', 'hand'), 'weapon hand lands on the arm hand');
eq(by('head').anchor, 'neck', 'head aligned by neck');
// z order: back to front follows the zmap (later in the list = further back)
eq(c.placed.map((p) => p.layer.n), ['body', 'weapon', 'arm', 'head', 'face', 'hair', 'hairOverHead'], 'layers sorted back to front by zmap');
// a reversed list reverses the stack (detected orientation keeps head over body)
const zr = zDepthTable([...zmap].reverse());
eq(compose(parts, 'stand1', 0, zr)!.placed.map((p) => p.layer.n), ['body', 'weapon', 'arm', 'head', 'face', 'hair', 'hairOverHead'], 'orientation detection keeps the stack right for a reversed reader');
// bbox covers every layer
ok(c.minX <= by('weapon').x && c.maxY >= 0 && c.minY <= by('hairOverHead').y, 'bounding box covers the layers');
// body face flag hides the face
const noFace = item('body', [{ ...body.actions.stand1[0 as never] as unknown as FrameData, f: 0 } as FrameData]);
eq(compose([{ slot: 'body', item: noFace }, { slot: 'head', item: head }, { slot: 'face', item: face }], 'stand1', 0, z)!.placed.some((p) => p.layer.n === 'face'), false, 'face hidden when the body frame says so');
// a missing action for the body gives null; a part lacking the action is just skipped
eq(compose(parts, 'swingO1', 0, z), null, 'unknown action -> null');
eq(compose([{ slot: 'body', item: body }, { slot: 'head', item: head }], 'stand1', 5, z)!.placed.length, 3, 'frame index wraps and absent parts are skipped');
// aliases
const al = item('hair', [], { default: [fr(layer('hair', 'hair', 4, 4, 2, 2, { brow: [0, 0] }))], stand1: 'default' });
eq(compose([{ slot: 'body', item: body }, { slot: 'head', item: head }, { slot: 'hair', item: al }], 'stand1', 0, z)!.placed.some((p) => p.layer.n === 'hair'), true, 'an alias action resolves to its target frames');

// stances and looks
eq(stanceActions('shoot', null).stand, 'stand2', 'bow stands with stand2');
eq(stanceActions('swing', { ...sword, actions: { stand1: [], walk1: [], swingO2: [] } }).attack, ['swingO2'], 'attack list limited to what the weapon has');
const look = defaultLook(1302000);
eq(lookItems(look), { body: '00002000', head: '00012000', face: '00020000', hair: '00030000', coat: '01040002', pants: '01060002', shoes: '01072001', weapon: '01302000' }, 'default look item ids');
eq(lookItems({ ...look, gender: 1, skin: 3, hair: 31040, hairColor: 5 }).hair, '00031045', 'hair colour is the last digit');
eq(sanitizeLook({ gender: 1, face: 20000, skin: 99 }, 1302000).face, 21000, 'invalid saved faces are replaced');
const w = wantedItems();
eq([w.body.length, w.head.length, w.face.length, w.hair.length, w.coat.length, w.pants.length, w.shoes.length, w.weapon.length], [5, 5, 6, 48, 4, 4, 2, 4], 'wanted item counts');
eq(w.weapon, ['01302000', '01372005', '01452002', '01332005'], 'weapons of the four classes');
console.log(`test-avatar: ok (${checks} checks)`);
