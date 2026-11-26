/* Thermal prints inside the receipt.
   - <figure class="print"><img data-dither src alt></figure>: the photo is re-printed as
     1-bit Atkinson dots, the way a receipt printer prints a picture; hover shows the original.
   - <canvas data-illus="name">: a project drawn as a dot-matrix illustration (ILLUS below). */

const INK = '#1e1f23';
const RED = '#d8262e';
const DOT_FONT = '"Doto Variable", "Martian Mono Variable", monospace';

/* ---------------------------------------------------------------- dithered photos */
const PITCH = 2; // CSS px per printed dot

// Atkinson keeps 6/8 of the error, so highlights blow out to clean paper like thermal prints do
export function atkinson(gray, w, h) {
  const g = Float32Array.from(gray);
  const out = new Uint8Array(w * h); // 1 = ink
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = g[i] < 0.5 ? 0 : 1;
      out[i] = 1 - v;
      const err = (g[i] - v) / 8;
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny < h) g[ny * w + nx] += err;
      }
    }
  }
  return out;
}

function printPhoto(img) {
  const fig = img.closest('.print');
  const cssW = fig.clientWidth;
  if (!cssW || !img.naturalWidth) return;
  const cssH = Math.round((cssW * img.naturalHeight) / img.naturalWidth);
  const w = Math.round(cssW / PITCH);
  const h = Math.round(cssH / PITCH);

  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d', { willReadFrequently: true });
  t.drawImage(img, 0, 0, w, h);
  const px = t.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const l = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    gray[i] = Math.min(1, Math.max(0, (l - 0.5) * 1.3 + 0.56)); // a little contrast, a little lift
  }
  const bits = atkinson(gray, w, h);

  let c = fig.querySelector('canvas');
  if (!c) {
    c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    fig.prepend(c);
  }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const s = PITCH * dpr;
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  const g = c.getContext('2d');
  g.fillStyle = INK;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bits[y * w + x]) g.fillRect(x * s, y * s, s * 0.9, s * 0.9);
  fig.classList.add('is-printed');
}

/* ---------------------------------------------------------------- dot-matrix canvas */
// Every illustration is drawn on a board (544 x 130 by default: the receipt's width on desktop;
// a margin slip sets its own with draw.board), scaled to fit, then snapped to a grid of round
// dots. v: 1 ink, 2 red, 0 paper, KEEP paper nothing may print on.
const KEEP = 3;
function dotCanvas(c, draw) {
  const [VW, VH] = draw.board || [544, 130];
  const cssW = c.clientWidth;
  const cssH = c.clientHeight;
  if (!cssW || !cssH) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);

  const pitch = cssW < 420 ? 3 : 4;
  const cols = Math.floor(cssW / pitch) + 1;
  const rows = Math.floor(cssH / pitch) + 1;
  const grid = new Uint8Array(cols * rows);
  const s = Math.min(cssW / VW, cssH / VH);
  const ox = (cssW - VW * s) / 2;
  const oy = cssH - VH * s;
  const texts = [];
  const P = pitch / s; // one dot, in board units

  const put = (x, y, v = 1, force = false) => {
    const gx = Math.round((x * s + ox) / pitch);
    const gy = Math.round((y * s + oy) / pitch);
    if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) return;
    const i = gy * cols + gx;
    if (force || !grid[i]) grid[i] = v; // otherwise the first ink wins
  };
  const d = {
    P,
    line(x1, y1, x2, y2, v = 1, step = P / 2) {
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
      for (let i = 0; i <= n; i++) put(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, v);
    },
    dash(x1, y1, x2, y2, v = 1) {
      d.line(x1, y1, x2, y2, v, P * 2);
    },
    path(pts, v = 1, step) {
      for (let i = 1; i < pts.length; i++) d.line(...pts[i - 1], ...pts[i], v, step);
    },
    box(x, y, w, h, v = 1, step) {
      d.path([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], v, step);
    },
    fill(x, y, w, h, v = 1) {
      for (let yy = y; yy <= y + h; yy += P / 2) for (let xx = x; xx <= x + w; xx += P / 2) put(xx, yy, v, true);
    },
    circle(cx, cy, r, v = 1, filled = false, force = filled) {
      if (filled) {
        for (let yy = -r; yy <= r; yy += P / 2)
          for (let xx = -r; xx <= r; xx += P / 2) if (xx * xx + yy * yy <= r * r) put(cx + xx, cy + yy, v, force);
        return;
      }
      const n = Math.max(12, Math.ceil((2 * Math.PI * r) / (P / 2)));
      for (let i = 0; i < n; i++) put(cx + Math.cos((i / n) * 2 * Math.PI) * r, cy + Math.sin((i / n) * 2 * Math.PI) * r, v);
    },
    arrow(x1, y1, x2, y2, v = 1, step) {
      d.line(x1, y1, x2, y2, v, step);
      const a = Math.atan2(y2 - y1, x2 - x1);
      for (const t of [2.6, -2.6]) d.line(x2, y2, x2 + Math.cos(a + t) * 9, y2 + Math.sin(a + t) * 9, v);
    },
    // closed outline, filled with every other dot so land reads lighter than the coast
    poly(pts, v = 1) {
      d.path([...pts, pts[0]], v);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += P * 2)
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += P * 2) if (inside(pts, x, y)) put(x, y, v);
    },
    text(str, x, y, size, v = 1) {
      texts.push([str, x, y, size, v]);
    },
    grid: { put },
  };
  draw(d);

  const r = pitch * 0.4;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = grid[y * cols + x];
      if (!v || v === KEEP) continue;
      g.fillStyle = v === 2 ? RED : INK;
      g.beginPath();
      g.arc(x * pitch, y * pitch, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.textBaseline = 'bottom';
  for (const [str, x, y, size, v] of texts) {
    g.fillStyle = v === 2 ? RED : INK;
    g.font = `900 ${Math.round(size * s)}px ${DOT_FONT}`;
    g.fillText(str, x * s + ox, y * s + oy);
  }
}

