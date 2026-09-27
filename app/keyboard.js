// Keyboard page, notes, on-screen keyboard, computer keys, joystick, ribbon, SW1/SW2, play mode.
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
// ---------------- Keyboard page: on-screen keys, play mode, MIDI program buttons ----------------
function pageKeys() {
  const sel = (label, opts, val, on) => { const w = el('label', 'ctl'), s = el('select'); w.append(el('span', 'nm', label), el('span'), s);
    opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); }); s.value = String(val); s.addEventListener('change', () => on(s.value)); return w; };
  const rng = (label, min, max, val, fmt, on) => { const w = el('label', 'ctl'), out = el('output', null, fmt(val)), r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.value = val;
    r.addEventListener('input', () => { on(Number(r.value)); out.textContent = fmt(Number(r.value)); }); w.append(el('span', 'nm', label), out, r); return w; };
  const tog = (label, val, on) => { const w = el('label', 'tog'), c = el('input'); c.type = 'checkbox'; c.checked = !!val; c.addEventListener('change', () => on(c.checked)); w.append(c, document.createTextNode(label)); return w; };
  const btn = (label, fn, cls) => { const b = el('button', 'hw' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const set = (k, v, re) => { kbs[k] = v; kbApply(); if (re) renderPage(); };
  const whiteNotes = []; for (let n = 21; n <= 108; n++) if (!isBlack(n)) whiteNotes.push([n, F.note(n)]);
  return [
    { title: 'Keys', custom: host => {
      const g = el('div', 'grid');
      g.appendChild(sel('Octaves', [[0, 'Fit to the screen']].concat([1, 2, 3, 4, 5, 6, 7].map(n => [n, n + (n > 1 ? ' octaves' : ' octave')])), kbs.oct, v => set('oct', Number(v), true)));
      g.appendChild(sel('Rows', [[1, 'One row'], [2, 'Two rows (the upper row goes on higher)']], kbs.rows, v => set('rows', Number(v))));
      g.appendChild(sel('Lowest key', [[-1, 'Automatic (middle C in the centre)']].concat(whiteNotes), kbs.start, v => set('start', Number(v))));
      if (!kbs.oct) g.appendChild(rng('Key width', 16, 80, kbs.kw || 28, v => v + ' px', v => set('kw', v)));
      g.appendChild(rng('Key height', 60, 400, kbs.h || 120, v => kbs.h ? v + ' px' : 'automatic', v => set('h', v)));
      g.appendChild(sel('Note names', [['none', 'None'], ['c', 'On the C keys'], ['all', 'On every white key']], kbs.labels, v => set('labels', v)));
      g.appendChild(rng('Touch velocity', 0, 127, kbs.vel, v => v ? String(v) : 'by position', v => set('vel', v)));
      host.appendChild(g);
      const row = el('div', 'btnrow'); row.appendChild(btn('Automatic height', () => set('h', 0, true))); row.appendChild(btn('Reset all key settings', () => { for (const k of ['oct', 'kw', 'start', 'rows', 'h', 'bl', 'bw', 'hideBlack', 'labels', 'vel']) kbs[k] = clone(kbDefault[k]); kbApply(); renderPage(); toast('Keyboard reset'); }));
      host.appendChild(row);
      host.appendChild(el('p', 'help', 'The Oct buttons still shift what the keys play; the computer keys (A W S E D …) start at the lowest C on the screen. Touch velocity “by position” plays softer near the top of a key and louder near the bottom; any other value plays every note at that velocity.'));
    } },
    { title: 'Black keys', custom: host => {
      const pre = el('div', 'bkpre');
      [['Normal', 60, 62, false], ['Small', 45, 50, false], ['Very small', 28, 38, false], ['Hidden', kbs.bl, kbs.bw, true]].forEach(([t, bl, bw, hide]) => {
        const b = btn(t, () => { kbs.bl = bl; kbs.bw = bw; kbs.hideBlack = hide; kbApply(); renderPage(); });
        b.setAttribute('aria-pressed', String(hide ? kbs.hideBlack : !kbs.hideBlack && kbs.bl === bl && kbs.bw === bw)); b.classList.add('sm'); pre.appendChild(b);
      });
      host.appendChild(pre);
      if (!kbs.hideBlack) { const g = el('div', 'grid');
        g.appendChild(rng('Length', 20, 80, kbs.bl, v => v + '%', v => set('bl', v)));
        g.appendChild(rng('Width', 25, 90, kbs.bw, v => v + '%', v => set('bw', v)));
        host.appendChild(g); }
      host.appendChild(el('p', 'help', kbs.hideBlack ? 'Only the white keys are shown, each one wider. Sharps and flats still play from MIDI and the computer keyboard.' : 'Length and width are measured against a white key. Shorter black keys leave more of the white keys free to touch.'));
    } },
    { title: 'Controls', custom: host => {
      const g = el('div', 'grid'), setCtl = (k, v) => { kbs.ctl[k] = v; kbApply(); };
      for (const [k, label] of CTL_ITEMS) g.appendChild(tog(label, kbs.ctl[k], v => setCtl(k, v)));
      host.appendChild(g);
      const row = el('div', 'btnrow');
      row.appendChild(btn('Show all', () => { for (const [k] of CTL_ITEMS) kbs.ctl[k] = true; kbApply(); renderPage(); }));
      row.appendChild(btn('Hide all', () => { for (const [k] of CTL_ITEMS) kbs.ctl[k] = false; kbApply(); renderPage(); }));
      row.appendChild(btn('Default', () => { kbs.ctl = clone(kbDefault.ctl); kbApply(); renderPage(); }));
      host.appendChild(row);
      host.appendChild(el('p', 'help', 'Choose what sits next to the keys (normal view and play mode). Fewer controls leave more width for the keys. The vertical sticks go at the left of the keys and spring back to the centre: the X stick bends the pitch (up +X, down −X, like the joystick left/right), the Y stick sends modulation (up +Y = CC1, down −Y = CC2).'));
    } },
    { title: 'Play mode', custom: host => {
      const g = el('div', 'grid');
      g.appendChild(tog('Full screen and turn sideways', kbs.fullscreen, v => set('fullscreen', v)));
      host.appendChild(g);
      const row = el('div', 'btnrow'); row.appendChild(btn('Start play mode', () => { startAudio(); setPlayMode(true); })); host.appendChild(row);
      host.appendChild(el('p', 'help', 'Play mode hides the editor so the keyboard fills the screen. Hold a phone sideways: Android browsers turn and go full screen by themselves; on an iPhone, turn it by hand (and turn off the portrait orientation lock). Exit returns to the editor.'));
    } },
    { title: 'MIDI program buttons', custom: host => {
      for (const [k, lab, key] of [['next', 'Next program', 'midiNext'], ['prev', 'Previous program', 'midiPrev']]) {
        const r = el('div', 'learnrow'); r.append(el('span', 'nm', lab), el('span', 'bind', midiLearn === k ? 'press the button now…' : bindName(kbs[key])));
        r.appendChild(btn(midiLearn === k ? 'Cancel' : 'Learn', () => { midiLearn = midiLearn === k ? null : k; if (midiLearn) $('#midibtn').click(); renderPage(); }, midiLearn === k ? 'sm learning' : 'sm'));
        if (kbs[key]) r.appendChild(btn('Clear', () => { kbs[key] = null; saveKbs(); renderPage(); }, 'sm'));
        host.appendChild(r);
      }
      const g = el('div', 'grid');
      g.appendChild(sel('Program change messages', [['step', 'Step to the next or previous program'], ['bank', 'Pick that number in the current bank'], ['off', 'Ignore']], kbs.pc, v => { kbs.pc = v; saveKbs(); }));
      host.appendChild(g);
      host.appendChild(el('p', 'help', 'Press Learn, then press the button on your MIDI keyboard: it can send a note, a controller or a program change. Many keyboards’ program +/− buttons send program changes; “Step” follows their direction, so they work with no learning at all. MIDI must be switched on (the MIDI button at the top).'));
    } }
  ];
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
// keyboard settings (Keyboard page). oct 0 = as many keys as fit at width kw; start -1 = middle C near the centre;
// rows 1 or 2 (the upper row goes on from the lower one's top key); h 0 = automatic height; bl / bw = black key length / width in % of a white key; vel 0 = by where the key is touched
// ctl: which controls are shown beside the keys (CTL_ITEMS)
const CTL_ITEMS = [['oct', 'Octave buttons'], ['trans', 'Transpose buttons'], ['joy', 'Joystick'], ['xbar', 'Vertical X stick (pitch bend)'], ['ybar', 'Vertical Y stick (modulation)'], ['ribbon', 'Ribbon'], ['sw', 'SW1 / SW2 buttons']];
const kbDefault = { oct: 0, kw: 0, start: -1, rows: 1, h: 0, bl: 60, bw: 62, hideBlack: false, labels: 'c', vel: 0, fullscreen: true, pc: 'step', midiNext: null, midiPrev: null,
  ctl: { oct: true, trans: true, joy: true, xbar: false, ybar: false, ribbon: true, sw: true } };
const kbs = Object.assign(clone(kbDefault), store.get('moss-kb', {}));
{ const c = kbs.ctl && typeof kbs.ctl === 'object' ? kbs.ctl : {}; kbs.ctl = {};
  // older settings had one switch, playCtl (joystick, ribbon and SW buttons in play mode)
  for (const [k] of CTL_ITEMS) kbs.ctl[k] = typeof c[k] === 'boolean' ? c[k] : kbs.playCtl === false && ['joy', 'ribbon', 'sw'].includes(k) ? false : kbDefault.ctl[k];
  delete kbs.playCtl; }
{ const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
  kbs.oct = num(kbs.oct, 0, 7, 0); kbs.kw = kbs.kw ? num(kbs.kw, 16, 80, 0) : 0; kbs.h = kbs.h ? num(kbs.h, 60, 400, 0) : 0;
  kbs.rows = num(kbs.rows, 1, 2, 1); kbs.start = num(kbs.start, -1, 108, -1); if (kbs.start >= 0 && isBlack(kbs.start)) kbs.start--;
  kbs.bl = num(kbs.bl, 20, 80, 60); kbs.bw = num(kbs.bw, 25, 90, 62); kbs.vel = num(kbs.vel, 0, 127, 0);
  if (!['none', 'c', 'all'].includes(kbs.labels)) kbs.labels = 'c'; if (!['step', 'bank', 'off'].includes(kbs.pc)) kbs.pc = 'step'; }
const saveKbs = () => store.set('moss-kb', kbs);
function kbApply() { saveKbs(); const d = $('#dock'); d.classList.toggle('kbfix', !!kbs.h); d.classList.toggle('rows2', kbs.rows > 1); d.style.setProperty('--kb-h', kbs.h + 'px'); ctlApply(); buildKb(); setDockH(); }
// show or hide each control; the controls column goes away when it has nothing to show
function ctlApply() {
  const c = kbs.ctl;
  $('#octgrp').hidden = !c.oct; $('#trgrp').hidden = !c.trans; $('#joy').hidden = !c.joy; $('#ribbon').hidden = !c.ribbon; $('#swrow').hidden = !c.sw;
  $('#xbar').hidden = !c.xbar; $('#ybar').hidden = !c.ybar; $('#ctltog').hidden = !c.joy && !c.ribbon;
  const none = !c.oct && !c.trans && !c.joy && !c.ribbon && !c.sw;
  $('#ctrls').hidden = none; document.body.classList.toggle('noctl', none);
}
function buildKb() {
  const kb = $('#kb'), W = kb.clientWidth || 360; kb.innerHTML = '';
  const whites = kbs.oct ? 7 * kbs.oct + 1 : Math.max(8, Math.min(52, Math.floor(W / (kbs.kw || (W < 520 ? 25 : 30)))));
  const base = kbs.start >= 0 ? kbs.start : 60 - 12 * Math.floor(kbs.rows * Math.floor(whites / 7) / 2); // default: middle C near the centre (between the rows)
  if (kbs.rows > 1) { const top = kbRow(kb, base, whites, W, '50%', 'calc(50% - 3px)'); kbRow(kb, top, whites, W, '0', 'calc(50% - 3px)'); }
  else kbRow(kb, base, whites, W, '0', '100%');
}
// one row of keys from note base (a white key) with the given number of white keys; returns its top white key
function kbRow(kb, base, whites, W, top, height) {
  const row = el('div', 'kbrow'); row.style.top = top; row.style.height = height; kb.appendChild(row);
  const notes = []; let n = base, c = 0;
  while (c < whites && n <= 127) { if (!isBlack(n)) { c++; notes.push(n); } else if (!kbs.hideBlack) notes.push(n); n++; }
  const nw = notes.filter(k => !isBlack(k)).length || 1, ww = W / nw, bw = ww * kbs.bw / 100;
  let wi = 0, last = base; const blacks = [];
  for (const k of notes) {
    if (!isBlack(k)) {
      const d = el('div', 'wk'); d.dataset.n = k; d.style.left = (wi * ww) + 'px'; d.style.width = (ww + 0.5) + 'px';
      if (kbs.labels === 'all' || (kbs.labels === 'c' && k % 12 === 0)) d.appendChild(el('span', 'c' + (k % 12 === 0 ? ' cn' : ''), kbs.labels === 'all' && k % 12 ? NOTE_NAMES[k % 12] : F.note(k + perf.oct * 12)));
      if (lit.has(k)) d.classList.add('on');
      row.appendChild(d); wi++; last = k;
    } else if (wi > 0) { const d = el('div', 'bk'); d.dataset.n = k; d.style.left = (wi * ww - bw / 2) + 'px'; d.style.width = bw + 'px'; d.style.height = kbs.bl + '%'; if (lit.has(k)) d.classList.add('on'); blacks.push(d); }
  }
  blacks.forEach(d => row.appendChild(d));
  return last;
}
const ptr = new Map();
function keyAt(x, y) { const e = document.elementFromPoint(x, y); const k = e && e.closest && e.closest('#kb .wk, #kb .bk'); return k ? { n: Number(k.dataset.n), el: k } : null; }
function velAt(y, k) { if (kbs.vel) return kbs.vel; const r = k.el.getBoundingClientRect(); return Math.round(40 + 87 * Math.max(0, Math.min(1, (y - r.top) / r.height))); }
const kbEl = $('#kb');
kbEl.addEventListener('pointerdown', e => {
  e.preventDefault(); const k = keyAt(e.clientX, e.clientY); if (!k) return;
  try { kbEl.setPointerCapture(e.pointerId); } catch (x) { console.debug('pointer capture failed', x); }
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
// phones: touches on the playing surfaces must not select text, show the magnifier, scroll or zoom (iOS ignores
// touch-action for some of these, so the touch events themselves are cancelled; pointer events still arrive)
const noTouch = e => { if (e.cancelable) e.preventDefault(); };
for (const s of ['#kb', '#joy', '#ribbon', '#xbar', '#ybar']) for (const t of ['touchstart', 'touchmove', 'touchend']) $(s).addEventListener(t, noTouch, { passive: false });
// iOS pinch zoom (Safari ignores user-scalable=no): cancel it on the dock and everywhere in play mode
const inPlayArea = e => document.body.classList.contains('play') || (e.target && e.target.closest && e.target.closest('#dock'));
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, e => { if (inPlayArea(e)) noTouch(e); }, { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1 && inPlayArea(e)) noTouch(e); }, { passive: false });
$('#dock').addEventListener('dblclick', e => e.preventDefault());
let rsT = 0; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(buildKb, 120); });

