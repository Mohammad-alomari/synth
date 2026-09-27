# Page checks for the Trinity PCM programs: list, sample packs, sound, pages, both audio modes
import asyncio, sys, re
from playwright.async_api import async_playwright
URL = 'http://127.0.0.1:8765/index.html'
SHOT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
async def run(p, fallback):
    b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = await b.new_page(viewport={'width': 1200, 'height': 900})
    logs, reqs = [], []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text))
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: ' + str(e)))
    pg.on('requestfinished', lambda r: reqs.append(r.url))
    if fallback: await pg.add_init_script("delete window.AudioWorkletNode;")
    await pg.goto(URL); await pg.wait_for_timeout(900)
    await pg.click('#power'); await pg.wait_for_timeout(1500)
    print('--', 'mode', await pg.evaluate('window.__mossMode'))
    info = await pg.evaluate("""() => { const s = document.querySelector('#prog'); const g = [...s.querySelectorAll('optgroup')].map(x => x.label + ' (' + x.children.length + ')');
      return { options: s.options.length, groups: g.filter(x => /PCM/.test(x)).slice(0, 30), all: g.length }; }""")
    print('program list', info['options'], 'options,', info['all'], 'groups'); print('  PCM groups:', info['groups'][:8], '...', len(info['groups']))
    # find some programs by name among the pc: options
    picks = await pg.evaluate("""() => { const o = [...document.querySelectorAll('#prog option')].filter(x => x.value.startsWith('pc:'));
      const find = re => { const x = o.find(x => re.test(x.textContent)); return x ? [x.value, x.textContent] : null; };
      return [o[0] && [o[0].value, o[0].textContent], find(/piano/i), find(/str/i), find(/bass/i), find(/(kit|drum)/i), find(/(zurna|mizmar|mijwiz|nay|oud|kanun|qanun)/i)].filter(Boolean); }""")
    for v, name in picks:
        idx = int(v.split(':')[1])
        r = await pg.evaluate("""async (idx) => { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048);
          M.loadProgram('pc', idx); const P = M.getPatch();
          await new Promise(r => setTimeout(r, 1500));   // packs load
          const notes = P.mode === 'drum' ? [36, 38, 42] : [48, 60, 64];
          notes.forEach(n => M.noteOn(n, 100)); let pk = 0, rms = 0, c = 0; const t0 = performance.now();
          while (performance.now() - t0 < 900) { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) { pk = Math.max(pk, Math.abs(v)); s += v * v; } rms += Math.sqrt(s / buf.length); c++; await new Promise(r => setTimeout(r, 30)); }
          notes.forEach(n => M.noteOff(n)); await new Promise(r => setTimeout(r, 600));
          return { name: P.name, mode: P.mode, pk: pk.toFixed(3), rms: (rms / c).toFixed(4), lcd: document.querySelector('#pname').textContent, status: document.querySelector('#status').textContent.slice(0, 90) }; }""", idx)
        print(' ', v, r)
    mp3 = sorted(set(re.sub(r'.*/samples/', '', u) for u in reqs if '/samples/' in u))
    print('packs fetched:', len(mp3), mp3[:12])
    if not fallback:
        # pages of the current (last) program and a normal one
        await pg.evaluate("window.__moss.loadProgram('pc', %d)" % int(picks[1][0].split(':')[1] if len(picks) > 1 else 0))
        for pid in ['program', 'osc0', 'filter0', 'amp0', 'fx']:
            await pg.evaluate("window.__moss.selectPage('%s')" % pid); await pg.wait_for_timeout(250)
            await pg.screenshot(path='%s/pcm_%s.png' % (SHOT, pid), full_page=True)
        # back to a MOSS program: the MOSS pages come back and play
        lv = await pg.evaluate("""async () => { const M = window.__moss, an = window.__mossAnalyser(), buf = new Float32Array(2048); M.loadProgram('st', 0); await new Promise(r => setTimeout(r, 150));
          M.noteOn(60, 110); let pk = 0; const t0 = performance.now(); while (performance.now() - t0 < 500) { an.getFloatTimeDomainData(buf); for (const v of buf) pk = Math.max(pk, Math.abs(v)); await new Promise(r => setTimeout(r, 30)); }
          M.noteOff(60); return [pk.toFixed(3), document.querySelectorAll('#tabs [role=tab]').length]; }""")
        print('MOSS after PCM: peak, tabs', lv)
        await pg.set_viewport_size({'width': 400, 'height': 860}); await pg.evaluate("window.__moss.loadProgram('pc', 0); window.__moss.selectPage('osc0')"); await pg.wait_for_timeout(300)
        await pg.screenshot(path='%s/pcm_phone.png' % SHOT, full_page=True)
        ov = await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        print('phone horizontal overflow px', ov)
    errs = [l for l in logs if ('error' in l.lower() or 'PAGEERROR' in l) and 'ERR_TUNNEL' not in l]
    print('errors', errs[:6])
    await b.close()
async def main():
    async with async_playwright() as p:
        await run(p, False)
        await run(p, True)
asyncio.run(main())
