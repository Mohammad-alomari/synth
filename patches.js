// ===== Patch model (mirrors the MOSS program structure) =====
function mossOscDefaults() {
  return {
    // Standard
    wave: 'saw', level: 99, edge: 99, tri: 0, sine: 0, phase: 0, wform: 0, wfLfo: 'lfo2', wfInt: 0,
    shIn: 50, shType: 'clip', shOffset: 0, shShape: 0, shBal: 0,
    // Comb filter
    cIn: 'osc', cLevel: 0, cNoise: 99, cPw: 20, cFb: 85, cDamp: 20,
    // VPM
    vCar: 'sine', vCarLvl: 99, vShape: 0, vType: 1, vFb: 0, vMod: 'sine', vModLvl: 40, vRatio: 1, vFine: 0,
    // Resonance
    rIn: 'noise', rLevel: 99,
    r0Lvl: 99, r0Harm: 1, r0Fine: 0, r0Reso: 80,
    r1Lvl: 70, r1Harm: 2, r1Fine: 0, r1Reso: 80,
    r2Lvl: 50, r2Harm: 3, r2Fine: 0, r2Reso: 80,
    r3Lvl: 35, r3Harm: 5, r3Fine: 0, r3Reso: 80,
    // Ring / Cross / Sync
    mIn: 'sub', mCar: 'saw', mEdge: 99, mDepth: 60, mType: 1,
    // Bowed string (double size)
    bwSpdEg: 'amp', bwSpdInt: 60, bwDiff: 0, bwPrsEg: 'amp', bwPrsInt: 80, bwRosin: 40, bwPos: 12, bwDamp: 45, bwDampKey: 60, bwDampLo: 0, bwDampHi: 0, bwDisp: 40, bwRefl: 95, bwEqF: 20, bwEqQ: 10, bwEqG: 0,
    // Reed (double size)
    rdType: 5, rdPrsEg: 'amp', rdPrsInt: 75, rdNoise: 15, rdHpf: 25, rdHpfReso: 10, rdEqF: 25, rdEqQ: 10, rdEqG: 0, rdWsOff: 0, rdWsTable: 'clip', rdWsShape: 15,
    // Plucked string (double size)
    plAtk: 90, plAtkVel: 40, plUp: 40, plUpVel: 0, plDn: 90, plDnVel: 0, plNoise: 25, plNoiseVel: 0, plPos: 25, plDisp: 5, plDamp: 50, plDampKt: 0, plDecay: 70, plDecayKt: 20, plRel: 30,
    plHarm: 0, plPickup: 1, plPickPos: 30, plEqF: 10, plEqG: 0, plBoost: 20,
    // Organ: three drawbars (harmonic 1 = one octave below the oscillator), percussion
    og0Wave: 0, og0Harm: 2, og0Fine: 0, og0Lvl: 99, og0Perc: 0,
    og1Wave: 0, og1Harm: 4, og1Fine: 0, og1Lvl: 60, og1Perc: 0,
    og2Wave: 0, og2Harm: 6, og2Fine: 0, og2Lvl: 0, og2Perc: 60, ogTrig: 0, ogDecay: 45,
    // E.Piano: hammer, tone generator (tine), pickup, low EQ
    epForce: 60, epCurve: 40, epWidth: 60, epClick: 30, epDecay: 70, epRel: 40, epOtL: 40, epOtF: 88, epOtD: 35, epPos: 45, epEqF: 30, epEqG: 3,
    // Brass (double size)
    brType: 0, brJump: 0, brPrsEg: 'amp', brPrsInt: 90, brLip: 50, brBell: 10, brBellRes: 10, brNoise: 8, brEqF: 25, brEqQ: 10, brEqG: 0, brStr: 0
  };
}
function mossOsc(type) {
  return { type: type || 'standard', octave: 0, transpose: 0, tune: 0, foffset: 0, slopeCenter: 60, slopeLow: 1, slopeHigh: 1, p: mossOscDefaults() };
}
const MOSS_LFOMOD = { fm1: 'off', fm1Int: 0, fm2: 'off', fm2Int: 0, am: 'off', amInt: 0, msync: 0, mbase: 4, mtimes: 0 };
const MOSS_EGMOD = { lvlSrc: 'off', lvlInt: 0, tSrc: 'off', tInt: 0, nSrc: 'off', nAt: 0, nDc: 0, nSl: 0, nRl: 0 };
function mossEG(o) { return Object.assign({ startL: 0, atkL: 99, brkL: 60, susL: 30, relL: 0, atkT: 0, decT: 40, slpT: 55, relT: 45, vel: 0, velTime: 0 }, MOSS_EGMOD, o || {}); }
function mossFilter(o) { return Object.assign({ type: 'lpf', trimA: 80, trimB: 80, freqA: 70, resoA: 10, freqB: 60, resoB: 10, eg: 'eg1', egInt: 20, keyLow: 60, keyHigh: 60, rampLow: -25, rampHigh: 25 }, o || {}); }
function mossDefaultPatch() {
  return {
    name: 'Init Program',
    voice: { mode: 'poly', priority: 'last', maxVoices: 6, unison: 1, uniDetune: 20, random: 0, porta: 0, portaTime: 30, portaFingered: 0, bendUp: 2, bendDown: -2, hold: 0, tempo: 120 },
    osc: [mossOsc('standard'), mossOsc('standard')],
    sub: { wave: 'saw', octave: 0, transpose: 0, tune: 0, foffset: 0 },
    noise: { ftype: 'thru', trim: 99, freq: 99, reso: 0 },
    mix: [{ osc1: 99, osc2: 0, sub: 0, noise: 0, fb: 0 }, { osc1: 0, osc2: 0, sub: 0, noise: 0, fb: 0 }],
    filt: { routing: 'parallel', link: 0 },
    f: [mossFilter(), mossFilter()],
    amp: [{ level: 99, eg: 'amp', keyLow: 60, keyHigh: 60, rampLow: 0, rampHigh: 0 }, { level: 99, eg: 'amp', keyLow: 60, keyHigh: 60, rampLow: 0, rampHigh: 0 }],
    ampEG: Object.assign({ atkT: 0, decT: 45, slpT: 55, relT: 35, atkL: 99, brkL: 92, susL: 85, vel: 30, velTime: 0 }, MOSS_EGMOD),
    eg: [mossEG(), mossEG({ startL: 99, atkL: 99, brkL: 30, susL: 0, decT: 35 }), mossEG({ atkT: 60, brkL: 99, susL: 99 }), mossEG({ startL: 0, atkL: 99, atkT: 0, decT: 20, brkL: 0, susL: 0 })],
    lfo: [
      Object.assign({ wave: 'tri0', freq: 140, offset: 0, sync: 'voice', fade: 30 }, MOSS_LFOMOD),
      Object.assign({ wave: 'tri0', freq: 100, offset: 0, sync: 'off', fade: 0 }, MOSS_LFOMOD),
      Object.assign({ wave: 'sine', freq: 70, offset: 0, sync: 'off', fade: 0 }, MOSS_LFOMOD),
      Object.assign({ wave: 'rndsh', freq: 150, offset: 0, sync: 'voice', fade: 0 }, MOSS_LFOMOD)
    ],
    mods: [
      { src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 25 },
      { src: 'lfo1', via: 'jsyn', dst: 'fFreq', amt: 30 },
      { src: 'at', via: 'off', dst: 'fFreq', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 },
      { src: 'off', via: 'off', dst: 'off', amt: 0 }
    ],
    out: { level: 100, pan: 64 },
    fx: TFX.rack()
  };
}
function mossMerge(base, o) {
  if (Array.isArray(o)) { o.forEach((v, i) => { if (v === null || v === undefined) return; if (typeof v === 'object' && base[i] && typeof base[i] === 'object') mossMerge(base[i], v); else base[i] = v; }); return base; }
  for (const k in o) { const v = o[k]; if (v && typeof v === 'object' && base[k] && typeof base[k] === 'object') mossMerge(base[k], v); else base[k] = v; }
  return base;
}
// Effect section in the Trinity layout. Spec: { ins: [[type, params]...], send1, send2, m1: [type, params, return, cascade], m2: [type, params, return], eqLo, eqHi }
function mossFx(s) {
  const r = TFX.rack(); if (!s) return r;
  const slot = a => ({ on: 1, type: a[0], p: Object.assign(TFX.defaults(a[0]), a[1] || {}) });
  r.ins = (s.ins || []).map(slot);
  if (s.m1) r.m1 = Object.assign(slot(s.m1), { ret: s.m1[2] === undefined ? 127 : s.m1[2], pan: -1, cascade: s.m1[3] ? 1 : 0 });
  if (s.m2) r.m2 = Object.assign(slot(s.m2), { ret: s.m2[2] === undefined ? 127 : s.m2[2], pan: -1 });
  else if (s.m2 === null) r.m2.on = 0;
  r.send1 = r.ifxSend1 = s.send1 || 0; r.send2 = r.ifxSend2 = s.send2 === undefined ? r.send2 : s.send2;
  r.eqLo = s.eqLo || 0; r.eqHi = s.eqHi || 0;
  return r;
}
// Programs saved before the Trinity effects existed carry the old simple effect settings: translate them
function mossFixFx(P) { if (P && (!P.fx || !Array.isArray(P.fx.ins))) P.fx = TFX.fromLegacy(P.fx); return P; }
function mossLoad(o) {
  o = JSON.parse(JSON.stringify(o || {}));
  const raw = o.fx; delete o.fx;
  const P = mossMerge(mossDefaultPatch(), o);
  P.fx = raw && Array.isArray(raw.ins) ? Object.assign(TFX.rack(), raw) : TFX.fromLegacy(raw);
  // every effect slot gets its full parameter set (older saves or pasted JSON may lack some)
  const fill = s => { if (s && s.type && TFX.byId(s.type)) s.p = Object.assign(TFX.defaults(s.type), s.p || {}); };
  P.fx.ins = P.fx.ins.filter(s => s && s.type); P.fx.ins.forEach(fill); fill(P.fx.m1); fill(P.fx.m2);
  return P;
}
function mossMods(list) { const m = []; for (let i = 0; i < 12; i++) m.push(list[i] ? Object.assign({ via: 'off' }, list[i]) : { src: 'off', via: 'off', dst: 'off', amt: 0 }); return m; }

