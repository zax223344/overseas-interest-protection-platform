/* 验证镜像站可采性：鼎泰安元 list 页 + 观察者网郑和号文章页取作者主页 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const netx = require('./netx');

async function getText(url, enc) {
  const r = await netx.smartFetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
  const buf = Buffer.from(await r.arrayBuffer());
  try { return new TextDecoder(enc || 'utf-8').decode(buf); } catch (e) { return buf.toString('utf8'); }
}

(async () => {
  console.log('=== A. 鼎泰安元 新闻列表 /list/?1_1.html ===');
  try {
    const html = await getText('http://www.dtaygroup.com/list/?1_1.html', 'gbk');
    console.log('size', html.length);
    const links = [...html.matchAll(/href="([^"]*content\?\d+\.html)"[^>]*>([^<]{4,80})/g)].slice(0, 10);
    links.forEach(m => console.log(' -', m[1], '|', m[2].trim()));
    const dates = [...html.matchAll(/20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}/g)].slice(0, 10);
    console.log(' dates:', dates.map(d => d[0]).join(', '));
  } catch (e) { console.log('ERR', e.message); }

  console.log('=== B. 观察者网 郑和号文章页取作者主页 ===');
  try {
    const html = await getText('https://user.guancha.cn/main/content?id=1650375');
    console.log('size', html.length);
    const home = html.match(/href="(\/user\/home[^"]*)"/) || html.match(/href="(https?:\/\/user\.guancha\.cn\/user\/home[^"]*)"/);
    console.log('author home:', home ? home[1] : 'not found');
    const nick = html.match(/class="author[^"]*"[^>]*>([^<]{2,30})/) || html.match(/郑和号/);
    console.log('nick hit:', nick ? (nick[1] || nick[0]).slice(0, 30) : 'no');
    if (home) {
      const h2 = await getText(home[1].startsWith('http') ? home[1] : 'https://user.guancha.cn' + home[1]);
      console.log('home size', h2.length);
      const arts = [...h2.matchAll(/content\?id=(\d+)[^>]*>([^<]{4,60})/g)].slice(0, 8);
      arts.forEach(m => console.log(' -', m[1], '|', m[2].trim()));
      const dts = [...h2.matchAll(/20\d{2}-\d{2}-\d{2}/g)].slice(0, 8);
      console.log(' dates:', dts.map(d => d[0]).join(', '));
    }
  } catch (e) { console.log('ERR', e.message); }
  process.exit(0);
})();
