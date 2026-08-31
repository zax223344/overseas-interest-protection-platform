# -*- coding: utf-8 -*-
"""#521 端到端：采集漏斗前端可视化验证
验证点：
  1. 态势总览出现「▶ 采集漏斗」行，显示 采集 X → 拒收 Y → 入库 Z（转化率）
  2. 点击展开 11 类拒收分桶（每类带白话注释 title）
  3. 控制台零错误
"""
import json
from playwright.sync_api import sync_playwright

r = {'console_errors': [], 'steps': []}

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
    page.wait_for_timeout(12000)   # 等待 daily-stats 拉取+渲染

    # 采集漏斗行
    funnel_row = page.query_selector('.funnel-row')
    r['funnel_row_visible'] = bool(funnel_row)
    if funnel_row:
        r['funnel_text'] = funnel_row.text_content()[:200].strip()
        r['steps'].append('漏斗行: ' + r['funnel_text'][:120])
        # 点击展开
        try:
            page.click('.funnel-row span')
            page.wait_for_timeout(500)
            detail = page.query_selector('.funnel-detail')
            r['detail_expanded'] = bool(detail) and detail.is_visible()
            if detail:
                buckets = detail.text_content().strip()[:400]
                r['bucket_text'] = buckets
                r['bucket_count'] = len(detail.query_selector_all('span'))
        except Exception as e:
            r['click_err'] = str(e)[:150]

    page.screenshot(path='_test_521_funnel.png', full_page=False)
    r['zero_console_err'] = len(r['console_errors']) == 0
    b.close()

print(json.dumps(r, ensure_ascii=False, indent=2))
