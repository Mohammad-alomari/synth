// ===== Trinity effect DSP =====
// Every class here is self-contained so the AudioWorklet can be built from their source text.
// Signal conventions follow the Trinity Effect Manual: size-1 insert effects are mono in / mono out (dry too),
// size-2 and size-4 effects are stereo, master effects are mono in / stereo out and return only the effect sound.

// delay line with fractional read; d is in samples and must be >= 1 (1 = the sample written last)
class FXDL {
  constructor(maxS) { let n = 16; while (n < maxS + 8) n <<= 1; this.b = new Float32Array(n); this.m = n - 1; this.w = 0; this.max = n - 4; }
  push(x) { this.b[this.w] = x; this.w = (this.w + 1) & this.m; }
  tap(d) {
    if (d < 1) d = 1; else if (d > this.max) d = this.max;
    const p = this.w - d, i = Math.floor(p), f = p - i, m = this.m, a = this.b[i & m];
    return a + (this.b[(i + 1) & m] - a) * f;
  }
  tapI(d) { return this.b[(this.w - d) & this.m]; }
  clear() { this.b.fill(0); }
}

// RBJ biquad, transposed direct form II
class FXBQ {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(t, f, q, db, sr) {
    f = Math.min(Math.max(f, 8), sr * 0.45); q = Math.max(q || 0.707, 0.05);
    const w = 2 * Math.PI * f / sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, (db || 0) / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    if (t === 'lp') { b1 = 1 - cs; b0 = b2 = b1 / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (t === 'hp') { b1 = -(1 + cs); b0 = b2 = (1 + cs) / 2; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (t === 'bp') { b0 = al; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (t === 'peak') { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    else if (t === 'ls' || t === 'hs') {
      const s = 2 * Math.sqrt(A) * al, k = t === 'ls' ? 1 : -1;
      b0 = A * ((A + 1) - k * (A - 1) * cs + s); b1 = 2 * k * A * ((A - 1) - k * (A + 1) * cs); b2 = A * ((A + 1) - k * (A - 1) * cs - s);
      a0 = (A + 1) + k * (A - 1) * cs + s; a1 = -2 * k * ((A - 1) + k * (A + 1) * cs); a2 = (A + 1) + k * (A - 1) * cs - s;
    } else if (t === 'ap') { b0 = 1 - al; b1 = -2 * cs; b2 = 1 + al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  flush() { if (!(Math.abs(this.z1) > 1e-20)) this.z1 = 0; if (!(Math.abs(this.z2) > 1e-20)) this.z2 = 0; }
  reset() { this.z1 = 0; this.z2 = 0; }
}

// shared helpers
class FXL {
  // LFO: phase 0..1 -> 0..1. Waves: 0 triangle, 1 sine, 2 square, 3 saw up, 4 saw down. Shape bends the curve (-100..100)
  static uni(p, wave, shape) {
    let u;
    if (wave === 1) u = 0.5 - 0.5 * Math.cos(6.283185307179586 * p);
    else if (wave === 2) u = p < 0.5 ? 1 : 0;
    else if (wave === 3) u = p;
    else if (wave === 4) u = 1 - p;
    else u = p < 0.5 ? 2 * p : 2 - 2 * p;
    if (shape) { const s = shape / 100; u = s > 0 ? 1 - Math.pow(1 - u, 1 + 4 * s) : Math.pow(u, 1 - 4 * s); }
    return u;
  }
  static k(fc, sr) { return 1 - Math.exp(-6.283185307179586 * Math.min(fc, sr * 0.49) / sr); }
  // one-pole coefficients for Korg "High damp" / "Low damp" (0..100 %)
  static hdK(hd, sr) { return FXL.k(20000 * Math.pow(0.025, Math.max(0, Math.min(100, hd || 0)) / 100), sr); }
  static ldK(ld, sr) { return FXL.k(8 * Math.pow(125, Math.max(0, Math.min(100, ld || 0)) / 100), sr); }
  static tempoHz(p) { return (p.tempo || 120) / 240 / Math.max(1e-3, (p.len || 1) / (p.lenDiv || 4)); }
  static db(x) { return Math.pow(10, x / 20); }
  static ms(v, sr) { return v * sr / 1000; }
  // time constant (s) of Korg attack/release values 1..100
  static tc(v, lo, hi) { return lo * Math.pow(hi / lo, (Math.max(1, Math.min(100, v)) - 1) / 99); }
  // effect dynamic-modulation source value (0..1, bipolar sources -1..1)
  static src(x, i) { return i > 0 && x && x.src ? x.src[i] || 0 : 0; }
  static rnd(s) { s.r = (s.r * 1664525 + 1013904223) >>> 0; return s.r / 4294967296; }
}

// the base: wet/dry mixing and the mono/stereo/master conventions
class FxBase {
  constructor(sr, e) {
    this.sr = sr; this.e = e; this.id = e.id; this.v = e.v; this.grp = e.grp;
    this.mono = e.grp === 'S1'; this.master = e.grp === 'MM' || e.grp === 'MR'; this.big = e.grp === 'S4';
    this.pre = [new FXBQ(), new FXBQ(), new FXBQ(), new FXBQ()]; this.preLo = NaN; this.preHi = NaN;
    this.ph = 0; this.env = 0; this.rs = { r: (e.idx * 7919 + 17) >>> 0 }; this.x = null;
    this.wSigned = e.params.some(q => q[0] === 'wet' && q[2] < 0); this.oSigned = e.params.some(q => q[0] === 'out' && q[2] < 0);
  }
  // input stage shared by many Korg effects: "EQ Trim" then pre low/high shelving EQ
  preEq(p, trimMax) {
    const lo = p.lo || 0, hi = p.hi || 0;
    if (lo !== this.preLo || hi !== this.preHi) { this.preLo = lo; this.preHi = hi; for (let c = 0; c < 2; c++) { this.pre[c * 2].set('ls', 100, 0.707, lo, this.sr); this.pre[c * 2 + 1].set('hs', 8000, 0.707, hi, this.sr); } }
    this.trimG = p.trim === undefined ? 1 : p.trim / (trimMax || 100);
    this.eqOn = !!(lo || hi);
  }
  eqL(x) { x *= this.trimG; return this.eqOn ? this.pre[1].run(this.pre[0].run(x)) : x; }
  eqR(x) { x *= this.trimG; return this.eqOn ? this.pre[3].run(this.pre[2].run(x)) : x; }
  // mixing: w = wet/dry (-100..100 %; negative inverts the effect sound). Masters return the effect sound at "Output level"
  mixSet(p, wetKey) {
    const k = wetKey || 'wet';
    let w = this.master ? (p.out !== undefined ? p.out : p[k] !== undefined ? p[k] : 80) : (p[k] === undefined ? 50 : p[k]);
    // Wet/Dry (or a master effect's level) can follow a dynamic-modulation source: value + amount x source
    if (p.wsrc && this.x) { w += (p.wamt || 0) * FXL.src(this.x, p.wsrc | 0); w = Math.max((this.master && p.out !== undefined ? this.oSigned : this.wSigned) ? -100 : 0, Math.min(100, w)); }
    if (this.master) { this.W = 0; this.A = 0; this.G = w / 100; }
    else { this.W = w / 100; this.A = 1 - Math.abs(this.W); this.G = 1; }
  }
  out(L, R, i, dl, dr, wl, wr) {
    if (this.master) { L[i] = wl * this.G; R[i] = wr * this.G; }
    else { L[i] = dl * this.A + wl * this.W; R[i] = dr * this.A + wr * this.W; }
  }
  flushAll() { for (const b of this.pre) b.flush(); }
  reset() {}
}

// ---------------- delays ----------------
class FxDelay extends FxBase {
  constructor(sr, e) {
    super(sr, e);
    const v = e.v, g = e.grp;
    const ms = v === 'lcr' ? (g === 'S4' ? 2730 : g === 'MR' ? 2000 : 1400) : v === 'stereo' || v === 'dual' ? (g === 'S4' ? 1360 : 680) : v === 'hold' ? 2700 : v === 'tempo' ? 2730 : v === 'stmod' ? 520 : 680;
    const n = Math.ceil(ms * sr / 1000) + 32;
    this.dA = new FXDL(n); this.dB = new FXDL(v === 'lcr' || v === 'mono' || v === 'mtap' || v === 'hold' ? 8 : n);
    this.t = new Float64Array(6).fill(-1); this.s = new Float64Array(12); this.env = 0; this.gdyn = 0;
    this.rp = [0.5, 0.5, 0.5, 0.5]; this.rpt = [0, 0]; this.frozen = 0;
  }
  // smoothed delay time in samples (glides like a tape delay when a time is changed)
  tm(k, ms) { const tgt = ms > 0 ? Math.max(1, ms * this.sr / 1000) : 1; if (this.t[k] < 0) this.t[k] = tgt; else this.t[k] += (tgt - this.t[k]) * this.kt; return this.t[k]; }
  // one-pole high damp and low damp (a low cut) on the signal entering the line
  damp(c, x) { const s = this.s; s[c] += this.kh * (x - s[c]); s[c + 6] += this.kl * (s[c] - s[c + 6]); return s[c] - s[c + 6]; }
  process(L, R, n, p, x) {
    const v = this.v, sr = this.sr; this.kt = 1 - Math.exp(-1 / (0.06 * sr));
    this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W; this.kh = FXL.hdK(p.hd, sr); this.kl = FXL.ldK(p.ld, sr);
    const fb = Math.max(-1, Math.min(1, (p.fb || 0) / 100)) * 0.985;
    if (v === 'mono' || v === 'mtap' || v === 'tempo' && this.mono) {
      const l1 = (p.lvl1 === undefined ? 100 : p.lvl1) / 100;
      for (let i = 0; i < n; i++) {
        const m = (L[i] + R[i]) * 0.5;
        let y;
        if (v === 'mtap') { const a = this.dA.tap(this.tm(0, p.t1)), b = this.dA.tap(this.tm(1, p.t2)); this.dA.push(this.damp(0, m + b * fb)); y = a * l1 + b; }
        else { const t = v === 'tempo' ? 1000 / FXL.tempoHz(p) : p.time; y = this.dA.tap(this.tm(0, t)); this.dA.push(this.damp(0, m + y * fb)); }
        { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (m) * A_ + y1_ * W_; R[i] = (m) * A_ + y2_ * W_; } }
      }
    } else if (v === 'dual') {
      const fL = (p.fbL || 0) / 100 * 0.985, fR = (p.fbR || 0) / 100 * 0.985, dm = !!p.wsrc && !this.master;
      const dmv = dm ? (p.wamt || 0) * FXL.src(this.x, p.wsrc | 0) : 0, cl = w => Math.max(0, Math.min(100, w)) / 100;
      const wL = cl((p.wetL === undefined ? 50 : p.wetL) + dmv), wR = cl((p.wetR === undefined ? 50 : p.wetR) + dmv);
      const kL = FXL.hdK(p.hdL, sr), kR = FXL.hdK(p.hdR, sr), jL = FXL.ldK(p.ldL, sr), jR = FXL.ldK(p.ldR, sr), s = this.s;
      for (let i = 0; i < n; i++) {
        const yl = this.dA.tap(this.tm(0, p.timeL)), yr = this.dB.tap(this.tm(1, p.timeR));
        let a = L[i] + yl * fL; s[0] += kL * (a - s[0]); s[6] += jL * (s[0] - s[6]); this.dA.push(s[0] - s[6]);
        let b = R[i] + yr * fR; s[1] += kR * (b - s[1]); s[7] += jR * (s[1] - s[7]); this.dB.push(s[1] - s[7]);
        if (this.master) { L[i] = yl * this.G; R[i] = yr * this.G; } else { L[i] = L[i] * (1 - wL) + yl * wL; R[i] = R[i] * (1 - wR) + yr * wR; }
      }
    } else if (v === 'stereo' || v === 'tempo' || v === 'stmod' || v === 'dyn' || v === 'randpan' || v === 'stmtap') {
      const sp = v === 'stereo' || v === 'dyn' || v === 'stmtap' ? (p.spread === undefined ? 100 : p.spread) / 100 : 1;
      const cross = v === 'stereo' && p.cross === 1, mode = v === 'stmtap' ? p.mode | 0 : 0;
      let fL = fb, fR = fb;
      if (v === 'stmod' || v === 'randpan') { fL = (p.fbL || 0) / 100 * 0.985; fR = (p.fbR || 0) / 100 * 0.985; }
      // modulation delay LFO, dynamic delay envelope, random panning
      const lf = v === 'stmod' ? p.lfoF / sr : 0, dmL = (p.depthL || 0) * 0.02, dmR = (p.depthR || 0) * 0.02;
      const thr = v === 'dyn' ? Math.pow(10, ((p.thr === undefined ? 40 : p.thr) - 100) * 0.6 / 20) : 0;
      const kA = v === 'dyn' ? 1 - Math.exp(-1 / (FXL.tc(p.atk, 0.001, 0.5) * sr)) : 0, kR = v === 'dyn' ? 1 - Math.exp(-1 / (FXL.tc(p.rel, 0.01, 3) * sr)) : 0;
      const kEnv = 1 - Math.exp(-1 / (0.01 * sr));
      const tT = v === 'tempo' ? 1000 / FXL.tempoHz(p) : 0, l1 = (p.lvl1 === undefined ? 100 : p.lvl1) / 100;
      const rL = v === 'randpan' ? p.spdL / sr : 0, rR = v === 'randpan' ? p.spdR / sr : 0, ps = (p.pspread === undefined ? 80 : p.pspread) / 100;
      const gL = v === 'randpan' ? (p.lvlL === undefined ? 100 : p.lvlL) / 100 : 1, gR = v === 'randpan' ? (p.lvlR === undefined ? 100 : p.lvlR) / 100 : 1;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i];
        let yl, yr, al = 0, ar = 0;
        if (v === 'stmod') {
          this.ph += lf; if (this.ph >= 1) this.ph -= 1;
          const u = FXL.uni(this.ph, p.wave | 0, p.shape) - 0.5, u2 = FXL.uni((this.ph + 0.5) % 1, p.wave | 0, p.shape) - 0.5;
          yl = this.dA.tap(this.tm(0, p.timeL) + (u * 2 * dmL) * sr / 1000); yr = this.dB.tap(this.tm(1, p.timeR) + (u2 * 2 * dmR) * sr / 1000);
        } else if (v === 'tempo') { yl = this.dA.tap(this.tm(0, tT)); yr = this.dB.tap(this.tm(1, tT)); }
        else if (v === 'stmtap') {
          const t1 = this.tm(0, p.t1), t2 = this.tm(1, p.t2);
          al = this.dA.tap(t1); ar = this.dB.tap(t1); yl = this.dA.tap(t2); yr = this.dB.tap(t2);
        } else { yl = this.dA.tap(this.tm(0, p.timeL)); yr = this.dB.tap(this.tm(1, p.timeR)); }
        const inL = mode === 2 || mode === 3 ? (dl + dr) * 0.5 : dl, inR = mode === 2 || mode === 3 ? (dl + dr) * 0.5 : dr;
        const xl = cross || mode === 1 ? yr : yl, xr = cross || mode === 1 ? yl : yr;
        this.dA.push(this.damp(0, inL + xl * fL)); this.dB.push(this.damp(1, inR + xr * fR));
        let wl = yl, wr = yr;
        if (v === 'stmtap') {
          if (mode === 2) { wl = al * l1 + yr * 0.3; wr = yl; } else if (mode === 3) { wl = yl; wr = ar * l1 + yr * 0.3; } else { wl = al * l1 + yl; wr = ar * l1 + yr; }
        }
        if (v === 'dyn') {
          const lv = Math.max(Math.abs(dl), Math.abs(dr)); this.env += kEnv * (lv - this.env);
          const tgt = (this.env > thr) === (p.pol === 1) ? 1 : 0;
          this.gdyn += (tgt > this.gdyn ? kA : kR) * (tgt - this.gdyn); wl *= this.gdyn; wr *= this.gdyn;
        }
        if (v === 'randpan') {
          // each delay moves to a new random position at its own panning speed
          for (let c = 0; c < 2; c++) {
            this.rpt[c] += c ? rR : rL;
            if (this.rpt[c] >= 1) { this.rpt[c] -= 1; this.rp[c + 2] = 0.5 + (FXL.rnd(this.rs) - 0.5) * ps; }
            this.rp[c] += (this.rp[c + 2] - this.rp[c]) * 0.0008;
          }
          const a = yl * gL, b = yr * gR;
          wl = a * Math.cos(this.rp[0] * 1.5708) + b * Math.cos(this.rp[1] * 1.5708); wr = a * Math.sin(this.rp[0] * 1.5708) + b * Math.sin(this.rp[1] * 1.5708);
        }
        if (sp < 1) { const s0 = (1 + sp) * 0.5, s1 = (1 - sp) * 0.5, a = wl; wl = a * s0 + wr * s1; wr = wr * s0 + a * s1; }
        { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
      }
    } else if (v === 'lcr') {
      const gl = (p.lvlL || 0) / 50, gc = (p.lvlC || 0) / 50, gr = (p.lvlR || 0) / 50, sp = (p.spread === undefined ? 50 : p.spread) / 50;
      const s0 = (1 + sp) * 0.5, s1 = (1 - sp) * 0.5;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = this.master ? dl : (dl + dr) * 0.5;
        const a = this.dA.tap(this.tm(0, p.timeL)) * gl, c = this.dA.tap(this.tm(1, p.timeC)), b = this.dA.tap(this.tm(2, p.timeR)) * gr;
        this.dA.push(this.damp(0, m + c * fb));
        const cc = c * gc * 0.7071;
        { const y1_ = a * s0 + b * s1 + cc, y2_ = b * s0 + a * s1 + cc; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
      }
    } else if (v === 'hold') {
      // Hold Delay: while the hold control is on, the loop plays back frozen; otherwise it records
      const hold = FXL.src(x, p.hsrc | 0) >= 0.5 ? 1 : 0, pan = (p.pan || 0) / 100, gl = Math.min(1, 1 - pan), gr = Math.min(1, 1 + pan);
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5, t = this.tm(0, Math.max(1, p.loop));
        this.frozen += ((hold ? 1 : 0) - this.frozen) * 0.002;
        const y = this.dA.tap(t);
        this.dA.push(y * this.frozen + m * (1 - this.frozen));
        { const y1_ = y * gl, y2_ = y * gr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
      }
    }
    for (let k = 0; k < 12; k++) if (!(Math.abs(this.s[k]) > 1e-20)) this.s[k] = 0;
  }
}

// ---------------- reverbs ----------------
// an 8-line feedback delay network with input diffusion; the room types add early reflections
class FxReverb extends FxBase {
  constructor(sr, e) {
    super(sr, e);
    const v = e.v, T = {
      hall: { l: [31.3, 37.9, 41.7, 47.3, 53.9, 59.3, 67.7, 73.1], d: [0.72, 0.68, 0.64, 0.6], m: 0.25, hd: 1, er: 0 },
      smooth: { l: [33.1, 39.7, 44.3, 49.9, 56.3, 62.9, 69.7, 77.3], d: [0.78, 0.75, 0.7, 0.66], m: 0.55, hd: 1.1, er: 0 },
      room: { l: [12.7, 15.1, 17.3, 19.9, 22.1, 24.7, 27.1, 30.7], d: [0.7, 0.66, 0.6, 0.56], m: 0.12, hd: 1, er: 1 },
      bright: { l: [12.1, 14.3, 16.9, 19.3, 21.7, 23.9, 26.9, 29.3], d: [0.7, 0.66, 0.6, 0.56], m: 0.12, hd: 0.45, er: 1 },
      wetplate: { l: [9.7, 13.3, 16.9, 19.7, 23.5, 27.1, 29.9, 34.3], d: [0.8, 0.78, 0.74, 0.7], m: 0.35, hd: 0.8, er: 0 },
      dryplate: { l: [8.9, 11.9, 15.1, 17.9, 21.1, 24.1, 27.1, 30.7], d: [0.72, 0.7, 0.64, 0.6], m: 0.2, hd: 1.35, er: 0 },
      delrev: { l: [31.3, 37.9, 41.7, 47.3, 53.9, 59.3, 67.7, 73.1], d: [0.72, 0.68, 0.64, 0.6], m: 0.3, hd: 1, er: 0 },
      er: { l: null }
    }[v] || { l: [31.3, 37.9, 41.7, 47.3, 53.9, 59.3, 67.7, 73.1], d: [0.72, 0.68, 0.64, 0.6], m: 0.25, hd: 1, er: 0 };
    this.T = T;
    this.pd = new FXDL(Math.ceil(0.21 * sr) + 8);
    if (T.l) {
      this.len = T.l.map(ms => ms * sr / 1000);
      this.lines = this.len.map(l => new FXDL(Math.ceil(l + 0.002 * sr) + 8));
      this.lp = new Float64Array(8); this.g = new Float64Array(8); this.o = new Float64Array(8);
      const ap = [4.77, 3.59, 12.73, 9.31];
      this.ap = ap.map(ms => ({ d: new FXDL(Math.ceil(ms * sr / 1000) + 4), n: Math.round(ms * sr / 1000) }));
      this.apR = ap.map(ms => ({ d: new FXDL(Math.ceil(ms * 1.13 * sr / 1000) + 4), n: Math.round(ms * 1.13 * sr / 1000) }));
      this.mph = [0, 0.25, 0.5, 0.75]; this.mv = new Float64Array(4).fill(-1); this.ms = new Float64Array(4);
      this.dc = [0, 0, 0, 0];
    }
    // early reflection tap patterns (ms, gain, side) for the room reverbs and the Early Reflections effect
    this.erTaps = [];
    const rs = { r: 12345 };
    for (let j = 0; j < 24; j++) { const f = (j + 0.35 + FXL.rnd(rs) * 0.6) / 24; this.erTaps.push([f, j & 1 ? 1 : -1, FXL.rnd(rs)]); }
    this.erLine = v === 'er' ? new FXDL(Math.ceil(1.7 * sr) + 8) : null;
    this.post = [new FXBQ(), new FXBQ()]; this.postOn = v === 'bright';
    if (this.postOn) for (const b of this.post) b.set('hs', 5000, 0.707, 3, sr);
    // L/C/R delay stage of Delay/Reverb
    if (v === 'delrev') { this.dly = new FXDL(Math.ceil(0.69 * sr) + 8); this.ds = new Float64Array(4); this.dt = new Float64Array(3).fill(-1); }
    this.kT = NaN; this.kH = NaN; this.dcl = 0; this.dcr = 0; this.kdc = FXL.k(15, sr);
    this.mInc = [0.37 / sr, 0.53 / sr, 0.71 / sr, 0.83 / sr]; this.erS = new Float64Array(4); this.erG = new Float64Array(4); this.erP = new Float64Array(4);
  }
  static get ERK() { return FxReverb._erk || (FxReverb._erk = [1, 2, 3, 4].map(j => ['er' + j, 'er' + j + 'l', 'er' + j + 'p'])); }
  setup(p) {
    const T = this.T, sr = this.sr, rt = Math.max(0.1, p.time || 2);
    for (let k = 0; k < 8; k++) this.g[k] = Math.pow(10, -3 * this.len[k] / (rt * sr));
    const hd = Math.min(100, (p.hd === undefined ? 20 : p.hd) * T.hd);
    this.kd = FXL.k(16000 * Math.pow(0.07, hd / 100), sr);
    // keeps a medium hall near the level of the dry sound; long reverbs are still a little louder
    let gm = 0; for (let k = 0; k < 8; k++) gm += this.g[k] * this.g[k]; gm /= 8;
    this.norm = Math.sqrt(1 - gm) * Math.pow(Math.min(rt, 8) / 2, 0.25) * 0.9;
  }
  process(L, R, n, p, x) {
    const v = this.v, sr = this.sr, T = this.T;
    this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W; this.preEq(p, this.master ? 30 : 100); const TG_ = this.trimG, EQ_ = this.eqOn, pq0_ = this.pre[0], pq1_ = this.pre[1], pq2_ = this.pre[2], pq3_ = this.pre[3], eqL_ = x => EQ_ ? pq1_.run(pq0_.run(x * TG_)) : x * TG_, eqR_ = x => EQ_ ? pq3_.run(pq2_.run(x * TG_)) : x * TG_;
    const pdS = Math.max(1, (p.pd || 0) * sr / 1000), thru = (p.pdt || 0) / (this.master ? 30 : 100);
    if (v === 'er') return this.procER(L, R, n, p);
    { const kt = p.time || 0, kh = p.hd || 0; if (kt !== this.kT || kh !== this.kH) { this.kT = kt; this.kH = kh; this.setup(p); } }
    const g = this.g, lines = this.lines, len = this.len, lp = this.lp, o = this.o, kd = this.kd, norm = this.norm;
    const modA = T.m * sr / 1000, mInc = this.mInc, ap = this.ap, apR = this.apR, D = T.d;
    // room ER / master ER taps
    const erLv = T.er ? (p.er === undefined ? 60 : p.er) / 100 : 0, revLv = T.er && p.rev !== undefined ? p.rev / 100 : 1;
    const mEr = this.master && p.er1 !== undefined;
    const sp = this.master ? (p.spread === undefined ? 30 : p.spread) / 30 : 1;
    const erS = this.erS, erG = this.erG, erP = this.erP;
    if (mEr) for (let j = 0; j < 4; j++) { const K = FxReverb.ERK[j]; erS[j] = Math.max(1, (p[K[0]] || 0) * sr / 1000); erG[j] = (p[K[1]] || 0) / 30 * 0.6; erP[j] = (p[K[2]] === undefined ? 3 : p[K[2]]) / 6; }
    // Delay/Reverb: an L/C/R multitap delay in front of the hall
    const DR = v === 'delrev';
    const dg = DR ? [(p.lvlL || 0) / 30, (p.lvlC || 0) / 30, (p.lvlR || 0) / 30] : null, dfb = DR ? (p.fb || 0) / 100 * 0.985 : 0;
    const dkh = DR ? FXL.hdK(p.dhd, sr) : 0, dkl = DR ? FXL.ldK(p.dld, sr) : 0, kt = 1 - Math.exp(-1 / (0.06 * sr));
    const tg0 = DR ? Math.max(1, (p.timeL || 0) * sr / 1000) : 0, tg1 = DR ? Math.max(1, (p.timeC || 0) * sr / 1000) : 0, tg2 = DR ? Math.max(1, (p.timeR || 0) * sr / 1000) : 0;
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i];
      let il = eqL_(dl), ir = eqR_(this.master ? dl : dr);
      let tapL = 0, tapR = 0;
      if (DR) {
        const dt = this.dt;
        if (dt[0] < 0) { dt[0] = tg0; dt[1] = tg1; dt[2] = tg2; } else { dt[0] += (tg0 - dt[0]) * kt; dt[1] += (tg1 - dt[1]) * kt; dt[2] += (tg2 - dt[2]) * kt; }
        const a = this.dly.tap(this.dt[0]), c = this.dly.tap(this.dt[1]), b = this.dly.tap(this.dt[2]);
        const s = this.ds; s[0] += dkh * (il + c * dfb - s[0]); s[1] += dkl * (s[0] - s[1]); this.dly.push(s[0] - s[1]);
        tapL = a * dg[0] + c * dg[1] * 0.7071; tapR = b * dg[2] + c * dg[1] * 0.7071;
        il += (tapL + tapR) * 0.5; ir = il;
      }
      // DC blocker, then pre delay (with "pre delay thru": part of the input skips it) and the early reflections
      this.dcl += this.kdc * (il - this.dcl); this.dcr += this.kdc * (ir - this.dcr); il -= this.dcl; ir -= this.dcr;
      const mi = (il + ir) * 0.5;
      this.pd.push(mi);
      const pdo = this.pd.tap(pdS);
      let xl = pdo * (1 - thru) + mi * thru, xr = xl;
      if (!this.master && !this.mono) { const side = (il - ir) * 0.5; xl += side; xr -= side; }
      let el = 0, er = 0;
      if (mEr) { for (let j = 0; j < 4; j++) { const t = this.pd.tap(erS[j]) * erG[j]; el += t * (1 - erP[j]); er += t * erP[j]; } }
      else if (erLv) {
        const span = (6 + 30 * Math.min(1, (p.time || 1) / 3)) * sr / 1000;
        for (let j = 0; j < 12; j++) { const tp = this.erTaps[j], t = this.pd.tap(pdS + tp[0] * span) * (1 - j / 14) * 0.45; if (tp[1] > 0) el += t; else er += t; }
        el *= erLv; er *= erLv;
      }
      // input diffusion (separate chains for left and right)
      for (let j = 0; j < 4; j++) {
        const a = ap[j], d = a.d.tapI(a.n), w = xl - D[j] * d; a.d.push(w); xl = d + D[j] * w;
        const b = apR[j], d2 = b.d.tapI(b.n), w2 = xr - D[j] * d2; b.d.push(w2); xr = d2 + D[j] * w2;
      }
      // tank: read, damp, decay
      // modulated line lengths: computed every 16 samples, interpolated in between
      if ((i & 15) === 0) for (let j = 0; j < 4; j++) {
        this.mph[j] += mInc[j] * 16; this.mph[j] -= Math.floor(this.mph[j]);
        const tg = modA * (1 + Math.sin(6.283185307 * this.mph[j]));
        if (this.mv[j] < 0) this.mv[j] = tg; this.ms[j] = (tg - this.mv[j]) / 16;
      }
      for (let q = 0; q < 8; q++) {
        let t = len[q];
        if (q < 4) { this.mv[q] += this.ms[q]; t += this.mv[q]; }
        const y = q < 4 ? lines[q].tap(t) : lines[q].tapI(Math.round(t));
        lp[q] += kd * (y - lp[q]); o[q] = lp[q] * g[q];
      }
      // 8x8 Hadamard mix (scaled 1/sqrt 8)
      const a0 = o[0] + o[1], a1 = o[0] - o[1], a2 = o[2] + o[3], a3 = o[2] - o[3], a4 = o[4] + o[5], a5 = o[4] - o[5], a6 = o[6] + o[7], a7 = o[6] - o[7];
      const b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3, b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
      const h = 0.3535533905932738;
      lines[0].push((b0 + b4) * h + xl); lines[1].push((b1 + b5) * h + xr); lines[2].push((b2 + b6) * h - xl); lines[3].push((b3 + b7) * h + xr);
      lines[4].push((b0 - b4) * h + xl); lines[5].push((b1 - b5) * h - xr); lines[6].push((b2 - b6) * h + xl); lines[7].push((b3 - b7) * h - xr);
      let wl = (o[0] - o[2] + o[4] + o[6]) * norm, wr = (o[1] + o[3] - o[5] + o[7]) * norm;
      if (sp < 1) { const m = (wl + wr) * 0.5; wl = m + (wl - m) * sp; wr = m + (wr - m) * sp; }
      wl = wl * revLv + el + tapL * (DR ? 1 : 0); wr = wr * revLv + er + tapR * (DR ? 1 : 0);
      if (this.postOn) { wl = this.post[0].run(wl); wr = this.post[1].run(wr); }
      if (this.mono) { const m = (wl + wr) * 0.5; wl = m; wr = m; }
      { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (this.mono ? (dl + dr) * 0.5 : dl) * A_ + y1_ * W_; R[i] = (this.mono ? (dl + dr) * 0.5 : dr) * A_ + y2_ * W_; } }
    }
    for (let q = 0; q < 8; q++) if (!(Math.abs(lp[q]) > 1e-20)) lp[q] = 0;
    this.flushAll(); for (const b of this.post) b.flush();
  }
  // Early Reflections effect: Sharp, Loose, Modulated or Reverse reflection patterns over the ER time
  procER(L, R, n, p) {
    const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W; const TG_ = this.trimG, EQ_ = this.eqOn, pq0_ = this.pre[0], pq1_ = this.pre[1], eqL_ = x => EQ_ ? pq1_.run(pq0_.run(x * TG_)) : x * TG_;
    const sr = this.sr, type = p.type | 0, span = Math.max(10, p.ertime || 100) * sr / 1000, pdS = Math.max(1, (p.pd || 0) * sr / 1000), taps = this.erTaps;
    const N = taps.length, gain = this.erGain || (this.erGain = new Float64Array(N)), tt = this.erT || (this.erT = new Float64Array(N));
    if (type !== this.erType) { // tap gains only depend on the type
      this.erType = type; let tot = 0;
      for (let j = 0; j < N; j++) { const f = taps[j][0]; gain[j] = type === 3 ? Math.pow(f, 1.5) : type === 1 ? Math.exp(-1.8 * f) : Math.exp(-3.5 * f); tot += gain[j] * gain[j]; }
      const nrm = 0.9 / Math.sqrt(tot); for (let j = 0; j < N; j++) gain[j] *= nrm;
    }
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i], m = this.mono ? (dl + dr) * 0.5 : (dl + dr) * 0.5;
      this.erLine.push(eqL_(m));
      if (type === 2) { this.ph += 0.6 / sr; if (this.ph >= 1) this.ph -= 1; }
      if ((i & 15) === 0) { // tap times at control rate, glided sample by sample (the Modulated sweep is only 0.6 Hz)
        const td = this.erD || (this.erD = new Float64Array(N)), ph2 = this.ph + 16 * 0.6 / sr;
        for (let j = 0; j < N; j++) {
          const tp = taps[j], t = pdS + tp[0] * span;
          if (type === 2) { const a = t + (1 + Math.sin(6.283185307 * (this.ph + tp[2]))) * 0.0015 * sr, b = t + (1 + Math.sin(6.283185307 * (ph2 + tp[2]))) * 0.0015 * sr; tt[j] = a; td[j] = (b - a) / 16; }
          else { tt[j] = t; td[j] = 0; }
        }
      }
      let el = 0, er = 0;
      const td = this.erD;
      for (let j = 0; j < N; j++) {
        const y = this.erLine.tap(tt[j]) * gain[j]; tt[j] += td[j];
        if (taps[j][1] > 0) el += y; else er += y;
      }
      if (type === 1) { const a = el, b = er; el = a * 0.8 + b * 0.2; er = b * 0.8 + a * 0.2; }
      if (this.mono) { const m2 = (el + er) * 0.7; el = m2; er = m2; }
      { const y1_ = el, y2_ = er; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (this.mono ? m : dl) * A_ + y1_ * W_; R[i] = (this.mono ? m : dr) * A_ + y2_ * W_; } }
    }
    this.flushAll();
  }
}

