// MIDI mode: play from a MIDI keyboard without the on-screen keys.
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
// ---------------- MIDI mode ----------------
// The editor and the keyboard dock are hidden. The screen shows the program name large, program change (Prev / Next,
// Browse with search and favourites), scale, octave / transpose, Sustain, Record, Panic, a MIDI monitor and a few
// sound controls for the current program (quick edit: MOSS / PCM macros or the timbre levels of a combination).
const inMidiMode = () => document.body.classList.contains('midi');
const curEntry = () => { const v = prog.bank + ':' + prog.idx; return progEntries().find(e => e.v === v); };
function setMidiMode(on) {
  if (on && document.body.classList.contains('play')) setPlayMode(false);
  document.body.classList.toggle('midi', on);
  wakeLock(on);
  if (on) {
    mmQuickFor = null; mmDevice(); mmLcd(); window.scrollTo(0, 0);
    if (!midiOn) $('#midibtn').click(); // asks for MIDI access (the tap that opened MIDI mode counts as the user's gesture)
  } else {
    if (favOnly) setFavOnly(false);
    requestAnimationFrame(() => { buildKb(); setDockH(); });
  }
}
function mmDevice() {
  if (!inMidiMode()) return;
  const n = midiNames.length;
  $('#mmled').classList.toggle('on', n > 0);
  $('#mmdev').textContent = n ? 'MIDI: ' + midiNames.join(', ') : midiOn ? 'No MIDI keyboard found: plug one in' : 'MIDI is off';
  $('#mmconnect').hidden = n > 0;
}
function mmLcd() {
  if (!inMidiMode()) return;
  const e = curEntry(), f = !!e && isFav(e);
  $('#mmnum').textContent = $('#pnum').textContent + ' · ' + (patch.kind === 'combi' ? 'Combination' : patch.kind === 'pcm' ? 'PCM program' : 'MOSS program');
  $('#mmname').textContent = (patch.name || 'Untitled') + (edited ? ' *' : '');
  $('#mmfrom').textContent = e ? e.g : '';
  const fb = $('#mmfav'); fb.setAttribute('aria-pressed', String(f)); fb.textContent = f ? '★' : '☆'; fb.title = f ? 'Remove from favourites' : 'Add to favourites';
  const w = inPlace(), sp = $('#mmsaveplace'); sp.hidden = !w; if (w) sp.textContent = 'Save in place (' + w.label + ')';
  if (mmQuickFor !== patch) mmQuick();
}

// ---------------- quick edit ----------------
// Each control moves one or more parameters together (both filters, both oscillators), keeping their differences;
// it shows the first one's value. Double-click returns to the value the program had when it was loaded.
let mmQuickFor = null;
function mmMacros() {
  const P = patch;
  if (P.kind === 'combi') return P.timbres.map((t, k) => tPlays(t) ? { label: 'T' + (k + 1) + ' ' + (t.pName || ''), paths: ['timbres.' + k + '.level'], min: 0, max: 127, fmt: K.n } : null).filter(Boolean);
  if (P.kind === 'pcm') {
    const osc = P.mode === 'double' ? [0, 1] : [0], filt = [];
    osc.forEach(i => { const r = P.o[i].route; if (r === 'thru') return; filt.push('o.' + i + '.f.0.'); if (r !== 'single') filt.push('o.' + i + '.f.1.'); });
    const fp = k => filt.map(f => f + k);
    return [{ label: 'Level', paths: osc.map(i => 'o.' + i + '.amp.level'), min: 0, max: 127, fmt: K.n },
      { label: 'Cutoff', paths: fp('cut'), min: 0, max: 99, fmt: K.cut }, { label: 'Resonance', paths: fp('reso'), min: 0, max: 31, fmt: K.n },
      { label: 'Filter EG', paths: fp('egInt'), min: -99, max: 99, fmt: K.sgn },
      { label: 'Attack', paths: osc.map(i => 'o.' + i + '.aeg.atkT'), min: 0, max: 99, fmt: K.time }, { label: 'Release', paths: osc.map(i => 'o.' + i + '.aeg.relT'), min: 0, max: 99, fmt: K.time }];
  }
  const fp = k => (P.filt && P.filt.link ? [0] : [0, 1]).map(i => 'f.' + i + '.' + k);
  return [{ label: 'Level', paths: ['out.level'], min: 0, max: 127, fmt: String },
    { label: 'Cutoff', paths: fp('freqA'), min: 0, max: 99, fmt: F.hz }, { label: 'Resonance', paths: fp('resoA'), min: 0, max: 99, fmt: String },
    { label: 'Filter EG', paths: fp('egInt'), min: -99, max: 99, fmt: F.sgn },
    { label: 'Attack', paths: ['ampEG.atkT'], min: 0, max: 99, fmt: F.time }, { label: 'Release', paths: ['ampEG.relT'], min: 0, max: 99, fmt: F.time }];
}
function mmQuick() {
  mmQuickFor = patch;
  const g = $('#mmgrid'); g.innerHTML = '';
  for (const m of mmMacros()) {
    const base = m.paths.map(p => getP(p));
    if (!base.length || base.some(v => typeof v !== 'number')) continue;
    const w = el('label', 'ctl'), out = el('output', null, m.fmt(base[0])), inp = el('input');
    inp.type = 'range'; inp.min = m.min; inp.max = m.max; inp.value = base[0];
    const apply = v => { const d = v - base[0]; m.paths.forEach((p, i) => setP(p, Math.max(m.min, Math.min(m.max, base[i] + d)))); out.textContent = m.fmt(v); };
    inp.addEventListener('input', () => apply(Number(inp.value)));
    inp.addEventListener('dblclick', () => { inp.value = base[0]; apply(base[0]); });
    w.title = 'Double-click to go back to the loaded value';
    w.append(el('span', 'nm', m.label), out, inp); g.appendChild(w);
  }
  $('#mmhelp').textContent = patch.kind === 'combi'
    ? 'Level of each playing timbre.'
    : 'Moves both filters and oscillators together.';
}

