"""Debug _eventKeyFuzzy in browser."""
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

        # Check if new function is loaded
        has_main = page.evaluate('typeof AVIEW !== "undefined" && AVIEW._eventKeyFuzzy && AVIEW._eventKeyFuzzy.toString().indexOf("_mainEventCountry") >= 0')
        print('Has _mainEventCountry in _eventKeyFuzzy:', has_main)

        # Get keys for first 8 alerts
        keys = page.evaluate('''() => {
            if(typeof AVIEW === 'undefined' || !ALERTS) return [];
            var list = ALERTS.slice().sort((a,b)=>String(b.time||'').localeCompare(String(a.time||''))).slice(0,10);
            return list.map(a => ({
                title: (a.title_zh || a.title || '').slice(0,80),
                country: a.country,
                key: AVIEW._eventKeyFuzzy(a),
                strict: AVIEW._eventKey(a)
            }));
        }''')
        print('Keys of first 10 alerts:')
        for k in keys:
            print('  country=%s key=%s strict=%s title=%s' % (k['country'], k['key'], k['strict'], k['title'][:60]))

        # Check merge result
        merged = page.evaluate('''() => {
            if(typeof AVIEW === 'undefined' || !ALERTS) return 0;
            var list = ALERTS.slice().sort((a,b)=>String(b.time||'').localeCompare(String(a.time||'')));
            var merged = AVIEW._mergeEvents(list, 'fuzzy');
            return {before: list.length, after: merged.length};
        }''')
        print('Merge result:', merged)

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
