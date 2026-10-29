import { isTouch } from './touch.ts';

/** Keyboard (WASD/arrows) and a touch joystick (touch anywhere outside the UI and drag), with a faint ghost ring as a hint while idle. */
const R = 56;
const DEAD = 0.12;

/** true when a key event goes to a text field */
export const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

export class Input {
  private keys = new Set<string>();
  private joyId = -1;
  private joyX0 = 0;
  private joyY0 = 0;
  private joyX = 0;
  private joyY = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private ghost: HTMLDivElement;
  private hint = false;
  onPause: () => void = () => {};
  enabled = true;

  constructor(root: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    root.appendChild(this.base);
    this.ghost = document.createElement('div');
    this.ghost.className = 'joy-ghost';
    this.ghost.innerHTML = '<div class="joy-knob"></div>';
    root.appendChild(this.ghost);

    window.addEventListener('keydown', (e) => {
      // typing in a text field (the character name) must not steer the hero or have its WASD swallowed
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') { if (!e.repeat) this.onPause(); return; }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    const isUi = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('button, .screen, .win, .card, .mwin, .mtip, input, .gear-toast, .statusbar, .hud-btns');
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || this.joyId !== -1 || isUi(e.target)) return;
      this.joyId = e.pointerId;
      this.joyX0 = e.clientX; this.joyY0 = e.clientY;
      this.joyX = this.joyY = 0;
      this.base.style.display = 'block';
      this.showGhost();
      this.base.style.left = e.clientX + 'px';
      this.base.style.top = e.clientY + 'px';
      this.knob.style.transform = 'translate(-50%,-50%)';
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      let dx = e.clientX - this.joyX0, dy = e.clientY - this.joyY0;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      const m = Math.min(l, R) / R;
      if (m < DEAD) this.joyX = this.joyY = 0;
      else { const k = ((m - DEAD) / (1 - DEAD)) / Math.max(m, 1e-6); this.joyX = (dx / R) * k; this.joyY = (dy / R) * k; }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = -1; this.joyX = this.joyY = 0;
      this.base.style.display = 'none';
      this.showGhost();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** Shows the idle ghost ring (touch devices, during a run only). */
  setHint(on: boolean) {
    if (on === this.hint) return;
    this.hint = on;
    this.showGhost();
  }

  private showGhost() {
    this.ghost.style.display = this.hint && this.joyId === -1 && isTouch() ? 'block' : 'none';
  }

  /** Writes the movement vector (length <= 1) into out. */
  read(out: { x: number; y: number }) {
    let x = 0, y = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('a') || k.has('arrowleft')) x -= 1;
      if (k.has('d') || k.has('arrowright')) x += 1;
      if (k.has('w') || k.has('arrowup')) y -= 1;
      if (k.has('s') || k.has('arrowdown')) y += 1;
      if (x !== 0 && y !== 0) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      if (this.joyId !== -1) { x = this.joyX; y = this.joyY; }
    }
    out.x = x; out.y = y;
  }
}
