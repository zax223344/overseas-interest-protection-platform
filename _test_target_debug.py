"""Debug specific Russia/Nepal alerts."""
import sys, traceback
from playwright.sync_api import sync_playwright

BASE_URL = 'http://127.0.0.1:3000'
USER = 'test_aa_20260826'
PASS = 'Test123456!'

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1400, 'height': 900})
        page = context.new_page()
        page.on('console', lambda msg: errors.append(f"[{msg.type}] {msg.text}"))
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))

        page.goto(BASE_URL + '/', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#li-user', timeout=20000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('#sb-autoalert-count', timeout=30000)

        page.goto(BASE_URL + '/#situation', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#sit-alerts', timeout=20000)
        page.wait_for_timeout(3000)

        # Find Russia/Nepal alerts
        items = page.evaluate('''() => {
            if(typeof AVIEW === 'undefined' || !ALERTS) return [];
            var list = ALERTS.filter(a => {
                var t = (a.title_zh || a.title || '') + ' ' + (a.country || '');
                return /俄罗斯|尼泊尔|Russia|Nepal/i.test(t);
            });
            return list.map(a => ({
                title: (a.title_zh || a.title || '').slice(0,100),
                country: a.country,
                key: AVIEW._eventKeyFuzzy(a),
                strict: AVIEW._eventKey(a),
                level: a.level,
                time: a.time
            }));
        }''')
        print('Russia/Nepal alerts:', len(items))
        for it in items:
            print('  c=%s key=%s strict=%s' % (it['country'], it['key'], it['strict'][:40]))
            print('     title=%s' % it['title'][:80])

        browser.close()

    if errors:
        print('--- errors ---')
        for e in errors[:20]: print(e)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
