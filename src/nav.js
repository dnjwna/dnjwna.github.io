import { sound } from './sound.js';

const GLYPHS = '#*+=:%-.';
const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function initNav({ reduced = false } = {}) {
  const nav = document.getElementById('nav');
  const linkWrap = nav.querySelector('.nav__links');
  const links = [...linkWrap.querySelectorAll('a[data-section]')];
  const ink = linkWrap.querySelector('.nav__ink');
  const tape = document.getElementById('tape');
  const tapeFill = document.getElementById('tapeFill');
  const tapePct = document.getElementById('tapePct');
  const sections = links
    .map((a) => document.getElementById(a.dataset.section))
    .filter(Boolean);

  initClock();
  initSound();
  initScramble(links, reduced);
  const menu = initMenu({ reduced });
  initShortcuts(sections, menu);

  /* ---- active section, ink bar, tape line, tuck-on-scroll ---------------- */
  let active = null;
  let lastY = window.scrollY;
  // mobile pins the 3D printer to the top of the screen; the nav would cover its paper
  const pin = document.querySelector('.hero__pin');
  const narrow = matchMedia('(max-width: 900px)');
  const printerPinned = () => {
    if (!narrow.matches || !pin || pin.offsetHeight < 40) return false; // no-webgl: nothing to cover
    return Math.abs(pin.getBoundingClientRect().top) < 1; // stuck at the top, not scrolling away
  };
  let ticking = false;
  let typeTimer = 0;

  function placeInk() {
    const a = links.find((l) => l.dataset.section === active);
    linkWrap.classList.toggle('has-active', Boolean(a));
    if (!a) return;
    ink.style.setProperty('--x', `${a.offsetLeft}px`);
    ink.style.setProperty('--w', `${a.offsetWidth}px`);
  }

  function typeTape(text) {
    clearInterval(typeTimer);
    if (reduced) {
      tape.textContent = text;
      return;
    }
    let i = 0;
    tape.textContent = '';
    typeTimer = setInterval(() => {
      i += 1;
      tape.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(typeTimer);
    }, 16);
  }

  function setActive(id) {
    if (id === active) return;
    active = id;
    links.forEach((l) => {
      const on = l.dataset.section === id;
      l.classList.toggle('is-active', on);
      if (on) l.setAttribute('aria-current', 'location');
      else l.removeAttribute('aria-current');
    });
    placeInk();
    const sec = id && document.getElementById(id);
    typeTape(sec ? `> now printing ${id}: ${sec.dataset.tape || ''}` : '> ready, scroll to print');
  }

  function onScroll() {
    ticking = false;
    const y = window.scrollY;
    const probe = window.innerHeight * 0.38;

    let current = null;
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= probe) current = s.id;
    }
    // last section is short: treat "scrolled to bottom" as contact
    if (window.innerHeight + y >= document.documentElement.scrollHeight - 4) current = sections.at(-1)?.id ?? current;
    setActive(current);

    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.round((y / max) * 20) * 5 : 0; // 5% steps, like a feed counter
    tapeFill.style.setProperty('--p', `${pct}%`);
    tapePct.textContent = `${pct}%`;

    const menuOpen = !document.getElementById('menu').hidden;
    if (!menuOpen) {
      if (printerPinned()) nav.classList.add('is-tucked');
      else if (y > lastY + 6 && y > 240) nav.classList.add('is-tucked');
      else if (y < lastY - 6 || y < 240) nav.classList.remove('is-tucked');
    }
    lastY = y;
  }

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true },
  );
  // other parts of the page can print a line on the tape (e.g. the tear-off)
  window.addEventListener('receipt:tape', (e) => {
    // a printed message should be seen, even mid-scroll, unless the nav would cover the printer
    if (!printerPinned()) nav.classList.remove('is-tucked');
    typeTape(String(e.detail ?? ''));
  });
  window.addEventListener('resize', placeInk);
  document.fonts?.ready.then(placeInk);
  onScroll();
}

