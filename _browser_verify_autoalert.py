import json, time, sys, os, subprocess
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
NODE = r"C:\Users\28737\.workbuddy\binaries\node\versions\22.22.2\node.exe"

def gen_token():
    code = """
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'orps_jwt_secret_key_2026_overseas_protection_platform';
console.log(jwt.sign({ id: 1, username: 'admin', role: 'admin' }, secret, { expiresIn: '7d' }));
"""
    env = os.environ.copy()
    env['JWT_SECRET'] = 'orps_jwt_secret_key_2026_overseas_protection_platform'
    r = subprocess.run([NODE, '-e', code], cwd=os.path.join(OUT_DIR, 'server'), capture_output=True, text=True, env=env)
    return r.stdout.strip()

TOKEN = gen_token()
USER = {"name":"admin","role":"admin","isTrial":False,"expireTime":None}

def log(msg):
    print(msg, flush=True)

def alert_counts(page):
    return page.evaluate("""() => {
        var c={active:0,acknowledged:0,responding:0,resolved:0,total:0};
        (window.ALERTS||[]).forEach(a=>{c.total++; if(c[a.status]!=null)c[a.status]++;});
        return c;
    }""")

def open_page(browser):
    ctx = browser.new_context()
    ctx.add_init_script(f"""
        localStorage.setItem('orps_api_token', {json.dumps(TOKEN)});
        localStorage.setItem('orps_user', {json.dumps(json.dumps(USER))});
    """)
    page = ctx.new_page()
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    for _ in range(30):
        if page.evaluate("() => document.getElementById('app') && document.getElementById('app').style.display !== 'none'"):
            break
        time.sleep(0.5)
    page.evaluate("() => { if(typeof navigateTo==='function') navigateTo('autoalert'); }")
    page.wait_for_selector("#aa-situations", state="visible", timeout=20000)
    for _ in range(20):
        if page.evaluate("() => (typeof APIClient!=='undefined' && APIClient.isOnline && APIClient.isOnline())"):
            break
        time.sleep(0.5)
    time.sleep(1)
    return page

def test_confirm(browser):
    page = open_page(browser)
    info = page.evaluate("""() => {
        var cs = (typeof AUTOALERT !== 'undefined' && AUTOALERT._clusterAlerts) ? AUTOALERT._clusterAlerts() : [];
        return { clustersN: cs.length, topId: cs.length ? String(cs[0].topMember.id) : null };
    }""")
    log("CONFIRM test state: " + json.dumps(info, ensure_ascii=False))
    if not info['topId']:
        log("WARN: no cluster to confirm")
        page.context.close()
        return None
    before = alert_counts(page)
    page.screenshot(path=os.path.join(OUT_DIR, "_verify_autoalert_confirm_before.png"))
    page.click(f"button[onclick*=\"AUTOALERT.confirmAlert('{info['topId']}')\"]", timeout=5000)
    time.sleep(2)
    after = alert_counts(page)
    page.screenshot(path=os.path.join(OUT_DIR, "_verify_autoalert_confirm_after.png"))
    log("CONFIRM before: " + json.dumps(before, ensure_ascii=False))
    log("CONFIRM after : " + json.dumps(after, ensure_ascii=False))
    page.context.close()
    return before, after

def test_dismiss(browser):
    page = open_page(browser)
    target = page.evaluate("""() => {
        var cs = (typeof AUTOALERT !== 'undefined' && AUTOALERT._clusterAlerts) ? AUTOALERT._clusterAlerts() : [];
        for (var i=0;i<cs.length;i++){
            var c = cs[i];
            var m = c.members.find(x => !x.dismissed);
            if (m) return {cid: String(c.key), mid: String(m.id)};
        }
        return null;
    }""")
    log("DISMISS target: " + json.dumps(target, ensure_ascii=False))
    if not target:
        log("WARN: no member to dismiss")
        page.context.close()
        return None
    before = alert_counts(page)
    page.screenshot(path=os.path.join(OUT_DIR, "_verify_autoalert_dismiss_before.png"))
    page.click(f".aa-sit-card[data-skey='{target['cid']}']", timeout=5000)
    time.sleep(1)
    page.click(f"button[onclick*=\"AUTOALERT.dismissAlert('{target['mid']}')\"]", timeout=5000)
    time.sleep(2)
    after = alert_counts(page)
    page.screenshot(path=os.path.join(OUT_DIR, "_verify_autoalert_dismiss_after.png"))
    log("DISMISS before: " + json.dumps(before, ensure_ascii=False))
    log("DISMISS after : " + json.dumps(after, ensure_ascii=False))
    page.context.close()
    return before, after

if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        c = test_confirm(browser)
        d = test_dismiss(browser)
        browser.close()
    ok = True
    if c is None or c[1]['acknowledged'] < c[0]['acknowledged'] + 1:
        ok = False
        log("CONFIRM RESULT: FAIL")
    else:
        log("CONFIRM RESULT: PASS")
    if d is None or d[1]['resolved'] < d[0]['resolved'] + 1:
        ok = False
        log("DISMISS RESULT: FAIL")
    else:
        log("DISMISS RESULT: PASS")
    log("OVERALL: " + ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)
