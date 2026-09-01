"""ORPS 专题分析模型 Playwright 截图复核：四 Tab + 灰显路径"""
import sys, traceback
from playwright.sync_api import sync_playwright

BASE_URL = 'http://127.0.0.1:3100'
USER = 'admin'
PASS = 'admin123'
OUT = '_screenshot_models_{name}.png'
errors = []

def shot(page, name):
    path = OUT.format(name=name)
    page.screenshot(path=path, full_page=False)
    print('[OK] 截图:', path)

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 960})
        page = context.new_page()
        # 详细记录网络与控制台
        page.on('console', lambda m: errors.append(f"[{m.type}] {m.text}"))
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))
        page.on('requestfailed', lambda r: errors.append(f"[netfail] {r.url} :: {r.failure}"))
        page.on('response', lambda r: errors.append(f"[net] {r.status} {r.url}") if '/api/models' in r.url else None)

        # 1. 登录
        page.goto(BASE_URL + '/', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#li-user', timeout=20000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('.sb-item', timeout=30000)
        print('[OK] 登录成功')

        # 2. 点击侧边栏进入专题分析模型视图
        page.click('.sb-item[data-view="models"]')
        page.wait_for_selector('.dc-tab[data-tab="geo"]', timeout=30000)
        page.wait_for_timeout(3500)  # 等组织 API + 画像
        # 确认视图容器可见
        vis = page.evaluate("document.getElementById('view-models') && getComputedStyle(document.getElementById('view-models')).display")
        print('[OK] view-models display =', vis)
        tabs = page.query_selector_all('.dc-tab[data-tab]')
        print('[OK] Tab 数量 =', len(tabs))
        shot(page, 'tab1_orgs')

        # 3. 灰显路径：点击样本不足组织
        insuff = page.query_selector('tr[data-org]:has-text("样本不足")')
        if insuff:
            insuff.click()
            page.wait_for_timeout(1500)
            shot(page, 'tab1_orgs_insufficient')
            txt = page.evaluate("document.getElementById('models-org-profile') ? document.getElementById('models-org-profile').innerText.slice(0,200) : ''")
            print('[OK] 灰显组织画像文本:', txt.replace('\n', ' | ')[:160])
        else:
            print('[WARN] 未找到样本不足组织行')

        # 4. Tab2 Hawkes
        page.click('.dc-tab[data-tab="hawkes"]')
        page.wait_for_timeout(3000)
        shot(page, 'tab2_hawkes')
        # 点击巴基斯坦行（详情+回测）
        row = page.query_selector('tr[data-hc]:has-text("巴基斯坦")')
        if row:
            row.click()
            page.wait_for_timeout(2500)
            shot(page, 'tab2_hawkes_pk')
        else:
            print('[WARN] 未找到巴基斯坦 Hawkes 行')

        # 5. Tab3 绑架
        page.click('.dc-tab[data-tab="kidnap"]')
        page.wait_for_timeout(3000)
        shot(page, 'tab3_kidnap')

        # 6. Tab4 地缘
        page.click('.dc-tab[data-tab="geo"]')
        page.wait_for_timeout(3000)
        shot(page, 'tab4_geo')

        browser.close()

    print('--- 控制台错误/警告 ---' if errors else '--- 无控制台错误 ---')
    for e in errors[:30]:
        print(e)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