// even-odd ray test
function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/* ---------------------------------------------------------------- the illustrations */
// Coastlines, simplified by hand (lon, lat): enough to read as the region on a receipt, not a map
const LAND = {
  malaya: [[100.1, 6.6], [101.0, 6.9], [102.1, 6.2], [103.4, 4.6], [103.5, 2.8], [104.3, 1.4], [103.4, 1.3], [101.3, 2.8], [100.4, 4.0], [100.3, 5.3]],
  sumatra: [[95.3, 5.6], [97.5, 5.2], [100.4, 2.2], [103.7, -0.9], [106.0, -3.2], [105.8, -5.8], [104.5, -5.9], [102.3, -4.0], [100.3, -1.0], [98.7, 1.7], [95.9, 4.0]],
  java: [[105.2, -6.8], [106.1, -6.0], [108.3, -6.3], [110.4, -6.9], [112.6, -6.9], [114.4, -7.7], [114.4, -8.6], [110.5, -8.2], [108.2, -7.8], [106.4, -7.4]],
  borneo: [[109.0, 1.5], [109.6, 2.1], [111.2, 2.6], [113.0, 3.2], [115.4, 4.9], [117.0, 7.0], [119.2, 5.1], [118.0, 4.3], [118.3, 2.0], [117.6, 0.7], [117.4, -0.9], [116.3, -3.5], [114.6, -4.1], [111.7, -3.2], [110.2, -2.9], [109.6, -0.4], [109.0, 0.5]],
};
const BANDUNG = [107.6, -6.9];
const PENANG = [100.3, 5.4];

// lon/lat window [lon0, lon1] x [lat0 (north), lat1 (south)] -> board coordinates
const projection = ([W, H], [lon0, lon1], [lat0, lat1]) => ([lon, lat]) => [
  ((lon - lon0) / (lon1 - lon0)) * W,
  ((lat0 - lat) / (lat0 - lat1)) * H,
];
// land goes last: the first ink wins, so pins and routes drawn before it stay on top
const drawLand = (d, at) => Object.values(LAND).forEach((coast) => d.poly(coast.map(at)));

