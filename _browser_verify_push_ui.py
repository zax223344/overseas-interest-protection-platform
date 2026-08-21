import json, time, os, subprocess
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
    env = os.environ.copy(); env['JWT_SECRET']='orps_jwt_secret_key_2026_overseas_protection_platform'
    r = subprocess.run([NODE, '-e', code], cwd=os.path.join(OUT_DIR,'server'), capture_output=True, text=True, env=env)
    return r.stdout.strip()

TOKEN = gen_token()
USER = {"name":"admin","role":"admin","isTrial":False,"expireTime":None}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={'width':1280,'height':800})
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
    page.evaluate("() => { if(typeof navigateTo==='function') navigateTo('settings'); }")
    page.wait_for_selector("#push-config-card", state="visible", timeout=20000)
    for _ in range(20):
        if page.evaluate("() => (typeof APIClient!=='undefined' && APIClient.isOnline && APIClient.isOnline())"):
            break
        time.sleep(0.5)
    time.sleep(1)
    page.screenshot(path=os.path.join(OUT_DIR, "_verify_push_settings.png"))
    # verify elements exist
    has = page.evaluate("""() => {
      return {
        enabled: !!document.getElementById('pc-enabled'),
        pushOnNew: !!document.getElementById('pc-pushOnNew'),
        pushOnResolve: !!document.getElementById('pc-pushOnResolve'),
        smtpHost: !!document.getElementById('pc-smtpHost'),
        dingWebhook: !!document.getElementById('pc-dingWebhook')
      };
    }""")
    print(json.dumps(has, ensure_ascii=False))
    browser.close()
