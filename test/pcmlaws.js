// The PCM engine's laws, as measured against KORG Collection TRINITY (pcm.js: PCM, PcmEG, PcmVoice): the numbers
// here are the measured ones, so a change of a law fails this test unless the number is changed with it.
// First the functions by value, then the same laws heard through the engine on a built-in sine (no samples needed).
const H = require('./harness.js'), X = H.load(H.ORDER);
const sr = 48000, N = 128, P = X.PCM;
let bad = 0;
const near = (what, got, want, tol) => { const ok = Math.abs(got - want) <= tol; if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + what + ': ' + (+got.toFixed(4)) + (ok ? '' : ' (expected ' + want + ' +- ' + tol + ')')); };
const hz = (x, p, kl, kh, rl, rh) => P.cutHz(x + P.ftrack(p, kl, kh, rl, rh), sr);

// cutoff: ten octaves over 0-99, 20 Hz - 20 kHz at middle C; cutoff measured on five programs (Hz at the pitch sounded)
near('cutoff 0 at middle C, Hz', P.cutHz(0, sr), 19.6, 0.05);
near('cutoff 99 at middle C, Hz', P.cutHz(99, sr), 20070, 40);
near('ten steps up, ratio', P.cutHz(50, sr) / P.cutHz(40, sr), 2.014, 0.002);
near('no ramps, pitch 60, Frequency 40', hz(40, 60, 0, 0, 0, 0), 321.8, 3.2);
near('no ramps, pitch 24, Frequency 40', hz(40, 24, 0, 0, 0, 0), 138.0, 1.4);
near('pitch 12, below the high key 32', hz(40, 12, 0, 32, 0, -5), 104.1, 1.0);
near('pitch 48, high key 32, ramp -5', hz(40, 48, 0, 32, 0, -5), 231.6, 2.3);
near('pitch 55, low key 60, ramp +50', hz(40, 55, 60, 60, 50, 56), 251, 3);
near('pitch 36, low key 48, ramp -60, Frequency 55', hz(55, 36, 48, 48, -60, -40), 777, 8);
// resonance (Q) and envelope times
[[0, 0.5], [8, 1.77], [16, 4.45], [20, 8.78], [24, 19.2]].forEach(([r, q]) => near('Q at resonance ' + r, 1 / P.kReso(r), q, q * 0.02));
[[0, 0], [20, 0.0625], [40, 0.25], [60, 1], [80, 4], [90, 11.49], [99, 91.95]].forEach(([v, t]) => near('EG time ' + v + ', s', P.tsec(v), t, t * 0.005 + 1e-9));
// envelope shapes: time 1 s per segment, 1 ms steps
const run = (eg, secs) => { let v = 0; for (let i = 0; i < Math.round(secs * 1000); i++) v = eg.tick(0.001); return v; };
let e = new X.PcmEG(true); e.start(0, 1, 1, 1, 0, 1, 0, 0, 1);
near('rise: half way at half the time', run(e, 0.5), 0.5, 0.002);
e = new X.PcmEG(true); e.start(1, 1, 0.5, 0.5, 0, 0, 1, 0, 1); run(e, 0.002);
near('fall to a level: 11 % of the way left at half the time', (run(e, 0.5) - 0.5) / 0.5, 0.109, 0.004);
near('fall to a level: there at its time', run(e, 0.52), 0.5, 0.001);
e = new X.PcmEG(true); e.start(1, 1, 1, 1, 0, 0, 0, 0, 1); run(e, 0.01); e.release();
near('release: -20 dB at 0.546 of the time', 20 * Math.log10(run(e, 0.546)), -20, 0.15);
near('release: -40 dB at 1.075', 20 * Math.log10(run(e, 1.075 - 0.546)), -40, 0.3);
run(e, 0.6); near('release: silent after 1.65', e.val, 0, 1e-9); near('release: ended', e.done() ? 1 : 0, 1, 0);
e = new X.PcmEG(); e.start(1, 1, 1, 1, 0, 0, 0, 0, 1); run(e, 0.01); e.release();
near('a filter EG falling to 0 is there at its time', run(e, 1.001), 0, 1e-9);