function pin(d, x, y) {
  d.circle(x, y, 5, 2, true);
  d.circle(x, y, 11, 2);
  d.circle(x, y, 15, KEEP, true, false); // reserve paper round the pin so the land stays off it
}

// margin slips beside About, Stack, Log and Contact (wide screens only)
const MARGIN = {
  // About: where the receipt is printed
  where: Object.assign(
    (d) => {
      const at = projection([380, 150], [104.4, 115.2], [-5.4, -9]);
      const [bx, by] = at(BANDUNG);
      pin(d, bx, by);
      d.text('BANDUNG', bx - 36, 24, 15, 2); // out in the Java Sea, north of the pin
      d.line(bx, 30, bx, by - 14, 2, d.P * 2);
      drawLand(d, at);
    },
    { board: [380, 150] },
  ),

  // Stack: how the groups hand work to each other, with a tool from each
  pipeline: Object.assign(
    (d) => {
      const steps = [['MODEL', 'PyTorch'], ['API', 'FastAPI'], ['APP', 'React'], ['SHIP', 'Vercel']];
      steps.forEach(([s, tool], i) => {
        const y = 8 + i * 70;
        const v = i === 0 ? 2 : 1;
        d.box(50, y, 280, 42, v);
        d.text(s, 66, y + 32, 22, v);
        d.text(tool, 206, y + 29, 15, 1);
        if (i < steps.length - 1) d.arrow(190, y + 46, 190, y + 66);
      });
    },
    { board: [380, 262] },
  ),

  // Log: home to the research internship
  route: Object.assign(
    (d) => {
      const at = projection([380, 260], [95, 120], [8, -9]);
      const [ax, ay] = at(BANDUNG);
      const [bx, by] = at(PENANG);
      const mx = (ax + bx) / 2 - 40;
      const my = (ay + by) / 2 - 30;
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 0.05)
        pts.push([(1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by]);
      pin(d, ax, ay);
      pin(d, bx, by);
      d.path(pts, 2, d.P * 2);
      d.text('BANDUNG', ax - 30, ay + 34, 14, 2); // Indian Ocean, south of Java
      d.text('PENANG', bx - 78, by + 5, 14, 2); // Andaman Sea, west of the island
      drawLand(d, at);
    },
    { board: [380, 260] },
  ),

  // Contact: an envelope postmarked in Bandung
  mail: Object.assign(
    (d) => {
      const [x, y, w, h] = [40, 30, 300, 170];
      d.box(x, y, w, h);
      d.line(x, y, x + w / 2, y + h * 0.58);
      d.line(x + w, y, x + w / 2, y + h * 0.58);
      d.line(x, y + h, x + w * 0.38, y + h * 0.45);
      d.line(x + w, y + h, x + w * 0.62, y + h * 0.45);
      d.box(x + w - 62, y + 12, 48, 56, 1, d.P * 2); // stamp
      d.circle(x + w - 92, y + 46, 30, 2); // postmark
      d.circle(x + w - 92, y + 46, 24, 2);
      d.text('BDG', x + w - 112, y + 54, 16, 2);
      for (let k = 0; k < 3; k++) {
        const wy = y + 34 + k * 12;
        const wave = [];
        for (let t = 0; t <= 1; t += 0.05) wave.push([x + w - 150 + t * 46, wy + Math.sin(t * Math.PI * 3) * 3]);
        d.path(wave, 2);
      }
    },
    { board: [380, 220] },
  ),
};

