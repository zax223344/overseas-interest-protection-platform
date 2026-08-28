/* dump 鼎泰安元列表页链接结构 + 观察者网文章页作者信息 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const netx = require('./netx');
async function getText(url, enc) {
  const r = await netx.smartFetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  const buf = Buffer.from(await r.arrayBuffer());
  try { return new TextDecoder(enc || 'utf-8').decode(buf); } catch (e) { return buf.toString('utf8'); }
}
(async () => {
  const html = await getText('http://www.dtaygroup.com/list/?1_1.html', 'gbk');
  const hrefs = [...html.matchAll(/href="([^"]+)"[^>]*>([\s\S]{0,120}?)</g)].map(m => m[1] + ' || ' + m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).filter(s => s.split('||')[1].length > 6);
  hrefs.slice(0, 20).forEach(s => console.log(s.slice(0, 110)));
  console.log('=== guancha uid ===');
  const g = await getText('https://user.guancha.cn/main/content?id=1650375');
  const uid = g.match(/uid["'\s:=]+(\d{3,})/) || g.match(/user_id["'\s:=]+(\d{3,})/) || g.match(/\/user\/(\d{3,})/) || g.match(/"author_id"\s*:\s*"?(\d+)/);
  console.log('uid match:', uid ? uid[0].slice(0, 60) : 'none');
  const idx = g.indexOf('郑和号');
  console.log('郑和号 ctx:', idx >= 0 ? g.slice(Math.max(0, idx - 120), idx + 60).replace(/\s+/g, ' ') : 'not found');
  process.exit(0);
})();
