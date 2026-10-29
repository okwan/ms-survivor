import { DIFFICULTIES } from '../game/data.ts';

const CSS = `
.dpick { display: flex; flex-direction: column; gap: 4px; align-items: stretch; margin: 6px 0; pointer-events: auto; }
.dpick-row { display: flex; gap: 4px; }
.dpick-b { flex: 1 1 0; min-width: 0; min-height: 36px; padding: 4px 2px; font: 900 13px var(--font); color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,.35); cursor: pointer; border-radius: 7px; border: 1px solid #1d4a96; background: linear-gradient(#5b9ff0, #2c66c6); box-shadow: inset 0 1px 0 rgba(255,255,255,.35); transition: filter .12s; }
.dpick-b:hover:not(:disabled) { filter: brightness(1.1); }
.dpick-b:focus-visible { outline: 2px solid #ffe27a; outline-offset: 1px; }
.dpick-b:disabled { background: #b9bfcc; border-color: #a2a9ba; color: #eef0f4; text-shadow: none; box-shadow: none; cursor: default; }
.dpick-b.sel { background: linear-gradient(#ffb547, #f07c12); border-color: #b45708; }
.dpick-d { font: bold 12px var(--font); text-align: center; color: inherit; opacity: .85; min-height: 2.4em; }
`;

/** A compact row of the difficulty tiers (locked ones disabled) with the selected tier's description underneath; self-contained and styled here. */
export function difficultyPicker(onPick: (i: number) => void): { el: HTMLElement; set(selected: number, cleared: number): void } {
  if (!document.getElementById('dpick-css')) {
    const st = document.createElement('style');
    st.id = 'dpick-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'dpick';
  const row = document.createElement('div');
  row.className = 'dpick-row';
  const desc = document.createElement('div');
  desc.className = 'dpick-d';
  const btns = DIFFICULTIES.map((_, i) => {
    const b = document.createElement('button');
    b.className = 'dpick-b';
    b.addEventListener('click', () => onPick(i));
    row.appendChild(b);
    return b;
  });
  el.append(row, desc);
  return {
    el,
    set(selected, cleared) {
      btns.forEach((b, i) => {
        const locked = i > cleared + 1;
        b.disabled = locked;
        b.textContent = locked ? `\u{1F512} ${DIFFICULTIES[i].name}` : DIFFICULTIES[i].name;
        b.title = locked ? `Clear ${DIFFICULTIES[i - 1].name} to unlock` : DIFFICULTIES[i].desc;
        b.classList.toggle('sel', i === selected);
      });
      desc.textContent = DIFFICULTIES[Math.max(0, Math.min(DIFFICULTIES.length - 1, selected))].desc;
    },
  };
}
