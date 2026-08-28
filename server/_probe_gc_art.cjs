/* 观察者网文章页正文容器 + created_at 全格式样本 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const netx = require('./netx');
(async () => {
  const r = await netx.smartFetch('https://user.guancha.cn/main/content?id=1721757', { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await r.text();
  console.log('size', html.length);
  ['article-content', 'content-txt', 'article-txt', 'content all-txt', 'review-content', 'articleContent'].forEach(c => {
    const m = html.match(new RegExp('<div[^>]*class="[^"]*' + c.replace(/ /g, '\\s*') + '[^"]*"', 'i'));
    if (m) console.log('container hit:', m[0]);
  });
  const timeM = html.match(/<time[^>]*>([^<]{4,40})<\/time>/) || html.match(/class="time[^"]*"[^>]*>([^<]{4,40})</) || html.match(/(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  console.log('time:', timeM ? timeM[1] || timeM[0] : 'none');
  /* created_at 格式样本：取列表页 15 条 */
  const lr = await netx.smartFetch('https://user.guancha.cn/user/get-published-list?uid=1199281&page=1&size=15', { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' } });
  const j = JSON.parse(await lr.text());
  (j.data.items || []).forEach(a => console.log(' -', JSON.stringify(a.created_at), '|', a.title.slice(0, 30)));
  process.exit(0);
})();
