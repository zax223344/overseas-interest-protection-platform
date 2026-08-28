const { Client } = require('./node_modules/pg');
const c = new Client({ host:'127.0.0.1', port:5432, database:'orps_db', user:'orps_user', password:'orps_dev_pass_2026' });
(async () => {
  await c.connect();
  const r = await c.query("SELECT jsonb_pretty(jsonb_path_query_first(data_json, '$[*] ? (@.title like_regex \"回应\" flag \"i\")')) AS a FROM datahub_store WHERE collection='alerts'");
  console.log(r.rows[0] && r.rows[0].a ? r.rows[0].a : 'not found');
  await c.end();
})().catch(e=>{console.error(e);process.exit(1);});
