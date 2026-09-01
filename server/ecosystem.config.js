/**
 * 海外利益保护情报预警平台 - PM2 守护进程配置
 * 用途：7×24 小时自动运行 Node 后端，崩溃/异常退出后自动重启
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'orps-server',
      script: path.join(__dirname, 'server.js'),
      cwd: __dirname,
      // 显式指定 Node 路径，避免依赖系统 PATH（2026-09-01 修复：22.22.2 目录已不存在，实际为 22.22.2-2）
      interpreter: 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe',
      instances: 1,
      exec_mode: 'fork',
      // 内存上限 400M：系统总内存仅 16GB，WorkBuddy 等进程已占 3.5GB+，
      // ORPS 超过 400MB 即自动重启，防止内存泄漏拖垮整机。原 2G 阈值过高无法防 OOM。
      max_memory_restart: '400M',
      // 限制 Node 老年代空间，配合 max_memory_restart 提前触发重启
      node_args: '--max-old-space-size=384',
      // 崩溃/退出后 3 秒重启
      restart_delay: 3000,
      // 30 秒内最多 5 次异常重启则锁定
      min_uptime: '30s',
      max_restarts: 5,
      // 不随 PM2 守护进程一起启动时自动恢复（由 Windows 计划任务控制）
      autorestart: true,
      // 监控文件变化不自动重启（前端/脚本改动后请手动重启）
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // 确保运行时能找到隔离目录安装的模块
        NODE_PATH: 'C:/Users/28737/.workbuddy/binaries/node/workspace/node_modules'
      },
      // PM2 日志路径
      log_file: path.join(__dirname, 'logs', 'pm2-combined.log'),
      out_file: path.join(__dirname, 'logs', 'pm2-out.log'),
      error_file: path.join(__dirname, 'logs', 'pm2-err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // 合并输出，方便排查
      merge_logs: true,
      // 日志按大小切割：单个 10MB，保留 5 个历史文件
      log_max_size: '10M',
      log_retain: 5
    }
  ]
};
