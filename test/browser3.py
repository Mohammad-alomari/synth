# Headless browser test for the Organ / E.Piano / Brass models: programs sound, editor pages render, no errors
import asyncio, sys, os, tempfile
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/index.html'
SP = os.environ.get('SHOT', tempfile.gettempdir()) + os.sep  # screenshot folder
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1200, 'height': 900})
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.click('#power'); await pg.wait_for_timeout(1500)
        print('mode', await pg.evaluate('window.__mossMode'))
        res = await pg.evaluate("""async () => {
          const M = window.__moss, out = [];
          const an = window.__mossAnalyser(), buf = new Float32Array(2048);
          const level = async ms => { let pk = 0, t0 = performance.now(); while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (const v of buf) pk = Math.max(pk, Math.abs(v)); await new Promise(r => setTimeout(r, 40)); } return pk; };
          const tryProg = async (bank, idx) => { M.loadProgram(bank, idx); await new Promise(r => setTimeout(r, 150)); M.noteOn(60, 100); M.noteOn(64, 100); const a = await level(800); M.noteOff(60); M.noteOff(64); await level(500); const P = M.getPatch(); return [bank + idx, P.name, P.osc[0].type + '/' + P.osc[1].type, a.toFixed(3), document.querySelector('#status').textContent]; };
          for (const [b, i] of [['st', 16], ['st', 17], ['st', 18], ['pm', 2], ['pm', 14], ['pm', 21], ['pm', 66], ['pm', 78], ['pm', 85], ['pm', 3 * 128 + 62], ['pm', 3 * 128 + 119], ['pm', 3 * 128 + 78]]) out.push(await tryProg(b, i));
          return out; }""")
        for r in res: print(r)
        for prog, page, shot in [(('st', 17), 'osc0', 'organ'), (('st', 16), 'osc0', 'epiano'), (('st', 18), 'osc0', 'brass'), (('pm', 2), 'osc1', 'epiano_osc2')]:
            await pg.evaluate("([b, i, pgid]) => { window.__moss.loadProgram(b, i); window.__moss.selectPage(pgid); }", [prog[0], prog[1], page])
            await pg.wait_for_timeout(300)
            info = await pg.evaluate("[document.querySelectorAll('#page section, #page .sec').length, document.querySelectorAll('#page input[type=range]').length, document.querySelectorAll('#page select').length, [...document.querySelectorAll('#page h3, #page .sec-title, #page h2')].map(h => h.textContent).join(' | ')]")
            print(shot, info)
            await pg.screenshot(path=SP + 'osc_' + shot + '.png', full_page=True)
        # change a model parameter through the UI and hear it still
        await pg.evaluate("window.__moss.loadProgram('st', 18); window.__moss.selectPage('osc0')")
        await pg.wait_for_timeout(200)
        sel = await pg.evaluate("""() => { const s = [...document.querySelectorAll('#page select')].find(s => [...s.options].some(o => o.textContent === 'Horn 1')); if (!s) return 'no inst select'; s.value = '3'; s.dispatchEvent(new Event('change')); return window.__moss.getPatch().osc[0].p.brType; }""")
        print('brass type after UI change', sel)
        # program list no longer marks anything partial
        part = await pg.evaluate("[...document.querySelectorAll('option')].filter(o => /partial/.test(o.textContent)).length")
        print('options marked partial', part)
        # mobile
        await pg.set_viewport_size({'width': 390, 'height': 844}); await pg.evaluate("window.__moss.loadProgram('st', 17); window.__moss.selectPage('osc0')"); await pg.wait_for_timeout(300)
        print('mobile horizontal overflow px', await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"))
        await pg.screenshot(path=SP + 'osc_mobile.png', full_page=True)
        errs = [l for l in logs if 'error' in l.lower() and 'font' not in l.lower()]
        print('errors', len(errs)); [print('  ', e) for e in errs[:10]]
        await b.close()
asyncio.run(main())
