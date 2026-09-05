/**
 * server/forecast-engine.js —— 统一国别预测推演引擎（#626）
 * =====================================================================
 * 收敛平台四处各自为政的预测推演（country FORECAST.ENGINE 前端规则外推 /
 * 情景推演 LLM / models 线性回归 / foresee 八维预判）为单一算法源：
 *   · 数据源：intel_data 审核通过的真实情报（60 天窗）——数据联动，非展示层拼装；
 *   · 算法：与原前端 FORECAST.ENGINE 同款（国别基线 + 等级加权时间衰减强度 +
 *     动量外推 + 均值回归 + 置信度），公式一处维护，前端降级兜底同构；
 *   · 基线：server/country-bases.js（由前端 COUNTRIES 八维评分同权提取）；
 *   · 消费：GET /api/forecast/countries（country 视图优先消费，失败前端本地降级）。
 *
 * 零模拟数据铁律：无样本即无输出；时间戳缺失样本不参与趋势对比（如实弃权）。
 */
'use strict';
const BASES = require('./country-bases');

/* 等级权重 / 类型→八维映射（与前端 FORECAST.ENGINE 同构） */
const LV_W = { red: 1.0, orange: 0.6, yellow: 0.3, blue: 0.15 };
const TYPE_DIM = (function () {
  const m = {
    terror_events: '安全风险', security_events: '安全风险', military_conflicts: '安全风险',
    political_events: '政治风险', natural_disasters: '自然环境风险', public_health: '安全风险',
    sanctions_data: '经济风险', economic_risk: '经济风险', social_unrest: '社会文化风险',
    infrastructure: '运营风险', geopolitical_intel: '地缘战略风险', osint_intel: '安全风险'
  };
  /* 分类体系 v2.0（#627）：18 子类 → 9 类风险类型，经 CAT_STD.alertType 覆盖 */
  try {
    const STD = require('./category-standard');
    (STD.SUBCATS || []).forEach(s => { m[s.key] = s.alertType; });
  } catch (e) {}
  return m;
})();
const SELF = { '中国': 1, '中国大陆': 1, '中华人民共和国': 1, 'China': 1, '中国香港': 1, '中国澳门': 1, '中国台湾': 1 };
const ALIAS = {
  '印尼': '印度尼西亚', '沙特': '沙特阿拉伯', '俄': '俄罗斯', '美': '美国', '缅': '缅甸', '菲': '菲律宾',
  '越': '越南', '韩': '韩国', '刚果金': '刚果（金）', '刚果（金）': '刚果（金）', '民主刚果': '刚果（金）',
  '孟加拉': '孟加拉国', '南非共和国': '南非', '埃塞': '埃塞俄比亚'
};
function norm(n) {
  const s = String(n || '').trim();
  return ALIAS[s] || s;
}
function clamp10(v) { return Math.max(0, Math.min(10, Math.round(v * 10) / 10)); }

/* 处置建议（规则驱动，与前端同款文案） */
function advice(cn, p6, type, reds, mom) {
  const t = [];
  if (p6 >= 8) t.push('启动一级响应，评估撤离条件');
  else if (p6 >= 6) t.push('提升安保等级，限制非必要出行');
  else if (p6 >= 4) t.push('保持常态监控，完善应急预案');
  else t.push('维持例行研判');
  if (mom > 0.5) t.push('风险快速上行，加密研判频次');
  if (type === '安全风险' && reds) t.push('核查在当地人员与项目点位');
  else if (type === '经济风险') t.push('排查合规敞口与资金汇出通道');
  else if (type === '地缘战略风险') t.push('评估通道替代与供应链冗余');
  else if (type === '社会文化风险') t.push('加强属地沟通与舆情应对');
  else if (type === '自然环境风险') t.push('检查营地防灾与医疗保障');
  return t.join('；');
}

/* 基线兜底：基线表未收录国由样本等级分布反推保守基线（同前端 inferBase） */
function inferBase(arr) {
  let w = 0;
  arr.forEach(s => { w += LV_W[s.level] || 0.15; });
  const avg = w / Math.max(arr.length, 1);
  return Math.round((2.8 + avg * 4.7) * 10) / 10;
}

/**
 * 主计算：PG 行 → 国别预测行集。
 * @param rows  SELECT country, level, type, title, ts (ms, 0=缺失) 的已审核行
 */
