/* ===== 微信公众平台扫码登录工具（独立进程，2026-08-21）=====
 * 用途：登录 mp.weixin.qq.com 公众号后台，保存会话供 wechat-oa.js 采集器使用。
 * 运行方式（不要常驻，登录成功即退出）：
 *   node server/wechat-login.js            # 无头模式：二维码写入状态文件，由系统页面展示
 *   node server/wechat-login.js --headed   # 有头模式：本机弹窗扫码（调试用）
 *
 * 状态文件协议（server/.cache/）：
 *   wechat-login-state.json  {state, qr(dataURL), message, updated}
 *     state: starting | waiting(等扫码) | scanned(已扫待确认) | success | timeout | error
 *   wechat-session.json      {token, savedAt, storageState}   ← 采集器读取这个
 *
 * 零模拟铁律：只保存真实登录产生的 cookie/token，绝不伪造。
 * 安全：session 文件含登录凭证，仅本机使用，已在 .gitignore 覆盖的 .cache 目录内。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '.cache');
const STATE_FILE = path.join(CACHE_DIR, 'wechat-login-state.json');
const SESSION_FILE = path.join(CACHE_DIR, 'wechat-session.json');
const HEADED = process.argv.includes('--headed');
const TIMEOUT_MS = 5 * 60 * 1000;          // 整个登录流程最长 5 分钟
const QR_REFRESH_MS = 3 * 1000;            // 二维码轮询间隔

/* 微信公众号平台是国内站点：必须直连，清掉工具 shell 可能注入的代理环境 */
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
delete process.env.NODE_OPTIONS;

function _writeState(patch) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    let cur = {};
    try { cur = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
    const next = Object.assign({}, cur, patch, { updated: new Date().toISOString() });
    if (patch.qr === undefined && cur.qr) next.qr = cur.qr;   // 未显式更新则保留旧二维码
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  } catch (e) { /* 状态文件失败不阻断登录 */ }
}

async function main() {
  _writeState({ state: 'starting', qr: '', message: '正在启动登录浏览器…' });
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'zh-CN'
  });
  const page = await context.newPage();
  const deadline = Date.now() + TIMEOUT_MS;
  let lastQr = '';

  try {
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    _writeState({ state: 'waiting', message: '请用微信扫描二维码（在系统「公众号采集」面板或本机弹窗中）' });

    while (Date.now() < deadline) {
      /* 1) 登录成功判定：跳转到后台首页（URL 带 token） */
      const url = page.url();
      const m = url.match(/[?&]token=(\d+)/);
      if (m) {
        const storageState = await context.storageState();
        fs.writeFileSync(SESSION_FILE, JSON.stringify({
          token: m[1],
          savedAt: new Date().toISOString(),
          storageState
        }, null, 2));
        _writeState({ state: 'success', qr: '', message: '登录成功，会话已保存（token=' + m[1] + '）' });
        console.log('[WECHAT-LOGIN] 登录成功，token=' + m[1] + '，会话已保存到 ' + SESSION_FILE);
        await browser.close().catch(() => {});
        process.exit(0);
      }

      /* 2) 二维码抓取：登录页 img[src*="qrcode"]，base64 化后写状态文件供网页展示 */
      try {
        const qr = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img'));
          const img = imgs.find(i => /qrcode/i.test(i.src || '')) ||
                      document.querySelector('.login__type__container__scan__qrcode, .qrcode img, .qrcode_img');
          if (!img || !img.src) return '';
          return img.src;
        });
        if (qr && qr !== lastQr) {
          /* 在页面上下文里 fetch（带会话 cookie），转 dataURL */
          const dataUrl = await page.evaluate(async (u) => {
            try {
              const r = await fetch(u, { credentials: 'include' });
              const b = await r.blob();
              return await new Promise(res => {
                const fr = new FileReader();
                fr.onload = () => res(fr.result);
                fr.onerror = () => res('');
                fr.readAsDataURL(b);
              });
            } catch (e) { return ''; }
          }, qr);
          if (dataUrl && dataUrl.startsWith('data:image')) {
            lastQr = qr;
            _writeState({ state: 'waiting', qr: dataUrl, message: '请用微信扫描二维码（二维码约2分钟过期，会自动刷新）' });
          }
        }
        /* 3) 已扫待确认：页面上二维码区域切换为"扫描成功"提示 */
        const scanned = await page.evaluate(() => {
          const t = document.body ? document.body.innerText : '';
          return /扫描成功|请在微信中确认|确认登录/.test(t) && !/二维码已过期/.test(t);
        }).catch(() => false);
        if (scanned) _writeState({ state: 'scanned', message: '已扫码，请在手机微信上点击「确认登录」' });
      } catch (e) { /* 页面跳转中 evaluate 会抛错，下一轮重试 */ }

      await new Promise(r => setTimeout(r, QR_REFRESH_MS));
      /* 页面可能被微信主动刷新（二维码过期），若在登录页则重新加载拿新码 */
      if (!/token=\d+/.test(page.url())) {
        const bodyLen = await page.evaluate(() => document.body ? document.body.innerHTML.length : 0).catch(() => 0);
        if (!bodyLen) await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
    }
    _writeState({ state: 'timeout', qr: '', message: '5 分钟内未完成扫码，登录超时，请重新发起' });
    console.warn('[WECHAT-LOGIN] 登录超时');
  } catch (e) {
    _writeState({ state: 'error', qr: '', message: '登录异常：' + (e && e.message || e) });
    console.error('[WECHAT-LOGIN] 异常:', e && e.message || e);
  } finally {
    await browser.close().catch(() => {});
  }
  process.exit(1);
}

main();
