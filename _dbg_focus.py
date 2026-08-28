# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
USER = 'test_aa_20260826'
PASS = 'Test123456!'
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    msgs = []
    pg.on('console', lambda m: msgs.append(m.type + ': ' + m.text[:180]))
    pg.on('pageerror', lambda e: msgs.append('PAGEERROR: ' + str(e)[:180]))
    pg.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=60000)
    pg.fill('#li-user', USER)
    pg.fill('#li-pass', PASS)
    pg.click('button:has-text("登 录")')
    pg.wait_for_selector('#app:not([style*="none"])', timeout=30000)
    pg.wait_for_timeout(3000)
    pg.evaluate("navigateTo('anomaly')")
    pg.wait_for_timeout(12000)
    r = pg.evaluate('''() => ({
        meta: (document.getElementById('anomaly-meta')||{textContent:''}).textContent,
        stats: ((document.getElementById('anomaly-stats')||{innerText:''}).innerText||'').replace(/\\s+/g,' ').slice(0,120),
        list: ((document.getElementById('anomaly-list')||{innerText:''}).innerText||'').slice(0,150),
        dataAt: (window.ANOMALY_VIEW && ANOMALY_VIEW._data) ? ANOMALY_VIEW._data.at : null
    })''')
    print('ANOMALY(12s):', r)
    pg.screenshot(path=r'C:\\Users\\28737\\Desktop\\新建文件夹\\_shot_srv3_anomaly2.png')
    pg.evaluate("navigateTo('funnel')")
    pg.wait_for_timeout(12000)
    r = pg.evaluate('''() => ({
        meta: (document.getElementById('funnel-meta')||{textContent:''}).textContent,
        stages: Array.from(document.querySelectorAll('#funnel-stages > div')).length,
        dataOk: !!(window.FUNNEL_VIEW && FUNNEL_VIEW._data)
    })''')
    print('FUNNEL(12s):', r)
    print('CONSOLE (最后15条):')
    for m in msgs[-15:]:
        print(' ', m)
    b.close()
