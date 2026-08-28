# 采集源救援重扫结果处理 — 执行记录

## 2026-08-24 01:45 执行
- 输入：server/.cache/feed-rescan.json（469 源，进程已结束，最终结果就绪）
- 统计：recovered=183 / stillNetfail=61 / httpErr=225（含 200 但 0 item 60 个）
- 动作：
  - 剔除 404/410 死源 102 个唯一 URL（124 行，含重复注册），备份 _backup_media_feeds_prerescan_20260824.js
  - 两轮均网络失败 44 个唯一 URL（49 行）标注「// 本地不可达（待云机恢复）」，未删除
  - reutersagency 死 URL 不在注册表（scrapers.js 中为另一参数变体），未处理
- 重启：清代理 env，pm2 delete + start（--output/--error 指向 server/logs/pm2-out.log / pm2-err.log），服务 200，/api/intel/political_events 返回真实数据
- git：commit 66d3709 已 push（media_feeds.js + server.js 标题本地化修复）
- 后续建议：CSIS/CFR/RUSI/SWP/Bruegel 等智库原 feed 404，可后续实测新 feed URL 补回（禁止拍脑袋编 URL）
