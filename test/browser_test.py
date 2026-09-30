# Browser test of the built page (Chromium via Playwright). Starts its own http server; exit code 0 = all passed.
# Usage: python3 test/browser_test.py   (needs node: it builds _test.html with the made-up test banks, test/fixtures.js, and
# writes PCG files from them with test/mkpcg.js; nobody's own files are needed)
# Covers: sound of MOSS / PCM / combination programs in both audio modes, MIDI note-on latency, drum programs left out, every page renders, effects editing,
# phone width, keyboard settings, play mode, MIDI program buttons and SW1/SW2, recording, imported-PCG storage (IndexedDB, reload, migration, removal), synth memory, error messages,
# and the public (Netlify) build.
import asyncio, base64, functools, http.server, os, struct, subprocess, sys, tempfile, threading
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp()
fails = []
def ok(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra != '' else ''), flush=True)
    if not cond: fails.append(name)
def serve(root=ROOT, page='index.html'):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=root)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d/%s' % (srv.server_address[1], page)
def pcg(name, out, which=None):  # a PCG file made from a test bank file (test/fixtures.js), as base64
    subprocess.run(['node', os.path.join(ROOT, 'test', 'mkpcg.js'), name, os.path.join(TMP, out)] + ([which] if which else []), check=True, capture_output=True)
    return base64.b64encode(open(os.path.join(TMP, out), 'rb').read()).decode()

JS = """
window.__t = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  // peak output level while holding notes (waits for stand-in packs first)
  async play(bank, idx, notes, wait) { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048);
    M.loadProgram(bank, idx); await this.sleep(wait || 150); notes.forEach(n => M.noteOn(n, 100)); let pk = 0; const t0 = performance.now();
    while (performance.now() - t0 < 500) { an.getFloatTimeDomainData(buf); for (const v of buf) pk = Math.max(pk, Math.abs(v)); await this.sleep(25); }
    notes.forEach(n => M.noteOff(n)); await this.sleep(150); return pk; },
  // every page of the current program renders something
  pages() { const ids = [...document.querySelectorAll('#tabs [role=tab]')].map(t => t.id.replace(/^tab-/, '')), empty = [];
    for (const id of ids) { window.__moss.selectPage(id); if (!document.querySelector('#page').children.length) empty.push(id); } return [ids.length, empty]; },
  find(re) { const e = window.__moss.progEntries().find(e => re.test(e.v + ' ' + e.t)); return e ? e.v : null; },
  groups() { return [...new Set(window.__moss.progEntries().map(e => e.g))]; },
  group(t) { return this.groups().filter(g => g.includes(t)).length; },
  firstIn(t) { const e = window.__moss.progEntries().find(e => e.g.includes(t)); return e ? e.v : null; },
  inGroup(re) { return window.__moss.progEntries().filter(e => re.test(e.g)); },
  load(v) { const [b, i] = v.split(':'); window.__moss.loadProgram(b, +i); },
  async import(b64, name) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await window.__moss.importPcgFile(new File([u], name)); return document.querySelector('#status').textContent; },
  timbres() { const P = window.__moss.getPatch(); return P.timbres.filter(t => t.status !== 'off').map(t => [t.pLabel, t.pName, t.from || '']); },
  // MIDI latency probe: an AudioWorklet on the synth's output reports the audio time when sound first arrives after being armed
  async probe() {
    if (this.pn) return; const c = window.__mossCtx();
    const src = `class P extends AudioWorkletProcessor { constructor() { super(); this.arm = 0; this.port.onmessage = () => { this.arm = 1; }; }
      process(ins) { const x = ins[0] && ins[0][0]; if (this.arm && x) for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-5) { this.arm = 0; this.port.postMessage(currentTime + i / sampleRate); break; } return true; } }
      registerProcessor('probe', P);`;
    await c.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
    this.pn = new AudioWorkletNode(c, 'probe', { numberOfInputs: 1, numberOfOutputs: 0 }); window.__mossAnalyser().connect(this.pn);
  },
  // a note-on through the page's MIDI handler, from silence: [ms the main thread spent on it, ms of audio until it sounded]
  hit(note) { return new Promise(res => { const M = window.__moss, c = window.__mossCtx(), p = this.pn;
    M.onMidi({ data: [0xB0, 120, 0] });
    setTimeout(() => { let c0 = 0, m0 = 0, m1 = 0, to = 0; const done = r => { clearTimeout(to); p.port.onmessage = null; M.onMidi({ data: [0x80, note, 0] }); res(r); };
      p.port.onmessage = e => done([m1 - m0, (e.data - c0) * 1000]); to = setTimeout(() => done([m1 - m0, -1]), 1000);
      c0 = c.currentTime; m0 = performance.now(); p.port.postMessage(1); M.onMidi({ data: [0x90, note, 100] }); m1 = performance.now(); }, 150); }); },
};
"""

async def open_page(b, url, script_mode=False):
    pg = await b.new_page(viewport={'width': 1200, 'height': 900})
    pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append('page error: ' + str(e)))
    # our own files must load; outside resources (web fonts) may be blocked where the test runs
    pg.on('requestfailed', lambda r: pg.errs.append('failed: ' + r.url) if r.url.startswith(url.rsplit('/', 1)[0]) else None)
    pg.on('response', lambda r: pg.errs.append('HTTP %d: %s' % (r.status, r.url)) if r.status >= 400 else None)
    if script_mode: await pg.add_init_script('delete window.AudioWorkletNode;')
    await pg.add_init_script(JS)
    await pg.goto(url); await pg.wait_for_timeout(500)
    await pg.click('#power'); await pg.wait_for_timeout(1000)
    return pg

