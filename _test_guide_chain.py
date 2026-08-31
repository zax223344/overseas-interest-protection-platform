# -*- coding: utf-8 -*-
"""公网引导页→隧道→登录 完整链路（修正：等 SPA 渲染、精确选择器）"""
import json
from playwright.sync_api import sync_playwright

GUIDE = 'https://zax223344.github.io/overseas-interest-protection-platform/'
USER = 'admin'
PASS = 'admin123'

r = {'console_errors': [], 'steps': []}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.on('console', lambda m: r['console_errors'].append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: r['console_errors'].append('pageerror: ' + str(e)))

    # 1. 打开引导页
    page.goto(GUIDE, wait_until='domcontentloaded', timeout=40000)
    page.wait_for_timeout(2500)
    r['steps'].append('引导页状态: ' + (page.text_content('#statusText') or '').strip())
    r['steps'].append('引导页地址框: ' + (page.text_content('#urlBox') or '').strip())

    # 2. 等跳转（用 starts-with 匹配，不依赖路径）
    try:
        page.wait_for_url(lambda u: 'trycloudflare.com' in u, timeout=20000)
        r['steps'].append('跳转后 URL: ' + page.url)
    except Exception as e:
        r['steps'].append('跳转失败: ' + str(e)[:120])

    # 3. 等系统 SPA 渲染登录卡片（最长 30s）
    page.wait_for_selector('#li-user', timeout=30000)
    page.wait_for_selector('#li-pass', timeout=5000)
    page.wait_for_selector('button.auth-btn', timeout=5000)
    r['steps'].append('登录卡片已渲染: #li-user 已就位')
    page.screenshot(path='_screenshot_guide_landing.png')

    # 4. 执行登录
    page.fill('#li-user', USER)
    page.fill('#li-pass', PASS)
    page.click('button.auth-btn')
    page.wait_for_timeout(6000)
    page.screenshot(path='_screenshot_guide_chain.png')

    # 5. 登录后判定
    auth_user = page.evaluate("function(){ try { return !!(window.AUTH && window.AUTH.user); } catch(e){ return false; } }")
    app_vis = page.evaluate("function(){ var a=document.getElementById('app'); if(!a) return false; var s=getComputedStyle(a); return s.display!=='none' && s.visibility!=='hidden'; }()")
    sb_count = page.locator('.sb-item').count()
    r['steps'].append('AUTH.user 存在: ' + str(auth_user))
    r['steps'].append('#app 可见: ' + str(app_vis))
    r['steps'].append('侧边栏菜单项: ' + str(sb_count))
    r['steps'].append('登录后 URL: ' + page.url)

    b.close()
print(json.dumps(r, ensure_ascii=False, indent=1))
