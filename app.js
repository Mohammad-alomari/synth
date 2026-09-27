(() => {
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const clone = o => JSON.parse(JSON.stringify(o));
const SVGNS = 'http://www.w3.org/2000/svg';
const ENGINE_CLASSES = [MD, MossEG, MossLFO, MossVoice, TFX, FXDL, FXBQ, FXL, FxBase, FxDelay, FxReverb, FxMod, FxPhaser, FxTrem, FxRot, FxFilt, FxEQ, FxDyn, FxDrive, FxPitch, FxRack, PCM, PcmEG, PcmLFO, PcmStore, PcmVoice, MossCombi, MossEngine];

// ---------------- persistence ----------------
const LS_USER = 'moss-user-programs', LS_CUR = 'moss-current';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
};
let userBank = store.get(LS_USER, []); if (!Array.isArray(userBank)) userBank = [];
let prog = { bank: 'st', idx: 0 }, patch = mossPreset(0), edited = false;
const saved = store.get(LS_CUR, null);
if (saved && saved.patch) { try { patch = loadAny(saved.patch); prog = saved.prog || prog; edited = !!saved.edited; } catch (e) { patch = mossPreset(0); } }
// a stored program: MOSS programs are merged onto the default patch; Trinity PCM programs are kept as they are
function loadAny(p) { return p && (p.kind === 'pcm' || p.kind === 'combi') ? clone(p) : mossLoad(p); }
let saveT = 0;
function saveCurrent() { clearTimeout(saveT); saveT = setTimeout(() => store.set(LS_CUR, { patch, prog, edited }), 300); }

// ---------------- Trinity PCG banks ----------------
const LS_PCG = 'moss-pcg', MAX_IMPORTED = 8;
const b64dec = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const b64enc = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const pcgBanks = []; // { name, scale, bytes, n, rs, builtin, names, fmt: 'trinity' | 'triton' }
// rs: record size, 521 (Trinity layout) or 716 (Triton: Trinity layout + the Triton effect section)
function addPcgBank(name, scale, bytes, builtin, fmt, rs) {
  rs = rs || 521;
  const n = Math.floor(bytes.length / rs), names = [];
  for (let i = 0; i < n; i++) names.push(korgName(bytes.subarray(i * rs, i * rs + 16)) || 'Untitled');
  pcgBanks.push({ name, scale: scale || new Array(12).fill(0), bytes, n, rs, builtin, names, fmt: fmt || 'trinity' });
}
(typeof MOSS_PCG_BUILTIN !== 'undefined' ? MOSS_PCG_BUILTIN : []).forEach(b => addPcgBank(b.name, b.scale, b64dec(b.m), true, b.fmt, b.rs));
(x => Array.isArray(x) ? x : [])(store.get(LS_PCG, [])).forEach(b => { try { addPcgBank(b.name, b.scale, b64dec(b.m), false, b.fmt, b.rs); } catch (e) {} });
function savePcgBanks() { return store.set(LS_PCG, pcgBanks.filter(b => !b.builtin).map(b => ({ name: b.name, scale: b.scale, fmt: b.fmt, rs: b.rs, m: b64enc(b.bytes) }))); }
const bankLetter = b => b && b.fmt === 'triton' ? 'F' : 'M';
function pcgPatch(idx) {
  const b = pcgBanks[Math.floor(idx / 128)], i = idx % 128;
  if (!b || i >= b.n) return null;
  const P = korgDecodeMoss(b.bytes.subarray(i * b.rs, (i + 1) * b.rs), b.scale, b.fmt);
  P.korgInfo.source = b.name + ', Bank ' + bankLetter(b) + ' ' + String(i).padStart(3, '0');
  return P;
}
// ---------------- Trinity PCM programs, drum kits and combinations (built-in files + imported PCGs) ----------------
// A set is one PCG file: its PCM banks (A-D, 128 x 433 bytes), its drum kits and its combination banks.
const LS_TRI = 'moss-tri';
const triSets = [], pcmBanks = [], combiBanks = []; // flat lists of { set, letter, bytes, names }; ids 'pc:' / 'cb:' + (index * 128 + number)
const pad3 = n => String(n).padStart(3, '0');
function addTriSet(name, scale, pcm, kitBytes, combis, builtin) {
  const set = { name, scale: scale || new Array(12).fill(0), kitBytes, kits: null, combis: combis || [], builtin };
  triSets.push(set);
  for (const b of pcm) {
    const names = []; for (let i = 0; i < 128; i++) names.push(korgName(b.bytes.subarray(i * 433, i * 433 + 16)) || 'Untitled');
    pcmBanks.push({ set, letter: b.letter, bytes: b.bytes, names });
  }
  for (const b of set.combis) {
    const names = []; for (let i = 0; i < 128; i++) names.push(korgName(b.bytes.subarray(i * 388, i * 388 + 16)) || 'Untitled');
    combiBanks.push({ set, letter: b.letter, bytes: b.bytes, names });
  }
  return set;
}
function kitsOf(set) { if (!set.kits) { set.kits = []; const B = set.kitBytes || new Uint8Array(0); for (let o = 0; o + 1426 <= B.length; o += 1426) set.kits.push(korgDecodeKit(B.subarray(o, o + 1426))); } return set.kits; }
function triFromFile(name, bytes, builtin) { // a whole Trinity PCG -> set
  const S = korgTrinitySections(bytes); if (!S.ok || (!S.pcm.length && !S.kits.length)) return null;
  const cat = recs => { const rs = recs[0].length, u = new Uint8Array(recs.length * rs); recs.forEach((r, i) => u.set(r, i * rs)); return u; };
  const kitBytes = S.kits.length ? cat(S.kits) : null;
  return addTriSet(name, S.userScale, S.pcm.map(b => ({ letter: b.bank, bytes: cat(b.recs) })), kitBytes, S.combis.map(b => ({ letter: b.bank, bytes: cat(b.recs) })), builtin);
}
(typeof TRI_BUILTIN !== 'undefined' ? TRI_BUILTIN : []).forEach(t => addTriSet(t.name, t.scale, t.pcm.map(b => ({ letter: b.bank, bytes: b64dec(b.m) })), t.kits ? b64dec(t.kits) : null, t.combis.map(b => ({ letter: b.bank, bytes: b64dec(b.m) })), true));
(x => Array.isArray(x) ? x : [])(store.get(LS_TRI, [])).forEach(t => { try { triFromFile(t.name, b64dec(t.m), false); } catch (e) {} });
function pcmPatch(idx) {
  const b = pcmBanks[Math.floor(idx / 128)], i = idx % 128;
  if (!b) return null;
  const P = korgDecodePcm(b.bytes.subarray(i * 433, (i + 1) * 433), b.set.scale);
  if (P.mode === 'drum') P.kitData = kitsOf(b.set)[P.kit] || null;
  P.korgInfo.source = b.set.name + ', Bank ' + b.letter + ' ' + String(i).padStart(3, '0');
  return P;
}
// a combination with each timbre's program attached (t.p): banks A-D are the file's PCM banks, bank 4 its Bank M
// (MOSS, Trinity V3); a Solo-TRI Bank S is not modelled, so such a timbre stays silent
function timbreProgram(set, t) {
  t.p = null; t.pId = ''; t.pLabel = ('ABCD'[t.bank] || (t.bank === 4 ? 'M' : '?')) + pad3(t.prog);
  if (t.bank <= 3) { const bi = pcmBanks.findIndex(x => x.set === set && x.letter === 'ABCD'[t.bank]); if (bi >= 0) { t.p = pcmPatch(bi * 128 + t.prog); t.pId = 'pc:' + (bi * 128 + t.prog); } }
  else if (t.bank === 4) { const mi = pcgBanks.findIndex(x => x.name === set.name && x.fmt !== 'triton'); if (mi >= 0) { t.p = pcgPatch(mi * 128 + t.prog); t.pId = 'pm:' + (mi * 128 + t.prog); } else t.pLabel = 'S' + pad3(t.prog); }
  if (t.p) delete t.p.korg; // the raw bytes are not needed inside a combination
  t.pName = t.p ? t.p.name : '';
}
function combiPatch(idx) {
  const b = combiBanks[Math.floor(idx / 128)], i = idx % 128;
  if (!b) return null;
  const C = korgDecodeCombi(b.bytes.subarray(i * 388, (i + 1) * 388), b.set.scale);
  C.timbres.forEach(t => { if (t.status !== 'off') timbreProgram(b.set, t); else { t.p = null; t.pLabel = ('ABCD'[t.bank] || 'M') + pad3(t.prog); t.pName = ''; } });
  C.voice = { hold: 0 }; C.out = { level: 127 }; delete C.korg;
  C.korgInfo.source = b.set.name + ', Combination ' + b.letter + pad3(i);
  return C;
}
// an unedited program is reloaded from its source, so it picks up anything newer (such as its decoded effects)
if (!edited) { try { const P = prog.bank === 'pm' ? pcgPatch(prog.idx) : prog.bank === 'pc' ? pcmPatch(prog.idx) : prog.bank === 'cb' ? combiPatch(prog.idx) : prog.bank === 'st' ? mossPreset(prog.idx) : null; if (P) patch = P; } catch (e) {} }
async function importPcgFile(file) {
  let buf;
  try { buf = await file.arrayBuffer(); } catch (e) { toast('Could not read that file'); return; }
  const bytes = new Uint8Array(buf), r = korgParsePCG(bytes);
  if (!r.ok) { status(r.error); toast('Not imported: ' + r.error); return; }
  const name = file.name.replace(/\.pcg$/i, '');
  if (r.fmt === 'triton') {
    if (!r.bankM.length) { status(name + ': this Triton-family file has no MOSS (bank F) programs.' + (r.pcmPrograms ? ' Its ' + r.pcmPrograms + ' PCM programs need the Triton\u2019s samples.' : '')); toast('No MOSS programs in ' + name); return; }
  }
  if (pcgBanks.filter(b => !b.builtin).length + triSets.filter(t => !t.builtin).length >= MAX_IMPORTED) { toast('Remove an imported bank first (limit ' + MAX_IMPORTED + ')'); return; }
  const got = [];
  let first = null;
  if (r.bankM.length) {
    const rs = r.bankM[0].length, mb = new Uint8Array(r.bankM.length * rs); r.bankM.forEach((rec, i) => mb.set(rec, i * rs));
    addPcgBank(name, r.userScale, mb, false, r.fmt, rs);
    if (!savePcgBanks()) { pcgBanks.pop(); toast('Browser storage is full; the bank was not kept'); return; }
    got.push(r.bankM.length + (r.fmt === 'triton' ? ' MOSS (bank F)' : ' Bank M') + ' programs'); first = ['pm', (pcgBanks.length - 1) * 128];
  }
  if (r.fmt !== 'triton' && (r.pcmPrograms || r.drumKits)) {
    const before = pcmBanks.length, set = triFromFile(name, bytes, false);
    if (set) {
      const kept = store.get(LS_TRI, []); kept.push({ name, m: b64enc(bytes) });
      if (!store.set(LS_TRI, kept)) { toast('Browser storage is full: the PCM banks play now but are not kept'); }
      const nb = pcmBanks.length - before;
      if (nb) { got.push(nb * 128 + ' PCM programs (banks ' + pcmBanks.slice(before).map(b => b.letter).join('') + ')'); if (!first) first = ['pc', before * 128]; }
      if (set.kitBytes) got.push(Math.floor(set.kitBytes.length / 1426) + ' drum kits');
      if (set.combis.length) got.push(set.combis.length * 128 + ' combinations');
    }
  }
  if (!got.length) { status(name + ': nothing this synth can play' + (r.bankS ? ' (it has a Bank S for the SOLO-TRI board, not supported yet)' : '') + '.'); toast('Nothing imported from ' + name); return; }
  fillProgSelect(); if (first) loadProgram(first[0], first[1]);
  status('Imported from ' + name + ': ' + got.join(', ') + '.' + (r.bankS ? ' Its Bank S (SOLO-TRI) is not supported yet.' : ''));
  toast('Imported ' + name);
}

// ---------------- audio ----------------
let ctx = null, node = null, analyser = null, starting = null, fallbackEng = null, graphReady = false, audioMode = '', unlockEl = null, voiceTimer = 0, userPaused = false;
let micSrc = null, micStream = null;
// the Vocoder's modulator: a microphone feeds the engine's input (the vocoder falls back to its own input without one)
let micBusy = false;
async function setMic(on) {
  if (micBusy) return !!micStream;
  if (!on || micStream) {
    if (micSrc) { try { micSrc.disconnect(); } catch (e) {} micSrc = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (!on) return false;
  }
  micBusy = true;
  try {
    if (!ctx || !graphReady) await startAudio();
    if (!ctx || !node) return false;
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    micSrc = ctx.createMediaStreamSource(micStream); micSrc.connect(node);
    return true;
  } catch (e) { toast('No microphone: ' + ((e && (e.name || e.message)) || 'not allowed here')); if (micStream) micStream.getTracks().forEach(t => t.stop()); micStream = null; micSrc = null; return false; }
  finally { micBusy = false; }
}
let send = () => {};
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SILENT_WAV = 'data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
function workletSource() {
  return ENGINE_CLASSES.map(c => c.toString()).join('\n') + `
class MossProc extends AudioWorkletProcessor {
  constructor() { super(); this.e = new MossEngine(sampleRate); this.c = 0; this.err = 0; this.R = new Float32Array(128);
    this.port.onmessage = ev => { try { this.e.handle(ev.data); } catch (x) { this.port.postMessage({ t: 'err', m: String(x && x.message || x) }); } }; }
  process(ins, outs) {
    const o = outs[0]; if (!o || !o[0]) return true;
    const L = o[0], n = L.length;
    let R = o[1]; if (!R) { if (this.R.length < n) this.R = new Float32Array(n); R = this.R; } // mono output: still render
    const mi = ins && ins[0] && ins[0][0] && ins[0][0].length === n ? ins[0][0] : null;
    try { this.e.process(L, R, n, mi); }
    catch (x) { L.fill(0); R.fill(0); if (!this.err) { this.err = 1; this.port.postMessage({ t: 'err', m: String(x && x.message || x) }); } try { this.e.handle({ t: 'panic' }); } catch (y) {} }
    if (!o[1]) for (let i = 0; i < n; i++) L[i] = (L[i] + R[i]) * 0.5;
    this.c += n;
    if (this.c >= 2400) { this.c = 0; const st = this.e.store, need = st && st.need.size ? [...st.need] : null; if (need) st.need.clear(); this.port.postMessage({ t: 'st', v: this.e.voiceStates(), need }); }
    return true;
  }
}
registerProcessor('moss', MossProc);`;
}
// ---------------- stand-in samples for Trinity PCM programs ----------------
// samples/packs.json lists the packs (one MP3 per General MIDI instrument or drum kit, mono 32 kHz); each is decoded
// here when a program first needs it and handed to the engine as zones (see PcmStore in pcm.js).
let packsReq = null, engineUp = false; const packState = {};
function packIndex() {
  if (!packsReq) packsReq = fetch('samples/packs.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(e => { status('The stand-in samples could not be loaded (' + (e && e.message || e) + '). PCM programs play a soft placeholder tone.'); return { packs: {} }; });
  return packsReq;
}
function pcmZones(meta, x) { // align on the sync click, heal each loop seam, list the zones
  let k = 0, m = 0; for (let i = 0; i < Math.min(x.length, meta.sync + meta.search); i++) { const a = Math.abs(x[i]); if (a > m) { m = a; k = i; } }
  const off = k - meta.sync, zones = [];
  for (const [st, len, ls, le, gdb, zs] of meta.s) {
    const s0 = st + off, a = ls >= 0 ? ls + off : -1, e = le >= 0 ? le + off : -1;
    if (a > 0 && e > a) { const n = Math.min(meta.heal || 64, a, e - a); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; x[e - n + i] = x[e - n + i] * (1 - t) + x[a - n + i] * t; } }
    for (const [lo, hi, root, tune] of zs) zones.push({ lo, hi, root: root - tune / 100, rate: meta.rate, data: x, ls: a, le: e, end: s0 + len, start: s0, gain: Math.pow(10, gdb / 20) });
  }
  return zones;
}
async function loadPack(name) {
  if (packState[name] || !engineUp) return;
  packState[name] = 'loading';
  try {
    const idx = await packIndex(), meta = idx.packs[name]; if (!meta) { packState[name] = 'missing'; return; }
    const r = await fetch('samples/' + meta.file); if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer(), OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const oc = new OC(1, 1, meta.rate);
    const ab = await new Promise((res, rej) => { const q = oc.decodeAudioData(buf, res, rej); if (q && q.then) q.then(res, rej); });
    const x = new Float32Array(ab.getChannelData(0));
    send({ t: 'pcmPack', name, zones: pcmZones(meta, x) }, [x.buffer]);
    packState[name] = 'ok';
  } catch (e) { packState[name] = 'err'; status('A stand-in sample pack (' + name + ') could not be loaded: ' + (e && e.message || e)); }
}
// the packs a PCM program uses (so they load before the first note)
function packsFor(P) {
  const out = new Set(), M = PCM_STANDIN;
  if (!P || P.kind !== 'pcm') return out;
  if (P.mode === 'drum') { const K = P.kitData; out.add('kit_std'); if (K) for (const k of K.keys) for (const d of [k.hi, k.lo]) { const e = d >= 0 && M.ds[d]; if (e && e.p) out.add(e.p); } return out; }
  for (const O of P.o) for (let id of [O.msHi, O.msLo]) { if (id >= 0x1000) id = P.ramMap ? P.ramMap[id & 0xfff] || 0 : 0; const e = M.ms[id]; if (e && e.p) out.add(e.p); }
  return out;
}
function pcmPrepare(P) {
  if (!P || !engineUp) return;
  if (P.kind === 'combi') { const all = new Set(); P.timbres.forEach(t => { if (t.p && t.status !== 'off') packsFor(t.p).forEach(x => all.add(x)); }); all.forEach(loadPack); }
  else if (P.kind === 'pcm') packsFor(P).forEach(loadPack);
}
// a new engine (audio start, compatibility mode) has no packs yet
function pcmEngineReset() { for (const k in packState) delete packState[k]; send({ t: 'pcmMap', map: PCM_STANDIN }); engineUp = true; pcmPrepare(patch); }
// Must run synchronously inside a user gesture (tap, click, key): WebKit only lets audio start there.
function ensureContext() {
  // iOS 16.4+: play as media, so the Silent switch does not mute the synth
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) {}
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { status('This browser has no Web Audio support.'); return null; }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.connect(ctx.destination);
    ctx.onstatechange = () => powerUI();
  }
  if (ctx.state !== 'running' && !userPaused) {
    try { const p = ctx.resume(); if (p && p.then) p.then(powerUI, () => {}); } catch (e) {}
    // classic WebKit unlock: start a silent one-sample buffer inside the gesture
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) {}
  }
  if (IS_IOS && !navigator.audioSession && !unlockEl) {
    // older iOS: a playing media element lifts the Silent-switch mute for Web Audio
    try { unlockEl = document.createElement('audio'); unlockEl.setAttribute('playsinline', ''); unlockEl.loop = true; unlockEl.src = SILENT_WAV; const pr = unlockEl.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {}
  }
  return ctx;
}
function engineError(m) { status('Sound engine error: ' + String(m).slice(0, 140) + '. Tell Claude this message.'); }
function useScriptFallback(msg) {
  if (node) { try { node.disconnect(); } catch (e) {} if (node.port) node.port.onmessage = null; }
  audioMode = 'script';
  fallbackEng = new MossEngine(ctx.sampleRate);
  node = ctx.createScriptProcessor(1024, 1, 2);
  if (micSrc) { try { micSrc.disconnect(); micSrc.connect(node); } catch (e) {} } // the vocoder keeps its microphone
  let shown = false;
  node.onaudioprocess = e => {
    const b = e.outputBuffer, L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : new Float32Array(b.length);
    const mi = micSrc && e.inputBuffer && e.inputBuffer.numberOfChannels ? e.inputBuffer.getChannelData(0) : null;
    try { fallbackEng.process(L, R, b.length, mi); }
    catch (x) { L.fill(0); R.fill(0); if (!shown) { shown = true; engineError(x && x.message || x); } try { fallbackEng.handle({ t: 'panic' }); } catch (y) {} }
  };
  send = m => { try { fallbackEng.handle(m); } catch (x) { engineError(x && x.message || x); } };
  node.connect(analyser);
  if (!voiceTimer) voiceTimer = setInterval(() => { if (fallbackEng) { showVoices(fallbackEng.voiceStates()); const st = fallbackEng.store; if (st && st.need.size) { const n = [...st.need]; st.need.clear(); n.forEach(loadPack); } } }, 80);
  send({ t: 'patch', p: clone(patch) }); sendTuning(); pcmEngineReset();
  if (msg) status(msg);
}
function startAudio() {
  ensureContext();
  if (!ctx || graphReady) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    try {
      if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('no AudioWorklet');
      const url = URL.createObjectURL(new Blob([workletSource()], { type: 'application/javascript' }));
      // some embedded browsers never settle this when the page policy blocks it, so time out and fall back
      await Promise.race([ctx.audioWorklet.addModule(url), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      node = new AudioWorkletNode(ctx, 'moss', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      node.port.onmessage = e => { const d = e.data; if (!d) return; if (d.t === 'st') { showVoices(d.v); if (d.need) d.need.forEach(loadPack); } else if (d.t === 'err') engineError(d.m); };
      node.onprocessorerror = () => useScriptFallback('The audio worklet stopped, so the synth switched to compatibility mode.');
      send = (m, tr) => node.port.postMessage(m, tr || []);
      node.connect(analyser);
      audioMode = 'worklet';
      send({ t: 'patch', p: clone(patch) }); sendTuning(); pcmEngineReset();
    } catch (err) {
      useScriptFallback('Running in compatibility mode (higher latency).');
    }
    graphReady = true;
    window.__mossMode = audioMode; window.__mossCtx = () => ctx; window.__mossAnalyser = () => analyser;
    powerUI();
    requestAnimationFrame(drawScope);
    setTimeout(() => {
      if (!ctx) return;
      if (ctx.state !== 'running' && !userPaused) status('The browser is holding the sound back. Tap Start audio, then play.');
      else if (IS_IOS && !navigator.audioSession && !/error|compatibility/i.test($('#status').textContent)) status('No sound? Turn off Silent mode (the switch on the side of the iPhone).');
    }, 1500);
  })();
  return starting;
}
function powerUI() { const on = ctx && ctx.state === 'running'; $('#pled').classList.toggle('on', !!on); $('#ptxt').textContent = on ? 'Audio on' : (ctx ? 'Audio paused' : 'Start audio'); }
$('#power').addEventListener('click', async () => {
  if (!ctx || !graphReady) { userPaused = false; await startAudio(); powerUI(); return; }
  if (ctx.state === 'running') { userPaused = true; releaseInputs(); send({ t: 'panic' }); await ctx.suspend(); }
  else { userPaused = false; ensureContext(); }
  powerUI();
});
// Any finished tap, click or key press may start or resume audio (WebKit ignores the start of a touch)
const gestureUnlock = () => { if (userPaused) return; if (!ctx || !graphReady || ctx.state !== 'running') startAudio(); };
['pointerup', 'touchend', 'click', 'keydown'].forEach(t => window.addEventListener(t, gestureUnlock, true));
function status(t) { $('#status').textContent = t || ''; }
let toastT = 0;
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 1800); }