/* ---- live Bandung clock ---------------------------------------------------- */
function initClock() {
  const els = document.querySelectorAll('[data-clock]');
  const tick = () => {
    const t = clockFmt.format(new Date());
    els.forEach((el) => {
      el.textContent = t;
      el.dateTime = t;
    });
  };
  tick();
  setInterval(tick, 1000);
}

/* ---- sound toggles (nav + menu stay in sync) ------------------------------- */
function initSound() {
  const btns = document.querySelectorAll('[data-sound-toggle]');
  const render = (on) =>
    btns.forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? 'Sound on' : 'Sound off';
    });
  btns.forEach((b) => b.addEventListener('click', () => sound.toggle()));
  sound.onChange(render);
  render(sound.enabled);
}

/* ---- hover: label re-prints through noise glyphs --------------------------- */
function initScramble(links, reduced) {
  if (reduced) return;
  links.forEach((a) => {
    const lbl = a.querySelector('.lbl');
    const final = lbl.dataset.text;
    let timer = 0;
    const run = () => {
      clearInterval(timer);
      let frame = 0;
      timer = setInterval(() => {
        lbl.textContent = [...final]
          .map((ch, i) => (i < frame - 2 ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
          .join('');
        frame += 1;
        if (frame > final.length + 2) {
          clearInterval(timer);
          lbl.textContent = final;
        }
      }, 30);
      sound.buzz(0.03, 0.08);
    };
    a.addEventListener('mouseenter', run);
    a.addEventListener('focus', run);
  });
}

/* ---- menu receipt: prints in, tears off ------------------------------------ */
function initMenu({ reduced }) {
  const menu = document.getElementById('menu');
  const btn = document.getElementById('menuBtn');
  const paper = menu.querySelector('.menu__paper');
  const lines = [...menu.querySelectorAll('.pl')];
  let closing = false;
  let timers = [];

  const focusables = () => [...menu.querySelectorAll('a[href], button:not([disabled])')];

  function open() {
    if (!menu.hidden) return;
    closing = false;
    menu.classList.remove('is-tearing');
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    document.getElementById('nav').classList.remove('is-tucked');
    timers.forEach(clearTimeout);
    timers = lines.map((_, i) => setTimeout(() => sound.buzz(), 180 + i * 65));
    requestAnimationFrame(() => focusables()[0]?.focus({ preventScroll: true }));
  }

  function close({ returnFocus = true } = {}) {
    if (menu.hidden || closing) return;
    closing = true;
    timers.forEach(clearTimeout);
    const finish = () => {
      menu.hidden = true;
      menu.classList.remove('is-tearing');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      closing = false;
      if (returnFocus) btn.focus({ preventScroll: true });
    };
    if (reduced) return finish();
    sound.buzz(0.12, 0.2);
    menu.classList.add('is-tearing');
    const onEnd = (e) => {
      if (e.target !== paper || e.animationName !== 'tearOff') return; // ignore bubbling line animations
      paper.removeEventListener('animationend', onEnd);
      if (closing) finish();
    };
    paper.addEventListener('animationend', onEnd);
    setTimeout(() => closing && finish(), 900); // safety net if animationend never fires
  }

  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  menu.querySelectorAll('[data-menu-close]').forEach((el) => el.addEventListener('click', () => close()));
  menu.querySelectorAll('.menu__items a').forEach((a) =>
    a.addEventListener('click', () => close({ returnFocus: false })),
  );

  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // if the viewport grows past the breakpoint, don't leave a stale menu open
  matchMedia('(min-width: 901px)').addEventListener('change', (m) => m.matches && close({ returnFocus: false }));

  return { open, close, isOpen: () => !menu.hidden };
}

/* ---- number keys jump to sections ------------------------------------------ */
function initShortcuts(sections, menu) {
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || menu.isOpen()) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const n = Number.parseInt(e.key, 10);
    if (n >= 1 && n <= sections.length) {
      sections[n - 1].scrollIntoView({ block: 'start' });
      history.replaceState(null, '', `#${sections[n - 1].id}`);
    }
  });
}
