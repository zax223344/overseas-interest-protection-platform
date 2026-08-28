import asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:3000"
USER = "test_aa_20260826"
PASS = "Test123456"

JS_CHECK = r"""() => {
  const out = { ldn: 0, shtatorit: 0, staleRows: 0, mixed: 0, alertRows: [] };
  const t = document.body.innerText || '';
  // 伦敦使馆旧闻 / Shtatorit 残留
  if (/伦敦.*使馆|伦敦.*大使馆|London\s+[Ee]mbassy/.test(t)) out.ldn++;
  if (/Shtatorit|vite\s+pas/.test(t)) out.shtatorit++;
  // 最新预警面板逐行检查时间（超过24h的行）
  const sa = document.getElementById('sit-alerts');
  if (sa) {
    sa.querySelectorAll('.sit-alert-row').forEach(el => {
      const txt = el.textContent || '';
      out.alertRows.push(txt.replace(/\s+/g, ' ').trim().slice(0, 90));
      const m = txt.match(/(\d+)\s*小时前|(\d+)\s*天前|(\d+)\s*分钟前|刚刚/);
      if (m && (m[2] && parseInt(m[2]) > 0)) out.staleRows++;
      const hm = txt.match(/(\d+)\s*月前/);
      if (hm) out.staleRows++;
    });
  }
  // 混排
  const lines = t.split('\n').filter(x => x.trim().length > 15);
  lines.forEach(l => {
    if (/[\u4e00-\u9fa5]/.test(l) && /[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){3,}/.test(l)) out.mixed++;
  });
  return out;
}"""

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 950})
        await page.goto(BASE_URL, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(3000)
        await page.fill("#li-user", USER)
        await page.fill("#li-pass", PASS)
        await page.click("button:has-text('登 录')")
        await page.wait_for_timeout(6000)
        await page.evaluate("if(typeof navigateTo==='function') navigateTo('situation')")
        await page.wait_for_timeout(9000)
        r = await page.evaluate(JS_CHECK)
        print("伦敦使馆旧闻出现:", r.get("ldn"))
        print("Shtatorit 类残留出现:", r.get("shtatorit"))
        print("最新预警面板陈旧行(天/月前):", r.get("staleRows"))
        print("全页面混排行数:", r.get("mixed"))
        print("=== 最新预警面板行 ===")
        for row in r.get("alertRows", []): print("  ROW |", row)
        await page.screenshot(path="C:/Users/28737/Desktop/新建文件夹/_verify/_screenshot_stale.png")
        await browser.close()

asyncio.run(main())
