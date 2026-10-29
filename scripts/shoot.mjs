// CI screenshots of the built site with the real extracted art (branch builds only, see deploy.yml): serves <dist> on a local
// port, opens it in Chromium at a desktop and a phone-landscape size, walks the login screens and logs each screenshot as
// base64 JPEG lines ("SHOT <name> <chunk>", then "SHOT-END <name>") so they can be read from the job log. Never fails the build.
//   node scripts/shoot.mjs dist
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const dist = process.argv[2] || 'dist';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(dist, path.endsWith('/') ? path + 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

/** a saved character so the character select has someone to show */
const SAVE = {
  character: { name: 'Oscar', cls: 'warrior', level: 37, look: null },
};

async function main() {
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch (e) {
    console.log(`shoot: playwright not available (${e.message})`);
    return;
  }
  await new Promise((r) => server.listen(4173, r));
  const browser = await chromium.launch();
  const sizes = [
    { tag: 'desktop', viewport: { width: 1280, height: 720 }, touch: false },
    { tag: 'phone', viewport: { width: 844, height: 390 }, touch: true },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: s.viewport, hasTouch: s.touch, isMobile: s.touch, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`shoot ${s.tag}: page error ${e.stack}`));
    const shot = async (name, wait = 1600) => {
      if (wait) await page.waitForTimeout(wait);
      const b64 = (await page.screenshot({ type: 'jpeg', quality: 72 })).toString('base64');
      for (let i = 0; i < b64.length; i += 3000) console.log(`SHOT ${s.tag}-${name} ${b64.slice(i, i + 3000)}`);
      console.log(`SHOT-END ${s.tag}-${name}`);
    };
    const click = async (sel) => {
      const el = page.locator(`${sel} >> visible=true`).first();
      if (!(await el.count())) { console.log(`shoot ${s.tag}: no ${sel}`); return false; }
      await el.click({ force: true });
      return true;
    };
    try {
      await page.goto('http://localhost:4173/index.html?bot');
      await page.waitForFunction(() => window.game, null, { timeout: 30000 });
      await shot('title');
      // the steps of the login flow, each a selector to press then a screenshot; a missing selector is logged and skipped
      for (const [name, sel] of [['world', '[data-shot=login]'], ['channel', '[data-shot=world]'], ['select', '[data-shot=channel]']]) {
        if (await click(sel)) await shot(name);
      }
      // with a saved character
      await page.evaluate((save) => {
        const k = 'maple-survivor-save-v1';
        const cur = JSON.parse(localStorage.getItem(k) || '{}');
        const look = cur.character?.look ?? window.game?.hero?.()?.look ?? null;
        localStorage.setItem(k, JSON.stringify({ ...cur, character: { ...(cur.character ?? {}), ...save.character, look: save.character.look ?? look } }));
      }, SAVE);
      await page.reload();
      await page.waitForFunction(() => window.game, null, { timeout: 30000 });
      await shot('title-saved');
      // the name can be typed: rename through the title's ID box (WASD included), then check the save
      const typed = async (sel, text) => {
        const el = page.locator(`${sel} >> visible=true`).first();
        if (!(await el.count())) return `no ${sel}`;
        await el.click();
        await page.keyboard.type(text);
        await page.keyboard.press('Tab');
        return el.inputValue();
      };
      const savedName = () => page.evaluate(() => JSON.parse(localStorage.getItem('maple-survivor-save-v1') || '{}').character?.name);
      const nameCheck = [`id box "${await typed('.ml-field[aria-label="Character name"]', 'Swadd')}", saved "${await savedName()}"`];
      for (const sel of ['[data-shot=login]', '[data-shot=world]', '[data-shot=channel]']) {
        await click(sel);
        await page.waitForTimeout(1500);
      }
      await shot('select-saved');
      if ((await click('[data-shot=cnew]')) || (await click('[data-shot=new]'))) {
        await page.waitForTimeout(2500);
        await shot('create');
        nameCheck.push(`creator box "${await typed('.ml-cname, .create-name', 'Wasd')}"`);
        if (await click('[data-shot=dice]')) {
          await page.waitForTimeout(800);
          await shot('create-dice');
        }
      }
      console.log(`shoot ${s.tag}: ui ${JSON.stringify(await page.evaluate(() => window.game?.ui?.()))}`);
      console.log(`shoot ${s.tag}: name check: ${nameCheck.join(', ')}`);
      // the other menus, desktop only: windows on the title, then a run (playing, level-up, pause, equip, results)
      if (s.tag === 'desktop') {
        await page.reload();
        await page.waitForFunction(() => window.game, null, { timeout: 30000 });
        const menu = async (name, fn) => {
          try {
            await page.evaluate(fn);
            await shot(name);
          } catch (e) {
            console.log(`shoot ${s.tag}: ${name}: ${e.message}`);
          }
        };
        await menu('shop', () => window.game.shop(true));
        await menu('hyper', () => { window.game.shop(false); window.game.hyper(0, 'warrior', true); });
        await menu('playing', () => { window.game.hyper(0, 'warrior', false); window.game.start(7, 'warrior'); window.game.god(true); window.game.step(20); });
        await menu('levelup', () => window.game.step(120));
        await menu('equip', () => { window.game.pick(0); window.game.window('equip', true); window.game.window('inventory', true); });
        // a level-up offer blocks pausing: resolve any left open (pick is a no-op without one), then pause through the api
        await menu('pause', () => { window.game.window('equip', false); window.game.window('inventory', false); for (let i = 0; i < 5; i++) window.game.pick(0); if (window.game.pause(true) !== 'paused') throw new Error('did not pause'); });
        await menu('results', () => { window.game.pause(false); window.game.god(false); window.game.autopick(true); window.game.step(900); });
        // a new run played in real time with the bot; captured right after a skill fired, so the hero is mid-attack (real body action, swing trail, cast effect)
        for (const cls of ['warrior', 'pirate', 'thief']) {
          try {
            await page.evaluate((c) => { window.game.start(11, c); window.game.god(true); window.game.autopick(true); window.game.bot(true); }, cls);
            await page.waitForFunction(() => { const s = window.game.sim; return s.t > 4 && s.t - s.lastFire < 0.1; }, null, { timeout: 30000, polling: 'raf' });
            await shot(`attack-${cls}`, 0);
            console.log(`shoot ${s.tag}: attack-${cls} ${JSON.stringify(await page.evaluate(() => ({ t: window.game.sim.t, skill: window.game.sim.lastSkill, aimDx: window.game.sim.aimX - window.game.sim.px, facing: window.game.sim.facing })))}`);
          } catch (e) {
            console.log(`shoot ${s.tag}: attack-${cls}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.log(`shoot ${s.tag}: ${e.message}`);
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.log(`shoot: ${e.stack}`);
  server.close();
});
