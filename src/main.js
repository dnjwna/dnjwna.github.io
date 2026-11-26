import './style.css';
import { renderBarcodes } from './barcode.js';
import { initNav } from './nav.js';
import { initTear } from './tear.js';
import { renderQR } from './qr.js';
import { initPrints } from './dither.js';
import { sound } from './sound.js';
import { initNight } from './night.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- receipt metadata: today's date and a receipt number from the visit time ---- */
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const receiptNo = `${pad(now.getDate())}${pad(now.getMonth() + 1)}-${pad(now.getHours())}${pad(now.getMinutes())}`;
document.querySelectorAll('[data-receipt-no]').forEach((el) => (el.textContent = receiptNo));
document.querySelectorAll('[data-today]').forEach((el) => (el.textContent = now.toLocaleDateString('en-GB')));
document.querySelectorAll('[data-year]').forEach((el) => (el.textContent = String(now.getFullYear())));

renderBarcodes();
const qrEl = document.getElementById('contactQR');
if (qrEl) renderQR(qrEl);
initPrints({ reduced });

// keyboard / touch friendly twin of the 3D printer's button
document.querySelectorAll('[data-print-fact]').forEach((b) =>
  b.addEventListener('click', () => window.dispatchEvent(new Event('printer:print-fact'))),
);
initNav({ reduced });
initNight({ reduced });

/* ---- contact actions ---- */
const status = document.getElementById('actionStatus');
let statusTimer = 0;
const say = (msg, { stamp = false } = {}) => {
  status.textContent = msg;
  status.classList.remove('is-stamp');
  if (stamp) {
    void status.offsetWidth; // restart the stamp animation on repeat clicks
    status.classList.add('is-stamp');
  }
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    status.textContent = '';
    status.classList.remove('is-stamp');
  }, 2600);
};

document.getElementById('copyEmail')?.addEventListener('click', async (e) => {
  const email = e.currentTarget.dataset.email;
  try {
    await navigator.clipboard.writeText(email);
    sound.kaching();
    say('Copied', { stamp: true });
  } catch {
    say(email); // clipboard blocked: at least show it so it can be selected
  }
});
initTear({ reduced });

/* ---- the paper torn off the 3D printer lands as the page's receipt ---- */
const wrap = document.querySelector('.receipt-wrap');
const land = new IntersectionObserver(([e]) => {
  if (!e.isIntersecting) return;
  land.unobserve(wrap);
  wrap.classList.add('is-landing');
});
wrap.addEventListener('animationend', (e) => e.animationName === 'receiptLand' && wrap.classList.remove('is-landing'));
// only when the receipt is still below the screen: one already being read must not jump
window.addEventListener('receipt:torn', () => {
  if (!reduced && wrap.getBoundingClientRect().top > innerHeight) land.observe(wrap);
});

/* ---- 3D printer (loaded separately so the page is usable before three.js arrives) ---- */
const canvas = document.getElementById('scene');
import('./scene.js')
  .then(({ initScene }) => initScene(canvas, { reduced }))
  .catch((err) => {
    console.warn('[scene] falling back to the flat layout:', err);
    document.documentElement.classList.add('no-webgl');
  });
