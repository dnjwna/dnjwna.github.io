import { barcodeBars } from './barcode.js';

const INK = '#1E1F23';
const SOFT = '#686B72';
const RED = '#D8262E';
const PAPER = '#FCFCF9';
const MONO = '"Martian Mono Variable", ui-monospace, Menlo, monospace';
const DOT = '"Doto Variable", "Martian Mono Variable", monospace';

async function loadFonts() {
  if (!document.fonts?.load) return;
  const wanted = [`900 120px ${DOT}`, `400 20px ${MONO}`, `700 20px ${MONO}`];
  try {
    await Promise.race([
      Promise.all(wanted.map((f) => document.fonts.load(f))),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system monospace */
  }
}

/**
 * Draws the receipt that the 3D printer feeds out.
 * The top of the canvas is the first line printed (the paper's free tip).
 * Returns pixel markers so the scene knows how far to feed on load and on scroll.
 */
export async function createReceiptCanvas({ width = 640, height = 2048 } = {}) {
  await loadFonts();

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  const PAD = 44;
  const LINE = 40;

  g.fillStyle = PAPER;
  g.fillRect(0, 0, width, height);
  g.textBaseline = 'alphabetic';

  const mono = (s, w = 400) => `${w} ${s}px ${MONO}`;
  const dot = (s, w = 900) => `${w} ${s}px ${DOT}`;
  let y = 70;

  const put = (str, x, align, font, color = INK) => {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(str, x, y);
  };
  const center = (str, font, lh, color = INK) => {
    put(str, width / 2, 'center', font, color);
    y += lh;
  };
  const row = (l, r, font, lh, color = INK) => {
    put(l, PAD, 'left', font, color);
    put(r, width - PAD, 'right', font, color);
    y += lh;
  };
  const dashed = (after = 46) => {
    y -= 8;
    g.fillStyle = INK;
    for (let x = PAD; x < width - PAD; x += 18) g.fillRect(x, y, 10, 3);
    y += after;
  };

  const now = new Date();
  const date = now.toLocaleDateString('en-GB');
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  // --- header (curls away over the top first) ---
  center('* * *   R E C E I P T   * * *', mono(18, 600), 50, SOFT);
  center('DANU TRISNA JUWANA', mono(27, 700), 40, RED);
  center('Bandung, West Java, Indonesia', mono(18), 32, SOFT);
  center('github.com/dnjwna', mono(18), 50, SOFT);
  row(`Date ${date}`, `Time ${time}`, mono(17), 32);
  row('Cashier: you', 'Till 01', mono(17), 50);
  dashed();

  // --- greeting: what's visible on the rising paper after the intro feed ---
  y += 100;
  center('HALO!', dot(150), 58);
  center('thanks for stopping by', mono(19), 52, SOFT);
  dashed();
  const introPx = y + 6;

  // --- items ---
  row('QTY  ITEM', 'YEAR', mono(16, 700), LINE);
  const items = [
    ['Fall detection, LSTM-SVM', 'PyTorch / MediaPipe'],
    ['Pulau, macOS notch app', 'Swift'],
    ['FarmLens, AgriTech PWA', 'Next.js / FastAPI'],
    ['FlowStep, project mgmt', 'Laravel / React'],
    ['Mini Wallet', 'Laravel / React'],
  ];
  for (const [name, stack] of items) {
    row(`1    ${name}`, '2026', mono(18, 500), 30);
    put(`     ${stack}`, PAD, 'left', mono(15), SOFT);
    y += 42;
  }
  row('2    Still printing', '...', mono(18, 600), 50, RED);
  dashed();

  row('SUBTOTAL', '5 shipped', mono(17), 34);
  row('IN PROGRESS', '2', mono(17), 64);
  g.font = dot(64);
  row('TOTAL', '7 ITEMS', dot(64), 74, RED);
  dashed(56);

  // --- barcode ---
  const bars = barcodeBars('DNJWNA-PORTFOLIO');
  const units = bars.reduce((s, b) => s + b.w, 0);
  const scale = (width - PAD * 2) / units;
  let x = PAD;
  g.fillStyle = INK;
  for (const b of bars) {
    if (b.bar) g.fillRect(Math.round(x), y, Math.max(1, Math.round(b.w * scale)), 96);
    x += b.w * scale;
  }
  y += 132;
  center('dnjwna  portfolio  2026', mono(15), 74, SOFT);
  center('TERIMA KASIH', dot(66), 50);
  center('please come again', mono(17), 40, SOFT);
  const endPx = y + 20;
  y += 30;
  center('- - - - -  tear here  - - - - -', mono(15), 40, RED);

  // end-of-roll stripe near the tail, fading in like the real thing
  const stripeTop = Math.round(endPx * 0.62);
  const sg = g.createLinearGradient(0, stripeTop, 0, endPx + 40);
  sg.addColorStop(0, 'rgba(216, 38, 46, 0)');
  sg.addColorStop(0.35, 'rgba(216, 38, 46, 0.45)');
  sg.addColorStop(1, 'rgba(216, 38, 46, 0.7)');
  g.fillStyle = sg;
  g.fillRect(width - 22, stripeTop, 9, endPx + 40 - stripeTop);

  const usedH = Math.min(height, y + 200);
  const creasePx = [Math.round(endPx * 0.34), Math.round(endPx * 0.71)];
  ageReceipt(g, width, usedH, creasePx);

  return { canvas: c, introPx, endPx: Math.min(endPx, height - 20), lineHeight: LINE, creasePx };
}

/* Seeded RNG so the paper looks the same on every visit */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Makes the printed canvas look like real thermal paper:
 * fibres and pulp flecks, faded ink patches, dot dropouts,
 * two dead print-head columns, and folds that crack the ink.
 */
function ageReceipt(g, W, H, creases) {
  const r = rng(26112026);
  const paper = (a) => `rgba(252, 252, 249, ${a})`;

  // 1. fibres: short, thin, mostly horizontal strokes
  g.lineCap = 'round';
  for (let i = 0; i < 1400; i++) {
    const x = r() * W;
    const y = r() * H;
    const len = 12 + r() * 70;
    const ang = (r() - 0.5) * 0.35;
    g.strokeStyle = `rgba(30, 31, 35, ${0.025 + r() * 0.045})`;
    g.lineWidth = 0.5 + r() * 0.9;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len * 0.5, y + (r() - 0.5) * 4, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    g.stroke();
  }
  // pulp flecks
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(30, 31, 35, ${0.05 + r() * 0.08})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 1.2, 1 + r() * 1.2);
  }

  // 2. sun-faded patches: paper colour laid over the ink
  for (let i = 0; i < 9; i++) {
    const cx = r() * W;
    const cy = r() * H;
    const rad = 90 + r() * 170;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, paper(0.32 + r() * 0.22));
    grad.addColorStop(1, paper(0));
    g.save();
    g.translate(cx, cy);
    g.scale(1.6, 0.7); // flattened, like wear along the roll
    g.translate(-cx, -cy);
    g.fillStyle = grad;
    g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    g.restore();
  }

  // the head prints weaker toward one edge
  const edge = g.createLinearGradient(W * 0.6, 0, W, 0);
  edge.addColorStop(0, paper(0));
  edge.addColorStop(1, paper(0.2));
  g.fillStyle = edge;
  g.fillRect(0, 0, W, H);

  // 3. dot dropouts: tiny holes punched into the ink
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = paper(0.45 + r() * 0.5);
    const s = 1 + r() * 1.6;
    g.fillRect(r() * W, r() * H, s, s);
  }

  // 4. dead print-head elements: a thin pale line through every row
  g.fillStyle = paper(0.8);
  g.fillRect(Math.round(W * 0.366), 0, 2, H);
  g.fillStyle = paper(0.55);
  g.fillRect(Math.round(W * 0.713), 0, 1.5, H);

  // 5. folds: soft shadow either side, a bright ridge where the ink cracked
  for (const cy of creases) {
    const tilt = (r() - 0.5) * 18;
    const line = (width, color) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(0, cy - tilt / 2);
      g.lineTo(W, cy + tilt / 2);
      g.stroke();
    };
    line(16, 'rgba(30, 31, 35, 0.035)');
    line(6, 'rgba(30, 31, 35, 0.05)');
    line(2.2, paper(0.92));
    // ink flakes off along the fold
    for (let i = 0; i < 160; i++) {
      const x = r() * W;
      const yy = cy - tilt / 2 + (x / W) * tilt + (r() - 0.5) * 7;
      g.fillStyle = paper(0.6 + r() * 0.4);
      g.fillRect(x, yy, 1 + r() * 3, 1 + r() * 1.5);
    }
  }
}
