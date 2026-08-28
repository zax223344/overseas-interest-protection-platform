/* 验证四种搜狗检索策略哪个能拿到刺猬安全最新文章 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const w = require('./wechat-oa.js');
const httpGet = w._internals.httpGet;
function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(); }

async function search(cookies, label, url) {
  const r = await httpGet(url, { timeout: 12000, headers: { 'Cookie': cookies, 'Referer': 'https://weixin.sogou.com/' } });
  const html = r.body || '';
  const anti = /antispider|请输入验证码|异常访问/.test(html);
  const blocks = html.match(/<div class="txt-box">[\s\S]*?<\/li>/g) || [];
  console.log('=== ' + label + ' === size ' + html.length + ' anti ' + anti + ' blocks ' + blocks.length);
  const now = Date.now();
  let fresh = 0;
  for (const b of blocks.slice(0, 6)) {
    const m = b.match(/<h3>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const title = stripHtml(m[2].replace(/<!--red_beg-->|<!--red_end-->/g, ''));
    const sp = b.match(/<div class="s-p">([\s\S]*?)<\/div>/);
    let ts = 0;
    if (sp) { const tm = sp[1].match(/timeConvert\('?(\d{10})'?\)/) || sp[1].match(/t="(\d{10})"/); if (tm) ts = parseInt(tm[1], 10) * 1000; }
    const ageH = ts ? ((now - ts) / 3600000).toFixed(0) : '?';
    if (ts && now - ts < 7 * 864e5) fresh++;
    console.log(' -', ts ? new Date(ts).toISOString().slice(0, 16) : '(no ts)', '(' + ageH + 'h)', '|', title.slice(0, 46));
  }
  console.log(' 7天内新鲜: ' + fresh + '/' + blocks.length);
  return blocks.length;
}

(async () => {
  const r0 = await httpGet('https://weixin.sogou.com/', { timeout: 10000, headers: { 'Referer': 'https://www.sogou.com/' } });
  const cookies = (r0.headers['set-cookie'] || []).map(c => String(c).split(';')[0]).filter(s => s.includes('=')).join('; ');
  console.log('cookies OK');

  await search(cookies, 'A. query=刺猬安全', 'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent('刺猬安全'));
  await new Promise(r => setTimeout(r, 8000));
  await search(cookies, 'B. query=刺猬安全出海&tsn=1(一天内)', 'https://weixin.sogou.com/weixin?type=2&tsn=1&query=' + encodeURIComponent('刺猬安全出海'));
  await new Promise(r => setTimeout(r, 8000));
  await search(cookies, 'C. query=刺猬海外安全日报', 'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent('刺猬海外安全日报'));
  await new Promise(r => setTimeout(r, 8000));
  await search(cookies, 'D. query=刺猬安全出海&page=2', 'https://weixin.sogou.com/weixin?type=2&page=2&query=' + encodeURIComponent('刺猬安全出海'));
  process.exit(0);
})().catch(e => { console.error('EX', e.message); process.exit(1); });
