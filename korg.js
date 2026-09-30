// ===== Korg Trinity PCG reader + MOSS-TRI (Bank M) program decoder =====
// Record layout: "Trinity V3 MIDI Implementation" rev 1.0 (Dec 14 1998), section 2
// ("MOSS Program Parameter Structure", 521 bytes). File layout (header, directory of
// sections) was worked out from real Trinity PCG files and checks out byte-exactly.

const KORG = {
  SRC: ['off', 'eg1', 'eg2', 'eg3', 'eg4', 'ampeg', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'porta', 'velS', 'vel', 'velH', 'key', 'keyExp',
    'splitH', 'splitL', 'at', 'jsx', 'jsy', 'jsyn', 'atjs', 'ribbon', 'ribP', 'ribN', 'ribZ', 'foot', 'slider', 'cc19', 'sw1', 'sw2', 'fsw', 'cc83'],
  EGSEL: ['eg1', 'eg1', 'eg2', 'eg3', 'eg4', 'amp'], // 1..5 per the table; 0 (seen in untouched Init programs) behaves as EG1
  OSC: ['standard', 'comb', 'vpm', 'reso', 'ring', 'cross', 'sync', 'organ', 'epiano', 'brass', 'reed', 'pluck', 'bowed'],
  OSC_NAME: ['Standard', 'Comb Filter', 'VPM', 'Resonance', 'Ring Mod', 'Cross Mod', 'Sync Mod', 'Organ Model', 'E.Piano Model', 'Brass Model', 'Reed Model', 'Plucked String', 'Bowed String'],
  LFOW: ['tri0', 'tri90', 'trirnd', 'sine', 'sawup0', 'sawup180', 'sawdn0', 'sawdn180', 'square', 'rndsh', 'rndvec', 'stri4', 'stri6', 'ssaw4', 'ssaw6', 'exptri', 'expsawup', 'expsawdn'],
  WAVE4: ['saw', 'square', 'tri', 'sine'],
  INSEL: ['osc', 'sub', 'noise', 'f1', 'f2'],
  COMBIN: ['osc', 'sub', 'f1', 'f2', 'pulse', 'impulse'],
  VPMMOD: ['saw', 'square', 'tri', 'sine', 'osc', 'sub', 'f1', 'f2'],
  FTYPE: ['lpf', 'lpf', 'hpf', 'bpf', 'brf', 'dbpf'],
  ROUTING: ['serial1', 'serial2', 'parallel'],
  NOISE: ['thru', 'lpf', 'hpf', 'bpf'],
  // Trinity program scale list (Parameter Guide 1-1e); 9 = Octave User Scale from Global mode
  SCALE: ['equal', 'pureMaj', 'pureMin', 'arabic', 'pyth', 'werck', 'kirn', 'slendro', 'pelog', 'user', 'stretch'],
  // Triton/EXB-MOSS numbering of the same list: Korg inserted Triton-only controllers, so entries shift.
  // Pinned by comparing Trinity and Triton copies of the same factory programs; entries marked ~ are inferred
  // (they are controllers that rest at zero, so they cannot change how a program sounds untouched).
  SRC_TRITON: ['off', 'eg1', 'eg2', 'eg3', 'eg4', 'ampeg', 'lfo1', 'lfo2', 'lfo3', 'lfo4', 'porta', 'key', 'keyExp', 'splitH', 'splitL',
    'velS', 'vel', 'velH', 'at', 'jsx', 'jsy', 'jsyn', 'atjs', /*~JS+Y&AT/2*/ 'atjs', /*~JS-Y&AT/2*/ 'jsyn', 'ribbon', /*~*/ 'ribP', /*~*/ 'ribN',
    /*~knobs 1-4 (CC17, 19, 20, 21)*/ 'kn1', 'cc19', 'kn3', 'kn4', /*~unknown*/ 'off', 'off', 'off', /*~foot pedal*/ 'foot', /*~*/ 'slider', /*~*/ 'cc19', 'sw1', 'sw2', /*~*/ 'fsw', /*~*/ 'cc83'],
  NOT_BUILT: [], // every MOSS oscillator model is now built
  DOUBLE: ['brass', 'reed', 'pluck', 'bowed'],
  REC: 521
};

