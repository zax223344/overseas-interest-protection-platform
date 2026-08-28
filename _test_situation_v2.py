import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1600, 'height': 1200})
        page = await context.new_page()
        page.on('console', lambda msg: print('CONSOLE:', msg.text[:200]))
        page.on('pageerror', lambda err: print('PAGEERROR:', err))
        await page.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=120000)
        await page.wait_for_timeout(3000)
        # login
        await page.fill('#li-user', 'test_aa_20260826')
        await page.fill('#li-pass', 'Test123456!')
        await page.click('#auth-card-login .auth-btn')
        await page.wait_for_load_state('networkidle', timeout=120000)
        await page.wait_for_timeout(6000)
        # screenshot home
        await page.screenshot(path='_screenshot_situation_v2.png', full_page=False)
        # check alert rows
        els = await page.query_selector_all('.sit-alert-row')
        print('sit-alert-row count:', len(els))
        # check focus panel duplicate titles
        titles = await page.evaluate('''() => {
            const out = [];
            document.querySelectorAll('#globe-intel-live .live-title').forEach(el => out.push(el.innerText));
            return out;
        }''')
        print('focus live titles:', titles)
        # check latest alert titles
        latest = await page.evaluate('''() => {
            const out = [];
            document.querySelectorAll('#sit-alerts .sit-alert-row').forEach(el => {
                const t = el.querySelector('[style*="white-space:nowrap"]');
                if (t) out.push(t.innerText);
            });
            return out;
        }''')
        print('latest alert titles:', latest)
        # click first alert row
        if els:
            try:
                await els[0].click()
                await page.wait_for_timeout(1000)
                await page.screenshot(path='_screenshot_situation_detail.png', full_page=False)
            except Exception as e:
                print('click error:', e)
        await browser.close()

asyncio.run(main())
