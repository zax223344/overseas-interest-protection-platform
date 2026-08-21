import json, time, sys, os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4NzI0ODI1NSwiZXhwIjoxNzg3ODUzMDU1fQ.R5ZNjnDtQaQwkuATB8kNbvqjlfNFpjGfTw745xLOsPE"
USER = {"name":"admin","role":"admin","isTrial":False,"expireTime":None}
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def log(msg):
    print(msg, flush=True)

def alert_counts():
    from collections import Counter
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        ctx.add_init_script(f"""
            localStorage.setItem('orps_api_token', {json.dumps(TOKEN)});
            localStorage.setItem('orps_user', {json.dumps(json.dumps(USER))});
        """)
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        # wait for app and APIClient online
        for _ in range(30):
            if page.evaluate("() => document.getElementById('app') && document.getElementById('app').style.display !== 'none'"):
                break
            time.sleep(0.5)
        for _ in range(20):
            if page.evaluate("() => (typeof APIClient!=='undefined' && APIClient.isOnline && APIClient.isOnline())"):
                break
            time.sleep(0.5)
        page.evaluate("() => { if(typeof navigateTo==='function') navigateTo('alerts'); }")
        page.wait_for_selector("#alert-cmd-queue", state="visible", timeout=20000)
        time.sleep(2)
        # find first active alert id
        aid = page.evaluate("""() => {
            var a = (window.ALERTS||[]).find(x => x.status==='active');
            return a ? String(a.id) : null;
        }""")
        if not aid:
            log("WARN: no active alert found")
            browser.close()
            return None, None
        before = page.evaluate("""() => {
            var c={active:0,acknowledged:0,responding:0,resolved:0,total:0};
            (window.ALERTS||[]).forEach(a=>{c.total++; if(c[a.status]!=null)c[a.status]++;});
            return c;
        }""")
        page.screenshot(path=os.path.join(OUT_DIR, "_verify_before.png"))
        # click ack button for first active alert
        sel = f"button[onclick*=\"AVIEW.ack('{aid}')\"]"
        log(f"Clicking ack for alert {aid}: selector {sel}")
        page.click(sel, timeout=5000)
        time.sleep(2)
        # click respond
        page.click(f"button[onclick*=\"AVIEW.respond('{aid}')\"]", timeout=5000)
        time.sleep(2)
        # click resolve
        page.click(f"button[onclick*=\"AVIEW.resolve('{aid}')\"]", timeout=5000)
        time.sleep(2)
        after = page.evaluate("""() => {
            var c={active:0,acknowledged:0,responding:0,resolved:0,total:0};
            (window.ALERTS||[]).forEach(a=>{c.total++; if(c[a.status]!=null)c[a.status]++;});
            var a=(window.ALERTS||[]).find(x=>String(x.id)==={aid!r});
            return {counts:c, alert:a?{id:a.id,status:a.status,level:a.level,title:a.title_zh||a.title}:null};
        }""".replace("{aid!r}", repr(aid)))
        page.screenshot(path=os.path.join(OUT_DIR, "_verify_after.png"))
        browser.close()
        return before, after

if __name__ == '__main__':
    before, after = alert_counts()
    log("BEFORE: " + json.dumps(before, ensure_ascii=False))
    log("AFTER : " + json.dumps(after, ensure_ascii=False))
    ok = after and after.get('alert') and after['alert']['status'] == 'resolved' and after['counts']['resolved'] >= (before['resolved']+1)
    log("RESULT: " + ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)