async def record_wav(pg, mode):
    # record to WAV: a note played while recording ends up in the downloaded file
    await pg.set_viewport_size({'width': 1200, 'height': 900})
    await pg.evaluate("window.__moss.loadProgram('st', 0)")
    await pg.click('#recbtn'); await pg.wait_for_timeout(300)
    await pg.evaluate("async () => { window.__moss.noteOn(60, 110); await __t.sleep(700); window.__moss.noteOff(60); await __t.sleep(200); }")
    async with pg.expect_download() as dl:
        await pg.click('#recbtn')
    path = await (await dl.value).path(); data = open(path, 'rb').read()
    sr, n = struct.unpack('<I', data[24:28])[0], (len(data) - 44) // 4
    pk = max(abs(x) for x in struct.unpack('<%dh' % (n * 2), data[44:44 + n * 4])) / 32768 if n else 0
    ok('record (%s recorder): a stereo 16-bit WAV of about a second with the note in it' % mode, data[:4] == b'RIFF' and data[8:12] == b'WAVE' and 0.5 < n / sr < 3 and pk > 0.005, [n / sr if n else 0, round(pk, 3)])
    ok('record: the %s recorder was used' % mode, await pg.evaluate('window.__mossRecMode') == mode, await pg.evaluate('window.__mossRecMode'))

