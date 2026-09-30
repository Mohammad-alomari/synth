// Program list and LCD, signal-flow diagram, voice LEDs and scope.
// One of the app/ files: build.py joins them in order inside one function scope, so they share their top-level names.
// ---------------- program select / LCD ----------------
// removes an imported bank's stored copy
function forget(b) { if (!b.builtin) dropEdits(b.combis ? 'P' : 'M', b.name); if (b.dbId != null) idb.del(b.dbId).catch(e => { console.error('Could not delete stored bank', e); status('Could not delete ' + b.name + ' from browser storage; it may come back after a reload.'); }); }
function removeTriSet(set) {
  triSets.splice(triSets.indexOf(set), 1);
  for (const L of [pcmBanks, combiBanks]) for (let i = L.length - 1; i >= 0; i--) if (L[i].set === set) L.splice(i, 1);
}
// list group (bank) names, as the program browser shows them
const pmGroup = b => b.builtin && b.fmt === 'triton' ? b.name : 'Bank ' + bankLetter(b) + ' from ' + b.name;
const pcGroup = b => 'Bank ' + b.letter + ' (PCM) from ' + b.set.name;
const cbGroup = b => 'Combinations ' + b.letter + ' from ' + b.set.name;
const userGroup = () => userBank.length ? 'User programs' : 'User programs (none saved yet)';
// the playing program's group
function progGroup() {
  const k = Math.floor(prog.idx / 128), b = prog.bank === 'pm' ? pcgBanks[k] : prog.bank === 'pc' ? pcmBanks[k] : prog.bank === 'cb' ? combiBanks[k] : null;
  return prog.bank === 'st' ? 'Starter programs' : prog.bank === 'us' ? userGroup() : !b ? '' : prog.bank === 'pm' ? pmGroup(b) : prog.bank === 'pc' ? pcGroup(b) : cbGroup(b);
}
// every program in list order, grouped by bank: { v: 'bank:idx', b, i, t: program text, g: group }
function progEntries() {
  const out = [], add = (g, b, i, t) => out.push({ v: b + ':' + i, b, i, t, g });
  MOSS_PRESETS.forEach((p, i) => add('Starter programs', 'st', i, String(i).padStart(2, '0') + ' ' + p.name));
  userStarters.forEach((p, i) => { const k = MOSS_PRESETS.length + i; add('Starter programs', 'st', k, String(k).padStart(2, '0') + ' ' + p.name); });
  const ug = userGroup();
  userBank.forEach((p, i) => add(ug, 'us', i, String(i + 1).padStart(2, '0') + ' ' + (p.name || 'Untitled')));
  pcgBanks.forEach((b, bi) => { const g = pmGroup(b); for (let i = 0; i < b.n; i++) add(g, 'pm', bi * 128 + i, bankLetter(b) + String(i).padStart(3, '0') + ' ' + b.names[i]); });
  pcmBanks.forEach((b, bi) => { const g = pcGroup(b); for (let i = 0; i < 128; i++) if (!b.drum[i]) add(g, 'pc', bi * 128 + i, b.letter + String(i).padStart(3, '0') + ' ' + b.names[i]); });
  combiBanks.forEach((b, bi) => { const g = cbGroup(b); for (let i = 0; i < 128; i++) add(g, 'cb', bi * 128 + i, 'C' + b.letter + pad3(i) + ' ' + b.names[i]); });
  return out;
}
// the search box: every word must appear in the program's name, number or group (upper/lower case alike)
let progQuery = '';
// favourites (the ★ in MIDI mode), kept by list group + program text so they survive re-imports;
// favOnly limits the list and the ‹ › steps to them
const favs = new Set((a => Array.isArray(a) ? a : [])(store.get('moss-favs', []))); let favOnly = false;
const favKey = e => e.g + '|' + e.t, isFav = e => favs.has(favKey(e));
const progMatch = (e, words) => { const t = (e.t + ' ' + e.g).toLowerCase(); return words.every(w => t.includes(w)); };
function progList() {
  let all = progEntries(); if (favOnly) all = all.filter(isFav);
  const words = progQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? all.filter(e => progMatch(e, words)) : all;
}
// the program lists changed (a program saved, a bank imported, the favourites filter): open browsers show it
function refreshProgs() { browsers.forEach(b => b.render()); lastButtons(); }
function lcd() {
  const pb = prog.bank === 'pc' ? pcmBanks[Math.floor(prog.idx / 128)] : prog.bank === 'cb' ? combiBanks[Math.floor(prog.idx / 128)] : null;
  $('#pnum').textContent = prog.bank === 'st' ? 'ST ' + String(prog.idx).padStart(2, '0') : prog.bank === 'pm' ? bankLetter(pcgBanks[Math.floor(prog.idx / 128)]) + String(prog.idx % 128).padStart(3, '0')
    : pb ? (prog.bank === 'cb' ? 'C' : '') + pb.letter + String(prog.idx % 128).padStart(3, '0') : 'US ' + String(prog.idx + 1).padStart(2, '0');
  $('#pname').textContent = (patch.name || 'Untitled') + (edited ? ' *' : '');
  $('#pname').title = edited ? 'Edited, not saved' : '';
  $('#pbname').textContent = $('#pnum').textContent + ' ' + $('#pname').textContent;
  $('#progbank').textContent = progGroup() || 'Programs';
  perfLcd(); mmLcd(); browsers.forEach(b => b.sync());
}
// ---------------- recently played programs (Last) ----------------
// The last programs played, newest first (the current one included), kept over a reload. Last goes to the one before,
// and pressing it again comes back, e.g. between a combination and a timbre program being edited. Unsaved edits of a
// program you leave are kept (for this session) and come back with it when you return through Last or the recent list.
const RECENT_MAX = 6;
let recent = (a => Array.isArray(a) ? a.filter(v => typeof v === 'string') : [])(store.get('moss-recent', [])).slice(0, RECENT_MAX);
const recentEdits = new Map(); // 'bank:idx' -> the program with its unsaved edits
function noteRecent() {
  const v = prog.bank + ':' + prog.idx;
  if (recent[0] !== v) { recent = [v, ...recent.filter(x => x !== v)].slice(0, RECENT_MAX); store.set('moss-recent', recent); }
  lastButtons();
}
// the recent programs that still exist (a removed file takes its programs away), current first
function recentEntries() { const all = new Map(progEntries().map(e => [e.v, e])); return recent.map(v => all.get(v)).filter(Boolean); }
// the program before the current one (after Save to User the current one is not yet in the list)
const lastEntry = () => recentEntries().find(e => e.v !== prog.bank + ':' + prog.idx);
function lastButtons() { const has = !!lastEntry(); ['#lastbtn', '#pblast', '#mmlast'].forEach(s => { const b = $(s); if (b) b.disabled = !has; }); }
function goLast() { const e = lastEntry(); if (e) loadProgram(e.b, e.i, true); }
// fromRecent: opened through Last or the recent list, so kept unsaved edits come back
function loadProgram(bank, idx, fromRecent) {
  const was = prog.bank + ':' + prog.idx, now = bank + ':' + idx, kept = fromRecent ? recentEdits.get(now) : null;
  if (edited && was !== now) { recentEdits.set(was, clone(patch)); toast('Unsaved edits kept: ↶ Last brings them back'); }
  recentEdits.delete(now);
  let pm = null;
  try { pm = bank === 'pm' ? pcgPatch(idx) : bank === 'pc' ? pcmPatch(idx) : bank === 'cb' ? combiPatch(idx) : null; }
  catch (e) { console.error('Could not decode program ' + bank + ':' + idx, e); status('That program could not be read (' + (e && e.message || e) + '); its data may be damaged. The previous program stays.'); return; }
  if ((bank === 'us' && !userBank[idx]) || (bank === 'st' && !(idx < MOSS_PRESETS.length + userStarters.length)) || ((bank === 'pm' || bank === 'pc' || bank === 'cb') && !pm) || !['st', 'us', 'pm', 'pc', 'cb'].includes(bank)) { bank = 'st'; idx = 0; }
  patch = bank === 'st' ? starterPatch(idx) : bank === 'pm' || bank === 'pc' || bank === 'cb' ? pm : refreshTimbres(loadAny(userBank[idx]));
  prog = { bank, idx }; edited = false;
  if (kept && now === bank + ':' + idx) { patch = kept; edited = true; }
  pcmPrepare(patch);
  send({ t: 'patch', p: clone(patch) }); sendTuning();
  if (!PAGESET()[curPage]) curPage = Object.keys(PAGESET())[0];
  renderAll(); saveCurrent(); noteRecent();
  if (edited) status('Your unsaved edits of ' + (patch.name || 'this program') + ' are back.');
  else if (patch.kind === 'combi') status(combiStatus());
  else if (patch.kind === 'pcm') status(pcmStatus(patch));
  else if (patch.korgInfo) { const pl = korgPlayability(patch); status(pl.full ? '' : 'Not built yet: ' + pl.missing.join(', ') + '. That part is silent.'); } else status('');
}
// what a PCM program plays, for the status line
function pcmStatus(P) {
  const own = Object.values(P.ramMap || {}).filter(v => typeof v === 'string'), tri = P.korgInfo && P.korgInfo.fmt === 'triton' ? 'Triton program' : 'Trinity PCM program';
  if (own.length) return tri + ': plays your own samples' + (own.some(k => !(pcmMap.ms[k] || {}).u) ? ' where they are here, stand-ins for the rest' : '') + ' (see the Program page).';
  return tri + ': ' + (korgPacks ? 'Korg’s own recordings where this copy has them, stand-in recordings for the rest' : 'Korg’s samples are not available, so stand-in recordings play') + ' (see the Program page).';
}
// previous / next program; with a search, only through its results
function stepProgram(dir) {
  let list = progList(); if (!list.length) list = progEntries();
  let k = list.findIndex(x => x.b === prog.bank && x.i === prog.idx);
  k = k < 0 ? (dir > 0 ? 0 : list.length - 1) : (k + dir + list.length) % list.length;
  loadProgram(list[k].b, list[k].i);
}
$('#prev').addEventListener('click', () => stepProgram(-1));
$('#next').addEventListener('click', () => stepProgram(1));
$('#lastbtn').addEventListener('click', goLast);
function renderAll() { lcd(); renderTabs(); renderPage(); renderFlow(); }

