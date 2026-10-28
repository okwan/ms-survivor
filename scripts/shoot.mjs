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
    page.on('pageerror', (e) => console.log(`shoot ${s.tag}: page error ${e.message}`));
    const shot = async (name) => {
      await page.waitForTimeout(1600);
      const b64 = (await page.screenshot({ type: 'jpeg', quality: 72 })).toString('base64');
      for (let i = 0; i < b64.length; i += 3000) console.log(`SHOT ${s.tag}-${name} ${b64.slice(i, i + 3000)}`);
      console.log(`SHOT-END ${s.tag}-${name}`);
    };
    const click = async (sel) => {
      const el = page.locator(sel).first();
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
      for (const sel of ['[data-shot=login]', '[data-shot=world]', '[data-shot=channel]']) await click(sel);
      await shot('select-saved');
      console.log(`shoot ${s.tag}: ui ${JSON.stringify(await page.evaluate(() => window.game?.ui?.()))}`);
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