async def keyboard_and_midi(pg):
    # SW1/SW2 are visible at every width and follow CC80/81 from MIDI
    ok('SW1 and SW2 are visible (desktop)', await pg.is_visible('#sw1') and await pg.is_visible('#sw2'))
    await pg.evaluate("window.__moss.onMidi({data: [0xB0, 81, 127]})")
    ok('MIDI CC81 lights SW2', await pg.get_attribute('#sw2', 'aria-pressed') == 'true')
    await pg.evaluate("window.__moss.onMidi({data: [0xB0, 81, 0]})")
    # keyboard settings: octaves, lowest key, black keys small or hidden
    keys = "[document.querySelectorAll('#kb .wk').length, document.querySelectorAll('#kb .bk').length, +document.querySelector('#kb .wk').dataset.n]"
    await pg.evaluate("Object.assign(window.__moss.kbs, {oct: 2, start: 50, bl: 28}); window.__moss.kbApply()")
    ok('keyboard: 2 octaves from D3', await pg.evaluate(keys) == [15, 10, 50], await pg.evaluate(keys))
    ok('keyboard: very short black keys', await pg.evaluate("document.querySelector('#kb .bk').style.height") == '28%')
    await pg.evaluate("window.__moss.kbs.hideBlack = true; window.__moss.kbApply()")
    ok('keyboard: black keys hidden', await pg.evaluate(keys) == [15, 0, 50], await pg.evaluate(keys))
    # program change steps through the list; a learned controller is a Next button (press only, not release)
    await pg.evaluate("window.__moss.loadProgram('st', 0); window.__moss.onMidi({data: [0xC0, 9]}); window.__moss.onMidi({data: [0xC0, 10]})")
    ok('MIDI program change steps forward', await pg.evaluate("document.querySelector('#pnum').textContent") == 'ST 02')
    await pg.evaluate("window.__moss.onMidi({data: [0xC0, 9]})")
    ok('MIDI program change steps back', await pg.evaluate("document.querySelector('#pnum').textContent") == 'ST 01')
    await pg.evaluate("async () => { const M = window.__moss; M.kbs.midiNext = {t: 'cc', ch: 0, n: 22}; M.onMidi({data: [0xB0, 22, 127]}); await __t.sleep(120); M.onMidi({data: [0xB0, 22, 0]}); }")
    ok('learned MIDI button: next program', await pg.evaluate("document.querySelector('#pnum').textContent") == 'ST 02')
    # two rows: the upper row goes on from the lower row's top key
    await pg.evaluate("Object.assign(window.__moss.kbs, {oct: 2, start: 48, rows: 2, hideBlack: false}); window.__moss.kbApply()")
    rows = await pg.evaluate("[...document.querySelectorAll('#kb .kbrow')].map(r => [+r.querySelector('.wk').dataset.n, +[...r.querySelectorAll('.wk')].pop().dataset.n])")
    ok('keyboard: two rows, C3-C5 and C5-C7', rows == [[48, 72], [72, 96]], rows)
    # the computer keys start at the lowest C on the screen
    await pg.evaluate("window.__moss.kbs.rows = 1; window.__moss.kbApply()")
    await pg.keyboard.down('a'); held = await pg.evaluate("[...document.querySelectorAll('#kb .wk.on')].map(k => +k.dataset.n)"); await pg.keyboard.up('a')
    ok('computer key A plays the lowest C on the screen (C3)', held == [48], held)
    # editor program browser: the bank button under the display opens the current bank; banks can be switched
    E = '#edbrowse'
    eitems = "[...document.querySelectorAll('#edbrowse .pbr-list button')].map(b => b.firstChild.textContent)"
    await pg.evaluate("window.__moss.loadProgram('st', 1)")
    ok('editor: the bank button shows the current bank', await pg.text_content('#progbank') == 'Starter programs', await pg.text_content('#progbank'))
    await pg.click('#progbtn')
    ok('editor browser: opens on the current bank', await pg.is_visible(E) and await pg.text_content(E + ' .pbr-bank .bn') == 'Starter programs'
       and (await pg.evaluate("document.querySelector('#edbrowse [aria-selected=true]').textContent")).startswith('01'))
    await pg.click(E + ' .pbr-bank')
    banks = await pg.evaluate(eitems)
    target = next(b for b in banks if b.startswith('Bank A (PCM)'))
    await pg.evaluate("t => [...document.querySelectorAll('#edbrowse .pbr-list button')].find(b => b.firstChild.textContent === t).click()", target)
    got = await pg.evaluate(eitems)
    await pg.evaluate("document.querySelectorAll('#edbrowse .pbr-list button')[2].click()"); await pg.wait_for_timeout(100)
    ok('editor browser: picking a program in another bank loads it and the list stays open', await pg.is_visible(E) and (await pg.text_content('#pnum')) == got[2][:4]
       and await pg.text_content('#progbank') == target, [await pg.text_content('#pnum'), got[2][:4]])
    # program search: the list and the ‹ › buttons keep to the results
    await pg.fill(E + ' input', 'organ'); await pg.wait_for_timeout(400)
    found = await pg.evaluate("window.__moss.progList().map(e => [e.t, e.g])")
    names = [t for t, g in found]
    ok('program search: only matching programs are listed', 0 < len(found) < 200 and all('organ' in (t + ' ' + g).lower() for t, g in found)
       and len(await pg.evaluate(eitems)) == len(found), len(found))
    await pg.click('#next'); await pg.wait_for_timeout(100)
    cur = await pg.evaluate("(() => { const P = window.__moss.getPatch(); return window.__moss.progList().some(e => e.t.endsWith(' ' + P.name)); })()")
    ok('program search: next steps within the results', cur)
    await pg.fill(E + ' input', ''); await pg.wait_for_timeout(400)
    ok('program search cleared: every program is listed again', await pg.evaluate("window.__moss.progList().length") > 1000)
    await pg.focus(E + ' input'); await pg.keyboard.press('Escape')
    ok('editor browser: Escape closes it', not await pg.is_visible(E) and await pg.get_attribute('#progbtn', 'aria-expanded') == 'false')
    # play bar: scale switch loads a maqam on its key; Sustain sends the pedal and shows a MIDI pedal
    await pg.evaluate("window.__moss.setPlayMode(true)")
    await pg.select_option('#pbscale', 'mq:bayati')
    t = await pg.evaluate("window.__moss.tuningTable().slice(60, 72)")
    ok('play bar: Bayati on D (E a quarter tone flat)', t[4] == -50 and sum(1 for c in t if c) == 1, t)
    await pg.select_option('#pbkey', '7')
    t = await pg.evaluate("window.__moss.tuningTable().slice(60, 72)")
    ok('play bar: Bayati moved to G (A a quarter tone flat)', t[9] == -50 and sum(1 for c in t if c) == 1, t)
    await pg.select_option('#pbscale', 'equal')
    await pg.click('#pbsus')
    ok('play bar: Sustain on', await pg.get_attribute('#pbsus', 'aria-pressed') == 'true')
    await pg.evaluate("window.__moss.onMidi({data: [0xB0, 64, 0]})")
    ok('a MIDI pedal release shows on the Sustain button', await pg.get_attribute('#pbsus', 'aria-pressed') == 'false')
    await pg.evaluate("window.__moss.setPlayMode(false)")
    # play mode on a phone held sideways: the keyboard fills the screen, the page does not scroll sideways
    await pg.evaluate("const k = window.__moss.kbs; Object.assign(k, {oct: 0, start: -1, bl: 60, hideBlack: false, fullscreen: false, midiNext: null}); window.__moss.kbApply()")
    await pg.set_viewport_size({'width': 844, 'height': 390})
    await pg.evaluate("window.__moss.setPlayMode(true)"); await pg.wait_for_timeout(200)
    w, h = await pg.evaluate("(r => [r.width, r.height])(document.querySelector('#kb').getBoundingClientRect())")
    ok('play mode (landscape phone): keyboard fills the screen', w > 600 and h > 280, [w, h])
    ok('play mode: no sideways scrolling', await pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') <= 0)
    # controls: all hidden but the vertical X stick -> the keys get almost the whole width; the stick springs back
    await pg.evaluate("const k = window.__moss.kbs; for (const c in k.ctl) k.ctl[c] = c === 'xbar'; window.__moss.kbApply()"); await pg.wait_for_timeout(100)
    vis = await pg.evaluate("['#ctrls', '#joy', '#xbar', '#ybar'].map(s => !!document.querySelector(s).offsetParent)")
    ok('controls: only the X stick is shown', vis == [False, False, True, False], vis)
    w2 = await pg.evaluate("document.querySelector('#kb').getBoundingClientRect().width")
    ok('controls hidden: the keys get the width', w2 > w + 60, [w, w2])
    r = await pg.evaluate("(r => [r.x + r.width / 2, r.y + 4, r.y + r.height / 2])(document.querySelector('#xbar').getBoundingClientRect())")
    await pg.mouse.move(r[0], r[2]); await pg.mouse.down(); await pg.mouse.move(r[0], r[1])
    up = await pg.evaluate("parseFloat(document.querySelector('#xbar .knob').style.top)")
    await pg.mouse.up()
    back = await pg.evaluate("parseFloat(document.querySelector('#xbar .knob').style.top)")
    ok('X stick: moves up and springs back', up < 15 and back == 50, [up, back])
    await pg.evaluate("const k = window.__moss.kbs; for (const c in k.ctl) k.ctl[c] = !['xbar', 'ybar'].includes(c); window.__moss.kbApply()")
    await pg.evaluate("window.__moss.setPlayMode(false)")
    # MIDI mode: no keys; big name, Prev / Next, MIDI monitor, quick edit, favourites
    await pg.set_viewport_size({'width': 390, 'height': 844})
    await pg.evaluate("window.__moss.loadProgram('st', 0); window.__moss.setMidiMode(true)"); await pg.wait_for_timeout(100)
    ok('MIDI mode: the keys are hidden, the MIDI view shows', not await pg.is_visible('#kb') and await pg.is_visible('#mmname'))
    ok('MIDI mode: the program name is shown', await pg.text_content('#mmname') == await pg.evaluate("window.__moss.getPatch().name"))
    await pg.click('#mmnext')
    ok('MIDI mode: Next steps the program', (await pg.text_content('#mmnum')).startswith('ST 01'), await pg.text_content('#mmnum'))
    await pg.evaluate("window.__moss.onMidi({data: [0x90, 62, 90]}); window.__moss.onMidi({data: [0x80, 62, 0]})")
    ok('MIDI mode: the monitor shows the note', 'D4' in await pg.text_content('#mmnote') and '90' in await pg.text_content('#mmnote'), await pg.text_content('#mmnote'))
    await pg.wait_for_timeout(150)
    lat = await pg.text_content('#mmlat')
    ok('MIDI mode: the monitor shows the latency', lat.startswith('≈ ') and lat.endswith(' ms') and int(lat[2:-3]) > 0, ascii(lat))
    # Cutoff moves both filters by the same amount
    f0 = await pg.evaluate("(p => [p.f[0].freqA, p.f[1].freqA, p.filt.link])(window.__moss.getPatch())")
    await pg.evaluate("(() => { const r = [...document.querySelectorAll('#mmgrid .ctl')].find(c => c.textContent.startsWith('Cutoff')).querySelector('input'); r.value = Number(r.value) - 10; r.dispatchEvent(new Event('input')); })()")
    f1 = await pg.evaluate("(p => [p.f[0].freqA, p.f[1].freqA])(window.__moss.getPatch())")
    ok('MIDI mode: Cutoff lowers both filters', f1[0] == max(0, f0[0] - 10) and (f0[2] or f1[1] == max(0, f0[1] - 10)), [f0, f1])
    ok('MIDI mode: an edit marks the name', (await pg.text_content('#mmname')).endswith('*'))
    await pg.click('#mmrevert')
    ok('MIDI mode: Revert restores the program', await pg.evaluate("window.__moss.getPatch().f[0].freqA") == f0[0])
    # Browse lists the current bank only
    n_st = len(await pg.evaluate("__t.inGroup(/^Starter programs$/)"))
    await pg.click('#mmbrowse')
    ok('MIDI mode: Browse lists the current bank only', await pg.text_content('#mmbrowsebox .pbr-bank .bn') == 'Starter programs'
       and await pg.evaluate("document.querySelectorAll('#mmbrowsebox .pbr-list button').length") == n_st, n_st)
    # favourites: star two programs, then Prev / Next step only between them
    await pg.click('#mmfav'); await pg.click('#mmnext'); await pg.click('#mmnext'); await pg.click('#mmfav')
    ok('MIDI mode: the star shows a favourite', await pg.get_attribute('#mmfav', 'aria-pressed') == 'true')
    await pg.click('#mmbrowsebox .pbr-bar .hw')
    ok('MIDI mode: the favourites list has the two programs', await pg.evaluate("document.querySelectorAll('#mmbrowsebox .pbr-list button').length") == 2)
    await pg.click('#mmnext'); a = await pg.text_content('#mmnum'); await pg.click('#mmnext'); b2 = await pg.text_content('#mmnum')
    ok('MIDI mode: Next steps through favourites only', a.startswith('ST 01') and b2.startswith('ST 03'), [a, b2])
    await pg.evaluate("window.__moss.setMidiMode(false)"); await pg.wait_for_timeout(100)
    ok('MIDI mode off: keys back, favourites filter off', await pg.is_visible('#kb') and await pg.evaluate("window.__moss.progList().length") > 1000)
    # play mode program list: big < > buttons; the name opens the list of the current bank; the bank button lists the banks; a pick closes it
    L = '#pblbody'
    items = "[...document.querySelectorAll('#pblbody .pbr-list button')].map(b => b.firstChild.textContent)"
    await pg.evaluate("window.__moss.loadProgram('st', 2); window.__moss.setPlayMode(true)"); await pg.wait_for_timeout(150)
    r = await pg.evaluate("[...['#pbprev', '#pbnext', '#pbnamebtn']].map(s => (r => [r.width, r.height])(document.querySelector(s).getBoundingClientRect()))")
    ok('play bar: big Prev / Next buttons and name bar', all(w >= 56 and h >= 40 for w, h in r), r)
    ok('play mode: the program list starts closed', not await pg.is_visible('#pbl'))
    await pg.click('#pbnamebtn')
    ok('play mode: tapping the name opens the program list', await pg.is_visible('#pbl'))
    got = await pg.evaluate(items)
    ok('program list: only the current bank', await pg.text_content(L + ' .pbr-bank .bn') == 'Starter programs' and len(got) == n_st, [len(got), n_st])
    ok('program list: the current program is marked', (await pg.evaluate("document.querySelector('#pblbody [aria-selected=true]').textContent")).startswith('02'))
    await pg.click(L + ' .pbr-bank')
    banks = await pg.evaluate(items)
    ok('program list: the bank button lists every bank, after Recently played', banks[0] == 'Recently played' and banks[1] == 'Starter programs' and any(b.startswith('Bank A (PCM)') for b in banks)
       and any(b.startswith('Combinations') for b in banks) and len(banks) == len(set(banks)), banks[:4])
    ok('program list: the current bank is marked', await pg.evaluate("document.querySelector('#pblbody [aria-selected=true]').firstChild.textContent") == 'Starter programs')
    target = next(b for b in banks if b.startswith('Bank A (PCM)'))
    await pg.evaluate("t => [...document.querySelectorAll('#pblbody .pbr-list button')].find(b => b.firstChild.textContent === t).click()", target)
    got = await pg.evaluate(items)
    ok('program list: a bank shows its own programs', await pg.text_content(L + ' .pbr-bank .bn') == target and len(got) > 0 and all(x.startswith('A') for x in got), got[:3])
    await pg.evaluate("document.querySelectorAll('#pblbody .pbr-list button')[1].click()"); await pg.wait_for_timeout(100)
    ok('program list: picking a program loads it and closes the list', not await pg.is_visible('#pbl') and (await pg.text_content('#pbname')).startswith(got[1][:4]), await pg.text_content('#pbname'))
    await pg.click('#pbnamebtn')
    ok('program list: reopens on the playing program\'s bank', await pg.text_content(L + ' .pbr-bank .bn') == target)
    await pg.fill(L + ' input', 'organ'); await pg.wait_for_timeout(400)
    got = await pg.evaluate(items)
    ok('program list: a search lists matches from every bank', not await pg.is_visible(L + ' .pbr-bank') and len(got) > 0
       and await pg.evaluate("document.querySelectorAll('#pblbody .pbr-list .g').length") > 1, len(got))
    await pg.fill(L + ' input', ''); await pg.wait_for_timeout(400)
    ok('program list: clearing the search goes back to one bank', await pg.is_visible(L + ' .pbr-bank'))
    await pg.keyboard.press('Escape')
    ok('program list: Escape closes it and stays in play mode', not await pg.is_visible('#pbl') and await pg.evaluate("document.body.classList.contains('play')"))
    await pg.click('#pbnamebtn'); await pg.click('#pblclose')
    ok('program list: Close closes it', not await pg.is_visible('#pbl'))
    await pg.evaluate("window.__moss.setPlayMode(false)")
    await pg.set_viewport_size({'width': 1200, 'height': 900})

async def midi_latency(pg):
    # a MIDI keyboard's note-on through the page's MIDI handler: the main thread's share, and the audio until the sound
    # leaves the synth (at most the next block or two); the browser's buffer and the output device come on top (reported)
    await pg.evaluate('__t.probe()')
    sr, base, out = await pg.evaluate("(c => [c.sampleRate, c.baseLatency || 0, c.outputLatency || 0])(window.__mossCtx())")
    q = 128 / sr * 1000
    for bank, idx in [('st', 0), ('pc', 0)]:
        await pg.evaluate("([b, i]) => window.__moss.loadProgram(b, i)", [bank, idx]); await pg.wait_for_timeout(1500)
        r = [await pg.evaluate("(n) => __t.hit(n)", 60 + k % 5) for k in range(8)]
        main, audio = sorted(x[0] for x in r), sorted(x[1] for x in r)
        print('     MIDI latency %s:%d: main thread %.2f ms (max %.2f), synth %.1f ms (max %.1f), browser buffer + device %.0f ms' % (bank, idx, main[4], main[-1], audio[4], audio[-1], (base + out) * 1000))
        ok('MIDI latency %s:%d: the main thread passes a note on in under 2 ms' % (bank, idx), main[4] < 2, main)
        ok('MIDI latency %s:%d: the note sounds within the next audio blocks' % (bank, idx), audio[0] >= 0 and audio[-1] <= max(10, base * 1000) + 3 * q + 2, audio)

async def sound_and_pages(b, url):
    pg = await open_page(b, url)
    ok('audio starts (AudioWorklet)', await pg.evaluate('window.__mossMode') == 'worklet')
    for bank, idx, what in [('st', 0, 'starter'), ('st', 16, 'E.Piano model'), ('st', 17, 'Organ model'), ('st', 18, 'Brass model'), ('pm', 128, 'Bank M program')]:
        pk = await pg.evaluate("([b, i]) => __t.play(b, i, [60, 64])", [bank, idx])
        ok('MOSS %s %s:%d plays' % (what, bank, idx), pk > 0.005, round(pk, 3))
    pc = await pg.evaluate("__t.find(/^pc:\\d+ A\\d+ (?!Initl)/)")
    pk = await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [48, 60, 64], 1500)", pc)
    ok('PCM program %s plays (stand-in samples)' % pc, pk > 0.005, round(pk, 3))
    if os.path.exists(os.path.join(ROOT, 'samples', 'korg', 'packs.json')):  # only where samples/korg/ was built (tools/samples/build_korg.py)
        info = await pg.evaluate("__moss.pcmInfo()")
        ok('Korg multisamples replace their stand-ins', info['korg'] > 50 and info['map']['ms']['215']['p'] == 'k_bouzo069', info['korg'])
        kp = await pg.evaluate("__t.find(/^pc:\\d+ \\w\\d+ .*piano/i)")
        pk = await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [48, 60, 64], 1500)", kp)
        st = await pg.evaluate("__moss.pcmInfo().state")
        ok('a piano program %s plays Korg\'s A.Piano' % kp, pk > 0.005 and st.get('k_a_pia000') == 'ok', (round(pk, 3), {k: v for k, v in st.items() if k.startswith('k_')}))
    ok('drum programs are not in the program list', await pg.evaluate("__t.find(/Test Drum Kit/)") is None)  # TestSet3's drum programs
    pk = await pg.evaluate("__t.play('cb', 0, [48, 60, 64], 1500)")
    ok('combination cb:0 plays', pk > 0.005, round(pk, 3))
    for v in ['st:17', pc, 'cb:0']:
        await pg.evaluate('(v) => __t.load(v)', v)
        n, empty = await pg.evaluate('__t.pages()')
        ok('%s: all %d pages render' % (v, n), n > 0 and not empty, empty)
    await pg.evaluate("window.__moss.loadProgram('cb', 0); window.__moss.selectPage('timbre')")
    txt = await pg.evaluate("document.querySelector('#page').textContent")
    ok('combination Timbre page shows Delay start and the MIDI filters', 'Delay start' in txt and 'MIDI filters' in txt and 'Receives the damper' in txt)
    await pg.evaluate("window.__moss.loadProgram('st', 14); window.__moss.selectPage('fx')")
    n0 = await pg.evaluate('window.__moss.getPatch().fx.ins.length')
    await pg.evaluate("document.querySelector('#page .fxchip.add').click()")
    ok('effects page: adding an insert effect works', await pg.evaluate('window.__moss.getPatch().fx.ins.length') == n0 + 1)
    await pg.set_viewport_size({'width': 390, 'height': 844})
    for v, page in [('st:17', 'osc0'), (pc, 'program'), ('cb:0', 'combi')]:
        await pg.evaluate("([v, p]) => { __t.load(v); window.__moss.selectPage(p); }", [v, page]); await pg.wait_for_timeout(150)
        ov = await pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        ok('phone width, %s %s page: no sideways scrolling' % (v, page), ov <= 0, ov)
    await record_wav(pg, 'worklet')
    await midi_latency(pg)
    await keyboard_and_midi(pg)
    ok('no errors (AudioWorklet mode)', not pg.errs, pg.errs[:5])
    await pg.close()
    pg = await open_page(b, url, script_mode=True)
    ok('compatibility audio mode starts', await pg.evaluate('window.__mossMode') == 'script')
    ok('compatibility mode: MOSS plays', await pg.evaluate("__t.play('st', 0, [60])") > 0.005)
    ok('compatibility mode: PCM plays', await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [60], 1500)", pc) > 0.005)
    await record_wav(pg, 'script')
    ok('no errors (compatibility mode)', not pg.errs, pg.errs[:5])
    await pg.close()

