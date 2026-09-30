// Test banks: made-up Trinity data in the shape of the built-in bank files (pcgdata.js, tridata.js, userdata.js), so the
// tests need nobody's own PCG files. Every record is written byte by byte after the Korg layouts that korg.js reads
// (docs/research/), with values from a seeded random generator: the same banks on every run and machine.
// They cover every MOSS oscillator model, Single / Double / Drum PCM programs, RAM samples, effects of every size,
// combinations with PCM and MOSS timbres, key splits, delay start, MIDI filters, insert chains, a file with a Bank S
// (Solo-TRI) and a Triton program from a made-up sample disk (in place of userdata.js).
// Usage: node test/fixtures.js [outdir]   (default test/fixtures/, ignored by git). The harness calls ensure().
const fs = require('fs'), path = require('path');
const { TFX } = require('../fxcat.js');
const OUT = path.join(__dirname, 'fixtures');

// the files: set 1 has every bank (it fills in for imported files that lack one), set 3 has a Bank S and drum programs
const SETS = [
  { name: 'TestSet1', pcm: 'ABCD', combis: 'ABCD', moss: true, scale: [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, -50, 0] },
  { name: 'TestSet2', pcm: 'AB', combis: 'A', moss: true, scale: [0, 0, 0, 0, -55, 0, 0, 0, 0, 0, 0, -55] },
  { name: 'TestSet3', pcm: 'AB', combis: 'AB', moss: false, s: 1, drums: true, scale: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50] }
];
const MOSS_MODELS = ['Standard', 'Comb', 'VPM', 'Resonance', 'Ring', 'Cross', 'Sync', 'Organ', 'E.Piano', 'Brass', 'Reed', 'Pluck', 'Bowed'];
// the 38 bytes of each model (korgDecodeMoss): e = [byte, lowest, highest] of its lists and signed fields, s = bytes naming a modulation source
const MODEL_BYTES = [
  { e: [[7, 6, 9]], s: [9, 12, 17, 20] }, { e: [[0, 0, 5]], s: [4, 7, 9, 12] }, { e: [[0, 0, 3], [13, 0, 16], [19, 0, 7]], s: [2, 4, 7, 9, 15, 17, 21, 23] },
  { e: [[0, 0, 4]], s: [2, 4, 8, 14, 20, 26, 30] }, { e: [[0, 0, 4], [1, 0, 3]], s: [3, 5] }, { e: [[0, 0, 4], [1, 0, 3]], s: [3, 5] }, { e: [[0, 0, 4], [1, 0, 3]], s: [] },
  { e: [[0, 0, 3], [7, 0, 3], [14, 0, 3]], s: [4, 11, 18, 23] }, { e: [[12, 0, 49], [13, -18, 18]], s: [10] },
  { e: [[0, 0, 5], [2, 0, 5], [28, 0, 49], [29, 0, 29], [30, -18, 18]], s: [4, 6, 10] }, { e: [[0, 0, 16], [2, 0, 5]], s: [4, 6, 26, 36] },
  { e: [], s: [9, 12, 16, 22, 26] }, { e: [[0, 0, 5], [7, 0, 5]], s: [2, 4, 9, 13, 19, 22, 25] }
];

