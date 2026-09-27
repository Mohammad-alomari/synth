# Headless browser test: loads the built page over http, starts audio, plays programs, visits the Effects page
import asyncio, sys, json, os, tempfile
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/index.html'
SHOT = os.environ.get('SHOT', tempfile.gettempdir())  # screenshot folder
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1200, 'height': 900})
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
        pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.click('#power'); await pg.wait_for_timeout(1500)
        mode = await pg.evaluate('window.__mossMode')
        st = await pg.evaluate("document.querySelector('#status').textContent")
        print('mode', mode, '| status:', st)
        res = await pg.evaluate("""async () => {
          const M = window.__moss, out = [];
          const an = window.__mossAnalyser(), buf = new Float32Array(2048);
          const level = async ms => { let pk = 0, t0 = performance.now(); while (performance.now() - t0 < ms) { an.getFloatTimeDomainData(buf); for (const v of buf) pk = Math.max(pk, Math.abs(v)); await new Promise(r => setTimeout(r, 40)); } return pk; };
          const tryProg = async (bank, idx) => { M.loadProgram(bank, idx); await new Promise(r => setTimeout(r, 150)); M.noteOn(60, 100); M.noteOn(64, 100); const a = await level(700); M.noteOff(60); M.noteOff(64); const tail = await level(900); return [bank + idx, M.getPatch().name, a.toFixed(3), tail.toFixed(3), M.getPatch().fx.ins.map(s => s.type).join(','), M.getPatch().fx.m1.on ? M.getPatch().fx.m1.type : '-', M.getPatch().fx.m2.on ? M.getPatch().fx.m2.type : '-']; };
          for (const [b, i] of [['st', 1], ['st', 14], ['st', 15], ['pm', 0], ['pm', 3], ['pm', 128], ['pm', 130], ['pm', 385]]) out.push(await tryProg(b, i));
          return out; }""")
        for r in res: print(r)
        # Effects page renders and its controls work
        await pg.evaluate("window.__moss.loadProgram('st', 14); window.__moss.selectPage('fx')")
        await pg.wait_for_timeout(300)
        n = await pg.evaluate("document.querySelectorAll('#page .fxchip').length")
        sel = await pg.evaluate("document.querySelectorAll('#page select').length")
        rng = await pg.evaluate("document.querySelectorAll('#page input[type=range]').length")
        print('fx page chips', n, 'selects', sel, 'sliders', rng)
        await pg.screenshot(path=os.path.join(SHOT, 'fx.png'), full_page=True)
        # add an insert, change its type, move, remove
        await pg.evaluate("[...document.querySelectorAll('#page .fxchip.add')][0].click()")
        await pg.wait_for_timeout(200)
        cnt = await pg.evaluate("window.__moss.getPatch().fx.ins.length")
        await pg.evaluate("""() => { const s = document.querySelector('#page .fxtype'); s.value = 'S4:14'; s.dispatchEvent(new Event('change')); }""")
        await pg.wait_for_timeout(200)
        t = await pg.evaluate("window.__moss.getPatch().fx.ins.map(s => s.type)")
        print('after add', cnt, 'types', t)
        # masters
        await pg.evaluate("[...document.querySelectorAll('#page .fxchip')].find(c => /Master 2/.test(c.textContent)).click()")
        await pg.wait_for_timeout(200)
        await pg.screenshot(path=os.path.join(SHOT, 'fx_m2.png'), full_page=True)
        # mobile layout
        await pg.set_viewport_size({'width': 390, 'height': 844}); await pg.wait_for_timeout(300)
        ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        print('mobile horizontal overflow px', ov)
        await pg.screenshot(path=os.path.join(SHOT, 'fx_mobile.png'), full_page=True)
        errs = [l for l in logs if 'error' in l.lower()]
        print('console errors:', errs[:10])
        await b.close()
asyncio.run(main())
