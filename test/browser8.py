# Imported PCG storage (IndexedDB): import survives a reload, old localStorage banks are moved over, removal forgets them.
# Needs http.server on 8765. Test files are made with test/mkpcg.js.
import asyncio, sys, os, base64, subprocess, tempfile
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/index.html'
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp()
def mk(name, out, which=None):
    subprocess.run(['node', os.path.join(HERE, 'mkpcg.js'), name, os.path.join(TMP, out)] + ([which] if which else []), check=True, capture_output=True)
    return base64.b64encode(open(os.path.join(TMP, out), 'rb').read()).decode()
fails = []
def ok(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('  ' + str(extra) if extra != '' else ''))
    if not cond: fails.append(name)
IMPORT = """async ([b64, name]) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  await window.__moss.importPcgFile(new File([u], name)); return document.querySelector('#status').textContent; }"""
GROUPS = "(t) => [...document.querySelectorAll('#prog optgroup')].filter(g => g.label.includes(t)).length"
async def main():
    full, moss = mk('Hadi2024', 'Test1.pcg'), mk('TRIN-2KJ', 'Test2.pcg', 'pcm,kit')
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context()).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(800)
        st = await pg.evaluate(IMPORT, [full, 'Test1.PCG'])
        ok('import reports what it got', 'Imported from Test1' in st and 'refused' not in st, st)
        n1 = await pg.evaluate(GROUPS, 'from Test1')
        ok('imported banks listed (M + 4 PCM + 4 combi)', n1 == 9, n1)
        await pg.reload(); await pg.wait_for_timeout(1200)
        ok('banks still there after reload', await pg.evaluate(GROUPS, 'from Test1') == 9)
        ok('nothing left in localStorage', await pg.evaluate("localStorage.getItem('moss-tri') === null && localStorage.getItem('moss-pcg') === null"))
        # old-format data in localStorage is moved to IndexedDB
        await pg.evaluate("(m) => localStorage.setItem('moss-tri', JSON.stringify([{ name: 'Old2', m }]))", moss)
        await pg.reload(); await pg.wait_for_timeout(1200)
        ok('localStorage bank from an older version appears', await pg.evaluate(GROUPS, 'from Old2') == 4)
        ok('...and was moved out of localStorage', await pg.evaluate("localStorage.getItem('moss-tri') === null"))
        await pg.reload(); await pg.wait_for_timeout(1200)
        ok('...and is still there after another reload', await pg.evaluate(GROUPS, 'from Old2') == 4)
        # remove the PCM banks of Old2 through the Program page button
        v = await pg.evaluate("[...document.querySelectorAll('#prog optgroup')].find(g => g.label.includes('from Old2')).querySelector('option').value")
        await pg.evaluate("(v) => { const [b, i] = v.split(':'); window.__moss.loadProgram(b, +i); window.__moss.selectPage('prog'); }", v)
        await pg.wait_for_timeout(200)
        clicked = await pg.evaluate("() => { const b = [...document.querySelectorAll('button')].find(b => /Remove these PCM banks/.test(b.textContent)); if (b) b.click(); return !!b; }")
        ok('remove button shown for imported PCM banks', clicked)
        await pg.wait_for_timeout(300)
        ok('removed banks gone', await pg.evaluate(GROUPS, 'from Old2') == 0)
        await pg.reload(); await pg.wait_for_timeout(1200)
        ok('removed banks stay gone after reload', await pg.evaluate(GROUPS, 'from Old2') == 0 and await pg.evaluate(GROUPS, 'from Test1') == 9)
        # errors are shown, not swallowed
        st = await pg.evaluate(IMPORT, [base64.b64encode(base64.b64decode(full)[:5000]).decode(), 'Broken.PCG'])
        ok('damaged file: status explains', 'damaged' in st or 'shorter' in st, st)
        await pg.evaluate("localStorage.setItem('moss-current', JSON.stringify({ patch: { kind: 'combi', timbres: 5 }, prog: { bank: 'cb', idx: 0 }, edited: true }))")
        await pg.reload(); await pg.wait_for_timeout(1200)
        st = await pg.evaluate("document.querySelector('#status').textContent")
        ok('unreadable last program: status says so', 'could not be restored' in st, st)
        ok('no page errors', not errs, errs)
        await b.close()
    sys.exit(1 if fails else 0)
asyncio.run(main())
