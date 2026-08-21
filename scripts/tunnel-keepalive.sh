#!/bin/bash
# ============================================================
# cloudflared 隧道保活 + 引导文件自动更新
# 功能：
#   1. 启动 cloudflared 快速隧道（HTTP2 + IPv4，国内直连 Cloudflare 边缘）
#   2. 每次拿到新 trycloudflare 域名 → 更新 orps-pages/orps-server.json 并推送 gh-pages
#      （GitHub Pages 引导页地址固定，APP/浏览器打开引导页自动跳到最新隧道域名）
#   3. 隧道断线 5 秒后自动重连，7×24 常驻
# 用法：bash scripts/tunnel-keepalive.sh    （建议由 PM2 或计划任务守护）
# ============================================================
set -u

ROOT="/c/Users/28737/Desktop/新建文件夹"
PAGES="/c/Users/28737/Desktop/orps-pages"
CF="$ROOT/tools/cloudflared.exe"
LOG="/c/Users/28737/.workbuddy/tools/tunnel.log"
CFLOG="/tmp/cf_tunnel_keepalive.log"

# 干净环境，避免 IDE 注入的代理/NODE_OPTIONS 干扰隧道进程
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NODE_OPTIONS || true

update_pages() {
  local url="$1"
  local ts
  ts=$(date "+%Y-%m-%dT%H:%M:%S+08:00")
  printf '{"url":"%s","updated":"%s","note":"海安预警APP服务器地址引导文件，隧道重连后由脚本自动更新"}\n' "$url" "$ts" > "$PAGES/orps-server.json"
  # 同步主仓库根目录的引导文件副本
  cp "$PAGES/orps-server.json" "$ROOT/orps-server.json"
  (
    cd "$PAGES" || exit 0
    git add orps-server.json >/dev/null 2>&1
    git commit -m "tunnel: $url ($ts)" >/dev/null 2>&1 || exit 0
    GIT_TERMINAL_PROMPT=0 git push origin gh-pages >/dev/null 2>&1 \
      && echo "$(date '+%F %T') pages updated -> $url" >> "$LOG" \
      || echo "$(date '+%F %T') pages push FAILED (will retry next round)" >> "$LOG"
  )
}

echo "=== $(date '+%F %T') tunnel-keepalive started ===" >> "$LOG"

while true; do
  echo "=== $(date '+%F %T') connecting ===" >> "$LOG"
  : > "$CFLOG"
  "$CF" tunnel --url http://localhost:3000 --no-autoupdate \
        --protocol http2 --edge-ip-version 4 >> "$CFLOG" 2>&1 &
  CFPID=$!

  # 等待新域名出现（最多 40 秒）
  NEWURL=""
  for i in $(seq 1 40); do
    NEWURL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$CFLOG" 2>/dev/null | head -1)
    [ -n "$NEWURL" ] && break
    kill -0 $CFPID 2>/dev/null || break
    sleep 1
  done

  if [ -n "$NEWURL" ]; then
    CUR=$(grep -o '"url":"[^"]*"' "$PAGES/orps-server.json" 2>/dev/null | cut -d'"' -f4)
    if [ "$NEWURL" != "$CUR" ]; then
      echo "$(date '+%F %T') new tunnel: $NEWURL" >> "$LOG"
      update_pages "$NEWURL"
    else
      echo "$(date '+%F %T') tunnel unchanged: $NEWURL" >> "$LOG"
    fi
  else
    echo "$(date '+%F %T') WARN: no tunnel URL within 40s" >> "$LOG"
  fi

  # 等待隧道进程退出（正常运行时一直阻塞在这里）
  wait $CFPID 2>/dev/null
  echo "=== $(date '+%F %T') disconnected, retry in 5s ===" >> "$LOG"
  sleep 5
done