// ---------------- chorus / flanger / ensemble / vibrato family ----------------
class FxMod extends FxBase {
  static get MTK() { return FxMod._mtk || (FxMod._mtk = [1, 2, 3, 4].map(k => ['t' + k, 'd' + k, 'p' + k, 'l' + k])); }
  constructor(sr, e) {
    super(sr, e);
    const ms = e.v === 'mtc' ? (e.grp === 'MM' ? 160 : 620) : 80;
    this.dA = new FXDL(Math.ceil(ms * sr / 1000) + 8); this.dB = new FXDL(Math.ceil(ms * sr / 1000) + 8);
    this.fb = new Float64Array(4); this.ph2 = 0; this.eg = 0; this.trig = -1; this.rv = 0.5; this.rt = 0.5; this.rph = 0;
    this.xo = [new FXBQ(), new FXBQ(), new FXBQ(), new FXBQ()]; this.xoKey = -1; this.dsm = [-1, -1];
  }
  process(L, R, n, p, x) {
    const v = this.v, sr = this.sr, M = sr / 1000;
    this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W; this.preEq(p); const TG_ = this.trimG, EQ_ = this.eqOn, pq0_ = this.pre[0], pq1_ = this.pre[1], pq2_ = this.pre[2], pq3_ = this.pre[3], eqL_ = x => EQ_ ? pq1_.run(pq0_.run(x * TG_)) : x * TG_, eqR_ = x => EQ_ ? pq3_.run(pq2_.run(x * TG_)) : x * TG_;
    const st = !this.mono;
    // LFO speed: tempo-synced types use Tempo / Length, Ensemble uses "Speed"
    let f = v === 'tflanger' ? FXL.tempoHz(p) : v === 'ens' || v === 'stens' ? 0.1 * Math.pow(60, (Math.max(1, p.speed || 1) - 1) / 99) : p.lfoF || 0.5;
    const inc = f / sr, wave = p.wave | 0, shape = p.shape || 0, phs = (p.phase === undefined ? 0 : p.phase) / 360;
    const sp = p.spread === undefined ? 1 : p.spread / 100;
    const s0 = (1 + sp) * 0.5, s1 = (1 - sp) * 0.5, fbk = Math.max(-1, Math.min(1, (p.fb || 0) / 100)) * 0.98, kh = FXL.hdK(p.hd, sr);
    if (v === 'chorus' || v === 'stchorus' || v === 'flanger' || v === 'tflanger' || v === 'eflanger' || v === 'rflanger' || v === 'vib' || v === 'shimmer' || v === 'biph') {
      const dep = (p.depth || 0) / 100;
      // modulation depth in ms for each type (Korg gives Depth 0..100; these spans are this model's reading)
      const span = v === 'vib' ? 3 : v === 'chorus' || v === 'stchorus' || v === 'shimmer' ? 6 : v === 'biph' ? 3 : 5;
      const baseL = v === 'stchorus' || v === 'biph' ? p.pdL : v === 'chorus' ? p.pd : v === 'vib' ? 1 : v === 'shimmer' ? 8 : v === 'eflanger' ? p.dbot : p.delay;
      const baseR = v === 'stchorus' || v === 'biph' ? p.pdR : baseL;
      // Envelope Flanger: an EG restarted by each note sweeps from "delay top" down to "delay bottom"
      if (v === 'eflanger' && x && x.trig !== this.trig) { this.trig = x.trig; this.eg = 1; }
      const egK = v === 'eflanger' ? Math.exp(-1 / (FXL.tc(p.decay, 0.03, 6) * sr)) : 1;
      const kEnv = 1 - Math.exp(-1 / (0.005 * sr)), kRel = 1 - Math.exp(-1 / (0.15 * sr)), sens = (p.sens || 0) / 100;
      const stepInc = v === 'rflanger' ? (p.stepF || 4) / sr : 0, rK = FXL.k(Math.max(0.05, f * 2), sr);
      const inc2 = v === 'biph' ? (p.lfoF2 || 0.7) / sr : 0, dep2 = (p.depth2 || 0) / 100;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        this.ph += inc; if (this.ph >= 1) this.ph -= 1;
        let uL, uR;
        if (v === 'eflanger') { this.eg *= egK; uL = uR = this.eg; }
        else if (v === 'rflanger') {
          this.rph += stepInc; if (this.rph >= 1) { this.rph -= 1; this.rt = FXL.rnd(this.rs); }
          this.rv += rK * (this.rt - this.rv);
          uL = (this.rv + FXL.uni(this.ph, 0, 0)) * 0.5; uR = (this.rv + FXL.uni((this.ph + phs) % 1, 0, 0)) * 0.5;
        } else if (v === 'biph') {
          this.ph2 += inc2; if (this.ph2 >= 1) this.ph2 -= 1;
          const a = 0.5 - 0.5 * Math.cos(6.283185307 * this.ph), b = 0.5 - 0.5 * Math.cos(6.283185307 * this.ph2);
          uL = (a * dep + b * dep2) / Math.max(1e-6, dep + dep2); uR = 1 - uL;
        } else { uL = FXL.uni(this.ph, wave, shape); uR = st ? FXL.uni((this.ph + phs + 1) % 1, wave, shape) : uL; }
        let dd = dep;
        if (v === 'shimmer') { const a = Math.abs(m); this.env += (a > this.env ? kEnv : kRel) * (a - this.env); dd = dep * (1 - sens + sens * Math.min(1, this.env * 5)); }
        if (v === 'eflanger') dd = 1;
        const spanL = v === 'eflanger' ? (p.dtop - p.dbot) : span * dd;
        const tl = Math.max(1, (baseL + spanL * uL) * M), tr = Math.max(1, (baseR + (v === 'eflanger' ? spanL : span * dd) * uR) * M);
        let yl = this.dA.tap(tl), yr = st ? this.dB.tap(tr) : yl;
        const il = this.master ? eqL_(dl) : st ? eqL_(dl) : eqL_(m), ir = this.master ? eqR_(dl) : eqR_(dr);
        if (fbk) { this.fb[0] += kh * (yl - this.fb[0]); this.fb[1] += kh * (yr - this.fb[1]); }
        this.dA.push(il + (fbk ? this.fb[0] * fbk : 0)); if (st) this.dB.push(ir + (fbk ? this.fb[1] * fbk : 0));
        if (st) { const a = yl; yl = a * s0 + yr * s1; yr = yr * s0 + a * s1; { const y1_ = yl, y2_ = yr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } } }
        else { const y1_ = yl, y2_ = yl; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (m) * A_ + y1_ * W_; R[i] = (m) * A_ + y2_ * W_; } }
      }
    } else if (v === 'hchorus') {
      const fs = 50 * Math.pow(160, (Math.max(1, p.split || 40) - 1) / 99);
      if (fs !== this.xoKey) { this.xoKey = fs; this.xo[0].set('lp', fs, 0.707, 0, sr); this.xo[1].set('hp', fs, 0.707, 0, sr); this.xo[2].set('lp', fs, 0.707, 0, sr); this.xo[3].set('hp', fs, 0.707, 0, sr); }
      const lo = (p.lowl === undefined ? 100 : p.lowl) / 100, hi = (p.highl === undefined ? 100 : p.highl) / 100, dep = (p.depth || 0) / 100 * 6, pd = p.pd || 0;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5, il = st ? dl : m, ir = st ? dr : m;
        this.ph += inc; if (this.ph >= 1) this.ph -= 1;
        const uL = FXL.uni(this.ph, wave, 0), uR = FXL.uni((this.ph + phs + 1) % 1, wave, 0);
        const yl = this.dA.tap(Math.max(1, (pd + dep * uL) * M)), yr = st ? this.dB.tap(Math.max(1, (pd + dep * uR) * M)) : yl;
        this.fb[0] += kh * (yl - this.fb[0]); this.fb[1] += kh * (yr - this.fb[1]);
        const hl = this.xo[1].run(il), hr = st ? this.xo[3].run(ir) : hl, ll = this.xo[0].run(il), lr = st ? this.xo[2].run(ir) : ll;
        this.dA.push(hl + this.fb[0] * fbk); if (st) this.dB.push(hr + this.fb[1] * fbk);
        { const y1_ = ll * lo + yl * hi, y2_ = lr * lo + yr * hi; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (il) * A_ + y1_ * W_; R[i] = (ir) * A_ + y2_ * W_; } }
      }
      for (const b of this.xo) b.flush();
    } else if (v === 'ens' || v === 'stens') {
      const dep = (p.depth || 0) / 100 * 4, sh = (p.shimmer || 0) / 100 * 0.45, inc6 = 6.1 / sr;
      // the three modulated delay times are computed every 8 samples and interpolated in between
      const dT = this.dT || (this.dT = new Float64Array(3).fill(-1)), dS = this.dS || (this.dS = new Float64Array(3));
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        if ((i & 7) === 0) {
          this.ph += inc * 8; this.ph -= Math.floor(this.ph); this.ph2 += inc6 * 8; this.ph2 -= Math.floor(this.ph2);
          for (let k = 0; k < 3; k++) {
            const u = 0.5 - 0.5 * Math.cos(6.283185307 * (this.ph + k / 3)), w = Math.sin(6.283185307 * (this.ph2 + k / 3)), tg = Math.max(1, (7 + dep * u + sh * w) * M);
            if (dT[k] < 0) dT[k] = tg; dS[k] = (tg - dT[k]) / 8;
          }
        }
        dT[0] += dS[0]; dT[1] += dS[1]; dT[2] += dS[2];
        const a = this.dA.tap(dT[0]), b = this.dA.tap(dT[1]), c = this.dA.tap(dT[2]);
        this.dA.push(v === 'stens' ? eqL_(m) : m);
        let wl = (a + b * 0.7071) * 0.75, wr = (c + b * 0.7071) * 0.75;
        if (v === 'stens') { const q = wl; wl = q * s0 + wr * s1; wr = wr * s0 + q * s1; }
        if (this.mono) { const mm = (wl + wr) * 0.6; wl = mm; wr = mm; }
        { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (this.mono ? m : dl) * A_ + y1_ * W_; R[i] = (this.mono ? m : dr) * A_ + y2_ * W_; } }
      }
    } else if (v === 'mtc') {
      const MM = this.grp === 'MM', N = MM ? 3 : 4;
      if (!this.mT) { this.mT = new Float64Array(4); this.mD = new Float64Array(4); this.mPL = new Float64Array(4); this.mPR = new Float64Array(4); }
      const T = this.mT, D = this.mD, PL = this.mPL, PR = this.mPR, KK = FxMod.MTK;
      for (let k = 0; k < N; k++) {
        const K = KK[k];
        T[k] = Math.max(0, p[K[0]] || 0); D[k] = (p[K[1]] || 0) / (MM ? 100 : 30) * 3;
        const pn = ((p[K[2]] === undefined ? 0 : p[K[2]]) + 6) / 12, g = MM ? (p[K[3]] === undefined ? 80 : p[K[3]]) / 100 : p[K[3]] === undefined ? 1 : p[K[3]] / 30;
        PL[k] = Math.cos(pn * 1.5708) * g; PR[k] = Math.sin(pn * 1.5708) * g;
      }
      const dT = this.dT || (this.dT = new Float64Array(4).fill(-1)), dS = this.dS || (this.dS = new Float64Array(4));
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        if ((i & 7) === 0) {
          this.ph += inc * 8; this.ph -= Math.floor(this.ph);
          for (let k = 0; k < N; k++) { const tg = Math.max(1, (T[k] + D[k] * (0.5 - 0.5 * Math.cos(6.283185307 * (this.ph + k * 0.25)))) * M); if (dT[k] < 0) dT[k] = tg; dS[k] = (tg - dT[k]) / 8; }
        }
        let wl = 0, wr = 0, t1 = 0;
        for (let k = 0; k < N; k++) {
          dT[k] += dS[k];
          const y = this.dA.tap(dT[k]);
          if (k === 0) t1 = y;
          wl += y * PL[k]; wr += y * PR[k];
        }
        this.fb[0] += kh * (t1 - this.fb[0]);
        this.dA.push(m + this.fb[0] * fbk);
        { const y1_ = wl * 0.6, y2_ = wr * 0.6; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
      }
    } else if (v === 'doppler') {
      const pd = (p.pdepth || 0) / 100 * 6, pn = (p.pandepth || 0) / 100;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        this.ph += inc; if (this.ph >= 1) this.ph -= 1;
        const s = Math.sin(6.283185307 * this.ph), c = Math.cos(6.283185307 * this.ph);
        const y = this.dA.tap(Math.max(1, (8 - pd * c) * M)); this.dA.push(m);
        const q = 0.5 + 0.5 * s * pn, amp = 0.85 + 0.15 * c;
        { const y1_ = y * Math.cos(q * 1.5708) * 1.4142 * amp, y2_ = y * Math.sin(q * 1.5708) * 1.4142 * amp; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
      }
    }
    this.flushAll();
    for (let k = 0; k < 4; k++) if (!(Math.abs(this.fb[k]) > 1e-20)) this.fb[k] = 0;
  }
}

