// MIDI input: notes, controllers, program buttons.
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
// ---------------- MIDI ----------------
// Next / previous program from buttons on a MIDI controller: learned on the Keyboard page (a note, a controller or a
// program change); program change messages can also step through the list or pick a number in the current bank.
let midiLearn = null, lastPc = null, lastStepT = 0, midiOn = false, midiNames = [];
const bindName = b => !b ? 'not set' : (b.t === 'cc' ? 'Controller ' + b.n : b.t === 'note' ? 'Note ' + F.note(b.n) : 'Program change ' + (b.n + 1)) + ', channel ' + (b.ch + 1);
// a learned button is debounced (some controllers send a burst when pressed); program changes step every time
function midiStep(dir, debounce) { if (debounce) { const t = performance.now(); if (t - lastStepT < 80) return; lastStepT = t; } stepProgram(dir); }
function pcSelect(v) {
  const b = prog.bank, base = Math.floor(prog.idx / 128) * 128;
  if (b === 'st') { if (v < MOSS_PRESETS.length) loadProgram('st', v); return; }
  if (b === 'us') { if (userBank[v]) loadProgram('us', v); return; }
  if (b === 'pc') { const pb = pcmBanks[base / 128]; if (!pb || pb.drum[v]) { toast('Program ' + pb.letter + pad3(v) + ' is a drum program (not supported)'); return; } }
  if (b === 'pm') { const mb = pcgBanks[base / 128]; if (!mb || v >= mb.n) return; }
  loadProgram(b, base + v);
}
// returns true when the message was a program button (so it does not also play or send a controller)
function midiProgramButtons(st, ch, d1, d2) {
  const kind = st === 0xB0 ? 'cc' : st === 0x90 && d2 > 0 ? 'note' : st === 0xC0 ? 'pc' : null;
  if (midiLearn && kind && (kind !== 'cc' || d2 > 0)) {
    kbs[midiLearn === 'next' ? 'midiNext' : 'midiPrev'] = { t: kind, ch, n: d1 };
    toast((midiLearn === 'next' ? 'Next' : 'Previous') + ' program: ' + bindName({ t: kind, ch, n: d1 }));
    midiLearn = null; saveKbs(); if (curPage === 'keys') renderPage(); return true;
  }
  const noteOff = st === 0x80 || (st === 0x90 && d2 === 0);
  const hit = b => !!b && b.ch === ch && b.n === d1 && b.t === (noteOff ? 'note' : kind);
  for (const [b, dir] of [[kbs.midiNext, 1], [kbs.midiPrev, -1]]) if (hit(b)) { if (!noteOff && (kind !== 'cc' || d2 > 0)) midiStep(dir, kind !== 'pc'); return true; }
  if (kind === 'pc') {
    if (kbs.pc === 'step') { const dir = lastPc === null ? 1 : (d1 - lastPc + 128) % 128 < 64 ? 1 : -1; if (d1 !== lastPc || lastPc === null) midiStep(dir); }
    else if (kbs.pc === 'bank') pcSelect(d1);
    lastPc = d1; return true;
  }
  return false;
}
function onMidi(e) {
  const d = e.data; if (!d || d.length < 1) return;
  const st = d[0] & 0xf0, ch = d[0] & 15, d1 = d[1], d2 = d[2];
  mmMonitor(st, d1, d2);
  if (midiProgramButtons(st, ch, d1, d2)) return;
  if (st === 0xB0 && (d1 === 80 || d1 === 81)) swShow(d1 - 80, d2 >= 64);
  if (st === 0xB0 && d1 === 64) sustainShow(d2 >= 64);
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
    const hook = () => { let n = 0; midiNames = []; acc.inputs.forEach(inp => { inp.onmidimessage = onMidi; if (inp.state === 'connected') { n++; midiNames.push(inp.name || 'MIDI input'); } }); if (!n) releaseInputs('m:'); $('#mled').classList.toggle('on', n > 0); midiOn = true; mmDevice(); status(n ? 'MIDI: ' + n + ' input' + (n > 1 ? 's' : '') + ' connected' : 'MIDI is on, but no input devices were found.'); };
    hook(); acc.onstatechange = hook;
  } catch (err) { status('MIDI access was blocked here. Open the page in its own browser tab and allow MIDI when asked.'); }
});
