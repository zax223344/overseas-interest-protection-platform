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
          document.querySelectorAll('#view-situation div, #view-situation span').forEach(el => {
            const raw = el.getAttribute('style') || '';
            // 找 title 数据从哪个 JS 变量来：检查所有含 Bessent 的元素
          });
          // 直接检查 sit-alerts 容器的原始 innerHTML 片段
          const sa = document.getElementById('sit-alerts');
          if (sa) {
            const html = sa.innerHTML;
            const idx = html.indexOf('Bessent');
            if (idx >= 0) out.push('SIT-ALERTS-HTML: ' + html.slice(Math.max(0, idx - 400), idx + 200));
          }
          // 检查 a.title 数据源：ALERTS 中 Bessent 条目的完整字段
          if (typeof ALERTS !== 'undefined') {
            const hit = (ALERTS || []).filter(a => String(a.title || '').indexOf('Bessent') >= 0 || String(a.title_zh || '').indexOf('Bessent') >= 0);
            hit.slice(0, 2).forEach(a => {
              out.push('ALERT-FIELD title=' + JSON.stringify(String(a.title || '').slice(0, 150)));
              out.push('ALERT-FIELD title_zh=' + JSON.stringify(String(a.title_zh || '').slice(0, 150)));
              out.push('ALERT-FIELD desc=' + JSON.stringify(String(a.desc || '').slice(0, 150)));
              out.push('ALERT-FIELD content=' + JSON.stringify(String(a.content || '').slice(0, 150)));
              out.push('ALERT-FIELD content_zh=' + JSON.stringify(String(a.content_zh || '').slice(0, 150)));
            });
          }
          return out;
        }""")
        for line in info: print(line[:400])
        await browser.close()

asyncio.run(main())
