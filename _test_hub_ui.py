# -*- coding: utf-8 -*-
"""ORPS 大情报分析中枢 · 六专项 + 智能体 Playwright 验证
- admin/admin123 登录（domcontentloaded）
- 六专项逐一截图 + 智能体面板触发一次研判（org-analyst）
- 控制台零 pageerror 判定
"""
import sys, io, traceback
from playwright.sync_api import sync_playwright

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
BASE = 'http://127.0.0.1:3100'
OUT = r'C:/Users/28737/Desktop/新建文件夹/logs'
REPORT = OUT + r'/_models_v2_report.txt'
lines = []
def log(s):
    print(s)
    lines.append(s)
errors = []

VIEWS = [
    ('overview', '中枢总览', '#ma-canvas', '中枢总览'),
    ('org', '恐怖组织动态', '#ma-canvas', '组织活动指数榜'),
    ('terror', '国别恐袭行为画像', '#ma-canvas', '行为画像'),
    ('kidnap', '海外绑架行动模式', '#ma-canvas', '绑架行动模式'),
    ('geo', '地缘安全风险', '#ma-canvas', '地缘安全风险'),
    ('sanctions', '对华制裁', '#ma-canvas', '对华制裁'),
    ('minerals', '关键矿产及海关', '#ma-canvas', '矿产'),
]

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={'width': 1600, 'height': 960})
        page = ctx.new_page()
        page.on('console', lambda m: errors.append('[%s] %s' % (m.type, m.text)) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append('[pageerror] %s' % e))

        # 登录
        page.goto(BASE + '/', wait_until='domcontentloaded', timeout=60000)
        page.wait_for_selector('#li-user', timeout=30000)
        page.evaluate("APIClient.login('admin','admin123').then(function(){AUTH.user={name:'admin',role:'admin'};AUTH.showApp();})")
        page.wait_for_timeout(2500)
        auth = page.evaluate("typeof AUTH !== 'undefined'")
        overlay = page.evaluate("(function(){var o=document.getElementById('auth-overlay');return o && (o.style.display==='none' || getComputedStyle(o).display==='none');})()")
        log('[登录] AUTH=%s overlay_hidden=%s' % (auth, overlay))

        # 进入 models 视图
        page.evaluate("navigateTo('models')")
        page.wait_for_selector('#ma-nav .ma-nav-item', timeout=20000)
        page.wait_for_timeout(2500)
        nav_cnt = page.evaluate("document.querySelectorAll('#ma-nav .ma-nav-item').length")
        log('[框架] 导航树条目数=%s（预期 7）' % nav_cnt)
        agent_ready = page.evaluate("!!document.getElementById('ma-agent')")
        log('[框架] 智能体面板存在=%s' % agent_ready)

        # 六专项逐一截图
        for key, name, sel, marker in VIEWS:
            page.evaluate("MODELS_ANALYSIS._show('%s')" % key)
            try:
                page.wait_for_function("document.getElementById('ma-canvas').innerText.indexOf('%s') >= 0" % marker, timeout=25000)
            except Exception:
                log('[警告] %s 等待标记「%s」超时' % (name, marker))
            page.wait_for_timeout(1200)
            txt = page.evaluate("document.getElementById('ma-canvas').innerText.replace(/\\n/g,' | ').slice(0,150)")
            log('[%s] %s' % (name, txt))
            page.screenshot(path='%s/_hub_%s.png' % (OUT, key))

        # 智能体触发：org-analyst（走 LLM，最长 120s）
        page.evaluate("MODELS_ANALYSIS._show('org')")
        page.wait_for_timeout(2000)
        page.evaluate("MODELS_ANALYSIS._sel.org='taliban'; MODELS_ANALYSIS._renderAgentPanel();")
        page.wait_for_timeout(500)
        page.evaluate("document.getElementById('ma-agent-run').click()")
        try:
            page.wait_for_function(
                "document.getElementById('ma-agent-result') && (document.getElementById('ma-agent-result').innerText.indexOf('研判中')<0)",
                timeout=120000)
        except Exception:
            log('[警告] 智能体研判 120s 超时')
        agent_txt = page.evaluate("document.getElementById('ma-agent-result') ? document.getElementById('ma-agent-result').innerText.replace(/\\n/g,' | ').slice(0,220) : 'MISSING'")
        log('[智能体] org-analyst 结果=%s' % agent_txt)
        page.screenshot(path='%s/_hub_agent_org.png' % OUT)

        # 证据链：点击第一条证据
        try:
            first = page.query_selector('.ma-evi[data-evid]')
            if first:
                first.click()
                page.wait_for_timeout(1500)
                modal = page.evaluate("!!document.querySelector('.ma-modal')")
                log('[证据链] 事件详情弹窗=%s' % modal)
                page.screenshot(path='%s/_hub_evidence_modal.png' % OUT)
        except Exception as e:
            log('[证据链] 点击失败 %s' % e)

        b.close()

    log('--- 控制台错误(%d) ---' % len(errors))
    for e in errors[:30]:
        log(e)
    if not errors:
        log('（无 pageerror / error）')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        log('[EXC] ' + traceback.format_exc())
    finally:
        with open(REPORT, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
