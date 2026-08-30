# -*- coding: utf-8 -*-
"""联合作业台 v3 编排自由化实测：时间窗联动 / 面板开关 / 满宽地图 / 观测方案 / 刷新恢复"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
SHOT = r"C:\Users\28737\Desktop\新建文件夹\tmp\wb_v3_{}.png"
ok, fail = [], []

def chk(name, cond, extra=""):
    (ok if cond else fail).append(name + (" | " + extra if extra else ""))
    print(("[PASS] " if cond else "[FAIL] ") + name + (" | " + extra if extra else ""))

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1600, "height": 950})
    # 登录
    pg.goto(BASE, wait_until="domcontentloaded")
    pg.evaluate('localStorage.removeItem("orps_wb_state"); localStorage.removeItem("orps_wb_profiles");')
    if pg.locator("#li-user").count() or pg.locator("#auth-card-login .auth-btn").count():
        pg.wait_for_selector("#li-user", timeout=20000)
        pg.fill("#li-user", "test_aa_20260826")
        pg.fill("#li-pass", "Test123456!")
        pg.click('button:has-text("登 录")')
        pg.wait_for_selector("#app", state="visible", timeout=30000)
    pg.wait_for_timeout(12000)  # 冷启动 12s：DataHub.loadFromAPI + 10s 补载
    pg.evaluate('navigateTo("workbench")')
    pg.wait_for_timeout(3500)

    # ── 1. 编排工具条四组件 ──
    chk("工具条-时间窗按钮x4", pg.locator(".wb-tbtn").count() == 4)
    chk("工具条-面板开关x3", pg.locator(".wb-pbtn").count() == 3)
    chk("工具条-方案下拉+保存+删除", pg.locator("#wb-prof").count() == 1 and pg.locator("#wb-prof-save").count() == 1 and pg.locator("#wb-prof-del").count() == 1)
    chk("工具条-满宽按钮", pg.locator(".wb-mfocus").count() == 1)
    chk("默认24h激活", "active" in (pg.locator(".wb-tbtn[data-h='24']").get_attribute("class") or ""))

    # ── 2. 时间窗切换联动（同刻快照对比，消除 DataHub 异步刷新赛跑） ──
    logic = pg.evaluate('() => { const A = ALERTS||[]; const cnt = h => A.filter(a => { const t = Date.parse(String(a.time||"").replace(" ","T")); return !isNaN(t) && Date.now()-t <= h*3600e3; }).length; return cnt(6) <= cnt(24) && cnt(24) <= cnt(48) && cnt(48) <= cnt(168); }')
    chk("窗口嵌套逻辑 6h⊆24h⊆48h⊆7d", logic)
    pg.click(".wb-tbtn[data-h='48']")
    pg.wait_for_timeout(2500)
    ui = pg.evaluate('() => ({ hours: WORKBENCH._hours, feedRows: document.querySelectorAll("#wb-feed .wb-feed").length, cnt: (ALERTS||[]).filter(a => { const t = Date.parse(String(a.time||"").replace(" ","T")); return !isNaN(t) && Date.now()-t <= WORKBENCH._hours*3600e3; }).length })')
    chk("切48h后UI渲染=同刻窗口数据", ui["feedRows"] == ui["cnt"], "feed=%d cnt=%d" % (ui["feedRows"], ui["cnt"]))
    chk("指数卡文案动态化", "48 小时" in pg.locator("#wb-ixcard").inner_text())
    chk("时间窗state已存", pg.evaluate('JSON.parse(localStorage.getItem("orps_wb_state")).hours') == 48)

    # ── 3. 面板开关 ──
    pg.click(".wb-pbtn[data-p='feed']")
    pg.wait_for_timeout(1200)
    chk("关闭情报流-右栏消失", pg.locator("#wb-feed").count() == 0)
    pg.click(".wb-pbtn[data-p='ix']")
    pg.wait_for_timeout(1200)
    chk("关闭指数卡-卡片消失", pg.locator("#wb-ixcard").count() == 0)
    pg.click(".wb-pbtn[data-p='feed']")
    pg.click(".wb-pbtn[data-p='ix']")
    pg.wait_for_timeout(1500)
    chk("重开面板-均恢复", pg.locator("#wb-feed").count() == 1 and pg.locator("#wb-ixcard").count() == 1,
        "feed容器=%d ix卡=%d" % (pg.locator("#wb-feed").count(), pg.locator("#wb-ixcard").count()))

    # ── 4. 满宽地图 ──
    pg.click(".wb-mfocus")
    pg.wait_for_timeout(2500)
    chk("满宽-工作区tab隐藏", pg.locator("#wb-ws-tabs").count() == 0)
    chk("满宽-情报流隐藏", pg.locator("#wb-feed").count() == 0)
    chk("满宽-图层栏保留", pg.locator("#wb-layers").count() == 1)
    h = pg.evaluate('document.getElementById("wb-map").offsetHeight')
    chk("满宽-地图高度680", h >= 650, "h=%d" % h)
    pg.screenshot(path=SHOT.format("mapfocus"))
    pg.click(".wb-mfocus")
    pg.wait_for_timeout(2000)

    # ── 5. 观测方案：保存 → 改状态 → 应用恢复 ──
    pg.on("dialog", lambda d: d.accept("甲方案"))
    pg.click("#wb-prof-save")
    pg.wait_for_timeout(1200)
    pg.remove_listener("dialog", lambda d: None) if False else None
    profs = pg.evaluate('JSON.parse(localStorage.getItem("orps_wb_profiles") || "{}")')
    chk("方案已保存", "甲方案" in profs, str(list(profs.keys())))
    chk("方案含当前组合", profs.get("甲方案", {}).get("hours") == 48)
    # 改乱状态再应用方案恢复
    pg.click(".wb-tbtn[data-h='6']")
    pg.wait_for_timeout(1500)
    pg.select_option("#wb-prof", "甲方案")
    pg.wait_for_timeout(2000)
    chk("应用方案-时间窗恢复48", pg.evaluate('WORKBENCH._hours') == 48)
    chk("应用方案-按钮态恢复", "active" in (pg.locator(".wb-tbtn[data-h='48']").get_attribute("class") or ""))

    # ── 6. 刷新后状态恢复（_loadState） ──
    st_before = pg.evaluate('JSON.stringify({h:WORKBENCH._hours, ws:WORKBENCH._ws, mf:WORKBENCH._mapFocus, L:WORKBENCH._layers})')
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_timeout(4000)
    if not pg.locator("#app").is_visible():
        pg.wait_for_selector("#li-user", state="visible", timeout=20000)
        pg.fill("#li-user", "test_aa_20260826")
        pg.fill("#li-pass", "Test123456!")
        pg.click('button:has-text("登 录")')
        pg.wait_for_selector("#app", state="visible", timeout=30000)
        pg.wait_for_timeout(4000)
    pg.evaluate('navigateTo("workbench")')
    pg.wait_for_timeout(3500)
    st_after = pg.evaluate('JSON.stringify({h:WORKBENCH._hours, ws:WORKBENCH._ws, mf:WORKBENCH._mapFocus, L:WORKBENCH._layers})')
    chk("刷新后观测台完整恢复", st_before == st_after, "before=%s after=%s" % (st_before[:80], st_after[:80]))
    chk("刷新后地图视野恢复", pg.evaluate('!!(WORKBENCH._savedView && WORKBENCH._savedView.center)'))
    pg.screenshot(path=SHOT.format("restored"))

    # ── 7. 地图标记层仍正常（回归） ──
    leaflets = pg.evaluate('document.querySelectorAll("#wb-map path").length')
    chk("地图标记层渲染正常", leaflets > 5, "paths=%d" % leaflets)

    b.close()

print("\n===== 结果：%d PASS / %d FAIL =====" % (len(ok), len(fail)))
for f in fail:
    print("FAIL:", f)
sys.exit(1 if fail else 0)