// ---------------- phasers ----------------
class FxPhaser extends FxBase {
  constructor(sr, e) { super(sr, e); this.s = new Float64Array(16); this.fbv = [0, 0]; this.lp = [0, 0]; this.dcb = [0, 0]; this.kdc = FXL.k(10, sr); this.aL = 0; this.aR = 0; this.eg = 0; this.trig = -1; this.rv = 0.5; this.rt = 0.5; this.rph = 0; }
  coef(pos) { const f = 80 * Math.pow(160, Math.max(0, Math.min(1, pos))), t = Math.tan(Math.PI * Math.min(f, this.sr * 0.45) / this.sr); return (t - 1) / (t + 1); }
  process(L, R, n, p, x) {
    const v = this.v, sr = this.sr, st = !this.mono;
    this.mixSet(p, v === 'phtrem' ? 'wet' : 'wet'); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W; this.preEq(p); const TG_ = this.trimG, EQ_ = this.eqOn, pq0_ = this.pre[0], pq1_ = this.pre[1], pq2_ = this.pre[2], pq3_ = this.pre[3], eqL_ = x => EQ_ ? pq1_.run(pq0_.run(x * TG_)) : x * TG_, eqR_ = x => EQ_ ? pq3_.run(pq2_.run(x * TG_)) : x * TG_;
    const f = v === 'tph' ? FXL.tempoHz(p) : p.lfoF || 0.5, inc = f / sr, wave = p.wave | 0, shape = p.shape || 0, phs = (p.phase === undefined ? 90 : p.phase) / 360;
    const man = (v === 'eph' ? p.mbot : p.manual === undefined ? 50 : p.manual) / 100, dep = v === 'eph' ? ((p.mtop || 0) - (p.mbot || 0)) / 100 : (p.depth || 0) / 100;
    const fbk = Math.max(-1, Math.min(1, (p.reso || 0) / 100)) * 0.9, kh = FXL.hdK(p.hd, sr);
    const sp = p.spread === undefined ? 1 : p.spread / 100, s0 = (1 + sp) * 0.5, s1 = (1 - sp) * 0.5;
    if (v === 'eph' && x && x.trig !== this.trig) { this.trig = x.trig; this.eg = 1; }
    const egK = v === 'eph' ? Math.exp(-1 / (FXL.tc(p.decay, 0.03, 6) * sr)) : 1, stepInc = v === 'rph' ? (p.stepF || 4) / sr : 0, rK = FXL.k(Math.max(0.05, f * 2), sr);
    const pw = v === 'phtrem' ? (p.pwet === undefined ? 50 : p.pwet) / 100 : 1, td = v === 'phtrem' ? (p.tdepth || 0) / 100 : 0;
    const s = this.s;
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      let uL, uR;
      if (v === 'eph') { this.eg *= egK; uL = uR = this.eg; }
      else if (v === 'rph') { this.rph += stepInc; if (this.rph >= 1) { this.rph -= 1; this.rt = FXL.rnd(this.rs); } this.rv += rK * (this.rt - this.rv); uL = this.rv; uR = 1 - this.rv; }
      else { uL = FXL.uni(this.ph, wave, shape); uR = FXL.uni((this.ph + phs + 1) % 1, wave, shape); }
      if ((i & 7) === 0) { this.aL = this.coef(v === 'eph' ? man + dep * uL : man + dep * (uL - 0.5)); this.aR = st ? this.coef(v === 'eph' ? man + dep * uR : man + dep * (uR - 0.5)) : this.aL; }
      const il = this.master ? eqL_(dl) : st ? eqL_(dl) : eqL_(m), ir = this.master ? eqR_(dl) : eqR_(dr);
      let yl = il + this.fbv[0] * fbk, yr = ir + this.fbv[1] * fbk;
      const aL = this.aL, aR = this.aR;
      for (let k = 0; k < 8; k++) {
        const ol = aL * yl + s[k]; s[k] = yl - aL * ol; yl = ol;
        if (st) { const or = aR * yr + s[k + 8]; s[k + 8] = yr - aR * or; yr = or; }
      }
      if (!st) yr = yl;
      this.lp[0] += kh * (yl - this.lp[0]); this.lp[1] += kh * (yr - this.lp[1]);
      // DC blocker in the feedback: without it high resonance piles up DC / sub-bass (~10x at DC)
      this.dcb[0] += this.kdc * (this.lp[0] - this.dcb[0]); this.dcb[1] += this.kdc * (this.lp[1] - this.dcb[1]); this.fbv[0] = this.lp[0] - this.dcb[0]; this.fbv[1] = this.lp[1] - this.dcb[1];
      let wl = yl, wr = yr;
      if (v === 'phtrem') {
        // phaser with its own wet/dry, followed by a tremolo on the same LFO
        const a = 1 - Math.abs(pw); wl = il * a + yl * pw; wr = ir * a + yr * pw;
        const g = 1 - td * FXL.uni(this.ph, 0, p.tshape || 0); wl *= g; wr *= g;
      }
      if (st && sp < 1) { const q = wl; wl = q * s0 + wr * s1; wr = wr * s0 + q * s1; }
      { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (st ? dl : m) * A_ + y1_ * W_; R[i] = (st ? dr : m) * A_ + y2_ * W_; } }
    }
    for (let k = 0; k < 16; k++) if (!(Math.abs(s[k]) > 1e-20)) s[k] = 0;
    for (let k = 0; k < 2; k++) if (!(Math.abs(this.lp[k]) > 1e-20) && !(Math.abs(this.dcb[k]) > 1e-20)) { this.lp[k] = 0; this.dcb[k] = 0; this.fbv[k] = 0; }
    this.flushAll();
  }
}

