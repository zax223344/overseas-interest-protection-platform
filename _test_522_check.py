# -*- coding: utf-8 -*-
"""#522 排查：前端 ALERTS 数组中塞内加尔/圭亚那事件的显示情况"""
import json
from playwright.sync_api import sync_playwright

r = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, ignore_https_errors=True)
    page = ctx.new_page()
    page.goto('http://127.0.0.1:3000', wait_until='domcontentloaded', timeout=30000)
    page.wait_for_selector('#li-user', timeout=30000)
    page.wait_for_timeout(2000)
    page.fill('#li-user', 'admin')
    page.fill('#li-pass', 'admin123')
    page.click('#btn-login')
    page.wait_for_timeout(10000)

    r['alerts_matches'] = page.evaluate("""() => {
      const out = [];
      (ALERTS||[]).forEach(a => {
        const t = String(a.title_zh||a.title||'');
        if (/塞内加尔|圭亚那|矿企遇袭|华人店铺/.test(t)) {
          out.push({id: String(a.id), title: t.slice(0,60), country: a.country, level: a.level,
                    time: String(a.time||'').slice(0,16), src: a._sourceType||a.source_type||'',
                    url: String(a.url||'').slice(0,60), live: !!a._live});
        }
      });
      return out;
    }""")
    # 也查原始 intel 数据分发（DBCenter 侧）
    r['total_alerts'] = page.evaluate("() => (typeof ALERTS!=='undefined'?ALERTS.length:0)")
    b.close()

print(json.dumps(r, ensure_ascii=False, indent=2))
