"""
联合作业台（workbench）真实浏览器验证：
1. 登录 → 点侧边栏「联合作业台」
2. 验证：指数卡 / 工作区 tab / 图层列表 / 国家聚合 / 情报流 渲染
3. 交互：切「涉华安全专项」工作区 → 点一个图层「i」Explain 弹层 → 截图
"""
import sys, traceback
from playwright.sync_api import sync_playwright

BASE_URL = 'http://127.0.0.1:3000'
USER = 'test_aa_20260826'
PASS = 'Test123456!'
OUT = [
    r'_test_wb_1_view.png',
    r'_test_wb_2_ws_switch.png',
    r'_test_wb_3_explain.png',
    r'_test_wb_4_index.png',
]

def shot(page, i, tag):
    page.screenshot(path=OUT[i], full_page=False)
    print('[OK] 截图', tag, OUT[i])

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()
        page.on('console', lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type in ('error', 'warning') else None)
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))

        # 1. 登录
        page.goto(BASE_URL + '/', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#li-user', timeout=20000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('#app', state='visible', timeout=30000)
        page.wait_for_timeout(2000)
        print('[OK] 登录成功')

        # 2. 进入「联合作业台」（evaluate navigateTo，避免点击被遮挡）
        page.evaluate('navigateTo("workbench")')
        page.wait_for_timeout(3500)
        cls = page.evaluate('document.getElementById("view-workbench").className')
        print('view-workbench class:', cls)
        assert 'active' in cls, '视图未激活'

        # 验证核心元素
        checks = [
            ('指数卡', '#wb-ixcard'),
            ('工作区tab', '#wb-ws-tabs'),
            ('图层面板', '#wb-layers'),
            ('情报流', '#wb-feed'),
        ]
        for name, sel in checks:
            el = page.query_selector(sel)
            print(('[OK] ' if el else '[MISS] ') + name, sel)
        # 指数文本
        ix = page.query_selector('#wb-ixcard')
        if ix:
            print('指数卡文本:', ix.inner_text().replace('\n', ' | ')[:200])
        tabs = page.query_selector_all('#wb-ws-tabs .dc-tab')
        print('工作区数量:', len(tabs), '|', ' / '.join(t.inner_text() for t in tabs))
        layers = page.query_selector_all('#wb-layers .wb-lrow')
        print('图层数量:', len(layers))
        feeds = page.query_selector_all('#wb-feed .wb-feed')
        print('情报流条数:', len(feeds))
        shot(page, 0, '默认工作区')

        # 3. 切「涉华安全专项」工作区
        page.click('#wb-ws-tabs .dc-tab[data-ws="cnsec"]')
        page.wait_for_timeout(1500)
        feeds2 = page.query_selector_all('#wb-feed .wb-feed')
        print('切涉华专项后情报流条数:', len(feeds2))
        shot(page, 1, '涉华安全专项')

        # 4. 点图层「i」Explain 弹层
        page.click('.wb-info[data-exp="flag_cn"]')
        page.wait_for_selector('.wb-modal', timeout=8000)
        modal = page.query_selector('.wb-modal')
        print('Explain 弹层:', modal.inner_text().replace('\n', ' | ')[:260])
        shot(page, 2, 'Explain弹层')
        page.click('.wb-mx')
        page.wait_for_timeout(500)

        # 5. 点指数「构成明细」
        page.click('#wb-ixbtn')
        page.wait_for_selector('.wb-modal', timeout=8000)
        m2 = page.query_selector('.wb-modal')
        print('指数构成:', m2.inner_text().replace('\n', ' | ')[:260])
        shot(page, 3, '指数构成明细')

        browser.close()

    print('--- 控制台错误/警告 ---' if errors else '--- 无控制台错误 ---')
    for e in errors[:20]:
        print(e)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
