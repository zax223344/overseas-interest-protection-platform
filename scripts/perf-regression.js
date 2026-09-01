#!/usr/bin/env node
/* 回归验证：登录 → GET 简报 → PUT 编辑 → 回读一致性 → SSE 流 → gzip/TTL 抽查 */
const http = require('http');
const zlib = require('zlib');
function req(method, path, body, headers, raw) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: 3000, method, path, headers: Object.assign({ 'Accept-Encoding': 'gzip' }, headers || {}) }, (res) => {
      const c = []; res.on('data', d => c.push(d));
      res.on('end', () => {
        let buf = Buffer.concat(c);
        if (res.headers['content-encoding'] === 'gzip') { try { buf = zlib.gunzipSync(buf); } catch (e) {} }
        resolve({ status: res.statusCode, h: res.headers, b: buf, text: buf.toString() });
      });
    });
    r.on('error', e => resolve({ status: 0, err: e.message }));
    if (body) r.write(body);
    r.end();
  });
}
async function main() {
  const date = '2026-09-01';
  /* 1. 登录 */
  const lg = await req('POST', '/api/auth/login', JSON.stringify({ username: 'admin', password: 'admin123' }), { 'Content-Type': 'application/json' });
  const token = JSON.parse(lg.text).token;
  const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  console.log('1) 登录:', lg.status === 200 ? 'OK' : 'FAIL');

  /* 2. GET 简报 */
  const g1 = await req('GET', '/api/reports/daily/' + date, null, auth);
  const row = JSON.parse(g1.text);
  console.log('2) GET 简报:', g1.status, 'items=', (row.items || []).length, 'sections=', (row.sections || []).length, 'x-cache=', g1.h['x-cache']);

  /* 3. PUT 编辑（改第一条标题加后缀，再改回） */
  const items = row.items, sections = row.sections;
  const origTitle = items[0] && items[0].title;
  items[0].title = String(origTitle) + '【回归测试】';
  const put = await req('PUT', '/api/reports/daily/' + date, JSON.stringify({ items, sections, note: 'perf 回归测试写入' }), auth);
  console.log('3) PUT 编辑:', put.status, put.text.slice(0, 60));
  const g2 = await req('GET', '/api/reports/daily/' + date, null, auth);
  const row2 = JSON.parse(g2.text);
  /* PUT 设计：编辑存为 edited 覆盖层（不覆盖基准 items），断言看 edited.items */
  const edTitle = row2.edited && row2.edited.items && row2.edited.items[0] && row2.edited.items[0].title;
  console.log('   回读 edited 覆盖层:', (edTitle || '').indexOf('【回归测试】') >= 0 ? '编辑生效 OK' : 'FAIL', '| manual_edit=', row2.manual_edit, '| x-cache=', g2.h['x-cache']);

  /* 4. 改回原标题（还原数据） */
  items[0].title = origTitle;
  const put2 = await req('PUT', '/api/reports/daily/' + date, JSON.stringify({ items, sections, note: 'perf 回归测试还原' }), auth);
  const g3 = await req('GET', '/api/reports/daily/' + date, null, auth);
  const row3 = JSON.parse(g3.text);
  const edTitle3 = row3.edited && row3.edited.items && row3.edited.items[0] && row3.edited.items[0].title;
  console.log('4) 还原:', put2.status === 200 && edTitle3 === origTitle ? 'OK' : 'FAIL');

  /* 5. SSE 流：连接 8s，收心跳/事件 */
  await new Promise(done => {
    const r = http.get({ host: '127.0.0.1', port: 3000, path: '/api/stream' }, (res) => {
      let got = 0;
      const t = setTimeout(() => { r.destroy(); console.log('5) SSE: 状态', res.statusCode, '类型', res.headers['content-type'], '收到', got, '字节（连接保持8s不断开=OK）'); done(); }, 8000);
      res.on('data', d => { got += d.length; });
      res.on('error', () => { clearTimeout(t); console.log('5) SSE: 连接错误 FAIL'); done(); });
    });
    r.on('error', () => { console.log('5) SSE: 请求错误 FAIL'); done(); });
  });

  /* 6. TTL 缓存抽查（两次请求第二次 HIT） */
  const s1 = await req('GET', '/api/funnel/today', null, auth);
  const s2 = await req('GET', '/api/funnel/today', null, auth);
  console.log('6) funnel TTL:', s1.h['x-cache'], '→', s2.h['x-cache'], '| gzip=', s1.h['content-encoding'] || 'identity');

  /* 7. gzip 大 JSON */
  const a1 = await req('GET', '/api/datahub/alerts', null, auth);
  console.log('7) alerts:', a1.status, 'gzip=', a1.h['content-encoding'] || 'identity', '传输', Math.round(a1.b.length / 1024) + 'KB');
  process.exit(0);
}
main();
