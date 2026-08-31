/* 独立验证：用 server 同款 netx + 解码逻辑，对一条真实 Google News URL 验真 */
const netx = require('C:/Users/28737/Desktop/新建文件夹/server/netx.js');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function decode(gurl) {
  const m = String(gurl).match(/\/(?:articles|read)\/([A-Za-z0-9_-]+)/);
  if (!m) return 'URL 不匹配';
  const b = m[1];
  const page = await netx.smartFetch('https://news.google.com/rss/articles/' + b, { timeout: 12000, headers: { 'User-Agent': UA } });
  if (!page || !page.ok) return 'GET 文章页失败 status=' + (page && page.status);
  const html = await page.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/), ts = html.match(/data-n-a-ts="([^"]+)"/);
  if (!sg || !ts) return '页面无签名参数（len=' + html.length + '）';
  const payload = [["Fbv4je", '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"' + b + '",' + ts[1] + ',"' + sg[1] + '"]']];
  const resp = await netx.smartPost('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    timeout: 15000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body: 'f.req=' + encodeURIComponent(JSON.stringify(payload)),
  });
  if (!resp || !resp.ok) return 'POST 失败 status=' + (resp && resp.status);
  const txt = await resp.text();
  const parts = txt.split('\n\n');
  if (parts.length < 2) return '应答无分段';
  let outer;
  try { outer = JSON.parse(parts[1]); } catch (e) { return '外层 JSON 解析失败: ' + txt.slice(0, 120); }
  const inner = outer && outer[0] && outer[0][2];
  if (typeof inner !== 'string') return 'inner 非 string';
  const arr = JSON.parse(inner);
  return arr && typeof arr[1] === 'string' ? arr[1] : '无 URL';
}

(async () => {
  // 塔吉克那条（已知答案 timesca.com 2025-12-02）
  const r1 = await decode('https://news.google.com/rss/articles/CBMikgFBVV95cUxPVm5xUWo2SzM5QlhxR255N001MEZxaGI0OTV6MmpPcGlpVk5HWENLYlBUTkE3YWNLeGNlUVRNN21nQXpIMG9KY3U0RzZQRWJLQTcwRUZSNHp2OFFScnZtMlpOYXRpN2FTV3hteWwtTFhzTDZHLWFIR1R1YVNPbWlnU2k1VGV0RTRWck9pVTZLN2htZw?oc=5');
  console.log('测试1(塔吉克旧闻):', r1);
})().catch(e => console.error('ERR', e.message));
