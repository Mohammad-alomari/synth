// ===== MOSS-style DSP engine (runs in AudioWorklet or ScriptProcessor) =====
// Parameter ranges follow Korg's EXB-MOSS / Z1 documentation (0..99, -99..+99).
// Internal curves (times, Hz mappings, filter/shaper maths) are our own approximations.

class MD {
  static clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  static lvl(v) { v = v < 0 ? 0 : v > 99 ? 99 : v; const x = v / 99; return x * x; }
  static tsec(v) { if (v <= 0) return 0; return 0.0008 * Math.exp((v > 99 ? 99 : v) * 0.1063); }
  static lfoHz(v) { v = v < 0 ? 0 : v > 199 ? 199 : v; return 0.01 * Math.exp(v * 0.043717); }
  static cutHz(v) { return 20 * Math.pow(2, v * 0.1010101); }
  static kReso(r) { r = r < 0 ? 0 : r > 99 ? 99 : r; const x = r / 99; return 2 * (1 - Math.pow(x, 0.6)) + 0.004 - 0.02 * Math.pow(x, 24); }
  static sat(x) { const a = x < 0 ? -x : x; if (a <= 1.2) return x; const y = 1.2 + MD.tanh(a - 1.2); return x < 0 ? -y : y; }
  static midiHz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  static tanh(x) { if (x > 3) return 1; if (x < -3) return -1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
  static fold(x) { x = (x + 1) * 0.25; x = x - Math.floor(x); x *= 4; return (x > 2 ? 4 - x : x) - 1; }
  static tri0(p) { return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; }
  static pitchScale(a) { const x = a / 99; return (x < 0 ? -12 : 12) * x * x; }
  static edgeCoef(edge, sr) { if (edge >= 99) return 1; const fc = 200 * Math.pow(100, edge / 99); return 1 - Math.exp(-2 * Math.PI * Math.min(fc, sr * 0.45) / sr); }
  // integer forms used in the per-sample code: wave 0 saw, 1 square, 2 triangle, 3 sine; input 0 other OSC, 1 sub, 2 noise, 3 filter 1, 4 filter 2
  static wI(kind) { return kind === 'saw' ? 0 : kind === 'square' ? 1 : kind === 'tri' ? 2 : 3; }
  static waveI(k, p) { return k === 0 ? 2 * p - 1 : k === 1 ? (p < 0.5 ? 1 : -1) : k === 2 ? 1 - 4 * Math.abs(p - 0.5) : Math.sin(6.283185307179586 * p); }
  static inI(sel) { return sel === 'osc' ? 0 : sel === 'sub' ? 1 : sel === 'noise' ? 2 : sel === 'f1' ? 3 : sel === 'f2' ? 4 : -1; }
  static discs(kind) { // shared constant tables: callers must not modify them
    const D = MD._d || (MD._d = { saw: [[0, -2]], square: [[0, 2], [0.5, -2]], none: [] });
    return kind === 'saw' ? D.saw : kind === 'square' ? D.square : D.none;
  }
}

// ---------- Envelope: Start > Attack > Break (decay) > Sustain (slope) > Release ----------
class MossEG {
  constructor() { this.stage = 0; this.val = 0; this.from = 0; this.t = 0; this.ls = 1; this.ts = 1; this.lm = 1; this.tm = [1, 1, 1, 1]; }
  trigger(p, isAmp, vel, legato) {
    const vc = p.vel || 0;
    this.ls = vc >= 0 ? 1 - (vc / 99) * (1 - vel) : 1 - (-vc / 99) * vel;
    const vt = p.velTime || 0;
    this.ts = Math.pow(2, -(vt / 99) * (2 * vel - 1) * 1.5);
    if (legato && this.stage > 0 && this.stage < 5) return;
    this.p = p; this.isAmp = isAmp;
    if (isAmp) this.from = this.stage === 0 ? 0 : this.val;
    else this.from = (p.startL || 0) / 99 * this.ls;
    this.val = this.from;
    this.stage = 1; this.t = 0;
  }
  release() { if (this.stage > 0 && this.stage < 5) { this.stage = 5; this.t = 0; this.from = this.val; } }
  kill() { this.stage = 0; this.val = 0; }
  target(st) {
    const p = this.p, s = this.ls * this.lm;
    if (st === 1) return p.atkL / 99 * s;
    if (st === 2) return p.brkL / 99 * s;
    if (st === 3 || st === 4) return MD.clamp((p.susL + (this.susOff || 0)) / 99, -1, 1) * s;
    return this.isAmp ? 0 : (p.relL || 0) / 99 * s;
  }
  dur(st) {
    const p = this.p, o = this.timeOff || [0, 0, 0, 0];
    const v = st === 1 ? p.atkT + o[0] : st === 2 ? p.decT + o[1] : st === 3 ? p.slpT + o[2] : p.relT + o[3];
    return MD.tsec(v) * this.ts * this.tm[st === 5 ? 3 : st - 1]; // tm = attack, decay, slope, release
  }
  tick(dtb) {
    let guard = 0;
    while (guard++ < 6) {
      const st = this.stage;
      if (st === 0 || st === 6) return this.val;
      if (st === 4) { this.val = this.target(4); return this.val; }
      const T = this.dur(st), tg = this.target(st);
      if (T <= 0) { this.val = tg; this.adv(); continue; }
      this.t += dtb;
      if (this.t >= T) { this.val = tg; this.adv(); return this.val; }
      const r = this.t / T;
      if (st === 1) this.val = this.from + (tg - this.from) * r;
      else this.val = tg + (this.from - tg) * Math.exp(-5 * r) * (1 - r * 0.0067);
      return this.val;
    }
    return this.val;
  }
  adv() {
    this.from = this.val; this.t = 0;
    if (this.stage === 5) { this.stage = this.isAmp ? 0 : 6; return; }
    if (this.stage < 4) this.stage++;
  }
}

// ---------- LFO (18 waveforms from the MOSS list) ----------
class MossLFO {
  constructor(seed) { this.ph = 0; this.seed = seed || 12345; this.r0 = 0; this.r1 = 0; this.last = 0; this.half = 0; }
  rnd() { let x = this.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x; return (x >>> 0) / 4294967296 * 2 - 1; }
  copyFrom(g) { this.ph = g.ph; this.r0 = g.r0; this.r1 = g.r1; this.last = g.last; this.half = g.half; }
  reset(wave) { this.ph = wave === 'trirnd' ? (this.rnd() + 1) / 2 : 0; this.r0 = this.rnd(); this.r1 = this.rnd(); this.half = 0; }
  step(hz, dtb, wave) {
    const prev = this.ph;
    this.ph += hz * dtb;
    if (this.ph >= 1) { this.ph -= Math.floor(this.ph); this.r0 = this.rnd(); }
    const h = this.ph < 0.5 ? 0 : 1;
    if (h !== this.half || (this.ph < prev)) { this.half = h; this.last = this.r1; this.r1 = this.rnd(); }
    const p = this.ph;
    switch (wave) {
      case 'tri90': return MD.tri0((p + 0.25) % 1);
      case 'sawup0': return 2 * ((p + 0.5) % 1) - 1;
      case 'sawup180': return 2 * p - 1;
      case 'sawdn0': return 1 - 2 * ((p + 0.5) % 1);
      case 'sawdn180': return 1 - 2 * p;
      case 'square': return p < 0.5 ? 1 : -1;
      case 'sine': return Math.sin(6.283185307179586 * p);
      case 'stri4': return MD.tri0(Math.floor(p * 8) / 8);
      case 'stri6': return MD.tri0(Math.floor(p * 12) / 12);
      case 'ssaw4': return Math.floor(p * 4) / 3 * 2 - 1;
      case 'ssaw6': return Math.floor(p * 6) / 5 * 2 - 1;
      case 'rndsh': return this.r0;
      case 'rndvec': { const f = (p % 0.5) * 2; return this.last + (this.r1 - this.last) * f; }
      case 'expsawup': return (Math.exp(3 * p) - 1) / 19.0855 * 2 - 1;
      case 'expsawdn': return (Math.exp(3 * (1 - p)) - 1) / 19.0855 * 2 - 1;
      case 'exptri': { const t = 1 - 2 * Math.abs(p - 0.5); return (Math.exp(3 * t) - 1) / 19.0855 * 2 - 1; }
      default: return MD.tri0(p); // tri0 / trirnd
    }
  }
}

// ---------- Voice ----------
class MossVoice {
  constructor(sr, idx) {
    this.sr = sr; this.idx = idx; this.active = false; this.note = 60; this.vel = 1; this.gate = false;
    this.egs = [new MossEG(), new MossEG(), new MossEG(), new MossEG(), new MossEG()];
    this.lfos = [0, 1, 2, 3].map(i => new MossLFO(1000 + idx * 77 + i * 13));
    this.lfoT = 0; this.seed = 22222 + idx * 999;
    this.osc = [this.mkOsc(), this.mkOsc()];
    this.sub = { ph: 0, pend: 0 };
    this.nz = { a: 0, b: 0 };
    this.flt = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.prevF1 = 0; this.prevF2 = 0; this.prevAmp = 0; this.prevO1 = 0; this.prevO2 = 0;
    this.g1 = 0; this.g2 = 0; this.pl = 0.707; this.pr = 0.707;
    this.silent = 0; this.fading = false; this.fadeG = 1; this.pitch = 60; this.target = 60; this.detune = 0; this.age = 0;
    this.src = new Float64Array(40); this.dst = new Float64Array(64); this.glideSpan = 0;
    this.bc = [this.mkBc(), this.mkBc()]; this.oy = new Float64Array(2); this.io = new Float64Array(4);
    // per-oscillator mod slots (made once, not per block). Slots 0 and 1 are the classic Mod A/B: the importer, the Mod
    // page and the presets route them as o1A/o1B (o2A/o2B), so those routes must reach the physical models' slot 0/1 too
    this.Mf = [k => k < 2 ? this.dst[5 + k] + this.dst[43 + k] : this.dst[43 + k], k => k < 2 ? this.dst[7 + k] + this.dst[51 + k] : this.dst[51 + k]];
    // caches: a value is only recomputed when its input changes (same function, same input, same result)
    this.lfF = new Float64Array(4).fill(NaN); this.lfH = new Float64Array(4); this.lfFv = new Float64Array(4).fill(NaN); this.lfFs = new Float64Array(4);
    this.nzX = NaN; this.nzR = NaN; this.subS = NaN; this.subH = 0;
    // per-block working storage, reused so the audio thread allocates nothing while playing
    this.ncB = new Float64Array(4); this.mg = new Float64Array(10);
    this.fl = [0, 1].map(() => ({ ft: 0, ca: new Float64Array(4), cb: new Float64Array(4), trA: 0, trB: 0, xa: NaN, ra: NaN, xb: NaN, rb: NaN }));
  }
  static get CAL() { return MossVoice._cal || (MossVoice._cal = { bowed: 0, clar: -0.5, sax: -0.5, fluteK: 1.993, pluck: 0, reedMod: 0.06, bowMinPos: 0.1, bowSpeed: 0.45, bowDisp: 0.6, bowNoise: 0.35, rosinK: 0.09, bowedGain: 3.0, reedGain: 0.7, pluckGain: 8, brassGain: 0.3, epGain: 2, organGain: 0.5 }); }
  // Reed Inst Types: [architecture 0 cylindrical / 1 conical / 2 jet, max breath, reed offset, reed slope, noise scale, split]
  static get REED() {
    return MossVoice._reed || (MossVoice._reed = [
      [1, 1.00, 0.70, 0.30, 0.30, 0.35], [1, 1.05, 0.68, 0.32, 0.30, 0.40], [1, 1.10, 0.66, 0.34, 0.35, 0.45], // Hard Sax 1-3
      [1, 0.90, 0.72, 0.28, 0.25, 0.32], [1, 0.85, 0.74, 0.26, 0.25, 0.30],                                   // Soft Sax 1-2
      [1, 1.00, 0.64, 0.36, 0.20, 0.38], [1, 1.05, 0.62, 0.38, 0.25, 0.42], [1, 0.95, 0.70, 0.30, 0.20, 0.29], // Double Reed 1-2, Bassoon
      [0, 0.90, 0.70, -0.30, 0.20, 0],                                                                        // Clarinet
      [2, 1.30, 0, 0, 0.30, 0.27], [2, 1.35, 0, 0, 0.45, 0.27], [2, 1.30, 0, 0, 0.60, 0.265],                  // Flute 1-2, Pan Flute
      [2, 1.25, 0, 0, 0.20, 0.27], [2, 1.40, 0, 0, 0.80, 0.265],                                               // Ocarina, Shakuhachi
      [0, 0.85, 0.75, -0.25, 0.10, 0], [0, 0.90, 0.73, -0.28, 0.10, 0], [0, 1.00, 0.60, -0.40, 0.05, 0]       // Harmonica 1-2, Reed Synth
    ]);
  }
  // measured sounding windows per Reed Inst Type: [centre breath, centre shift per unit of reed offset, half width, highest breath that still speaks]
  static get REEDWIN() { return MossVoice._rw || (MossVoice._rw = [[0.775, -2, 0.2], [0.775, -2, 0.2], [0.775, -2, 0.2], [0.825, -4.25, 0.15], [0.912, -5.12, 0.15, 1.0], [0.775, -2, 0.2], [0.763, -1.63, 0.2], [0.838, -3.87, 0.2], [0.825, -4.25, 0.15], [1.1, 0, 0.25], [1.1, 0, 0.25], [1.1, 0, 0.25], [1.1, 0, 0.25], [1.1, 0, 0.25], [0.912, -5.12, 0.15, 1.0], [0.813, -4.37, 0.15], [0.75, -1.75, 0.2]]); }
  mkBc() {
    const d = [[0, 0], [0, 0]];
    return { type: '', ti: -1, discs: d, dbuf: d, nd: 0, semC: NaN, hzC: 0, edgeC: NaN, ecC: 1, bands: [0, 1, 2, 3].map(() => ({ i: 0, a1: 0, a2: 0, a3: 0, k: 0, out: 0 })), nb: 0,
      eqB: new Float64Array(5), hpB: new Float64Array(4), lscB: new Float64Array(5), bstB: new Float64Array(5) };
  }
  // oscillator type -> small integer for the per-sample switch
  static get TI() { return MossVoice._ti || (MossVoice._ti = { standard: 0, comb: 1, vpm: 2, reso: 3, ring: 4, cross: 5, sync: 6, bowed: 7, reed: 8, pluck: 9, organ: 10, epiano: 11, brass: 12 }); }
  static get VPMR() { return MossVoice._vr || (MossVoice._vr = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]); }
  static get RKEY() { return MossVoice._rk || (MossVoice._rk = [0, 1, 2, 3].map(b => ['r' + b + 'Lvl', 'r' + b + 'Harm', 'r' + b + 'Fine', 'r' + b + 'Reso'])); }
  mkOsc() { return { type: '', ph: 0, ph2: 0, pend: 0, e: 0, buf: new Float32Array(8192), w: 0, w2: 0, lp: 0, lp2: 0, lpx: 0, apx: 0, apy: 0, burst: 0, bp: new Float64Array(8), y: 0, prevIn: 0, dcx: 0, dcy: 0, eq: new Float64Array(8), spdPrev: null, exI: 0, exN: 0, exA: 0, exUp: 1, exDn: 1, exNz: 0, epX: 0, epF: 0 }; }
  // Brass Model instrument types: [lip brightness (pulse sharpness at full pressure), bore low-pass, bore feedback, odd-harmonic bore, output trim]
  static get BRASS() {
    return MossVoice._brass || (MossVoice._brass = [
      [22, 0.18, 0.80, 0, 1.00],  // Brass 1: bright, trumpet-like
      [16, 0.28, 0.82, 0, 1.05],  // Brass 2
      [11, 0.40, 0.86, 0, 1.10],  // Brass 3: darker, trombone-like
      [6, 0.58, 0.88, 0, 1.25],   // Horn 1: dark, round
      [8, 0.50, 0.86, 0, 1.20],   // Horn 2
      [14, 0.30, 0.80, 1, 1.00]   // ReedBrass: odd-harmonic (closed) bore
    ]);
  }
  // mean and 1/rms of the lip pulse exp(k(cos - 1)) for k = 0..48 in steps of 0.25 (built on first use)
  static get BPULSE() {
    if (MossVoice._bp) return MossVoice._bp;
    const n = 193, t = new Float64Array(n * 2), M = 512;
    for (let j = 0; j < n; j++) {
      const k = j * 0.25; let s = 0, s2 = 0;
      for (let i = 0; i < M; i++) { const v = Math.exp(k * (Math.cos(2 * Math.PI * i / M) - 1)); s += v; s2 += v * v; }
      const m = s / M, v = Math.max(s2 / M - m * m, 1e-12);
      t[j * 2] = m; t[j * 2 + 1] = 1 / Math.sqrt(v);
    }
    return (MossVoice._bp = t);
  }
  rnd() { let x = this.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x; return (x >>> 0) / 4294967296 * 2 - 1; }
  start(eng, note, vel, detune, legato, glideFrom) {
    const P = eng.patch;
    this.note = note; this.vel = vel; this.gate = true; this.detune = detune;
    this.target = note;
    if (glideFrom !== null && glideFrom !== undefined) this.pitch = glideFrom; else this.pitch = note;
    this.glideSpan = Math.abs(this.target - this.pitch);
    for (const o of this.osc) o.jb = undefined; // Jump Bend starts from the joystick's current position
    if (!legato) {
      this.randOff = (P.voice.random || 0) / 99 * 0.5 * this.rnd();
      const perc = eng.percussionOK();
      for (let i = 0; i < 2; i++) {
        const o = this.osc[i]; o.burst = this.burstLen(P.osc[i].p); o.bp.fill(0); o.lp = 0; o.lp2 = 0; o.lpx = 0; o.apx = 0; o.apy = 0; o.buf.fill(0); o.y = 0; o.eq.fill(0); o.spdPrev = null; o.dcx = 0; o.dcy = 0;
        this.pluckExcite(o, P.osc[i], vel); this.epExcite(o, P.osc[i], vel);
        if (P.osc[i].type === 'organ') o.eq[3] = (P.osc[i].p.ogTrig || perc) ? 1 : 0; // percussion: Multi on every note, Single only from silence
      }
      if (!this.active) { this.flt[0].fill(0); this.flt[1].fill(0); this.g1 = 0; this.g2 = 0; this.prevAmp = 0; }
      for (let i = 0; i < 4; i++) { const L = P.lfo[i]; if (L.sync === 'voice') this.lfos[i].reset(L.wave); else this.lfos[i].copyFrom(eng.glfo[i]); }
      this.lfoT = 0;
    }
    for (let i = 0; i < 4; i++) this.egs[i].trigger(P.eg[i], false, vel, legato);
    this.egs[4].trigger(P.ampEG, true, vel, legato);
    this.active = true; this.silent = 0; this.age = eng.clock++; this.fading = false; this.fadeG = 1;
  }
  burstLen(p) { return 1 + Math.floor(Math.pow((p.cPw || 0) / 99, 2) * 0.02 * this.sr); }
  release() { this.gate = false; for (const e of this.egs) e.release(); }
  kill() { this.active = false; this.gate = false; for (const e of this.egs) e.kill(); }

