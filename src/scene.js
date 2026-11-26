import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createReceiptCanvas } from './receiptTexture.js';
import { sound } from './sound.js';
import { createContactShadow, createDust, createSelfTestStub } from './ambient.js';
import { buildLamp, createLighting } from './lamp.js';
import { createSlips } from './slips.js';
import { FACTS } from './facts.js';

/* Paper path, in world units (1 unit ≈ 10 cm of printer)
   The paper leaves the slot going up, leans back slightly, then curls
   backwards over the lid, hangs behind the printer and settles on the desk. */
const PAPER_W = 1.5;
const SEG = 360; // samples along the paper (dense enough to resolve the folds)
const XSEG = 8; // samples across the paper (for the cupped curl)
const SLOT = { y: 1.13, z: 0.34 };
const RISE = 1.2; // straight part before the curl
const CURL_R = 0.72; // radius of the backward curl
const GROUND_R = 0.28; // radius where the hanging paper meets the desk
const LEAN = 0.1; // backward lean of the rising part (rad)
const CUP = 0.045; // edge-to-centre curl across the width
const CREASE_H = 0.014; // height of a fold ridge
const CREASE_W = 0.028; // half-width of a fold ridge
// The hand-off to the page: printing ends at TEAR_AT of the hero scroll, the printer tears
// the paper off and it drops out of the frame, toward the receipt the page shows below.
const TEAR_AT = 0.88;
const REATTACH_AT = 0.8; // scrolling back above this puts the paper back and reprints it
const DROP_MS = 850;
const STUB = 0.05; // fresh paper left in the slot after a tear

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export async function initScene(canvas, { reduced = false } = {}) {
  if (!hasWebGL()) throw new Error('WebGL is not available');
  const hero = canvas.closest('.hero') ?? canvas.parentElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const look = new THREE.Vector3();

  /* ---- light + desk ----
     Key light comes from the upper right, low enough that the printer throws a
     long soft shadow leftward across the desk, into the space beside the copy. */
  const hemi = new THREE.HemisphereLight(0xffffff, 0xa9b3ac, 1.35);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff8ee, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); // lower res + radius = softer penumbra
  key.shadow.radius = 9;
  key.shadow.blurSamples = 16;
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.035;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xeef3ff, 1.05); // keeps the paper face bright
  fill.position.set(-3, 3, 7);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe4ecff, 0.7);
  rim.position.set(4, 3, -4);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const rig = new THREE.Group();
  scene.add(rig);

  /* ---- receipt texture ---- */
  const receipt = await createReceiptCanvas({ width: 640, height: 2048 });
  const pxPerUnit = receipt.canvas.width / PAPER_W;
  const LTEX = receipt.canvas.height / pxPerUnit;
  const LINE = receipt.lineHeight / pxPerUnit;
  const introL = receipt.introPx / pxPerUnit;
  const maxL = Math.min(LTEX - 0.05, receipt.endPx / pxPerUnit + 0.1);
  // folds live in paper coordinates (distance from the tip), so they travel with the paper;
  // alternate mountain / valley like a receipt folded once each way
  const creases = (receipt.creasePx ?? []).map((px, i) => ({ p: px / pxPerUnit, dir: i % 2 ? -1 : 1 }));

  const tex = new THREE.CanvasTexture(receipt.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;

  const printer = buildPrinter();
  rig.add(printer.group);
  rig.add(createContactShadow());

  // a self-test print torn off earlier, lying front-left of the machine
  const stub = createSelfTestStub();
  rig.add(stub);

  // the desk lamp: click it to work late (night mode)
  const lamp = buildLamp();
  rig.add(lamp.group, lamp.spot, lamp.spot.target);
  const LAMP_AIM = new THREE.Vector3(0, 1.55, 0.36); // the face of the printed paper
  const lighting = createLighting({ hemi, key, fill, rim, ground, lamp, reduced });
  lighting.set(document.documentElement.classList.contains('is-night'), { instant: true });
  window.addEventListener('lamp:change', (e) => {
    lighting.set(e.detail.on, { instant: e.detail.instant });
    start();
  });

  const dust = reduced ? null : createDust();
  if (dust) rig.add(dust.points);

  // fact slips printed by the button
  const slips = createSlips(rig);

  /* ---- paper mesh (rebuilt every frame on the CPU; ~2k verts) ---- */
  const cols = XSEG + 1;
  const rows = SEG + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const index = [];
  for (let r = 0; r < SEG; r++) {
    for (let c = 0; c < XSEG; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index.push(a, b, d, b, e, d); // front faces the viewer on the rising part
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(index);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));

  const front = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, side: THREE.FrontSide }),
  );
  const back = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.9, metalness: 0, side: THREE.BackSide }),
  );
  for (const m of [front, back]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    rig.add(m);
  }

  const zc = new Float32Array(rows);
  const yc = new Float32Array(rows);
  const ph = new Float32Array(rows);

  /* feed: 0..1 while the head is printing (sustained flutter);
     kick: a jolt on every line step that buckles the paper right at the slot */
  function updatePaper(L, t, feed = 0, kick = 0, jam = 0) {
    L = Math.max(L, 0.02);
    const ds = L / SEG;
    let z = SLOT.z;
    let y = SLOT.y;
    let phi = Math.PI / 2 + LEAN + 0.03 * Math.sin(t * 0.7) + feed * 0.022 * Math.sin(t * 47) + kick * 0.035 - jam * 0.14; // a jam buckles the paper back toward the lid
    const r = CURL_R * (1 + 0.04 * Math.sin(t * 0.45));
    let grounded = false;

    for (let i = 0; i < rows; i++) {
      zc[i] = z;
      yc[i] = y;
      ph[i] = phi;
      const s = i * ds;
      if (!grounded && phi > 1.25 * Math.PI && y < GROUND_R + 0.01) grounded = true;
      if (grounded) phi = Math.max(Math.PI, phi - ds / GROUND_R);
      else if (s >= RISE) phi = Math.min(1.5 * Math.PI, phi + ds / r);
      z += Math.cos(phi) * ds;
      y = Math.max(0.004, y + Math.sin(phi) * ds);
    }

    for (let i = 0; i < rows; i++) {
      const s = i * ds;
      const pp = L - s; // distance from the tip along the receipt
      const v = 1 - pp / LTEX; // tip (s = L) shows the top of the canvas
      let fold = 0;
      for (const c of creases) {
        const d = (pp - c.p) / CREASE_W;
        if (d > -4 && d < 4) fold += c.dir * CREASE_H * Math.exp(-d * d);
      }
      const nz = Math.sin(ph[i]);
      const ny = -Math.cos(ph[i]);
      const sway = 0.025 * Math.sin(s * 1.3 - t * 0.9) * (s / (L + 1e-3)) + feed * 0.004 * Math.sin(t * 61 + s * 9);
      // a ripple that runs up from the slot while feeding, and a short buckle per line
      const ripple =
        feed * 0.011 * Math.sin(s * 22 - t * 38) * Math.exp(-s * 1.8) +
        kick * 0.022 * Math.sin(s * 14) * Math.exp(-s * 3.2);
      const crumpleFall = jam * Math.exp(-s * 2.3);
      const cupFade = Math.min(1, s / 0.35);
      for (let c = 0; c < cols; c++) {
        const u = c / XSEG;
        const k = 2 * u - 1;
        // jammed paper crinkles near the slot: interfering sines across length and width
        const crumple = crumpleFall * 0.06 * Math.sin(s * 31 + k * 4.3) * Math.sin(s * 13 - k * 6.1 + 1.2);
        const off = CUP * k * k * cupFade + fold * cupFade * (0.75 + 0.25 * k) + ripple * (1 - 0.35 * k * k) + crumple; // folds skew slightly across the width
        const o = i * cols + c;
        pos[o * 3] = (u - 0.5) * PAPER_W + sway;
        pos[o * 3 + 1] = yc[i] + ny * off;
        pos[o * 3 + 2] = zc[i] + nz * off;
        uvs[o * 2] = u;
        uvs[o * 2 + 1] = v;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.computeVertexNormals();
  }

  /* ---- layout: printer right of the copy on wide screens, centred on narrow ---- */
  const base = { x: 0, rotY: -0.25, cam: new THREE.Vector3(), look: new THREE.Vector3() };
  function layout() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const wide = camera.aspect > 1.15 && window.innerWidth > 900;
    if (wide) {
      base.x = clamp(camera.aspect * 1.0 + 0.15, 1.4, 3.0);
      base.rotY = -0.4;
      base.cam.set(0, 1.9, 8.6);
      base.look.set(0, 1.38, 0); // a little low, so the machine sits clear of the bottom fade
      stub.position.set(-1.62, 0, 1.12); // in the gap between the copy and the machine
      stub.rotation.y = 0.5;
      stub.scale.setScalar(1.22);
      slips.setLandingArea({ x: [-1.25, 0.2], z: [1.25, 1.75] });
      lamp.place({ x: -2.05, z: -0.25 }, { x: -0.75, z: 1.35 }, LAMP_AIM); // left of the machine, reaching over the front
    } else {
      base.x = 0;
      base.rotY = -0.3;
      base.cam.set(0, 1.9, Math.max(8.0, 5.2 / camera.aspect));
      base.look.set(0, 1.45, 0);
      stub.position.set(-0.5, 0, 1.4); // narrow frame: in front of the machine so it isn't cropped
      stub.rotation.y = -0.22;
      stub.scale.setScalar(1);
      slips.setLandingArea({ x: [-0.8, 0.8], z: [1.3, 1.75] });
      lamp.place({ x: 1.12, z: -0.55 }, { x: 1.05, z: 1.4 }, LAMP_AIM); // narrow frame: right side, reaching over the front
    }
    camera.updateProjectionMatrix();
  }
  layout();
  new ResizeObserver(layout).observe(canvas);

  /* ---- input ---- */
  const pointer = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  if (!reduced && matchMedia('(pointer: fine)').matches) {
    window.addEventListener(
      'pointermove',
      (e) => {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      },
      { passive: true },
    );
  }
  const stage = canvas.parentElement;
  const hint = document.getElementById('heroHint');
  let hintState = '';
  const heroProgress = () => {
    const r = hero.getBoundingClientRect();
    const pinned = getComputedStyle(stage).position === 'sticky';
    // pinned (desktop): progress over the scroll track; flowing (mobile): while the canvas scrolls away
    const span = pinned ? r.height - window.innerHeight : r.height * 0.8;
    return clamp(-r.top / Math.max(1, span), 0, 1);
  };
  const setHint = (p, jammed = false) => {
    const next = jammed ? 'jam' : torn ? 'done' : p > 0.02 ? 'feeding' : 'idle';
    if (!hint || next === hintState) return;
    hintState = next;
    hint.textContent =
      next === 'jam'
        ? 'Paper jam. Scroll a little slower'
        : next === 'done'
        ? 'Torn off. Your copy is below'
        : next === 'feeding'
          ? 'Feeding paper…'
          : "Scroll to feed the paper, or press the printer's button";
  };

  /* ---- ambient light pool behind the canvas, tracking the printer on screen ---- */
  const probe = new THREE.Vector3();
  let glowKey = '';
  function placeGlow() {
    // positions in px relative to the stage, so it also works when the canvas
    // is only the top part of the stage (mobile)
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    probe.set(0, 0.9, 0.2);
    rig.localToWorld(probe).project(camera);
    const gx = Math.round(canvas.offsetLeft + (probe.x * 0.5 + 0.5) * w);
    const gy = Math.round(canvas.offsetTop + (-probe.y * 0.5 + 0.5) * h);
    // where the desk plane meets the wall, far behind the printer
    probe.set(rig.position.x, 0, -40).project(camera);
    const hy = Math.round(canvas.offsetTop + (-probe.y * 0.5 + 0.5) * h);
    const k = `${gx}|${gy}|${hy}`;
    if (k === glowKey) return;
    glowKey = k;
    stage.style.setProperty('--glow-x', `${gx}px`);
    stage.style.setProperty('--glow-y', `${gy}px`);
    stage.style.setProperty('--horizon', `${hy}px`);
  }

  /* ---- the printer's feed button prints a fact slip ---- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoverDirty = false;
  let hoverXY = null;
  let press = 0;
  let boostUntil = 0;
  let factIdx = Math.floor(Math.random() * FACTS.length);
  let lastFactAt = -1e9;
  const tape = (text) => window.dispatchEvent(new CustomEvent('receipt:tape', { detail: text }));

  function hitsButton(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(printer.buttonTargets, false).length > 0;
  }
  function hitsLamp(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(lamp.hitTargets, false).length > 0;
  }

  function printFact() {
    const now = performance.now();
    if (now - lastFactAt < 900) return; // one slip at a time
    lastFactAt = now;
    sound.click();
    press = 1;
    boostUntil = now + 700;
    kick = 1;
    for (let i = 0; i < 9; i++) setTimeout(() => sound.buzz(), 120 + i * 60);
    const text = FACTS[factIdx % FACTS.length];
    factIdx += 1;
    setTimeout(() => {
      const no = slips.spawn(text);
      tape(`> fact #${String(no).padStart(2, '0')}: ${text}`);
      start(); // make sure the loop is running to animate it
    }, reduced ? 0 : 420);
  }
  window.addEventListener('printer:print-fact', printFact);

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    hoverXY = [e.clientX, e.clientY];
    hoverDirty = true;
  });
  canvas.addEventListener('pointerleave', () => {
    hoverXY = null;
    canvas.style.cursor = '';
  });
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved >= 8) return;
    if (hitsButton(e.clientX, e.clientY)) printFact();
    else if (hitsLamp(e.clientX, e.clientY)) window.dispatchEvent(new Event('lamp:toggle'));
  });

  /* ---- loop ---- */
  let L = reduced ? introL : 0.03;
  let fed = reduced ? introL : 0.03;
  let introDone = reduced;
  let lastFeedAt = 0;
  let lastStep = -1;
  let feed = 0; // sustained print flutter, 0..1
  let kick = 0; // per-line jolt, decays fast
  let torn = false;
  let tornAt = 0; // when the torn piece started to fall (0 once it has left the frame)

  function tearOff(now) {
    torn = true;
    tornAt = reduced ? 0 : now;
    if (reduced) L = STUB;
    sound.tear();
    tape('> torn off. your copy is below');
    window.dispatchEvent(new Event('receipt:torn'));
  }
  // the torn piece falls forward, off the desk and out of the bottom of the frame
  function dropPaper(now) {
    const k = Math.min(1, (now - tornAt) / DROP_MS);
    for (const m of [front, back]) {
      m.position.set(0, -7 * k * k + 0.25 * Math.sin(k * Math.PI), 1.8 * (1 - (1 - k) ** 2));
      m.rotation.x = 0.7 * k * k;
    }
    if (k < 1) return;
    tornAt = 0;
    L = STUB; // the next sheet waits in the slot
    for (const m of [front, back]) {
      m.position.set(0, 0, 0);
      m.rotation.x = 0;
    }
  }

  /* ---- paper jam: only from genuinely fast wheel / trackpad / touch scrolling ----
     Link clicks, number-key jumps and PageDown scroll programmatically or by key,
     so jams require a wheel/touch event in the last 200 ms. */
  const JAM_SPEED = 1700; // px per second, sustained (a fast mouse-wheel spin or a trackpad flick)
  const JAM_SUSTAIN = 70; // ms of continuous fast scrolling before it jams (time-based, so fps doesn't matter)
  const JAM_LOCK = 900; // ms the page physically refuses to scroll, like stuck paper
  const JAM_HOLD = 1500; // ms the printer stays jammed
  const JAM_COOLDOWN = 2500; // ms after a jam clears before it can jam again
  let lastGestureAt = -1e9;
  let prevScrollY = window.scrollY;
  let prevScrollAt = performance.now();
  let speed = 0; // signed px/s: positive = scrolling down = paper feeding out
  let fastSince = 0;
  let jamUntil = 0;
  let jamCooldownUntil = 0;
  let jam = 0; // crumple amount, eased
  let jamShake = 0;
  const markGesture = () => (lastGestureAt = performance.now());
  window.addEventListener('wheel', markGesture, { passive: true });
  window.addEventListener('touchmove', markGesture, { passive: true });

  // The jam *holds* the page for a moment. Blocking listeners are attached only
  // while jammed, so normal scrolling never pays for a non-passive handler.
  const jamAlert = document.getElementById('jamAlert');
  let lockY = 0;
  const block = (e) => e.preventDefault();
  const holdScroll = () => {
    if (Math.abs(window.scrollY - lockY) > 1) window.scrollTo({ top: lockY, behavior: 'instant' });
  };
  function lockPage() {
    lockY = window.scrollY;
    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('scroll', holdScroll, { passive: true });
    stage.classList.remove('is-jammed');
    void stage.offsetWidth;
    stage.classList.add('is-jammed');
    if (jamAlert) jamAlert.hidden = false;
    setTimeout(unlockPage, JAM_LOCK);
  }
  function unlockPage() {
    window.removeEventListener('wheel', block);
    window.removeEventListener('touchmove', block);
    window.removeEventListener('scroll', holdScroll);
  }
  let t = 0;
  let prev = performance.now();
  let raf = 0;
  let visible = true;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (!reduced) t += dt;

    // intro: feed one line every ~50 ms, like a real print head
    if (!introDone && now - lastFeedAt > 50) {
      lastFeedAt = now;
      fed = Math.min(introL, fed + LINE);
      sound.buzz();
      kick = 1;
      if (fed >= introL) introDone = true;
    }

    // scroll: keep feeding, quantised to whole lines
    let target = fed;
    const p = heroProgress();
    if (introDone) {
      if (!torn && p >= TEAR_AT) tearOff(now);
      else if (torn && !tornAt && p < REATTACH_AT) {
        torn = false; // scrolled back: print it again
        for (let i = 0; i < 8; i++) setTimeout(() => sound.buzz(), i * 60);
      }
      const step = Math.floor((Math.min(1, p / TEAR_AT) * (maxL - introL)) / LINE);
      if (step !== lastStep) {
        if (lastStep !== -1 && now >= jamUntil && !torn) {
          sound.buzz();
          kick = 1;
        }
        lastStep = step;
      }
      target = torn ? STUB : introL + step * LINE;
    }
    // jam detection (real elapsed time, so a slow frame can't fake a fast scroll)
    const sy = window.scrollY;
    const el = Math.max(1, now - prevScrollAt) / 1000;
    speed += ((sy - prevScrollY) / el - speed) * (1 - Math.exp(-el / 0.04)); // signed, 40 ms time constant, fps-independent
    prevScrollY = sy;
    prevScrollAt = now;
    const canJam =
      !reduced && now >= jamCooldownUntil && now - lastGestureAt < 200 && p > 0.01 && p < 0.99;
    // fast for JAM_SUSTAIN ms, counted from the start of the frame where it got fast,
    // so one long frame on a slow device counts the same as several short ones
    // only feeding (scrolling down) jams; scrolling up rewinds the paper and never should
    if (canJam && speed > JAM_SPEED) fastSince ||= now - el * 1000;
    else fastSince = 0;
    if (fastSince && now - fastSince >= JAM_SUSTAIN) {
      fastSince = 0;
      jamUntil = now + JAM_HOLD;
      jamCooldownUntil = jamUntil + JAM_COOLDOWN;
      jamShake = 1;
      sound.jam();
      lockPage();
      tape('> PAPER JAM! scroll a little slower');
      setTimeout(() => {
        if (jamAlert) jamAlert.hidden = true;
        stage.classList.remove('is-jammed');
        tape('> jam cleared, printing resumed');
        for (let i = 0; i < 6; i++) setTimeout(() => sound.buzz(), i * 60);
      }, JAM_HOLD);
    }
    const jammed = now < jamUntil;
    if (!reduced) jam += ((jammed ? 1 : 0) - jam) * (1 - Math.exp(-dt * (jammed ? 14 : 3.5)));

    // while jammed the paper doesn't move; afterwards it catches up. A falling piece keeps its length.
    if (tornAt) dropPaper(now);
    else if (!jammed) L += reduced ? target - L : (target - L) * (1 - Math.exp(-dt * 14));

    const printing = !jammed && !tornAt && (Math.abs(target - L) > 0.004 || !introDone || now < boostUntil);
    // error blink while jammed, flicker while printing, dim at rest
    printer.led.material.emissiveIntensity = jammed
      ? Math.sin(now / 52) > 0
        ? 3.2
        : 0.05
      : printing
        ? 1.6 + Math.random() * 0.9
        : 0.35;
    if (!reduced) {
      feed += ((printing ? 1 : 0) - feed) * (1 - Math.exp(-dt * (printing ? 16 : 4)));
      kick *= Math.exp(-dt * 11);
      // the shell shivers a little with the stepper motor
      jamShake *= Math.exp(-dt * 7);
      printer.group.position.x = feed * 0.0035 * Math.sin(t * 73) + jamShake * 0.014 * Math.sin(now / 9);
      printer.group.position.y = feed * 0.002 * Math.abs(Math.sin(t * 91)) + jamShake * 0.006 * Math.abs(Math.sin(now / 7));
    }

    smooth.x += (pointer.x - smooth.x) * (1 - Math.exp(-dt * 4));
    smooth.y += (pointer.y - smooth.y) * (1 - Math.exp(-dt * 4));
    rig.position.x = base.x;
    // pointer turns the machine on the desk (yaw only: tilting the rig would sink
    // things into the desk) and nudges the camera for parallax
    rig.rotation.y = base.rotY + smooth.x * 0.22;

    // while feeding, turn the printer toward the viewer and lean in to read the paper
    rig.rotation.y += p * 0.22;
    // while feeding, ease back a touch so the growing paper and the base both stay in frame
    camera.position.set(
      base.cam.x + base.x * p * 0.3 + smooth.x * 0.22,
      base.cam.y + p * 0.3 - smooth.y * 0.14,
      base.cam.z + p * 0.55,
    );
    look.set(base.look.x + base.x * p * 0.3, base.look.y + p * 0.32, base.look.z);
    camera.lookAt(look);
    setHint(p, jammed);

    key.target.position.set(rig.position.x - 0.6, 0, 0.4);
    key.position.set(rig.position.x + 5.5, 5.2, 3.2);
    dust?.update(t);
    placeGlow();

    lighting.update(dt, now);
    updatePaper(L, t, feed, kick, jam);
    slips.update(dt);

    // button travel + hover cursor (raycast at most once per frame)
    press *= Math.exp(-dt * 9);
    printer.btn.position.z = printer.btnZ - press * 0.03;
    if (hoverDirty && hoverXY) {
      hoverDirty = false;
      canvas.style.cursor = hitsButton(hoverXY[0], hoverXY[1]) || hitsLamp(hoverXY[0], hoverXY[1]) ? 'pointer' : '';
    }
    renderer.render(scene, camera);
  }

  const start = () => {
    if (!raf && visible && !document.hidden) {
      prev = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? start() : stop();
  }).observe(hero);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();

  return { stop };
}

