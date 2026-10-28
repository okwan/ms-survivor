/**
 * Background music: a title track, a run track and (optionally) one track per run region, looped. Browsers refuse to start audio
 * before a user gesture, so playback is armed on the first pointer/key/touch event and retried on the next one if the browser
 * still says no. Moving between run tracks (a region change) cross-fades over FADE seconds; the title track switches instantly.
 */
export type Track = 'title' | 'run';

const FADE = 1.5;

interface Entry {
  el: HTMLAudioElement;
  /** 0..1 share of the master volume this track plays at */
  level: number;
}

export class Bgm {
  /** by URL, so regions sharing a file share one element */
  private els = new Map<string, Entry>();
  private urls: { run: string | null; title: string | null };
  private regionUrls: (string | null)[];
  private region = 0;
  private want: Track | null = null;
  private unlocked = false;
  private volume: number;
  private muted: boolean;
  private timer = 0;

  constructor(urls: { run: string | null; title: string | null }, volume: number, muted: boolean, regions: (string | null)[] = []) {
    this.urls = urls;
    this.regionUrls = regions;
    this.volume = volume;
    this.muted = muted;
    for (const url of new Set([urls.title, urls.run, ...regions])) if (url) this.add(url);
    if (this.els.size) this.arm();
  }

  private add(url: string) {
    const el = new Audio(url);
    el.loop = true;
    el.preload = 'none';
    el.addEventListener('error', () => this.els.delete(url));
    this.els.set(url, { el, level: 0 });
  }

  get available(): boolean {
    return this.els.size > 0;
  }

  private arm() {
    const go = () => {
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, go, true);
      this.unlocked = true;
      this.apply(true);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, go, true);
  }

  /** the URL that should be audible now */
  private target(): string | null {
    if (this.want === 'title') return this.urls.title;
    if (this.want === 'run') return this.regionUrls[this.region] ?? this.urls.run;
    return null;
  }

  play(t: Track) {
    // the title track and the run music never overlap: switching to or from the title is instant
    const instant = t === 'title' || this.want === 'title' || this.want === null;
    this.want = t;
    if (this.unlocked) this.apply(instant);
  }

  /** A new region starts: cross-fade to its track (or keep playing when it shares the current one). */
  setRegion(i: number) {
    this.region = i;
    if (this.unlocked && this.want === 'run') this.apply(false);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.apply(true);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.apply(true);
  }

  private apply(instant: boolean) {
    const target = this.target();
    let fading = false;
    for (const [url, e] of this.els) {
      const on = url === target && this.unlocked;
      if (instant) e.level = on ? 1 : 0;
      else fading = fading || e.level !== (on ? 1 : 0);
      e.el.muted = this.muted;
      if (on && e.el.paused) {
        e.el.play().catch(() => {
          // still blocked: wait for another gesture
          this.unlocked = false;
          this.arm();
        });
      }
    }
    this.paint(target);
    if (fading && !this.timer) this.timer = window.setInterval(() => this.step(), 50);
  }

  private step() {
    const target = this.target();
    const d = 0.05 / FADE;
    let moving = false;
    for (const [url, e] of this.els) {
      const goal = url === target && this.unlocked ? 1 : 0;
      if (e.level < goal) e.level = Math.min(goal, e.level + d);
      else if (e.level > goal) e.level = Math.max(goal, e.level - d);
      if (e.level !== goal) moving = true;
    }
    this.paint(target);
    if (!moving) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private paint(target: string | null) {
    for (const [url, e] of this.els) {
      e.el.volume = Math.max(0, Math.min(1, this.volume * e.level));
      if (e.level === 0 && url !== target && !e.el.paused) {
        e.el.pause();
        e.el.currentTime = 0;
      }
    }
  }
}