// ---------------- browse: search and favourites ----------------
const mmBr = progBrowser($('#mmbrowsebox'), e => loadProgram(e.b, e.i, e.recent));
function mmBrowse(open) {
  $('#mmbrowsebox').hidden = !open; $('#mmbrowse').setAttribute('aria-expanded', String(open));
  if (open) mmBr.open();
}
$('#mmfav').addEventListener('click', () => {
  const e = curEntry(); if (!e) return;
  const k = favKey(e); if (favs.has(k)) favs.delete(k); else favs.add(k);
  store.set('moss-favs', [...favs]); if (favOnly) refreshProgs(); mmLcd(); mmBr.render();
  toast(favs.has(k) ? 'Added to favourites' : 'Removed from favourites');
});

// ---------------- MIDI monitor ----------------
let mmHitT = 0;
function mmMonitor(st, d1, d2) {
  if (!inMidiMode()) return;
  const led = $('#mmled'); led.classList.add('hit'); clearTimeout(mmHitT); mmHitT = setTimeout(() => led.classList.remove('hit'), 90);
  if (st === 0x90 && d2 > 0) $('#mmnote').textContent = F.note(d1) + ' · velocity ' + d2;
  else if (st === 0xE0) { const v = (((d2 << 7) | d1) - 8192) / 8192, b = $('#mmbend').style; b.left = (v < 0 ? 50 + v * 50 : 50) + '%'; b.width = Math.abs(v) * 50 + '%'; }
  else if (st === 0xB0 && d1 === 1) $('#mmmod').style.width = (d2 / 127 * 100) + '%';
}

// ---------------- buttons and keys ----------------
$('#midimodebtn').addEventListener('click', () => { startAudio(); setMidiMode(true); });
$('#mmexit').addEventListener('click', () => setMidiMode(false));
$('#mmconnect').addEventListener('click', () => $('#midibtn').click());
$('#mmprev').addEventListener('click', () => stepProgram(-1));
$('#mmlast').addEventListener('click', goLast);
$('#mmnext').addEventListener('click', () => stepProgram(1));
$('#mmbrowse').addEventListener('click', () => mmBrowse($('#mmbrowsebox').hidden));
$('#mmnamebtn').addEventListener('click', () => mmBrowse($('#mmbrowsebox').hidden));
$('#mmrec').addEventListener('click', () => $('#recbtn').click());
$('#mmpanic').addEventListener('click', () => { releaseInputs(); sustainShow(false); send({ t: 'panic' }); toast('All notes off'); });
$('#mmoctdn').addEventListener('click', () => setOct(perf.oct - 1));
$('#mmoctup').addEventListener('click', () => setOct(perf.oct + 1));
$('#mmoctv').addEventListener('click', () => setOct(0));
$('#mmtrdn').addEventListener('click', () => setTrans(perf.trans - 1));
$('#mmtrup').addEventListener('click', () => setTrans(perf.trans + 1));
$('#mmtrv').addEventListener('click', () => setTrans(0));
$('#mmrevert').addEventListener('click', () => loadProgram(prog.bank, prog.idx));
$('#mmsave').addEventListener('click', () => saveToUser());
$('#mmsaveplace').addEventListener('click', () => saveInPlace());
$('#mmeditor').addEventListener('click', () => { setMidiMode(false); selectPage(Object.keys(PAGESET())[0]); });
// computer keys: left / right arrow = previous / next program, Escape leaves (not while typing in the search box)
window.addEventListener('keydown', e => {
  if (!inMidiMode() || e.metaKey || e.ctrlKey || e.altKey) return;
  const tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepProgram(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); stepProgram(1); } else if (e.key === 'Escape') setMidiMode(false);
});
