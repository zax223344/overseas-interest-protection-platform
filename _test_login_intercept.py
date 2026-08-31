# -*- coding: utf-8 -*-
"""拦截登录 API 请求看实际行为"""
import json
from playwright.sync_api import sync_playwright

TUNNEL = 'https://belt-shoes-maui-afterwards.trycloudflare.com/'
r = {'api_calls': [], 'console': []}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.on('console', lambda m: r['console'].append(m.type + ': ' + m.text[:200]) if m.type in ('error','warning') else None)
    page.on('pageerror', lambda e: r['console'].append('pageerror: ' + str(e)[:200]))
    page.on('request', lambda req: r['api_calls'].append(f'REQ {req.method} {req.url[:150]}') if '/api/' in req.url else None)
    page.on('response', lambda res: r['api_calls'].append(f'RES {res.status} {res.url[:150]}') if '/api/' in res.url else None)

    page.goto(TUNNEL, wait_until='domcontentloaded', timeout=40000)
    page.wait_for_selector('#li-user', timeout=30000)
    page.wait_for_timeout(3000)
    page.fill('#li-user', 'admin')
    page.fill('#li-pass', 'admin123')
    page.click('button.auth-btn')
    page.wait_for_timeout(8000)
    r['final_url'] = page.url
    r['auth_user'] = page.evaluate("function(){ try { return !!(window.AUTH && window.AUTH.user); } catch(e){ return 'err:'+e.message; } }()")
    b.close()
print(json.dumps(r, ensure_ascii=False, indent=1)[:6000])
