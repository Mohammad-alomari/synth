// Runs every effect type with default parameters on noise + a saw chord; reports NaN, gain and CPU time.
global.TFX = require('../fxcat.js').TFX;
const D = require('../fxdsp.js'); Object.assign(global, D);
const sr = 48000, N = 128, secs = +(process.env.SECS || 2);
function sig(i) { // bright saw chord + a bit of noise, with gaps so tails are exercised
  const t = i / sr, g = (t % 1) < 0.6 ? 1 : 0;
  let s = 0; for (const f of [220, 277.2, 329.6]) s += ((t * f) % 1) * 2 - 1;
  return g * (s * 0.12 + (Math.random() * 2 - 1) * 0.03);
}
const rows = [];
for (const e of TFX.CAT) {
  const u = FxRack.make(sr, e); const p = TFX.defaults(e.id);
  const L = new Float32Array(N), R = new Float32Array(N); let inE = 0, outE = 0, bad = 0, peak = 0;
  const x = { src: new Float64Array(27), note: 57, vel: 0.8, trig: 1, mic: null };
  const t0 = process.hrtime.bigint();
  for (let b = 0; b < secs * sr / N; b++) {
    for (let i = 0; i < N; i++) { const v = sig(b * N + i); L[i] = v; R[i] = e.master ? v : v * 0.9; inE += v * v; }
    x.src[8] = (Math.sin(b / 100) + 1) / 2; if (b % 200 === 0) x.trig++;
    u.process(L, R, N, p, x);
    for (let i = 0; i < N; i++) { const a = L[i], c = R[i]; if (!(a === a) || !(c === c) || !isFinite(a) || !isFinite(c)) bad++; outE += (a * a + c * c) / 2; peak = Math.max(peak, Math.abs(a), Math.abs(c)); }
  }
  const us = Number(process.hrtime.bigint() - t0) / 1e3 / secs; // microseconds per second of audio
  rows.push([e.id.padEnd(6), e.name.padEnd(22), 'gain ' + (10 * Math.log10(outE / inE)).toFixed(1).padStart(6) + ' dB', 'peak ' + peak.toFixed(2).padStart(6), 'cpu ' + (us / 1e4).toFixed(2).padStart(6) + '%', bad ? 'NaN x' + bad : '']);
}
for (const r of rows) console.log(r.join('  '));
