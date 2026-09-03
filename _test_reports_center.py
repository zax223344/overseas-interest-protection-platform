"""ORPS #528/#533/#534 前端验证：侧栏三入口 + 周期选择器 + 专题选题弹窗 + AI报告区
铁律：goto 一律 domcontentloaded（SSE 致 networkidle 永不触发）；切视图用 navigateTo()
"""
import sys, traceback
from playwright.sync_api import sync_playwright

BASE_URL = 'http://127.0.0.1:3000'
USER = 'admin'
PASS = 'admin123'

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1480, 'height': 920})
        page = context.new_page()
        page.on('console', lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type in ('error', 'warning') else None)
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))

        # 1. 登录
        page.goto(BASE_URL + '/', wait_until='domcontentloaded', timeout=60000)
        page.wait_for_selector('#li-user', timeout=20000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('.sb-item', timeout=30000)
        page.wait_for_timeout(1500)
        print('[OK] 登录成功')

        # 2. 侧栏三入口验证
        for dv, label in [('reports', '周期简报中心'), ('reportsc', '专题分析中心'), ('aireport', 'AI情报分析报告')]:
            el = page.query_selector(f'.sb-item[data-view="{dv}"]')
            txt = el.inner_text().strip() if el else '(不存在)'
            ok = 'OK' if (el and label in txt) else 'FAIL'
            print(f'[{ok}] 侧栏 {dv}: {txt}')
        page.screenshot(path='_shot_sidebar.png')

        # 3. 专题分析中心：周期选择器
        page.evaluate("navigateTo('reportsc')")
        page.wait_for_selector('#reportsc-root .rc-tcard', timeout=20000)
        page.wait_for_timeout(2500)
        freq = page.query_selector('#rc-freq')
        opts = freq.query_selector_all('option') if freq else []
        print(f"[{'OK' if freq else 'FAIL'}] 周期选择器存在，选项: {[o.inner_text() for o in opts]}")
        page.screenshot(path='_shot_reportsc.png')

        # 4. model-export 选题弹窗
        page.click('.rc-tcard[data-t="model-export"]')
        page.wait_for_timeout(1200)
        genbtn = page.query_selector('#rc-toolbar [data-act="gen"]')
        print(f"[{'OK' if genbtn else 'FAIL'}] model-export 生成按钮: {genbtn.inner_text().strip() if genbtn else '无'}")
        if genbtn:
            genbtn.click()
            page.wait_for_selector('#rc-topic-mask.show', timeout=8000)
            page.wait_for_timeout(600)
            dims = page.query_selector_all('#rc-tp-dims .rc-ck')
            cs = page.query_selector_all('#rc-tp-countries .rc-ck')
            wins = page.query_selector_all('#rc-tp-win option')
            print(f'[OK] 选题弹窗打开：维度 {len(dims)} 个 / 国家 {len(cs)} 个 / 时间窗 {len(wins)} 档')
            # 交互实测：勾选两维 + 两国
            page.click('#rc-tp-dims .rc-ck[data-k="org"]')
            page.click('#rc-tp-dims .rc-ck[data-k="china"]')
            page.click('#rc-tp-countries .rc-ck[data-k="巴基斯坦"]')
            page.click('#rc-tp-countries .rc-ck[data-k="刚果(金)"]')
            page.fill('#rc-tp-topic', '俾路支省中资项目安全暴露深度分析')
            page.select_option('#rc-tp-win', '90')
            on_n = len(page.query_selector_all('#rc-topic-mask .rc-ck.on'))
            print(f'[OK] 选题交互：已勾选 {on_n} 项')
            page.screenshot(path='_shot_topic_dialog.png')
            page.click('#rc-topic-mask [data-act="topic-close"]')
            page.wait_for_timeout(400)

        # 5. AI情报分析报告独立视图
        page.evaluate("navigateTo('aireport')")
        page.wait_for_timeout(2500)
        vis = page.evaluate("(() => { const v = document.getElementById('view-aireport'); if (!v) return 'NO_EL'; const cs = getComputedStyle(v); return (cs.display !== 'none' && v.offsetParent !== null) ? 'VISIBLE' : 'hidden:' + cs.display; })()")
        print(f"[{'OK' if vis == 'VISIBLE' else 'FAIL'}] view-aireport 可见性: {vis}")
        page.screenshot(path='_shot_aireport.png')

        # 6. 周期简报中心（伞形视图）
        page.evaluate("navigateTo('reports')")
        page.wait_for_timeout(2200)
        page.screenshot(path='_shot_reports.png')
        print('[OK] 三视图截图完成')

        browser.close()

    print('--- 控制台错误 ---' if errors else '--- 无控制台错误 ---')
    for e in errors[:20]:
        print(e)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
