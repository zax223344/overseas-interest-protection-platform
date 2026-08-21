/**
 * purge_non_overseas.js — 一次性清理脚本
 * 目标：删除数据库中"仅涉华但与中国海外利益安全无关"的条目，保留真正的海外利益安全情报。
 * 判定标准（与 gate.js / chinaOverseasGate 同源）：
 *   保留：含涉华要素（A）且含海外标记/安全事件/强海外利益信号
 *   保留：非涉华但 F+G/C/D/H/I 组合且含涉华/强海外利益信号
 *   删除：纯文化娱乐、普通商业、他国内政民生、无海外利益安全信号的涉华条目
 */
'use strict';
const { query } = require('./db');
const scrapers = require('./scrapers');

async function main() {
  console.log('[PURGE] 开始回扫 osint_intel / collect_logs / socmint_intel 中的无关涉华数据...');
  const types = ['osint_intel', 'collect_logs', 'socmint_intel'];
  let total = 0, deleted = 0, kept = 0;

  for (const t of types) {
    const { rows } = await query(
      `SELECT id, title, data_json FROM intel_data WHERE data_type = $1`,
      [t]
    );
    console.log(`[PURGE] ${t}: 共 ${rows.length} 条待审`);

    const toDelete = [];
    for (const r of rows) {
      const title = r.title || '';
      const dj = r.data_json || {};
      const txt = title + ' ' + (dj.content || '') + ' ' + (dj.description || '');
      const gate = scrapers.chinaOverseasGate(txt);
      if (!gate.pass) {
        toDelete.push(r.id);
      } else {
        kept++;
      }
    }

    if (toDelete.length) {
      const batch = 100;
      for (let i = 0; i < toDelete.length; i += batch) {
        const slice = toDelete.slice(i, i + batch);
        const placeholders = slice.map((_, j) => `$${j + 1}`).join(',');
        await query(`DELETE FROM intel_data WHERE id IN (${placeholders})`, slice);
      }
      deleted += toDelete.length;
    }
    total += rows.length;
  }

  console.log(`[PURGE] 完成：总计 ${total} 条，删除 ${deleted} 条无关涉华/弱相关数据，保留 ${kept} 条海外利益安全情报。`);
  process.exit(0);
}

main().catch(e => { console.error('[PURGE] 失败:', e); process.exit(1); });
