from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':430,'height':932})
    pg.goto('http://127.0.0.1:8899/', wait_until='networkidle')
    pg.wait_for_timeout(1200)
    pg.screenshot(path='_pages_guide_mobile.png', full_page=True)
    pg2 = b.new_page(viewport={'width':1280,'height':800})
    pg2.goto('http://127.0.0.1:8899/', wait_until='networkidle')
    pg2.wait_for_timeout(1200)
    pg2.screenshot(path='_pages_guide_desktop.png', full_page=True)
    b.close()
print('ok')
