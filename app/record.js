// Record to WAV.
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
// ---------------- record to WAV ----------------
// Taps the final output (after the effects and the limiter) and saves a 16-bit stereo WAV when stopped.
const REC_MAX_S = 600; // 10 minutes (about 115 MB while recording)
let rec = null; // { tap, sink, L: Int16Array[], R: Int16Array[], n, t, flush, flushing }
function recUI() {
  const on = !!rec, s = on ? Math.floor(rec.n / ctx.sampleRate) : 0, txt = on ? 'Stop ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : 'Record';
  for (const [b, l, t] of [['#recbtn', '#rled', '#rtxt'], ['#mmrec', '#mmrled', '#mmrtxt']]) { $(l).classList.toggle('on', on); $(b).setAttribute('aria-pressed', String(on)); $(t).textContent = txt; }
}
// The tap runs in an AudioWorklet (off the main thread, so a busy page cannot drop audio); it converts to 16 bits and
// hands over 4096-frame chunks. Compatibility mode (no worklet) keeps the older ScriptProcessor tap.
const REC_WORKLET = `class MossRec extends AudioWorkletProcessor {
  constructor() { super(); this.N = 4096; this.L = new Int16Array(this.N); this.R = new Int16Array(this.N); this.k = 0; this.stop = false;
    this.port.onmessage = e => { if (e.data === 'flush') { this.send(); this.port.postMessage({ done: true }); this.stop = true; } }; }
  send() { if (!this.k) return; const L = this.L.slice(0, this.k), R = this.R.slice(0, this.k); this.k = 0; this.port.postMessage({ L, R }, [L.buffer, R.buffer]); }
  process(ins) {
    if (this.stop) return false;
    const i = ins[0], a = i && i[0], b = i && i[1] || a, n = a ? a.length : 128;
    for (let j = 0; j < n; j++) {
      const l = a ? Math.max(-1, Math.min(1, a[j])) : 0, r = b ? Math.max(-1, Math.min(1, b[j])) : 0;
      this.L[this.k] = l < 0 ? l * 32768 : l * 32767; this.R[this.k] = r < 0 ? r * 32768 : r * 32767;
      if (++this.k === this.N) this.send();
    }
    return true;
  }
}
registerProcessor('moss-rec', MossRec);`;
let recModule = null;
function recWorklet(c) {
  if (audioMode !== 'worklet' || !c.audioWorklet) return Promise.resolve(false);
  if (!recModule) { const url = URL.createObjectURL(new Blob([REC_WORKLET], { type: 'application/javascript' })); recModule = c.audioWorklet.addModule(url).then(() => true, e => { console.warn('Recorder worklet failed; using the older recorder', e); return false; }); }
  return recModule;
}
async function recStart() {
  const c = ensureContext(); if (!c) return;
  await startAudio();
  const sink = c.createGain(); sink.gain.value = 0;
  const r = rec = { tap: null, sink, L: [], R: [], n: 0, t: 0, flush: null };
  recUI();
  const chunk = (L, R) => {
    if (rec !== r) return;
    r.L.push(L); r.R.push(R); r.n += L.length;
    if (r.n >= REC_MAX_S * c.sampleRate) { recStop(); status('Recording stopped at the 10-minute limit and saved.'); }
    else if (performance.now() - r.t > 250) { r.t = performance.now(); recUI(); }
  };
  if (await recWorklet(c)) {
    if (rec !== r) return; // stopped while the worklet was loading
    const tap = r.tap = new AudioWorkletNode(c, 'moss-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    window.__mossRecMode = 'worklet';
    let done = null;
    tap.port.onmessage = e => {
      const d = e.data;
      if (d.done) { if (done) done(); }
      else if (rec === r) chunk(d.L, d.R);
      else if (r.flushing) { r.L.push(d.L); r.R.push(d.R); r.n += d.L.length; } // the last chunk, after Stop
    };
    // Stop asks the worklet for its last partial chunk before the file is written
    r.flush = () => new Promise(res => { done = res; r.flushing = true; tap.port.postMessage('flush'); setTimeout(res, 500); });
  } else {
    if (rec !== r) return;
    const tap = r.tap = c.createScriptProcessor(4096, 2, 2);
    window.__mossRecMode = 'script';
    const i16 = a => { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const v = Math.max(-1, Math.min(1, a[i])); o[i] = v < 0 ? v * 32768 : v * 32767; } return o; };
    tap.onaudioprocess = e => { const b = e.inputBuffer, L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L; chunk(i16(L), i16(R)); };
  }
  analyser.connect(r.tap); r.tap.connect(sink); sink.connect(c.destination);
  status('Recording… press Stop to save a WAV file.');
}
async function recStop() {
  const r = rec; if (!r) return; rec = null;
  recUI();
  if (r.flush) await r.flush();
  try { if (r.tap) { analyser.disconnect(r.tap); r.tap.disconnect(); } r.sink.disconnect(); } catch (e) { console.debug('recorder already disconnected', e); }
  if (!r.n) { status('Nothing was recorded.'); return; }
  const blob = wavBlob(r.L, r.R, r.n, ctx.sampleRate), d = new Date(), p2 = x => String(x).padStart(2, '0');
  const a = el('a'); a.href = URL.createObjectURL(blob);
  a.download = 'trinity-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.wav';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  status('Saved ' + a.download + ' (' + (r.n / ctx.sampleRate).toFixed(1) + ' s).');
}
// 16-bit PCM stereo WAV from interleaving the recorded chunks
function wavBlob(Ls, Rs, n, sr) {
  const buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf), str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
  const out = new Int16Array(buf, 44); let k = 0;
  for (let c = 0; c < Ls.length; c++) { const L = Ls[c], R = Rs[c]; for (let i = 0; i < L.length; i++) { out[k++] = L[i]; out[k++] = R[i]; } }
  return new Blob([buf], { type: 'audio/wav' });
}
$('#recbtn').addEventListener('click', () => { if (rec) recStop(); else recStart(); });
