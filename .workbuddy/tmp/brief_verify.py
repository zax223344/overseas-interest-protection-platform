# -*- coding: utf-8 -*-
# 2026-09-05 五项指令回归：领导要报速览 / 时间线 / 相似事件 / 信源分级 / 录入类别数
import re, json, sys, os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
SHOT = r"C:\Users\28737\Desktop\新建文件夹\.workbuddy\shots"
os.makedirs(SHOT, exist_ok=True)

CHARS = 'ABCDEGHJKMPSTUX4789'
FONT = {
 'A':['01110','10001','10001','11111','10001','10001','10001'],
 'B':['11110','10001','10001','11110','10001','10001','11110'],
 'C':['01110','10001','10000','10000','10000','10001','01110'],
 'D':['11110','10001','10001','10001','10001','10001','11110'],
 'E':['11111','10000','10000','11110','10000','10000','11111'],
 'G':['01110','10001','10000','10111','10001','10001','01111'],
 'H':['10001','10001','10001','11111','10001','10001','10001'],
 'J':['00111','00010','00010','00010','00010','10010','01100'],
 'K':['10001','10010','10100','11000','10100','10010','10001'],
 'M':['10001','11011','10101','10101','10001','10001','10001'],
 'P':['11110','10001','10001','11110','10000','10000','10000'],
 'S':['01111','10000','10000','01110','00001','00001','11110'],
 'T':['11111','00100','00100','00100','00100','00100','00100'],
 'U':['10001','10001','10001','10001','10001','10001','01110'],
 'X':['10001','10001','01010','00100','01010','10001','10001'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
}
PX = 3
Y_BASE = 22 - 21 / 2.0 + 1.5

def solve_group(rot, cx, cy, rects):
    pts = [(x + 1.5, y + 1.5) for x, y in rects]
    min_x = min(p[0] for p in pts)
    grid = set()
    for ox, oy in pts:
        grid.add((int(round((ox - min_x) / PX)), int(round((oy - Y_BASE) / PX))))
    best = (None, -10**9)
    for ch in CHARS:
        fset = set((c, r) for r in range(7) for c in range(5) if FONT[ch][r][c] == '1')
        for dc in (-2, -1, 0, 1, 2):
            for dr in (-2, -1, 0, 1, 2):
                moved = set((c + dc, r + dr) for c, r in fset)
                score = len(grid & moved) * 2 - len(grid - moved) - len(moved - grid)
                if score > best[1]:
                    best = (ch, score)
    return best[0]

results = []
def ok(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    print(("[PASS] " if cond else "[FAIL] ") + name + (" | " + str(extra) if extra else ""))

def wait_brief_data(page, timeout_s=40):
    for _ in range(int(timeout_s / 2)):
        page.wait_for_timeout(2000)
        st = page.evaluate("(() => ({ data: !!LEADERBRIEF._data, evs: document.querySelectorAll('#brief-root .lb-ev').length }))()")
        if st.get("data") and st.get("evs", 0) >= 0:
            return st
    return {}

def wait_insight_modal(page, timeout_s=25):
    for _ in range(int(timeout_s / 2)):
        page.wait_for_timeout(2000)
        has = page.evaluate("(() => { const m = document.getElementById('insight-modal'); return !!m && !(m.textContent || '').includes('真实库检索中'); })()")
        if has:
            return True
    return False

def modal_text(page):
    return page.evaluate("(() => { const m = document.getElementById('insight-modal'); return m ? (m.textContent || '').replace(/\\s+/g, ' ').slice(0, 150) : '(no modal)'; })()")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("#li-captcha-img svg", timeout=45000)
    page.wait_for_timeout(500)
    svg = page.evaluate("() => document.querySelector('#li-captcha-img svg').outerHTML")
    cap_id = page.evaluate("() => AUTH._captchaId || ''")
    groups = re.findall(r'<g transform="rotate\((-?[\d.]+) ([\d.]+) ([\d.]+)\)"[^>]*>(.*?)</g>', svg, re.S)
    text = ""
    for rot, cx, cy, cells in groups:
        rects = [(float(x), float(y)) for x, y in re.findall(r'<rect x="([\d.]+)" y="([\d.]+)"', cells)]
        text += solve_group(float(rot), float(cx), float(cy), rects)
    print("CAPTCHA:", text, "id=", cap_id[:8])
    if len(text) != 4:
        print("验证码解码失败"); browser.close(); sys.exit(2)
    page.fill("#li-user", "admin")
    page.fill("#li-pass", "admin123")
    page.fill("#li-captcha", text)
    page.click("#btn-login")
    page.wait_for_timeout(6000)
    auth = page.evaluate("() => typeof AUTH !== 'undefined' && !!AUTH.user")
    ok("登录成功", auth)
    if not auth:
        page.screenshot(path=SHOT + "/brief-login-fail.png")
        browser.close(); sys.exit(2)

    # ---- ① 领导要报速览视图 ----
    sb = page.evaluate("() => Array.from(document.querySelectorAll('.sb-item[data-view=brief]')).map(e => e.textContent.trim())")
    ok("侧边栏「领导要报速览」入口存在", sb and "领导要报速览" in (sb[0] if sb else ""), sb)
    page.evaluate("navigateTo('brief')")
    st = wait_brief_data(page)
    print("BRIEF LOADED:", st)
    ok("领导要报数据装配完成（真实库）", bool(st.get("data")))
    ok("view-brief 容器可见", page.evaluate("() => { const v = document.getElementById('view-brief'); return !!v && v.style.display !== 'none'; }"))
    kpi = page.evaluate("""(() => {
        const els = Array.from(document.querySelectorAll('#brief-root .lb-kpi'));
        return els.map(e => (e.querySelector('.l')||{}).textContent + '=' + (e.querySelector('.v')||{}).textContent);
    })()""")
    print("KPI:", kpi)
    ok("KPI 大数字条渲染（今日总量/红色/橙色/涉华）", len(kpi) >= 4, kpi)
    evs = page.evaluate("() => document.querySelectorAll('#brief-root .lb-ev').length")
    ok("红橙要情 TOP5 事件卡渲染", evs >= 1, evs)
    advice = page.evaluate("() => document.querySelectorAll('#brief-root .lb-adv').length")
    ok("一句话决策建议装配", advice >= 1, advice)
    page.screenshot(path=SHOT + "/brief-view.png", full_page=False)

    # ---- ② 时间线弹窗 ----
    page.evaluate("() => { const b = document.querySelector('#brief-root .lb-mini'); if (b) b.click(); }")
    wait_insight_modal(page)
    stages = page.evaluate("""(() => {
        const m = document.getElementById('insight-modal');
        if (!m) return [];
        const names = [];
        m.querySelectorAll('div').forEach(d => {
            const t = d.textContent || '';
            if (/^(首次采集|多源印证|预警入列|审核入库|处置跟踪|归档复盘)/.test(t.trim()) && t.length < 200) names.push(t.trim().slice(0, 40));
        });
        return names;
    })()""")
    print("STAGES:", stages[:8], "| MODAL:", modal_text(page))
    ok("时间线弹窗打开且六阶段渲染", len(stages) >= 5, len(stages))
    page.screenshot(path=SHOT + "/brief-lifecycle.png", full_page=False)
    page.evaluate("() => INSIGHT.close()")
    page.wait_for_timeout(500)

    # ---- ③ 相似事件弹窗 ----
    page.evaluate("() => { const b = document.querySelectorAll('#brief-root .lb-mini')[1]; if (b) b.click(); }")
    wait_insight_modal(page)
    sim = page.evaluate("""(() => {
        const m = document.getElementById('insight-modal');
        if (!m) return { modal: false };
        const txt = m.textContent || '';
        return { modal: true, hasMatch: /相似历史事件/.test(txt), has90: /90\s*天/.test(txt) || /近 ?90/.test(txt), n: (txt.match(/原文/g)||[]).length };
    })()""")
    print("SIM:", sim, "| MODAL:", modal_text(page))
    ok("相似事件弹窗打开", sim.get("modal"))
    ok("相似匹配统计区渲染（近90天口径）", sim.get("has90"))
    page.screenshot(path=SHOT + "/brief-similar.png", full_page=False)
    page.evaluate("() => INSIGHT.close()")
    page.wait_for_timeout(500)

    # ---- ④ 信源分级弹窗 ----
    page.evaluate("() => { const b = Array.from(document.querySelectorAll('#brief-root .lb-btn')).find(x => x.textContent.includes('信源分级')); if (b) b.click(); }")
    wait_insight_modal(page)
    sc = page.evaluate("""(() => {
        const m = document.getElementById('insight-modal');
        if (!m) return { modal: false };
        const txt = m.textContent || '';
        return { modal: true, rows: (txt.match(/30天 \\d+ 条/g)||[]).length, hasNote: /分级口径/.test(txt) };
    })()""")
    print("SRC-CRED:", sc, "| MODAL:", modal_text(page))
    ok("信源分级弹窗打开", sc.get("modal"))
    ok("信源分级列表渲染（≥10 行）", (sc.get("rows") or 0) >= 10, sc.get("rows"))
    ok("分级口径说明展示", sc.get("hasNote"))
    page.screenshot(path=SHOT + "/brief-srccred.png", full_page=False)
    page.evaluate("() => INSIGHT.close()")
    page.wait_for_timeout(500)

    # ---- ⑤ 预警详情弹窗：时间线/相似事件按钮 ----
    page.evaluate("navigateTo('alerts')")
    page.wait_for_timeout(6000)
    btns = page.evaluate("""(() => {
        try {
            const items = (typeof ALERTS !== 'undefined' && ALERTS.length) ? ALERTS : [];
            if (!items.length) return { n: 0 };
            /* 优先选可溯源 intel_data 的 SRV-/裸数字 id 条目（时间戳 id 走标题回落，覆盖面窄） */
            const pick = items.find(x => /^(?:SRV-)?\\d{1,9}$/.test(String(x.id || ''))) || items[0];
            showAlertDetail(pick.id);
            const bd = document.getElementById('modal-bd');
            if (!bd) return { n: 0 };
            return { n: 1, id: String(pick.id), hasTL: bd.textContent.includes('时间线'), hasSim: bd.textContent.includes('相似事件'), tt: (document.getElementById('modal-tt')||{}).textContent };
        } catch (e) { return { n: 0, err: String(e) }; }
    })()""")
    print("ALERT DETAIL BTN:", btns)
    ok("预警详情弹窗含「⏱ 时间线」按钮", btns.get("hasTL"), btns.get("err", btns.get("tt", "")))
    ok("预警详情弹窗含「🔍 相似事件」按钮", btns.get("hasSim"))
    # 点击时间线按钮验证联动
    if btns.get("n"):
        page.evaluate("() => { const b = Array.from(document.querySelectorAll('#modal-bd button')).find(x => x.textContent.includes('时间线')); if (b) b.click(); }")
        wait_insight_modal(page, 35)
        tl = page.evaluate("() => !!document.getElementById('insight-modal') && (document.getElementById('insight-modal').textContent || '').includes('首次采集')")
        ok("预警详情→时间线弹窗联动", tl, modal_text(page))
        page.screenshot(path=SHOT + "/brief-alert-tl.png", full_page=False)
        page.evaluate("() => INSIGHT.close()")

    # ---- ⑥ 情报录入类别数（应为真实类别数，非 12） ----
    page.evaluate("navigateTo('manual-entry')")
    page.wait_for_timeout(5000)
    cat = page.evaluate("""(() => {
        const t = document.body.textContent || '';
        const m = t.match(/第一步[^\\n]{0,40}(\\d{2})\\s*类/);
        return m ? m[1] : null;
    })()""")
    print("CAT COUNT:", cat)
    ok("情报录入显示真实类别数（≠12）", cat is not None and cat != "12", cat)
    page.screenshot(path=SHOT + "/brief-manualentry.png", full_page=False)

    # ---- ⑦ 专题分析中心（reportsc）：频次选择（日/周/月/年）+ 标准版/公文版切换 ----
    page.evaluate("navigateTo('reportsc')")
    gov = {}
    for _ in range(15):
        page.wait_for_timeout(2000)
        gov = page.evaluate("""(() => {
            const freqSel = document.getElementById('rc-freq');
            const opts = freqSel ? Array.from(freqSel.options).map(o => o.textContent.trim()) : [];
            return { hasFreq: !!freqSel, opts,
                     hasStdBtn: !!document.querySelector('[data-act=ver-std]'),
                     hasGovBtn: !!document.querySelector('[data-act=ver-gov]'),
                     curType: (document.querySelector('.rc-nav .on, #rc-nav .on') || {}).textContent || '' };
        })()""")
        if gov.get("hasFreq") and gov.get("hasGovBtn") is not None:
            break
    print("REPORTS TOOLBAR:", gov)
    ok("简报阅读器含「标准版/公文版」版本切换", gov.get("hasStdBtn") and gov.get("hasGovBtn"), gov)
    freq_str = " | ".join(gov.get("opts") or [])
    print("FREQ OPTS:", freq_str[:300])
    ok("频次选择含 每日/每周/每月/每年", all(k in freq_str for k in ["每日", "每周", "每月", "每年"]), freq_str[:120])
    page.screenshot(path=SHOT + "/brief-reports.png", full_page=False)

    real_errors = [e for e in errors if "Favicon" not in e]
    ok("无页面JS错误", len(real_errors) == 0, real_errors[:6])
    browser.close()

fails = [r for r in results if not r[1]]
print("\n===== SUMMARY: %d pass / %d fail =====" % (len(results) - len(fails), len(fails)))
for name, _, extra in fails:
    print("FAIL:", name, extra)
sys.exit(1 if fails else 0)
