global.TFX = require('../fxcat.js').TFX; Object.assign(global, require('../fxdsp.js'));
const P = require('../patches.js'); Object.assign(global, P);
// engine needs MD etc: load engine.js into global scope
const vm = require('vm'); vm.runInThisContext(require('fs').readFileSync(__dirname + '/../engine.js', 'utf8').replace(/if \(typeof module[^\n]*\n/g, '') + '\nglobalThis.MossEngine = MossEngine;');
const sr = 48000, N = 128;
function run(cc1) {
  const e = new MossEngine(sr); e.handle({ t: 'patch', p: mossPreset(14) }); e.handle({ t: 'cc', c: 1, v: cc1 }); e.handle({ t: 'on', n: 57, v: 100 });
  const out = new Float32Array(sr), L = new Float32Array(N), R = new Float32Array(N);
  for (let b = 0; b < sr / N; b++) { e.process(L, R, N); out.set(L, b * N); }
  return out;
}
function band(a, f0, f1) { let t = 0; for (let f = f0; f <= f1; f += 20) { let re = 0, im = 0; for (let i = 24000; i < 48000; i++) { const w = 2 * Math.PI * f * i / sr; re += a[i] * Math.cos(w); im += a[i] * Math.sin(w); } t += re * re + im * im; } return 10 * Math.log10(t); }
const a = run(0), b = run(127);
console.log('JS+Y 0 (voice U):   300-450 Hz', band(a, 300, 450).toFixed(1), ' 600-800', band(a, 600, 800).toFixed(1), ' 1000-1200', band(a, 1000, 1200).toFixed(1));
console.log('JS+Y 127 (voice A): 300-450 Hz', band(b, 300, 450).toFixed(1), ' 600-800', band(b, 600, 800).toFixed(1), ' 1000-1200', band(b, 1000, 1200).toFixed(1));
