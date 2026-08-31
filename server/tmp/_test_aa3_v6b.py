# -*- coding: utf-8 -*-
"""ORPS 智能联动预警 v6 推理链引擎真机复验（token 注入 + 真实点击）"""
import sys, time, io, json, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3000'
OUT = r'C:\Users\28737\Desktop\新建文件夹\server\logs\_aa3_v6_verify.png'
TOKEN = json.loads(urllib.request.urlopen(urllib.request.Request(
    BASE + '/api/auth/trial', data=json.dumps({'username': 'test_aa_v6_0830', 'password': 'Test123456x', 'days': 7}).encode(),
    headers={'Content-Type': 'application/json'})).read())['token'] if False else 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5IiwidXNlcm5hbWUiOiJ0ZXN0X2FhX3Y2XzA4MzAiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4ODA4MjEwOSwiZXhwIjoxNzg4Njg2OTA5fQ.cQGd-CplrHl8TX5mFnV9ZrdXLojJYaPHZEv5uJmYPjk'
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1600, 'height': 950})
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)

    # token 注入
    pg.goto(BASE, wait_until='domcontentloaded')
    pg.evaluate("t => localStorage.setItem('orps_api_token', t)", TOKEN)
    pg.reload(wait_until='load')
    time.sleep(5)
    app_on = pg.evaluate("getComputedStyle(document.getElementById('app')).display")
    print('[0] 登录态 #app display=%s %s' % (app_on, 'OK' if app_on != 'none' else 'FAIL-未登录'))

    pg.evaluate("navigateTo('autoalert')")
    time.sleep(3)

    # 1) 结构完整性
    concl = pg.locator('.aa3-conclusion').count()
    steps = pg.locator('.aa3-chain .aa3-step').count()
    rows = pg.locator('.aa3-row').count()
    sel_rows = pg.locator('.aa3-row.selected').count()
    momentum_left = pg.locator('.aa3-row-meta:has-text("动量")').count()
    view_rect = pg.evaluate("var r=document.getElementById('view-autoalert').getBoundingClientRect(); Math.round(r.width)+'x'+Math.round(r.height)")
    print('[1] 结论卡=%d 推理链步骤=%d 行=%d 默认选中=%d 动量残留=%d 视图尺寸=%s' % (concl, steps, rows, sel_rows, momentum_left, view_rect))
    if steps:
        labels = pg.evaluate("Array.from(document.querySelectorAll('.aa3-chain .aa3-step-label')).map(n=>n.textContent)")
        print('    五段: ' + ' / '.join(labels))

    # 2) 真实点击第2行
    if rows >= 2:
        before = pg.locator('.aa3-detail-title').inner_text()[:24] if pg.locator('.aa3-detail-title').count() else ''
        pg.locator('.aa3-row').nth(1).click()
        time.sleep(0.8)
        after = pg.locator('.aa3-detail-title').inner_text()[:24] if pg.locator('.aa3-detail-title').count() else ''
        mains = pg.locator('.aa3-main').count()
        print('[2] 真实点击第2行: [%s]->[%s] 面板数=%d %s' % (before, after, mains, 'OK' if mains == 1 and after else 'FAIL'))
        pg.screenshot(path=OUT)

    # 3) 证据链行点击 → 弹窗
    ev = pg.locator('.aa3-related').count()
    if ev:
        pg.locator('.aa3-related').first.click()
        time.sleep(1)
        modal_open = pg.evaluate("!!document.getElementById('modal') && document.getElementById('modal').classList.contains('show')")
        print('[3] 证据行点击弹窗=%s' % modal_open)
        pg.evaluate("document.getElementById('modal').classList.remove('show')")
        time.sleep(0.5)

    # 4) SOAR 预案 checklist
    pb = pg.locator('.aa3-playbook').count()
    if pb:
        pg.locator('.aa3-playbook').first.click()
        time.sleep(0.8)
        pb_open = pg.evaluate("!!document.getElementById('modal') && document.getElementById('modal').classList.contains('show')")
        pb_items = pg.locator('.aa3-pb-item').count()
        if pb_items:
            pg.locator('.aa3-pb-item').first.click()
            time.sleep(0.5)
            checked = pg.evaluate("Array.from(document.querySelectorAll('#aa3-pb-list .aa3-pb-item')).filter(n=>n.classList.contains('on')).length")
        else:
            checked = -1
        print('[4] 预案模态=%s 条目=%d 勾选生效=%d' % (pb_open, pb_items, checked))
        pg.evaluate("document.getElementById('modal').classList.remove('show')")

    # 5) 筛选 chips 真实点击
    n0 = pg.locator('.aa3-row').count()
    pg.locator('.aa3-chip').first.click()
    time.sleep(0.6)
    n1 = pg.locator('.aa3-row').count()
    print('[5] 筛选点击: 行数 %d->%d %s' % (n0, n1, 'OK' if n1 <= n0 else 'FAIL'))

    # 6) 65s 节流稳定性：标题应保持不变（无无谓重建）
    marker = pg.evaluate("(function(){var r=document.querySelector('.aa3-detail-title');return r?r.textContent.slice(0,40):''})()")
    time.sleep(65)
    marker2 = pg.evaluate("(function(){var r=document.querySelector('.aa3-detail-title');return r?r.textContent.slice(0,40):''})()")
    print('[6] 65s 后详情稳定=%s' % ('OK' if marker == marker2 else 'CHANGED[%s]->[%s]' % (marker[:20], marker2[:20])))

    print('\n[控制台错误] %d 条' % len(errors))
    for e in errors[:8]:
        print('  ' + e[:170])
    b.close()
print('DONE')
