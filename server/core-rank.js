/**
 * core-rank.js — 「核心度」数据筛选规则单一事实源（#785，2026-09-13 用户指令：
 * 「所有功能区涉及数据显示的，筛选不是核心重点数据，重新设计；特别是涉华，专家视角」）
 * ================================================================================
 * 病根：全站显示接口 ORDER BY collect_time DESC —— 谁新谁上。
 *   ① backfill 历史补采占库 89%，合成句/低危条目把真正的高危情报挤出首屏；
 *   ② severity 词表三套混用（high/red/高、orange、medium/yellow/中），86.6% 是 low；
 *   ③ 涉华面板用标题 ILIKE 硬扫，入库时 isChinaRelatedStrict 判定的 chinaRelated
 *      标记未使用；_chinaNegative 仅 108 行（稀疏），无 24h 涉华负面置顶。
 *
 * 真实分布画像（2026-09-13，147,398 行 approved，orps-tmp/_p785_profile*.js）：
 *   severity: low 127,594 / medium 10,686 / high 3,697 / red 859 / orange 700 / 中 652 / yellow 73
 *   chinaRelated: true 5,815 / false 141,552（入库判定，可信）
 *   factSheet: 102,802 行（69.7%）
 *   risk_score: p25=13 p50=21 p75=33 p90=48 p95=60 max=90
 *
 * 核心度 = 涉华35 + 级别22 + 类型10 + 时效13 + 风险分10 + 要素5 + 多源5（满分100）。
 * 全部 SQL 可表达，供各显示接口内联（一处定义，全站同一套）。
 */
'use strict';

/* ---------- 一、资格闸（未过 = 不进任何核心视图；只藏不删） ---------- */
const GATE_SQL = `
      audit_status = 'approved'
      AND COALESCE(data_json->>'_archiveEvent','') <> 'true'
      AND COALESCE(data_json->>'_tplLowConf','') <> 'true'
      AND (COALESCE(data_json->>'title_zh','') ~ '[一-龥]' OR title ~ '[一-龥]')`;

/* ---------- 二、核心度评分（SQL 表达式；调用处须能引用 title / data_json / collect_time / data_type） ---------- */
/* severity 词表归一：high 族=high/red/高/critical/紧急；orange=中高；mid 族=medium/yellow/中 */
const SCORE_SQL = `(
      /* ① 涉华维度 0-35：负面 > 关联 > 无（涉华是本平台第一优先） */
      (CASE
        WHEN COALESCE(data_json->>'_chinaNegative','') = 'true' THEN 35
        WHEN COALESCE(data_json->>'chinaRelated','') = 'true'   THEN 22
        ELSE 0 END)
      /* ② 级别 0-22：词表三套归一后取档 */
      + (CASE
        WHEN COALESCE(NULLIF(data_json->>'severity',''), severity) IN ('high','red','高','critical','紧急','severe') THEN 22
        WHEN COALESCE(NULLIF(data_json->>'severity',''), severity) IN ('orange','中高') THEN 17
        WHEN COALESCE(NULLIF(data_json->>'severity',''), severity) IN ('medium','yellow','中') THEN 11
        ELSE 3 END)
      /* ③ 事件类型 0-10：武力类 > 强制/治安类 > 其余 */
      + (CASE
        WHEN data_type IN ('terror_events','military_conflicts','security_events') THEN 10
        WHEN data_type IN ('sanctions_data','crime_events','social_unrest','infrastructure') THEN 7
        ELSE 4 END)
      /* ④ 时效 0-13：24h 内满档，30 天外归零（软衰减，不做硬截断） */
      + (CASE
        WHEN collect_time >= NOW() - INTERVAL '24 hours' THEN 13
        WHEN collect_time >= NOW() - INTERVAL '72 hours' THEN 10
        WHEN collect_time >= NOW() - INTERVAL '7 days'   THEN 6
        WHEN collect_time >= NOW() - INTERVAL '30 days'  THEN 2
        ELSE 0 END)
      /* ⑤ 平台风险分 0-10：rs≥70 满档、≤20 为 0（真实分位 p95=60 → 前 5% 拿满） */
      + (CASE WHEN data_json ? 'risk_score' AND data_json->>'risk_score' ~ '^[0-9.]+$'
              THEN ROUND(LEAST(10.0, GREATEST(0.0, ((data_json->>'risk_score')::numeric - 20) / 5.0)))
              ELSE 0 END)
      /* ⑥ 情报要素完整度 0-5（#782 factSheet：时间/地点/主体/事件/结果/伤亡） */
      + (CASE
        WHEN jsonb_typeof(data_json->'factSheet') = 'array' THEN
          CASE WHEN jsonb_array_length(data_json->'factSheet') >= 5 THEN 5
               WHEN jsonb_array_length(data_json->'factSheet') >= 3 THEN 3
               ELSE 1 END
        ELSE 0 END)
      /* ⑦ 多源佐证 0-5（GDELT 报道量 / 采集 mentions，log 档） */
      + (CASE
        WHEN GREATEST(COALESCE(NULLIF(data_json->>'_gdArticles','')::int, 0), COALESCE(NULLIF(data_json->>'mentions','')::int, 0)) >= 20 THEN 5
        WHEN GREATEST(COALESCE(NULLIF(data_json->>'_gdArticles','')::int, 0), COALESCE(NULLIF(data_json->>'mentions','')::int, 0)) >= 5  THEN 3
        WHEN GREATEST(COALESCE(NULLIF(data_json->>'_gdArticles','')::int, 0), COALESCE(NULLIF(data_json->>'mentions','')::int, 0)) >= 2  THEN 1
        ELSE 0 END)
    )`;

