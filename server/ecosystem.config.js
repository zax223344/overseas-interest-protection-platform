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
      // 内存上限 3G（2026-09-07 #665 卡顿根因修正：1G 帽下补采 4 worker + 全通道采集 +
      // 报告引擎 + 50人并发，V8 常态贴 1G 帽→06:36-06:39 连续 4 次 FATAL heap OOM 崩溃
      // → 服务反复重启断线即用户感知的"卡顿/慢"。16GB 整机给 ORPS 3G 合理，
      // max_memory_restart 留 3.5G 防漏兜底（贴帽前主动重启，不再等 V8 崩溃）。
      max_memory_restart: '3500M',
      // 限制 Node 老年代空间，配合 max_memory_restart 提前触发重启
      node_args: '--max-old-space-size=3072',
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
    },
    {
      // 补采/归档独立 worker 进程（#713，2026-09-08 L1 根修）：历史补采引擎 4 worker
      // + 滚动归档 + 涉华恐袭历史回补，与 orps-server 隔离事件循环与 PG 池。
      // 加载同一 server.js 代码库，ORPS_ROLE=worker 时无 HTTP 监听、只挂 backfill 类
      // 调度任务；暂停走 tmp/sched-state.json（SCHED 类级）+ backfill_state DB 旗。
      name: 'orps-workers',
      script: path.join(__dirname, 'workers.js'),
      cwd: __dirname,
      interpreter: 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe',
      instances: 1,
      exec_mode: 'fork',
      // 补采不加载前端静态/低频 API，内存需求低于 server；2G 帽 + 2.5G 硬顶
      max_memory_restart: '2500M',
      node_args: '--max-old-space-size=2048',
      restart_delay: 5000,
      min_uptime: '30s',
      max_restarts: 10,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        ORPS_ROLE: 'worker',
        NODE_PATH: 'C:/Users/28737/.workbuddy/binaries/node/workspace/node_modules'
      },
      log_file: path.join(__dirname, 'logs', 'pm2-workers-combined.log'),
      out_file: path.join(__dirname, 'logs', 'pm2-workers-out.log'),
      error_file: path.join(__dirname, 'logs', 'pm2-workers-err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      log_max_size: '10M',
      log_retain: 5
    },
    {
      // 应用层看门狗（#712 P0-3，2026-09-08）：health 连续 5 败（30s×5）→ pm2.restart
      // orps-server；仍死则 netstat 查 3000 端口僵尸占用者 taskkill 后再 restart（根治 L2
      // 连环 EADDRINUSE）；orps-workers 心跳 5min 停更 → restart。冷却 10min 防风暴。
      // 与 orps-pg-keepalive 分工：那边管 PM2 God/PG 死亡（基建层），这边管进程活着
      // 但事件循环卡死/端口僵尸（应用层，pm2 restart 级），见 watchdog.js 头注。
      name: 'orps-watchdog',
      script: path.join(__dirname, 'watchdog.js'),
      cwd: __dirname,
      interpreter: 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      restart_delay: 10000,
      autorestart: true,
      watch: false,
      env: {
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: ''
      },
      log_file: path.join(__dirname, 'logs', 'watchdog-pm2.log'),
      out_file: path.join(__dirname, 'logs', 'watchdog-pm2.log'),
      error_file: path.join(__dirname, 'logs', 'watchdog-pm2.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      // 本地 git 容灾哨兵（#579）：每 30 分钟体检+镜像快照+损坏自动恢复。
      // 铁律：server/ 与 .git 永不上云端仓库，容灾全部本地化。
      // 快照目录 C:/Users/28737/Desktop/orps-git-snapshots/（latest/oncommit/daily×7）。
      name: 'orps-git-keepalive',
      script: path.join(__dirname, '..', 'git-keepalive.js'),
      cwd: path.join(__dirname, '..'),
      interpreter: 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      restart_delay: 5000,
      autorestart: true,
      watch: false,
      log_file: path.join(__dirname, '..', 'logs', 'git-keepalive.log'),
      out_file: path.join(__dirname, '..', 'logs', 'git-keepalive-out.log'),
      error_file: path.join(__dirname, '..', 'logs', 'git-keepalive-err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      // PG+服务 双保活看门狗（#656，2026-09-06）：每 60s 探 PG 5432 与 /api/health，
      // 挂则拉起。PM2 托管保证其自身常驻；开机时 start-orps.js 还会在 PM2 之外
      // 拉一份独立副本（防重入=60s 轮询等待接管）——PM2 God 死亡时由独立副本兜底。
      name: 'orps-pg-keepalive',
      script: 'C:/Users/28737/.workbuddy/orps-boot/pg-keepalive.js',
      interpreter: 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe',
      cwd: 'C:/Users/28737/.workbuddy/orps-boot',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '200M',
      restart_delay: 10000,
      autorestart: true,
      watch: false,
      env: {
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: ''
      },
      log_file: 'C:/Users/28737/.workbuddy/tools/pg-keepalive-pm2.log',
      out_file: 'C:/Users/28737/.workbuddy/tools/pg-keepalive-pm2.log',
      error_file: 'C:/Users/28737/.workbuddy/tools/pg-keepalive-pm2.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      // cloudflared 隧道保活（2026-09-06 引导链断链事故后并入 PM2 托管）：
      // 原由 start-orps.js detached spawn，但从 AI 工具沙箱/PowerShell 拉起的
      // detached 进程会被会话回收连坐杀死，且睡眠唤醒后 cloudflared 僵尸态
      // （进程活、隧道死、无 exit 事件）无人自愈。PM2 God 常驻，crash 自动重启。
      // 脚本自带：断线 5s 重连 + 新域名 API 优先更新 gh-pages 引导页 + 5min 僵尸态看门狗。
      // 注意防重入：cloudflared 已在跑时脚本会 process.exit(0)（PM2 视为正常退出，
      // 30s 后 min_uptime 内不重启——需 start-orps.js 不再重复拉起旧版 keepalive）。
      name: 'orps-tunnel',
      script: 'C:/Users/28737/.workbuddy/orps-boot/tunnel-keepalive.js',
      interpreter: 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2-2/node.exe',
      cwd: 'C:/Users/28737/.workbuddy/orps-boot',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      restart_delay: 10000,
      autorestart: true,
      watch: false,
      min_uptime: '30s',
      max_restarts: 10,
      env: {
        // 清代理：cloudflared 边缘连接与 api.github.com 均须直连
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        http_proxy: '',
        https_proxy: ''
      },
      log_file: 'C:/Users/28737/.workbuddy/tools/tunnel.log',
      out_file: 'C:/Users/28737/.workbuddy/tools/tunnel.log',
      error_file: 'C:/Users/28737/.workbuddy/tools/tunnel.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
