/* 直打搜狗检索页，dump 原始解析结果（含 ts），定位"9条全被判旧"根因 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const w = require('./wechat-oa.js');
const httpGet = w._internals.httpGet;

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }

(async () => {
  /* 拿 cookie */
  const r0 = await httpGet('https://weixin.sogou.com/', { timeout: 10000, headers: { 'Referer': 'https://www.sogou.com/' } });
  const setC = r0.headers['set-cookie'] || [];
  const cookies = setC.map(c => String(c).split(';')[0]).filter(s => s.includes('=')).join('; ');
  console.log('cookies:', cookies ? 'OK' : 'FAIL');

  const url = 'https://weixin.sogou.com/weixin?type=2&query=' + encodeURIComponent('刺猬安全出海');
  const r = await httpGet(url, { timeout: 12000, headers: { 'Cookie': cookies, 'Referer': 'https://weixin.sogou.com/' } });
  const html = r.body || '';
  console.log('html size:', html.length, 'antispider:', /antispider|请输入验证码|异常访问/.test(html));

  const blocks = html.match(/<div class="txt-box">[\s\S]*?<\/li>/g) || [];
  console.log('blocks:', blocks.length);
  const now = Date.now();
  for (const b of blocks.slice(0, 10)) {
    const m = b.match(/<h3>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const title = stripHtml(m[2].replace(/<!--red_beg-->|<!--red_end-->/g, ''));
    const sp = b.match(/<div class="s-p">([\s\S]*?)<\/div>/);
    let ts = 0, spRaw = '';
    if (sp) {
      spRaw = sp[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      const tm = sp[1].match(/timeConvert\('?(\d{10})'?\)/) || sp[1].match(/t="(\d{10})"/);
      if (tm) ts = parseInt(tm[1], 10) * 1000;
    }
    const ageH = ts ? ((now - ts) / 3600000).toFixed(1) + 'h' : 'N/A';
    console.log(' -', ts ? new Date(ts).toISOString().slice(0, 16) : '(no ts)', '(age ' + ageH + ')', '|', title.slice(0, 50));
    console.log('   spRaw:', spRaw);
  }
  process.exit(0);
})().catch(e => { console.error('EX', e.message); process.exit(1); });