// ---------------- parameter access ----------------
function getP(path, obj) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj || patch); }
function setP(path, v, silent) {
  const ks = path.split('.'); let o = patch;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = v;
  if (!silent) send({ t: 'set', path, v });
  if (!edited) { edited = true; lcd(); }
  saveCurrent();
  if (/^(mix|filt|osc\.\d\.type|f\.\d\.type|sub\.wave|osc\.\d\.p\.(mIn|rIn|cIn|vMod))/.test(path)) flowSoon();
}
let flowQ = 0;
function flowSoon() { if (!flowQ) flowQ = requestAnimationFrame(() => { flowQ = 0; renderFlow(); }); }
const DEF = mossDefaultPatch();
function defaultAt(path) { return getP(path, DEF); }

// ---------------- vocabulary ----------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const RATIOS = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const DOUBLE = ['brass', 'reed', 'pluck', 'bowed'];
const F = {
  // the Trinity's own number first (as its screen shows it), then this model's reading of it in real units
  time: v => v + ' \u00b7 ' + (t => t === 0 ? '0 ms' : t < 1 ? Math.round(t * 1000) + ' ms' : t.toFixed(t < 10 ? 2 : 1) + ' s')(MD.tsec(v)),
  hz: v => v + ' \u00b7 ' + (h => h < 1000 ? Math.round(h) + ' Hz' : (h / 1000).toFixed(h < 10000 ? 2 : 1) + ' kHz')(MD.cutHz(v)),
  lfo: v => v + ' \u00b7 ' + (h => (h < 10 ? h.toFixed(2) : h.toFixed(1)) + ' Hz')(MD.lfoHz(v)),
  sgn: v => (v > 0 ? '+' : '') + v,
  oct: v => ({ '-2': "32'", '-1': "16'", '0': "8'", '1': "4'" })[v],
  note: n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1),
  ratio: i => String(RATIOS[i]),
  pan: v => v === 64 ? 'C064' : (v < 64 ? 'L' : 'R') + String(Math.round(v)).padStart(3, '0'), // as the Trinity shows it: L000 \u2026 C064 \u2026 R127
  semis: v => (v > 0 ? '+' : '') + v + ' st',
  cents: v => (v > 0 ? '+' : '') + v + ' ct',
  slope: v => (v >= 0 ? '+' : '') + Number(v).toFixed(2),
  hzOff: v => (v > 0 ? '+' : '') + Number(v).toFixed(1) + ' Hz',
  ms: v => v + ' ms', pct: v => v + '%'
};
const OSC_TYPES = [['standard', 'Standard'], ['comb', 'Comb Filter'], ['vpm', 'VPM'], ['reso', 'Resonance'], ['ring', 'Ring Modulation'], ['cross', 'Cross Modulation'], ['sync', 'Sync Modulation'],
  ['organ', 'Organ Model'], ['epiano', 'E.Piano Model'], ['brass', 'Brass Model'], ['reed', 'Reed Model'], ['pluck', 'Plucked String Model'], ['bowed', 'Bowed String Model']];
const BRASS_TYPES = ['Brass 1', 'Brass 2', 'Brass 3', 'Horn 1', 'Horn 2', 'ReedBrass'].map((n, i) => [i, n]);
const ORGAN_WAVES = [[0, 'Sine 1 (pure)'], [1, 'Sine 2 (+2nd harmonic)'], [2, 'Sine 3 (+2nd, 3rd)'], [3, 'Triangle']];
// drawbar pitch in organ footage, with the oscillator at 8' (harmonic 1 is one octave below it)
const FOOT = { 1: "16'", 2: "8'", 3: "5\u2153'", 4: "4'", 5: "3\u2155'", 6: "2\u2154'", 8: "2'", 10: "1\u2157'", 12: "1\u2153'", 16: "1'" };
const fmtHarm = h => h + ' \u00b7 ' + (FOOT[h] || (16 / h).toFixed(2) + "'");
const REED_TYPES = ['Hard Sax 1', 'Hard Sax 2', 'Hard Sax 3', 'Soft Sax 1', 'Soft Sax 2', 'Double Reed 1', 'Double Reed 2', 'Bassoon', 'Clarinet', 'Flute 1', 'Flute 2', 'Pan Flute', 'Ocarina', 'Shakuhachi', 'Harmonica 1', 'Harmonica 2', 'Reed Synth'].map((n, i) => [i, n]);
const TYPE_SHORT = { standard: 'STANDARD', comb: 'COMB', vpm: 'VPM', reso: 'RESONANCE', ring: 'RING MOD', cross: 'CROSS MOD', sync: 'SYNC MOD', organ: 'ORGAN', epiano: 'E.PIANO', brass: 'BRASS', reed: 'REED', pluck: 'PLUCKED', bowed: 'BOWED' };
const CAR_OPTS = [['saw', 'Saw'], ['square', 'Square'], ['tri', 'Triangle'], ['sine', 'Sine']];
const LFO_OPTS = [['lfo1', 'LFO 1'], ['lfo2', 'LFO 2'], ['lfo3', 'LFO 3'], ['lfo4', 'LFO 4']];
const EG_OPTS = [['eg1', 'EG 1'], ['eg2', 'EG 2'], ['eg3', 'EG 3'], ['eg4', 'EG 4'], ['amp', 'Amp EG']];
const LFO_WAVES = [['tri0', 'Triangle 0'], ['tri90', 'Triangle 90'], ['trirnd', 'Triangle random'], ['sawup0', 'Saw up 0'], ['sawup180', 'Saw up 180'], ['sawdn0', 'Saw down 0'], ['sawdn180', 'Saw down 180'], ['square', 'Square'], ['sine', 'Sine'],
  ['stri4', 'Step triangle 4'], ['stri6', 'Step triangle 6'], ['ssaw4', 'Step saw 4'], ['ssaw6', 'Step saw 6'], ['rndsh', 'Random S/H'], ['rndvec', 'Random vector'], ['expsawup', 'Exp saw up'], ['expsawdn', 'Exp saw down'], ['exptri', 'Exp triangle']];
// what each oscillator type's modulation slots control (slot 0/1 are the classic Mod A/B)
const MOD_SLOTS = { standard: ['waveform', 'shaper input', 'shaper shape', 'shaper balance'], comb: ['feedback', 'high damp', 'input level'], vpm: ['modulator level', 'wave shape', 'carrier level', 'modulator pitch'],
  reso: ['harmonic shift', 'resonance', 'input level', 'band 1 harmonic', 'band 2 harmonic', 'band 3 harmonic', 'band 4 harmonic'], ring: ['depth', 'wave edge'], cross: ['depth', 'wave edge'], sync: ['slave pitch', 'wave edge'],
  bowed: ['bow speed', 'bow pressure', 'bowing point', 'damping', 'dispersion', 'reflection'], reed: ['breath pressure', 'reed', 'wave shape'], pluck: ['pluck position', 'dispersion', 'damping', 'harmonics', 'pickup position'],
  organ: ['drawbar 1 level', 'drawbar 2 level', 'drawbar 3 level', 'percussion level'], epiano: ['pickup position'], brass: ['pressure', 'lip character'] };
// Korg's alternate modulation source list (Trinity V3 MIDI implementation table [*3])
const SRC_OPTS = [['off', 'Off'], ['eg1', 'EG 1'], ['eg2', 'EG 2'], ['eg3', 'EG 3'], ['eg4', 'EG 4'], ['ampeg', 'Amp EG'], ['lfo1', 'LFO 1'], ['lfo2', 'LFO 2'], ['lfo3', 'LFO 3'], ['lfo4', 'LFO 4'],
  ['porta', 'Portamento'], ['velS', 'Velocity (soft)'], ['vel', 'Velocity (medium)'], ['velH', 'Velocity (hard)'], ['key', 'Note number (linear)'], ['keyExp', 'Note number (exp)'], ['splitH', 'Note split high'], ['splitL', 'Note split low'],
  ['at', 'Aftertouch'], ['jsx', 'JS X (bend)'], ['jsy', 'JS +Y (CC1)'], ['jsyn', 'JS \u2212Y (CC2)'], ['atjs', 'Aftertouch + JS +Y'], ['ribbon', 'Ribbon X (CC16)'], ['ribP', 'Ribbon +X'], ['ribN', 'Ribbon \u2212X'], ['ribZ', 'Ribbon touch'],
  ['foot', 'Foot pedal (CC4)'], ['slider', 'Value slider (CC18)'], ['kn1', 'Knob 1 (CC17)'], ['cc19', 'Knob 2 / MIDI CC19'], ['kn3', 'Knob 3 (CC20)'], ['kn4', 'Knob 4 (CC21)'], ['sw1', 'SW1 (CC80)'], ['sw2', 'SW2 (CC81)'], ['fsw', 'Foot switch (CC82)'], ['cc83', 'MIDI CC83']];
function dstOpts() {
  const slots = i => { const L = MOD_SLOTS[patch.osc[i].type] || ['mod A', 'mod B']; const n = i + 1;
    return L.map((lab, k) => ['o' + n + (k === 0 ? 'A' : k === 1 ? 'B' : 'm' + k), 'OSC ' + n + ': ' + lab]); };
  return [['off', 'Off'], ['pitch', 'Pitch, all oscillators'], ['pitch1', 'OSC 1 pitch'], ['pitch2', 'OSC 2 pitch'], ['pitchSub', 'Sub OSC pitch']].concat(slots(0), slots(1), [['o1Lvl', 'OSC 1 level'], ['o2Lvl', 'OSC 2 level'],
    ['fFreq', 'Filter 1+2 cutoff'], ['f1Freq', 'Filter 1 cutoff'], ['f1Reso', 'Filter 1 resonance'], ['f1FreqB', 'Filter 1 B cutoff'], ['f1ResoB', 'Filter 1 B resonance'],
    ['f2Freq', 'Filter 2 cutoff'], ['f2Reso', 'Filter 2 resonance'], ['f2FreqB', 'Filter 2 B cutoff'], ['f2ResoB', 'Filter 2 B resonance'], ['noiseFreq', 'Noise filter cutoff'],
    ['m1o1', 'Mixer 1 OSC 1'], ['m1o2', 'Mixer 1 OSC 2'], ['m1sub', 'Mixer 1 sub'], ['m1noise', 'Mixer 1 noise'], ['m1fb', 'Mixer 1 feedback'],
    ['m2o1', 'Mixer 2 OSC 1'], ['m2o2', 'Mixer 2 OSC 2'], ['m2sub', 'Mixer 2 sub'], ['m2noise', 'Mixer 2 noise'], ['m2fb', 'Mixer 2 feedback'],
    ['amp1', 'Amp 1 level'], ['amp2', 'Amp 2 level'], ['pan', 'Pan'], ['portaTime', 'Portamento time'], ['lfo1Rate', 'LFO 1 speed'], ['lfo2Rate', 'LFO 2 speed'], ['lfo3Rate', 'LFO 3 speed'], ['lfo4Rate', 'LFO 4 speed']]);
}

// ---------------- control descriptors ----------------
const S = (path, label, min, max, o) => Object.assign({ k: 's', path, label, min, max, step: 1 }, o || {});
const SEL = (path, label, opts, o) => Object.assign({ k: 'sel', path, label, opts }, o || {});
const TOG = (path, label, o) => Object.assign({ k: 'tog', path, label }, o || {});
const ROUTING_HELP = {
  parallel: 'Mixer 1 feeds Filter 1 and Amp 1; Mixer 2 feeds Filter 2 and Amp 2.',
  serial1: 'Mixer 1 runs through Filter 1 then Filter 2 into Amp 1. Mixer 2 goes straight to Amp 2, unfiltered.',
  serial2: 'Mixer 1 runs through Filter 1 into Amp 1, and Filter 1\u2019s output also feeds Filter 2 into Amp 2. Mixer 2 is not used. This reading of Serial 2 comes from reviews, since Korg\u2019s own diagram is only in the scanned Z1 manual.'
};
const EG_MODS = s => [SEL(s + '.lvlSrc', 'Level mod source', SRC_OPTS), S(s + '.lvlInt', 'Level mod intensity', -99, 99, { fmt: F.sgn }),
  SEL(s + '.tSrc', 'Time mod source', SRC_OPTS), S(s + '.tInt', 'Time mod intensity', -99, 99, { fmt: F.sgn }),
  SEL(s + '.nSrc', 'Stage time source', SRC_OPTS), S(s + '.nAt', 'Attack time mod', -99, 99, { fmt: F.sgn }), S(s + '.nDc', 'Decay time mod', -99, 99, { fmt: F.sgn }),
  S(s + '.nSl', 'Slope time mod', -99, 99, { fmt: F.sgn }), S(s + '.nRl', 'Release time mod', -99, 99, { fmt: F.sgn })];
const DEF_EG = s => [S(s + '.atkT', 'Attack time', 0, 99, { fmt: F.time }), S(s + '.decT', 'Decay time', 0, 99, { fmt: F.time }), S(s + '.slpT', 'Slope time', 0, 99, { fmt: F.time }), S(s + '.relT', 'Release time', 0, 99, { fmt: F.time })];