function compute(rows) {
  const now = Date.now(), DAY = 86400000;
  const byC = {};
  let total = 0, detailed = 0, minTs = now, maxTs = 0;
  rows.forEach(r => {
    const cn = norm(r.country);
    if (!cn || cn === '未知' || SELF[cn]) return;
    const s = { country: cn, level: r.level || 'blue', type: r.type || '安全风险', title: r.title || '', ts: r.ts || 0, detailed: !!r.detailed };
    (byC[cn] = byC[cn] || []).push(s);
    total++;
    if (s.detailed) detailed++;
    if (s.ts) { if (s.ts < minTs) minTs = s.ts; if (s.ts > maxTs) maxTs = s.ts; }
  });
  const spanDays = total ? Math.max(1, Math.round((maxTs - minTs) / DAY)) : 0;
  const out = [];
  Object.keys(byC).forEach(cn => {
    const arr = byC[cn];
    const b = BASES[cn];
    const hasBase = !!b;
    const base = hasBase ? b.base : inferBase(arr);
    /* 事件强度：等级权重 × 时间衰减（半衰期 30 天）；无时间戳样本只按折中衰减计入总强度，趋势弃权 */
    let inten = 0, recent = 0, prior = 0, nRecent = 0, nPrior = 0, nNoTs = 0;
    arr.forEach(s => {
      const w = LV_W[s.level] || 0.15;
      if (!s.ts) { inten += w * 0.5; nNoTs++; return; }
      const ageD = Math.max(0, (now - s.ts) / DAY);
      inten += w * Math.pow(0.5, ageD / 30);
      if (ageD <= 15) { recent += w; nRecent++; }
      else if (ageD <= 45) { prior += w; nPrior++; }
    });
    /* 当前风险 = 基线 + 事件上浮（饱和上限 +2.5，事件是加成非加权平均） */
    const boost = 2.5 * (1 - Math.exp(-inten / 2.2));
    const cur = clamp10(base + boost);
    /* 动量：近 15 天 vs 前 15-45 天（前窗折算等长）；时序样本不足 2 条不做外推 */
    const nTs = nRecent + nPrior, momWeak = (nTs < 2);
    const priorNorm = prior / 2;
    let mom = momWeak ? 0 : (recent - priorNorm) / Math.max(priorNorm, 0.5);
    mom = Math.max(-1.6, Math.min(1.6, mom));
    /* 波动率 + 均值回归 */
    const vol = 0.45 + Math.min(0.85, inten / 6);
    const rev = (cur - base) * 0.18;
    const p3 = clamp10(cur + mom * 0.62 * vol - rev * 0.5);
    const p6 = clamp10(cur + mom * 0.88 * vol - rev);
    /* 置信度：样本量 + 细节完整度 + 时序完备性；无权威基线如实扣减 */
    const n = arr.length;
    const det = arr.filter(s => s.detailed).length;
    const withTs = arr.filter(s => !!s.ts).length;
    let conf = 48 + Math.min(n, 24) * 1.35 + (det / Math.max(n, 1)) * 16 + (withTs / Math.max(n, 1)) * 10 + ((nRecent && nPrior) ? 6 : 0);
    if (!hasBase) conf -= 12;
    conf = Math.max(30, Math.min(94, Math.round(conf)));
    /* 驱动因素：真实类型分布 Top3 */
    const tc = {};
    arr.forEach(s => { tc[s.type] = (tc[s.type] || 0) + 1; });
    const tops = Object.keys(tc).sort((a, b) => tc[b] - tc[a]);
    let driver = tops.slice(0, 3).map(t => t + ' ' + tc[t] + '起').join(' · ');
    const reds = arr.filter(s => s.level === 'red').length;
    const oranges = arr.filter(s => s.level === 'orange').length;
    if (reds) driver += '｜红色' + reds + '条';
    const latest = arr.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    const mainType = tops[0] || '安全风险';
    /* 计算样本明细（cap 40，时间倒序）：前端 explain() 依据溯源直接消费，保证与服务端同一数据源 */
    const smps = arr.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 40)
      .map(s => ({ title: s.title, level: s.level, type: s.type, ts: s.ts, detailed: s.detailed, src: 'intel_data（审核通过）' }));
    out.push({
      country: cn, flag: b ? b.flag : '🌐', region: b ? b.region : '', hasBase: hasBase,
      cur: cur, p3: p3, p6: p6, base: Math.round(base * 10) / 10,
      trend: (p6 - cur) > 0.15 ? 'up' : (p6 - cur) < -0.15 ? 'down' : 'flat',
      mom: Math.round(mom * 100) / 100, confidence: conf, momWeak: momWeak, nNoTs: nNoTs,
      n: n, nRed: reds, nOrange: oranges, nRecent: nRecent, detailed: det,
      driver: driver, mainType: mainType,
      latest: latest ? latest.title : '', latestTs: latest ? latest.ts : 0,
      samples: smps,
      advice: advice(cn, p6, mainType, reds, mom)
    });
  });
  out.sort((a, b) => (b.p6 - b.cur) - (a.p6 - a.cur) || b.p6 - a.p6);
  return { ok: true, rows: out, total: total, detailed: detailed, span: spanDays, engine: 'server-unified', computedAt: new Date().toISOString() };
}

/* PG 查询 + 主计算（server.js 注入 query） */
async function computeFromDb(query) {
  const { rows } = await query(
    `SELECT COALESCE(NULLIF(country,''), data_json->>'country_cn', '') AS country,
            COALESCE(NULLIF(data_json->>'level_norm',''), severity, 'yellow') AS level,
            data_type AS type,
            COALESCE(NULLIF(data_json->>'title_zh',''), title, '') AS title,
            CASE WHEN COALESCE(LENGTH(data_json->>'content_zh'),0) >= 200 THEN 1 ELSE 0 END AS detailed,
            GREATEST(
              CASE WHEN event_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN event_date::timestamptz ELSE NULL END,
              collect_time
            ) AS t
     FROM intel_data
     WHERE collect_time >= NOW() - INTERVAL '60 days' AND audit_status = 'approved'
       AND COALESCE(NULLIF(country,''), data_json->>'country_cn', '') <> ''`
  );
  const samples = rows.map(r => ({
    country: r.country, level: r.level, type: TYPE_DIM[r.type] || '安全风险',
    title: r.title, detailed: !!r.detailed,
    ts: r.t ? new Date(r.t).getTime() : 0
  }));
  return compute(samples);
}

module.exports = { compute, computeFromDb, _norm: norm };
