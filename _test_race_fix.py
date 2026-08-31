# -*- coding: utf-8 -*-
"""竞态回归：刚加载立即点登录按钮不应再报 AUTH 未定义"""
import json
from playwright.sync_api import sync_playwright

TUNNEL = 'https://belt-shoes-maui-afterwards.trycloudflare.com/'
results = []
for delay in [0, 100, 500, 1500]:
    r = {'delay_ms': delay, 'pageerrors': [], 'login_ok': False, 'auth_ready_initial': None}
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: r['pageerrors'].append(str(e)[:200]))
        page.on('console', lambda m: r['pageerrors'].append('console.' + m.type + ': ' + m.text[:200]) if m.type == 'error' else None)
        page.goto(TUNNEL, wait_until='domcontentloaded', timeout=40000)
        page.wait_for_selector('#li-user', timeout=30000)
        # 检查初始禁用态
        r['user_disabled'] = page.locator('#li-user').is_disabled()
        r['btn_disabled'] = page.locator('#btn-login').is_disabled()
        page.wait_for_timeout(delay)
        # 强制点登录按钮（绕过 disabled 用 force=True 模拟竞态）
        page.locator('#li-user').fill('admin', force=True)
        page.locator('#li-pass').fill('admin123', force=True)
        try:
            page.locator('#btn-login').click(force=True, timeout=2000)
        except Exception as e:
            r['pageerrors'].append('click failed: ' + str(e)[:100])
        page.wait_for_timeout(5000)
        try:
            r['login_ok'] = page.evaluate("function(){ return typeof AUTH!=='undefined' && !!AUTH.user; }()")
            r['final_url'] = page.url
        except: pass
        b.close()
    results.append(r)
print(json.dumps(results, ensure_ascii=False, indent=1))
