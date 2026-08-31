# -*- coding: utf-8 -*-
"""截图：修复后初始禁用态 vs 就绪后激活态"""
import json
from playwright.sync_api import sync_playwright

TUNNEL = 'https://belt-shoes-maui-afterwards.trycloudflare.com/'
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.goto(TUNNEL, wait_until='domcontentloaded', timeout=40000)
    # 极早抓拍：DOM 出现 #li-user 立刻截
    page.wait_for_selector('#li-user', timeout=30000)
    page.screenshot(path='_screenshot_login_initial.png')
    # 等 3s 再截一次（应该已激活）
    page.wait_for_timeout(3000)
    state = page.evaluate("""function(){
        return {
            user_disabled: document.getElementById('li-user').disabled,
            pass_disabled: document.getElementById('li-pass').disabled,
            btn_disabled: document.getElementById('btn-login').disabled,
            hint_display: (function(){ var h=document.getElementById('login-hint'); return h ? getComputedStyle(h).display : 'none'; })(),
            auth_ready: typeof AUTH!=='undefined' && !!AUTH._ready
        };
    }""")
    print('就绪后状态:', json.dumps(state, ensure_ascii=False))
    page.screenshot(path='_screenshot_login_ready.png')
    # 最后完整登录一遍
    page.fill('#li-user', 'admin')
    page.fill('#li-pass', 'admin123')
    page.click('#btn-login')
    page.wait_for_timeout(6000)
    final = page.evaluate("function(){ return {url: location.href, auth: typeof AUTH!=='undefined' && !!AUTH.user}; }()")
    print('登录最终:', json.dumps(final, ensure_ascii=False))
    page.screenshot(path='_screenshot_after_login.png')
    b.close()
