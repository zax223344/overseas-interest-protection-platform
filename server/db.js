/**
 * 数据库连接池 - PostgreSQL (pg)
 */
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: require('path').join(__dirname, '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] 连接池错误:', err.message);
});

/**
 * 执行查询
 * @param {string} text - SQL 语句
 * @param {Array} params - 参数
 * @returns {Promise<QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      console.log(`[DB] 慢查询 ${duration}ms: ${text.substring(0, 80)}`);
    }
    return res;
  } catch (err) {
    console.error('[DB] 查询错误:', err.message);
    throw err;
  }
}

/**
 * 获取连接客户端 (事务用)
 */
async function getClient() {
  return pool.connect();
}

/**
 * 测试数据库连接
 */
async function testConnection() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('[DB] 连接成功:', res.rows[0].now);
    return true;
  } catch (err) {
    console.error('[DB] 连接失败:', err.message);
    return false;
  }
}

module.exports = { pool, query, getClient, testConnection };
