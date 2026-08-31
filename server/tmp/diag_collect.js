const {Pool} = require('pg');
const pool = new Pool({connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const q = async (sql) => (await pool.query(sql)).rows;
  const days = await q(`SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') d, count(*) c
    FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - interval '3 day')
    GROUP BY 1 ORDER BY 1`);
  console.log('=== 近3天逐日入库(北京时间) ===');
  days.forEach(r => console.log(r.d, r.c));
  const hr = await q(`SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') d,
    floor(extract(hour from created_at AT TIME ZONE 'Asia/Shanghai')/6)*6 hb, count(*) c
    FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - interval '2 day')
    GROUP BY 1,2 ORDER BY 1,2`);
  console.log('=== 近2天分6小时桶 ===');
  hr.forEach(r => console.log(r.d, String(r.hb).padStart(2,'0')+'-'+String(r.hb+6).padStart(2,'0')+'h', r.c));
  const src = await q(`SELECT COALESCE(data_json->>'_sourceType','(空)') s, count(*) c
    FROM intel_data WHERE created_at >= now() - interval '24 hour' GROUP BY 1 ORDER BY c DESC LIMIT 15`);
  console.log('=== 最近24h通道分布 ===');
  src.forEach(r => console.log(r.s, r.c));
  const h6 = await q(`SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','MM-DD HH24:00') h, count(*) c
    FROM intel_data WHERE created_at >= now() - interval '8 hour' GROUP BY 1 ORDER BY 1`);
  console.log('=== 最近8小时逐小时 ===');
  h6.forEach(r => console.log(r.h, r.c));
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
