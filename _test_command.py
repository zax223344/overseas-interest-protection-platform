import sys, traceback
from playwright.sync_api import sync_playwright

USER = 'test_aa_20260826'
PASS = 'Test123456!'
OUT = r'C:\Users\28737\Desktop\新建文件夹\_screenshot_command.png'

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
        page.click('.sb-item[data-view="command"]')
        page.wait_for_selector('#view-command .command-center', timeout=20000)
        page.wait_for_timeout(2000)
        page.screenshot(path=OUT, full_page=False)
        print('saved', OUT)
        intake = page.query_selector('.cmd-header')
        if intake:
            print('header:', intake.inner_text().replace('\n', ' | ')[:200])
        browser.close()
    if errors:
        print('--- errors ---')
        for e in errors[:20]: print(e)
    else:
        print('no errors')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
