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
  /* 2026-09-04 P0-2：本地 PG 已启用 SSL（自签证书），后端走加密连接。
   * rejectUnauthorized:false——自签证书不验链（本机回环，目标是传输加密而非身份验证，
   * 身份验证由 PG 密码承担）；TLSv1.3 实测确认（pg_stat_ssl）。 */
  ssl: { rejectUnauthorized: false },
  /* 2026-09-02 perf：公网 50 人并发 + 轮询类接口，max 20 会排队。
   * PG max_connections=100（实测），常驻系统占用 ~3，提到 40 留足余量。 */
  max: parseInt(process.env.DB_POOL_MAX || '40', 10),
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
      /* 2026-09-08 #711 观测系统：>500ms 计入滚动指标 + 最近 20 条环形缓冲
       * （/api/sys/metrics 暴露，供演示期/采集恢复期实时观测慢查询风暴） */
      if (duration > 500) {
        _slow.count++; _slow.lastAt = new Date().toISOString();
        _slow.recent[_slow.idx % 20] = { ms: duration, sql: text.replace(/\s+/g, ' ').slice(0, 120), at: _slow.lastAt };
        _slow.idx++;
      }
    }
    return res;
  } catch (err) {
    console.error('[DB] 查询错误:', err.message);
    throw err;
  }
}

const _slow = { count: 0, lastAt: null, idx: 0, recent: [] };
function getStats() {
  return { pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }, slow: { count: _slow.count, lastAt: _slow.lastAt, recent: _slow.recent.filter(Boolean) } };
}

/* ===== #712 P0-4 报告池软读写分离（2026-09-08）=====
 * 背景（L1）：日报/巡检等重查询（keyset 分批后仍达数百批×数百 ms）与 API 在线
 * 查询抢同一个 40 连接池，洪峰期 API 探活排队→health 000。
 * 方案：重报表查询走独立小池 reportQuery（max 2）——重查询互不挤占 API 池；
 * 同一 PG 实例（无副本），属"软"分离：先解决池饥饿，真副本就绪后只改此池配置。
 * 消费方：_generateDailyReport / _integrityWatchdog / 报告类重聚合。
 * 铁律：事务写路径（getClient）与采集 INSERT 一律仍走主池，禁止迁 reportQuery。 */
const reportPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026',
  ssl: { rejectUnauthorized: false },
  max: parseInt(process.env.DB_REPORT_POOL_MAX || '2', 10),
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 15000,
});
reportPool.on('error', (err) => { console.error('[DB-REPORT] 报告池错误:', err.message); });
async function reportQuery(text, params) {
  try {
    return await reportPool.query(text, params);
  } catch (err) {
    console.error('[DB-REPORT] 查询错误:', err.message);
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

/* ===== #712 P0 health 专用微池（2026-09-08 collect 恢复卡死事故根修）=====
 * 背景：原 health 走 40 连接主池 testConnection——采集大军（127 源/轮）洪峰期打满
 * 主池，health 的 SELECT NOW() 排队 >5s → 探活误判死 → 看门狗/恢复脚本连环误动作，
 * 而事件循环其实活着（日志持续滚动）。L1 池饥饿的最后残余。
 * 方案：health 探测走独立 1 连接微池 + 2.5s 硬超时，永不排队。职责分工自此清晰：
 *   health 5s 无响应 = 事件循环死 → orps-watchdog restart（restart 才有意义）
 *   health 秒回但 database:disconnected = PG 死 → orps-pg-keepalive 拉起 PG
 * 其余任何业务查询（含采集 INSERT）一律禁用此池。 */
const healthPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026',
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 0,       /* 常驻连接不复收，探活零建连开销 */
  connectionTimeoutMillis: 2500,
});
healthPool.on('error', () => { /* 探活池错误由 healthPing 吞掉上报，不刷屏 */ });
async function healthPing() {
  try {
    await Promise.race([
      healthPool.query('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('health ping 2.5s timeout')), 2500)),
    ]); /* race 对两个 promise 都挂了 handler，输家延迟 reject 不会成为 unhandled */
    return true;
  } catch (e) { return false; }
}

/* ===== #724 P0-1 预警供血专用微池（2026-09-09 审计铁证根治）=====
 * 背景：08-26→09-08 17 时预警中心零新增 14 天——_serverAlertGen/_alertValueSentinel
 * 走 40 连接主池，采集大军（127 源/轮）+backfill 4 worker 洪峰打满主池，
 * 预警三函数排队 10s 超时（PM2 err: timeout exceeded when trying to connect），
 * catch(e){console.warn} 吞掉静默重试。进程重启后自愈但根因（池饥饿）未除。
 * 方案：预警供血链（候选扫描/队列读写/哨兵巡检）走独立 2 连接微池 + 4s 硬超时，
 * 与采集 INSERT 永不抢连接。铁律：采集/事务/API 在线查询禁用此池。 */
const alertPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026',
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 0,       /* 常驻连接不复收，预警 3min 一轮零建连开销 */
  connectionTimeoutMillis: 4000,
});
alertPool.on('error', (err) => { console.error('[DB-ALERT] 预警池错误:', err.message); });
async function alertQuery(text, params) {
  try {
    return await alertPool.query(text, params);
  } catch (err) {
    console.error('[DB-ALERT] 查询错误:', err.message);
    throw err;
  }
}

module.exports = { pool, query, reportQuery, alertQuery, getClient, testConnection, getStats, healthPing };
