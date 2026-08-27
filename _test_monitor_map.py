import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        await context.add_init_script("""
            localStorage.setItem('orps_user', JSON.stringify({name:'testadmin',role:'admin'}));
            localStorage.setItem('orps_acct_testadmin', JSON.stringify({user:'testadmin',pass:'test123',status:'approved',role:'admin',regTime:new Date().toLocaleString('zh-CN')}));
        """)
        await page.goto('http://localhost:3000/?t=242', wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(8000)
        await page.evaluate("if(typeof navigateTo==='function') navigateTo('monitor')")
        await page.wait_for_timeout(3000)
        # Check if map container exists and has Leaflet tiles or markers
        res = await page.evaluate("""
            (function(){
                var mapEl = document.getElementById('mon-map-svg');
                var map2 = document.getElementById('mon-geoint-map');
                return {
                    monMapExists: !!mapEl,
                    monMapChildCount: mapEl ? mapEl.childElementCount : 0,
                    monMapText: mapEl ? (mapEl.innerText||'').slice(0,200) : '',
                    leafletTiles: document.querySelectorAll('.leaflet-tile').length,
                    leafletLayers: document.querySelectorAll('.leaflet-marker-icon, .leaflet-overlay-pane svg').length
                };
            })()
        """)
        print('Monitor map test:', res)
        await page.screenshot(path='_test_monitor_map.png', full_page=True)
        await browser.close()

asyncio.run(main())
