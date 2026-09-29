# Browser test of the built page (Chromium via Playwright). Starts its own http server; exit code 0 = all passed.
# Usage: python3 test/browser_test.py            (run python3 build.py first; needs node for test/mkpcg.js)
# Covers: sound of MOSS / PCM / combination programs in both audio modes, drum programs left out, every page renders, effects editing,
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
def serve(root=ROOT):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=root)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d/index.html' % srv.server_address[1]
def pcg(name, out, which=None):  # a PCG file made from built-in data, as base64
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
    ok('program list: the bank button lists every bank', banks[0] == 'Starter programs' and any(b.startswith('Bank A (PCM)') for b in banks)
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

async def sound_and_pages(b, url):
    pg = await open_page(b, url)
    ok('audio starts (AudioWorklet)', await pg.evaluate('window.__mossMode') == 'worklet')
    for bank, idx, what in [('st', 0, 'starter'), ('st', 16, 'E.Piano model'), ('st', 17, 'Organ model'), ('st', 18, 'Brass model'), ('pm', 128, 'Bank M program')]:
        pk = await pg.evaluate("([b, i]) => __t.play(b, i, [60, 64])", [bank, idx])
        ok('MOSS %s %s:%d plays' % (what, bank, idx), pk > 0.005, round(pk, 3))
    pc = await pg.evaluate("__t.find(/^pc:\\d+ A\\d+ (?!Initl)/)")
    pk = await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [48, 60, 64], 1500)", pc)
    ok('PCM program %s plays (stand-in samples)' % pc, pk > 0.005, round(pk, 3))
    if os.path.exists(os.path.join(ROOT, 'samples', 'korg', 'packs.json')):  # only in the owner's copy (tools/samples/build_korg.py)
        info = await pg.evaluate("__moss.pcmInfo()")
        ok('Korg multisamples replace their stand-ins', info['korg'] > 50 and info['map']['ms']['215']['p'] == 'k_bouzo069', info['korg'])
        kp = await pg.evaluate("__t.find(/^pc:\\d+ \\w\\d+ .*piano/i)")
        pk = await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [48, 60, 64], 1500)", kp)
        st = await pg.evaluate("__moss.pcmInfo().state")
        ok('a piano program %s plays Korg\'s A.Piano' % kp, pk > 0.005 and st.get('k_a_pia000') == 'ok', (round(pk, 3), {k: v for k, v in st.items() if k.startswith('k_')}))
    ok('drum programs are not in the program list', await pg.evaluate("__t.find(/Mega-Mix/)") is None)  # a TRINI-1-KJ drum program
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
    full, combis, pcm = pcg('Hadi2024', 'Full.pcg'), pcg('TRIN-2KJ', 'Combis.pcg', 'combi'), pcg('TRINI-1-KJ', 'Pcm.pcg', 'pcm')
    ctx = await b.new_context(); pg = await ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    await pg.add_init_script(JS); await pg.goto(url); await pg.wait_for_timeout(500)
    # a combination-only file with nothing imported before it: the built-in files fill in (Hadi2024 first)
    st = await pg.evaluate('([b, n]) => __t.import(b, n)', [combis, 'Combis.PCG'])
    ok('combination-only file is accepted', '128 combinations' in st, st)
    T = await pg.evaluate('__t.timbres()')
    ok('...its timbres come from the built-in Hadi2024', T and all(t[2] == 'Hadi2024' for t in T if t[1]), T[:3])
    st = await pg.evaluate('([b, n]) => __t.import(b, n)', [full, 'Full.PCG'])
    ok('full file imported', 'Imported from Full' in st and 'refused' not in st, st)
    await pg.evaluate('([b, n]) => __t.import(b, n)', [combis, 'Combis2.PCG'])
    T = await pg.evaluate('__t.timbres()')
    ok('memory: a later import takes programs from the newest earlier import', T and all(t[2] == 'Full' for t in T if t[1]), T[:3])
    await pg.evaluate("__t.load(__t.firstIn('Combinations A from Full'))")
    ok("memory: a file's own banks come first", all(t[2] == '' for t in await pg.evaluate('__t.timbres()')))
    await pg.evaluate('([b, n]) => __t.import(b, n)', [pcm, 'PcmOnly.PCG'])
    n = len(await pg.evaluate("__t.inGroup(/\(PCM\) from PcmOnly/)"))
    ok('drum programs of an imported file are left out', 0 < n < 256, n)  # TRINI-1-KJ has 8 drum programs in banks A-B
    n = await pg.evaluate("() => { let n = 0; for (const e of __t.inGroup(/^Combinations . from (Hadi2024|TRINI-1-KJ)$/)) { __t.load(e.v); n += __t.timbres().filter(t => t[2]).length; } return n; }")
    ok('built-in files only use their own banks', n == 0, n)
    # storage: everything is still there after a reload
    await pg.reload(); await pg.wait_for_timeout(1200)
    ok('imports kept after reload (IndexedDB)', await pg.evaluate("__t.group('from Full')") == 9 and await pg.evaluate("__t.group('from Combis2')") == 1)
    ok('...memory order kept', all(t[2] == 'Full' for t in await pg.evaluate("() => { __t.load(__t.firstIn('from Combis2')); return __t.timbres(); }") if t[1]))
    # a timbre's program edited and saved in place: the combination plays the edit, also after a reload; Restore original undoes it
    cv = await pg.evaluate("__t.firstIn('Combinations A from Hadi2024')")
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
    # the Netlify page: built with --public (no owner files); importing a PCG still works
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
    ok('public page: none of the owner\'s files are listed', not any(n in ' '.join(groups) for n in ['Hadi2024', 'KJ4TRINI', 'TRIN', 'from ', 'Korg factory']), groups)
    ok('public page: starter program plays', await pg.evaluate("__t.play('st', 0, [60])") > 0.005)
    st = await pg.evaluate('([b, n]) => __t.import(b, n)', [pcg('Hadi2024', 'Pub.pcg'), 'Mine.PCG'])
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

async def main():
    if not os.path.exists(os.path.join(ROOT, 'index.html')): sys.exit('index.html missing: run python3 build.py')
    url = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        await sound_and_pages(b, url)
        await storage_and_memory(b, url)
        await public_page(b)
        await b.close()
    print('ALL PASSED' if not fails else '%d FAILED: %s' % (len(fails), '; '.join(fails)))
    sys.exit(1 if fails else 0)
asyncio.run(main())
