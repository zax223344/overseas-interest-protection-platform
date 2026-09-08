'use strict';
/**
 * workers.js — ORPS 补采/归档独立 worker 进程入口（任务 #713，2026-09-08）
 * ================================================================
 * 背景（L1 资源挤兑根因）：4 个补采 worker + 滚动归档 + 演示服务原本全在
 * server.js 一个进程里抢同一个事件循环与同一个 PG 池——补采洪峰把 health 探活
 * 都挤成 000。拆分后：
 *   - orps-server（server 角色）：HTTP API + 采集 + 报告 + AI 值班
 *   - orps-workers（本进程，worker 角色）：历史补采引擎（backfill.js 4 worker）
 *     + 滚动归档（rolling-archive）+ 涉华恐袭历史回补 tick（china-terror-backfill-tick）
 *
 * 实现方式：设置 ORPS_ROLE=worker 后加载同一份 server.js——全部代码/闸门/翻译管线
 * 单一来源，由 scheduler.js 角色亲和决定本进程只挂 backfill 类定时器（无 HTTP 监听）。
 * 与 server 进程的协调：
 *   - 暂停状态：tmp/sched-state.json（SCHED 类级暂停，POST /api/sched/pause 生效）
 *   - 补采启停：backfill_state.paused DB 旗（/api/backfill/pause|resume，60s 轮询接管）
 *   - 心跳：tmp/sched-worker.json（60s 落盘，GET /api/sched/list 合并展示）
 */
process.env.ORPS_ROLE = 'worker';
require('./server'); /* 调度器角色亲和生效：只挂 backfill 类任务，无端口监听 */

/* 保活引用：pg 池连接常驻已足够，此处防御性兜底（空操作 interval 持有事件循环） */
setInterval(() => {}, 60 * 1000);