// ---------------- tremolo and panners ----------------
class FxTrem extends FxBase {
  constructor(sr, e) { super(sr, e); this.envL = 0; this.pos = [0.5, 0.5]; }
  process(L, R, n, p) {
    const v = this.v, sr = this.sr; this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    const inc = (p.lfoF || 1) / sr, wave = p.wave | 0, shape = p.shape || 0, phs = (p.phase === undefined ? 0 : p.phase) / 360, dep = (p.depth || 0) / 100;
    if (v === 'trem' || v === 'pan') {
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        this.ph += inc; if (this.ph >= 1) this.ph -= 1;
        const uL = FXL.uni(this.ph, wave, shape), uR = FXL.uni((this.ph + phs + 1) % 1, wave, shape);
        if (v === 'trem') {
          if (this.mono) { const y = m * (1 - dep * uL); { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (m) * A_ + y1_ * W_; R[i] = (m) * A_ + y2_ * W_; } } }
          else { const y1_ = dl * (1 - dep * uL), y2_ = dr * (1 - dep * uR); if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
        } else {
          // auto pan: each channel travels between the sides; LFO phase offsets the right channel
          const qL = 0.5 + (uL - 0.5) * dep, qR = 0.5 + (uR - 0.5) * dep;
          const wl = dl * Math.cos(qL * 1.5708) + dr * Math.cos(qR * 1.5708), wr = dl * Math.sin(qL * 1.5708) + dr * Math.sin(qR * 1.5708);
          { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
        }
      }
    } else {
      // Envelope Pan / Dyna Pan: the input level moves each channel from its start to its destination
      const kA = v === 'envpan' ? 1 - Math.exp(-1 / (FXL.tc(p.atk, 0.002, 1) * sr)) : 1 - Math.exp(-1 / (FXL.tc(101 - (p.rate || 40), 0.005, 1.5) * sr));
      const kR = v === 'envpan' ? 1 - Math.exp(-1 / (FXL.tc(p.rel, 0.01, 3) * sr)) : kA * 0.5;
      const a0 = (p.lStart || 0) / 100, a1 = (p.lDest === undefined ? 100 : p.lDest) / 100, b0 = (p.rStart === undefined ? 100 : p.rStart) / 100, b1 = (p.rDest || 0) / 100;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], lv = Math.max(Math.abs(dl), Math.abs(dr));
        this.envL += (lv > this.envL ? kA : kR) * (lv - this.envL);
        const e = Math.min(1, this.envL * 4), qL = a0 + (a1 - a0) * e, qR = b0 + (b1 - b0) * e;
        const wl = dl * Math.cos(qL * 1.5708) + dr * Math.cos(qR * 1.5708), wr = dl * Math.sin(qL * 1.5708) + dr * Math.sin(qR * 1.5708);
        { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
      }
    }
  }
}

