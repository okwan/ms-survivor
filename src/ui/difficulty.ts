import { DIFFICULTIES } from '../game/data.ts';

const CSS = `
.dpick { display: flex; flex-direction: column; gap: 4px; align-items: stretch; margin: 6px 0; pointer-events: auto; }
.dpick-row { display: flex; gap: 4px; }
.dpick-b { flex: 1 1 0; min-width: 0; min-height: 40px; padding: 4px 2px; font: 900 13px var(--font); color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,.4); cursor: pointer; border-radius: 8px; border: 2px solid #fff; background: linear-gradient(#7ab8f5, #2d6fd0); outline: 0; }
.dpick-b:disabled { filter: grayscale(.9); opacity: .55; cursor: default; }
.dpick-b.sel { background: linear-gradient(#ffb23f, #e57400); box-shadow: 0 0 0 2px #a65200; }
.dpick-d { font: bold 12px var(--font); text-align: center; color: #ffe27a; text-shadow: 0 1px 0 rgba(0,0,0,.5); min-height: 2.4em; }
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
