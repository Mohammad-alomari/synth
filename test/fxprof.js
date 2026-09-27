// Per-unit CPU inside a realistic rack (several effect classes alive at once, so calls are polymorphic)
const H = require('./harness.js'); const X = H.load(H.ORDER);
const sr = 48000, N = 128, secs = 4;
const ids = (process.argv[2] || 'S2:16,S2:9,S2:15,MR:5,MM:5,S2:13,S2:11,MR:1,S1:2,S2:6').split(',');
const units = ids.map(id => { const u = X.FxRack.make(sr, X.TFX.byId(id)); if (id[0] === 'M') u.master = true; u.x = { src: new Float64Array(40), note: 60, trig: 1 }; return u; });
const P = ids.map(id => X.TFX.defaults(id));
const L = new Float32Array(N), R = new Float32Array(N), t = new Float64Array(ids.length);
let ph = 0;
for (let b = 0; b < secs * sr / N; b++) {
  for (let k = 0; k < units.length; k++) {
    for (let i = 0; i < N; i++) { ph += 220 / sr; if (ph > 1) ph -= 1; L[i] = R[i] = (ph * 2 - 1) * 0.3; }
    const t0 = process.hrtime.bigint(); units[k].process(L, R, N, P[k], units[k].x); t[k] += Number(process.hrtime.bigint() - t0);
  }
}
ids.forEach((id, k) => console.log(id.padEnd(6), X.TFX.byId(id).name.padEnd(22), (t[k] / 1e9 / secs * 100).toFixed(2) + '%'));
console.log('total', (t.reduce((a, b) => a + b) / 1e9 / secs * 100).toFixed(1) + '%');
