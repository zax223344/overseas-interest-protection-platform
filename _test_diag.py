# -*- coding: utf-8 -*-
"""深度诊断：AUTH 未定义根因——捕获所有 console + 网络失败"""
import json
from playwright.sync_api import sync_playwright

GUIDE = 'https://zax223344.github.io/overseas-interest-protection-platform/'
r = {'console': [], 'pageerrors': [], 'net_failed': []}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.on('console', lambda m: r['console'].append(m.type + ': ' + m.text[:300]))
    page.on('pageerror', lambda e: r['pageerrors'].append(str(e)[:300]))
    page.on('requestfailed', lambda req: r['net_failed'].append(req.url + ' -- ' + (req.failure or '')))
    page.on('response', lambda res: r['net_failed'].append(f'HTTP {res.status} {res.url[:120]}') if res.status >= 400 else None)

    page.goto(GUIDE, wait_until='domcontentloaded', timeout=40000)
    page.wait_for_timeout(2000)
    try:
        page.wait_for_url(lambda u: 'trycloudflare.com' in u, timeout=20000)
    except: pass
    page.wait_for_selector('#li-user', timeout=30000)
    page.wait_for_timeout(2000)

    # 触发点击前先看 AUTH 是否已经定义
    before = page.evaluate("function(){ try { return {hasAuth: typeof window.AUTH !== 'undefined', hasAuthGlobal: typeof AUTH !== 'undefined'}; } catch(e){ return {err: e.message}; } }()")
    r['before_click'] = before

    # 检查 app.js 加载状态
    appjs = page.evaluate("function(){ var s=document.querySelector('script[src*=\"app.js\"]'); return s ? s.src : 'NOT_FOUND'; }()")
    r['appjs_src'] = appjs

    # 抓所有 script 标签的 src
    scripts = page.evaluate("function(){ return Array.from(document.querySelectorAll('script[src]')).map(s => s.src); }()")
    r['scripts_loaded'] = scripts

    page.fill('#li-user', 'admin')
    page.fill('#li-pass', 'admin123')
    page.click('button.auth-btn')
    page.wait_for_timeout(5000)
    b.close()

print(json.dumps(r, ensure_ascii=False, indent=1)[:8000])
