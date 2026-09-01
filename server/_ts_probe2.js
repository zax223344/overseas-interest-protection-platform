/* 模拟服务端 _translateAny 首选链：auto 源语言 TranSmart + _translationOk 判定 */
const netx = require('./netx.js');
const TEXTS = [
  'Senate approves Sherry Rehmans resolution for PIMS fire probe',
  'Trishuli floods collapse Krishnabhir section of Prithvi Highway',
  'Controlled experiment testing translation pipeline stability'
];
function _translationOk(src, dst) {
  const a = String(src || '').trim(), b = String(dst || '').trim();
  if (!a || !b) return false;
  if (b === a) return false;
  const cjk = (b.match(/[一-龥]/g) || []).length;
  if (cjk < 2) return false;
  if (cjk / b.length < 0.15) return false;
  const ratio = b.length / Math.max(1, a.length);
  if (ratio < 0.2 || ratio > 4) return false;
  const enWords = b.match(/[A-Za-z]{3,}/g) || [];
  const longEnPhrases = enWords.filter(function(w) { return w.length >= 4; }).length;
  if (longEnPhrases >= 3 && cjk / b.length < 0.5) return false;
  const untranslatedPhrases = /US designates|UK-based|Action as foreign|terrorist group|as foreign|designates.*as|said in a statement|according to.*said/i;
  if (untranslatedPhrases.test(b) && cjk / b.length < 0.6) return false;
  return true;
}
(async () => {
  for (const t of TEXTS) {
    const body = JSON.stringify({
      header: { fn: 'auto_translation', client_key: 'browser-chrome-120.0.0-Windows 10-' + Date.now() },
      type: 'plain', model_category: 'normal',
      source: { lang: 'auto', text_list: ['', t, ''] },
      target: { lang: 'zh' }
    });
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
      const ok = _translationOk(t, zh);
      const cjk = (String(zh).match(/[一-龥]/g) || []).length;
      console.log('TEXT: ' + t.slice(0, 50));
      console.log('  raw  => ' + JSON.stringify(String(zh).slice(0, 80)));
      console.log('  cjk=' + cjk + ' len=' + String(zh).length + ' cjkRatio=' + (cjk / Math.max(1, String(zh).length)).toFixed(2) + ' lenRatio=' + (String(zh).length / t.length).toFixed(2) + ' | _translationOk = ' + ok);
    } catch (e) {
      console.log('TEXT: ' + t.slice(0, 50) + '\n  ERR: ' + e.message);
    }
    await new Promise(s => setTimeout(s, 500));
  }
  process.exit(0);
})();
