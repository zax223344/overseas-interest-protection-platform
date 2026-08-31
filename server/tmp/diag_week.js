const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query(`SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD(DY)') d, count(*) c,
    count(*) FILTER (WHERE data_json->>'data_type' LIKE '%security%' OR data_json->>'data_type' LIKE '%terror%' OR data_json->>'data_type' LIKE '%conflict%') sec
    FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= '2026-08-23'::date
      AND created_at AT TIME ZONE 'Asia/Shanghai' < '2026-08-31'::date
    GROUP BY to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD(DY)') ORDER BY 1`);
  console.log('日期 | 入库 | 安全类占比');
  r.rows.forEach(x => console.log(x.d, '|', x.c, '|', (100*x.sec/x.c).toFixed(0)+'%'));
  // sidepool 情况: 查今天被 cat-structure 降级的量
  const sp = await pool.query(`SELECT count(*) c FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= '2026-08-30'::date AND (data_json->>'sidepool')='1'`);
  console.log('今日 sidepool 标记:', sp.rows[0].c);
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
