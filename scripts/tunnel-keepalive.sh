#!/bin/bash
# ============================================================
# 【已废弃 2026-08-29】bash 版隧道保活已退役。
#
# 退役原因：
#   1. 与 node 版（~/.workbuddy/orps-boot/tunnel-keepalive.js）双实例竞争：
#      开机链同时拉起两版，12 秒窗口内互未检测到对方，各抢一条 trycloudflare
#      隧道，导致 orps-server.json 与实际活隧道不一致，公网入口失联。
#   2. git push 不带代理，国内直连 GitHub 必失败（node 版已修复：代理优先+直连回退）。
#
# 唯一权威入口：开机自启链
#   Startup/orps-boot.bat → start-orps.js → tunnel-keepalive.js (node, detached)
#
# 本文件保留为桩，防止旧计划任务/文档引用时报错。
# ============================================================
echo "[deprecated] bash 版 tunnel-keepalive 已退役，请使用 node 版：" >&2
echo "  node C:/Users/28737/.workbuddy/orps-boot/tunnel-keepalive.js" >&2
exit 0