// ---- through the engine: a sine (multisample 288 is a built-in waveform), middle C sounding its own pitch ----
function sine(set) {
  const p = X.korgDecodePcm(new Uint8Array(433)), O = p.o[0];
  p.mode = 'single'; p.voice.mode = 'poly'; O.msHi = O.msLo = 288; O.lvlHi = O.lvlLo = 127; O.velSplit = 1; O.octave = 0; O.transpose = 0; O.pitch.slope = 1;
  O.route = 'single'; O.ftype = ['lpf', 'lpf']; O.ftn = [0, 0];
  O.f.forEach(f => Object.assign(f, { cut: 99, gain: 99, reso: 0, resoVel: 0, egInt: 0, egVel: 0, lfoInt: 0, lowKey: 0, highKey: 127, lowRamp: 0, highRamp: 0, amsSrc: 'off', amsInt: 0 }));
  Object.assign(O.amp, { level: 127, vel: 0, lowKey: 0, highKey: 127, lowRamp: 0, highRamp: 0, at: 0, amsSrc: 'off', amsInt: 0 });
  Object.assign(O.aeg, { startL: 99, atkT: 0, atkL: 99, decT: 0, brkL: 99, slpT: 0, susL: 99, relT: 0, kt: [0, 0, 0, 0], vt: [0, 0, 0, 0], tSrc: 'off', tInt: 0, lv: [0, 0, 0] });
  Object.assign(O.feg, { startL: 0, atkT: 0, atkL: 0, decT: 0, brkL: 0, slpT: 0, susL: 0, relT: 0, relL: 0, kt: [0, 0, 0, 0], vt: [0, 0, 0, 0], tSrc: 'off', tInt: 0, lv: [0, 0, 0] });
  p.fx.ins = []; p.fx.m1.on = 0; p.fx.m2.on = 0;
  set(O, p);
  return p;
}
// level (rms, dB) of middle C held, 0.3-0.5 s after the note-on; the engine's "dry" output: before effects and limiter
function level(p, vel) {
  const en = new X.MossEngine(sr), L = new Float32Array(N), R = new Float32Array(N);
  en.handle({ t: 'pcmMap', map: X.PCM_STANDIN }); en.dry = true; en.handle({ t: 'patch', p });
  en.handle({ t: 'on', n: 60, v: vel || 127 });
  let ss = 0, n = 0;
  for (let k = 0; k < Math.round(0.5 * sr / N); k++) { L.fill(0); R.fill(0); en.process(L, R, N); if (k * N >= 0.3 * sr) for (let i = 0; i < N; i++) { ss += L[i] * L[i]; n++; } }
  return 10 * Math.log10(ss / n + 1e-30);
}
const full = level(sine(() => {}));
near('Amp Level 64 against 127, dB', level(sine(O => { O.amp.level = 64; })) - full, -5.95, 0.1);
near('amp EG level 50 against 99, dB', level(sine(O => { O.aeg.startL = O.aeg.atkL = O.aeg.brkL = O.aeg.susL = 50; })) - full, -5.93, 0.1);
const vel50 = sine(O => { O.amp.vel = 50; });
near('Velocity Int +50: velocity 64 against 127, dB', level(vel50, 64) - level(vel50, 127), -7.5, 0.15);
near('Velocity Int +50: velocity 8 against 127, dB', level(vel50, 8) - level(vel50, 127), -16.7, 0.2);
// the sine is at 261.63 Hz; a low-pass of Q 0.5 set to that frequency passes half (-6.02 dB), an octave below it a fifth (-13.98 dB)
const at = Math.log2(261.63 / 19.6) * 9.9;
near('low-pass at the sine, dB', level(sine(O => { O.f[0].cut = at; })) - full, -6.02, 0.15);
near('low-pass an octave below the sine, dB', level(sine(O => { O.f[0].cut = at - 9.9; })) - full, -13.98, 0.2);
// the filter EG at level 30 with intensity 33 opens 10 x 0.30 x 0.33 = 0.99 octave: from an octave below to the sine
near('filter EG level 30 x intensity 33 = one octave, dB', level(sine(O => { O.f[0].cut = at - 9.9; O.f[0].egInt = 33; O.feg.susL = 30; })) - full, -6.1, 0.2);
// EG Velocity Int is added in proportion to velocity: 0 + 66 x 64/127 = 33.3 at velocity 64
near('EG Velocity Int 66 at velocity 64 = intensity 33, dB', level(sine(O => { O.f[0].cut = at - 9.9; O.f[0].egVel = 66; O.feg.susL = 30; }), 64) - full, -6.0, 0.25);
// a level velocity sensitivity is added to the level: the EG parked on its attack level 0 + 60 x 64/127 = 30
near('filter EG attack level 0 with sensitivity +60 at velocity 64 = level 30, dB', level(sine(O => { O.f[0].cut = at - 9.9; O.f[0].egInt = 33; O.feg.lv = [0, 60, 0]; O.feg.decT = 99; }), 64) - full, -6.2, 0.4);
// the cutoff follows the pitch sounded: the oscillator an octave up moves the cutoff 43/105 of an octave up
const trk = sine(O => { O.f[0].cut = at; O.transpose = 12; });
near('transpose +12: the low-pass moves 0.41 octave, dB', level(trk) - level(sine(O => { O.transpose = 12; })), -20 * Math.log10(1 + Math.pow(2, 2 * (1 - 43 / 105))), 0.2);
// the filter's limit: a resonance of 24 on the sine cannot lift it more than about 4 dB
near('resonance 24 at the sine: gain held, dB', level(sine(O => { O.f[0].cut = at; O.f[0].reso = 24; O.f[0].gain = 77; })) - level(sine(O => { O.f[0].gain = 77; })), 4.0, 1.0);

console.log(bad ? bad + ' FAILED' : 'PCM laws: all passed');
if (bad) process.exitCode = 1;
