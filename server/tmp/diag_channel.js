const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const r = await pool.query(`SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','MM-DD') d,
    COALESCE(data_json->>'_sourceType','(空)') s, count(*) c
    FROM intel_data WHERE created_at AT TIME ZONE 'Asia/Shanghai' >= '2026-08-28'::date
      AND created_at AT TIME ZONE 'Asia/Shanghai' < '2026-08-30'::date + interval '18 hour'
    GROUP BY 1,2`);
  const map = {};
  r.rows.forEach(x => { map[x.s] = map[x.s] || {}; map[x.s][x.d] = x.c; });
  console.log('通道 | 08-28全天 | 08-29全天 | 08-30至17点');
  Object.keys(map).sort((a,b)=>((map[b]['08-30']||0)+(map[b]['08-29']||0))-((map[a]['08-30']||0)+(map[a]['08-29']||0))).forEach(s=>{
    console.log(s, '|', map[s]['08-28']||0, '|', map[s]['08-29']||0, '|', map[s]['08-30']||0);
  });
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