/* ---- printer built from primitives ---- */
function buildPrinter() {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.55 });
  const lid = new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.6 });
  const gap = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 1 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa9afb5, roughness: 0.28, metalness: 0.85 });

  const add = (g, m, x, y, z) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  add(new RoundedBoxGeometry(2.2, 1.0, 1.9, 4, 0.14), body, 0, 0.5, 0); // shell, front face at z = 0.95
  add(new RoundedBoxGeometry(2.08, 0.2, 1.22, 4, 0.08), lid, 0, 1.02, -0.3); // lid over the paper roll
  add(new RoundedBoxGeometry(2.08, 0.16, 0.5, 4, 0.06), dark, 0, 1.0, 0.66); // front bezel
  add(new THREE.BoxGeometry(1.72, 0.06, 0.1), gap, 0, 1.07, 0.36); // paper slot
  add(new THREE.BoxGeometry(1.76, 0.035, 0.04), metal, 0, 1.105, 0.43); // tear bar

  const led = add(
    new THREE.CylinderGeometry(0.035, 0.035, 0.03, 20),
    new THREE.MeshStandardMaterial({ color: 0x3a0d0d, emissive: 0xff3b30, emissiveIntensity: 0.35 }),
    0.78,
    0.72,
    0.955,
  );
  led.rotation.x = Math.PI / 2;
  const btn = add(
    new THREE.CylinderGeometry(0.09, 0.09, 0.05, 28),
    new THREE.MeshStandardMaterial({ color: 0xd9dbd6, roughness: 0.5 }),
    0.78,
    0.45,
    0.96,
  );
  btn.rotation.x = Math.PI / 2;
  // generous invisible hit area so the small button is easy to press
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.08, 20),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  hit.rotation.x = Math.PI / 2;
  hit.position.copy(btn.position);
  group.add(hit);

  // model plate on the front
  const lc = document.createElement('canvas');
  lc.width = 512;
  lc.height = 96;
  const g = lc.getContext('2d');
  g.fillStyle = '#9aa0a7';
  g.font = '600 40px "Martian Mono Variable", ui-monospace, monospace';
  g.textBaseline = 'middle';
  g.fillText('DTJ-80 thermal', 10, 50);
  const plateTex = new THREE.CanvasTexture(lc);
  plateTex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.16),
    new THREE.MeshBasicMaterial({ map: plateTex, transparent: true, toneMapped: false }),
  );
  plate.position.set(-0.5, 0.6, 0.952);
  group.add(plate);

  return { group, led, btn, btnZ: btn.position.z, buttonTargets: [btn, hit] };
}