function pageProgram() {
  return [
    { title: 'Program', controls: [
      { k: 'txt', path: 'name', label: 'Name' },
      SEL('voice.mode', 'Voice assign', [['poly', 'Poly'], ['monoSingle', 'Mono, single trigger'], ['monoMulti', 'Mono, multi trigger']]),
      SEL('voice.priority', 'Note priority', [['last', 'Last'], ['low', 'Low'], ['high', 'High']]),
      SEL('voice.maxVoices', 'Polyphony', [[6, '6 voices (MOSS-TRI)'], [12, '12 voices'], [16, '16 voices']], { num: true }),
      SEL('voice.unison', 'Unison', [[1, 'Off'], [2, '2 voices'], [3, '3 voices'], [6, '6 voices']], { num: true }),
      S('voice.uniDetune', 'Unison detune', 0, 99), S('voice.random', 'Random pitch', 0, 99), TOG('voice.hold', 'Hold'), S('voice.tempo', 'Tempo (LFO sync)', 40, 240, { fmt: v => v + ' bpm' })] },
    { title: 'Portamento', controls: [TOG('voice.porta', 'On'), TOG('voice.portaFingered', 'Fingered (legato only)'), S('voice.portaTime', 'Time', 0, 99)] },
    { title: 'Joystick pitch bend', controls: [S('voice.bendUp', 'JS +X', -60, 24, { fmt: F.semis }), S('voice.bendDown', 'JS \u2212X', -60, 24, { fmt: F.semis })] },
    { title: 'Output', controls: [S('out.level', 'Output level', 0, 127), S('out.pan', 'Pan', 0, 127, { fmt: F.pan })],
      help: 'MIDI CC 70 to 76 and 79 work as on the EXB-MOSS: sustain level, resonance, release, attack, cutoff, decay, LFO speed and filter EG intensity.' },
    { title: 'Program memory', custom: renderMemory }
  ].concat(patch.korgInfo ? [{ title: 'Imported from ' + (patch.korgInfo && /Bank F/.test(patch.korgInfo.source || '') ? 'Triton' : 'Trinity'), custom: renderImportInfo }] : []);
}
function pageOsc(i) {
  const O = patch.osc[i], base = 'osc.' + i, pp = base + '.p.', t = O.type, other = i === 0 ? 'OSC 2' : 'OSC 1';
  const dbl = i === 1 && DOUBLE.includes(patch.osc[0].type);
  const types = i === 0 ? OSC_TYPES : OSC_TYPES.slice(0, 9);
  const secs = [
    { title: 'Oscillator ' + (i + 1), note: dbl ? 'Unavailable while OSC 1 uses a double-size model' : '', controls: [
      SEL(base + '.type', 'Type', types, { rerender: true }),
      S(base + '.octave', 'Octave', -2, 1, { fmt: F.oct }), S(base + '.transpose', 'Transpose', -12, 12, { fmt: F.sgn }),
      S(base + '.tune', 'Tune', -50, 50, { fmt: F.cents }), S(base + '.foffset', 'Frequency offset', -10, 10, { step: 0.1, fmt: F.hzOff })] }
  ];
  if (t === 'standard') {
    secs.push({ title: 'Wave', controls: [SEL(pp + 'wave', 'Main wave', [['saw', 'Saw'], ['pulse', 'Pulse']]), S(pp + 'level', 'Level', 0, 99), S(pp + 'edge', 'Wave edge', 0, 99),
      S(pp + 'tri', 'Triangle level', 0, 99), S(pp + 'sine', 'Sine level', 0, 99), S(pp + 'phase', 'Triangle/sine phase', -99, 99, { fmt: F.sgn })] });
    secs.push({ title: 'Waveform modulation', controls: [S(pp + 'wform', 'Waveform', -99, 99, { fmt: F.sgn }), SEL(pp + 'wfLfo', 'LFO', LFO_OPTS), S(pp + 'wfInt', 'LFO intensity', -99, 99, { fmt: F.sgn })],
      help: 'Saw: +99 doubles the frequency. Pulse: 0 is a square wave and \u00b199 is silent. Triangle: bends through ramp and trapezoid shapes.' });
    secs.push({ title: 'Wave shape', controls: [SEL(pp + 'shType', 'Table', [['clip', 'Clip'], ['reso', 'Reso']]), S(pp + 'shIn', 'Input', 0, 99), S(pp + 'shOffset', 'Offset', -99, 99, { fmt: F.sgn }),
      S(pp + 'shShape', 'Shape', 0, 99), S(pp + 'shBal', 'Balance', 0, 99)], help: 'Balance 0 bypasses the shaper; 99 is fully shaped.' });
  } else if (t === 'comb') {
    const burst = O.p.cIn === 'pulse' || O.p.cIn === 'impulse';
    secs.push({ title: 'Comb input', controls: [SEL(pp + 'cIn', 'Input', [['osc', other + ' + noise'], ['sub', 'Sub OSC + noise'], ['f1', 'Filter 1 + noise'], ['f2', 'Filter 2 + noise'], ['pulse', 'Pulse noise'], ['impulse', 'Impulse']], { rerender: true }),
      S(pp + 'cLevel', 'Input level', 0, 99), burst ? S(pp + 'cPw', 'Pulse width', 0, 99) : S(pp + 'cNoise', 'Noise level', 0, 99)],
      help: burst ? 'Pulse noise and impulse fire once at each note-on, like a pluck.' : 'The noise comes from the noise generator, so its filter colours the comb.' });
    secs.push({ title: 'Comb filter', controls: [S(pp + 'cFb', 'Feedback', 0, 99), S(pp + 'cDamp', 'High damp', 0, 99)] });
  } else if (t === 'vpm') {
    const ext = ['osc', 'sub', 'f1', 'f2'].includes(O.p.vMod);
    secs.push({ title: 'Carrier', controls: [SEL(pp + 'vCar', 'Wave', CAR_OPTS), S(pp + 'vCarLvl', 'Level', 0, 99), S(pp + 'vShape', 'Wave shape', 0, 99),
      SEL(pp + 'vType', 'Shape type', [[1, 'Type 1'], [2, 'Type 2 (rounded)']], { num: true }), S(pp + 'vFb', 'Feedback', 0, 99)] });
    const mc = [SEL(pp + 'vMod', 'Wave', CAR_OPTS.concat([['osc', other], ['sub', 'Sub OSC'], ['f1', 'Filter 1'], ['f2', 'Filter 2']]), { rerender: true }), S(pp + 'vModLvl', 'Level', 0, 99)];
    if (!ext) mc.push(S(pp + 'vRatio', 'Coarse ratio', 0, 16, { fmt: F.ratio }), S(pp + 'vFine', 'Fine', -50, 50, { fmt: F.cents }));
    secs.push({ title: 'Modulator', controls: mc });
  } else if (t === 'reso') {
    const warn = patch.osc[0].type === 'reso' && patch.osc[1].type === 'reso' && patch.osc[0].p.rIn === 'osc' && patch.osc[1].p.rIn === 'osc';
    secs.push({ title: 'Input', controls: [SEL(pp + 'rIn', 'Input', [['osc', other], ['sub', 'Sub OSC'], ['noise', 'Noise'], ['f1', 'Filter 1'], ['f2', 'Filter 2']], { rerender: true }), S(pp + 'rLevel', 'Level', 0, 99)],
      help: warn ? 'Both oscillators feed each other here, which is unstable on the original too and may go silent.' : '' });
    for (let b = 0; b < 4; b++) secs.push({ title: 'Band-pass ' + (b + 1), controls: [S(pp + 'r' + b + 'Lvl', 'Level', 0, 99), S(pp + 'r' + b + 'Harm', 'Harmonic', 1, 16), S(pp + 'r' + b + 'Fine', 'Fine', -99, 99, { fmt: F.sgn }), S(pp + 'r' + b + 'Reso', 'Resonance', 0, 99)] });
  } else if (t === 'ring' || t === 'cross' || t === 'sync') {
    const c = [SEL(pp + 'mIn', t === 'sync' ? 'Master (input)' : 'Modulator (input)', [['osc', other], ['sub', 'Sub OSC'], ['noise', 'Noise'], ['f1', 'Filter 1'], ['f2', 'Filter 2']]),
      SEL(pp + 'mCar', t === 'sync' ? 'Slave wave' : 'Carrier wave', CAR_OPTS), S(pp + 'mEdge', 'Wave edge', 0, 99)];
    if (t !== 'sync') c.push(S(pp + 'mDepth', 'Depth', 0, 99));
    if (t === 'ring') c.push(SEL(pp + 'mType', 'Type', [[1, 'Type 1'], [2, 'Type 2 (brighter)']], { num: true }));
    secs.push({ title: { ring: 'Ring modulation', cross: 'Cross modulation', sync: 'Sync modulation' }[t], controls: c,
      help: t === 'sync' ? 'The slave runs at this oscillator\u2019s pitch and restarts on each cycle of the master. Sweep it with the Mod page destination \u201cOSC ' + (i + 1) + ': slave pitch\u201d.' : '' });
  } else if (t === 'bowed') {
    secs.push({ title: 'Bow speed', controls: [SEL(pp + 'bwSpdEg', 'Speed EG', EG_OPTS), S(pp + 'bwSpdInt', 'EG intensity', -99, 99, { fmt: F.sgn }), TOG(pp + 'bwDiff', 'Differential (bow with a controller\u2019s movement)')],
      help: 'Speed follows the EG; negative intensity bows the other way. Modulate it on the Mod page (\u201cOSC 1: bow speed\u201d).' });
    secs.push({ title: 'Bow pressure', controls: [SEL(pp + 'bwPrsEg', 'Pressure EG', EG_OPTS), S(pp + 'bwPrsInt', 'EG intensity', -99, 99, { fmt: F.sgn }), S(pp + 'bwRosin', 'Rosin', 0, 99)] });
    secs.push({ title: 'String', controls: [S(pp + 'bwPos', 'Bowing point', 0, 99), S(pp + 'bwDamp', 'Damping', 0, 99), S(pp + 'bwDampKey', 'Damping track key', 0, 127, { fmt: F.note }),
      S(pp + 'bwDampLo', 'Damping ramp low', -99, 99, { fmt: F.sgn }), S(pp + 'bwDampHi', 'Damping ramp high', -99, 99, { fmt: F.sgn }), S(pp + 'bwDisp', 'Dispersion', 0, 99), S(pp + 'bwRefl', 'Bridge reflection', 0, 99)] });
    secs.push({ title: 'Peaking EQ', controls: [S(pp + 'bwEqF', 'Frequency', 0, 49), S(pp + 'bwEqQ', 'Q', 0, 29), S(pp + 'bwEqG', 'Gain', -18, 18, { fmt: F.sgn })] });
  } else if (t === 'reed') {
    secs.push({ title: 'Instrument', controls: [SEL(pp + 'rdType', 'Inst type', REED_TYPES, { num: true }), SEL(pp + 'rdPrsEg', 'Pressure EG', EG_OPTS), S(pp + 'rdPrsInt', 'EG intensity', -99, 99, { fmt: F.sgn }), S(pp + 'rdNoise', 'Breath noise', 0, 99)],
      help: 'Breath noise comes from the noise generator, so its filter shapes the breath. Pressure near zero is silent; more pressure plays louder and brighter.' });
    secs.push({ title: 'Tone', controls: [S(pp + 'rdHpf', 'High-pass', 0, 99), S(pp + 'rdHpfReso', 'High-pass resonance', 0, 99), SEL(pp + 'rdWsTable', 'Shape table', [['clip', 'Clip'], ['reso', 'Reso']]),
      S(pp + 'rdWsOff', 'Shape offset', -99, 99, { fmt: F.sgn }), S(pp + 'rdWsShape', 'Shape', 0, 99)] });
    secs.push({ title: 'Peaking EQ', controls: [S(pp + 'rdEqF', 'Frequency', 0, 49), S(pp + 'rdEqQ', 'Q', 0, 29), S(pp + 'rdEqG', 'Gain', -18, 18, { fmt: F.sgn })] });
  } else if (t === 'pluck') {
    secs.push({ title: 'Attack', controls: [S(pp + 'plAtk', 'Attack level', 0, 99), S(pp + 'plAtkVel', 'Level velocity', -99, 99, { fmt: F.sgn }), S(pp + 'plUp', 'Curve up', 0, 99), S(pp + 'plUpVel', 'Curve up velocity', -99, 99, { fmt: F.sgn }),
      S(pp + 'plDn', 'Curve down', 0, 99), S(pp + 'plDnVel', 'Curve down velocity', -99, 99, { fmt: F.sgn }), S(pp + 'plNoise', 'Noise level', 0, 99), S(pp + 'plNoiseVel', 'Noise velocity', -99, 99, { fmt: F.sgn })] });
    secs.push({ title: 'String', controls: [S(pp + 'plPos', 'String position', 0, 99), S(pp + 'plDisp', 'Dispersion', 0, 99), S(pp + 'plDamp', 'Damping', 0, 99), S(pp + 'plDampKt', 'Damping key track', -99, 99, { fmt: F.sgn }),
      S(pp + 'plDecay', 'Decay', 0, 99), S(pp + 'plDecayKt', 'Decay key track', -99, 99, { fmt: F.sgn }), S(pp + 'plRel', 'Release', 0, 99), S(pp + 'plHarm', 'Harmonics point', 0, 99)],
      help: 'Harmonics point is where the string is lightly touched (50 is the middle: the octave harmonic). How firmly it is touched comes from the Mod page destination \u201cOSC 1: harmonics\u201d, for example an EG for a harmonic at the attack.' });
    secs.push({ title: 'Pickup and EQ', controls: [TOG(pp + 'plPickup', 'Pickup'), S(pp + 'plPickPos', 'Pickup position', 0, 99), S(pp + 'plEqF', 'Low EQ frequency', 0, 49), S(pp + 'plEqG', 'Low EQ gain', -18, 18, { fmt: F.sgn }), S(pp + 'plBoost', 'Low boost', 0, 99)] });
  } else if (t === 'organ') {
    for (let k = 0; k < 3; k++) secs.push({ title: 'Drawbar ' + (k + 1), controls: [SEL(pp + 'og' + k + 'Wave', 'Wave', ORGAN_WAVES, { num: true }), S(pp + 'og' + k + 'Harm', 'Harmonic', 1, 16, { fmt: fmtHarm }),
      S(pp + 'og' + k + 'Fine', 'Fine', -99, 99, { fmt: F.cents }), S(pp + 'og' + k + 'Lvl', 'Level', 0, 99), S(pp + 'og' + k + 'Perc', 'Percussion', 0, 99)],
      help: k === 0 ? 'Harmonic 1 sounds one octave below the oscillator, so 2 is the oscillator\u2019s own pitch. Footages assume the oscillator is at 8\u2032. Mod page: \u201cOSC ' + (i + 1) + ': drawbar 1 level\u201d.' : '' });
    secs.push({ title: 'Percussion', controls: [SEL(pp + 'ogTrig', 'Trigger', [[0, 'Single'], [1, 'Multi']], { num: true }), S(pp + 'ogDecay', 'Decay', 0, 99)],
      help: 'Multi strikes the percussion on every note. Single strikes it only on a note played with no other key held (notes of a chord struck together all get it). The percussion level AMS on the Mod page (\u201cpercussion level\u201d) scales each drawbar\u2019s percussion.' });
  } else if (t === 'epiano') {
    secs.push({ title: 'Hammer', controls: [S(pp + 'epForce', 'Force', 0, 99), S(pp + 'epCurve', 'Force velocity curve', -1, 99, { fmt: v => v < 0 ? 'Off' : String(v) }), S(pp + 'epWidth', 'Hammer width', 0, 99), S(pp + 'epClick', 'Click level', 0, 99)],
      help: 'More force hits the tine harder: brighter and louder. Higher width means a narrower hammer: a sharper tone and click.' });
    secs.push({ title: 'Tone generator', controls: [S(pp + 'epDecay', 'Decay', 0, 99), S(pp + 'epRel', 'Release', 0, 99), S(pp + 'epOtL', 'Overtone level', 0, 99),
      S(pp + 'epOtF', 'Overtone freq', 0, 99, { fmt: v => '\u00d7' + (Math.pow(2, 1 + 2 * v / 99)).toFixed(2) }), S(pp + 'epOtD', 'Overtone decay', 0, 99)],
      help: 'Decay and Release are the tine\u2019s own ring and damper; they only show when the Amp EG is longer. The overtone is inharmonic, which gives the bell.' });
    secs.push({ title: 'Pickup and EQ', controls: [S(pp + 'epPos', 'Pickup position', 0, 99), S(pp + 'epEqF', 'Low EQ frequency', 0, 49), S(pp + 'epEqG', 'Low EQ gain', -18, 18, { fmt: F.sgn })],
      help: 'Low settings centre the pickup on the tine: the 2nd partial takes over and the fundamental fades. Higher settings bring the fundamental in.' });
  } else if (t === 'brass') {
    secs.push({ title: 'Instrument', controls: [SEL(pp + 'brType', 'Inst type', BRASS_TYPES, { num: true }), SEL(pp + 'brPrsEg', 'Pressure EG', EG_OPTS), S(pp + 'brPrsInt', 'EG intensity', -99, 99, { fmt: F.sgn }), S(pp + 'brNoise', 'Breath noise', 0, 99)],
      help: 'More pressure plays louder and brighter. Breath noise comes from the noise generator, so its filter shapes the breath. Mod page: \u201cOSC 1: pressure\u201d.' });
    secs.push({ title: 'Lips and bell', controls: [S(pp + 'brLip', 'Lip character', 0, 99), S(pp + 'brBell', 'Bell tone', 0, 99), S(pp + 'brBellRes', 'Bell resonance', 0, 99), S(pp + 'brStr', 'Strength', 0, 99)],
      help: 'Higher lip character is firmer, harder blowing. Higher bell tone removes the low end. Strength overdrives the tone.' });
    secs.push({ title: 'Peaking EQ', controls: [S(pp + 'brEqF', 'Frequency', 0, 49), S(pp + 'brEqQ', 'Q', 0, 29), S(pp + 'brEqG', 'Gain', -18, 18, { fmt: F.sgn })] });
  }
  return secs;
}
function pageSubNoise() {
  return [
    { title: 'Sub oscillator', controls: [SEL('sub.wave', 'Wave', CAR_OPTS), S('sub.octave', 'Octave', -2, 1, { fmt: F.oct }), S('sub.transpose', 'Transpose', -12, 12, { fmt: F.sgn }), S('sub.tune', 'Tune', -50, 50, { fmt: F.cents }), S('sub.foffset', 'Frequency offset', -10, 10, { step: 0.1, fmt: F.hzOff })] },
    { title: 'Noise generator', controls: [SEL('noise.ftype', 'Filter', [['thru', 'Thru'], ['lpf', 'Low pass'], ['hpf', 'High pass'], ['bpf', 'Band pass']]), S('noise.trim', 'Input trim', 0, 99), S('noise.freq', 'Cutoff', 0, 99, { fmt: F.hz }), S('noise.reso', 'Resonance', 0, 99)] }
  ];
}
function pageMixer() {
  return [0, 1].map(b => ({ title: 'Mixer ' + (b + 1), note: b === 1 && patch.filt.routing === 'serial2' ? 'Not used with Serial 2 routing' : '',
    controls: [S('mix.' + b + '.osc1', 'OSC 1', 0, 99), S('mix.' + b + '.osc2', 'OSC 2', 0, 99), S('mix.' + b + '.sub', 'Sub OSC', 0, 99), S('mix.' + b + '.noise', 'Noise', 0, 99), S('mix.' + b + '.fb', 'Feedback', 0, 99)],
    help: b === 1 ? 'Feedback returns the amp output to the mixer. High settings distort, as on the original.' : '' }));
}
function pageFilter() {
  const secs = [{ title: 'Routing', controls: [SEL('filt.routing', 'Routing', [['parallel', 'Parallel'], ['serial1', 'Serial 1'], ['serial2', 'Serial 2']], { rerender: true }), TOG('filt.link', 'Link Filter 2 to Filter 1', { rerender: true })],
    help: ROUTING_HELP[patch.filt.routing] }];
  for (let f = 0; f < 2; f++) {
    if (f === 1 && patch.filt.link) { secs.push({ title: 'Filter 2', note: 'Linked to Filter 1', controls: [] }); continue; }
    const b = 'f.' + f + '.', F2 = patch.f[f];
    const c = [SEL(b + 'type', 'Type', [['lpf', 'Low pass'], ['hpf', 'High pass'], ['bpf', 'Band pass'], ['brf', 'Band reject'], ['dbpf', 'Dual band pass']], { rerender: true }),
      S(b + 'trimA', 'A trim', 0, 99), S(b + 'freqA', 'A cutoff', 0, 99, { fmt: F.hz }), S(b + 'resoA', 'A resonance', 0, 99)];
    if (F2.type === 'dbpf') { c.push(S(b + 'trimB', 'B trim', 0, 99), S(b + 'freqB', 'B cutoff', 0, 99, { fmt: F.hz }), S(b + 'resoB', 'B resonance', 0, 99)); if (F2.egIntB !== undefined) c.push(S(b + 'egIntB', 'B EG intensity', -99, 99, { fmt: F.sgn })); }
    c.push(SEL(b + 'eg', 'Cutoff EG', EG_OPTS), S(b + 'egInt', 'EG intensity', -99, 99, { fmt: F.sgn }),
      S(b + 'keyLow', 'Key low', 0, 127, { fmt: F.note }), S(b + 'keyHigh', 'Key high', 0, 127, { fmt: F.note }), S(b + 'rampLow', 'Ramp low', -99, 99, { fmt: F.sgn }), S(b + 'rampHigh', 'Ramp high', -99, 99, { fmt: F.sgn }));
    secs.push({ title: 'Filter ' + (f + 1), controls: c, help: f === 0 ? 'Keyboard tracking: Ramp low \u221250 and Ramp high +50 follow the pitch exactly. Resonance at 99 self-oscillates once a note excites it.' : '' });
  }
  return secs;
}
function pageAmp() {
  const secs = [0, 1].map(a => ({ title: 'Amp ' + (a + 1), controls: [S('amp.' + a + '.level', 'Level', 0, 99), SEL('amp.' + a + '.eg', 'EG', EG_OPTS),
    S('amp.' + a + '.keyLow', 'Key low', 0, 127, { fmt: F.note }), S('amp.' + a + '.keyHigh', 'Key high', 0, 127, { fmt: F.note }), S('amp.' + a + '.rampLow', 'Ramp low', -99, 99, { fmt: F.sgn }), S('amp.' + a + '.rampHigh', 'Ramp high', -99, 99, { fmt: F.sgn })] }));
  secs.push({ title: 'Amp EG', eg: 'ampEG', isAmp: true, controls: DEF_EG('ampEG').concat([S('ampEG.atkL', 'Attack level', 0, 99), S('ampEG.brkL', 'Break level', 0, 99), S('ampEG.susL', 'Sustain level', 0, 99),
    S('ampEG.vel', 'Velocity to level', -99, 99, { fmt: F.sgn }), S('ampEG.velTime', 'Velocity to time', -99, 99, { fmt: F.sgn })]) });
  secs.push({ title: 'Amp EG modulation', controls: EG_MODS('ampEG') });
  return secs;
}
let egSel = 0, lfoSel = 0;
function pageEG() {
  const b = 'eg.' + egSel;
  return [{ title: '', seg: ['EG 1', 'EG 2', 'EG 3', 'EG 4'], segVal: egSel, segSet: v => { egSel = v; renderPage(); }, eg: b,
    controls: [S(b + '.startL', 'Start level', -99, 99, { fmt: F.sgn }), S(b + '.atkL', 'Attack level', -99, 99, { fmt: F.sgn }), S(b + '.brkL', 'Break level', -99, 99, { fmt: F.sgn }), S(b + '.susL', 'Sustain level', -99, 99, { fmt: F.sgn }), S(b + '.relL', 'Release level', -99, 99, { fmt: F.sgn })]
      .concat(DEF_EG(b)).concat([S(b + '.vel', 'Velocity to level', -99, 99, { fmt: F.sgn }), S(b + '.velTime', 'Velocity to time', -99, 99, { fmt: F.sgn })]),
    help: 'Route EGs on the Filter, Amp and Mod pages. Time values are approximate; Korg never published the curves.' },
  { title: 'EG ' + (egSel + 1) + ' modulation', controls: EG_MODS(b), help: 'Level mod scales the levels like velocity does. Time mods follow Korg: +16 on a full source halves the times, +99 makes them 64 times shorter.' }];
}
function pageLFO() {
  const b = 'lfo.' + lfoSel;
  return [{ title: '', seg: ['LFO 1', 'LFO 2', 'LFO 3', 'LFO 4'], segVal: lfoSel, segSet: v => { lfoSel = v; renderPage(); },
    controls: [SEL(b + '.wave', 'Waveform', LFO_WAVES), S(b + '.freq', 'Frequency', 0, 199, { fmt: F.lfo }), S(b + '.offset', 'Offset', -50, 50, { fmt: F.sgn }),
      SEL(b + '.sync', 'Key sync', [['off', 'Off'], ['timbre', 'By timbre'], ['voice', 'By voice']]), S(b + '.fade', 'Fade in', 0, 99, { fmt: F.time })],
    help: 'Key sync by voice restarts each note\u2019s LFO; by timbre restarts all of them when you play from silence.' },
  { title: 'LFO ' + (lfoSel + 1) + ' modulation', controls: [SEL(b + '.fm1', 'Speed mod 1 source', SRC_OPTS), S(b + '.fm1Int', 'Speed mod 1 intensity', -99, 99, { fmt: F.sgn }),
      SEL(b + '.fm2', 'Speed mod 2 source', SRC_OPTS), S(b + '.fm2Int', 'Speed mod 2 intensity', -99, 99, { fmt: F.sgn }),
      SEL(b + '.am', 'Depth source', SRC_OPTS), S(b + '.amInt', 'Depth intensity', -99, 99, { fmt: F.sgn })],
    help: 'Once a depth source is set, the LFO\u2019s depth follows it (as on the Prophecy and Z1), so a joystick can bring vibrato in from nothing.' },
  { title: 'Tempo sync', controls: [TOG(b + '.msync', 'Sync to tempo'), SEL(b + '.mbase', 'Base note', [[0, '1/16'], [1, '1/8 triplet'], [2, '1/8'], [3, '1/4 triplet'], [4, '1/4'], [5, '1/2 triplet'], [6, '1/2'], [7, 'Whole']], { num: true }),
      S(b + '.mtimes', 'Times', 0, 15, { fmt: v => '\u00d7' + (v + 1) })],
    help: 'Uses the program tempo on the Program page. One cycle lasts the base note times this number.' }];
}
function pageMod() { return [{ title: 'Modulation', custom: renderMods }]; }
// ---------------- effects (Trinity insert + master effects) ----------------
const FX_MAX_INS = 8;
const FX_CATS = [['delay', 'Delay'], ['reverb', 'Reverb and reflections'], ['mod', 'Chorus, flanger, ensemble'], ['phaser', 'Phaser'], ['trem', 'Tremolo and pan'], ['rot', 'Rotary speaker'],
  ['filt', 'Filter, talking modulator, special'], ['eq', 'EQ'], ['dyn', 'Dynamics'], ['drive', 'Drive, amp, decimator'], ['pitch', 'Pitch']];
