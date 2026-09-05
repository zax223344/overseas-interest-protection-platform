/**
 * 种子数据脚本 v2 - 使用 vm 模块提取 app.js 中的默认数据
 * 用法: node scripts/seed.js
 */
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026',
});

const DH_COLLECTIONS = [
  'countries', 'enterprises', 'alerts', 'events',
  'warning_rules', 'chokepoints', 'corridors', 'predictions',
  'terror_events', 'china_security', 'playbooks', '_pending_reviews'
];

async function seed() {
  console.log('============================================');
  console.log('  数据库种子数据填充 v2');
  console.log('============================================\n');

  // 读取 app.js
  const appJsPath = path.join(__dirname, '..', '..', 'app.js');
  console.log('[1] 读取 app.js...');
  let appJsContent;
  try {
    appJsContent = fs.readFileSync(appJsPath, 'utf8');
    console.log('  读取成功 (' + (appJsContent.length / 1024).toFixed(1) + ' KB)');
  } catch (e) {
    console.error('  读取失败:', e.message);
    process.exit(1);
  }

  // 用 vm 模块在沙箱中执行 app.js 的数据定义部分
  console.log('\n[2] 提取默认数据...');
  
  // 创建沙箱上下文 - 提供浏览器环境的桩函数
  const sandbox = {
    console: console,
    localStorage: { getItem: function() { return null; }, setItem: function() {} },
    document: { getElementById: function() { return null; }, addEventListener: function() {} },
    window: {},
    navigator: { userAgent: 'node' },
    Chart: function() {},
    d3: {},
    topojson: {},
    fetch: function() { return Promise.reject(new Error('no fetch')); },
    setTimeout: setTimeout,
    setInterval: function() {},
    clearTimeout: clearTimeout,
    clearInterval: function() {},
    Date: Date,
    Math: Math,
    JSON: JSON,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    Promise: Promise,
    Map: Map,
    Set: Set,
    Symbol: Symbol,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    _extractedData: {}
  };
  
  // 提取变量: 在app.js末尾添加代码把变量暴露出来
  const extractionCode = appJsContent + '\n' +
    'try { _extractedData.COUNTRIES = typeof COUNTRIES !== "undefined" ? COUNTRIES : []; } catch(e) {}\n' +
    'try { _extractedData.ENTERPRISES = typeof ENTERPRISES !== "undefined" ? ENTERPRISES : []; } catch(e) {}\n' +
    'try { _extractedData.ALERTS = typeof ALERTS !== "undefined" ? ALERTS : []; } catch(e) {}\n' +
    'try { _extractedData.EVENTS = typeof EVENTS !== "undefined" ? EVENTS : []; } catch(e) {}\n' +
    'try { _extractedData.WARNING_RULES = typeof WARNING_RULES !== "undefined" ? WARNING_RULES : []; } catch(e) {}\n' +
    'try { _extractedData.CHOKEPOINTS = typeof CHOKEPOINTS !== "undefined" ? CHOKEPOINTS : []; } catch(e) {}\n' +
    'try { _extractedData.CORRIDORS = typeof CORRIDORS !== "undefined" ? CORRIDORS : []; } catch(e) {}\n' +
    'try { _extractedData.PREDICTIONS = typeof PREDICTIONS !== "undefined" ? PREDICTIONS : []; } catch(e) {}\n' +
    'try { _extractedData.TERROR_EVENTS = typeof TERROR_EVENTS !== "undefined" ? TERROR_EVENTS : []; } catch(e) {}\n' +
    'try { _extractedData.CHINA_SECURITY = typeof CHINA_SECURITY !== "undefined" ? CHINA_SECURITY : []; } catch(e) {}\n' +
    'try { _extractedData._pendingReviews = typeof _pendingReviews !== "undefined" ? _pendingReviews : []; } catch(e) {}\n';
  
  try {
    vm.createContext(sandbox);
    vm.runInContext(extractionCode, sandbox, { timeout: 10000 });
  } catch (e) {
    console.log('  vm执行部分失败(可能正常):', e.message.substring(0, 100));
  }
  
  const COLLECTION_TO_VAR = {
    countries: 'COUNTRIES',
    enterprises: 'ENTERPRISES',
    alerts: 'ALERTS',
    events: 'EVENTS',
    warning_rules: 'WARNING_RULES',
    chokepoints: 'CHOKEPOINTS',
    corridors: 'CORRIDORS',
    predictions: 'PREDICTIONS',
    terror_events: 'TERROR_EVENTS',
    china_security: 'CHINA_SECURITY',
    _pending_reviews: '_pendingReviews'
  };
  
  const extractedData = {};
  for (const [collection, varName] of Object.entries(COLLECTION_TO_VAR)) {
    const data = sandbox._extractedData[varName];
    if (data && Array.isArray(data)) {
      extractedData[collection] = data;
      console.log('  ' + collection + ': ' + data.length + ' 条记录');
    } else {
      extractedData[collection] = [];
      console.log('  ' + collection + ': 未提取到, 使用空数组');
    }
  }
  extractedData.playbooks = [];

  // 写入数据库
  console.log('\n[3] 写入 PostgreSQL...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const collection of DH_COLLECTIONS) {
      const data = extractedData[collection] || [];
      const dataJson = JSON.stringify(data);

      await client.query(
        `INSERT INTO datahub_store (collection, data_json, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (collection) DO UPDATE SET data_json = $2, updated_at = NOW()`,
        [collection, dataJson]
      );
      console.log('  ✓ ' + collection + ': ' + data.length + ' 条');
    }

    // 自动预警配置
    const defaultAlertConfig = {
      rules: [
        { id: 'AR01', name: '国家风险红色预警', type: 'country_risk', threshold: 8.0, level: 'red', enabled: true },
        { id: 'AR02', name: '国家风险橙色预警', type: 'country_risk', threshold: 6.0, level: 'orange', enabled: true },
        { id: 'AR03', name: '安全事件预警', type: 'security_event', level: 'orange', enabled: true },
        { id: 'AR04', name: '恐怖袭击预警', type: 'terror_attack', level: 'red', enabled: true },
        { id: 'AR05', name: '经济风险预警', type: 'economic', level: 'yellow', enabled: true },
      ],
      schedule: '0 */6 * * *',
      channels: ['platform', 'email'],
      lastRun: null,
      history: []
    };

    await client.query(
      `INSERT INTO datahub_store (collection, data_json, updated_at)
       VALUES ('auto_alert_config', $1, NOW())
       ON CONFLICT (collection) DO UPDATE SET data_json = $1, updated_at = NOW()`,
      [JSON.stringify(defaultAlertConfig)]
    );
    console.log('  ✓ auto_alert_config: 默认预警规则');

    await client.query('COMMIT');
    console.log('\n============================================');
    console.log('  种子数据填充完成!');
    console.log('============================================');

    // 验证
    const verifyResult = await client.query(
      "SELECT collection, jsonb_array_length(data_json) as count FROM datahub_store WHERE collection IN ('countries','enterprises','alerts','events','warning_rules','chokepoints','corridors','predictions','terror_events','china_security') ORDER BY collection"
    );
    console.log('\n  数据验证:');
    verifyResult.rows.forEach(r => {
      console.log('    ' + r.collection + ': ' + r.count + ' 条');
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n  写入失败:', err.message);
  } finally {
    client.release();
  }

  await pool.end();
}

seed().catch(err => {
  console.error('种子数据脚本异常:', err);
  process.exit(1);
});
