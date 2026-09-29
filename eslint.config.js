// ESLint for the synth's sources: npm run lint.
// The page's files are plain scripts that share names across files (build.py joins them into index.html; the app/
// files share one function scope), so each file's top-level declarations are declared as globals for the others.
const fs = require('fs'), path = require('path');
const js = require('@eslint/js'), globals = require('globals'), espree = require('espree');

const PAGE = ['fxcat.js', 'patches.js', 'engine.js', 'pcm.js', 'combi.js', 'fxdsp.js', 'pcmmap.js', 'korg.js'];
const DATA = { MOSS_PCG_BUILTIN: 'readonly', TRI_BUILTIN: 'readonly', USER_TRITON: 'readonly' }; // pcgdata.js / tridata.js / userdata.js (data, not linted)
const APP = fs.readdirSync(path.join(__dirname, 'app')).filter(f => f.endsWith('.js')).map(f => 'app/' + f);
// top-level names of the files: let / var may be reassigned from other files, the rest may not
function topNames(files) {
  const out = {};
  for (const f of files) {
    const ast = espree.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
    for (const n of ast.body) {
      if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) out[n.id.name] = 'readonly';
      if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') out[d.id.name] = n.kind === 'const' ? 'readonly' : 'writable';
    }
  }
  return out;
}
const pageGlobals = { ...topNames(PAGE), ...DATA }, appGlobals = topNames(APP);
const rules = {
  'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }], // top-level names are used by other files
  'no-redeclare': 'off', // each shared name is also declared in its own file
  'no-useless-assignment': 'off' // the DSP code starts its locals at 0 on purpose
};

module.exports = [
  { ignores: ['index.html', 'dist/**', 'node_modules/**', 'pcgdata.js', 'tridata.js', 'userdata.js', 'tools/samples/**'] },
  js.configs.recommended,
  { files: PAGE, languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.node, ...pageGlobals } }, rules },
  { files: APP, languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...pageGlobals, ...appGlobals } }, rules },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } }, rules },
  // the tests load the page's files into Node and use their names
  { files: ['test/**/*.js', 'tools/*.js', 'eslint.config.js'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...pageGlobals } }, rules }
];
