// Loads the synth's sources into one context (as the page does) for offline tests
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
function load(files) {
  const ctx = { console, Math, Float32Array, Float64Array, Uint8Array, Int16Array, Int32Array, Uint32Array, Array, Object, JSON, Number, String, atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64') };
  vm.createContext(ctx);
  let code = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/if \(typeof module !== 'undefined'\)[^\n]*\n/g, '')).join('\n;\n');
  // expose the top-level declarations
  code += '\n;this.__x = {' + ["TFX", "FxRack", "MossEngine", "MD", "mossPreset", "mossDefaultPatch", "mossLoad", "MOSS_PRESETS", "korgDecodeMoss", "korgParsePCG", "KORG", "MOSS_PCG_BUILTIN", "korgTritonToTrinity", "KORG_PCM", "korgTrinitySections", "korgDecodePcm", "korgDecodeKit", "korgDecodeCombi", "PCM", "PcmVoice", "PcmStore", "TRI_BUILTIN", "PCM_STANDIN", "PCM_RAMGUESS", "PCM_MS_NAMES", "MossCombi", "korgCombiChains"].map(n => n + ': typeof ' + n + " !== 'undefined' ? " + n + ' : undefined').join(', ') + '};';
  vm.runInContext(code, ctx, { filename: 'bundle.js' });
  return ctx.__x;
}
module.exports = { load, ORDER: ['fxcat.js', 'patches.js', 'engine.js', 'pcm.js', 'combi.js', 'fxdsp.js', 'pcmmap.js', 'korg.js', 'pcgdata.js', 'tridata.js'] };
