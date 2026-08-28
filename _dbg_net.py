# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
USER = 'test_aa_20260826'
PASS = 'Test123456!'
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    reqs = []
    pg.on('request', lambda r: reqs.append(r.url[-40:] + ' ' + r.method) if '/api/anomaly' in r.url or '/api/funnel' in r.url else None)
    pg.on('requestfailed', lambda r: reqs.append('FAILED: ' + r.url[-50:] + ' ' + str(r.failure)) if '/api/anomaly' in r.url or '/api/funnel' in r.url else None)
    resp = []
    pg.on('response', lambda r: resp.append(r.url[-40:] + ' ' + str(r.status)) if '/api/anomaly' in r.url or '/api/funnel' in r.url else None)
    pg.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=60000)
    pg.fill('#li-user', USER)
    pg.fill('#li-pass', PASS)
    pg.click('button:has-text("登 录")')
    pg.wait_for_selector('#app:not([style*="none"])', timeout=30000)
    pg.wait_for_timeout(3000)
    pg.evaluate("navigateTo('anomaly')")
    pg.wait_for_timeout(9000)
    r = pg.evaluate('''() => ({
        meta: (document.getElementById('anomaly-meta')||{textContent:''}).textContent,
        statsLen: ((document.getElementById('anomaly-stats')||{innerText:''}).innerText||'').length
    })''')
    print('ANOMALY state:', r)
    print('REQUESTS:')
    for x in reqs: print(' ', x)
    print('RESPONSES:')
    for x in resp: print(' ', x)
    b.close()
