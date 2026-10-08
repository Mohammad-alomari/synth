// ===== Trinity PCM ("ACCESS") synthesis =====
// Two oscillators per voice (Single / Double). Drum-mode programs (drum kits) are not supported and stay silent. Each oscillator plays a multisample (chosen by
// velocity between a higher and a lower one), then two filters (A, B: LPF/HPF/BPF/BRF; parallel, serial, single or
// through), then its amp. Per oscillator: filter EG, amp EG, OSC LFO (pitch), filter LFO; one pitch EG per voice.
// Parameter ranges and meanings follow Korg's Trinity program table (MIDI implementation, TABLE 1).
// Korg's sample ROM is not available: every multisample is played by a stand-in (PcmStore).

class PCM {
  static lfoHz(v) { return 0.03 * Math.pow(1000, (v < 0 ? 0 : v > 140 ? 140 : v) / 99); } // 0: 0.03 Hz, 50: 1 Hz, 75: 5.4 Hz, 99: 30 Hz
  // The laws below marked "measured" come from playing the same factory programs here and in KORG Collection
  // TRINITY 1.1.4 with the same values (black box: rendered audio and Korg's manual; 2026-10).
  // Filter cutoff 0..99 -> Hz (measured, five programs within 1 %): ten octaves, 19.6 Hz .. 20 kHz when the
  // oscillator sounds middle C; the keyboard tracking (ftrack) is added to x in the same steps (9.9 per octave)
  static cutHz(x, sr) { const f = 19.6 * Math.pow(2, x * 0.1010101); return f > sr * 0.45 ? sr * 0.45 : f; }
  // Filter EG reach (measured): 10 octaves x level/100 x intensity/100 = 0.98 steps per intensity step at level 99
  static get EGK() { return 0.98; }
  // Filter keyboard tracking in cutoff steps (measured): the cutoff follows the sounding pitch p (note number: key +
  // transposes + octave) by 43/105 octave per octave on every key; a ramp adds ramp/105 beyond its breakpoint.
  // Korg's manual says the same in its own words: ramp +62 = as the pitch, -43 = none.
  static ftrack(p, kl, kh, rl, rh) { return (43 * (p - 60) + (p > kh ? rh * (p - kh) : 0) - (p < kl ? rl * (kl - p) : 0)) * 0.00785714; } // x 9.9 / (105 x 12)
  // bend STEP list (Korg): 0 continuous, 1 = 1/8 semitone, 2 = 1/4, 3 = 1/2, 4 = 1 ... 15 = 12 semitones
  static stepSemis(v) { return !(v > 0) ? 0 : v < 4 ? [0.125, 0.25, 0.5][v - 1] : v - 3; }
  // Resonance 0..31 -> filter damping k = 1/Q (measured on the low-pass: Q 0.5 at 0, 1.8 at 8, 4.4 at 16, 8.8 at 20,
  // 19 at 24; from 28-30 Korg's filter sounds by itself, here Q ends at 100 and the filter's limit (PcmVoice) holds it)
  static kReso(r) {
    const Q = PCM.QT || (PCM.QT = new Float64Array([0.5, 0.61, 0.74, 0.86, 0.99, 1.13, 1.30, 1.52, 1.77, 1.96, 2.16, 2.36, 2.58, 2.96, 3.39, 3.88, 4.45, 5.25, 6.2, 7.4, 8.78, 10.6, 12.9, 15.7, 19.2, 23.6, 29, 37, 47, 60, 77, 100]));
    r = r < 0 ? 0 : r > 31 ? 31 : r; const i = r | 0, f = r - i;
    return 1 / (i >= 31 ? Q[31] : Q[i] + (Q[i + 1] - Q[i]) * f);
  }
  // EG time 0..99 -> seconds (measured on the amp EG, the filter EG keeps it): 2^((v - 60) / 10), so 60 = 1 s and
  // +10 doubles; above 80 it grows faster, up to 92 s at 99. 0 = at once (PcmEG: a fall still takes 16 ms).
  static tsec(v) {
    if (!(v > 0)) return 0;
    if (v <= 80) return Math.pow(2, (v - 60) / 10);
    const T = PCM.TT || (PCM.TT = new Float64Array([4, 4.33, 4.69, 5.11, 5.60, 6.16, 6.85, 7.66, 8.69, 9.94, 11.49, 13.45, 15.99, 19.36, 23.98, 30.65, 39.40, 52.54, 68.95, 91.95]));
    const x = (v > 99 ? 99 : v) - 80, i = x | 0;
    return i >= 19 ? T[19] : T[i] + (T[i + 1] - T[i]) * (x - i);
  }
  // Level of a PCM voice against the stored output trim (measured: a full-scale sine at full settings leaves Korg's
  // plugin at -14.2 dBFS; three of Korg's recordings played from the local packs then sit within about 2 dB of it)
  static get GAIN() { return 0.29; }
  // Amp keyboard tracking -> gain (measured on three programs; Korg's manual gives the directions): below the low key
  // a positive ramp makes the sound softer and a negative one louder, above the high key a positive ramp louder and a
  // negative one softer, by ramp/100 of the level per two octaves, as amplitude; never more than double. p is the
  // pitch the oscillator sounds (as ftrack); the low key is tested first (it may lie above the high key).
  static atrack(p, kl, kh, rl, rh) { const g = p < kl ? 1 - rl * (kl - p) / 2400 : p > kh ? 1 + rh * (p - kh) / 2400 : 1; return g < 0 ? 0 : g > 2 ? 2 : g; }
  // The filter's limit (measured: a full-level sine at resonance 16+ comes out at most 3.9 dB above its level, with
  // harmonics; Korg's manual: "if the sound is distorting ... lower Trim"). The filter's two states stop at this
  // level (a full-scale sample is 1; 0.95 fits the measured gains best).
  static get FSAT() { return 0.95; }
  // EG time multiplier from keyboard track (center C4) and velocity: +99 halves the time per octave / at full velocity
  static tmul(kt, vt, note, v) { return Math.pow(2, -(kt / 99) * (note - 60) / 12 - (vt / 99) * (v * 2 - 1)); }
  // a tiny deterministic noise source for the stand-in noise waves
  static hash(i) { let x = (i * 374761393) | 0; x = (x ^ (x >>> 13)) * 1274126177 | 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296 * 2 - 1; }
}

