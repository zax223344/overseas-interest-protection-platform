"""联合作业台 v2 真地图图层验证"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=60000)
    pg.wait_for_selector('#li-user', timeout=20000)
    pg.fill('#li-user', 'test_aa_20260826')
    pg.fill('#li-pass', 'Test123456!')
    pg.click('button:has-text("登 录")')
    pg.wait_for_selector('#app', state='visible', timeout=30000)
    pg.wait_for_timeout(4000)
    pg.evaluate('navigateTo("workbench")')
    pg.wait_for_timeout(6000)

    print('标记统计:', pg.evaluate('document.getElementById("wb-mapstat").innerText'))
    print('瓦片已载:', pg.evaluate('document.querySelectorAll("#wb-map .leaflet-tile-loaded").length'))
    print('svg path 总数:', pg.evaluate('document.querySelectorAll("#wb-map svg path").length'))
    n1 = pg.evaluate('document.querySelectorAll("#wb-map path.leaflet-interactive").length')
    print('可交互path(含热区圆+咽喉):', n1)
    pg.screenshot(path='_test_wb_v2_map.png')

    # 图层开关交互
    pg.uncheck('#wb-layers input[data-layer="alerts"]')
    pg.wait_for_timeout(1200)
    n2 = pg.evaluate('document.querySelectorAll("#wb-map path.leaflet-interactive").length')
    print('取消热区后 path:', n2, '(应减少≈39)')
    pg.check('#wb-layers input[data-layer="alerts"]')
    pg.wait_for_timeout(1200)
    n3 = pg.evaluate('document.querySelectorAll("#wb-map path.leaflet-interactive").length')
    print('恢复热区后 path:', n3, '(应回到', str(n1) + ')')

    # 项目层开关
    pg.uncheck('#wb-layers input[data-layer="project"]')
    pg.wait_for_timeout(1000)
    print('取消项目层后统计:', pg.evaluate('document.getElementById("wb-mapstat").innerText'))
    pg.check('#wb-layers input[data-layer="project"]')
    pg.wait_for_timeout(1000)

    # 切工作区
    pg.click('#wb-ws-tabs .dc-tab[data-ws="corridor"]')
    pg.wait_for_timeout(1500)
    print('切通道走廊监控后:', pg.evaluate('document.getElementById("wb-mapstat").innerText'))
    pg.screenshot(path='_test_wb_v2_corridor.png')

    # 点热区圆弹窗
    circles = pg.query_selector_all('#wb-map path.leaflet-interactive')
    if circles:
        try:
            circles[2].click(force=True)
            pg.wait_for_timeout(800)
            popup = pg.query_selector('.leaflet-popup-content')
            print('热区弹窗:', (popup.inner_text()[:150] if popup else 'none').replace('\n', ' | '))
        except Exception as e:
            print('弹窗点击失败:', e)

    # Explain 弹层
    pg.click('.wb-info[data-exp="strait"]')
    pg.wait_for_timeout(600)
    m = pg.query_selector('.wb-modal')
    print('Explain 弹层:', (m.inner_text()[:150] if m else 'none').replace('\n', ' | '))
    if m:
        pg.click('.wb-mx')

    print('pageerrors:', errs[:3])
    b.close()
