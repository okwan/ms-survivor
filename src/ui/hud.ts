import { EVOLUTION_PASSIVE_SLOTS } from '../game/evolutions.ts';
import { BOSSES, BOSS_BARS, CLASS_BY_KEY, JOB_BY_CODE, MAX_PASSIVES, MAX_SKILLS, NOVA_CAST, PASSIVES, SKILL_BY_KEY, skillCooldown } from '../game/data.ts';
import { AILMENTS } from '../game/ailments.ts';
import { FIELD_ITEMS } from '../game/fieldItems.ts';
import type { Sim } from '../game/sim.ts';
import { Radar } from './radar.ts';
import { statusScale } from './layout.ts';
import { theme } from './theme.ts';

/** Status bar theme per class: the hue of the EXP / level plate (warrior red, magician blue, bowman green, thief purple). */
export const JOB_HUE: Record<string, number> = { warrior: 355, magician: 215, bowman: 125, thief: 280 };

/** The window buttons of the status bar. */
export type BarWindow = 'equip' | 'inventory' | 'stats';

export const fmtTime = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** Timed field-item buffs shown under the kills pill: the field item and where its seconds left are kept (Sim.field) */
const BUFFS: { item: number; left: (s: Sim) => number }[] = [
  { item: 1, left: (s) => s.field.couponT },
  { item: 2, left: (s) => s.field.elixirT },
  { item: 3, left: (s) => s.field.clockT },
];

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
  /** a status bar button (Equip / Item / Stat) was pressed */
  onWindow: (w: BarWindow) => void = () => {};
  private skillCd: HTMLElement[] = [];
  private cls = '';

  constructor(parent: HTMLElement, icons: Record<string, string>) {
    this.icons = icons;
    const r = (this.root = document.createElement('div'));
    r.className = 'hud';
    r.innerHTML = `
      <div class="hud-tl"><div class="pill"><b>KILLS</b> <span data-k="kills">0</span></div><div class="pill meso"><i class="coin"></i><span data-k="mesos">0</span></div>
        <div class="buffs">${BUFFS.map((b, i) => `<div class="buff" data-k="buff${i}" title="${FIELD_ITEMS[b.item].name}"><img alt="" data-k="bufficon${i}"><b data-k="bufftime${i}"></b></div>`).join('')}
          ${AILMENTS.map((a) => `<div class="buff ail" data-k="ail${a.id}" title="${a.name}: ${a.desc}" style="border-color:${a.color}"><img alt="" data-k="ailicon${a.id}"><b data-k="ailtime${a.id}"></b></div>`).join('')}</div></div>
      <div class="vignette" data-k="vignette"></div>
      <div class="hud-top">
        <div class="clock" data-k="clock">0:00</div>
        <div class="nextboss" data-k="next">NEXT BOSS 2:15</div>
        <div class="bosspanel" data-k="bosspanel">
          ${[0, 1, 2].map((i) => `<div class="bossrow" data-k="bossrow${i}">
            <div class="bossname" data-k="bossname${i}"></div>
            <div class="bar boss"><div class="fill" data-k="bossfill${i}"></div><span data-k="bosstext${i}"></span></div>
          </div>`).join('')}
          <div class="bar cast" data-k="castbar"><div class="fill" data-k="castfill"></div><span>Ground Slam</span></div>
        </div>
      </div>
      <div class="hud-tr" data-k="tr"></div>
      <div class="raid" data-k="raid"></div>
      <div class="statusbar" data-k="sb" data-job="magician">
        <div class="sb-inner">
          <div class="sb-plate">
            <div class="sb-jobicon"><img alt="" data-k="jobicon"></div>
            <div class="lvbox"><small>LV.</small><b data-k="lv">1</b></div>
            <div class="sb-names"><b data-k="job">Magician</b><span data-k="hname">Maple</span></div>
          </div>
          <div class="sb-gauges">
            <div class="bar hp"><div class="fill" data-k="hpfill"></div><span data-k="hptext">120 / 120</span></div>
            <div class="bar mp"><div class="fill" data-k="mpfill"></div><span data-k="mptext"></span></div>
          </div>
          <div class="sb-btns">
            <button class="sbtn" data-w="equip" title="Equip (Q)"><i>Equip</i></button>
            <button class="sbtn" data-w="inventory" title="Inventory (I)"><i>Item</i></button>
            <button class="sbtn" data-w="stats" title="Stats (C)"><i>Stat</i></button>
          </div>
          <div class="sb-quick"><div class="slots" data-k="skills"></div><div class="slots passive" data-k="passives"></div></div>
        </div>
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
    r.querySelectorAll<HTMLButtonElement>('.sbtn').forEach((b) => b.addEventListener('click', () => this.onWindow(b.dataset.w as BarWindow)));
    const fit = () => document.documentElement.style.setProperty('--sbs', String(statusScale(window.innerWidth)));
    fit();
    window.addEventListener('resize', fit);
    for (let i = 0; i < MAX_SKILLS; i++) { const sl = this.makeSlot(this.el.skills); this.skillSlots.push(sl); this.skillCd.push(sl.querySelector('.cd')!); }
    for (let i = 0; i < MAX_PASSIVES + EVOLUTION_PASSIVE_SLOTS; i++) this.passiveSlots.push(this.makeSlot(this.el.passives));
  }

  private makeSlot(parent: HTMLElement): HTMLElement {
    const s = document.createElement('div');
    s.className = 'slot empty';
    s.innerHTML = '<img alt=""><em></em><span class="cd"></span>';
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
      slot.children[1].textContent = String(level);
    } else {
      img.removeAttribute('src');
      slot.children[1].textContent = '';
    }
  }

  private cdFill(el: HTMLElement | undefined, ready: number) {
    if (!el) return;
    const v = ready >= 0.999 ? '0%' : ((1 - ready) * 100).toFixed(0) + '%';
    if (this.cache.get(el) !== v) { this.cache.set(el, v); el.style.height = v; }
  }

  /** The hero's name and class: tints the EXP bar and the level plate and sets the class icon. */
  setHero(name: string, cls: string) {
    this.text(this.el.hname, name);
    this.setClass(cls);
  }

  private setClass(cls: string) {
    if (cls === this.cls) return;
    this.cls = cls;
    const sb = this.el.sb;
    sb.dataset.job = cls;
    sb.style.setProperty('--job-hue', String(JOB_HUE[cls] ?? 215));
    const def = CLASS_BY_KEY[cls];
    const img = this.el.jobicon as HTMLImageElement;
    const k = def?.skills[0];
    if (k && this.icons[k]) img.src = this.icons[k];
    else img.removeAttribute('src');
    this.text(this.el.job, def?.name ?? cls);
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
    this.setClass(sim.cls.key);
    // MP shows how ready the active skills are (average of 1 - cooldown left / cooldown)
    let ready = 0;
    for (let i = 0; i < sim.skills.length; i++) {
      const sk = sim.skills[i];
      const def = SKILL_BY_KEY[sk.key];
      const r = def ? 1 - Math.max(0, Math.min(1, sk.cd / skillCooldown(def, sk.level, sim.haste))) : 1;
      ready += r;
      this.cdFill(this.skillCd[i], r);
    }
    for (let i = sim.skills.length; i < MAX_SKILLS; i++) this.cdFill(this.skillCd[i], 1);
    const mp = sim.skills.length ? ready / sim.skills.length : 1;
    this.width(this.el.hpfill, (sim.hp / sim.maxHp) * 100);
    this.width(this.el.mpfill, mp * 100);
    this.width(this.el.expfill, xp * 100);
    const job = JOB_BY_CODE[sim.jobs[sim.jobs.length - 1]]?.name ?? sim.cls.name;
    this.text(this.el.job, job);
    if (theme.active) {
      // MapleStory status bar: level in the big level digits, "HP [120/120]" and "EXP 1234[12.34%]" in the tiny bar digits
      this.html(this.el.lv, theme.lv(sim.level));
      this.html(this.el.hptext, theme.num(`HP [${Math.ceil(sim.hp)}/${Math.round(sim.maxHp)}]`));
      this.html(this.el.mptext, theme.num(`MP [${Math.round(mp * 100)}/100]`));
      this.html(this.el.exptext, theme.num(`EXP ${Math.floor(sim.xp)}[${(xp * 100).toFixed(2)}%]`));
    } else {
      this.text(this.el.lv, String(sim.level));
      this.text(this.el.hptext, `${Math.ceil(sim.hp)} / ${Math.round(sim.maxHp)}`);
      this.text(this.el.mptext, `MP ${Math.round(mp * 100)}%`);
      this.text(this.el.exptext, `EXP ${Math.floor(sim.xp)} / ${sim.xpNeed} [${(xp * 100).toFixed(1)}%]`);
    }

    for (let i = 0; i < MAX_SKILLS; i++) {
      const s = sim.skills[i];
      this.fillSlot(this.skillSlots[i], s ? s.key : null, s ? s.level : 0);
    }
    for (let i = 0; i < MAX_PASSIVES + EVOLUTION_PASSIVE_SLOTS; i++) {
      const s = sim.passives[i];
      this.fillSlot(this.passiveSlots[i], s ? s.key : null, s ? s.level : 0);
    }

    // one health bar per living boss (oldest first, at most BOSS_BARS); the ground-slam cast bar follows the first one that is casting
    const bs = sim.activeBosses(BOSS_BARS);
    this.disp(this.el.bosspanel, bs.length > 0);
    let casting: (typeof bs)[number] | null = null;
    for (let i = 0; i < BOSS_BARS; i++) {
      const b = bs[i];
      this.disp(this.el['bossrow' + i], !!b);
      if (!b) continue;
      this.text(this.el['bossname' + i], BOSSES[b.boss].name + (b.berserk ? '  (ENRAGED)' : ''));
      this.width(this.el['bossfill' + i], (Math.max(0, b.hp) / b.maxHp) * 100);
      this.text(this.el['bosstext' + i], `${Math.max(0, Math.ceil(b.hp))} / ${Math.ceil(b.maxHp)}`);
      if (!casting && b.castT > 0) casting = b;
    }
    this.disp(this.el.castbar, !!casting);
    if (casting) this.width(this.el.castfill, (1 - casting.castT / NOVA_CAST) * 100);

    const raidOn = sim.raidUntil > sim.t && sim.raidText !== '' && !sim.over;
    this.disp(this.el.raid, raidOn);
    if (raidOn) this.text(this.el.raid, sim.raidText);

    // active field-item buffs: small icon with the seconds left
    for (let i = 0; i < BUFFS.length; i++) {
      const left = BUFFS[i].left(sim);
      const on = left > 0;
      this.disp(this.el['buff' + i], on);
      if (!on) continue;
      const img = this.el['bufficon' + i] as HTMLImageElement;
      const src = this.icons['field' + BUFFS[i].item] ?? '';
      if (this.cache.get(img) !== src) { this.cache.set(img, src); img.src = src; }
      this.text(this.el['bufftime' + i], String(Math.ceil(left)));
      this.el['buff' + i].classList.toggle('low', left < 5);
    }

    // ailments: a chip with the seconds left each; Darkness also darkens the screen edges
    for (const a of AILMENTS) {
      const left = sim.ail.left[a.id];
      const on = left > 0;
      this.disp(this.el['ail' + a.id], on);
      if (!on) continue;
      const img = this.el['ailicon' + a.id] as HTMLImageElement;
      const src = this.icons['ail' + a.id] ?? '';
      if (this.cache.get(img) !== src) { this.cache.set(img, src); img.src = src; }
      this.text(this.el['ailtime' + a.id], String(Math.ceil(left)));
      this.el['ail' + a.id].classList.toggle('low', left < 1.5);
    }
    this.el.vignette.classList.toggle('on', sim.ail.dark);

    this.radar.draw(sim);
  }
}
