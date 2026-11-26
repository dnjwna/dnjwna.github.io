import * as THREE from 'three';
import { barcodeBars } from './barcode.js';

/* Everything here exists to make the printer sit *on* the desk:
   a contact shadow, a self-test print lying in front of it, and dust in the light. */

const MONO = '"Martian Mono Variable", ui-monospace, Menlo, monospace';
const DOT = '"Doto Variable", "Martian Mono Variable", monospace';

/** Soft occlusion where the printer touches the desk (the directional shadow alone floats). */
export function createContactShadow({ width = 2.2, depth = 1.9 } = {}) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(18, 26, 22, 0.55)');
  grad.addColorStop(0.45, 'rgba(18, 26, 22, 0.32)');
  grad.addColorStop(0.75, 'rgba(18, 26, 22, 0.1)');
  grad.addColorStop(1, 'rgba(18, 26, 22, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });

  const group = new THREE.Group();
  // tight core right under the shell + a wider, fainter skirt
  const core = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.12, depth * 1.15), mat);
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.9, depth * 1.9), mat.clone());
  skirt.material.opacity = 0.45;
  for (const [m, y] of [
    [skirt, 0.001],
    [core, 0.002],
  ]) {
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.renderOrder = -1;
    group.add(m);
  }
  return group;
}

/** A torn-off self-test print, curled from the heat, lying on the desk. */
export function createSelfTestStub() {
  const W = 360;
  const H = 520;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // torn zigzag top edge via the alpha channel
  g.fillStyle = '#FCFCF9';
  g.beginPath();
  const tooth = 18;
  g.moveTo(0, tooth);
  for (let x = 0; x < W; x += tooth) {
    g.lineTo(x + tooth / 2, 0);
    g.lineTo(x + tooth, tooth);
  }
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.closePath();
  g.fill();

  const ink = '#1E1F23';
  const soft = '#6E7177';
  const put = (t, x, y, font, color = ink, align = 'left') => {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = align;
    g.fillText(t, x, y);
  };
  put('SELF-TEST', W / 2, 78, `900 48px ${DOT}`, ink, 'center');
  put('DTJ-80 thermal', W / 2, 112, `500 17px ${MONO}`, soft, 'center');
  g.fillStyle = ink;
  for (let x = 26; x < W - 26; x += 14) g.fillRect(x, 134, 8, 2);
  const rows = [
    ['Head', 'OK'],
    ['Cutter', 'OK'],
    ['Paper', '80 mm'],
    ['Density', 'low'],
  ];
  rows.forEach(([k, v], i) => {
    put(k, 26, 172 + i * 30, `400 16px ${MONO}`, soft);
    put(v, W - 26, 172 + i * 30, `600 16px ${MONO}`, ink, 'right');
  });
  // print-density ramp: the classic self-test block
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(30, 31, 35, ${0.15 + i * 0.11})`;
    g.fillRect(26 + i * 38.5, 308, 34, 26);
  }
  const bars = barcodeBars('SELFTEST');
  const units = bars.reduce((s, b) => s + b.w, 0);
  const sc = (W - 52) / units;
  let bx = 26;
  g.fillStyle = ink;
  for (const b of bars) {
    if (b.bar) g.fillRect(Math.round(bx), 360, Math.max(1, Math.round(b.w * sc)), 56);
    bx += b.w * sc;
  }
  put('VOID', W / 2, 482, `700 30px ${MONO}`, '#D8262E', 'center');

  // wear: same language as the main receipt
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(252, 252, 249, ${0.4 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const w = 0.62;
  const h = w * (H / W);
  const geo = new THREE.PlaneGeometry(w, h, 6, 24);
  // lay it flat, then curl the torn end up and cup it a little
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const yy = p.getY(i);
    const t = (yy + h / 2) / h; // 0 = bottom, 1 = torn top
    const curl = Math.pow(Math.max(0, t - 0.55) / 0.45, 2.2) * 0.13;
    const cup = (x / (w / 2)) ** 2 * 0.012;
    p.setXYZ(i, x, yy, curl + cup + 0.004);
  }
  geo.computeVertexNormals();

  const front = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide }),
  );
  front.rotation.x = -Math.PI / 2;
  front.castShadow = true;
  front.receiveShadow = true;

  const group = new THREE.Group();
  group.add(front);
  return group;
}

/** Dust motes drifting in the key light around the printer. */
export function createDust({ count = 70, box = [3.4, 3.2, 3.0], center = [0, 1.7, 0.2] } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);

  const base = new Float32Array(count * 3);
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    base[i * 3] = center[0] + (Math.random() - 0.5) * box[0];
    base[i * 3 + 1] = center[1] + (Math.random() - 0.5) * box[1];
    base[i * 3 + 2] = center[2] + (Math.random() - 0.5) * box[2];
    seed[i] = Math.random() * 100;
  }
  pos.set(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(c),
      size: 0.045,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      toneMapped: false,
    }),
  );

  function update(t) {
    for (let i = 0; i < count; i++) {
      const s = seed[i];
      // slow Brownian-ish drift, mostly sinking, wrapping inside the box
      const fall = ((t * 0.035 + s) % 1) * box[1];
      pos[i * 3] = base[i * 3] + Math.sin(t * 0.21 + s) * 0.12;
      pos[i * 3 + 1] = center[1] + box[1] / 2 - ((base[i * 3 + 1] - center[1] + box[1] / 2 + fall) % box[1]);
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.17 + s * 1.3) * 0.1;
    }
    geo.attributes.position.needsUpdate = true;
  }

  return { points, update };
}