// ---- envelope: start > attack > (decay > break) > (slope > sustain) > release ----
// Shapes as measured (see PCM): a rise is a straight line that takes the segment's time T. A fall is exponential,
// e^(-4.2 t/T), shifted so that it arrives exactly at T. An amp EG (zero = true) falling to silence is the one
// exception: 1.001 e^(-4.2 t/T) - 0.001 of the way, -20 dB at 0.55 T, -37 dB at T, silent at 1.65 T. A segment ends
// when it arrives. A time of 0 is at once for a rise and 16 ms (the law's value at 0) for a fall.
class PcmEG {
  constructor(zero) { this.stage = 0; this.val = 0; this.from = 0; this.t = 0; this.L = new Float64Array(5); this.T = new Float64Array(4); this.hold = false; this.zero = !!zero; }
  // levels: [start, attack, break, sustain, release] in -1..1 ; times: [attack, decay, slope, release] seconds
  start(L0, L1, L2, L3, L4, T0, T1, T2, T3) {
    const L = this.L, T = this.T; L[0] = L0; L[1] = L1; L[2] = L2; L[3] = L3; L[4] = L4; T[0] = T0; T[1] = T1; T[2] = T2; T[3] = T3;
    this.val = L0; this.from = L0; this.stage = 1; this.t = 0;
  }
  release() { if (this.stage > 0 && this.stage < 5) { this.stage = 5; this.t = 0; this.from = this.val; } }
  kill() { this.stage = 0; this.val = 0; }
  done() { return this.stage === 0 || this.stage === 6; }
  tick(dt) {
    let g = 0;
    while (g++ < 6) {
      const st = this.stage;
      if (st === 0 || st === 6) return this.val;
      if (st === 4) { this.val = this.L[3]; return this.val; }
      let T = st === 5 ? this.T[3] : this.T[st - 1]; const tg = st === 5 ? this.L[4] : this.L[st];
      if (tg >= this.from) { // a rise
        if (T <= 0) { this.val = tg; this.adv(); continue; }
        this.t += dt;
        if (this.t >= T) { this.val = tg; this.adv(); return this.val; }
        this.val = this.from + (tg - this.from) * (this.t / T);
        return this.val;
      }
      if (T <= 0) T = 0.015625;
      this.t += dt;
      const e = Math.exp(-4.2 * this.t / T), h = this.zero && tg === 0 ? 1.001 * e - 0.001 : (e - 0.0149956) * 1.0152239;
      if (h <= 0) { this.val = tg; this.adv(); return this.val; }
      this.val = tg + (this.from - tg) * h;
      return this.val;
    }
    return this.val;
  }
  adv() { this.from = this.val; this.t = 0; if (this.stage === 5) { this.stage = 6; return; } if (this.stage < 4) this.stage++; }
}

// ---- LFO: Triangle/Saw/Rectangle/Sine at 0/90/180/270 degrees, Guitar, Random 1-6 ----
class PcmLFO {
  constructor(seed) { this.ph = 0; this.seed = seed | 0 || 1; this.r0 = 0; this.r1 = 0; this.cur = 0; this.hold = 1; this.t = 0; }
  rnd() { let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x; return (x >>> 0) / 4294967296 * 2 - 1; }
  reset() { this.ph = 0; this.t = 0; this.r0 = this.rnd(); this.r1 = this.rnd(); this.hold = 1; }
  static tri(q) { q = q - Math.floor(q); return q < 0.25 ? q * 4 : q < 0.75 ? 2 - q * 4 : q * 4 - 4; }
  step(hz, dt, w) {
    const prev = this.ph; this.ph += hz * dt; let wrap = false;
    if (this.ph >= 1) { this.ph -= Math.floor(this.ph); wrap = true; }
    const p = this.ph, tri = PcmLFO.tri;
    switch (w) {
      case 'tri0': return tri(p); case 'tri90': return tri(p + 0.25); case 'tri180': return tri(p + 0.5); case 'tri270': return tri(p + 0.75);
      case 'sawup0': return p * 2 - 1; case 'sawup180': return ((p + 0.5) % 1) * 2 - 1;
      case 'sawdn0': return 1 - p * 2; case 'sawdn180': return 1 - ((p + 0.5) % 1) * 2;
      case 'rect0': return p < 0.5 ? 1 : -1; case 'rect180': return p < 0.5 ? -1 : 1;
      case 'sine0': return Math.sin(6.283185307179586 * p); case 'sine180': return -Math.sin(6.283185307179586 * p);
      case 'guitar': return (tri(p) + 1) * 0.5; // bends only upward, like a guitarist's vibrato
      default: { // random 1-6: 1 level random at a fixed time, 2 time random/level fixed, 3 both; 4-6 the same with ramps
        const n = w.charCodeAt(3) - 48, ramp = n > 3, m = ramp ? n - 3 : n;
        if (wrap || p < prev) {
          this.r0 = this.r1;
          this.r1 = m === 2 ? (this.r1 > 0 ? -1 : 1) : this.rnd();
          if (m !== 1) this.hold = 0.35 + Math.random() * 1.3;
        }
        if (m !== 1) { this.t += hz * dt; if (this.t >= this.hold) { this.t = 0; this.r0 = this.r1; this.r1 = m === 2 ? (this.r1 > 0 ? -1 : 1) : this.rnd(); this.hold = 0.35 + Math.random() * 1.3; } }
        const f = m === 1 ? p : MD.clamp(this.t / this.hold, 0, 1);
        return ramp ? this.r0 + (this.r1 - this.r0) * f : this.r0;
      }
    }
  }
}