/* 完整排序子句：核心度优先，同分按入库时间（同事件多报道保证最新在前） */
const ORDER_SQL = ` ORDER BY ` + SCORE_SQL.replace(/\n\s*/g, ' ') + ` DESC, collect_time DESC, id DESC `;

/* ---------- 三、涉华面板专用（专家视角分层） ---------- */
/* 负面词表（确定性规则，零生成式；仅用于涉华子集的展示分层，不改库）。
 * 覆盖：武力侵害 / 治安侵害 / 强制措施 / 歧视排华 / 政策限制 / 灾害风险。 */
const NEG_RE = /袭击|遇袭|绑架|劫持|抢劫|爆炸|爆炸物|枪击|暗杀|杀害|遇难|身亡|伤亡|勒索|胁迫|威胁|恐吓|诈骗|贩毒|走私|偷渡|逮捕|被抓|拘留|拘押|羁押|判刑|获刑|遣返|驱逐|吊销|查封|排华|辱华|歧视|仇恨|种族主义|制裁|禁运|黑名单|管制|限制|禁令|关税|调查|处罚|罚款|警告|提醒|撤离|撤侨|戒备|风险提示|坠机|沉船|海难|地震|洪水|山火|疫情|冲突|交火|交战|战争|政变|骚乱|罢工|游行示威|搁浅|扣押/i;

/* 涉华关键词（ILIKE 兜底召回用；flag 未打的存量行靠它）——与 china 面板旧表一致并补全 */
const CN_KEYWORDS = ['中国', '中资', '中企', '中方', '华人', '华侨', '华裔', '涉华', '对华', '驻华', '访华', '一带一路', '中巴经济走廊',
  'China', 'Chinese', 'Beijing', 'Belt and Road', 'CPEC', 'Sino-'];

/** JS 侧负面判定（与 NEG_RE 同源） */
function isNegativeZh(text) { return NEG_RE.test(String(text || '')); }

/**
 * 涉华分层（展示用，不改库）：
 *   layer 1 = 24h 涉华负面（硬规则：24h 涉华负面最优先）
 *   layer 2 = 涉华负面（>24h）
 *   layer 3 = 涉华（flag 命中，isChinaRelatedStrict 口径）
 *   layer 4 = 仅关键词命中（flag 未打，弱涉华 → 沉底防噪声）
 */
function cnLayer(it, nowMs) {
  const t = String(it.title_zh || it.title || '');
  const neg = it._chinaNegative === true || it._chinaNegative === 'true' || isNegativeZh(t);
  const age = nowMs - new Date(it.collect_time || Date.now()).getTime();
  if (neg && age <= 24 * 3600e3) return 1;
  if (neg) return 2;
  if (it.chinaRelated === true || it.chinaRelated === 'true') return 3;
  return 4;
}

module.exports = { GATE_SQL, SCORE_SQL, ORDER_SQL, NEG_RE, CN_KEYWORDS, isNegativeZh, cnLayer };
