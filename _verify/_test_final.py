import asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:3000"
USER = "test_aa_20260826"
PASS = "Test123456"

JS_CHECK = r"""() => {
  const out = { mixed: 0, dbStatus: '', dcBadge: '' };
  const t = document.body.innerText || '';
  const lines = t.split('\n').filter(x => x.trim().length > 15);
  lines.forEach(l => {
    if (/[\u4e00-\u9fa5]/.test(l) && /[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){3,}/.test(l)) out.mixed++;
  });
  const m = t.match(/\u6570\u636e\u5e93[:：]\s*(\d+)\s*\u6761/); if (m) out.dbStatus = m[1];
  const b = document.getElementById('sb-dc-count'); if (b) out.dcBadge = b.textContent.trim();
  return out;
}"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 950})
        errors = []
        page.on("pageerror", lambda e: errors.append("PAGEERR|" + str(e)[:150]))
        page.on("console", lambda m: errors.append("CERR|" + m.text[:150]) if m.type == "error" else None)
        await page.goto(BASE_URL, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(3000)
        await page.fill("#li-user", USER)
        await page.fill("#li-pass", PASS)
        await page.click("button:has-text('登 录')")
        try:
            await page.wait_for_function("!document.getElementById('login-page') || document.getElementById('login-page').offsetParent === null", timeout=20000)
        except Exception:
            print("LOGIN-TIMEOUT")
        await page.wait_for_timeout(3000)
        await page.evaluate("if(typeof navigateTo==='function') navigateTo('situation')")
        await page.wait_for_timeout(7000)
        r = await page.evaluate(JS_CHECK)
        print("全页面混排行数:", r.get("mixed"))
        print("态势总览数据库条数:", r.get("dbStatus"))
        print("数据中心徽标:", r.get("dcBadge"))
        print("JS错误:", len(errors))
        for e in errors[:5]: print("  ERR|", e)
        await page.screenshot(path="C:/Users/28737/Desktop/新建文件夹/_verify/_screenshot_final.png")
        await browser.close()

asyncio.run(main())
