/**
 * MapleStory UI pieces (UI.wz, extracted to maple/ui/*.png) exposed to the DOM UI: CSS custom properties with the image URLs
 * plus feature classes on <html> (ms-sb, ms-win, ms-btn...), so style.css only applies the real art for pieces that exist and
 * keeps the plain CSS look for everything else. With no manifest nothing is set and the page looks as before.
 */
import type { UiArt } from '../maple/art.ts';

const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

class Theme {
  art: UiArt | null = null;

  get active(): boolean {
    return !!this.art;
  }

  has(name: string): boolean {
    return !!this.art?.pieces[name];
  }

  url(name: string): string {
    const p = this.art?.pieces[name];
    return p ? this.art!.base + p.src : '';
  }

  private img(name: string, scale: number): string {
    const p = this.art!.pieces[name];
    return `<img src="${this.art!.base + p.src}" alt="" style="width:${p.w * scale}px;height:${p.h * scale}px">`;
  }

  /** Status bar digits as images: "EXP 1234[12.34%]". Letters stay text (the real bar has them baked into the background). */
  num(text: string, scale = 2): string {
    if (!this.art || !this.has('sb.n.0')) return esc(text);
    let out = '';
    for (const ch of text) {
      if (ch >= '0' && ch <= '9') out += this.has(`sb.n.${ch}`) ? this.img(`sb.n.${ch}`, scale) : ch;
      else if (ch === '/' && this.has('sb.n.slash')) out += this.img('sb.n.slash', scale);
      else if (ch === '%' && this.has('sb.n.percent')) out += this.img('sb.n.percent', scale);
      else if (ch === '[' && this.has('sb.n.Lbracket')) out += this.img('sb.n.Lbracket', scale);
      else if (ch === ']' && this.has('sb.n.Rbracket')) out += this.img('sb.n.Rbracket', scale);
      else if (ch === '.') out += `<i class="dot" style="width:${scale}px;height:${scale}px"></i>`;
      else if (ch === ' ') out += `<i class="sp" style="width:${scale * 3}px"></i>`;
      else out += `<b class="lt">${esc(ch)}</b>`;
    }
    return `<span class="mnum">${out}</span>`;
  }

  /** The level as MapleStory's big level digits. */
  lv(n: number, scale = 2): string {
    if (!this.art || !this.has('lv.0')) return String(n);
    let out = '';
    for (const ch of String(n)) out += this.has(`lv.${ch}`) ? this.img(`lv.${ch}`, scale) : ch;
    return `<span class="mnum">${out}</span>`;
  }
}

export const theme = new Theme();

/** Sets the CSS variables and feature classes for the pieces that exist. Safe to call with null. */
export function applyUiTheme(ui: UiArt | null) {
  theme.art = ui;
  if (!ui) return;
  try {
    const root = document.documentElement;
    const st = root.style;
    const set = (cls: string, on: boolean) => on && root.classList.add(cls);
    // absolute URLs: a url() inside a custom property resolves against the stylesheet that uses it, not the page
    const abs = (rel: string) => new URL(rel, document.baseURI).href;
    const url = (n: string) => `url("${abs(theme.url(n))}")`;
    const P = ui.pieces;
    for (const [name, p] of Object.entries(P)) {
      const id = name.replace(/\./g, '-');
      st.setProperty(`--u-${id}`, `url("${abs(ui.base + p.src)}")`);
      st.setProperty(`--u-${id}-w`, `${p.w}px`);
      st.setProperty(`--u-${id}-h`, `${p.h}px`);
    }
    root.classList.add('ms-ui');
    // cursor: the WZ origin is the hot spot
    for (const [n, v] of [['0', '--cur0'], ['1', '--cur1']] as const) {
      const p = P[`cur.${n}`];
      if (p) st.setProperty(v, `${url(`cur.${n}`)} ${Math.max(0, Math.min(p.w - 1, Math.abs(p.ox)))} ${Math.max(0, Math.min(p.h - 1, Math.abs(p.oy)))}, auto`);
    }
    if (!P['cur.1'] && P['cur.0']) st.setProperty('--cur1', st.getPropertyValue('--cur0'));
    set('ms-cur', !!P['cur.0']);
    set('ms-sb', !!P['sb.fill']);
    set('ms-hp', !!P['sb.hp']);
    const exp = P['sb.exp'] ? 'sb.exp' : P['sb.expGreen'] ? 'sb.expGreen' : P['sb.tempExp'] ? 'sb.tempExp' : '';
    if (exp) { st.setProperty('--u-expfill', url(exp)); st.setProperty('--u-expfill-h', `${P[exp].h}px`); st.setProperty('--u-expfill-size', P[exp].w <= 2 ? '100% 100%' : 'auto 100%'); root.classList.add('ms-exp'); }
    set('ms-gray', !!P['sb.gray']);
    set('ms-num', !!P['sb.n.0'] && !!P['sb.n.9']);
    set('ms-lv', !!P['lv.0'] && !!P['lv.9']);
    set('ms-menu', !!P['sb.menu.normal']);
    set('ms-logo', !!P['title.logo']);
    set('ms-slider', !!P['sl.mid'] && !!P['sl.thumb']);
    // 3-part window frame: top | centre | bottom stacked in one PNG
    const win = ['win.notice2', 'win.yesno2', 'win.notice3', 'win.yesno3'].find((n) => P[n]?.meta);
    if (win) {
      const m = P[win].meta!;
      st.setProperty('--win-img', url(win));
      st.setProperty('--win-top', String(m.top));
      st.setProperty('--win-bottom', String(m.bottom));
      st.setProperty('--win-side', String(Math.min(14, Math.floor(P[win].w / 6))));
      root.classList.add('ms-win');
    }
    // blank buttons (cap | column | cap), primary from OK, secondary from Cancel
    const okB = P['btn.ok.normal'], noB = P['btn.cancel.normal'];
    if (okB?.meta && noB?.meta) {
      for (const [k, base] of [['ok', 'btn.ok'], ['no', 'btn.cancel']] as const)
        for (const [s, suffix] of [['n', 'normal'], ['h', 'hover'], ['p', 'pressed'], ['d', 'disabled']] as const) {
          const src = P[`${base}.${suffix}`] ? `${base}.${suffix}` : `${base}.normal`;
          st.setProperty(`--btn-${k}-${s}`, url(src));
        }
      st.setProperty('--btn-cap', String(Math.max(okB.meta.cap, noB.meta.cap)));
      st.setProperty('--btn-h', `${okB.h * 2}px`);
      root.classList.add('ms-btn');
    }
  } catch (e) {
    console.warn('ui theme failed', e);
  }
}
