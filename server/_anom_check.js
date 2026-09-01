/**
 * _anom_check.js — 异动信号内容实质校验层验证脚本（临时，下划线开头不入主流程）
 * 从 server.js 源码提取真实的 _anomSubstanceCheck 等函数（非复制粘贴），验证两组关键场景：
 *   A. 用户投诉的 CBC 案例复现：8 条媒体编辑政策新闻 → terror_events 统计异动 11.2 倍，必须被抑制/改判媒体舆论异动
 *   B. 对照组：8 条真实恐袭标题 → 必须正常通过（pass）
 *   C. 非暴力类同质簇（同一制裁事件多源报道）→ homo（单一事件多源报道，降级黄）
 *   D. 非暴力类多元簇 → pass（统计异动照常有意义）
 * 运行：node _anom_check.js，全绿退出码 0。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const m = src.match(/\/\* ===== 2026-09-01 内容实质校验层[\s\S]*?(?=\nasync function _runAnomalyWatch)/);
if (!m) { console.error('FAIL: 未在 server.js 中找到内容实质校验层代码块'); process.exit(1); }
/* 在独立函数作用域内执行真实代码块，导出被测函数 */
const factory = new Function(m[0] + '\nreturn { _anomSubstanceCheck, _anomHomoCheck, _anomTitleSim, _anomAnchor };');
const api = factory();
console.log('已从 server.js 提取校验函数：' + Object.keys(api).join(', '));

let failed = 0;
function check(name, cat, titles, expectActions) {
  const r = api._anomSubstanceCheck(cat, titles);
  const ok = expectActions.includes(r.action);
  if (!ok) failed++;
  console.log('\n[' + (ok ? 'PASS' : 'FAIL') + '] ' + name + '  cat=' + cat + '  样例 ' + titles.length + ' 条');
  console.log('  期望 action ∈ ' + JSON.stringify(expectActions) + '，实际 action = ' + JSON.stringify(r.action));
  console.log('  reason = ' + (r.reason || '(无)'));
  return r;
}

/* ===== A. 用户投诉真实案例：CBC 改 9·11"恐怖袭击"标签政策（今日 8 条 terror_events，日均 0.7，11.2 倍）===== */
const cbcTitles = [
  '加拿大广播公司改变了对9·11使用"恐怖袭击"标签的政策',
  '加拿大广播公司告诉工作人员不要称9·11为恐怖袭击',
  'CBC新编辑方针：不再将9·11事件称为恐怖袭击',
  '加拿大广播公司更新措辞指南引发争议',
  '多家加拿大新闻机构决定修改恐袭报道用语',
  'CBC解释修改9·11报道用语的编辑政策',
  '加拿大广播公司否认因政府压力改变措辞',
  '外媒关注CBC恐袭标签政策调整'
];
const rA = check('A: CBC 媒体政策簇（用户投诉案例，11.2 倍异动）', 'terror_events', cbcTitles, ['media', 'suppress']);
console.log('  → 该场景下原逻辑会生成【风险升温】加拿大·恐怖事件 信号；现被' + (rA.action === 'media' ? '改判媒体舆论异动（黄+标注+不入预警中心）' : '抑制') + ' ✓');

/* ===== B. 对照组：真实恐袭聚集日（必须正常触发）===== */
const realTitles = [
  '索马里摩加迪沙自杀式汽车炸弹袭击致10死20伤',
  '青年党在巴尔达勒发动袭击击毙3名士兵',
  '基斯马尤路边炸弹袭击军队车队致2伤',
  '摩加迪沙市场枪击事件造成2死5伤',
  '非盟部队在希尔沙贝利与武装分子交火',
  '索马里青年党无人机打击政府军营地',
  '摩加迪沙机场附近发生爆炸暂无组织认领',
  '盖多州武装分子伏击平民车队致4死'
];
check('B: 索马里真实恐袭聚集日（8 条独立事件）', 'terror_events', realTitles, ['pass']);

/* ===== C. 非暴力类：同一制裁事件多源报道（高度同质）===== */
const sancTitles = [
  '美国财政部宣布对伊朗石油部门实施新制裁',
  '美国财政部对伊朗石油部门制裁措施细节公布',
  '美国财政部宣布制裁伊朗石油部门相关企业',
  '详析美国财政部对伊朗石油部门的新制裁',
  '美国财政部制裁伊朗石油部门 油价应声上涨'
];
check('C: 制裁类单一事件多源报道（标题同质）', 'sanctions_data', sancTitles, ['homo']);

/* ===== D. 非暴力类：多元独立事件（异动有意义，应通过）===== */
const mixedTitles = [
  '巴基斯坦政局动荡 总理面临不信任投票',
  '巴央行宣布加息300个基点应对经济风险',
  '中巴经济走廊项目进度审查会议召开',
  '巴基斯坦暴雨引发洪涝多地受灾',
  '巴最高法院裁决选举日程争议'
];
check('D: 巴政局/经济多元事件簇（独立事件聚集）', 'political_events', mixedTitles, ['pass']);

/* ===== E. 边界：暴力类但样例不足（<3 条，不校验）===== */
check('E: 样例不足（2 条）不校验', 'terror_events', ['某地发生爆炸', '某地枪击案'], ['pass']);

console.log('\n========== 结果：' + (failed ? 'FAIL ' + failed + ' 项' : '全部通过') + ' ==========');
process.exit(failed ? 1 : 0);
