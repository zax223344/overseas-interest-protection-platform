import sys, json, traceback
from playwright.sync_api import sync_playwright

USER = 'test_aa_20260826'
PASS = 'Test123456!'
SHOT = r'C:\Users\28737\Desktop\新建文件夹\_shot_ia_merge_{}.png'

def main():
    errors = []
    results = []
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
        page.wait_for_timeout(3500)

        # 1. 侧边栏入口数与键
        sb = page.evaluate('''() => Array.from(document.querySelectorAll('.sb-item[data-view]')).map(e=>e.getAttribute('data-view'))''')
        results.append(('sidebar_keys', sb))
        results.append(('sidebar_count_12', len([k for k in sb if k])))

        # 2. 伞形结构验证
        struct = page.evaluate('''() => {
            var out = {};
            ['reports','country','datapool','datagov'].forEach(u=>{
                var host = document.getElementById('view-'+u);
                out[u] = host ? { exists:true, cls:host.className, kids:Array.from(host.children).map(c=>c.id) } : {exists:false};
            });
            ['alerts','settings'].forEach(u=>{
                var host = document.getElementById('view-'+u);
                out['sv_'+u] = !!document.getElementById('sv-'+u);
                out['kids_'+u] = host ? Array.from(host.children).map(c=>c.id) : null;
            });
            return out;
        }''')
        results.append(('umbrella_structure', struct))

        # 3. 旧键兼容跳转：autoalert→alerts
        page.evaluate("navigateTo('autoalert')")
        page.wait_for_timeout(1500)
        r = page.evaluate('''() => ({
            alertsActive: document.getElementById('view-alerts').classList.contains('active'),
            aaSubActive: document.getElementById('view-autoalert').classList.contains('active'),
            sbActive: document.querySelector('.sb-item.active') ? document.querySelector('.sb-item.active').getAttribute('data-view') : null,
            title: document.getElementById('pageTitle').textContent,
            aaLen: (document.getElementById('view-autoalert').innerText||'').length
        })''')
        results.append(('autoalert_alias', r))
        page.screenshot(path=SHOT.format('autoalert'))

        # 4. 旧键 matrix→country
        page.evaluate("navigateTo('matrix')")
        page.wait_for_timeout(1800)
        r = page.evaluate('''() => ({
            countryActive: document.getElementById('view-country').classList.contains('active'),
            mxSubActive: document.getElementById('view-matrix').classList.contains('active'),
            sbActive: document.querySelector('.sb-item.active').getAttribute('data-view'),
            title: document.getElementById('pageTitle').textContent,
            mxLen: (document.getElementById('view-matrix').innerText||'').length
        })''')
        results.append(('matrix_alias', r))
        page.screenshot(path=SHOT.format('country'))

        # 5. 页签切换：国别档案内点 forecast 页签
        page.evaluate("switchViewTab('country','forecast')")
        page.wait_for_timeout(1800)
        r = page.evaluate('''() => ({
            fcSubActive: document.getElementById('view-forecast').classList.contains('active'),
            fcLen: (document.getElementById('view-forecast').innerText||'').length,
            curView: window._currentView
        })''')
        results.append(('country_tab_forecast', r))

        # 6. wechat→datapool
        page.evaluate("navigateTo('wechat')")
        page.wait_for_timeout(1500)
        r = page.evaluate('''() => ({
            dpActive: document.getElementById('view-datapool').classList.contains('active'),
            wcSubActive: document.getElementById('view-wechat').classList.contains('active'),
            sbActive: document.querySelector('.sb-item.active').getAttribute('data-view'),
            title: document.getElementById('pageTitle').textContent,
            wcLen: (document.getElementById('view-wechat').innerText||'').length
        })''')
        results.append(('wechat_alias', r))
        page.screenshot(path=SHOT.format('datapool'))

        # 7. explain→datagov
        page.evaluate("navigateTo('explain')")
        page.wait_for_timeout(1500)
        r = page.evaluate('''() => ({
            dgActive: document.getElementById('view-datagov').classList.contains('active'),
            exSubActive: document.getElementById('view-explain').classList.contains('active'),
            sbActive: document.querySelector('.sb-item.active').getAttribute('data-view'),
            exLen: (document.getElementById('view-explain').innerText||'').length
        })''')
        results.append(('explain_alias', r))

        # 8. role→settings + 主设置页签往返
        page.evaluate("navigateTo('role')")
        page.wait_for_timeout(1500)
        r = page.evaluate('''() => ({
            stActive: document.getElementById('view-settings').classList.contains('active'),
            roleSubActive: document.getElementById('view-role').classList.contains('active'),
            svSettingsHidden: !document.getElementById('sv-settings').classList.contains('active'),
            roleLen: (document.getElementById('view-role').innerText||'').length
        })''')
        results.append(('role_alias', r))
        page.evaluate("navigateTo('settings')")
        page.wait_for_timeout(1500)
        r = page.evaluate('''() => ({
            svSettingsActive: document.getElementById('sv-settings').classList.contains('active'),
            roleSubHidden: !document.getElementById('view-role').classList.contains('active'),
            stLen: (document.getElementById('sv-settings').innerText||'').length
        })''')
        results.append(('settings_tab_return', r))
        page.screenshot(path=SHOT.format('settings'))

        # 9. analysis→reports + aireport 页签
        page.evaluate("navigateTo('analysis')")
        page.wait_for_timeout(2000)
        r = page.evaluate('''() => ({
            rpActive: document.getElementById('view-reports').classList.contains('active'),
            anaSubActive: document.getElementById('view-analysis').classList.contains('active'),
            title: document.getElementById('pageTitle').textContent,
            anaLen: (document.getElementById('view-analysis').innerText||'').length
        })''')
        results.append(('analysis_alias', r))
        page.evaluate("navigateTo('aireport')")
        page.wait_for_timeout(1500)
        r = page.evaluate('''() => ({
            aiSubActive: document.getElementById('view-aireport').classList.contains('active'),
            aiLen: (document.getElementById('view-aireport').innerText||'').length
        })''')
        results.append(('aireport_tab', r))
        page.screenshot(path=SHOT.format('reports'))

        # 10. 预警中心主页面（alerts 本体）
        page.evaluate("navigateTo('alerts')")
        page.wait_for_timeout(2500)
        r = page.evaluate('''() => ({
            alertsActive: document.getElementById('view-alerts').classList.contains('active'),
            svAlertsActive: document.getElementById('sv-alerts').classList.contains('active'),
            aaHidden: !document.getElementById('view-autoalert').classList.contains('active'),
            svLen: (document.getElementById('sv-alerts').innerText||'').length
        })''')
        results.append(('alerts_main', r))
        page.screenshot(path=SHOT.format('alerts'))

        # 11. 侧边栏点击直达（点伞形入口）
        page.click('.sb-item[data-view="country"]')
        page.wait_for_timeout(1800)
        r = page.evaluate('''() => ({
            viaClick: document.getElementById('view-country').classList.contains('active'),
            firstTab: document.getElementById('view-matrix').classList.contains('active')
        })''')
        results.append(('sb_click_country', r))

        browser.close()

    print(json.dumps(dict(results), ensure_ascii=False, indent=1, default=str))
    print('PAGE_ERRORS:', json.dumps(errors[:20], ensure_ascii=False))
    print('ERROR_COUNT:', len(errors))

if __name__ == '__main__':
    main()
