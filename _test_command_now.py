import sys, os, time
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:3000'
CREDS = {'username': 'test_aa_20260826', 'password': 'Test123456!'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_screenshot_command_now.png')

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1600, 'height': 1000})
        page = context.new_page()
        page.goto(URL, wait_until='networkidle', timeout=120000)
        time.sleep(2)
        page.locator('#auth-card-login input#li-user').fill(CREDS['username'])
        page.locator('#auth-card-login input#li-pass').fill(CREDS['password'])
        page.locator('#auth-card-login button').click()
        page.wait_for_load_state('networkidle', timeout=120000)
        time.sleep(2)
        page.evaluate("""() => { if (typeof navigateTo === 'function') navigateTo('command'); }""")
        time.sleep(4)
        body = page.inner_text('body')
        print('contains 实时预警接入:', '实时预警接入' in body)
        print('contains 待处理事件:', '待处理事件' in body)
        print('contains 在办工单:', '在办工单' in body)
        page.screenshot(path=OUT, full_page=False)
        print('screenshot saved:', OUT)
        browser.close()

if __name__ == '__main__':
    main()