// fall detection: 13 MediaPipe-style joints, standing, in a unit box (y down, feet on y = 1)
const STAND = {
  nose: [0, 0.07], ls: [-0.07, 0.2], rs: [0.07, 0.2], le: [-0.09, 0.37], re: [0.09, 0.37],
  lw: [-0.08, 0.52], rw: [0.08, 0.52], lh: [-0.05, 0.53], rh: [0.05, 0.53],
  lk: [-0.05, 0.76], rk: [0.05, 0.76], la: [-0.05, 1], ra: [0.05, 1],
};
const BONES = [
  ['ls', 'rs'], ['ls', 'le'], ['le', 'lw'], ['rs', 're'], ['re', 'rw'], ['ls', 'lh'], ['rs', 'rh'],
  ['lh', 'rh'], ['lh', 'lk'], ['lk', 'la'], ['rh', 'rk'], ['rk', 'ra'],
];
// tilt of the body about the ankles, and how far the hands reach out to break the fall
const FRAMES = [
  { tilt: 0, reach: 0 },
  { tilt: 22, reach: 0.45 },
  { tilt: 58, reach: 1 },
  { tilt: 88, reach: 0.6 },
];

function pose({ tilt, reach }) {
  const a = (tilt * Math.PI) / 180;
  const out = {};
  for (const [k, [x0, y0]] of Object.entries(STAND)) {
    let x = x0;
    let y = y0;
    if (k === 'lw' || k === 'rw') { x += 0.16 * reach; y -= 0.18 * reach; } // arms swing forward
    if (k === 'le' || k === 're') { x += 0.08 * reach; y -= 0.06 * reach; }
    const dy = y - 1; // rotate about the feet, falling to the right
    out[k] = [x * Math.cos(a) - dy * Math.sin(a), 1 + x * Math.sin(a) + dy * Math.cos(a)];
  }
  return out;
}

// satellite tile: river, a road and fields of four densities (0 dark .. 1 paper)
function terrain(u, v) {
  if (Math.abs(v - (0.55 + 0.18 * Math.sin(u * 6))) < 0.09) return 0;
  if (Math.abs(u - v * 0.6 - 0.22) < 0.03) return 1;
  const h = (Math.floor(u * 4) * 7 + Math.floor(v * 3) * 13) % 4;
  return [0.35, 0.55, 0.75, 0.92][h];
}

