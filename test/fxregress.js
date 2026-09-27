// Every effect type, alone, rendered by the reference tree and the current one; reports any difference
const fs = require('fs'), path = require('path');
const REF = process.argv[2] || '/home/claude/moss_ref', CUR = path.join(__dirname, '..');
function load(dir) {
  const src = ['fxcat.js', 'patches.js', 'engine.js', 'fxdsp.js'].map(f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/if \(typeof module !== 'undefined'\)[^\n]*\n/g, '')).join('\n;\n') + '\nmodule.exports={MossEngine,mossPreset,TFX};';
  const m = new module.constructor(); m._compile(src, path.join(dir, 'b' + Math.random() + '.js')); return m.exports;
}
const A = load(REF), B = load(CUR), sr = 48000, N = 128;
let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; const RR = Math.random;
function render(X, P) {
  seed = 777; Math.random = rnd;
  const e = new X.MossEngine(sr); e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(P)) });
  e.handle({ t: 'on', n: 60, v: 100 }); e.handle({ t: 'on', n: 67, v: 80 });
  const L = new Float32Array(N), R = new Float32Array(N), out = [];
  for (let b = 0; b < 300; b++) {
    if (b === 100) { e.handle({ t: 'cc', c: 1, v: 100 }); e.handle({ t: 'at', v: 0.7 }); }
    if (b === 150) { e.handle({ t: 'off', n: 60 }); e.handle({ t: 'off', n: 67 }); }
    if (b === 200) e.handle({ t: 'on', n: 72, v: 127 });
    e.process(L, R, N); for (let i = 0; i < N; i++) out.push(L[i], R[i]);
  }
  Math.random = RR; return out;
}
let same = 0, bad = [];
for (const e of A.TFX.CAT) {
  for (const variant of [0, 1]) {
    const P = A.mossPreset(1); P.fx = A.TFX.rack();
    const p = A.TFX.defaults(e.id);
    if (variant) { p.lo = 6; p.hi = -4; p.wsrc = 8; p.wamt = 40; }
    if (e.grp === 'MM' || e.grp === 'MR') { P.fx.ins = []; P.fx.m1 = { on: e.grp === 'MM' ? 1 : 0, type: e.grp === 'MM' ? e.id : 'MM:4', p: e.grp === 'MM' ? p : A.TFX.defaults('MM:4'), ret: 127, cascade: 0 }; P.fx.m2 = { on: e.grp === 'MR' ? 1 : 0, type: e.grp === 'MR' ? e.id : 'MR:5', p: e.grp === 'MR' ? p : A.TFX.defaults('MR:5'), ret: 110 }; P.fx.send1 = 80; P.fx.send2 = 80; P.fx.eqLo = variant ? 4 : 0; P.fx.eqHi = variant ? -3 : 0; }
    else { P.fx.ins = [{ on: 1, type: e.id, p }]; P.fx.m1.on = 0; P.fx.m2.on = 0; }
    const a = render(A, P), b = render(B, P);
    let md = 0; for (let i = 0; i < a.length; i++) md = Math.max(md, Math.abs(a[i] - b[i]));
    if (md === 0) same++; else bad.push([e.id, e.name, variant, md]);
  }
}
console.log('effect renders', A.TFX.CAT.length * 2, 'identical', same, 'different', bad.length);
bad.forEach(b => console.log('  ', b[0], b[1], 'variant', b[2], 'max diff', b[3].toExponential(2)));
