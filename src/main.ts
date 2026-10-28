import './ui/style.css';
import { Application } from 'pixi.js';
import { botInput, botPick } from './game/bot.ts';
import { CLASS_BY_KEY, DEFAULT_CLASS, RUN_LENGTH, TICK } from './game/data.ts';
import { Sim } from './game/sim.ts';
import { buildArt } from './maple/art.ts';
import type { MapleArt } from './maple/art.ts';
import { loadManifest } from './maple/assets.ts';
import type { MapleManifest } from './maple/assets.ts';
import { Avatar } from './maple/avatar.ts';
import { defaultLook, sanitizeLook } from './maple/avatar-core.ts';
import type { AvatarManifest, Look } from './maple/avatar-core.ts';
import { Bgm } from './maple/audio.ts';
import { Sfx, playSimEvents } from './maple/sfx.ts';
import { GearPool } from './game/gear.ts';
import { GearIcons } from './render/gear-icons.ts';
import { GearUi, lookGearOf } from './ui/gear.ts';
import { Renderer } from './render/renderer.ts';
import { CreateScreen } from './ui/create.ts';
import type { CreateResult } from './ui/create.ts';
import { MapBanner } from './ui/banner.ts';
import { Hud } from './ui/hud.ts';
import { BookPanel } from './ui/book.ts';
import { ShopPanel } from './ui/shop.ts';
import { NoteUi } from './ui/items.ts';
import { GachaUi } from './ui/gachapon.ts';
import { ScrollPool } from './game/scrolls.ts';
import { bookBonus, bookCounts, mergeBook } from './game/book.ts';
import { applyUiTheme } from './ui/theme.ts';
import { Input } from './ui/input.ts';
import { isTouch } from './ui/touch.ts';
import { loadSave, writeSave } from './ui/save.ts';
import { Screens } from './ui/screens.ts';

type Mode = 'title' | 'playing' | 'paused' | 'ended';

/** Real Maple art from maple/manifest.json (written by the deploy step). Null on any failure or after 12 s: the game then uses placeholder art. */
let avatarManifest: AvatarManifest | null = null;
/** move-speed factor per mob id from Mob.wz (info/speed), empty without a manifest: the sim then keeps its hand-tuned speeds */
let mobSpeeds: Record<number, number> = {};
let mapleManifest: MapleManifest | null = null;
async function loadArt(): Promise<MapleArt | null> {
  try {
    const run = async () => {
      const m = await loadManifest();
      if (!m) return null;
      avatarManifest = m.avatar ?? null;
      mobSpeeds = {};
      for (const [id, e] of Object.entries(m.mobs)) if (typeof e.speed === 'number' && Number.isFinite(e.speed)) mobSpeeds[Number(id)] = e.speed;
      mapleManifest = m;
      const art = await buildArt(m);
      console.info(`maple art: ${art.counts.mobs} mobs, ${art.counts.skills} skill animations, ${art.counts.icons} icons, ${art.counts.objects} map objects, ${art.counts.digitSets} damage sets, ${art.counts.uiPieces} ui pieces, bgm ${art.bgm.run ? 'run' : '-'}/${art.bgm.title ? 'title' : '-'} (source ${m.source?.mirror ?? '?'})`);
      return art;
    };
    return await Promise.race([run(), new Promise<null>((r) => setTimeout(() => r(null), 12000))]);
  } catch (e) {
    console.warn('maple art unavailable, using placeholders', e);
    return null;
  }
}

