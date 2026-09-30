#!/usr/bin/env node
// Writes userdata.js: starter programs made from the owner's own sample disk (a Triton/Trinity PCG saved with its
// samples: <name>.PCG + <name>/ with the KMP/KSF multisamples). The KMP file names carry each multisample's number in
// the synth's RAM, which is how the PCG's programs refer to them. Programs whose every audible multisample is on the disk
// become starter programs; they play the packs tools/samples/build_korg.py --all --prefix u_ builds into samples/user/.
// userdata.js holds the programs' own bytes (decoded at start-up by korgDecodeTritonPcm) and the file's user scales; it
// lives in private/ (never committed) and is left out of the public build.
// Usage: node tools/user_starters.js "<folder>/<disk>.PCG" [out=private/userdata.js]
const fs = require('fs'), path = require('path');
const H = require('../test/harness.js'), X = H.load(H.ORDER);
const pcgPath = process.argv[2], out = process.argv[3] || path.join(__dirname, '..', 'private', 'userdata.js');
if (!pcgPath) { console.error('usage: node tools/user_starters.js <file.PCG> [out.js]'); process.exit(1); }
const disk = path.join(path.dirname(pcgPath), path.basename(pcgPath, path.extname(pcgPath)));
const packName = f => 'u_' + f.toLowerCase().replace(/[^a-z0-9_-]/g, '_'); // same rule as build_korg.py

// the multisamples on the disk: RAM number (from the KMP file name) -> pack, name; empty ones (only skipped samples) are left out
// (where a pack is not built, the page plays the fallback, PCM_FALLBACK: no sound is picked by its name)
const ms = {}, byRam = {};
for (const f of fs.readdirSync(disk).filter(f => /\.KMP$/i.test(f))) {
  const b = fs.readFileSync(path.join(disk, f)), stem = f.slice(0, -4), n = Number(stem.slice(-3));
  const name = b.subarray(8, 24).toString('latin1').replace(/[^\x20-\x7e]/g, ' ').trim().replace(/\s+/g, ' ');
  const dir = path.join(disk, stem), ksf = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => /\.KSF$/i.test(x)).length : 0;
  if (!ksf || isNaN(n)) { console.log('skipped (no samples):', f, name); continue; }
  ms[packName(stem)] = { name, ram: n };
  byRam[n] = packName(stem);
}

const pcg = new Uint8Array(fs.readFileSync(pcgPath)), T = X.korgTritonSections(pcg);
if (!T.ok || !T.pcm.length) { console.error('not a Triton PCG with PCM programs'); process.exit(1); }
const progs = [], seen = new Set(), names = new Set(), used = new Set();
const ok = P => P.mode !== 'drum' && P.ramMap && !P.korgInfo.missing.rom && !P.korgInfo.missing.ram;
const add = (P, r, at, note) => {
  const body = JSON.stringify(Object.assign({}, P, { name: '' })), nm = P.name.trim();
  if (seen.has(body) || names.has(nm)) return false; // the same program saved again, or another version under the same name
  seen.add(body); names.add(nm); Object.values(P.ramMap).forEach(v => used.add(v));
  progs.push(Object.assign({ n: nm, at, m: Buffer.from(r).toString('base64') }, note ? { note } : {})); return true;
};
// 1. programs whose every audible multisample is on the disk, as saved
for (const bank of T.pcm) bank.recs.forEach((r, i) => { const P = X.korgDecodeTritonPcm(r, T.glb, n => byRam[n]); if (ok(P)) add(P, r, bank.bank + String(i).padStart(3, '0')); });
// 2. a multisample no such program plays: the first Double program whose OSC 1 plays it and whose OSC 2 is not on the disk,
//    as a Single program (its OSC 1 with its envelopes, filter and effects)
for (const bank of T.pcm) bank.recs.forEach((r, i) => {
  if ((r[204] & 3) !== 1) return;
  const one = Uint8Array.from(r); one[204] = (one[204] & ~3); // oscillator mode Single
  const P = X.korgDecodeTritonPcm(one, T.glb, n => byRam[n]);
  if (ok(P) && Object.values(P.ramMap).some(v => !used.has(v))) add(P, one, bank.bank + String(i).padStart(3, '0'), 'OSC 1 only (OSC 2 is not on the disk)');
});
// 3. the multisamples still left: a plain program each (built at start-up)
const plain = Object.keys(ms).filter(k => !used.has(k));
const data = { name: path.basename(pcgPath, path.extname(pcgPath)), scales: T.glb.scales, ms, progs, plain };
fs.writeFileSync(out, '// Starter programs from the owner\'s own sample disk (tools/user_starters.js from ' + path.basename(pcgPath) + '): the Triton programs whose\n' +
  '// multisamples are all on the disk, as their 540-byte records (m, base64), the file\'s user octave scales, and the disk\'s multisamples\n' +
  '// (pack in samples/user/, RAM number, name). Left out of the public build.\n' +
  'const USER_TRITON = ' + JSON.stringify(data) + ';\n' +
  "if (typeof module !== 'undefined') module.exports = { USER_TRITON };\n");
console.log('multisamples', Object.keys(ms).length, 'in programs', used.size, '| starter programs', progs.length, '+ plain', plain.length, plain.join(' '));
console.log(progs.map(p => p.at + ' ' + p.n).join(' | '));
