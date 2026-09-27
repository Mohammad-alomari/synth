// Combinations of the built-in PCG files: resolve their timbres' programs, play a chord, check for NaN, runaway
// levels and CPU. Usage: node test/combis.js [name filter] [max count]
// Quick by default (every 16th combination); FULL=1 plays all of them. Env: STEP.
const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..');
const src = ['fxcat.js', 'patches.js', 'engine.js', 'pcm.js', 'combi.js', 'fxdsp.js', 'pcmmap.js', 'korg.js', 'pcgdata.js', 'tridata.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/if \(typeof module !== 'undefined'\)[^\n]*\n/g, '')).join('\n;\n') +
  '\nmodule.exports={MossEngine,korgDecodePcm,korgDecodeKit,korgDecodeCombi,korgDecodeMoss,TRI_BUILTIN,MOSS_PCG_BUILTIN,PCM_STANDIN};';
const m = new module.constructor(); m._compile(src, path.join(dir, 'bundle_combis.js')); const X = m.exports;
const PK = require('./pcmpacks.js');
const sr = 48000, N = 128, only = process.argv[2] || '', max = +(process.argv[3] || 1e9), step = +(process.env.STEP || (process.env.FULL || only ? 1 : 16));
let seen = 0;
// a combination as the page builds it: each timbre gets its program (PCM A-D from the same file, bank 4 = its MOSS bank M)
function build(T, r) {
  const C = X.korgDecodeCombi(r, T.scale);
  const pcm = {}; for (const b of T.pcm) pcm[b.bank] = Buffer.from(b.m, 'base64');
  const kraw = T.kits ? Buffer.from(T.kits, 'base64') : null;
  const mb = X.MOSS_PCG_BUILTIN.find(b => b.name === T.name), mraw = mb ? Buffer.from(mb.m, 'base64') : null;
  for (const t of C.timbres) {
    t.p = null; if (t.status === 'off') continue;
    const L = 'ABCD'[t.bank];
    if (L && pcm[L]) { t.p = X.korgDecodePcm(pcm[L].subarray(t.prog * 433, (t.prog + 1) * 433), T.scale); if (t.p.mode === 'drum' && kraw) t.p.kitData = X.korgDecodeKit(kraw.subarray(t.p.kit * 1426, (t.p.kit + 1) * 1426)); }
    else if (t.bank === 4 && mraw) t.p = X.korgDecodeMoss(mraw.subarray(t.prog * 521, (t.prog + 1) * 521), T.scale);
  }
  C.voice = { hold: 0 }; C.out = { level: 127 };
  return C;
}
let tot = 0, bad = [], lv = [], cpuMax = 0, cpuSum = 0, silent = [];
for (const T of X.TRI_BUILTIN) for (const b of T.combis) {
  const raw = Buffer.from(b.m, 'base64');
  for (let i = 0; i < 128 && tot < max; i++) {
    const r = raw.subarray(i * 388, (i + 1) * 388), C = build(T, r);
    if (only && !(C.name.includes(only) || T.name.includes(only))) continue;
    if (!C.timbres.some(t => t.p && (t.status === 'int') && (t.ch === 16 || t.ch === 0))) continue;
    if (seen++ % step) continue;
    tot++;
    const e = new X.MossEngine(sr); e.handle({ t: 'pcmMap', map: X.PCM_STANDIN }); e._mapSent = true;
    e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(C)) });
    const Lb = new Float32Array(N), Rb = new Float32Array(N);
    const notes = [48, 55, 60, 64];
    notes.forEach(n => e.handle({ t: 'on', n, v: 100 })); e.process(Lb, Rb, N);
    for (const p of e.combi.parts) if (p) PK.feed(p, X); // the packs the timbres asked for
    e.handle({ t: 'panic' }); notes.forEach(n => e.handle({ t: 'on', n, v: 100 }));
    let pk = 0, ss = 0, nan = false; const blocks = Math.round(1.2 * sr / N), t0 = process.hrtime.bigint();
    for (let k = 0; k < blocks; k++) {
      if (k === Math.round(0.8 * sr / N)) notes.forEach(n => e.handle({ t: 'off', n }));
      e.process(Lb, Rb, N);
      for (let j = 0; j < N; j++) { const a = Lb[j], c = Rb[j]; if (a !== a || c !== c) nan = true; pk = Math.max(pk, Math.abs(a), Math.abs(c)); ss += a * a + c * c; }
    }
    const cpu = Number(process.hrtime.bigint() - t0) / 1e9 / 1.2; cpuMax = Math.max(cpuMax, cpu); cpuSum += cpu;
    const rms = Math.sqrt(ss / (blocks * N * 2)), db = 20 * Math.log10(rms + 1e-12);
    if (nan) bad.push(T.name + ':' + C.name);
    if (db < -60) silent.push(T.name + ' ' + b.bank + i + ' ' + C.name + ' [' + C.timbres.filter(t => t.status === 'int').map(t => (t.p ? t.p.name : 'none') + '/ch' + t.ch).join(', ') + ']');
    lv.push(db);
    if (only) console.log(C.name, 'rms', db.toFixed(1), 'peak', pk.toFixed(2), 'cpu', (cpu * 100).toFixed(0) + '%', 'chains', JSON.stringify(C.chains.map(c => ({ t: c.timbres, fx: c.blocks.map(k => C.blocks[k] && C.blocks[k].type) }))));
  }
}
lv.sort((a, b) => a - b);
console.log('combinations', tot, 'NaN', bad.length, 'silent', silent.length, 'rms p10/p50/p90', [0.1, 0.5, 0.9].map(q => lv[Math.floor(q * (lv.length - 1))].toFixed(1)).join(' '), 'cpu avg/max', (cpuSum / tot * 100).toFixed(0) + '% / ' + (cpuMax * 100).toFixed(0) + '%');
if (bad.length) { console.log('NaN:', bad.slice(0, 10)); process.exitCode = 1; }
if (silent.length) console.log('silent:', silent.slice(0, 12).join('\n  '));
