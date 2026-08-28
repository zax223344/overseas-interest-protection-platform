import asyncio, re
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:3000"
USER = "test_aa_20260826"
PASS = "Test123456"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 950})
        errors = []
        page.on("pageerror", lambda e: errors.append("PAGEERR|" + str(e)[:160]))
        page.on("console", lambda m: errors.append("CONSOLE-ERR|" + m.text[:160]) if m.type == "error" else None)
        await page.goto(BASE_URL, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(3500)
        # 登录
        await page.fill("#li-user", USER)
        await page.fill("#li-pass", PASS)
        await page.click("button:has-text('登 录')")
        # 等待登录页消失（被主界面替代）
        try:
            await page.wait_for_function("!document.getElementById('login-page') || document.getElementById('login-page').offsetParent === null", timeout=20000)
        except Exception as e:
            print("LOGIN-WAIT-FAIL", e)
        await page.wait_for_timeout(3000)
        # 进入态势总览并等面板
        try:
            await page.evaluate("if(typeof navigateTo==='function') navigateTo('situation')")
        except Exception as e:
            print("NAV-ERR", e)
        try:
            await page.wait_for_selector('#globe-intel-live', timeout=10000)
        except Exception:
            pass
        await page.wait_for_timeout(8000)  # 等 renderIntelPanels + 首次 DataHub 拉取
        result = await page.evaluate("""() => {
          const out = { liveItems: [], topAlerts: [], alertRows: [], cnCounter: '', headerTime: '' };
          const gi = document.getElementById('globe-intel-live');
          if (gi) {
            gi.querySelectorAll('.live-item').forEach(el => out.liveItems.push(el.textContent.replace(/\s+/g, ' ').trim().slice(0, 100)));
            const tt = gi.textContent || '';
            const m = tt.match(/涉华\s*(\d+)/); if (m) out.cnCounter = m[1];
            const tm = tt.match(/\d{2}:\d{2}/); if (tm) out.headerTime = tm[0];
          }
          // 抓"最高价值预警"块下的行
          if (gi) {
            gi.querySelectorAll('div[onclick*="AVIEW.selectAlert"]').forEach(el => out.topAlerts.push(el.textContent.replace(/\s+/g, ' ').trim().slice(0, 100)));
          }
          const sa = document.getElementById('sit-alerts');
          if (sa) sa.querySelectorAll('.sit-alert-row, .live-item, div[onclick]').forEach(el => {
            const t = el.textContent.replace(/\s+/g, ' ').trim();
            if (t && t.length > 6 && t.length < 220) out.alertRows.push(t.slice(0, 120));
          });
          return out;
        }""")
        def is_mixed(t):
            return bool(re.search(r'[一-龥]', t or '')) and bool(re.search(r"[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){3,}", t or ''))
        all_titles = result.get('liveItems', []) + result.get('topAlerts', []) + result.get('alertRows', [])
        mixed = [t for t in all_titles if is_mixed(t)]
        print("=== 全球态势焦点 LIVE-ITEMS:", len(result.get('liveItems', [])))
        for t in result.get('liveItems', []): print("  LIVE |", t)
        print("=== 最高价值预警 TOP:", len(result.get('topAlerts', [])))
        for t in result.get('topAlerts', [])[:8]: print("  TOP |", t)
        print("=== 态势总览告警行 (前10):")
        for t in result.get('alertRows', [])[:10]: print("  ROW |", t)
        print("CN-COUNTER:", result.get('cnCounter'), " HEADER-TIME:", result.get('headerTime'))
        print("MIXED-TITLES:", len(mixed))
        for t in mixed[:6]: print("  MIXED|", t)
        print("JS-ERRORS:", len(errors))
        for e in errors[:6]: print("  ERR|", e)
        await page.screenshot(path="C:/Users/28737/Desktop/新建文件夹/_verify/_screenshot_focus2.png", full_page=False)
        await browser.close()

asyncio.run(main())
