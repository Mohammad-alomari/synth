// Note-on latency of the engine: a note-on (as a MIDI note-on arrives) must be heard in the same audio block.
// For every program whose amp envelope starts at once (attack under 5 ms, no oscillator / timbre delay), the first
// (PCM programs: played with the amp EG's attack time at 0; their time law makes 1 a 17 ms ramp already, and what is
// timed here is the engine, not the program's own fade-in)
// output sample above -120 dBFS must come within 1 ms of the note-on (the Reed, Brass and Bowed models: 10 ms, their
// sound builds up in the tube or on the string first, part of the model). Effects are switched off (a delay effect or a
// reverb's pre-delay is part of a sound, not latency). What the page adds on top (the main thread, one 128-frame block,
// the audio device) is measured by the browser test with simulated MIDI.
// Env: STEP (programs of the test banks), OWN=1 (your own banks in private/), VERBOSE.
const H = require('./harness.js'), X = H.load(H.ORDER), PK = require('./pcmpacks.js');
const sr = 48000, N = 128, b64 = s => Uint8Array.from(Buffer.from(s, 'base64')), step = +(process.env.STEP || 4);
const dryFx = fx => { if (!fx) return; fx.ins = []; fx.m1.on = 0; fx.m2.on = 0; fx.eqLo = fx.eqHi = 0; };
// frames from the note-on to the first sample above 1e-6 (-120 dBFS)
function onset(P) {
  const e = new X.MossEngine(sr), L = new Float32Array(N), R = new Float32Array(N);
  if (P.kind === 'pcm') PK.preload(e, X, P);
  else if (P.kind === 'combi') { e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(P)) }); e.handle({ t: 'on', n: 60, v: 100 }); e.process(L, R, N); for (const p of e.combi.parts) if (p) PK.feed(p, X); e.handle({ t: 'panic' }); }
  e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(P)) });
  for (let k = 0; k < 4; k++) e.process(L, R, N);
  e.handle({ t: 'on', n: 60, v: 100 });
  for (let o = 0; o < 0.1 * sr; o += N) { e.process(L, R, N); for (let i = 0; i < N; i++) if (Math.abs(L[i]) > 1e-6 || Math.abs(R[i]) > 1e-6) return o + i; }
  return -1;
}
const fast = t => X.MD.tsec(t) < 0.005, WAVEGUIDE = ['reed', 'brass', 'bowed'];
const limit = P => (P.kind === 'pcm' || P.kind === 'combi' || !WAVEGUIDE.includes(P.osc[0].type) ? 0.001 : 0.010) * sr;
const list = [];
X.MOSS_PRESETS.forEach((_, i) => list.push(['ST' + i, X.mossPreset(i)]));
X.MOSS_PCG_BUILTIN.forEach(bk => { const rs = bk.rs || 521, by = b64(bk.m); for (let i = 0; i < by.length / rs; i += step) list.push([bk.name + ' M' + i, X.korgDecodeMoss(by.subarray(i * rs, (i + 1) * rs), bk.scale, bk.fmt)]); });
X.TRI_BUILTIN.forEach(T => {
  T.pcm.forEach(bk => { const by = b64(bk.m); for (let i = 0; i < 128; i += step) list.push([T.name + ' ' + bk.bank + i, X.korgDecodePcm(by.subarray(i * 433, (i + 1) * 433), T.scale)]); });
  const pcm = {}; for (const b of T.pcm) pcm[b.bank] = b64(b.m);
  T.combis.forEach(bk => { const by = b64(bk.m); for (let i = 0; i < 128; i += step * 2) { // a combination as the page builds it (PCM timbres of the same file)
    const C = X.korgDecodeCombi(by.subarray(i * 388, (i + 1) * 388), T.scale);
    for (const t of C.timbres) { t.p = null; const Lt = 'ABCD'[t.bank]; if (t.status !== 'off' && Lt && pcm[Lt]) { t.p = X.korgDecodePcm(pcm[Lt].subarray(t.prog * 433, (t.prog + 1) * 433), T.scale); if (t.p.mode === 'drum') t.p = null; } }
    C.voice = { hold: 0 }; C.out = { level: 127 };
    list.push([T.name + ' C' + bk.bank + i, C]);
  } });
});
// the programs that must start at once: amp EG attack under 5 ms, no delay; and they play at all on middle C
// (a record the decoder had to repair, out-of-range values, is damaged data: its timing means nothing)
const clean = P => !(P.korgInfo && P.korgInfo.notes && P.korgInfo.notes.some(t => /out-of-range|invalid/.test(t)));
function immediate(P) {
  if (!clean(P)) return false;
  if (P.kind === 'pcm') return P.mode !== 'drum' && P.o.every((O, k) => (k === 1 && P.mode !== 'double') || O.delay === 0);
  if (P.kind === 'combi') { const T = P.timbres.filter(t => t.p && t.status === 'int' && (t.ch === 16 || t.ch === 0) && t.keyBot <= 60 && t.keyTop >= 60 && t.velBot <= 100 && t.velTop >= 100);
    return T.length > 0 && T.every(t => t.delay === 0 && immediate(t.p)); }
  return fast(P.ampEG.atkT) && P.amp.every(A => A.eg === 'amp');
}
let n = 0, worst = 0; const late = [];
for (const [id, P0] of list) {
  const P = JSON.parse(JSON.stringify(P0));
  if (!immediate(P)) continue;
  dryFx(P.fx); if (P.kind === 'combi') { P.chains = []; for (const t of P.timbres) if (t.p) dryFx(t.p.fx); }
  for (const Q of P.kind === 'pcm' ? [P] : P.kind === 'combi' ? P.timbres.map(t => t.p).filter(q => q && q.kind === 'pcm') : []) for (const O of Q.o) O.aeg.atkT = 0;
  const f = onset(P);
  if (f < 0) continue; // silent on middle C (a key or velocity zone, a filter shut): nothing to time
  n++; worst = Math.max(worst, f);
  if (f > limit(P)) late.push(id + ' ' + (P.name || '') + ': ' + (f / sr * 1000).toFixed(2) + ' ms');
  if (process.env.VERBOSE) console.log(id.padEnd(16), (P.name || '').padEnd(17), (f / sr * 1000).toFixed(3), 'ms');
}
console.log('note-on latency of the engine: ' + n + ' programs, slowest ' + (worst / sr * 1000).toFixed(2) + ' ms (' + worst + ' frames)' + (late.length ? '; late: ' + late.join(', ') : ''));
if (late.length || !n) process.exitCode = 1;
