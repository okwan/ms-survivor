/** The map-name banner shown at the start of a run and at each region change (top centre, about 3 s). */
import './banner.css';

const SHOW_MS = 3000;

export class MapBanner {
  private el: HTMLDivElement;
  private street: HTMLDivElement;
  private name: HTMLDivElement;
  private timer = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'map-banner';
    this.street = document.createElement('div');
    this.street.className = 'street';
    this.name = document.createElement('div');
    this.name.className = 'name';
    const rule = document.createElement('div');
    rule.className = 'rule';
    this.el.append(this.street, this.name, rule);
    root.appendChild(this.el);
  }

  /** Shows the banner; with only one non-empty line that line is used as the big one. */
  show(street: string, name: string) {
    const big = name || street;
    this.street.textContent = name ? street : '';
    this.street.style.display = name && street ? '' : 'none';
    this.name.textContent = big;
    if (!big) return;
    this.el.classList.add('show');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), SHOW_MS);
  }

  hide() {
    window.clearTimeout(this.timer);
    this.el.classList.remove('show');
  }
}
