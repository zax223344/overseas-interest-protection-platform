from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':1440,'height':900})
    # 注入登录态（免登录页）
    pg.goto('http://localhost:3000/', wait_until='domcontentloaded')
    pg.evaluate("""() => {
      localStorage.setItem('orps_api_token','dev-audit-token');
      localStorage.setItem('orps_user', JSON.stringify({name:'admin',role:'admin',status:'active'}));
    }""")
    pg.goto('http://localhost:3000/', wait_until='networkidle')
    pg.wait_for_timeout(4000)
    pg.screenshot(path='_sit_panels_after.png')
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.wait_for_timeout(1500)
    pg.screenshot(path='_sit_panels_after2.png')
    print('remaining panels:', pg.evaluate("""() => ['globe-intel-live','globe-intel-alerts','globe-intel-hotspots','globe-stats','globe-hud','sit-level-panel'].map(id=>id+':'+(!!document.getElementById(id))).join(' ')"""))
    b.close()
print('ok')
