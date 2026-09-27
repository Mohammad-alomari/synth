# Combinations: list, sound, pages (Combination, Timbre, Effects), timbre edits, both audio modes, phone width
import asyncio, sys
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/index.html'
SHOT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
async def run(p, fallback):
    b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = await b.new_page(viewport={'width': 1200, 'height': 900})
    logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    if fallback: await pg.add_init_script("delete window.AudioWorkletNode;")
    await pg.goto(URL); await pg.wait_for_timeout(900); await pg.click('#power'); await pg.wait_for_timeout(1500)
    print('--', 'mode', await pg.evaluate('window.__mossMode'))
    info = await pg.evaluate("""() => { const o = [...document.querySelectorAll('#prog option')].filter(x => x.value.startsWith('cb:'));
      const g = [...document.querySelectorAll('#prog optgroup')].filter(x => /Combinations/.test(x.label)).map(x => x.label);
      const pick = re => { const x = o.find(x => re.test(x.textContent)); return x ? [x.value, x.textContent] : null; };
      return { n: o.length, groups: g, picks: [o[0] && [o[0].value, o[0].textContent], pick(/ZMR Live/), pick(/zurna/i), pick(/STRING/i), pick(/MTBK/)].filter(Boolean) }; }""")
    print('combinations', info['n'], info['groups'][:4], '...', len(info['groups']))
    for v, name in info['picks']:
        r = await pg.evaluate("""async (idx) => { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048);
          M.loadProgram('cb', idx); const P = M.getPatch(); await new Promise(r => setTimeout(r, 2500));
          const notes = [48, 55, 60, 64, 72]; notes.forEach(n => M.noteOn(n, 100)); let pk = 0, rms = 0, c = 0; const t0 = performance.now();
          while (performance.now() - t0 < 1000) { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) { pk = Math.max(pk, Math.abs(x)); s += x * x; } rms += Math.sqrt(s / buf.length); c++; await new Promise(r => setTimeout(r, 30)); }
          notes.forEach(n => M.noteOff(n)); await new Promise(r => setTimeout(r, 400));
          return { name: P.name, kind: P.kind, timbres: P.timbres.filter(t => t.status !== 'off').map(t => t.pLabel + ' ' + t.pName + '/ch' + t.ch).join(', '), pk: pk.toFixed(3), rms: (rms / c).toFixed(4), lcd: document.querySelector('#pnum').textContent, status: document.querySelector('#status').textContent.slice(0, 110) }; }""", int(v.split(':')[1]))
        print(' ', v, r)
    if not fallback:
        idx = int(info['picks'][1][0].split(':')[1]) if len(info['picks']) > 1 else 0
        await pg.evaluate("window.__moss.loadProgram('cb', %d)" % idx); await pg.wait_for_timeout(400)
        for pid in ['combi', 'timbre', 'fx']:
            await pg.evaluate("window.__moss.selectPage('%s')" % pid); await pg.wait_for_timeout(300)
            await pg.screenshot(path='%s/combi_%s.png' % (SHOT, pid), full_page=True)
        # edit: timbre level to 0 on every timbre -> silence; then program change of timbre 1
        r = await pg.evaluate("""async () => { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048), P = M.getPatch();
          document.querySelectorAll('#page input[type=range]'); // timbre page
          M.selectPage('timbre'); const tabs = document.querySelectorAll('#tabs [role=tab]').length;
          const tbl = document.querySelectorAll('table.kit tr').length;
          return { tabs, tblRows: tbl }; }""")
        print('pages', r)
        await pg.set_viewport_size({'width': 400, 'height': 860}); await pg.evaluate("window.__moss.selectPage('combi')"); await pg.wait_for_timeout(300)
        await pg.screenshot(path='%s/combi_phone.png' % SHOT, full_page=True)
        print('phone overflow', await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"))
        await pg.set_viewport_size({'width': 1200, 'height': 900})
        # back to a MOSS program and a PCM program
        lv = await pg.evaluate("""async () => { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048); const out = [];
          for (const [b, i] of [['st', 0], ['pc', 10]]) { M.loadProgram(b, i); await new Promise(r => setTimeout(r, 900)); M.noteOn(60, 110); let pk = 0; const t0 = performance.now();
            while (performance.now() - t0 < 500) { an.getFloatTimeDomainData(buf); for (const v of buf) pk = Math.max(pk, Math.abs(v)); await new Promise(r => setTimeout(r, 30)); }
            M.noteOff(60); out.push(b + ' ' + pk.toFixed(3)); await new Promise(r => setTimeout(r, 300)); }
          return out; }""")
        print('after combi:', lv)
    errs = [l for l in logs if ('error' in l.lower() or 'PAGEERROR' in l) and 'ERR_TUNNEL' not in l]
    print('errors', errs[:6])
    await b.close()
async def main():
    async with async_playwright() as p:
        await run(p, False)
        await run(p, True)
asyncio.run(main())