// ---- stand-in multisamples ----
// A zone: { lo, hi, root (MIDI note at the stored rate, may be fractional), rate, data: Float32Array, ls, le (loop; le <= 0: one-shot), gain, start }
// Packs (decoded stand-in recordings) arrive from the page; built-in waveforms are generated here on first use.
class PcmStore {
  constructor(sr) { this.sr = sr; this.packs = new Map(); this.map = { ms: {} }; this.cache = new Map(); this.need = new Set(); this.fb = null; }
  setMap(m) { this.map = { ms: m.ms || {} }; this.cache.clear(); }
  putPack(name, zones) { this.packs.set(name, zones); this.cache.clear(); }
  // zones for multisample number id (kind 'ms'); a soft placeholder while its pack is still loading
  get(kind, id) {
    const key = kind + id; let z = this.cache.get(key); if (z) return z;
    const e = this.map[kind][id] || { syn: 'tri' };
    if (e.syn) { z = { zones: PcmStore.synth(e.syn, this.sr), key: -1, shift: 0, gain: 1 }; this.cache.set(key, z); return z; }
    const pk = this.packs.get(e.p);
    if (!pk) { this.need.add(e.p); return this.fallback(); }
    z = { zones: pk, key: e.k === undefined ? -1 : e.k, shift: e.r || 0, gain: Math.pow(10, (e.g || 0) / 20), loop: e.loop };
    this.cache.set(key, z); return z;
  }
  fallback() { return this.fb || (this.fb = { zones: PcmStore.synth('tri', this.sr), key: -1, shift: 0, gain: 0.5, pending: true }); }
  static pick(zones, key) {
    let best = zones[0], bd = 1e9;
    for (const z of zones) { if (key >= z.lo && key <= z.hi) return z; const d = key < z.lo ? z.lo - key : key - z.hi; if (d < bd) { bd = d; best = z; } }
    return best;
  }
  // ---- built-in waveforms: band-limited single cycles, one table per 6 semitones (no aliasing up to the zone top) ----
  static synth(kind, sr) {
    const c = PcmStore._syn || (PcmStore._syn = {}); if (c[kind]) return c[kind];
    const zones = [], N = 2048, rate = 32000;
    const spec = PcmStore.spectrum(kind);
    if (spec.noise) {
      const len = rate, d = new Float32Array(len + 3); let y = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) { const w = PCM.hash(i + 17); if (spec.noise === 1) d[i] = w * 0.5; else { b1 = 0.97 * b1 + w * 0.3; b2 = b2 + (b1 - b2) * (spec.noise === 2 ? 0.5 : 0.15); d[i] = (spec.noise === 2 ? b1 - b2 : b2) * 1.6; } y = d[i]; }
      void y; d[len] = d[0]; d[len + 1] = d[1]; d[len + 2] = d[2];
      zones.push({ lo: 0, hi: 127, root: 60, rate, data: d, ls: 0, le: len, end: len, gain: 1, start: 0 });
      return (c[kind] = zones);
    }
    for (let top = 23; top <= 131; top += 6) {
      const root = top - 3, f0 = 440 * Math.pow(2, (top - 69) / 12), maxH = Math.max(1, Math.floor(rate * 0.45 / f0));
      const d = new Float32Array(N + 3), amps = spec.h;
      for (let h = 1; h <= Math.min(maxH, amps.length); h++) {
        const a = amps[h - 1]; if (!a) continue;
        const ph = spec.ph ? spec.ph[h - 1] || 0 : 0, w = 2 * Math.PI * h / N;
        for (let i = 0; i < N; i++) d[i] += a * Math.sin(w * i + ph);
      }
      let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(d[i])); const g = pk > 0 ? 0.9 / pk : 1;
      for (let i = 0; i < N; i++) d[i] *= g; d[N] = d[0]; d[N + 1] = d[1]; d[N + 2] = d[2];
      const f = 440 * Math.pow(2, (root - 69) / 12);
      zones.push({ lo: top - 5, hi: top, root, rate: f * N, data: d, ls: 0, le: N, end: N, gain: spec.gain || 1, start: 0 });
    }
    zones[0].lo = 0; zones[zones.length - 1].hi = 127;
    return (c[kind] = zones);
  }
  // harmonic amplitudes (1-based) for the built-in waveforms
  static spectrum(kind) {
    const H = 256, arr = f => { const a = []; for (let h = 1; h <= H; h++) a.push(f(h)); return a; };
    const pulse = w => arr(h => Math.sin(Math.PI * h * w) / h);
    switch (kind) {
      case 'saw': return { h: arr(h => 1 / h) };
      case 'saw_mg': return { h: arr(h => 1 / h * (h > 40 ? 0.7 : 1)) };
      case 'square': return { h: arr(h => (h % 2 ? 1 / h : 0)) };
      case 'square_jp': return { h: arr(h => (h % 2 ? 1 / h : 0.08 / h)) };
      case 'pulse2': return { h: pulse(0.02) }; case 'pulse5': return { h: pulse(0.05) }; case 'pulse8': return { h: pulse(0.08) };
      case 'pulse16': return { h: pulse(0.16) }; case 'pulse33': return { h: pulse(0.33) }; case 'pulse40': return { h: pulse(0.4) };
      case 'tri': return { h: arr(h => (h % 2 ? (((h - 1) / 2) % 2 ? -1 : 1) / (h * h) : 0)) };
      case 'ramp': return { h: arr(h => -1 / h) };
      case 'parabolic': return { h: arr(h => 1 / (h * h)), ph: arr(() => Math.PI / 2) };
      case 'sine': return { h: [1] };
      case 'sine2': return { h: [1, 0.05, 0.02] };
      case 'organ1': return { h: [1, 0.8, 0.6, 0.5, 0, 0.35, 0, 0.3] };        // 16' 8' 5 1/3' 4' ... drawbars
      case 'organ2': return { h: [1, 1, 0.8, 0, 0, 0.5, 0, 0.4, 0, 0, 0, 0.3, 0, 0, 0, 0.25] };
      case 'organ3': return { h: [0.6, 1, 0, 0.8, 0, 0.5] };
      case 'organ4': return { h: [1, 0.5, 0.3, 0.7, 0.2, 0.4, 0.1, 0.5] };
      case 'organ5': return { h: [1, 0, 0.9, 0, 0.8, 0, 0.6, 0, 0.5, 0, 0.3] };
      case 'ep1': return { h: [1, 0.35, 0.12, 0.05, 0.02, 0.01, 0.008] };
      case 'ep2': return { h: [1, 0.5, 0.3, 0.1, 0.06, 0.04, 0.03, 0.02] };
      case 'ep3': return { h: [1, 0.2, 0.05, 0.15, 0.02, 0.05] };
      case 'bell1': return { h: [1, 0, 0.5, 0, 0.3, 0, 0, 0.4, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.2] };
      case 'bell2': return { h: [0.6, 0, 0, 1, 0, 0, 0, 0.5, 0, 0, 0.4, 0, 0, 0.3] };
      case 'clav': return { h: arr(h => (h <= 20 ? (h % 2 ? 1 : 0.6) / Math.sqrt(h) : 0)) };
      case 'guitar': return { h: arr(h => (h <= 30 ? 1 / Math.pow(h, 0.9) * (1 + 0.3 * Math.sin(h * 1.7)) : 0)) };
      case 'digi1': return { h: arr(h => (h % 3 === 0 ? 0 : 1 / h) * (h < 60 ? 1 : 0)) };
      case 'digi2': return { h: arr(h => (h < 48 ? Math.abs(Math.sin(h * 0.61)) / Math.sqrt(h) : 0)) };
      case 'digi3': return { h: arr(h => (h < 64 ? (h % 4 === 1 ? 1 : 0.25) / h : 0)) };
      case 'wire': return { h: arr(h => (h < 96 ? 1 / Math.sqrt(h) * (h % 5 === 0 ? 0.2 : 1) : 0)) };
      case 'sync1': return { h: arr(h => { const r = 2.5; return Math.abs(Math.sin(Math.PI * r) * 2 * r / (Math.PI * (r * r - h * h + 1e-9))) / Math.max(1, h / 6); }) };
      case 'sync2': return { h: arr(h => { const r = 3.4; return Math.abs(Math.sin(Math.PI * r) * 2 * r / (Math.PI * (r * r - h * h + 1e-9))) / Math.max(1, h / 8); }) };
      case 'sync3': return { h: arr(h => { const r = 5.3; return Math.abs(Math.sin(Math.PI * r) * 2 * r / (Math.PI * (r * r - h * h + 1e-9))) / Math.max(1, h / 10); }) };
      case 'syn_bass': return { h: arr(h => 1 / h * (h === 1 ? 1.3 : 1)) };
      case 'reso_bass': return { h: arr(h => (1 / h) * (1 + 3 * Math.exp(-Math.pow(h - 7, 2) / 4))) };
      case 'fm_bass': return { h: [1, 0.8, 0.5, 0.3, 0.25, 0.1, 0.08, 0.05] };
      case 'noise': return { noise: 1 }; case 'noise_hi': return { noise: 2 }; case 'noise_lo': return { noise: 3 };
      default: return { h: arr(h => (h % 2 ? 1 / (h * h) : 0)) };
    }
  }
}

