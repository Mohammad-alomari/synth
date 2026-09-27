// ===== Trinity combinations =====
// A combination layers or splits up to 8 timbres. Each timbre plays one program (PCM bank A-D, or MOSS bank M on a
// V3 Trinity) through an engine of its own, running "dry"; the combination then adds its own effects: up to 8 insert
// effect blocks shared out as chains (korgCombiChains in korg.js) and the two master effects with the master EQ.
// Per timbre: MIDI channel (only GLOBAL and channel 1 answer the keyboard), level, pan (or the program's), sends (or
// the program's), transpose, detune, bend range, key zone and velocity zone with their fade slopes, Hide OSC 2,
// Force Poly, Delay start (a timbre's note starts that long after the key; "key off" = when the key is released) and
// the MIDI filters (damper, aftertouch, control change; program change is not used by this page).
// Not modelled: a timbre's own scale (all timbres use the combination's scale).
class MossCombi {
  constructor(host) {
    this.host = host; this.sr = host.sr; this.patch = null;
    this.parts = []; this.racks = []; this.cfx = []; this.master = new FxRack(host.sr);
    this.held = new Map(); // key -> [[timbre, note sent], ...]
    this.clock = 0; this.pending = []; // delayed timbre notes: { at (sample), key, k, n, v, kk, off }
    this.grow(128);
  }
  grow(n) {
    this.cap = n; this.pl = new Float32Array(n); this.pr = new Float32Array(n); this.s1 = new Float32Array(n); this.s2 = new Float32Array(n);
    this.cL = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Float32Array(n)); this.cR = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Float32Array(n));
  }
  // the timbre's program with the combination's overrides applied
  static timbrePatch(t) {
    const p = t.p;
    if (t.bend !== null && t.bend !== undefined) {
      if (p.kind === 'pcm') for (const O of p.o) { O.pitch.jsUp = t.bend; O.pitch.jsDown = -t.bend; }
      else if (p.voice) { p.voice.bendUp = t.bend; p.voice.bendDown = -t.bend; }
    }
    if (t.hideOsc2 && p.kind === 'pcm' && p.mode === 'double') p.mode = 'single';
    if (t.forcePoly && p.voice) p.voice.mode = 'poly';
    return p;
  }
  // does timbre t answer the keyboard (INT or BOTH, on the global channel)?
  static plays(t) { return !!t && !!t.p && (t.status === 'int' || t.status === 'both') && (t.ch === 16 || t.ch === 0); }
  setPatch(C) {
    this.patch = C;
    const T = C.timbres || [], live = T.filter(MossCombi.plays).length || 1;
    for (let k = 0; k < 8; k++) {
      const t = T[k]; let e = this.parts[k];
      if (!t || !t.p || t.status === 'off') { if (e) { e.handle({ t: 'panic' }); e.patch = null; } continue; }
      if (!e) {
        e = this.parts[k] = new MossEngine(this.sr); e.dry = true;
        e.store = this.host.store; e.tuneCents = this.host.tuneCents; // one sample store and one tuning for all timbres
      }
      e.handle({ t: 'patch', p: MossCombi.timbrePatch(t) });
      // the Trinity's voices are shared by all timbres: 32 PCM voices (16 in Double mode), 6 MOSS voices
      e.vcap = t.p.kind === 'pcm' ? Math.max(4, Math.floor(32 / live)) : 6;
    }
    (C.chains || []).forEach((ch, c) => {
      this.racks[c] = this.racks[c] || new FxRack(this.sr);
      this.cfx[c] = { ins: ch.blocks.map(k => C.blocks[k]).filter(Boolean), ifxPan: ch.pan, ifxWidth: ch.width, ifxSend1: 0, ifxSend2: 0, m1: null, m2: null };
    });
    this.cfx.length = (C.chains || []).length;
  }
  stop() { for (const e of this.parts) if (e) e.handle({ t: 'panic' }); this.held.clear(); this.pending = []; }
  // MIDI filters: does timbre t receive this controller message? (older stored combinations have no filter fields)
  static receives(t, m) {
    if (!t) return true;
    if (m.t === 'at') return t.rxAT !== 0;
    if (m.t === 'cc') return m.c >= 120 || (m.c === 64 ? t.rxDamper !== 0 : t.rxCC !== 0);
    return true;
  }
  handle(m) {
    const P = this.patch;
    switch (m.t) {
      case 'patch': this.stop(); this.setPatch(m.p); this.host.patch = m.p; break;
      case 'set': { // a combination setting (timbre level, pan ... or an effect): applied to the stored combination
        const ks = m.path.split('.'); let o = P; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = m.v;
        if (ks[0] === 'timbres' && ['bend', 'hideOsc2', 'forcePoly', 'status', 'ch'].includes(ks[2])) this.setPatch(P);
        break;
      }
      case 'on': this.noteOn(m.n, m.v, m.k); break;
      case 'off': this.noteOff(m.n); break;
      case 'panic': this.stop(); break;
      default: { const T = P ? P.timbres : []; this.parts.forEach((e, k) => { if (e && e.patch && MossCombi.receives(T[k], m)) e.handle(m); }); } // controllers, through each timbre's MIDI filters
    }
  }
  // key and velocity zones: 0 outside, 1 inside, fading in over the slope at each edge
  static zone(x, lo, hi, sLo, sHi) {
    if (x < lo || x > hi) return 0;
    let f = 1;
    if (sLo > 0 && x < lo + sLo) f = Math.min(f, (x - lo + 1) / (sLo + 1));
    if (sHi > 0 && x > hi - sHi) f = Math.min(f, (hi - x + 1) / (sHi + 1));
    return f;
  }
  noteOn(note, vel, key) {
    const P = this.patch; if (!P || vel <= 0) return this.noteOff(note);
    if (this.held.has(note)) this.noteOff(note);
    const sent = [];
    P.timbres.forEach((t, k) => {
      const e = this.parts[k];
      if (!e || !e.patch || !MossCombi.plays(t)) return;
      const f = MossCombi.zone(note, t.keyBot, t.keyTop, t.keySlopeBot || 0, t.keySlopeTop || 0) * MossCombi.zone(vel, t.velBot, t.velTop, t.velSlopeBot || 0, t.velSlopeTop || 0);
      const n = note + (t.transpose || 0);
      if (f <= 0 || n < 0 || n > 127) return;
      const v = Math.max(1, Math.round(vel * f)), kk = key === undefined || key === null ? undefined : key + (t.transpose || 0), d = t.delay || 0;
      if (d < 0) { this.pending.push({ at: Infinity, key: note, k, n, v, kk, off: true }); return; } // plays when the key is released
      if (d > 0) this.pending.push({ at: this.clock + d / 1000 * this.sr, key: note, k, n, v, kk });
      else e.handle({ t: 'on', n, v, k: kk });
      sent.push(k, n);
    });
    this.held.set(note, sent);
  }
  noteOff(note) {
    // a delayed note whose key is released before its delay has passed does not sound; key-off timbres start now
    // and are released after KEYOFF_S (estimate)
    const kept = [];
    for (const p of this.pending) {
      if (p.key !== note || p.rel) kept.push(p);
      else if (p.off) { p.at = this.clock; p.rel = this.clock + MossCombi.KEYOFF_S * this.sr; kept.push(p); }
    }
    this.pending = kept;
    const s = this.held.get(note); if (!s) return;
    for (let i = 0; i < s.length; i += 2) { const e = this.parts[s[i]]; if (e && e.patch) e.handle({ t: 'off', n: s[i + 1] }); }
    this.held.delete(note);
  }
  static get KEYOFF_S() { return 0.25; }
  // starts delayed notes that are due (at block start: within 3 ms)
  runPending(n) {
    const now = this.clock + n, kept = [];
    for (const p of this.pending) {
      const e = this.parts[p.k];
      if (p.at < now && !p.on) { if (e && e.patch) e.handle({ t: 'on', n: p.n, v: p.v, k: p.kk }); p.on = true; if (!p.rel) continue; }
      if (p.rel !== undefined && p.on && p.rel < now) { if (e && e.patch) e.handle({ t: 'off', n: p.n }); continue; }
      kept.push(p);
    }
    this.pending = kept; this.clock = now;
  }
  voiceStates() {
    const a = [];
    for (const e of this.parts) if (e && e.patch) { const m = e.maxV(); for (let i = 0; i < m; i++) { const v = e.voices[i]; if (v.active) a.push(v.gate ? 2 : 1); } }
    while (a.length < 32) a.push(0);
    return a.slice(0, 32);
  }
  process(outL, outR, n, mic) {
    outL.fill(0); outR.fill(0);
    const P = this.patch, H = this.host; if (!P) return;
    if (n > this.cap) this.grow(n);
    if (this.pending.length) this.runPending(n); else this.clock += n;
    const pl = this.pl, pr = this.pr, s1 = this.s1, s2 = this.s2, chains = P.chains || [];
    s1.fill(0, 0, n); s2.fill(0, 0, n);
    const cUsed = []; for (let c = 0; c < chains.length; c++) { cUsed.push(false); this.cL[c].fill(0, 0, n); this.cR[c].fill(0, 0, n); }
    P.timbres.forEach((t, k) => {
      const e = this.parts[k];
      if (!e || !e.patch) return;
      let busy = false; for (const v of e.voices) if (v.active) { busy = true; break; }
      if (!busy) return;
      e.tuneRef = H.tuneRef + (t.detune || 0) / 100;
      e.process(pl, pr, n, null);
      const g = Math.pow((t.level === undefined ? 127 : t.level) / 127, 2);
      if (typeof t.pan === 'number' && t.pan >= 0) { // the timbre's pan replaces the program's
        const gl = (t.pan <= 64 ? 1 : (127 - t.pan) / 63) * g, gr = (t.pan >= 64 ? 1 : t.pan / 64) * g;
        for (let i = 0; i < n; i++) { const m = (pl[i] + pr[i]) * 0.5; pl[i] = m * gl; pr[i] = m * gr; }
      } else if (g !== 1) for (let i = 0; i < n; i++) { pl[i] *= g; pr[i] *= g; }
      const c = t.chain === undefined ? -1 : t.chain;
      if (c >= 0 && c < chains.length) {
        const L = this.cL[c], R = this.cR[c]; cUsed[c] = true;
        for (let i = 0; i < n; i++) { L[i] += pl[i]; R[i] += pr[i]; }
        return;
      }
      const pf = e.patch.fx || {}, a = (t.send1 === 'prog' ? pf.send1 || 0 : t.send1 || 0) / 127, b = (t.send2 === 'prog' ? pf.send2 || 0 : t.send2 || 0) / 127;
      for (let i = 0; i < n; i++) { outL[i] += pl[i]; outR[i] += pr[i]; const m = (pl[i] + pr[i]) * 0.5; s1[i] += m * a; s2[i] += m * b; }
    });
    // effect modulation sources come from the host's controllers and the keys held in the combination
    H.held = [...this.held.keys()]; H.fxSources(); H.fx.x.mic = mic || null;
    chains.forEach((ch, c) => {
      // chains run even when their timbres are silent, so delay and reverb tails ring out
      const L = this.cL[c], R = this.cR[c], rk = this.racks[c]; rk.x = H.fx.x;
      rk.process(L, R, n, this.cfx[c]);
      const a = ch.send1 / 127, b = ch.send2 / 127;
      for (let i = 0; i < n; i++) { outL[i] += L[i]; outR[i] += R[i]; const m = (L[i] + R[i]) * 0.5; s1[i] += m * a; s2[i] += m * b; }
    });
    // layered timbres add up: the combination sits 3 dB below a single program (estimate)
    for (let i = 0; i < n; i++) { outL[i] *= 0.708; outR[i] *= 0.708; s1[i] *= 0.708; s2[i] *= 0.708; }
    this.master.x = H.fx.x;
    this.master.master(outL, outR, n, P.fx || {}, s1, s2, 0, 0);
    H.limit(outL, outR, n);
  }
}
if (typeof module !== 'undefined') module.exports = { MossCombi };
