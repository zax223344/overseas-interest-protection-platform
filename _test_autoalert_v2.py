import sys, traceback
from playwright.sync_api import sync_playwright

USER = 'test_aa_20260826'
PASS = 'Test123456!'
OUT = r'C:\Users\28737\Desktop\新建文件夹\_screenshot_autoalert_v2.png'

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1400, 'height': 900})
        page = context.new_page()
        page.on('console', lambda msg: errors.append(f"[{msg.type}] {msg.text}"))
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))

        page.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=60000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('#sb-autoalert-count', timeout=30000)

        page.click('.sb-item[data-view="autoalert"]')
        page.wait_for_selector('.aa-item', timeout=20000)

        # get first item id and select via JS to avoid DOM detach
        first_id = page.locator('.aa-item').first.get_attribute('onclick')
        print('first onclick:', first_id)
        import re
        m = re.search(r"'([^']+)'", first_id or '')
        if m:
            item_id = m.group(1)
            page.evaluate('(id) => { if(window.AUTOALERT) window.AUTOALERT.select(id); }', item_id)
            page.wait_for_timeout(1000)
        selected = page.query_selector_all('.aa-item.selected')
        print('selected count:', len(selected))
        right = page.query_selector('#aa-right')
        print('right text:', (right.inner_text() if right else 'none').replace('\n', ' | ')[:500])
        page.screenshot(path=OUT, full_page=False)
        browser.close()

    if errors:
        print('--- console errors ---')
        for e in errors[:20]:
            print(e)
    else:
        print('no console errors')

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        traceback.print_exc()
        sys.exit(1)
