import sys, traceback
from playwright.sync_api import sync_playwright

USER = 'test_aa_20260826'
PASS = 'Test123456!'
OUT1 = r'C:\Users\28737\Desktop\新建文件夹\_screenshot_situation_cycle_1.png'
OUT2 = r'C:\Users\28737\Desktop\新建文件夹\_screenshot_situation_cycle_2.png'

def snap(page):
    return page.evaluate('''() => {
        var fc = document.getElementById('focus-clock');
        var cd = document.getElementById('focus-countdown');
        var lcd = document.getElementById('la-countdown');
        var gi = document.getElementById('globe-intel-live');
        var sa = document.getElementById('sit-alerts');
        return {
            clock: fc ? fc.textContent : null,
            countdown: cd ? cd.textContent : null,
            laCountdown: lcd ? lcd.textContent : null,
            focusText: gi ? (gi.innerText || '').replace(/\\n/g, ' | ').slice(0, 600) : null,
            alertsText: sa ? (sa.innerText || '').replace(/\\n/g, ' | ').slice(0, 400) : null
        };
    }''')

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1400, 'height': 900})
        page = context.new_page()
        page.on('console', lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type in ('error', 'warning') else None)
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))

        page.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=60000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('#sb-autoalert-count', timeout=30000)
        page.click('.sb-item[data-view="situation"]')
        page.wait_for_timeout(4000)

        s1 = snap(page)
        print('=== T0 ===')
        print('clock:', s1['clock'])
        print('countdown:', s1['countdown'])
        print('la-countdown:', s1['laCountdown'])
        print('focus:', s1['focusText'][:300])
        page.screenshot(path=OUT1, full_page=False)

        # verify second-level heartbeat: clock must tick within 3s
        page.wait_for_timeout(3000)
        s1b = snap(page)
        print('clock after 3s:', s1b['clock'], '| ticked:', s1b['clock'] != s1['clock'])
        print('countdown after 3s:', s1b['countdown'])

        # wait past the 60s boundary to catch the rotation
        page.wait_for_timeout(62000)
        s2 = snap(page)
        print('=== T+65s ===')
        print('clock:', s2['clock'])
        print('countdown:', s2['countdown'])
        print('la-countdown:', s2['laCountdown'])
        print('focus:', s2['focusText'][:300])
        page.screenshot(path=OUT2, full_page=False)

        print('=== verdict ===')
        print('heartbeat (clock ticks):', s1b['clock'] != s1['clock'])
        print('countdown reset (T0 vs T+65):', s1['countdown'], '->', s2['countdown'])
        print('focus panel changed:', s1['focusText'] != s2['focusText'])
        print('alerts panel changed:', s1['alertsText'] != s2['alertsText'])
        print('screenshots:', OUT1, OUT2)
        browser.close()
    if errors:
        print('--- console errors/warnings (first 15) ---')
        for e in errors[:15]:
            print(e)
    else:
        print('no console errors')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