  // modulation sources, per block
  computeSources(eng, P, dtb) {
    const s = this.src, c = eng.ctl, cc = eng.cc, v = this.vel, n = this.note;
    // performance sources (Korg AMS list order is mapped onto these slots by the importer)
    s[0] = 0; s[10] = v; s[11] = (n - 60) / 60; s[12] = c.at; s[13] = c.jsy; s[14] = c.jsyn;
    s[15] = c.jsx; s[16] = c.ribbon; s[17] = c.foot; s[18] = c.sw1; s[19] = c.sw2;
    s[20] = this.glideSpan > 1e-3 ? MD.clamp(Math.abs(this.target - this.pitch) / this.glideSpan, 0, 1) : 0;
    s[21] = Math.sqrt(v); s[22] = v * v;
    const kx = (n - 60) / 60; s[23] = kx * (kx < 0 ? -kx : kx);
    s[24] = n >= 60 ? 1 : 0; s[25] = n < 60 ? 1 : 0; s[26] = Math.min(1, c.at + c.jsy);
    s[27] = c.ribbon > 0 ? c.ribbon : 0; s[28] = c.ribbon < 0 ? -c.ribbon : 0; s[29] = c.ribZ || 0;
    s[30] = (cc[18] || 0) / 127; s[31] = (cc[19] || 0) / 127; s[32] = (cc[82] || 0) >= 64 ? 1 : 0; s[33] = (cc[83] || 0) / 127;
    s[34] = (cc[17] || 0) / 127; s[35] = (cc[20] || 0) / 127; s[36] = (cc[21] || 0) / 127;
    // routing indices come pre-resolved from MossEngine.compile(): -1 = no source assigned
    const C = eng.cEG;
    for (let i = 0; i < 5; i++) {
      const eg = this.egs[i], p = i < 4 ? P.eg[i] : P.ampEG, j = i * 3;
      eng.applyEgOffsets(eg);
      let lm = 1;
      if (C[j] >= 0 && p.lvlInt) { const x = MD.clamp(s[C[j]], 0, 1), k = p.lvlInt / 99; lm = k >= 0 ? 1 - k * (1 - x) : 1 + k * x; }
      eg.lm = lm;
      const t = C[j + 1] >= 0 ? s[C[j + 1]] * (p.tInt || 0) : 0;
      const nd = C[j + 2] >= 0 ? s[C[j + 2]] : 0;
      const tm = eg.tm;
      if (t === 0 && nd === 0) { tm[0] = 1; tm[1] = 1; tm[2] = 1; tm[3] = 1; }
      else {
        tm[0] = Math.pow(2, -(t + nd * (p.nAt || 0)) / 16.5); tm[1] = Math.pow(2, -(t + nd * (p.nDc || 0)) / 16.5);
        tm[2] = Math.pow(2, -(t + nd * (p.nSl || 0)) / 16.5); tm[3] = Math.pow(2, -(t + nd * (p.nRl || 0)) / 16.5);
      }
      s[i < 4 ? 1 + i : 5] = eg.tick(dtb);
    }
    this.lfoT += dtb;
    const CL = eng.cLFO;
    for (let i = 0; i < 4; i++) {
      const L = P.lfo[i], j = i * 3;
      let f = L.freq + eng.lfoRateMod + this.dst[35 + i];
      if (CL[j] >= 0) f += s[CL[j]] * (L.fm1Int || 0);
      if (CL[j + 1] >= 0) f += s[CL[j + 1]] * (L.fm2Int || 0);
      let hz;
      if (L.msync) hz = eng.syncHz(L); else { if (f !== this.lfF[i]) { this.lfF[i] = f; this.lfH[i] = MD.lfoHz(f); } hz = this.lfH[i]; }
      let val = this.lfos[i].step(hz, dtb, L.wave);
      const o = (L.offset || 0) / 50;
      val = (val + o) / (1 + Math.abs(o));
      const fv = L.fade || 0; if (fv !== this.lfFv[i]) { this.lfFv[i] = fv; this.lfFs[i] = MD.tsec(fv); }
      const fade = this.lfFs[i];
      const fg = fade > 0 ? Math.min(1, this.lfoT / fade) : 1;
      // Prophecy/Z1-style amplitude AMS: once a source is assigned, depth = source x intensity
      const am = (CL[j + 2] >= 0 && L.amInt) ? MD.clamp(s[CL[j + 2]] * L.amInt / 99, -1, 1) : 1;
      s[6 + i] = val * fg * am * eng.lfoAmp[i];
    }
  }
  computeDests(eng) {
    const d = this.dst; d.fill(0);
    const s = this.src, M = eng.cMods, n = eng.cModsN;
    for (let k = 0; k < n; k += 4) {
      let v = s[M[k]];
      if (M[k + 1] >= 0) v *= s[M[k + 1]];
      d[M[k + 2]] += v * M[k + 3];
    }
  }

  // ---- per-block oscillator setup ----
  setupOsc(eng, P, i, semisBase, pb) {
    const O = P.osc[i], p = O.p, o = this.osc[i], bc = this.bc[i], sr = this.sr, d = this.dst;
    if (o.type !== O.type) { o.type = O.type; o.ph = 0; o.ph2 = 0; o.pend = 0; o.e = 0; o.buf.fill(0); o.lp = 0; o.bp.fill(0); o.y = 0; o.dcx = 0; o.dcy = 0; }
    const n = this.pitch;
    const c = O.slopeCenter === undefined ? 60 : O.slopeCenter;
    const slope = n < c ? (n - c) * (O.slopeLow === undefined ? 1 : O.slopeLow) : (n - c) * (O.slopeHigh === undefined ? 1 : O.slopeHigh);
    let semis = c + slope + O.octave * 12 + O.transpose + O.tune / 100 + semisBase + d[1] + d[2 + i];
    // Reed / Brass "Jump Bend" (bit 0 = joystick +X, bit 1 = -X): bending in that direction moves in semitone jumps,
    // like overblowing or changing the fingering, with a quick 15 ms move to each new step (estimate)
    const jmp = O.type === 'reed' ? p.rdJump : O.type === 'brass' ? p.brJump : 0;
    if (jmp) {
      const on = (pb > 0 && (jmp & 1)) || (pb < 0 && (jmp & 2)), tgt = on ? Math.round(pb) : pb;
      o.jb = on && o.jb !== undefined ? o.jb + (tgt - o.jb) * (1 - Math.exp(-(this._dtb || 0) / 0.015)) : tgt;
      semis += o.jb - pb;
    }
    const mb = 43 + i * 8, M = this.Mf[i];
    const A = (d[5 + i * 2] + d[mb]) / 99, B = (d[6 + i * 2] + d[mb + 1]) / 99;
    bc.type = O.type; { const ti = MossVoice.TI[O.type]; bc.ti = ti === undefined ? -1 : ti; } bc.A = A; bc.B = B; bc.lvlMul = MD.lvl(99 + d[9 + i]);
    if (O.type === 'sync') semis += A * 48;
    if (semis !== bc.semC) { bc.semC = semis; bc.hzC = MD.midiHz(semis); }
    let hz = bc.hzC + (O.foffset || 0);
    const dt = MD.clamp(hz / sr, -0.45, 0.45);
    bc.dt = dt; bc.hz = hz;
    const t = O.type;
    if (t === 'standard') {
      let lf = 0; const wl = p.wfLfo, li = wl === 'lfo1' ? 6 : wl === 'lfo2' ? 7 : wl === 'lfo3' ? 8 : wl === 'lfo4' ? 9 : 0; if (li) lf = this.src[li];
      const w = MD.clamp((p.wform + lf * p.wfInt) / 99 + A, -1, 1);
      bc.w = w; bc.main = p.wave; bc.pulse = p.wave === 'pulse';
      const D = bc.dbuf; bc.discs = D; bc.nd = 2;
      if (p.wave === 'pulse') { bc.pd = 0.5 * (1 - Math.abs(w)); bc.ps = w < 0 ? -1 : 1; if (bc.pd < 1e-4) bc.nd = 0; else { D[0][0] = 0; D[0][1] = -2 * bc.ps; D[1][0] = 1 - bc.pd; D[1][1] = 2 * bc.ps; } }
      else { D[0][0] = 0; D[0][1] = -2; D[1][0] = 0.5; D[1][1] = -2 * w; }
      bc.mainL = MD.lvl(p.level); bc.triL = MD.lvl(p.tri); bc.sinL = MD.lvl(p.sine); bc.pshift = ((p.phase || 0) / 99 * 0.5 + 1) % 1;
      if (p.edge !== bc.edgeC) { bc.edgeC = p.edge; bc.ecC = MD.edgeCoef(p.edge, sr); } bc.ec = bc.ecC;
      bc.shIn = MD.clamp(p.shIn / 99 + B, 0, 1) * 2; bc.shType = p.shType; bc.shReso = p.shType === 'reso'; bc.shOff = p.shOffset / 99; bc.shK = MD.clamp((p.shShape + M(2)) / 99, 0, 1); bc.shBal = MD.clamp((p.shBal + M(3)) / 99, 0, 1);
      bc.gfold = 1 + 2 * Math.abs(w); bc.tsign = w < 0 ? -1 : 1;
    } else if (t === 'comb') {
      const fbv = MD.clamp(p.cFb + A * 99, 0, 99);
      bc.fb = 0.999 * Math.sqrt(fbv / 99);
      const a = MD.clamp(p.cDamp / 99 + B, 0, 1) * 0.95; bc.a = a;
      const w0 = 2 * Math.PI * Math.max(hz, 5) / sr;
      const pdl = a > 0 ? Math.atan2(a * Math.sin(w0), 1 - a * Math.cos(w0)) / w0 : 0;
      bc.L = MD.clamp(sr / Math.max(hz, 5) - pdl, 2, 8180);
      bc.inL = MD.lvl(p.cLevel + M(2)); bc.nL = MD.lvl(p.cNoise + M(2)); bc.cin = p.cIn; bc.cinI = p.cIn === 'pulse' ? 5 : p.cIn === 'impulse' ? 6 : MD.inI(p.cIn);
      bc.norm = 1 - 0.6 * bc.fb;
    } else if (t === 'vpm') {
      bc.car = p.vCar; bc.carI = MD.wI(p.vCar); bc.carL = MD.lvl(p.vCarLvl + M(2));
      bc.shape = MD.clamp(p.vShape / 99 + B, 0, 1); bc.vtype = p.vType; bc.fbk = p.vFb / 99 * 0.6;
      bc.mod = p.vMod; bc.modW = (p.vMod === 'saw' || p.vMod === 'square' || p.vMod === 'tri' || p.vMod === 'sine') ? MD.wI(p.vMod) : -1; bc.modIn = MD.inI(p.vMod); const ml = MD.clamp(p.vModLvl / 99 + A, 0, 1); bc.idx = ml * ml * 2.0;
      const r = MossVoice.VPMR[MD.clamp(p.vRatio | 0, 0, 16)];
      bc.dt2 = MD.clamp(hz * r * Math.pow(2, (p.vFine || 0) / 1200 + MD.pitchScale(M(3)) / 12) / sr, 0, 0.49);
    } else if (t === 'reso') {
      bc.rin = p.rIn; bc.rinI = MD.inI(p.rIn); bc.inL = MD.lvl(p.rLevel + M(2));
      const shift = Math.round(A * 15);
      const kOff = B * 99;
      let nb = 0;
      for (let b = 0; b < 4; b++) {
        const K = MossVoice.RKEY[b];
        const lv = MD.lvl(p[K[0]]); if (lv <= 0) continue;
        const h = MD.clamp(p[K[1]] + shift + Math.round(M(3 + b)), 1, 32);
        const fc = hz * h * Math.pow(2, (p[K[2]] || 0) / 99 / 12);
        if (fc >= sr * 0.45 || fc <= 10) continue;
        const Q = 0.7 * Math.pow(300, MD.clamp(p[K[3]] + kOff, 0, 99) / 99), k = 1 / Q;
        const g = Math.tan(Math.PI * fc / sr), a1 = 1 / (1 + g * (g + k)), bd = bc.bands[nb++];
        bd.i = b; bd.a1 = a1; bd.a2 = g * a1; bd.a3 = g * g * a1; bd.k = k; bd.out = lv * Math.pow(k, p.rIn === 'noise' ? 0.5 : 0.85) * 1.4;
      }
      bc.nb = nb;
    } else if (t === 'ring' || t === 'cross' || t === 'sync') {
      bc.car = p.mCar; bc.carI = MD.wI(p.mCar); bc.ec = MD.edgeCoef(MD.clamp(p.mEdge + B * 99, 0, 99), sr);
      bc.depth = t === 'sync' ? 0 : MD.clamp(p.mDepth / 99 + A, 0, 1);
      bc.mtype = p.mType; bc.min = p.mIn; bc.minI = MD.inI(p.mIn); bc.discs = MD.discs(p.mCar); bc.nd = bc.discs.length;
      bc.xI = bc.depth * bc.depth * 6;
    } else if (t === 'bowed') this.setupBowed(p, bc, o, hz, M);
    else if (t === 'reed') this.setupReed(p, bc, o, hz, M);
    else if (t === 'pluck') this.setupPluck(eng, p, bc, o, hz, M);
    else if (t === 'organ') this.setupOrgan(eng, i, p, bc, hz, A, B, M);
    else if (t === 'epiano') this.setupEPiano(eng, p, bc, o, hz, A);
    else if (t === 'brass') this.setupBrass(p, bc, o, hz, A, B);
  }

