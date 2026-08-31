# -*- coding: utf-8 -*-
"""验证竞态：刚加载就点 vs 等 2s 再点"""
import json
from playwright.sync_api import sync_playwright

GUIDE = 'https://zax223344.github.io/overseas-interest-protection-platform/'
TUNNEL = 'https://belt-shoes-maui-afterwards.trycloudflare.com/'

def test(label, click_after_ms):
    r = {'label': label, 'pageerrors': [], 'result': ''}
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
        page = ctx.new_page()
        page.on('pageerror', lambda e: r['pageerrors'].append(str(e)[:200]))
        page.goto(TUNNEL, wait_until='domcontentloaded', timeout=40000)
        page.wait_for_selector('#li-user', timeout=30000)
        # 关键：等不等
        if click_after_ms > 0:
            page.wait_for_timeout(click_after_ms)
        auth_defined = page.evaluate("function(){ try { return typeof AUTH !== 'undefined'; } catch(e){ return false; } }()")
        r['auth_defined_before_click'] = auth_defined
        if auth_defined:
            page.fill('#li-user', 'admin')
            page.fill('#li-pass', 'admin123')
            page.click('button.auth-btn')
            page.wait_for_timeout(4000)
            r['auth_user'] = page.evaluate("function(){ try { return !!(window.AUTH && window.AUTH.user); } catch(e){ return false; } }()")
            r['url_after'] = page.url
        b.close()
    return r

results = [
    test('立即点(0ms)', 0),
    test('等2s再点', 2000),
    test('等5s再点', 5000),
]
print(json.dumps(results, ensure_ascii=False, indent=1))
