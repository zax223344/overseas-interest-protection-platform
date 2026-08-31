# -*- coding: utf-8 -*-
import sys, time, io, urllib.request, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:3000'
TOKEN='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5IiwidXNlcm5hbWUiOiJ0ZXN0X2FhX3Y2XzA4MzAiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4ODA4MjEwOSwiZXhwIjoxNzg4Njg2OTA5fQ.cQGd-CplrHl8TX5mFnV9ZrdXLojJYaPHZEv5uJmYPjk'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':950})
    pg.goto(BASE,wait_until='load')
    pg.evaluate("t=>localStorage.setItem('orps_api_token',t)",TOKEN)
    pg.reload(wait_until='load'); time.sleep(5)
    pg.evaluate("navigateTo('autoalert')"); time.sleep(3)
    info=pg.evaluate("""(function(){
      var sel=['.aa3-hero','.aa3-conclusion','.aa3-horizon','.aa3-main','.aa3-charts','.aa3-footer'];
      var out=[]; sel.forEach(function(s){
        var n=document.querySelector(s); if(!n){out.push(s+':NULL');return;}
        var r=n.getBoundingClientRect();
        out.push(s+': rect='+Math.round(r.width)+'x'+Math.round(r.height)+' top='+Math.round(r.top+window.scrollY)+' disp='+getComputedStyle(n).display);
      });
      var scn=document.querySelector('.aa3-scenarios');
      var det=document.querySelector('.aa3-detail');
      out.push('scenarios: '+scn.getBoundingClientRect().height+'h rows='+document.querySelectorAll('.aa3-row').length);
      out.push('detail: '+det.getBoundingClientRect().height+'h chainSteps='+document.querySelectorAll('.aa3-chain .aa3-step').length);
      return out.join('\\n');
    })()""")
    print(info)
    # 滚到 .aa3-main 截图
    pg.evaluate("document.querySelector('.aa3-main').scrollIntoView({block:'start'})")
    time.sleep(1)
    pg.screenshot(path=r'C:/Users/28737/Desktop/新建文件夹/server/logs/_aa3_v6_chain.png')
    b.close()
