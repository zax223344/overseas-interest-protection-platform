const {Pool} = require('pg');
const pool = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5432/orps_db'});
(async () => {
  const t = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='datahub_store'");
  console.log('datahub_store 列:', t.rows.map(r => r.column_name + '(' + r.data_type + ')').join(', '));
  await pool.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
