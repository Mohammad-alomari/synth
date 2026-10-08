// Sample sets of Trinity PCG files (samples/flash/, never in the repository): the rules, on made-up data.
// A PCG holds no audio. Its RAM/Flash multisample n plays what the caller of the decoder names for n (the n-th
// multisample of the file's own sample set), and the fallback where the caller names nothing. A pack may carry Korg's
// 2nd start of a sample (where an oscillator with Start Offset begins) and may ask for no loop-seam healing (lossless).
const H = require('./harness.js'), X = H.load(H.ORDER), PK = require('./pcmpacks.js');
const b64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) fails++; };
const FB = X.PCM_FALLBACK;

// ---- the decoder: RAM/Flash multisamples 3 (low velocities) and 5 (high) of OSC 1 ----
const T = X.TRI_BUILTIN[0], rec = Uint8Array.from(b64(T.pcm[0].m).subarray(0, 433));
rec[17] &= ~3; // Single mode
rec[31] = rec[33] = 0x10; rec[32] = 3; rec[34] = 5;
const set = { 3: 'f:SET:3', 5: 'f:SET:5' };
let P = X.korgDecodePcm(rec, T.scale, n => set[n]);
ok('a file with its sample set: each RAM/Flash multisample plays the set\'s multisample of that number', P.ramMap[3] === 'f:SET:3' && P.ramMap[5] === 'f:SET:5', P.ramMap);
ok('...and nothing is said about a fallback', !P.korgInfo.notes.some(n => /fallback/.test(n)), P.korgInfo.notes);
P = X.korgDecodePcm(rec, T.scale, n => (n === 5 ? set[5] : undefined));
ok('a multisample the set does not have plays the fallback', P.ramMap[3] === FB && P.ramMap[5] === 'f:SET:5', P.ramMap);
ok('...and the Program page names only that one', P.korgInfo.notes.some(n => /RAM\/Flash sample 3,.*fallback/.test(n)), P.korgInfo.notes);
P = X.korgDecodePcm(rec, T.scale);
ok('a file without a sample set: the fallback, as before', P.ramMap[3] === FB && P.ramMap[5] === FB, P.ramMap);

// ---- a pack's map: 2nd start, and no healing when the pack says heal 0 ----
const sync = 271, N = 6000, x = new Float32Array(N); x[sync] = 0.95;
for (let i = 1000; i < 5000; i++) x[i] = (i - 1000) / 8000; // a ramp: every frame has its own value
const meta = { rate: 48000, sync, search: 3072, heal: 0, s: [[1000, 4000, 3000, 5000, 0, [[0, 127, 60, 0]], 1500]] };
const before = Float32Array.from(x), Z = PK.zonesFrom(meta, x);
ok('heal 0: the samples are left as they are', x.every((v, i) => v === before[i]));
ok('the zone carries the 2nd start', Z.length === 1 && Z[0].s2 === 1500 && Z[0].start === 1000 && Z[0].ls === 3000 && Z[0].le === 5000, Z.map(z => [z.start, z.s2, z.ls, z.le]));
const y = Float32Array.from(before), old = PK.zonesFrom({ rate: 48000, sync, search: 3072, s: [[1000, 4000, 3000, 5000, 0, [[0, 127, 60, 0]]]] }, y);
ok('a pack without them: no 2nd start, the seam healed over 64 frames', old[0].s2 === -1 && y[4999] !== before[4999] && y[4935] === before[4935], [old[0].s2, y[4999], before[4999]]);

// ---- the engine: Start Offset begins at the 2nd start ----
const first = off => {
  const Q = X.korgDecodePcm(rec, T.scale, n => set[n]);
  const O = Q.o[0]; O.offHi = off; O.velSplit = 1; O.amp.level = 127; O.amp.vel = 0; O.octave = 0; O.transpose = 0; O.tune = 0; O.delay = 0;
  O.pitch.egInt = 0; O.pitch.lfoInt = 0; O.pitch.slope = 1; O.route = 'thru'; Q.random = 0;
  for (const k of ['startL', 'atkL', 'brkL', 'susL']) O.aeg[k] = 99;
  for (const k of ['atkT', 'decT', 'slpT', 'relT']) O.aeg[k] = 0;
  Q.fx.ins = []; Q.fx.m1.on = 0; Q.fx.m2.on = 0;
  const e = new X.MossEngine(48000);
  e.handle({ t: 'pcmMap', map: { ms: { 'f:SET:5': { p: 'pk', g: 0 } } } });
  e.handle({ t: 'pcmPack', name: 'pk', zones: PK.zonesFrom(meta, Float32Array.from(before)) });
  e.handle({ t: 'patch', p: Q });
  const L = new Float32Array(128), R = new Float32Array(128); let peak = 0;
  e.handle({ t: 'on', n: 60, v: 1 });
  for (let b = 0; b < 12; b++) { L.fill(0); R.fill(0); e.process(L, R, 128); for (let i = 0; i < 128; i++) peak = Math.max(peak, Math.abs(L[i])); }
  return peak;
};
// the ramp rises along the sample: 1536 frames from the 2nd start (frame 500 of the sample) reach higher than from the start
const a0 = first(0), a1 = first(1);
ok('Start Offset off: the sample plays from its first frame', a0 > 0, a0);
ok('Start Offset on: it plays from the 2nd start (500 frames in: the ramp is that much higher)', a1 > a0 * 1.2 && Math.abs(a1 / a0 - (500 + 1536) / 1536) < 0.05, [a0, a1, a1 / a0]);
console.log(fails ? fails + ' FAILED' : 'sample sets: all passed');
process.exit(fails ? 1 : 0);
