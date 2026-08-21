from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto('http://localhost:3000/', wait_until='domcontentloaded')
    pg.evaluate("""() => {
      localStorage.setItem('orps_api_token','dev-audit-token');
      localStorage.setItem('orps_user', JSON.stringify({name:'admin',role:'admin',status:'active'}));
    }""")
    pg.goto('http://localhost:3000/', wait_until='domcontentloaded')
    pg.wait_for_timeout(6000)
    # 侧边栏进入「公众号采集」
    pg.click('.sb-item[data-view="wechat"]')
    pg.wait_for_timeout(2500)
    pg.screenshot(path='_wechat_panel.png')
    # DOM 断言
    checks = pg.evaluate("""() => ({
      viewActive: document.getElementById('view-wechat') && document.getElementById('view-wechat').classList.contains('active'),
      status: !!document.getElementById('wx-status'),
      login: !!document.getElementById('wx-login'),
      accounts: !!document.getElementById('wx-accounts'),
      console_: !!document.getElementById('wx-console'),
      statusText: (document.getElementById('wx-status')||{}).innerText || '',
      accountCount: document.querySelectorAll('#wx-accounts > div > div').length
    })""")
    print('checks:', checks)
    print('console errors:', [e for e in errs if 'favicon' not in e][:5])
    b.close()
print('ok')
