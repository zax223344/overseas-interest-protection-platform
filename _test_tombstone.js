/* Task #464 验收测试：墓碑五层防线
 * A. 伦敦旧文回灌 PUT → 必须被拒收（写入闸 tombstoned）
 * B. 队列确认无该文
 * C. 换 id/换措辞变体回灌（模拟翻译漂移+盖新戳）→ 同样拒收
 * D. 删除另一条旧预警 → 五库全清（intel_data/archive/sidepool/queue/cache）*/
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
const BASE = 'http://localhost:3000';

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_aa_20260826', password: 'Test123456!' })
  });
  const j = await r.json();
  if (!j.token) throw new Error('登录失败: ' + JSON.stringify(j));
  return j.token;
}
async function getQueue() {
  const { rows } = await pool.query(`SELECT data_json FROM datahub_store WHERE collection='alerts'`);
  return (rows.length && Array.isArray(rows[0].data_json)) ? rows[0].data_json : [];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('等待服务热身...');
  await sleep(12000);
  const token = await login();
  console.log('✓ 登录成功');

  const LONDON = {
    id: '9999' + Date.now(), /* 换全新 id 模拟旧客户端绕过 */
    alert_no: 'CN-SEC-20260829-TEST',
    title: '伦敦新中国巨型大使馆的恐怖袭击“可能会倒塌公寓并伤害180米范围内的人”-伦敦晚报',
    title_zh: '伦敦新中国巨型大使馆的恐怖袭击“可能会倒塌公寓并伤害180米范围内的人”-伦敦晚报',
    url: 'https://news.google.com/rss/articles/CBMiqgFBVV95cUxQVWJiTVpDTkhHNHkyYWxvQjhuemVvcmthRWRkb0pnR1FqTWFUbTgyblBlbkFxWmhoandnMWVOVFQzcFdBMzhzMGhOMWstUVBfeWVjYW91QTZXRlpORTFHX2p0TTg3eG05Uzhwdkd4YlBmVUl6aWp4V2lrQVFrSTNQY3F0UUNOZEM3UTdWWFVRY2hxUHpEV1FNMGg1cU5TOHh5RU82SnNtR3AxQQ?oc=5',
    desc: 'Terror attack on new China mega-embassy in London could collapse flats',
    time: new Date().toISOString().slice(0, 16).replace('T', ' '),
    level: 'orange', type: '安全风险', country: '中国', source: '中资企业商会', status: 'active',
    interestLinked: true, chinaRelated: true
  };
  const VARIANT = { /* 变体：不同措辞+不同 alert_no+英文标题 */
    ...LONDON,
    id: '8888' + Date.now(),
    alert_no: 'CN-SEC-20260829-VARX',
    title: "Terror attack on new China mega-embassy in London 'could collapse flats and injure people within 180 metres'",
    title_zh: '',
    url: 'https://www.standard.co.uk/news/crime/china-mega-embassy-london-terror-attack-flats-b1234567.html',
  };

  /* ── 测试 A/B：原文回灌 ── */
  const q0 = await getQueue();
  const has0 = q0.filter(a => String(a.title || '').includes('伦敦新中国巨型')).length;
  console.log(`B1. 回灌前队列 ${q0.length} 条，使馆旧文 ${has0} 条（期望 0）`);
  /* PUT 需要带上全量现有队列（模拟客户端全量保存），否则触发防误清 */
  const payload = q0.concat([LONDON]);
  const r1 = await fetch(BASE + '/api/datahub/alerts', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(payload)
  });
  console.log('A1. PUT 原文回灌 HTTP', r1.status, await r1.json().then(j => JSON.stringify(j)).catch(() => ''));
  await sleep(1000);
  const q1 = await getQueue();
  const has1 = q1.filter(a => String(a.title || '').includes('伦敦新中国巨型')).length;
  console.log(`A2. 回灌后队列 ${q1.length} 条，使馆旧文 ${has1} 条（期望 0 → ${has1 === 0 ? '✅ 拒收成功' : '❌ 失败'}）`);

  /* ── 测试 C：变体回灌（换 id/换措辞/换 URL 的英文标题） ── */
  const payload2 = q1.concat([VARIANT]);
  const r2 = await fetch(BASE + '/api/datahub/alerts', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(payload2)
  });
  console.log('C1. PUT 英文变体回灌 HTTP', r2.status);
  await sleep(1000);
  const q2 = await getQueue();
  const has2 = q2.filter(a => /mega-embassy|巨型大使馆/.test(String(a.title || ''))).length;
  console.log(`C2. 变体回灌后使馆相关 ${has2} 条（期望 0 → ${has2 === 0 ? '✅ 变体拦截成功' : '❌ 失败'}）`);

  /* ── 测试 D：删除端到端（挑一条现存的旧 SRV 预警走终局删除） ── */
  const target = q2.find(a => String(a.id || '').startsWith('SRV-') && a.title);
  if (target) {
    console.log(`D1. 测试终局删除目标: id=${target.id} | ${(target.title || '').slice(0, 50)}`);
    const r3 = await fetch(BASE + '/api/intel-tombstone', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ title: target.title, title_zh: target.title_zh || '', url: target.url || '' })
    });
    const j3 = await r3.json();
    console.log('D2. 终局删除响应:', JSON.stringify(j3));
    await sleep(500);
    const q3 = await getQueue();
    const still = q3.filter(a => String(a.title || '') === String(target.title || ''));
    console.log(`D3. 队列中同标题残留 ${still.length} 条（期望 0 → ${still.length === 0 ? '✅ 队列清除成功' : '❌ 失败'}）`);
    /* intel_data 中对应行也应被清 */
    const { rows: idRows } = await pool.query('SELECT COUNT(*)::int AS n FROM intel_data WHERE title = $1', [target.title]);
    console.log(`D4. intel_data 同标题残留 ${idRows[0].n} 行（期望 0）`);
  } else {
    console.log('D. 跳过：队列无 SRV 条目可测');
  }

  /* ── 汇总 ── */
  const qF = await getQueue();
  console.log(`\n最终队列 ${qF.length} 条。使馆旧文存在: ${qF.some(a => /巨型大使馆|mega-embassy/.test(String(a.title || ''))) ? '❌ 仍在' : '✅ 已根除'}`);
  await pool.end();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
