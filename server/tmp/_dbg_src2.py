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
    pg.evaluate("""(function(){
      var rows=Array.from(document.querySelectorAll('[onclick*="showAlertDetail"]'));
      var tjk=rows.filter(r=>(r.textContent||'').indexOf('塔吉克')>=0);
      if(tjk.length) tjk[0].click();
    })()""")
    time.sleep(1)
    body=pg.evaluate("document.getElementById('modal-bd')?document.getElementById('modal-bd').innerText:''")
    # 只打印含 来源/URL/原文 的行
    for line in body.split('\n'):
        if any(k in line for k in ['来源','URL','url','原文','链接','发布','时间']):
            print('MODAL|', line[:110])
    b.close()