// computer keyboard
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
const keyOf = e => e.code === 'Semicolon' ? ';' : /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : (e.key || '').toLowerCase();
const kdown = new Map();
// the computer keys start at the lowest C of the on-screen keyboard (middle C when it is automatic)
const compKeysBase = () => kbs.start < 0 ? 60 : Math.min(108, kbs.start + (12 - kbs.start % 12) % 12);
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tg = e.target; if (tg && (tg.tagName === 'INPUT' && (tg.type === 'text' || tg.type === 'search') || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) return;
  const k = keyOf(e);
  if (k === 'z' && !e.repeat) { setOct(perf.oct - 1); return; }
  if (k === 'x' && !e.repeat) { setOct(perf.oct + 1); return; }
  if (k === 'c' && !e.repeat) { setTrans(perf.trans - 1); return; }
  if (k === 'v' && !e.repeat) { setTrans(perf.trans + 1); return; }
  if (KEYMAP[k] === undefined || e.repeat) return;
  if (tg && tg.tagName === 'INPUT' && tg.type === 'range') return;
  kdown.set(k, true); playOn('k:' + k, compKeysBase() + KEYMAP[k], 100); e.preventDefault();
});
window.addEventListener('keyup', e => { const k = keyOf(e); if (kdown.has(k)) { playOff('k:' + k); kdown.delete(k); } });
window.addEventListener('blur', () => { kdown.forEach((_, k) => playOff('k:' + k)); kdown.clear(); });