  // ======== Organ Model (single size) ========
  // Three drawbars. Harmonic 1 is one octave below the oscillator pitch (so 2 = 8', 3 = 5 1/3', 4 = 4', ...).
  // Sine 1 is a pure sine; Sine 2 and Sine 3 add the 2nd, and the 2nd and 3rd, harmonics of the drawbar.
  // Each drawbar can add a decaying percussion (Single: only from silence; Multi: every note).
  setupOrgan(eng, i, p, bc, hz, A, B, M) {
    const sr = this.sr, nyq = sr * 0.45, lm = [A * 99, B * 99, M(2)];
    // Percussion level AMS scales every drawbar's percussion level, the way a level AMS scales an EG:
    // positive intensity k gives 1 - k + k * source, negative gives 1 + k * source (0 percussion stays 0)
    const kp = eng.cKp[i];
    const pmul = MD.clamp(1 + (M(3) - kp) / 99, 0, 2);
    bc.gainK = MossVoice.CAL.organGain;
    if (!bc.odt) { bc.odt = new Float64Array(3); bc.oL = new Float64Array(3); bc.oP = new Float64Array(3); bc.oW = new Int8Array(3); bc.og2 = new Float64Array(3); bc.og3 = new Float64Array(3); bc.otN = new Int8Array(3); }
    for (let k = 0; k < 3; k++) {
      const h = MD.clamp(p['og' + k + 'Harm'] | 0 || 1, 1, 16);
      const f = Math.abs(hz) * 0.5 * h * Math.pow(2, (p['og' + k + 'Fine'] || 0) / 1200);
      const wv = MD.clamp(p['og' + k + 'Wave'] | 0, 0, 3);
      bc.oW[k] = wv; bc.odt[k] = f / sr;
      const ok = f > 0 && f < nyq;
      bc.oL[k] = ok ? MD.lvl((p['og' + k + 'Lvl'] || 0) + lm[k]) : 0;
      bc.oP[k] = ok ? MD.lvl(p['og' + k + 'Perc'] || 0) * pmul : 0;
      bc.og2[k] = 2 * f < nyq ? 0.5 : 0; bc.og3[k] = 3 * f < nyq ? 1 / 3 : 0;
      // triangle: additive (odd harmonics below Nyquist) when the naive shape would alias audibly
      let nt = 0; while (nt < 7 && (2 * nt + 1) * f < nyq) nt++;
      bc.otN[k] = 15 * f < nyq ? 0 : nt;
    }
    // percussion decay: about 50 ms (0) to 4 s (99) to -60 dB
    const T = 0.05 * Math.pow(80, MD.clamp(p.ogDecay === undefined ? 50 : p.ogDecay, 0, 99) / 99);
    bc.pdec = Math.exp(-6.9078 / (T * sr));
  }

  // ======== E.Piano Model (single size) ========
  // A hammer strikes a tine with two vibrating modes (fundamental and an inharmonic overtone); an
  // electromagnetic pickup turns the motion into sound. Its flux falls off either side of the pickup, so with the
  // pickup centred on the tine (Location 0) the output is mostly the 2nd partial; moving it off-centre brings in
  // the fundamental. Harder strikes swing the tine further into the pickup's non-linear region: brighter and louder.
  static epHammer(f, tc) { const x = f * tc; return 1 / (1 + x * x); }
  static epRatio(v) { return Math.pow(2, 1 + 2 * MD.clamp(v, 0, 99) / 99); } // overtone at 2x (0) .. 8x (99) the fundamental
  epExcite(o, O, vel) {
    if (!O || O.type !== 'epiano') return;
    const p = O.p, sr = this.sr;
    const F = MD.clamp((p.epForce === undefined ? 60 : p.epForce) / 99, 0, 1), c = p.epCurve === undefined ? 40 : p.epCurve;
    const Fe = c < 0 ? F : F * Math.pow(MD.clamp(vel, 0.01, 1), 0.2 + 2.3 * MD.clamp(c, 0, 99) / 99);
    o.epF = Fe; o.epX = 0.12 + 1.5 * Fe;
    const f1 = MD.midiHz(this.note + (O.octave || 0) * 12 + (O.transpose || 0)), fo = f1 * MossVoice.epRatio(p.epOtF);
    const w = MD.clamp((p.epWidth === undefined ? 60 : p.epWidth) / 99, 0, 1), tc = 0.0004 + (1 - w) * 0.004;
    // a wider hammer stays on the tine longer, which filters the strike: the overtone is excited less
    const Hr = Math.min(1, MossVoice.epHammer(fo, tc) / MossVoice.epHammer(f1, tc));
    // modes start at rest and are set moving by the strike (displacement = Im of the rotating state)
    const q = o.eq;
    q[0] = o.epX; q[1] = 0;
    q[2] = o.epX * 0.6 * MD.lvl(p.epOtL || 0) * Hr * (0.5 + 0.5 * Fe); q[3] = 0;
    // hammer click: a short burst of filtered noise
    o.exI = 0; o.exN = Math.round(0.03 * sr);
    o.exA = MD.lvl(p.epClick || 0) * (0.3 + 0.7 * Fe) * 0.5;
    o.bp.fill(0);
  }
  setupEPiano(eng, p, bc, o, hz, A) {
    const sr = this.sr, f1 = MD.clamp(Math.abs(hz), 8, sr * 0.45);
    const ks = MD.clamp(Math.pow(262 / f1, 0.6), 0.25, 4);
    let T1 = 0.1 * Math.pow(150, MD.clamp(p.epDecay === undefined ? 70 : p.epDecay, 0, 99) / 99) * ks;
    let To = 0.01 * Math.pow(200, MD.clamp(p.epOtD || 0, 0, 99) / 99) * ks;
    if (!this.gate && !eng.sustainHeld(this)) { const TR = 0.015 * Math.pow(130, MD.clamp(p.epRel === undefined ? 40 : p.epRel, 0, 99) / 99); T1 = Math.min(T1, TR); To = Math.min(To, TR); }
    const r1 = Math.exp(-6.9078 / (T1 * sr)), w1 = 2 * Math.PI * f1 / sr;
    bc.c1 = r1 * Math.cos(w1); bc.s1 = r1 * Math.sin(w1);
    const fo = f1 * MossVoice.epRatio(p.epOtF), ro = Math.exp(-6.9078 / (To * sr));
    if (fo < sr * 0.45) { const wo = 2 * Math.PI * fo / sr; bc.co = ro * Math.cos(wo); bc.so = ro * Math.sin(wo); bc.oOn = 1; }
    else { bc.co = ro; bc.so = 0; bc.oOn = 0; }
    const d = 0.06 + 0.84 * MD.clamp(((p.epPos === undefined ? 50 : p.epPos) + A * 99) / 99, 0, 1);
    bc.d = d; bc.phiD = 1 / (1 + d * d); bc.gainK = MossVoice.CAL.epGain;
    const w = MD.clamp((p.epWidth === undefined ? 60 : p.epWidth) / 99, 0, 1);
    bc.ckDec = Math.exp(-1 / ((0.0015 + (1 - w) * 0.004) * sr));
    bc.ckA = 1 - Math.exp(-2 * Math.PI * (2000 + 10000 * w) / sr); bc.ckH = 1 - Math.exp(-2 * Math.PI * 300 / sr);
    bc.lsc = MossVoice.lshCoef(40 * Math.pow(2, (p.epEqF || 0) / 49 * 5), p.epEqG || 0, sr, bc.lscB);
  }

  // ======== Brass Model (double size: OSC 1 only) ========
  // The lips buzz at the played pitch and let through pulses of air; the harder they are blown (Pressure) and the
  // firmer the lips (Lip Character), the more completely they close each cycle, so the pulses sharpen and the tone
  // brightens as it gets louder, as on real brass. The pulses drive a bore resonator (a tuned delay loop with a
  // low-pass bell reflection), then the bell's radiation (a resonant high-pass: Bell Tone / Resonance),
  // the peaking EQ and the Strength overdrive.
  setupBrass(p, bc, o, hz, A, B) {
    const sr = this.sr, ty = MossVoice.BRASS[MD.clamp(p.brType | 0, 0, 5)];
    const f0 = MD.clamp(Math.abs(hz), 16, sr * 0.2), w0 = 2 * Math.PI * f0 / sr;
    bc.dt = f0 / sr;
    const prs = MD.clamp((this.egVal(p.brPrsEg || 'amp') * (p.brPrsInt === undefined ? 99 : p.brPrsInt) + A * 99) / 99, 0, 1.25);
    const lc = MD.clamp(((p.brLip === undefined ? 50 : p.brLip) + B * 99) / 99, 0, 1);
    bc.amp = Math.pow(prs, 0.75);
    const k = MD.clamp(0.4 + ty[0] * Math.pow(prs * (0.35 + 1.3 * lc), 1.6), 0.25, 47.9);
    const T = MossVoice.BPULSE, j = k * 4, j0 = j | 0, fr = j - j0;
    bc.k = k; bc.mean = T[j0 * 2] + (T[j0 * 2 + 2] - T[j0 * 2]) * fr; bc.norm = T[j0 * 2 + 1] + (T[j0 * 2 + 3] - T[j0 * 2 + 1]) * fr;
    bc.la = ty[1]; bc.odd = ty[3];
    bc.g = ty[2]; bc.gin = 1 - bc.g;
    const lpd = MossVoice.lpDelay(bc.la, w0);
    bc.L = MD.clamp((bc.odd ? sr / f0 * 0.5 : sr / f0) - lpd, 2, 8180);
    bc.nz = MD.lvl(p.brNoise || 0) * 0.6;
    const fc = 60 * Math.pow(35, MD.clamp(p.brBell || 0, 0, 99) / 99), Q = 0.6 * Math.pow(12, MD.clamp(p.brBellRes || 0, 0, 99) / 99);
    bc.hpc = MossVoice.svfCoef(fc, 1 / Q, sr, bc.hpB);
    bc.eqc = MossVoice.peqCoef(p.brEqF, p.brEqQ, p.brEqG, sr, bc.eqB);
    const st = MD.clamp(p.brStr || 0, 0, 99) / 99;
    bc.drv = 1 + 9 * Math.pow(st, 1.5); bc.drvN = 1 / MD.tanh(bc.drv); bc.dmix = Math.min(1, Math.sqrt(st) * 1.2);
    bc.gain = ty[4] * MossVoice.CAL.brassGain;
  }

