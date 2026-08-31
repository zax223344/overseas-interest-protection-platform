# -*- coding: utf-8 -*-
import sys, time, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:3000'
def probe(pg, label):
    info=pg.evaluate("""(function(){
      var out=[]; var n=document.getElementById('view-autoalert');
      while(n && n!==document.body){
        var cs=getComputedStyle(n); var rc=n.getBoundingClientRect();
        out.push((n.id||n.className||n.tagName)+' disp='+cs.display+' rect='+Math.round(rc.width)+'x'+Math.round(rc.height)+(n.classList.contains('active')?' [active]':''));
        n=n.parentElement;
      }
      var tab=document.querySelector('#mtabs-alerts .dc-tab.active');
      out.push('activeTab='+(tab?tab.textContent.trim():'null'));
      return out.join('\\n');
    })()""")
    print('===== '+label+' ====='); print(info)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':950})
    pg.goto(BASE, wait_until='networkidle')
    if pg.locator('#li-user').count():
        pg.fill('#li-user','test_aa_20260826'); pg.fill('#li-pass','Test123456')
        pg.click('button:has-text("登 录")'); time.sleep(2)
    pg.evaluate("navigateTo('autoalert')"); time.sleep(2)
    probe(pg,'navigateTo(autoalert) 直达')
    pg.evaluate("navigateTo('alerts')"); time.sleep(1)
    probe(pg,'navigateTo(alerts) 后')
    tabs=pg.locator('#mtabs-alerts .dc-tab')
    for i in range(tabs.count()):
        if '智能联动' in tabs.nth(i).inner_text():
            tabs.nth(i).click(); time.sleep(2); break
    probe(pg,'点击页签后')
    b.close()
