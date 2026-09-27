// Functional checks: pitch, delay time, reverb decay, EQ gain, talking-modulator formants
global.TFX = require('../../fxcat.js').TFX; Object.assign(global, require('../../fxdsp.js'));
const sr = 48000, N = 128;
function run(id, p, gen, secs, x) {
  const e = TFX.byId(id), u = FxRack.make(sr, e), P = Object.assign(TFX.defaults(id), p);
  const n = Math.round(secs * sr / N) * N, oL = new Float32Array(n), oR = new Float32Array(n), L = new Float32Array(N), R = new Float32Array(N);
  x = x || { src: new Float64Array(27), note: 60, trig: 1 };
  for (let b = 0; b < n / N; b++) { for (let i = 0; i < N; i++) { const v = gen(b * N + i); L[i] = v; R[i] = v; } u.process(L, R, N, P, x); oL.set(L, b * N); oR.set(R, b * N); }
  return [oL, oR];
}
const rms = (a, s, e) => { let t = 0; for (let i = s; i < e; i++) t += a[i] * a[i]; return Math.sqrt(t / (e - s)); };
function freq(a, s, e) { // zero-crossing frequency estimate
  let c = 0, first = -1, last = -1; for (let i = s + 1; i < e; i++) if (a[i - 1] < 0 && a[i] >= 0) { if (first < 0) first = i; last = i; c++; }
  return (c - 1) * sr / (last - first);
}
function dft(a, s, e, f) { let re = 0, im = 0; for (let i = s; i < e; i++) { const w = 2 * Math.PI * f * i / sr; re += a[i] * Math.cos(w); im += a[i] * Math.sin(w); } return Math.hypot(re, im) / (e - s) * 2; }
const sine = f => i => Math.sin(2 * Math.PI * f * i / sr) * 0.5;
// pitch shifter: +12 st, wet 100 -> 880 Hz
{ const [o] = run('S2:34', { shift: 12, fine: 0, wet: 100, fb: 0, delay: 0 }, sine(440), 1); console.log('Pitch shifter +12 st: 440 Hz ->', freq(o, sr * 0.3, sr).toFixed(1), 'Hz; 880 Hz amp', dft(o, sr * 0.3, sr, 880).toFixed(3), '440 amp', dft(o, sr * 0.3, sr, 440).toFixed(3)); }
{ const [o] = run('S2:34', { shift: -7, fine: 0, wet: 100, fb: 0, delay: 0, mode: 0 }, sine(440), 1); console.log('Pitch shifter -7 st: ->', freq(o, sr * 0.3, sr).toFixed(1), 'Hz (expect', (440 * Math.pow(2, -7 / 12)).toFixed(1) + ')'); }
{ const [o, o2] = run('S2:33', { cents: 20, wet: 100 }, sine(440), 1); console.log('Detune +/-20 ct: L', freq(o, sr * 0.3, sr).toFixed(2), 'R', freq(o2, sr * 0.3, sr).toFixed(2), '(expect', (440 * Math.pow(2, 20 / 1200)).toFixed(2), (440 * Math.pow(2, -20 / 1200)).toFixed(2) + ')'); }
// delays: impulse -> first echo time
function echo(id, p, key) { const [o, o2] = run(id, p, i => i === 0 ? 1 : 0, 1.6); let mx = 0, at = 0, mx2 = 0, at2 = 0; for (let i = 10; i < o.length; i++) { if (Math.abs(o[i]) > mx) { mx = Math.abs(o[i]); at = i; } if (Math.abs(o2[i]) > mx2) { mx2 = Math.abs(o2[i]); at2 = i; } } return [(at / sr * 1000).toFixed(1), (at2 / sr * 1000).toFixed(1), mx.toFixed(2)]; }
console.log('S1 Delay 250 ms:', echo('S1:26', { time: 250, fb: 0, wet: 100 }));
console.log('Stereo Delay L300/R450:', echo('S2:38', { timeL: 300, timeR: 450, fb: 0, wet: 100, spread: 100 }));
console.log('L/C/R Long Delay master L700 C0lvl R1200:', echo('MR:0', { timeL: 700, timeC: 900, timeR: 1200, lvlL: 50, lvlC: 0, lvlR: 50, spread: 50, out: 100, fb: 0 }));
console.log('Tempo Delay 120bpm 1/4 (500ms):', echo('S2:41', { tempo: 120, len: 1, lenDiv: 4, wet: 100, fb: 0 }));
// reverb decay: time for the tail to drop 30 dB, x2 -> RT60 estimate
function rt(id, t) {
  const [o] = run(id, { time: t, hd: 0, pd: 0, out: 100, wet: 100, er: 0, lo: 0, hi: 0, trim: id[0] === 'M' ? 30 : 100 }, i => i < 480 ? (Math.random() * 2 - 1) : 0, t * 1.4 + 0.5);
  const w = 2400, env = []; for (let s = 0; s + w < o.length; s += w) env.push(20 * Math.log10(rms(o, s, s + w) + 1e-12));
  const pk = Math.max(...env), i5 = env.findIndex(v => v < pk - 5), i35 = env.findIndex(v => v < pk - 35);
  return i35 > 0 ? ((i35 - i5) * w / sr * 2).toFixed(2) : 'n/a';
}
for (const id of ['MR:4', 'MR:5', 'MR:2', 'MR:6', 'MR:7', 'S2:46']) console.log('RT60', id, TFX.byId(id).name, 'set 2.0 s ->', rt(id, 2), 's; set 4.0 ->', rt(id, 4));
// EQ: +12 dB at band 3 of the parametric EQ (2 kHz)
{ const [o] = run('S2:6', { f3: 2000, g3: 12, q3: 1, g1: 0, g2: 0, g4: 0, wet: 100, trim: 100 }, sine(2000), 0.5); console.log('P4EQ +12 dB @2k:', (20 * Math.log10(rms(o, 4800, 24000) / (0.5 / Math.SQRT2))).toFixed(2), 'dB'); }
{ const F = FxEQ.gFreq(0); console.log('GEQ7 Wide 1 bands', F.map(f => Math.round(f)).join(' ')); const [o] = run('S1:6', { type: 0, b4: -12, wet: 100, trim: 100 }, sine(F[3]), 0.5); console.log('GEQ7 band4 -12 dB:', (20 * Math.log10(rms(o, 4800, 24000) / (0.5 / Math.SQRT2))).toFixed(2), 'dB'); }
// Talking Modulator: vowel A vs I on a bright pulse train, compare energy near F2
{ const saw = i => ((i * 110 / sr) % 1) * 2 - 1; const A = run('S2:11', { manual: 0, src: 0, bottom: 0, wet: 100, reso: 60, shift: 0 }, saw, 0.6)[0], I = run('S2:11', { manual: 0, src: 0, bottom: 1, wet: 100, reso: 60, shift: 0 }, saw, 0.6)[0];
  const band = (a, f) => dft(a, 9600, 28800, Math.round(f / 110) * 110);
  console.log('Talk A: F1(650)', band(A, 650).toFixed(3), 'F2(1100)', band(A, 1080).toFixed(3), 'I-F2(1870)', band(A, 1870).toFixed(3), '| Talk I: 290', band(I, 290).toFixed(3), '1870', band(I, 1870).toFixed(3), '650', band(I, 650).toFixed(3), 'rms A', rms(A, 9600, 28800).toFixed(3), 'I', rms(I, 9600, 28800).toFixed(3), 'in', (1 / Math.sqrt(3)).toFixed(3)); }