const MOSS_PRESETS = [
  { name: 'Init Program', out: { level: 104 } },
  { name: 'Silver Saw Lead', out: { level: 89 },
    voice: { mode: 'monoSingle', porta: 1, portaFingered: 1, portaTime: 38 },
    osc: [{ p: { wform: 12, wfLfo: 'lfo2', wfInt: 10 } }, { tune: 9, p: { wform: -8 } }],
    mix: [{ osc1: 99, osc2: 88 }],
    f: [{ freqA: 60, resoA: 38, egInt: 32 }],
    eg: [{ atkT: 0, decT: 48, brkL: 45, slpT: 62, susL: 22 }],
    ampEG: { decT: 50, brkL: 95, susL: 88, relT: 32 },
    fx: { send1: 46, send2: 34, m1: ['MM:5', { timeL: 281, timeC: 375, timeR: 563, lvlL: 40, lvlC: 30, lvlR: 40, fb: 32, hd: 30, out: 100 }], m2: ['MR:4', { time: 2.2, pd: 20, out: 90 }] } },
  { name: 'PWM Strings', out: { level: 69 },
    osc: [{ p: { wave: 'pulse', wform: 22, wfLfo: 'lfo2', wfInt: 45 } }, { tune: -7, p: { wave: 'pulse', wform: -12, wfLfo: 'lfo3', wfInt: 40 } }],
    mix: [{ osc1: 88, osc2: 88 }],
    f: [{ freqA: 68, resoA: 8, egInt: 12, eg: 'eg3' }],
    eg: [null, null, { atkT: 62, startL: 0, atkL: 99, brkL: 90, susL: 80, decT: 60, slpT: 60, relT: 55 }],
    ampEG: { atkT: 55, decT: 60, brkL: 99, slpT: 60, susL: 96, relT: 60 },
    lfo: [null, { wave: 'tri0', freq: 95, sync: 'off' }, { wave: 'tri90', freq: 88, sync: 'off' }],
    fx: { ins: [['S2:13', { lfoF: 0.42, depth: 45, pdL: 8, pdR: 12, wet: 50 }]], send2: 62, m2: ['MR:5', { time: 3.4, pd: 30, hd: 25, out: 90 }] } },
  { name: 'Sync Sweep', out: { level: 105 },
    osc: [{ type: 'sync', octave: 1, p: { mIn: 'sub', mCar: 'saw', mEdge: 95 } }],
    sub: { wave: 'saw' },
    mix: [{ osc1: 99, sub: 0 }],
    f: [{ freqA: 82, resoA: 12, egInt: 0 }],
    eg: [null, { startL: 99, atkL: 99, atkT: 0, decT: 58, brkL: 28, slpT: 64, susL: 12 }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 25 }, { src: 'eg2', dst: 'o1A', amt: 55 }, { src: 'jsyn', dst: 'o1A', amt: 40 }]),
    ampEG: { susL: 86, relT: 30 },
    fx: { send1: 40, send2: 30, m1: ['MM:5', { timeL: 250, timeC: 375, timeR: 500, lvlL: 45, lvlC: 25, lvlR: 45, fb: 25, hd: 40, out: 100 }], m2: ['MR:2', { time: 1.2, out: 90 }] } },
  { name: 'Comb Pluck Bass', out: { level: 127 },
    osc: [{ type: 'comb', octave: -1, p: { cIn: 'impulse', cLevel: 99, cPw: 8, cFb: 93, cDamp: 35 } }],
    sub: { wave: 'square', octave: -1 },
    mix: [{ osc1: 99, sub: 42 }],
    f: [{ freqA: 52, resoA: 22, egInt: 36 }],
    eg: [{ atkT: 0, decT: 42, brkL: 25, slpT: 50, susL: 0 }],
    ampEG: { atkT: 0, decT: 56, brkL: 70, slpT: 64, susL: 0, relT: 24, vel: 45 },
    fx: { send2: 18, m2: ['MR:2', { time: 0.8, hd: 40, out: 80 }] } },
  { name: 'Comb Noise Pad', out: { level: 127 },
    osc: [{ type: 'comb', p: { cIn: 'osc', cLevel: 0, cNoise: 99, cFb: 90, cDamp: 14 } }, { type: 'comb', octave: 1, tune: 6, p: { cIn: 'osc', cLevel: 0, cNoise: 99, cFb: 82, cDamp: 25 } }],
    mix: [{ osc1: 92 }, { osc2: 80 }],
    f: [{ freqA: 72, resoA: 10, egInt: 0 }, { type: 'bpf', freqA: 62, resoA: 25, egInt: 0 }],
    ampEG: { atkT: 62, decT: 60, brkL: 99, susL: 97, relT: 62 },
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 25 }, { src: 'lfo3', dst: 'f2Freq', amt: 14 }, { src: 'lfo2', dst: 'o1A', amt: 6 }]),
    fx: { send1: 30, send2: 72, m1: ['MM:5', { timeL: 420, timeC: 630, timeR: 540, lvlL: 40, lvlC: 30, lvlR: 40, fb: 30, hd: 50, out: 100 }, 110, 1], m2: ['MR:5', { time: 4.2, pd: 40, hd: 30, out: 90 }] } },
  { name: 'VPM Tine Keys', out: { level: 112 },
    osc: [{ type: 'vpm', p: { vCar: 'sine', vMod: 'sine', vRatio: 1, vModLvl: 12 } }, { type: 'vpm', p: { vCar: 'sine', vMod: 'sine', vRatio: 14, vModLvl: 0 } }],
    mix: [{ osc1: 99, osc2: 50 }],
    f: [{ freqA: 92, resoA: 0, egInt: 0 }],
    eg: [{ startL: 99, atkL: 99, atkT: 0, decT: 52, brkL: 22, slpT: 62, susL: 0, vel: 55 }, { startL: 99, atkL: 99, atkT: 0, decT: 30, brkL: 0, slpT: 30, susL: 0, vel: 40 }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 20 }, { src: 'eg1', dst: 'o1A', amt: 42 }, { src: 'eg2', dst: 'o2A', amt: 62 }]),
    ampEG: { atkT: 0, decT: 62, brkL: 60, slpT: 72, susL: 0, relT: 42, vel: 45 },
    fx: { ins: [['S2:20', { lfoF: 0.35, manual: 45, depth: 55, reso: 25, wet: 50, spread: 80 }]], send2: 42, m2: ['MR:6', { time: 1.8, pd: 15, hd: 30, out: 85 }] } },
  { name: 'Glass Bell', out: { level: 114 },
    osc: [{ type: 'vpm', p: { vCar: 'sine', vMod: 'sine', vRatio: 5, vFine: 45, vModLvl: 20 } }, { octave: 1, p: { level: 0, sine: 70 } }],
    mix: [{ osc1: 99, osc2: 40 }],
    f: [{ freqA: 95, resoA: 0, egInt: 0 }],
    eg: [{ startL: 99, atkL: 99, atkT: 0, decT: 64, brkL: 30, slpT: 78, susL: 0, vel: 50 }],
    mods: mossMods([{ src: 'eg1', dst: 'o1A', amt: 40 }]),
    ampEG: { atkT: 0, decT: 68, brkL: 50, slpT: 80, susL: 0, relT: 66, vel: 40 },
    fx: { send1: 22, send2: 64, m1: ['MM:5', { timeL: 330, timeC: 500, timeR: 440, lvlL: 40, lvlC: 25, lvlR: 40, fb: 20, hd: 45, out: 100 }], m2: ['MR:6', { time: 3.6, pd: 25, hd: 20, out: 90 }] } },
  { name: 'Resonance Glass Pad', out: { level: 127 },
    osc: [{ type: 'reso', p: { rIn: 'noise', r0Reso: 90, r1Reso: 88, r2Reso: 86, r3Reso: 84 } },
          { type: 'reso', p: { rIn: 'noise', r0Harm: 4, r1Harm: 6, r2Harm: 8, r3Harm: 10, r0Lvl: 70, r1Lvl: 55, r2Lvl: 45, r3Lvl: 35, r0Reso: 88, r1Reso: 88, r2Reso: 88, r3Reso: 88 } }],
    mix: [{ osc1: 99, osc2: 72 }],
    f: [{ freqA: 88, resoA: 0, egInt: 0 }],
    lfo: [null, null, null, { wave: 'ssaw4', freq: 95, sync: 'off' }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 20 }, { src: 'lfo4', dst: 'o2A', amt: 14 }]),
    ampEG: { atkT: 56, decT: 60, brkL: 99, susL: 97, relT: 64 },
    fx: { send1: 34, send2: 78, m1: ['MM:5', { timeL: 315, timeC: 420, timeR: 525, lvlL: 45, lvlC: 30, lvlR: 45, fb: 38, hd: 55, out: 100 }, 100, 1], m2: ['MR:5', { time: 4.8, pd: 50, hd: 30, out: 90 }] } },
  { name: 'Ring Mod Bell', out: { level: 127 },
    osc: [{ type: 'ring', p: { mIn: 'osc', mCar: 'sine', mDepth: 99, mType: 1 } }, { octave: 1, transpose: 5, tune: 13, p: { level: 0, sine: 99 } }],
    mix: [{ osc1: 99, osc2: 0 }],
    f: [{ freqA: 90, resoA: 0, egInt: 0 }],
    ampEG: { atkT: 0, decT: 66, brkL: 40, slpT: 76, susL: 0, relT: 60, vel: 40 },
    fx: { send2: 58, m2: ['MR:4', { time: 3.0, pd: 25, hd: 25, out: 90 }] } },
  { name: 'Cross Mod Bass', out: { level: 100 },
    voice: { mode: 'monoMulti' },
    osc: [{ type: 'cross', octave: -1, p: { mIn: 'sub', mCar: 'saw', mDepth: 45, mEdge: 88 } }],
    sub: { wave: 'sine', octave: -1 },
    mix: [{ osc1: 99, sub: 30 }],
    f: [{ freqA: 56, resoA: 30, egInt: 34 }],
    eg: [{ atkT: 0, decT: 40, brkL: 30, slpT: 50, susL: 10 }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 20 }, { src: 'eg1', dst: 'o1A', amt: 30 }]),
    ampEG: { susL: 90, relT: 20 },
    fx: { ins: [['S1:1', { sens: 45, atk: 20, outl: 60, wet: 100 }]], send2: 14, m2: ['MR:2', { time: 0.7, hd: 40, out: 80 }] } },
  { name: 'Formant Choir', out: { level: 124 },
    osc: [{ p: { wform: 10, wfLfo: 'lfo2', wfInt: 20 } }, { tune: 10, p: { wform: -10 } }],
    mix: [{ osc1: 90, osc2: 90 }],
    f: [{ type: 'dbpf', freqA: 46, freqB: 70, resoA: 62, resoB: 58, egInt: 0, rampLow: 0, rampHigh: 0 }],
    lfo: [null, { wave: 'tri0', freq: 70, sync: 'off' }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 22 }, { src: 'lfo2', dst: 'fFreq', amt: 8 }, { src: 'jsyn', dst: 'fFreq', amt: 20 }]),
    ampEG: { atkT: 38, decT: 55, brkL: 99, susL: 95, relT: 48 },
    fx: { ins: [['S2:16', { speed: 35, depth: 55, shimmer: 35, wet: 55 }]], send2: 60, m2: ['MR:5', { time: 3.2, pd: 35, hd: 25, out: 90 }] } },
  { name: 'Reso Shaper Lead', out: { level: 81 },
    voice: { mode: 'monoSingle', porta: 1, portaFingered: 1, portaTime: 30 },
    osc: [{ p: { shIn: 55, shShape: 30, shBal: 75, shType: 'reso' } }],
    mix: [{ osc1: 99, fb: 50 }],
    f: [{ freqA: 74, resoA: 22, egInt: 18 }],
    eg: [{ atkT: 0, decT: 50, brkL: 40, slpT: 60, susL: 25 }, { startL: 99, atkL: 99, decT: 50, brkL: 30, susL: 10 }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 25 }, { src: 'eg2', dst: 'o1B', amt: 30 }, { src: 'jsyn', dst: 'o1B', amt: 45 }]),
    ampEG: { susL: 90, relT: 30 },
    fx: { ins: [['S1:4', { mode: 0, drive: 30, outl: 26, lcut: 2, wet: 60 }]], send1: 40, send2: 30, m1: ['MM:5', { timeL: 300, timeC: 450, timeR: 600, lvlL: 40, lvlC: 25, lvlR: 40, fb: 30, hd: 45, out: 100 }], m2: ['MR:4', { time: 2.0, out: 85 }] } },
  { name: 'Serial Filter Bass', out: { level: 87 },
    voice: { mode: 'monoMulti' },
    filt: { routing: 'serial1' },
    osc: [{ octave: -1, p: { wave: 'pulse', wform: 30 } }, { octave: -1, tune: -6 }],
    mix: [{ osc1: 90, osc2: 80 }],
    f: [{ freqA: 38, resoA: 62, egInt: 48 }, { type: 'hpf', freqA: 12, resoA: 5, egInt: 0, rampLow: 0, rampHigh: 0 }],
    eg: [{ atkT: 0, decT: 44, brkL: 20, slpT: 50, susL: 5, vel: 40 }],
    ampEG: { decT: 55, brkL: 85, slpT: 60, susL: 70, relT: 18 },
    fx: { send2: 12, m2: ['MR:2', { time: 0.6, hd: 45, out: 80 }] } },
  { name: 'Talking Saw Lead', out: { level: 96 },
    voice: { mode: 'monoSingle', porta: 1, portaFingered: 1, portaTime: 28 },
    osc: [{ p: { wform: 0 } }, { tune: 7, p: { wform: 0 } }],
    mix: [{ osc1: 99, osc2: 80 }],
    f: [{ freqA: 88, resoA: 5, egInt: 0 }],
    mods: mossMods([{ src: 'lfo1', via: 'at', dst: 'pitch', amt: 22 }]),
    ampEG: { atkT: 4, decT: 50, brkL: 99, susL: 94, relT: 30 },
    fx: { ins: [['S2:11', { manual: 0, src: 8, bottom: 2, center: 4, top: 0, shift: 0, reso: 70, wet: 100 }], ['S2:13', { lfoF: 0.5, depth: 30, pdL: 9, pdR: 13, wet: 35 }]],
      send1: 44, send2: 40, m1: ['MM:5', { timeL: 340, timeC: 510, timeR: 680, lvlL: 45, lvlC: 25, lvlR: 45, fb: 30, hd: 40, out: 100 }], m2: ['MR:5', { time: 2.6, pd: 30, out: 90 }] },
    help: 'Push the joystick up (JS +Y) to open the vowels U, O, A.' },
  { name: 'Vowel Ribbon Pad', out: { level: 88 },
    osc: [{ p: { wave: 'pulse', wform: 20, wfLfo: 'lfo2', wfInt: 35 } }, { tune: -8, p: { wform: 0 } }],
    mix: [{ osc1: 90, osc2: 85 }],
    f: [{ freqA: 80, resoA: 5, egInt: 0 }],
    lfo: [null, { wave: 'tri0', freq: 80, sync: 'off' }],
    ampEG: { atkT: 50, decT: 60, brkL: 99, susL: 96, relT: 58 },
    fx: { ins: [['S2:11', { manual: 50, src: 11, bottom: 1, center: 3, top: 0, shift: -10, reso: 55, wet: 90 }], ['S2:16', { speed: 30, depth: 50, shimmer: 30, wet: 50 }]],
      send2: 70, m2: ['MR:5', { time: 4.5, pd: 45, hd: 25, out: 90 }] },
    help: 'Slide on the ribbon to move the voice between I, E and A.' },
  { name: 'Tine Electric Piano', out: { level: 100 },
    osc: [{ type: 'epiano', p: { epForce: 55, epCurve: 60, epWidth: 62, epClick: 25, epDecay: 80, epRel: 35, epOtL: 45, epOtF: 90, epOtD: 30, epPos: 38, epEqF: 28, epEqG: 4 } }],
    mix: [{ osc1: 99, osc2: 0 }],
    f: [{ freqA: 99, resoA: 0, egInt: 0, rampLow: 0, rampHigh: 0 }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 15 }]),
    ampEG: { atkT: 0, decT: 99, brkL: 99, slpT: 99, susL: 99, relT: 45, vel: 25 },
    fx: { ins: [['S2:27', { wave: 1, phase: 180, lfoF: 4.2, depth: 45, wet: 100 }]], send2: 30, m2: ['MR:6', { time: 1.6, pd: 10, hd: 35, out: 80 }] },
    help: 'E.Piano model: play harder for a brighter bark. The stereo tremolo is insert effect 1.' },
  { name: 'Percussive Drawbars', out: { level: 96 },
    osc: [{ type: 'organ', p: { og0Wave: 2, og0Harm: 1, og0Lvl: 95, og0Perc: 0, og1Wave: 0, og1Harm: 4, og1Lvl: 45, og1Perc: 0, og2Wave: 0, og2Harm: 6, og2Lvl: 0, og2Perc: 75, ogTrig: 0, ogDecay: 38 } }],
    mix: [{ osc1: 99, osc2: 0 }],
    f: [{ freqA: 99, resoA: 0, egInt: 0, rampLow: 0, rampHigh: 0 }],
    mods: mossMods([]),
    ampEG: { atkT: 0, decT: 0, brkL: 99, slpT: 0, susL: 99, relT: 8, vel: 0 },
    fx: { ins: [['S1:4', { mode: 0, drive: 12, outl: 60, lcut: 2, wet: 35 }], ['S2:36', { fast: 0, acc: 45, balance: 55, mic: 35, wet: 100, spdSrc: 8 }]], send2: 22, m2: ['MR:2', { time: 1.0, hd: 35, out: 80 }] },
    help: 'Organ model: 16\u2032 with 8\u2032 and 5\u2153\u2032 (Sine 3), 4\u2032, and single-trigger 2\u2154\u2032 percussion. Push the joystick up (JS +Y) for the fast rotor.' },
  { name: 'Brass Section', out: { level: 104 },
    voice: { unison: 2, uniDetune: 14 },
    osc: [{ type: 'brass', p: { brType: 1, brPrsEg: 'eg1', brPrsInt: 99, brLip: 40, brBell: 14, brBellRes: 20, brNoise: 10, brEqF: 30, brEqQ: 8, brEqG: 3, brStr: 8 } }],
    mix: [{ osc1: 99, osc2: 0 }],
    f: [{ freqA: 96, resoA: 0, egInt: 0, rampLow: 0, rampHigh: 0 }],
    eg: [{ startL: 0, atkT: 20, atkL: 99, decT: 42, brkL: 78, slpT: 60, susL: 72, relT: 30, relL: 0, vel: 45 }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 20 }, { src: 'vel', dst: 'o1B', amt: 30 }, { src: 'at', dst: 'o1A', amt: 25 }]),
    ampEG: { atkT: 4, decT: 60, brkL: 99, slpT: 60, susL: 99, relT: 30, vel: 20 },
    fx: { send2: 45, m2: ['MR:4', { time: 2.2, pd: 25, hd: 30, out: 85 }] },
    help: 'Brass model: EG 1 is the breath pressure. Velocity firms the lips; aftertouch blows harder.' },
  { name: 'Mijwiz Daraa (Do)', out: { level: 106 },
    // Hauran double clarinet: two cane pipes with idioglot single reeds, a little out of tune with each other so they
    // beat; played without a break (circular breathing). Mijwiz in Do, maqam Bayati: Re a quarter tone flat.
    voice: { mode: 'monoSingle', priority: 'last', unison: 2, uniDetune: 12, porta: 0, bendUp: 2, bendDown: -2 },
    scale: { type: 'user', key: 0, user: [0, 0, -50, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    osc: [{ type: 'reed', p: { rdType: 8, rdPrsEg: 'amp', rdPrsInt: 92, rdNoise: 22, rdHpf: 34, rdHpfReso: 15, rdEqF: 36, rdEqQ: 9, rdEqG: 10, rdWsTable: 'reso', rdWsShape: 55, rdWsOff: 15 } }],
    noise: { ftype: 'bpf', trim: 99, freq: 80, reso: 10 },
    mix: [{ osc1: 99, osc2: 0, sub: 0, noise: 0, fb: 0 }],
    f: [{ freqA: 92, resoA: 0, egInt: 0, rampLow: 0, rampHigh: 0, trimA: 80 }],
    amp: [{ level: 99 }, { level: 0 }],
    ampEG: { atkT: 8, atkL: 99, decT: 30, brkL: 99, slpT: 40, susL: 99, relT: 18, vel: 15 },
    lfo: [{ wave: 'sine', freq: 144, sync: 'voice', fade: 25, offset: 0 }, { wave: 'square', freq: 160, sync: 'voice', fade: 0, offset: 50 }, null, { wave: 'rndvec', freq: 150, sync: 'voice', fade: 0, offset: 0 }],
    mods: mossMods([{ src: 'lfo1', via: 'jsy', dst: 'o1A', amt: 14 }, { src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 8 }, { src: 'lfo2', via: 'jsyn', dst: 'pitch', amt: 35 },
      { src: 'lfo4', dst: 'o1A', amt: 3 }, { src: 'at', dst: 'o1A', amt: 15 }]),
    fx: { send2: 38, m2: ['MR:2', { time: 1.3, pd: 14, hd: 35, out: 82 }] },
    help: 'Mijwiz in Do, maqam Bayati (Re is a quarter tone flat). The two pipes beat against each other. Joystick up: breath vibrato. Joystick down: a fast finger trill a 3/4 tone up. Aftertouch blows harder.' },
  { name: 'Rababa Bedouin (Do)', out: { level: 76 },
    // Bedouin rababa: one string of horsehair over a small frame covered with goat or gazelle skin, bowed with a horsehair bow.
    // String: a steady Helmholtz stroke bowed near the lower end (these bow settings lock the same way on every note);
    // EG1 gives the bow a firm start and settles its speed, so each stroke speaks quickly.
    voice: { mode: 'monoSingle', priority: 'last', unison: 1, porta: 1, portaFingered: 1, portaTime: 33, bendUp: 2, bendDown: -2 },
    scale: { type: 'user', key: 0, user: [0, 0, -50, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    osc: [{ type: 'bowed', p: { bwSpdEg: 'eg1', bwSpdInt: 99, bwPrsEg: 'amp', bwPrsInt: 70, bwRosin: 15, bwPos: 13, bwDamp: 30, bwDampKey: 60, bwDampLo: 0, bwDampHi: 0,
      bwDisp: 10, bwRefl: 92, bwEqF: 28, bwEqQ: 9, bwEqG: 9 } }],
    // horsehair on horsehair: a band of bow noise (~3.7 kHz), a scratch as the bow catches (EG2), grain from a fast random LFO
    noise: { ftype: 'bpf', trim: 99, freq: 74, reso: 10 },
    mix: [{ osc1: 99, osc2: 0, sub: 0, noise: 50, fb: 0 }, { osc1: 0, osc2: 0, sub: 0, noise: 0, fb: 0 }],
    // skin body (fixed, not key-tracked): the lowest membrane mode (~300 Hz for a ~19 x 26 cm goat skin) as a resonant
    // high-pass, the skin radiates little below it; the bridge-driven nasal formant (~1.2 kHz) is the bowed model's EQ;
    // damping of skin and hair above ~5 kHz
    filt: { routing: 'serial1', link: 0 },
    f: [{ type: 'hpf', freqA: 39, resoA: 50, egInt: 0, rampLow: 0, rampHigh: 0, trimA: 80 }, { type: 'lpf', freqA: 80, resoA: 15, egInt: 0, rampLow: 0, rampHigh: 0, trimA: 80 }],
    amp: [{ level: 99 }, { level: 0 }],
    ampEG: { atkT: 6, atkL: 99, decT: 30, brkL: 99, slpT: 40, susL: 99, relT: 52, vel: 20 },
    eg: [{ startL: 0, atkT: 10, atkL: 99, decT: 50, brkL: 75, slpT: 55, susL: 70, relT: 34, relL: 0, vel: 0 },
      { startL: 99, atkT: 0, atkL: 99, decT: 42, brkL: 0, slpT: 0, susL: 0, relT: 0, relL: 0, vel: 40 }],
    lfo: [{ wave: 'sine', freq: 144, sync: 'voice', fade: 52, offset: 0 }, { wave: 'square', freq: 160, sync: 'voice', fade: 0, offset: 50 },
      { wave: 'rndsh', freq: 176, sync: 'off', fade: 0, offset: 0 }, { wave: 'rndvec', freq: 146, sync: 'off', fade: 0, offset: 0 }],
    mods: mossMods([{ src: 'eg2', dst: 'm1noise', amt: 25 }, { src: 'lfo3', dst: 'm1noise', amt: 12 }, { src: 'lfo4', dst: 'pitch', amt: 5 },
      { src: 'lfo1', dst: 'pitch', amt: 6 }, { src: 'lfo1', via: 'jsy', dst: 'pitch', amt: 13 }, { src: 'lfo2', via: 'jsyn', dst: 'pitch', amt: 35 },
      { src: 'at', dst: 'o1A', amt: 25 }, { src: 'at', dst: 'm1noise', amt: 15 }]),
    // skin body, insert EQ: fundamental below the lowest mode held back, the gap between membrane modes (~600 Hz) that the
    // centred bridge does not drive, presence (~2.7 kHz). A small tent-like room.
    fx: { ins: [['S1:5', { trim: 100, t1: 1, f1: 280, q1: 1, g1: -6, f2: 600, q2: 2, g2: -7, f3: 2700, q3: 2, g3: 6, t4: 0, f4: 1200, q4: 1.5, g4: 0, wet: 100 }]],
      send2: 28, m2: ['MR:2', { time: 0.9, pd: 8, hd: 55, out: 82 }] },
    help: 'Rababa in Do (the open string, middle C), maqam Bayati: Re is a quarter tone flat. The tone is nasal and raspy, with a weak fundamental, as on the skin-covered Bedouin rababa. Play legato for finger slides; release and replay a note for a new bow stroke. Joystick up: deeper finger vibrato. Joystick down: finger trill a 3/4 tone up. Aftertouch bows faster and rougher.' }
];
function mossPreset(i) { const pr = MOSS_PRESETS[i] || MOSS_PRESETS[0]; const o = JSON.parse(JSON.stringify(pr)); const fxs = o.fx; delete o.fx; const p = mossMerge(mossDefaultPatch(), o); p.fx = mossFx(fxs || { send2: 30 }); return p; }
if (typeof module !== 'undefined') module.exports = { mossDefaultPatch, mossPreset, MOSS_PRESETS, mossMerge, mossFx, mossFixFx, mossLoad };

