import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        # Inject admin auth to bypass login
        await context.add_init_script("""
            localStorage.setItem('orps_user', JSON.stringify({name:'testadmin',role:'admin'}));
            localStorage.setItem('orps_acct_testadmin', JSON.stringify({user:'testadmin',pass:'test123',status:'approved',role:'admin',regTime:new Date().toLocaleString('zh-CN')}));
        """)
        await page.goto('http://localhost:3000/?t=240', wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(8000)
        # Wait for app visible
        try:
            await page.wait_for_selector('#app', state='visible', timeout=10000)
        except Exception as e:
            print('App not visible:', e)
            await page.screenshot(path='_test_country_cap_app.png')
            await browser.close()
            return
        # Ensure we are logged in (auth overlay hidden)
        overlay = await page.locator('#auth-overlay').is_visible()
        print('auth-overlay visible:', overlay)
        if overlay:
            await page.fill('#li-user', 'testadmin')
            await page.fill('#li-pass', 'test123')
            await page.click('button:has-text("登 录")')
            await page.wait_for_timeout(2500)
        # Navigate to situation overview if not default
        try:
            await page.evaluate("if(typeof navigateTo==='function') navigateTo('situation')")
        except Exception as e:
            print('navigateTo error:', e)
        await page.wait_for_timeout(3000)
        # Wait for ALERTS to populate and force re-render
        for _ in range(10):
            has_alerts = await page.evaluate("typeof ALERTS!=='undefined' && ALERTS.length>0")
            if has_alerts:
                break
            await page.wait_for_timeout(1000)
        await page.evaluate("""
            (function(){
                try{ SITUATION.renderLiveStats(); }catch(e){ console.error(e); }
                try{ SITUATION.renderIntelPanels(); }catch(e){ console.error(e); }
            })()
        """)
        await page.wait_for_timeout(2000)
        # Test _capPerCountry with synthetic data
        synthetic_test = await page.evaluate("""
            (function(){
                if(typeof AVIEW==='undefined' || !AVIEW._capPerCountry) return {error:'AVIEW._capPerCountry missing'};
                var list=[
                    {id:1,title_zh:'尼泊尔洪水致100人死亡',country:'尼泊尔',level:'red',time:'2026-08-27T10:00:00Z'},
                    {id:2,title_zh:'尼泊尔山洪暴发多人失踪',country:'尼泊尔',level:'orange',time:'2026-08-27T09:00:00Z'},
                    {id:3,title_zh:'尼泊尔山体滑坡阻断道路',country:'尼泊尔',level:'blue',time:'2026-08-27T08:00:00Z'},
                    {id:4,title_zh:'尼日利亚绑架危机升级',country:'尼日利亚',level:'red',time:'2026-08-27T10:00:00Z'},
                    {id:5,title_zh:'尼日利亚总统下令营救',country:'尼日利亚',level:'orange',time:'2026-08-27T09:00:00Z'},
                    {id:6,title_zh:'刚果金发生涉中国公民绑架事件',country:'刚果民主共和国',level:'red',time:'2026-08-27T10:00:00Z'}
                ];
                var capped=AVIEW._capPerCountry(list,1);
                return {
                    in:list.length,
                    out:capped.length,
                    countries:capped.map(function(a){return a.country;}),
                    ids:capped.map(function(a){return a.id;})
                };
            })()
        """)
        print('Synthetic cap test:', synthetic_test)
        # Check real ALERTS country distribution after cap
        real_test = await page.evaluate("""
            (function(){
                if(typeof ALERTS==='undefined') return {error:'ALERTS missing'};
                var pool=ALERTS.filter(function(a){return a.status!=='resolved';});
                var merged=(typeof AVIEW!=='undefined'&&AVIEW._mergeEvents)?AVIEW._mergeEvents(pool,'fuzzy'):pool;
                var capped=(typeof AVIEW!=='undefined'&&AVIEW._capPerCountry)?AVIEW._capPerCountry(merged,1):merged;
                var cnt=function(arr){var o={};arr.forEach(function(a){var c=a.country||'未知';o[c]=(o[c]||0)+1;});return o;};
                return {
                    total:ALERTS.length,
                    active:pool.length,
                    merged:merged.length,
                    capped:capped.length,
                    topCountries:cnt(capped),
                    nepalBefore:merged.filter(function(a){return (a.title_zh||a.title||'').indexOf('尼泊尔')>=0 || (a.country||'')==='尼泊尔';}).length,
                    nepalAfter:capped.filter(function(a){return (a.title_zh||a.title||'').indexOf('尼泊尔')>=0 || (a.country||'')==='尼泊尔';}).length,
                    nigeriaBefore:merged.filter(function(a){return (a.title_zh||a.title||'').indexOf('尼日利亚')>=0 || (a.country||'')==='尼日利亚';}).length,
                    nigeriaAfter:capped.filter(function(a){return (a.title_zh||a.title||'').indexOf('尼日利亚')>=0 || (a.country||'')==='尼日利亚';}).length,
                    drcAfter:capped.filter(function(a){return ((a.title_zh||a.title||'').indexOf('刚果')>=0 || (a.country||'')==='刚果民主共和国' || (a.country||'')==='刚果金');}).length,
                    nepalItems:capped.filter(function(a){return (a.title_zh||a.title||'').indexOf('尼泊尔')>=0;}).map(function(a){return {country:a.country,title:(a.title_zh||a.title||'').slice(0,40)};}),
                    nigeriaItems:capped.filter(function(a){return (a.title_zh||a.title||'').indexOf('尼日利亚')>=0 || (a.title_zh||a.title||'').indexOf('尼日尔')>=0;}).map(function(a){return {country:a.country,title:(a.title_zh||a.title||'').slice(0,40)};})
                };
            })()
        """)
        print('Real ALERTS cap test:', real_test)
        # DOM check: count distinct rows containing country keyword, not string occurrences
        dom_test = await page.evaluate("""
            (function(){
                var alerts=document.getElementById('sit-alerts');
                var live=document.getElementById('globe-intel-live');
                function distinctCountryRows(el, kw){
                    if(!el) return 0;
                    return Array.from(el.querySelectorAll('.sit-alert-row')).filter(function(r){ var text=r.innerText||''; return text.indexOf(kw)>=0; }).length;
                }
                function extractItems(el, kws){
                    if(!el) return [];
                    return Array.from(el.querySelectorAll('.sit-alert-row')).map(function(r){
                        var text=r.innerText||'';
                        var o={text:text.slice(0,80)};
                        kws.forEach(function(k){ o[k]=text.indexOf(k)>=0?1:0; });
                        return o;
                    });
                }
                return {
                    sitAlertsExists:!!alerts,
                    globeIntelExists:!!live,
                    nepalRowsInAlerts:distinctCountryRows(alerts,'尼泊尔'),
                    nigeriaRowsInAlerts:distinctCountryRows(alerts,'尼日利亚'),
                    nigerRowsInAlerts:distinctCountryRows(alerts,'尼日尔'),
                    nepalRowsInGlobe:distinctCountryRows(live,'尼泊尔'),
                    nigeriaRowsInGlobe:distinctCountryRows(live,'尼日利亚'),
                    nigerRowsInGlobe:distinctCountryRows(live,'尼日尔'),
                    alertItems:extractItems(alerts,['尼泊尔','尼日利亚','尼日尔','俄罗斯'])
                };
            })()
        """)
        print('DOM test:', dom_test)
        await page.screenshot(path='_test_country_cap.png', full_page=True)
        await browser.close()

asyncio.run(main())
