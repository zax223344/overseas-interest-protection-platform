# -*- coding: utf-8 -*-
"""公网端到端验证：模拟手机 4G 通过隧道域名真实使用系统"""
import json, time, os
from playwright.sync_api import sync_playwright

PUBLIC = "https://e9b0344d351aab.lhr.life"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4NzI0ODI1NSwiZXhwIjoxNzg3ODUzMDU1fQ.R5ZNjnDtQaQwkuATB8kNbvqjlfNFpjGfTw745xLOsPE"
USER = {"name":"admin","role":"admin","isTrial":False,"expireTime":None}
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def log(m): print(m, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
        user_agent="Mozilla/5.0 (Linux; Android 14; HUAWEI Mate 60) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")
    ctx.add_init_script(f"""
        localStorage.setItem('orps_api_token', {json.dumps(TOKEN)});
        localStorage.setItem('orps_user', {json.dumps(json.dumps(USER))});
    """)
    page = ctx.new_page()
    t0 = time.time()
    page.goto(PUBLIC, wait_until="domcontentloaded", timeout=90000)
    log(f"页面加载耗时: {time.time()-t0:.1f}s")

    # 等 app 显示
    app_ok = False
    for _ in range(40):
        if page.evaluate("() => document.getElementById('app') && document.getElementById('app').style.display !== 'none'"):
            app_ok = True; break
        time.sleep(0.5)
    log(f"APP 主界面渲染: {'OK' if app_ok else 'FAIL'}")

    # API 经公网可达（登录态校验）
    api = page.evaluate("""async () => {
        try{
            var r = await fetch('/api/alerts?pageSize=3', {headers:{'Authorization':'Bearer ' + localStorage.getItem('orps_api_token')}});
            var j = await r.json();
            return {status:r.status, count:(j.alerts||j.data||[]).length};
        }catch(e){ return {error:String(e)}; }
    }""")
    log(f"公网 API 数据: {json.dumps(api, ensure_ascii=False)}")

    # SW 在 HTTPS 公网域名下注册
    time.sleep(3)
    sw = page.evaluate("""async () => {
        if(!('serviceWorker' in navigator)) return {supported:false};
        var reg = await navigator.serviceWorker.getRegistration();
        return {registered: !!reg, active: !!(reg && reg.active)};
    }""")
    log(f"公网 SW 注册: {json.dumps(sw)}")

    page.screenshot(path=os.path.join(OUT_DIR, "_public_mobile.png"), full_page=False)

    # 点一个菜单验证交互
    page.click(".mobile-menu-toggle", timeout=8000)
    time.sleep(0.8)
    page.click(".sb-item[data-view='alerts']", timeout=8000)
    time.sleep(2.5)
    alerts_title = page.evaluate("() => document.getElementById('pageTitle').textContent")
    log(f"导航到预警中心: {alerts_title.strip()}")
    page.screenshot(path=os.path.join(OUT_DIR, "_public_mobile_alerts.png"))
    browser.close()

    ok = app_ok and api.get('status') == 200
    log(f"\nRESULT: {'PASS - 手机4G可用' if ok else 'FAIL'}")
