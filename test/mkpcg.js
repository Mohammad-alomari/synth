// Writes a Trinity .PCG file from the test banks (test/fixtures.js; with OWN=1 your own files in private/), for import tests.
// Usage: node test/mkpcg.js <bank file name> <out.pcg> [sections]   sections: any of pcm,combi,moss (default all)
//        node test/mkpcg.js <sample disk name> <out.pcg> triton    a Triton PCG (no MOSS bank): one PCM bank from the
//        sample disk's first program (record 0) and copies of it on ROM multisamples 1-127, and the global's user scales
const fs = require('fs'), path = require('path'), dir = process.env.OWN ? path.join(__dirname, '..', 'private') : require('./fixtures.js').ensure();
if (process.argv[4] === 'triton') {
  const U = (() => { const m = new module.constructor(); m._compile(fs.readFileSync(path.join(dir, 'userdata.js'), 'utf8') + '\nmodule.exports = USER_TRITON;', 'u'); return m.exports; })();
  const out = process.argv[3], rec0 = Buffer.from(U.progs[0].m, 'base64'), recs = [];
  for (let i = 0; i < 128; i++) {
    const r = Buffer.from(rec0);
    if (i) { r.fill(32, 0, 16); r.write('Triton ' + String(i).padStart(3, '0'), 0, 'latin1'); r[230] = 0; r[231] = i; r[232] = 0; } // OSC 1: ROM multisample i
    recs.push(r);
  }
  const u32 = v => { const x = Buffer.alloc(4); x.writeUInt32BE(v); return x; }, chunk = (tag, body) => Buffer.concat([Buffer.from(tag, 'latin1'), u32(body.length), body]);
  const glb = Buffer.alloc(856); U.scales.forEach((sc, k) => sc.forEach((c, j) => { glb[8 + k * 12 + j] = c & 255; }));
  const pcg = chunk('PCG1', Buffer.concat([chunk('PRG1', chunk('PBK1', Buffer.concat([u32(128), u32(540), u32(0)].concat(recs)))), chunk('GLB1', glb)]));
  const h = Buffer.alloc(16); h.write('KORGP', 0, 'latin1'); h[7] = 1;
  fs.writeFileSync(out, Buffer.concat([h, pcg]));
  console.log('wrote', out, 'Triton: 1 PCM bank of 128 programs');
  process.exit(0);
}
const TRI = (() => { const m = new module.constructor(); m._compile(fs.readFileSync(path.join(dir, 'tridata.js'), 'utf8') + '\nmodule.exports = TRI_BUILTIN;', 'tri'); return m.exports; })();
const MOSS = (() => { const m = new module.constructor(); m._compile(fs.readFileSync(path.join(dir, 'pcgdata.js'), 'utf8') + '\nmodule.exports = MOSS_PCG_BUILTIN;', 'pcg'); return m.exports; })();
const [name, out, which] = process.argv.slice(2);
if (!name || !out) { console.error('usage: node test/mkpcg.js <name> <out.pcg> [pcm,combi,moss]\nnames: ' + TRI.map(t => t.name).join(', ')); process.exit(2); }
const want = new Set((which || 'pcm,combi,moss').split(','));
const T = TRI.find(t => t.name === name), M = MOSS.find(b => b.name === name && b.fmt !== 'triton');
if (!T) { console.error('no bank file named ' + name); process.exit(2); }
const b64 = s => Buffer.from(s, 'base64'), u16 = v => Buffer.from([v >> 8, v & 255]);
const L = { A: 0, B: 1, C: 2, D: 3 }, dirs = [], secs = [];
function add(type, count, body) { dirs.push([type, count, body.length]); secs.push(body); }
if (want.has('pcm') && T.pcm.length) add(0, T.pcm.length, Buffer.concat(T.pcm.flatMap(b => [u16(L[b.bank]), b64(b.m)])));
if (want.has('combi') && T.combis.length) add(2, T.combis.length, Buffer.concat(T.combis.flatMap(b => [u16(L[b.bank]), b64(b.m)])));
if (want.has('moss') && M) add(5, 1, Buffer.concat([u16(4), b64(M.m)]));
const h = Buffer.alloc(0x50); h.write('KORG;', 0, 'latin1'); h[7] = 5; h.writeUInt32BE(0x50, 0x18);
// the directory as the Trinity writes it: entry n is section type n (0 PCM, 1 S, 2 combinations, 3 kits, 4 global, 5 M); unused: FFFF
for (let i = 0; i < 6; i++) { const d = dirs.find(x => x[0] === i), o = 0x20 + i * 8; if (d) { h.writeUInt16BE(d[0], o); h.writeUInt16BE(d[1], o + 2); h.writeUInt32BE(d[2], o + 4); } else { h.writeUInt16BE(0xffff, o); } }
fs.writeFileSync(out, Buffer.concat([h].concat(secs)));
console.log('wrote', out, dirs.map(d => 'type ' + d[0] + ' x' + d[1]).join(', '));
