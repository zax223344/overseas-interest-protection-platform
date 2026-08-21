require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appPath = path.join(__dirname, '..', 'app.js');
const appSrc = fs.readFileSync(appPath, 'utf8');

const ctx = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Promise,
  parseInt, parseFloat, isNaN, isFinite, Infinity, NaN, undefined,
  window: {}, document: { createElement: () => ({}) },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: {}, navigator: {}, history: {},
  setTimeout, setInterval, clearTimeout, clearInterval,
  alert: () => {}, confirm: () => true, prompt: () => null,
  fetch: () => Promise.resolve({ json: () => [], text: () => '' }),
  WebSocket: class { constructor(){} },
  showToast: () => {},
  _jsErrors: []
};
ctx.self = ctx.window;
ctx.window.addEventListener = () => {};
ctx.window.removeEventListener = () => {};
ctx.window.localStorage = ctx.localStorage;
ctx.window.location = ctx.location;
ctx.window.navigator = ctx.navigator;
ctx.window.document = ctx.document;
vm.createContext(ctx);

try {
  vm.runInContext(appSrc, ctx, { timeout: 60000 });
} catch (e) {
  console.log('eval stopped (expected):', e.message);
}

console.log('keys sample:', Object.keys(ctx).filter(k => /COUNTRIES|ENTERPRISES|WARNING|CHOKE|CORRIDOR|PREDICT/.test(k)));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'orps',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS
});

(async () => {
  const client = await pool.connect();
  try {
    const seed = {
      countries: ctx.COUNTRIES,
      enterprises: ctx.ENTERPRISES,
      warning_rules: ctx.WARNING_RULES,
      chokepoints: ctx.CHOKEPOINTS,
      corridors: ctx.CORRIDORS,
      predictions: ctx.PREDICTIONS || []
    };
    for (const [col, data] of Object.entries(seed)) {
      if (!Array.isArray(data)) {
        console.log('SKIP', col, typeof data);
        continue;
      }
      const res = await client.query('SELECT id FROM datahub_store WHERE collection = $1', [col]);
      if (res.rows.length === 0) {
        await client.query('INSERT INTO datahub_store (collection, data_json) VALUES ($1, $2)', [col, JSON.stringify(data)]);
        console.log('INSERT', col, data.length);
      } else {
        await client.query('UPDATE datahub_store SET data_json = $1 WHERE collection = $2', [JSON.stringify(data), col]);
        console.log('UPDATE', col, data.length);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
