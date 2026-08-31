const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query("SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') d, count(*) c FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= '2026-08-23'::date AND created_at AT TIME ZONE 'Asia/Shanghai' < '2026-08-31'::date GROUP BY 1 ORDER BY 1");
  const wd = ['日','一','二','三','四','五','六'];
  console.log('日期 | 星期 | 入库');
  r.rows.forEach(x => { const dt = new Date(x.d + 'T00:00:00+08:00'); console.log(x.d, '| 周' + wd[dt.getDay()], '|', x.c); });
  const sp = await pool.query("SELECT count(*) c FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= '2026-08-30'::date AND data_json->>'sidepool' = '1'");
  console.log('今日被类别结构帽降sidepool:', sp.rows[0].c);
  const dt2 = await pool.query("SELECT data_json->>'data_type' t, count(*) c FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= '2026-08-30'::date GROUP BY 1 ORDER BY c DESC LIMIT 12");
  console.log('今日类别分布:'); dt2.rows.forEach(x => console.log(' ', x.t, x.c));
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
