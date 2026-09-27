// Writes a Trinity .PCG file from the built-in data, for import tests.
// Usage: node test/mkpcg.js <built-in file name> <out.pcg> [sections]   sections: any of pcm,combi,kit,moss (default all)
const fs = require('fs'), path = require('path'), dir = path.join(__dirname, '..');
const TRI = (() => { const m = new module.constructor(); m._compile(fs.readFileSync(path.join(dir, 'tridata.js'), 'utf8') + '\nmodule.exports = TRI_BUILTIN;', 'tri'); return m.exports; })();
const MOSS = (() => { const m = new module.constructor(); m._compile(fs.readFileSync(path.join(dir, 'pcgdata.js'), 'utf8') + '\nmodule.exports = MOSS_PCG_BUILTIN;', 'pcg'); return m.exports; })();
const [name, out, which] = process.argv.slice(2);
if (!name || !out) { console.error('usage: node test/mkpcg.js <name> <out.pcg> [pcm,combi,kit,moss]\nnames: ' + TRI.map(t => t.name).join(', ')); process.exit(2); }
const want = new Set((which || 'pcm,combi,kit,moss').split(','));
const T = TRI.find(t => t.name === name), M = MOSS.find(b => b.name === name && b.fmt !== 'triton');
if (!T) { console.error('no built-in file named ' + name); process.exit(2); }
const b64 = s => Buffer.from(s, 'base64'), u16 = v => Buffer.from([v >> 8, v & 255]);
const L = { A: 0, B: 1, C: 2, D: 3 }, dirs = [], secs = [];
function add(type, count, body) { dirs.push([type, count, body.length]); secs.push(body); }
if (want.has('pcm') && T.pcm.length) add(0, T.pcm.length, Buffer.concat(T.pcm.flatMap(b => [u16(L[b.bank]), b64(b.m)])));
if (want.has('combi') && T.combis.length) add(2, T.combis.length, Buffer.concat(T.combis.flatMap(b => [u16(L[b.bank]), b64(b.m)])));
if (want.has('kit') && T.kits) { const k = b64(T.kits); add(3, k.length / 1426, Buffer.concat([u16(0), k])); }
if (want.has('moss') && M) add(5, 1, Buffer.concat([u16(4), b64(M.m)]));
const h = Buffer.alloc(0x50); h.write('KORG;', 0, 'latin1'); h[7] = 5; h.writeUInt32BE(0x50, 0x18);
for (let i = 0; i < 6; i++) { const d = dirs[i], o = 0x20 + i * 8; if (d) { h.writeUInt16BE(d[0], o); h.writeUInt16BE(d[1], o + 2); h.writeUInt32BE(d[2], o + 4); } else { h.writeUInt16BE(0xffff, o); } }
fs.writeFileSync(out, Buffer.concat([h].concat(secs)));
console.log('wrote', out, dirs.map(d => 'type ' + d[0] + ' x' + d[1]).join(', '));
