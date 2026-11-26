import { sound } from './sound.js';

/* Night mode for the whole page, switched by the desk lamp.
   Lives outside the 3D scene so the buttons still work if WebGL doesn't. */

const KEY = 'dtj-lamp';

export function initNight({ reduced = false } = {}) {
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('[data-lamp-toggle]')];
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  // a visitor's own choice wins; otherwise follow the system's dark mode
  let on = false;
  try {
    const saved = localStorage.getItem(KEY);
    on = saved ? saved === 'on' : matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    on = matchMedia('(prefers-color-scheme: dark)').matches;
  }

  const tape = (text) => window.dispatchEvent(new CustomEvent('receipt:tape', { detail: text }));

  function apply(next, { instant = false, announce = false } = {}) {
    on = next;
    root.classList.toggle('is-night', on);
    if (themeMeta) themeMeta.content = on ? '#1C201E' : '#D6DBD6';
    buttons.forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'Lamp on' : 'Lamp off';
    });
    window.dispatchEvent(new CustomEvent('lamp:change', { detail: { on, instant } }));
    if (announce) tape(on ? '> lamp on, working late' : '> lamp off, back to daylight');
  }

  function toggle() {
    sound.click();
    apply(!on, { announce: true, instant: reduced });
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* not persisted; fine */
    }
  }

  buttons.forEach((b) => b.addEventListener('click', toggle));
  window.addEventListener('lamp:toggle', toggle); // the 3D lamp was clicked

  apply(on, { instant: true });
  return { isOn: () => on };
}
