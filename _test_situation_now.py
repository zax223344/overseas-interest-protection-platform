import json, os, sys, time, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1920, 'height': 1080})
    page = context.new_page()
    page.on('console', lambda msg: print('CONSOLE:', msg.text) if msg.type == 'error' else None)
    page.on('pageerror', lambda err: print('PAGEERROR:', err))

    page.goto('http://127.0.0.1:3000/#situation')
    page.wait_for_load_state('networkidle')
    time.sleep(1)

    # login with trial account
    page.fill('#username', 'test_aa_20260826')
    page.fill('#password', 'Test123456!')
    page.click('button[type=submit]')
    page.wait_for_load_state('networkidle')
    time.sleep(2)

    # ensure situation view
    page.goto('http://127.0.0.1:3000/#situation')
    page.wait_for_load_state('networkidle')
    time.sleep(3)

    page.screenshot(path=os.path.join(ROOT, '_screenshot_situation_now.png'), full_page=False)
    print('screenshot saved')
    browser.close()
