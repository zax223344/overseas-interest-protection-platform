/**
 * purge_blue_alerts.js — 清理数据库中不应进入预警中心的普通涉华新闻
 * 标准：与 gate.js / chinaOverseasGate + 预警分级逻辑同源，
 *       仅保留真正构成中国海外利益安全风险的条目（红/橙/黄），
 *       删除普通涉华新闻（文化交流/一般商业/社会民生/教育科技等蓝色级别）。
 */
'use strict';
const { query } = require('./db');
const scrapers = require('./scrapers');

function isBlueLevel(title) {
  const text = String(title || '');
  // 红色：人员安全/重大安全事件/战争政变/撤侨/重大灾害
  if (/死亡|伤亡|遇害|遇难|绑架|人质|劫持|恐袭|爆炸|空袭|枪击|战争|政变|屠杀|撤侨|沉船|坠机|重大事故|重大灾害|地震.*伤亡|海啸|台风.*登陆|洪水.*淹没/i.test(text)) return false;
  // 橙色：中资/华人/项目遇袭或重大风险、严重制裁、重大运营中断
  if (/中资.*(?:遇袭|袭击|冲突|威胁|风险|损失|中断|停工|冻结|制裁)|中企.*(?:遇袭|袭击|冲突|威胁|风险|损失|中断|停工|冻结|制裁)|华人.*(?:遇害|被绑|袭击|威胁|风险)|华侨.*(?:遇害|被绑|袭击|威胁|风险)|使馆.*(?:遇袭|袭击|威胁|风险)|项目.*(?:遇袭|中断|停工|冻结|重大风险|重大损失)|重大制裁|严厉制裁|大规模抗议|军事冲突|武装冲突|资产.*冻结|重大损失/i.test(text)) return false;
  // 黄色：一般安全风险/轻微政治变化/一般经济波动
  if (/袭击|冲突|骚乱|抗议|制裁|封锁|限制|风险|警惕|关注|波动|延误|紧张|摩擦|争端|审查|调查|批评|指责/i.test(text)) return false;
  return true;
}

async function main() {
  console.log('[PURGE-BLUE] 开始清理不应进入预警中心的普通涉华新闻...');
  const { rows } = await query(
    `SELECT id, title, data_json->>'interestLinked' AS linked FROM intel_data WHERE data_type = 'osint_intel'`,
    []
  );
  console.log(`[PURGE-BLUE] 共 ${rows.length} 条待审`);

  const toDelete = [];
  let kept = 0;
  for (const r of rows) {
    // 只处理涉华且过 gate 的条目（interestLinked=true 或 gate 通过）
    const gate = scrapers.chinaOverseasGate(r.title || '');
    if (!gate.pass) {
      // 非涉华/弱相关已由 purge_non_overseas 清理
      continue;
    }
    // 过 gate 但蓝色级别 → 删除
    if (isBlueLevel(r.title)) {
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
  }
  console.log(`[PURGE-BLUE] 完成：删除 ${toDelete.length} 条蓝色提示级涉华新闻，保留 ${kept} 条风险预警级情报。`);
  process.exit(0);
}

main().catch(e => { console.error('[PURGE-BLUE] 失败:', e); process.exit(1); });
