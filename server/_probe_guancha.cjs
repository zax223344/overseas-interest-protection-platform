/* 验证观察者网用户文章列表接口候选 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const netx = require('./netx');
(async () => {
  const cands = [
    'https://user.guancha.cn/user/get-published-list?uid=1199281&page=1&size=15',
    'https://user.guancha.cn/user/get-published-list?uid=1199281&page_no=1&page_size=15',
    'https://user.guancha.cn/user/home?uid=1199281'
  ];
  for (const u of cands) {
    try {
      const r = await netx.smartFetch(u, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' } });
      const txt = await r.text();
      console.log('===', u.slice(0, 80), '=> HTTP', r.status, 'size', txt.length);
      console.log(txt.slice(0, 400).replace(/\s+/g, ' '));
    } catch (e) { console.log('===', u.slice(0, 60), 'ERR', e.message); }
  }
  process.exit(0);
})();