// ---------------- joystick & ribbon ----------------
const joy = $('#joy'), knob = joy.querySelector('.knob');
let joyId = null, lastCC1 = -1, lastCC2 = -1;
// X = pitch bend, Y = modulation (+Y CC1, -Y CC2); shared by the joystick and the vertical sticks
function sendX(x) { send({ t: 'bend', v: x }); }
function sendY(y) {
  const c1 = y > 0 ? Math.round(y * 127) : 0, c2 = y < 0 ? Math.round(-y * 127) : 0;
  if (c1 !== lastCC1) { send({ t: 'cc', c: 1, v: c1 }); lastCC1 = c1; }
  if (c2 !== lastCC2) { send({ t: 'cc', c: 2, v: c2 }); lastCC2 = c2; }
}
function joySet(x, y) { knob.style.left = (50 + x * 44) + '%'; knob.style.top = (50 - y * 40) + '%'; sendX(x); sendY(y); }
function joyFromEvent(e) { const r = joy.getBoundingClientRect(); const x = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1)); const y = Math.max(-1, Math.min(1, 1 - (e.clientY - r.top) / r.height * 2)); joySet(Math.abs(x) < 0.06 ? 0 : x, Math.abs(y) < 0.06 ? 0 : y); }
joy.addEventListener('pointerdown', e => { e.preventDefault(); joyId = e.pointerId; try { joy.setPointerCapture(e.pointerId); } catch (x) { console.debug('pointer capture failed', x); } if (!ctx) startAudio(); joyFromEvent(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyFromEvent(e); });
const joyUp = e => { if (e.pointerId !== joyId) return; joyId = null; joySet(0, 0); };
joy.addEventListener('pointerup', joyUp); joy.addEventListener('pointercancel', joyUp); joy.addEventListener('lostpointercapture', joyUp);
// vertical sticks: up = +, down = -, back to the centre on release
for (const [id, out] of [['#xbar', sendX], ['#ybar', sendY]]) {
  const bar = $(id), bk = bar.querySelector('.knob'); let bid = null;
  const setV = v => { bk.style.top = (50 - v * 42) + '%'; out(v); };
  const from = e => { const r = bar.getBoundingClientRect(); const v = Math.max(-1, Math.min(1, 1 - (e.clientY - r.top) / r.height * 2)); setV(Math.abs(v) < 0.06 ? 0 : v); };
  bar.addEventListener('pointerdown', e => { e.preventDefault(); bid = e.pointerId; try { bar.setPointerCapture(e.pointerId); } catch (x) { console.debug('pointer capture failed', x); } if (!ctx) startAudio(); from(e); });
  bar.addEventListener('pointermove', e => { if (e.pointerId === bid) from(e); });
  const up = e => { if (e.pointerId !== bid) return; bid = null; setV(0); };
  bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up); bar.addEventListener('lostpointercapture', up);
}
const rib = $('#ribbon'), dot = rib.querySelector('.dot'); let ribId = null;
function ribFrom(e) { const r = rib.getBoundingClientRect(); const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); dot.style.left = 'calc(' + (x * 100) + '% - 9px)'; send({ t: 'cc', c: 16, v: Math.round(x * 127) }); }
rib.addEventListener('pointerdown', e => { e.preventDefault(); send({ t: 'ribz', v: 1 }); ribId = e.pointerId; try { rib.setPointerCapture(e.pointerId); } catch (x) { console.debug('pointer capture failed', x); } if (!ctx) startAudio(); ribFrom(e); });
rib.addEventListener('pointermove', e => { if (e.pointerId === ribId) ribFrom(e); });
const ribUp = e => { if (e.pointerId !== ribId) return; ribId = null; send({ t: 'ribz', v: 0 }); dot.style.left = 'calc(50% - 9px)'; send({ t: 'cc', c: 16, v: 64 }); };
rib.addEventListener('pointerup', ribUp); rib.addEventListener('pointercancel', ribUp); rib.addEventListener('lostpointercapture', ribUp);
const swState = [0, 0];
// the SW1/SW2 buttons also light up when a MIDI controller sends CC80/81
function swShow(k, on) { swState[k] = on ? 1 : 0; $(k ? '#sw2' : '#sw1').setAttribute('aria-pressed', String(!!on)); }
[['#sw1', 0, 80], ['#sw2', 1, 81]].forEach(([id, k, cc]) => { const b = $(id); if (!b) return;
  b.addEventListener('click', () => { swShow(k, !swState[k]); if (!ctx) startAudio(); send({ t: 'cc', c: cc, v: swState[k] ? 127 : 0 }); }); });