// ---------------- rotary speaker ----------------
class FxRot extends FxBase {
  constructor(sr, e) {
    super(sr, e);
    this.hl = new FXDL(Math.ceil(0.004 * sr) + 8); this.rl = new FXDL(Math.ceil(0.004 * sr) + 8);
    this.xo = [new FXBQ(), new FXBQ()]; this.xo[0].set('lp', 800, 0.707, 0, sr); this.xo[1].set('hp', 800, 0.707, 0, sr);
    this.hA = 0; this.rA = 0; this.hHz = -1; this.rHz = -1; this.odLp = 0;
  }
  process(L, R, n, p, x) {
    const sr = this.sr; this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    const src = p.spdSrc | 0, fast = src ? FXL.src(x, src) >= 0.5 : p.fast === 1;
    const acc = (p.acc === undefined ? 50 : p.acc) / 100, tH = 0.15 + (1 - acc) * 2.2, tR = tH * 2.8;
    const hT = fast ? 6.8 : 0.8, rT = fast ? 5.9 : 0.66;
    if (this.hHz < 0) { this.hHz = hT; this.rHz = rT; }
    this.hHz += (hT - this.hHz) * (1 - Math.exp(-n / (tH * sr))); this.rHz += (rT - this.rHz) * (1 - Math.exp(-n / (tR * sr)));
    const md = (p.mic === undefined ? 40 : p.mic) / 100, amH = 0.5 * (1 - 0.55 * md), amR = 0.32 * (1 - 0.55 * md), dop = 0.00032 * sr * (1 - 0.35 * md);
    const bal = (p.balance === undefined ? 50 : p.balance) / 50, gH = Math.min(1, bal), gR = Math.min(1, 2 - bal);
    const iH = 6.283185307 * this.hHz / sr, iR = 6.283185307 * this.rHz / sr;
    const od = this.v === 'rotod' && p.od !== 0, odG = 1 + (p.odGain === undefined ? 25 : p.odGain) * 0.5, odL = (p.odLevel === undefined ? 35 : p.odLevel) / 50;
    const kod = FXL.k(5000, sr);
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i];
      let m = (dl + dr) * 0.5;
      if (od) { const y = Math.tanh(m * odG + 0.15) - 0.1489; this.odLp += kod * (y - this.odLp); m = this.odLp * odL * 0.7; }
      const lo = this.xo[0].run(m), hi = this.xo[1].run(m);
      this.hA += iH; if (this.hA > 6.283185307) this.hA -= 6.283185307; this.rA += iR; if (this.rA > 6.283185307) this.rA -= 6.283185307;
      this.hl.push(hi); this.rl.push(lo);
      // two microphones 90 degrees apart around the cabinet
      const sH = Math.sin(this.hA), cH = Math.cos(this.hA), sR = Math.sin(this.rA), cR = Math.cos(this.rA);
      const hLv = this.hl.tap(2 + dop * (1 + sH)) * (1 - amH * (0.5 + 0.5 * cH)), hRv = this.hl.tap(2 + dop * (1 + cH)) * (1 - amH * (0.5 - 0.5 * sH));
      const rLv = this.rl.tap(2 + dop * 0.3 * (1 + sR)) * (1 - amR * (0.5 + 0.5 * cR)), rRv = this.rl.tap(2 + dop * 0.3 * (1 + cR)) * (1 - amR * (0.5 - 0.5 * sR));
      let wl = hLv * gH + rLv * gR, wr = hRv * gH + rRv * gR;
      if (this.mono) { const q = (wl + wr) * 0.5; wl = q; wr = q; { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = ((dl + dr) * 0.5) * A_ + y1_ * W_; R[i] = ((dl + dr) * 0.5) * A_ + y2_ * W_; } } }
      else { const y1_ = wl, y2_ = wr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
    }
    this.xo[0].flush(); this.xo[1].flush();
  }
}

