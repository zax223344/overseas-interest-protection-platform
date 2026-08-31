# -*- coding: utf-8 -*-
"""#520 端到端：态势总览焦点/最新预警面板大池轮播验证
验证点：
  1. 最新预警面板「在监 N 条」为大池（非蓝+24h 口径），页数>3
  2. 焦点面板高价值预警池 60、实时情报流池 50（轮播标记 X/N）
  3. 等待 65s 后面板内容真实轮换（首条标题变化 / 页码 +1）
  4. 控制台零错误
"""
import json, re
from playwright.sync_api import sync_playwright

r = {'console_errors': [], 'steps': []}

def read_alert_header(page):
    txt = (page.text_content('#sit-alerts') or '')
    m = re.search(r'第\s*(\d+)\s*/\s*(\d+)\s*页\s*·\s*在监\s*(\d+)\s*条', txt)
    if m:
        return {'page': int(m.group(1)), 'pages': int(m.group(2)), 'monitor': int(m.group(3))}
    return None

def read_focus_marks(page):
    txt = (page.text_content('#globe-intel-live') or '')
    out = {}
    m = re.search(r'高价值预警\s*·\s*轮播\s*(\d+)\s*/\s*(\d+)', txt)
    if m: out['top'] = (int(m.group(1)), int(m.group(2)))
    m2 = re.search(r'实时情报流\s*·\s*轮播\s*(\d+)\s*/\s*(\d+)', txt)
    if m2: out['live'] = (int(m2.group(1)), int(m2.group(2)))
    return out

def first_row_title(page):
    rows = page.query_selector_all('#sit-alerts .sit-alert-row')
    return rows[0].text_content()[:60] if rows else ''

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.on('console', lambda m: r['console_errors'].append(m.text[:200]) if m.type == 'error' else None)
    page.on('pageerror', lambda e: r['console_errors'].append('pageerror: ' + str(e)[:200]))

    page.goto('http://127.0.0.1:3000', wait_until='domcontentloaded', timeout=30000)
    page.wait_for_selector('#li-user', timeout=30000)
    page.wait_for_timeout(2000)
    page.fill('#li-user', 'admin')
    page.fill('#li-pass', 'admin123')
    page.click('#btn-login')
    page.wait_for_timeout(6000)
    r['login'] = page.evaluate("typeof AUTH!=='undefined' && !!AUTH.user")
    r['steps'].append('login=' + str(r['login']))

    # 默认态势总览视图；等待面板渲染稳定
    page.wait_for_timeout(8000)
    h1 = read_alert_header(page)
    f1 = read_focus_marks(page)
    t1 = first_row_title(page)
    r['before'] = {'header': h1, 'focus': f1, 'first_row': t1}
    r['steps'].append('before=' + json.dumps({'header': h1, 'focus': f1}, ensure_ascii=False))

    # 等待 60s 轮播引擎触发翻页
    page.wait_for_timeout(66000)
    h2 = read_alert_header(page)
    f2 = read_focus_marks(page)
    t2 = first_row_title(page)
    r['after'] = {'header': h2, 'focus': f2, 'first_row': t2}
    r['steps'].append('after=' + json.dumps({'header': h2, 'focus': f2}, ensure_ascii=False))

    # 判定
    r['pool_big'] = bool(h1 and h1['monitor'] >= 40)
    r['pages_gt3'] = bool(h1 and h1['pages'] > 3)
    r['focus_pool'] = f1
    r['rotated'] = (t1 != t2) or (h1 and h2 and h1['page'] != h2['page'])
    r['zero_console_err'] = len(r['console_errors']) == 0

    page.screenshot(path='_test_520_rotation.png', full_page=False)
    b.close()

print(json.dumps(r, ensure_ascii=False, indent=2))
