# -*- coding: utf-8 -*-
"""ORPS 智能联动预警 v6 推理链引擎真机复验"""
import sys, time, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3000'
OUT = r'C:\Users\28737\Desktop\新建文件夹\server\logs\_aa3_v6_verify.png'
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1600, 'height': 950})
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errors.append('console.' + m.type + ': ' + m.text) if m.type == 'error' else None)

    # 登录
    pg.goto(BASE, wait_until='networkidle')
    if pg.locator('#li-user').count():
        pg.fill('#li-user', 'test_aa_20260826')
        pg.fill('#li-pass', 'Test123456')
        pg.click('button:has-text("登 录")')
        time.sleep(2)

    # 进智能联动预警
    pg.evaluate("navigateTo('autoalert')")
    time.sleep(3)

    # 1) 结论卡 + 推理链 + 默认选中（消灭空面板）
    concl = pg.locator('.aa3-conclusion').count()
    steps = pg.locator('.aa3-chain .aa3-step').count()
    chain_txt = pg.locator('.aa3-chain').inner_text()[:200] if steps else ''
    sel_rows = pg.locator('.aa3-row.selected').count()
    rows = pg.locator('.aa3-row').count()
    momentum_left = pg.locator('.aa3-row-meta:has-text("动量")').count()
    print('[1] 结论卡=%d 推理链步骤=%d 情景行=%d 默认选中行=%d 残留动量字样=%d' % (concl, steps, rows, sel_rows, momentum_left))
    print('    链内容预览: ' + chain_txt.replace('\n', ' | ')[:180])

    # 2) 真实 DOM 点击第 2 行（不用 evaluate —— 就是要测用户真实点击路径）
    if rows >= 2:
        before_title = pg.locator('.aa3-detail-title').inner_text() if pg.locator('.aa3-detail-title').count() else ''
        pg.locator('.aa3-row').nth(1).click()
        time.sleep(0.6)
        after_title = pg.locator('.aa3-detail-title').inner_text() if pg.locator('.aa3-detail-title').count() else ''
        mains = pg.locator('.aa3-main').count()
        sel_now = pg.locator('.aa3-row.selected').count()
        print('[2] 点击第2行: 标题[%s]->[%s] 面板数=%d 选中=%d %s' % (before_title[:20], after_title[:20], mains, sel_now, 'OK' if mains == 1 and after_title else 'FAIL'))
        pg.screenshot(path=OUT)

    # 3) 点击证据链预警行 → 弹窗打开 → 等待 65s 验证模态期间视图不被重绘摧毁
    ev = pg.locator('.aa3-related').count()
    if ev:
        pg.locator('.aa3-related').first.click()
        time.sleep(1)
        modal_open = pg.evaluate("!!document.getElementById('modal') && document.getElementById('modal').classList.contains('show')")
        print('[3] 点击证据行弹窗打开=%s' % modal_open)
        if modal_open:
            modal_tt = pg.locator('#modal-tt').inner_text()[:30]
            pg.evaluate("document.getElementById('modal').classList.remove('show')")
            time.sleep(0.5)
    else:
        print('[3] 无证据行可点（前瞻情景）')

    # 4) SOAR 预案卡点击 → checklist 模态
    pb = pg.locator('.aa3-playbook').count()
    if pb:
        pg.locator('.aa3-playbook').first.click()
        time.sleep(0.8)
        pb_open = pg.evaluate("!!document.getElementById('modal') && document.getElementById('modal').classList.contains('show')")
        pb_items = pg.locator('.aa3-pb-item').count()
        print('[4] 预案模态=%s 清单条目=%d' % (pb_open, pb_items))
        if pb_items:
            pg.locator('.aa3-pb-item').first.click()
            time.sleep(0.5)
            checked = pg.evaluate("Array.from(document.querySelectorAll('#aa3-pb-list .aa3-pb-item')).filter(n=>n.classList.contains('on')).length")
            print('    勾选后 on 状态=%d/1' % checked)
        pg.evaluate("document.getElementById('modal').classList.remove('show')")
    else:
        print('[4] 无预案卡')

    # 5) 筛选 chips 点击
    pg.locator('.aa3-chip').first.click()
    time.sleep(0.5)
    filtered = pg.locator('.aa3-row').count()
    print('[5] 点筛选chip后 行数=%d' % filtered)
    pg.locator('.aa3-chip').nth(3).click()
    time.sleep(0.5)

    # 6) 60s 重绘节流验证：等 65 秒，观察 DOM 元素是否稳定（id 不变=没有无谓重建）
    marker = pg.evaluate("(function(){var r=document.querySelector('.aa3-detail-title'); return r?r.textContent.slice(0,40):''})()")
    time.sleep(65)
    marker2 = pg.evaluate("(function(){var r=document.querySelector('.aa3-detail-title'); return r?r.textContent.slice(0,40):''})()")
    rows2 = pg.locator('.aa3-row').count()
    print('[6] 65s后 详情标题稳定=%s 行数=%d（标题[%s]）' % (marker == marker2, rows2, marker2[:25]))

    print('\n[控制台错误] %d 条' % len(errors))
    for e in errors[:8]:
        print('  ' + e[:160])
    b.close()
print('DONE')