// ---------------- filters and generators: Talking Modulator, wah, exciter, resonators, ring mod, vocoder ... ----------------
class FxFilt extends FxBase {
  static get VOW() {
    // formant frequency (Hz), level (dB) and bandwidth (Hz) of the vowels A, I, U, E, O (four formants each)
    return FxFilt._vow || (FxFilt._vow = [
      [[650, 1080, 2650, 2900], [0, -6, -7, -8], [80, 90, 120, 130]],
      [[290, 1870, 2800, 3250], [0, -15, -18, -20], [40, 90, 100, 120]],
      [[350, 600, 2700, 2900], [0, -20, -17, -14], [40, 60, 100, 120]],
      [[400, 1700, 2600, 3200], [0, -14, -12, -14], [70, 80, 100, 120]],
      [[400, 800, 2600, 2800], [0, -10, -12, -12], [40, 80, 100, 120]]]);
  }
  constructor(sr, e) {
    super(sr, e);
    const v = e.v;
    this.bq = []; for (let i = 0; i < (v === 'voc' ? 34 : v === 'piano' ? 10 : 8); i++) this.bq.push(new FXBQ());
    this.sv = new Float64Array(8); this.c = -1; this.fa = new Float64Array(8); this.env = 0; this.hold = [0, 0]; this.dph = 0; this.osc = 0;
    this.rv = [0.5, 0.5]; this.rt = [0.5, 0.5]; this.rph = 0; this.lp = new Float64Array(8);
    if (v === 'reson' || v === 'reson2') { const N = Math.ceil(sr / 14) + 8; this.dA = new FXDL(N); this.dB = new FXDL(N); }
    if (v === 'enh') this.dA = new FXDL(Math.ceil(0.06 * sr) + 8);
    if (v === 'piano') { this.cmb = [40, 45, 50, 55, 59, 64].map(nn => ({ d: new FXDL(Math.ceil(sr / (440 * Math.pow(2, (nn - 69) / 12))) + 8), t: sr / (440 * Math.pow(2, (nn - 69) / 12)), s: 0 })); this.bodyKey = ''; }
    if (v === 'voc') { this.venv = new Float64Array(16); this.vKey = ''; }
    this.key = '';
  }
  // TPT state-variable filter (c = channel), returns [lp, bp(normalised), hp] in this.sv slots 4..6
  // coefficients are set at control rate (svfSet) and used per sample (svf)
  svfSet(c, f, q) {
    const g = Math.tan(Math.PI * Math.min(f, this.sr * 0.45) / this.sr), k = 1 / q, a1 = 1 / (1 + g * (g + k)), C = this.sc || (this.sc = new Float64Array(8));
    C[c * 4] = a1; C[c * 4 + 1] = g * a1; C[c * 4 + 2] = g * g * a1; C[c * 4 + 3] = k;
  }
  svf(c, xin) {
    const C = this.sc, a1 = C[c * 4], a2 = C[c * 4 + 1], a3 = C[c * 4 + 2], k = C[c * 4 + 3], s = this.sv;
    const v3 = xin - s[c * 2 + 1], v1 = a1 * s[c * 2] + a2 * v3, v2 = s[c * 2 + 1] + a2 * s[c * 2] + a3 * v3;
    s[c * 2] = 2 * v1 - s[c * 2]; s[c * 2 + 1] = 2 * v2 - s[c * 2 + 1];
    this.o_lp = v2; this.o_bp = v1 * k; this.o_hp = xin - k * v1 - v2;
  }
  process(L, R, n, p, x) {
    const v = this.v, sr = this.sr; this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    if (v === 'talk') return this.talk(L, R, n, p, x);
    if (v === 'voc') return this.vocoder(L, R, n, p, x);
    if (v === 'piano') return this.piano(L, R, n, p, x);
    this.preEq(p); const TG_ = this.trimG, EQ_ = this.eqOn, pq0_ = this.pre[0], pq1_ = this.pre[1], pq2_ = this.pre[2], pq3_ = this.pre[3], eqL_ = x => EQ_ ? pq1_.run(pq0_.run(x * TG_)) : x * TG_, eqR_ = x => EQ_ ? pq3_.run(pq2_.run(x * TG_)) : x * TG_;
    const st = !this.mono;
    if (v === 'wah') {
      const mode = p.auto | 0, auto = mode === 0, ctl = FXL.src(x, p.src | 0), b = (p.fbot || 0) / 100, t = (p.ftop === undefined ? 90 : p.ftop) / 100, winc = (p.lfoF || 1) / sr;
      const sens = (p.sens || 0) / 100, shp = (p.eshape || 0) / 100, q = 0.8 + (p.reso || 0) / 100 * 12;
      const kA = FXL.k(80, sr), kR = FXL.k(8, sr);
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        let c;
        if (auto) { const a = Math.abs(m); this.env += (a > this.env ? kA : kR) * (a - this.env); c = Math.min(1, this.env * sens * 8); c = shp >= 0 ? 1 - Math.pow(1 - c, 1 + shp * 3) : Math.pow(c, 1 - shp * 3); }
        else if (mode === 2) { this.dph += winc; if (this.dph >= 1) this.dph -= 1; c = this.dph < 0.5 ? this.dph * 2 : 2 - this.dph * 2; }
        else c = Math.max(0, Math.min(1, Math.abs(ctl)));
        if ((i & 7) === 0) this.svfSet(0, 150 * Math.pow(20, b + (t - b) * c), q);
        this.svf(0, m);
        const y = this.o_bp * 1.4 + this.o_lp * 0.25;
        { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (m) * A_ + y1_ * W_; R[i] = (m) * A_ + y2_ * W_; } }
      }
    } else if (v === 'rand') {
      const inc = (p.lfoF || 4) / sr, cut = (p.cutoff === undefined ? 50 : p.cutoff) / 100, dep = (p.depth || 0) / 100, q = 0.7 + (p.reso || 0) / 100 * 14;
      const t = st ? Math.abs(p.spread === undefined ? 100 : p.spread) / 100 : 0, kS = FXL.k(150, sr);
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        this.rph += inc; if (this.rph >= 1) { this.rph -= 1; this.rt[0] = FXL.rnd(this.rs); this.rt[1] = FXL.rnd(this.rs); }
        this.rv[0] += kS * (this.rt[0] - this.rv[0]); this.rv[1] += kS * (this.rt[1] - this.rv[1]);
        const rl = this.rv[0], rr = rl * (1 - t) + this.rv[1] * t;
        if ((i & 7) === 0) { this.svfSet(0, 60 * Math.pow(250, Math.max(0, Math.min(1, cut + dep * (rl - 0.5)))), q); if (st) this.svfSet(1, 60 * Math.pow(250, Math.max(0, Math.min(1, cut + dep * (rr - 0.5)))), q); }
        this.svf(0, st ? dl : m); const yl = this.o_lp;
        let yr = yl; if (st) { this.svf(1, dr); yr = this.o_lp; }
        { const y1_ = yl, y2_ = yr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (st ? dl : m) * A_ + y1_ * W_; R[i] = (st ? dr : m) * A_ + y2_ * W_; } }
      }
    } else if (v === 'exc' || v === 'enh') {
      const f = 600 * Math.pow(25, Math.max(0, Math.min(140, p.point === undefined ? 70 : p.point)) / 140), bl = (p.blend || 0) / 100;
      if (f !== this.key) { this.key = f; for (let c = 0; c < 2; c++) { this.bq[c].set('hp', f, 0.707, 0, sr); this.bq[c + 2].set('hp', f, 0.707, 0, sr); } }
      const w = (p.width || 0) / 100, amb = (p.amb || 0) / 100, tL = Math.max(1, (p.dlyL || 0) * sr / 1000), tR = Math.max(1, (p.dlyR || 0) * sr / 1000), kA = FXL.k(3000, sr);
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i];
        if (v === 'exc') {
          const m = eqL_((dl + dr) * 0.5), h = this.bq[0].run(m), hs = this.bq[2].run(Math.tanh(h * 3) / 3);
          const y = m + bl * (h * 0.6 + hs * 1.6);
          { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = ((dl + dr) * 0.5) * A_ + y1_ * W_; R[i] = ((dl + dr) * 0.5) * A_ + y2_ * W_; } }
        } else {
          const il = eqL_(dl), ir = eqR_(dr), m = (il + ir) * 0.5, sd = (il - ir) * 0.5;
          const h = this.bq[0].run(m), hs = this.bq[2].run(Math.tanh(h * 3) / 3), mx = m + bl * (h * 0.6 + hs * 1.6);
          this.dA.push(m);
          const a = this.dA.tap(tL), b = this.dA.tap(tR);
          this.lp[0] += kA * ((a + b) * 0.5 - this.lp[0]);
          const side = sd * (1 + w) + (a - b) * w * 0.5, am = this.lp[0] * amb * 0.5;
          { const y1_ = mx + side + am, y2_ = mx - side + am; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
        }
      }
    } else if (v === 'sub') {
      const note = p.mode === 1 ? null : (x ? x.note : 60);
      const f = note === null ? p.fixed || 40 : 440 * Math.pow(2, (note + (p.interval || 0) + (p.fine || 0) / 100 - 69) / 12);
      const inc = f / sr, sens = (p.sens === undefined ? 60 : p.sens) / 100, kA = FXL.k(60, sr), kR = FXL.k(6, sr);
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5, a = Math.abs(m);
        this.env += (a > this.env ? kA : kR) * (a - this.env);
        this.dph += inc; if (this.dph >= 1) this.dph -= 1;
        // "adds very low frequencies to the input signal": the effect sound is the input plus the oscillator
        const y = m + Math.sin(6.283185307 * this.dph) * Math.min(1, this.env * sens * 3);
        { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (m) * A_ + y1_ * W_; R[i] = (m) * A_ + y2_ * W_; } }
      }
    } else if (v === 'reson' || v === 'reson2') {
      const two = v === 'reson2', inc = (p.lfoF || 1) / sr, ld = (p.lfoDepth || 0) / 100 * 2, trim = (p.trim === undefined ? 80 : p.trim) / 100;
      const f1 = 440 * Math.pow(2, ((p.pitch || 57) + (p.fine || 0) / 100 - 69) / 12), f2 = 440 * Math.pow(2, ((p.pitch2 || 64) + (p.fine2 || 0) / 100 - 69) / 12);
      const r1 = Math.max(-1, Math.min(1, (p.reso || 0) / 100)) * 0.985, r2 = Math.max(-1, Math.min(1, (p.reso2 || 0) / 100)) * 0.985;
      const k1 = FXL.hdK(p.hd, sr), k2 = FXL.hdK(two ? p.hd2 : p.hd, sr);
      const n1 = Math.sqrt(1 - r1 * r1) + 0.05, n2 = Math.sqrt(1 - r2 * r2) + 0.05;
      const l1 = two ? (p.lvl1 === undefined ? 80 : p.lvl1) / 100 : 1, l2 = two ? (p.lvl2 === undefined ? 80 : p.lvl2) / 100 : 0;
      const q1 = two ? ((p.pan1 || 0) + 6) / 12 : 0.5, q2 = two ? ((p.pan2 || 0) + 6) / 12 : 0.5;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5 * trim;
        this.dph += inc; if (this.dph >= 1) this.dph -= 1;
        const mod = Math.pow(2, ld * Math.sin(6.283185307 * this.dph) / 12);
        const a = this.dA.tap(sr / (f1 * mod)); this.lp[0] += k1 * (a - this.lp[0]); this.dA.push(m + this.lp[0] * r1);
        let y1 = a * n1, y2 = 0;
        if (two) { const b = this.dB.tap(sr / (f2 * mod)); this.lp[1] += k2 * (b - this.lp[1]); this.dB.push(m + this.lp[1] * r2); y2 = b * n2; }
        if (two) { const y1_ = y1 * l1 * Math.cos(q1 * 1.5708) * 1.4142 + y2 * l2 * Math.cos(q2 * 1.5708) * 1.4142, y2_ = y1 * l1 * Math.sin(q1 * 1.5708) * 1.4142 + y2 * l2 * Math.sin(q2 * 1.5708) * 1.4142; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
        else { const y1_ = y1, y2_ = y1; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = ((dl + dr) * 0.5) * A_ + y1_ * W_; R[i] = ((dl + dr) * 0.5) * A_ + y2_ * W_; } }
      }
    } else if (v === 'ring') {
      const f0 = p.mode === 1 ? 440 * Math.pow(2, ((x ? x.note : 60) + (p.noteOfs || 0) + (p.fine || 0) / 100 - 69) / 12) : Math.max(0, p.fixed || 0);
      const inc = (p.lfoF || 1) / sr, ld = (p.lfoDepth || 0) / 100;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        this.rph += inc; if (this.rph >= 1) this.rph -= 1;
        this.dph += f0 * Math.pow(2, ld * Math.sin(6.283185307 * this.rph)) / sr; if (this.dph >= 1) this.dph -= Math.floor(this.dph);
        const y = m * Math.sin(6.283185307 * this.dph);
        { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (m) * A_ + y1_ * W_; R[i] = (m) * A_ + y2_ * W_; } }
      }
    }
    for (let k = 0; k < 8; k++) { if (!(Math.abs(this.sv[k]) > 1e-20)) this.sv[k] = 0; if (!(Math.abs(this.lp[k]) > 1e-20)) this.lp[k] = 0; }
    for (const b of this.bq) b.flush(); this.flushAll();
  }
  // Talking Modulator: formant filters morph through Voice Bottom -> Center -> Top as the voice control moves
  talk(L, R, n, p, x) {
    const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    const sr = this.sr, V = FxFilt.VOW, bi = p.bottom | 0, ci = p.center | 0, ti = p.top | 0, src = p.src | 0;
    const man = (p.manual === undefined ? 50 : p.manual) / 100, sv = FXL.src(x, src);
    // with a source, the manual value is the resting position and the source moves the voice towards the top;
    // "LFO" (Triton) sweeps the voice bottom -> top -> bottom
    const bip = src === 10 || src === 11, lfo = p.sweep === 1;
    let tgt = src ? (bip ? man + sv * 0.5 : man + sv * (1 - man)) : man;
    if (lfo) { this.dph += n * (p.lfoF || 0.5) / sr; this.dph -= Math.floor(this.dph); tgt = this.dph < 0.5 ? this.dph * 2 : 2 - this.dph * 2; }
    tgt = Math.max(0, Math.min(1, tgt));
    if (this.c < 0) this.c = tgt;
    const shift = Math.pow(2, (p.shift || 0) / 100 * 0.75), bwS = 3 * Math.pow(1 / 6, (p.reso === undefined ? 60 : p.reso) / 100);
    const kc = 1 - Math.exp(-1 / (0.012 * sr)), bq = this.bq, amp = this.fa;
    for (let i = 0; i < n; i++) {
      if ((i & 15) === 0) {
        this.c += (tgt - this.c) * (1 - Math.pow(1 - kc, 16));
        // the four formant filters are only re-designed when the vowel position or a setting moved
        const c = this.c, tk = this.tk || (this.tk = new Float64Array(6).fill(NaN));
        if (!(tk[0] === c && tk[1] === shift && tk[2] === bwS && tk[3] === bi && tk[4] === ci && tk[5] === ti)) {
        tk[0] = c; tk[1] = shift; tk[2] = bwS; tk[3] = bi; tk[4] = ci; tk[5] = ti;
        const A = c < 0.5 ? V[bi] : V[ci], B = c < 0.5 ? V[ci] : V[ti], t = c < 0.5 ? c * 2 : (c - 0.5) * 2;
        let pw = 0;
        for (let k = 0; k < 4; k++) {
          const f = Math.exp(Math.log(A[0][k]) * (1 - t) + Math.log(B[0][k]) * t) * shift;
          const g = Math.pow(10, (A[1][k] * (1 - t) + B[1][k] * t) / 20), bw = (A[2][k] * (1 - t) + B[2][k] * t) * bwS * (0.6 + 0.4 * shift);
          bq[k].set('bp', f, f / bw, 0, sr); amp[k] = g; pw += g * g * bw;
        }
        // keeps the level of a bright input roughly steady whatever the vowel and resonance
        const mk = Math.min(14, Math.sqrt(sr * 0.5 / (pw * 1.5708)) * 0.4);
        for (let k = 0; k < 4; k++) amp[k] *= mk;
        }
      }
      const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
      const y = bq[0].run(m) * amp[0] + bq[1].run(m) * amp[1] + bq[2].run(m) * amp[2] + bq[3].run(m) * amp[3];
      { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
    }
    for (const b of bq) b.flush();
  }
  // Piano Body/Damper: sound-board resonances, plus open-string sympathetic resonance while the damper pedal is down
  piano(L, R, n, p, x) {
    const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    const sr = this.sr, bq = this.bq, key = (p.tone || 60) + '';
    if (key !== this.bodyKey) {
      this.bodyKey = key; const F = [95, 170, 260, 390, 560, 820, 1250, 2100];
      for (let k = 0; k < 8; k++) bq[k].set('bp', F[k], 5, 0, sr);
      const fc = 1500 * Math.pow(13, (p.tone || 60) / 100); bq[8].set('lp', fc, 0.707, 0, sr); bq[9].set('lp', fc, 0.707, 0, sr);
    }
    const board = (p.board || 0) / 100 * 1.6, ped = FXL.src(x, 17) >= 0.5, dmp = (p.damper || 0) / 100 * 0.35, fbc = ped ? 0.985 : 0.6, kd = FXL.k(3500, sr);
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
      let body = 0; for (let k = 0; k < 8; k++) body += bq[k].run(m) * (1 - k * 0.08);
      let sym = 0;
      for (const c of this.cmb) { const y = c.d.tap(c.t); c.s += kd * (y - c.s); c.d.push(m * 0.2 + c.s * fbc); sym += y; }
      const add = body * board + sym * dmp;
      { const y1_ = bq[8].run(dl + add), y2_ = bq[9].run(dr + add); if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
    }
    for (const b of bq) b.flush(); for (const c of this.cmb) if (!(Math.abs(c.s) > 1e-20)) c.s = 0;
  }
  // Vocoder: 16 bands; the modulator is the microphone when one is connected, otherwise the input itself
  vocoder(L, R, n, p, x) {
    const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    const sr = this.sr, bq = this.bq;
    if (!this.vKey) { this.vKey = '1'; for (let k = 0; k < 16; k++) { const f = 120 * Math.pow(7000 / 120, k / 15); bq[k].set('bp', f, 6, 0, sr); bq[k + 16].set('bp', f, 6, 0, sr); } bq[32].set('hp', 5000, 0.707, 0, sr); }
    const mic = x && x.mic && x.mic.length >= n ? x.mic : null, ct = (p.carTrim === undefined ? 80 : p.carTrim) / 100 * 1.25, mt = (p.modTrim === undefined ? 80 : p.modTrim) / 100 * 1.25;
    const hm = (p.hiMix || 0) / 100, vc = (p.vc === undefined ? 80 : p.vc) / 100, kA = FXL.k(1 / 0.004 / 6.283, sr), kR = FXL.k(1 / 0.04 / 6.283, sr), E = this.venv;
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i], car = (dl + dr) * 0.5 * ct, mod = (mic ? mic[i] * 4 : (dl + dr) * 0.5) * mt;
      let y = 0;
      for (let k = 0; k < 16; k++) { const a = Math.abs(bq[k + 16].run(mod)); E[k] += (a > E[k] ? kA : kR) * (a - E[k]); y += bq[k].run(car) * E[k]; }
      y = y * 9 * vc + car * (1 - vc) + bq[32].run(mod) * hm;
      { const y1_ = y, y2_ = y; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
    }
    for (const b of bq) b.flush();
  }
}

// ---------------- equalisers ----------------
class FxEQ extends FxBase {
  constructor(sr, e) { super(sr, e); this.b = []; for (let i = 0; i < 26; i++) this.b.push(new FXBQ()); this.nb = 0; this.kv = new Float64Array(55).fill(NaN); }
  static get KEYS() { const K = FxEQ._k || (FxEQ._k = []); if (!K.length) for (let k = 1; k <= 13; k++) K.push('b' + k, 'f' + k, 'q' + k, 'g' + k); return K; }
  static gFreq(type) {
    // Trinity Graphic 7 Band EQ band sets. Korg shows the frequencies on screen only; three "Wide" sets in series
    // make the documented 21-band EQ from 80 Hz to 18 kHz, and the other sets follow the same grid.
    const G = k => 80 * Math.pow(225, k / 20), set = (a, st) => Array.from({ length: 7 }, (_, i) => G(a + i * st));
    return [set(0, 3), set(1, 3), set(2, 3), set(0, 2), set(4, 2), set(8, 2), set(0, 1), set(0, 1.5), set(7, 1), set(5.5, 1.5), set(14, 1), set(11, 1.5)][type] || set(0, 3);
  }
  setup(p) {
    const v = this.v, sr = this.sr, b = this.b, st = !this.mono;
    const put = (i, t, f, q, g) => { b[i].set(t, f, q, g, sr); b[i + 13].set(t, f, q, g, sr); };
    if (v === 'peq') {
      put(0, p.t1 === 1 ? 'ls' : 'peak', p.f1, p.q1, p.g1); put(1, 'peak', p.f2, p.q2, p.g2); put(2, 'peak', p.f3, p.q3, p.g3); put(3, p.t4 === 1 ? 'hs' : 'peak', p.f4, p.q4, p.g4); this.nb = 4;
    } else if (v === 'geq7') {
      const F = FxEQ.gFreq(p.type | 0), q = [1.2, 1.2, 1.2, 1.9, 1.9, 1.9, 3.6, 2.5, 3.6, 2.5, 3.6, 2.5][p.type | 0] || 1.2;
      for (let k = 0; k < 7; k++) put(k, 'peak', F[k], q, p['b' + (k + 1)] || 0); this.nb = 7;
    } else {
      for (let k = 0; k < 13; k++) put(k, 'peak', 80 * Math.pow(225, k / 12), 2.2, p['b' + (k + 1)] || 0); this.nb = 13;
    }
  }
  process(L, R, n, p) {
    this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    // re-design the bands only when a setting changed
    const kv = this.kv, K = FxEQ.KEYS; let ch = false;
    const a0 = p.type | 0, a1 = p.t1 | 0, a2 = p.t4 | 0;
    if (kv[0] !== a0 || kv[1] !== a1 || kv[2] !== a2) { kv[0] = a0; kv[1] = a1; kv[2] = a2; ch = true; }
    for (let j = 0; j < 52; j++) { const v = p[K[j]] || 0; if (kv[3 + j] !== v) { kv[3 + j] = v; ch = true; } }
    if (ch) this.setup(p);
    const b = this.b, nb = this.nb, tr = (p.trim === undefined ? 100 : p.trim) / 100, st = !this.mono;
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i];
      let yl = (st ? dl : (dl + dr) * 0.5) * tr, yr = dr * tr;
      for (let k = 0; k < nb; k++) { yl = b[k].run(yl); if (st) yr = b[k + 13].run(yr); }
      if (!st) yr = yl;
      { const y1_ = yl, y2_ = yr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (st ? dl : (dl + dr) * 0.5) * A_ + y1_ * W_; R[i] = (st ? dr : (dl + dr) * 0.5) * A_ + y2_ * W_; } }
    }
    for (const q of b) q.flush();
  }
}

