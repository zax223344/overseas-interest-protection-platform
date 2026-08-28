import sys, os, json, time
from playwright.sync_api import sync_playwright

URL = 'http://127.0.0.1:3000'
CREDS = {'username': 'test_aa_20260826', 'password': 'Test123456!'}
OUT_PROJ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_screenshot_monitor_project.png')

errors = []
def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1600, 'height': 1000})
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda msg: errors.append(f"CONSOLE {msg.type}: {msg.text}") if msg.type == 'error' else None)
        page.goto(URL, wait_until='networkidle', timeout=120000)
        time.sleep(2)
        page.locator('#auth-card-login input#li-user').fill(CREDS['username'])
        page.locator('#auth-card-login input#li-pass').fill(CREDS['password'])
        page.locator('#auth-card-login button').click()
        page.wait_for_load_state('networkidle', timeout=120000)
        time.sleep(2)
        page.evaluate("""() => { if (typeof navigateTo === 'function') navigateTo('monitor'); }""")
        time.sleep(5)
        # find a project id containing 中老
        pid = page.evaluate("""() => {
            if (typeof ENTITY !== 'undefined' && ENTITY.PROJECTS) {
                var p = ENTITY.PROJECTS.find(function(x){ return /中老/.test(x.name); });
                return p ? p.id : null;
            }
            return null;
        }""")
        print('project id:', pid)
        if pid:
            page.evaluate(f"""() => {{ if (typeof MONITOR !== 'undefined' && MONITOR.showProjectRisk) MONITOR.showProjectRisk('{pid}'); }}""")
            time.sleep(1)
        page.screenshot(path=OUT_PROJ, full_page=False)
        body = page.inner_text('body')
        print('modal contains 实时风险:', '实时风险' in body)
        print('modal contains 应急指南:', '应急指南' in body)
        print('errors:', errors[:30])
        print('project detail screenshot saved:', OUT_PROJ)
        browser.close()

if __name__ == '__main__':
    main()
