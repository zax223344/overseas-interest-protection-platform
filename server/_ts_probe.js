/* TranSmart 文本依赖性诊断：同一时刻测失败文本与对照文本 */
const netx = require('./netx.js');
const TEXTS = [
  'Senate approves Sherry Rehmans resolution for PIMS fire probe',
  'Trishuli floods collapse Krishnabhir section of Prithvi Highway',
  'A quick brown fox jumps over the lazy dog near riverbank'
];
(async () => {
  for (const t of TEXTS) {
    const body = JSON.stringify({
      header: { fn: 'auto_translation', client_key: 'browser-chrome-120.0.0-Windows 10-' + Date.now() },
      type: 'plain', model_category: 'normal',
      source: { lang: 'en', text_list: ['', t, ''] },
      target: { lang: 'zh' }
    });
    const t0 = Date.now();
    try {
      const r = await netx.smartPost('https://transmart.qq.com/api/imt', {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://transmart.qq.com/zh-CN/index'
        },
        body
      });
      const j = await r.json();
      const zh = (j.auto_translation || []).filter(Boolean).join('').trim();
      console.log('[' + (Date.now() - t0) + 'ms] ' + t.slice(0, 45) + '\n   => ' + JSON.stringify(String(zh).slice(0, 70)));
    } catch (e) {
      console.log('[' + (Date.now() - t0) + 'ms] ' + t.slice(0, 45) + '\n   ERR: ' + e.message + (e.cause ? ' | cause: ' + String(e.cause.code || e.cause.message || e.cause) : ''));
    }
    await new Promise(s => setTimeout(s, 500));
  }
  process.exit(0);
})();
