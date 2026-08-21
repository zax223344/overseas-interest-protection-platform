from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.goto('http://localhost:3000/', wait_until='domcontentloaded')
    pg.evaluate("""() => {
      localStorage.setItem('orps_api_token','dev-audit-token');
      localStorage.setItem('orps_user', JSON.stringify({name:'admin',role:'admin',status:'active'}));
    }""")
    pg.goto('http://localhost:3000/', wait_until='domcontentloaded')
    pg.wait_for_timeout(6000)
    # 直接在页面上下文里 fetch 状态接口，看真实返回
    r = pg.evaluate("""async () => {
      try {
        const resp = await fetch('/api/wechat/status');
        const j = await resp.json();
        return {http: resp.status, ok: j.ok, logged: j.status && j.status.logged, accounts: (j.status && j.status.accounts || []).length};
      } catch (e) { return {err: String(e)}; }
    }""")
    print('fetch /api/wechat/status =>', r)
    # APIClient.baseUrl 是什么
    print('APIClient.baseUrl =', pg.evaluate("() => (typeof APIClient!=='undefined' && APIClient.baseUrl) || '(none)'"))
    pg.click('.sb-item[data-view="wechat"]')
    pg.wait_for_timeout(3000)
    st = pg.evaluate("""() => ({
      statusText: ((document.getElementById('wx-status')||{}).innerText||'').slice(0,120),
      loginText: ((document.getElementById('wx-login')||{}).innerText||'').slice(0,80),
      accountRows: document.querySelectorAll('#wx-accounts > div > div').length
    })""")
    print('panel:', st)
    pg.screenshot(path='_wechat_panel.png')
    b.close()
print('ok')