  // ======== physical models (double size: OSC 1 only) ========
  // Waveguide designs follow the classic published structures (Smith / McIntyre-Schumacher-Woodhouse,
  // as in the Synthesis ToolKit); Korg's own MOSS algorithms are not public.
  static rd(buf, base, w, L) { let rp = w - L; if (rp < 0) rp += 4096; const i0 = rp | 0, f = rp - i0; const a = buf[base + (i0 & 4095)], b = buf[base + ((i0 + 1) & 4095)]; return a + (b - a) * f; }
  static lpDelay(a, w) { return a <= 0 ? 0 : Math.atan2(a * Math.sin(w), 1 - a * Math.cos(w)) / w; }
  static lpGain(a, w) { return (1 - a) / Math.sqrt(1 - 2 * a * Math.cos(w) + a * a); }
  static apDelay(c, w) { const a1 = Math.atan2(-Math.sin(w), c + Math.cos(w)), a2 = Math.atan2(-c * Math.sin(w), 1 + c * Math.cos(w)); return -(a1 - a2) / w; }
  static peqCoef(f, q, g, sr, out) {
    if (!g) return null;
    const fc = MD.clamp(50 * Math.pow(2, (f || 0) / 49 * 8), 30, sr * 0.45), Q = 0.5 * Math.pow(20, (q || 0) / 29);
    const A = Math.pow(10, g / 40), w = 2 * Math.PI * fc / sr, al = Math.sin(w) / (2 * Q), cs = Math.cos(w), a0 = 1 + al / A;
    const c = out || new Array(5);
    c[0] = (1 + al * A) / a0; c[1] = -2 * cs / a0; c[2] = (1 - al * A) / a0; c[3] = -2 * cs / a0; c[4] = (1 - al / A) / a0;
    return c;
  }
  static lshCoef(fc, g, sr, out) {
    if (!g) return null;
    const A = Math.pow(10, g / 40), w = 2 * Math.PI * MD.clamp(fc, 20, sr * 0.45) / sr, cs = Math.cos(w), sa = 2 * Math.sqrt(A) * Math.sin(w) / 2 * Math.SQRT2;
    const a0 = (A + 1) + (A - 1) * cs + sa;
    const c = out || new Array(5);
    c[0] = A * ((A + 1) - (A - 1) * cs + sa) / a0; c[1] = 2 * A * ((A - 1) - (A + 1) * cs) / a0; c[2] = A * ((A + 1) - (A - 1) * cs - sa) / a0; c[3] = -2 * ((A - 1) + (A + 1) * cs) / a0; c[4] = ((A + 1) + (A - 1) * cs - sa) / a0;
    return c;
  }
  static bq(st, j, c, x) {
    if (!c) return x;
    const y = c[0] * x + c[1] * st[j] + c[2] * st[j + 1] - c[3] * st[j + 2] - c[4] * st[j + 3];
    st[j + 1] = st[j]; st[j] = x; st[j + 3] = st[j + 2]; st[j + 2] = y;
    return y;
  }
  setupBowed(p, bc, o, hz, M) {
    const sr = this.sr;
    let spd = (this.egVal(p.bwSpdEg || 'amp') * (p.bwSpdInt === undefined ? 99 : p.bwSpdInt) + M(0)) / 99;
    if (p.bwDiff) {
      // "Differential": the rate of change of EG + AMS is used as the bow speed
      const prev = o.spdPrev === null ? spd : o.spdPrev; o.spdPrev = spd;
      spd = (spd - prev) / Math.max(this._dtb || 3e-4, 1e-4) * 0.08;
    }
    bc.bowV = MD.clamp(spd, -1.5, 1.5) * MossVoice.CAL.bowSpeed;
    const prs = MD.clamp((this.egVal(p.bwPrsEg || 'amp') * (p.bwPrsInt === undefined ? 60 : p.bwPrsInt) + M(1)) / 99, 0, 1);
    bc.slope = 5 - 4 * prs;
    // Rosin = static friction: less rosin lowers the sticking plateau of the friction curve
    const ros = MD.clamp((p.bwRosin === undefined ? 70 : p.bwRosin) / 99, 0, 1);
    bc.rc = 0.75 + (1 - ros) * MossVoice.CAL.rosinK; bc.bn = (1 - ros) * MossVoice.CAL.bowNoise;
    const mp = MossVoice.CAL.bowMinPos, pos = mp + (1 - 2 * mp) * MD.clamp(((p.bwPos === undefined ? 13 : p.bwPos) + M(2)) / 99, 0, 1);
    const n = this.note, key = p.bwDampKey === undefined ? 60 : p.bwDampKey;
    const dkt = n < key ? (key - n) * (p.bwDampLo || 0) / 99 * 2 : (n - key) * (p.bwDampHi || 0) / 99 * 2;
    // Damping inside the loop is linear-phase (two symmetric 3-tap stages, 2 samples of delay) so every
    // harmonic keeps its tuning; the rest of the darkening happens after the loop where it cannot detune.
    const dmp = MD.clamp(((p.bwDamp || 0) + M(3) + dkt) / 99, 0, 1);
    bc.b = 0.25 * Math.pow(dmp, 0.7); bc.oa = Math.pow(dmp, 1.1) * 0.94;
    bc.c = -MD.clamp(((p.bwDisp || 0) + M(4)) / 99, 0, 1) * MossVoice.CAL.bowDisp;
    // Bridge reflection: 0 = none, higher = speaks more easily (curve keeps 50-99 musically usable)
    bc.g = 0.998 * (1 - Math.pow(1 - MD.clamp(((p.bwRefl === undefined ? 90 : p.bwRefl) + M(5)) / 99, 0, 1), 2.5));
    const f0 = MD.clamp(hz, 16, sr * 0.2), w0 = 2 * Math.PI * f0 / sr;
    // a stiff (dispersive) bowed string locks slightly sharp: measured, about 0.35 samples at full dispersion
    const Lt = MD.clamp(sr / f0 - 2 - MossVoice.apDelay(bc.c, w0) + MossVoice.CAL.bowed + 0.35 * Math.pow(-bc.c / 0.6, 2), 4, 8100);
    bc.Lb = MD.clamp(Lt * pos, 1.5, 4090); bc.Ln = MD.clamp(Lt - bc.Lb, 1.5, 4090);
    bc.eqc = MossVoice.peqCoef(p.bwEqF, p.bwEqQ, p.bwEqG, sr, bc.eqB); bc.gainK = MossVoice.CAL.bowedGain;
  }
  setupReed(p, bc, o, hz, M) {
    const sr = this.sr, ty = MossVoice.REED[MD.clamp(p.rdType | 0, 0, 16)];
    bc.arch = ty[0];
    const prs = MD.clamp((this.egVal(p.rdPrsEg || 'amp') * (p.rdPrsInt === undefined ? 99 : p.rdPrsInt) + M(0)) / 99, 0, 1.25);
    bc.nz = MD.clamp((p.rdNoise || 0) / 99, 0, 1) * ty[4];
    bc.rOff = ty[2] + M(1) / 99 * MossVoice.CAL.reedMod; bc.rSlope = ty[3];
    // Pressure is mapped into this instrument's measured sounding window (which shifts as the reed closes),
    // so Korg-range pressures always speak: near 0 = silent, then soft edge -> loud edge of the window.
    const wf = MossVoice.REEDWIN[MD.clamp(p.rdType | 0, 0, 16)];
    const cen = wf[0] + wf[1] * (bc.rOff - ty[2]), lo = Math.max(0.35, cen - 0.8 * wf[2]), hi = Math.min(cen + 0.8 * wf[2], wf[3] || 9);
    bc.breath = prs < 0.12 ? lo * prs / 0.12 : lo + (hi - lo) * MD.clamp((prs - 0.12) / 0.95, 0, 1);
    const f0 = MD.clamp(hz, 16, sr * 0.2), w0 = 2 * Math.PI * f0 / sr;
    if (bc.arch === 0) bc.L = MD.clamp(sr / f0 * 0.5 + MossVoice.CAL.clar, 2, 4090);
    else if (bc.arch === 1) { const Lt = MD.clamp(sr / f0 + MossVoice.CAL.sax, 4, 8100); bc.L1 = MD.clamp(Lt * ty[5], 1.5, 4090); bc.L0 = MD.clamp(Lt - bc.L1, 2, 4090); }
    else { bc.fa = 0.7 - 0.1 * 22050 / sr; const Lb = MD.clamp(sr / f0 * MossVoice.CAL.fluteK - MossVoice.lpDelay(bc.fa, w0 / MossVoice.CAL.fluteK), 4, 4090); bc.L = Lb; bc.Lj = MD.clamp(Lb * ty[5], 1.5, 4090); }
    bc.wsOff = (p.rdWsOff || 0) / 99 * 0.5; bc.wsTab = p.rdWsTable === 'reso'; bc.wsK = MD.clamp(((p.rdWsShape || 0) + M(2)) / 99, 0, 1);
    bc.hpc = (p.rdHpf || 0) > 0 ? MossVoice.svfCoef(MD.cutHz(p.rdHpf), MD.kReso(p.rdHpfReso || 0), sr, bc.hpB) : null;
    bc.eqc = MossVoice.peqCoef(p.rdEqF, p.rdEqQ, p.rdEqG, sr, bc.eqB); bc.gainK = MossVoice.CAL.reedGain;
  }
  setupPluck(eng, p, bc, o, hz, M) {
    const sr = this.sr, n = this.note, f0 = MD.clamp(hz, 16, sr * 0.2), w0 = 2 * Math.PI * f0 / sr;
    const damp = MD.clamp(((p.plDamp === undefined ? 30 : p.plDamp) + M(2) + (n - 60) * (p.plDampKt || 0) / 99 * 1.5) / 99, 0, 1);
    bc.b = 0.25 * Math.pow(damp, 0.7); bc.oa = Math.pow(damp, 1.5) * 0.75;
    bc.c = -MD.clamp(((p.plDisp || 0) + M(1)) / 99, 0, 1) * 0.7;
    const dec = MD.clamp((p.plDecay === undefined ? 60 : p.plDecay) - (n - 60) * (p.plDecayKt || 0) / 99 * 1.5, 0, 99);
    let T60 = 0.15 + 14 * Math.pow(dec / 99, 2.2);
    if (!this.gate && !eng.sustainHeld(this)) T60 = Math.min(T60, 0.02 + 4 * Math.pow((p.plRel || 0) / 99, 2.2)); // released, and not held by the damper pedal
    // Decay sets the fundamental's ring time; Damping only darkens the upper partials
    bc.g = Math.min(0.99995, Math.pow(10, -3 / (T60 * f0)));
    bc.L = MD.clamp(sr / f0 - 2 - MossVoice.apDelay(bc.c, w0) + MossVoice.CAL.pluck, 2, 4090);
    bc.pos = MD.clamp(((p.plPos === undefined ? 20 : p.plPos) + M(0)) / 99, 0.02, 0.98);
    bc.pk = p.plPickup ? MD.clamp(((p.plPickPos === undefined ? 30 : p.plPickPos) + M(4)) / 99, 0.02, 0.98) * bc.L * 0.5 : 0;
    bc.lsc = MossVoice.lshCoef(40 * Math.pow(2, (p.plEqF || 0) / 49 * 5), p.plEqG || 0, sr, bc.lscB);
    bc.bst = (p.plBoost || 0) > 0 ? MossVoice.lshCoef(120, (p.plBoost || 0) / 99 * 12, sr, bc.bstB) : null; bc.gainK = MossVoice.CAL.pluckGain;
    // Harmonics: the string is lightly touched at Point; the Harmonics control (Mod page) sets how firmly. A touch damps
    // every mode that does not have a node there. In the loop this is a linear-phase comb around the string delay:
    // mode m keeps gain 1 - a (1 - cos(2 pi m x)) / 2 per period, i.e. 1 for the modes with a node at x.
    const hx = MD.clamp((p.plHarm || 0) / 99, 0, 1), x2 = Math.min(hx, 1 - hx), ha = MD.clamp(M(3) / 99, 0, 1);
    bc.hD = Math.max(0, Math.min(x2 * sr / f0, bc.L - 1, 4094 - bc.L));
    bc.ha = bc.hD > 0.5 ? ha : 0;
  }
  pluckExcite(o, O, vel) {
    if (!O || O.type !== 'pluck') { o.exN = 0; return; }
    const p = O.p, sr = this.sr;
    const per = sr / MD.midiHz(this.note + (O.octave || 0) * 12 + (O.transpose || 0));
    const vc = (base, ctl) => MD.clamp(base + (ctl || 0) * (vel - 1), 0, 99);
    const up = vc(p.plUp === undefined ? 70 : p.plUp, p.plUpVel) / 99, dn = vc(p.plDn === undefined ? 50 : p.plDn, p.plDnVel) / 99;
    o.exUp = Math.max(1, Math.round((0.02 + (1 - up) * 0.6) * per));
    o.exDn = Math.max(1, Math.round((0.03 + (1 - dn) * 0.9) * per));
    o.exN = o.exUp + o.exDn; o.exI = 0;
    o.exA = vc(p.plAtk === undefined ? 80 : p.plAtk, p.plAtkVel) / 99;
    o.exNz = vc(p.plNoise || 0, p.plNoiseVel) / 99;
  }

