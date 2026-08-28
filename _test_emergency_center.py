import json
import time
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3000"
OUT_SHOT = "_screenshot_emergency_center.png"
OUT_CONSOLE = "_emergency_center_console.json"

def main():
    logs = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 1100})
        page = context.new_page()
        page.on("console", lambda msg: logs.append({"type": msg.type, "text": msg.text}))
        page.on("pageerror", lambda err: logs.append({"type": "pageerror", "text": str(err)}))

        page.goto(URL, wait_until="networkidle", timeout=90000)
        page.evaluate("""() => {
            localStorage.setItem('orps_user', JSON.stringify({name:'测试用户',role:'admin',isTrial:true}));
        }""")
        page.reload(wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(5000)

        page.evaluate("() => { if(window.navigateTo) navigateTo('monitor'); else if(window.MONITOR && MONITOR.switch) MONITOR.switch('map'); }")
        page.wait_for_timeout(4000)

        # scroll to emergency guide
        page.evaluate("() => { var el=document.getElementById('mon-emg-guide'); if(el) el.scrollIntoView({block:'start'}); }")
        page.wait_for_timeout(1000)

        # check if emergency center rendered
        root = page.locator(".emg-root")
        logs.append({"type": "check", "text": "emg-root count: " + str(root.count())})

        # select Pakistan
        sel = page.locator(".emg-country-selector select")
        if sel.count():
            sel.select_option("巴基斯坦")
            page.wait_for_timeout(1000)

        # click a project card
        cards = page.locator(".emg-project-card")
        if cards.count():
            cards.first.click()
            page.wait_for_timeout(1500)

        page.screenshot(path=OUT_SHOT, full_page=True)
        browser.close()

    with open(OUT_CONSOLE, "w", encoding="utf-8") as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)
    print("done", OUT_SHOT, OUT_CONSOLE)

if __name__ == "__main__":
    main()