async def storage_and_memory(b, url):
    full, combis, pcm = pcg('TestSet1', 'Full.pcg'), pcg('TestSet2', 'Combis.pcg', 'combi'), pcg('TestSet3', 'Pcm.pcg', 'pcm')
    ctx = await b.new_context(); pg = await ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.add_init_script(JS); await pg.goto(url); await pg.wait_for_timeout(500)
    # a combination-only file with nothing imported before it: the built-in files fill in (TestSet1 first)
    st = await pg.evaluate('([b, n]) => __t.import(b, n)', [combis, 'Combis.PCG'])
    ok('combination-only file is accepted', '128 combinations' in st, st)
    T = await pg.evaluate('__t.timbres()')
    ok('...its timbres come from the built-in TestSet1', T and all(t[2] == 'TestSet1' for t in T if t[1]), T[:3])
    st = await pg.evaluate('([b, n]) => __t.import(b, n)', [full, 'Full.PCG'])
    ok('full file imported', 'Imported from Full' in st and 'refused' not in st, st)
    await pg.evaluate('([b, n]) => __t.import(b, n)', [combis, 'Combis2.PCG'])
    T = await pg.evaluate('__t.timbres()')
    ok('memory: a later import takes programs from the newest earlier import', T and all(t[2] == 'Full' for t in T if t[1]), T[:3])
    await pg.evaluate("__t.load(__t.firstIn('Combinations A from Full'))")
    ok("memory: a file's own banks come first", all(t[2] == '' for t in await pg.evaluate('__t.timbres()')))
    await pg.evaluate('([b, n]) => __t.import(b, n)', [pcm, 'PcmOnly.PCG'])
    n = len(await pg.evaluate("__t.inGroup(/\(PCM\) from PcmOnly/)"))
    ok('drum programs of an imported file are left out', 0 < n < 256, n)  # TestSet3 has 4 drum programs in each of banks A-B
    n = await pg.evaluate("() => { let n = 0; for (const e of __t.inGroup(/^Combinations . from (TestSet1|TestSet3)$/)) { __t.load(e.v); n += __t.timbres().filter(t => t[2]).length; } return n; }")
    ok('built-in files only use their own banks', n == 0, n)
    # storage: everything is still there after a reload
    await pg.reload(); await pg.wait_for_timeout(1200)
    ok('imports kept after reload (IndexedDB)', await pg.evaluate("__t.group('from Full')") == 9 and await pg.evaluate("__t.group('from Combis2')") == 1)
    ok('...memory order kept', all(t[2] == 'Full' for t in await pg.evaluate("() => { __t.load(__t.firstIn('from Combis2')); return __t.timbres(); }") if t[1]))
    # a timbre's program edited and saved in place: the combination plays the edit, also after a reload; Restore original undoes it
    cv = await pg.evaluate("__t.firstIn('Combinations A from TestSet1')")
    click = "(re) => { window.__moss.selectPage('program'); const b = [...document.querySelectorAll('button')].find(b => new RegExp(re).test(b.textContent)); if (b) b.click(); return !!b; }"
    pid = await pg.evaluate("(v) => { __t.load(v); const t = window.__moss.getPatch().timbres.find(t => t.pId); return t && t.pId; }", cv)
    # the same combination saved to the User bank twice: as now, and as older versions stored it (no t.src)
    await pg.evaluate(click, '^Save to User bank')
    await pg.evaluate("(v) => { __t.load(v); window.__moss.getPatch().timbres.forEach(t => delete t.src); }", cv)
    await pg.evaluate(click, '^Save to User bank')
    uc = await pg.evaluate("() => { const e = window.__moss.progEntries().filter(e => e.b === 'us'); return e.slice(-2).map(e => e.i); }")
    orig = await pg.evaluate("(p) => { __t.load(p); const P = window.__moss.getPatch(); const n = P.name; P.name = 'Edited In Place'; return n; }", pid)
    saved = await pg.evaluate(click, '^Save in place')
    names = lambda: pg.evaluate("(v) => { __t.load(v); return __t.timbres().map(t => t[1]); }", cv)
    ok('save in place: the combination uses the edited program', saved and 'Edited In Place' in await names(), [saved, pid])
    unames = await pg.evaluate("(l) => l.map(i => { window.__moss.loadProgram('us', i); return window.__moss.getPatch().timbres.map(t => t.pName); })", uc)
    ok('...and so does the combination saved to the User bank (also one stored by an older version)', len(unames) == 2 and all('Edited In Place' in n for n in unames), [uc, [n[:2] for n in unames]])
    await pg.reload(); await pg.wait_for_timeout(1200)
    ok('...kept after reload, and the bank list shows it', 'Edited In Place' in await names() and bool(await pg.evaluate("__t.find(/Edited In Place/)")))
    await pg.evaluate("(p) => __t.load(p)", pid)
    restored = await pg.evaluate(click, '^Restore original')
    ok('...Restore original brings back the program from the file', restored and orig in await names() and 'Edited In Place' not in await names(), orig)
    # removal through the Program page button
    await pg.evaluate("__t.load(__t.firstIn('(PCM) from PcmOnly')); window.__moss.selectPage('program')")
    clicked = await pg.evaluate("() => { const b = [...document.querySelectorAll('button')].find(b => /Remove these PCM banks/.test(b.textContent)); if (b) b.click(); return !!b; }")
    await pg.wait_for_timeout(300)  # the stored copy is deleted asynchronously
    left = await pg.evaluate("__t.group('from PcmOnly')")
    await pg.reload(); await pg.wait_for_timeout(1200)
    after = await pg.evaluate("__t.group('from PcmOnly')")
    ok('removed banks stay removed', clicked and left == 0 and after == 0, [clicked, left, after])
    # banks an older version kept in localStorage are moved to IndexedDB
    await pg.evaluate("(m) => localStorage.setItem('moss-tri', JSON.stringify([{ name: 'Old', m }]))", pcm)
    await pg.reload(); await pg.wait_for_timeout(1200)
    ok('old localStorage banks are moved over', await pg.evaluate("__t.group('from Old')") == 2 and await pg.evaluate("localStorage.getItem('moss-tri') === null"))
    # errors are reported
    st = await pg.evaluate('([b, n]) => __t.import(b, n)', [base64.b64encode(base64.b64decode(full)[:5000]).decode(), 'Broken.PCG'])
    ok('damaged file: the status line says so', 'damaged' in st, st)
    await pg.evaluate("localStorage.setItem('moss-current', JSON.stringify({ patch: { kind: 'combi', timbres: 5 }, prog: { bank: 'cb', idx: 0 }, edited: true }))")
    await pg.reload(); await pg.wait_for_timeout(1000)
    st = await pg.evaluate("document.querySelector('#status').textContent")
    ok('broken stored program: page starts and says so', 'could not be restored' in st, st)
    ok('no page errors (storage and memory)', not pg.errs, pg.errs[:5])
    await ctx.close()

