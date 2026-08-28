import sys, os, json, re, requests
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3000'
OUT = os.path.join(os.path.dirname(__file__), '_screenshot_situation_v3.png')
USER = 'test_pw_' + str(int(__import__('time').time()))[-6:]
PASS = 'Test123456'

def ensure_user():
    r = requests.post(BASE + '/api/auth/trial', json={'username': USER, 'password': PASS, 'days': 7}, timeout=10)
    print('trial create', r.status_code, r.text[:200])
    if r.status_code in (200, 201, 409):
        r2 = requests.post(BASE + '/api/auth/login', json={'username': USER, 'password': PASS}, timeout=10)
        print('login', r2.status_code, r2.text[:200])
        if r2.status_code == 200:
            return r2.json().get('token')
    return None

def main():
    token = ensure_user()
    if not token:
        print('failed to get token')
        sys.exit(1)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1600, 'height': 900})
        page = ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
        page.on('console', lambda msg: print(f'[console {msg.type}] {msg.text[:200]}'))
        print('ui login')
        page.goto(BASE + '/', wait_until='networkidle')
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.locator('.auth-card #auth-card-login button.auth-btn').first.click()
        page.wait_for_function('()=>document.getElementById("app") && document.getElementById("app").style.display!=="none"', timeout=25000)
        page.wait_for_function('()=>{var o=document.getElementById("auth-overlay"); return !o || o.style.display==="none" || getComputedStyle(o).display==="none" || o.style.opacity==="0"}', timeout=10000)
        page.goto(BASE + '/#situation', wait_until='networkidle')
        page.wait_for_timeout(8000)
        try:
            page.wait_for_selector('#globe-intel-live', timeout=10000)
            page.wait_for_selector('#sit-alerts', timeout=10000)
        except Exception as e:
            print('panel not found', e)
        alerts = page.locator('#sit-alerts .sit-alert-row').count()
        live = page.locator('#globe-intel-live .live-item').count()
        top = page.locator('#globe-intel-live .panel-body div[onclick*="selectAlert"]').count()
        print(f'sit-alerts rows: {alerts}, live-items: {live}, focus clickable: {top}')
        page.screenshot(path=OUT, full_page=False)
        print('saved', OUT)
        if errs:
            print('ERRORS:', '\n'.join(errs))
        browser.close()
        sys.exit(1 if errs else 0)

if __name__ == '__main__':
    main()
