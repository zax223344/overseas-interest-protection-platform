(async()=>{
  const pg=require('pg');
  const pool=new pg.Pool({host:'localhost',port:5432,database:'orps_db',user:'orps_user',password:'orps_dev_pass_2026'});
  const r=await pool.query("SELECT data_json->>'content_zh' as cz,data_json->>'title_zh' tz FROM intel_data WHERE collect_time >= '2026-08-31' AND collect_time < '2026-09-01' AND data_json->>'content_zh' LIKE '%Attaque%' LIMIT 1");
  console.log('raw content_zh (first 500):',JSON.stringify(String(r.rows[0].cz).slice(0,500)));
  console.log('title:',r.rows[0].tz);
  /* check after my strip what happens */
  const stripped=String(r.rows[0].cz).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
  console.log('stripped result:',stripped);
  process.exit(0);
})();