// mulberry32, seeded from a text, so each bank keeps its bytes when another one changes
function rng(text) {
  let a = 0; for (const c of text) a = (Math.imul(a, 31) + c.charCodeAt(0)) | 0;
  const next = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), chance: p => next() < p, pick: l => l[Math.floor(next() * l.length)] };
}
const text = (r, s) => { for (let i = 0; i < 16; i++) r[i] = i < s.length ? s.charCodeAt(i) & 127 : 32; };
const FX_N = {}; for (const e of TFX.CAT) { const [g, n] = e.id.split(':'); FX_N[g] = Math.max(FX_N[g] || 0, +n + 1); }
// an insert block (22 bytes): random parameter bytes (the decoder clamps each field to its range), a type of size 1, 2 or 4
function insBlock(r, o, R) {
  const sz = R.int(1, 3);
  for (let k = 0; k < 16; k++) r[o + k] = R.int(0, 255);
  r[o + 16] = R.int(0, FX_N['S' + [0, 1, 2, 4][sz]] - 1) | (R.chance(0.9) ? 64 : 0); r[o + 17] = sz;
  r[o + 18] = R.chance(0.7) ? 64 : R.int(0, 127); r[o + 19] = 127; r[o + 20] = R.int(0, 127); r[o + 21] = R.int(0, 127);
}
// master effects 1 and 2 with their returns, and the master EQ (40 bytes)
function master(r, o, R) {
  const m = (p, g, on) => { for (let k = 0; k < 16; k++) r[p + k] = R.int(0, 255); r[p + 16] = R.int(0, FX_N[g] - 1) | (on ? 64 : 0); r[p + 17] = 50; r[p + 18] = R.int(60, 127); };
  m(o, 'MM', R.chance(0.6)); if (R.chance(0.2)) r[o + 16] |= 128; // cascade into master effect 2
  m(o + 19, 'MR', R.chance(0.8));
  r[o + 38] = R.int(-12, 12) & 255; r[o + 39] = R.int(-12, 12) & 255;
}