$('#ctltog').addEventListener('click', () => { const c = $('#ctrls'); const open = c.classList.toggle('collapsed') === false; $('#ctltog').setAttribute('aria-expanded', String(open)); setDockH(); });
function setDockH() { if (document.body.classList.contains('play') || document.body.classList.contains('midi')) return; const h = $('#dock').getBoundingClientRect().height; document.documentElement.style.setProperty('--dock-h', Math.ceil(h) + 'px'); }

// ---------------- play mode ----------------
// The keyboard and controllers fill the screen; on phones that allow it, the page goes full screen and turns sideways.
const vpMeta = document.querySelector('meta[name="viewport"]'), vpBase = vpMeta ? vpMeta.content : '';
function setPlayMode(on) {
  document.body.classList.toggle('play', on);
  // no zoom while playing (also resets a zoom that happened before); normal zoom returns when play mode ends
  if (vpMeta) vpMeta.content = on ? vpBase + ', maximum-scale=1, user-scalable=no' : vpBase;
  if (on) { try { const sel = window.getSelection(); if (sel) sel.removeAllRanges(); } catch (e) { console.debug('clear selection failed', e); } }
  else { pbListOpen(false); if (favOnly) setFavOnly(false); }
  wakeLock(on);
  if (on && kbs.fullscreen) {
    const de = document.documentElement, rf = de.requestFullscreen || de.webkitRequestFullscreen;
    try { const p = rf && rf.call(de, { navigationUI: 'hide' }); if (p && p.then) p.then(() => { try { const q = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (q && q.catch) q.catch(e => console.debug('orientation lock refused', e)); } catch (e) { console.debug('orientation lock failed', e); } }, e => console.debug('full screen refused', e)); } catch (e) { console.debug('full screen failed', e); }
  } else if (!on) {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { console.debug('orientation unlock failed', e); }
    const fe = document.fullscreenElement || document.webkitFullscreenElement, xf = document.exitFullscreen || document.webkitExitFullscreen;
    if (fe && xf) { try { const p = xf.call(document); if (p && p.catch) p.catch(e => console.debug('exit full screen failed', e)); } catch (e) { console.debug('exit full screen failed', e); } }
  }
  requestAnimationFrame(() => { buildKb(); setDockH(); });
}
// keep the screen on while playing (Screen Wake Lock; the browser drops it when the page is hidden, so it is taken again on return)
let wakeSentinel = null;
async function wakeLock(on) {
  if (!on) { if (wakeSentinel) { try { await wakeSentinel.release(); } catch (e) { console.debug('wake lock release failed', e); } wakeSentinel = null; } return; }
  if (!navigator.wakeLock || (wakeSentinel && !wakeSentinel.released)) return;
  try { wakeSentinel = await navigator.wakeLock.request('screen'); } catch (e) { console.debug('wake lock refused', e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.classList.contains('play')) wakeLock(true); });