  // ---- blep helper: advance phase, return 1-sample-delayed corrected value ----
  blepStep(o, dt, f, discs, nd, amp) {
    let p = o.ph + dt; if (p >= 1) p -= 1;
    o.ph = p;
    let v = f * amp;
    for (let k = 0; k < nd; k++) {
      const q = discs[k][0], h = discs[k][1] * amp;
      if (h === 0) continue;
      let dd = p - q; if (dd < 0) dd += 1;
      if (dd < dt) { const x = dd / dt; o.pend += h * 0.5 * x * x; v -= h * 0.5 * (1 - x) * (1 - x); }
    }
    const out = o.pend; o.pend = v; return out;
  }
  stdMain(bc, p) {
    if (bc.pulse) { if (bc.pd < 1e-4) return 0; let q = p + bc.pd; if (q >= 1) q -= 1; return bc.ps * ((2 * p - 1) - (2 * q - 1)); }
    let q = p + 0.5; if (q >= 1) q -= 1; return (2 * p - 1) + bc.w * (2 * q - 1);
  }
  carrierStep(o, bc, dt, syncX) {
    const kind = bc.carI, discs = bc.discs;
    if (syncX < 0) {
      let p = o.ph + dt; if (p >= 1) p -= 1; o.ph = p;
      let v = MD.waveI(kind, p);
      for (let k = 0; k < discs.length; k++) {
        const q = discs[k][0], h = discs[k][1];
        let dd = p - q; if (dd < 0) dd += 1;
        if (dd < dt) { const x = dd / dt; o.pend += h * 0.5 * x * x; v -= h * 0.5 * (1 - x) * (1 - x); }
      }
      const out = o.pend; o.pend = v; return out;
    }
    // hard sync: reset happened syncX samples ago
    const pre = (1 - syncX) * dt;
    let pr = o.ph + pre; if (pr >= 1) pr -= 1;
    for (let k = 0; k < discs.length; k++) {
      const q = discs[k][0], h = discs[k][1];
      let dd = pr - q; if (dd < 0) dd += 1;
      if (dd < pre) { const x = syncX + dd / dt; o.pend += h * 0.5 * x * x; o.pendNext = (o.pendNext || 0) - h * 0.5 * (1 - x) * (1 - x); }
    }
    const hj = MD.waveI(kind, 0) - MD.waveI(kind, pr);
    const p = syncX * dt; o.ph = p;
    let v = MD.waveI(kind, p) + (o.pendNext || 0); o.pendNext = 0;
    o.pend += hj * 0.5 * syncX * syncX; v -= hj * 0.5 * (1 - syncX) * (1 - syncX);
    for (let k = 0; k < discs.length; k++) {
      const q = discs[k][0], h = discs[k][1];
      if (q > 0 && q < p) { const x = (p - q) / dt; o.pend += h * 0.5 * x * x; v -= h * 0.5 * (1 - x) * (1 - x); }
    }
    const out = o.pend; o.pend = v; return out;
  }
  // does this oscillator (its current settings) read input k (0 the other OSC, 1 sub, 2 noise, 3/4 filters)?
  readsInput(bc, k) {
    switch (bc.ti) {
      case 1: return bc.cinI === k;
      case 2: return bc.modW < 0 && bc.modIn === k;
      case 3: return bc.rinI === k;
      case 4: case 5: case 6: return bc.minI === k;
    }
    return false;
  }
  inputSigI(k, i) {
    switch (k) {
      case 0: return i === 0 ? this.prevO2 : this.prevO1;
      case 1: return this.io[0];
      case 2: return this.io[1];
      case 3: return this.prevF1;
      case 4: return this.prevF2;
    }
    return 0;
  }
  // one sample of oscillator i into this.oy[i]; the per-sample values travel through typed arrays (this.io: sub, noise)
  // because passing or returning doubles through calls that are not inlined allocates on every sample
  oscTick(i) {
    const bc = this.bc[i];
    switch (bc.ti) {
      case 0: this.tick0(i); break;
      case 1: this.tick1(i); break;
      case 2: this.tick2(i); break;
      case 3: this.tick3(i); break;
      case 4: this.tick4(i); break;
      case 5: this.tick5(i); break;
      case 6: this.tick6(i); break;
      case 7: this.tick7(i); break;
      case 8: this.tick8(i); break;
      case 9: this.tick9(i); break;
      case 10: this.tick10(i); break;
      case 11: this.tick11(i); break;
      case 12: this.tick12(i); break;
      default: this.oy[i] = 0;
    }
    let y = this.oy[i];
    if (!(y === y) || y > 50 || y < -50) { const o = this.osc[i]; y = 0; o.ph = 0; o.pend = 0; o.e = 0; o.y = 0; o.lp = 0; o.buf.fill(0); o.bp.fill(0); }
    this.oy[i] = y * bc.lvlMul;
  }
  tick0(i) { // standard
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    const dt = bc.dt < 0 ? 0 : bc.dt;
    const pn = o.ph + dt >= 1 ? o.ph + dt - 1 : o.ph + dt;
    let m = this.blepStep(o, dt, this.stdMain(bc, pn), bc.discs, bc.nd, bc.mainL);
    if (bc.ec < 1) { o.e += bc.ec * (m - o.e); m = o.e; }
    let pt = o.ph - dt + bc.pshift; pt -= Math.floor(pt);
    let x = m;
    if (bc.triL > 0) x += bc.triL * bc.tsign * MD.fold(bc.gfold * (1 - 4 * Math.abs(pt - 0.5)));
    if (bc.sinL > 0) x += bc.sinL * Math.sin(6.283185307179586 * pt);
    if (bc.shBal > 0) {
      const u = x * bc.shIn + bc.shOff;
      const s = bc.shReso ? Math.sin(1.5707963 * u * (1 + 7 * bc.shK)) : MD.tanh(u * (1 + 9 * bc.shK));
      x = x * (1 - bc.shBal) + s * bc.shBal;
    }
    y = x;
    this.oy[i] = y;
  }
  tick1(i) { // comb
    const o = this.osc[i], bc = this.bc[i], noise = this.io[1];
    let y = 0;
    let inp = 0;
    const c = bc.cinI;
    if (c === 5) { inp = o.burst > 0 ? noise * bc.inL * 2 : 0; if (o.burst > 0) o.burst--; }
    else if (c === 6) { inp = o.burst > 0 ? bc.inL * 6 : 0; if (o.burst > 0) o.burst--; }
    else inp = this.inputSigI(c, i) * bc.inL + noise * bc.nL;
    const buf = o.buf, N = 8192;
    let rp = o.w - bc.L; if (rp < 0) rp += N;
    const i0 = rp | 0, fr = rp - i0, i1 = (i0 + 1) & 8191;
    const dl = buf[i0] + (buf[i1] - buf[i0]) * fr;
    o.lp = dl * (1 - bc.a) + o.lp * bc.a;
    let v = inp + bc.fb * o.lp;
    v = MD.tanh(v * 0.25) * 4;
    buf[o.w] = v; o.w = (o.w + 1) & 8191;
    // DC blocker
    const yy = v - o.dcx + 0.995 * o.dcy; o.dcx = v; o.dcy = yy;
    y = yy * (c === 6 || c === 5 ? 1 : bc.norm);
    this.oy[i] = y;
  }
  tick2(i) { // vpm
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    let m;
    if (bc.modW >= 0) {
      o.ph2 += bc.dt2; if (o.ph2 >= 1) o.ph2 -= 1; m = MD.waveI(bc.modW, o.ph2);
    } else m = this.inputSigI(bc.modIn, i);
    o.ph += bc.dt; if (o.ph >= 1) o.ph -= 1; else if (o.ph < 0) o.ph += 1;
    let ph = o.ph + bc.idx * m + bc.fbk * o.y; ph -= Math.floor(ph);
    const raw = MD.waveI(bc.carI, ph);
    const kk = 1 + 7 * bc.shape;
    let v = bc.vtype === 2 ? Math.sin(1.5707963 * kk * Math.sin(1.5707963 * raw)) : (bc.shape < 0.005 ? raw : Math.sin(1.5707963 * kk * raw));
    o.y = v; y = v * bc.carL;
    this.oy[i] = y;
  }
  tick3(i) { // reso
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    const inp = this.inputSigI(bc.rinI, i) * bc.inL;
    let sum = 0;
    const bs = bc.bands, st = o.bp, nb = bc.nb;
    for (let k = 0; k < nb; k++) {
      const b = bs[k], j = b.i * 2;
      const v3 = inp - st[j + 1];
      const v1 = b.a1 * st[j] + b.a2 * v3;
      const v2 = st[j + 1] + b.a2 * st[j] + b.a3 * v3;
      st[j] = 2 * v1 - st[j]; st[j + 1] = 2 * v2 - st[j + 1];
      sum += v1 * b.out;
    }
    y = MD.tanh(sum * 0.5) * 2;
    this.oy[i] = y;
  }
  tick4(i) { // ring
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    let c = this.carrierStep(o, bc, bc.dt < 0 ? 0 : bc.dt, -1);
    if (bc.ec < 1) { o.e += bc.ec * (c - o.e); c = o.e; }
    let m = this.inputSigI(bc.minI, i);
    if (bc.mtype === 2) m = MD.clamp(m * 2.5, -1, 1);
    y = c * ((1 - bc.depth) + bc.depth * m);
    this.oy[i] = y;
  }
  tick5(i) { // cross
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    const m = this.inputSigI(bc.minI, i);
    o.ph += bc.dt * (1 + bc.xI * m);
    o.ph -= Math.floor(o.ph);
    let c = MD.waveI(bc.carI, o.ph);
    if (bc.ec < 1) { o.e += bc.ec * (c - o.e); c = o.e; }
    y = c;
    this.oy[i] = y;
  }
  tick6(i) { // sync
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    const m = this.inputSigI(bc.minI, i);
    let sx = -1;
    if (o.prevIn < 0 && m >= 0) { const tt = o.prevIn / (o.prevIn - m); sx = MD.clamp(1 - tt, 1e-6, 1); }
    o.prevIn = m;
    let c = this.carrierStep(o, bc, bc.dt < 0 ? 0 : bc.dt, sx);
    if (bc.ec < 1) { o.e += bc.ec * (c - o.e); c = o.e; }
    y = c;
    this.oy[i] = y;
  }
  tick7(i) { // bowed
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    const buf = o.buf;
    const nOut = MossVoice.rd(buf, 0, o.w, bc.Ln), bOut = MossVoice.rd(buf, 4096, o.w2, bc.Lb);
    const b = bc.b, eq = o.eq;
    const s1 = (1 - 2 * b) * o.lp + b * (bOut + o.lp2); o.lp2 = o.lp; o.lp = bOut;
    const s2 = (1 - 2 * b) * eq[4] + b * (s1 + eq[5]); eq[5] = eq[4]; eq[4] = s1;
    const ap = bc.c * s2 + o.apx - bc.c * o.apy; o.apx = s2; o.apy = ap;
    const bridgeRefl = -bc.g * ap, nutRefl = -0.995 * nOut;
    const dv = bc.bowV - (bridgeRefl + nutRefl);
    let q = (dv < 0 ? -dv : dv) * bc.slope + bc.rc; q = q * q; q = 1 / (q * q); if (q > 1) q = 1;
    const nv = dv * q * (1 + bc.bn * (Math.random() * 2 - 1));
    buf[o.w] = MD.clamp(bridgeRefl + nv, -4, 4); o.w = (o.w + 1) & 4095;
    buf[4096 + o.w2] = MD.clamp(nutRefl + nv, -4, 4); o.w2 = (o.w2 + 1) & 4095;
    const yy = bOut - o.dcx + 0.995 * o.dcy; o.dcx = bOut; o.dcy = yy;
    o.e += (1 - bc.oa) * (yy - o.e);
    y = MossVoice.bq(o.eq, 0, bc.eqc, o.e) * bc.gainK;
    this.oy[i] = y;
  }
  tick8(i) { // reed
    const o = this.osc[i], bc = this.bc[i], noise = this.io[1];
    let y = 0;
    const buf = o.buf, breath = bc.breath * (1 + bc.nz * noise + 1e-4 * noise);
    let out;
    if (bc.arch === 0) {
      const bo = MossVoice.rd(buf, 0, o.w, bc.L);
      const lp = 0.5 * (bo + o.lpx); o.lpx = bo;
      const pd = -0.95 * lp - breath;
      let r = bc.rOff + bc.rSlope * pd; r = r > 1 ? 1 : r < -1 ? -1 : r;
      buf[o.w] = MD.clamp(breath + pd * r, -3, 3); o.w = (o.w + 1) & 4095;
      out = bo;
    } else if (bc.arch === 1) {
      const d0 = MossVoice.rd(buf, 0, o.w, bc.L0), d1 = MossVoice.rd(buf, 4096, o.w2, bc.L1);
      const lp = 0.5 * (d0 + o.lpx); o.lpx = d0;
      const temp = -0.95 * lp, lo = temp - d1, pd = breath - lo;
      let r = bc.rOff + bc.rSlope * pd; r = r > 1 ? 1 : r < -1 ? -1 : r;
      buf[4096 + o.w2] = MD.clamp(temp, -3, 3); o.w2 = (o.w2 + 1) & 4095;
      buf[o.w] = MD.clamp(breath - pd * r - temp, -3, 3); o.w = (o.w + 1) & 4095;
      out = lo * 0.6;
    } else {
      const bo = MossVoice.rd(buf, 0, o.w, bc.L);
      o.lp = (1 - bc.fa) * bo + bc.fa * o.lp;
      const t = o.lp - o.lp2 + 0.995 * o.apy; o.lp2 = o.lp; o.apy = t;
      buf[4096 + o.w2] = breath - 0.5 * t; o.w2 = (o.w2 + 1) & 4095;
      const pj = MossVoice.rd(buf, 4096, o.w2, bc.Lj);
      let jt = pj * (pj * pj - 1); jt = jt > 1 ? 1 : jt < -1 ? -1 : jt;
      buf[o.w] = MD.clamp(jt + 0.5 * t, -3, 3); o.w = (o.w + 1) & 4095;
      out = bo * 0.6;
    }
    const u = out + bc.wsOff;
    let ws = bc.wsTab ? Math.sin(1.5707963 * u * (1 + 7 * bc.wsK)) : MD.tanh(u * (1 + 9 * bc.wsK));
    if (bc.hpc) { const c = bc.hpc, st = o.bp; const v3 = ws - st[1], v1 = c[0] * st[0] + c[1] * v3, v2 = st[1] + c[1] * st[0] + c[2] * v3; st[0] = 2 * v1 - st[0]; st[1] = 2 * v2 - st[1]; ws = ws - c[3] * v1 - v2; }
    const yy = ws - o.dcx + 0.995 * o.dcy; o.dcx = ws; o.dcy = yy;
    y = MossVoice.bq(o.eq, 0, bc.eqc, yy) * bc.gainK;
    this.oy[i] = y;
  }
  tick9(i) { // pluck
    const o = this.osc[i], bc = this.bc[i], noise = this.io[1];
    let y = 0;
    const buf = o.buf;
    let ex = 0;
    if (o.exI < o.exN) { const k = o.exI++; const env = k < o.exUp ? k / o.exUp : 1 - (k - o.exUp) / o.exDn; ex = o.exA * env * ((1 - o.exNz) + o.exNz * noise * 2); }
    buf[4096 + o.w2] = ex; o.w2 = (o.w2 + 1) & 4095;
    const xin = ex - MossVoice.rd(buf, 4096, o.w2, bc.pos * bc.L + 1); // +1: this line was just written
    let dl = MossVoice.rd(buf, 0, o.w, bc.L);
    if (bc.ha > 0) dl = (1 - 0.5 * bc.ha) * dl + 0.25 * bc.ha * (MossVoice.rd(buf, 0, o.w, bc.L - bc.hD) + MossVoice.rd(buf, 0, o.w, bc.L + bc.hD)); // harmonics touch
    const b = bc.b, q = o.eq;
    const s1 = (1 - 2 * b) * o.lp + b * (dl + o.lp2); o.lp2 = o.lp; o.lp = dl;
    const s2 = (1 - 2 * b) * q[6] + b * (s1 + q[7]); q[7] = q[6]; q[6] = s1;
    const ap = bc.c * s2 + o.apx - bc.c * o.apy; o.apx = s2; o.apy = ap;
    const v = xin + bc.g * ap;
    buf[o.w] = MD.clamp(v, -4, 4); o.w = (o.w + 1) & 4095;
    const out = bc.pk > 0 ? v - MossVoice.rd(buf, 0, o.w, bc.pk + 1) : v;
    let yy = out - o.dcx + 0.995 * o.dcy; o.dcx = out; o.dcy = yy;
    o.e += (1 - bc.oa) * (yy - o.e); yy = o.e;
    yy = MossVoice.bq(o.bp, 0, bc.lsc, yy); yy = MossVoice.bq(o.bp, 4, bc.bst, yy);
    y = yy * bc.gainK;
    this.oy[i] = y;
  }
  tick10(i) { // organ
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    const q = o.eq, pe = q[3]; q[3] = pe * bc.pdec;
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      let ph = q[k] + bc.odt[k]; if (ph >= 1) ph -= 1; q[k] = ph;
      const g = bc.oL[k] + bc.oP[k] * pe;
      if (g <= 0) continue;
      const wv = bc.oW[k];
      let v;
      if (wv === 3) {
        const nt = bc.otN[k];
        if (nt === 0) v = MD.tri0(ph);
        else { // band-limited triangle: 8/pi^2 * sum (-1)^m sin((2m+1)x) / (2m+1)^2
          const x = 6.283185307179586 * ph, s1 = Math.sin(x), c2 = 2 * Math.cos(2 * x);
          let sp = -s1, sc = s1, acc = s1;
          for (let m = 1; m < nt; m++) { const sn = c2 * sc - sp; sp = sc; sc = sn; const h = 2 * m + 1; acc += (m & 1 ? -sn : sn) / (h * h); }
          v = acc * 0.8105694691387022;
        }
      } else {
        const x = 6.283185307179586 * ph, s = Math.sin(x);
        v = s;
        if (wv > 0) { v += bc.og2[k] * 2 * s * Math.cos(x); if (wv === 2) v += bc.og3[k] * s * (3 - 4 * s * s); }
      }
      sum += g * v;
    }
    y = sum * bc.gainK;
    this.oy[i] = y;
  }
  tick11(i) { // epiano
    const o = this.osc[i], bc = this.bc[i];
    let y = 0;
    const q = o.eq;
    let a = q[0], b = q[1]; q[0] = a * bc.c1 - b * bc.s1; q[1] = a * bc.s1 + b * bc.c1;
    a = q[2]; b = q[3]; q[2] = a * bc.co - b * bc.so; q[3] = a * bc.so + b * bc.co;
    const u = q[1] + q[3] * bc.oOn + bc.d;
    let v = (bc.phiD - 1 / (1 + u * u)) * bc.gainK;
    if (o.exI < o.exN) {
      o.exI++; const st = o.bp; o.exA *= bc.ckDec;
      st[4] += bc.ckA * (this.rnd() - st[4]); const hp = st[4] - st[5]; st[5] += bc.ckH * (st[4] - st[5]);
      v += hp * o.exA * 3;
    }
    const yy = v - o.dcx + 0.995 * o.dcy; o.dcx = v; o.dcy = yy;
    y = MossVoice.bq(o.bp, 0, bc.lsc, yy);
    this.oy[i] = y;
  }
  tick12(i) { // brass
    const o = this.osc[i], bc = this.bc[i], noise = this.io[1];
    let y = 0;
    let ph = o.ph + bc.dt; if (ph >= 1) ph -= 1; o.ph = ph;
    const br = 1 + bc.nz * noise;
    const s = (Math.exp(bc.k * (Math.cos(6.283185307179586 * ph) - 1)) - bc.mean) * bc.norm * bc.amp * br + bc.nz * 0.3 * bc.amp * noise;
    const buf = o.buf;
    let rp = o.w - bc.L; if (rp < 0) rp += 8192;
    const i0 = rp | 0, fr = rp - i0, d0 = buf[i0], dl = d0 + (buf[(i0 + 1) & 8191] - d0) * fr;
    o.lp = (1 - bc.la) * dl + bc.la * o.lp;
    const v = s * bc.gin + (bc.odd ? -bc.g : bc.g) * o.lp;
    buf[o.w] = v; o.w = (o.w + 1) & 8191;
    const c = bc.hpc, st = o.bp;
    const v3 = v - st[1], v1 = c[0] * st[0] + c[1] * v3, v2 = st[1] + c[1] * st[0] + c[2] * v3;
    st[0] = 2 * v1 - st[0]; st[1] = 2 * v2 - st[1];
    let yy = MossVoice.bq(o.eq, 0, bc.eqc, v - c[3] * v1 - v2) * bc.gain;
    if (bc.dmix > 0) yy += bc.dmix * (MD.tanh(yy * bc.drv) * bc.drvN - yy); // Strength: overdrive, faded in
    y = yy;
    this.oy[i] = y;
  }

  // ---- SVF (TPT) helpers ----
  static svfCoef(fc, k, sr, out) {
    const g = Math.tan(Math.PI * MD.clamp(fc, 16, sr * 0.45) / sr), a1 = 1 / (1 + g * (g + k));
    if (!out) return [a1, g * a1, g * g * a1, k];
    out[0] = a1; out[1] = g * a1; out[2] = g * g * a1; out[3] = k; return out;
  }

  renderBlock(eng, L, R, off, n) {
    const P = eng.patch, sr = this.sr, dtb = n / sr, d = this.dst;
    this._dtb = dtb;
    this.computeSources(eng, P, dtb);
    this.computeDests(eng);
    // portamento
    const V = P.voice;
    if (this.pitch !== this.target) {
      const T = MD.tsec((V.portaTime || 0) + d[31]) * 0.5;
      if (T <= 0) this.pitch = this.target;
      else { this.pitch += (this.target - this.pitch) * (1 - Math.exp(-dtb / T)); if (Math.abs(this.target - this.pitch) < 0.001) this.pitch = this.target; }
    }
    const pb = eng.bendSemis();
    const base = pb + this.detune + (this.randOff || 0) + eng.tuneSemis(this.pitch - eng.keyShift[this.note]);
    this.setupOsc(eng, P, 0, base, pb);
    const dbl = eng.cDbl;
    if (!dbl) this.setupOsc(eng, P, 1, base, pb); else { this.bc[1].type = 'none'; this.bc[1].ti = -1; }
    // sub osc
    const S = P.sub;
    const sc = S.slopeCenter === undefined ? 60 : S.slopeCenter, spn = this.pitch;
    const sslope = spn < sc ? (spn - sc) * (S.slopeLow === undefined ? 1 : S.slopeLow) : (spn - sc) * (S.slopeHigh === undefined ? 1 : S.slopeHigh);
    const subSemis = sc + sslope + S.octave * 12 + S.transpose + S.tune / 100 + base + d[1] + d[4];
    if (subSemis !== this.subS) { this.subS = subSemis; this.subH = MD.midiHz(subSemis); }
    const subDt = MD.clamp((this.subH + (S.foffset || 0)) / sr, 0, 0.45);
    // noise filter
    const NZ = P.noise, nzOn = NZ.ftype !== 'thru', nzT = NZ.ftype === 'lpf' ? 0 : NZ.ftype === 'hpf' ? 1 : 2;
    let nc = null;
    if (nzOn) { const x = NZ.freq + d[14], r = NZ.reso; if (x !== this.nzX || r !== this.nzR) { this.nzX = x; this.nzR = r; MossVoice.svfCoef(MD.cutHz(x), MD.kReso(r), sr, this.ncB); } nc = this.ncB; }
    const nzTrim = MD.lvl(NZ.trim);
    // mixer gains: [OSC1, OSC2, sub, noise, feedback] for mixer 1 then mixer 2
    const MX = P.mix, mg = this.mg;
    for (let b = 0; b < 2; b++) {
      const m = MX[b], j = b * 5;
      mg[j] = MD.lvl(m.osc1 + d[20 + j]); mg[j + 1] = MD.lvl(m.osc2 + d[21 + j]); mg[j + 2] = MD.lvl(m.sub + d[22 + j]); mg[j + 3] = MD.lvl(m.noise + d[23 + j]); mg[j + 4] = MD.lvl(m.fb + d[24 + j]) * 0.9;
    }
    // filters
    const FR = P.filt.routing, route = FR === 'serial1' ? 1 : FR === 'serial2' ? 2 : 0;
    const fl = this.fl, note = this.note;
    for (let f = 0; f < 2; f++) {
      const F = (f === 1 && P.filt.link) ? P.f[0] : P.f[f];
      const egv = this.src[MossVoice.egIx(F.eg)];
      const egShift = (F.egInt + eng.ccOff.fegInt) * egv;
      const modF = d[15 + f * 2] * 1 + d[19] + eng.ccOff.cutoff;
      const modR = d[16 + f * 2] + eng.ccOff.reso;
      const xa = F.freqA + egShift + modF + MossVoice.trk(note, F.keyLow, F.keyHigh, F.rampLow, F.rampHigh), ra = F.resoA + modR;
      const o = fl[f], ty = F.type;
      o.ft = ty === 'lpf' ? 0 : ty === 'hpf' ? 1 : ty === 'bpf' ? 2 : ty === 'dbpf' ? 4 : 3;
      if (xa !== o.xa || ra !== o.ra) { o.xa = xa; o.ra = ra; MossVoice.svfCoef(MD.cutHz(xa), MD.kReso(ra), sr, o.ca); }
      o.trA = MD.lvl(F.trimA) * 1.2;
      if (o.ft === 4) {
        const egShiftB = F.egIntB === undefined ? egShift : (F.egIntB + eng.ccOff.fegInt) * egv;
        const modFB = F.egIntB === undefined ? modF : d[39 + f] + d[19] + eng.ccOff.cutoff;
        const xb = F.freqB + egShiftB + modFB + MossVoice.trk(note, F.keyLowB === undefined ? F.keyLow : F.keyLowB, F.keyHighB === undefined ? F.keyHigh : F.keyHighB, F.rampLowB === undefined ? F.rampLow : F.rampLowB, F.rampHighB === undefined ? F.rampHigh : F.rampHighB);
        const rb = F.resoB + (F.egIntB === undefined ? modR : d[41 + f] + eng.ccOff.reso);
        if (xb !== o.xb || rb !== o.rb) { o.xb = xb; o.rb = rb; MossVoice.svfCoef(MD.cutHz(xb), MD.kReso(rb), sr, o.cb); }
        o.trB = MD.lvl(F.trimB) * 1.2;
      }
    }
    // amps
    let gt0 = 0, gt1 = 0;
    if (this.fading) this.fadeG = Math.max(0, this.fadeG - dtb / 0.02);
    for (let a = 0; a < 2; a++) {
      const A = P.amp[a];
      let ev = this.src[MossVoice.egIx(A.eg)]; if (ev < 0) ev = 0;
      const kdb = note < A.keyLow ? (A.keyLow - note) / 12 * A.rampLow / 99 * 12 : note > A.keyHigh ? (note - A.keyHigh) / 12 * A.rampHigh / 99 * 12 : 0;
      const g = MD.lvl(A.level + d[32 + a]) * ev * ev * Math.pow(10, MD.clamp(kdb, -60, 24) / 20);
      if (a === 0) gt0 = g * this.fadeG; else gt1 = g * this.fadeG;
    }
    const pan = MD.clamp(((P.out.pan < 0 ? 64 : P.out.pan) - 64) / 63 + d[34] / 99, -1, 1);
    const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
    const g1s = (gt0 - this.g1) / n, g2s = (gt1 - this.g2) / n;
    const pls = (pl - this.pl) / n, prs = (pr - this.pr) / n;
    let g1 = this.g1, g2 = this.g2, cpl = this.pl, cpr = this.pr, prevAmp = this.prevAmp;
    const f1 = this.flt[0], f2 = this.flt[1], fl0 = fl[0], fl1 = fl[1];
    const m10 = mg[0], m11 = mg[1], m12 = mg[2], m13 = mg[3], m14 = mg[4], m20 = mg[5], m21 = mg[6], m22 = mg[7], m23 = mg[8], m24 = mg[9];
    let peak = 0;
    const sub = this.sub, nz = this.nz, sw = S.wave, subBL = sw === 'saw' || sw === 'square', subD = MD.discs(sw), subN = subD.length, swI = MD.wI(sw);
    // an oscillator nobody can hear (both mixer levels 0, not used as another oscillator's input) is not computed
    // (only when its mixer levels are 0 and nothing modulates them, so it can never fade in with a stale state)
    const osc2on = this.bc[1].type !== 'none' && !(eng.cO2off && !this.readsInput(this.bc[0], 0)), oy = this.oy;
    const subOn = !(eng.cSubOff && !this.readsInput(this.bc[0], 1) && (this.bc[1].type === 'none' || !this.readsInput(this.bc[1], 1)));
    const io = this.io;
    for (let s = 0; s < n; s++) {
      // noise (the rnd() generator, inline)
      let sd = this.seed | 0; sd ^= sd << 13; sd ^= sd >>> 17; sd ^= sd << 5; this.seed = sd;
      const w = (sd >>> 0) / 4294967296 * 2 - 1;
      let noise = w;
      if (nzOn) {
        const v0 = w * nzTrim * 1.5, c = nc;
        const v3 = v0 - nz.b, v1 = c[0] * nz.a + c[1] * v3, v2 = nz.b + c[1] * nz.a + c[2] * v3;
        nz.a = MD.sat(2 * v1 - nz.a); let nl = 2 * v2 - nz.b; if (nl > 4 || nl < -4) nl = 4 * MD.tanh(nl / 4); nz.b = nl;
        if (!(nz.a === nz.a) || !(nz.b === nz.b)) { nz.a = 0; nz.b = 0; }
        noise = nzT === 0 ? v2 : nzT === 1 ? v0 - c[3] * v1 - v2 : v1 * c[3] * 1.5;
      }
      // sub oscillator (blepStep / waveI, inline)
      let subv = 0;
      if (!subOn) { /* silent and unused */ }
      else if (subBL) {
        let sp = sub.ph + subDt; if (sp >= 1) sp -= 1;
        sub.ph = sp;
        let v = swI === 0 ? 2 * sp - 1 : (sp < 0.5 ? 1 : -1);
        for (let k = 0; k < subN; k++) {
          const q = subD[k][0], h = subD[k][1];
          let dd = sp - q; if (dd < 0) dd += 1;
          if (dd < subDt) { const x = dd / subDt; sub.pend += h * 0.5 * x * x; v -= h * 0.5 * (1 - x) * (1 - x); }
        }
        subv = sub.pend; sub.pend = v;
      } else { let sp = sub.ph + subDt; if (sp >= 1) sp -= 1; sub.ph = sp; subv = swI === 2 ? 1 - 4 * Math.abs(sp - 0.5) : Math.sin(6.283185307179586 * sp); }
      // oscillators
      io[0] = subv; io[1] = noise;
      this.oscTick(0); const o1 = oy[0];
      this.prevO1 = o1;
      let o2 = 0; if (osc2on) { this.oscTick(1); o2 = oy[1]; }
      this.prevO2 = o2;
      const fbS = MD.tanh(prevAmp * 1.5);
      const b1 = o1 * m10 + o2 * m11 + subv * m12 + noise * m13 + fbS * m14;
      const b2 = o1 * m20 + o2 * m21 + subv * m22 + noise * m23 + fbS * m24;
      // filters: parallel feeds Filter 2 from Mixer 2; both serial routings feed it from Filter 1
      io[2] = b1; this.filtI(fl0, f1); const y1 = io[3];
      io[2] = route === 0 ? b2 : y1; this.filtI(fl1, f2); const y2 = io[3];
      const in1 = route === 1 ? y2 : y1, in2 = route === 1 ? b2 : y2;
      this.prevF1 = y1; this.prevF2 = y2;
      g1 += g1s; g2 += g2s; cpl += pls; cpr += prs;
      const out = in1 * g1 + in2 * g2;
      prevAmp = out;
      const ao = out < 0 ? -out : out; if (ao > peak) peak = ao;
      L[off + s] += out * cpl; R[off + s] += out * cpr;
    }
    this.prevAmp = prevAmp;
    this.g1 = gt0; this.g2 = gt1; this.pl = pl; this.pr = pr;
    // voice end: once released, the voice ends when every EG the amps use has finished (an EG that holds a
    // release level above 0 fades out over 20 ms instead of sounding for ever), or after 0.3 s of silence
    if (!this.gate && !eng.sustainHeld(this)) {
      if (peak < 2e-5) this.silent += dtb; else this.silent = 0;
      const ae = this.egs[4];
      if ((ae.stage === 0 && P.amp[0].eg === 'amp' && P.amp[1].eg === 'amp') || this.silent > 0.3 || this.fadeG <= 0) this.kill();
      else if (!this.fading && (gt0 > 0 || gt1 > 0) && (gt0 === 0 || this.egDone(P.amp[0].eg)) && (gt1 === 0 || this.egDone(P.amp[1].eg))) this.fading = true;
    }
    if (!(this.prevAmp === this.prevAmp)) this.kill();
  }
  egDone(sel) { const k = MossVoice.egIx(sel) - 1; if (k < 0) return true; const st = this.egs[k].stage; return st === 0 || st === 6; }
  static egIx(sel) { switch (sel) { case 'eg1': return 1; case 'eg2': return 2; case 'eg3': return 3; case 'eg4': return 4; case 'amp': return 5; } return 0; } // src[0] is always 0
  egVal(sel) { switch (sel) { case 'eg1': return this.src[1]; case 'eg2': return this.src[2]; case 'eg3': return this.src[3]; case 'eg4': return this.src[4]; case 'amp': return this.src[5]; } return 0; }
  static trk(n, kl, kh, rl, rh) { return n < kl ? (kl - n) / 12 * 9.9 * (rl / 50) : n > kh ? (n - kh) / 12 * 9.9 * (rh / 50) : 0; }
  // one filter per sample: ft 0 LPF, 1 HPF, 2 BPF, 3 BRF, 4 dual band-pass (same maths as filt()/svf())
  filtI(c, st) { // input this.io[2], output this.io[3]
    const x = this.io[2], ft = c.ft;
    if (ft === 4) { this.io[3] = (this.svfB(c.ca, st, 0, x * c.trA) * c.ca[3] + this.svfB(c.cb, st, 2, x * c.trB) * c.cb[3]) * 1.2; return; }
    const ca = c.ca, v0 = x * c.trA, s0 = st[0], s1 = st[1];
    const v3 = v0 - s1, v1 = ca[0] * s0 + ca[1] * v3, v2 = s1 + ca[1] * s0 + ca[2] * v3;
    let a = MD.sat(2 * v1 - s0), l = 2 * v2 - s1; if (l > 4 || l < -4) l = 4 * MD.tanh(l / 4);
    if (!(l === l) || !(a === a)) { a = 0; l = 0; }
    st[0] = a; st[1] = l;
    const k = ca[3];
    this.io[3] = ft === 0 ? v2 : ft === 1 ? v0 - k * v1 - v2 : ft === 2 ? v1 * k * 1.4 : v0 - k * v1;
  }
  svfB(c, st, j, v0) { // band-pass output of svf()
    const s0 = st[j], s1 = st[j + 1];
    const v3 = v0 - s1, v1 = c[0] * s0 + c[1] * v3, v2 = s1 + c[1] * s0 + c[2] * v3;
    let a = MD.sat(2 * v1 - s0), l = 2 * v2 - s1; if (l > 4 || l < -4) l = 4 * MD.tanh(l / 4);
    if (!(l === l) || !(a === a)) { a = 0; l = 0; }
    st[j] = a; st[j + 1] = l;
    return v1;
  }

}