async function boot() {
  if (isTouch()) document.documentElement.classList.add('touch');
  const uiRoot = document.getElementById('ui')!;
  const host = document.getElementById('app')!;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x4f9a3c,
    antialias: false,
    resolution: Math.min(isTouch() ? 1.5 : 2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  const art = await loadArt();
  const gearPool = GearPool.fromManifest(avatarManifest?.gear);
  const scrollPool = ScrollPool.fromManifest((mapleManifest as MapleManifest | null)?.items?.scrolls);
  const gearIcons = new GearIcons(avatarManifest?.gear ?? null);
  await gearIcons.load();
  console.info(`maple gear: ${gearPool.items.size} ${gearPool.real ? 'extracted' : 'placeholder'} items`);
  const avatar = avatarManifest ? new Avatar(avatarManifest) : null;
  console.info(`maple avatar: ${avatar ? 'parts for the player character available' : 'no character art, placeholder hero'}`);
  applyUiTheme(art?.ui ?? null);
  const renderer = new Renderer(app, art);
  app.renderer.on('resize', () => renderer.resize());
  renderer.setGearIcons(gearIcons);

  const save = loadSave();
  const bgm = art ? new Bgm(art.bgm, save.settings.volume, save.settings.muted, art.bgmRegions) : null;
  const sfx = art && Object.keys(art.sfx).length ? new Sfx(art.sfx, save.settings.sfxVolume, save.settings.muted) : null;
  const banner = new MapBanner(uiRoot);
  /** banner text and music for a region (the run starts in region 0) */
  const enterRegion = (r: number) => {
    const ra = art?.regions[r];
    if (ra) banner.show(ra.street, ra.name);
    bgm?.setRegion(r);
  };
  let mode: Mode = 'title';
  let sim = new Sim(1);
  // the character of the current/next run: the saved one, or a Magician with the default look
  let hero: CreateResult = save.character
    ? { cls: save.character.cls as CreateResult['cls'], look: save.character.look, name: save.character.name }
    : { cls: DEFAULT_CLASS, look: defaultLook(CLASS_BY_KEY[DEFAULT_CLASS].weapon), name: 'Maple' };
  let god = false;
  let speed = 1;
  let autopick = false;
  let botOn = false;
  let manual: { x: number; y: number } | null = null;
  let acc = 0;

  const hud = new Hud(uiRoot, renderer.tex.icons);
  hud.show(false);
  const input = new Input(uiRoot);
  const vec = { x: 0, y: 0 };
  const gearUi = new GearUi(uiRoot, gearIcons, {
    active: () => mode === 'playing',
    autoEquip: (on) => { save.settings.autoEquip = on; sim.autoEquip = on; writeSave(save); },
    sim: () => sim,
    look: () => (avatar ? { ...hero.look, gear: lookGearOf(sim) } : null),
    name: () => hero.name,
  }, save.settings.autoEquip, avatar);
  hud.onWindow = (w) => gearUi.windows.toggle(w);
  // the hero's look = creation look + equipped gear; re-composited when the equipped set changes
  let seenGear = 0;

  function startRun(seed?: number, cls?: string, look?: Look) {
    if (cls && CLASS_BY_KEY[cls]) hero = { ...hero, cls: cls as CreateResult['cls'], look: sanitizeLook(look ?? hero.look, CLASS_BY_KEY[cls].weapon) };
    renderer.setHero(avatar, hero.look, CLASS_BY_KEY[hero.cls].stance);
    avatar?.prefetch(hero.look);
    sim = new Sim(seed ?? (Math.random() * 4294967296) >>> 0, hero.cls, { pool: gearPool, gender: hero.look.gender, autoEquip: save.settings.autoEquip, scrolls: scrollPool, pet: save.settings.pet, book: save.book, mobSpeeds, meta: save.meta });
    sim.god = god;
    gearUi.reset();
    gachaUi.reset();
    hud.setHero(hero.name, hero.cls);
    seenGear = 0;
    acc = 0;
    mode = 'playing';
    bgm?.setRegion(0);
    bgm?.play('run');
    enterRegion(0);
    screens.hideAll();
    hud.show(true);
  }

  function bank(quit: boolean) {
    save.book = mergeBook(save.book, sim.book);
    save.mesos += sim.mesos;
    if (save.character && save.character.name === hero.name && sim.level > 1) save.character.level = sim.level;
    const best = !quit && sim.t > save.bestTime;
    if (sim.t > save.bestTime) save.bestTime = sim.t;
    writeSave(save);
    return best;
  }

  function endRun() {
    mode = 'ended';
    const best = bank(false);
    screens.showResults({ won: sim.won, time: sim.t, level: sim.level, kills: sim.kills, mesos: sim.mesos, bosses: sim.bossKills, elites: sim.elites.killed, best });
  }

  function toTitle() {
    sim = new Sim(1);
    gachaUi.reset();
    mode = 'title';
    bgm?.play('title');
    banner.hide();
    hud.show(false);
    screens.showTitle(save);
  }

  function setPaused(p: boolean) {
    if (p && mode === 'playing' && !sim.offer) { mode = 'paused'; screens.showPause(true); }
    else if (!p && mode === 'paused') { mode = 'playing'; screens.showPause(false); }
  }

  const screens = new Screens(
    uiRoot,
    {
      start: () => { screens.hideAll(); create.show(save.character ?? { ...hero }); },
      quick: () => {
        const ch = save.character;
        if (!ch) return;
        hero = { cls: ch.cls as CreateResult['cls'], look: ch.look, name: ch.name };
        const go = () => startRun();
        if (!avatar) return go();
        void Promise.race([avatar.ensureLook(hero.look), new Promise((r) => setTimeout(r, 2500))]).then(go);
      },
      resume: () => setPaused(false),
      quit: () => { bank(true); toTitle(); },
      retry: () => startRun(),
      menu: () => toTitle(),
      pick: (i) => sim.pick(i),
      reroll: () => sim.reroll(),
      banish: (i) => sim.banish(i),
      book: () => bookPanel.show(save.book),
      shop: () => shopPanel.show(),
      pet: (on) => { save.settings.pet = on; writeSave(save); },
      volume: (v) => { save.settings.volume = v; writeSave(save); bgm?.setVolume(v); },
      sfxVolume: (v) => { save.settings.sfxVolume = v; writeSave(save); sfx?.setVolume(v); sfx?.play('ui.click'); },
      mute: (m) => setMuted(m),
    },
    renderer.tex.icons,
    avatar,
  );
  const bookPanel = new BookPanel(uiRoot, (mapleManifest as MapleManifest | null)?.mobs ?? {});
  const shopPanel = new ShopPanel(uiRoot, renderer.tex.icons, (mapleManifest as MapleManifest | null)?.npc ?? null, {
    save: () => save,
    write: () => writeSave(save),
    changed: () => screens.refresh(save),
    sound: (k) => { if (k !== 'deny') sfx?.play('game.pickup', { volume: 0.6 }); },
  });
  const noteUi = new NoteUi(uiRoot);
  const gachaUi = new GachaUi(uiRoot, renderer.tex.icons);
  gachaUi.onReveal = (_i, r) => sfx?.play(r.kind === 'evolve' ? 'game.levelup' : 'game.pickup', { volume: 0.5 });
  const create = new CreateScreen(uiRoot, {
    avatar,
    icons: renderer.tex.icons,
    onBack: () => { create.hide(); screens.showTitle(save); },
    onStart: (r) => {
      hero = r;
      save.character = { cls: r.cls, look: r.look, name: r.name };
      writeSave(save);
      create.hide();
      startRun();
    },
  });
  function setMuted(m: boolean) {
    save.settings.muted = m;
    writeSave(save);
    bgm?.setMuted(m);
    sfx?.setMuted(m);
    screens.setMuted(m);
    hud.setMuted(m);
  }
  // button and card sounds for every UI element (clicks, and a soft tick when the pointer enters one)
  uiRoot.addEventListener('click', (e) => { if ((e.target as Element).closest('button, .card')) sfx?.play('ui.click'); });
  let hoverEl: Element | null = null;
  uiRoot.addEventListener('pointerover', (e) => {
    const t = (e.target as Element).closest('button, .card');
    if (t && t !== hoverEl && (e as PointerEvent).pointerType === 'mouse') sfx?.play('ui.hover', { volume: 0.5 });
    hoverEl = t;
  });
  hud.muteBtn.addEventListener('click', () => setMuted(!save.settings.muted));
  hud.setMuted(save.settings.muted);
  screens.showTitle(save);
  bgm?.play('title');
  input.onPause = () => { if (mode === 'playing') setPaused(true); else if (mode === 'paused') setPaused(false); };
  hud.pauseBtn.addEventListener('click', () => setPaused(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

  function applyInput() {
    if (botOn) { const b = botInput(sim); sim.setInput(b.x, b.y); }
    else if (manual) sim.setInput(manual.x, manual.y);
    else { input.read(vec); sim.setInput(vec.x, vec.y); }
  }

  app.ticker.add((ticker) => {
    const dt = Math.min(0.1, ticker.deltaMS / 1000);
    if (mode === 'playing') {
      if (autopick && sim.offer) sim.pick(botPick(sim));
      acc = Math.min(acc + dt * speed, 0.25 * Math.max(1, speed));
      let guard = Math.ceil(12 * Math.max(1, speed));
      while (acc >= TICK && guard-- > 0 && !sim.over) {
        if (sim.offer) { if (autopick) sim.pick(botPick(sim)); else break; }
        applyInput();
        sim.tick(TICK);
        acc -= TICK;
      }
      if (sim.offer) acc = 0;
      if (sim.over) endRun();
    }
    input.setHint(mode === 'playing');
    if (sim.events.length) {
      if (sfx) playSimEvents(sfx, sim.events, sim.cls.key);
      for (let i = 0; i < sim.events.length; i++) {
        const ev = sim.events[i];
        if (ev.type === 'region') enterRegion(ev.region);
        else if (ev.type === 'gacha') gachaUi.show(ev);
      }
    }
    renderer.render(sim, dt);
    if (mode !== 'title') {
      hud.update(sim);
      gearUi.update(sim);
      noteUi.update(sim);
      if (sim.gearVersion !== seenGear) {
        seenGear = sim.gearVersion;
        renderer.setLook({ ...hero.look, gear: lookGearOf(sim) });
      }
      screens.syncLevelUp(sim);
    }
  });

  if (import.meta.env.DEV || /[?&]bot\b/.test(location.search)) {
    const api = {
      get sim() { return sim; },
      start: (seed?: number, cls?: string) => startRun(seed, cls),
      /** open the New Character window, or (with a class) pick it and jump to the customisation step */
      create: () => { screens.hideAll(); create.show(save.character ?? { ...hero }); },
      step(seconds: number) {
        const n = Math.round(seconds * 60);
        for (let i = 0; i < n && !sim.over; i++) {
          if (sim.offer) { if (autopick) sim.pick(botPick(sim)); else break; }
          applyInput();
          sim.tick(TICK);
        }
        sim.events.length = 0;
      },
      pick: (i: number) => sim.pick(i),
      reroll: () => sim.reroll(),
      banish: (i: number) => sim.banish(i),
      setInput(x: number, y: number) { manual = { x, y }; },
      clearInput() { manual = null; },
      god(on: boolean) { god = on; sim.god = on; },
      speed(m: number) { speed = m; },
      autopick(on: boolean) { autopick = on; },
      bot(on: boolean) { botOn = on; },
      mode: () => mode,
      renderer,
      hero: () => hero,
      /** what is on screen: the screen name ('login', 'select', 'title', 'create', 'playing', 'paused', 'ended') and the open game windows */
      ui: () => ({ screen: mode === 'title' ? (create.visible ? 'create' : screens.titleState() || 'title') : mode, windows: gearUi.windows.list().map((w) => w.name) }),
      /** open or close the 'equip' / 'inventory' / 'stats' window */
      window: (name: 'equip' | 'inventory' | 'stats', on = true) => gearUi.windows.set(name, on),
      /** unequipped items carried (ids), and wear one of them */
      bag: () => sim.bag.map((i) => i.id),
      equipFromBag: (id: string) => sim.equipFromBag(id),
      /** equipped item ids by slot and the summed bonus */
      gear: () => sim.gearSummary(),
      /** put an item (pool id) in the bag as if picked up; equips it when it is an upgrade */
      giveGear: (id: string) => sim.giveGear(id),
      avatar: () => (avatar ? { ready: avatar.ready(hero.look) } : null),
      /** what real Maple art was loaded (null = placeholders) */
      region: () => sim.region,
      /** sound effects: keys that can play, decoded so far, plays in the last second */
      sfx: () => (sfx ? sfx.stats() : null),
      maple: () => (art ? { ...art.counts, bgm: art.bgm, ground: !!art.map?.ground, levelUp: !!art.levelUp } : null),
      /** loaded item art keys: potions, mesos, scrolls, pet, enchant */
      items: () => art?.items?.keys ?? [],
      /** the pet's position and how many pickups it has collected (null: no pet this run) */
      pet: () => (sim.pet ? { x: sim.pet.x, y: sim.pet.y, collected: sim.pet.collected } : null),
      /** the Monster Book: kills per mob id (this run included) */
      book: () => ({ ...(mode === 'title' ? save.book : sim.book) }),
      /** the Henesys shop: ranks bought and banked mesos, and open / close the window */
      shop: (on = true) => { if (on) shopPanel.show(); else shopPanel.hide(); return { meta: { ...save.meta }, mesos: save.mesos, open: shopPanel.visible }; },
      bookBonus: () => ({ ...bookCounts(sim.book), bonus: bookBonus(sim.book) }),
      snapshot: () => ({ ...sim.snapshot(), mode, runLength: RUN_LENGTH }),
    };
    (window as unknown as { game: typeof api }).game = api;
  }
}

boot().catch((e) => {
  console.error(e);
  const d = document.createElement('pre');
  d.style.cssText = 'color:#fff;padding:16px;position:fixed;inset:0;background:#300';
  d.textContent = 'Failed to start: ' + String(e);
  document.body.appendChild(d);
});
