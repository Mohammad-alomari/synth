// Offline checks for the Organ, E.Piano and Brass models: pitch, level, spectrum, stability
const H = require('../harness.js'); const X = H.load(H.ORDER);
const sr = 48000;
function patchFor(type, p, extra) {
  const P = X.mossDefaultPatch(); P.osc[0].type = type; Object.assign(P.osc[0].p, p || {});
  P.mix[0] = { osc1: 99, osc2: 0, sub: 0, noise: 0, fb: 0 }; P.mix[1] = { osc1: 0, osc2: 0, sub: 0, noise: 0, fb: 0 };
  P.f[0].type = 'lpf'; P.f[0].freqA = 99; P.f[0].egInt = 0; P.f[0].resoA = 0; P.f[0].trimA = 99; P.f[0].rampLow = 0; P.f[0].rampHigh = 0;
  P.mods = []; P.fx.ins = []; P.fx.m1.on = 0; P.fx.m2.on = 0; P.fx.eqLo = 0; P.fx.eqHi = 0;
  P.ampEG = Object.assign(P.ampEG, { atkT: 0, decT: 0, slpT: 0, relT: 20, atkL: 99, brkL: 99, susL: 99, vel: 0 });
  P.amp[1].level = 0; P.out.level = 127;
  if (extra) extra(P);
  return P;
}
// renders the voice output directly (before program level / effects)
function renderVoice(P, note, vel, secs, offAt) {
  const e = new X.MossEngine(sr); e.handle({ t: 'patch', p: JSON.parse(JSON.stringify(P)) });
  e.handle({ t: 'on', n: note, v: vel });
  const n = Math.round(secs * sr), out = new Float64Array(n), L = new Float32Array(16), R = new Float32Array(16);
  for (let i = 0; i < n; i += 16) {
    if (offAt !== undefined && i === Math.round(offAt * sr / 16) * 16) e.handle({ t: 'off', n: note });
    L.fill(0); R.fill(0);
    for (const vv of e.voices) if (vv.active) vv.renderBlock(e, L, R, 0, 16);
    for (let k = 0; k < 16 && i + k < n; k++) out[i + k] = L[k] / 0.7071;
  }
  return out;
}
function goertzel(x, s, len, f) { const w = 2 * Math.PI * f / sr; let re = 0, im = 0; for (let i = 0; i < len; i++) { const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / len); re += x[s + i] * Math.cos(w * i) * win; im += x[s + i] * Math.sin(w * i) * win; } return Math.hypot(re, im) / len * 4; }
function harm(x, s, len, f, nh) { const r = []; for (let h = 1; h <= nh; h++) r.push(goertzel(x, s, len, f * h)); const m = Math.max(...r, 1e-12); return r.map(v => (20 * Math.log10(v / m + 1e-12)).toFixed(0).padStart(4)).join(''); }
function rms(x, s, len) { let a = 0; for (let i = s; i < s + len; i++) a += x[i] * x[i]; return Math.sqrt(a / len); }
function peak(x) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; }
function pitchAC(x, s, len, f0) { const T = sr / f0; const cc = l => { let c = 0; for (let i = s; i < s + len; i++) c += x[i] * x[i + l]; return c; };
  let best = -1e9, bi = 0; for (let l = Math.floor(T * 0.9); l <= Math.ceil(T * 1.1); l++) { const c = cc(l); if (c > best) { best = c; bi = l; } }
  const a = cc(bi - 1), b = cc(bi), c = cc(bi + 1); return sr / (bi + 0.5 * (a - c) / (a - 2 * b + c)); }
