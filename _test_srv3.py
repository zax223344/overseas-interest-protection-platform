# -*- coding: utf-8 -*-
# 服务端三件（异动信号/采集漏斗/归档检索）真浏览器验证
import sys, json, traceback
from playwright.sync_api import sync_playwright

USER = 'test_aa_20260826'
PASS = 'Test123456!'
SHOT = r'C:\Users\28737\Desktop\新建文件夹\_shot_srv3_{}.png'

def main():
    errors = []
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 900})
        page = context.new_page()
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))
        page.on('console', lambda msg: errors.append(f"[console.error] {msg.text}") if msg.type == 'error' else None)

        page.goto('http://127.0.0.1:3000/', wait_until='networkidle', timeout=60000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('#app:not([style*="none"])', timeout=30000)
        page.wait_for_timeout(3500)

        # 1. 伞形页签结构：alerts 3 页签、datagov 5 页签
        tabs = page.evaluate('''() => ({
            alerts: Array.from(document.querySelectorAll('#mtabs-alerts .dc-tab')).map(e=>e.textContent.trim()),
            datagov: Array.from(document.querySelectorAll('#mtabs-datagov .dc-tab')).map(e=>e.textContent.trim())
        })''')
        results.append(('umbrella_tabs', tabs))

        # 2. 异动信号页签（alerts 伞形下第 3 个）
        page.evaluate("navigateTo('anomaly')")
        page.wait_for_timeout(4500)
        r = page.evaluate('''() => ({
            alertsActive: document.getElementById('view-alerts').classList.contains('active'),
            anomSubActive: document.getElementById('view-anomaly').classList.contains('active'),
            sbActive: document.querySelector('.sb-item.active') ? document.querySelector('.sb-item.active').getAttribute('data-view') : null,
            title: document.getElementById('pageTitle').textContent,
            meta: (document.getElementById('anomaly-meta')||{}).textContent || '',
            statsLen: (document.getElementById('anomaly-stats')||{}).innerText || '',
            listLen: (document.getElementById('anomaly-list')||{}).innerText || '',
            hasModules: typeof ANOMALY_VIEW !== 'undefined'
        })''')
        results.append(('anomaly_view', r))
        page.screenshot(path=SHOT.format('anomaly'))

        # 3. 采集漏斗页签（datagov 伞形下）
        page.evaluate("navigateTo('funnel')")
        page.wait_for_timeout(3500)
        r = page.evaluate('''() => ({
            datagovActive: document.getElementById('view-datagov').classList.contains('active'),
            funnelSubActive: document.getElementById('view-funnel').classList.contains('active'),
            sbActive: document.querySelector('.sb-item.active') ? document.querySelector('.sb-item.active').getAttribute('data-view') : null,
            title: document.getElementById('pageTitle').textContent,
            meta: (document.getElementById('funnel-meta')||{}).textContent || '',
            stages: Array.from(document.querySelectorAll('#funnel-stages > div')).length,
            firstStageText: ((document.querySelector('#funnel-stages')||{}).innerText||'').slice(0,200),
            hasModules: typeof FUNNEL_VIEW !== 'undefined'
        })''')
        results.append(('funnel_view', r))

        # 点开三级明细
        page.evaluate("FUNNEL_VIEW.toggle('blocked')")
        page.wait_for_timeout(600)
        page.evaluate("FUNNEL_VIEW.toggle('stored')")
        page.wait_for_timeout(600)
        page.evaluate("FUNNEL_VIEW.toggle('alerts')")
        page.wait_for_timeout(600)
        r = page.evaluate('''() => ({ detailOpen: ((document.getElementById('funnel-stages')||{}).innerText||'').length })''')
        results.append(('funnel_details_open', r))
        page.screenshot(path=SHOT.format('funnel'))

        # 4. 归档检索页签
        page.evaluate("navigateTo('archive')")
        page.wait_for_timeout(3500)
        r = page.evaluate('''() => ({
            archiveSubActive: document.getElementById('view-archive').classList.contains('active'),
            title: document.getElementById('pageTitle').textContent,
            statsText: ((document.getElementById('ar-stats')||{}).innerText||'').slice(0,150),
            resultRows: document.querySelectorAll('#ar-results tbody tr').length,
            pagerText: ((document.getElementById('ar-pager')||{}).innerText||'').replace(/\\s+/g,' ').slice(0,80),
            hasModules: typeof ARCHIVE_VIEW !== 'undefined'
        })''')
        results.append(('archive_view', r))
        page.screenshot(path=SHOT.format('archive'))

        # 5. 归档检索交互：关键词 + 国别
        page.fill('#ar-q', '袭击')
        page.click('#ar-search')
        page.wait_for_timeout(2500)
        r = page.evaluate('''() => ({
            q_total: ((document.getElementById('ar-stats')||{}).innerText||'').split('\\n')[0],
            rows: document.querySelectorAll('#ar-results tbody tr').length
        })''')
        results.append(('archive_search_q', r))
        page.screenshot(path=SHOT.format('archive_q'))

        # 6. 回归：预警中心主队列仍正常（alerts 首页签）
        page.evaluate("navigateTo('alerts')")
        page.wait_for_timeout(4000)
        r = page.evaluate('''() => ({
            alertsSubActive: document.getElementById('sv-alerts').classList.contains('active'),
            queueLen: ((document.getElementById('alert-cmd-queue')||{}).innerText||'').length,
            statsLen: ((document.getElementById('alert-stats')||{}).innerText||'').length
        })''')
        results.append(('alerts_regression', r))

        browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=1))
    if errors:
        print('PAGE ERRORS:')
        for e in errors[:12]:
            print(' ', e[:200])
        sys.exit(1)
    print('ALL_OK')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
