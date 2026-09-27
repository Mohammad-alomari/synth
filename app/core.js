// Core: helpers, browser storage, Trinity PCG banks and the synth memory, audio start-up, stand-in sample packs.
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
const clone = o => JSON.parse(JSON.stringify(o));
const SVGNS = 'http://www.w3.org/2000/svg';
const ENGINE_CLASSES = [MD, MossEG, MossLFO, MossVoice, TFX, FXDL, FXBQ, FXL, FxBase, FxDelay, FxReverb, FxMod, FxPhaser, FxTrem, FxRot, FxFilt, FxEQ, FxDyn, FxDrive, FxPitch, FxRack, PCM, PcmEG, PcmLFO, PcmStore, PcmVoice, MossCombi, MossEngine];

// ---------------- persistence ----------------
const LS_USER = 'moss-user-programs', LS_CUR = 'moss-current';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { console.warn('Could not read ' + k + ' from browser storage', e); return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { console.warn('Could not write ' + k + ' to browser storage', e); return false; } }
};
// Imported PCG files live in IndexedDB (raw bytes, far more room than localStorage's ~5 MB).
// One record per imported bank: { id, kind: 'moss' | 'tri', name, scale, fmt, rs, bytes }
const idb = {
  open() {
    return this.p || (this.p = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB is not available')); return; }
      const r = indexedDB.open('trinity-web-synth', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async run(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => { const t = d.transaction('files', mode), q = fn(t.objectStore('files')); t.oncomplete = () => res(q.result); t.onerror = t.onabort = () => rej(t.error || new Error('storage transaction failed')); });
  },
  all() { return this.run('readonly', s => s.getAll()); },
  add(rec) { return this.run('readwrite', s => s.add(rec)); },
  addAll(recs) { return this.run('readwrite', s => { let q = null; for (const r of recs) q = s.add(r); return q || s.count(); }); }, // one transaction: all or nothing
  del(id) { return this.run('readwrite', s => s.delete(id)); }
};
let userBank = store.get(LS_USER, []); if (!Array.isArray(userBank)) userBank = [];
let prog = { bank: 'st', idx: 0 }, patch = mossPreset(0), edited = false;
const saved = store.get(LS_CUR, null);
let bootNote = ''; // shown in the status line once the page is up
if (saved && saved.patch) { try { patch = loadAny(saved.patch); prog = saved.prog || prog; edited = !!saved.edited; } catch (e) { console.error('The last program could not be restored', e); patch = mossPreset(0); bootNote = 'Your last program could not be restored, so the first starter program is loaded.'; } }
// a stored program: MOSS programs are merged onto the default patch; Trinity PCM programs are kept as they are
function loadAny(p) {
  if (p && p.kind === 'combi' && !Array.isArray(p.timbres)) throw new Error('combination without timbres');
  if (p && p.kind === 'combi') for (const t of p.timbres) for (const f of ['rxDamper', 'rxAT', 'rxCC']) if (t && t[f] === undefined) t[f] = 1;
  if (p && p.kind === 'pcm' && !Array.isArray(p.o)) throw new Error('PCM program without oscillators');
  return p && (p.kind === 'pcm' || p.kind === 'combi') ? clone(p) : mossLoad(p);
}
let saveT = 0;
let saveWarned = false;
function saveCurrent() { clearTimeout(saveT); saveT = setTimeout(() => { if (!store.set(LS_CUR, { patch, prog, edited }) && !saveWarned) { saveWarned = true; status('Browser storage refused to save: this program and its edits are not remembered after a reload.'); } }, 300); }

// ---------------- programs saved in their place in a Trinity bank ----------------
// The bank's bytes stay as imported; an edited program saved "in place" is kept here and read before the bytes, so the
// bank list and every combination that uses the program play the edit. Keyed by file, bank and number (not list position).
const LS_EDITS = 'moss-bank-edits';
let bankEdits = store.get(LS_EDITS, {}); if (!bankEdits || typeof bankEdits !== 'object' || Array.isArray(bankEdits)) bankEdits = {};
const editKeyM = (b, i) => ['M', b.builtin ? 1 : 0, b.fmt === 'triton' ? 'F' : 'M', b.name, i].join('|');
const editKeyP = (b, i) => ['P', b.set.builtin ? 1 : 0, b.letter, b.set.name, i].join('|');
function saveEdits(all) { if (!store.set(LS_EDITS, all)) return false; bankEdits = all; return true; }
// an imported file that is removed takes its saved edits with it (kind 'M': its Bank M, 'P': its PCM banks)
function dropEdits(kind, name) { const all = Object.assign({}, bankEdits), pre = kind + '|0|'; for (const k in all) if (k.startsWith(pre) && k.split('|')[3] === name) delete all[k]; saveEdits(all); }

// ---------------- Trinity PCG banks ----------------
const LS_PCG = 'moss-pcg', MAX_IMPORTED = 8;
const b64dec = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const pcgBanks = []; // { name, scale, bytes, n, rs, builtin, names, fmt: 'trinity' | 'triton' }
// rs: record size, 521 (Trinity layout) or 716 (Triton: Trinity layout + the Triton effect section)
function addPcgBank(name, scale, bytes, builtin, fmt, rs) {
  rs = rs || 521;
  const n = Math.floor(bytes.length / rs), names = [];
  const b = { name, scale: scale || new Array(12).fill(0), bytes, n, rs, builtin, names, fmt: fmt || 'trinity', dbId: null };
  for (let i = 0; i < n; i++) names.push(pcgName(b, i));
  pcgBanks.push(b); return b;
}
function pcgName(b, i) { const e = bankEdits[editKeyM(b, i)]; return e ? e.name || 'Untitled' : korgName(b.bytes.subarray(i * b.rs, i * b.rs + 16)) || 'Untitled'; }
function pcmName(b, i) { const e = bankEdits[editKeyP(b, i)]; return e ? e.name || 'Untitled' : korgName(b.bytes.subarray(i * 433, i * 433 + 16)) || 'Untitled'; }
(typeof MOSS_PCG_BUILTIN !== 'undefined' ? MOSS_PCG_BUILTIN : []).forEach(b => addPcgBank(b.name, b.scale, b64dec(b.m), true, b.fmt, b.rs));
const bankLetter = b => b && b.fmt === 'triton' ? 'F' : 'M';
function pcgPatch(idx) {
  const b = pcgBanks[Math.floor(idx / 128)], i = idx % 128;
  if (!b || i >= b.n) return null;
  const e = bankEdits[editKeyM(b, i)], P = e ? loadAny(e) : korgDecodeMoss(b.bytes.subarray(i * b.rs, (i + 1) * b.rs), b.scale, b.fmt);
  P.korgInfo = P.korgInfo || { notes: [] };
  P.korgInfo.source = b.name + ', Bank ' + bankLetter(b) + ' ' + String(i).padStart(3, '0') + (e ? ' (edited and saved in place)' : '');
  return P;
}
// ---------------- Trinity PCM programs and combinations (built-in files + imported PCGs) ----------------
// A set is one PCG file: its PCM banks (A-D, 128 x 433 bytes) and its combination banks. Drum kits are not supported:
// Drum-mode programs are left out of the lists, and timbres that use one stay silent.
const LS_TRI = 'moss-tri';
const triSets = [], pcmBanks = [], combiBanks = []; // flat lists of { set, letter, bytes, names }; ids 'pc:' / 'cb:' + (index * 128 + number)
const pad3 = n => String(n).padStart(3, '0');
function addTriSet(name, scale, pcm, combis, builtin, hasS) {
  const set = { name, scale: scale || new Array(12).fill(0), combis: combis || [], builtin, hasS: !!hasS, dbId: null };
  triSets.push(set);
  for (const b of pcm) {
    const pb = { set, letter: b.letter, bytes: b.bytes, names: [], drum: [] };
    for (let i = 0; i < 128; i++) { pb.names.push(pcmName(pb, i)); pb.drum.push((b.bytes[i * 433 + 17] & 3) === 2); }
    pcmBanks.push(pb);
  }
  for (const b of set.combis) {
    const names = []; for (let i = 0; i < 128; i++) names.push(korgName(b.bytes.subarray(i * 388, i * 388 + 16)) || 'Untitled');
    combiBanks.push({ set, letter: b.letter, bytes: b.bytes, names });
  }
  return set;
}
function triFromFile(name, bytes, builtin) { // a whole Trinity PCG -> set
  const S = korgTrinitySections(bytes); if (!S.ok || (!S.pcm.length && !S.combis.length && !S.bankM.length)) return null;
  const cat = recs => { const rs = recs[0].length, u = new Uint8Array(recs.length * rs); recs.forEach((r, i) => u.set(r, i * rs)); return u; };
  return addTriSet(name, S.userScale, S.pcm.map(b => ({ letter: b.bank, bytes: cat(b.recs) })), S.combis.map(b => ({ letter: b.bank, bytes: cat(b.recs) })), builtin, S.bankS.length > 0);
}
(typeof TRI_BUILTIN !== 'undefined' ? TRI_BUILTIN : []).forEach(t => addTriSet(t.name, t.scale, t.pcm.map(b => ({ letter: b.bank, bytes: b64dec(b.m) })), t.combis.map(b => ({ letter: b.bank, bytes: b64dec(b.m) })), true, !!t.s));
// ---- synth memory ----
// Like loading PCG files into a real Trinity: an imported file brings the banks it contains; whatever it lacks
// (PCM banks A-D, Bank M) comes from what was loaded before it: earlier imports (newest first), then the
// built-in files in their list order (the first one has every bank, so one file fills everything in). Built-in files keep to their own data, as before. A file with a Bank S (Solo-TRI) never takes a
// Bank M from memory: in that synth, bank 4 is the Solo-TRI bank (not modelled, silent).
const mossOf = s => pcgBanks.find(x => x.name === s.name && x.fmt !== 'triton' && !!x.builtin === !!s.builtin) || null;
function setHas(s, what) { return what === 'M' ? !!mossOf(s) : pcmBanks.some(b => b.set === s && b.letter === what); }
function memoryFor(set, what) {
  if (setHas(set, what)) return set;
  if (set.builtin || (what === 'M' && set.hasS)) return null;
  const imp = triSets.filter(s => !s.builtin), order = imp.slice(0, imp.indexOf(set)).reverse().concat(triSets.filter(s => s.builtin));
  for (const s of order) { if (what === 'M' && s.hasS) return null; if (setHas(s, what)) return s; }
  return null;
}
function pcmPatch(idx) {
  const b = pcmBanks[Math.floor(idx / 128)], i = idx % 128;
  if (!b || b.drum[i]) return null; // Drum-mode programs (drum kits) are not supported
  const e = bankEdits[editKeyP(b, i)], P = e ? loadAny(e) : korgDecodePcm(b.bytes.subarray(i * 433, (i + 1) * 433), b.set.scale);
  P.korgInfo = P.korgInfo || { notes: [] };
  P.korgInfo.source = b.set.name + ', Bank ' + b.letter + ' ' + String(i).padStart(3, '0') + (e ? ' (edited and saved in place)' : '');
  return P;
}
// a combination with each timbre's program attached (t.p): banks A-D are the file's PCM banks, bank 4 its Bank M
// (MOSS, Trinity V3); a Solo-TRI Bank S is not modelled, so such a timbre stays silent
function timbreProgram(set, t) {
  t.p = null; t.pId = ''; t.pLabel = ('ABCD'[t.bank] || (t.bank === 4 ? 'M' : '?')) + pad3(t.prog);
  t.from = ''; t.drum = false;
  if (t.bank <= 3) { const L = 'ABCD'[t.bank], src = memoryFor(set, L), bi = src ? pcmBanks.findIndex(x => x.set === src && x.letter === L) : -1; if (bi >= 0 && pcmBanks[bi].drum[t.prog]) t.drum = true; else if (bi >= 0) { t.p = pcmPatch(bi * 128 + t.prog); t.pId = 'pc:' + (bi * 128 + t.prog); if (src !== set) t.from = src.name; } }
  else if (t.bank === 4) { const src = memoryFor(set, 'M'), mb = src && mossOf(src), mi = mb ? pcgBanks.indexOf(mb) : -1; if (mi >= 0) { t.p = pcgPatch(mi * 128 + t.prog); t.pId = 'pm:' + (mi * 128 + t.prog); if (src !== set) t.from = src.name; } else if (set.hasS || set.builtin) t.pLabel = 'S' + pad3(t.prog); }
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
if (!edited) { try { const P = prog.bank === 'pm' ? pcgPatch(prog.idx) : prog.bank === 'pc' ? pcmPatch(prog.idx) : prog.bank === 'cb' ? combiPatch(prog.idx) : prog.bank === 'st' ? mossPreset(prog.idx) : null; if (P) patch = P; } catch (e) { console.warn('Could not reload the current program', e); } }
// restores a stored bank into the lists; returns false (and logs) when the record cannot be read
function restoreRecord(r) {
  try {
    if (r.kind === 'moss') addPcgBank(r.name, r.scale, r.bytes, false, r.fmt, r.rs).dbId = r.id;
    else { const set = triFromFile(r.name, r.bytes, false); if (!set) throw new Error('nothing this synth can play'); set.dbId = r.id; }
    return true;
  } catch (e) { console.error('Stored bank "' + r.name + '" could not be restored', e); return false; }
}
// imported banks load after start-up (IndexedDB is asynchronous); banks from older versions are moved over from localStorage
async function restoreImported() {
  const bad = [], old = [], dec = (o, kind) => { try { old.push({ kind, name: o.name, scale: o.scale, fmt: o.fmt, rs: o.rs, bytes: b64dec(o.m) }); } catch (e) { console.error('Stored bank could not be decoded', e); bad.push(o && o.name); } };
  (x => Array.isArray(x) ? x : [])(store.get(LS_PCG, [])).forEach(b => dec(b, 'moss'));
  (x => Array.isArray(x) ? x : [])(store.get(LS_TRI, [])).forEach(t => dec(t, 'tri'));
  let recs;
  try {
    if (old.length) await idb.addAll(old);
    recs = await idb.all();
  } catch (e) {
    console.error('Browser storage (IndexedDB) is not available', e);
    recs = old.map(r => Object.assign({ id: null }, r)); // still play what an older version kept in localStorage
    status('Browser storage is not available here: imported banks cannot be kept.');
  }
  if (old.length && recs.some(r => r.id != null)) try { localStorage.removeItem(LS_PCG); localStorage.removeItem(LS_TRI); } catch (e) { console.warn(e); }
  for (const r of recs) if (!restoreRecord(r)) bad.push(r.name);
  if (bad.length) status('Could not restore imported bank' + (bad.length > 1 ? 's' : '') + ': ' + bad.join(', ') + '. Import the file again.');
  if (!recs.length) return;
  if (!edited && ['pm', 'pc', 'cb'].includes(prog.bank)) loadProgram(prog.bank, prog.idx); else { refreshProgs(); lcd(); }
}
// any failure while importing ends up in the status line instead of being lost in the console
async function importPcgFile(file) {
  try { await importPcgInner(file); }
  catch (e) { console.error('Import failed', e); status('Could not import ' + (file && file.name || 'that file') + ': ' + (e && e.message || e) + '. The file may be damaged or from a model this synth does not read.'); toast('Import failed'); }
}
async function importPcgInner(file) {
  let buf;
  try { buf = await file.arrayBuffer(); } catch (e) { console.error('Could not read file', e); toast('Could not read that file'); status('Could not read ' + file.name + ': ' + (e && e.message || e)); return; }
  const bytes = new Uint8Array(buf), r = korgParsePCG(bytes);
  if (!r.ok) { status(r.error); toast('Not imported: ' + r.error); return; }
  const name = file.name.replace(/\.pcg$/i, '');
  if (r.fmt === 'triton') {
    if (!r.bankM.length) { status(name + ': this Triton-family file has no MOSS (bank F) programs.' + (r.pcmPrograms ? ' Its ' + r.pcmPrograms + ' PCM programs need the Triton\u2019s samples.' : '')); toast('No MOSS programs in ' + name); return; }
  }
  if (new Set(pcgBanks.filter(b => !b.builtin).concat(triSets.filter(t => !t.builtin)).map(x => x.name)).size >= MAX_IMPORTED) { /* counts files, not banks */ toast('Remove an imported bank first (limit ' + MAX_IMPORTED + ')'); return; }
  const got = [];
  let first = null, notKept = false;
  if (r.bankM.length) {
    const rs = r.bankM[0].length, mb = new Uint8Array(r.bankM.length * rs); r.bankM.forEach((rec, i) => mb.set(rec, i * rs));
    const nb = addPcgBank(name, r.userScale, mb, false, r.fmt, rs);
    try { nb.dbId = await idb.add({ kind: 'moss', name, scale: nb.scale, fmt: nb.fmt, rs, bytes: mb }); }
    catch (e) { console.error('Could not store bank', e); notKept = true; }
    got.push(r.bankM.length + (r.fmt === 'triton' ? ' MOSS (bank F)' : ' Bank M') + ' programs'); first = ['pm', (pcgBanks.length - 1) * 128];
  }
  if (r.fmt !== 'triton' && (r.pcmPrograms || r.combis || r.bankM.length)) {
    const before = pcmBanks.length, set = triFromFile(name, bytes, false);
    if (set) {
      try { set.dbId = await idb.add({ kind: 'tri', name, bytes }); }
      catch (e) { console.error('Could not store PCM banks', e); notKept = true; }
      const nb = pcmBanks.length - before;
      if (nb) { got.push(nb * 128 + ' PCM programs (banks ' + pcmBanks.slice(before).map(b => b.letter).join('') + ')'); if (!first) first = ['pc', before * 128]; }
      if (set.combis.length) { got.push(set.combis.length * 128 + ' combinations'); if (!first) first = ['cb', (combiBanks.length - set.combis.length) * 128]; }
    }
  }
  if (!got.length) { status(name + ': nothing this synth can play' + (r.bankS ? ' (it has a Bank S for the SOLO-TRI board, not supported yet)' : '') + '.'); toast('Nothing imported from ' + name); return; }
  refreshProgs(); if (first) loadProgram(first[0], first[1]);
  status('Imported from ' + name + ': ' + got.join(', ') + '.' + (r.bankS ? ' Its Bank S (SOLO-TRI) is not supported yet.' : '') + (notKept ? ' Browser storage refused it: it plays now but is gone after a reload.' : ''));
  toast(notKept ? 'Imported ' + name + ' (not kept)' : 'Imported ' + name);
}

// ---------------- audio ----------------
let ctx = null, node = null, analyser = null, starting = null, fallbackEng = null, graphReady = false, audioMode = '', unlockEl = null, voiceTimer = 0, userPaused = false;
let micSrc = null, micStream = null;
// the Vocoder's modulator: a microphone feeds the engine's input (the vocoder falls back to its own input without one)
let micBusy = false;
async function setMic(on) {
  if (micBusy) return !!micStream;
  if (!on || micStream) {
    if (micSrc) { try { micSrc.disconnect(); } catch (e) { console.debug('microphone already disconnected', e); } micSrc = null; }
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
    catch (x) { L.fill(0); R.fill(0); if (!this.err) { this.err = 1; this.port.postMessage({ t: 'err', m: String(x && x.message || x) }); } try { this.e.handle({ t: 'panic' }); } catch (y) { console.warn('panic after an engine error failed', y); } }
    if (!o[1]) for (let i = 0; i < n; i++) L[i] = (L[i] + R[i]) * 0.5;
    this.c += n;
    if (this.c >= 2400) { this.c = 0; const st = this.e.store, need = st && st.need.size ? [...st.need] : null; if (need) st.need.clear(); this.port.postMessage({ t: 'st', v: this.e.voiceStates(), need }); }
    return true;
  }
}
registerProcessor('moss', MossProc);`;
}
// ---------------- stand-in samples for Trinity PCM programs ----------------
// samples/packs.json lists the packs (one MP3 per General MIDI instrument or drum set, mono 32 kHz); each is decoded
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
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { console.debug('audioSession not settable', e); }
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { status('This browser has no Web Audio support.'); return null; }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.connect(ctx.destination);
    ctx.onstatechange = () => powerUI();
  }
  if (ctx.state !== 'running' && !userPaused) {
    try { const p = ctx.resume(); if (p && p.then) p.then(powerUI, e => console.warn('Audio could not start yet (the browser wants a click or key press)', e)); } catch (e) { console.warn('Audio resume failed', e); }
    // classic WebKit unlock: start a silent one-sample buffer inside the gesture
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { console.debug('silent unlock buffer failed', e); }
  }
  if (IS_IOS && !navigator.audioSession && !unlockEl) {
    // older iOS: a playing media element lifts the Silent-switch mute for Web Audio
    try { unlockEl = document.createElement('audio'); unlockEl.setAttribute('playsinline', ''); unlockEl.loop = true; unlockEl.src = SILENT_WAV; const pr = unlockEl.play(); if (pr && pr.catch) pr.catch(e => console.debug('silent unlock element did not play', e)); } catch (e) { console.debug('silent unlock element failed', e); }
  }
  return ctx;
}
function engineError(m) { status('Sound engine error: ' + String(m).slice(0, 140) + '. Reload the page to go on; if it happens again, please report this message.'); }
function useScriptFallback(msg) {
  if (node) { try { node.disconnect(); } catch (e) { console.debug('worklet node already disconnected', e); } if (node.port) node.port.onmessage = null; }
  audioMode = 'script';
  fallbackEng = new MossEngine(ctx.sampleRate);
  node = ctx.createScriptProcessor(1024, 1, 2);
  if (micSrc) { try { micSrc.disconnect(); micSrc.connect(node); } catch (e) { console.warn('Could not reconnect the microphone', e); } } // the vocoder keeps its microphone
  let shown = false;
  node.onaudioprocess = e => {
    const b = e.outputBuffer, L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : new Float32Array(b.length);
    const mi = micSrc && e.inputBuffer && e.inputBuffer.numberOfChannels ? e.inputBuffer.getChannelData(0) : null;
    try { fallbackEng.process(L, R, b.length, mi); }
    catch (x) { L.fill(0); R.fill(0); if (!shown) { shown = true; engineError(x && x.message || x); } try { fallbackEng.handle({ t: 'panic' }); } catch (y) { console.warn('panic after an engine error failed', y); } }
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
function status(t) { $('#status').textContent = t || ''; $('#mmstatus').textContent = t || ''; }
let toastT = 0;
function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('show'), 1800); }
