/**
 * 数据库初始化脚本
 * 用法: node scripts/init-db.js
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: require('path').join(__dirname, '..', '.env') });

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'orps_db',
  user: process.env.DB_USER || 'orps_user',
  password: process.env.DB_PASS || 'orps_dev_pass_2026',
});

async function init() {
  console.log('============================================');
  console.log('  数据库初始化 - 海外利益保护情报预警平台');
  console.log('============================================\n');

  try {
    // 读取 SQL 文件
    const sqlPath = path.join(__dirname, '..', 'init.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('[1/3] 正在执行 init.sql...');
    await pool.query(sql);
    console.log('      ✓ 表结构创建完成\n');

    // 生成默认管理员密码哈希
    console.log('[2/3] 正在设置默认管理员账号...');
    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await pool.query(
      `UPDATE users SET password = $1 WHERE username = 'admin'`,
      [hashedPassword]
    );
    console.log('      ✓ 默认管理员: admin / admin123\n');

    console.log('[3/3] 数据库初始化完成！');
    console.log('\n  默认管理员账号:');
    console.log('    用户名: admin');
    console.log('    密码:   admin123');
    console.log('\n  请及时修改管理员密码！\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ 初始化失败:', err.message);
    console.error('\n请检查:');
    console.error('  1. PostgreSQL 服务是否已启动');
    console.error('  2. .env 文件中的数据库配置是否正确');
    console.error('  3. 数据库 orps_db 是否已创建');
    console.error('  4. 用户 orps_user 是否有权限');
    process.exit(1);
  }
}

init();
