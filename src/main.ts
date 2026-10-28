import './ui/style.css';
import { Application } from 'pixi.js';
import { botInput } from './game/bot.ts';
import { RUN_LENGTH, TICK } from './game/data.ts';
import { Sim } from './game/sim.ts';
import { buildArt } from './maple/art.ts';
import type { MapleArt } from './maple/art.ts';
import { loadManifest } from './maple/assets.ts';
import { Bgm } from './maple/audio.ts';
import { Renderer } from './render/renderer.ts';
import { Hud } from './ui/hud.ts';
import { applyUiTheme } from './ui/theme.ts';
import { Input } from './ui/input.ts';
import { loadSave, writeSave } from './ui/save.ts';
import { Screens } from './ui/screens.ts';

type Mode = 'title' | 'playing' | 'paused' | 'ended';

/** Real Maple art from maple/manifest.json (written by the deploy step). Null on any failure or after 12 s: the game then uses placeholder art. */
async function loadArt(): Promise<MapleArt | null> {
  try {
    const run = async () => {
      const m = await loadManifest();
      if (!m) return null;
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
  const uiRoot = document.getElementById('ui')!;
  const host = document.getElementById('app')!;

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: 0x4f9a3c,
    antialias: false,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  host.appendChild(app.canvas);

  const art = await loadArt();
  applyUiTheme(art?.ui ?? null);
  const renderer = new Renderer(app, art);
  app.renderer.on('resize', () => renderer.resize());

  const save = loadSave();
  const bgm = art ? new Bgm(art.bgm, save.settings.volume, save.settings.muted) : null;
  let mode: Mode = 'title';
  let sim = new Sim(1);
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

  function startRun(seed?: number) {
    sim = new Sim(seed ?? (Math.random() * 4294967296) >>> 0);
    sim.god = god;
    acc = 0;
    mode = 'playing';
    bgm?.play('run');
    screens.hideAll();
    hud.show(true);
  }

  function bank(quit: boolean) {
    save.mesos += sim.mesos;
    const best = !quit && sim.t > save.bestTime;
    if (sim.t > save.bestTime) save.bestTime = sim.t;
    writeSave(save);
    return best;
  }

  function endRun() {
    mode = 'ended';
    const best = bank(false);
    screens.showResults({ won: sim.won, time: sim.t, level: sim.level, kills: sim.kills, mesos: sim.mesos, bosses: sim.bossKills, best });
  }

  function toTitle() {
    sim = new Sim(1);
    mode = 'title';
    bgm?.play('title');
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
      start: () => startRun(),
      resume: () => setPaused(false),
      quit: () => { bank(true); toTitle(); },
      retry: () => startRun(),
      menu: () => toTitle(),
      pick: (i) => sim.pick(i),
      reroll: () => sim.reroll(),
      banish: (i) => sim.banish(i),
      volume: (v) => { save.settings.volume = v; writeSave(save); bgm?.setVolume(v); },
      mute: (m) => setMuted(m),
    },
    renderer.tex.icons,
  );
  function setMuted(m: boolean) {
    save.settings.muted = m;
    writeSave(save);
    bgm?.setMuted(m);
    screens.setMuted(m);
    hud.setMuted(m);
  }
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
      if (autopick && sim.offer) sim.pick(0);
      acc = Math.min(acc + dt * speed, 0.25 * Math.max(1, speed));
      let guard = Math.ceil(12 * Math.max(1, speed));
      while (acc >= TICK && guard-- > 0 && !sim.over) {
        if (sim.offer) { if (autopick) sim.pick(0); else break; }
        applyInput();
        sim.tick(TICK);
        acc -= TICK;
      }
      if (sim.offer) acc = 0;
      if (sim.over) endRun();
    }
    renderer.render(sim, dt);
    if (mode !== 'title') {
      hud.update(sim);
      screens.syncLevelUp(sim);
    }
  });

  if (import.meta.env.DEV || /[?&]bot\b/.test(location.search)) {
    const api = {
      get sim() { return sim; },
      start: (seed?: number) => startRun(seed),
      step(seconds: number) {
        const n = Math.round(seconds * 60);
        for (let i = 0; i < n && !sim.over; i++) {
          if (sim.offer) { if (autopick) sim.pick(0); else break; }
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
      /** what real Maple art was loaded (null = placeholders) */
      maple: () => (art ? { ...art.counts, bgm: art.bgm, ground: !!art.map?.ground, levelUp: !!art.levelUp } : null),
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
