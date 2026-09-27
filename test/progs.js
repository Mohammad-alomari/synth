// Renders the built-in programs (starter, factory Triton, Trinity banks) with their effects; reports NaN, level, CPU.
// Quick by default (every 8th program, 1 s each); FULL=1 renders every program for 2.5 s. Env: STEP, SECS, ONLY, DRY, VERBOSE.
const H = require('./harness.js'); const X = H.load(H.ORDER);
const sr = 48000, N = 128;
const b64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
function render(P, secs, notes) {
  const e = new X.MossEngine(sr); e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(P)) });
  const L = new Float32Array(N), R = new Float32Array(N); let ss = 0, pk = 0, bad = 0, cnt = 0;
  const total = Math.round(secs * sr / N), offAt = Math.round(total * 0.6);
  notes.forEach(n => e.handle({ t: 'on', n, v: 100 }));
  const t0 = process.hrtime.bigint();
  for (let b = 0; b < total; b++) {
    if (b === offAt) notes.forEach(n => e.handle({ t: 'off', n }));
    e.process(L, R, N);
    for (let i = 0; i < N; i++) { const a = L[i], c = R[i]; if (!(a === a && c === c)) bad++; ss += a * a + c * c; pk = Math.max(pk, Math.abs(a), Math.abs(c)); cnt += 2; }
  }
  const cpu = Number(process.hrtime.bigint() - t0) / 1e9 / secs;
  return { rms: Math.sqrt(ss / cnt), pk, bad, cpu, faults: e.fx.faults };
}
const list = [];
X.MOSS_PRESETS.forEach((_, i) => list.push(['ST' + i, X.mossPreset(i)]));
X.MOSS_PCG_BUILTIN.forEach(bk => { const rs = bk.rs || 521, by = b64(bk.m), n = by.length / rs; for (let i = 0; i < n; i++) { const P = X.korgDecodeMoss(by.subarray(i * rs, (i + 1) * rs), bk.scale, bk.fmt); list.push([(bk.fmt === 'triton' ? 'F' : bk.name.slice(0, 4)) + i, P]); } });
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null, FULL = !!process.env.FULL;
const step = +(process.env.STEP || (FULL || only ? 1 : 8)), secs = +(process.env.SECS || (FULL ? 2.5 : 1));
let worst = 0, cpuMax = 0, nBad = 0; const lv = [], rows = [];
for (const [k, [id, P]] of list.entries()) {
  if (only ? !only.test(id) : k % step) continue;
  if (process.env.DRY) { P.fx.ins = []; P.fx.m1.on = 0; P.fx.m2.on = 0; P.fx.eqLo = P.fx.eqHi = 0; P.fx.ifxRoute = 0; }
  const r = render(P, secs, [48, 55, 60, 64]);
  if (r.bad || r.faults) nBad++;
  lv.push(20 * Math.log10(r.rms + 1e-9)); cpuMax = Math.max(cpuMax, r.cpu);
  rows.push([id.padEnd(8), (P.name || '').padEnd(17), 'rms ' + (20 * Math.log10(r.rms + 1e-9)).toFixed(1).padStart(6), 'pk ' + r.pk.toFixed(2), 'cpu ' + (r.cpu * 100).toFixed(1) + '%', r.bad ? 'NaN ' + r.bad : '', r.faults ? 'FAULT ' + r.faults : '', P.fx.ins.map(s => s.type).join(',') + ' | ' + (P.fx.m1.on ? P.fx.m1.type : '-') + ' ' + (P.fx.m2.on ? P.fx.m2.type : '-')].join('  '));
}
if (process.env.VERBOSE) rows.forEach(r => console.log(r));
lv.sort((a, b) => a - b);
console.log('programs', lv.length, 'with NaN/faults', nBad, 'level dB min/median/max', lv[0].toFixed(1), lv[lv.length >> 1].toFixed(1), lv[lv.length - 1].toFixed(1), 'max cpu', (cpuMax * 100).toFixed(1) + '%');
if (nBad) process.exitCode = 1;
