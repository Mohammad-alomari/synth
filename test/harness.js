// Loads the synth's sources into one scope (as the page does) for offline tests and tools.
// The sources are compiled as a module of this Node process. (They used to run in a vm context, where every global
// such as Math goes through a slow lookup: the engine ran 4-5x slower there than in a browser, which made the tests
// slow and their CPU figures misleading.)
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
const ORDER = ['fxcat.js', 'patches.js', 'engine.js', 'pcm.js', 'combi.js', 'fxdsp.js', 'pcmmap.js', 'korg.js', 'pcgdata.js', 'tridata.js'];
// the top-level names the tests use (a name the loaded files do not declare comes back undefined)
const NAMES = ['TFX', 'FxRack', 'MossEngine', 'MD', 'mossPreset', 'mossDefaultPatch', 'mossLoad', 'MOSS_PRESETS', 'korgDecodeMoss', 'korgParsePCG', 'KORG', 'MOSS_PCG_BUILTIN',
  'korgTritonToTrinity', 'KORG_PCM', 'korgTrinitySections', 'korgDecodePcm', 'korgDecodeCombi', 'PCM', 'PcmVoice', 'PcmStore', 'TRI_BUILTIN', 'PCM_STANDIN', 'PCM_RAMGUESS',
  'PCM_MS_NAMES', 'MossCombi', 'korgCombiChains', 'KORG_TRITON_PCM', 'korgTritonSections', 'korgDecodeTritonPcm'];
let serial = 0;
// files: source files in page order; root: the source tree (default: this one; the regression tools load an older
// copy too, which may lack some of the files)
function load(files, root) {
  root = root || dir;
  let code = files.filter(f => fs.existsSync(path.join(root, f)))
    .map(f => fs.readFileSync(path.join(root, f), 'utf8').replace(/if \(typeof module !== 'undefined'\)[^\n]*\n/g, '')).join('\n;\n');
  code += '\n;module.exports = {' + NAMES.map(n => n + ': typeof ' + n + " !== 'undefined' ? " + n + ' : undefined').join(', ') + '};';
  const m = new module.constructor();
  m._compile(code, path.join(root, 'bundle_' + (serial++) + '.js'));
  return m.exports;
}
module.exports = { load, ORDER };
