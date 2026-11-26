// Printer and register sounds. Two recorded samples (public/sounds/) carry the
// print feed and the ka-ching; everything else, and any sample that hasn't
// loaded yet or failed to, is synthesised. Audio only starts after a user gesture.

let ctx = null;
let noise = null;
let lastAt = 0;
const listeners = new Set();
const KEY = 'dtj-sound';

// Loudness of the samples relative to the synth they replace. Tune by ear.
const PRINT_GAIN = 0.5; // at buzz()'s default level of 0.16
const KACHING_GAIN = 0.8;
const KACHING_SKIP = 0.19; // s of silence at the head of kaching.mp3

const SAMPLE_URLS = {
  print: `${import.meta.env.BASE_URL}sounds/receipt.mp3`,
  kaching: `${import.meta.env.BASE_URL}sounds/kaching.mp3`,
};
const samples = { print: null, kaching: null }; // decoded AudioBuffers
let fetched = null; // Promise<{print: ArrayBuffer|null, kaching: ArrayBuffer|null}>
let decoding = false;

// On by default; a visitor who switches it off stays off on their next visit.
let enabled = true;
try {
  if (localStorage.getItem(KEY) === 'off') enabled = false;
} catch {
  /* storage blocked: keep the default */
}

/** Download the samples once. No AudioContext needed, so this can run before a gesture. */
function fetchSamples() {
  if (fetched) return fetched;
  const get = (url) =>
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
  fetched = Promise.all([get(SAMPLE_URLS.print), get(SAMPLE_URLS.kaching)]).then(([print, kaching]) => ({
    print,
    kaching,
  }));
  return fetched;
}

/**
 * The receipt recording fades in and stops dead, so it can't loop as is.
 * Cut out the steady middle and crossfade its tail into its head
 * (equal-power) so the loop point has no click or level dip.
 */
function makeLoop(buf, from = 0.15, to = buf.duration - 0.06, xfade = 0.12) {
  const sr = buf.sampleRate;
  const a = Math.floor(from * sr);
  const b = Math.min(buf.length, Math.floor(to * sr));
  const x = Math.floor(xfade * sr);
  const n = b - a - x;
  if (n <= x) return buf; // too short to loop cleanly; play it raw
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < n; i++) dst[i] = src[a + i];
    for (let i = 0; i < x; i++) {
      const t = i / x;
      dst[i] = src[a + i] * Math.sin((t * Math.PI) / 2) + src[a + n + i] * Math.cos((t * Math.PI) / 2);
    }
  }
  return out;
}

function decodeSamples() {
  if (decoding || !ctx) return;
  decoding = true;
  const decode = (ab) =>
    ab
      ? new Promise((resolve) => {
          // callback form too: older Safari has no promise-returning decodeAudioData
          const p = ctx.decodeAudioData(ab, resolve, () => resolve(null));
          if (p && p.catch) p.catch(() => resolve(null));
        })
      : Promise.resolve(null);
  fetchSamples().then(async ({ print, kaching }) => {
    const [p, k] = await Promise.all([decode(print), decode(kaching)]);
    if (p) samples.print = makeLoop(p);
    if (k) samples.kaching = k;
  });
}

if (enabled) fetchSamples();

function ensureContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  if (!ctx) {
    ctx = new AC();
    const len = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    decodeSamples();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return true;
}

/*
 * The print motor. Every buzz() keeps it running a little longer, so a burst
 * of buzz() calls (one per printed line, 50-70 ms apart) becomes one
 * continuous run of the recording instead of a row of separate blips.
 */
let motor = null; // { src, gain, level, releasing, kill }
let motorUntil = 0; // ctx time the motor should spin down
let motorTimer = 0;
const MOTOR_HANG = 0.05; // s kept running past each call, bridges the gaps between lines
const MOTOR_RELEASE = 0.16; // s of fade-out before the source is actually stopped

function rampTo(gain, value, now, time) {
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(value, now + time);
}

function stopMotor() {
  motorTimer = 0;
  if (!motor || motor.releasing) return;
  const late = motorUntil - ctx.currentTime;
  if (late > 0.005) {
    motorTimer = setTimeout(stopMotor, late * 1000);
    return;
  }
  // Fade out, but keep the source alive for a moment: if another line comes in
  // during the fade, runMotor() picks the same playback back up, no restart.
  const m = motor;
  const now = ctx.currentTime;
  m.releasing = true;
  m.gain.gain.cancelScheduledValues(now);
  m.gain.gain.setValueAtTime(m.gain.gain.value, now);
  m.gain.gain.setTargetAtTime(0, now, 0.018);
  m.kill = setTimeout(() => {
    if (motor !== m || !m.releasing) return;
    motor = null;
    try {
      m.src.stop();
    } catch {
      /* already stopped */
    }
  }, MOTOR_RELEASE * 1000);
}

function runMotor(duration, level) {
  const now = ctx.currentTime;
  const target = PRINT_GAIN * (level / 0.16);
  if (motor && motor.releasing) {
    clearTimeout(motor.kill);
    motor.releasing = false;
    motor.level = target;
    rampTo(motor.gain, target, now, 0.008);
  }
  if (!motor) {
    const src = ctx.createBufferSource();
    src.buffer = samples.print;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(target, now + 0.008);
    src.connect(gain).connect(ctx.destination);
    // start somewhere random so short runs don't all sound the same
    src.start(now, Math.random() * samples.print.duration);
    motor = { src, gain, level: target, releasing: false, kill: 0 };
  } else if (target > motor.level) {
    rampTo(motor.gain, target, now, 0.01);
    motor.level = target;
  }
  motorUntil = Math.max(motorUntil, now + Math.max(duration, 0.045) + MOTOR_HANG);
  if (!motorTimer) motorTimer = setTimeout(stopMotor, (motorUntil - now) * 1000);
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
    if (enabled) fetchSamples();
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
    if (samples.kaching) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = samples.kaching;
        const g = ctx.createGain();
        g.gain.value = KACHING_GAIN;
        src.connect(g).connect(ctx.destination);
        src.start(now, KACHING_SKIP);
        return;
      } catch {
        /* fall through to the synth */
      }
    }
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

  /**
   * One print-head line. With the receipt sample loaded this keeps the print
   * motor running; otherwise it synthesises a blip, rate-limited so scroll
   * bursts don't stack.
   */
  buzz(duration = 0.045, level = 0.16) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    if (samples.print) {
      try {
        runMotor(duration, level);
        return;
      } catch {
        /* fall through to the synth */
      }
    }
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