// ---- MOSS program (521 bytes; korgDecodeMoss) ----
function mossRec(name, model, R) {
  const r = new Uint8Array(521); text(r, name);
  r[17] = R.chance(0.85) ? 0x80 : R.pick([0x00, 0x40]) | (R.int(0, 2) << 4); // poly, or mono with a note priority
  r[19] = R.chance(0.8) ? 0 : R.pick([0x10, 0x30, 0x90]) | R.int(0, 11); // equal, pure major, Arabic or the user scale, on some key
  r[20] = R.chance(0.8) ? 0 : R.int(0, 20); r[23] = R.chance(0.85) ? 0 : R.int(1, 3); r[24] = R.int(0, 40);
  for (let i = 0; i < 4; i++) { // EG 1-4
    const b = 25 + i * 19;
    [R.int(-99, 99), R.int(0, 60), R.int(-99, 99), R.int(0, 70), R.int(-99, 99), R.int(0, 70), R.int(-99, 99), R.int(0, 60), R.int(-50, 50)].forEach((v, k) => { r[b + k] = v & 255; });
    if (R.chance(0.3)) { r[b + 9] = R.int(1, 33); r[b + 10] = R.int(-99, 99) & 255; }
    r[b + 11] = R.int(-30, 30) & 255;
  }
  for (let i = 0; i < 4; i++) { const b = 101 + i * 11; r[b] = R.int(0, 17) | (R.int(0, 2) << 6); r[b + 1] = R.int(0, 199); r[b + 6] = R.int(0, 60); r[b + 9] = R.int(-20, 20) & 255; } // LFO 1-4
  r[145] = 2; r[146] = 254; if (R.chance(0.1)) r[147] = R.int(0, 255); // bend range, step
  if (R.chance(0.4)) { r[148] = R.pick([6, 7, 19, 20]); r[149] = R.int(-15, 15) & 255; } // pitch modulation
  if (R.chance(0.1)) { r[150] = R.int(1, 3); r[151] = R.int(0, 60); } // portamento
  const osc = (base, type) => { // type, pitch block (octave 0, key tracking 1:1), then the model's 38 bytes
    r[base] = type; r[base + 1] = 2; r[base + 3] = R.chance(0.3) ? R.int(-10, 10) & 255 : 0; r[base + 5] = 60; r[base + 6] = 50; r[base + 7] = 50;
    if (R.chance(0.2)) { r[base + 8] = R.pick([6, 7]); r[base + 9] = R.int(-20, 20) & 255; }
    const sb = base + 14, M = MODEL_BYTES[type];
    for (let k = 0; k < 38; k++) r[sb + k] = R.int(0, 99);
    for (const [k, lo, hi] of M.e) r[sb + k] = R.int(lo, hi) & 255;
    for (const k of M.s) r[sb + k] = R.chance(0.3) ? R.int(1, 33) : 0;
    if (type === 0) r[base + 16] = R.int(60, 99); // Standard: an audible saw / pulse level
  };
  osc(154, model); osc(206, R.int(0, 8));
  r[258] = R.pick([1, 2]); r[262] = 60; r[263] = 50; r[264] = 50; r[271] = R.int(0, 3); // sub oscillator
  r[272] = R.int(0, 3); r[273] = R.int(50, 99); r[274] = R.int(0, 99); r[279] = R.int(0, 60); // noise
  r[280] = R.int(70, 99); r[283] = R.int(0, 99); // mixer: OSC 1 (always heard), OSC 2, sub, noise, feedback
  if (R.chance(0.6)) { r[286] = R.int(0, 99); r[289] = R.int(0, 99); }
  if (R.chance(0.4)) r[292] = R.int(0, 80);
  if (R.chance(0.3)) r[298] = R.int(0, 50);
  if (R.chance(0.2)) r[304] = R.int(0, 40);
  r[311] = R.int(0, 2) | (R.chance(0.3) ? 4 : 0); // routing, link
  for (const b of [312, 339]) { // filters 1-2
    const t = R.int(1, 5); r[b] = t; r[b + 1] = 99; r[b + 2] = t === 2 ? R.int(0, 50) : R.int(35, 99); r[b + 4] = 127; r[b + 7] = R.int(0, 5); r[b + 8] = R.int(-60, 60) & 255;
    r[b + 13] = R.int(0, 70); r[b + 16] = 99; r[b + 17] = R.int(35, 99); r[b + 19] = 127; r[b + 22] = R.int(-60, 60) & 255; r[b + 25] = R.int(0, 50);
  }
  for (const b of [366, 375]) { r[b] = R.int(80, 99); r[b + 2] = 127; r[b + 5] = R.chance(0.8) ? 5 : R.int(1, 4); } // amps (5 = amp EG)
  [R.int(0, 40), 99, R.int(10, 70), R.int(50, 99), R.int(10, 70), R.int(40, 99), R.int(5, 50)].forEach((v, k) => { r[385 + k] = v; }); // amp EG
  r[395] = R.int(-30, 30) & 255;
  r[403] = R.chance(0.8) ? 64 : R.int(0, 127); r[406] = R.int(100, 127); r[407] = R.int(0, 127); r[408] = R.int(0, 127); r[409] = 120;
  for (let k = 0; k < 3; k++) if (R.chance(0.35)) insBlock(r, 415 + k * 22, R);
  r[477] = 64; r[478] = 127; r[479] = R.int(0, 127); r[480] = R.int(0, 127);
  master(r, 481, R);
  return r;
}

