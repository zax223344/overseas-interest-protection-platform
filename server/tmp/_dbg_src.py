# -*- coding: utf-8 -*-
import sys, time, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:3000'
TOKEN='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5IiwidXNlcm5hbWUiOiJ0ZXN0X2FhX3Y2XzA4MzAiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4ODA4MjEwOSwiZXhwIjoxNzg4Njg2OTA5fQ.cQGd-CplrHl8TX5mFnV9ZrdXLojJYaPHZEv5uJmYPjk'
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':950})
    pg.goto(BASE,wait_until='load')
    pg.evaluate("t=>localStorage.setItem('orps_api_token',t)",TOKEN)
    pg.reload(wait_until='load'); time.sleep(5)
    pg.evaluate("navigateTo('alerts')"); time.sleep(3)
    # 找塔吉克相关预警行并点击
    n=pg.evaluate("""(function(){
      var rows=Array.from(document.querySelectorAll('.alert-item,.sit-alert-row,[onclick*="showAlertDetail"]'));
      var tjk=rows.filter(r=>(r.textContent||'').indexOf('塔吉克')>=0);
      return {total:rows.length, tjk:tjk.length, firstTitle:tjk.length?tjk[0].textContent.slice(0,60):''};
    })()""")
    print('[预警中心] 行总数=%d 塔吉克相关=%d' % (n['total'], n['tjk']))
    if n['tjk']:
        print('  首条:', n['firstTitle'])
        # 点击第一条塔吉克预警打开详情
        pg.evaluate("""(function(){
          var rows=Array.from(document.querySelectorAll('.alert-item,.sit-alert-row,[onclick*="showAlertDetail"]'));
          var tjk=rows.filter(r=>(r.textContent||'').indexOf('塔吉克')>=0);
          if(tjk.length) tjk[0].click();
        })()""")
        time.sleep(1)
        modal=pg.evaluate("!!document.getElementById('modal') && document.getElementById('modal').classList.contains('show')")
        body=pg.evaluate("document.getElementById('modal-bd')?document.getElementById('modal-bd').innerText.slice(0,400):''")
        print('[详情弹窗] 打开=%s' % modal)
        print('  详情内容:\n' + body[:380].replace('\n','\n  '))
        pg.screenshot(path=r'C:/Users/28737/Desktop/新建文件夹/server/logs/_tjk_alert_detail.png')
    b.close()
print('DONE')
