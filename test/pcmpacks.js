// Node helper for tests: decodes stand-in packs (samples/*.mp3) with ffmpeg into engine zones, exactly as the page does
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const dir = path.join(__dirname, '..', 'samples');
let INDEX = null; const cache = {};
function index() { return INDEX || (INDEX = JSON.parse(fs.readFileSync(path.join(dir, 'packs.json'), 'utf8'))); }
// the same conversion as the page's loader (app/core.js pcmZones): sync-click alignment, loop-seam heal, zone list
function zonesFrom(meta, x) {
  let k = 0, m = 0; for (let i = 0; i < Math.min(x.length, meta.sync + meta.search); i++) { const a = Math.abs(x[i]); if (a > m) { m = a; k = i; } }
  const off = k - meta.sync, zones = [];
  for (const [st, len, ls, le, gdb, zs] of meta.s) {
    const s = st + off, a = ls >= 0 ? ls + off : -1, e = le >= 0 ? le + off : -1;
    if (a > 0 && e > a) { const n = Math.min(meta.heal || 64, a, e - a); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; x[e - n + i] = x[e - n + i] * (1 - t) + x[a - n + i] * t; } }
    for (const [lo, hi, root, tune] of zs) zones.push({ lo, hi, root: root - tune / 100, rate: meta.rate, data: x, ls: a, le: e, end: s + len, start: s, gain: Math.pow(10, gdb / 20) });
  }
  return zones;
}
function pack(name) {
  if (cache[name]) return cache[name];
  const meta = index().packs[name]; if (!meta) return null;
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, meta.file), '-f', 'f32le', '-ac', '1', '-ar', String(meta.rate), '-'], { maxBuffer: 1 << 28 });
  const x = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  return (cache[name] = zonesFrom(meta, x));
}
// give an engine the stand-in map and every pack it asks for (call after note-ons, then render again)
function feed(eng, X) {
  if (!eng._mapSent) { eng.handle({ t: 'pcmMap', map: X.PCM_STANDIN }); eng._mapSent = true; }
  for (const n of [...eng.store.need]) { const z = pack(n); if (z) eng.handle({ t: 'pcmPack', name: n, zones: z }); eng.store.need.delete(n); }
}
function preload(eng, X, P) { // resolve every stand-in a PCM program can use before playing it
  eng.handle({ t: 'pcmMap', map: X.PCM_STANDIN }); eng._mapSent = true;
  const ids = []; for (const O of P.o) ids.push(O.msHi, O.msLo);
  for (const id of ids) { const e = X.PCM_STANDIN.ms[id < 0x1000 ? id : (P.ramMap && P.ramMap[id & 0xfff]) || 0]; if (e && e.p) { const z = pack(e.p); if (z) eng.handle({ t: 'pcmPack', name: e.p, zones: z }); } }
}
module.exports = { index, pack, feed, preload, zonesFrom };