async def public_page(b):
    # the Netlify page: built with --public (no built-in banks); importing a PCG still works
    # laid out as netlify.toml publishes it: the page, the samples and the app files (manifest, service worker, icons)
    d = tempfile.mkdtemp()
    for f in ['samples', 'icons', 'manifest.webmanifest', 'sw.js']: os.symlink(os.path.join(ROOT, f), os.path.join(d, f))
    subprocess.run([sys.executable, os.path.join(ROOT, 'build.py'), os.path.join(d, 'index.html'), '--public'], cwd=ROOT, check=True, capture_output=True)
    url = serve(d)
    ctx = await b.new_context(); pg = await ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.add_init_script(JS); await pg.goto(url); await pg.wait_for_timeout(500)
    await pg.click('#power'); await pg.wait_for_timeout(800)
    groups = await pg.evaluate("__t.groups()")
    ok('public page: no built-in banks are listed', not any(n in ' '.join(groups) for n in ['TestSet', 'from ', 'Korg factory']), groups)
    ok('public page: starter program plays', await pg.evaluate("__t.play('st', 0, [60])") > 0.005)
    ok("public page: no starters from a sample disk", await pg.evaluate("__t.find(/Test Zurna/)") is None)
    st = await pg.evaluate('([b, n]) => __t.import(b, n)', [pcg('TestSet1', 'Pub.pcg'), 'Mine.PCG'])
    ok('public page: importing a PCG works', 'Imported from Mine' in st, st)
    v = await pg.evaluate("__t.firstIn('(PCM) from Mine')")
    pk = await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [48, 60, 64], 1500)", v) if v else 0
    ok('public page: an imported PCM program plays', pk > 0.005, round(pk, 3))
    v = await pg.evaluate("__t.firstIn('Combinations A from Mine')")
    pk = await pg.evaluate("(v) => __t.play('cb', +v.split(':')[1], [48, 60, 64], 1500)", v) if v else 0
    ok('public page: an imported combination plays', pk > 0.005, round(pk, 3))
    # installable app: the manifest loads and the service worker takes over (so the page opens offline)
    man = await pg.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
    ok('public page: app manifest with icons', man.get('name') == 'Trinity Web Synth' and len(man.get('icons', [])) >= 2, man.get('name'))
    sw = await pg.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")
    ok('public page: service worker active', sw)
    await pg.reload(); await pg.wait_for_timeout(500)
    await ctx.set_offline(True)
    await pg.reload(); await pg.wait_for_timeout(500)
    ok('public page opens offline (from the service worker)', await pg.evaluate("!!document.querySelector('#kb .wk')"))
    await ctx.set_offline(False)
    ok('no page errors (public page)', not pg.errs, pg.errs[:5])
    await ctx.close()

