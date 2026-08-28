import asyncio, json, re
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:3000"
USER = "test_aa_20260826"
PASS = "Test123456"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1600, "height": 950})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        await page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2500)
        # 登录
        try:
            await page.fill("#li-user", USER)
            await page.fill("#li-pass", PASS)
            await page.click("button:has-text('登 录')")
            await page.wait_for_timeout(4000)
        except Exception as e:
            print("LOGIN-FAIL", e)
        # 进入态势总览
        try:
            await page.evaluate("navigateTo('situation')")
        except Exception:
            pass
        await page.wait_for_timeout(5000)
        # 检查全球态势焦点面板
        result = await page.evaluate("""() => {
          const out = { panelTitles: [], liveItems: [], alerts: [], cnCounter: '' };
          const gi = document.getElementById('globe-intel-live');
          if (gi) {
            gi.querySelectorAll('.live-item').forEach(el => out.liveItems.push(el.textContent.trim().slice(0, 80)));
            const tt = gi.textContent || '';
            const m = tt.match(/涉华\s*(\d+)/); if (m) out.cnCounter = m[1];
          }
          const sa = document.getElementById('sit-alerts');
          if (sa) sa.querySelectorAll('.sit-alert-row').forEach(el => out.alerts.push(el.textContent.trim().slice(0, 80)));
          return out;
        }""")
        # 半中半英检测：含中文 + 4 个以上连续英文单词
        def is_mixed(t):
            has_zh = re.search(r'[一-龥]', t or '')
            latin_run = re.search(r"[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){3,}", t or '')
            return bool(has_zh and latin_run)
        all_titles = result.get('liveItems', []) + result.get('alerts', [])
        mixed = [t for t in all_titles if is_mixed(t)]
        print("LIVE-ITEMS:", len(result.get('liveItems', [])))
        for t in result.get('liveItems', []): print("  LIVE |", t)
        print("ALERT-ROWS:", len(result.get('alerts', [])))
        for t in result.get('alerts', []): print("  ALERT|", t)
        print("CN-COUNTER:", result.get('cnCounter'))
        print("MIXED-TITLES:", len(mixed))
        for t in mixed: print("  MIXED|", t)
        print("JS-ERRORS:", len(errors))
        for e in errors[:8]: print("  ERR|", e[:160])
        await page.screenshot(path="C:/Users/28737/Desktop/新建文件夹/_verify/_screenshot_focus.png", full_page=False)
        await browser.close()

asyncio.run(main())
