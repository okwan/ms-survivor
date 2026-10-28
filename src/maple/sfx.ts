/**
 * Sound effects (Sound.wz extracts, manifest `sfx`): Web Audio, started by the first user gesture like Bgm. A sound is fetched and
 * decoded the first time it is asked for and plays once it is ready. Mass hits are tamed three ways: the same key may not restart
 * within its interval (45 ms by default), at most 4 voices per key and 14 overall play at once, and every voice gets a small random
 * playback-rate jitter so simultaneous hits do not phase into one buzz.
 */
import { BOSSES, LADDER, SKILL_BY_KEY } from '../game/data.ts';
import { GEM } from '../game/types.ts';
import type { SimEvent } from '../game/types.ts';

export interface PlayOpts {
  volume?: number;
  rate?: number;
}

/** What the event mapper needs from a player (Sfx, or a fake in tests). */
export interface SfxLike {
  has(key: string): boolean;
  play(key: string, opts?: PlayOpts): void;
}

const MIN_INTERVAL_MS = 45;
const MAX_PER_KEY = 4;
const MAX_VOICES = 14;
const JITTER = 0.05;
/** keys with their own minimum interval (ms) */
const INTERVALS: Record<string, number> = { 'game.pickup': 80 };

/** Pure bookkeeping for the throttle rules, so Node tests can run it without audio. */
export class VoiceLimiter {
  private last = new Map<string, number>();
  private active = new Map<string, number>();
  private total = 0;

  /** True (and the voice is counted) when `key` may start at `now` ms. Call end(key) when the voice finishes. */
  tryStart(key: string, now: number): boolean {
    const last = this.last.get(key);
    if (last !== undefined && now - last < (INTERVALS[key] ?? MIN_INTERVAL_MS)) return false;
    const n = this.active.get(key) ?? 0;
    if (n >= MAX_PER_KEY || this.total >= MAX_VOICES) return false;
    this.last.set(key, now);
    this.active.set(key, n + 1);
    this.total++;
    return true;
  }

  end(key: string) {
    const n = this.active.get(key) ?? 0;
    if (n > 0) {
      this.active.set(key, n - 1);
      this.total--;
    }
  }

  get voices(): number {
    return this.total;
  }
}

export class Sfx implements SfxLike {
  private urls: Record<string, string>;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer | null>();
  private loading = new Set<string>();
  private limiter = new VoiceLimiter();
  private volume: number;
  private muted: boolean;
  /** start times (ms) of the last plays, a ring buffer for the bot hook */
  private recent = new Float64Array(64);
  private recentN = 0;
  private loaded = 0;

  constructor(urls: Record<string, string>, volume: number, muted: boolean) {
    this.urls = urls;
    this.volume = volume;
    this.muted = muted;
    if (Object.keys(urls).length) this.arm();
  }

  private arm() {
    const go = () => {
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, go, true);
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.apply();
        void this.ctx.resume();
      } catch {
        this.ctx = null;
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, go, true);
  }

  has(key: string): boolean {
    return key in this.urls && this.buffers.get(key) !== null;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.apply();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.apply();
  }

  private apply() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  play(key: string, opts: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || this.volume <= 0 || !(key in this.urls)) return;
    const buf = this.buffers.get(key);
    if (buf === null) return;
    if (buf === undefined) {
      this.load(key, opts);
      return;
    }
    this.start(key, buf, opts);
  }

  private load(key: string, opts: PlayOpts) {
    if (this.loading.has(key)) return;
    this.loading.add(key);
    const t0 = performance.now();
    void (async () => {
      try {
        const res = await fetch(this.urls[key]);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(key, buf);
        this.loaded++;
        // the sound was wanted just now: play it unless it took so long that it would be out of sync
        if (performance.now() - t0 < 300) this.start(key, buf, opts);
      } catch {
        this.buffers.set(key, null);
      } finally {
        this.loading.delete(key);
      }
    })();
  }

  private start(key: string, buf: AudioBuffer, opts: PlayOpts) {
    const ctx = this.ctx!;
    const now = performance.now();
    if (!this.limiter.tryStart(key, now)) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * (1 - JITTER + Math.random() * 2 * JITTER);
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g);
    g.connect(this.master!);
    src.onended = () => {
      this.limiter.end(key);
      src.disconnect();
      g.disconnect();
    };
    src.start();
    this.recent[this.recentN++ & 63] = now;
  }

  /** For the bot hook: how many sounds can play, and how many started in the last second. */
  stats() {
    const now = performance.now();
    let last = 0;
    for (let i = 0; i < 64; i++) if (now - this.recent[i] < 1000 && this.recent[i] > 0) last++;
    return { keys: Object.keys(this.urls).length, loaded: this.loaded, playsLastSecond: last, voices: this.limiter.voices, running: this.ctx?.state === 'running' };
  }
}

/**
 * Turns a batch of sim events into sounds (the sim stays free of audio): cast -> skill use (bolts once per volley), hit -> skill
 * hit or else the mob's damage sound (quiet), death -> mob die, boss spawn -> loud, level up, pickups, region change.
 * `cls` is the hero's class key, for the weapon sound a skill without its own falls back to.
 */
export function playSimEvents(sfx: SfxLike, events: readonly SimEvent[], cls: string): void {
  let bolt: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    switch (e.type) {
      case 'cast': {
        if (e.kind === 'bolt') {
          if (bolt === e.skill) break;
          bolt = e.skill;
        }
        const id = SKILL_BY_KEY[e.skill]?.id;
        const use = `skill.${id}.use`;
        if (id !== undefined && sfx.has(use)) sfx.play(use, { volume: 0.8 });
        else if (e.kind === 'melee' || e.kind === 'cone') sfx.play(`weapon.${cls}.attack`, { volume: 0.7 });
        break;
      }
      case 'hit': {
        const id = SKILL_BY_KEY[e.skill]?.id;
        const hit = `skill.${id}.hit`;
        if (id !== undefined && sfx.has(hit)) sfx.play(hit, { volume: 0.5 });
        else {
          const mob = e.bossIdx >= 0 ? BOSSES[e.bossIdx]?.id : LADDER[e.tier]?.id;
          if (mob !== undefined) sfx.play(`mob.${mob}.damage`, { volume: 0.5 });
        }
        break;
      }
      case 'death': {
        const mob = e.boss >= 0 ? BOSSES[e.boss]?.id : LADDER[e.tier]?.id;
        if (mob !== undefined) sfx.play(`mob.${mob}.die`, { volume: e.boss >= 0 ? 1 : 0.6 });
        break;
      }
      case 'bossSpawn': {
        const mob = BOSSES[e.boss]?.id;
        if (mob !== undefined) sfx.play(sfx.has(`mob.${mob}.attack`) ? `mob.${mob}.attack` : `mob.${mob}.die`, { volume: 1 });
        break;
      }
      case 'levelUp':
        sfx.play('game.levelup', { volume: 0.9 });
        break;
      case 'revive':
        sfx.play('game.levelup', { volume: 1 });
        break;
      case 'gacha':
        sfx.play(e.count >= 5 ? 'game.levelup' : 'game.drop', { volume: 0.9 });
        break;
      case 'pickup':
        sfx.play('game.pickup', { volume: e.kind === GEM ? 0.2 : 0.35 });
        break;
      case 'region':
        sfx.play('game.portal', { volume: 0.8 });
        break;
      case 'elite':
      case 'swarm':
        sfx.play('game.portal', { volume: 0.6 });
        break;
      case 'box':
        sfx.play('game.drop', { volume: 0.6 });
        break;
      default:
        break;
    }
  }
}
