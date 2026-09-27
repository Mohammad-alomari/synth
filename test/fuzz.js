// Random-parameter fuzzing of every effect: no NaN/Infinity, output stays bounded
global.TFX = require('../fxcat.js').TFX; Object.assign(global, require('../fxdsp.js'));
const sr = 48000, N = 128; let seed = 1; const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const bad = [];
for (const e of TFX.CAT) for (let trial = 0; trial < 12; trial++) {
  const p = TFX.defaults(e.id);
  for (const q of e.params) { if (q[2] === 'sel') p[q[0]] = Math.floor(rnd() * q[3].length); else if (q[2] === 'src') p[q[0]] = Math.floor(rnd() * 36); else p[q[0]] = trial < 2 ? (trial ? q[3] : q[2]) : q[2] + (q[3] - q[2]) * rnd(); }
  if (trial % 3 === 0) { p.wsrc = Math.floor(rnd() * 36); p.wamt = rnd() * 200 - 100; }
  const u = FxRack.make(sr, e); if (trial % 4 === 1) u.master = true;
  const x = { src: new Float64Array(40), note: Math.floor(rnd() * 128), trig: 0 }; u.x = x;
  const L = new Float32Array(N), R = new Float32Array(N); let pk = 0, nan = 0;
  for (let b = 0; b < 0.8 * sr / N; b++) {
    for (let k = 0; k < 40; k++) x.src[k] = rnd() < 0.02 ? rnd() * 2 - 1 : x.src[k]; if (b % 50 === 0) x.trig++;
    const kind = Math.floor(b / 60) % 4;
    for (let i = 0; i < N; i++) { const t = b * N + i; L[i] = kind === 0 ? Math.sin(t * 0.05) * 0.9 : kind === 1 ? (rnd() * 2 - 1) : kind === 2 ? 0 : 0.7; R[i] = kind === 3 ? -0.7 : L[i]; }
    u.process(L, R, N, p, x);
    for (let i = 0; i < N; i++) { if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nan++; else pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); }
  }
  if (nan || pk > 40) bad.push([e.id, e.name, trial, nan ? 'NaN x' + nan : 'peak ' + pk.toFixed(1), JSON.stringify(p).slice(0, 300)]);
}
console.log(bad.length ? bad.map(b => b.join(' | ')).join('\n') : 'all bounded, no NaN');
if (bad.length) process.exitCode = 1;