const fxSize = id => { const e = TFX.byId(id); return e ? TFX.SIZE[e.grp] : 0; };
let fxSel = 'i0';
function fxTypeSelect(cur, groups, onPick, label) {
  const s = el('select', 'fxtype'); s.setAttribute('aria-label', label);
  const ce = TFX.byId(cur);
  if (ce && !groups.includes(ce.grp)) { const g = el('optgroup'); g.label = 'Set by the imported program'; const o = el('option', null, ce.name + '  \u00b7 size ' + (TFX.SIZE[ce.grp] || '-')); o.value = ce.id; g.appendChild(o); s.appendChild(g); }
  for (const [core, cname] of FX_CATS) {
    const list = TFX.CAT.filter(e => groups.includes(e.grp) && e.core === core); if (!list.length) continue;
    const g = el('optgroup'); g.label = cname;
    list.forEach(e => { const o = el('option', null, e.name + (e.master ? '' : '  · size ' + TFX.SIZE[e.grp])); o.value = e.id; g.appendChild(o); });
    s.appendChild(g);
  }
  s.value = cur; s.addEventListener('change', () => onPick(s.value)); return s;
}
// one parameter of an effect, from the catalog: [key, label, min, max, default, unit, log] or [key, label, 'sel'|'src', options, default]
function fxCtl(path, q) {
  const [key, label, a, b, , unit, lg] = q, cur = getP(path + '.' + key);
  const w = el('label', 'ctl'), nm = el('span', 'nm', label);
  if (a === 'sel' || a === 'src') {
    const opts = a === 'src' ? TFX.SRC_NAMES : b, sEl = el('select');
    opts.forEach((t, i) => { const o = el('option', null, t); o.value = i; sEl.appendChild(o); });
    sEl.value = String(Math.round(cur === undefined || cur === null ? (q[4] || 0) : cur));
    sEl.addEventListener('change', () => setP(path + '.' + key, Number(sEl.value)));
    w.append(nm, el('span'), sEl); return w;
  }
  const span = b - a, whole = Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(q[4]);
  const step = unit === 's' ? 0.1 : unit === 'dB' ? 0.5 : unit === 'ms' && span <= 60 ? 0.1 : whole ? 1 : span <= 2 ? 0.01 : span <= 20 ? 0.1 : 1;
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0, out = el('output'), inp = el('input');
  const erPan = /^er\dp$/.test(key), tapPan = /^(p\d|pan\d)$/.test(key);
  const fmt = v => {
    if (unit === 'note') return F.note(Math.round(v));
    if (erPan) return ['L', '1', '2', 'C', '4', '5', 'R'][Math.round(v)] || String(v);
    if (tapPan) { const r = Math.round(v); return r === 0 ? 'C' : r < 0 ? 'L' + -r : 'R' + r; }
    const t = lg ? (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(2) : v.toFixed(1)) : (+v).toFixed(dec);
    return (a < 0 && v > 0 ? '+' : '') + t + (unit ? (unit === '%' || unit === '°' ? '' : ' ') + unit : '');
  };
  inp.type = 'range';
  const toPos = v => lg ? Math.round(Math.log(v / a) / Math.log(b / a) * 1000) : v, fromPos = x => lg ? a * Math.pow(b / a, x / 1000) : x;
  if (lg) { inp.min = 0; inp.max = 1000; inp.step = 1; } else { inp.min = a; inp.max = b; inp.step = step; }
  const v0 = cur === undefined ? q[4] : cur; inp.value = toPos(v0); out.textContent = fmt(v0);
  const put = v => { v = Math.max(a, Math.min(b, v)); if (!lg) v = Math.round(v / step) * step; v = +v.toFixed(4); setP(path + '.' + key, v); out.textContent = fmt(v); return v; };
  inp.addEventListener('input', () => put(fromPos(Number(inp.value))));
  inp.addEventListener('dblclick', () => { const v = put(q[4]); inp.value = toPos(v); });
  w.title = 'Double-click to reset'; w.append(nm, out, inp); return w;
}
function fxParams(host, path, id, master) {
  const e = TFX.byId(id); if (!e) return;
  const g = el('div', 'grid'); e.params.forEach(q => g.appendChild(fxCtl(path + '.p', q))); host.appendChild(g);
  // every Trinity effect's Wet/Dry (a master effect's level) can follow a dynamic-modulation source
  const m = el('div', 'fxmod');
  m.appendChild(fxCtl(path + '.p', ['wsrc', master ? 'Level mod source' : 'Wet/dry mod source', 'src', null, 0]));
  m.appendChild(fxCtl(path + '.p', ['wamt', master ? 'Level mod amount' : 'Wet/dry mod amount', -100, 100, 0, '']));
  host.appendChild(m);
}
// controllers that the program's effects listen to but that have no control on screen: sliders that send their MIDI CC
const FX_SRC_CC = { 15: [82, 1], 16: [4], 17: [64, 1], 18: [7], 19: [10], 20: [11], 21: [12], 22: [13], 23: [18], 24: [19], 26: [17], 27: [20], 28: [21], 29: [17], 30: [19], 31: [20], 32: [21], 33: [65, 1], 34: [66, 1], 35: [83] };
const fxCC = {};
function fxSourcesUsed() {
  const fx = patch.fx, used = new Set(), look = p => { if (!p) return; for (const k of ['src', 'wahSrc', 'spdSrc', 'hsrc', 'wsrc']) if (p[k] > 0) used.add(Math.round(p[k])); };
  fx.ins.forEach(sl => sl && sl.on && look(sl.p)); if (fx.m1.on) look(fx.m1.p); if (fx.m2.on) look(fx.m2.p);
  return [...used].filter(i => FX_SRC_CC[i]).sort((x, y) => x - y);
}
function renderFxControllers(host) {
  const g = el('div', 'grid');
  for (const i of fxSourcesUsed()) {
    const [cc, sw] = FX_SRC_CC[i], name = TFX.SRC_NAMES[i];
    if (sw) {
      const w = el('label', 'tog'), c = el('input'); c.type = 'checkbox'; c.checked = (fxCC[cc] || 0) >= 64;
      c.addEventListener('change', () => { fxCC[cc] = c.checked ? 127 : 0; if (!ctx) startAudio(); send({ t: 'cc', c: cc, v: fxCC[cc] }); });
      w.append(c, document.createTextNode(name)); g.appendChild(w);
    } else {
      const w = el('label', 'ctl'), out = el('output', null, String(fxCC[cc] === undefined ? (cc === 7 || cc === 11 ? 127 : cc === 10 ? 64 : 0) : fxCC[cc])), inp = el('input');
      inp.type = 'range'; inp.min = 0; inp.max = 127; inp.value = out.textContent;
      inp.addEventListener('input', () => { fxCC[cc] = Number(inp.value); out.textContent = inp.value; send({ t: 'cc', c: cc, v: fxCC[cc] }); });
      w.append(el('span', 'nm', name), out, inp); g.appendChild(w);
    }
  }
  host.appendChild(g);
}
function fxSetIns(list) { setP('fx.ins', clone(list)); renderPage(); renderFlow(); }
function renderFxRouting(host) {
  const fx = patch.fx, ins = fx.ins, uses = ins.some(sl => sl && sl.type) || !!fx.ifxRoute;
  const box = el('div', 'fxroute');
  const chip = (txt, sub, key, off, cls) => { const c = el('button', 'fxchip' + (cls ? ' ' + cls : '') + (off ? ' off' : '') + (fxSel === key ? ' sel' : '')); c.type = 'button'; c.appendChild(el('b', null, txt)); if (sub) c.appendChild(el('span', null, sub)); if (key) c.addEventListener('click', () => { fxSel = key; renderPage(); }); else c.disabled = true; return c; };
  const arrow = t => el('span', 'fxarr', t || '→');
  const r1 = el('div', 'fxrow');
  r1.append(chip('MOSS', 'voices', null, false, 'src'), arrow());
  ins.forEach((sl, i) => { const e = TFX.byId(sl.type); r1.append(chip('IFX ' + (i + 1), e ? e.name : '?', 'i' + i, !sl.on), arrow()); });
  if (ins.length < FX_MAX_INS) { const add = chip('+', 'add insert', null, false, 'add'); add.disabled = false; add.addEventListener('click', () => { const l = ins.slice(); l.push(TFX.slot('S2:13')); fxSel = 'i' + (l.length - 1); fxSetIns(l); }); r1.append(add, arrow()); }
  r1.append(chip('Pan / width', uses ? 'after inserts' : 'program pan', null), arrow(), chip('EQ', (fx.eqLo || fx.eqHi) ? 'L ' + F.sgn(fx.eqLo) + ' / H ' + F.sgn(fx.eqHi) + ' dB' : 'flat', 'eq'), arrow(), chip('OUT', 'L/R', null, false, 'src'));
  const s1 = uses ? fx.ifxSend1 : fx.send1, s2 = uses ? fx.ifxSend2 : fx.send2;
  const r2 = el('div', 'fxrow sub'), m1 = TFX.byId(fx.m1.type), m2 = TFX.byId(fx.m2.type);
  r2.append(el('span', 'fxarr', '↳ Send 1 ' + s1), chip('Master 1', m1 ? m1.name : '?', 'm1', !fx.m1.on), el('span', 'fxarr', 'Return ' + fx.m1.ret + ' → out' + (fx.m1.cascade ? ', cascade ↓' : '')));
  const r3 = el('div', 'fxrow sub');
  r3.append(el('span', 'fxarr', '↳ Send 2 ' + s2), chip('Master 2', m2 ? m2.name : '?', 'm2', !fx.m2.on), el('span', 'fxarr', 'Return ' + fx.m2.ret + ' → out'));
  box.append(r1, r2, r3); host.appendChild(box);
  // size budget, as on the Trinity
  const used = ins.reduce((t, sl) => t + (sl && sl.type ? fxSize(sl.type) : 0), 0);
  const note = used > 4 || ins.length > 3 ? 'Inserts use size ' + used + ' in ' + ins.length + ' slots. A Trinity program allows 3 inserts with a total size of 4 (a Combination 8 and 8); here you can chain up to ' + FX_MAX_INS + ' of any size.' :
    'Inserts use size ' + used + ' of the Trinity program\u2019s 4 (3 slots). You can chain up to ' + FX_MAX_INS + ' here, of any size.';
  host.appendChild(el('p', 'help', note + ' Tap a block to edit it.'));
}
function renderFxSlot(host) {
  const fx = patch.fx, i = Number(fxSel.slice(1)), sl = fx.ins[i];
  if (!sl) { host.appendChild(el('p', 'help', 'No insert effect selected. Add one with the + block above.')); return; }
  const path = 'fx.ins.' + i, e = TFX.byId(sl.type);
  const bar = el('div', 'fxbar');
  const on = el('label', 'tog'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!sl.on;
  cb.addEventListener('change', () => { setP(path + '.on', cb.checked ? 1 : 0); renderPage(); }); on.append(cb, document.createTextNode('On'));
  bar.appendChild(on);
  bar.appendChild(fxTypeSelect(sl.type, ['S1', 'S2', 'S4'], id => { const l = clone(fx.ins); l[i] = { on: l[i].on, type: id, p: TFX.defaults(id) }; fxSetIns(l); }, 'Insert effect ' + (i + 1) + ' type'));
  const mv = (t, fn, dis) => { const b = el('button', 'hw sm', t); b.type = 'button'; b.disabled = !!dis; b.addEventListener('click', fn); bar.appendChild(b); };
  mv('← Earlier', () => { const l = clone(fx.ins); [l[i - 1], l[i]] = [l[i], l[i - 1]]; fxSel = 'i' + (i - 1); fxSetIns(l); }, i === 0);
  mv('Later →', () => { const l = clone(fx.ins); [l[i + 1], l[i]] = [l[i], l[i + 1]]; fxSel = 'i' + (i + 1); fxSetIns(l); }, i >= fx.ins.length - 1);
  mv('Remove', () => { const l = clone(fx.ins); l.splice(i, 1); fxSel = 'i' + Math.max(0, i - 1); fxSetIns(l); });
  host.appendChild(bar);
  if (e) host.appendChild(el('p', 'help', 'Size ' + TFX.SIZE[e.grp] + (e.grp === 'S1' ? ': mono in and out (the dry sound turns mono too, as on the Trinity).' : ': stereo.') + (sl.type === 'S4:4' ? ' The modulator is a microphone when one is allowed (the button below; the Claude page itself blocks microphones), otherwise the synth itself.' : '')));
  if (sl.type === 'S4:4') { const b = el('button', 'hw', micStream ? 'Microphone on' : 'Use microphone as modulator'); b.type = 'button'; b.addEventListener('click', async () => { await setMic(!micStream); renderPage(); }); host.appendChild(b); }
  fxParams(host, path, sl.type);
}
function renderFxMaster(host, which) {
  const fx = patch.fx, M = fx[which], path = 'fx.' + which, grp = which === 'm1' ? 'MM' : 'MR';
  const bar = el('div', 'fxbar');
  const on = el('label', 'tog'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!M.on;
  cb.addEventListener('change', () => { setP(path + '.on', cb.checked ? 1 : 0); renderPage(); renderFlow(); }); on.append(cb, document.createTextNode('On'));
  bar.append(on, fxTypeSelect(M.type, [grp], id => { const m = clone(M); m.type = id; m.p = TFX.defaults(id); setP(path, m); renderPage(); }, (which === 'm1' ? 'Master effect 1' : 'Master effect 2') + ' type'));
  host.appendChild(bar);
  const g = el('div', 'grid');
  g.appendChild(mkCtl(S(path + '.ret', 'Return', 0, 127)));
  if (which === 'm1') g.appendChild(mkCtl(TOG(path + '.cascade', 'Cascade into Master 2')));
  host.appendChild(g);
  fxParams(host, path, M.type, true);
}
function pageFX() {
  const fx = patch.fx, uses = fx.ins.some(sl => sl && sl.type) || !!fx.ifxRoute;
  if (!/^(i\d|m1|m2|eq)$/.test(fxSel) || (fxSel[0] === 'i' && !fx.ins[Number(fxSel.slice(1))])) fxSel = fx.ins.length ? 'i0' : 'm2';
  const secs = [{ title: 'Routing', custom: renderFxRouting, help: patch.help || '' }];
  if (fxSel[0] === 'i') secs.push({ title: 'Insert effect ' + (Number(fxSel.slice(1)) + 1), custom: renderFxSlot });
  else if (fxSel === 'm1') secs.push({ title: 'Master Effect 1 · modulation', custom: h => renderFxMaster(h, 'm1'), help: 'Mono in, stereo out. It returns only the effect sound; Send 1 sets how much reaches it.' });
  else if (fxSel === 'm2') secs.push({ title: 'Master Effect 2 · reverb and delay', custom: h => renderFxMaster(h, 'm2'), help: 'Mono in, stereo out. It returns only the effect sound; Send 2 sets how much reaches it.' });
  else secs.push({ title: 'Master EQ', controls: [S('fx.eqLo', 'Low gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' }), S('fx.eqHi', 'High gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' })], help: 'Gentle shelving EQ on the final output, around ' + (fx.eqLoF || 80) + ' Hz and ' + (fx.eqHiF || 12000) / 1000 + ' kHz. Korg does not publish the exact corner frequencies, so these are estimates.' });
  if (fxSourcesUsed().length) secs.push({ title: 'Controllers used by these effects', custom: renderFxControllers, help: 'These effects follow controllers that have no control on this screen. Move them here, or send the MIDI CC from your keyboard.' });
  secs.push({ title: uses ? 'After the inserts' : 'Program output', controls: uses
    ? [S('fx.ifxPan', 'Pan', 0, 127, { fmt: F.pan }), S('fx.ifxWidth', 'Width', 0, 127), S('fx.ifxSend1', 'Send 1 (to Master 1)', 0, 127), S('fx.ifxSend2', 'Send 2 (to Master 2)', 0, 127)]
    : [S('fx.send1', 'Send 1 (to Master 1)', 0, 127), S('fx.send2', 'Send 2 (to Master 2)', 0, 127)],
    help: uses ? 'With insert effects in use, the pan, width and sends after them apply (the program’s own sends are ignored), as on the Trinity.' : 'With no insert effects, the program’s pan (Program page) and these sends apply.' });
  return secs;
}
const PAGES = { program: ['Program', pageProgram], osc0: ['OSC 1', () => pageOsc(0)], osc1: ['OSC 2', () => pageOsc(1)], subnoise: ['Sub + Noise', pageSubNoise], mixer: ['Mixer', pageMixer],
  filter: ['Filter', pageFilter], amp: ['Amp', pageAmp], eg: ['EG 1\u20134', pageEG], lfo: ['LFO 1\u20134', pageLFO], mod: ['Mod', pageMod], fx: ['Effects', pageFX], scale: ['Scale', pageScale] };

