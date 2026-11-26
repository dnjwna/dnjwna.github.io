import * as THREE from 'three';

const MONO = '"Martian Mono Variable", ui-monospace, Menlo, monospace';
const DOT = '"Doto Variable", "Martian Mono Variable", monospace';
const MAX_SLIPS = 6;

function wrap(g, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function slipTexture(text, no) {
  const W = 420;
  const H = 300;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const tooth = 16;

  // zigzag on both torn ends
  g.fillStyle = '#FCFCF9';
  g.beginPath();
  g.moveTo(0, tooth);
  for (let x = 0; x < W; x += tooth) {
    g.lineTo(x + tooth / 2, 0);
    g.lineTo(x + tooth, tooth);
  }
  g.lineTo(W, H - tooth);
  for (let x = W; x > 0; x -= tooth) {
    g.lineTo(x - tooth / 2, H);
    g.lineTo(x - tooth, H - tooth);
  }
  g.closePath();
  g.fill();

  g.fillStyle = '#1E1F23';
  g.textAlign = 'left';
  g.font = `900 40px ${DOT}`;
  g.fillText(`FACT #${String(no).padStart(2, '0')}`, 24, 66);
  g.fillStyle = '#D8262E';
  g.fillRect(24, 82, W - 48, 3);
  g.fillStyle = '#1E1F23';
  g.font = `500 21px ${MONO}`;
  wrap(g, text, W - 48)
    .slice(0, 5)
    .forEach((l, i) => g.fillText(l, 24, 124 + i * 31));

  // same thermal wear as everything else
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(252, 252, 249, ${0.4 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1.3, 1.3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Small fact slips that fly out of the slot and land on the desk.
 * Positions are in the printer rig's local space.
 */
export function createSlips(rig) {
  const live = [];
  let count = 0;
  let area = { x: [-1.3, 0.25], z: [1.25, 1.8] };

  function setLandingArea(a) {
    area = a;
  }

  function spawn(text) {
    count += 1;
    const w = 0.5;
    const h = w * (300 / 420);
    const geo = new THREE.PlaneGeometry(w, h, 4, 8);
    // a little heat curl along the length
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setZ(i, ((y / (h / 2)) ** 2) * 0.02);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: slipTexture(text, count),
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    rig.add(mesh);

    const rand = (a, b) => a + Math.random() * (b - a);
    const slip = {
      mesh,
      t: 0,
      from: new THREE.Vector3(rand(-0.25, 0.25), 1.2, 0.42),
      to: new THREE.Vector3(rand(...area.x), 0.008 + (live.length % MAX_SLIPS) * 0.0025, rand(...area.z)),
      spin: rand(-0.7, 0.7),
      flutter: rand(2.5, 4),
    };
    mesh.position.copy(slip.from);
    live.push(slip);

    if (live.length > MAX_SLIPS) {
      const old = live.shift();
      rig.remove(old.mesh);
      old.mesh.geometry.dispose();
      old.mesh.material.map.dispose();
      old.mesh.material.dispose();
    }
    return count;
  }

  const ease = (x) => 1 - (1 - x) ** 3;

  function update(dt) {
    for (const s of live) {
      if (s.t >= 1) continue;
      s.t = Math.min(1, s.t + dt / 1.05);
      const t = s.t;
      const e = ease(t);
      const m = s.mesh;
      m.position.lerpVectors(s.from, s.to, e);
      m.position.y += Math.sin(Math.PI * t) * 0.55 * (1 - t * 0.4); // arc up, then drop
      m.rotation.x = -Math.PI / 2 * ease(Math.min(1, t * 1.15));
      m.rotation.z = s.spin * e;
      m.rotation.y = Math.sin(t * Math.PI * s.flutter) * 0.35 * (1 - t); // flutters as it falls
    }
  }

  return { spawn, update, setLandingArea };
}
