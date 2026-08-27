#!/usr/bin/env node
/* git hook 自动重启脚本（2026-08-28 #437）
 * 由 .git/hooks/post-merge 与 post-checkout 调用：本地代码经 git pull/checkout 更新后，
 * 自动重启 PM2 orps-server，避免人工遗漏导致线上跑旧代码。
 * 重启铁律与人工操作一致：先清代理环境变量 → pm2 kill → pm2 start（正斜杠日志路径）。 */
const { spawnSync } = require('child_process');
const path = require('path');

const NODE = 'C:/Users/28737/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const PM2 = 'C:/Users/28737/.workbuddy/binaries/node/workspace/node_modules/pm2/bin/pm2';
const ROOT = path.resolve(__dirname, '..'); /* 项目根（server/ 的上一级） */

const env = Object.assign({}, process.env);
delete env.HTTP_PROXY; delete env.HTTPS_PROXY;
delete env.http_proxy; delete env.https_proxy;
delete env.NODE_OPTIONS;

function run(args) {
  const r = spawnSync(NODE, [PM2].concat(args), { cwd: ROOT, env, encoding: 'utf8' });
  if (r.stdout) process.stdout.write(String(r.stdout));
  if (r.stderr) process.stderr.write(String(r.stderr));
  return r.status === 0;
}

/* 只有当 server 代码/前端有变更时才重启，纯文档改动跳过（由调用方判断，这里保守全重启） */
console.log('[git-hook] 检测到代码更新，重启 orps-server ...');
run(['kill']);
run(['start', 'server/server.js', '--name', 'orps-server',
     '--output', 'server/logs/pm2-out.log', '--error', 'server/logs/pm2-err.log']);
console.log('[git-hook] orps-server 重启完成');
