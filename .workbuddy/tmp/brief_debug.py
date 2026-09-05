# -*- coding: utf-8 -*-
# brief 视图数据装配诊断：console + network
import re, sys, os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
CHARS = 'ABCDEGHJKMPSTUX4789'
FONT = {
 'A':['01110','10001','10001','11111','10001','10001','10001'],'B':['11110','10001','10001','11110','10001','10001','11110'],
 'C':['01110','10001','10000','10000','10000','10001','01110'],'D':['11110','10001','10001','10001','10001','10001','11110'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],'G':['01110','10001','10000','10111','10001','10001','01111'],
 'H':['10001','10001','10001','11111','10001','10001','10001'],'J':['00111','00010','00010','00010','00010','10010','01100'],
 'K':['10001','10010','10100','11000','10100','10010','10001'],'M':['10001','11011','10101','10101','10001','10001','10001'],
 'P':['11110','10001','10001','11110','10000','10000','10000'],'S':['01111','10000','10000','01110','00001','00001','11110'],
 'T':['11111','00100','00100','00100','00100','00100','00100'],'U':['10001','10001','10001','10001','10001','10001','01110'],
 'X':['10001','10001','01010','00100','01010','10001','10001'],'4':['00010','00110','01010','10010','11111','00010','00010'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
}
PX = 3; Y_BASE = 22 - 21/2.0 + 1.5
def solve_group(rot, cx, cy, rects):
    pts = [(x+1.5, y+1.5) for x, y in rects]
    min_x = min(p[0] for p in pts)
    grid = set()
    for ox, oy in pts:
        grid.add((int(round((ox-min_x)/PX)), int(round((oy-Y_BASE)/PX))))
    best = (None, -10**9)
    for ch in CHARS:
        fset = set((c, r) for r in range(7) for c in range(5) if FONT[ch][r][c]=='1')
        for dc in (-2,-1,0,1,2):
            for dr in (-2,-1,0,1,2):
                moved = set((c+dc, r+dr) for c, r in fset)
                score = len(grid & moved)*2 - len(grid-moved) - len(moved-grid)
                if score > best[1]: best = (ch, score)
    return best[0]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width":1600,"height":1000})
    page = ctx.new_page()
    page.on("console", lambda m: print("[CONSOLE-%s]" % m.type, m.text[:200]))
    page.on("pageerror", lambda e: print("[PAGEERR]", str(e)[:200]))
    page.on("requestfailed", lambda r: print("[REQFAIL]", r.url[:120], str(r.failure)[:100]))
    page.on("response", lambda r: print("[RESP %d]" % r.status, r.url[:120]) if '/api/insight' in r.url else None)

    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("#li-captcha-img svg", timeout=45000)
    page.wait_for_timeout(500)
    svg = page.evaluate("() => document.querySelector('#li-captcha-img svg').outerHTML")
    groups = re.findall(r'<g transform="rotate\((-?[\d.]+) ([\d.]+) ([\d.]+)\)"[^>]*>(.*?)</g>', svg, re.S)
    text = ""
    for rot, cx, cy, cells in groups:
        rects = [(float(x), float(y)) for x, y in re.findall(r'<rect x="([\d.]+)" y="([\d.]+)"', cells)]
        text += solve_group(float(rot), float(cx), float(cy), rects)
    if len(text) != 4:
        print("CAPTCHA FAIL:", text); browser.close(); sys.exit(2)
    page.fill("#li-user", "admin"); page.fill("#li-pass", "admin123"); page.fill("#li-captcha", text)
    page.click("#btn-login"); page.wait_for_timeout(6000)
    print("AUTH:", page.evaluate("() => !!AUTH.user"))

    page.evaluate("navigateTo('brief')")
    for i in range(6):
        page.wait_for_timeout(5000)
        st = page.evaluate("(() => ({ loading: LEADERBRIEF._loading, data: !!LEADERBRIEF._data, body: (document.getElementById('lb-body')||{}).textContent || '' }))()")
        print("T+%ds:" % ((i+1)*5), str(st)[:160])
        if st.get("data"): break
    state = page.evaluate("""(() => ({
        hasLB: typeof LEADERBRIEF !== 'undefined',
        hasINS: typeof INSIGHT !== 'undefined',
        loading: LEADERBRIEF._loading,
        data: LEADERBRIEF._data ? { ok: LEADERBRIEF._data.ok, n: (LEADERBRIEF._data.top||[]).length } : null,
        bodyTxt: (document.getElementById('lb-body')||{}).textContent || '(no lb-body)',
        rootHtml: (document.getElementById('brief-root')||{}).innerHTML ? 'HAS_HTML len=' + document.getElementById('brief-root').innerHTML.length : 'EMPTY'
    }))()""")
    print("STATE:", state)
    # 直接在页面里 fetch
    direct = page.evaluate("""(() => fetch('/api/insight/leader-brief').then(r => r.text()).then(t => t.slice(0, 150)))()""")
    print("DIRECT FETCH:", direct)
    browser.close()
