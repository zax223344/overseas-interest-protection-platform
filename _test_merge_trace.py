"""Trace _mergeEvents behavior."""
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

        trace = page.evaluate('''() => {
            var list = ALERTS.filter(a => /尼泊尔|Nepal/i.test(a.country||a.title_zh||a.title||'')).slice(0,6);
            var trace=[];
            var seen={};
            list.forEach(function(a){
                var k=AVIEW._eventKeyFuzzy(a);
                trace.push({
                    title: (a.title_zh||a.title||'').slice(0,40),
                    country: a.country,
                    key: k,
                    seenBefore: !!seen[k],
                    seenKeys: Object.keys(seen).slice()
                });
                if(seen[k]) seen[k]++;
                else seen[k]=1;
            });
            return trace;
        }''')
        for t in trace:
            print(t)

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