const ILLUS = {
  fall(d) {
    const ground = 122;
    d.dash(0, 126, 544, 126);
    const cellW = 544 / FRAMES.length;
    const H = Math.min(ground - 24, cellW * 0.74); // a lying body must fit its cell
    FRAMES.forEach((f, i) => {
      const p = pose(f);
      const ox = i * cellW + cellW * 0.14;
      const P = (k) => [ox + p[k][0] * H, ground - (1 - p[k][1]) * H];
      for (const [a, b] of BONES) d.line(...P(a), ...P(b));
      d.circle(...P('nose'), H * 0.06);
      if (i === FRAMES.length - 1) {
        // the detector's output on the last window: a red box around the body, closed by the floor
        const pts = Object.keys(p).map(P);
        const pad = 12;
        const x1 = Math.min(...pts.map((q) => q[0])) - pad;
        const x2 = Math.max(...pts.map((q) => q[0])) + pad;
        const y1 = Math.min(...pts.map((q) => q[1])) - pad - H * 0.06;
        d.path([[x1, ground], [x1, y1], [x2, y1], [x2, ground]], 2, d.P * 2);
        d.text('FALL', x1, y1 - 4, 18, 2);
      }
    });
  },

  // the notch closed, then opened into an island playing a song
  pulau(d) {
    for (const [x, open] of [[16, false], [292, true]]) {
      const w = 236;
      const cx = x + w / 2;
      d.box(x, 4, w, 120);
      d.dash(x + 8, 16, x + w - 8, 16); // menu bar
      d.line(x + 8, 116, x + w - 8, 116); // dock shelf
      if (!open) {
        d.fill(cx - 24, 4, 48, 12);
        continue;
      }
      const ix = cx - 92;
      d.fill(ix, 4, 184, 46);
      d.fill(ix + 10, 12, 30, 30, 0); // album art
      d.circle(ix + 25, 27, 9, 1, true);
      d.fill(ix + 50, 14, 82, 4, 0); // title
      d.fill(ix + 50, 23, 56, 3, 0); // lyrics line
      d.fill(ix + 50, 35, 112, 3, 0); // progress
      d.fill(ix + 50, 35, 46, 3, 2);
      d.fill(ix + 150, 13, 4, 14, 0); // pause
      d.fill(ix + 160, 13, 4, 14, 0);
    }
    d.arrow(258, 64, 284, 64, 2);
  },

  // a leaf in the camera frame with its spots found, and rain past the payout line
  farmlens(d) {
    const cy = 66;
    const half = (t) => 40 * Math.sin(Math.PI * t) ** 0.85;
    const X = (t) => 40 + 190 * t;
    const top = [];
    const bot = [];
    for (let i = 0; i <= 40; i++) {
      top.push([X(i / 40), cy - half(i / 40)]);
      bot.push([X(i / 40), cy + half(i / 40)]);
    }
    d.path(top);
    d.path(bot);
    d.line(18, cy + 6, 40, cy);
    d.line(40, cy, 230, cy);
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      d.line(X(t), cy, X(t + 0.08), cy - half(t + 0.08) * 0.8);
      d.line(X(t), cy, X(t + 0.08), cy + half(t + 0.08) * 0.8);
    }
    for (const [x, y, r] of [[100, 50, 6], [154, 80, 7], [188, 55, 5]]) {
      d.circle(x, y, r, 1, true);
      d.box(x - r - 6, y - r - 6, 2 * r + 12, 2 * r + 12, 2, d.P);
    }
    for (const [x, y, sx, sy] of [[10, 8, 1, 1], [256, 8, -1, 1], [10, 124, 1, -1], [256, 124, -1, -1]]) {
      d.line(x, y, x + 16 * sx, y);
      d.line(x, y, x, y + 16 * sy);
    }
    // weather: a cloud, its rain, and a gauge filled past the trigger
    d.circle(344, 40, 16, 1, true);
    d.circle(370, 30, 22, 1, true);
    d.circle(396, 40, 16, 1, true);
    d.fill(344, 40, 52, 16);
    for (let k = 0; k < 5; k++) {
      const x = 344 + k * 13;
      d.line(x, 66 + (k % 2) * 10, x - 6, 80 + (k % 2) * 10);
      d.line(x, 96 + (k % 2) * 6, x - 6, 110 + (k % 2) * 6);
    }
    d.box(462, 14, 30, 108);
    d.fill(467, 44, 20, 73);
    d.fill(467, 56, 20, 4, 0); // a gap in the ink so the red trigger line reads across it
    d.dash(446, 58, 508, 58, 2);
  },

  // a Kanban board, one card on its way from the first column to the second
  flowstep(d) {
    const card = (x, y) => {
      d.box(x, y, 148, 26);
      d.line(x + 10, y + 9, x + 104, y + 9);
      d.line(x + 10, y + 17, x + 66, y + 17);
    };
    const cols = [[22, 3], [198, 2], [374, 1]];
    for (const [x, n] of cols) {
      d.fill(x, 4, 58, 5);
      for (let i = 0; i < n; i++) if (!(x === 22 && i === 1)) card(x, 20 + i * 36);
    }
    d.box(22, 56, 148, 26, 2, d.P * 2); // the slot it left
    const dx = 212;
    const dy = 96;
    d.fill(dx + 5, dy + 5, 148, 26);
    d.fill(dx, dy, 148, 26, 0);
    card(dx, dy);
    d.arrow(172, 72, dx - 6, dy + 8, 2, d.P * 2);
  },

  // two requests at once, one padlock, one ledger row changed at a time
  wallet(d) {
    for (const y of [16, 88]) {
      d.box(8, y, 56, 26);
      d.line(16, y + 9, 52, y + 9);
      d.line(16, y + 17, 40, y + 17);
    }
    d.arrow(66, 29, 236, 60);
    d.arrow(66, 101, 236, 72);
    // padlock
    const lx = 248;
    for (let a = Math.PI; a <= 2 * Math.PI; a += 0.12) d.grid.put(lx + 13 + Math.cos(a) * 9, 60 + Math.sin(a) * 9);
    d.line(lx + 4, 60, lx + 4, 64);
    d.line(lx + 22, 60, lx + 22, 64);
    d.fill(lx, 63, 26, 20);
    d.fill(lx + 11, 69, 4, 8, 0);
    d.line(lx + 30, 73, 298, 73);
    // ledger
    d.box(300, 7, 228, 116);
    for (let r = 1; r < 5; r++) d.dash(300, 7 + r * 23, 528, 7 + r * 23);
    [150, 112, 168, 96, 132].forEach((len, r) => d.line(312, 19 + r * 23, 312 + len, 19 + r * 23));
    d.box(302, 62, 224, 21, 2);
  },

  // the same tile, blocky in, sharp out
  satellite(d) {
    const S = 112;
    const lo = [70, 9];
    const hi = [362, 9];
    const B = 10;
    const block = S / B;
    const g1 = new Float32Array(B * B);
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) g1[y * B + x] = terrain((x + 0.5) / B, (y + 0.5) / B);
    const b1 = atkinson(g1, B, B);
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) if (b1[y * B + x]) d.fill(lo[0] + x * block, lo[1] + y * block, block - d.P, block - d.P);
    const n = Math.floor(S / d.P);
    const g2 = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g2[y * n + x] = terrain((x + 0.5) / n, (y + 0.5) / n);
    const b2 = atkinson(g2, n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (b2[y * n + x]) d.grid.put(hi[0] + x * d.P, hi[1] + y * d.P);
    d.box(lo[0] - 4, lo[1] - 4, S + 6, S + 6);
    d.box(hi[0] - 4, hi[1] - 4, S + 6, S + 6);
    d.arrow(206, 65, 340, 65, 2, d.P * 2);
  },

  // two cited claims: one the source supports, one it does not
  citation(d) {
    const page = (x, lens, marks = {}) => {
      d.box(x, 4, 180, 120);
      lens.forEach((len, i) => {
        const y = 18 + i * 13;
        d.line(x + 12, y, x + 12 + len, y);
        if (marks[i]) d.line(x + 12, y + 4, x + 12 + len, y + 4, marks[i]);
      });
    };
    page(24, [150, 132, 118, 156, 140, 96, 150, 120], { 2: 1, 5: 2 });
    page(340, [140, 156, 120, 148, 100, 152, 130, 88]);
    d.box(146, 44, 8, 8); // [1]
    d.box(124, 83, 8, 8, 2); // [2]
    d.dash(160, 48, 336, 36);
    d.dash(138, 87, 336, 96, 2);
    d.path([[238, 22], [246, 30], [262, 12]]); // supported
    d.line(238, 100, 254, 116, 2); // not supported
    d.line(254, 100, 238, 116, 2);
  },
};

