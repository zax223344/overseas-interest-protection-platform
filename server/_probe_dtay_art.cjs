/* dump 鼎泰安元文章页结构（标题/日期/正文容器） */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const netx = require('./netx');
(async () => {
  const r = await netx.smartFetch('http://www.dtaygroup.com/content/?1308.html', { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(await r.arrayBuffer());
  const html = new TextDecoder('gbk').decode(buf);
  console.log('size', html.length);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  console.log('H1:', h1 ? h1[1].replace(/<[^>]+>/g, '').trim() : 'none');
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  console.log('TITLE:', title ? title[1].trim() : 'none');
  const dm = html.match(/(?:发布时间|发布日期|时间|日期)[:：\s]*(20\d{2}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
  console.log('DATE:', dm ? dm[0] : 'not found by label');
  const anyDate = html.match(/20\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?/);
  console.log('any date:', anyDate ? anyDate[0] : 'none');
  /* 找正文容器候选 */
  ['content', 'article', 'detail', 'text', 'show'].forEach(c => {
    const m = html.match(new RegExp('<div[^>]*(?:id|class)="[^"]*' + c + '[^"]*"[^>]*>', 'i'));
    if (m) console.log('container hit:', m[0]);
  });
  /* 正文前 800 字纯文本预览 */
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n');
  const idx = text.indexOf('刚果');
  console.log('--- body preview ---');
  console.log(text.slice(Math.max(0, idx - 100), idx + 700));
  process.exit(0);
})();
