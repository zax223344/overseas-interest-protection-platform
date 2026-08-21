# 任务完成概览：每日≥500条采集量与80-100条涉华数据指标

## 已完成功能

### 1. 后端采集强化
- **采集周期**：`server/server.js` 将轮询间隔从 90 秒压缩到 **30 秒**，每轮抓取媒体源 60 重点 + 40 轮询、智库 20 重点 + 25 轮询。
- **涉华专项采集**：新增 `_runChinaFocus`，调用 `globalmedia.scrapeChinaFocus` 对高命中中文媒体、港台媒体、涉华外媒/智库进行专项抓取。
- **日指标统计**：新增 `_dailyStats`、`_isChinaLinked`、`/api/media/daily-stats` 端点，按 URL 去重后写入 PostgreSQL，并实时返回：
  - `runtime`（本次启动累计）
  - `database`（当日数据库真实落盘）
  - `targets`（总量≥500、涉华80-100）
  - `gaps`（距离目标缺口）

### 2. 数据源与闸门优化
- `server/media_feeds.js`：新增 `CHINA_FOCUS_SOURCES` 涉华专项源，补充中国官方/港台/涉华国际媒体与智库。
- `server/globalmedia.js`：新增 `scrapeChinaFocus`，对 Chinese source 含中国关键词且非文化娱乐噪声的条目额外放行。
- `gate.js` / `server/scrapers.js`：扩展涉华关键词，提升 A/B 维度命中。
- 修复 `server/media_feeds.js` 中 El País RSS URL 格式错误、Xinhua World HTML 页面误作 RSS 的问题。

### 3. 前端实时指标展示
- `app.js`：首页「实时情报流」面板标题直接显示今日采集进度：
  - `📊 <总量>/<500>`
  - `🇨🇳 <涉华>/80`
- 每 30 秒轮询 `/api/media/daily-stats` 刷新指标。

### 4. 验证结果
- 后端所有修改文件通过 `node --check`。
- 后端服务已重启，`/api/health` 正常。
- 实测约 20 分钟运行后：
  - 数据库当日 `osint_intel`：**299 条**
  - 数据库当日涉华：**100 条**（已达标 80-100 指标）
  - 总量缺口：**201 条**（按当前速率可在数小时内达标）

## 需要用户操作
- **Ctrl + Shift + R 硬刷新浏览器**，加载 `app.js?v=115` 新版本后可在首页实时情报流标题看到今日采集指标。
- 后端服务已自动启动并在后台运行，无需手动干预。
