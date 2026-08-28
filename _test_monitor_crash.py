import json
import sys
import time
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3000"
OUT_SHOT = "_screenshot_monitor_crash.png"
OUT_CONSOLE = "_monitor_console.json"

def main():
    logs = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 1100})
        page = context.new_page()
        page.on("console", lambda msg: logs.append({"type": msg.type, "text": msg.text}))
        page.on("pageerror", lambda err: logs.append({"type": "pageerror", "text": str(err)}))

        page.goto(URL, wait_until="networkidle", timeout=90000)
        # skip login by setting localStorage and reload
        page.evaluate("""() => {
            localStorage.setItem('orps_user', JSON.stringify({name:'测试用户',role:'admin',isTrial:true}));
        }""")
        page.reload(wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(5000)

        # navigate to monitor
        page.evaluate("() => { if(window.navigateTo) navigateTo('monitor'); else if(window.MONITOR && MONITOR.switch) MONITOR.switch('map'); }")
        page.wait_for_timeout(4000)

        # click emergency guide country select
        try:
            sel = page.locator("#mon-emg-guide select")
            if sel.count():
                sel.select_option("巴基斯坦")
                page.wait_for_timeout(1000)
                logs.append({"type": "action", "text": "selected Pakistan in emergency guide"})
        except Exception as e:
            logs.append({"type": "select_error", "text": str(e)})

        # click a project chip if exists
        try:
            chips = page.locator("#mon-emg-guide span[onclick*='showProjectRisk']")
            if chips.count():
                chips.first.click()
                page.wait_for_timeout(1500)
                logs.append({"type": "action", "text": "clicked project chip"})
                # close modal
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)
        except Exception as e:
            logs.append({"type": "chip_error", "text": str(e)})

        # click map area (project marker approx Pakistan)
        try:
            svg_wrap = page.locator("#mon-map-svg")
            if svg_wrap.count():
                box = svg_wrap.bounding_box()
                if box:
                    page.mouse.click(box["x"] + box["width"] * 0.62, box["y"] + box["height"] * 0.42)
                    page.wait_for_timeout(1500)
                    logs.append({"type": "action", "text": "clicked map area"})
        except Exception as e:
            logs.append({"type": "map_click_error", "text": str(e)})

        page.screenshot(path=OUT_SHOT, full_page=False)
        browser.close()

    with open(OUT_CONSOLE, "w", encoding="utf-8") as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)
    print("done", OUT_SHOT, OUT_CONSOLE)

if __name__ == "__main__":
    main()
