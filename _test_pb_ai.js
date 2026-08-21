/* 端到端测试 AI 预案推荐：登录 → 调 /api/llm/run kind=playbook-recommend */
const http = require('http');
function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, j: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, raw: d.slice(0, 300) }); } });
    });
    r.on('error', reject);
    r.setTimeout(150000, () => { r.destroy(); reject(new Error('timeout')); });
    if (data) r.write(data);
    r.end();
  });
}
(async () => {
  /* 登录拿 token（尝试常见路径） */
  let token = '';
  for (const p of ['/api/auth/login', '/api/login']) {
    try {
      const r = await req('POST', p, { username: 'admin', password: 'admin123' });
      if (r.j && (r.j.token || (r.j.data && r.j.data.token))) { token = r.j.token || r.j.data.token; console.log('登录成功 via', p); break; }
      else console.log(p, '->', r.status, JSON.stringify(r.j || r.raw).slice(0, 120));
    } catch (e) { console.log(p, 'ERR', e.message); }
  }
  if (!token) { console.log('无 token，无法测 AI 接口'); process.exit(0); }
  const pbs = [
    { id: 'PB-001', title: '恐怖袭击应急响应预案', type: '安全风险', level: 'I级' },
    { id: 'PB-002', title: '绑架劫持事件处置预案', type: '安全风险', level: 'I级' },
    { id: 'PB-010', title: '重大交通事故应急响应预案', type: '运营风险', level: 'II级' },
    { id: 'PB-020', title: '舆情危机应对预案', type: '舆情风险', level: 'III级' },
    { id: 'PB-099', title: '通用应急响应预案', type: '综合', level: 'IV级' }
  ];
  const cases = [
    { name: '死亡铁路探访（用户点名案例，应判 none 或舆情）', alert: { title: '探访泰缅"死亡铁路"，见证日本军国主义侵略罪行 - 华侨网', desc: '记者探访泰缅死亡铁路遗址，见证二战时期日本军国主义强征劳工修筑铁路的侵略罪行，缅怀遇难华侨劳工。', country: '中国', level: 'red', type: '运营风险' } },
    { name: '俾路支爆炸（真实恐袭，应荐恐怖袭击预案）', alert: { title: '瓜达尔港附近发生针对中资企业车队的爆炸袭击', desc: '俾路支解放军宣称对瓜达尔港附近中资企业车队路边炸弹袭击负责，造成中方人员受伤。', country: '巴基斯坦', level: 'red', type: '安全风险' } }
  ];
  for (const c of cases) {
    console.log('\n=== ' + c.name + ' ===');
    try {
      const r = await req('POST', '/api/llm/run', { kind: 'playbook-recommend', alert: c.alert, playbooks: pbs }, token);
      console.log('HTTP', r.status, '|', JSON.stringify(r.j || r.raw).slice(0, 400));
    } catch (e) { console.log('ERR', e.message); }
  }
})();