// ---------------- dynamics ----------------
class FxDyn extends FxBase {
  constructor(sr, e) { super(sr, e); this.env = new Float64Array(3); this.gr = new Float64Array(3).fill(1); this.xo = [new FXBQ(), new FXBQ(), new FXBQ(), new FXBQ()]; this.xoOn = false; }
  process(L, R, n, p) {
    const v = this.v, sr = this.sr; this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W; this.preEq(p); const TG_ = this.trimG, EQ_ = this.eqOn, pq0_ = this.pre[0], pq1_ = this.pre[1], pq2_ = this.pre[2], pq3_ = this.pre[3], eqL_ = x => EQ_ ? pq1_.run(pq0_.run(x * TG_)) : x * TG_, eqR_ = x => EQ_ ? pq3_.run(pq2_.run(x * TG_)) : x * TG_;
    const st = !this.mono;
    if (v === 'comp') {
      // Sensitivity lowers the threshold (more compression) and brings in matching make-up gain; Output Level trims the result
      const sens = p.sens === undefined ? 50 : p.sens, Tdb = -8 - 0.34 * sens, rat = 6, T = FXL.db(Tdb), mk = FXL.db(-Tdb * (1 - 1 / rat) * 0.6);
      const kA = 1 - Math.exp(-1 / (FXL.tc(p.atk, 0.0003, 0.08) * sr)), kR = 1 - Math.exp(-1 / (0.15 * sr)), og = (p.outl === undefined ? 60 : p.outl) / 60 * mk;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], il = eqL_(st ? dl : (dl + dr) * 0.5), ir = st ? eqR_(dr) : il;
        const a = Math.max(Math.abs(il), Math.abs(ir)); this.env[0] += (a > this.env[0] ? kA : kR) * (a - this.env[0]);
        const e = this.env[0], g = e > T ? Math.pow(T / e, 1 - 1 / rat) : 1;
        { const y1_ = il * g * og, y2_ = ir * g * og; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (st ? dl : (dl + dr) * 0.5) * A_ + y1_ * W_; R[i] = (st ? dr : (dl + dr) * 0.5) * A_ + y2_ * W_; } }
      }
    } else if (v === 'lim' || v === 'mbl') {
      // Ratio 1.0:1-10.0:1 in 0.1 steps, 11:1-50:1 in 1 steps, then Inf:1 (raw 0-131)
      const r = Math.round(p.ratio === undefined ? 60 : p.ratio), rat = r >= 131 ? 1000 : r <= 90 ? 1 + r * 0.1 : 11 + (r - 91);
      const kA = 1 - Math.exp(-1 / (FXL.tc(p.atk, 0.0001, 0.05) * sr)), kR = 1 - Math.exp(-1 / (FXL.tc(p.rel, 0.01, 1) * sr)), mk = FXL.db(p.gain || 0);
      const T = this.T3 || (this.T3 = new Float64Array(3));
      T[0] = FXL.db((p.thr || 0) + (v === 'mbl' ? p.lowo || 0 : 0)); T[1] = FXL.db((p.thr || 0) + (p.mido || 0)); T[2] = FXL.db((p.thr || 0) + (p.higho || 0));
      if (v === 'mbl' && !this.xoOn) { this.xoOn = true; this.xo[0].set('lp', 250, 0.707, 0, sr); this.xo[1].set('lp', 250, 0.707, 0, sr); this.xo[2].set('hp', 3000, 0.707, 0, sr); this.xo[3].set('hp', 3000, 0.707, 0, sr); }
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], il = st ? dl : (dl + dr) * 0.5, ir = st ? dr : il;
        let yl, yr;
        if (v === 'lim') {
          const a = Math.max(Math.abs(il), Math.abs(ir)); this.env[0] += (a > this.env[0] ? kA : kR) * (a - this.env[0]);
          const e = this.env[0], g = e > T[0] ? Math.pow(T[0] / e, 1 - 1 / rat) : 1; yl = il * g * mk; yr = ir * g * mk;
        } else {
          const m = (il + ir) * 0.5, lo = this.xo[0].run(m), hi = this.xo[2].run(m), mid = m - lo - hi; yl = 0;
          for (let k = 0; k < 3; k++) { const bnd = k === 0 ? lo : k === 1 ? mid : hi, a = Math.abs(bnd); this.env[k] += (a > this.env[k] ? kA : kR) * (a - this.env[k]); const e = this.env[k]; yl += bnd * (e > T[k] ? Math.pow(T[k] / e, 1 - 1 / rat) : 1); }
          yl *= mk; yr = yl + (ir - il) * 0.5 * mk; yl = yl - (ir - il) * 0.5 * mk;
        }
        { const y1_ = yl, y2_ = yr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (il) * A_ + y1_ * W_; R[i] = (ir) * A_ + y2_ * W_; } }
      }
      for (const b of this.xo) b.flush();
    } else if (v === 'gate') {
      const T = FXL.db(-80 + (p.thr === undefined ? 30 : p.thr) * 0.8), kE = FXL.k(200, sr);
      const kA = 1 - Math.exp(-1 / (FXL.tc(p.atk, 0.0002, 0.05) * sr)), kR = 1 - Math.exp(-1 / (FXL.tc(p.rel, 0.005, 1.5) * sr));
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], il = st ? dl : (dl + dr) * 0.5, ir = st ? dr : il;
        const a = Math.max(Math.abs(il), Math.abs(ir)); this.env[0] += kE * (a - this.env[0]);
        const tg = this.env[0] > T ? 1 : 0; this.gr[0] += (tg > this.gr[0] ? kA : kR) * (tg - this.gr[0]);
        { const y1_ = il * this.gr[0], y2_ = ir * this.gr[0]; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (il) * A_ + y1_ * W_; R[i] = (ir) * A_ + y2_ * W_; } }
      }
    }
    this.flushAll();
  }
}

// ---------------- drive: amp simulation, overdrive, decimator ----------------
class FxDrive extends FxBase {
  constructor(sr, e) { super(sr, e); this.b = []; for (let i = 0; i < 12; i++) this.b.push(new FXBQ()); this.key = ''; this.s = new Float64Array(8); this.hp = [0, 0]; this.hold = [0, 0]; this.dph = 0; this.sv = new Float64Array(4); }
  cab(type, off) {
    const sr = this.sr, b = this.b;
    const T = [[['hp', 70, 0.7, 0], ['peak', 2500, 1, 3], ['lp', 6500, 0.8, 0]], [['hp', 80, 0.7, 0], ['peak', 400, 0.8, 3], ['lp', 5000, 0.9, 0]], [['hp', 90, 0.7, 0], ['peak', 1200, 0.9, 5], ['lp', 4500, 0.9, 0]], [['hp', 60, 0.7, 0], ['peak', 2200, 1.2, 2], ['lp', 4000, 0.8, 0]]][type];
    for (let c = 0; c < 2; c++) for (let k = 0; k < 3; k++) b[off + c * 3 + k].set(T[k][0], T[k][1], T[k][2], T[k][3], sr);
  }
  process(L, R, n, p, x) {
    const v = this.v, sr = this.sr, st = !this.mono, b = this.b; this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    const k1 = p.amp | 0, k2 = p.lcut || 0, k3 = p.fs || 0, k4 = p.prelpf | 0, k5 = p.spk | 0, kv = this.kv || (this.kv = new Float64Array(5).fill(NaN));
    if (kv[0] !== k1 || kv[1] !== k2 || kv[2] !== k3 || kv[3] !== k4 || kv[4] !== k5) {
      kv[0] = k1; kv[1] = k2; kv[2] = k3; kv[3] = k4; kv[4] = k5;
      if (v === 'amp') this.cab(p.amp | 0, 0);
      if (v === 'od' || v === 'odw') { const f = 20 * Math.pow(40, (p.lcut || 0) / 10); b[6].set('hp', f, 0.707, 0, sr); b[7].set('hp', f, 0.707, 0, sr); this.cab(3, 0); }
      if (v === 'deci') { const f = Math.min(sr * 0.45, (p.fs || 12000) * 0.45); b[6].set('lp', f, 0.707, 0, sr); b[7].set('lp', f, 0.707, 0, sr); b[8].set('lp', f, 0.707, 0, sr); b[9].set('lp', f, 0.707, 0, sr); }
    }
    if (v === 'amp') {
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], il = st ? dl : (dl + dr) * 0.5, ir = st ? dr : il;
        const yl = b[2].run(b[1].run(b[0].run(Math.tanh(il * 2.2) * 0.6))), yr = st ? b[5].run(b[4].run(b[3].run(Math.tanh(ir * 2.2) * 0.6))) : yl;
        { const y1_ = yl, y2_ = yr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (il) * A_ + y1_ * W_; R[i] = (ir) * A_ + y2_ * W_; } }
      }
    } else if (v === 'od' || v === 'odw') {
      const hg = (p.mode | 0) === 1, dr0 = p.drive === undefined ? 40 : p.drive, g = hg ? 2 + dr0 * 3 : 1 + dr0 * 0.45, ol = (p.outl === undefined ? 25 : p.outl) / 50 * 0.6, dm = (p.direct || 0) / 50;
      const wah = v === 'odw' && p.wah === 1, ctl = FXL.src(x, p.wahSrc | 0), spk = v === 'od' || p.spk !== 0, kd = FXL.k(hg ? 3000 : 6000, sr);
      const ch = st ? 2 : 1;
      const wf = 350 * Math.pow(7, Math.max(0, Math.min(1, Math.abs(ctl)))), wg = Math.tan(Math.PI * wf / sr), wa1 = 1 / (1 + wg * (wg + 0.2)), wa2 = wg * wa1, wa3 = wg * wa2;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], i0 = st ? dl : (dl + dr) * 0.5;
        let o0 = 0, o1 = 0;
        for (let c = 0; c < ch; c++) {
          const inp = c ? dr : i0;
          let s = b[6 + c].run(inp);
          if (wah) {
            const k = 0.2, a1 = wa1, a2 = wa2, a3 = wa3, sv = this.sv;
            const v3 = s - sv[c * 2 + 1], v1 = a1 * sv[c * 2] + a2 * v3, v2 = sv[c * 2 + 1] + a2 * sv[c * 2] + a3 * v3; sv[c * 2] = 2 * v1 - sv[c * 2]; sv[c * 2 + 1] = 2 * v2 - sv[c * 2 + 1]; s = v1 * k * 3;
          }
          let y = Math.tanh(s * g + 0.12) - 0.1194;
          if (hg) { this.s[c + 2] += 0.02 * (y - this.s[c + 2]); y = Math.tanh((y - this.s[c + 2]) * 3); }
          this.s[c] += kd * (y - this.s[c]); y = this.s[c];
          if (spk) y = b[2 + c * 3].run(b[1 + c * 3].run(b[c * 3].run(y)));
          if (c) o1 = y * ol + inp * dm; else o0 = y * ol + inp * dm;
        }
        if (!st) o1 = o0;
        { const y1_ = o0, y2_ = o1; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (i0) * A_ + y1_ * W_; R[i] = (st ? dr : i0) * A_ + y2_ * W_; } }
      }
    } else if (v === 'deci') {
      const inc = Math.min(1, (p.fs || 12000) / sr), pre = p.prelpf !== 0, kh = FXL.hdK(p.hd, sr), bits = Math.max(4, Math.min(24, p.res || 24)), q = Math.pow(2, bits - 1), qi = 1 / q;
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], il = st ? dl : (dl + dr) * 0.5, ir = st ? dr : il;
        const fl = pre ? b[6].run(il) : il, fr = pre ? b[7].run(ir) : ir;
        this.dph += inc; if (this.dph >= 1) { this.dph -= 1; this.hold[0] = bits < 24 ? Math.round(fl * q) * qi : fl; this.hold[1] = bits < 24 ? Math.round(fr * q) * qi : fr; }
        this.s[0] += kh * (this.hold[0] - this.s[0]); this.s[1] += kh * (this.hold[1] - this.s[1]);
        { const y1_ = this.s[0], y2_ = st ? this.s[1] : this.s[0]; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (il) * A_ + y1_ * W_; R[i] = (ir) * A_ + y2_ * W_; } }
      }
    }
    for (const q of b) q.flush(); for (let k = 0; k < 8; k++) if (!(Math.abs(this.s[k]) > 1e-20)) this.s[k] = 0; for (let k = 0; k < 4; k++) if (!(Math.abs(this.sv[k]) > 1e-20)) this.sv[k] = 0;
  }
}