async def last_program(b, url):
    pg = await open_page(b, url)
    cur = "() => { const P = window.__moss.getPatch(); return [document.querySelector('#pnum').textContent, P.name, document.querySelector('#pname').textContent.endsWith(' *')]; }"
    cb = await pg.evaluate("__t.firstIn('Combinations A from TestSet1')")
    pid = await pg.evaluate("(v) => { __t.load(v); return window.__moss.getPatch().timbres.find(t => t.pId).pId; }", cb)
    combi = await pg.evaluate(cur)
    await pg.evaluate("(p) => __t.load(p)", pid)
    prog1 = await pg.evaluate(cur)
    await pg.click('#lastbtn')
    ok('Last goes back to the combination', await pg.evaluate(cur) == combi, combi)
    await pg.click('#lastbtn')
    ok('...and pressing it again returns to the timbre program', await pg.evaluate(cur) == prog1, prog1)
    # an unsaved edit is kept while you are away and comes back through Last
    await pg.evaluate("() => { window.__moss.selectPage('program'); }")
    name = pg.locator('#page input[type=text]').first
    await name.fill('Kept Edit'); await pg.wait_for_timeout(100)
    await pg.click('#lastbtn')
    back = await pg.evaluate(cur)
    await pg.click('#lastbtn')
    ok('unsaved edits come back with Last', back == combi and await pg.evaluate(cur) == [prog1[0], 'Kept Edit', True], await pg.evaluate(cur))
    # the recent list in the editor's browser
    await pg.evaluate("__t.load(__t.firstIn('Starter programs'))")
    await pg.click('#progbtn'); await pg.click('#edbrowse .pbr-bank')
    await pg.click("#edbrowse .pbr-list button:has-text('Recently played')")
    rows = await pg.evaluate("[...document.querySelectorAll('#edbrowse .pbr-list button')].map(b => b.textContent)")
    ok('the browser lists the recently played programs, newest first, marking kept edits', len(rows) == 3 and rows[0].startswith('00 ') and rows[1].startswith(prog1[0]) and rows[1].endswith('edited') and rows[2].startswith(combi[0]), rows)
    await pg.reload(); await pg.wait_for_timeout(800)
    ok('the register is kept over a reload', len(await pg.evaluate("window.__moss.recent()")) >= 3 and not await pg.is_disabled('#lastbtn'))
    ok('no page errors (Last)', not pg.errs, pg.errs[:5])
    await pg.close()

