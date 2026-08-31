# -*- coding: utf-8 -*-
import sys, time, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:3000'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':950})
    pg.goto(BASE, wait_until='networkidle')
    if pg.locator('#li-user').count():
        pg.fill('#li-user','test_aa_20260826'); pg.fill('#li-pass','Test123456')
        pg.click('button:has-text("登 录")'); time.sleep(2)
    pg.evaluate("navigateTo('autoalert')"); time.sleep(3)
    info=pg.evaluate("""(function(){
      var rows=Array.from(document.querySelectorAll('.aa3-row'));
      var out=[];
      rows.slice(0,6).forEach(function(r,i){
        var rc=r.getBoundingClientRect();
        var cs=getComputedStyle(r);
        var anc=r.closest('.aa3-scenarios');
        var arc=anc?anc.getBoundingClientRect():null;
        out.push(i+': rect='+Math.round(rc.width)+'x'+Math.round(rc.height)+' disp='+cs.display+' vis='+cs.visibility+
          ' | listRect='+(arc?Math.round(arc.width)+'x'+Math.round(arc.height)+' top='+Math.round(arc.top):'null')+
          ' | parentDisp='+getComputedStyle(r.parentElement).display);
      });
      out.push('rowsTotal='+rows.length);
      var sv=document.getElementById('view-autoalert');
      out.push('viewAutoalert disp='+(sv?getComputedStyle(sv).display:'null')+' rect='+(sv?Math.round(sv.getBoundingClientRect().width)+'x'+Math.round(sv.getBoundingClientRect().height):''));
      return out.join('\\n');
    })()""")
    print(info)
    b.close()
