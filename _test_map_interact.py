import json
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:3000"
OUT_SHOT = "_screenshot_map_interact.png"
OUT_CONSOLE = "_map_interact_console.json"

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

        # open monitor
        page.evaluate("() => { if(window.navigateTo) navigateTo('monitor'); }")
        page.wait_for_timeout(3000)

        # click map area (approx Pakistan/India border)
        svg_wrap = page.locator("#mon-map-svg")
        if svg_wrap.count():
            box = svg_wrap.bounding_box()
            if box:
                page.mouse.click(box["x"] + box["width"] * 0.62, box["y"] + box["height"] * 0.42)
                page.wait_for_timeout(1000)
                logs.append({"type": "action", "text": "clicked map area"})

        # switch to countries tab
        page.evaluate("() => { if(window.MONITOR && MONITOR.switch) MONITOR.switch('countries'); }")
        page.wait_for_timeout(1500)

        # switch back to map
        page.evaluate("() => { if(window.MONITOR && MONITOR.switch) MONITOR.switch('map'); }")
        page.wait_for_timeout(2000)

        # click a region button
        reg = page.locator("button#reg-afr")
        if reg.count():
            reg.click()
            page.wait_for_timeout(1500)

        # switch corridors
        page.evaluate("() => { if(window.MONITOR && MONITOR.switch) MONITOR.switch('corridors'); }")
        page.wait_for_timeout(1500)

        # back to map
        page.evaluate("() => { if(window.MONITOR && MONITOR.switch) MONITOR.switch('map'); }")
        page.wait_for_timeout(2000)

        page.screenshot(path=OUT_SHOT, full_page=False)
        browser.close()

    with open(OUT_CONSOLE, "w", encoding="utf-8") as f:
        json.dump(logs[-200:], f, ensure_ascii=False, indent=2)
    print("done", OUT_SHOT, OUT_CONSOLE)

if __name__ == "__main__":
    main()
