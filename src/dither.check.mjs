// node src/dither.check.mjs — Atkinson must print white as paper, black as ink, mid-grey as a mix
import assert from 'node:assert/strict';
import { atkinson } from './dither.js';

const n = 32 * 32;
const ink = (v) => atkinson(new Float32Array(n).fill(v), 32, 32).reduce((a, b) => a + b, 0) / n;
assert.equal(ink(1), 0);
assert.equal(ink(0), 1);
const mid = ink(0.5);
assert.ok(mid > 0.3 && mid < 0.7, `mid-grey ink coverage ${mid}`);
console.log('dither ok');
