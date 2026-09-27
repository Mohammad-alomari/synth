# Synth memory: an imported file without some banks takes them from earlier imports, then the built-in files.
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
# the loaded combination's timbres: [label, program name, from]
TIMBRES = "() => { const P = window.__moss.getPatch(); return P.kind === 'combi' ? P.timbres.filter(t => t.status !== 'off').map(t => [t.pLabel, t.pName, t.from || '']) : null; }"
FIRST = "(t) => { const g = [...document.querySelectorAll('#prog optgroup')].find(g => g.label.includes(t)); return g ? g.querySelector('option').value : null; }"
LOAD = "(v) => { const [b, i] = v.split(':'); window.__moss.loadProgram(b, +i); }"
async def main():
    combis, full, mossOnly, pcmOnly = mk('TRIN-2KJ', 'Combis.pcg', 'combi'), mk('Hadi2024', 'Full.pcg'), mk('KJ4TRINI', 'MossOnly.pcg', 'moss'), mk('TRINI-1-KJ', 'PcmOnly.pcg', 'pcm')
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await (await b.new_context()).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(800)
        # 1 a file with only combinations is accepted; with nothing imported before it, the built-in files fill in
        st = await pg.evaluate(IMPORT, [combis, 'Combis.PCG'])
        ok('combination-only file is imported', '128 combinations' in st, st)
        T = await pg.evaluate(TIMBRES)
        ok('its combination loads, all programs from one built-in file (Hadi2024)', T is not None and all(t[1] and t[2] == 'Hadi2024' for t in T), T)
        # 2 import a full file, then the combination-only file again: the newer import wins over built-ins
        await pg.evaluate(IMPORT, [full, 'Full.PCG'])
        await pg.evaluate(IMPORT, [combis, 'Combis2.PCG'])
        T = await pg.evaluate(TIMBRES)
        ok('memory takes programs from the latest earlier import', T is not None and all(t[2] == 'Full' for t in T if t[1]), T)
        T0 = await pg.evaluate("() => window.__moss.getPatch().timbres[0].pName")
        # the same program name as in the full file's bank?
        ok('...and the program is the one in that file', T0 != '', T0)
        # 3 the older combination-only import still resolves to built-ins (it was loaded before Full)
        v = await pg.evaluate(FIRST, 'Combinations A from Combis')
        await pg.evaluate(LOAD, v)
        T = await pg.evaluate(TIMBRES)
        ok('the earlier import does not see later files', T is not None and all(t[2] not in ('Full', 'Combis2') for t in T), T)
        # 4 survives a reload (order kept)
        await pg.reload(); await pg.wait_for_timeout(1500)
        v = await pg.evaluate(FIRST, 'Combinations A from Combis2')
        await pg.evaluate(LOAD, v)
        T = await pg.evaluate(TIMBRES)
        ok('after reload: still from Full', T is not None and all(t[2] == 'Full' for t in T if t[1]), T)
        # 5 a file's own banks win: Full's own combinations use Full, not anything else
        v = await pg.evaluate(FIRST, 'Combinations A from Full')
        await pg.evaluate(LOAD, v)
        T = await pg.evaluate(TIMBRES)
        ok("a file's own banks are used first", T is not None and all(t[2] == '' for t in T), T)
        # 6 built-in files are unchanged: their combinations never borrow from other files
        n = await pg.evaluate("""() => { let n = 0; const sel = document.querySelector('#prog');
          for (const g of sel.querySelectorAll('optgroup')) if (/^Combinations . from (Hadi2024|KJ4TRINI|TRIN-2KJ|TRIN_3KJ|TRINI-1-KJ)$/.test(g.label)) for (const o of g.querySelectorAll('option')) {
            const [b, i] = o.value.split(':'); window.__moss.loadProgram(b, +i); for (const t of window.__moss.getPatch().timbres) if (t.from) n++; }
          return n; }""")
        ok('built-in files never borrow from other files', n == 0, n)
        # 7 a Bank-M-only file is accepted and its bank can be removed
        st = await pg.evaluate(IMPORT, [mossOnly, 'MossOnly.PCG'])
        ok('Bank-M-only file imported', '128 Bank M programs' in st, st)
        # 8 drum programs of a file without kits play the kits in memory
        st = await pg.evaluate(IMPORT, [pcmOnly, 'PcmOnly.PCG'])
        d = await pg.evaluate("""() => { const out = []; for (const g of document.querySelectorAll('#prog optgroup')) if (/\\(PCM\\) from PcmOnly/.test(g.label)) for (const o of g.querySelectorAll('option')) {
            const [b, i] = o.value.split(':'); window.__moss.loadProgram(b, +i); const P = window.__moss.getPatch(); if (P.mode === 'drum') out.push([P.name, !!P.kitData, P.korgInfo.kitFrom || '']); }
          return out; }""")
        ok('drum programs take kits from memory', len(d) > 0 and all(x[1] and x[2] == 'Full' for x in d), d[:4])
        ok('no page errors', not errs, errs)
        await b.close()
    sys.exit(1 if fails else 0)
asyncio.run(main())
