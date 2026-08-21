# -*- coding: utf-8 -*-
"""PWA 可安装性实测：manifest 解析 + SW 注册 + beforeinstallprompt"""
import json, time, os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def log(m): print(m, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
        user_agent="Mozilla/5.0 (Linux; Android 14; HUAWEI Mate 60) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")
    page = ctx.new_page()

    # 捕获 install prompt 事件
    page.add_init_script("""
        window.__pwaInstallable = false;
        window.addEventListener('beforeinstallprompt', function(e){ window.__pwaInstallable = true; e.preventDefault(); });
    """)
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    time.sleep(6)  # 等 SW 注册 + installability 检查

    # 1) manifest link 与内容
    manifest = page.evaluate("""async () => {
        var link = document.querySelector('link[rel="manifest"]');
        if(!link) return {exists:false};
        try{
            var r = await fetch(link.href);
            var j = await r.json();
            return {exists:true, name:j.name, short_name:j.short_name, display:j.display,
                    start_url:j.start_url, theme:j.theme_color,
                    icons:(j.icons||[]).map(i=>i.sizes+':'+i.purpose)};
        }catch(e){ return {exists:true, parseError:String(e)}; }
    }""")
    log(f"manifest: {json.dumps(manifest, ensure_ascii=False)}")

    # 2) SW 注册状态
    sw = page.evaluate("""async () => {
        if(!('serviceWorker' in navigator)) return {supported:false};
        try{
            var reg = await navigator.serviceWorker.getRegistration();
            if(!reg) return {supported:true, registered:false};
            return {supported:true, registered:true, scope:reg.scope,
                    active: !!(reg.active && reg.active.state === 'activated')};
        }catch(e){ return {supported:true, error:String(e)}; }
    }""")
    log(f"serviceWorker: {json.dumps(sw, ensure_ascii=False)}")

    # 3) installability
    installable = page.evaluate("() => window.__pwaInstallable")
    log(f"beforeinstallprompt 触发(可安装): {installable}")

    # 4) 图标实际可加载
    icons_ok = page.evaluate("""async () => {
        var urls = ['icons/icon-192.png','icons/icon-512.png','icons/icon-512-maskable.png','icons/apple-touch-icon.png'];
        var out = [];
        for(var u of urls){
            try{ var r = await fetch(u); out.push(u + ':' + r.status + ':' + (r.headers.get('content-type')||'')); }
            catch(e){ out.push(u + ':ERR'); }
        }
        return out;
    }""")
    for line in icons_ok: log(f"  icon {line}")

    page.screenshot(path=os.path.join(OUT_DIR, "_pwa_mobile.png"))
    browser.close()

    ok = (manifest.get('exists') and not manifest.get('parseError')
          and manifest.get('display') == 'standalone'
          and sw.get('registered') and sw.get('active'))
    log(f"\nRESULT: {'PASS' if ok else 'FAIL'} (installable={installable})")