// ---------- Engine ----------
class MossEngine {
  constructor(sr) {
    this.sr = sr; this.patch = null; this.clock = 1;
    this.voices = []; for (let i = 0; i < 16; i++) this.voices.push(new MossVoice(sr, i));
    // Trinity PCM programs use their own voice pool (32 voices) and the stand-in sample store
    this.mvoices = this.voices; this.pvoices = null; this.store = typeof PcmStore !== 'undefined' ? new PcmStore(sr) : null;
    // combinations: up to 8 timbres, each an engine of its own (see MossCombi); a timbre's engine runs 'dry' (no effects)
    this.combi = null; this.dry = false; this.vcap = 0;
    this.ctl = { at: 0, jsy: 0, jsyn: 0, jsx: 0, ribbon: 0, ribZ: 0, foot: 0, sw1: 0, sw2: 0, sustain: false, expr: 1 };
    this.cc = {};
    this.ccOff = { cutoff: 0, reso: 0, fegInt: 0 };
    this.glfo = [0, 1, 2, 3].map(i => new MossLFO(777 + i * 31)); this.glfoVal = [0, 0, 0, 0];
    this.lfoRate = [1, 1, 1, 1]; this.lfoAmp = [1, 1, 1, 1]; this.lfoRateMod = 0; this.lfF = new Float64Array(4).fill(NaN);
    this.held = []; this.monoVoices = []; this.lastNote = null;
    // tuning: cents offset per note (indexed by the key that was pressed), master tune as a semitone offset
    this.tuneCents = new Float32Array(128); this.tuneRef = 0; this.keyShift = new Int16Array(128);
    this.fx = new FxRack(sr); this.fxTrig = 0;
    this.bufL = new Float32Array(128); this.bufR = new Float32Array(128);
    this.SRC_INDEX = { off: 0, eg1: 1, eg2: 2, eg3: 3, eg4: 4, ampeg: 5, lfo1: 6, lfo2: 7, lfo3: 8, lfo4: 9, vel: 10, key: 11, at: 12, jsy: 13, jsyn: 14, jsx: 15, ribbon: 16, foot: 17, sw1: 18, sw2: 19,
      porta: 20, velS: 21, velH: 22, keyExp: 23, splitH: 24, splitL: 25, atjs: 26, ribP: 27, ribN: 28, ribZ: 29, slider: 30, cc19: 31, fsw: 32, cc83: 33, kn1: 34, kn3: 35, kn4: 36 };
    this.DST_INDEX = { pitch: 1, pitch1: 2, pitch2: 3, pitchSub: 4, o1A: 5, o1B: 6, o2A: 7, o2B: 8, o1Lvl: 9, o2Lvl: 10, noiseFreq: 14, f1Freq: 15, f1Reso: 16, f2Freq: 17, f2Reso: 18, fFreq: 19,
      m1o1: 20, m1o2: 21, m1sub: 22, m1noise: 23, m1fb: 24, m2o1: 25, m2o2: 26, m2sub: 27, m2noise: 28, m2fb: 29, portaTime: 31, amp1: 32, amp2: 33, pan: 34, lfo1Rate: 35, lfo2Rate: 36, lfo3Rate: 37, lfo4Rate: 38,
      f1FreqB: 39, f2FreqB: 40, f1ResoB: 41, f2ResoB: 42 };
    for (let i = 0; i < 8; i++) { this.DST_INDEX['o1m' + i] = 43 + i; this.DST_INDEX['o2m' + i] = 51 + i; }
    this.pkt = 0; this.time = 0; this.percAt = -1;
    // patch routing resolved to indices once per edit (not per block): see compile()
    this.cEG = new Int16Array(15).fill(-1); this.cLFO = new Int16Array(12).fill(-1); this.cMods = []; this.cModsN = 0; this.cKp = [0, 0]; this.cDbl = false; this.cO2off = false; this.cSubOff = false;
    this.egSus = 0; this.egTime = new Float64Array(4); // CC 70 / 73, 75, 72 offsets for every EG
  }
  compile() {
    const P = this.patch; if (!P) return;
    if (P.kind === 'pcm') { this.cMods = []; this.cModsN = 0; this.cDbl = false; this.cO2off = false; this.cSubOff = true; return; }
    const SI = this.SRC_INDEX, DI = this.DST_INDEX;
    const src = k => (k && k !== 'off') ? (SI[k] === undefined ? 0 : SI[k]) : -1; // 0 reads the always-zero slot
    for (let i = 0; i < 5; i++) { const p = i < 4 ? P.eg[i] : P.ampEG; this.cEG[i * 3] = src(p.lvlSrc); this.cEG[i * 3 + 1] = src(p.tSrc); this.cEG[i * 3 + 2] = src(p.nSrc); }
    for (let i = 0; i < 4; i++) { const L = P.lfo[i]; this.cLFO[i * 3] = src(L.fm1); this.cLFO[i * 3 + 1] = src(L.fm2); this.cLFO[i * 3 + 2] = src(L.am); }
    const M = [], kp = [0, 0];
    for (const m of P.mods) {
      if (m.src !== 'off' && m.amt > 0) { if (m.dst === 'o1m3') kp[0] += m.amt; else if (m.dst === 'o2m3') kp[1] += m.amt; }
      if (!m.amt || m.src === 'off' || m.dst === 'off') continue;
      const si = SI[m.src], di = DI[m.dst];
      if (si === undefined || di === undefined) continue;
      const vi = (m.via && m.via !== 'off') ? SI[m.via] : undefined;
      M.push(si, vi === undefined ? -1 : vi, di, di <= 4 ? MD.pitchScale(m.amt) : m.amt);
    }
    this.cMods = M; this.cModsN = M.length; this.cKp = kp;
    const modded = d => P.mods.some(m => m.dst === d && m.src !== 'off' && m.amt);
    this.cO2off = P.mix[0].osc2 <= 0 && P.mix[1].osc2 <= 0 && !modded('m1o2') && !modded('m2o2');
    this.cSubOff = P.mix[0].sub <= 0 && P.mix[1].sub <= 0 && !modded('m1sub') && !modded('m2sub');
    const t = P.osc[0].type; this.cDbl = t === 'brass' || t === 'reed' || t === 'pluck' || t === 'bowed';
  }
  // Organ Model, Single trigger: percussion only for a note played with no other key down
  // (notes of a chord struck together, within 30 ms, all get it, as on a tonewheel organ)
  percussionOK() {
    if (this.held.length <= 1) { this.percAt = this.time; return true; }
    return this.time - this.percAt < 0.03;
  }
  syncHz(L) {
    const beats = [0.25, 1 / 3, 0.5, 2 / 3, 1, 4 / 3, 2, 4][MD.clamp(L.mbase | 0, 0, 7)] * ((L.mtimes | 0) + 1);
    const bpm = MD.clamp((this.patch.voice && this.patch.voice.tempo) || 120, 40, 240);
    return bpm / 60 / beats;
  }
  sustainHeld(v) { return this.ctl.sustain && v.sustained; }
  // joystick X bend; the program's bend Step (0 = continuous) makes it move in steps of that many semitones
  bendSemis() {
    const x = this.ctl.jsx, V = this.patch.voice, b = x >= 0 ? x * V.bendUp : -x * V.bendDown, st = x >= 0 ? V.bendStepUp : V.bendStepDown;
    return st > 0 ? Math.round(b / st) * st : b;
  }
  applyEgOffsets(eg) { eg.susOff = this.egSus; eg.timeOff = this.egTime; }
  handle(m) {
    if (this.combi) {
      if (m.t === 'patch' && !(m.p && m.p.kind === 'combi')) { this.combi.stop(); this.combi = null; }
      else if (m.t !== 'tune' && m.t !== 'pcmMap' && m.t !== 'pcmPack') { this.combi.handle(m); return; }
    }
    switch (m.t) {
      case 'patch': {
        if (m.p && m.p.kind === 'combi') { for (const v of this.voices) if (v.active) v.kill(); this.held = []; this.monoVoices = []; this.patch = m.p; this.combi = new MossCombi(this); this.combi.handle(m); break; }
        const pcm = m.p && m.p.kind === 'pcm';
        if (pcm && !this.pvoices) { this.pvoices = []; for (let i = 0; i < 32; i++) this.pvoices.push(new PcmVoice(this.sr, i)); }
        const pool = pcm ? this.pvoices : this.mvoices;
        if (pool !== this.voices) { for (const v of this.voices) if (v.active) v.kill(); this.voices = pool; this.monoVoices = []; }
        this.patch = m.p; this.compile(); if (!this.patch.voice.hold) this.releaseUnheld(); break;
      }
      case 'pcmMap': if (this.store) this.store.setMap(m.map); break;
      case 'pcmPack': if (this.store) this.store.putPack(m.name, m.zones); break;
      case 'set': {
        const ks = m.path.split('.'); let o = this.patch; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = m.v;
        if (ks[0] !== 'fx') this.compile();
        if (m.path === 'voice.hold' && !m.v) this.releaseUnheld();
        break;
      }
      case 'on': this.noteOn(m.n, m.v, m.k); break;
      case 'tune': if (m.cents && m.cents.length === 128) this.tuneCents.set(m.cents); if (m.a4 > 0) this.tuneRef = 12 * Math.log2(m.a4 / 440); break;
      case 'off': this.noteOff(m.n); break;
      case 'cc': this.ccIn(m.c, m.v); break;
      case 'bend': this.ctl.jsx = m.v; break;
      case 'at': this.ctl.at = m.v; break;
      case 'ribz': this.ctl.ribZ = m.v ? 1 : 0; break;
      case 'panic': for (const v of this.voices) v.kill(); this.held = []; break;
    }
  }
  ccIn(c, v) {
    const x = v / 127;
    this.cc[c] = v;
    if (c === 70) this.egSus = (v - 64) / 64 * 99;
    else if (c === 73) this.egTime[0] = (v - 64) / 64 * 99;
    else if (c === 75) { this.egTime[1] = (v - 64) / 64 * 99; this.egTime[2] = this.egTime[1]; }
    else if (c === 72) this.egTime[3] = (v - 64) / 64 * 99;
    if (c === 1) this.ctl.jsy = x;
    else if (c === 2) this.ctl.jsyn = x;
    else if (c === 4) this.ctl.foot = x;
    else if (c === 11) this.ctl.expr = x;
    else if (c === 16) this.ctl.ribbon = x * 2 - 1;
    else if (c === 80) this.ctl.sw1 = x >= 0.5 ? 1 : 0;
    else if (c === 81) this.ctl.sw2 = x >= 0.5 ? 1 : 0;
    else if (c === 64) { this.ctl.sustain = v >= 64; if (!this.ctl.sustain) for (const vv of this.voices) if (vv.sustained) { vv.sustained = false; if (!vv.gate) vv.release(); } }
    else if (c === 74) this.ccOff.cutoff = (v - 64) / 64 * 40;
    else if (c === 71) this.ccOff.reso = (v - 64) / 64 * 60;
    else if (c === 79) this.ccOff.fegInt = (v - 64) / 64 * 99;
    else if (c === 120) { for (const vv of this.voices) vv.kill(); this.held = []; this.monoVoices = []; }
    else if (c === 123) { for (const vv of this.voices) { vv.sustained = false; if (vv.active) vv.release(); } this.held = []; }
  }
  isMono() { return this.patch.voice.mode !== 'poly'; }
  // voices still gated although their key is up (latched by Hold, or left over from another program) are let go
  releaseUnheld() {
    for (const v of this.voices) if (v.active && v.gate && !this.held.includes(v.note)) {
      if (this.ctl.sustain) { v.sustained = true; v.gate = false; } else v.release();
    }
  }
  tuneSemis(p) {
    const t = this.tuneCents;
    if (!(p > 0)) return t[0] / 100 + this.tuneRef;
    if (p >= 127) return t[127] / 100 + this.tuneRef;
    const i = Math.floor(p), f = p - i;
    return (t[i] + (t[i + 1] - t[i]) * f) / 100 + this.tuneRef;
  }
  maxV() { const P = this.patch, m = P.kind === 'pcm' ? (P.mode === 'double' ? 16 : 32) : MD.clamp(P.voice.maxVoices | 0, 1, 16); return this.vcap > 0 && this.vcap < m ? this.vcap : m; }
  uniOffsets() {
    const V = this.patch.voice, n = V.unison | 0;
    if (n <= 1) return [0];
    const sp = (V.uniDetune || 0) / 99 * 0.5, out = [];
    for (let i = 0; i < n; i++) out.push((i / (n - 1) * 2 - 1) * sp);
    return out;
  }
  noteOn(note, vel, key) {
    if (!this.patch) return;
    if (vel <= 0) return this.noteOff(note);
    { const fx = this.fx.x; fx.note = note; fx.vel = vel / 127; fx.trig++; }
    this.keyShift[note] = (key === undefined || key === null) ? 0 : MD.clamp(note - key, -127, 127);
    const V = this.patch.voice, v01 = vel / 127;
    const wasEmpty = this.held.length === 0 && !this.voices.some(v => v.active && v.gate);
    this.held = this.held.filter(n => n !== note); this.held.push(note);
    if (wasEmpty && this.patch.lfo) for (let i = 0; i < 4; i++) if (this.patch.lfo[i].sync === 'timbre') this.glfo[i].reset(this.patch.lfo[i].wave);
    const offs = this.uniOffsets();
    if (this.isMono()) {
      const chosen = this.monoPick();
      if (chosen !== note && this.monoVoices.length && this.monoVoices[0].active) return;
      this.monoPlay(note, v01, !wasEmpty);
      return;
    }
    if (V.hold) for (const v of this.voices) if (v.active && v.gate && v.note === note) v.release(); // Hold: the new strike replaces the latched one
    const maxV = this.maxV();
    const glide = V.porta && !V.portaFingered ? this.lastNote : (V.porta && V.portaFingered && !wasEmpty ? this.lastNote : null);
    for (const off of offs) {
      const v = this.alloc(maxV);
      v.sustained = false;
      v.start(this, note, v01, off, false, glide);
    }
    this.lastNote = note;
  }
  monoPick() {
    const V = this.patch.voice, h = this.held;
    if (!h.length) return null;
    if (V.priority === 'low') return Math.min(...h);
    if (V.priority === 'high') return Math.max(...h);
    return h[h.length - 1];
  }
  monoPlay(note, v01, legatoPossible) {
    const V = this.patch.voice, offs = this.uniOffsets(), maxV = this.maxV();
    const alive = this.monoVoices.filter(v => v.active);
    const legato = legatoPossible && alive.length > 0 && alive[0].gate && V.mode === 'monoSingle';
    const glideOK = V.porta && (!V.portaFingered || (legatoPossible && alive.length && alive[0].gate));
    if (alive.length === offs.length && alive.length) {
      alive.forEach((v, i) => {
        const from = glideOK ? v.pitch : null;
        if (legato) { v.target = note; v.note = note; v.gate = true; if (!glideOK) v.pitch = note; v.glideSpan = Math.abs(v.target - v.pitch); }
        else { v.start(this, note, v01, offs[i], false, from); if (!glideOK) v.pitch = note; }
      });
    } else {
      for (const v of this.monoVoices) v.kill();
      this.monoVoices = [];
      for (let i = 0; i < Math.min(offs.length, maxV); i++) {
        const v = this.voices[i];
        v.start(this, note, v01, offs[i], false, glideOK && this.lastNote !== null ? this.lastNote : null);
        this.monoVoices.push(v);
      }
    }
    this.lastNote = note;
  }
  alloc(maxV) {
    let best = null;
    for (let i = 0; i < maxV; i++) { const v = this.voices[i]; if (!v.active) return v; }
    for (let i = 0; i < maxV; i++) { const v = this.voices[i]; if (!v.gate && !v.sustained && (!best || v.age < best.age)) best = v; }
    if (!best) for (let i = 0; i < maxV; i++) { const v = this.voices[i]; if (!v.gate && (!best || v.age < best.age)) best = v; } // held only by the pedal
    if (!best) for (let i = 0; i < maxV; i++) { const v = this.voices[i]; if (!best || v.age < best.age) best = v; }
    best.kill(); return best;
  }
  noteOff(note) {
    if (!this.patch) return;
    this.held = this.held.filter(n => n !== note);
    if (this.patch.voice.hold) return; // Hold: notes keep sounding as if the key were still down
    if (this.isMono()) {
      for (const v of this.voices) if (v.active && v.gate && v.note === note && !this.monoVoices.includes(v)) { if (this.ctl.sustain) { v.sustained = true; v.gate = false; } else v.release(); }
      const alive = this.monoVoices.filter(v => v.active);
      if (!alive.length || alive[0].note !== note) return;
      const next = this.monoPick();
      if (next !== null) { this.monoPlay(next, alive[0].vel, true); return; }
      for (const v of alive) { if (this.ctl.sustain) { v.sustained = true; v.gate = false; } else v.release(); }
      return;
    }
    for (const v of this.voices) if (v.active && v.gate && v.note === note) {
      if (this.ctl.sustain) { v.sustained = true; v.gate = false; }
      else v.release();
    }
  }
  voiceStates() { if (this.combi) return this.combi.voiceStates(); const a = []; const m = this.maxV(); for (let i = 0; i < m; i++) a.push(this.voices[i].active ? (this.voices[i].gate ? 2 : 1) : 0); return a; }
  // effect dynamic-modulation sources, in the Trinity's order (0 None ... 25 Tempo)
  fxSources() {
    const x = this.fx.x, S = x.src, c = this.ctl, cc = this.cc, v7 = k => (cc[k] === undefined ? -1 : cc[k] / 127);
    const held = this.held.length > 0, sus = held || (c.sustain && this.voices.some(v => v.active && v.sustained));
    const retrig = x.trig !== this.fxTrig; this.fxTrig = x.trig;
    S[1] = held ? 1 : 0; S[2] = sus ? 1 : 0; S[3] = held && !retrig ? 1 : 0; S[4] = sus && !retrig ? 1 : 0;
    S[5] = x.note / 127; S[6] = x.vel; S[7] = c.at; S[8] = c.jsy; S[9] = c.jsyn; S[10] = c.jsx; S[11] = c.ribbon; S[12] = c.ribZ;
    S[13] = c.sw1; S[14] = c.sw2; S[15] = (cc[82] || 0) >= 64 ? 1 : 0; S[16] = c.foot; S[17] = c.sustain ? 1 : 0;
    const vol = v7(7), pan = v7(10); S[18] = vol < 0 ? 1 : vol; S[19] = pan < 0 ? 0.5 : pan; S[20] = c.expr;
    S[21] = Math.max(0, v7(12)); S[22] = Math.max(0, v7(13)); S[23] = Math.max(0, v7(18)); S[24] = Math.max(0, v7(19)); S[25] = 0;
    // extra controllers used by Triton programs: knobs 1, 3, 4 (CC17, 20, 21), knobs 1-4 [+] (upper half), CC65, CC66, CC83
    const k1 = Math.max(0, v7(17)), k2 = Math.max(0, v7(19)), k3 = Math.max(0, v7(20)), k4 = Math.max(0, v7(21)), up = v => Math.max(0, v * 2 - 1);
    S[26] = k1; S[27] = k3; S[28] = k4; S[29] = up(k1); S[30] = up(k2); S[31] = up(k3); S[32] = up(k4);
    S[33] = (cc[65] || 0) >= 64 ? 1 : 0; S[34] = (cc[66] || 0) >= 64 ? 1 : 0; S[35] = Math.max(0, v7(83));
  }
  process(outL, outR, n, mic) {
    if (this.combi) return this.combi.process(outL, outR, n, mic);
    outL.fill(0); outR.fill(0);
    if (!this.patch) return;
    const P = this.patch;
    let off = 0;
    while (off < n) {
      const bn = Math.min(16, n - off), dtb = bn / this.sr;
      if (P.lfo) for (let i = 0; i < 4; i++) {
        const L = P.lfo[i];
        this.lfoRateMod = this.cc[76] !== undefined ? (this.cc[76] - 64) / 64 * 60 : 0;
        const lf = L.freq + this.lfoRateMod;
        if (L.msync) { this.lfoRate[i] = this.syncHz(L); this.lfF[i] = NaN; }
        else if (lf !== this.lfF[i]) { this.lfF[i] = lf; this.lfoRate[i] = MD.lfoHz(lf); }
        this.lfoAmp[i] = 1;
        this.glfoVal[i] = this.glfo[i].step(this.lfoRate[i], dtb, L.wave);
      }
      const vs = this.voices;
      for (let k = 0; k < vs.length; k++) if (vs[k].active) vs[k].renderBlock(this, outL, outR, off, bn);
      off += bn;
    }
    this.time += n / this.sr;
    // program level comes before the effects (as on the Trinity), then the insert and master effects, then a soft limit
    const g = Math.pow((P.out.level || 0) / 127, 2) * 0.6 * this.ctl.expr * (P.out.trim === undefined ? 1 : P.out.trim);
    for (let i = 0; i < n; i++) { outL[i] *= g; outR[i] *= g; }
    if (this.dry) return; // a combination's timbre: the combination adds its own effects
    this.fxSources(); this.fx.x.mic = mic || null;
    this.fx.process(outL, outR, n, P.fx);
    this.limit(outL, outR, n);
  }
  limit(outL, outR, n) {
    // output stage: a peak limiter (instant attack, 120 ms release) keeps hot programs clean below full scale,
    // then a soft clip catches anything left
    const rel = this.limRel || (this.limRel = Math.exp(-1 / (0.12 * this.sr))), ceil = 0.89;
    let env = this.limEnv || 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(outL[i]), Math.abs(outR[i]));
      env = a > env ? a : env * rel + a * (1 - rel);
      const gl = env > ceil ? ceil / env : 1;
      outL[i] = MD.tanh(outL[i] * gl); outR[i] = MD.tanh(outR[i] * gl);
    }
    this.limEnv = env > 1e-9 ? env : 0; this.limGain = env > ceil ? ceil / env : 1;
  }
}

