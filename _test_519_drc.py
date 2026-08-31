# -*- coding: utf-8 -*-
"""#519 端到端：threatroom 搜「刚果(金)」验证引擎语义修复"""
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
    page.wait_for_timeout(5000)

    # 进入 threatroom
    page.click('.sb-item[data-view="threatroom"]')
    page.wait_for_timeout(1500)
    # 填入刚果（金）
    page.fill('#tr-q', '刚果（金）')
    page.click('#tr-go')
    r['steps'].append('已提交检索: 刚果（金）')

    # 等 collect 完成（最多 6 分钟）——报告渲染（tr-rep 默认 display:none，用 attached 判定）
    page.wait_for_selector('#tr-rep .card', state='attached', timeout=360000)
    page.wait_for_timeout(4000)
    stage_txt = (page.text_content('#tr-stage') or '').strip()[:150]
    r['steps'].append('阶段条: ' + stage_txt)

    # 头卡 KPI 文本
    head = page.text_content('#tr-rep')
    r['kpi_fresh'] = '本轮全网命中' in (head or '')
    # 判研文字不再出现误导文案
    r['no_vacuum_text'] = ('信息真空' not in (head or '')) and ('监测盲区' not in (head or ''))
    # fresh 徽标存在
    r['web_badge_count'] = page.locator('#tr-rep .tr-web-badge').count() if page.locator('.tr-web-badge').count() else 0
    # 情报流条目数
    r['feed_items'] = page.locator('#tr-rep .tr-item').count()
    page.screenshot(path='_screenshot_519_drc.png')
    b.close()
print(json.dumps(r, ensure_ascii=False, indent=1))
