# Drum programs: kit table, stand-in packs, sound on several keys (worklet mode)
import asyncio, sys
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/index.html'
SHOT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1200, 'height': 900})
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(900); await pg.click('#power'); await pg.wait_for_timeout(1500)
        progs = await pg.evaluate("""() => [...document.querySelectorAll('#prog option')].filter(o => o.value.startsWith('pc:') && /kit|cymbal/i.test(o.textContent)).map(o => [o.value, o.textContent])""")
        print('drum-ish programs', progs[:12])
        for v, name in progs[:8]:
            r = await pg.evaluate("""async (idx) => { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048);
              M.loadProgram('pc', idx); const P = M.getPatch(); if (P.mode !== 'drum') return null; await new Promise(r => setTimeout(r, 2000));
              const out = []; for (const n of [36, 38, 42, 48, 50, 54, 60, 72]) { M.noteOn(n, 100); let pk = 0; const t0 = performance.now();
                while (performance.now() - t0 < 250) { an.getFloatTimeDomainData(buf); for (const x of buf) pk = Math.max(pk, Math.abs(x)); await new Promise(r => setTimeout(r, 20)); }
                M.noteOff(n); out.push(n + ':' + pk.toFixed(2)); }
              return { name: P.name, kit: P.kitData && P.kitData.name, keys: out.join(' ') }; }""", int(v.split(':')[1]))
            if r: print(' ', r)
        await pg.evaluate("window.__moss.selectPage('program')"); await pg.wait_for_timeout(300)
        rows = await pg.evaluate("document.querySelectorAll('table.kit tr').length")
        print('kit table rows', rows)
        el = await pg.query_selector('.kitwrap')
        if el: await el.scroll_into_view_if_needed(); await pg.screenshot(path=SHOT + '/drum_kit.png')
        errs = [l for l in logs if ('error' in l.lower() or 'PAGEERROR' in l) and 'ERR_TUNNEL' not in l]
        print('errors', errs[:6])
        await b.close()
asyncio.run(main())
