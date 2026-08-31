# -*- coding: utf-8 -*-
"""最终验证：公网引导页→隧道→登录→进入系统（修正判定：AUTH 是 const 不挂 window）"""
import json
from playwright.sync_api import sync_playwright

GUIDE = 'https://zax223344.github.io/overseas-interest-protection-platform/'
r = {'console_errors': [], 'steps': []}

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.on('console', lambda m: r['console_errors'].append(m.text[:200]) if m.type == 'error' else None)
    page.on('pageerror', lambda e: r['console_errors'].append('pageerror: ' + str(e)[:200]))

    # 1. 引导页
    page.goto(GUIDE, wait_until='domcontentloaded', timeout=40000)
    page.wait_for_timeout(2000)
    try:
        page.wait_for_url(lambda u: 'trycloudflare.com' in u, timeout=20000)
        r['steps'].append('引导页自动跳转到: ' + page.url)
    except Exception as e:
        r['steps'].append('自动跳转超时，手动点击进入按钮')
        try:
            page.click('#enterBtn', timeout=3000)
            page.wait_for_url(lambda u: 'trycloudflare.com' in u, timeout=20000)
            r['steps'].append('手动跳转到: ' + page.url)
        except Exception as e2:
            r['steps'].append('手动跳转也失败: ' + str(e2)[:100])

    # 2. 登录页 → 登录
    page.wait_for_selector('#li-user', timeout=30000)
    page.wait_for_timeout(2000)
    page.fill('#li-user', 'admin')
    page.fill('#li-pass', 'admin123')
    page.click('button.auth-btn')
    page.wait_for_timeout(8000)

    # 3. 正确判定：AUTH 是 const，直接引用而非 window.AUTH
    check = page.evaluate("""function(){
        var out = {};
        try { out.authDefined = (typeof AUTH !== 'undefined'); } catch(e){ out.authDefined = 'err'; }
        try { out.authUser = (typeof AUTH !== 'undefined' && !!AUTH.user) ? (AUTH.user.name + '/' + AUTH.user.role) : null; } catch(e){ out.authUser = 'err:' + e.message; }
        var app = document.getElementById('app');
        out.appVisible = app ? (getComputedStyle(app).display !== 'none') : false;
        out.authCardVisible = (function(){ var c = document.getElementById('auth-card-login'); return c ? (getComputedStyle(c).display !== 'none' && c.offsetParent !== null) : 'not_found'; })();
        out.sbItems = document.querySelectorAll('.sb-item').length;
        out.viewTitle = (document.querySelector('.sb-item.active') || {}).textContent || '';
        return out;
    }""")
    r['login_result'] = check
    page.screenshot(path='_screenshot_guide_final.png')
    b.close()

print(json.dumps(r, ensure_ascii=False, indent=1))
