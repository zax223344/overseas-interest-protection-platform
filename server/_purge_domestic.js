require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const gateSrc = fs.readFileSync(path.join(__dirname, '..', 'gate.js'), 'utf8');
const window = {}, self = window;
eval(gateSrc);
const GATE = window.GATE || self.GATE;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'orps',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS
});

function textOf(item) {
  if (!item) return '';
  return String(item.title || item.title_zh || '') + ' ' + String(item.desc || item.content || item.content_zh || item.description || '');
}

(async () => {
  const client = await pool.connect();
  try {
    // datahub_store
    const dh = await client.query('SELECT * FROM datahub_store');
    let totalRemoved = 0;
    for (const row of dh.rows) {
      if (!row.data_json || !Array.isArray(row.data_json)) continue;
      const before = row.data_json.length;
      const kept = [];
      for (const it of row.data_json) {
        const txt = textOf(it);
        if (!GATE.chinaOverseasGate(txt).pass && !(GATE._isProtected && GATE._isProtected(it))) {
          console.log('DROP datahub_store.' + row.collection, it.id || it.alert_id || it.alert_no, txt.slice(0, 60));
          totalRemoved++;
        } else {
          kept.push(it);
        }
      }
      if (kept.length !== before) {
        await client.query('UPDATE datahub_store SET data_json = $1 WHERE id = $2', [JSON.stringify(kept), row.id]);
        console.log('UPDATE datahub_store.' + row.collection, before, '->', kept.length);
      }
    }

    // auto_alerts
    const aa = await client.query('SELECT * FROM auto_alerts');
    for (const row of aa.rows) {
      let txt;
      if (row.data_json) txt = textOf(row.data_json);
      else txt = String(row.title || '') + ' ' + String(row.desc || '');
      if (!GATE.chinaOverseasGate(txt).pass && !(GATE._isProtected && GATE._isProtected(row))) {
        await client.query('DELETE FROM auto_alerts WHERE id = $1', [row.id]);
        console.log('DELETE auto_alerts', row.alert_id || row.id, txt.slice(0, 60));
        totalRemoved++;
      }
    }

    // alert_records
    const ar = await client.query("SELECT * FROM alert_records WHERE title ILIKE '%秦皇岛%' OR country ILIKE '%中国%'");
    for (const row of ar.rows) {
      const txt = String(row.title || '') + ' ' + String(row.notes || '');
      if (/秦皇岛|河北|海港区|国内火灾|商业单位火灾/.test(txt)) {
        await client.query('DELETE FROM alert_records WHERE id = $1', [row.id]);
        console.log('DELETE alert_records', row.alert_no || row.id, txt.slice(0, 60));
        totalRemoved++;
      }
    }

    console.log('\nTotal removed:', totalRemoved);
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
