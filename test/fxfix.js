// Checks for effect fixes: missing parameters, re-enabling an effect, Dual Delay wet with a mod source, resting when silent, master negative output
const H = require('./harness.js'); const X = H.load(H.ORDER); const sr = 48000;
const ok = (name, cond, extra) => { if (!cond) process.exitCode = 1; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
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
  const fx = X.TFX.rack(); fx.m1.on = 0; fx.m2.on = 0;
  const p = X.TFX.defaults('S2:37'); p.wetL = 10; p.wetR = 10; p.wsrc = 8; p.wamt = 0; p.timeL = 100; p.timeR = 100; p.fbL = 0; p.fbR = 0;
  fx.ins = [{ on: 1, type: 'S2:37', p }];
  const L = new Float32Array(128), R = new Float32Array(128);
  let first = 0; { const r3 = new X.FxRack(sr); for (let i = 0; i < 128; i++) L[i] = R[i] = 1; r3.process(L, R, 128, fx); first = L[0]; }
  ok('  ...dry share is 90%', Math.abs(first - 0.9) < 1e-6, 'first sample ' + first.toFixed(4));
}
{ // an effect rests after 6 s of silence in and out, not before its longest echo, and wakes up at once
  const r = new X.FxRack(sr), fx = X.TFX.rack(); fx.m1.on = 0; fx.m2.on = 0;
  const p = X.TFX.defaults('S4:17'); p.tempo = 48; p.len = 1; p.lenDiv = 1; p.fb = 0; p.wet = 50; // one echo, 5 s later (the longest line)
  fx.ins = [{ on: 1, type: 'S4:17', p }];
  const L = new Float32Array(128), R = new Float32Array(128), bps = sr / 128; let echoAt = -1;
  for (let b = 0; b < 12 * bps; b++) {
    for (let i = 0; i < 128; i++) L[i] = R[i] = b < 2 ? Math.sin(i * 0.2) * 0.5 : 0;
    r.process(L, R, 128, fx);
    if (b > 2 && echoAt < 0) for (let i = 0; i < 128; i++) if (Math.abs(L[i]) > 1e-3) { echoAt = b / bps; break; }
  }
  const u = r.ins[0];
  ok('a 5 s echo still comes after 5 s of silence', Math.abs(echoAt - 5) < 0.1, 'echo at ' + echoAt.toFixed(2) + ' s');
  ok('  ...then the delay rests (6 s of silence)', u.q >= 6 * sr, 'silent ' + (u.q / sr).toFixed(1) + ' s');
  let calls = 0; const proc = u.process; u.process = function (...a) { calls++; return proc.apply(this, a); };
  L.fill(0); R.fill(0); r.process(L, R, 128, fx);
  ok('  ...and is not computed while resting', calls === 0);
  for (let i = 0; i < 128; i++) L[i] = R[i] = Math.sin(i * 0.2) * 0.5; r.process(L, R, 128, fx);
  ok('  ...and wakes up with the first sound', calls === 1 && u.q === 0 && Math.abs(L[10]) > 0.1, 'calls ' + calls + ', out ' + L[10].toFixed(3));
}
{ // master Flanger with negative output level keeps its sign when a mod source is set
  const r = new X.FxRack(sr), u = X.FxRack.make(sr, X.TFX.byId('MM:1')); u.master = true; u.x = r.x;
  const p = X.TFX.defaults('MM:1'); p.out = -80; p.wsrc = 8; p.wamt = 0; u.mixSet(p); ok('master negative output with mod source', Math.abs(u.G + 0.8) < 1e-9, 'gain ' + u.G);
}