// ---- PCM program (433 bytes; korgDecodePcm). o: { mode 0 single / 1 double / 2 drum, ms: [OSC 1, OSC 2], plain } ----
function pcmRec(name, R, o) {
  const r = new Uint8Array(433); text(r, name);
  r[16] = R.int(0, 15) | (R.int(0, 15) << 4);
  r[17] = o.mode | (!o.plain && R.chance(0.1) ? 0x08 | (R.chance(0.5) ? 0x04 : 0) : 0) | (R.chance(0.05) ? 0x10 : 0) | (R.int(0, 2) << 5);
  r[18] = o.mode === 1 && R.chance(0.3) ? R.int(40, 100) : 1;
  r[19] = o.plain || R.chance(0.8) ? 0 : R.pick([0x10, 0x30, 0x90]) | R.int(0, 11);
  if (!o.plain && R.chance(0.2)) [R.int(-30, 30), R.int(0, 40), R.int(-30, 30), R.int(0, 40), R.int(0, 40), R.int(-30, 30)].forEach((v, k) => { r[22 + k] = v & 255; }); // pitch EG
  const osc = (b, ms) => {
    const put = (at, n) => { r[at] = (n >> 8) & 0x7f; r[at + 1] = n & 255; };
    put(b, ms); put(b + 2, !o.plain && R.chance(0.2) ? R.int(0, 332) : ms);
    r[b + 4] = R.int(100, 127); r[b + 5] = R.int(100, 127); r[b + 6] = !o.plain && R.chance(0.2) ? R.int(40, 100) : 1;
    r[b + 7] = ((o.plain || R.chance(0.8) ? 2 : R.pick([1, 3])) << 6) | (R.chance(0.1) ? R.int(-12, 12) & 31 : 0); // octave, transpose
    const tune = R.chance(0.3) ? R.int(-15, 15) : 0; r[b + 8] = (tune >> 8) & 255; r[b + 9] = tune & 255;
    r[b + 10] = !o.plain && R.chance(0.1) ? R.int(1, 30) : 0; // delay
    r[b + 11] = 10; r[b + 12] = R.chance(0.2) ? R.int(-20, 20) & 255 : 0; r[b + 13] = R.chance(0.3) ? R.int(0, 8) : 0; r[b + 15] = 2; r[b + 16] = 254;
    r[b + 23] = R.int(0, 18); r[b + 25] = R.int(20, 80); r[b + 26] = R.int(0, 40); r[b + 29] = R.int(0, 60); r[b + 32] = R.int(0, 40); r[b + 33] = R.int(0, 30); // OSC LFO, vibrato
    const route = o.plain ? 2 : R.pick([2, 2, 2, 1, 0, 3]), ft = [o.plain || R.chance(0.8) ? 0 : R.int(1, 3), R.int(0, 3)];
    r[b + 36] = ft[0] | (ft[1] << 2) | (route << 4);
    [R.int(-30, 30), R.int(0, 30), R.int(0, 99), R.int(0, 60), R.int(-50, 99), R.int(0, 60), R.int(-50, 99), R.int(0, 50), R.int(-30, 30)].forEach((v, k) => { r[b + 37 + k] = v & 255; }); // filter EG
    r[b + 61] = R.int(0, 18); r[b + 63] = R.int(10, 80); // filter LFO
    ft.forEach((t, k) => { // filters A and B: a high-pass sits low, a low-pass / band-pass higher
      const f = b + 72 + k * 15; r[f] = t === 1 ? R.int(0, 40) : o.plain ? R.int(70, 99) : R.int(40, 99); r[f + 1] = 99; r[f + 2] = R.int(0, 20);
      r[f + 4] = R.int(-40, 60) & 255; r[f + 9] = 60; r[f + 10] = 60;
    });
    r[b + 102] = R.int(90, 127); r[b + 103] = 60; r[b + 104] = 60; r[b + 107] = R.int(0, 40); // amp
    [0, R.int(0, 25), 99, R.int(10, 70), R.int(60, 99), R.int(10, 70), R.int(40, 99), R.int(10, 50)].forEach((v, k) => { r[b + 111 + k] = v; }); // amp EG
    r[b + 132] = R.chance(0.7) ? 64 : R.int(20, 108); r[b + 135] = R.int(0, 60); r[b + 136] = R.int(0, 90);
  };
  osc(31, o.ms[0]); osc(168, o.ms[1]);
  if (!o.plain) for (let k = 0; k < 4; k++) if (R.chance(0.3)) insBlock(r, 305 + k * 22, R);
  master(r, 393, R);
  return r;
}

