from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width':430,'height':932})
    pg.goto('https://zax223344.github.io/overseas-interest-protection-platform/', wait_until='networkidle', timeout=60000)
    pg.wait_for_timeout(1500)
    pg.screenshot(path='_pages_live_mobile.png', full_page=True)
    status = pg.text_content('#statusText') or ''
    url = pg.text_content('#urlBox') or ''
    print('STATUS:', status.strip())
    print('URLBOX:', url.strip())
    b.close()
print('ok')
