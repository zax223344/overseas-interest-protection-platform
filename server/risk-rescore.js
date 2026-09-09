/* ============================================================
 * server/risk-rescore.js — _scoreRiskItem 共享实现（#724 P0-3 → #723 存量重刷）
 * ================================================================
 * 用途：把 server.js:7571 _scoreRiskItem 的纯逻辑部分抽到独立模块，
 * 避免迁移脚本和线上服务两处分别维护导致漂移。
 * 依赖：entities.js（实体识别）+ risk-level.js（红蓝闸+定级归一）。
 * 端点：无（被 server.js _scoreRiskItem 与 orps-tmp/_723_resync.js 共用）。
 * ============================================================ */
'use strict';
const ENTITY = require('../entities.js');
const RL = require('./risk-level');

const ZONE_ACTIONS = {
  green: '绿区（0-30分）：正常运营，无需特殊防护，保持常态关注。',
  yellow: '黄区（31-60分）：加强安保巡逻，限制人员外出，密切关注事态发展，做好应急准备。',
  red: '红区（61-100分）：立即启动应急预案，视情考虑人员撤离，与驻外使领馆保持24小时通联。'
};

/* 与 server.js 原版完全同步——任何对红/橙/黄边界的修改必须双改 */
function rescoreRiskItem(it) {
  const r = ENTITY.assessRisk({
    title: String(it.title || '') + ' ' + String(it.title_zh || ''),
    content: String(it.content_zh || '') + ' ' + String(it.content || it.desc || it.description || ''),
    country: it.country || it.country_cn || '',
    source: it.source || '', platform: it.platform || '',
    publishedAt: it.publishedAt || it.pubDate || it.collect_time || '',
    chinaNegative: it._chinaNegative === true || it.chinaNegative === true
  });
  let score = r.riskScore;
  const hits = (r.ruleHits || []).slice();
  const hitIds = hits.map(h => h.rule);
  const ent = r.entities || { enterprises: [], projects: [], assets: [] };
  const t = String(it.title || '') + ' ' + String(it.title_zh || '') + ' ' + String(it.content || it.desc || '').slice(0, 300);
  const chinaSig = /中国|中资|中企|中方|华人|华侨|华裔|中国公民|留学生|一带一路|中国使领馆|中国驻|撤侨|Chinese|China|CPEC/i.test(t)
    || ent.enterprises.length > 0 || ent.projects.length > 0 || (it.asset_tags && it.asset_tags.length > 0);
  const cm = t.match(/(\d{1,4})\s*(?:名|人|个)?\s*(?:死亡|身亡|遇难|丧生|被打死|被击毙)/) ||
             t.match(/(\d{1,4})\s*(?:people\s+)?(?:killed|dead|deaths)/i) ||
             t.match(/(?:death toll|kills)\s*(\d{1,4})/i);
  const deaths = cm ? parseInt(cm[1], 10) : 0;
  const redEligible = RL.red1Of(t);
  if (score >= 61 && !redEligible) {
    hits.push({ rule: 'R-Z05', name: '红区硬约束：仅涉华生命安全/重大地缘外溢可入红，压至橙区上沿', add: 60 - score });
    score = 60;
  }
  if (redEligible && score < 61) {
    hits.push({ rule: 'R-Z06', name: '红区触发（RED-1 涉华生命安全）：中国公民被袭/绑/撤侨/中资项目营地遇袭/使领馆遇冲击', add: 61 - score });
    score = 61;
  }
  const red2 = RL.red2Of({ t, deaths, chinaSig, channel_tags: it.channel_tags, interest_tier: it.interest_tier });
  if (red2.hit && score < 61) {
    hits.push({ rule: 'R-Z07', name: '红区触发（RED-2 重大地缘外溢）：' + red2.why, add: 61 - score });
    score = 61;
  }
  const topThreat = (hits[0] && hits[0].rule) || '';
  if (topThreat === 'R-T09' && score >= 61 && !redEligible) {
    hits.push({ rule: 'R-Z04', name: '制裁类硬约束:一律不准入红', add: 55 - score });
    score = 55;
  }
  if (!chinaSig && deaths >= 10 && score < 46) {
    hits.push({ rule: 'R-Z02', name: '非涉华重大伤亡（' + deaths + '死），提级黄区态势关注', add: 46 - score });
    score = 46;
  }
  const SUBSTANTIVE_NONVIOLENT = ['R-T08', 'R-T09', 'R-T15', 'R-T19'];
  if (chinaSig && hitIds.some(id => SUBSTANTIVE_NONVIOLENT.indexOf(id) >= 0) && score < 40) {
    hits.push({ rule: 'R-Z03', name: '涉华实质威胁（征收/制裁/法律/用工），提级黄区下沿', add: 40 - score });
    score = 40;
  }
  try {
    const _bump = v => { if (score < 61) score = Math.min(60, score + v); };
    if (it.interest_tier === 'TIER1') { _bump(8); hits.push({ rule: 'R-IB1', name: '第一梯队利益国（利益极重+风险极高）', add: 8 }); }
    else if (it.interest_tier === 'TIER2') { _bump(4); hits.push({ rule: 'R-IB2', name: '第二梯队利益国', add: 4 }); }
    if (it.interest_projects && it.interest_projects.length) { _bump(6); hits.push({ rule: 'R-IB3', name: '命中重点项目:' + it.interest_projects.join('、'), add: 6 }); }
    if (it.channel_tags && it.channel_tags.length) { _bump(5); hits.push({ rule: 'R-IB4', name: '涉及海上战略通道:' + it.channel_tags.join('、'), add: 5 }); }
    if (it.country_risk_indicators && (it.country_risk_indicators.security >= 8 || it.country_risk_indicators.political >= 8)) { _bump(3); hits.push({ rule: 'R-IB5', name: '东道国风险指标高危（政治/公共安全≥8）', add: 3 }); }
  } catch (e) {}
  try {
    const _bump2 = v => { if (score < 61) score = Math.min(60, score + v); };
    const tags = it.core_threat_tags || [];
    if (tags.includes('cn_victim')) { _bump2(10); hits.push({ rule: 'R-CT1', name: '核心威胁:涉华人员/机构受害', add: 10 }); }
    else if (tags.length) { _bump2(5); hits.push({ rule: 'R-CT2', name: '核心威胁:' + (it.core_threat_name || tags.join('/')), add: 5 }); }
  } catch (e) {}
  const zone = score >= 61 ? 'red' : score >= 31 ? 'yellow' : 'green';
  const level = score >= 61 ? 'red' : score >= 46 ? 'orange' : score >= 31 ? 'yellow' : 'blue';
  return { score: score, zone: zone, level: level,
    rationale: hits.map(h => h.name + '(' + (h.add > 0 ? '+' : '') + h.add + ')').join('；'),
    action: ZONE_ACTIONS[zone] };
}

module.exports = { rescoreRiskItem: rescoreRiskItem, ZONE_ACTIONS: ZONE_ACTIONS };