function drawIllus(c) {
  const draw = ILLUS[c.dataset.illus] || MARGIN[c.dataset.illus];
  if (!draw) return;
  if (draw.board) c.style.aspectRatio = draw.board.join(' / ');
  dotCanvas(c, draw);
}

/* ---------------------------------------------------------------- wiring */
export function initPrints({ reduced } = {}) {
  const photos = [...document.querySelectorAll('img[data-dither]')];
  const illus = [...document.querySelectorAll('canvas[data-illus]')];
  const redraw = (el) => (el.tagName === 'IMG' ? printPhoto(el) : drawIllus(el));

  photos.forEach((img) => (img.complete ? printPhoto(img) : img.addEventListener('load', () => printPhoto(img), { once: true })));
  illus.forEach(drawIllus);
  document.fonts.ready.then(() => illus.forEach(drawIllus)); // again once Doto is in, for the labels

  // re-print at the new width; only width changes matter
  const widths = new WeakMap();
  const ro = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const w = Math.round(target.clientWidth);
      if (widths.get(target) === w) continue;
      widths.set(target, w);
      redraw(target.matches('.print') ? target.querySelector('img[data-dither]') : target);
    }
  });
  photos.forEach((img) => ro.observe(img.closest('.print')));
  illus.forEach((c) => ro.observe(c));

  // each print feeds out once, line by line, the first time it reaches the screen
  if (reduced) return;
  const prints = document.querySelectorAll('.print');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-feeding');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.35 },
  );
  prints.forEach((p) => {
    p.classList.add('will-feed');
    io.observe(p);
  });
}