// ---------------- Trinity PCM program pages ----------------
// Values are shown as the Trinity shows them (0-99, -99..+99 ...); the dot-separated part is this model's estimate.
const K = {
  n: v => String(v), sgn: v => (v > 0 ? '+' : '') + v,
  time: v => F.time(v),
  cut: v => { const h = PCM.cutHz(v, 48000); return v + ' · ' + (h < 1000 ? Math.round(h) + ' Hz' : (h / 1000).toFixed(1) + ' kHz'); },
  lfo: v => { const h = PCM.lfoHz(v); return v + ' · ' + (h < 10 ? h.toFixed(2) : h.toFixed(1)) + ' Hz'; },
  pint: v => (v >= 0 ? '+' : '') + Number(v).toFixed(2),
  oct: v => ({ '-2': "32'", '-1': "16'", '0': "8'", '1': "4'" })[v], semis: v => (v > 0 ? '+' : '') + v,
  cents: v => (v > 0 ? '+' : '') + v + ' ct', slope: v => (v >= 0 ? '+' : '') + Number(v).toFixed(1),
  delay: v => v < 0 ? 'Key off' : v + ' ms', pan: v => v < 0 ? 'Off' : F.pan(v)
};
const pcmAms = i => KORG_PCM.AMS.map((a, k) => [a, KORG_PCM.AMS_NAME[k]]).slice(0, i === 1 ? 27 : 23);
const MS_OPTS = () => PCM_MS_NAMES.map((n, i) => [i, String(i).padStart(3, '0') + ' ' + n]);
const standinName = id => { const e = PCM_STANDIN.ms[id]; if (!e) return 'placeholder'; if (e.syn) return 'built-in ' + e.syn + ' wave'; if (/^kit/.test(e.p)) return e.p.replace('kit_', '') + ' kit, key ' + e.k; return 'General MIDI ' + (parseInt(e.p.slice(2), 10) + 1) + (e.r ? ' (shifted ' + e.r + ' st)' : ''); };
function pcmPageProgram() {
  const P = patch, secs = [
    { title: 'Program', controls: [
      { k: 'txt', path: 'name', label: 'Name' },
      SEL('mode', 'Oscillator mode', [['single', 'Single'], ['double', 'Double'], ['drum', 'Drums']], { rerender: true }),
      SEL('voice.mode', 'Key assign', [['poly', 'Poly'], ['monoSingle', 'Mono, legato'], ['monoMulti', 'Mono']]),
      SEL('voice.priority', 'Key priority (mono)', [['last', 'Last'], ['low', 'Low'], ['high', 'High']]),
      TOG('voice.hold', 'Hold'), TOG('voice.piano', 'Poly assign: Piano'),
      S('osc2Vel', 'OSC 2 bottom velocity', 1, 127, { fmt: K.n }),
      SEL('random', 'Random pitch', [[0, 'Off'], [1 / 64, '±1/64'], [1 / 32, '±1/32'], [1 / 16, '±1/16'], [1 / 8, '±1/8'], [1 / 4, '±1/4'], [1 / 2, '±1/2'], [1, '±1']], { num: true })] },
    { title: 'Pitch EG', controls: [S('peg.startL', 'Start level', -99, 99, { fmt: K.sgn }), S('peg.atkT', 'Attack time', 0, 99, { fmt: K.time }), S('peg.atkL', 'Attack level', -99, 99, { fmt: K.sgn }),
      S('peg.decT', 'Decay time', 0, 99, { fmt: K.time }), S('peg.relT', 'Release time', 0, 99, { fmt: K.time }), S('peg.relL', 'Release level', -99, 99, { fmt: K.sgn }),
      S('peg.velT', 'Time by velocity', -99, 99, { fmt: K.sgn }), SEL('peg.tSrc', 'Time A.M. source', pcmAms(0)), S('peg.tInt', 'Time A.M. intensity', -99, 99, { fmt: K.sgn })],
      help: 'Each oscillator sets how far this EG bends its pitch (OSC pages, EG intensity).' }];
  if (P.mode === 'drum') secs.push({ title: 'Drum kit', custom: renderKitPick });
  secs.push({ title: 'Program memory', custom: renderMemory });
  secs.push({ title: 'Imported from Trinity', custom: renderImportInfo });
  return secs;
}
function renderKitPick(host) {
  const src = prog.bank === 'pc' ? pcmBanks[Math.floor(prog.idx / 128)] : null, kits = src ? kitsOf(src.set) : [];
  const row = el('div', 'grid'), w = el('label', 'ctl'), s = el('select');
  w.append(el('span', 'nm', 'Kit'), el('span'), s);
  if (kits.length) kits.forEach((k, i) => { const o = el('option', null, String(i).padStart(2, '0') + ' ' + k.name); o.value = i; s.appendChild(o); });
  else { const o = el('option', null, patch.kitData ? patch.kitData.name : 'No kit'); o.value = patch.kit; s.appendChild(o); s.disabled = true; }
  s.value = String(patch.kit);
  s.addEventListener('change', () => { patch.kit = Number(s.value); patch.kitData = kits[patch.kit] || null; edited = true; lcd(); saveCurrent(); pcmPrepare(patch); send({ t: 'patch', p: clone(patch) }); });
  row.appendChild(w); host.appendChild(row);
  host.appendChild(el('p', 'help', 'Drum kits come from the same PCG file as the program. Each key plays one of Korg’s drum samples; the program’s filters and amp EG shape it. Korg’s samples are not available, so each one is played by the General MIDI drum sound that matches where Korg’s factory kits place it (an estimate: the real sample may differ).'));
  const K = patch.kitData; if (!K) return;
  const wrap = el('div', 'kitwrap'), t = el('table', 'kit'), hd = el('tr');
  ['Key', 'Drum sample', 'Stand-in', 'Level', 'Tune', 'Pan'].forEach(x => hd.appendChild(el('th', null, x))); t.appendChild(hd);
  const sd = d => { if (d >= 0x1000) return 'RAM ' + (d & 0xfff); const e = PCM_STANDIN.ds[d]; return e ? (GM_DRUMS[e.k - 27] || 'key ' + e.k) + (e.p !== 'kit_std' ? ' (' + e.p.slice(4) + ')' : '') : 'conga'; };
  K.keys.forEach((q, j) => {
    if (q.hi <= 0 && q.lo <= 0) return;
    const tr = el('tr'), two = q.lo >= 0 && q.lo !== q.hi && q.velSplit > 1;
    [F.note(21 + j), '#' + (q.hi >= 0x1000 ? 'RAM' + (q.hi & 0xfff) : q.hi) + (two ? ' / #' + q.lo : ''), sd(q.hi) + (two && sd(q.lo) !== sd(q.hi) ? ' / ' + sd(q.lo) : ''), sgn(q.hiLvl), q.hiTune ? sgn(q.hiTune) : '0', q.pan > 127 ? 'off' : F.pan(q.pan)]
      .forEach(x => tr.appendChild(el('td', null, String(x))));
    t.appendChild(tr);
  });
  wrap.appendChild(t); host.appendChild(wrap);
}
// General MIDI / GS drum names for keys 27..87 (the stand-in drum sounds)
const GM_DRUMS = ['High Q', 'Slap', 'Scratch push', 'Scratch pull', 'Sticks', 'Square click', 'Metronome click', 'Metronome bell', 'Kick 2', 'Kick 1', 'Side stick', 'Snare 1', 'Hand clap', 'Snare 2', 'Low floor tom', 'Closed hi-hat', 'High floor tom', 'Pedal hi-hat', 'Low tom', 'Open hi-hat', 'Low-mid tom', 'High-mid tom', 'Crash 1', 'High tom', 'Ride 1', 'China cymbal', 'Ride bell', 'Tambourine', 'Splash', 'Cowbell', 'Crash 2', 'Vibraslap', 'Ride 2', 'High bongo', 'Low bongo', 'Mute high conga', 'Open high conga', 'Low conga', 'High timbale', 'Low timbale', 'High agogo', 'Low agogo', 'Cabasa', 'Maracas', 'Short whistle', 'Long whistle', 'Short guiro', 'Long guiro', 'Claves', 'High wood block', 'Low wood block', 'Mute cuica', 'Open cuica', 'Mute triangle', 'Open triangle', 'Shaker', 'Jingle bell', 'Bell tree', 'Castanets', 'Mute surdo', 'Open surdo'];
function pcmPageOsc(i) {
  const P = patch, b = 'o.' + i + '.', O = P.o[i], drum = P.mode === 'drum';
  if (i === 1 && P.mode !== 'double') return [{ title: 'Oscillator 2', note: 'Used only in Double mode', controls: [] }];
  const secs = [];
  if (!drum) secs.push({ title: 'Multisample', controls: [SEL(b + 'msHi', 'High multisample', MS_OPTS(), { num: true, rerender: true }), S(b + 'lvlHi', 'High level', 0, 127, { fmt: K.n }), TOG(b + 'offHi', 'High: offset start'),
    SEL(b + 'msLo', 'Low multisample', MS_OPTS(), { num: true, rerender: true }), S(b + 'lvlLo', 'Low level', 0, 127, { fmt: K.n }), TOG(b + 'offLo', 'Low: offset start'),
    S(b + 'velSplit', 'High from velocity', 1, 127, { fmt: K.n })],
    help: 'Stand-ins: high → ' + standinName(O.msHi) + '; low → ' + standinName(O.msLo) + '. Korg’s own samples are not available.' });
  secs.push({ title: 'Pitch', controls: [S(b + 'octave', 'Octave', -2, 1, { fmt: K.oct }), S(b + 'transpose', 'Transpose', -12, 12, { fmt: K.semis }), S(b + 'tune', 'Tune', -1200, 1200, { fmt: K.cents }),
    S(b + 'delay', 'Delay start', -1, 5000, { fmt: K.delay, step: 2 }), S(b + 'pitch.slope', 'Pitch slope', -1, 2, { fmt: K.slope, step: 0.1 }),
    S(b + 'pitch.egInt', 'Pitch EG intensity', -12, 12, { fmt: K.pint, step: 0.01 }), S(b + 'pitch.egVel', 'EG intensity by velocity', -99, 99, { fmt: K.sgn }),
    SEL(b + 'pitch.egAmsSrc', 'EG intensity A.M.', pcmAms(i)), S(b + 'pitch.egAmsInt', 'EG intensity A.M. amount', -12, 12, { fmt: K.pint, step: 0.01 }),
    S(b + 'pitch.ribbon', 'Ribbon', -12, 12, { fmt: K.semis }), S(b + 'pitch.jsUp', 'Joystick +X', -60, 12, { fmt: K.semis }), S(b + 'pitch.jsDown', 'Joystick −X', -60, 12, { fmt: K.semis }),
    SEL(b + 'pitch.amsSrc', 'Pitch A.M. source', pcmAms(i)), S(b + 'pitch.amsInt', 'Pitch A.M. intensity', -12, 12, { fmt: K.pint, step: 0.01 })] });
  secs.push({ title: 'OSC LFO (vibrato)', controls: [SEL(b + 'lfo.wave', 'Waveform', KORG_PCM.LFOW.map((w, k) => [w, KORG_PCM.LFOW_NAME[k]])), SEL(b + 'lfo.start', 'Start', [['on', 'Note on'], ['off', 'Note off'], ['both', 'On, stops at note off']]),
    TOG(b + 'lfo.sync', 'Key sync'), S(b + 'lfo.freq', 'Frequency', 0, 99, { fmt: K.lfo }), S(b + 'lfo.offset', 'Offset', -99, 99, { fmt: K.sgn }), S(b + 'lfo.delay', 'Delay', 0, 99, { fmt: K.time }), S(b + 'lfo.fade', 'Fade', -99, 99, { fmt: K.sgn }),
    S(b + 'lfo.kbd', 'Speed by key', -99, 99, { fmt: K.sgn }), S(b + 'lfo.jsy', 'Speed by joystick +Y', 0, 99, { fmt: K.n }), SEL(b + 'lfo.fmSrc', 'Speed A.M.', pcmAms(i)), S(b + 'lfo.fmInt', 'Speed A.M. amount', -99, 99, { fmt: K.sgn }),
    S(b + 'pitch.lfoInt', 'Pitch intensity', -12, 12, { fmt: K.pint, step: 0.01 }), S(b + 'lfoPitch.jsy', 'Intensity by joystick +Y', 0, 99, { fmt: K.n }), S(b + 'lfoPitch.at', 'Intensity by aftertouch', 0, 99, { fmt: K.n }),
    SEL(b + 'lfoPitch.amsSrc', 'Intensity A.M.', pcmAms(i)), S(b + 'lfoPitch.amsInt', 'Intensity A.M. amount', -12, 12, { fmt: K.pint, step: 0.01 })] });
  secs.push({ title: 'Pan and sends', controls: [S(b + 'pan', 'Pan', -1, 127, { fmt: K.pan }), SEL(b + 'panSrc', 'Pan A.M.', pcmAms(i)), S(b + 'panInt', 'Pan A.M. amount', -99, 99, { fmt: K.sgn }),
    S(b + 'send1', 'Send 1', 0, 127, { fmt: K.n }), S(b + 'send2', 'Send 2', 0, 127, { fmt: K.n })] });
  return secs;
}
function pcmPageFilter(i) {
  const P = patch, b = 'o.' + i + '.', O = P.o[i];
  if (i === 1 && P.mode !== 'double') return [{ title: 'Filter 2', note: 'Used only in Double mode', controls: [] }];
  const ft = [['lpf', 'Low pass'], ['hpf', 'High pass'], ['bpf', 'Band pass'], ['brf', 'Band reject']];
  const typeSel = k => ({ k: 'sel', path: b + 'ftype.' + k, label: 'Filter ' + 'AB'[k] + ' type', opts: ft, rerender: true });
  const secs = [{ title: 'Filters', controls: [SEL(b + 'route', 'Routing', [['single', 'Single (A)'], ['serial', 'Serial (A then B)'], ['parallel', 'Parallel'], ['thru', 'Through (off)']], { rerender: true }), typeSel(0), typeSel(1)],
    help: 'Cutoff values follow the Trinity; the kHz figures are this model’s estimate (0 ≈ 250 Hz, 99 ≈ 20 kHz).' }];
  [0, 1].forEach(k => {
    if (k === 1 && O.route === 'single') return;
    const f = b + 'f.' + k + '.';
    secs.push({ title: 'Filter ' + 'AB'[k], controls: [S(f + 'cut', 'Cutoff', 0, 99, { fmt: K.cut }), S(f + 'gain', 'Input gain', 0, 99, { fmt: K.n }), S(f + 'reso', 'Resonance', 0, 31, { fmt: K.n }), S(f + 'resoVel', 'Resonance by velocity', -99, 99, { fmt: K.sgn }),
      S(f + 'egInt', 'Filter EG intensity', -99, 99, { fmt: K.sgn }), S(f + 'egVel', 'EG intensity by velocity', -99, 99, { fmt: K.sgn }), S(f + 'lfoInt', 'Filter LFO intensity', -99, 99, { fmt: K.sgn }),
      S(f + 'jsx', 'Joystick X', -99, 99, { fmt: K.sgn }), S(f + 'at', 'Aftertouch', 0, 99, { fmt: K.n }),
      S(f + 'lowKey', 'Key track low key', 0, 127, { fmt: F.note }), S(f + 'highKey', 'Key track high key', 0, 127, { fmt: F.note }), S(f + 'lowRamp', 'Lower ramp', -99, 99, { fmt: K.sgn }), S(f + 'highRamp', 'Higher ramp', -99, 99, { fmt: K.sgn }),
      SEL(f + 'amsSrc', 'Cutoff A.M.', pcmAms(i)), S(f + 'amsInt', 'Cutoff A.M. amount', -99, 99, { fmt: K.sgn })] });
  });
  const e = b + 'feg.';
  secs.push({ title: 'Filter EG', eg: b + 'feg', controls: [S(e + 'startL', 'Start level', -99, 99, { fmt: K.sgn }), S(e + 'atkT', 'Attack time', 0, 99, { fmt: K.time }), S(e + 'atkL', 'Attack level', -99, 99, { fmt: K.sgn }),
    S(e + 'decT', 'Decay time', 0, 99, { fmt: K.time }), S(e + 'brkL', 'Break point level', -99, 99, { fmt: K.sgn }), S(e + 'slpT', 'Slope time', 0, 99, { fmt: K.time }), S(e + 'susL', 'Sustain level', -99, 99, { fmt: K.sgn }),
    S(e + 'relT', 'Release time', 0, 99, { fmt: K.time }), S(e + 'relL', 'Release level', -99, 99, { fmt: K.sgn })] });
  secs.push({ title: 'Filter EG modulation', controls: ['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'kt.' + k, n + ' time by key', -99, 99, { fmt: K.sgn }))
    .concat(['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'vt.' + k, n + ' time by velocity', -99, 99, { fmt: K.sgn })))
    .concat([SEL(e + 'tSrc', 'Time A.M.', pcmAms(i)), S(e + 'tInt', 'Time A.M. amount', -99, 99, { fmt: K.sgn })])
    .concat(['Start', 'Attack', 'Break point'].map((n, k) => S(e + 'lv.' + k, n + ' level by velocity', -99, 99, { fmt: K.sgn })))
    .concat([SEL(b + 'fegAms.src', 'EG intensity A.M.', pcmAms(i)), S(b + 'fegAms.int', 'EG intensity A.M. amount', -99, 99, { fmt: K.sgn })]) });
  const l = b + 'flfo.';
  secs.push({ title: 'Filter LFO', controls: [SEL(l + 'wave', 'Waveform', KORG_PCM.LFOW.map((w, k) => [w, KORG_PCM.LFOW_NAME[k]])), SEL(l + 'start', 'Start', [['on', 'Note on'], ['off', 'Note off'], ['both', 'On, stops at note off']]),
    TOG(l + 'sync', 'Key sync'), S(l + 'freq', 'Frequency', 0, 99, { fmt: K.lfo }), S(l + 'offset', 'Offset', -99, 99, { fmt: K.sgn }), S(l + 'delay', 'Delay', 0, 99, { fmt: K.time }), S(l + 'fade', 'Fade', -99, 99, { fmt: K.sgn }),
    SEL(l + 'fmSrc', 'Speed A.M.', pcmAms(i)), S(l + 'fmInt', 'Speed A.M. amount', -99, 99, { fmt: K.sgn }),
    S(b + 'flfoMod.jsyn', 'Intensity by joystick −Y', 0, 99, { fmt: K.n }), S(b + 'flfoMod.at', 'Intensity by aftertouch', 0, 99, { fmt: K.n }),
    SEL(b + 'flfoMod.amsSrc', 'Intensity A.M.', pcmAms(i)), S(b + 'flfoMod.amsInt', 'Intensity A.M. amount', -99, 99, { fmt: K.sgn })] });
  return secs;
}
function pcmPageAmp(i) {
  const P = patch, b = 'o.' + i + '.', a = b + 'amp.', e = b + 'aeg.';
  if (i === 1 && P.mode !== 'double') return [{ title: 'Amp 2', note: 'Used only in Double mode', controls: [] }];
  return [{ title: 'Amp', controls: [S(a + 'level', 'Level', 0, 127, { fmt: K.n }), S(a + 'vel', 'Level by velocity', -99, 99, { fmt: K.sgn }), S(a + 'at', 'Level by aftertouch', -99, 99, { fmt: K.sgn }),
    SEL(a + 'amsSrc', 'Level A.M.', pcmAms(i)), S(a + 'amsInt', 'Level A.M. amount', -99, 99, { fmt: K.sgn }),
    S(a + 'lowKey', 'Key track low key', 0, 127, { fmt: F.note }), S(a + 'highKey', 'Key track high key', 0, 127, { fmt: F.note }), S(a + 'lowRamp', 'Lower ramp', -99, 99, { fmt: K.sgn }), S(a + 'highRamp', 'Higher ramp', -99, 99, { fmt: K.sgn })] },
  { title: 'Amp EG', eg: b + 'aeg', isAmp: true, controls: [S(e + 'startL', 'Start level', 0, 99, { fmt: K.n }), S(e + 'atkT', 'Attack time', 0, 99, { fmt: K.time }), S(e + 'atkL', 'Attack level', 0, 99, { fmt: K.n }),
    S(e + 'decT', 'Decay time', 0, 99, { fmt: K.time }), S(e + 'brkL', 'Break point level', 0, 99, { fmt: K.n }), S(e + 'slpT', 'Slope time', 0, 99, { fmt: K.time }), S(e + 'susL', 'Sustain level', 0, 99, { fmt: K.n }),
    S(e + 'relT', 'Release time', 0, 99, { fmt: K.time })] },
  { title: 'Amp EG modulation', controls: ['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'kt.' + k, n + ' time by key', -99, 99, { fmt: K.sgn }))
    .concat(['Attack', 'Decay', 'Slope', 'Release'].map((n, k) => S(e + 'vt.' + k, n + ' time by velocity', -99, 99, { fmt: K.sgn })))
    .concat([SEL(e + 'tSrc', 'Time A.M.', pcmAms(i)), S(e + 'tInt', 'Time A.M. amount', -99, 99, { fmt: K.sgn })])
    .concat(['Start', 'Attack', 'Break point'].map((n, k) => S(e + 'lv.' + k, n + ' level by velocity', -99, 99, { fmt: K.sgn }))) }];
}
const PAGES_PCM = { program: ['Program', pcmPageProgram], osc0: ['OSC 1', () => pcmPageOsc(0)], osc1: ['OSC 2', () => pcmPageOsc(1)], filter0: ['Filter 1', () => pcmPageFilter(0)], filter1: ['Filter 2', () => pcmPageFilter(1)],
  amp0: ['Amp 1', () => pcmPageAmp(0)], amp1: ['Amp 2', () => pcmPageAmp(1)], fx: ['Effects', pageFX], scale: ['Scale', pageScale] };
// ---------------- Trinity combination pages ----------------
let curTimbre = 0;
const TSTAT = { int: 'On', off: 'Off', ext: 'External', both: 'Both' };
const tPlays = t => !!t && !!t.p && (t.status === 'int' || t.status === 'both') && (t.ch === 16 || t.ch === 0);
const tLabel = (t, k) => 'T' + (k + 1) + ' ' + (t.pLabel || '') + (t.pName ? ' ' + t.pName : '');
const zoneTxt = t => (t.keyBot > 0 || t.keyTop < 127 ? F.note(t.keyBot) + '–' + F.note(t.keyTop) : 'all keys');
function combiStatus() {
  const C = patch, on = C.timbres.filter(tPlays), miss = C.timbres.filter(t => t.status !== 'off' && !t.p);
  return 'Combination: ' + on.length + (on.length === 1 ? ' timbre plays' : ' timbres play') + ' from the keyboard' + (miss.length ? '; ' + miss.length + ' use a program this file does not have (silent)' : '') + '. PCM timbres play stand-in samples.';
}
function renderTimbreTable(host) {
  const wrap = el('div', 'kitwrap'), t = el('table', 'kit'), hd = el('tr');
  ['', 'Program', 'Status', 'MIDI', 'Level', 'Pan', 'Transpose', 'Keys', 'Velocity', 'Insert FX'].forEach(x => hd.appendChild(el('th', null, x))); t.appendChild(hd);
  patch.timbres.forEach((tb, k) => {
    const tr = el('tr', 'trow' + (k === curTimbre ? ' sel' : '') + (tPlays(tb) ? '' : ' dim'));
    const fx = tb.chain >= 0 ? 'chain ' + (tb.chain + 1) : tb.status === 'off' ? '' : 'none';
    ['T' + (k + 1), (tb.pLabel || '') + ' ' + (tb.pName || (tb.status !== 'off' ? '(not in this file)' : '')), TSTAT[tb.status] || tb.status, tb.ch === 16 ? 'Global' : 'Ch ' + (tb.ch + 1),
      tb.level, tb.pan === 'prog' ? 'Program' : tb.pan < 0 ? 'Off' : F.pan(tb.pan), sgn(tb.transpose), zoneTxt(tb), tb.velBot + '–' + tb.velTop, fx].forEach(x => tr.appendChild(el('td', null, String(x))));
    tr.tabIndex = 0; tr.title = 'Edit timbre ' + (k + 1);
    const go = () => { curTimbre = k; selectPage('timbre'); };
    tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    t.appendChild(tr);
  });
  wrap.appendChild(t); host.appendChild(wrap);
}
function combiPageMain() {
  return [{ title: 'Combination', controls: [{ k: 'txt', path: 'name', label: 'Name' }] },
    { title: 'Timbres', custom: renderTimbreTable, help: 'Only timbres that are On and on the Global channel (or channel 1) answer the keyboard; a timbre on another MIDI channel waits for that channel, as on the Trinity. Tap a row to edit the timbre.' },
    { title: 'Program memory', custom: renderMemory },
    { title: 'Imported from Trinity', custom: renderImportInfo }];
}
function renderTimbrePick(host) {
  const row = el('div', 'btnrow');
  patch.timbres.forEach((t, k) => { const b = el('button', 'hw sm' + (k === curTimbre ? ' on' : ''), 'T' + (k + 1)); b.type = 'button'; b.setAttribute('aria-pressed', k === curTimbre ? 'true' : 'false'); if (!tPlays(t)) b.style.opacity = '0.55'; b.addEventListener('click', () => { curTimbre = k; renderPage(); renderFlow(); }); row.appendChild(b); });
  host.appendChild(row);
}
// the timbre's program: any program of the same PCG file (its PCM banks, and its Bank M on a V3 file)
function renderTimbreProgram(host) {
  const t = patch.timbres[curTimbre], cb = combiBanks[Math.floor(prog.idx / 128)], set = prog.bank === 'cb' && cb ? cb.set : null;
  const w = el('label', 'ctl'), s = el('select');
  w.append(el('span', 'nm', 'Program'), el('span'), s);
  if (!set) { const o = el('option', null, t.pLabel + ' ' + (t.pName || '')); s.appendChild(o); s.disabled = true; }
  else {
    pcmBanks.forEach((b, bi) => { if (b.set !== set) return; const g = el('optgroup'); g.label = 'Bank ' + b.letter; b.names.forEach((n, i) => { const o = el('option', null, b.letter + pad3(i) + ' ' + n); o.value = 'ABCD'.indexOf(b.letter) + ':' + i; g.appendChild(o); }); s.appendChild(g); });
    const mb = pcgBanks.find(x => x.name === set.name && x.fmt !== 'triton');
    if (mb) { const g = el('optgroup'); g.label = 'Bank M (MOSS)'; mb.names.forEach((n, i) => { const o = el('option', null, 'M' + pad3(i) + ' ' + n); o.value = '4:' + i; g.appendChild(o); }); s.appendChild(g); }
    s.value = t.bank + ':' + t.prog;
    s.addEventListener('change', () => {
      const [bk, pg] = s.value.split(':').map(Number); t.bank = bk; t.prog = pg; timbreProgram(set, t);
      edited = true; lcd(); saveCurrent(); pcmPrepare(patch); send({ t: 'patch', p: clone(patch) }); renderPage(); renderFlow();
    });
  }
  host.appendChild(w);
  if (t.p) {
    const open = el('button', 'hw sm', 'Open this program'); open.type = 'button';
    open.addEventListener('click', () => { const [b, i] = t.pId.split(':'); loadProgram(b, Number(i)); });
    if (t.pId) host.appendChild(open);
  }
}
function combiPageTimbre() {
  const k = curTimbre, t = patch.timbres[k], b = 'timbres.' + k + '.';
  const secs = [{ title: 'Timbre', custom: renderTimbrePick }, { title: 'Timbre ' + (k + 1) + ' program', custom: renderTimbreProgram }];
  const c = [SEL(b + 'status', 'Status', [['int', 'On (INT)'], ['off', 'Off'], ['ext', 'External only'], ['both', 'Both']], { rerender: true }),
    SEL(b + 'ch', 'MIDI channel', [[16, 'Global']].concat([...Array(16)].map((_, i) => [i, 'Channel ' + (i + 1)])), { num: true, rerender: true }),
    S(b + 'level', 'Level', 0, 127, { fmt: K.n })];
  if (typeof t.pan === 'number' && t.pan >= 0) c.push(S(b + 'pan', 'Pan', 0, 127, { fmt: F.pan }));
  c.push(S(b + 'transpose', 'Transpose', -24, 24, { fmt: K.semis }), S(b + 'detune', 'Detune', -99, 99, { fmt: K.cents }));
  if (t.bend !== null && t.bend !== undefined) c.push(S(b + 'bend', 'Pitch bend range', -24, 24, { fmt: K.semis }));
  if (typeof t.send1 === 'number') c.push(S(b + 'send1', 'Send 1', 0, 127, { fmt: K.n }));
  if (typeof t.send2 === 'number') c.push(S(b + 'send2', 'Send 2', 0, 127, { fmt: K.n }));
  c.push(TOG(b + 'hideOsc2', 'Hide OSC 2 (Double programs)'), TOG(b + 'forcePoly', 'Force poly (Mono programs)'));
  const notes = [];
  if (t.pan === 'prog') notes.push('pan: the program’s'); if (t.bend === null || t.bend === undefined) notes.push('bend range: the program’s');
  if (t.send1 === 'prog' || t.send2 === 'prog') notes.push('sends: the program’s');
  secs.push({ title: 'Mix', controls: c, help: (notes.length ? 'This timbre uses ' + notes.join(', ') + '. ' : '') + (t.chain >= 0 ? 'It plays through insert chain ' + (t.chain + 1) + ' (Effects page), whose sends apply instead of its own.' : 'It has no insert effect.') });
  secs.push({ title: 'Key and velocity zones', controls: [S(b + 'keyBot', 'Lowest key', 0, 127, { fmt: F.note }), S(b + 'keyTop', 'Highest key', 0, 127, { fmt: F.note }),
    S(b + 'keySlopeBot', 'Fade in above lowest key', 0, 72, { fmt: v => v + ' st' }), S(b + 'keySlopeTop', 'Fade out below highest key', 0, 72, { fmt: v => v + ' st' }),
    S(b + 'velBot', 'Lowest velocity', 1, 127, { fmt: K.n }), S(b + 'velTop', 'Highest velocity', 1, 127, { fmt: K.n }),
    S(b + 'velSlopeBot', 'Fade in above lowest velocity', 0, 120, { fmt: K.n }), S(b + 'velSlopeTop', 'Fade out below highest velocity', 0, 120, { fmt: K.n })],
    help: 'The timbre plays only inside its zones; the fades soften it toward each edge.' });
  return secs;
}
function renderCombiRouting(host) {
  const C = patch, box = el('div', 'fxroute');
  const chip = (txt, sub, key, off, cls) => { const c = el('button', 'fxchip' + (cls ? ' ' + cls : '') + (off ? ' off' : '') + (fxSel === key ? ' sel' : '')); c.type = 'button'; c.appendChild(el('b', null, txt)); if (sub) c.appendChild(el('span', null, sub)); if (key) c.addEventListener('click', () => { fxSel = key; renderPage(); }); else c.disabled = true; return c; };
  const arrow = t => el('span', 'fxarr', t || '→');
  (C.chains || []).forEach((ch, c) => {
    const r = el('div', 'fxrow');
    r.append(chip('Chain ' + (c + 1), ch.timbres.map(k => 'T' + (k + 1)).join(' + '), null, false, 'src'), arrow());
    ch.blocks.forEach(k => { const B = C.blocks[k], e = B && TFX.byId(B.type); r.append(chip('IFX ' + (k + 1), e ? e.name : 'unknown', B ? 'b' + k : null, !B || !B.on), arrow()); });
    r.append(chip('Pan / width', F.pan(ch.pan < 0 ? 64 : ch.pan), null), arrow(), chip('OUT', 'send 1: ' + ch.send1 + ', send 2: ' + ch.send2, null, false, 'src'));
    box.appendChild(r);
  });
  const dry = C.timbres.map((t, k) => (t.status !== 'off' && t.chain < 0 ? k : -1)).filter(k => k >= 0);
  if (dry.length) { const r = el('div', 'fxrow'); r.append(chip('No insert', dry.map(k => 'T' + (k + 1)).join(' + '), null, false, 'src'), arrow(), chip('OUT', 'each timbre’s sends', null, false, 'src')); box.appendChild(r); }
  const fx = C.fx, m1 = TFX.byId(fx.m1.type), m2 = TFX.byId(fx.m2.type), r2 = el('div', 'fxrow sub');
  r2.append(el('span', 'fxarr', '↳ Send 1'), chip('Master 1', m1 ? m1.name : '?', 'm1', !fx.m1.on), el('span', 'fxarr', '↳ Send 2'), chip('Master 2', m2 ? m2.name : '?', 'm2', !fx.m2.on), arrow(), chip('EQ', (fx.eqLo || fx.eqHi) ? 'L ' + F.sgn(fx.eqLo) + ' / H ' + F.sgn(fx.eqHi) + ' dB' : 'flat', 'eq'));
  box.appendChild(r2); host.appendChild(box);
  host.appendChild(el('p', 'help', 'A combination has 8 insert effect blocks, shared out as chains to its timbres, and the two master effects. Tap a block to edit it.'));
}
function renderCombiBlock(host) {
  const k = Number(fxSel.slice(1)), B = patch.blocks[k]; if (!B) return;
  const path = 'blocks.' + k, e = TFX.byId(B.type);
  const bar = el('div', 'fxbar'), on = el('label', 'tog'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!B.on;
  cb.addEventListener('change', () => { setP(path + '.on', cb.checked ? 1 : 0); renderPage(); }); on.append(cb, document.createTextNode('On'));
  bar.append(on, el('span', 'nm', e ? e.name + ' (size ' + TFX.SIZE[e.grp] + ')' : B.type)); host.appendChild(bar);
  fxParams(host, path, B.type);
}
function pageCombiFx() {
  const C = patch, first = (C.chains || []).map(ch => ch.blocks.find(k => C.blocks[k])).find(k => k !== undefined);
  if (!/^(b\d|m1|m2|eq)$/.test(fxSel) || (fxSel[0] === 'b' && !C.blocks[Number(fxSel.slice(1))])) fxSel = first !== undefined ? 'b' + first : 'm2';
  const secs = [{ title: 'Routing', custom: renderCombiRouting }];
  if (fxSel[0] === 'b') secs.push({ title: 'Insert effect ' + (Number(fxSel.slice(1)) + 1), custom: renderCombiBlock });
  else if (fxSel === 'm1') secs.push({ title: 'Master Effect 1 · modulation', custom: h => renderFxMaster(h, 'm1'), help: 'Mono in, stereo out. It returns only the effect sound.' });
  else if (fxSel === 'm2') secs.push({ title: 'Master Effect 2 · reverb and delay', custom: h => renderFxMaster(h, 'm2'), help: 'Mono in, stereo out. It returns only the effect sound.' });
  else secs.push({ title: 'Master EQ', controls: [S('fx.eqLo', 'Low gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' }), S('fx.eqHi', 'High gain', -18, 18, { step: 0.5, fmt: v => F.sgn(v) + ' dB' })] });
  return secs;
}
const PAGES_COMBI = { combi: ['Combination', combiPageMain], timbre: ['Timbre', combiPageTimbre], fx: ['Effects', pageCombiFx], scale: ['Scale', pageScale] };
function renderFlowCombi(svg) {
  const C = patch, add = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
  const FX = { x: 356, y: 55, w: 42, h: 40 };
  C.timbres.forEach((t, k) => {
    const x = k < 4 ? 2 : 178, y = 4 + (k % 4) * 37, w = 168, h = 32, live = tPlays(t);
    const g = add('g', { class: 'blk' + (curPage === 'timbre' && curTimbre === k ? ' sel' : '') + (live ? '' : ' dim'), tabindex: 0, role: 'button', 'aria-label': 'Edit timbre ' + (k + 1) });
    add('rect', { x, y, width: w, height: h, rx: 2 }, g);
    add('text', { x: x + 5, y: y + 13, class: 't' }, g).textContent = 'T' + (k + 1) + ' ' + (t.status === 'off' ? 'OFF' : (t.pLabel || ''));
    add('text', { x: x + 5, y: y + 27 }, g).textContent = (t.pName || (t.status === 'off' ? '' : 'NOT IN FILE')).toUpperCase().slice(0, 18);
    const go = () => { curTimbre = k; selectPage('timbre'); }; g.addEventListener('click', go); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  const g = add('g', { class: 'blk' + (curPage === 'fx' ? ' sel' : ''), tabindex: 0, role: 'button', 'aria-label': 'Edit effects' });
  add('rect', { x: FX.x, y: FX.y, width: FX.w, height: FX.h, rx: 2 }, g); add('text', { x: FX.x + 5, y: FX.y + FX.h / 2 + 5, class: 't' }, g).textContent = 'FX';
  const go = () => selectPage('fx'); g.addEventListener('click', go); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
}
function PAGESET() { return patch && patch.kind === 'combi' ? PAGES_COMBI : patch && patch.kind === 'pcm' ? PAGES_PCM : PAGES; }
let curPage = store.get('moss-page', 'program'); if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];

// ---------------- rendering ----------------
function mkCtl(d, onAfter) {
  const val = getP(d.path);
  if (d.k === 's') {
    const w = el('label', 'ctl'), nm = el('span', 'nm', d.label), out = el('output'), inp = el('input');
    const fmt = d.fmt || String;
    inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = d.step; inp.value = val; out.textContent = fmt(val);
    inp.addEventListener('input', () => { const v = Number(inp.value); setP(d.path, v); out.textContent = fmt(v); if (onAfter) onAfter(); });
    inp.addEventListener('dblclick', () => { const dv = defaultAt(d.path); if (dv === undefined) return; inp.value = dv; setP(d.path, dv); out.textContent = fmt(dv); if (onAfter) onAfter(); });
    w.title = 'Double-click to reset';
    w.append(nm, out, inp); return w;
  }
  if (d.k === 'sel') {
    const w = el('label', 'ctl'), nm = el('span', 'nm', d.label), s = el('select');
    for (const o of d.opts) { const op = el('option', null, o[1]); op.value = o[0]; if (o[2]) op.disabled = true; s.appendChild(op); }
    s.value = String(val);
    s.addEventListener('change', () => { const v = d.num ? Number(s.value) : s.value; setP(d.path, v); if (d.rerender) { renderPage(); renderFlow(); } if (onAfter) onAfter(); });
    w.append(nm, el('span'), s); return w;
  }
  if (d.k === 'tog') {
    const w = el('label', 'tog'), c = el('input'); c.type = 'checkbox'; c.checked = !!val;
    c.addEventListener('change', () => { setP(d.path, c.checked ? 1 : 0); if (d.rerender) { renderPage(); renderFlow(); } });
    w.append(c, document.createTextNode(d.label)); return w;
  }
  if (d.k === 'txt') {
    const w = el('label', 'ctl'), nm = el('span', 'nm', d.label), t = el('input'); t.type = 'text'; t.maxLength = 24; t.value = val || '';
    t.addEventListener('input', () => { patch.name = t.value; edited = true; lcd(); saveCurrent(); });
    w.append(nm, el('span'), t); return w;
  }
}
function renderTabs() {
  const host = $('#tabs'); host.innerHTML = '';
  for (const [id, [label]] of Object.entries(PAGESET())) {
    const b = el('button', 'tab', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.id = 'tab-' + id;
    b.setAttribute('aria-selected', String(id === curPage));
    b.addEventListener('click', () => selectPage(id));
    host.appendChild(b);
  }
}
function selectPage(id) { curPage = id; store.set('moss-page', id); renderTabs(); renderPage(); renderFlow(); const t = $('#tab-' + id); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
function renderPage() {
  const host = $('#page'); host.innerHTML = ''; host.setAttribute('aria-labelledby', 'tab-' + curPage);
  if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];
  const secs = PAGESET()[curPage][1]();
  for (const sec of secs) {
    const s = el('section', 'sec');
    if (sec.title || sec.seg || sec.note) {
      const h = el('h3'); if (sec.title) h.appendChild(document.createTextNode(sec.title));
      if (sec.seg) {
        const g = el('div', 'seg'); g.setAttribute('role', 'group');
        sec.seg.forEach((lab, i) => { const b = el('button', null, lab); b.type = 'button'; b.setAttribute('aria-pressed', String(i === sec.segVal)); b.addEventListener('click', () => sec.segSet(i)); g.appendChild(b); });
        h.appendChild(g);
      }
      if (sec.note) h.appendChild(el('span', 'note', sec.note));
      s.appendChild(h);
    }
    let egSvg = null;
    if (sec.eg) { egSvg = document.createElementNS(SVGNS, 'svg'); egSvg.setAttribute('class', 'egsvg'); egSvg.setAttribute('viewBox', '0 0 360 70'); egSvg.setAttribute('aria-hidden', 'true'); s.appendChild(egSvg); drawEG(egSvg, sec.eg, sec.isAmp); }
    if (sec.custom) sec.custom(s);
    else {
      const g = el('div', 'grid');
      for (const d of sec.controls) g.appendChild(mkCtl(d, egSvg ? () => drawEG(egSvg, sec.eg, sec.isAmp) : null));
      s.appendChild(g);
    }
    if (sec.help) s.appendChild(el('p', 'help', sec.help));
    host.appendChild(s);
  }
}
function drawEG(svg, path, isAmp) {
  const e = getP(path), T = v => 0.12 + Math.log10(1 + MD.tsec(v) * 40);
  const pts = []; let x = 0;
  pts.push([x, isAmp ? 0 : e.startL]); x += T(e.atkT); pts.push([x, e.atkL]); x += T(e.decT); pts.push([x, e.brkL]); x += T(e.slpT); pts.push([x, e.susL]);
  x += 0.9; pts.push([x, e.susL]); x += T(e.relT); pts.push([x, isAmp ? 0 : e.relL]);
  const W = 352, H = 64, sx = W / x, lo = isAmp ? 0 : -99, hi = 99;
  const Y = v => 4 + (hi - v) / (hi - lo) * (H - 4);
  svg.innerHTML = '';
  const z = document.createElementNS(SVGNS, 'line'); z.setAttribute('x1', 4); z.setAttribute('x2', 356); z.setAttribute('y1', Y(0)); z.setAttribute('y2', Y(0)); svg.appendChild(z);
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', pts.map((q, i) => (i ? 'L' : 'M') + (4 + q[0] * sx).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join(' ')); svg.appendChild(p);
}
function renderMods(host) {
  const box = el('div', 'mods');
  const hd = el('div', 'modrow modhead'); ['', 'Source', 'Via (scales)', 'Destination', 'Amount'].forEach(t => hd.appendChild(el('span', null, t))); box.appendChild(hd);
  const dsts = dstOpts();
  patch.mods.forEach((m, i) => {
    const r = el('div', 'modrow'); r.appendChild(el('span', 'n', String(i + 1)));
    const mk = (key, opts, cls, lab) => { const s = el('select', cls); s.setAttribute('aria-label', 'Slot ' + (i + 1) + ' ' + lab); for (const o of opts) { const op = el('option', null, o[1]); op.value = o[0]; s.appendChild(op); } s.value = m[key]; s.addEventListener('change', () => setP('mods.' + i + '.' + key, s.value)); return s; };
    r.appendChild(mk('src', SRC_OPTS, 'ssel', 'source'));
    r.appendChild(mk('via', [['off', 'Always']].concat(SRC_OPTS.slice(1)), 'vsel', 'via'));
    r.appendChild(mk('dst', dsts, 'dsel', 'destination'));
    const a = el('div', 'amt'), inp = el('input'), out = el('output', null, F.sgn(m.amt));
    inp.type = 'range'; inp.min = -99; inp.max = 99; inp.value = m.amt; inp.setAttribute('aria-label', 'Slot ' + (i + 1) + ' amount');
    inp.addEventListener('input', () => { setP('mods.' + i + '.amt', Number(inp.value)); out.textContent = F.sgn(Number(inp.value)); });
    inp.addEventListener('dblclick', () => { inp.value = 0; setP('mods.' + i + '.amt', 0); out.textContent = '0'; });
    a.append(inp, out); r.appendChild(a); box.appendChild(r);
  });
  host.appendChild(box);
  host.appendChild(el('p', 'help', 'Each slot is one of MOSS\u2019s per-parameter AMS routings. Pitch amounts are curved: 25 is about three-quarters of a semitone and 99 is an octave. \u201cVia\u201d multiplies the route by a second source, such as LFO 1 via JS +Y for joystick vibrato. Mod A and B change meaning with the oscillator type and are named in the destination list.'));
}
function renderMemory(host) {
  const row = el('div', 'btnrow');
  const b = (label, fn) => { const x = el('button', 'hw', label); x.type = 'button'; x.addEventListener('click', fn); row.appendChild(x); return x; };
  b(prog.bank === 'us' ? 'Save to User ' + String(prog.idx + 1).padStart(2, '0') : 'Save to User bank', () => {
    if (prog.bank === 'us' && userBank[prog.idx]) userBank[prog.idx] = clone(patch); else { userBank.push(clone(patch)); prog = { bank: 'us', idx: userBank.length - 1 }; }
    commitUser('Saved to User ' + String(prog.idx + 1).padStart(2, '0'));
  });
  if (prog.bank === 'us') b('Save as new', () => { userBank.push(clone(patch)); prog = { bank: 'us', idx: userBank.length - 1 }; commitUser('Saved to User ' + String(prog.idx + 1).padStart(2, '0')); });
  if (prog.bank === 'us' && userBank[prog.idx]) b('Delete from User bank', () => { userBank.splice(prog.idx, 1); prog = { bank: 'st', idx: 0 }; commitUser('Deleted'); loadProgram('st', 0); });
  b('Export or import', () => { $('#dlgtxt').value = JSON.stringify(patch); $('#dlg').showModal(); });
  b('Import Trinity PCG', () => { const f = el('input'); f.type = 'file'; f.accept = '.pcg,.PCG'; f.addEventListener('change', () => { if (f.files && f.files[0]) importPcgFile(f.files[0]); }); f.click(); });
  const cb = prog.bank === 'pm' ? pcgBanks[Math.floor(prog.idx / 128)] : null;
  if (cb && !cb.builtin) b('Remove this Trinity bank', () => { pcgBanks.splice(pcgBanks.indexOf(cb), 1); savePcgBanks(); fillProgSelect(); loadProgram('st', 0); toast('Removed ' + cb.name); });
  b('Revert', () => loadProgram(prog.bank, prog.idx));
  host.appendChild(row);
  host.appendChild(el('p', 'help', 'User programs and imported banks live in this browser only. Use Export to keep a copy elsewhere. Importing reads a Trinity PCG file\u2019s Bank M (MOSS) programs, its PCM programs (banks A\u2013D) with their drum kits, its combinations, and its user scale. Korg\u2019s free Trinity preload data can be imported the same way.'));
}
function renderImportInfo(host) {
  if (patch.kind === 'combi') {
    const k = patch.korgInfo || {}, lines = [(k.source ? k.source + '. ' : '') + 'Trinity combination: ' + patch.timbres.filter(t => t.status !== 'off').length + ' timbres in use, ' + (patch.chains || []).length + ' insert effect chain' + ((patch.chains || []).length === 1 ? '' : 's') + '.'];
    lines.push('Each timbre plays its program from the same PCG file (banks A\u2013D: PCM programs with stand-in samples; bank M: MOSS). Not modelled yet: the timbre Delay start, the per-timbre MIDI filters, and a timbre\u2019s own scale (all timbres use the combination\u2019s scale). How the timbres share the insert effects follows the user files; Korg\u2019s documentation of that byte is incomplete.');
    (k.notes || []).forEach(n => lines.push(n + '.'));
    lines.forEach(t => host.appendChild(el('p', 'help', t)));
    return;
  }
  if (patch.kind === 'pcm') {
    const k = patch.korgInfo || {}, lines = [(k.source ? k.source + '. ' : '') + 'Trinity PCM program, ' + { single: 'Single', double: 'Double', drum: 'Drums' }[patch.mode] + ' mode.'];
    if (patch.mode !== 'drum') patch.o.slice(0, patch.mode === 'double' ? 2 : 1).forEach((O, i) => lines.push('OSC ' + (i + 1) + ': ' + (PCM_MS_NAMES[O.msHi] || 'RAM sample') + ' \u2192 stand-in: ' + standinName(O.msHi < 0x1000 ? O.msHi : (patch.ramMap || {})[O.msHi & 0xfff] || 0) + '.'));
    lines.push('Korg\u2019s sample ROM is not available, so openly licensed General MIDI recordings (MuseScore\u2019s MS General, MIT licence) and built-in waveforms stand in for the multisamples. The program\u2019s own filters, envelopes, LFOs and effects are applied to them.');
    (k.notes || []).forEach(n => lines.push(n + '.'));
    lines.forEach(t => host.appendChild(el('p', 'help', t)));
    return;
  }
  const k = patch.korgInfo || {}, names = { standard: 'Standard', comb: 'Comb Filter', vpm: 'VPM', reso: 'Resonance', ring: 'Ring Mod', cross: 'Cross Mod', sync: 'Sync Mod', organ: 'Organ', epiano: 'E.Piano', brass: 'Brass', reed: 'Reed', pluck: 'Plucked String', bowed: 'Bowed String' };
  const lines = [(k.source ? k.source + '. ' : '') + 'OSC 1: ' + (names[k.osc1] || k.osc1) + (k.osc2 ? ', OSC 2: ' + (names[k.osc2] || k.osc2) : ' (double-size model)') + '.'];
  (k.notes || []).forEach(n => lines.push(n + '.'));
  lines.forEach(t => host.appendChild(el('p', 'help', t)));
}
function commitUser(msg) {
  if (!store.set(LS_USER, userBank)) { toast('Could not save: browser storage is unavailable'); return; }
  edited = false;
  fillProgSelect(); lcd(); saveCurrent(); renderPage(); toast(msg);
}
$('#dlgcopy').addEventListener('click', async () => {
  const t = $('#dlgtxt'); t.select();
  try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch (e) { try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Select the text and copy it manually'); } }
});
$('#dlgload').addEventListener('click', () => {
  try {
    const p = JSON.parse($('#dlgtxt').value);
    if (!p || typeof p !== 'object' || !(p.osc || (p.kind === 'pcm' && p.o) || (p.kind === 'combi' && Array.isArray(p.timbres)))) throw new Error('not a program');
    patch = loadAny(p); edited = true; pcmPrepare(patch); if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];
    send({ t: 'patch', p: clone(patch) }); sendTuning(); renderAll(); saveCurrent(); $('#dlg').close(); toast('Program loaded');
  } catch (e) { toast('That text is not a MOSS program'); }
});

// ---------------- program select / LCD ----------------
let progSig = '';
function fillProgSelect() {
  const s = $('#prog'), sig = userBank.map(p => p.name || '').join('\u0001') + '|' + pcgBanks.map(b => b.name + ':' + b.n).join('|') + '|' + pcmBanks.map(b => b.set.name + b.letter).join('|') + '|' + combiBanks.map(b => b.set.name + b.letter).join('|');
  if (sig === progSig && s.options.length) { s.value = prog.bank + ':' + prog.idx; return; }
  progSig = sig; s.innerHTML = '';
  const g1 = el('optgroup'); g1.label = 'Starter programs';
  MOSS_PRESETS.forEach((p, i) => { const o = el('option', null, String(i).padStart(2, '0') + ' ' + p.name); o.value = 'st:' + i; g1.appendChild(o); });
  s.appendChild(g1);
  const g2 = el('optgroup'); g2.label = userBank.length ? 'User programs' : 'User programs (none saved yet)';
  userBank.forEach((p, i) => { const o = el('option', null, String(i + 1).padStart(2, '0') + ' ' + (p.name || 'Untitled')); o.value = 'us:' + i; g2.appendChild(o); });
  s.appendChild(g2);
  pcgBanks.forEach((b, bi) => {
    const g = el('optgroup'); g.label = b.builtin && b.fmt === 'triton' ? b.name : 'Bank ' + bankLetter(b) + ' from ' + b.name;
    for (let i = 0; i < b.n; i++) { const o = el('option', null, bankLetter(b) + String(i).padStart(3, '0') + ' ' + b.names[i]); o.value = 'pm:' + (bi * 128 + i); g.appendChild(o); }
    s.appendChild(g);
  });
  pcmBanks.forEach((b, bi) => {
    const g = el('optgroup'); g.label = 'Bank ' + b.letter + ' (PCM) from ' + b.set.name;
    for (let i = 0; i < 128; i++) { const o = el('option', null, b.letter + String(i).padStart(3, '0') + ' ' + b.names[i]); o.value = 'pc:' + (bi * 128 + i); g.appendChild(o); }
    s.appendChild(g);
  });
  combiBanks.forEach((b, bi) => {
    const g = el('optgroup'); g.label = 'Combinations ' + b.letter + ' from ' + b.set.name;
    for (let i = 0; i < 128; i++) { const o = el('option', null, 'C' + b.letter + pad3(i) + ' ' + b.names[i]); o.value = 'cb:' + (bi * 128 + i); g.appendChild(o); }
    s.appendChild(g);
  });
  s.value = prog.bank + ':' + prog.idx;
}
function lcd() {
  const pb = prog.bank === 'pc' ? pcmBanks[Math.floor(prog.idx / 128)] : prog.bank === 'cb' ? combiBanks[Math.floor(prog.idx / 128)] : null;
  $('#pnum').textContent = prog.bank === 'st' ? 'ST ' + String(prog.idx).padStart(2, '0') : prog.bank === 'pm' ? bankLetter(pcgBanks[Math.floor(prog.idx / 128)]) + String(prog.idx % 128).padStart(3, '0')
    : pb ? (prog.bank === 'cb' ? 'C' : '') + pb.letter + String(prog.idx % 128).padStart(3, '0') : 'US ' + String(prog.idx + 1).padStart(2, '0');
  $('#pname').textContent = (patch.name || 'Untitled') + (edited ? ' *' : '');
  $('#pname').title = edited ? 'Edited, not saved' : '';
  perfLcd();
}
function loadProgram(bank, idx) {
  const pm = bank === 'pm' ? pcgPatch(idx) : bank === 'pc' ? pcmPatch(idx) : bank === 'cb' ? combiPatch(idx) : null;
  if ((bank === 'us' && !userBank[idx]) || ((bank === 'pm' || bank === 'pc' || bank === 'cb') && !pm) || !['st', 'us', 'pm', 'pc', 'cb'].includes(bank)) { bank = 'st'; idx = 0; }
  patch = bank === 'st' ? mossPreset(idx) : bank === 'pm' || bank === 'pc' || bank === 'cb' ? pm : loadAny(userBank[idx]);
  prog = { bank, idx }; edited = false;
  pcmPrepare(patch);
  send({ t: 'patch', p: clone(patch) }); sendTuning();
  if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];
  renderAll(); saveCurrent();
  if (patch.kind === 'combi') status(combiStatus());
  else if (patch.kind === 'pcm') status('Trinity PCM program: Korg\u2019s samples are not available, so stand-in recordings play (see the Program page).');
  else if (patch.korgInfo) { const pl = korgPlayability(patch); status(pl.full ? '' : 'Not built yet: ' + pl.missing.join(', ') + '. That part is silent.'); } else status('');
}
function stepProgram(dir) {
  const list = MOSS_PRESETS.map((_, i) => ['st', i]).concat(userBank.map((_, i) => ['us', i]));
  pcgBanks.forEach((b, bi) => { for (let i = 0; i < b.n; i++) list.push(['pm', bi * 128 + i]); });
  pcmBanks.forEach((b, bi) => { for (let i = 0; i < 128; i++) list.push(['pc', bi * 128 + i]); });
  combiBanks.forEach((b, bi) => { for (let i = 0; i < 128; i++) list.push(['cb', bi * 128 + i]); });
  let k = list.findIndex(x => x[0] === prog.bank && x[1] === prog.idx); if (k < 0) k = 0;
  k = (k + dir + list.length) % list.length; loadProgram(list[k][0], list[k][1]);
}
$('#prog').addEventListener('change', e => { const [b, i] = e.target.value.split(':'); loadProgram(b, Number(i)); });
$('#prev').addEventListener('click', () => stepProgram(-1));
$('#next').addEventListener('click', () => stepProgram(1));
function renderAll() { fillProgSelect(); lcd(); renderTabs(); renderPage(); renderFlow(); }

// ---------------- signal flow (TouchView-style block diagram) ----------------
function renderFlow() {
  const svg = $('#flow'); svg.innerHTML = '';
  if (patch.kind === 'combi') return renderFlowCombi(svg);
  if (patch.kind === 'pcm') return renderFlowPcm(svg);
  const P = patch, R = P.filt.routing, dbl = DOUBLE.includes(P.osc[0].type);
  const add = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
  const wires = add('g', {});
  const B = {
    osc0: { x: 2, y: 4, w: 88, h: 30, t: 'OSC 1', s: TYPE_SHORT[P.osc[0].type], page: 'osc0' },
    osc1: { x: 2, y: 40, w: 88, h: 30, t: 'OSC 2', s: dbl ? 'UNUSED' : TYPE_SHORT[P.osc[1].type], page: 'osc1', dim: dbl },
    sub: { x: 2, y: 76, w: 88, h: 30, t: 'SUB', s: P.sub.wave.toUpperCase(), page: 'subnoise' },
    noise: { x: 2, y: 112, w: 88, h: 30, t: 'NOISE', s: P.noise.ftype.toUpperCase(), page: 'subnoise' },
    mix0: { x: 124, y: 18, w: 48, h: 40, t: 'MIX 1', page: 'mixer' },
    mix1: { x: 124, y: 92, w: 48, h: 40, t: 'MIX 2', page: 'mixer', dim: R === 'serial2' },
    f0: { x: 204, y: 18, w: 58, h: 40, t: 'FILT 1', s: P.f[0].type.toUpperCase(), page: 'filter' },
    f1: { x: 204, y: 92, w: 58, h: 40, t: 'FILT 2', s: (P.filt.link ? P.f[0] : P.f[1]).type.toUpperCase(), page: 'filter' },
    a0: { x: 290, y: 18, w: 44, h: 40, t: 'AMP 1', page: 'amp' },
    a1: { x: 290, y: 92, w: 44, h: 40, t: 'AMP 2', page: 'amp' },
    fx: { x: 356, y: 55, w: 42, h: 40, t: 'FX', page: 'fx' }
  };
  const cy = b => b.y + b.h / 2;
  const wire = (x1, y1, x2, y2, off) => { const mx = (x1 + x2) / 2; add('path', { d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, class: 'wire' + (off ? ' off' : '') }, wires); };
  const srcKeys = [['osc0', 'osc1'], ['osc1', 'osc2'], ['sub', 'sub'], ['noise', 'noise']];
  srcKeys.forEach(([bk, mk], si) => { [0, 1].forEach(m => { const lv = P.mix[m][mk]; const s = B[bk], d = B['mix' + m]; wire(s.x + s.w, cy(s) + (m ? 4 : -4), d.x, cy(d) + (si - 1.5) * 6, !lv || s.dim || d.dim); }); });
  const r = (a, b, off) => wire(B[a].x + B[a].w, cy(B[a]), B[b].x, cy(B[b]), off);
  if (R === 'parallel') { r('mix0', 'f0'); r('f0', 'a0'); r('mix1', 'f1'); r('f1', 'a1'); }
  else if (R === 'serial1') {
    r('mix0', 'f0'); add('path', { d: `M233 58 L233 92`, class: 'wire' }, wires); wire(262, 112, 290, 38);
    add('path', { d: `M172 112 C182 112 182 145 200 145 L276 145 C286 145 282 116 290 116`, class: 'wire' }, wires);
  } else { r('mix0', 'f0'); r('f0', 'a0'); add('path', { d: `M233 58 L233 92`, class: 'wire' }, wires); r('f1', 'a1'); }
  r('a0', 'fx'); r('a1', 'fx');
  for (const [k, b] of Object.entries(B)) {
    const g = add('g', { class: 'blk' + (b.page === curPage ? ' sel' : '') + (b.dim ? ' dim' : ''), tabindex: 0, role: 'button', 'aria-label': 'Edit ' + b.t.toLowerCase() });
    add('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 2 }, g);
    add('text', { x: b.x + 5, y: b.y + (b.s ? 13 : b.h / 2 + 5), class: 't' }, g).textContent = b.t;
    if (b.s) add('text', { x: b.x + 5, y: b.y + 26 }, g).textContent = b.s;
    const go = () => selectPage(b.page);
    g.addEventListener('click', go);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }
}

function renderFlowPcm(svg) {
  const P = patch, dbl = P.mode === 'double', drum = P.mode === 'drum';
  const add = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
  const wires = add('g', {}), short = (n, k) => (n || '').toUpperCase().slice(0, k);
  const msn = O => drum ? 'DRUM KIT' : short(PCM_MS_NAMES[O.msHi < 375 ? O.msHi : 0], 13);
  const B = {
    o0: { x: 2, y: 18, w: 112, h: 40, t: 'OSC 1', s: msn(P.o[0]), page: 'osc0' }, o1: { x: 2, y: 92, w: 112, h: 40, t: 'OSC 2', s: dbl ? msn(P.o[1]) : 'UNUSED', page: 'osc1', dim: !dbl },
    f0: { x: 150, y: 18, w: 84, h: 40, t: 'FILTER 1', s: P.o[0].route === 'thru' ? 'THRU' : P.o[0].route.toUpperCase(), page: 'filter0' }, f1: { x: 150, y: 92, w: 84, h: 40, t: 'FILTER 2', s: P.o[1].route === 'thru' ? 'THRU' : P.o[1].route.toUpperCase(), page: 'filter1', dim: !dbl },
    a0: { x: 270, y: 18, w: 60, h: 40, t: 'AMP 1', page: 'amp0' }, a1: { x: 270, y: 92, w: 60, h: 40, t: 'AMP 2', page: 'amp1', dim: !dbl },
    fx: { x: 356, y: 55, w: 42, h: 40, t: 'FX', page: 'fx' } };
  const cy = b => b.y + b.h / 2, wire = (a, b, off) => { const A = B[a], C = B[b], x1 = A.x + A.w, y1 = cy(A), x2 = C.x, y2 = cy(C), mx = (x1 + x2) / 2; add('path', { d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`, class: 'wire' + (off ? ' off' : '') }, wires); };
  wire('o0', 'f0'); wire('f0', 'a0'); wire('a0', 'fx'); wire('o1', 'f1', !dbl); wire('f1', 'a1', !dbl); wire('a1', 'fx', !dbl);
  for (const b of Object.values(B)) {
    const g = add('g', { class: 'blk' + (b.page === curPage ? ' sel' : '') + (b.dim ? ' dim' : ''), tabindex: 0, role: 'button', 'aria-label': 'Edit ' + b.t.toLowerCase() });
    add('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 2 }, g);
    add('text', { x: b.x + 5, y: b.y + (b.s ? 15 : b.h / 2 + 5), class: 't' }, g).textContent = b.t;
    if (b.s) add('text', { x: b.x + 5, y: b.y + 31 }, g).textContent = b.s;
    const go = () => selectPage(b.page); g.addEventListener('click', go); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }
}

// ---------------- voice LEDs & scope ----------------
function showVoices(v) {
  const h = $('#vleds'); if (h.children.length !== v.length) { h.innerHTML = ''; v.forEach(() => h.appendChild(el('i'))); h.classList.toggle('many', v.length > 16); }
  v.forEach((s, i) => { h.children[i].className = s === 2 ? 'g' : s === 1 ? 'r' : ''; });
}
const scopeBuf = new Float32Array(2048);
let scopeInk = '', scopeGain = 1;
const readInk = () => { scopeInk = getComputedStyle(document.documentElement).getPropertyValue('--lcd-ink').trim() || '#1a2e28'; };
readInk();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readInk); } catch (e) {}
let scopeC = null, scopeG = null, scopeIdle = 0;
function drawScope() {
  requestAnimationFrame(drawScope);
  if (document.hidden || !analyser || !ctx || ctx.state !== 'running') return;
  const c = scopeC || (scopeC = $('#scope')), g = scopeG || (scopeG = c.getContext('2d'));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  {
    analyser.getFloatTimeDomainData(scopeBuf);
    // trigger on a rising zero crossing so periodic waves stand still
    let st = 0; for (let i = 1; i < 1024; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { st = i; break; }
    const span = 600;
    let pk = 0; for (let i = 0; i < span; i++) { const a = Math.abs(scopeBuf[st + i]); if (a > pk) pk = a; }
    // silence: draw the flat line once, then stop repainting until sound comes back
    if (pk < 1e-5) { if (scopeIdle++ > 2) return; } else scopeIdle = 0;
    // slow auto-gain: quiet sounds still fill the display, loud ones never clip it
    const target = pk > 0.002 ? Math.min(12, 0.9 / pk) : scopeGain;
    scopeGain += (target - scopeGain) * (target < scopeGain ? 0.5 : 0.08);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = scopeInk; g.globalAlpha = 0.25; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.globalAlpha = 1; g.lineWidth = 1.6 * dpr; g.lineJoin = 'round'; g.beginPath();
    for (let i = 0; i < span; i++) {
      const x = i / (span - 1) * w, y = h / 2 - Math.max(-1, Math.min(1, scopeBuf[st + i] * scopeGain)) * (h / 2 - 3 * dpr);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
}

// ---------------- performance: octave, transpose, scale ----------------
// Korg's Z1/MOSS scale list. Cents are offsets from equal temperament for Key = C.
// Korg never published its exact tables, so these are the standard historical values.
const SCALES = [
  ['equal', 'Equal temperament', null],
  ['pureMaj', 'Pure major', [0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, -3.9, -11.7]],
  ['pureMin', 'Pure minor', [0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, 17.6, -11.7]],
  ['arabic', 'Arabic', [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, -50]],
  ['pyth', 'Pythagorean', [0, 13.7, 3.9, -5.9, 7.8, -2.0, 11.7, 2.0, 15.6, 5.9, -3.9, 9.8]],
  ['werck', 'Werckmeister III', [0, -9.8, -7.8, -5.9, -9.8, -2.0, -11.7, -3.9, -7.8, -11.7, -3.9, -7.8]],
  ['kirn', 'Kirnberger III', [0, -9.8, -6.8, -5.9, -13.7, -2.0, -9.8, -3.4, -7.8, -10.3, -3.9, -11.7]],
  ['slendro', 'Slendro', [0, 0, 40, 0, 0, -20, 0, 20, 0, 60, 0, 0]],
  ['pelog', 'Pelog', [0, 0, -80, 0, -130, 40, 0, -30, 0, -115, 0, -150]],
  ['stretch', 'Stretch (piano)', 'stretch'],
  ['user', 'Your scale', 'user']
];
// Maqam presets for "Your scale": [id, name, default tonic, {semitones above tonic: cents}]
const MAQAMS = [
  ['rast', 'Rast', 0, { 4: -50, 11: -50 }],
  ['bayati', 'Bayati', 2, { 2: -50 }],
  ['saba', 'Saba', 2, { 2: -50 }],
  ['sikah', 'Sikah', 4, { 0: -50, 7: -50 }],
  ['huzam', 'Huzam', 4, { 0: -50 }],
  ['iraq', 'Iraq', 11, { 0: -50, 5: -50 }]
];
const perfDefault = { progScale: true, oct: 0, trans: 0, scale: 'equal', key: 0, a4: 440, user: new Array(12).fill(0), userLabel: '', quick: -50, sel: 4, maqam: 'rast', maqamKey: 0 };
const perf = Object.assign(clone(perfDefault), store.get('moss-perf', {}));
if (!Array.isArray(perf.user) || perf.user.length !== 12) perf.user = new Array(12).fill(0);
perf.user = perf.user.map(x => Math.max(-100, Math.min(100, Number(x) || 0)));
if (!SCALES.some(s => s[0] === perf.scale)) perf.scale = 'equal';
perf.oct = Math.max(-3, Math.min(3, perf.oct | 0)); perf.trans = Math.max(-12, Math.min(12, perf.trans | 0));
perf.key = ((perf.key | 0) % 12 + 12) % 12; perf.a4 = Math.max(430, Math.min(450, Number(perf.a4) || 440));
let perfT = 0;
const savePerfNow = () => { clearTimeout(perfT); perfT = 0; store.set('moss-perf', perf); };
const savePerf = () => { clearTimeout(perfT); perfT = setTimeout(savePerfNow, 250); };
window.addEventListener('pagehide', () => { if (perfT) savePerfNow(); });
const scaleDef = () => SCALES.find(s => s[0] === perf.scale) || SCALES[0];
const keyApplies = () => Array.isArray(scaleDef()[2]);
// the 12 offsets currently in force (for pitch classes C..B)
function pcTable() {
  const d = scaleDef()[2];
  if (d === 'user') return perf.user.slice();
  if (!Array.isArray(d)) return new Array(12).fill(0);
  return NOTE_NAMES.map((_, pc) => d[(pc - perf.key + 12) % 12]);
}
// A Trinity program stores its own scale (type + key; type 9 = the file's Octave User Scale)
function progScaleOn() { const s = patch && patch.scale; return !!(perf.progScale && s && s.type && s.type !== 'equal'); }
function pcTableFor(type, key, user) {
  const d = (SCALES.find(s => s[0] === type) || SCALES[0])[2];
  if (d === 'user') return NOTE_NAMES.map((_, pc) => (user || [])[(pc - (key || 0) + 12) % 12] || 0);
  if (!Array.isArray(d)) return new Array(12).fill(0);
  return NOTE_NAMES.map((_, pc) => d[(pc - (key || 0) + 12) % 12]);
}
function tuningTable() {
  const s = progScaleOn() ? patch.scale : { type: perf.scale, key: perf.key, user: perf.user };
  const d = (SCALES.find(x => x[0] === s.type) || SCALES[0])[2], out = new Array(128).fill(0);
  if (d === 'stretch') { for (let n = 0; n < 128; n++) out[n] = Math.round(3.5e-4 * Math.pow(n - 64, 3) * 10) / 10; return out; }
  // the global "your scale" is absolute (key ignored); a program's user scale follows its Key, as on the Trinity
  const t = progScaleOn() ? pcTableFor(s.type, s.key, s.user) : pcTable();
  for (let n = 0; n < 128; n++) out[n] = t[n % 12];
  return out;
}
function offsetSummary(t) { const a = []; t.forEach((c, pc) => { if (c) a.push(NOTE_NAMES[pc] + sgn(Math.round(c))); }); return a.length ? a.slice(0, 5).join(' ') + (a.length > 5 ? ' \u2026' : '') : 'no offsets'; }
function sendTuning() { send({ t: 'tune', cents: tuningTable(), a4: perf.a4 }); }
function scaleLabel() {
  if (progScaleOn()) {
    const s = patch.scale, nm = (SCALES.find(x => x[0] === s.type) || SCALES[0])[1];
    return 'Program, ' + (s.type === 'user' ? 'user ' + offsetSummary(pcTableFor('user', s.key, s.user)) : nm + (s.key ? ' in ' + NOTE_NAMES[s.key] : '')) + (perf.a4 !== 440 ? ', A=' + perf.a4.toFixed(1) : '');
  }
  let s = perf.scale === 'user' ? (perf.userLabel || 'Your scale') : scaleDef()[1] + (keyApplies() && perf.key ? ' in ' + NOTE_NAMES[perf.key] : '');
  if (perf.a4 !== 440) s += ', A=' + perf.a4.toFixed(1);
  return s;
}
const sgn = v => (v > 0 ? '+' : v < 0 ? '\u2212' : '') + Math.abs(v);
function perfLcd() {
  $('#scalebtn').textContent = 'Scale: ' + scaleLabel();
  const parts = [];
  if (perf.oct) parts.push('Oct ' + sgn(perf.oct));
  if (perf.trans) parts.push('Trans ' + sgn(perf.trans));
  $('#shiftinfo').textContent = parts.join('  ');
  const ov = $('#octv'), tv = $('#trv');
  ov.textContent = sgn(perf.oct) || '0'; ov.classList.toggle('nz', !!perf.oct);
  tv.textContent = sgn(perf.trans) || '0'; tv.classList.toggle('nz', !!perf.trans);
}
function setOct(v) { perf.oct = Math.max(-3, Math.min(3, v)); savePerf(); perfLcd(); buildKb(); }
function setTrans(v) { perf.trans = Math.max(-12, Math.min(12, v)); savePerf(); perfLcd(); }
$('#octdn').addEventListener('click', () => setOct(perf.oct - 1));
$('#octup').addEventListener('click', () => setOct(perf.oct + 1));
$('#octv').addEventListener('click', () => setOct(0));
$('#trdn').addEventListener('click', () => setTrans(perf.trans - 1));
$('#trup').addEventListener('click', () => setTrans(perf.trans + 1));
$('#trv').addEventListener('click', () => setTrans(0));
$('#scalebtn').addEventListener('click', () => selectPage('scale'));
function applyScaleChange(msg) { savePerf(); sendTuning(); perfLcd(); if (curPage === 'scale') renderPage(); if (msg) toast(msg); }

function pageScale() {
  return [
    { title: 'Program scale', custom: host => {
      const g = el('div', 'grid'), w = el('label', 'tog'), c = el('input'); c.type = 'checkbox'; c.checked = !!perf.progScale;
      c.addEventListener('change', () => { perf.progScale = c.checked; applyScaleChange(); });
      w.append(c, document.createTextNode('Use each program\u2019s own scale')); g.appendChild(w); host.appendChild(g);
      const s = patch.scale;
      const info = s && s.type && s.type !== 'equal'
        ? 'This program has its own scale: ' + ((SCALES.find(x => x[0] === s.type) || SCALES[0])[1]) + (s.type === 'user' ? ' (' + offsetSummary(pcTableFor('user', s.key, s.user)) + ', from its PCG file\u2019s Global user scale)' : s.key ? ' in ' + NOTE_NAMES[s.key] : '') + '.'
        : 'This program has no scale of its own, so the scale below applies.';
      host.appendChild(el('p', 'help', info + ' Trinity programs store a scale; when this is on, they play in it, and programs without one use the scale below.'));
      if (s && s.type === 'user') { const row = el('div', 'btnrow'); const bt = el('button', 'hw', 'Copy the program scale into your scale'); bt.type = 'button';
        bt.addEventListener('click', () => { perf.user = pcTableFor('user', s.key, s.user); perf.scale = 'user'; perf.userLabel = 'From ' + (patch.name || 'program'); perf.progScale = false; applyScaleChange('Copied; program scales are now off so you can edit it'); });
        row.appendChild(bt); host.appendChild(row); }
    } },
    { title: 'Scale', custom: host => {
      const g = el('div', 'grid');
      const mkSel = (label, opts, val, on, dis) => {
        const w = el('label', 'ctl'), s = el('select'); w.append(el('span', 'nm', label), el('span'), s);
        opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); });
        s.value = String(val); s.disabled = !!dis; s.addEventListener('change', () => on(s.value)); return w;
      };
      g.appendChild(mkSel('Scale', SCALES.map(s => [s[0], s[1]]), perf.scale, v => { perf.scale = v; applyScaleChange(); }));
      g.appendChild(mkSel('Key', NOTE_NAMES.map((n, i) => [i, n]), perf.key, v => { perf.key = Number(v); applyScaleChange(); }, !keyApplies()));
      const w = el('label', 'ctl'), out = el('output'), r = el('input');
      r.type = 'range'; r.min = 430; r.max = 450; r.step = 0.1; r.value = perf.a4; out.textContent = perf.a4.toFixed(1) + ' Hz';
      r.addEventListener('input', () => { perf.a4 = Number(r.value); out.textContent = perf.a4.toFixed(1) + ' Hz'; savePerf(); sendTuning(); perfLcd(); });
      r.addEventListener('dblclick', () => { perf.a4 = 440; r.value = 440; out.textContent = '440.0 Hz'; savePerf(); sendTuning(); perfLcd(); });
      w.title = 'Double-click to reset to 440 Hz'; w.append(el('span', 'nm', 'Master tune'), out, r); g.appendChild(w);
      host.appendChild(g);
      const help = {
        equal: 'Standard tuning. Key has no effect.',
        arabic: 'Quarter-tone scale. Key C gives Rast on C and Bayati on D (E and B a quarter tone flat); D gives Rast on D and Bayati on E; F gives Rast on F; G gives Rast on G; A# gives Rast on B\u266d.',
        pureMaj: 'Major chords in the selected key are perfectly in tune.',
        pureMin: 'Minor chords in the selected key are perfectly in tune.',
        slendro: 'Five-note gamelan scale on C, D, F, G and A (with Key C). Other keys stay equal-tempered. Gamelan tunings vary by ensemble, so these are typical values.',
        pelog: 'Seven-note gamelan scale on the white keys (with Key C). Gamelan tunings vary by ensemble, so these are typical values.',
        stretch: 'Piano-style stretch: low notes slightly flat, high notes slightly sharp. Key has no effect.',
        user: 'Your own 12-key scale, edited below. Key has no effect: each key keeps its own offset.'
      }[perf.scale] || 'Historical temperament. Korg did not publish its exact tables, so these use the standard values.';
      host.appendChild(el('p', 'help', help));
    } },
    { title: 'Your scale', note: 'Cents per key, applied to every octave', custom: host => {
      const top = el('div', 'scaletop');
      top.appendChild(el('span', 'nm', 'Tap a key to set it to'));
      const seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Amount a tap applies');
      [-50, -25, 25, 50].forEach(q => { const b = el('button', null, sgn(q)); b.type = 'button'; b.setAttribute('aria-pressed', String(perf.quick === q)); b.addEventListener('click', () => { perf.quick = q; savePerf(); renderPage(); }); seg.appendChild(b); });
      top.appendChild(seg); host.appendChild(top);
      const cur = pcTable();
      const box = el('div', 'skeys'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Scale keys');
      const WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };
      const mk = (pc, black) => {
        const b = el('button', 'sk ' + (black ? 'b' : 'w')); b.type = 'button';
        const c = cur[pc];
        if (c) b.classList.add('off'); if (perf.sel === pc) b.classList.add('sel');
        b.append(el('span', 'cn', NOTE_NAMES[pc]), el('span', 'cc', c ? sgn(Math.round(c * 10) / 10) : '0'));
        b.setAttribute('aria-label', NOTE_NAMES[pc] + ', ' + (c ? sgn(c) + ' cents' : 'in tune') + '. Tap to toggle ' + sgn(perf.quick) + ' cents');
        b.addEventListener('click', () => { editUser(pc, Math.abs(cur[pc] - perf.quick) < 0.05 ? 0 : perf.quick); });
        return b;
      };
      WHITE.forEach((pc, i) => { const b = mk(pc, false); b.style.left = (i / 7 * 100) + '%'; b.style.width = (100 / 7) + '%'; box.appendChild(b); });
      Object.entries(BLACK).forEach(([pc, pos]) => { const b = mk(Number(pc), true); b.style.left = 'calc(' + (pos / 7 * 100) + '% - ' + (100 / 7 * 0.32) + '%)'; b.style.width = (100 / 7 * 0.64) + '%'; box.appendChild(b); });
      host.appendChild(box);
      // fine tuning of the selected key
      const g = el('div', 'grid fine');
      const w = el('label', 'ctl'), out = el('output'), r = el('input');
      r.type = 'range'; r.min = -100; r.max = 100; r.step = 1; r.value = Math.round(cur[perf.sel]);
      out.textContent = sgn(Math.round(cur[perf.sel])) + ' ct' ;
      if (!cur[perf.sel]) out.textContent = '0 ct';
      r.addEventListener('change', () => editUser(perf.sel, Number(r.value)));
      r.addEventListener('input', () => { out.textContent = (Number(r.value) ? sgn(Number(r.value)) : '0') + ' ct'; });
      w.append(el('span', 'nm', 'Fine-tune ' + NOTE_NAMES[perf.sel]), out, r); g.appendChild(w);
      const nudge = el('div', 'btnrow nudge');
      [['\u22121 ct', -1], ['+1 ct', 1], ['Reset ' + NOTE_NAMES[perf.sel], 0]].forEach(([t, d]) => { const b = el('button', 'hw', t); b.type = 'button'; b.addEventListener('click', () => editUser(perf.sel, d === 0 ? 0 : Math.max(-100, Math.min(100, Math.round(cur[perf.sel]) + d)))); nudge.appendChild(b); });
      g.appendChild(nudge);
      host.appendChild(g);
      host.appendChild(el('p', 'help', 'Tuning follows the keys you press, so it moves with Transpose. Changes apply instantly, even to notes you are holding.'));
    } },
    { title: 'Load a maqam', custom: host => {
      const g = el('div', 'grid');
      const mkSel = (label, opts, val, on) => { const w = el('label', 'ctl'), s = el('select'); w.append(el('span', 'nm', label), el('span'), s); opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); }); s.value = String(val); s.addEventListener('change', () => on(s.value)); return w; };
      g.appendChild(mkSel('Maqam', MAQAMS.map(m => [m[0], m[1]]), perf.maqam, v => { perf.maqam = v; const m = MAQAMS.find(x => x[0] === v); perf.maqamKey = m[2]; savePerf(); renderPage(); }));
      g.appendChild(mkSel('On', NOTE_NAMES.map((n, i) => [i, n]), perf.maqamKey, v => { perf.maqamKey = Number(v); savePerf(); }));
      host.appendChild(g);
      const row = el('div', 'btnrow');
      const ld = el('button', 'hw', 'Load maqam'); ld.type = 'button';
      ld.addEventListener('click', () => {
        const m = MAQAMS.find(x => x[0] === perf.maqam) || MAQAMS[0];
        perf.user = new Array(12).fill(0);
        for (const [deg, c] of Object.entries(m[3])) perf.user[(perf.maqamKey + Number(deg)) % 12] = c;
        perf.scale = 'user'; perf.userLabel = m[1] + ' on ' + NOTE_NAMES[perf.maqamKey];
        perf.sel = (perf.maqamKey + Number(Object.keys(m[3])[0] || 0)) % 12;
        applyScaleChange('Loaded ' + perf.userLabel);
      });
      const clr = el('button', 'hw', 'Clear your scale'); clr.type = 'button';
      clr.addEventListener('click', () => { perf.user = new Array(12).fill(0); perf.userLabel = ''; applyScaleChange('Your scale is back to equal tuning'); });
      row.append(ld, clr); host.appendChild(row);
      host.appendChild(el('p', 'help', 'Loading replaces your scale with the maqam\u2019s quarter tones at the chosen starting note. Bayati and Saba share the same tuning; Saba also uses the G\u266d key.'));
    } }
  ];
}
function editUser(pc, cents) {
  let msg = '';
  if (perf.scale !== 'user') {
    // start from whatever scale is playing now, so a tweak doesn't throw it away
    const from = scaleDef();
    perf.user = pcTable().map(x => Math.round(x * 10) / 10);
    msg = from[0] === 'equal' || from[0] === 'stretch' ? 'Switched to your scale' : 'Copied ' + from[1] + ' into your scale';
    perf.scale = 'user';
  }
  perf.user[pc] = cents; perf.sel = pc; perf.userLabel = '';
  applyScaleChange(msg);
}

// ---------------- notes ----------------
// Every input (screen keys, computer keys, MIDI) gets an id, so each note-off
// reaches the same sounding note even if octave or transpose changed meanwhile.
const lit = new Map();      // pressed key -> count, for key highlighting
const sounding = new Map(); // sounding note -> count
const srcMap = new Map();   // input id -> { k: pressed key, s: sounding note }
function keyEls(n) { return document.querySelectorAll('#kb [data-n="' + n + '"]'); }
function light(k, d) {
  const c = (lit.get(k) || 0) + d;
  if (c <= 0) { lit.delete(k); keyEls(k).forEach(x => x.classList.remove('on')); }
  else { lit.set(k, c); keyEls(k).forEach(x => x.classList.add('on')); }
}
function playOn(id, k, v) {
  if (srcMap.has(id)) playOff(id);
  const tk = k + perf.oct * 12, s = tk + perf.trans;
  if (k < 0 || k > 127 || s < 0 || s > 127) return;
  srcMap.set(id, { k, s }); light(k, 1);
  sounding.set(s, (sounding.get(s) || 0) + 1);
  const msg = { t: 'on', n: s, v, k: Math.max(0, Math.min(127, tk)) };
  userPaused = false;
  if (!graphReady) { startAudio().then(() => { const r = srcMap.get(id); if (r && r.s === s) send(msg); }); return; }
  if (ctx.state !== 'running') ensureContext();
  send(msg);
}
function playOff(id) {
  const r = srcMap.get(id); if (!r) return;
  srcMap.delete(id); light(r.k, -1);
  const c = (sounding.get(r.s) || 0) - 1;
  if (c <= 0) { sounding.delete(r.s); send({ t: 'off', n: r.s }); } else sounding.set(r.s, c);
}
// let go of every note an input (or all inputs) is holding: used by panic, MIDI All Notes Off and unplugging
function releaseInputs(prefix) { for (const id of [...srcMap.keys()]) if (!prefix || id.startsWith(prefix)) playOff(id); }
function noteOn(n, v) { playOn('api:' + n, n, v); }
function noteOff(n) { playOff('api:' + n); }

// ---------------- on-screen keyboard ----------------
const isBlack = n => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);
function buildKb() {
  const kb = $('#kb'), W = kb.clientWidth || 360; kb.innerHTML = '';
  const whites = Math.max(10, Math.min(36, Math.floor(W / (W < 520 ? 25 : 30))));
  const base = 60 - 12 * Math.floor(Math.floor(whites / 7) / 2); // keep middle C near the centre
  const notes = []; let n = base, c = 0;
  while (c < whites) { if (!isBlack(n)) c++; notes.push(n); n++; }
  const ww = W / whites; let wi = 0; const blacks = [];
  for (const k of notes) {
    if (!isBlack(k)) {
      const d = el('div', 'wk'); d.dataset.n = k; d.style.left = (wi * ww) + 'px'; d.style.width = (ww + 0.5) + 'px';
      if (k % 12 === 0) d.appendChild(el('span', 'c', F.note(k + perf.oct * 12)));
      if (lit.has(k)) d.classList.add('on');
      kb.appendChild(d); wi++;
    } else { const d = el('div', 'bk'); d.dataset.n = k; d.style.left = (wi * ww - ww * 0.31) + 'px'; d.style.width = (ww * 0.62) + 'px'; if (lit.has(k)) d.classList.add('on'); blacks.push(d); }
  }
  blacks.forEach(d => kb.appendChild(d));
}
const ptr = new Map();
function keyAt(x, y) { const e = document.elementFromPoint(x, y); const k = e && e.closest && e.closest('#kb .wk, #kb .bk'); return k ? { n: Number(k.dataset.n), el: k } : null; }
function velAt(y, k) { const r = k.el.getBoundingClientRect(); return Math.round(40 + 87 * Math.max(0, Math.min(1, (y - r.top) / r.height))); }
const kbEl = $('#kb');
kbEl.addEventListener('pointerdown', e => {
  e.preventDefault(); const k = keyAt(e.clientX, e.clientY); if (!k) return;
  try { kbEl.setPointerCapture(e.pointerId); } catch (x) {}
  ptr.set(e.pointerId, k.n); playOn('p' + e.pointerId, k.n, velAt(e.clientY, k));
});
kbEl.addEventListener('pointermove', e => {
  if (!ptr.has(e.pointerId)) return;
  const k = keyAt(e.clientX, e.clientY); if (!k || k.n === ptr.get(e.pointerId)) return;
  ptr.set(e.pointerId, k.n); playOn('p' + e.pointerId, k.n, velAt(e.clientY, k));
});
const ptrUp = e => { if (!ptr.has(e.pointerId)) return; playOff('p' + e.pointerId); ptr.delete(e.pointerId); };
kbEl.addEventListener('pointerup', ptrUp); kbEl.addEventListener('pointercancel', ptrUp); kbEl.addEventListener('lostpointercapture', ptrUp);
kbEl.addEventListener('contextmenu', e => e.preventDefault());
let rsT = 0; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(buildKb, 120); });

// computer keyboard
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
const keyOf = e => e.code === 'Semicolon' ? ';' : /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : (e.key || '').toLowerCase();
const kdown = new Map();
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tg = e.target; if (tg && (tg.tagName === 'INPUT' && tg.type === 'text' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) return;
  const k = keyOf(e);
  if (k === 'z' && !e.repeat) { setOct(perf.oct - 1); return; }
  if (k === 'x' && !e.repeat) { setOct(perf.oct + 1); return; }
  if (k === 'c' && !e.repeat) { setTrans(perf.trans - 1); return; }
  if (k === 'v' && !e.repeat) { setTrans(perf.trans + 1); return; }
  if (KEYMAP[k] === undefined || e.repeat) return;
  if (tg && tg.tagName === 'INPUT' && tg.type === 'range') return;
  kdown.set(k, true); playOn('k:' + k, 60 + KEYMAP[k], 100); e.preventDefault();
});
window.addEventListener('keyup', e => { const k = keyOf(e); if (kdown.has(k)) { playOff('k:' + k); kdown.delete(k); } });
window.addEventListener('blur', () => { kdown.forEach((_, k) => playOff('k:' + k)); kdown.clear(); });

// ---------------- joystick & ribbon ----------------
const joy = $('#joy'), knob = joy.querySelector('.knob');
let joyId = null, lastCC1 = -1, lastCC2 = -1;
function joySet(x, y) {
  knob.style.left = (50 + x * 44) + '%'; knob.style.top = (50 - y * 40) + '%';
  send({ t: 'bend', v: x });
  const c1 = y > 0 ? Math.round(y * 127) : 0, c2 = y < 0 ? Math.round(-y * 127) : 0;
  if (c1 !== lastCC1) { send({ t: 'cc', c: 1, v: c1 }); lastCC1 = c1; }
  if (c2 !== lastCC2) { send({ t: 'cc', c: 2, v: c2 }); lastCC2 = c2; }
}
function joyFromEvent(e) { const r = joy.getBoundingClientRect(); const x = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1)); const y = Math.max(-1, Math.min(1, 1 - (e.clientY - r.top) / r.height * 2)); joySet(Math.abs(x) < 0.06 ? 0 : x, Math.abs(y) < 0.06 ? 0 : y); }
joy.addEventListener('pointerdown', e => { e.preventDefault(); joyId = e.pointerId; try { joy.setPointerCapture(e.pointerId); } catch (x) {} if (!ctx) startAudio(); joyFromEvent(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyFromEvent(e); });
const joyUp = e => { if (e.pointerId !== joyId) return; joyId = null; joySet(0, 0); };
joy.addEventListener('pointerup', joyUp); joy.addEventListener('pointercancel', joyUp); joy.addEventListener('lostpointercapture', joyUp);
const rib = $('#ribbon'), dot = rib.querySelector('.dot'); let ribId = null;
function ribFrom(e) { const r = rib.getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); dot.style.left = 'calc(' + (x * 100) + '% - 9px)'; send({ t: 'cc', c: 16, v: Math.round(x * 127) }); }
rib.addEventListener('pointerdown', e => { e.preventDefault(); send({ t: 'ribz', v: 1 }); ribId = e.pointerId; try { rib.setPointerCapture(e.pointerId); } catch (x) {} if (!ctx) startAudio(); ribFrom(e); });
rib.addEventListener('pointermove', e => { if (e.pointerId === ribId) ribFrom(e); });
const ribUp = e => { if (e.pointerId !== ribId) return; ribId = null; send({ t: 'ribz', v: 0 }); dot.style.left = 'calc(50% - 9px)'; send({ t: 'cc', c: 16, v: 64 }); };
rib.addEventListener('pointerup', ribUp); rib.addEventListener('pointercancel', ribUp); rib.addEventListener('lostpointercapture', ribUp);
const swState = [0, 0];
[['#sw1', 0, 80], ['#sw2', 1, 81]].forEach(([id, k, cc]) => { const b = $(id); if (!b) return;
  b.addEventListener('click', () => { swState[k] = swState[k] ? 0 : 1; b.setAttribute('aria-pressed', String(!!swState[k])); if (!ctx) startAudio(); send({ t: 'cc', c: cc, v: swState[k] ? 127 : 0 }); }); });
$('#ctltog').addEventListener('click', () => { const c = $('#ctrls'); const open = c.classList.toggle('collapsed') === false; $('#ctltog').setAttribute('aria-expanded', String(open)); setDockH(); });
function setDockH() { const h = $('#dock').getBoundingClientRect().height; document.documentElement.style.setProperty('--dock-h', Math.ceil(h) + 'px'); }

// ---------------- MIDI ----------------
function onMidi(e) {
  const d = e.data; if (!d || d.length < 1) return;
  const st = d[0] & 0xf0, ch = d[0] & 15, d1 = d[1], d2 = d[2];
  if (st === 0x90 && d2 > 0) playOn('m:' + ch + ':' + d1, d1, d2);
  else if (st === 0x80 || (st === 0x90 && d2 === 0)) playOff('m:' + ch + ':' + d1);
  else if (st === 0xB0) { if (d1 === 120 || d1 === 123) releaseInputs('m:'); send({ t: 'cc', c: d1, v: d2 }); }
  else if (st === 0xE0) { const v = ((d2 << 7) | d1) - 8192; send({ t: 'bend', v: Math.max(-1, v / 8192) }); }
  else if (st === 0xD0) send({ t: 'at', v: d1 / 127 });
}
$('#midibtn').addEventListener('click', async () => {
  startAudio();
  if (!navigator.requestMIDIAccess) { status('Web MIDI is not available in this browser. Chrome, Edge and Opera support it; Safari does not.'); return; }
  try {
    const acc = await navigator.requestMIDIAccess();
    const hook = () => { let n = 0; acc.inputs.forEach(inp => { inp.onmidimessage = onMidi; if (inp.state === 'connected') n++; }); if (!n) releaseInputs('m:'); $('#mled').classList.toggle('on', n > 0); status(n ? 'MIDI: ' + n + ' input' + (n > 1 ? 's' : '') + ' connected' : 'MIDI is on, but no input devices were found.'); };
    hook(); acc.onstatechange = hook;
  } catch (err) { status('MIDI access was blocked here. Open the page in its own browser tab and allow MIDI when asked.'); }
});

// ---------------- boot ----------------
renderAll(); buildKb(); perfLcd(); showVoices(new Array((patch.voice && patch.voice.maxVoices) || 32).fill(0)); setDockH();
window.addEventListener('resize', setDockH);
window.__moss = { getPatch: () => patch, engine: () => fallbackEng, perf, tuningTable, playOn, playOff, pcgBanks, importPcgFile, startAudio, noteOn, noteOff, selectPage, loadProgram };
})();

