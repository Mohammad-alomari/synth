import asyncio
from playwright.async_api import async_playwright
SP='/tmp/claude-0/-home-claude/fd4940bd-9427-59ad-83bc-cbcf72517544/scratchpad/'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1100, 'height': 1400})
        logs = []; pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e))); pg.on('console', lambda m: logs.append(m.type + ' ' + m.text) if m.type == 'error' else None)
        await pg.goto('http://127.0.0.1:8765/index.html'); await pg.wait_for_timeout(600)
        await pg.click('#power'); await pg.wait_for_timeout(1200)
        await pg.add_style_tag(content='.dock{display:none !important}')
        await pg.evaluate("window.__moss.loadProgram('pm', 13); window.__moss.selectPage('fx')"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=SP+'fx_f13.png', full_page=True)
        # click Master 1 chip, then EQ chip
        await pg.evaluate("[...document.querySelectorAll('#page .fxchip')].find(c => /Master 1/.test(c.textContent)).click()"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=SP+'fx_f13_m1.png', full_page=True)
        await pg.evaluate("[...document.querySelectorAll('#page .fxchip')].find(c => /^EQ/.test(c.textContent)).click()"); await pg.wait_for_timeout(200)
        t = await pg.evaluate("document.querySelector('#page').innerText.slice(0, 600)")
        print(t)
        print(logs[:10])
        await b.close()
asyncio.run(main())