// ---------------- pitch shifters ----------------
class FxPitch extends FxBase {
  constructor(sr, e) {
    super(sr, e); const N = Math.ceil(1.12 * sr) + 8;
    this.d = [new FXDL(N), new FXDL(N), new FXDL(N), new FXDL(N)]; this.pp = new Float64Array(4); this.fb = new Float64Array(4); this.lp = new Float64Array(4);
    this.xo = [new FXBQ(), new FXBQ(), new FXBQ(), new FXBQ()]; this.xoKey = -1;
  }
  // two crossfaded read heads sweeping through a window of W samples (a classic delay-line pitch shifter)
  shift(c, r, W, base) {
    let ph = this.pp[c] + (1 - r) / W; ph -= Math.floor(ph); this.pp[c] = ph;
    const ph2 = ph + 0.5 - (ph >= 0.5 ? 1 : 0), line = this.d[c];
    const s1 = Math.sin(Math.PI * ph), s2 = Math.sin(Math.PI * ph2);
    return line.tap(base + ph * W) * s1 * s1 + line.tap(base + ph2 * W) * s2 * s2;
  }
  process(L, R, n, p, x) {
    const v = this.v, sr = this.sr, st = !this.mono; this.mixSet(p); const MS_ = this.master, G_ = this.G, A_ = this.A, W_ = this.W;
    const mode = p.mode === undefined ? 1 : p.mode | 0, W = (v === 'detune' ? 0.03 : [0.08, 0.04, 0.02][mode] || 0.04) * sr;
    const base = 1 + (p.delay || 0) * sr / 1000, fbk = Math.max(-1, Math.min(1, (p.fb || 0) / 100)) * 0.95, kh = FXL.hdK(p.hd, sr);
    const semis = v === 'detune' || v === 'psmod' ? (p.cents || 0) / 100 : (p.shift || 0) + (p.fine || 0) / 100;
    let rL = Math.pow(2, semis / 12), rR = v === 'detune' || (v === 'stpitch' && p.updown === 1) ? Math.pow(2, -semis / 12) : rL;
    const sp = p.spread === undefined ? 1 : p.spread / 100, s0 = (1 + sp) * 0.5, s1 = (1 - sp) * 0.5;
    if (v === 'pitch2') {
      const f = 100 * Math.pow(60, (Math.max(1, p.split || 40) - 1) / 99);
      if (f !== this.xoKey) { this.xoKey = f; this.xo[0].set('lp', f, 0.707, 0, sr); this.xo[1].set('hp', f, 0.707, 0, sr); this.xo[2].set('lp', f, 0.707, 0, sr); this.xo[3].set('hp', f, 0.707, 0, sr); }
      const rl = Math.pow(2, ((p.lowShift || 0) + (p.lowFine || 0) / 100) / 12), bal = (p.balance === undefined ? 50 : p.balance) / 50, gl = Math.min(1, 2 - bal), gh = Math.min(1, bal);
      for (let i = 0; i < n; i++) {
        const dl = L[i], dr = R[i], m = (dl + dr) * 0.5;
        this.d[0].push(this.xo[0].run(m)); this.d[1].push(this.xo[1].run(m));
        const lo = this.shift(0, rl, W, base) * gl, hi = this.shift(1, rL, W, base) * gh;
        { const y1_ = lo * s0 + hi * s1, y2_ = hi * s0 + lo * s1; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
      }
      for (const b of this.xo) b.flush();
      return;
    }
    const inc = (p.lfoF || 1) / sr, dep = (p.depth || 0) / 100, pan = v === 'psmod' ? (p.pan === undefined ? 50 : p.pan) / 100 : 0.5;
    for (let i = 0; i < n; i++) {
      const dl = L[i], dr = R[i], m = (dl + dr) * 0.5, il = st ? dl : m, ir = st ? dr : m;
      if (v === 'psmod') {
        this.ph += inc; if (this.ph >= 1) this.ph -= 1;
        const u = (p.wave | 0) === 1 ? (this.ph < 0.5 ? 1 : -1) : 1 - 4 * Math.abs(this.ph - 0.5);
        rL = Math.pow(2, semis * dep * u / 12); rR = Math.pow(2, -semis * dep * u / 12);
      }
      this.d[0].push(il + this.lp[0] * fbk); if (st || v === 'detune' || v === 'psmod') this.d[1].push(ir + this.lp[1] * fbk);
      let yl = this.shift(0, rL, W, base), yr = st || v === 'detune' || v === 'psmod' ? this.shift(1, rR, W, base) : yl;
      this.lp[0] += kh * (yl - this.lp[0]); this.lp[1] += kh * (yr - this.lp[1]);
      if (v === 'psmod') { yl *= Math.min(1, 2 - 2 * pan); yr *= Math.min(1, 2 * pan); }
      else if (st && sp < 1) { const a = yl; yl = a * s0 + yr * s1; yr = yr * s0 + a * s1; }
      if (!st) { const q = v === 'detune' || v === 'psmod' ? (yl + yr) * 0.5 : yl; { const y1_ = q, y2_ = q; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (m) * A_ + y1_ * W_; R[i] = (m) * A_ + y2_ * W_; } } }
      else { const y1_ = yl, y2_ = yr; if (MS_) { L[i] = y1_ * G_; R[i] = y2_ * G_; } else { L[i] = (dl) * A_ + y1_ * W_; R[i] = (dr) * A_ + y2_ * W_; } }
    }
    for (let k = 0; k < 4; k++) if (!(Math.abs(this.lp[k]) > 1e-20)) this.lp[k] = 0;
  }
}

// ---------------- the effect section: insert chain, IFX pan/width/sends, two master effects, master EQ ----------------
class FxRack {
  constructor(sr) {
    this.sr = sr; this.ins = []; this.mu = [null, null];
    // x: what the effects can read — dynamic-modulation sources (Trinity order 0 None ... 25 Tempo), last note, note-on count, microphone
    this.x = { src: new Float64Array(40), note: 60, vel: 0.8, trig: 0, mic: null };
    this.eq = [new FXBQ(), new FXBQ(), new FXBQ(), new FXBQ()]; this.eqK = new Float64Array(4).fill(NaN);
    this.grow(128); this.faults = 0; this.load = [];
    this.pt = new WeakMap(); this.insOn = []; this.muOn = [false, false];
  }
  // a slot saved by an older version (or pasted in) may lack parameters: fill them from the catalog once per slot/type
  fill(s) {
    const p = s.p || (s.p = {});
    if (this.pt.get(p) === s.type) return p;
    const d = TFX.defaults(s.type); for (const k in d) if (p[k] === undefined || p[k] === null) p[k] = d[k];
    this.pt.set(p, s.type); return p;
  }
  grow(n) { this.cap = n; this.aL = new Float32Array(n); this.aR = new Float32Array(n); this.bL = new Float32Array(n); this.bR = new Float32Array(n); }
  static make(sr, e) {
    switch (e.core) {
      case 'delay': return new FxDelay(sr, e);
      case 'reverb': return new FxReverb(sr, e);
      case 'mod': return new FxMod(sr, e);
      case 'phaser': return new FxPhaser(sr, e);
      case 'trem': return new FxTrem(sr, e);
      case 'rot': return new FxRot(sr, e);
      case 'filt': return new FxFilt(sr, e);
      case 'eq': return new FxEQ(sr, e);
      case 'dyn': return new FxDyn(sr, e);
      case 'drive': return new FxDrive(sr, e);
      case 'pitch': return new FxPitch(sr, e);
    }
    return null;
  }
  unit(arr, i, id, asMaster) {
    let u = arr[i];
    if (!u || u.id !== id) { const e = TFX.byId(id); u = arr[i] = e ? FxRack.make(this.sr, e) : null; if (u && asMaster) u.master = true; }
    if (u) u.x = this.x;
    return u;
  }
  reset() { this.ins = []; this.mu = [null, null]; this.insOn = []; this.muOn = [false, false]; for (const b of this.eq) b.reset(); }
  process(L, R, n, fx) {
    if (!fx || !Array.isArray(fx.ins)) return;
    if (n > this.cap) this.grow(n);
    const x = this.x, list = fx.ins;
    let any = false;
    // insert effects, in series
    for (let i = 0; i < list.length && i < 8; i++) {
      const s = list[i];
      if (!s || !s.type) { this.ins[i] = null; continue; }
      any = true;
      if (s.on && !this.insOn[i]) this.ins[i] = null; // switched (back) on: start with empty delay lines
      this.insOn[i] = !!s.on;
      const u = this.unit(this.ins, i, s.type);
      if (!u) continue;
      if (s.on) u.process(L, R, n, this.fill(s), x);
      else if (u.mono) for (let k = 0; k < n; k++) { const m = (L[k] + R[k]) * 0.5; L[k] = m; R[k] = m; } // a bypassed size-1 effect still passes mono
    }
    if (this.ins.length > list.length) this.ins.length = list.length;
    // pan and width after the inserts; the sends come from here when inserts are used, from the program otherwise
    let s1, s2;
    if (any || fx.ifxRoute) {
      const pan = fx.ifxPan === undefined || fx.ifxPan < 0 ? 64 : fx.ifxPan, w = Math.max(0, Math.min(1, (fx.ifxWidth === undefined ? 127 : fx.ifxWidth) / 127));
      const gl = pan <= 64 ? 1 : (127 - pan) / 63, gr = pan >= 64 ? 1 : pan / 64;
      if (gl !== 1 || gr !== 1 || w !== 1) for (let k = 0; k < n; k++) { const m = (L[k] + R[k]) * 0.5, sd = (L[k] - R[k]) * 0.5 * w; L[k] = (m + sd) * gl; R[k] = (m - sd) * gr; }
      s1 = (fx.ifxSend1 || 0) / 127; s2 = (fx.ifxSend2 || 0) / 127;
    } else { s1 = (fx.send1 || 0) / 127; s2 = (fx.send2 || 0) / 127; }
    this.master(L, R, n, fx, null, null, s1, s2);
  }
  // master effects: mono in, stereo out, send/return; Master Effect 1 can cascade into Master Effect 2.
  // The send buses are the output times s1/s2, or (combinations) the given mono buses b1/b2.
  master(L, R, n, fx, b1, b2, s1, s2) {
    if (n > this.cap) this.grow(n);
    const x = this.x;
    const m1 = fx.m1, m2 = fx.m2, on1 = !!(m1 && m1.on && m1.type), on2 = !!(m2 && m2.on && m2.type);
    if (on1 && !this.muOn[0]) this.mu[0] = null; if (on2 && !this.muOn[1]) this.mu[1] = null;
    this.muOn[0] = on1; this.muOn[1] = on2;
    const u1 = on1 ? this.unit(this.mu, 0, m1.type, true) : null;
    const u2 = on2 ? this.unit(this.mu, 1, m2.type, true) : null;
    if (u1 || u2) {
      const aL = this.aL, aR = this.aR, bL = this.bL, bR = this.bR;
      if (b1) for (let k = 0; k < n; k++) { aL[k] = aR[k] = b1[k]; bL[k] = b2[k]; }
      else for (let k = 0; k < n; k++) { const m = (L[k] + R[k]) * 0.5; aL[k] = aR[k] = m * s1; bL[k] = m * s2; }
      if (u1) {
        u1.process(aL, aR, n, this.fill(m1), x);
        const r = (m1.ret === undefined ? 127 : m1.ret) / 127, cas = !!m1.cascade && !!u2, cl = m1.casLvl === undefined ? r : m1.casLvl / 127;
        for (let k = 0; k < n; k++) { L[k] += aL[k] * r; R[k] += aR[k] * r; if (cas) bL[k] += (aL[k] + aR[k]) * 0.5 * cl; }
      }
      if (u2) {
        for (let k = 0; k < n; k++) bR[k] = bL[k];
        u2.process(bL, bR, n, this.fill(m2), x);
        const r = (m2.ret === undefined ? 127 : m2.ret) / 127;
        for (let k = 0; k < n; k++) { L[k] += bL[k] * r; R[k] += bR[k] * r; }
      }
    }
    // master EQ: low and high shelving
    const lo = fx.eqLo || 0, hi = fx.eqHi || 0;
    if (lo || hi) {
      // gentle-slope shelves; Korg does not publish the Trinity's master EQ corner frequencies, so these are estimates
      const fl = fx.eqLoF || 80, fh = fx.eqHiF || 12000, ek = this.eqK;
      if (ek[0] !== lo || ek[1] !== hi || ek[2] !== fl || ek[3] !== fh) { ek[0] = lo; ek[1] = hi; ek[2] = fl; ek[3] = fh; this.eq[0].set('ls', fl, 0.5, lo, this.sr); this.eq[1].set('ls', fl, 0.5, lo, this.sr); this.eq[2].set('hs', fh, 0.5, hi, this.sr); this.eq[3].set('hs', fh, 0.5, hi, this.sr); }
      for (let k = 0; k < n; k++) { L[k] = this.eq[2].run(this.eq[0].run(L[k])); R[k] = this.eq[3].run(this.eq[1].run(R[k])); }
      for (const b of this.eq) b.flush();
    }
    // a runaway or broken state never reaches the speakers: silence the block and rebuild the effects
    let chk = 0; for (let k = 0; k < n; k += 7) chk += L[k] + R[k];
    if (!(chk === chk) || chk === Infinity || chk === -Infinity) { L.fill(0); R.fill(0); this.reset(); this.faults++; }
  }
}
if (typeof module !== 'undefined') module.exports = { FXDL, FXBQ, FXL, FxBase, FxDelay, FxReverb, FxMod, FxPhaser, FxTrem, FxRot, FxFilt, FxEQ, FxDyn, FxDrive, FxPitch, FxRack };
