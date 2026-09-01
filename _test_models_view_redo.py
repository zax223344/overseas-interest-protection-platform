"""专题分析模型 - 补截 Tab3 绑架（更充裕等待）"""
import sys, traceback
from playwright.sync_api import sync_playwright

BASE_URL = 'http://127.0.0.1:3100'
errors = []
def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1200})
        page = context.new_page()
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))
        page.goto(BASE_URL + '/', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#li-user', timeout=20000)
        page.fill('#li-user', 'admin'); page.fill('#li-pass', 'admin123')
        page.click('button:has-text("登 录")')
        page.wait_for_selector('.sb-item', timeout=30000)
        page.click('.sb-item[data-view="models"]')
        page.wait_for_selector('.dc-tab[data-tab="geo"]', timeout=30000)
        page.wait_for_timeout(3000)
        # Tab3
        page.click('.dc-tab[data-tab="kidnap"]')
        page.wait_for_timeout(8000)  # 充足等待
        st = page.evaluate("({tab: MODELS_ANALYSIS._tab, body: document.getElementById('models-body').innerText.slice(0,200)})")
        print('[DBG] kidnap click state:', st)
        page.screenshot(path='_screenshot_models_tab3_kidnap.png', full_page=True)
        print('[OK] Tab3 kidnap 重新截图')
        # 滚动到对象清单区域
        page.evaluate("document.querySelector('#view-models').scrollTo(0, 600)")
        page.wait_for_timeout(1000)
        page.screenshot(path='_screenshot_models_tab3_kidnap_objects.png', full_page=False)
        print('[OK] Tab3 kidnap 对象清单截图')
        # Tab4 geo 详情（重截清晰版）
        page.click('.dc-tab[data-tab="geo"]')
        page.wait_for_timeout(4000)
        # 点击伊朗
        geoRow = page.query_selector('tr[data-country]:has-text("伊朗")')
        if geoRow:
            geoRow.click()
            page.wait_for_timeout(2500)
        page.screenshot(path='_screenshot_models_tab4_geo_detail.png', full_page=True)
        print('[OK] Tab4 geo 详情截图')
        # Hawkes 矩阵 Tab
        page.click('.dc-tab[data-tab="hawkes"]')
        page.wait_for_timeout(3000)
        # 滚动到手法矩阵
        page.evaluate("document.querySelector('#view-models').scrollTo(0, 1200)")
        page.wait_for_timeout(1000)
        page.screenshot(path='_screenshot_models_tab2_hawkes_matrix.png', full_page=False)
        print('[OK] Hawkes 矩阵截图')
        browser.close()
    if errors: [print(e) for e in errors[:10]]

if __name__ == '__main__':
    try: main()
    except Exception: traceback.print_exc(); sys.exit(1)
