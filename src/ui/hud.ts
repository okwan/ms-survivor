import { BOSSES, MAX_PASSIVES, MAX_SKILLS, NOVA_CAST, PASSIVES, SKILL_BY_KEY } from '../game/data.ts';
import type { Sim } from '../game/sim.ts';
import { Radar } from './radar.ts';
import { theme } from './theme.ts';

export const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export class Hud {
  readonly root: HTMLDivElement;
  readonly radar: Radar;
  readonly pauseBtn: HTMLButtonElement;
  readonly muteBtn: HTMLButtonElement;
  private cache = new Map<HTMLElement, string>();
  private el: Record<string, HTMLElement> = {};
  private skillSlots: HTMLElement[] = [];
  private passiveSlots: HTMLElement[] = [];
  private icons: Record<string, string>;
  private shown = true;

  constructor(parent: HTMLElement, icons: Record<string, string>) {
    this.icons = icons;
    const r = (this.root = document.createElement('div'));
    r.className = 'hud';
    r.innerHTML = `
      <div class="hud-tl"><div class="pill"><b>KILLS</b> <span data-k="kills">0</span></div><div class="pill meso"><i class="coin"></i><span data-k="mesos">0</span></div></div>
      <div class="hud-top">
        <div class="clock" data-k="clock">0:00</div>
        <div class="nextboss" data-k="next">NEXT BOSS 2:15</div>
        <div class="bosspanel" data-k="bosspanel">
          <div class="bossname" data-k="bossname"></div>
          <div class="bar boss"><div class="fill" data-k="bossfill"></div><span data-k="bosstext"></span></div>
          <div class="bar cast" data-k="castbar"><div class="fill" data-k="castfill"></div><span>Ground Slam</span></div>
        </div>
      </div>
      <div class="hud-tr" data-k="tr"></div>
      <div class="raid" data-k="raid"></div>
      <div class="hud-skills"><div class="slots" data-k="skills"></div><div class="slots passive" data-k="passives"></div></div>
      <div class="statusbar">
        <div class="lvbox"><small>LV</small><b data-k="lv">1</b></div>
        <div class="bar hp"><div class="fill" data-k="hpfill"></div><span data-k="hptext">120 / 120</span></div>
        <div class="bar exp"><div class="fill" data-k="expfill"></div><span data-k="exptext"></span></div>
      </div>`;
    parent.appendChild(r);
    r.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k!] = e));
    this.radar = new Radar(this.el.tr);
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'pausebtn';
    this.pauseBtn.textContent = 'II';
    this.pauseBtn.title = 'Pause (Esc)';
    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'pausebtn mutebtn';
    this.muteBtn.textContent = 'M';
    this.muteBtn.title = 'Mute music';
    const btns = document.createElement('div');
    btns.className = 'hud-btns';
    btns.append(this.muteBtn, this.pauseBtn);
    this.el.tr.appendChild(btns);
    for (let i = 0; i < MAX_SKILLS; i++) this.skillSlots.push(this.makeSlot(this.el.skills));
    for (let i = 0; i < MAX_PASSIVES; i++) this.passiveSlots.push(this.makeSlot(this.el.passives));
  }

  private makeSlot(parent: HTMLElement): HTMLElement {
    const s = document.createElement('div');
    s.className = 'slot empty';
    s.innerHTML = '<img alt=""><em></em>';
    parent.appendChild(s);
    return s;
  }

  private text(el: HTMLElement, v: string) {
    if (this.cache.get(el) !== v) { this.cache.set(el, v); el.textContent = v; }
  }
  private width(el: HTMLElement, pct: number) {
    const v = pct.toFixed(1) + '%';
    if (this.cache.get(el) !== v) { this.cache.set(el, v); el.style.width = v; }
  }
  /** like text() but for markup built from our own digit images; cached so the DOM is touched only on change */
  private html(el: HTMLElement, v: string) {
    if (this.cache.get(el) !== v) { this.cache.set(el, v); el.innerHTML = v; }
  }
  private disp(el: HTMLElement, show: boolean) {
    const v = show ? 'b' : 'n';
    if (this.cache.get(el) !== v) { this.cache.set(el, v); el.style.display = show ? '' : 'none'; }
  }
  private fillSlot(slot: HTMLElement, key: string | null, level: number) {
    const k = key ? key + level : '';
    if (this.cache.get(slot) === k) return;
    this.cache.set(slot, k);
    slot.classList.toggle('empty', !key);
    const img = slot.firstElementChild as HTMLImageElement;
    if (key) {
      img.src = this.icons[key] ?? '';
      slot.title = SKILL_BY_KEY[key]?.name ?? PASSIVES.find((p) => p.key === key)?.name ?? key;
      slot.lastElementChild!.textContent = String(level);
    } else {
      img.removeAttribute('src');
      slot.lastElementChild!.textContent = '';
    }
  }

  setMuted(m: boolean) {
    this.muteBtn.classList.toggle('off', m);
    this.muteBtn.title = m ? 'Unmute music' : 'Mute music';
  }

  show(on: boolean) {
    if (on !== this.shown) { this.shown = on; this.root.style.display = on ? '' : 'none'; }
  }

  update(sim: Sim) {
    this.text(this.el.kills, String(sim.kills));
    this.text(this.el.mesos, String(sim.mesos));
    this.text(this.el.clock, fmtTime(sim.t));
    const nb = sim.nextBossIn();
    this.text(this.el.next, nb >= 0 ? `NEXT BOSS ${fmtTime(Math.ceil(nb))}` : `VICTORY IN ${fmtTime(Math.ceil(900 - sim.t))}`);
    this.el.next.classList.toggle('soon', nb >= 0 && nb < 10);

    const xp = sim.xp / sim.xpNeed;
    this.width(this.el.hpfill, (sim.hp / sim.maxHp) * 100);
    this.width(this.el.expfill, xp * 100);
    if (theme.active) {
      // MapleStory status bar: level in the big level digits, "HP [120/120]" and "EXP 1234[12.34%]" in the tiny bar digits
      this.html(this.el.lv, theme.lv(sim.level));
      this.html(this.el.hptext, theme.num(`HP [${Math.ceil(sim.hp)}/${Math.round(sim.maxHp)}]`));
      this.html(this.el.exptext, theme.num(`EXP ${Math.floor(sim.xp)}[${(xp * 100).toFixed(2)}%]`));
    } else {
      this.text(this.el.lv, String(sim.level));
      this.text(this.el.hptext, `${Math.ceil(sim.hp)} / ${Math.round(sim.maxHp)}`);
      this.text(this.el.exptext, `EXP ${Math.floor(sim.xp)} / ${sim.xpNeed} [${(xp * 100).toFixed(1)}%]`);
    }

    for (let i = 0; i < MAX_SKILLS; i++) {
      const s = sim.skills[i];
      this.fillSlot(this.skillSlots[i], s ? s.key : null, s ? s.level : 0);
    }
    for (let i = 0; i < MAX_PASSIVES; i++) {
      const s = sim.passives[i];
      this.fillSlot(this.passiveSlots[i], s ? s.key : null, s ? s.level : 0);
    }

    const b = sim.activeBoss();
    this.disp(this.el.bosspanel, !!b);
    if (b) {
      this.text(this.el.bossname, BOSSES[b.boss].name + (b.berserk ? '  (ENRAGED)' : ''));
      this.width(this.el.bossfill, (Math.max(0, b.hp) / b.maxHp) * 100);
      this.text(this.el.bosstext, `${Math.max(0, Math.ceil(b.hp))} / ${Math.ceil(b.maxHp)}`);
      this.disp(this.el.castbar, b.castT > 0);
      if (b.castT > 0) this.width(this.el.castfill, (1 - b.castT / NOVA_CAST) * 100);
    }

    const raidOn = sim.raidUntil > sim.t && sim.raidText !== '' && !sim.over;
    this.disp(this.el.raid, raidOn);
    if (raidOn) this.text(this.el.raid, sim.raidText);

    this.radar.draw(sim);
  }
}
