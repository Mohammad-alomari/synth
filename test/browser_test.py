# Browser test of the built page (Chromium via Playwright). Starts its own http server; exit code 0 = all passed.
# Usage: python3 test/browser_test.py            (run python3 build.py first; needs node for test/mkpcg.js)
# Covers: sound of MOSS / PCM / drum / combination programs in both audio modes, every page renders, effects editing,
# phone width, imported-PCG storage (IndexedDB, reload, migration, removal), synth memory, error messages.
import asyncio, base64, functools, http.server, os, subprocess, sys, tempfile, threading
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp()
fails = []
def ok(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra != '' else ''), flush=True)
    if not cond: fails.append(name)
def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
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
  find(re) { const o = [...document.querySelectorAll('#prog option')].find(o => re.test(o.value + ' ' + o.textContent)); return o ? o.value : null; },
  group(t) { return [...document.querySelectorAll('#prog optgroup')].filter(g => g.label.includes(t)).length; },
  firstIn(t) { const g = [...document.querySelectorAll('#prog optgroup')].find(g => g.label.includes(t)); return g ? g.querySelector('option').value : null; },
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

async def sound_and_pages(b, url):
    pg = await open_page(b, url)
    ok('audio starts (AudioWorklet)', await pg.evaluate('window.__mossMode') == 'worklet')
    for bank, idx, what in [('st', 0, 'starter'), ('st', 16, 'E.Piano model'), ('st', 17, 'Organ model'), ('st', 18, 'Brass model'), ('pm', 128, 'Bank M program')]:
        pk = await pg.evaluate("([b, i]) => __t.play(b, i, [60, 64])", [bank, idx])
        ok('MOSS %s %s:%d plays' % (what, bank, idx), pk > 0.005, round(pk, 3))
    pc = await pg.evaluate("__t.find(/^pc:\\d+ A\\d+ (?!Initl)/)")
    pk = await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [48, 60, 64], 1500)", pc)
    ok('PCM program %s plays (stand-in samples)' % pc, pk > 0.005, round(pk, 3))
    dr = await pg.evaluate("__t.find(/Mega-Mix/)")  # a TRINI-1-KJ drum program (other files' kits hold odd data)
    pk = await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [36, 38, 42], 1500)", dr) if dr else 0
    ok('drum program %s plays' % dr, pk > 0.005, round(pk, 3))
    pk = await pg.evaluate("__t.play('cb', 0, [48, 60, 64], 1500)")
    ok('combination cb:0 plays', pk > 0.005, round(pk, 3))
    for v in ['st:17', pc, dr, 'cb:0']:
        await pg.evaluate('(v) => __t.load(v)', v)
        n, empty = await pg.evaluate('__t.pages()')
        ok('%s: all %d pages render' % (v, n), n > 0 and not empty, empty)
    await pg.evaluate("window.__moss.loadProgram('st', 14); window.__moss.selectPage('fx')")
    n0 = await pg.evaluate('window.__moss.getPatch().fx.ins.length')
    await pg.evaluate("document.querySelector('#page .fxchip.add').click()")
    ok('effects page: adding an insert effect works', await pg.evaluate('window.__moss.getPatch().fx.ins.length') == n0 + 1)
    await pg.set_viewport_size({'width': 390, 'height': 844})
    for v, page in [('st:17', 'osc0'), (pc, 'program'), ('cb:0', 'combi')]:
        await pg.evaluate("([v, p]) => { __t.load(v); window.__moss.selectPage(p); }", [v, page]); await pg.wait_for_timeout(150)
        ov = await pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        ok('phone width, %s %s page: no sideways scrolling' % (v, page), ov <= 0, ov)
    ok('no errors (AudioWorklet mode)', not pg.errs, pg.errs[:5])
    await pg.close()
    pg = await open_page(b, url, script_mode=True)
    ok('compatibility audio mode starts', await pg.evaluate('window.__mossMode') == 'script')
    ok('compatibility mode: MOSS plays', await pg.evaluate("__t.play('st', 0, [60])") > 0.005)
    ok('compatibility mode: PCM plays', await pg.evaluate("(v) => __t.play('pc', +v.split(':')[1], [60], 1500)", pc) > 0.005)
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
    dr = await pg.evaluate("() => { for (const g of document.querySelectorAll('#prog optgroup')) if (g.label.includes('(PCM) from PcmOnly')) for (const o of g.querySelectorAll('option')) { __t.load(o.value); const P = window.__moss.getPatch(); if (P.mode === 'drum') return [!!P.kitData, P.korgInfo.kitFrom || '']; } return null; }")
    ok('memory: drum programs of a file without kits use the kits in memory', dr == [True, 'Full'], dr)
    n = await pg.evaluate("() => { let n = 0; for (const g of document.querySelectorAll('#prog optgroup')) if (/^Combinations . from (Hadi2024|TRINI-1-KJ)$/.test(g.label)) for (const o of g.querySelectorAll('option')) { __t.load(o.value); n += __t.timbres().filter(t => t[2]).length; } return n; }")
    ok('built-in files only use their own banks', n == 0, n)
    # storage: everything is still there after a reload
    await pg.reload(); await pg.wait_for_timeout(1200)
    ok('imports kept after reload (IndexedDB)', await pg.evaluate("__t.group('from Full')") == 9 and await pg.evaluate("__t.group('from Combis2')") == 1)
    ok('...memory order kept', all(t[2] == 'Full' for t in await pg.evaluate("() => { __t.load(__t.firstIn('from Combis2')); return __t.timbres(); }") if t[1]))
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

async def main():
    if not os.path.exists(os.path.join(ROOT, 'index.html')): sys.exit('index.html missing: run python3 build.py')
    url = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        await sound_and_pages(b, url)
        await storage_and_memory(b, url)
        await b.close()
    print('ALL PASSED' if not fails else '%d FAILED: %s' % (len(fails), '; '.join(fails)))
    sys.exit(1 if fails else 0)
asyncio.run(main())