// ---- combination (388 bytes; korgDecodeCombi). letters: the file's PCM banks; M: it has a Bank M; plain: one timbre, bank A 0-1 ----
function combiRec(name, R, letters, M, plain) {
  const r = new Uint8Array(388); text(r, name);
  r[16] = R.int(0, 15); r[17] = R.chance(0.85) ? 0 : 0x30 | R.int(0, 11);
  const nIns = plain || R.chance(0.5) ? 0 : R.int(1, 4);
  for (let k = 0; k < nIns; k++) { insBlock(r, 20 + k * 22, R); if (R.chance(0.2)) r[20 + k * 22 + 16] |= 128; }
  master(r, 196, R);
  const nT = plain ? 1 : R.pick([1, 2, 2, 3, 4, 8]), split = nT === 2 && R.chance(0.4), vsplit = !split && nT === 2 && R.chance(0.3);
  for (let n = 0; n < 8; n++) {
    const b = 236 + n * 19;
    if (n >= nT) { r[b + 2] = 0x20 | 16; r[b + 3] = 127; r[b + 12] = 127; r[b + 15] = 127; r[b + 16] = 1; continue; } // off
    const moss = M && !plain && R.chance(0.2);
    r[b] = plain ? R.int(0, 1) : R.int(0, 127); r[b + 1] = moss ? 4 : plain ? 0 : R.int(0, letters.length - 1);
    r[b + 2] = (R.chance(0.9) || plain ? 0 : 3) << 5 | (R.chance(0.9) || plain ? 16 : 0); // internal (or both) on the global channel (or 1)
    r[b + 3] = R.int(90, 127); r[b + 4] = 0xE7; r[b + 5] = R.chance(0.2) ? R.pick([-12, 12]) & 255 : 0; r[b + 6] = R.chance(0.3) ? R.int(-10, 10) & 255 : 0;
    r[b + 7] = plain || R.chance(0.9) ? 0 : R.pick([R.int(1, 40), 255]); // delay start (255: at note-off)
    r[b + 8] = R.chance(0.5) ? 128 : R.int(0, 127); r[b + 9] = R.chance(0.5) ? 128 : R.int(0, 127); r[b + 10] = R.chance(0.5) ? 128 : R.int(0, 127);
    r[b + 11] = plain || R.chance(0.85) ? 0x0F : R.int(0, 15); // MIDI filters
    r[b + 12] = split && n === 0 ? 59 : 127; r[b + 13] = split && n === 1 ? 60 : 0; r[b + 15] = vsplit && n === 0 ? 63 : 127; r[b + 16] = vsplit && n === 1 ? 64 : 1;
    r[b + 18] = n === 0 ? (nIns ? R.int(1, 4) : 0) : nIns && R.chance(0.5) ? 5 : 0; // timbre 1 owns the insert chain, some others share it
  }
  return r;
}

// ---- a Triton PCM program (540 bytes; korgDecodeTritonPcm) playing RAM multisample n, with the file's user scale 0 ----
function tritonRec(name, n) {
  const r = new Uint8Array(540); text(r, name);
  r[172] = 52; r[173] = 64; r[177] = 60; // master effect 2: Reverb Hall, on
  r[204] = 0; r[206] = 3; r[207] = 11; // Single, poly; user octave scale 0
  const b = 230;
  r[b] = n >> 8; r[b + 1] = n & 255; r[b + 2] = 1; r[b + 3] = 120; r[b + 9] = 1; r[b + 10] = 1; r[b + 11] = 127; // RAM multisample, levels, velocity range
  r[b + 38] = 10; r[b + 46] = 2; r[b + 47] = 254; r[b + 57] = 99; r[b + 64] = 99; r[b + 79] = 99; // key tracking 1:1, bend, open filter
  r[b + 116] = 110; [0, 2, 99, 30, 99, 30, 90, 30].forEach((v, k) => { r[b + 126 + k] = v; }); // amp, amp EG
  r[b + 149] = 64; r[b + 153] = 40;
  return r;
}

