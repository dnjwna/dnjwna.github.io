// Synthesised thermal-printer chatter: short band-passed noise bursts plus a
// low stepper-motor tone. Off by default; only starts after a user gesture.

let ctx = null;
let noise = null;
let lastAt = 0;
const listeners = new Set();
const KEY = 'dtj-sound';

// On by default; a visitor who switches it off stays off on their next visit.
let enabled = true;
try {
  if (localStorage.getItem(KEY) === 'off') enabled = false;
} catch {
  /* storage blocked: keep the default */
}

function ensureContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  if (!ctx) {
    ctx = new AC();
    const len = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return true;
}

/* Browsers only allow audio after a real user gesture (click, tap, key).
   Scrolling doesn't count, so the context is unlocked on the first one. */
const unlockEvents = ['pointerdown', 'keydown', 'touchend'];
function unlock() {
  if (enabled) ensureContext();
  if (ctx && ctx.state === 'running') unlockEvents.forEach((e) => window.removeEventListener(e, unlock, true));
}
unlockEvents.forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));

export const sound = {
  get enabled() {
    return enabled;
  },

  toggle() {
    enabled = !enabled;
    if (enabled && !ensureContext()) enabled = false;
    try {
      localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {
      /* not persisted; fine */
    }
    listeners.forEach((fn) => fn(enabled));
    if (enabled) this.buzz(0.08);
    return enabled;
  },

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /**
   * Thermal paper tearing against the serrated bar: two short tugs, then a
   * crackly rip that sweeps up in pitch as the tear runs across the width.
   */
  tear({ delay = 0 } = {}) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    try {
      // tugs: dull paper flex before it gives
      for (const [at, f] of [
        [0, 210],
        [0.16, 240],
      ]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, t0 + at);
        o.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + at + 0.07);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.linearRampToValueAtTime(0.07, t0 + at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.08);
        o.connect(g).connect(ctx.destination);
        o.start(t0 + at);
        o.stop(t0 + at + 0.1);
      }

      // the rip itself: noise with sparse fibre "snaps", rising then trailing off
      const dur = 0.5;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const p = i / len;
        const env = p < 0.06 ? p / 0.06 : Math.pow(1 - p, 1.5);
        let v = (Math.random() * 2 - 1) * 0.3;
        if (Math.random() < 0.012 + 0.05 * (1 - p)) v += (Math.random() * 2 - 1) * 1.1;
        d[i] = v * env;
      }
      const rip = ctx.createBufferSource();
      rip.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 700;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.7;
      const ripAt = t0 + 0.3;
      band.frequency.setValueAtTime(1600, ripAt);
      band.frequency.exponentialRampToValueAtTime(4600, ripAt + dur * 0.8);
      const g = ctx.createGain();
      g.gain.value = 0.55;
      rip.connect(hp).connect(band).connect(g).connect(ctx.destination);
      rip.start(ripAt);
    } catch {
      /* decoration only */
    }
  },

  /** Paper jam: the motor grinds and stalls, then the printer beeps an error. */
  jam() {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    try {
      // grinding stall: detuned saws dropping in pitch, through a lowpass
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.13, now + 0.03);
      g.gain.setValueAtTime(0.13, now + 0.24);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      lp.connect(g).connect(ctx.destination);
      for (const det of [0, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(105 + det, now);
        o.frequency.exponentialRampToValueAtTime(48 + det, now + 0.36);
        o.connect(lp);
        o.start(now);
        o.stop(now + 0.4);
      }
      // gritty paper scrape on top
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.09, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      src.connect(bp).connect(ng).connect(ctx.destination);
      src.start(now, 0, 0.32);

      // error beeps
      for (const at of [0.5, 0.66]) {
        const b = ctx.createOscillator();
        b.type = 'square';
        b.frequency.value = 1046;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.0001, now + at);
        bg.gain.linearRampToValueAtTime(0.05, now + at + 0.005);
        bg.gain.setValueAtTime(0.05, now + at + 0.08);
        bg.gain.linearRampToValueAtTime(0.0001, now + at + 0.09);
        b.connect(bg).connect(ctx.destination);
        b.start(now + at);
        b.stop(now + at + 0.1);
      }
    } catch {
      /* decoration only */
    }
  },

  /** Cash register: the drawer clunks open, then the bell rings. */
  kaching() {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    try {
      // drawer: short lowpassed rattle + a thump
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      const dg = ctx.createGain();
      dg.gain.setValueAtTime(0.16, now);
      dg.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      src.connect(lp).connect(dg).connect(ctx.destination);
      src.start(now, Math.random() * 0.3, 0.13);
      const th = ctx.createOscillator();
      th.type = 'sine';
      th.frequency.setValueAtTime(140, now + 0.06);
      th.frequency.exponentialRampToValueAtTime(60, now + 0.16);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, now + 0.06);
      tg.gain.linearRampToValueAtTime(0.18, now + 0.07);
      tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      th.connect(tg).connect(ctx.destination);
      th.start(now + 0.06);
      th.stop(now + 0.2);

      // bell: two struck partials plus an inharmonic shimmer, long ring
      const at = now + 0.1;
      for (const [f, lvl, decay] of [
        [2093, 0.11, 1.1],
        [2637, 0.07, 0.9],
        [5420, 0.025, 0.35],
      ]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(lvl, at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
        o.connect(g).connect(ctx.destination);
        o.start(at);
        o.stop(at + decay + 0.02);
      }
    } catch {
      /* decoration only */
    }
  },

  /** Mechanical click of the printer's feed button. */
  click() {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    try {
      for (const [f, len, lvl, type] of [
        [1900, 0.012, 0.08, 'square'],
        [130, 0.05, 0.12, 'sine'],
      ]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f, now);
        o.frequency.exponentialRampToValueAtTime(f * 0.55, now + len);
        const g = ctx.createGain();
        g.gain.setValueAtTime(lvl, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + len);
        o.connect(g).connect(ctx.destination);
        o.start(now);
        o.stop(now + len + 0.01);
      }
    } catch {
      /* decoration only */
    }
  },

  /** One print-head line. Rate-limited so scroll bursts don't stack. */
  buzz(duration = 0.045, level = 0.16) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now - lastAt < 0.032) return;
    lastAt = now;

    try {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2600 + Math.random() * 900;
      band.Q.value = 1.1;

      const motor = ctx.createOscillator();
      motor.type = 'square';
      motor.frequency.value = 150 + Math.random() * 30;
      const motorGain = ctx.createGain();
      motorGain.gain.value = 0.035;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(level, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      src.connect(band).connect(env);
      motor.connect(motorGain).connect(env);
      env.connect(ctx.destination);

      src.start(now, Math.random() * 0.4, duration + 0.02);
      motor.start(now);
      motor.stop(now + duration + 0.02);
    } catch {
      /* audio is decoration; never let it break the page */
    }
  },
};
