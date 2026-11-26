import * as THREE from 'three';

/* A desk lamp next to the printer. Clicking it (or the "Lamp" button) turns the
   scene to night: the room lights drop and a warm spot from the lamp takes over. */

const BODY = 0x2b2e33;
const WARM = 0xffd29a;

const up = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

// stretch a unit-height cylinder between two points
function placeRod(mesh, a, b) {
  const d = tmpA.subVectors(b, a);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, d.length(), 1);
  mesh.quaternion.setFromUnitVectors(up, d.normalize());
}

export function buildLamp() {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: BODY, roughness: 0.42, metalness: 0.35 });
  const joint = new THREE.MeshStandardMaterial({ color: 0xa9afb5, roughness: 0.3, metalness: 0.85 });
  const inner = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7, side: THREE.BackSide });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: WARM, emissiveIntensity: 0 });

  const cast = (m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const base = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 40), metal));
  const rodGeo = new THREE.CylinderGeometry(0.032, 0.032, 1, 14);
  const lower = cast(new THREE.Mesh(rodGeo, metal));
  const upper = cast(new THREE.Mesh(rodGeo, metal));
  const j0 = cast(new THREE.Mesh(new THREE.SphereGeometry(0.06, 18, 12), joint));
  const j1 = cast(new THREE.Mesh(new THREE.SphereGeometry(0.06, 18, 12), joint));

  // shade: an open cone, dark outside and pale inside, with the bulb near its mouth
  const head = new THREE.Group();
  group.add(head);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.3, 0.42, 40, 1, true), metal);
  shade.material = metal.clone();
  shade.material.side = THREE.FrontSide;
  shade.castShadow = true;
  const lining = new THREE.Mesh(shade.geometry, inner);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  cap.position.y = 0.21;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), bulbMat);
  bulb.position.y = -0.06;
  // the cone's mouth points down its local -y
  head.add(shade, lining, cap, bulb);

  // generous invisible target so the lamp is easy to click
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 8),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  head.add(hit);

  const spot = new THREE.SpotLight(WARM, 0, 0, 0.66, 0.8, 1.6);
  spot.castShadow = false; // only at night (see lighting.set)
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0006;
  spot.shadow.normalBias = 0.03;
  spot.shadow.radius = 6;

  /** Base at `at`, arm reaching toward `reach`, shade aimed at `target` (all rig space).
      The arm reaches in FRONT of the paper so the lamp lights the printed face. */
  function place(at, reach, target) {
    const p0 = new THREE.Vector3(at.x, 0, at.z);
    const toT = new THREE.Vector3(reach.x - at.x, 0, reach.z - at.z);
    const dist = toT.length();
    toT.normalize();
    const side = new THREE.Vector3(-toT.z, 0, toT.x); // a little sideways kink, like a real arm

    base.position.set(p0.x, 0.04, p0.z);
    const a = p0.clone().setY(0.08);
    const b = p0.clone().addScaledVector(toT, -0.12).addScaledVector(side, 0.08).setY(1.22);
    const h = p0.clone().addScaledVector(toT, Math.min(1.25, dist * 0.8)).setY(2.15);
    placeRod(lower, a, b);
    placeRod(upper, b, h);
    j0.position.copy(b);
    j1.position.copy(h);

    head.position.copy(h);
    const aim = tmpB.copy(target).sub(h).normalize();
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim);
    head.position.addScaledVector(aim, 0.12);

    spot.position.copy(head.position).addScaledVector(aim, 0.05);
    spot.target.position.copy(target);
  }

  return { group, spot, bulb, hitTargets: [shade, lining, cap, bulb, hit], place };
}

/**
 * Day/night lighting. Eases every light toward its target each frame;
 * turning the lamp on flickers briefly, like a filament catching.
 */
export function createLighting({ hemi, key, fill, rim, ground, lamp, reduced }) {
  const DAY = { hemi: 1.35, key: 2.6, fill: 1.05, rim: 0.7, spot: 0, bulb: 0, shadow: 0.2 };
  const NIGHT = { hemi: 0.2, key: 0.12, fill: 0.09, rim: 0.32, spot: 14, bulb: 3.2, shadow: 0.42 };
  const cur = { ...DAY };
  let target = DAY;
  let flickerUntil = 0;
  const rimDay = new THREE.Color(0xe4ecff);
  const rimNight = new THREE.Color(0x8fa6ff);

  function set(on, { instant = false } = {}) {
    target = on ? NIGHT : DAY;
    lamp.spot.castShadow = on;
    flickerUntil = on && !instant && !reduced ? performance.now() + 320 : 0;
    if (instant || reduced) Object.assign(cur, target);
    rim.color.copy(on ? rimNight : rimDay);
  }

  function update(dt, now) {
    const k = 1 - Math.exp(-dt * 7);
    for (const name of Object.keys(cur)) cur[name] += (target[name] - cur[name]) * k;
    const flick = now < flickerUntil ? (Math.random() < 0.45 ? 0.15 : 1) : 1;
    hemi.intensity = cur.hemi;
    key.intensity = cur.key;
    fill.intensity = cur.fill;
    rim.intensity = cur.rim;
    lamp.spot.intensity = cur.spot * flick;
    lamp.bulb.material.emissiveIntensity = cur.bulb * flick;
    ground.material.opacity = cur.shadow;
  }

  return { set, update };
}
