"""Verify situation view latest alerts panel deduplication."""
import sys, traceback, re
from playwright.sync_api import sync_playwright

BASE_URL = 'http://127.0.0.1:3000'
USER = 'test_aa_20260826'
PASS = 'Test123456!'
OUTPUT = r'_screenshot_situation_alerts.png'

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
        print('[OK] 登录成功')

        page.goto(BASE_URL + '/#situation', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#sit-alerts', timeout=20000)
        page.wait_for_timeout(3000)
        print('[OK] 态势总览渲染完成')

        page.screenshot(path=OUTPUT, full_page=False)
        print('[OK] 截图已保存:', OUTPUT)

        # Extract alert rows text
        rows = page.query_selector_all('#sit-alerts .sit-alert-row')
        print('最新预警条目数:', len(rows))
        for i, row in enumerate(rows[:12]):
            txt = row.inner_text().replace('\n', ' | ')
            print(f'  [{i}] {txt[:180]}')

        # Check for duplicates by visible title
        titles = []
        for row in rows:
            t = row.query_selector('span[style*="white-space"]')
            if t: titles.append(t.inner_text().strip())
        seen = set()
        dups = []
        for t in titles:
            if t in seen: dups.append(t)
            seen.add(t)
        if dups:
            print('[WARN] 发现完全重复标题:', dups)
        else:
            print('[OK] 无完全重复标题')

        browser.close()

    if errors:
        print('--- 控制台错误 ---')
        for e in errors[:30]:
            print(e)
    else:
        print('--- 无控制台错误 ---')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