const db = v => (20 * Math.log10(v + 1e-12)).toFixed(1);
module.exports = { X, patchFor, renderVoice, harm, rms, peak, pitchAC, db, goertzel, sr };
if (require.main === module) {
  const which = process.argv[2] || 'all';
  const mh = n => 440 * Math.pow(2, (n - 69) / 12);
  if (which === 'all' || which === 'organ') {
    console.log('== Organ');
    const base = { og0Wave: 0, og0Harm: 2, og0Fine: 0, og0Lvl: 99, og0Perc: 0, og1Wave: 0, og1Harm: 4, og1Fine: 0, og1Lvl: 0, og1Perc: 0, og2Wave: 0, og2Harm: 6, og2Fine: 0, og2Lvl: 0, og2Perc: 60, ogTrig: 1, ogDecay: 40 };
    for (const [nm, p] of [['sin1 h2', {}], ['sin2 h2', { og0Wave: 1 }], ['sin3 h2', { og0Wave: 2 }], ['tri h2', { og0Wave: 3 }], ['h1 (16\')', { og0Harm: 1 }], ['3 bars full', { og1Lvl: 99, og2Lvl: 99 }], ['fine +50', { og0Fine: 50 }]]) {
      const P = patchFor('organ', Object.assign({}, base, p));
      for (const n of [36, 60, 96]) {
        const x = renderVoice(P, n, 100, 0.6), f = mh(n) * (p.og0Harm === 1 ? 0.5 : 1) * Math.pow(2, (p.og0Fine || 0) / 1200);
        console.log(nm.padEnd(12), n, 'pitch err c', (1200 * Math.log2(pitchAC(x, 12000, 8000, f) / f)).toFixed(1), 'rms', db(rms(x, 12000, 8000)), 'pk', peak(x).toFixed(2), 'harm', harm(x, 12000, 8192, f, 8));
      }
    }
    // percussion envelope: level of the 3rd harmonic (drawbar 3, harm 6 = 3x) over time
    const P = patchFor('organ', base); const x = renderVoice(P, 60, 100, 1.2);
    console.log('percussion (h3 level dB at 0.02/0.1/0.3/0.6 s):', [0.02, 0.1, 0.3, 0.6].map(t => db(goertzel(x, Math.round(t * sr), 2048, mh(60) * 3))).join(' '));
  }
  if (which === 'all' || which === 'ep') {
    console.log('== E.Piano');
    const base = { epForce: 60, epCurve: 40, epWidth: 60, epClick: 30, epDecay: 70, epRel: 40, epOtL: 50, epOtF: 90, epOtD: 40, epPos: 50, epEqF: 0, epEqG: 0 };
    for (const [nm, p] of [['default', {}], ['pickup 0', { epPos: 0 }], ['pickup 99', { epPos: 99 }], ['force 99', { epForce: 99 }], ['force 10', { epForce: 10 }], ['no overtone', { epOtL: 0 }], ['SAZ M62', { epForce: 44, epCurve: 15, epWidth: 99, epClick: 99, epDecay: 99, epRel: 60, epOtL: 99, epOtF: 0, epOtD: 0, epPos: 0, epEqF: 49, epEqG: 18 }]]) {
      const P = patchFor('epiano', Object.assign({}, base, p));
      for (const n of [36, 60, 84]) for (const v of [40, 120]) {
        const x = renderVoice(P, n, v, 1.0), f = mh(n);
        console.log(nm.padEnd(12), n, v, 'pk', peak(x).toFixed(2), 'rms 0.1-0.3', db(rms(x, 4800, 9600)), 'rms 0.7-0.9', db(rms(x, 33600, 9600)), 'harm', harm(x, 4800, 8192, f, 8));
      }
    }
  }
  if (which === 'all' || which === 'brass') {
    console.log('== Brass');
    const base = { brType: 0, brPrsEg: 'amp', brPrsInt: 99, brLip: 50, brBell: 0, brBellRes: 0, brNoise: 5, brEqF: 25, brEqQ: 10, brEqG: 0, brStr: 0 };
    for (const [nm, p] of [['Brass1', {}], ['Brass1 soft', { brPrsInt: 30 }], ['Brass1 p60', { brPrsInt: 60 }], ['lip 0', { brLip: 0 }], ['lip 99', { brLip: 99 }], ['Brass3', { brType: 2 }], ['Horn1', { brType: 3 }], ['ReedBrass', { brType: 5 }], ['bell 60 res 60', { brBell: 60, brBellRes: 60 }], ['strength 99', { brStr: 99 }]]) {
      const P = patchFor('brass', Object.assign({}, base, p));
      for (const n of [41, 60, 79]) {
        const x = renderVoice(P, n, 100, 0.6), f = mh(n);
        console.log(nm.padEnd(15), n, 'pitch err c', (1200 * Math.log2(pitchAC(x, 12000, 8000, f) / f)).toFixed(1), 'rms', db(rms(x, 12000, 8000)), 'pk', peak(x).toFixed(2), 'harm', harm(x, 12000, 8192, f, 10));
      }
    }
  }
}
