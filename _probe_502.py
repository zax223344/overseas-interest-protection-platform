# -*- coding: utf-8 -*-
"""排查 502 来源 + 重截总览（等数据就绪）"""
import sys, io
from playwright.sync_api import sync_playwright
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = 'http://127.0.0.1:3100'
OUT = r'C:/Users/28737/Desktop/新建文件夹/logs'
lines = []
def log(s): print(s); lines.append(s)

bad = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={'width': 1600, 'height': 960})
    page = ctx.new_page()
    page.on('response', lambda r: bad.append('%s %s' % (r.status, r.url)) if r.status >= 400 else None)
    page.goto(BASE + '/', wait_until='domcontentloaded', timeout=60000)
    page.wait_for_selector('#li-user', timeout=30000)
    page.evaluate("APIClient.login('admin','admin123').then(function(){AUTH.user={name:'admin',role:'admin'};AUTH.showApp();})")
    page.wait_for_timeout(2500)
    page.evaluate("navigateTo('models')")
    page.wait_for_selector('#ma-nav .ma-nav-item', timeout=20000)
    # 等总览 KPI 数字就绪（totalEvents 文本出现）
    try:
        page.wait_for_function("document.getElementById('ma-canvas').innerText.indexOf('已审计事件底数')>=0", timeout=30000)
    except Exception:
        log('[警告] 总览数据等待超时')
    page.wait_for_timeout(1500)
    txt = page.evaluate("document.getElementById('ma-canvas').innerText.replace(/\\n/g,' | ').slice(0,200)")
    log('[总览就绪] %s' % txt)
    page.screenshot(path=OUT + '/_hub_overview.png')
    b.close()
log('--- 4xx/5xx 请求 ---')
for x in bad[:20]:
    log(x)
if not bad:
    log('（无）')
with open(OUT + '/_hub_probe.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
