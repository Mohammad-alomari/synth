// Performance settings: octave, transpose, scales and maqams (Scale page).
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
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
  $('#scalebtn').textContent = 'Scale: ' + scaleLabel(); quickScaleUI();
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
      ld.addEventListener('click', () => loadMaqam(perf.maqam, perf.maqamKey));
      const clr = el('button', 'hw', 'Clear your scale'); clr.type = 'button';
      clr.addEventListener('click', () => { perf.user = new Array(12).fill(0); perf.userLabel = ''; applyScaleChange('Your scale is back to equal tuning'); });
      row.append(ld, clr); host.appendChild(row);
      host.appendChild(el('p', 'help', 'Loading replaces your scale with the maqam\u2019s quarter tones at the chosen starting note. Bayati and Saba share the same tuning; Saba also uses the G\u266d key.'));
    } }
  ];
}
// replaces "your scale" with a maqam's quarter tones starting on key
function loadMaqam(id, key) {
  const m = MAQAMS.find(x => x[0] === id) || MAQAMS[0];
  perf.maqam = m[0]; perf.maqamKey = key;
  perf.user = new Array(12).fill(0);
  for (const [deg, c] of Object.entries(m[3])) perf.user[(key + Number(deg)) % 12] = c;
  perf.scale = 'user'; perf.userLabel = m[1] + ' on ' + NOTE_NAMES[key];
  perf.sel = (key + Number(Object.keys(m[3])[0] || 0)) % 12;
  applyScaleChange('Loaded ' + perf.userLabel);
}
// the play bar's scale switch: equal, Arabic, a maqam or your scale (choosing one turns program scales off, so it is heard)
// what is playing, as the switch shows it: { v: option value, key: the key it is on }
function quickScale() {
  if (progScaleOn()) return { v: 'prog', key: 0 };
  if (perf.scale === 'user') { // a loaded maqam is "your scale" labelled "<maqam> on <key>"
    for (const m of MAQAMS) { const key = NOTE_NAMES.findIndex(n => perf.userLabel === m[1] + ' on ' + n); if (key >= 0) return { v: 'mq:' + m[0], key }; }
    return { v: 'user', key: 0 };
  }
  return { v: perf.scale, key: perf.key };
}
function quickScaleUI() {
  const s = $('#pbscale'), k = $('#pbkey'); if (!s) return;
  const { v, key } = quickScale(), opts = [['equal', 'Equal'], ['arabic', 'Arabic']].concat(MAQAMS.map(m => ['mq:' + m[0], m[1]]), [['user', perf.scale === 'user' && v === 'user' && perf.userLabel ? perf.userLabel : 'Your scale']]);
  if (v === 'prog') opts.unshift(['prog', 'Program scale']);
  else if (!opts.some(o => o[0] === v)) opts.unshift([v, scaleDef()[1]]);
  s.innerHTML = ''; for (const [val, t] of opts) { const o = el('option', null, t); o.value = val; s.appendChild(o); }
  s.value = v;
  if (!k.options.length) NOTE_NAMES.forEach((n, i) => { const o = el('option', null, n); o.value = i; k.appendChild(o); });
  k.disabled = !(v === 'arabic' || v.startsWith('mq:')); k.value = String(key);
}
$('#pbscale').addEventListener('change', e => {
  const v = e.target.value; if (v === 'prog') return;
  perf.progScale = false;
  if (v.startsWith('mq:')) { const m = MAQAMS.find(x => 'mq:' + x[0] === v); loadMaqam(m[0], m[2]); } // on its usual key
  else { perf.scale = v; applyScaleChange(); }
});
$('#pbkey').addEventListener('change', e => {
  const key = Number(e.target.value), { v } = quickScale();
  if (v === 'arabic') { perf.key = key; applyScaleChange(); } else if (v.startsWith('mq:')) loadMaqam(v.slice(3), key);
});
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