// ---- one PCM voice (both oscillators of a note) ----
class PcmVoice {
  constructor(sr, idx) {
    this.sr = sr; this.idx = idx; this.active = false; this.gate = false; this.note = 60; this.vel = 1; this.age = 0; this.sustained = false;
    this.peg = new PcmEG(); this.seed = 7777 + idx * 131;
    this.o = [0, 1].map(k => ({ on: false, z: null, pk: 0, pos: 0, root: 60, rate: 1, gain: 0, feg: new PcmEG(), aeg: new PcmEG(true), lfo: new PcmLFO(900 + idx * 17 + k), flfo: new PcmLFO(500 + idx * 29 + k),
      sa: new Float64Array(2), sb: new Float64Array(2), ca: new Float64Array(4), cb: new Float64Array(4), xa: NaN, xb: NaN, ra: NaN, rb: NaN,
      g: 0, pl: 0, pr: 0, wait: 0, keyOff: false, lfoOn: true, flfoOn: true, lfoT: 0, flfoT: 0, lvl: 1, filt: true, key: 60, velA: 1, sv: new Float64Array(8),
      // set while playing; declared here so every oscillator keeps one object shape (no allocation per block)
      kind: 'ms', id: 0, off: 0, startNow: false, relLater: 0, lv: 0, fv: 0, sgain: 1 }));
    this.pitch = 60; this.target = 60; this.glideSpan = 0; this.detune = 0; this.rnd = 0; this.silent = 0; this.fading = false; this.fadeG = 1;
  }
  noise() { let x = this.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x; return (x >>> 0) / 4294967296 * 2 - 1; }
  start(eng, note, vel, detune, legato, glideFrom) {
    const P = eng.patch;
    this.note = note; this.target = note; this.vel = vel; this.gate = true; this.detune = detune || 0; this.fading = false; this.fadeG = 1; this.silent = 0;
    this.pitch = glideFrom !== null && glideFrom !== undefined ? glideFrom : note; this.glideSpan = Math.abs(this.target - this.pitch);
    if (legato && this.active) return; // mono legato: the new pitch glides in; nothing restarts
    this.rnd = (P.random || 0) * this.noise();
    const G = P.peg, v = vel, tm = Math.pow(2, -(G.velT / 99) * (v * 2 - 1)) * this.amsTime(eng, G.tSrc, G.tInt, 0);
    this.peg.start(G.startL / 99, G.atkL / 99, 0, 0, G.relL / 99, PCM.tsec(G.atkT) * tm, PCM.tsec(G.decT) * tm, 0, PCM.tsec(G.relT) * tm);
    for (let i = 0; i < 2; i++) {
      const O = P.o[i], o = this.o[i];
      o.on = P.mode !== 'drum' && (i === 0 || (P.mode === 'double' && vel * 127 >= P.osc2Vel)); // Drum mode: silent
      if (!o.on) continue;
      o.pos = 0; o.sa.fill(0); o.sb.fill(0); o.xa = NaN; o.xb = NaN; o.ra = NaN; o.rb = NaN; o.g = 0; o.lfoT = 0; o.flfoT = 0; o.relLater = 0; o.startNow = false;
      const hi = vel * 127 >= O.velSplit;
      let id = hi ? O.msHi : O.msLo;
      const lvl = (hi ? O.lvlHi : O.lvlLo) / 127, off = hi ? O.offHi : O.offLo;
      if (id >= 0x1000) id = (P.ramMap && P.ramMap[id & 0xfff] !== undefined) ? P.ramMap[id & 0xfff] : 0;
      o.kind = 'ms'; o.id = id; o.lvl = lvl * lvl;
      o.key = note + O.octave * 12 + O.transpose;
      o.z = null; o.wait = O.delay < 0 ? -1 : O.delay / 1000; o.keyOff = O.delay < 0; o.off = off;
      o.velA = PcmVoice.velAmp(O.amp.vel, vel);
      // EGs (time mods by key, velocity and A.M.). A level velocity sensitivity is added to the start, attack and
      // break point levels in proportion to velocity (measured on both EGs: level + sensitivity x velocity / 127)
      const F = O.feg, A = O.aeg, fk = PCM.tmul, lv = (base, m) => MD.clamp(base + m * vel, -99, 99) / 99;
      const fam = this.amsTime(eng, F.tSrc, F.tInt, i), aam = this.amsTime(eng, A.tSrc, A.tInt, i);
      o.feg.start(lv(F.startL, F.lv[0]), lv(F.atkL, F.lv[1]), lv(F.brkL, F.lv[2]), F.susL / 99, F.relL / 99,
        PCM.tsec(F.atkT) * fk(F.kt[0], F.vt[0], note, vel) * fam, PCM.tsec(F.decT) * fk(F.kt[1], F.vt[1], note, vel) * fam, PCM.tsec(F.slpT) * fk(F.kt[2], F.vt[2], note, vel) * fam, PCM.tsec(F.relT) * fk(F.kt[3], F.vt[3], note, vel) * fam);
      const al = (base, m) => MD.clamp(base + m * vel, 0, 99) / 99;
      o.aeg.start(al(A.startL, A.lv[0]), al(A.atkL, A.lv[1]), al(A.brkL, A.lv[2]), A.susL / 99, 0,
        PCM.tsec(A.atkT) * fk(A.kt[0], A.vt[0], note, vel) * aam, PCM.tsec(A.decT) * fk(A.kt[1], A.vt[1], note, vel) * aam, PCM.tsec(A.slpT) * fk(A.kt[2], A.vt[2], note, vel) * aam, PCM.tsec(A.relT) * fk(A.kt[3], A.vt[3], note, vel) * aam);
      if (o.keyOff) { o.aeg.kill(); o.feg.kill(); }
      // LFOs
      if (O.lfo.sync || !this.active) o.lfo.reset(); if (O.flfo.sync || !this.active) o.flfo.reset();
      o.lfoOn = O.lfo.start !== 'off'; o.flfoOn = O.flfo.start !== 'off';
    }
    this.active = true; this.age = eng.clock++;
  }
  // amp Velocity Int (measured at +35, +50, +60 within 0.1 dB): level = (1 - Int/99 x (1 - velocity))^3, so +99 follows
  // velocity fully; a negative value by the same rule the other way round (softer playing is louder; not measured)
  static velAmp(k, v) { if (!k) return 1; const x = MD.clamp(k / 99, -1, 1), b = x >= 0 ? 1 - x * (1 - v) : 1 + x * v; return b * b * b; }
  amsTime(eng, src, int, i) { if (!int || src === 'off') return 1; const s = this.ams(eng, src, i); return Math.pow(2, -(int / 99) * s * 2); }
  // alternate modulation source value (unipolar sources 0..1, bipolar -1..1)
  ams(eng, src, i) {
    const c = eng.ctl, cc = eng.cc, o = this.o[i], o1 = this.o[0];
    switch (src) {
      case 'oeg': return this.peg.val; case 'feg': return o.feg.val; case 'aeg': return o.aeg.val;
      case 'olfo': return o.lv || 0; case 'flfo': return o.fv || 0;
      case 'vel': return this.vel; case 'note': return (this.note - 60) / 60; case 'pat': case 'at': return c.at;
      case 'jsx': return c.jsx; case 'jsy': return c.jsy; case 'jsyn': return c.jsyn; case 'ribbon': return c.ribbon; case 'ribz': return c.ribZ || 0;
      case 'foot': return c.foot; case 'slider': return (cc[18] || 0) / 127; case 'cc19': return (cc[19] || 0) / 127; case 'sw1': return c.sw1; case 'sw2': return c.sw2;
      case 'fsw': return (cc[82] || 0) >= 64 ? 1 : 0; case 'cc83': return (cc[83] || 0) / 127; case 'tempo': return 0;
      case 'feg1': return o1.feg.val; case 'aeg1': return o1.aeg.val; case 'olfo1': return o1.lv || 0; case 'flfo1': return o1.fv || 0;
    }
    return 0;
  }
  release() {
    this.gate = false; this.peg.release();
    for (const o of this.o) {
      if (!o.on) continue;
      if (o.keyOff) { o.wait = 0; o.keyOff = false; o.startNow = true; continue; } // key-off sample: starts now
      o.feg.release(); o.aeg.release();
    }
    this.relAt = 1;
  }
  kill() { this.active = false; this.gate = false; for (const o of this.o) { o.on = false; o.aeg.kill(); o.feg.kill(); } this.peg.kill(); }
  // filter cutoff (parameter units) of filter Fp of oscillator i: cutoff + EG, LFO, controllers, key track, A.M.
  // The EG's intensity is EG Int plus EG Velocity Int in proportion to velocity (measured: PCM); the tracking follows
  // the pitch the oscillator sounds (its key with octave and transpose), not the key played.
  fcut(eng, Fp, i, feg, fv, flInt, feInt) {
    const c = eng.ctl;
    return Fp.cut + feg * PCM.EGK * (Fp.egInt + Fp.egVel * this.vel + feInt) + fv * (Fp.lfoInt + flInt) + c.jsx * Fp.jsx + c.at * Fp.at
      + PCM.ftrack(this.o[i].key, Fp.lowKey, Fp.highKey, Fp.lowRamp, Fp.highRamp) + (Fp.amsInt ? Fp.amsInt * this.ams(eng, Fp.amsSrc, i) : 0) + eng.ccOff.cutoff;
  }
  renderBlock(eng, L, R, off, n) {
    const P = eng.patch, sr = this.sr, dt = n / sr, c = eng.ctl, store = eng.store;
    // portamento: the pitch glides to the note when the program has it on (Triton programs store it; Trinity PCM
    // programs have none, so it is off unless set here); then the voice-wide pitch EG
    if (this.pitch !== this.target) {
      const T = MD.tsec(P.voice.portaTime || 0) * 0.5;
      if (T <= 0) this.pitch = this.target;
      else { this.pitch += (this.target - this.pitch) * (1 - Math.exp(-dt / T)); if (Math.abs(this.target - this.pitch) < 0.001) this.pitch = this.target; }
    }
    const peg = this.peg.tick(dt);
    let any = false, peak = 0;
    for (let i = 0; i < 2; i++) {
      const o = this.o[i]; if (!o.on) continue;
      const O = P.o[i];
      if (o.startNow) { // key-off sample begins: its EGs run from the start, then release on their own
        o.startNow = false; const A = O.aeg, F = O.feg;
        o.aeg.start(A.startL / 99, A.atkL / 99, A.brkL / 99, A.susL / 99, 0, PCM.tsec(A.atkT), PCM.tsec(A.decT), PCM.tsec(A.slpT), PCM.tsec(A.relT));
        o.feg.start(F.startL / 99, F.atkL / 99, F.brkL / 99, F.susL / 99, F.relL / 99, PCM.tsec(F.atkT), PCM.tsec(F.decT), PCM.tsec(F.slpT), PCM.tsec(F.relT));
        o.aeg.release(); o.aeg.stage = 1; o.relLater = PCM.tsec(A.atkT) + PCM.tsec(A.decT);
        o.pos = 0; o.z = null;
      }
      if (o.wait !== 0) {
        if (o.wait < 0) { any = true; continue; }
        o.wait -= dt; if (o.wait > 0) { any = true; continue; } o.wait = 0;
      }
      if (o.relLater > 0) { o.relLater -= dt; if (o.relLater <= 0) o.aeg.release(); }
      // zone (chosen once the stand-in is available)
      if (!o.z || o.pk) { // pick the zone once the stand-in is loaded (a soft placeholder plays until then)
        const s = store.get(o.kind, o.id);
        if (!o.z || !s.pending) {
          o.z = PcmStore.pick(s.zones, s.key >= 0 ? s.key : o.key); o.pk = s.pending ? 1 : 0; o.sgain = s.gain * (o.z.gain || 1);
          o.root = (s.key >= 0 ? 60 - s.key + o.z.root : o.z.root) - (s.shift || 0); // a percussion stand-in (one drum sound) sounds at its own pitch at note 60
          const st = o.z.start || 0; // offset start: Korg's 2nd start where the pack has it, else skip 30 ms of the attack
          o.pos = !o.off ? st : o.z.s2 > 0 ? o.z.s2 : Math.min(o.z.le > 0 ? o.z.ls : o.z.data.length * 0.3, st + o.z.rate * 0.03);
        }
      }
      const z = o.z;
      // LFOs
      const lfoGate = O.lfo.start === 'off' ? !this.gate : O.lfo.start === 'both' ? this.gate : true;
      let lv = 0;
      if (lfoGate) {
        o.lfoT += dt; const d = MD.tsec(O.lfo.delay);
        if (o.lfoT >= d) {
          const fhz = PCM.lfoHz(O.lfo.freq + O.lfo.kbd * (this.note - 60) / 60 + O.lfo.jsy * c.jsy + (O.lfo.fmInt ? O.lfo.fmInt * this.ams(eng, O.lfo.fmSrc, i) : 0));
          lv = o.lfo.step(fhz, dt, O.lfo.wave); const oo = O.lfo.offset / 99; lv = (lv + oo) / (1 + Math.abs(oo));
          const fd = MD.tsec(Math.abs(O.lfo.fade)); if (fd > 0) { const r = MD.clamp((o.lfoT - d) / fd, 0, 1); lv *= O.lfo.fade > 0 ? r : 1 - r; }
        }
      }
      o.lv = lv;
      const flfoGate = O.flfo.start === 'off' ? !this.gate : O.flfo.start === 'both' ? this.gate : true;
      let fv = 0;
      if (flfoGate) {
        o.flfoT += dt; const d = MD.tsec(O.flfo.delay);
        if (o.flfoT >= d) {
          fv = o.flfo.step(PCM.lfoHz(O.flfo.freq + (O.flfo.fmInt ? O.flfo.fmInt * this.ams(eng, O.flfo.fmSrc, i) : 0)), dt, O.flfo.wave);
          const oo = O.flfo.offset / 99; fv = (fv + oo) / (1 + Math.abs(oo));
          const fd = MD.tsec(Math.abs(O.flfo.fade)); if (fd > 0) { const r = MD.clamp((o.flfoT - d) / fd, 0, 1); fv *= O.flfo.fade > 0 ? r : 1 - r; }
        }
      }
      o.fv = fv;
      const feg = o.feg.tick(dt), aeg = o.aeg.tick(dt);
      // pitch (semitones)
      const Pt = O.pitch;
      let semis = 60 + (this.pitch - 60) * Pt.slope + O.octave * 12 + O.transpose + O.tune / 100 + this.detune + this.rnd;
      semis += peg * (Pt.egInt * (1 + Pt.egVel / 99 * (this.vel - 1)) + (Pt.egAmsInt ? Pt.egAmsInt * this.ams(eng, Pt.egAmsSrc, i) : 0));
      const vib = Pt.lfoInt + MD.pitchScale(O.lfoPitch.jsy) * c.jsy + MD.pitchScale(O.lfoPitch.at) * c.at + (O.lfoPitch.amsInt ? O.lfoPitch.amsInt * this.ams(eng, O.lfoPitch.amsSrc, i) : 0);
      semis += lv * vib + Pt.ribbon * c.ribbon + (Pt.amsInt ? Pt.amsInt * this.ams(eng, Pt.amsSrc, i) : 0);
      const x = c.jsx, bst = PCM.stepSemis(x >= 0 ? Pt.stepUp : Pt.stepDown); let bend = x >= 0 ? x * Pt.jsUp : -x * Pt.jsDown;
      if (bst > 0) bend = Math.round(bend / bst) * bst; // STEP: the bend moves in steps
      semis += bend;
      semis += eng.tuneSemis(this.pitch - eng.keyShift[this.note]);
      const inc = z.rate / sr * Math.pow(2, (semis - o.root) / 12);
      // filters
      const route = O.route, rc = route === 'single' ? 1 : route === 'serial' ? 2 : route === 'parallel' ? 3 : 0;
      // filter LFO intensity grows with joystick -Y, aftertouch and its A.M.; filter EG intensity with its A.M.
      const flInt = O.flfoMod.jsyn * c.jsyn + O.flfoMod.at * c.at + (O.flfoMod.amsInt ? O.flfoMod.amsInt * this.ams(eng, O.flfoMod.amsSrc, i) : 0);
      const feInt = O.fegAms.int ? O.fegAms.int * this.ams(eng, O.fegAms.src, i) : 0;
      if (rc) {
        const xa = this.fcut(eng, O.f[0], i, feg, fv, flInt, feInt), ra = O.f[0].reso + O.f[0].resoVel / 99 * 31 * (this.vel - 1) + eng.ccOff.reso / 3;
        if (xa !== o.xa || ra !== o.ra) { o.xa = xa; o.ra = ra; MossVoice.svfCoef(PCM.cutHz(xa, sr), PCM.kReso(ra), sr, o.ca); }
        if (rc > 1) {
          const xb = this.fcut(eng, O.f[1], i, feg, fv, flInt, feInt), rb = O.f[1].reso + O.f[1].resoVel / 99 * 31 * (this.vel - 1) + eng.ccOff.reso / 3;
          if (xb !== o.xb || rb !== o.rb) { o.xb = xb; o.rb = rb; MossVoice.svfCoef(PCM.cutHz(xb, sr), PCM.kReso(rb), sr, o.cb); }
        }
      }
      // filter input gain: 99 = unity (most programs), lower values attenuate the signal going into the filter
      const ga = O.f[0].gain / 99, gb = O.f[1].gain / 99 * (rc === 3 ? 0.7 : 1), gpa = rc === 3 ? ga * 0.7 : ga;
      // amp: level, velocity x key track, aftertouch, A.M., amp EG. Velocity and key track together cannot lift the
      // amp above its full level (measured: a louder key gains nothing at full velocity, whatever Amp Level is)
      const A = O.amp; let vk = o.velA * PCM.atrack(o.key, A.lowKey, A.highKey, A.lowRamp, A.highRamp); if (vk > 1) vk = 1;
      // (Amp Level and the amp EG's levels are plain amplitude, measured: 64 of 127 = -6 dB, an EG level of 50 = -6 dB)
      let amp = A.level / 127 * o.lvl * vk * o.sgain * PCM.GAIN;
      if (A.at) amp *= MD.clamp(1 + A.at / 99 * c.at, 0, 2);
      if (A.amsInt) amp *= MD.clamp(1 + A.amsInt / 99 * this.ams(eng, A.amsSrc, i), 0, 2);
      const ae = aeg < 0 ? 0 : aeg, gt = amp * ae * this.fadeG;
      // pan
      let pan = O.pan; if (pan < 0) pan = 64;
      let pn = (pan - 64) / 63; if (O.panInt) pn += O.panInt / 99 * this.ams(eng, O.panSrc, i);
      pn = MD.clamp(pn, -1, 1); const pl = Math.cos((pn + 1) * Math.PI / 4), pr = Math.sin((pn + 1) * Math.PI / 4);
      // render: 4-point Hermite interpolation, then the filters (TPT state-variable, inlined), amp and pan
      const d = z.data, ls = z.ls, le = z.le, end = z.end > 0 ? z.end : d.length - 3, span = le - ls;
      let pos = o.pos, g = o.g, gl = o.pl, gr = o.pr; const gs = (gt - g) / n, pls = (pl - gl) / n, prs = (pr - gr) / n;
      const ca = o.ca, cb = o.cb, a0 = ca[0], a1 = ca[1], a2 = ca[2], ka = ca[3], b0 = cb[0], b1 = cb[1], b2 = cb[2], kb = cb[3];
      const ta = O.ftn[0], tb = O.ftn[1], kba = ka > 0.08 ? ka * 1.4 : 0.112, kbb = kb > 0.08 ? kb * 1.4 : 0.112;
      let sa0 = o.sa[0], sa1 = o.sa[1], sb0 = o.sb[0], sb1 = o.sb[1]; const FS = PCM.FSAT;
      let ended = false;
      for (let s = 0; s < n; s++) {
        const ip = pos | 0, f = pos - ip, x0 = d[ip], xm1 = ip > 0 ? d[ip - 1] : x0, x1 = d[ip + 1], x2 = d[ip + 2];
        let y = (((0.5 * (x2 - xm1) + 1.5 * (x0 - x1)) * f + (xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2)) * f + 0.5 * (x1 - xm1)) * f + x0;
        pos += inc;
        if (le > 0) { if (pos >= le) { pos -= span; if (pos >= le) pos = ls + (pos - ls) % span; } }
        else if (pos >= end) { ended = true; pos = end; }
        if (rc) {
          // filter A
          const xa = y * gpa, v3 = xa - sa1, v1 = a0 * sa0 + a1 * v3, v2 = sa1 + a1 * sa0 + a2 * v3;
          sa0 = 2 * v1 - sa0; sa1 = 2 * v2 - sa1;
          if (sa0 > FS) sa0 = FS; else if (sa0 < -FS) sa0 = -FS; if (sa1 > FS) sa1 = FS; else if (sa1 < -FS) sa1 = -FS;
          const ya = ta === 0 ? v2 : ta === 1 ? xa - ka * v1 - v2 : ta === 2 ? v1 * kba : xa - ka * v1;
          if (rc === 1) y = ya;
          else {
            // filter B: after A (serial) or beside it (parallel)
            const xb = rc === 2 ? ya * gb : y * gb, w3 = xb - sb1, w1 = b0 * sb0 + b1 * w3, w2 = sb1 + b1 * sb0 + b2 * w3;
            sb0 = 2 * w1 - sb0; sb1 = 2 * w2 - sb1;
            if (sb0 > FS) sb0 = FS; else if (sb0 < -FS) sb0 = -FS; if (sb1 > FS) sb1 = FS; else if (sb1 < -FS) sb1 = -FS;
            const yb = tb === 0 ? w2 : tb === 1 ? xb - kb * w1 - w2 : tb === 2 ? w1 * kbb : xb - kb * w1;
            y = rc === 2 ? yb : ya + yb;
          }
        }
        g += gs; gl += pls; gr += prs;
        const out = y * g, ao = out < 0 ? -out : out; if (ao > peak) peak = ao;
        L[off + s] += out * gl; R[off + s] += out * gr;
      }
      // keep the filter states bounded (a resonant filter driven hard) and finite
      if (!(sa0 === sa0 && sa1 === sa1 && sb0 === sb0 && sb1 === sb1) || Math.abs(sa0) + Math.abs(sa1) + Math.abs(sb0) + Math.abs(sb1) > 64) { sa0 = sa1 = sb0 = sb1 = 0; }
      o.sa[0] = sa0; o.sa[1] = sa1; o.sb[0] = sb0; o.sb[1] = sb1;
      o.pos = pos; o.g = gt; o.pl = pl; o.pr = pr;
      if (ended || o.aeg.done()) o.on = false;
      if (o.on) any = true;
    }
    if (!any) { this.kill(); return; }
    if (!this.gate && !eng.sustainHeld(this)) { if (peak < 2e-5) this.silent += dt; else this.silent = 0; if (this.silent > 0.25) this.kill(); }
  }
}

if (typeof module !== 'undefined') module.exports = { PCM, PcmEG, PcmLFO, PcmStore, PcmVoice };