async def new_programs(b, url):
    pg = await open_page(b, url)
    info = "() => { const P = window.__moss.getPatch(), p = document.querySelector('#pnum').textContent; return [p, P.kind || 'moss', P.name]; }"
    async def new(kind):
        await pg.evaluate("() => window.__moss.selectPage(window.__moss.getPatch().kind === 'combi' ? 'combi' : 'program')")
        await pg.click("#page button:has-text('New program')")
        await pg.click("#page .newprog button:has-text('%s')" % kind)
        return await pg.evaluate(info)
    got = await new('MOSS program')
    pk = await pg.evaluate("(p) => __t.play('us', +p.slice(3) - 1, [60, 64])", got[0])
    ok('New program: a MOSS program in the User bank plays', got[1] == 'moss' and got[2] == 'Init MOSS' and got[0].startswith('US') and pk > 0.005, [got, round(pk, 3)])
    got = await new('PCM program')
    pk = await pg.evaluate("(p) => __t.play('us', +p.slice(3) - 1, [60, 64], 1200)", got[0])
    n, empty = await pg.evaluate('__t.pages()')
    ok('...a PCM program plays and every page shows', got[1] == 'pcm' and got[2] == 'Init PCM' and pk > 0.005 and not empty, [got, round(pk, 3), empty])
    await pg.evaluate("__t.load(__t.find(/^pc:\\d+ A\\d+ (?!Initl)/))")
    src = await pg.evaluate("window.__moss.getPatch().name")
    got = await new('Combination')
    T = await pg.evaluate('__t.timbres()')
    pk = await pg.evaluate("(p) => __t.play('us', +p.slice(3) - 1, [60, 64], 1200)", got[0])
    ok('...a combination starts with the program you were on in timbre 1, and plays', got[1] == 'combi' and len(T) == 1 and T[0][1] == src and pk > 0.005, [got, T, round(pk, 3)])
    # timbre 2 picks a starter program; saved and reloaded, the combination keeps it
    await pg.evaluate("() => { window.__moss.selectPage('timbre'); [...document.querySelectorAll('#page .btnrow button')].find(b => b.textContent === 'T2').click(); }")
    await pg.select_option('#page label.ctl select >> nth=0', 'st:1')
    await pg.evaluate("() => { window.__moss.selectPage('combi'); [...document.querySelectorAll('#page button')].find(b => /^Save to User \\d/.test(b.textContent)).click(); }")
    await pg.reload(); await pg.wait_for_timeout(800)
    T = await pg.evaluate("(p) => { window.__moss.loadProgram('us', +p.slice(3) - 1); return __t.timbres(); }", got[0])
    ok('...timbre 2 takes any program (here a starter), kept after saving and a reload', len(T) == 2 and T[1][0] == 'ST01' and T[1][2] == 'starter programs', T)
    ok('no page errors (New program)', not pg.errs, pg.errs[:5])
    await pg.close()

