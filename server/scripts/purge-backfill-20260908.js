/**
 * purge-backfill-20260908.js — #716 清除 24.5 万条模板补采数据 + 账本重置（2026-09-08 用户指令一）
 * ================================================================
 * 用户拍板：「一是，24.5 万条数据，删除。」——审计结论（100% CAMEO 模板合成句 +
 * 行为体错配 + 类别失衡 88% 单类 + 涉华负面 0 + severity 失真），内容不可用。
 *
 * ★ 铁律：直接 SQL DELETE，绝不走 API 删除路由——API 删除会立墓碑
 *   （intel_tombstones：标题指纹+译文指纹+URL 三键），24.5 万条 URL 全部
 *   被入库闸拦死，重补等于自己把自己堵死。直接 SQL 删不立碑，同 URL 重采畅通。
 *
 * 动作序列：
 * ① 分批删（5000/批 + 300ms 间歇）：_backfillDay 标记 OR _sourceType='backfill' 双口径；
 * ② TRUNCATE backfill_progress（账本清零，断点从 01-01 重新开始）；
 * ③ DELETE backfill_state（清暂停旗）+ 置 trial='3'（试跑模式：先跑 3 个历史日
 *   出质量门报告，人工验收后 POST /api/backfill/resume 放行主战役）；
 * ④ VACUUM ANALYZE intel_data（回收死元组 + 统计信息刷新，慢查询治理）。
 *
 * 运行前置：backfill_state.paused 已置 1 且 orps-workers 已重启为新代码（带 trial
 * 逻辑）——否则旧引擎会在清库后立刻用旧逻辑乱灌。运行：
 *   cd server && node scripts/purge-backfill-20260908.js
 */
'use strict';
const { Client } = require('pg');
const c = new Client({ host: 'localhost', port: 5432, database: 'orps_db', user: 'orps_user', password: 'orps_dev_pass_2026' });
const BATCH = 5000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await c.connect();
  const pre = await c.query(`SELECT count(*) n FROM intel_data
    WHERE data_json->>'_backfillDay' IS NOT NULL OR COALESCE(data_json->>'_sourceType','')='backfill'`);
  console.log('[PURGE] 待清补采标记行:', pre.rows[0].n);
  const preAll = await c.query(`SELECT count(*) n FROM intel_data`);
  console.log('[PURGE] intel_data 当前行数:', preAll.rows[0].n);

  /* ① 分批删（intel_data + intel_archive 双表：rolling-archive 会把 collect_time
   *   超 7 天的行移入 intel_archive，只清主表会漏） */
  let total = 0, round = 0;
  for (;;) {
    const r = await c.query(`DELETE FROM intel_data WHERE ctid IN (
      SELECT ctid FROM intel_data
      WHERE data_json->>'_backfillDay' IS NOT NULL OR COALESCE(data_json->>'_sourceType','')='backfill'
      LIMIT $1)`, [BATCH]);
    total += r.rowCount; round++;
    if (r.rowCount < BATCH) break;
    if (round % 10 === 0) console.log('[PURGE] 已删 ' + total + ' 行...');
    await sleep(300);
  }
  const rArc = await c.query(`DELETE FROM intel_archive
    WHERE data_json->>'_backfillDay' IS NOT NULL OR COALESCE(data_json->>'_sourceType','')='backfill'`);
  console.log('[PURGE] 删除完成：intel_data 共 ' + total + ' 行 / ' + round + ' 批；intel_archive ' + rArc.rowCount + ' 行');

  /* ② 账本清零（标题缓存 backfill_title_cache 保留：死链判定与已捞标题复用，省回捞） */
  await c.query(`TRUNCATE backfill_progress`);

  /* ③ 状态重置 + 试跑模式。
   * 时序安全：保留 paused=1——清库后旧引擎（若 orps-workers 尚未重启为新代码）
   * 的 60s 接管轮询会因暂停旗而保持怠速；等两个进程都换新代码后再解除暂停
   * （DELETE FROM backfill_state WHERE k IN ('paused','pause_reason') 或
   * POST /api/backfill/resume），引擎随即开跑试跑 3 日。 */
  await c.query(`DELETE FROM backfill_state`);
  await c.query(`INSERT INTO backfill_state (k,v) VALUES ('trial','3'),('paused','1'),('pause_reason','purge-prep')`);
  console.log('[PURGE] 账本已清零，试跑模式 trial=3，暂停旗保留（purge-prep）——等新代码进程就绪后解除');

  /* ④ VACUUM ANALYZE（不能在事务块中执行；Client 默认自动提交） */
  console.log('[PURGE] VACUUM ANALYZE intel_data ...');
  await c.query(`VACUUM ANALYZE intel_data`);
  await c.query(`VACUUM ANALYZE backfill_progress`);

  const after = await c.query(`SELECT count(*) n FROM intel_data`);
  console.log('[PURGE] intel_data 剩余 ' + after.rows[0].n + ' 行（实时采集数据全量保留）');
  const st = await c.query(`SELECT * FROM backfill_state`);
  console.log('[PURGE] backfill_state:', JSON.stringify(st.rows));
  const pr = await c.query(`SELECT count(*) n FROM backfill_progress`);
  console.log('[PURGE] backfill_progress:', pr.rows[0].n, '行（清零）');
  await c.end();
  console.log('[PURGE] 完成。后续：① 重启 orps-workers + orps-server（新代码）→ ② 解除暂停（DELETE FROM backfill_state WHERE k IN (\'paused\',\'pause_reason\')）→ ③ 引擎 60s 内自动开跑试跑 3 日（01-01/01-02/01-03）');
})().catch(e => { console.error('[PURGE] 失败:', e.message); process.exit(1); });