// Sustain: an on-screen damper pedal (CC64); it also shows the pedal of a MIDI keyboard
let sustainOn = false;
function sustainShow(on) { sustainOn = !!on; for (const b of [$('#pbsus'), $('#mmsus')]) b.setAttribute('aria-pressed', String(sustainOn)); }
for (const b of [$('#pbsus'), $('#mmsus')]) b.addEventListener('click', () => { sustainShow(!sustainOn); if (!ctx) startAudio(); send({ t: 'cc', c: 64, v: sustainOn ? 127 : 0 }); });
$('#playbtn').addEventListener('click', () => { startAudio(); setPlayMode(true); });
$('#pbexit').addEventListener('click', () => setPlayMode(false));
$('#pbkeys').addEventListener('click', () => { setPlayMode(false); selectPage('keys'); });
$('#pbprev').addEventListener('click', () => stepProgram(-1));
$('#pbnext').addEventListener('click', () => stepProgram(1));
// the program list: tapping the name opens it; picking a program (or Close, or Escape) closes it
const pbList = progBrowser($('#pblbody'), e => { loadProgram(e.b, e.i); pbListOpen(false); }, () => !$('#pbl').hidden);
function pbListOpen(on) {
  const box = $('#pbl'); if (box.hidden === !on) return;
  box.hidden = !on; $('#pbnamebtn').setAttribute('aria-expanded', String(on));
  if (on) pbList.open(); else if (document.body.classList.contains('play')) $('#pbnamebtn').focus({ preventScroll: true });
}
$('#pbnamebtn').addEventListener('click', () => pbListOpen(true));
$('#pblclose').addEventListener('click', () => pbListOpen(false));
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !document.body.classList.contains('play')) return;
  if (!$('#pbl').hidden) { e.preventDefault(); pbListOpen(false); return; }
  if (!document.fullscreenElement) setPlayMode(false);
});
