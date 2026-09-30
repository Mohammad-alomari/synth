// Decoder rules that must hold. Exit code 0 = all passed.
// A sound the file names but the synth does not have (a RAM/Flash sample, an unmapped Triton multisample) plays the one
// fallback, PCM_FALLBACK, whatever the program is called: the synth never picks a sound by the program's name.
const H = require('./harness.js'), X = H.load(H.ORDER);
const b64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
let fails = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); if (!cond) fails++; };
const FB = X.PCM_FALLBACK;
ok('the fallback is a ROM multisample with a stand-in', Number.isInteger(FB) && !!X.PCM_STANDIN.ms[FB], FB);

// a Trinity PCM program playing RAM samples, under names that once picked a sound (zurna, mijwiz, oud, kanun, piano...)
const T = X.TRI_BUILTIN[0], bank = b64(T.pcm[0].m), rec = Uint8Array.from(bank.subarray(0, 433));
rec[31] = rec[33] = 0x10; rec[32] = 7; rec[34] = 9; // OSC 1: RAM samples 7 (low velocities) and 9 (high)
for (const name of ['Zurna Mijwiz', 'Oud Kanun', 'Kamanja Rabab', 'Tabla Darbuka', 'Grand Piano', 'Nay Kawala', 'Anything']) {
  for (let i = 0; i < 16; i++) rec[i] = i < name.length ? name.charCodeAt(i) : 32;
  const P = X.korgDecodePcm(rec, T.scale);
  ok('RAM samples of "' + name + '" play the fallback', P.ramMap && P.ramMap[7] === FB && P.ramMap[9] === FB, P.ramMap);
}
const P = X.korgDecodePcm(rec, T.scale);
ok('...and the Program page says so', P.korgInfo.notes.some(n => /RAM\/Flash samples 7, 9.*fallback/.test(n)), P.korgInfo.notes);

// a Triton program whose RAM sample is not among the loaded samples, and one on an unmapped ROM multisample
// the test banks' made-up sample disk (userdata.js): its Triton program
const tri = Uint8Array.from(b64(require('fs').readFileSync(require('path').join(H.DATA_DIR, 'userdata.js'), 'utf8').match(/"m":"([^"]+)"/)[1]));
const missing = X.korgDecodeTritonPcm(tri, { scales: [] }, () => undefined);
ok('a Triton RAM sample that is not loaded plays the fallback', Object.values(missing.ramMap || {}).every(v => v === FB) && Object.keys(missing.ramMap || {}).length > 0, missing.ramMap);
const rom = Uint8Array.from(tri); rom[232] = 0; // OSC 1 bank: ROM
const R = X.korgDecodeTritonPcm(rom, { scales: [] }, () => undefined);
ok('a Triton ROM multisample (not mapped yet) plays the fallback', R.o[0].msHi === FB && R.korgInfo.notes.some(n => /not mapped yet; fallback/.test(n)), [R.o[0].msHi, R.korgInfo.notes]);
console.log(fails ? fails + ' FAILED' : 'decoder rules: all passed');
process.exitCode = fails ? 1 : 0;
