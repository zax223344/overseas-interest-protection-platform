# -*- coding: utf-8 -*-
"""重建后全视图走查：17 视图逐个导航 + 截图 + console 错误收集"""
import json, time, os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/index.html"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4NzI0ODI1NSwiZXhwIjoxNzg3ODUzMDU1fQ.R5ZNjnDtQaQwkuATB8kNbvqjlfNFpjGfTw745xLOsPE"
USER = {"name":"admin","role":"admin","isTrial":False,"expireTime":None}
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_audit")
os.makedirs(OUT_DIR, exist_ok=True)

VIEWS = ["situation","command","monitor","threatorgs","intel","assets","alerts","autoalert",
         "matrix","forecast","analysis","aireport","explain","datasources","datacenter","settings","role"]

def log(m): print(m, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width":1440,"height":900})
    ctx.add_init_script(f"""
        localStorage.setItem('orps_api_token', {json.dumps(TOKEN)});
        localStorage.setItem('orps_user', {json.dumps(json.dumps(USER))});
    """)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))

    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    app_ok = False
    for _ in range(60):
        if page.evaluate("() => document.getElementById('app') && document.getElementById('app').style.display !== 'none'"):
            app_ok = True; break
        time.sleep(0.5)
    log(f"APP 渲染: {'OK' if app_ok else 'FAIL'}")
    time.sleep(4)  # 等初始数据

    for v in VIEWS:
        try:
            page.evaluate(f"() => navigateTo('{v}')")
            time.sleep(2.2)
            visible = page.evaluate(f"() => {{var el=document.getElementById('view-{v}'); return el && el.classList.contains('active');}}")
            # 内容非空判断（空壳视图由 JS 渲染，应已有子节点）
            kids = page.evaluate(f"() => {{var el=document.getElementById('view-{v}'); return el ? el.innerHTML.length : 0;}}")
            page.screenshot(path=os.path.join(OUT_DIR, f"v_{v}.png"), full_page=False)
            log(f"  [{v:12s}] active={visible} 内容量={kids}")
        except Exception as e:
            log(f"  [{v:12s}] 异常: {e}")

    log(f"\nConsole 错误共 {len(errors)} 条（去重后前 15 条）:")
    seen = set()
    for e in errors:
        k = e[:120]
        if k in seen: continue
        seen.add(k)
        log("  ERR: " + e[:300])
        if len(seen) >= 15: break
    browser.close()