function build() {
  const b64 = u => Buffer.from(u).toString('base64'), cat = recs => Buffer.concat(recs.map(x => Buffer.from(x)));
  const moss = [], tri = [];
  for (const S of SETS) {
    const T = { name: S.name, pcm: [], combis: [], scale: S.scale }; if (S.s) T.s = 1;
    for (const L of S.pcm) {
      const R = rng(S.name + ' PCM ' + L), recs = [];
      for (let i = 0; i < 128; i++) {
        const drum = S.drums && i >= 120 && i < 124, ram = !drum && (i === 60 || i === 61);
        const ms = [R.int(0, 374), R.int(0, 374)], mode = drum ? 2 : i < 2 ? 0 : R.pick([0, 0, 1]);
        if (i === 0) ms[0] = ms[1] = R.pick([94, 149, 152, 215]); // flute, strings, violin, bouzouki
        if (i === 1) ms[0] = ms[1] = 0; // A.Piano
        const name = drum ? 'Test Drum Kit ' + (i - 119) : i === 1 ? 'Test Piano' : ram ? 'Test RAM Zurna' : 'Test PCM ' + L + String(i).padStart(3, '0');
        const r = pcmRec(name, R, { mode, ms, plain: i < 2 });
        if (ram) { r[31] = r[33] = 0x10; r[32] = r[34] = i; } // RAM/Flash sample 0x1000 | n: not in the file, plays the fallback
        recs.push(r);
      }
      T.pcm.push({ bank: L, m: b64(cat(recs)) });
    }
    for (const L of S.combis) {
      const R = rng(S.name + ' combi ' + L), recs = [];
      for (let i = 0; i < 128; i++) recs.push(combiRec('Test Combi ' + L + String(i).padStart(3, '0'), R, S.pcm, S.moss, i === 0));
      T.combis.push({ bank: L, m: b64(cat(recs)) });
    }
    tri.push(T);
    if (S.moss) {
      const R = rng(S.name + ' M'), recs = [];
      for (let i = 0; i < 128; i++) recs.push(mossRec('T ' + MOSS_MODELS[i % 13] + ' ' + String(i).padStart(3, '0'), i % 13, R));
      moss.push({ name: S.name, scale: S.scale, m: b64(cat(recs)) });
    }
  }
  const scales = Array.from({ length: 16 }, (_, k) => k === 0 ? [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, -50, 0] : new Array(12).fill(0));
  const user = { name: 'TESTDISK', scales, ms: { u_testzurna112: { name: 'TEST ZURNA 112', ram: 112 }, u_testsaz043: { name: 'TEST SAZ 043', ram: 43 } },
    progs: [{ n: 'Test Zurna', at: 'A000', m: b64(tritonRec('Test Zurna', 112)) }], plain: ['u_testsaz043'] };
  return { moss, tri, user };
}

const HEAD = '// Made-up test banks (test/fixtures.js); not anybody\'s own files.\n';
function write(dir) {
  const d = build();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pcgdata.js'), HEAD + 'const MOSS_PCG_BUILTIN = ' + JSON.stringify(d.moss) + ";\nif (typeof module !== 'undefined') module.exports = { MOSS_PCG_BUILTIN };\n");
  fs.writeFileSync(path.join(dir, 'tridata.js'), HEAD + 'const TRI_BUILTIN = ' + JSON.stringify(d.tri) + ";\nif (typeof module !== 'undefined') module.exports = { TRI_BUILTIN };\n");
  fs.writeFileSync(path.join(dir, 'userdata.js'), HEAD + 'const USER_TRITON = ' + JSON.stringify(d.user) + ";\nif (typeof module !== 'undefined') module.exports = { USER_TRITON };\n");
  return dir;
}
// writes the banks when they are missing or older than this file; returns their folder
function ensure(dir) {
  dir = dir || OUT;
  const me = fs.statSync(__filename).mtimeMs, files = ['pcgdata.js', 'tridata.js', 'userdata.js'].map(f => path.join(dir, f));
  if (files.some(f => !fs.existsSync(f) || fs.statSync(f).mtimeMs < me)) write(dir);
  return dir;
}
module.exports = { ensure, build, SETS };
if (require.main === module) console.log('test banks written to', path.relative(process.cwd(), write(process.argv[2] || OUT)) || '.', '(' + SETS.map(s => s.name).join(', ') + ')');
