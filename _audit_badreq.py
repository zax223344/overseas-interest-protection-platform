# -*- coding: utf-8 -*-
"""定位 500/404 来源接口"""
import json, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/index.html"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4NzI0ODI1NSwiZXhwIjoxNzg3ODUzMDU1fQ.R5ZNjnDtQaQwkuATB8kNbvqjlfNFpjGfTw745xLOsPE"
USER = {"name":"admin","role":"admin","isTrial":False,"expireTime":None}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width":1440,"height":900})
    ctx.add_init_script(f"""
        localStorage.setItem('orps_api_token', {json.dumps(TOKEN)});
        localStorage.setItem('orps_user', {json.dumps(json.dumps(USER))});
    """)
    page = ctx.new_page()
    bad = []
    page.on("response", lambda r: bad.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    for _ in range(40):
        if page.evaluate("() => document.getElementById('app') && document.getElementById('app').style.display !== 'none'"):
            break
        time.sleep(0.5)
    time.sleep(6)
    for v in ["monitor","alerts","autoalert","analysis","datacenter","forecast","aireport","intel","command"]:
        page.evaluate(f"() => navigateTo('{v}')")
        time.sleep(1.5)
    print("坏请求:")
    for b in dict.fromkeys(bad):
        print(" ", b)
    browser.close()