function korgS8(v) { return v > 127 ? v - 256 : v; }
function korgName(bytes) {
  let s = '';
  for (let i = 0; i < 16; i++) { const c = bytes[i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' '; }
  return s.replace(/\s+$/, '');
}

// ---- PCG container ----
function korgParsePCG(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const out = { ok: false, error: '', sections: [], bankM: [], bankS: 0, pcmPrograms: 0, combis: 0, drumKits: 0, userScale: null, hasGlobal: false };
  if (b.length < 0x50 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'KORG') { out.error = 'This is not a Korg PCG file.'; return out; }
  if (b[4] !== 0x3B) { const t = korgParseTritonPCG(b); if (t.ok || t.error !== 'This Korg file has no program data.') return t; out.error = 'This PCG comes from a Korg model this synth does not read yet (ID 0x' + b[4].toString(16) + ').'; return out; }
  let off = 0x50;
  for (let i = 0; i < 6; i++) {
    const d = 0x20 + i * 8;
    const type = (b[d] << 8) | b[d + 1], count = (b[d + 2] << 8) | b[d + 3];
    const size = ((b[d + 4] << 24) >>> 0) + (b[d + 5] << 16) + (b[d + 6] << 8) + b[d + 7];
    if (type === 0xffff) continue;
    if (off + size > b.length) { out.error = 'The file is shorter than its own directory says; it may be damaged.'; return out; }
    out.sections.push({ type, count, size, off });
    if (type === 5 || type === 1) {
      const n = Math.floor((size - 2) / KORG.REC);
      const recs = [];
      for (let k = 0; k < n; k++) recs.push(b.slice(off + 2 + k * KORG.REC, off + 2 + (k + 1) * KORG.REC));
      if (type === 5) out.bankM = recs; else out.bankS = n;
    } else if (type === 0) out.pcmPrograms = count * 128;
    else if (type === 2) out.combis = count * 128;
    else if (type === 3) out.drumKits = count;
    else if (type === 4) {
      out.hasGlobal = true;
      // Global P3 "Octave User Scale": 12 signed cents values, C..B, at bytes 8-19 of the Global block
      out.userScale = Array.from(b.slice(off + 8, off + 20)).map(korgS8).map(v => Math.max(-99, Math.min(99, v)));
    }
    off += size;
  }
  if (off !== b.length) { out.error = 'The file length does not match its directory; it may be damaged.'; return out; }
  out.ok = true;
  return out;
}

// ---- Triton-family PCG (Triton, Triton Extreme/Studio/Rack, Karma) ----
// A 604-byte EXB-MOSS record = name (16) + 195 bytes of Triton program data (effects etc.) + Trinity MOSS bytes 16-408.
// It becomes a 716-byte record: the 521-byte Trinity layout followed by those 195 bytes.
function korgTritonToTrinity(rec) {
  const t = new Uint8Array(KORG.REC + 195);
  t.set(rec.subarray(0, 16), 0); t.set(rec.subarray(211, 604), 16); t[409] = 120;
  t.set(rec.subarray(16, 211), KORG.REC); // the Triton program's effect section, kept after the Trinity-layout record
  return t;
}
function korgParseTritonPCG(b) {
  const out = { ok: false, error: '', fmt: 'triton', bankM: [], bankS: 0, pcmPrograms: 0, combis: 0, drumKits: 0, userScale: new Array(12).fill(0) };
  const rd = o => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const tag = o => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  let p = -1; for (let i = 4; i < Math.min(64, b.length - 8); i++) if (tag(i) === 'PCG1') { p = i; break; }
  if (p < 0) { out.error = 'This Korg file has no program data.'; return out; }
  const end = Math.min(b.length, p + 8 + rd(p + 4));
  for (let o = p + 8; o + 8 <= end;) {
    const t = tag(o), sz = rd(o + 4), d = o + 8;
    if (t === 'PRG1' || t === 'CMB1' || t === 'DKT1') {
      for (let q = d; q + 8 <= d + sz;) {
        const t2 = tag(q), s2 = rd(q + 4), n = rd(q + 8), rs = rd(q + 12);
        if (t2 === 'MBK1' && rs >= 604) for (let i = 0; i < n; i++) out.bankM.push(korgTritonToTrinity(b.subarray(q + 20 + i * rs, q + 20 + i * rs + 604)));
        else if (t2 === 'PBK1') out.pcmPrograms += n;
        else if (t2 === 'CBK1') out.combis += n;
        else if (t2 === 'DBK1') out.drumKits += n;
        q += 8 + s2;
      }
    }
    o += 8 + sz;
  }
  out.ok = true;
  return out;
}

// ---- one Bank M program ----
function korgDecodeMoss(r, userScale, fmt) {
  const notes = [], TRI = fmt === 'triton', SRCS = TRI ? KORG.SRC_TRITON : KORG.SRC;
  const u = k => r[k], s = k => korgS8(r[k]);
  const lim = (v, a, b2, what) => { if (v < a || v > b2) { notes.push(what + ' had an out-of-range value (' + v + ') and was reset'); return v < a ? a : b2; } return v; };
  const src = k => { const v = r[k]; if (v >= SRCS.length) { notes.push('A modulation source had an invalid value (' + v + ') and was switched off'); return 'off'; } return SRCS[v]; };
  const P = mossDefaultPatch();
  P.name = korgName(r) || 'Untitled';
  P.mods = [];
  const route = (srcKey, dst, amt, via) => { if (srcKey !== 'off' && amt) P.mods.push({ src: srcKey, via: via || 'off', dst, amt }); };

  // Program common
  const b17 = u(17);
  P.voice.hold = (b17 >> 3) & 1;
  P.voice.priority = ['last', 'low', 'high'][(b17 >> 4) & 3] || 'last';
  P.voice.mode = ['monoMulti', 'monoSingle', 'poly'][b17 >> 6] || 'poly';
  P.voice.random = lim(u(20), 0, 99, 'Random pitch');
  P.voice.unison = [1, 2, 3, 6][u(23) & 3];
  P.voice.uniDetune = lim(u(24), 0, 99, 'Unison detune');
  P.voice.maxVoices = 6;
  const scType = u(19) >> 4, scKey = u(19) & 15;
  // Triton numbering: 9 Stretch, 10 User All Notes, 11-26 User Octave 00-15 (Triton user scales are not read)
  const scName = TRI ? (scType <= 8 ? KORG.SCALE[scType] : scType === 9 ? 'stretch' : 'equal') : (KORG.SCALE[scType] || 'equal');
  P.scale = { type: scName, key: scKey % 12, user: (userScale || new Array(12).fill(0)).slice() };
  if (TRI && scType >= 10) notes.push('This program used a Triton user scale, which is not stored in the file; equal temperament used');
  else if (!TRI && scType > 10) notes.push('Unknown scale type ' + scType + '; equal temperament used');

  // EG 1-4
  for (let i = 0; i < 4; i++) {
    const b = 25 + i * 19;
    P.eg[i] = { startL: s(b), atkT: u(b + 1), atkL: s(b + 2), decT: u(b + 3), brkL: s(b + 4), slpT: u(b + 5), susL: s(b + 6), relT: u(b + 7), relL: s(b + 8),
      lvlSrc: src(b + 9), lvlInt: s(b + 10), vel: s(b + 11), velTime: 0, tSrc: src(b + 12), tInt: s(b + 13), nSrc: src(b + 14), nAt: s(b + 15), nDc: s(b + 16), nSl: s(b + 17), nRl: s(b + 18) };
  }
  // LFO 1-4
  for (let i = 0; i < 4; i++) {
    const b = 101 + i * 11, w = u(b) & 31, m = u(b + 10);
    P.lfo[i] = { wave: KORG.LFOW[lim(w, 0, 17, 'LFO ' + (i + 1) + ' waveform')], sync: ['off', 'timbre', 'voice', 'voice'][u(b) >> 6], freq: lim(u(b + 1), 0, 199, 'LFO frequency'),
      fm1: src(b + 2), fm1Int: s(b + 3), fm2: src(b + 4), fm2Int: s(b + 5), fade: lim(u(b + 6), 0, 99, 'LFO fade'), am: src(b + 7), amInt: s(b + 8), offset: lim(s(b + 9), -50, 50, 'LFO offset'),
      msync: (m >> 7) & 1, mbase: (m >> 4) & 7, mtimes: m & 15 };
  }
  // OSC common
  P.voice.bendUp = lim(s(145), -60, 24, 'Pitch bend +'); P.voice.bendDown = lim(s(146), -60, 24, 'Pitch bend -');
  P.voice.bendStepUp = KORG_PCM.stepSemis(u(147) & 15); P.voice.bendStepDown = KORG_PCM.stepSemis(u(147) >> 4); // bend Step (+X / -X)
  route(src(148), 'pitch', s(149));
  P.voice.porta = u(150) & 1; P.voice.portaFingered = (u(150) >> 1) & 1; P.voice.portaTime = lim(u(151), 0, 99, 'Portamento time');
  route(src(152), 'portaTime', s(153));
  P.voice.tempo = TRI ? 120 : lim(u(409), 40, 240, 'Tempo');

  // OSC 1 and 2
  const pitchBlock = (b, target, dst) => {
    target.octave = lim(u(b), 0, 3, 'Octave') - 2; target.transpose = lim(s(b + 1), -12, 12, 'Transpose'); target.tune = lim(s(b + 2), -50, 50, 'Tune');
    target.foffset = lim(s(b + 3), -100, 100, 'Frequency offset') / 10;
    target.slopeCenter = u(b + 4) & 127; target.slopeLow = lim(s(b + 5), -50, 100, 'Pitch slope') / 50; target.slopeHigh = lim(s(b + 6), -50, 100, 'Pitch slope') / 50;
    const m1 = src(b + 7), i1 = s(b + 8), c1 = src(b + 9), ci = s(b + 10), m2 = src(b + 11), i2 = s(b + 12);
    route(m1, dst, i1);
    if (c1 !== 'off' && ci) route(m1, dst, ci, c1); // "Mod1 Int. Controller": the controller adds to Mod1's intensity
    route(m2, dst, i2);
  };
  const osc1Type = KORG.OSC[lim(u(154), 0, 12, 'OSC 1 type')];
  const dbl = KORG.DOUBLE.includes(osc1Type);
  for (let i = 0; i < 2; i++) {
    const base = i === 0 ? 154 : 206, O = P.osc[i], p = O.p, sb = base + 14;
    const M = k => 'o' + (i + 1) + (k === 0 ? 'A' : k === 1 ? 'B' : 'm' + k);
    O.type = i === 0 ? osc1Type : KORG.OSC[lim(u(206), 0, 8, 'OSC 2 type')];
    if (i === 1 && dbl) { O.type = 'standard'; continue; }
    pitchBlock(base + 1, O, i === 0 ? 'pitch1' : 'pitch2');
    const t = O.type;
    if (t === 'standard') {
      p.wave = u(sb) ? 'pulse' : 'saw'; p.edge = u(sb + 1); p.level = u(sb + 2); p.tri = u(sb + 3); p.sine = u(sb + 4); p.phase = s(sb + 5);
      p.wform = s(sb + 6); p.wfLfo = 'lfo' + lim(u(sb + 7) - 5, 1, 4, 'Waveform LFO'); p.wfInt = s(sb + 8); route(src(sb + 9), M(0), s(sb + 10));
      p.shIn = u(sb + 11); route(src(sb + 12), M(1), s(sb + 13)); p.shOffset = s(sb + 14); p.shType = u(sb + 15) ? 'reso' : 'clip';
      p.shShape = u(sb + 16); route(src(sb + 17), M(2), s(sb + 18)); p.shBal = u(sb + 19); route(src(sb + 20), M(3), s(sb + 21));
    } else if (t === 'comb') {
      p.cIn = KORG.COMBIN[lim(u(sb), 0, 5, 'Comb input')]; p.cLevel = u(sb + 1); p.cNoise = u(sb + 2); p.cPw = u(sb + 3); route(src(sb + 4), M(2), s(sb + 5));
      p.cFb = u(sb + 6); route(src(sb + 7), M(0), s(sb + 8)); route(src(sb + 9), M(0), s(sb + 10));
      p.cDamp = u(sb + 11); route(src(sb + 12), M(1), s(sb + 13));
    } else if (t === 'vpm') {
      p.vCar = KORG.WAVE4[lim(u(sb), 0, 3, 'VPM carrier')]; p.vCarLvl = u(sb + 1); route(src(sb + 2), M(2), s(sb + 3)); route(src(sb + 4), M(2), s(sb + 5));
      p.vShape = u(sb + 6); route(src(sb + 7), M(1), s(sb + 8)); route(src(sb + 9), M(1), s(sb + 10)); p.vType = (u(sb + 11) & 1) + 1; p.vFb = u(sb + 12);
      p.vRatio = lim(u(sb + 13), 0, 16, 'VPM ratio'); p.vFine = s(sb + 14); route(src(sb + 15), M(3), s(sb + 16)); route(src(sb + 17), M(3), s(sb + 18));
      p.vMod = KORG.VPMMOD[lim(u(sb + 19), 0, 7, 'VPM modulator')]; p.vModLvl = u(sb + 20); route(src(sb + 21), M(0), s(sb + 22)); route(src(sb + 23), M(0), s(sb + 24));
    } else if (t === 'reso') {
      p.rIn = KORG.INSEL[lim(u(sb), 0, 4, 'Resonance input')]; p.rLevel = u(sb + 1); route(src(sb + 2), M(2), s(sb + 3)); route(src(sb + 4), M(2), s(sb + 5));
      for (let k = 0; k < 4; k++) {
        const o = sb + 6 + k * 6;
        p['r' + k + 'Reso'] = u(o); p['r' + k + 'Harm'] = (u(o + 1) & 15) + 1; route(src(o + 2), M(3 + k), s(o + 3)); p['r' + k + 'Fine'] = s(o + 4); p['r' + k + 'Lvl'] = u(o + 5);
      }
      route(src(sb + 30), M(1), s(sb + 31));
    } else if (t === 'ring' || t === 'cross' || t === 'sync') {
      p.mIn = KORG.INSEL[lim(u(sb), 0, 4, 'Modulation input')]; p.mCar = KORG.WAVE4[lim(u(sb + 1), 0, 3, 'Carrier wave')];
      if (t === 'sync') p.mEdge = u(sb + 2);
      else {
        p.mDepth = u(sb + 2); route(src(sb + 3), M(0), s(sb + 4)); route(src(sb + 5), M(0), s(sb + 6));
        if (t === 'ring') { p.mType = (u(sb + 7) & 1) + 1; p.mEdge = u(sb + 8); } else p.mEdge = u(sb + 7);
      }
    } else if (t === 'bowed') {
      p.bwSpdEg = KORG.EGSEL[lim(u(sb), 0, 5, 'Bow speed EG')]; p.bwSpdInt = s(sb + 1); route(src(sb + 2), M(0), s(sb + 3)); route(src(sb + 4), M(0), s(sb + 5));
      p.bwDiff = u(sb + 6) & 1; p.bwPrsEg = KORG.EGSEL[lim(u(sb + 7), 0, 5, 'Bow pressure EG')]; p.bwPrsInt = s(sb + 8); route(src(sb + 9), M(1), s(sb + 10));
      p.bwRosin = u(sb + 11); p.bwPos = u(sb + 12); route(src(sb + 13), M(2), s(sb + 14));
      p.bwDamp = u(sb + 15); p.bwDampKey = u(sb + 16) & 127; p.bwDampLo = s(sb + 17); p.bwDampHi = s(sb + 18); route(src(sb + 19), M(3), s(sb + 20));
      p.bwDisp = u(sb + 21); route(src(sb + 22), M(4), s(sb + 23)); p.bwRefl = u(sb + 24); route(src(sb + 25), M(5), s(sb + 26));
      p.bwEqF = u(sb + 27); p.bwEqQ = u(sb + 28); p.bwEqG = s(sb + 29);
    } else if (t === 'reed') {
      p.rdType = lim(u(sb), 0, 16, 'Reed instrument type'); p.rdJump = u(sb + 1) & 3;
      p.rdPrsEg = KORG.EGSEL[lim(u(sb + 2), 0, 5, 'Reed pressure EG')]; p.rdPrsInt = s(sb + 3); route(src(sb + 4), M(0), s(sb + 5)); route(src(sb + 6), M(0), s(sb + 7));
      p.rdNoise = u(sb + 13); route(src(sb + 26), M(1), s(sb + 27)); p.rdHpf = u(sb + 28); p.rdHpfReso = u(sb + 29);
      p.rdEqF = u(sb + 30); p.rdEqQ = u(sb + 31); p.rdEqG = s(sb + 32);
      p.rdWsOff = s(sb + 34); p.rdWsTable = (u(sb + 35) >> 7) ? 'reso' : 'clip'; p.rdWsShape = u(sb + 35) & 127; route(src(sb + 36), M(2), s(sb + 37));
    } else if (t === 'pluck') {
      p.plAtk = u(sb); p.plAtkVel = s(sb + 1); p.plUp = u(sb + 2); p.plUpVel = s(sb + 3); p.plDn = u(sb + 4); p.plDnVel = s(sb + 5); p.plNoise = u(sb + 6); p.plNoiseVel = s(sb + 7);
      p.plPos = u(sb + 8); route(src(sb + 9), M(0), s(sb + 10)); p.plDisp = u(sb + 11); route(src(sb + 12), M(1), s(sb + 13));
      p.plDamp = u(sb + 14); p.plDampKt = s(sb + 15); route(src(sb + 16), M(2), s(sb + 17)); p.plDecay = u(sb + 18); p.plDecayKt = s(sb + 19); p.plRel = u(sb + 20);
      p.plHarm = u(sb + 21); route(src(sb + 22), M(3), s(sb + 23)); p.plPickup = u(sb + 24) & 1; p.plPickPos = u(sb + 25); route(src(sb + 26), M(4), s(sb + 27));
      p.plEqF = u(sb + 28); p.plEqG = s(sb + 29); p.plBoost = u(sb + 30);
    } else if (t === 'organ') {
      // The MIDI implementation lists a header row at 0, but the data starts at 0: 7 bytes per drawbar, then percussion
      for (let k = 0; k < 3; k++) {
        const o = sb + k * 7;
        p['og' + k + 'Wave'] = lim(u(o), 0, 3, 'Drawbar wave'); p['og' + k + 'Harm'] = (u(o + 1) & 15) + 1; p['og' + k + 'Fine'] = lim(s(o + 2), -99, 99, 'Drawbar fine');
        p['og' + k + 'Lvl'] = lim(u(o + 3), 0, 99, 'Drawbar level'); route(src(o + 4), M(k), s(o + 5)); p['og' + k + 'Perc'] = lim(u(o + 6), 0, 99, 'Percussion level');
      }
      p.ogTrig = u(sb + 21) & 1; p.ogDecay = lim(u(sb + 22), 0, 99, 'Percussion decay'); route(src(sb + 23), M(3), s(sb + 24));
    } else if (t === 'epiano') {
      p.epForce = lim(u(sb), 0, 99, 'Hammer force'); p.epCurve = s(sb + 1) < 0 ? -1 : lim(s(sb + 1), 0, 99, 'Force velocity curve');
      p.epWidth = lim(u(sb + 2), 0, 99, 'Hammer width'); p.epClick = lim(u(sb + 3), 0, 99, 'Click level');
      p.epDecay = lim(u(sb + 4), 0, 99, 'Decay'); p.epRel = lim(u(sb + 5), 0, 99, 'Release');
      p.epOtL = lim(u(sb + 6), 0, 99, 'Overtone level'); p.epOtF = lim(u(sb + 7), 0, 99, 'Overtone frequency'); p.epOtD = lim(u(sb + 8), 0, 99, 'Overtone decay');
      p.epPos = lim(u(sb + 9), 0, 99, 'Pickup position'); route(src(sb + 10), M(0), s(sb + 11));
      p.epEqF = lim(u(sb + 12), 0, 49, 'Low EQ frequency'); p.epEqG = lim(s(sb + 13), -18, 18, 'Low EQ gain');
    } else if (t === 'brass') {
      p.brType = lim(u(sb), 0, 5, 'Brass instrument type'); p.brJump = u(sb + 1) & 3;
      p.brPrsEg = KORG.EGSEL[lim(u(sb + 2), 0, 5, 'Brass pressure EG')]; p.brPrsInt = s(sb + 3); route(src(sb + 4), M(0), s(sb + 5)); route(src(sb + 6), M(0), s(sb + 7));
      p.brLip = lim(u(sb + 9), 0, 99, 'Lip character'); route(src(sb + 10), M(1), s(sb + 11));
      p.brBell = lim(u(sb + 15), 0, 99, 'Bell tone'); p.brBellRes = lim(u(sb + 16), 0, 99, 'Bell resonance'); p.brNoise = lim(u(sb + 17), 0, 99, 'Breath noise');
      p.brEqF = lim(u(sb + 28), 0, 49, 'Brass EQ frequency'); p.brEqQ = lim(u(sb + 29), 0, 29, 'Brass EQ Q'); p.brEqG = lim(s(sb + 30), -18, 18, 'Brass EQ gain'); p.brStr = lim(u(sb + 31), 0, 99, 'Strength');
    }
    p.korg = Array.from(r.slice(sb, sb + 38)); // raw oscillator block, as stored
  }

  // Sub oscillator
  const S = P.sub;
  S.octave = lim(u(258), 0, 3, 'Sub octave') - 2; S.transpose = lim(s(259), -12, 12, 'Sub transpose'); S.tune = lim(s(260), -50, 50, 'Sub tune'); S.foffset = s(261) / 10;
  S.slopeCenter = u(262) & 127; S.slopeLow = s(263) / 50; S.slopeHigh = s(264) / 50;
  route(src(265), 'pitchSub', s(266)); if (src(267) !== 'off' && s(268)) route(src(265), 'pitchSub', s(268), src(267)); route(src(269), 'pitchSub', s(270));
  S.wave = KORG.WAVE4[lim(u(271), 0, 3, 'Sub wave')];
  // Noise
  P.noise = { ftype: KORG.NOISE[lim(u(272), 0, 3, 'Noise filter type')], trim: u(273), freq: u(274), reso: u(279) };
  route(src(275), 'noiseFreq', s(276)); route(src(277), 'noiseFreq', s(278));
  // Mixer: OSC1 out1/out2, OSC2 out1/out2, Sub, Noise, Feedback (level, source, intensity each)
  const MX = [['osc1', 280, 'o1'], ['osc2', 286, 'o2'], ['sub', 292, 'sub'], ['noise', 298, 'noise'], ['fb', 304, 'fb']];
  for (const [k, b, d] of MX) {
    P.mix[0][k] = lim(u(b), 0, 99, 'Mixer level'); P.mix[1][k] = lim(u(b + 3), 0, 99, 'Mixer level');
    route(src(b + 1), 'm1' + d, s(b + 2)); route(src(b + 4), 'm2' + d, s(b + 5));
  }
  if (dbl) { P.mix[0].osc2 = 0; P.mix[1].osc2 = 0; }
  // Filters
  P.filt.routing = KORG.ROUTING[lim(u(311) & 3, 0, 2, 'Filter routing')]; P.filt.link = (u(311) >> 2) & 1;
  for (let f = 0; f < 2; f++) {
    const b = 312 + f * 27, F = P.f[f], tag = 'f' + (f + 1);
    F.type = KORG.FTYPE[lim(u(b), 1, 5, 'Filter ' + (f + 1) + ' type')];
    F.trimA = u(b + 1); F.freqA = u(b + 2); F.keyLow = u(b + 3) & 127; F.keyHigh = u(b + 4) & 127; F.rampLow = s(b + 5); F.rampHigh = s(b + 6);
    F.eg = KORG.EGSEL[lim(u(b + 7), 0, 5, 'Filter EG')]; F.egInt = s(b + 8);
    const s1 = src(b + 9), s2 = src(b + 11), sr = src(b + 14);
    route(s1, tag + 'Freq', s(b + 10)); route(s2, tag + 'Freq', s(b + 12));
    F.resoA = u(b + 13); route(sr, tag + 'Reso', s(b + 15));
    F.trimB = u(b + 16); F.freqB = u(b + 17); F.keyLowB = u(b + 18) & 127; F.keyHighB = u(b + 19) & 127; F.rampLowB = s(b + 20); F.rampHighB = s(b + 21);
    F.egIntB = s(b + 22); F.resoB = u(b + 25);
    if (F.type === 'dbpf') { route(s1, tag + 'FreqB', s(b + 23)); route(s2, tag + 'FreqB', s(b + 24)); route(sr, tag + 'ResoB', s(b + 26)); }
  }
  // Amps
  for (let a = 0; a < 2; a++) {
    const b = 366 + a * 9, A = P.amp[a];
    A.level = lim(u(b), 0, 99, 'Amp level'); A.keyLow = u(b + 1) & 127; A.keyHigh = u(b + 2) & 127; A.rampLow = s(b + 3); A.rampHigh = s(b + 4);
    A.eg = KORG.EGSEL[lim(u(b + 5), 0, 5, 'Amp EG select')];
    route(src(b + 7), 'amp' + (a + 1), s(b + 8));
  }
  // Amp EG
  P.ampEG = { atkT: u(385), atkL: u(386), decT: u(387), brkL: u(388), slpT: u(389), susL: u(390), relT: u(391),
    lvlSrc: src(393), lvlInt: s(394), vel: s(395), velTime: 0, tSrc: src(396), tInt: s(397), nSrc: src(398), nAt: s(399), nDc: s(400), nSl: s(401), nRl: s(402) };
  // Output
  const pan = s(403);
  // trim: the Trinity's output stage is quieter than this engine's; one fixed trim keeps every imported
  // program at the starter programs' loudness while preserving the balance between your programs
  P.out = { level: lim(u(406), 0, 127, 'Output level'), pan: pan < 0 ? -1 : pan, trim: 0.42 };
  route(src(404), 'pan', s(405));
  if (pan < 0) notes.push('Pan was OFF; it plays centred here');
  // Effects: bytes 403-520 of the record, decoded through the Trinity effect catalog (TFX)
  P.fx = TRI ? korgDecodeTritonFx(r.length >= KORG.REC + 195 ? r.subarray(KORG.REC, KORG.REC + 195) : null, notes) : korgDecodeTrinityFx(r, notes);
  while (P.mods.length < 12) P.mods.push({ src: 'off', via: 'off', dst: 'off', amt: 0 });
  P.korgInfo = { osc1: osc1Type, osc2: dbl ? null : P.osc[1].type, scale: P.scale.type, notes };
  return P;
}

// ---- effect section of a Trinity program ----
// Insert effects 1-3 (16 parameter bytes, type/switch, size), IFX pan/width/sends, Master Effect 1 (modulation) with
// cascade, Master Effect 2 (reverb/delay), returns, master EQ gains in 0.5 dB steps.
function korgDecodeTrinityFx(r, notes) {
  const fx = TFX.rack(), S = korgS8, SZ = [0, 1, 2, 4];
  fx.ins = [];
  for (let k = 0; k < 3; k++) {
    const b = 415 + k * 22, t = r[b + 16] & 63, on = (r[b + 16] >> 6) & 1, sz = SZ[r[b + 17] & 3];
    if (!sz) continue;
    const id = 'S' + sz + ':' + t, e = TFX.byId(id);
    if (!e) { notes.push('Insert effect ' + (k + 1) + ' has an unknown type (size ' + sz + ', number ' + t + ') and was left out'); continue; }
    fx.ins.push({ on, type: id, p: TFX.decode(id, r.subarray(b, b + 16)).p });
  }
  const pan = S(r[477]);
  fx.ifxPan = pan < 0 ? -1 : Math.min(127, pan); fx.ifxWidth = Math.min(127, r[478]); fx.ifxSend1 = Math.min(127, r[479]); fx.ifxSend2 = Math.min(127, r[480]);
  fx.send1 = Math.min(127, r[407]); fx.send2 = Math.min(127, r[408]);
  const master = (grp, b, tb, pb, rb, name) => {
    const t = r[tb] & 63, id = grp + ':' + t, on = (r[tb] >> 6) & 1;
    if (!TFX.byId(id)) { notes.push(name + ' has an unknown type (' + t + ') and was switched off'); return { on: 0, type: grp === 'MM' ? 'MM:4' : 'MR:5', p: TFX.defaults(grp === 'MM' ? 'MM:4' : 'MR:5'), ret: r[rb] & 127, pan: 50 }; }
    const pn = S(r[pb]);
    return { on, type: id, p: TFX.decode(id, r.subarray(b, b + 16)).p, ret: Math.min(127, r[rb]), pan: pn < 0 ? -1 : Math.min(100, pn) };
  };
  fx.m1 = master('MM', 481, 497, 498, 499, 'Master Effect 1'); fx.m1.cascade = (r[497] >> 7) & 1;
  fx.m2 = master('MR', 500, 516, 517, 518, 'Master Effect 2');
  fx.eqLo = Math.max(-36, Math.min(36, S(r[519]))) / 2; fx.eqHi = Math.max(-36, Math.min(36, S(r[520]))) / 2;
  return fx;
}

// ---- effects of a Triton-family program (the Korg factory EXB-MOSS bank) ----
// The Triton's effects extend the Trinity's. Byte layouts per effect come from the open-source Triton PCG converter
// (github.com/justedni/triton_pcg_to_vst); each is mapped onto the matching Trinity algorithm here.
// [name, insert type, type when used as MFX1/2 (null: the insert type runs as a master), MFX2 type if different, spec]
const KORG_TRITON_FX = {
    1: ['St. Amp Simulation', 'S2:0', null, null, 'amp@0@0@2@0@2 wet@1@0@64@0@100 wsrc@2@0@1F@0@31 wamt@3@9C@64@-100@100'],
    2: ['Stereo Compressor', 'S2:1', null, null, 'sens@1@1@64@1@100 atk@2@1@64@1@100 trim@3@0@64@0@100 lo@4@E2@1E@-15@15 hi@5@E2@1E@-15@15 outl@6@0@64@0@100 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    3: ['Stereo Limiter', 'S2:2', null, null, 'ratio@1@0@83@0@131 thr@2@D8@0@-40@0 atk@3@1@64@1@100 rel@4@1@64@1@100 gain@5@F0@18@-16@24 wet@11@0@64@0@100 wsrc@12@0@1F@0@31 wamt@13@9C@64@-100@100'],
    5: ['Stereo Gate', 'S2:4', null, null, 'thr@3@0@64@0@100 atk@4@1@64@1@100 rel@5@1@64@1@100 wet@7@0@64@0@100 wsrc@8@0@1F@0@31 wamt@9@9C@64@-100@100'],
    6: ['OD/Hi.Gain Wah', 'S2:5', null, null, 'wah@11:0@0@1@0@1 wahSrc@11:5-1@0@1F@0@31 mode@12:0@0@1@0@1 drive@13@1@64@1@100 lcut@3:4-1@0@A@0@10 outl@2:5-0,3:7@0@64@0@50 direct@12:6-1@0@32@0@50 spk@4:0@0@1@0@1 wet@4:7-1@0@64@0@100 wsrc@8:7-3@0@1F@0@31 wamt@15@9C@64@-100@100'],
    7: ['St. Parametric 4EQ', 'S2:6', null, null, 'trim@3:6-0@0@64@0@100 t1@9:0@0@1@0@1 t4@10:0@0@1@0@1 f1@7:5-0@0@31@20@1000@log q1@0:0,1:7-2@0@5F@0.5@10 g1@0:7-1@DC@24@-18@18 f2@8@0@C7@50@10000@log q2@6:4-0,7:7-6@0@5F@0.5@10 g2@5:3-0,6:7-5@DC@24@-18@18 f3@4:2-0,5:7-4@0@61@300@10000@log q3@9:7-1@0@5F@0.5@10 g3@10:7-1@DC@24@-18@18 f4@11@0@C3@500@20000@log q4@12@0@5F@0.5@10 g4@13@DC@24@-18@18 wet@14@0@64@0@100 wsrc@4:7-3@0@1F@0@31 wamt@15@9C@64@-100@100'],
    8: ['St. Graphic 7EQ', 'S2:7', null, null, 'type@0@0@B@0@11 trim@1@0@64@0@100 b1@2@DC@24@-18@18 b2@3@DC@24@-18@18 b3@4@DC@24@-18@18 b4@5@DC@24@-18@18 b5@6@DC@24@-18@18 b6@7@DC@24@-18@18 b7@8@DC@24@-18@18 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    9: ['St. Wah/Auto Wah', 'S1:7', null, null, 'fbot@1:6-0@0@64@0@100 ftop@0:5-0,1:7@0@64@0@100 auto@0:7-6@0@3@0@3 src@3:4-0@0@1F@0@31 sens@13:7-1@0@64@0@100 eshape@5@9C@64@-100@100 lfoF@6@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 reso@8@0@64@0@100 wet@9@0@64@0@100 wsrc@2:7-3@0@1F@0@31 wamt@10@9C@64@-100@100'],
    10: ['St. Random Filter', 'S2:9', null, null, 'stepF@1@1@C8@0.05@50@log lfoF@3@1@E6@0.02@20@lfo cutoff@0@0@64@0@100 depth@9:7-1@0@64@0@100 reso@6@0@64@0@100 wet@7@9C@64@-100@100 wsrc@10:7-3@0@1F@0@31 wamt@8@9C@64@-100@100'],
    11: ['St. Exciter/Enhncr', 'S2:10', null, null, 'blend@0@9C@64@-100@100 point@2@0@46@0@140 dlyL@4@0@8C@0@50@dms dlyR@5@0@8C@0@50@dms width@9:0,10:7-2@0@64@0@100 trim@8:6-0@0@64@0@100 lo@14:3-0,15:7-5@E2@1E@-15@15 hi@13:2-0,14:7-4@E2@1E@-15@15 wet@12:1-0,13:7-3@0@64@0@100 wsrc@12:6-2@0@1F@0@31 wamt@7@9C@64@-100@100'],
    13: ['Talking Modulator', 'S2:11', null, null, 'sweep@0:0@0@1@0@1 manual@0:7-1@0@64@0@100 src@1:4-0@0@1F@0@31 lfoF@3@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 top@1:7-5@0@4@0@4 center@2:2-0@0@4@0@4 bottom@2:5-3@0@4@0@4 shift@6@9C@64@-100@100 reso@7@0@64@0@100 wet@13:7-1@0@64@0@100 wsrc@8@0@1F@0@31 wamt@9@9C@64@-100@100'],
    14: ['Stereo Decimator', 'S2:12', null, null, 'prelpf@4:0@0@1@0@1 fs@10:0,11@0@1E0@0@48000 hd@4:7-1@0@64@0@100 res@0:2-0,1:7-5@4@18@4@24 wet@10:7-1@0@64@0@100 wsrc@3:4-0@0@1F@0@31 wamt@7@9C@64@-100@100'],
    16: ['St. Chorus', 'S2:13', 'MM:4', null, 'wave@12:0@0@1@0@1 phase@12:6-1@EE@12@-180@180 lfoF@0@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 pdL@2@0@8C@0@50@dms pdR@3@0@8C@0@50@dms depth@4@0@64@0@100 trim@13:7-1@0@64@0@100 lo@10:7-2@E2@1E@-15@15 hi@6@E2@1E@-15@15 wet@7@9C@64@-100@100 wsrc@8@0@1F@0@31 wamt@9@9C@64@-100@100'],
    17: ['St. Harmonic Chorus', 'S2:14', null, null, 'wave@3:0@0@1@0@1 phase@3:5-1@F1@F@-150@150 lfoF@8@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 pd@10@0@8C@0@50@dms depth@1:1-0,2:7-3@0@64@0@100 split@0:0,1:7-2@1@64@1@100 fb@12@9C@64@-100@100 hd@0:7-1@0@64@0@100 lowl@6:3-0,7:7-5@0@64@0@100 highl@5:2-0,6:7-4@0@64@0@100 wet@13:7-1@0@64@0@100 wsrc@5:7-3@0@1F@0@31 wamt@4@9C@64@-100@100'],
    18: ['Multitap Cho/Dly', 'S2:15', null, null, 'lfoF@12:2-0,13:7-5@1@3F@0.02@13@log t1@14:5-0,15:7@0@7F@0@570 d1@10:1-0,11:7-5@0@1E@0@30 l1@8:7-3@0@1E@0@30 p1@3:7-4@FA@6@-6@6 t2@8:2-0,9:7-4@0@7F@0@570 d2@9:3-0,10:7@0@1E@0@30 l2@6:1-0,7:7-5@0@1E@0@30 p2@4:7-4@FA@6@-6@6 t3@13:4-0,14:7-6@0@7F@0@570 d3@10:6-2@0@1E@0@30 l3@7:4-0@0@1E@0@30 p3@4:3-0@FA@6@-6@6 t4@15:6-0@0@7F@0@570 d4@11:4-0@0@1E@0@30 l4@12:7-3@0@1E@0@30 p4@3:3-0@FA@6@-6@6 fb@0@9C@64@-100@100 wet@5:5-0,6:7@0@64@0@100 wamt@2@9C@64@-100@100'],
    19: ['Ensemble', 'S2:16', 'MM:3', null, 'speed@0@1@64@1@100 depth@3@0@64@0@100 shimmer@6@0@64@0@100 wet@7@0@64@0@100 wsrc@8@0@1F@0@31 wamt@9@9C@64@-100@100'],
    20: ['Stereo Flanger', 'S2:17', 'MM:0', null, 'delay@0@0@8C@0@50@dms wave@12:0@0@1@0@1 shape@1@9C@64@-100@100 phase@12:6-1@EE@12@-180@180 lfoF@2@1@E6@0.02@20@lfo bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 depth@5@0@64@0@100 fb@6@9C@64@-100@100 hd@7@0@64@0@100 wet@9@9C@64@-100@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    21: ['St. Random Flanger', 'S2:18', null, null, 'delay@0@0@8C@0@50@dms phase@11:6-1@EE@12@-180@180 lfoF@1@1@E6@0.02@20@lfo stepF@3@1@C8@0.05@50@log depth@5@0@64@0@100 fb@6@9C@64@-100@100 hd@7@0@64@0@100 wet@8@9C@64@-100@100 wsrc@9@0@1F@0@31 wamt@10@9C@64@-100@100'],
    23: ['Stereo Phaser', 'S2:20', 'MM:1', null, 'wave@12:0@0@1@0@1 shape@0@9C@64@-100@100 phase@12:6-1@EE@12@-180@180 lfoF@1@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 manual@4@0@64@0@100 depth@5@0@64@0@100 reso@8@9C@64@-100@100 hd@13:7-1@0@64@0@100 wet@9@9C@64@-100@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    24: ['St. Random Phaser', 'S2:21', null, null, 'phase@11:7-2@EE@12@-180@180 lfoF@1@1@E6@0.02@20@lfo stepF@3@1@C8@0.05@50@log manual@0@0@64@0@100 depth@5@0@64@0@100 reso@6@9C@64@-100@100 hd@7@0@64@0@100 wet@8@9C@64@-100@100 wsrc@9@0@1F@0@31 wamt@10@9C@64@-100@100'],
    25: ['St. Env Phaser', 'S1:20', null, null, 'mbot@0@0@64@0@100 mtop@1@0@64@0@100 decay@7@1@64@1@100 reso@8@9C@64@-100@100 hd@9@0@64@0@100 wet@10@9C@64@-100@100 wsrc@11@0@1F@0@31 wamt@12@9C@64@-100@100'],
    26: ['St.Biphase Mod.', 'S2:23', null, null, 'lfoF@0@1@E6@0.02@20@lfo lfoF2@1@1@E6@0.02@20@lfo depth@3:6-0@0@64@0@100 depth2@4:6-0@0@64@0@100 pdL@2@0@8C@0@50@dms pdR@13@0@8C@0@50@dms fb@5@9C@64@-100@100 hd@6:6-0@0@64@0@100 wet@7@9C@64@-100@100 wsrc@15:4-0@0@1F@0@31 wamt@12@9C@64@-100@100'],
    30: ['Doppler', 'S2:26', null, null, 'lfoF@5@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 pdepth@1:0,2:7-2@0@64@0@100 pandepth@8@9C@64@-100@100 wet@4:7-1@0@64@0@100 wsrc@0:7-3@0@1F@0@31 wamt@10@9C@64@-100@100'],
    34: ['Stereo Auto Pan', 'S2:28', null, null, 'wave@9:0@0@1@0@1 shape@0@9C@64@-100@100 phase@12:6-1@EE@12@-180@180 lfoF@1@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 depth@3@0@64@0@100 wet@6@0@64@0@100 wsrc@7@0@1F@0@31 wamt@8@9C@64@-100@100'],
    35: ['St. Phaser + Trml', 'S2:31', null, null, 'lfoF@2@1@E6@0.02@20@lfo sync@13:0@0@1@0@1 bpm@14@0@FF@0@255 bn@15:2-0@0@7@0@7 bt@15:6-3@0@F@0@15 manual@13:7-1@0@64@0@100 depth@7:5-0@0@3F@0@100 reso@5:3-0,6:7-5@C1@3F@-100@100 pwet@4:2-0,5:7-4@C1@3F@-100@100 tshape@11:6-0@C1@3F@-100@100 tdepth@10:4-0,11:7@0@3F@0@100 wet@8:2-0,9:7-4@0@64@0@100 wsrc@8:7-3@0@1F@0@31 wamt@12@9C@64@-100@100'],
    36: ['St. Ring Modulator', 'S1:23', null, null, 'mode@6:7@0@1@0@1 fixed@7@0@E4@0@12000 noteOfs@1:3-0,2:7-5@D0@30@-48@48 fine@8@9C@64@-100@100 lfoF@9@1@E6@0.02@20@lfo lfoDepth@13:7-1@0@64@0@100 wet@0:7-1@0@64@0@100 wsrc@4:6-2@0@1F@0@31 wamt@12@9C@64@-100@100'],
    37: ['Detune', 'S2:33', null, null, 'cents@0@9C@64@-100@100 delay@3@0@BE@0@1000 fb@4@9C@64@-100@100 hd@5@0@64@0@100 wet@8@0@64@0@100 wsrc@9@0@1F@0@31 wamt@10@9C@64@-100@100'],
    38: ['Pitch Shifter', 'S2:34', null, null, 'mode@0@0@2@0@2 shift@1@E8@18@-24@24 fine@4@9C@64@-100@100 delay@6@0@BE@0@1000 fb@8@9C@64@-100@100 hd@9@0@64@0@100 wet@12@0@64@0@100 wsrc@13@0@1F@0@31 wamt@14@9C@64@-100@100'],
    43: ['L/C/R Delay', 'S2:40', 'MM:5', 'MR:0', 'timeL@2:3-0,3@0@FFF@0@4095 lvlL@7:5-0@0@32@0@50 timeC@1,2:7-4@0@FFF@0@4095 lvlC@6:3-0,7:7-6@0@32@0@50 timeR@5,6:7-4@0@FFF@0@4095 lvlR@11:5-0@0@32@0@50 fb@0@9C@64@-100@100 hd@9:1-0,10:7-3@0@64@0@100 ld@15:6-0@0@64@0@100 spread@9:7-2@0@32@0@50 wet@13:2-0,14:7-4@0@64@0@100 wsrc@13:7-3@0@1F@0@31 wamt@12@9C@64@-100@100'],
    44: ['Stereo/Cross Delay', 'S4:16', null, null, 'timeL@14:5-0,15@0@1A90@0@1360 timeR@12:3-0,13,14:7-6@0@1A90@0@1360 fbL@0@9C@64@-100@100 fbR@1@9C@64@-100@100 hdL@9:4-0,10:7-6@0@64@0@100 ldL@7:6-0@0@64@0@100 wetL@11:6-0@0@64@0@100 wsrc@8:1-0,9:7-5@0@1F@0@31 wamt@4@9C@64@-100@100 cross@8:7@0@1@0@1'],
    48: ['St. Auto Panning Dly', 'S2:44', null, null, 'timeL@2:4-0,3@0@FFF@0@4095 fbL@6@9C@64@-100@100 fbR@7@9C@64@-100@100 hd@8@0@64@0@100 spdL@11@1@E6@0.02@20@lfo pspread@13@0@64@0@100 wet@14@0@64@0@100 wsrc@4:2-0,5:7-6@0@1F@0@31 wamt@15@9C@64@-100@100'],
    49: ['L/C/R BPM Delay', 'S2:40', 'MM:5', 'MR:0', 'bpm@5@0@FF@0@255 lb@3:2-0@0@7@0@7 lt@6:7-4@0@F@0@15 lvlL@7:5-0@0@32@0@50 cb@3:5-3@0@7@0@7 ct@2:4-1@0@F@0@15 lvlC@6:3-0,7:7-6@0@32@0@50 rb@2:0,3:7-6@0@7@0@7 rt@1:0,2:7-5@0@F@0@15 lvlR@11:5-0@0@32@0@50 fb@0@9C@64@-100@100 hd@9:1-0,10:7-3@0@64@0@100 ld@15:6-0@0@64@0@100 spread@9:7-2@0@32@0@50 wet@13:2-0,14:7-4@0@64@0@100 wsrc@13:7-3@0@1F@0@31 wamt@12@9C@64@-100@100'],
    50: ['St. BPM Delay', 'S2:37', null, null, 'bpm@4@0@FF@0@255 lb@5:2-0@0@7@0@7 lt@5:6-3@0@F@0@15 ladjr@10,11:7@0@1FF@0@511 rb@6:2-0@0@7@0@7 rt@6:6-3@0@F@0@15 radjr@12,13:7@0@1FF@0@511 wet@9:6-0@0@64@0@100 wsrc@14:6-2@0@1F@0@31 wamt@8@9C@64@-100@100 fbL@0@9C@64@-100@100 fbR@1@9C@64@-100@100 hd@11:6-0@0@64@0@100 ld@13:6-0@0@64@0@100'],
    52: ['Reverb Hall', 'S2:46', 'MR:4', null, 'time@0@1@64@0.1@10 hd@1@0@64@0@100 pd@2@0@C8@0@200 pdt@3@0@64@0@100 trim@6@0@64@0@100 lo@7@E2@1E@-15@15 hi@8@E2@1E@-15@15 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    53: ['Reverb SmoothHall', 'S2:47', 'MR:5', null, 'time@0@1@64@0.1@10 hd@1@0@64@0@100 pd@2@0@C8@0@200 pdt@3@0@64@0@100 trim@6@0@64@0@100 lo@7@E2@1E@-15@15 hi@8@E2@1E@-15@15 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    54: ['Reverb Wet Plate', 'S2:50', 'MR:6', null, 'time@0@1@64@0.1@10 hd@1@0@64@0@100 pd@2@0@C8@0@200 pdt@3@0@64@0@100 trim@6@0@64@0@100 lo@7@E2@1E@-15@15 hi@8@E2@1E@-15@15 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    55: ['Reverb Dry Plate', 'S2:51', 'MR:7', null, 'time@0@1@64@0.1@10 hd@1@0@64@0@100 pd@2@0@C8@0@200 pdt@3@0@64@0@100 trim@6@0@64@0@100 lo@7@E2@1E@-15@15 hi@8@E2@1E@-15@15 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    56: ['Reverb Room', 'S2:48', 'MR:2', null, 'time@0@1@64@0.1@10 hd@1@0@64@0@100 pd@2@0@C8@0@200 pdt@3@0@64@0@100 er@4@0@64@0@100 rev@5@0@64@0@100 trim@6@0@64@0@100 lo@7@E2@1E@-15@15 hi@8@E2@1E@-15@15 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    57: ['Reverb BrightRoom', 'S2:49', 'MR:3', null, 'time@0@1@64@0.1@10 hd@1@0@64@0@100 pd@2@0@C8@0@200 pdt@3@0@64@0@100 er@4@0@64@0@100 rev@5@0@64@0@100 trim@6@0@64@0@100 lo@7@E2@1E@-15@15 hi@8@E2@1E@-15@15 wet@9@0@64@0@100 wsrc@10@0@1F@0@31 wamt@11@9C@64@-100@100'],
    79: ['OD/HG - Amp Sim', 'S2:5', null, null, 'mode@13:0@0@1@0@1 drive@3:6-0@1@64@1@100 outl@2:4-0,3:7@0@32@0@50 wet@0:7-1@0@64@0@100 wsrc@14:4-0@0@1F@0@31 wamt@15@9C@64@-100@100'],
    96: ['Rotary Speaker OD', 'S4:12', null, null, 'od@12:7@0@1@0@1 odGain@1:6-0@0@64@0@50 odLevel@0:5-0,1:7@0@64@0@50 fast@2:2@0@1@0@1 spdSrc@12:1-0,13:7-5@0@1F@0@31 acc@5:6-0@0@64@0@100 balance@7:6-0@0@64@0@100 mic@8@0@64@0@100 wet@10:3-0,11:7-5@0@64@0@100 wsrc@12:6-2@0@1F@0@31 wamt@15@9C@64@-100@100'],
    101: ['St. BPM Long Delay', 'S4:16', null, null, 'bpm@4@0@FF@0@255 lb@5:2-0@0@7@0@7 lt@5:6-3@0@F@0@15 ladjr@10,11:7@0@1FF@0@511 rb@6:2-0@0@7@0@7 rt@6:6-3@0@F@0@15 radjr@12,13:7@0@1FF@0@511 wet@9:6-0@0@64@0@100 wsrc@14:6-2@0@1F@0@31 wamt@8@9C@64@-100@100 fbL@0@9C@64@-100@100 fbR@1@9C@64@-100@100 hd@11:6-0@0@64@0@100 ld@13:6-0@0@64@0@100']
};
const KORG_TRITON_NOTE = [0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 2]; // BPM base notes in beats: 1/32, 1/16 triplet, 1/16, 1/8 triplet, 1/8, 1/4 triplet, 1/4, 1/2
// Triton dynamic-modulation sources (Off ... Tempo, 0-31) as indices of this synth's source list
const KORG_TRITON_DMOD = [0, 1, 2, 3, 4, 5, 6, 7, 10, 8, 9, 16, 21, 22, 11, 23, 26, 24, 27, 28, 29, 30, 31, 32, 17, 33, 34, 13, 14, 15, 35, 25];
function korgTritonFxSlot(t, bytes, slot, notes, tempo) {
  const m = KORG_TRITON_FX[t];
  if (!m) return null;
  const type = slot === 'ins' ? m[1] : slot === 'm2' && m[3] ? m[3] : m[2] || m[1];
  const p = Object.assign(TFX.defaults(type), TFX.decodeSpec(m[4], bytes));
  const ms = (bpm, bn, bt) => 60000 / (bpm >= 40 && bpm <= 240 ? bpm : tempo) * KORG_TRITON_NOTE[bn & 7] * ((bt | 0) + 1);
  if (p.sync && p.bn !== undefined) p.lfoF = 1000 / ms(p.bpm, p.bn, p.bt);
  if (t === 49) { p.timeL = ms(p.bpm, p.lb, p.lt); p.timeC = ms(p.bpm, p.cb, p.ct); p.timeR = ms(p.bpm, p.rb, p.rt); }
  if (t === 50 || t === 101) {
    const adj = r => (r >= 256 ? r - 512 : r) / 10;
    p.timeL = ms(p.bpm, p.lb, p.lt) * (1 + adj(p.ladjr) / 100); p.timeR = ms(p.bpm, p.rb, p.rt) * (1 + adj(p.radjr) / 100);
    p.hdL = p.hdR = p.hd; p.ldL = p.ldR = p.ld; p.wetL = p.wetR = p.wet;
  }
  if (t === 48) { p.timeR = p.timeL; p.spdR = p.spdL * 1.3; p.lvlL = p.lvlR = 100; }
  // Stereo/Cross Delay (times in 0.2 ms steps, up to 1.36 s) runs on the Dual Long Delay; cross feedback is not available there
  if (t === 44) { p.hdR = p.hdL; p.ldR = p.ldL; p.wetR = p.wetL; if (p.cross) notes.push('The Triton Stereo/Cross Delay is in Cross mode; it plays as a stereo delay here'); delete p.cross; }
  if (t === 79) notes.push('The Triton OD/HG - Amp Sim plays as Overdrive with the speaker simulator; its 3-band EQ and amp type are left out');
  if (t === 30 && (bytes[4] & 1)) notes.push('The Triton Doppler is set to one-shot; it loops here');
  if (t === 56 || t === 57) { if (type[0] === 'M') { const e = (p.er === undefined ? 50 : p.er) / 50; p.er1l *= e; p.er2l *= e; p.er3l *= e; p.er4l *= e; } }
  else if (type[0] === 'M' && type[1] === 'R' && p.er1l !== undefined) { p.er1l = p.er2l = p.er3l = p.er4l = 0; }
  if (type === 'MR:0' || type === 'MM:5') { p.lvlL = Math.min(50, p.lvlL); p.lvlC = Math.min(50, p.lvlC); p.lvlR = Math.min(50, p.lvlR); }
  if (slot !== 'ins') { p.out = Math.abs(p.wet === undefined ? 100 : p.wet); if (type === 'MM:4' || type === 'MM:0' || type === 'MM:1') p.spread = 100; }
  if (type === 'MR:2' || type === 'MR:3' || type === 'MR:4' || type === 'MR:5' || type === 'MR:6' || type === 'MR:7') { p.pdt = p.pdt * 0.3; p.trim = p.trim * 0.3; }
  if (p.wsrc) p.wsrc = KORG_TRITON_DMOD[p.wsrc] || 0;
  for (const k of ['src', 'wahSrc', 'spdSrc']) if (p[k] !== undefined) p[k] = KORG_TRITON_DMOD[p[k]] || 0;
  for (const k of ['sync', 'bpm', 'bn', 'bt', 'lb', 'lt', 'cb', 'ct', 'rb', 'rt', 'ladjr', 'radjr']) delete p[k];
  return { type, p };
}
function korgDecodeTritonFx(x, notes) {
  const fx = TFX.rack(), S = korgS8;
  fx.ins = [];
  if (!x || x.length < 195) { notes.push('This program\u2019s Triton effect settings were not stored; a plain reverb stands in'); fx.send2 = fx.ifxSend2 = 40; return fx; }
  const at = o => x[o - 16], tempo = 120, blk = o => x.subarray(o - 16, o); // o = absolute offset in the 604-byte Triton record
  // IFX 1-5: 16 parameter bytes, type, on/chain, (2), pan, bus, send 1, send 2. The program feeds the IFX named by its bus select, then follows the chain.
  let k = at(205) >= 1 && at(205) <= 5 ? at(205) - 1 : -1, last = -1, guard = 0;
  while (k >= 0 && k < 5 && guard++ < 5) {
    const o = 16 + k * 24, t = at(o + 16), on = (at(o + 17) >> 6) & 1, chain = (at(o + 17) >> 7) & 1;
    last = k;
    if (t) {
      const s = korgTritonFxSlot(t, blk(o), 'ins', notes, tempo);
      if (s) fx.ins.push({ on, type: s.type, p: s.p });
      else notes.push('Triton insert effect ' + t + (KORG_TRITON_NAMES[t] ? ' (' + KORG_TRITON_NAMES[t] + ')' : '') + ' is not reproduced');
    }
    if (!chain) break;
    k++;
  }
  if (last >= 0) { const o = 16 + last * 24; fx.ifxRoute = 1; fx.ifxPan = Math.min(127, at(o + 20)); fx.ifxWidth = 127; fx.ifxSend1 = Math.min(127, at(o + 22)); fx.ifxSend2 = Math.min(127, at(o + 23)); }
  // MFX 1-2, returns, chain, master EQ
  const master = (o, tb, which) => {
    const t = at(tb), on = (at(tb + 1) >> 6) & 1, s = t ? korgTritonFxSlot(t, blk(o), which, notes, tempo) : null;
    if (t && !s) notes.push('Triton master effect ' + t + (KORG_TRITON_NAMES[t] ? ' (' + KORG_TRITON_NAMES[t] + ')' : '') + ' is not reproduced');
    return s ? { on, type: s.type, p: s.p, pan: -1 } : { on: 0, type: which === 'm1' ? 'MM:4' : 'MR:5', p: TFX.defaults(which === 'm1' ? 'MM:4' : 'MR:5'), pan: -1 };
  };
  fx.m1 = master(136, 152, 'm1'); fx.m1.ret = Math.min(127, at(176));
  fx.m2 = master(156, 172, 'm2'); fx.m2.ret = Math.min(127, at(177));
  const ch = at(178); fx.m1.cascade = (ch >> 3) & 1 && !((ch >> 2) & 1) ? 1 : 0; fx.m1.casLvl = Math.min(127, at(179));
  fx.eqLo = Math.max(-36, Math.min(36, S(at(180)))) / 2; fx.eqHi = Math.max(-36, Math.min(36, S(at(182)))) / 2; fx.eqLoF = 80; fx.eqHiF = 12000;
  return fx;
}
const KORG_TRITON_NAMES = {"1": "St. Amp Simulation", "2": "Stereo Compressor", "3": "Stereo Limiter", "4": "Multiband Limiter", "5": "Stereo Gate", "6": "OD/Hi.Gain Wah", "7": "St. Parametric 4EQ", "8": "St. Graphic 7EQ", "9": "St. Wah/Auto Wah", "10": "St. Random Filter", "11": "St. Exciter/Enhncr", "12": "St. Sub Oscillator", "13": "Talking Modulator", "14": "Stereo Decimator", "15": "St. Analog Record", "16": "St. Chorus", "17": "St. Harmonic Chorus", "18": "Multitap Cho/Dly", "19": "Ensemble", "20": "Stereo Flanger", "21": "St. Random Flanger", "22": "St. Env. Flanger", "23": "Stereo Phaser", "24": "St. Random Phaser", "25": "St. Env Phaser", "26": "St.Biphase Mod.", "27": "Stereo Vibrato", "28": "St. Auto Fade Mod.", "29": "2Voice Resonator", "30": "Doppler", "31": "Scratch", "32": "Stereo Tremolo", "33": "St. Env. Tremolo", "34": "Stereo Auto Pan", "35": "St. Phaser + Trml", "36": "St. Ring Modulator", "37": "Detune", "38": "Pitch Shifter", "39": "Pitch Shift Mod.", "40": "Rotary Speaker", "41": "Early Reflections", "42": "Auto Reverse", "43": "L/C/R Delay", "44": "Stereo/Cross Delay", "45": "St. Multitap Delay", "46": "St. Modulation Delay", "47": "St. Dynamic Delay", "48": "St. Auto Panning Dly", "49": "L/C/R BPM Delay", "50": "St. BPM Delay", "51": "Sequence Delay", "52": "Reverb Hall", "53": "Reverb SmoothHall", "54": "Reverb Wet Plate", "55": "Reverb Dry Plate", "56": "Reverb Room", "57": "Reverb BrightRoom", "58": "P4EQ - Exciter", "59": "P4EQ - Wah", "60": "P4EQ  - Cho/Flng", "61": "P4EQ - Phaser", "62": "P4EQ - Mt. Delay", "63": "Comp - Wah", "64": "Comp - Amp Sim", "65": "Comp - OD/HiGain", "66": "Comp - Param4EQ", "67": "Comp - Cho/Flng", "68": "Comp - Phaser", "69": "Comp - Mt.Delay", "70": "Limiter - P4EQ", "71": "Limiter - Cho/Flng", "72": "Limiter - Phaser", "73": "Limiter - Mt. Delay", "74": "Exciter - Comp", "75": "Exciter - Limiter", "76": "Exciter - Cho/Flng", "77": "Exciter - Phaser", "78": "Exciter - Mt.Delay", "79": "OD/HG - Amp Sim", "80": "OD/HG - Cho/Flng", "81": "OD/HG - Phaser", "82": "OD/HG - Mt. Delay", "83": "Wah - Amp Sim", "84": "Decimator - Amp", "85": "Decimator - Comp", "86": "Amp Sim - Tremolo", "87": "Cho/Flng - Mt.Dly", "88": "Phaser - Cho/Flng", "89": "Reverb - Gate", "90": "Piano Body/Damper", "91": "St. Mltband Limiter", "92": "OD/HyperGain Wah", "93": "Vocoder", "94": "Multitap Cho/Delay", "95": "St. Pitch Shifter", "96": "Rotary Speaker OD", "97": "Early Reflections", "98": "L/C/R Long Delay", "99": "St/Cross Long Dly", "100": "LCR BPM Long Dly", "101": "St. BPM Long Delay", "102": "Hold Delay"};

// Which parts of a decoded program this synth can play right now
function korgPlayability(P) {
  const i = P.korgInfo || {}, missing = [];
  if (KORG.NOT_BUILT.includes(i.osc1)) missing.push(KORG.OSC_NAME[KORG.OSC.indexOf(i.osc1)]);
  const osc2Heard = i.osc2 && (P.mix[0].osc2 > 0 || P.mix[1].osc2 > 0);
  if (osc2Heard && KORG.NOT_BUILT.includes(i.osc2)) missing.push(KORG.OSC_NAME[KORG.OSC.indexOf(i.osc2)] + ' (OSC 2)');
  return { full: missing.length === 0, missing };
}

// ======== Trinity PCM ("ACCESS") programs and combinations (drum kits are not supported) ========
// Byte maps: Korg Trinity Parameter Guide, MIDI Implementation TABLE 1 (program, 433 bytes), TABLE 3 (combination,
// 388 bytes), TABLE 7 (drum kit, 1426 bytes); PCG records are the unpacked (8-bit) dumps.
const KORG_PCM = {
  REC: 433, COMBI: 388, KIT: 1426,
  BANKS: ['A', 'B', 'C', 'D'],
  // AMS list of the PCM synth (23-26 only from OSC 2: OSC 1's filter EG, amp EG, OSC LFO, filter LFO)
  AMS: ['off', 'oeg', 'feg', 'aeg', 'olfo', 'flfo', 'vel', 'note', 'pat', 'at', 'jsx', 'jsy', 'jsyn', 'ribbon', 'ribz', 'foot', 'slider', 'cc19', 'sw1', 'sw2', 'fsw', 'cc83', 'tempo',
    'feg1', 'aeg1', 'olfo1', 'flfo1'],
  AMS_NAME: ['Off', 'Pitch EG', 'Filter EG', 'Amp EG', 'OSC LFO', 'Filter LFO', 'Velocity', 'Note number', 'Poly aftertouch', 'Aftertouch', 'Joystick X', 'Joystick +Y (CC1)',
    'Joystick −Y (CC2)', 'Ribbon X (CC16)', 'Ribbon Z (CC17)', 'Pedal (CC4)', 'Value slider (CC18)', 'MIDI CC19', 'SW1 (CC80)', 'SW2 (CC81)', 'Pedal switch (CC82)', 'MIDI CC83', 'Tempo',
    'Filter EG of OSC 1', 'Amp EG of OSC 1', 'OSC LFO of OSC 1', 'Filter LFO of OSC 1'],
  LFOW: ['tri0', 'tri90', 'tri180', 'tri270', 'sawup0', 'sawup180', 'sawdn0', 'sawdn180', 'rect0', 'rect180', 'sine0', 'sine180', 'guitar', 'rnd1', 'rnd2', 'rnd3', 'rnd4', 'rnd5', 'rnd6'],
  LFOW_NAME: ['Triangle 0°', 'Triangle 90°', 'Triangle 180°', 'Triangle 270°', 'Saw up 0°', 'Saw up 180°', 'Saw down 0°', 'Saw down 180°', 'Rectangle 0°', 'Rectangle 180°',
    'Sine 0°', 'Sine 180°', 'Guitar', 'Random 1', 'Random 2', 'Random 3', 'Random 4', 'Random 5', 'Random 6'],
  FTYPE: ['lpf', 'hpf', 'bpf', 'brf'],
  ROUTE: ['parallel', 'serial', 'single', 'thru'],
  SCALE: ['equal', 'pureMaj', 'pureMin', 'arabic', 'pyth', 'werck', 'kirn', 'slendro', 'pelog', 'user', 'stretch', 'userAll'],
  // PITCH INT (-12.00..+12.00 semitones), signed byte, piecewise steps
  pint(b) { return b <= -61 ? -12 + (Math.max(b, -115) + 115) * 0.2 : b <= -51 ? -1 + (b + 60) * 0.05 : b <= 50 ? b * 0.01 : b <= 60 ? 0.55 + (b - 51) * 0.05 : 1.2 + (Math.min(b, 115) - 61) * 0.2; },
  // DELAY START list: ms, or -1 = start at note-off
  // bend STEP list: 0 continuous, 1 = 1/8 semitone, 2 = 1/4, 3 = 1/2, 4 = 1 ... 15 = 12 semitones
  stepSemis(v) { return v <= 0 ? 0 : v < 4 ? [0.125, 0.25, 0.5][v - 1] : v - 3; },
  delayMs(v) { if (v === 255) return -1; if (v <= 25) return v * 2; if (v <= 40) return 60 + (v - 26) * 10; if (v <= 56) return 250 + (v - 41) * 50; if (v <= 96) return 1100 + (v - 57) * 100; return 5000; },
  KEY_SLOPE: [0, 1, 2, 3, 4, 6, 8, 10, 12, 18, 24, 30, 36, 48, 60, 72]
};

// Section contents of a Trinity PCG: PCM program banks, combination banks, bank S, global (category names); drum kits are skipped
function korgTrinitySections(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), r = korgParsePCG(b);
  const out = { ok: r.ok, error: r.error, pcm: [], combis: [], bankS: [], bankM: r.bankM || [], userScale: r.userScale, cats: null };
  if (!r.ok || r.fmt === 'triton') return out;
  for (const s of r.sections) {
    if (s.type === 0 || s.type === 2) {
      const rs = s.type === 0 ? KORG_PCM.REC : KORG_PCM.COMBI, per = 2 + 128 * rs;
      for (let k = 0; k < s.count && (k + 1) * per <= s.size; k++) {
        const o = s.off + k * per, id = b[o + 1] & 3, recs = [];
        for (let i = 0; i < 128; i++) recs.push(b.slice(o + 2 + i * rs, o + 2 + (i + 1) * rs));
        (s.type === 0 ? out.pcm : out.combis).push({ bank: KORG_PCM.BANKS[id] || KORG_PCM.BANKS[k], recs });
      }
    } else if (s.type === 1) {
      const n = Math.floor((s.size - 2) / KORG.REC);
      for (let i = 0; i < n; i++) out.bankS.push(b.slice(s.off + 2 + i * KORG.REC, s.off + 2 + (i + 1) * KORG.REC));
    } else if (s.type === 4 && s.size >= 2 + 1170) {
      const g = s.off + 2, nm = k => korgName(b.subarray(g + 146 + k * 16, g + 162 + k * 16));
      out.cats = { progA: [], progB: [], combiA: [], combiB: [] };
      for (let i = 0; i < 16; i++) { out.cats.progA.push(nm(i)); out.cats.progB.push(nm(16 + i)); out.cats.combiA.push(nm(32 + i)); out.cats.combiB.push(nm(48 + i)); }
    }
  }
  return out;
}

// Insert chain (22-byte blocks) and master block (40 bytes) of a PCM program or combination
function korgDecodeFxBlocks(r, insOffs, mOff, notes) {
  const fx = TFX.rack(), S = korgS8, SZ = [0, 1, 2, 4];
  fx.ins = [];
  let last = -1;
  insOffs.forEach((b, k) => {
    const t = r[b + 16] & 63, on = (r[b + 16] >> 6) & 1, sz = SZ[r[b + 17] & 3];
    if (!sz) return;
    const id = 'S' + sz + ':' + t, e = TFX.byId(id);
    if (!e) { notes.push('Insert effect ' + (k + 1) + ' has an unknown type (size ' + sz + ', number ' + t + ') and was left out'); return; }
    fx.ins.push({ on, type: id, p: TFX.decode(id, r.subarray(b, b + 16)).p });
    last = b;
  });
  if (last >= 0) {
    const pan = r[last + 18]; fx.ifxPan = pan > 127 ? -1 : pan; fx.ifxWidth = Math.min(127, r[last + 19]);
    fx.ifxSend1 = Math.min(127, r[last + 20]); fx.ifxSend2 = Math.min(127, r[last + 21]);
  }
  const m = mOff, master = (grp, b, tb, pb, rb, name) => {
    const t = r[tb] & 63, id = grp + ':' + t, on = (r[tb] >> 6) & 1;
    if (!TFX.byId(id)) { notes.push(name + ' has an unknown type (' + t + ') and was switched off'); return { on: 0, type: grp === 'MM' ? 'MM:4' : 'MR:5', p: TFX.defaults(grp === 'MM' ? 'MM:4' : 'MR:5'), ret: r[rb] & 127, pan: 50 }; }
    const pn = S(r[pb]);
    return { on, type: id, p: TFX.decode(id, r.subarray(b, b + 16)).p, ret: Math.min(127, r[rb]), pan: pn < 0 ? -1 : Math.min(100, pn) };
  };
  fx.m1 = master('MM', m, m + 16, m + 17, m + 18, 'Master Effect 1'); fx.m1.cascade = (r[m + 16] >> 7) & 1;
  fx.m2 = master('MR', m + 19, m + 35, m + 36, m + 37, 'Master Effect 2');
  fx.eqLo = Math.max(-36, Math.min(36, S(r[m + 38]))) / 2; fx.eqHi = Math.max(-36, Math.min(36, S(r[m + 39]))) / 2;
  return fx;
}

// ---- one PCM program (433 bytes) ----
// the multisample that plays for a sound the file names but this synth does not have (pcmmap.js PCM_FALLBACK)
function korgFallback() { return typeof PCM_FALLBACK !== 'undefined' ? PCM_FALLBACK : 0; }
function korgFallbackName() { const n = korgFallback(); return typeof PCM_MS_NAMES !== 'undefined' && PCM_MS_NAMES[n] ? PCM_MS_NAMES[n] : 'multisample ' + n; }
function korgDecodePcm(r, userScale) {
  const notes = [], u = k => r[k], s = k => korgS8(r[k]), P = KORG_PCM;
  const lim = (v, a, b2, what) => { if (v < a || v > b2) { notes.push(what + ' had an out-of-range value (' + v + ')'); return v < a ? a : b2; } return v; };
  const ams = k => { const v = r[k]; if (v >= P.AMS.length) { notes.push('A modulation source had an invalid value (' + v + ') and was switched off'); return 'off'; } return P.AMS[v]; };
  const b17 = u(17), mode = ['single', 'double', 'drum'][b17 & 3] || 'single';
  if ((b17 & 3) === 3) notes.push('Unknown oscillator mode; played as Single');
  const scType = u(19) >> 4;
  const X = {
    kind: 'pcm', name: korgName(r) || 'Untitled', cat: u(16) & 15, catB: u(16) >> 4, mode,
    voice: { mode: (b17 >> 3) & 1 ? ((b17 >> 2) & 1 ? 'monoSingle' : 'monoMulti') : 'poly', priority: ['low', 'high', 'last', 'last'][(b17 >> 5) & 3], hold: (b17 >> 4) & 1,
      piano: (b17 >> 7) & 1, maxVoices: 32, unison: 1, uniDetune: 0, random: 0, porta: 0, portaTime: 0, portaFingered: 0, bendUp: 2, bendDown: -2, tempo: 120 },
    osc2Vel: Math.max(1, u(18) & 127),
    scale: { type: P.SCALE[scType] || 'equal', key: (u(19) & 15) % 12, user: (userScale || new Array(12).fill(0)).slice() },
    random: [0, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1][u(20) & 7],
    sw: [u(21) >> 4, u(21) & 15],
    peg: { startL: s(22), atkT: u(23), atkL: s(24), decT: u(25), relT: u(26), relL: s(27), velT: s(28), tSrc: ams(29), tInt: s(30) },
    o: [], out: { level: 127, pan: 64, trim: 3.3 } // PCM trim: the stand-in recordings sit ~18 dB under the MOSS voices
  };
  if (scType === 11) { X.scale.type = 'equal'; notes.push('The all-notes user scale is not stored in the program; equal temperament used'); }
  X.voice.random = X.random;
  const osc = (b) => {
    const ms = (h, l) => (((u(h) & 0x7f) << 8) | u(l));
    const lfo = (o) => ({ wave: P.LFOW[lim(u(o) & 31, 0, 18, 'LFO waveform')], start: ['on', 'off', 'both'][(u(o) >> 5) & 3] || 'on', sync: (u(o) >> 7) & 1, offset: s(o + 1), freq: lim(u(o + 2), 0, 99, 'LFO frequency'), delay: lim(u(o + 3), 0, 99, 'LFO delay'), fade: s(o + 4) });
    const filt = (o) => ({ cut: lim(u(o), 0, 99, 'Cutoff'), gain: lim(u(o + 1), 0, 99, 'Filter input gain'), reso: lim(u(o + 2), 0, 31, 'Resonance'), resoVel: s(o + 3),
      egInt: s(o + 4), egVel: s(o + 5), lfoInt: s(o + 6), jsx: s(o + 7), at: lim(u(o + 8), 0, 99, 'Filter aftertouch'),
      lowKey: u(o + 9) & 127, highKey: u(o + 10) & 127, lowRamp: s(o + 11), highRamp: s(o + 12), amsSrc: ams(o + 13), amsInt: s(o + 14) });
    const O = {
      msLo: ms(b, b + 1), offLo: u(b) >> 7, msHi: ms(b + 2, b + 3), offHi: u(b + 2) >> 7, lvlLo: u(b + 4) & 127, lvlHi: u(b + 5) & 127, velSplit: Math.max(1, u(b + 6) & 127),
      transpose: ((u(b + 7) & 31) ^ 16) - 16, octave: lim(u(b + 7) >> 6, 0, 3, 'Octave') - 2, tune: lim(((u(b + 8) << 8) | u(b + 9)) << 16 >> 16, -1200, 1200, 'Tune'), delay: P.delayMs(u(b + 10)),
      pitch: { slope: lim(s(b + 11), -10, 20, 'Pitch slope') / 10, egInt: P.pint(s(b + 12)), lfoInt: P.pint(s(b + 13)), ribbon: lim(s(b + 14), -12, 12, 'Ribbon pitch'),
        jsUp: lim(s(b + 15), -60, 12, 'Joystick +X'), jsDown: lim(s(b + 16), -60, 12, 'Joystick −X'), stepUp: u(b + 17) & 15, stepDown: u(b + 17) >> 4,
        amsSrc: ams(b + 18), amsInt: P.pint(s(b + 19)), egVel: s(b + 20), egAmsSrc: ams(b + 21), egAmsInt: P.pint(s(b + 22)) },
      lfo: Object.assign(lfo(b + 23), { kbd: s(b + 28), jsy: lim(u(b + 29), 0, 99, 'LFO speed by joystick'), fmSrc: ams(b + 30), fmInt: s(b + 31) }),
      lfoPitch: { jsy: lim(u(b + 32), 0, 99, 'Vibrato by joystick'), at: lim(u(b + 33), 0, 99, 'Vibrato by aftertouch'), amsSrc: ams(b + 34), amsInt: P.pint(s(b + 35)) },
      ftype: [P.FTYPE[u(b + 36) & 3], P.FTYPE[(u(b + 36) >> 2) & 3]], ftn: [u(b + 36) & 3, (u(b + 36) >> 2) & 3], route: P.ROUTE[(u(b + 36) >> 4) & 3],
      feg: { startL: s(b + 37), atkT: u(b + 38), atkL: s(b + 39), decT: u(b + 40), brkL: s(b + 41), slpT: u(b + 42), susL: s(b + 43), relT: u(b + 44), relL: s(b + 45),
        kt: [s(b + 46), s(b + 47), s(b + 48), s(b + 49)], vt: [s(b + 50), s(b + 51), s(b + 52), s(b + 53)], tSrc: ams(b + 54), tInt: s(b + 55), lv: [s(b + 56), s(b + 57), s(b + 58)] },
      fegAms: { src: ams(b + 59), int: s(b + 60) },
      flfo: Object.assign(lfo(b + 61), { fmSrc: ams(b + 66), fmInt: s(b + 67) }),
      flfoMod: { jsyn: lim(u(b + 68), 0, 99, 'Filter LFO by joystick'), at: lim(u(b + 69), 0, 99, 'Filter LFO by aftertouch'), amsSrc: ams(b + 70), amsInt: s(b + 71) },
      f: [filt(b + 72), filt(b + 87)],
      amp: { level: u(b + 102) & 127, lowKey: u(b + 103) & 127, highKey: u(b + 104) & 127, lowRamp: s(b + 105), highRamp: s(b + 106), vel: s(b + 107), at: s(b + 108), amsSrc: ams(b + 109), amsInt: s(b + 110) },
      aeg: { startL: lim(u(b + 111), 0, 99, 'Amp EG level'), atkT: u(b + 112), atkL: lim(u(b + 113), 0, 99, 'Amp EG level'), decT: u(b + 114), brkL: lim(u(b + 115), 0, 99, 'Amp EG level'), slpT: u(b + 116), susL: lim(u(b + 117), 0, 99, 'Amp EG level'), relT: u(b + 118),
        kt: [s(b + 119), s(b + 120), s(b + 121), s(b + 122)], vt: [s(b + 123), s(b + 124), s(b + 125), s(b + 126)], tSrc: ams(b + 127), tInt: s(b + 128), lv: [s(b + 129), s(b + 130), s(b + 131)] },
      pan: u(b + 132) === 255 ? -1 : u(b + 132) & 127, panSrc: ams(b + 133), panInt: s(b + 134), send1: u(b + 135) & 127, send2: u(b + 136) & 127
    };
    for (const e of [O.feg, O.aeg]) for (const k of ['atkT', 'decT', 'slpT', 'relT']) if (e[k] !== undefined) e[k] = lim(e[k], 0, 99, 'EG time');
    return O;
  };
  X.o.push(osc(31), osc(168));
  X.voice.bendUp = X.o[0].pitch.jsUp; X.voice.bendDown = X.o[0].pitch.jsDown;
  // RAM/Flash samples (loaded into the Trinity from disk) are not in the file: they play the fallback (PCM_FALLBACK)
  const ram = [];
  for (const O of X.o) for (const k of ['msLo', 'msHi']) if (O[k] >= 0x1000 && mode !== 'drum') ram.push(O[k] & 0xfff);
  if (ram.length) {
    const fb = korgFallback(), ns = [...new Set(ram)];
    X.ramMap = {}; ns.forEach(n => { X.ramMap[n] = fb; });
    notes.push('Plays RAM/Flash sample' + (ns.length > 1 ? 's ' : ' ') + ns.join(', ') + ', loaded into the Trinity and not stored in the file; the fallback plays instead (' + korgFallbackName() + ')');
  }
  X.fx = korgDecodeFxBlocks(r, [305, 327, 349, 371], 393, notes);
  // no insert effects: the oscillator blocks' sends feed the master effects
  X.fx.send1 = X.fx.ifxSend1 = X.fx.ins.length ? X.fx.ifxSend1 : X.o[0].send1;
  X.fx.send2 = X.fx.ins.length ? X.fx.ifxSend2 : X.o[0].send2;
  if (!X.fx.ins.length) X.fx.ifxSend2 = X.fx.send2;
  X.korgInfo = { kind: 'pcm', notes };
  X.korg = Array.from(r);
  return X;
}

// ======== Triton PCM programs (540 bytes) ========
// Byte map: Korg TRITON MIDI Implementation (1999.05.11), TABLE 1 "Program parameters (for PCM Synth)"; global user
// scales: TABLE 4. A Triton program is played by this synth's PCM program model (the Trinity's): the Triton's two LFOs per
// oscillator become the OSC LFO (pitch) and the filter LFO, its LPF+Reso / LPF+HPF filter the single / serial routes,
// its shared filter and amp key tracking both filters' ramps. Effects (bytes 16-210) are the Triton's, decoded like the
// EXB-MOSS bank's. Triton ROM multisamples are a different set from the Trinity's and are not mapped yet.
const KORG_TRITON_PCM = {
  REC: 540,
  // A.M. sources 00-2A (TABLE 1 **1-4) as this synth's AMS names (knobs 1/2 = CC17/CC19; pedals and knob 3/4: off)
  AMS: ['off', 'oeg', 'feg', 'aeg', 'olfo', 'flfo', 'note', 'note', 'note', 'note', 'note', 'note', 'note', 'note', 'note', 'vel', 'pat', 'at', 'jsx', 'jsy', 'jsyn', 'jsy', 'jsyn',
    'foot', 'ribbon', 'slider', 'ribz', 'cc19', 'off', 'off', 'ribz', 'cc19', 'off', 'off', 'off', 'off', 'off', 'off', 'sw1', 'sw2', 'fsw', 'cc83', 'tempo'],
  // LFO waveforms 0-14 (**1-6) as this synth's LFO shapes
  LFOW: ['tri0', 'tri90', 'rnd1', 'sawup0', 'sawup180', 'rect0', 'sine0', 'guitar', 'tri0', 'sawdn0', 'sawup0', 'tri0', 'tri0', 'sawup0', 'sawup0', 'rnd1', 'rnd2', 'rnd3', 'rnd4', 'rnd5', 'rnd6'],
  SCALE: ['equal', 'pureMaj', 'pureMin', 'arabic', 'pyth', 'werck', 'kirn', 'slendro', 'pelog', 'stretch']
};
// the Triton global's 16 user octave scales (cents) and its all-notes scale
function korgTritonGlobal(g) {
  const s8 = v => korgS8(v), out = { scales: [], allNotes: [] };
  if (!g || g.length < 328) return out;
  for (let k = 0; k < 16; k++) out.scales.push(Array.from(g.subarray(8 + k * 12, 20 + k * 12), s8));
  out.allNotes = Array.from(g.subarray(200, 328), s8);
  return out;
}
// Triton PCG contents: PCM program banks (A-E, 540-byte records), combination banks (not played yet), the global
function korgTritonSections(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf), out = { ok: false, pcm: [], combis: 0, glb: null };
  const rd = o => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3], tag = o => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  let p = -1; for (let i = 4; i < Math.min(64, b.length - 8); i++) if (tag(i) === 'PCG1') { p = i; break; }
  if (p < 0) return out;
  const end = Math.min(b.length, p + 8 + rd(p + 4));
  for (let o = p + 8; o + 8 <= end;) {
    const t = tag(o), sz = rd(o + 4), d = o + 8;
    if (t === 'PRG1' || t === 'CMB1') {
      for (let q = d; q + 20 <= d + sz;) {
        const t2 = tag(q), s2 = rd(q + 4), n = rd(q + 8), rs = rd(q + 12), id = rd(q + 16);
        if (t2 === 'PBK1' && rs === KORG_TRITON_PCM.REC) out.pcm.push({ bank: 'ABCDEFGHIJKLMN'[id] || '?', recs: Array.from({ length: n }, (_, i) => b.slice(q + 20 + i * rs, q + 20 + (i + 1) * rs)) });
        else if (t2 === 'CBK1') out.combis += n;
        q += 8 + s2;
      }
    } else if (t === 'GLB1') out.glb = korgTritonGlobal(b.subarray(d, d + sz));
    o += 8 + sz;
  }
  out.ok = true;
  return out;
}
// ---- one Triton PCM program (540 bytes); glb: korgTritonGlobal() of its file; ram(n): what plays RAM multisample n
// (an entry key of the sample map, e.g. 'u:zurna005'), or undefined when that sample is not available
function korgDecodeTritonPcm(r, glb, ram) {
  const X = korgDecodePcm(new Uint8Array(KORG_PCM.REC)); delete X.korg; // every field of the model, then the Triton's values
  const notes = [], u = k => r[k], s = k => korgS8(r[k]), T = KORG_TRITON_PCM, P = KORG_PCM;
  const ams = k => T.AMS[r[k]] || 'off', pint = k => P.pint(s(k)), c99 = (v) => Math.max(0, Math.min(99, v));
  const b204 = u(204), mode = ['single', 'double', 'drum'][b204 & 3] || 'single';
  X.name = korgName(r) || 'Untitled'; X.cat = u(206) & 15; X.catB = 0; X.mode = mode;
  Object.assign(X.voice, { mode: (b204 >> 2) & 1 ? ((b204 >> 3) & 1 ? 'monoSingle' : 'monoMulti') : 'poly', priority: ['low', 'high', 'last', 'last'][(b204 >> 4) & 3], hold: (b204 >> 7) & 1 });
  const sc = u(207);
  if (sc <= 9) X.scale = { type: T.SCALE[sc], key: u(208) % 12, user: new Array(12).fill(0) };
  else if (sc >= 11 && sc <= 26 && glb && glb.scales[sc - 11]) X.scale = { type: 'user', key: u(208) % 12, user: glb.scales[sc - 11].slice(), userNo: sc - 11 };
  else { X.scale = { type: 'equal', key: 0, user: new Array(12).fill(0) }; notes.push('The Triton ' + (sc === 10 ? 'all-notes user scale' : 'scale type ' + sc) + ' is not reproduced; equal temperament used'); }
  X.random = X.voice.random = [0, 1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1][u(209) & 7];
  X.peg = { startL: s(216), atkT: c99(u(217)), atkL: s(218), decT: c99(u(219)), relT: c99(u(220)), relL: s(221), velT: 0, tSrc: ams(226), tInt: s(227) };
  const romMiss = new Set(), ramMiss = new Set(), ramUsed = {};
  const ref = (hi, lo, bank) => { // multisample number + bank -> this synth's multisample id
    const n = ((hi & 0x7f) << 8) | lo;
    if (bank === 1) { const e = ram(n); if (e === undefined) ramMiss.add(n); else ramUsed[n] = e; return 0x1000 | (n & 0xfff); }
    romMiss.add((bank === 0 ? 'ROM ' : 'expansion ' + bank + ' ') + n); return korgFallback();
  };
  const osc = (b, k) => {
    const O = X.o[k], lfo = (o) => ({ wave: T.LFOW[u(o) & 31] || 'tri0', start: 'on', sync: (u(o) >> 7) & 1, offset: s(o + 2), freq: c99(u(o + 1)), delay: c99(u(o + 3)), fade: s(o + 4),
      kbd: 0, jsy: 0, fmSrc: ams(o + 6), fmInt: s(o + 7) });
    const audible = k === 0 || mode === 'double';
    O.offHi = u(b) >> 7; O.msHi = audible ? ref(u(b), u(b + 1), u(b + 2)) : 0; O.lvlHi = u(b + 3) & 127;
    O.velSplit = Math.max(1, u(b + 9) & 127);
    O.offLo = u(b + 4) >> 7; O.msLo = audible && O.velSplit > 1 && (u(b + 7) & 127) ? ref(u(b + 4), u(b + 5), u(b + 6)) : O.msHi; O.lvlLo = u(b + 7) & 127;
    if (audible && ((u(b) >> 6) & 1 || (O.velSplit > 1 && (u(b + 4) >> 6) & 1))) notes.push('OSC ' + (k + 1) + ' plays its multisample reversed on the Triton; forwards here');
    O.delay = u(b + 8) === 97 ? -1 : P.delayMs(u(b + 8));
    if (k === 1 && u(b + 10) > 1) X.osc2Vel = u(b + 10) & 127;
    if (audible && ((k === 0 && u(b + 10) > 1) || (u(b + 11) & 127) < 127)) notes.push('OSC ' + (k + 1) + ' plays only velocities ' + u(b + 10) + '-' + u(b + 11) + ' on the Triton; here it follows the Trinity model');
    const l1 = lfo(b + 12), l2 = lfo(b + 22);
    // pitch (262-285)
    O.octave = Math.max(-2, Math.min(1, s(b + 32))); O.transpose = Math.max(-12, Math.min(12, s(b + 33))); O.tune = Math.max(-1200, Math.min(1200, ((u(b + 34) << 8) | u(b + 35)) << 16 >> 16));
    const jsVib = pint(b + 50), vibJs = Math.sign(jsVib) * 99 * Math.sqrt(Math.min(12, Math.abs(jsVib)) / 12);
    Object.assign(O.pitch, { amsSrc: ams(b + 36), amsInt: pint(b + 37), slope: Math.max(-10, Math.min(20, s(b + 38))) / 10, egInt: pint(b + 39), egAmsSrc: ams(b + 40), egAmsInt: pint(b + 41),
      lfoInt: pint(b + 42), jsUp: Math.max(-60, Math.min(12, s(b + 46))), jsDown: Math.max(-60, Math.min(12, s(b + 47))), ribbon: Math.max(-12, Math.min(12, s(b + 48))), egVel: 0, stepUp: 0, stepDown: 0 });
    O.lfo = l1; O.lfoPitch = { jsy: Math.round(vibJs), at: 0, amsSrc: ams(b + 52), amsInt: pint(b + 53) };
    if (pint(b + 43)) notes.push('OSC ' + (k + 1) + ' pitch LFO 2 is left out (this model has one pitch LFO)');
    if (k === 0 && (u(b + 44) & 1)) { X.voice.porta = 1; X.voice.portaTime = u(b + 45) & 127; X.voice.portaFingered = (u(b + 44) >> 1) & 1; }
    // filter (286-345): LPF+Reso = one resonant low-pass; LPF+HPF = low-pass then high-pass
    const hp = u(b + 56) === 1, kt = [u(b + 112) & 127, s(b + 113), u(b + 114) & 127, s(b + 115)];
    O.route = hp ? 'serial' : 'single'; O.ftype = hp ? ['lpf', 'hpf'] : ['lpf', 'lpf']; O.ftn = hp ? [0, 1] : [0, 0];
    const lfoFilt = (s(b + 72) || s(b + 87)) ? 1 : 2; // the filter LFO: LFO 1 if a filter uses it, else LFO 2
    O.flfo = lfoFilt === 1 ? Object.assign({}, l1) : l2;
    const filt = (o, reso) => { const kbd = s(o + 1) / 99; return { cut: c99(u(o)), gain: c99(u(b + 57)), reso: reso, resoVel: 0, egInt: s(o + 6), egVel: s(o + 7),
      lfoInt: lfoFilt === 1 ? s(o + 8) : s(o + 9), jsx: 0, at: 0, lowKey: kt[0], highKey: kt[2], lowRamp: Math.round(kt[1] * kbd), highRamp: Math.round(kt[3] * kbd), amsSrc: ams(o + 2), amsInt: s(o + 3) }; };
    O.f = [filt(b + 64, hp ? 0 : Math.round(c99(u(b + 58)) * 31 / 99)), filt(b + 79, 0)];
    O.flfoMod = { jsyn: c99(Math.abs(s(b + 74 + (lfoFilt - 1)))), at: 0, amsSrc: ams(b + 62 + (lfoFilt - 1)), amsInt: s(b + 77 + (lfoFilt - 1)) };
    const eg = o => ({ startL: s(o), atkT: c99(u(o + 1)), atkL: s(o + 2), decT: c99(u(o + 3)), brkL: s(o + 4), slpT: c99(u(o + 5)), susL: s(o + 6), relT: c99(u(o + 7)) });
    O.feg = Object.assign(eg(b + 94), { relL: s(b + 102), kt: [0, 0, 0, 0], vt: [0, 0, 0, 0], tSrc: ams(b + 106), tInt: s(b + 107), lv: [0, 0, 0] });
    O.fegAms = { src: ams(b + 110), int: s(b + 111) };
    // amplifier (346-377): levels of the amp EG are 0-99 here
    O.amp = { level: u(b + 116) & 127, lowKey: u(b + 144) & 127, highKey: u(b + 146) & 127, lowRamp: s(b + 145), highRamp: s(b + 147), vel: s(b + 117), at: 0, amsSrc: ams(b + 118), amsInt: s(b + 119) };
    const ae = eg(b + 126); for (const q of ['startL', 'atkL', 'brkL', 'susL']) ae[q] = c99(u(b + 126 + { startL: 0, atkL: 2, brkL: 4, susL: 6 }[q]));
    O.aeg = Object.assign(ae, { kt: [0, 0, 0, 0], vt: [0, 0, 0, 0], tSrc: ams(b + 134), tInt: s(b + 135), lv: [0, 0, 0] });
    if (O.amp.amsSrc === 'off' && (s(b + 120) || s(b + 121))) { O.amp.amsSrc = s(b + 120) ? 'olfo' : 'flfo'; O.amp.amsInt = s(b + 120) || s(b + 121); }
    // output (378-383): pan 0 = random
    const pan = u(b + 149) & 127; O.pan = pan || 64; if (!pan && audible) notes.push('OSC ' + (k + 1) + ' pan is Random on the Triton; centre here');
    O.panSrc = ams(b + 150); O.panInt = s(b + 151); O.send1 = u(b + 152) & 127; O.send2 = u(b + 153) & 127;
  };
  osc(230, 0); osc(384, 1);
  X.voice.bendUp = X.o[0].pitch.jsUp; X.voice.bendDown = X.o[0].pitch.jsDown;
  if (Object.keys(ramUsed).length) X.ramMap = ramUsed;
  if (ramMiss.size) { X.ramMap = X.ramMap || {}; ramMiss.forEach(n => { X.ramMap[n] = korgFallback(); }); notes.push('Plays RAM multisample' + (ramMiss.size > 1 ? 's ' : ' ') + [...ramMiss].join(', ') + ', which ' + (ramMiss.size > 1 ? 'are' : 'is') + ' not among the loaded samples (fallback: ' + korgFallbackName() + ')'); }
  if (romMiss.size) notes.push('Plays Triton ' + [...romMiss].join(', ') + ' (Triton multisamples are not mapped yet; fallback: ' + korgFallbackName() + ')');
  if (mode === 'drum') notes.push('Drum-mode program: not supported');
  X.fx = korgDecodeTritonFx(r.subarray(16, 211), notes);
  X.fx.send1 = X.fx.ifxSend1 = X.fx.ins.length ? X.fx.ifxSend1 : X.o[0].send1;
  X.fx.send2 = X.fx.ins.length ? X.fx.ifxSend2 : X.o[0].send2;
  if (!X.fx.ins.length) X.fx.ifxSend2 = X.fx.send2;
  X.korgInfo = { kind: 'pcm', fmt: 'triton', notes, missing: { rom: romMiss.size, ram: ramMiss.size } };
  return X;
}

// ---- one combination (388 bytes): 8 timbres ----
// Which timbres go through which insert effects. Each timbre's byte 254 is 0 = no insert effect, 1/2/3 = the
// timbre takes an insert chain of size 1/2/4 (Korg's list), 4 = a chain using all the blocks it needs (seen only on a
// single timbre, with up to 8 units), 5..12 = the timbre shares the chain of timbre 1..8. Korg documents only
// 0..3 and "4..B = Timbre 1..8"; the user files fit the reading above (value - 4 = timbre number) far better, so
// it is used here. Chains take the used blocks in order; with two chains and both halves of the 8 blocks in use,
// the first takes blocks 1-4 and the second blocks 5-8.
function korgCombiChains(C) {
  const T = C.timbres, B = C.ifxBlocks, REQ = [0, 1, 2, 4, 8];
  const owners = [], chains = [];
  T.forEach((t, k) => { t.chain = -1; if (t.status !== 'off' && t.ifx >= 1 && t.ifx <= 4) owners.push(k); });
  const used = [], sz = k => B[k].size;
  for (let k = 0; k < 8; k++) if (sz(k)) used.push(k);
  const sumOf = ks => ks.reduce((a, k) => a + sz(k), 0), half = (a, b) => used.filter(k => k >= a && k < b);
  let lists;
  if (owners.length === 2 && half(0, 4).length && half(4, 8).length && sumOf(half(0, 4)) <= REQ[T[owners[0]].ifx]) lists = [half(0, 4), half(4, 8)];
  else {
    lists = []; let i = 0;
    for (const k of owners) { const want = REQ[T[k].ifx], got = []; let acc = 0; while (i < used.length && acc < want) { got.push(used[i]); acc += sz(used[i]); i++; } lists.push(got); }
  }
  owners.forEach((k, j) => {
    const ks = lists[j] || [];
    const last = ks.length ? B[ks[ks.length - 1]] : null;
    chains.push({ owner: k, blocks: ks, pan: last ? (last.pan > 127 ? -1 : last.pan) : 64, width: last ? Math.min(127, last.width) : 127, send1: last ? Math.min(127, last.send1) : 0, send2: last ? Math.min(127, last.send2) : 0 });
    T[k].chain = j;
  });
  T.forEach(t => { if (t.status !== 'off' && t.ifx >= 5 && t.ifx <= 12) { const o = T[t.ifx - 5]; if (o && o.chain >= 0) t.chain = o.chain; } });
  chains.forEach(c => { c.timbres = T.map((t, k) => (t.chain === chains.indexOf(c) ? k : -1)).filter(k => k >= 0); });
  return chains;
}
function korgDecodeCombi(r, userScale) {
  const notes = [], s = korgS8, T = [];
  for (let n = 0; n < 8; n++) {
    const b = 236 + n * 19, fl = r[b + 11];
    T.push({ prog: r[b] & 127, bank: r[b + 1], ch: r[b + 2] & 31, status: ['int', 'off', 'ext', 'both'][(r[b + 2] >> 5) & 3], level: r[b + 3] & 127,
      bend: s(r[b + 4]) === -25 ? null : s(r[b + 4]), transpose: s(r[b + 5]), detune: s(r[b + 6]), delay: KORG_PCM.delayMs(r[b + 7]),
      pan: r[b + 8] === 255 ? -1 : r[b + 8] === 128 ? 'prog' : r[b + 8] & 127, send1: r[b + 9] === 128 ? 'prog' : r[b + 9] & 127, send2: r[b + 10] === 128 ? 'prog' : r[b + 10] & 127,
      scaleProg: (fl >> 4) & 1, hideOsc2: (fl >> 5) & 1, forcePoly: (fl >> 6) & 1,
      rxPC: fl & 1, rxDamper: (fl >> 1) & 1, rxAT: (fl >> 2) & 1, rxCC: (fl >> 3) & 1, // MIDI filters: 1 = the timbre receives it
      keyTop: r[b + 12] & 127, keyBot: r[b + 13] & 127, keySlopeTop: KORG_PCM.KEY_SLOPE[r[b + 14] & 15], keySlopeBot: KORG_PCM.KEY_SLOPE[r[b + 14] >> 4],
      velTop: Math.max(1, r[b + 15] & 127), velBot: Math.max(1, r[b + 16] & 127), velSlopeTop: (r[b + 17] & 15) * 8, velSlopeBot: (r[b + 17] >> 4) * 8, ifx: r[b + 18] });
  }
  const scType = r[17] >> 4;
  const C = { kind: 'combi', name: korgName(r) || 'Untitled', cat: r[16] & 15, catB: r[16] >> 4, timbres: T,
    scale: { type: KORG_PCM.SCALE[scType] || 'equal', key: (r[17] & 15) % 12, user: (userScale || new Array(12).fill(0)).slice() }, random: r[18] & 7, sw: [r[19] >> 4, r[19] & 15] };
  C.ifxBlocks = [];
  for (let k = 0; k < 8; k++) { const b = 20 + k * 22; C.ifxBlocks.push({ size: [0, 1, 2, 4][r[b + 17] & 3], type: r[b + 16] & 63, on: (r[b + 16] >> 6) & 1, cascade: r[b + 16] >> 7, pan: r[b + 18], width: r[b + 19], send1: r[b + 20], send2: r[b + 21] }); }
  // each insert block decoded on its own (null = unused or an unknown type)
  C.blocks = C.ifxBlocks.map((B, k) => {
    if (!B.size) return null;
    const id = 'S' + B.size + ':' + B.type;
    if (!TFX.byId(id)) { notes.push('Insert effect ' + (k + 1) + ' has an unknown type (size ' + B.size + ', number ' + B.type + ') and was left out'); return null; }
    return { on: B.on, type: id, p: TFX.decode(id, r.subarray(20 + k * 22, 20 + k * 22 + 16)).p };
  });
  C.chains = korgCombiChains(C);
  C.fx = korgDecodeFxBlocks(r, [], 196, notes); // the master effects and EQ (the insert chains are in C.chains)
  C.korgInfo = { kind: 'combi', notes };
  C.korg = Array.from(r);
  return C;
}

if (typeof module !== 'undefined') module.exports = { korgFallback, korgFallbackName, korgDecodeTrinityFx, KORG, korgParsePCG, korgParseTritonPCG, korgTritonToTrinity, korgDecodeMoss, korgPlayability, korgS8, korgName, KORG_PCM, korgTrinitySections, korgDecodeFxBlocks, korgDecodePcm, korgDecodeCombi, korgCombiChains, KORG_TRITON_PCM, korgTritonGlobal, korgTritonSections, korgDecodeTritonPcm };
