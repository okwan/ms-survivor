/**
 * Short messages from the sim (sim.notes): scroll results "<Item> +n" / "The scroll failed.", Monster Book "New card: <mob>".
 * Stacked above the status bar; nothing here pauses the game. The DOM is touched only when the set of notes changes.
 */
import type { Sim } from '../game/sim.ts';

export class NoteUi {
  private root: HTMLDivElement;
  private sig = '';
  private lastSim: Sim | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'notes';
    parent.appendChild(this.root);
  }

  reset() {
    this.sig = '';
    this.root.textContent = '';
    this.lastSim = null;
  }

  update(sim: Sim) {
    if (sim !== this.lastSim) {
      this.lastSim = sim;
      this.sig = '';
    }
    const live = sim.notes.filter((n) => n.until >= sim.t);
    const sig = live.map((n) => n.id).join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.textContent = '';
    for (const n of live) {
      const d = document.createElement('div');
      d.className = `note ${n.kind}`;
      d.textContent = n.text;
      this.root.appendChild(d);
    }
  }
}
