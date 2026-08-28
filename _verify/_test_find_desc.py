import asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:3000"
USER = "test_aa_20260826"
PASS = "Test123456"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 950})
        await page.goto(BASE_URL, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(3000)
        await page.fill("#li-user", USER)
        await page.fill("#li-pass", PASS)
        await page.click("button:has-text('登 录')")
        try:
            await page.wait_for_function("!document.getElementById('login-page') || document.getElementById('login-page').offsetParent === null", timeout=20000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)
        await page.evaluate("if(typeof navigateTo==='function') navigateTo('situation')")
        await page.wait_for_timeout(8000)
        info = await page.evaluate("""() => {
          const sa = document.getElementById('sit-alerts');
          if (!sa) return ['NO sit-alerts'];
          const html = sa.innerHTML;
          const out = [];
          let idx = html.indexOf('&lt;a');
          if (idx >= 0) out.push('ENTITY-A at ' + idx + ': ' + html.slice(Math.max(0, idx - 250), idx + 150));
          idx = html.indexOf('<a ');
          if (idx >= 0) out.push('REAL-A at ' + idx + ': ' + html.slice(Math.max(0, idx - 250), idx + 150));
          // 找含英文长串的元素的直接父级标签结构
          const a = document.querySelector('#sit-alerts a');
          if (a) {
            let el = a, path = [];
            while (el && el !== sa) { path.push(el.tagName + '.' + (el.className || '')); el = el.parentElement; }
            out.push('A-PATH: ' + path.join(' < '));
          }
          return out;
        }""")
        for line in info: print(line[:500])
        await browser.close()

asyncio.run(main())
