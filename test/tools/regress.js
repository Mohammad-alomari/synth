// Regression: renders programs with a reference source tree and the current one, compares the output sample by sample.
// Usage: node test/tools/regress.js [refdir] ; env STEP (program stride), SECS, ONLY (regex on id), DRY=1 (no effects)
const fs = require('fs'), path = require('path');
const REF = process.argv[2], CUR = path.join(__dirname, '..', '..');
if (!REF) { console.error('usage: node test/tools/regress.js <refdir>  (refdir = folder with an older copy of the sources)'); process.exit(2); }
function load(dir) {
  const src = ['fxcat.js', 'patches.js', 'engine.js', 'pcm.js', 'combi.js', 'fxdsp.js', 'korg.js', 'pcgdata.js'].filter(f => fs.existsSync(path.join(dir, f))).map(f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/if \(typeof module !== 'undefined'\)[^\n]*\n/g, '')).join('\n;\n') + '\nmodule.exports={MossEngine,mossDefaultPatch,mossPreset,korgDecodeMoss,MOSS_PCG_BUILTIN,MOSS_PRESETS,mossLoad};';
  const m = new module.constructor(); m._compile(src, path.join(dir, 'bundle_' + Math.random() + '.js')); return m.exports;
}
const A = load(REF), B = load(CUR), sr = 48000, N = 128;
let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const realRandom = Math.random;
function render(X, P, secs, events) {
  seed = 12345; Math.random = rnd;
  const e = new X.MossEngine(sr); e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(P)) });
  const blocks = Math.round(secs * sr / N), L = new Float32Array(N), R = new Float32Array(N), out = new Float32Array(blocks * N * 2);
  let t = 0; const ev = events.slice();
  const t0 = process.hrtime.bigint();
  for (let b = 0; b < blocks; b++) {
    while (ev.length && ev[0][0] <= b) e.handle(ev.shift()[1]);
    e.process(L, R, N);
    for (let i = 0; i < N; i++) { out[(b * N + i) * 2] = L[i]; out[(b * N + i) * 2 + 1] = R[i]; }
  }
  const cpu = Number(process.hrtime.bigint() - t0) / 1e9 / secs;
  Math.random = realRandom;
  return { out, cpu };
}
const secs = +(process.env.SECS || 1.5), blocksPerSec = sr / N;
const events = [[0, { t: 'on', n: 48, v: 100 }], [0, { t: 'on', n: 55, v: 90 }], [3, { t: 'on', n: 60, v: 110 }], [5, { t: 'on', n: 64, v: 70 }],
  [Math.round(0.3 * blocksPerSec), { t: 'bend', v: 0.3 }], [Math.round(0.4 * blocksPerSec), { t: 'cc', c: 1, v: 90 }], [Math.round(0.5 * blocksPerSec), { t: 'at', v: 0.6 }],
  [Math.round(0.45 * blocksPerSec), { t: 'cc', c: 73, v: 40 }], [Math.round(0.47 * blocksPerSec), { t: 'cc', c: 72, v: 90 }], [Math.round(0.49 * blocksPerSec), { t: 'cc', c: 70, v: 50 }], [Math.round(0.5 * blocksPerSec), { t: 'cc', c: 74, v: 80 }],
  [Math.round(0.6 * blocksPerSec), { t: 'bend', v: 0 }], [Math.round(0.8 * blocksPerSec), { t: 'off', n: 48 }], [Math.round(0.8 * blocksPerSec), { t: 'off', n: 55 }],
  [Math.round(0.85 * blocksPerSec), { t: 'on', n: 72, v: 127 }], [Math.round(1.0 * blocksPerSec), { t: 'off', n: 60 }], [Math.round(1.0 * blocksPerSec), { t: 'off', n: 64 }], [Math.round(1.1 * blocksPerSec), { t: 'off', n: 72 }]];
const list = [];
const step = +(process.env.STEP || 1), only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
A.MOSS_PRESETS.forEach((_, i) => list.push(['ST' + i, A.mossPreset(i)]));
A.MOSS_PCG_BUILTIN.forEach((bk, bi) => { const rs = bk.rs || 521, by = Uint8Array.from(Buffer.from(bk.m, 'base64')), n = by.length / rs; for (let i = 0; i < n; i += step) list.push([bi + ':' + i, A.korgDecodeMoss(by.subarray(i * rs, (i + 1) * rs), bk.scale, bk.fmt)]); });
let same = 0, near = 0, diff = [], ca = 0, cb = 0, cnt = 0;
for (const [id, P0] of list) {
  if (only && !only.test(id)) continue;
  const P = JSON.parse(JSON.stringify(P0));
  if (process.env.DRY) { P.fx.ins = []; P.fx.m1.on = 0; P.fx.m2.on = 0; P.fx.eqLo = P.fx.eqHi = 0; P.fx.ifxRoute = 0; }
  const ra = render(A, P, secs, events), rb = render(B, P, secs, events);
  ca += ra.cpu; cb += rb.cpu; cnt++;
  let md = 0, pk = 0, e2 = 0, s2 = 0;
  for (let i = 0; i < ra.out.length; i++) { const d = Math.abs(ra.out[i] - rb.out[i]); if (d > md) md = d; pk = Math.max(pk, Math.abs(ra.out[i])); e2 += d * d; s2 += ra.out[i] * ra.out[i]; }
  const snr = s2 > 0 ? 10 * Math.log10(s2 / Math.max(e2, 1e-30)) : 999;
  if (md === 0) same++; else if (md < 1e-4) near++; else diff.push([id, P0.name, md, snr]);
}
console.log('programs', cnt, 'identical', same, 'within 1e-4', near, 'different', diff.length, '| cpu ref', (ca / cnt * 100).toFixed(2) + '%', 'new', (cb / cnt * 100).toFixed(2) + '%', 'speedup x' + (ca / cb).toFixed(2));
diff.sort((a, b) => b[2] - a[2]).slice(0, +(process.env.SHOW || 15)).forEach(d => console.log('  ', d[0].padEnd(7), (d[1] || '').padEnd(17), 'max diff', d[2].toExponential(2), 'SNR', d[3].toFixed(1) + ' dB'));
