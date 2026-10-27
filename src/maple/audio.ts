/**
 * Background music: a title track and a run track, looped. Browsers refuse to start audio before a user gesture,
 * so playback is armed on the first pointer/key/touch event and retried on the next one if the browser still says no.
 */
export type Track = 'title' | 'run';

export class Bgm {
  private els = new Map<Track, HTMLAudioElement>();
  private want: Track | null = null;
  private unlocked = false;
  private volume: number;
  private muted: boolean;

  constructor(urls: { run: string | null; title: string | null }, volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    for (const t of ['title', 'run'] as const) {
      const url = urls[t];
      if (!url) continue;
      const el = new Audio(url);
      el.loop = true;
      el.preload = 'none';
      el.addEventListener('error', () => this.els.delete(t));
      this.els.set(t, el);
    }
    if (this.els.size) this.arm();
  }

  get available(): boolean {
    return this.els.size > 0;
  }

  private arm() {
    const go = () => {
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, go, true);
      this.unlocked = true;
      this.apply();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, go, true);
  }

  play(t: Track) {
    this.want = t;
    if (this.unlocked) this.apply();
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
    for (const [t, el] of this.els) {
      el.volume = this.volume;
      el.muted = this.muted;
      if (t === this.want && this.unlocked) {
        if (el.paused) {
          el.play().catch(() => {
            // still blocked: wait for another gesture
            this.unlocked = false;
            this.arm();
          });
        }
      } else if (!el.paused) {
        el.pause();
        el.currentTime = 0;
      }
    }
  }
}
