// Checks for effect fixes: missing parameters, re-enabling an effect, Dual Delay wet with a mod source, master negative output
const H = require('./harness.js'); const X = H.load(H.ORDER); const sr = 48000;
const ok = (name, cond, extra) => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
const blk = (r, L, R, n) => { r.process(L, R, n || 128, r._fx); };
{ // missing parameters: every effect type with an almost empty parameter set
  let bad = [];
  for (const e of X.TFX.CAT) {
    const r = new X.FxRack(sr), fx = X.TFX.rack(); fx.m1.on = 0; fx.m2.on = 0;
    if (e.grp === 'MM') { fx.m1 = { on: 1, type: e.id, p: {}, ret: 127 }; fx.send1 = 100; } else if (e.grp === 'MR') { fx.m2 = { on: 1, type: e.id, p: {}, ret: 127 }; fx.send2 = 100; } else fx.ins = [{ on: 1, type: e.id, p: { wet: 50 } }];
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let b = 0; b < 50; b++) { for (let i = 0; i < 128; i++) { L[i] = R[i] = Math.sin((b * 128 + i) * 0.05) * 0.3; } r.process(L, R, 128, fx); }
    if (r.faults) bad.push(e.id);
  }
  ok('no effect faults with missing parameters', bad.length === 0, bad.join(','));
}
{ // switching a delay off mid-echo and back on after silence
  const r = new X.FxRack(sr), fx = X.TFX.rack(); fx.m1.on = 0; fx.m2.on = 0; fx.ins = [{ on: 1, type: 'S2:38', p: X.TFX.defaults('S2:38') }]; fx.ins[0].p.fb = 80;
  const L = new Float32Array(128), R = new Float32Array(128);
  for (let b = 0; b < 40; b++) { for (let i = 0; i < 128; i++) L[i] = R[i] = b < 5 ? Math.sin(i * 0.1) : 0; r.process(L, R, 128, fx); }
  fx.ins[0].on = 0; for (let b = 0; b < 400; b++) { L.fill(0); R.fill(0); r.process(L, R, 128, fx); }
  fx.ins[0].on = 1; let pk = 0; for (let b = 0; b < 400; b++) { L.fill(0); R.fill(0); r.process(L, R, 128, fx); for (let i = 0; i < 128; i++) pk = Math.max(pk, Math.abs(L[i])); }
  ok('re-enabled delay does not replay old echoes', pk < 1e-6, 'peak ' + pk.toExponential(2));
  // master reverb too
  const r2 = new X.FxRack(sr), f2 = X.TFX.rack(); f2.m1.on = 0; f2.ins = []; f2.send2 = 127;
  for (let b = 0; b < 40; b++) { for (let i = 0; i < 128; i++) L[i] = R[i] = b < 5 ? Math.sin(i * 0.1) : 0; r2.process(L, R, 128, f2); }
  f2.m2.on = 0; for (let b = 0; b < 100; b++) { L.fill(0); R.fill(0); r2.process(L, R, 128, f2); }
  f2.m2.on = 1; let pk2 = 0; for (let b = 0; b < 200; b++) { L.fill(0); R.fill(0); r2.process(L, R, 128, f2); for (let i = 0; i < 128; i++) pk2 = Math.max(pk2, Math.abs(L[i])); }
  ok('re-enabled master reverb starts clean', pk2 < 1e-6, 'peak ' + pk2.toExponential(2));
}
{ // Dual Delay: wetL/wetR honoured when a modulation source is set
  const r = new X.FxRack(sr), fx = X.TFX.rack(); fx.m1.on = 0; fx.m2.on = 0;
  const p = X.TFX.defaults('S2:37'); p.wetL = 10; p.wetR = 10; p.wsrc = 8; p.wamt = 0; p.timeL = 100; p.timeR = 100; p.fbL = 0; p.fbR = 0;
  fx.ins = [{ on: 1, type: 'S2:37', p }];
  const L = new Float32Array(128), R = new Float32Array(128);
  let first = 0; { const r3 = new X.FxRack(sr); for (let i = 0; i < 128; i++) L[i] = R[i] = 1; r3.process(L, R, 128, fx); first = L[0]; }
  ok('  ...dry share is 90%', Math.abs(first - 0.9) < 1e-6, 'first sample ' + first.toFixed(4));
}
{ // master Flanger with negative output level keeps its sign when a mod source is set
  const r = new X.FxRack(sr), u = X.FxRack.make(sr, X.TFX.byId('MM:1')); u.master = true; u.x = r.x;
  const p = X.TFX.defaults('MM:1'); p.out = -80; p.wsrc = 8; p.wamt = 0; u.mixSet(p); ok('master negative output with mod source', Math.abs(u.G + 0.8) < 1e-9, 'gain ' + u.G);
}
