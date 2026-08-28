# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    msgs = []
    pg.on('console', lambda m: msgs.append(m.type + ': ' + m.text[:150]))
    pg.on('pageerror', lambda e: msgs.append('PAGEERROR: ' + str(e)[:150]))
    pg.goto('http://127.0.0.1:3000/', wait_until='domcontentloaded', timeout=60000)
    r = pg.evaluate('''async () => {
        var out = {};
        try { var r1 = await fetch('/api/anomaly/signals'); out.anom_status = r1.status; var j = await r1.json(); out.anom_at = j.at; out.anom_len = (j.signals || []).length; } catch (e) { out.anom_err = String(e); }
        try { var r2 = await fetch('/api/funnel/today'); out.fu_status = r2.status; } catch (e) { out.fu_err = String(e); }
        try { var r3 = await fetch('/api/archive/search?limit=5'); out.ar_status = r3.status; } catch (e) { out.ar_err = String(e); }
        return out;
    }''')
    print('FETCH RESULT:', r)
    print('CONSOLE:')
    for m in msgs[:10]:
        print(' ', m)
    b.close()
