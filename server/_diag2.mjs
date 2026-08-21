import { query } from './db.js';

const REGION = {
  latam: '拉美', africa: '非洲', centralasia: '中亚', mideast: '中东(非伊以)', europe: '欧洲', southasia: '南亚'
};
const C2R = {};
for (const r in REGION) C2R[r] = REGION[r];

const dayStart = new Date(); dayStart.setHours(0,0,0,0);

// 1. 预警中心数据源
const dh = await query("SELECT collection, updated_at, jsonb_array_length(data_json) n FROM datahub_store WHERE collection IN ('alerts','events','terror_events')");
console.log('=== 共享库(预警/态势数据源) ===');
dh.rows.forEach(r => console.log(r.collection.padEnd(14), '条数=', r.n, ' 更新=', r.updated_at));

// 2. 今日 intel_data 总 + 区域
const cty = await query(`SELECT country, COUNT(*) n FROM intel_data WHERE collect_time >= $1 GROUP BY 1 ORDER BY 2 DESC`, [dayStart]);
const rg = {}; let other = 0, total = 0;
cty.rows.forEach(r => {
  const c = r.country; total += parseInt(r.n,10);
  let mapped = null;
  for (const rk in C2R) if (c === rk || c && c.indexOf(rk) >= 0) { mapped = C2R[rk]; break; }
  if (mapped) rg[mapped] = (rg[mapped]||0) + parseInt(r.n,10); else other += parseInt(r.n,10);
});
console.log('\n=== 今日 intel_data 区域汇总 (总 '+total+') ===');
Object.entries(rg).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(k.padEnd(14), v));
console.log('其他/未映射', other);

// 3. 区域均衡器插入情况
const bal = await query(`SELECT COUNT(*) n FROM intel_data WHERE collect_time >= $1 AND source LIKE '%区域均衡%'`, [dayStart]);
console.log('\n今日 source含"区域均衡" 条数:', bal.rows[0].n);
const recent = await query(`SELECT id, country, title, collect_time, source FROM intel_data WHERE source LIKE '%区域均衡%' ORDER BY collect_time DESC LIMIT 8`);
console.log('--- 最近均衡器插入 ---');
recent.rows.forEach(r => console.log('['+r.country+']', (r.title||'').slice(0,40), '|', r.collect_time, '|', r.source));

// 4. 最近30分钟 interestLinked=true 但可能没进预警的
const recent30 = await query(`SELECT COUNT(*) n FROM intel_data WHERE collect_time >= NOW() - INTERVAL '30 minutes' AND audit_status='approved'`);
console.log('\n近30分钟入库(approved):', recent30.rows[0].n);

// 5. 均衡器数据 country 实际值抽样（看是中文还是 ISO）
const sample = await query(`SELECT DISTINCT country FROM intel_data WHERE source LIKE '%区域均衡%' LIMIT 30`);
console.log('\n均衡器数据出现的 country 值:', sample.rows.map(r=>r.country||'(空)').join(', ') || '(无)');

process.exit(0);
