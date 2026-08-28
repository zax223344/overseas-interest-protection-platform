/* 验证国别锚定 GNews 查询源返回质量（沙特/哈萨克/刚果） */
const netx = require('./netx');
const scrapers = require('./scrapers');
(async () => {
  const tests = [
    ['沙特·安全冲突', '(Saudi Arabia) attack OR conflict OR coup OR terrorism OR protest OR kidnapping'],
    ['哈萨克·安全冲突', '(Kazakhstan) attack OR conflict OR coup OR terrorism OR protest OR kidnapping'],
    ['刚果金·安全冲突', '(Congo) attack OR conflict OR coup OR terrorism OR protest OR kidnapping'],
    ['印尼·中资经贸', '(Indonesia) China investment OR infrastructure OR railway OR port OR mining OR trade']
  ];
  for (const [label, q] of tests) {
    try {
      const r = await netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:1d') + '&hl=en-US&gl=US&ceid=US:en',
        { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } });
      const text = r && r.ok ? await r.text() : '';
      const items = text ? (scrapers.parseRss(text) || []).slice(0, 4) : [];
      console.log('=== ' + label + ': ' + items.length + ' 条 ===');
      items.forEach(it => console.log('  ' + String(it.title || '').slice(0, 90)));
    } catch (e) { console.log('=== ' + label + ' ERR: ' + e.message + ' ==='); }
  }
  process.exit(0);
})();
