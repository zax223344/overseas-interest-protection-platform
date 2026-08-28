"""Debug _mergeEvents as used by renderLiveStats."""
import sys, traceback
from playwright.sync_api import sync_playwright

BASE_URL = 'http://127.0.0.1:3000'
USER = 'test_aa_20260826'
PASS = 'Test123456!'

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1400, 'height': 900})
        page = context.new_page()
        page.on('console', lambda msg: errors.append(f"[{msg.type}] {msg.text}"))
        page.on('pageerror', lambda exc: errors.append(f"[pageerror] {exc}"))

        page.goto(BASE_URL + '/', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#li-user', timeout=20000)
        page.fill('#li-user', USER)
        page.fill('#li-pass', PASS)
        page.click('button:has-text("登 录")')
        page.wait_for_selector('#sb-autoalert-count', timeout=30000)

        page.goto(BASE_URL + '/#situation', wait_until='networkidle', timeout=60000)
        page.wait_for_selector('#sit-alerts', timeout=20000)
        page.wait_for_timeout(3000)

        # Simulate renderLiveStats merge
        result = page.evaluate('''() => {
            if(typeof AVIEW === 'undefined' || !ALERTS) return null;
            var pool=ALERTS.filter(function(a){return a.status!=='resolved';});
            var _cnRe=/中国|中资|中企|中方|华人|华侨|一带一路|涉华|对华|Chinese|China|CPEC/i;
            var _corrRe=/俾路支|瓜达尔|中巴经济走廊|CPEC|沙盖|奎达|霍尔木兹|红海|亚丁湾|曼德|胡塞|萨赫勒|马里|尼日尔|布基纳|阿富汗|喀布尔|叙利亚|也门|伊拉克|索马里|黎巴嫩|加沙|巴勒斯坦/i;
            var _val=function(a){try{return AVIEW._alertValue(a);}catch(e){return {score:0};}};
            var _tier=function(a){var t=String(a.title||'')+String(a.title_zh||'');if(a.chinaNegative||a._chinaNegative)return 0;if(_cnRe.test(t))return 1;if(_corrRe.test(t+String(a.country||'')))return 2;return 3;};
            var _lvW={red:4000,orange:3000,yellow:2000,blue:1000};
            var _tierW={0:1000,1:800,2:500,3:0};
            var _score=function(a){return (_lvW[a.level]||0)+(_tierW[_tier(a)]||0)+_val(a).score;};
            var sortedAlerts=pool.slice().sort(function(a,b){
              var sa=_score(a),sb=_score(b);if(sa!==sb)return sb-sa;
              return String(b.time||'').localeCompare(String(a.time||''));
            });
            var before=sortedAlerts.length;
            var merged=AVIEW._mergeEvents(sortedAlerts,'fuzzy');
            return {
              before: before,
              after: merged.length,
              nepal: merged.filter(a => /尼泊尔|Nepal/i.test(a.country||a.title_zh||a.title||'')).length,
              russia: merged.filter(a => /俄罗斯|Russia/i.test(a.country||a.title_zh||a.title||'')).length,
              first8: merged.slice(0,8).map(a => ({title:(a.title_zh||a.title||'').slice(0,60), country:a.country, key:AVIEW._eventKeyFuzzy(a), merged:a._mergedN||1}))
            };
        }''')
        print('Merge sim result:', result)

        browser.close()

    if errors:
        print('--- errors ---')
        for e in errors[:20]: print(e)

if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
