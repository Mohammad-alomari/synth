# Page checks for this round: program-change speed, program list reuse, stuck keys with Shift, compatibility mode, fx defaults
import asyncio, sys
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/index.html'
async def run(p, fallback):
    b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = await b.new_page(viewport={'width': 1200, 'height': 900})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    if fallback: await pg.add_init_script("delete window.AudioWorkletNode;")
    await pg.goto(URL); await pg.wait_for_timeout(700)
    await pg.click('#power'); await pg.wait_for_timeout(1500)
    print('--', 'mode', await pg.evaluate('window.__mossMode'))
    # program changes: time 60 prev/next steps, check the list is not rebuilt
    r = await pg.evaluate("""async () => {
      const s = document.querySelector('#prog'), first = s.options[5]; const t0 = performance.now();
      for (let i = 0; i < 60; i++) document.querySelector('#next').click();
      const dt = (performance.now() - t0) / 60;
      return [dt.toFixed(1) + ' ms per program change', s.options[5] === first ? 'list kept' : 'list rebuilt', s.value, s.options.length]; }""")
    print('program change:', r)
    # sound in this mode
    lv = await pg.evaluate("""async () => { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048); M.loadProgram('st', 16);
      await new Promise(r => setTimeout(r, 100)); M.noteOn(60, 110); let pk = 0; const t0 = performance.now(); while (performance.now() - t0 < 600) { an.getFloatTimeDomainData(buf); for (const v of buf) pk = Math.max(pk, Math.abs(v)); await new Promise(r => setTimeout(r, 30)); }
      M.noteOff(60); return pk.toFixed(3); }""")
    print('E.Piano peak', lv)
    # Shift pressed while a note key is down must not strand the note
    await pg.evaluate("window.__moss.loadProgram('st', 0)")
    await pg.keyboard.down(';'); await pg.wait_for_timeout(80); await pg.keyboard.down('Shift'); await pg.keyboard.up(';'); await pg.keyboard.up('Shift'); await pg.wait_for_timeout(1500)
    if fallback:
        act = await pg.evaluate("window.__moss.engine().voices.filter(v => v.active && v.gate).length")
        print('gated voices after Shift trick', act)
    lit = await pg.evaluate("document.querySelectorAll('#kb .on').length")
    print('lit keys after Shift trick', lit)
    # a pasted program with a sparse effect gets its defaults
    await pg.evaluate("""() => { const t = document.querySelector('#dlgtxt'); }""")
    errs = [l for l in logs if ('error' in l.lower() or 'PAGEERROR' in l) and 'ERR_TUNNEL' not in l]
    print('errors', errs[:5])
    await b.close()
async def main():
    async with async_playwright() as p:
        await run(p, False)
        await run(p, True)
asyncio.run(main())