async def user_starters(b, url):
    # starter programs from a Triton sample disk (userdata.js; here the test banks' made-up disk, whose samples are not here: stand-ins)
    pg = await open_page(b, url)
    n = await pg.evaluate("MOSS_PRESETS.length")
    v = await pg.evaluate("__t.find(/^st:\d+ \d+ Test Zurna$/)")
    ok('starters from a sample disk are listed after the MOSS starters', v is not None and int(v[3:]) >= n, [n, v])
    pk = await pg.evaluate("(v) => __t.play('st', +v.split(':')[1], [60, 64], 1500)", v)
    P = await pg.evaluate("() => { const P = window.__moss.getPatch(); return [P.kind, P.korgInfo.fmt, P.scale.type, JSON.stringify(P.ramMap)]; }")
    ok('...a Triton starter decodes (PCM, Triton, its maqam user scale) and plays', pk > 0.005 and P[:3] == ['pcm', 'triton', 'user'] and 'u_testzurna112' in P[3], [round(pk, 3), P])
    info = await pg.evaluate("() => { const i = window.__moss.pcmInfo(); return [!!(i.map.ms.u_testzurna112 || {}).u, document.querySelector('#status').textContent]; }")
    ok('...it plays a stand-in (the disk\'s samples are not here)', not info[0] and 'stand-ins' in info[1], info)
    await pg.evaluate("() => window.__moss.selectPage('osc0')")
    help_ = await pg.evaluate("document.querySelector('#page').textContent")
    ok('...the OSC page names the sample', 'TEST ZURNA 112' in help_, help_[:0])
    n2, empty = await pg.evaluate('__t.pages()')
    ok('...every page of it shows', not empty, empty)
    ok('no page errors (starters from a sample disk)', not pg.errs, pg.errs[:5])
    await pg.close()

async def main():
    # the page with the made-up test banks (never your own files, so the results are the same everywhere)
    subprocess.run(['node', os.path.join(ROOT, 'test', 'fixtures.js')], cwd=ROOT, check=True, capture_output=True)
    subprocess.run([sys.executable, 'build.py', '_test.html', '--data', os.path.join('test', 'fixtures')], cwd=ROOT, check=True, capture_output=True)
    url = serve(page='_test.html')
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        await sound_and_pages(b, url)
        await storage_and_memory(b, url)
        await last_program(b, url)
        await new_programs(b, url)
        await user_starters(b, url)
        await public_page(b)
        await b.close()
    print('ALL PASSED' if not fails else '%d FAILED: %s' % (len(fails), '; '.join(fails)))
    sys.exit(1 if fails else 0)
asyncio.run(main())