// ---------------- program browser (editor, play mode list, MIDI mode Browse) ----------------
// Lists one bank at a time, starting with the current program's; the bank button above the list shows every bank to
// switch to. A search or the favourites filter lists the matches from every bank. All browsers share the search,
// so ‹ › then step through its results.
const browsers = [], RECENT = 'Recently played';
function setProgQuery(v) { progQuery = v; }
function setFavOnly(on) { favOnly = on; refreshProgs(); }
function progBrowser(host, onPick, shown = () => !host.hidden) {
  const bar = el('div', 'pbr-bar'), q = el('input'), fav = el('button', 'hw', '★ Favourites'), bankBtn = el('button', 'pbr-bank'), list = el('div', 'pbr-list');
  q.type = 'search'; q.placeholder = 'Find a program'; q.autocomplete = 'off'; q.setAttribute('aria-label', 'Find a program');
  fav.type = 'button'; fav.title = 'Show and step through favourites only'; bankBtn.type = 'button';
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Programs');
  bar.append(q, fav); host.innerHTML = ''; host.append(bar, bankBtn, list);
  let bank = null, showBanks = false, shownFor = '', qT = 0;
  const item = (label, sel, cls, fn) => { const b = el('button', null); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(sel)); b.appendChild(el('span', null, label)); if (cls) b.appendChild(el('span', cls[0], cls[1])); b.addEventListener('click', fn); list.appendChild(b); return b; };
  const centre = b => { list.scrollTop = b ? Math.max(0, b.offsetTop - list.clientHeight / 2 + b.offsetHeight / 2) : 0; };
  function render() {
    if (!shown()) return;
    const cur = prog.bank + ':' + prog.idx, all = progEntries(), ce = all.find(e => e.v === cur), groups = [...new Set(all.map(e => e.g))];
    if (document.activeElement !== q) q.value = progQuery;
    fav.setAttribute('aria-pressed', String(favOnly));
    if (!bank || (bank !== RECENT && !groups.includes(bank))) bank = ce ? ce.g : groups[0];
    list.innerHTML = ''; let sel = null;
    if (progQuery || favOnly) { // matches from every bank, under their bank names
      bankBtn.hidden = true;
      const hits = progList(); let g = null;
      for (const e of hits) { if (e.g !== g) { g = e.g; list.appendChild(el('div', 'g', g)); } const b = item(e.t, e.v === cur, isFav(e) ? ['st', '★'] : null, () => onPick(e)); if (e.v === cur) sel = b; }
      if (!hits.length) list.appendChild(el('div', 'empty', favOnly && !progQuery ? 'No favourites yet: tap ☆ beside a program name to add it.' : 'No program matches.'));
    } else if (showBanks) { // every bank; the current one is marked
      bankBtn.hidden = false; bankBtn.replaceChildren(el('span', 'bn', 'Choose a bank'), el('span', 'bx', 'Back'));
      bankBtn.setAttribute('aria-label', 'Back to ' + bank);
      const rn = recentEntries().length;
      if (rn) { const b = item(RECENT, bank === RECENT, ['n', String(rn)], () => { bank = RECENT; showBanks = false; render(); }); if (bank === RECENT) sel = b; }
      for (const g of groups) { const b = item(g, g === bank, ['n', String(all.filter(e => e.g === g).length)], () => { bank = g; showBanks = false; render(); }); if (g === bank) sel = b; }
    } else { // the programs of one bank
      bankBtn.hidden = false; bankBtn.replaceChildren(el('span', 'bn', bank), el('span', 'bx', 'Banks ▾'));
      bankBtn.setAttribute('aria-label', 'Bank: ' + bank + '. Show all banks');
      if (bank === RECENT) { // newest first, under their bank names; kept unsaved edits come back with them
        for (const e of recentEntries()) { list.appendChild(el('div', 'g', e.g)); const b = item(e.t, e.v === cur, recentEdits.has(e.v) ? ['st', 'edited'] : null, () => onPick(Object.assign({ recent: true }, e))); if (e.v === cur) sel = b; }
      } else for (const e of all) if (e.g === bank) { const b = item(e.t, e.v === cur, isFav(e) ? ['st', '★'] : null, () => onPick(e)); if (e.v === cur) sel = b; }
    }
    centre(sel);
  }
  q.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { setProgQuery(q.value.trim()); render(); }, 150); });
  fav.addEventListener('click', () => setFavOnly(!favOnly));
  bankBtn.addEventListener('click', () => { showBanks = !showBanks; render(); });
  const api = {
    render,
    // open, or follow the playing program into its bank when it changes
    open() { bank = null; showBanks = false; shownFor = prog.bank + ':' + prog.idx; render(); },
    sync() { const cur = prog.bank + ':' + prog.idx; if (!shown() || cur === shownFor) return; if (bank === RECENT) { shownFor = cur; render(); } else api.open(); }
  };
  browsers.push(api); return api;
}
// the editor's browser opens under the ‹ › buttons from the bank button; it stays open while you try programs
const edBr = progBrowser($('#edbrowse'), e => loadProgram(e.b, e.i, e.recent));
function edBrowse(on) { const box = $('#edbrowse'); box.hidden = !on; $('#progbtn').setAttribute('aria-expanded', String(on)); if (on) { edBr.open(); box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
$('#progbtn').addEventListener('click', () => edBrowse($('#edbrowse').hidden));
$('#edbrowse').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); edBrowse(false); $('#progbtn').focus(); } });

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
  for (const b of Object.values(B)) {
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
  const P = patch, dbl = P.mode === 'double';
  const add = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
  const wires = add('g', {}), short = (n, k) => (n || '').toUpperCase().slice(0, k);
  const msn = O => short(PCM_MS_NAMES[O.msHi < 375 ? O.msHi : 0], 13);
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
  v.forEach((s, i) => { const c = s === 2 ? 'g' : s === 1 ? 'r' : '', e = h.children[i]; if (e.className !== c) e.className = c; }); // only the lights that changed
  if (document.body.classList.contains('midi')) {
    let n = 0; for (const s of v) if (s) n++;
    const vo = $('#mmvoices'), lt = $('#mmlat'), l = '≈ ' + latencyMs() + ' ms';
    if (vo.textContent !== String(n)) vo.textContent = n;
    if (lt.textContent !== l) lt.textContent = l;
  }
}
const scopeBuf = new Float32Array(2048);
let scopeInk = '', scopeGain = 1;
const readInk = () => { scopeInk = getComputedStyle(document.documentElement).getPropertyValue('--lcd-ink').trim() || '#1a2e28'; };
readInk();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readInk); } catch (e) { console.debug('no colour-scheme change events', e); }
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
