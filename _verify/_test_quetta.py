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
          const out = [];
          // 找所有 textContent 含 奎达 的叶子元素
          document.querySelectorAll('#view-situation *').forEach(el => {
            if (el.children.length === 0 && /奎达/.test(el.textContent || '')) {
              out.push('LEAF <' + el.tagName + '> parent=<' + (el.parentElement && el.parentElement.tagName) + '> text=' + el.textContent.trim().slice(0, 70));
            }
          });
          return out;
        }""")
        for line in info: print(line)
        await browser.close()

asyncio.run(main())
