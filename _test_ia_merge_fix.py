import json
from playwright.sync_api import sync_playwright

USER = 'test_aa_20260826'
PASS = 'Test123456!'

def main():
    errors = []
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))
        page.on('console', lambda msg: errors.append(f"[console.error] {msg.text}") if msg.type == 'error' else None)

        page.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=60000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('#app:not([style*="none"])', timeout=30000)
        page.wait_for_timeout(3000)

        # 侧边栏完整键清单
        results['sidebar'] = page.evaluate('''() => Array.from(document.querySelectorAll('.sb-item[data-view]')).map(e=>e.getAttribute('data-view'))''')

        # 修复点1：侧边栏点伞形入口 → 应回落到第一个页签并渲染
        page.click('.sb-item[data-view="country"]')
        page.wait_for_timeout(2000)
        results['sb_country_firsttab'] = page.evaluate('''() => ({
            countryActive: document.getElementById('view-country').classList.contains('active'),
            matrixActive: document.getElementById('view-matrix').classList.contains('active'),
            matrixLen: (document.getElementById('view-matrix').innerText||'').length,
            curView: window._currentView,
            title: document.getElementById('pageTitle').textContent
        })''')

        # 修复点2：navigateTo('forecast') 正确触发 FORECAST.init
        page.evaluate("navigateTo('forecast')")
        page.wait_for_timeout(2500)
        results['forecast_via_navigate'] = page.evaluate('''() => ({
            fcActive: document.getElementById('view-forecast').classList.contains('active'),
            fcLen: (document.getElementById('view-forecast').innerText||'').length,
            curView: window._currentView
        })''')

        # 回归：再点伞形入口 alerts → 应回主队列页签
        page.evaluate("navigateTo('autoalert')")
        page.wait_for_timeout(1500)
        page.click('.sb-item[data-view="alerts"]')
        page.wait_for_timeout(2000)
        results['sb_alerts_firsttab'] = page.evaluate('''() => ({
            svAlertsActive: document.getElementById('sv-alerts').classList.contains('active'),
            aaHidden: !document.getElementById('view-autoalert').classList.contains('active'),
            svLen: (document.getElementById('sv-alerts').innerText||'').length
        })''')

        # 回归：datapool 伞形入口 → 数据源库页签
        page.click('.sb-item[data-view="datapool"]')
        page.wait_for_timeout(2000)
        results['sb_datapool_firsttab'] = page.evaluate('''() => ({
            dsActive: document.getElementById('view-datasources').classList.contains('active'),
            dsLen: (document.getElementById('view-datasources').innerText||'').length
        })''')

        # 回归：datagov 伞形入口 → 数据中心页签
        page.click('.sb-item[data-view="datagov"]')
        page.wait_for_timeout(2500)
        results['sb_datagov_firsttab'] = page.evaluate('''() => ({
            dcActive: document.getElementById('view-datacenter').classList.contains('active'),
            dcLen: (document.getElementById('view-datacenter').innerText||'').length
        })''')

        # 回归：reports 伞形入口 → 研判简报页签
        page.click('.sb-item[data-view="reports"]')
        page.wait_for_timeout(2500)
        results['sb_reports_firsttab'] = page.evaluate('''() => ({
            anaActive: document.getElementById('view-analysis').classList.contains('active'),
            anaLen: (document.getElementById('view-analysis').innerText||'').length
        })''')

        browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=1, default=str))
    print('ERRORS:', json.dumps(errors[:15], ensure_ascii=False))

if __name__ == '__main__':
    main()
