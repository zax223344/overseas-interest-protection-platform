# -*- coding: utf-8 -*-
"""移动端汉堡菜单真实浏览器实测（移动视口 + 桌面对照）"""
import json, time, sys, os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4NzI0ODI1NSwiZXhwIjoxNzg3ODUzMDU1fQ.R5ZNjnDtQaQwkuATB8kNbvqjlfNFpjGfTw745xLOsPE"
USER = {"name":"admin","role":"admin","isTrial":False,"expireTime":None}
OUT_DIR = os.path.dirname(os.path.abspath(__file__))
results = {}

def log(msg): print(msg, flush=True)

def boot_page(p, mobile=True):
    browser = p.chromium.launch(headless=True)
    if mobile:
        ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    else:
        ctx = browser.new_context(viewport={"width":1440,"height":900})
    ctx.add_init_script(f"""
        localStorage.setItem('orps_api_token', {json.dumps(TOKEN)});
        localStorage.setItem('orps_user', {json.dumps(json.dumps(USER))});
    """)
    page = ctx.new_page()
    page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
    for _ in range(40):
        if page.evaluate("() => document.getElementById('app') && document.getElementById('app').style.display !== 'none'"):
            break
        time.sleep(0.5)
    time.sleep(1.5)
    return browser, page

def sidebar_state(page):
    return page.evaluate("""() => {
        var sb = document.getElementById('sidebar');
        if(!sb) return {exists:false};
        var cs = getComputedStyle(sb);
        var r = sb.getBoundingClientRect();
        return {
            exists: true,
            hasOpen: sb.classList.contains('open'),
            transform: cs.transform,
            transition: cs.transition,
            position: cs.position,
            zIndex: cs.zIndex,
            left: Math.round(r.left),
            width: Math.round(r.width),
            visible: r.left >= 0 && r.left < window.innerWidth
        };
    }""")

def toggle_state(page):
    return page.evaluate("""() => {
        var t = document.querySelector('.mobile-menu-toggle');
        if(!t) return {exists:false};
        var cs = getComputedStyle(t);
        var r = t.getBoundingClientRect();
        return {exists:true, display:cs.display, visible: cs.display!=='none' && r.width>0, rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
    }""")

def test_mobile():
    log("=== 移动视口 390x844 (iPhone) ===")
    with sync_playwright() as p:
        browser, page = boot_page(p, mobile=True)

        # T1: 汉堡按钮可见
        t = toggle_state(page)
        results['T1_toggle_visible_mobile'] = t.get('visible') is True
        log(f"T1 汉堡按钮可见: {results['T1_toggle_visible_mobile']}  state={t}")

        # T2: 初始侧边栏收起
        s0 = sidebar_state(page)
        results['T2_sidebar_initially_hidden'] = (s0.get('hasOpen') is False and s0.get('visible') is False)
        log(f"T2 初始侧边栏收起: {results['T2_sidebar_initially_hidden']}  state={s0}")
        page.screenshot(path=os.path.join(OUT_DIR, "_mob_1_initial.png"))

        # T3: 点击汉堡 → 滑出
        page.click(".mobile-menu-toggle", timeout=5000)
        time.sleep(0.6)  # 等动画
        s1 = sidebar_state(page)
        results['T3_sidebar_opens_on_click'] = (s1.get('hasOpen') is True and s1.get('visible') is True)
        log(f"T3 点击汉堡后滑出: {results['T3_sidebar_opens_on_click']}  state={s1}")
        page.screenshot(path=os.path.join(OUT_DIR, "_mob_2_open.png"))

        # T3b: 过渡动画是否包含 transform
        has_transform_transition = 'transform' in (s1.get('transition') or '')
        results['T3b_transform_transition'] = has_transform_transition
        log(f"T3b transition 含 transform: {has_transform_transition}  transition={s1.get('transition')}")

        # T4: 是否有专用遮罩层且 open 时可见
        overlay_info = page.evaluate("""() => {
            var ov = document.getElementById('sidebarOverlay');
            if(!ov) return {exists:false};
            var cs = getComputedStyle(ov);
            return {exists:true, display:cs.display, zIndex:cs.zIndex};
        }""")
        results['T4_overlay_shown_when_open'] = overlay_info.get('exists') is True and overlay_info.get('display') == 'block'
        log(f"T4 遮罩层 open 时显示: {results['T4_overlay_shown_when_open']}  info={overlay_info}")

        # T5: 点击菜单项后是否自动收起
        page.click(".sb-item[data-view='alerts']", timeout=5000)
        time.sleep(0.8)
        s2 = sidebar_state(page)
        results['T5_auto_collapse_after_nav'] = (s2.get('hasOpen') is False)
        log(f"T5 点击菜单项后自动收起: {results['T5_auto_collapse_after_nav']}  state={s2}")
        page.screenshot(path=os.path.join(OUT_DIR, "_mob_3_after_nav.png"))

        # T6: 再开一次，点遮罩层是否收起
        page.click(".mobile-menu-toggle", timeout=5000)
        time.sleep(0.6)
        s_open = sidebar_state(page)
        if not s_open.get('hasOpen'):
            results['T6_collapse_on_overlay_click'] = False
            log("T6 重开侧边栏失败")
        else:
            page.click("#sidebarOverlay", timeout=5000, force=True)
            time.sleep(0.6)
            s3 = sidebar_state(page)
            results['T6_collapse_on_overlay_click'] = (s3.get('hasOpen') is False)
            log(f"T6 点击遮罩层收起: {results['T6_collapse_on_overlay_click']}  state={s3}")
        page.screenshot(path=os.path.join(OUT_DIR, "_mob_4_after_overlay_click.png"))

        # T7: 打开状态下汉堡按钮仍可点击关闭（z-index 验证）
        page.click(".mobile-menu-toggle", timeout=5000)
        time.sleep(0.6)
        try:
            page.click(".mobile-menu-toggle", timeout=5000)
            time.sleep(0.6)
            s4 = sidebar_state(page)
            results['T7_toggle_closes_when_open'] = (s4.get('hasOpen') is False)
            log(f"T7 打开时再点汉堡关闭: {results['T7_toggle_closes_when_open']}  state={s4}")
        except Exception as e:
            results['T7_toggle_closes_when_open'] = False
            log(f"T7 汉堡按钮被遮挡无法点击: {e}")
        page.screenshot(path=os.path.join(OUT_DIR, "_mob_5_final.png"))

        browser.close()

def test_desktop():
    log("=== 桌面视口 1440x900 (对照) ===")
    with sync_playwright() as p:
        browser, page = boot_page(p, mobile=False)
        t = toggle_state(page)
        results['D1_toggle_hidden_desktop'] = (t.get('visible') is False)
        log(f"D1 桌面汉堡按钮隐藏: {results['D1_toggle_hidden_desktop']}  state={t}")
        s = sidebar_state(page)
        results['D2_sidebar_visible_desktop'] = (s.get('visible') is True and s.get('position') != 'fixed')
        log(f"D2 桌面侧边栏常驻可见: {results['D2_sidebar_visible_desktop']}  state={s}")
        page.screenshot(path=os.path.join(OUT_DIR, "_desk_1.png"))
        browser.close()

if __name__ == '__main__':
    test_mobile()
    test_desktop()
    log("\n===== 实测结果汇总 =====")
    fails = []
    for k, v in results.items():
        log(f"  {'PASS' if v else 'FAIL'}  {k}")
        if not v: fails.append(k)
    log(f"\nRESULT: {'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ','.join(fails)}")
    sys.exit(0 if not fails else 1)
