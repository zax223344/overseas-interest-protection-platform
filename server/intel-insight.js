/* ============================================================
 * server/intel-insight.js — 情报洞察服务（2026-09-05 用户指令三：5 项新增功能落地）
 * ================================================================
 * 此前 5 项建议只交付了建议清单（orps-tmp/功能审查建议-2026-09-05.md），未动代码。
 * 本文件把其中三项做成真实功能（零模拟，全部真实库计算）：
 *   ① GET /api/insight/leader-brief  领导要报速览（30 秒一页纸数据装配）
 *      近 24h 红橙 TOP + 涉华要点 + 一句话决策建议 + 待办风险，BLUF 结构。
 *   ② GET /api/insight/lifecycle     事件全生命周期时间线
 *      按事件签名/标题召回全库同源条目 → 首次采集→多源印证→预警入列→审核→归档
 *      五阶段时间线（各阶段均来自真实库字段，无处置工单数据的阶段如实标注）。
 *   ③ GET /api/insight/similar       相似历史事件匹配
 *      同类别 + 同国别 + 标题关键词重合（≥2 个实质词元）检索近 90 天历史事件，
 *      返回同类事件数、级别分布、复发间隔与处置结论线索。
 * 挂载：server.js 两行（require + app.use(intelInsight(ctx))）。
 * ============================================================ */
'use strict';
const express = require('express');
const scrapers = require('./scrapers');
const INTEREST_BASE = require('./interest-base'); /* 要道通道正则（与 reports-engine 同源单一来源） */
const reportsEngine = require('./reports-engine'); /* #664 公文版式引擎复用（govdoc.renderGovHtml，红头版式+图表复合分析与周期简报同源） */
const RL = require('./risk-level'); /* #724 P0-3：定级读取归一单一来源——与 ai-watch/恐袭/涉企同源，杜绝功能区口径漂移 */

/* 情报类别中文名（leader-brief 与 intel-center 共用） */
const _CAT_CN = {
  terror_events: '恐怖袭击', military_conflicts: '武装冲突', mass_violence: '群体性暴力',
  crime_events: '社会治安事件', regime_change: '政权变动', election_events: '选举事件',
  geopolitical_intel: '地缘外交', policy_shift: '政策法规突变', sanctions_data: '制裁与合规',
  financial_market: '金融市场风险', business_climate: '营商环境恶化', social_unrest: '社会动荡',
  public_health: '公共卫生', cyber_security: '网络与信息安全', industrial_accident: '生产安全事故',
  environmental_event: '环境生态事件', natural_disasters: '自然灾害', infrastructure: '基础设施中断'
};
/* 采集通道中文名（intel-center sources 用） */
const _CH_CN = {
  socmint_watch: '社媒哨兵（Mastodon）', social_media: '社媒采集', wechat_oa: '微信公众号线索',
  gap_scheduler: '缺口调度', core_threat_watch: '一分钟哨兵', channel_watch: '渠道哨兵',
  compliance_watch: '合规哨兵', consular_watch: '领事哨兵', cn_security_watch: '涉华安全哨兵',
  direct_rss: 'RSS 直采', gdelt: 'GDELT', gdelt_events: 'GDELT 事件', neon_sync: '云端同步',
  bri_watch: '一带一路采集', china_negative: '涉华负面采集', china_focus: '涉华专项采集',
  google_news: '谷歌新闻', sources_pack: '聚合源包', terror_attack: '恐袭专项采集',
  media: '媒体采集', threatroom: '威胁室采集', manual: '人工录入'
};
/* 级别归一：severity 列有脏值（历史写入），level_norm 优先，非四色一律回落 yellow
 * #724 P0-3：实现收敛到 risk-level.js assessLevel 单一来源（本函数保留为薄代理，
 * 全文件既有调用点不改名——与 ai-watch/china-terror/enterprise-risk 同一口径） */
function _lv(j, sev) {
  return RL.assessLevel(j, sev);
}

/* #718 实时数据铁律（用户原话：「事件研判中心……不能用旧数据，用近期的实时数据，
 * 这是铁律」）：leader-brief / intel-center 等实时视图的 SQL 一律排除补采回灌
 * （_sourceType='backfill'：collect_time=当下但事件为历史旧闻）与归档件。
 * 追加事件时间闸：档案级通道（china_terror/gap_scheduler 等）event_date 为 2022-2025
 * 旧闻但 collect_time 近期，ISO 格式超 45 天即排除；非 ISO 脏值保留。
 * 历史复盘类视图（lifecycle/similar/event-report 案卷、月度规律）不受此闸。 */
const FRESH = `COALESCE(data_json->>'_sourceType','') <> 'backfill' AND COALESCE(data_json->>'_archiveEvent','') <> 'true' AND (event_date IS NULL OR event_date !~ '^20\\d{2}-\\d{2}-\\d{2}' OR event_date >= to_char(NOW() - INTERVAL '45 days','YYYY-MM-DD'))`;

/* ============ #712 事件时效闸（主面板数据核实原则） ============
 * 用户口径（2026-09-08）：研判中心主面板只放「近期发生且对海外利益安全有现实威胁」的
 * 实时数据；旧数据只能作历史辅助。此前补采回灌/旧文重发（如 2004 年阿富汗 11 工人
 * 遇袭案，collect_time=昨晚）被误判为新鲜红橙事件顶上主面板——根因是只看采集时间。
 * 口径（自主研判）：
 *   _evTs   事件发生时间戳：publish_time/event_date 优先（regex-cast 铁律，varchar 脏值
 *           只认 YYYY-MM-DD 前缀）；无有效事件日期回落 collect_time（实时通道未带日期）。
 *   _evFresh 近 N 天内发生（默认 7 天）才算「近期」——研判队列/突发链等主面板闸门。
 *   _evAgeD 事件距今天数（案卷历史复盘标记用，>30 天 = 历史事件）。
 * 旧事件的合法去处：lifecycle / similar / event-report 历史复盘（全库不限时，标注历史）。 */
function _evTs(r) {
  const j = (r && r.data_json) || {};
  const raw = String(j.publish_time || r.event_date || '');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) { const t = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+08:00'); if (!isNaN(t)) return t; }
  const c = Date.parse(r && r.collect_time || '');
  return isNaN(c) ? 0 : c;
}
function _evFresh(r, days) {
  const t = _evTs(r);
  if (!t) return true; /* 连采集时间都缺的极端脏行，交下游闸门 */
  return (Date.now() - t) <= (days || 7) * 86400000;
}
function _evAgeD(r) {
  const t = _evTs(r);
  return t ? Math.floor((Date.now() - t) / 86400000) : 0;
}
function _evDate(r) {
  const j = (r && r.data_json) || {};
  return String(j.publish_time || r.event_date || '').slice(0, 10);
}

/* 中文数字/时间工具 */
function _nowCn() {
  const n = new Date();
  return n.getFullYear() + '年' + (n.getMonth() + 1) + '月' + n.getDate() + '日 ' +
    String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}
function _iso2cnTry(c) {
  /* 常用英文国名 → 中文（与 reports-engine _iso2cn 同源思路，本文件内自足） */
  const M = {
    'United States': '美国', 'United Kingdom': '英国', 'Russia': '俄罗斯', 'Ukraine': '乌克兰',
    'Pakistan': '巴基斯坦', 'Afghanistan': '阿富汗', 'Kazakhstan': '哈萨克斯坦', 'Indonesia': '印度尼西亚',
    'Malaysia': '马来西亚', 'Thailand': '泰国', 'Vietnam': '越南', 'Myanmar': '缅甸', 'Philippines': '菲律宾',
    'Nigeria': '尼日利亚', 'Sudan': '苏丹', 'Ethiopia': '埃塞俄比亚', 'Egypt': '埃及', 'Kenya': '肯尼亚',
    'Democratic Republic of the Congo': '刚果（金）', 'DR Congo': '刚果（金）', 'Congo': '刚果',
    'Zambia': '赞比亚', 'Zimbabwe': '津巴布韦', 'South Africa': '南非', 'Mali': '马里', 'Niger': '尼日尔',
    'Mozambique': '莫桑比克', 'Angola': '安哥拉', 'Algeria': '阿尔及利亚', 'Ghana': '加纳',
    'Tanzania': '坦桑尼亚', 'Namibia': '纳米比亚', 'Botswana': '博茨瓦纳', 'Guinea': '几内亚',
    'Chile': '智利', 'Peru': '秘鲁', 'Argentina': '阿根廷', 'Brazil': '巴西', 'Mexico': '墨西哥',
    'Bolivia': '玻利维亚', 'Ecuador': '厄瓜多尔', 'Colombia': '哥伦比亚', 'Venezuela': '委内瑞拉', 'Panama': '巴拿马',
    'Saudi Arabia': '沙特阿拉伯', 'United Arab Emirates': '阿联酋', 'Qatar': '卡塔尔', 'Kuwait': '科威特',
    'Oman': '阿曼', 'Iraq': '伊拉克', 'Iran': '伊朗', 'Israel': '以色列', 'Turkey': '土耳其', 'Türkiye': '土耳其',
    'Serbia': '塞尔维亚', 'Hungary': '匈牙利', 'Greece': '希腊', 'Cambodia': '柬埔寨', 'Laos': '老挝',
    'Bangladesh': '孟加拉国', 'Uzbekistan': '乌兹别克斯坦', 'Tajikistan': '塔吉克斯坦', 'Mongolia': '蒙古',
    'Haiti': '海地', 'France': '法国', 'Germany': '德国', 'Italy': '意大利', 'Netherlands': '荷兰',
    'Canada': '加拿大', 'Australia': '澳大利亚', 'Japan': '日本', 'Singapore': '新加坡', 'India': '印度'
  };
  if (!c) return '';
  if (/[\u4e00-\u9fa5]/.test(c)) return c;
  return M[String(c).trim()] || c;
}
/* 标题词元化（相似度计算用）：去停用词、取实质词 */
const _STOP = /^(在|于|与|和|及|对|被|将|已|的|了|是|称|说|案|后|前|中|新|再|又|不|无|有|人|国|军|警|the|a|an|of|in|on|at|to|for|and|or|is|are|was|were|be|been|as|by|with|from|after|before|over|into|says|said|amid|vs)$/i;
function _tokens(s) {
  const en = String(s || '').toLowerCase().match(/[a-z]{3,}/g) || [];
  const cn = String(s || '').match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  return en.concat(cn).filter(t => !_STOP.test(t));
}
function _overlap(a, b) {
  const A = new Set(a.map(x => x.toLowerCase())), B = new Set(b.map(x => x.toLowerCase()));
  let n = 0; A.forEach(x => { if (B.has(x)) n++; });
  return n;
}
/* 时间归一（本地时区）：RSS pubDate / PG Date 对象 / ISO 串 → 'YYYY-MM-DD HH:mm'；
 * 铁律：禁 toISOString()（UTC 偏移导致日期错位），全部走本地 getXXX */
function _fmtTime(t) {
  if (t == null || t === '') return '';
  const d = (t instanceof Date) ? t : new Date(String(t).replace('T', ' ').replace(/(?:\s?[+-]\d{2}:?\d{2}|Z)$/, ''));
  if (isNaN(d.getTime())) return String(t).slice(0, 16).replace('T', ' ');
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

module.exports = function intelInsight(ctx) {
  const q = ctx.query;
  const isChina = ctx.isChinaRelated || scrapers.isChinaRelatedStrict;
  const llmCall = (ctx.llm && ctx.llm.callMsg) || null;
  const router = express.Router();

  /* ---------- ① 领导要报速览（30 秒一页纸数据装配；#740-1 抽取共享底座，5min 缓存） ---------- */
  let _lbCache = null, _lbCacheAt = 0;
  async function _loadBrief() {
    if (_lbCache && Date.now() - _lbCacheAt < 300000) return _lbCache;
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const { rows } = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data WHERE collect_time >= $1 AND audit_status='approved' AND ${FRESH} ORDER BY collect_time DESC LIMIT 3000`,
        [since]
      );
      const items = rows.map(r => {
        const j = r.data_json || {};
        /* #688 时间归一修复：publish_time/event_date 解析失败（英文残串）回落 collect_time */
        let time = _fmtTime(j.publish_time || r.event_date || r.collect_time);
        if (!/^\d{4}-/.test(time)) time = _fmtTime(r.collect_time);
        return {
          id: r.id, type: r.data_type,
          title: r.title_cn || r.title || '',
          country: _iso2cnTry(r.country || j.country_cn || ''),
          severity: _lv(j, r.severity),
          source: r.source || j.source || '',
          time,
          url: j.url || '',
          sig: j._eventSig || '',
          china: !!isChina(String(r.title || '') + ' ' + String(r.title_cn || '')),
          corr: Number(j.corroboration || 0),
          deaths: Number(j.deaths || 0),
          /* #688 事件时效：回补入库的旧事件（event_date/publish_time 早于 48h）不进要报榜 */
          stale: /^\d{4}-\d{2}-\d{2}/.test(time) ? (Date.now() - new Date(time).getTime()) > 48 * 3600 * 1000 : false
        };
      });
      const reds = items.filter(i => i.severity === 'red');
      const oranges = items.filter(i => i.severity === 'orange');
      const chinas = items.filter(i => i.china);

      /* ===== #688 选题质量整治：核心（硬安全事件）· 重点（红橙/涉华/多源）· 不重复（同事件归并去重） ===== */
      /* ① 标题质量门：过短、t.co/URL 残留的条目直接出局 */
      const _okTitle = i => {
        const t = i.title || '';
        if (t.length < 8) return false;
        if (/\bt\.co\b|https?:\/\//.test(t)) return false;
        return true;
      };
      /* ② 硬安全事件词（领导要报的核心素材：真袭击/真伤亡/真冲突） */
      const _INC_RE = /(袭击|遇袭|爆炸|绑架|劫持|人质|枪击|开火|交火|空袭|炮击|火箭弹|导弹|无人机袭击|身亡|死亡|遇难|伤亡|死伤|击毙|遗体|冲突爆发|交战|武装人员|极端分子|恐怖|袭击者|枪手|撤侨|袭击事件)/;
      /* ③ 经贸/文娱噪音词（不是领导要报素材，重罚出榜） */
      const _NOISE_RE = /(反倾销|关税|股价|股市|股票|基金净值|袋费|票价|联赛|锦标赛|天气预报|票房|综艺|加息|利率|财报|招股|IPO|冠军|选秀|打折|促销)/;
      /* #688b（20:28 用户口径）中资企业海外立项与经营安全要素——这才是重点 */
      const _CNBIZ_RE = /(中资|中国企业|中国公司|中方项目|中企|中国工人|中国工程师|中国公民|中国籍|华商|华人商铺|经济走廊|CPEC|一带一路|工业园|矿区|油田|电站|承包工程|驻外机构|大使馆|领事馆|孔子学院|中资银行|中国投资|中方人员|项目遇袭|项目暂停|停工)/;
      /* #688b 俄罗斯方向降权：仅特别重大（红色/死亡≥10/三源以上印证）才保留权重 */
      const _isRu = i => (i.country === '俄罗斯' || /俄罗斯/.test(i.title || ''));
      const _major = i => i.severity === 'red' || (i.deaths || 0) >= 10 || (i.corr || 0) >= 3;
      /* #688b 涉华负面加权、正面软新闻降权（庆祝/合作类不是要报素材） */
      const _NEG_RE = /(袭击|遇袭|爆炸|绑架|劫持|人质|制裁|打压|封锁|禁令|管制|警告|威胁|暂停|停工|抗议|示威|骚乱|排华|反华|歧视|摩擦|纠纷|冲突|死亡|遇难|枪击|拘留|逮捕|起诉|扣押|没收|风险)/;
      const _POS_RE = /(庆祝|友谊|合作共赢|携手|开辟了|落成|揭牌|签署合作|音乐会|欢迎|成果丰硕|职业道路)/;
      /* ④ 类型权重（恐袭/武装冲突最高，经贸金融垫底） */
      const _TYPE_W = {
        terror_events: 24, military_conflicts: 20, mass_violence: 16, crime_events: 16,
        social_unrest: 14, regime_change: 14, natural_disasters: 12, cyber_security: 10,
        industrial_accident: 10, public_health: 10, environmental_event: 8, infrastructure: 8,
        election_events: 6, political_events: 6, sanctions_data: 5, geopolitical_intel: 5,
        policy_shift: 4, business_climate: 3, financial_market: 2
      };
      const _score = i =>
        ({ red: 100, orange: 55, yellow: 25, blue: 8 }[i.severity] || 5)
        + (i.china ? 35 : 0)
        + (_INC_RE.test(i.title) ? 30 : 0)
        + Math.min(i.corr, 6) * 6
        + Math.min(i.deaths || 0, 50) * 2
        + (_TYPE_W[i.type] || 4)
        - (_NOISE_RE.test(i.title) ? 60 : 0)
        + (_CNBIZ_RE.test(i.title) ? 18 : 0)
        + (i.china && _NEG_RE.test(i.title) ? 15 : 0)
        - (_POS_RE.test(i.title) ? 20 : 0)
        - (i.country === '中国' ? 25 : 0)
        - (_isRu(i) && !_major(i) ? 30 : 0)
        /* GDELT 模板句（"国别：A 对 B 发动XX/实施XX"）机翻格式差、事件语义弱，重罚出榜 */
        - (/^[^：]{1,14}：.+对.+(发动|实施|进行|举行|表达)/.test(i.title) ? 45 : 0);
      /* ⑤ 同事件归并：同 _eventSig / 同 URL / 同国别+相似标题 判为同一事件；
       *    归并时累计独立来源数（前端「N 源印证」徽章），代表条目取组内评分最高者。
       *    相似判定：CJK 二元组+拉丁词包含度（_sim）或词元重合≥3（词元切块对中文不稳，双保险） */
      const _bgrams = t => {
        const s = String(t || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9 ]/g, ' ');
        const set = new Set();
        (s.match(/[\u4e00-\u9fa5]{2,}/g) || []).forEach(w => { for (let k = 0; k + 2 <= w.length; k++) set.add(w.slice(k, k + 2)); });
        (s.toLowerCase().match(/[a-z]{3,}/g) || []).forEach(w => set.add(w));
        return set;
      };
      const _sim = (a, b) => {
        const A = _bgrams(a), B = _bgrams(b);
        if (!A.size || !B.size) return 0;
        let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
        return inter / Math.min(A.size, B.size);
      };
      const pool = items.filter(_okTitle).sort((a, b) => _score(b) - _score(a));
      const picked = [];
      for (const i of pool) {
        if (picked.length >= 60) break;
        let hit = null;
        for (const p of picked) {
          if (i.sig && i.sig === p.sig) { hit = p; break; }
          if (i.url && i.url === p.url) { hit = p; break; }
          if (i.country && i.country === p.country && (_overlap(_tokens(i.title), _tokens(p.title)) >= 3 || _sim(i.title, p.title) >= 0.40)) { hit = p; break; }
        }
        if (hit) {
          if (i.source) hit._srcSet.add(i.source);
          hit._corrN++;
          if (_score(i) > _score(hit)) { /* 保留评分更高的代表（级别/伤亡/印证） */
            const keepN = hit._corrN, keepS = hit._srcSet;
            Object.assign(hit, i); hit._corrN = keepN; hit._srcSet = keepS;
          }
        } else {
          i._corrN = 1; i._srcSet = new Set(i.source ? [i.source] : []);
          picked.push(i);
        }
      }
      const _corr = i => Math.max(i._corrN || 1, i._srcSet ? i._srcSet.size : 1);
      /* TOP5 入选门：海外事件（国别≠中国）+ 硬事件词/涉华/红色 + 48h 时效（杜绝经贸评论/国内事务凑数） */
      const gate = i => !i.stale && i.country !== '中国' && (_INC_RE.test(i.title) || i.china || i.severity === 'red');
      const top = picked.filter(gate).slice(0, 5);
      /* 涉华榜：海外方向（国别≠中国）+ 俄罗斯普通条目最多保留 1 条（特别重大不受限）——20:28 用户口径 */
      let _ruN = 0;
      const chinaTop = picked.filter(i => i.china && !i.stale && i.country !== '中国' && !top.includes(i))
        .filter(i => !_isRu(i) || _major(i) || _ruN++ < 1).slice(0, 5);
      /* 待办风险：涉华橙黄未升级项（不在 TOP5 内的，供值班主任追办） */
      const pending = picked.filter(i => i.china && !i.stale && (i.severity === 'orange' || i.severity === 'yellow') && !top.includes(i) && !chinaTop.includes(i)).slice(0, 4);
      /* 一句话决策建议：按 TOP 事件类型推导（规则模板，引用真实数字） */
      const types = {};
      items.forEach(i => { types[i.type] = (types[i.type] || 0) + 1; });
      const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const advice = [];
      if (reds.length) advice.push('近24小时红色预警 ' + reds.length + ' 条' + (chinas.length ? '（涉华 ' + chinas.filter(i => i.severity === 'red').length + ' 条）' : '') + '，建议值班主任牵头逐条核处，涉华红项一小时内上报');
      else if (oranges.length) advice.push('近24小时无红色预警，橙色 ' + oranges.length + ' 条按常规流程加密跟踪');
      else advice.push('近24小时无红橙预警，各方向按常态监测运行');
      if (chinas.length >= 5) advice.push('涉华情报 ' + chinas.length + ' 条，集中在' + (chinas[0] && chinas[0].country ? chinas[0].country : '重点国别') + '等方向，建议领事保护条线今日专项过筛');
      if (topTypes.length) advice.push('事件量前三类：' + topTypes.map(t => (_CAT_CN[t[0]] || t[0]) + ' ' + t[1] + ' 条').join('、'));
      const out = {
        ok: true, generatedAt: _nowCn(), window: '24h',
        stats: { total: items.length, red: reds.length, orange: oranges.length, china: chinas.length, dedupEvents: picked.length },
        top: top.map(i => ({ id: i.id, title: i.title.slice(0, 80), level: i.severity, country: i.country, type: _CAT_CN[i.type] || i.type, time: String(i.time).slice(0, 16), url: i.url, china: i.china, corr: _corr(i) })),
        chinaTop: chinaTop.map(i => ({ id: i.id, title: i.title.slice(0, 80), level: i.severity, country: i.country, time: String(i.time).slice(0, 16), url: i.url, corr: _corr(i) })),
        advice, pending: pending.map(i => ({ id: i.id, title: i.title.slice(0, 80), level: i.severity, country: i.country, corr: _corr(i) })),
        topTypes: topTypes.map(t => ({ key: t[0], name: _CAT_CN[t[0]] || t[0], n: t[1] }))
      };
      _lbCache = out; _lbCacheAt = Date.now();
      return out;
    } catch (e) { throw e; }
  }
  router.get('/leader-brief', async (req, res) => {
    try { res.json(await _loadBrief()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ①b #740-1 要报 AI 深度研判 + 未来趋势预测 ----------
   * 用户口径（2026-09-09）：速览不够复合化、无 AI 对未来趋势的预测内容；PDF 太简单无深度研判。
   * 通用范式（AI 研判类现算端点铁律）：30min 缓存 + in-flight 合并 + LLM 60s 硬超时回落规则模板。
   * 研判输入全部为 /leader-brief 真实装配数据（红橙要情/涉华要点/统计数字），零模拟。 */
  let _lbAiCache = null, _lbAiAt = 0, _lbAiBusy = null;
  function _lbAiFallback(d) {
    const s = d.stats || {};
    const top = d.top || [], cn = d.chinaTop || [];
    const hotC = {}; top.concat(cn).forEach(i => { if (i.country) hotC[i.country] = (hotC[i.country] || 0) + 1; });
    const hot = Object.entries(hotC).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]).join('、') || '多方向';
    const judge = [
      '一、态势判断。近24小时平台监测独立情报事件 ' + (s.total || 0) + ' 条（归并后事件 ' + (s.dedupEvents || 0) + ' 起），其中红色 ' + (s.red || 0) + ' 条、橙色 ' + (s.orange || 0) + ' 条、涉华关联 ' + (s.china || 0) + ' 条，焦点集中于 ' + hot + ' 方向。' + ((s.red || 0) > 0 ? '红级事件在场，态势处于加强关注档。' : '无红级事件，态势总体处于常态监测档。'),
      '二、关键证据。' + (top.slice(0, 3).map(i => '「' + String(i.title).slice(0, 50) + '」（' + i.country + '，' + i.level + '级' + (i.corr > 1 ? '，' + i.corr + '源印证' : '') + '）').join('；') || '近24小时无红橙要情入库。'),
      '三、影响评估。涉华方向要点 ' + cn.length + ' 条，建议优先按' + (cn[0] ? cn[0].country : '重点国别') + '方向评估对中方人员、项目与供应链的现实影响；其余海外事件作态势背景参考。（本段为规则模板装配，大模型研判暂不可用，数字均引用真实库统计）'
    ].join('\n');
    const forecasts = (d.topTypes || []).slice(0, 3).map(t => ({
      title: (t.name || '该类别') + '方向延续态势',
      conf: (t.n || 0) >= 30 ? '中' : '低',
      text: '近24小时该类别事件 ' + t.n + ' 条。若同类事件密度维持或上升，未来一周该方向风险面将延续当前水平。',
      trigger: '该类别 24h 事件量再增 50%，或出现红级同类事件'
    }));
    return { ok: true, llmOk: false, judge, forecasts, generatedAt: _nowCn(), note: '大模型研判暂不可用，本段为规则模板（引用真实库统计数字）；链路恢复后自动升级 Kimi 参谋级研判（30 分钟缓存周期后重试）。' };
  }
  async function _lbAiGen() {
    const d = await _loadBrief();
    const pv = reportsEngine._test.pvKimi();
    const sys = '你是海外利益保护情报预警平台的首席情报参谋，为委办领导撰写《要报深度研判与未来趋势预测》（参谋级，可直接供决策参考）。严格按以下格式输出：【深度研判】段含三小段，段首分别用「一、态势判断。」「二、关键证据。」「三、影响评估。」——态势判断先给一句总结论，再给当前所处档位（加强关注/常态监测）及定档依据；关键证据逐条引用给定红橙要情（点明国别、级别、多源印证情况）；影响评估落到对中方人员、项目、供应链的具体影响面。【趋势预测】段含 3-4 条，每条格式严格为：（一）标题（8-14 字）换行「预测：」未来 7-14 天该方向最可能的演化与风险点（2-3 句，点明对中资企业出海的安全与运营含义）换行「置信度：高|中|低」换行「触发：」一条可观测的验证或升级信号。全部基于给定真实数据外推，禁止编造事件与数字；信息不足处写「样本不足」；禁止口号式空话。';
    const usr = '【近24小时统计（真实采集库聚合）】独立情报事件 ' + ((d.stats && d.stats.total) || 0) + ' 条（归并后事件 ' + ((d.stats && d.stats.dedupEvents) || 0) + ' 起），红色 ' + ((d.stats && d.stats.red) || 0) + ' 条 / 橙色 ' + ((d.stats && d.stats.orange) || 0) + ' 条 / 涉华关联 ' + ((d.stats && d.stats.china) || 0) + ' 条\n类别分布前五：' + ((d.topTypes || []).map(t => t.name + ' ' + t.n + ' 条').join('、') || '—') +
      '\n【红橙要情 TOP5（评分精选）】\n' + ((d.top || []).map((i, n) => (n + 1) + '.[' + i.level + (i.china ? '·涉华' : '') + ']' + i.country + '：' + i.title + '（' + String(i.time).slice(0, 16) + '，' + (i.corr || 1) + ' 源印证）').join('\n') || '（无）') +
      '\n【涉华要点（TOP5）】\n' + ((d.chinaTop || []).map((i, n) => (n + 1) + '.[' + i.level + ']' + i.country + '：' + i.title + '（' + (i.corr || 1) + ' 源印证）').join('\n') || '（无）') +
      '\n【待办风险（涉华黄橙，值班主任追办）】\n' + ((d.pending || []).map((i, n) => (n + 1) + '.[' + i.level + ']' + i.country + '：' + i.title).join('\n') || '（无）') +
      '\n请输出深度研判与未来 7-14 天趋势预测。';
    let out = null;
    try {
      /* #740 实测（2026-09-10 探针）：kimi-k2.7 推理模型小 prompt 52s，真实要报 prompt 更大——
       * 60s 必超时回落规则模板（llmOk=false 根因），放宽到 150s（30min 缓存兜底，首算可接受） */
      const r = await Promise.race([llmCall(pv, sys, usr), new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT_150s')), 150000))]);
      if (r && r.text && r.text.length > 300) {
        if (r.error) console.warn('[INSIGHT] leader-brief-ai LLM 返回异常:', r.error);
        const txt = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
        const parts = txt.split(/【趋势预测】/);
        const jB = String(parts[0] || '').replace(/^【深度研判】/, '').trim();
        const fB = String(parts[1] || '').trim();
        const forecasts = [];
        const re = /（[一二三四五六七八九十]+）\s*([^\n]+)\n\s*预测：([\s\S]*?)\n\s*置信度：\s*(高|中|低)\s*\n\s*触发：\s*([^\n]+)/g;
        let m;
        while ((m = re.exec(fB))) forecasts.push({ title: m[1].trim(), text: m[2].trim(), conf: m[3], trigger: m[4].trim() });
        if (jB.length > 100) out = { ok: true, llmOk: true, judge: jB, forecasts, generatedAt: _nowCn(), note: 'Kimi 大模型基于近 24 小时真实采集库生成（事件清单与统计全部真实，研判与预测为模型外推，事实以原文链接为准）；30 分钟缓存。' };
      }
    } catch (e) { console.warn('[INSIGHT] leader-brief-ai LLM 失败，回落规则模板:', e.message); }
    if (!out) { console.warn('[INSIGHT] leader-brief-ai LLM 输出不达标（text<300 或研判段<100），回落规则模板'); out = _lbAiFallback(d); }
    _lbAiCache = out; _lbAiAt = Date.now();
    return out;
  }
  router.get('/leader-brief-ai', async (req, res) => {
    try {
      if (!llmCall) return res.json(_lbAiFallback(await _loadBrief()));
      if (_lbAiCache && Date.now() - _lbAiAt < 30 * 60 * 1000) return res.json(_lbAiCache);
      if (!_lbAiBusy) _lbAiBusy = _lbAiGen().finally(() => { _lbAiBusy = null; });
      res.json(await _lbAiBusy);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ② 事件全生命周期时间线 ---------- */
  /* 参数：id（intel_data 主键）或 q（标题关键词）+ country。按事件签名/标题词元召回全库。 */
  router.get('/lifecycle', async (req, res) => {
    try {
      const id = req.query.id, kw = String(req.query.q || '').trim(), country = String(req.query.country || '').trim();
      let anchor = null;
      if (id) {
        const r = await q(`SELECT id, data_type, title, country, severity, source, collect_time, event_date, audit_status, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn FROM intel_data WHERE id=$1`, [id]);
        anchor = r.rows[0] || null;
      } else if (kw) {
        const r = await q(`SELECT id, data_type, title, country, severity, source, collect_time, event_date, audit_status, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
                FROM intel_data WHERE (title ILIKE $1 OR data_json->>'title_zh' ILIKE $1) ORDER BY collect_time DESC LIMIT 1`, ['%' + kw + '%']);
        anchor = r.rows[0] || null;
      }
      if (!anchor) return res.json({ ok: false, error: '未找到锚点事件（请提供事件 id 或标题关键词）' });
      const j = anchor.data_json || {};
      const anchorTitle = anchor.title_cn || anchor.title || '';
      const anchorTk = _tokens(anchorTitle);
      /* 召回：同事件签名 OR 标题词元重合 ≥2 OR 同 URL（#669 全库不限时） */
      const cand = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, event_date, audit_status, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE (data_json->>'_eventSig' = $1 AND $1 <> '' OR (data_json->>'url' = $2 AND $2 <> '') OR title ILIKE $3)
         ORDER BY collect_time ASC LIMIT 120`,
        [j._eventSig || '', j.url || '', '%' + String(anchorTitle).slice(0, 18) + '%']
      );
      const related = cand.rows.filter(r => {
        if (r.id === anchor.id) return true;
        if (j._eventSig && (r.data_json || {})._eventSig === j._eventSig) return true;
        if (j.url && (r.data_json || {}).url === j.url) return true;
        /* 同国别 + 词元重合 ≥2 */
        if (country && _iso2cnTry(r.country) !== _iso2cnTry(anchor.country)) return false;
        return _overlap(anchorTk, _tokens(r.title_cn || r.title)) >= 2;
      });
      /* 阶段装配（全部来自真实字段；无数据阶段如实标注） */
      const first = related[0] || anchor;
      const srcSet = new Set(related.map(r => (r.source || (r.data_json || {}).source || '全网检索')).filter(Boolean));
      const stages = [
        { key: 'collect', name: '首次采集', time: _fmtTime(first.collect_time), detail: '来源：' + ((first.data_json || {})._sourceType || first.source || '采集通道') + '；标题：' + String(first.title_cn || first.title || '').slice(0, 60), done: true },
        { key: 'corrob', name: '多源印证', time: srcSet.size > 1 ? _fmtTime((related[related.length - 1] || first).collect_time) : '', detail: srcSet.size > 1 ? ('库内 ' + srcSet.size + ' 个独立信源报道同一事件：' + Array.from(srcSet).slice(0, 5).join('、')) : '单一信源，尚无库内交叉印证', done: srcSet.size > 1 },
        { key: 'alert', name: '预警入列', time: '', detail: '当前级别：' + _lv(j, anchor.severity) + '；涉华关联：' + (isChina(String(anchor.title || '') + ' ' + anchorTitle) ? '是' : '否'), done: true },
        { key: 'audit', name: '审核入库', time: _fmtTime(anchor.collect_time), detail: '审核状态：' + (anchor.audit_status || 'approved'), done: !!anchor.audit_status },
        { key: 'dispose', name: '处置跟踪', time: '', detail: '处置工单数据暂未接入（如实标注，不虚拟进度）', done: false },
        { key: 'archive', name: '归档复盘', time: '', detail: related.length > 3 ? '已进入归档检索范围（相关条目 ' + related.length + ' 条）' : '事件仍在活跃监测窗口内', done: related.length > 3 }
      ];
      res.json({
        ok: true, anchor: { id: anchor.id, title: anchorTitle.slice(0, 100), country: _iso2cnTry(anchor.country), type: anchor.data_type, level: _lv(j, anchor.severity) },
        stages, related: related.map(r => ({ id: r.id, title: String(r.title_cn || r.title || '').slice(0, 70), source: r.source || ((r.data_json || {}).source || '全网检索'), time: _fmtTime(r.collect_time), level: _lv(r.data_json, r.severity) }))
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ③ 相似历史事件匹配 ---------- */
  router.get('/similar', async (req, res) => {
    try {
      const id = req.query.id, kw = String(req.query.q || '').trim(), country = String(req.query.country || '').trim(), type = String(req.query.type || '').trim();
      let anchor = null;
      if (id) {
        const r = await q(`SELECT id, data_type, title, country, severity, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn FROM intel_data WHERE id=$1`, [id]);
        anchor = r.rows[0] || null;
      } else if (kw) {
        const r = await q(`SELECT id, data_type, title, country, severity, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
                FROM intel_data WHERE (title ILIKE $1 OR data_json->>'title_zh' ILIKE $1) ORDER BY collect_time DESC LIMIT 1`, ['%' + kw + '%']);
        anchor = r.rows[0] || null;
      }
      if (!anchor) return res.json({ ok: false, error: '未找到锚点事件' });
      const anchorTitle = anchor.title_cn || anchor.title || '';
      const anchorTk = _tokens(anchorTitle);
      const anchorType = type || anchor.data_type;
      const anchorCountry = country || _iso2cnTry(anchor.country);
      /* 同类候选池（#669 全库不限时，含归档，直接查 intel_data 全量取最新 1500） */
      const cand = await q(
        `SELECT id, data_type, title, country, severity, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data WHERE data_type = $1 ORDER BY collect_time DESC LIMIT 1500`,
        [anchorType]
      );
      const sims = cand.rows
        .filter(r => r.id !== anchor.id)
        .map(r => {
          const t = r.title_cn || r.title || '';
          const ov = _overlap(anchorTk, _tokens(t));
          const sameCountry = anchorCountry && _iso2cnTry(r.country) === anchorCountry;
          return { r, ov, sameCountry, score: ov * 2 + (sameCountry ? 3 : 0) };
        })
        .filter(x => x.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map(x => ({
          id: x.r.id, title: String(x.r.title_cn || x.r.title || '').slice(0, 90),
          country: _iso2cnTry(x.r.country), level: _lv(x.r.data_json, x.r.severity),
          time: _fmtTime(x.r.collect_time).slice(0, 10), sameCountry: x.sameCountry, overlap: x.ov,
          url: (x.r.data_json || {}).url || ''
        }));
      /* 复发统计：同类事件全库总数与国别分布 */
      const total = cand.rows.length;
      const byCountry = {};
      cand.rows.forEach(r => { const c = _iso2cnTry(r.country) || '未标注'; byCountry[c] = (byCountry[c] || 0) + 1; });
      const hotCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const lvDist = { red: 0, orange: 0, yellow: 0, blue: 0 };
      cand.rows.forEach(r => { const l = _lv(r.data_json, r.severity); if (lvDist[l] != null) lvDist[l]++; });
      res.json({
        ok: true, anchor: { id: anchor.id, title: anchorTitle.slice(0, 90), type: anchorType, country: anchorCountry },
        matches: sims, matchCount: sims.length,
        stats: { total90d: total, lvDist, hotCountries: hotCountries.map(x => ({ country: x[0], n: x[1] })) },
        note: '匹配口径：同情报类别 + 标题实质词元重合加权（同国别加成），全库不限时检索（最新 1500 条候选池）'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ④ 信源可信度分级（真实入库行为聚合，非人工拍脑袋） ---------- */
  /* 口径（全部来自 intel_data 近 30 天真实数据）：
   *   A 级 = 国际权威通讯社/主流大报（名单匹配）
   *   B 级 = 30 天入库量 ≥ 60 且 7 天内仍活跃
   *   C 级 = 30 天入库量 ≥ 15
   *   D 级 = 低频/待观察源
   * 同步透出：入库量、近 7 天活跃、涉华率（chinaRelated 标记）、最近采集时间 */
  router.get('/source-cred', async (req, res) => {
    try {
      const { rows } = await q(
        `SELECT COALESCE(NULLIF(source,''), (data_json->>'source')) AS src,
                COUNT(*) AS v30,
                COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days') AS a7,
                COUNT(*) FILTER (WHERE data_json->>'chinaRelated' = 'true') AS cn,
                MAX(collect_time) AS last_seen
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY v30 DESC LIMIT 60`
      );
      const WIRE = /reuters|associated press|^ap\b|\bafp\b|press trust|xinhua|^\s*bbc\b|the guardian|new york times|bloomberg|al\s*jazeera|washington post|france 24|dw\.com|^\s*dawn\b|the current\.pk|times of india|^\s*al-?arabiya/i;
      const out = rows.map(r => {
        const src = String(r.src || '').trim();
        const v30 = Number(r.v30), a7 = Number(r.a7), cn = Number(r.cn);
        const grade = WIRE.test(src) ? 'A' : (v30 >= 60 && a7 > 0) ? 'B' : v30 >= 15 ? 'C' : 'D';
        return {
          source: src, grade, volume30d: v30, active7d: a7,
          chinaRate: v30 ? Math.round(cn / v30 * 100) : 0,
          lastSeen: _fmtTime(r.last_seen)
        };
      }).filter(x => x.source);
      const dist = { A: 0, B: 0, C: 0, D: 0 };
      out.forEach(x => dist[x.grade]++);
      res.json({
        ok: true, window: '30d', total: out.length, dist,
        rows: out.sort((a, b) => (a.grade.charCodeAt(0) - b.grade.charCodeAt(0)) || b.volume30d - a.volume30d).slice(0, 30),
        note: '分级口径：A=权威通讯社/主流大报名单；B=30天入库≥60条且近7天活跃；C=≥15条；D=低频待观察。数据全部来自真实采集库聚合。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ⑤ 情报中心总览（INTELCENTER 四 tab 真实数据源，零模拟） ----------
   * sources : 真实信源统计（30 天量/7 天活跃/涉华率/分级）+ 采集通道分布（_sourceType）
   * osint   : 真实社媒/公众号/哨兵采集条目（近 7 天 _sourceType 通道）+ 拦截池（intel_sidepool）口径
   * analysis: 真实红橙预警事件（近 7 天审核通过），替代演示"分析结论"
   * timeline: 国别 7 天环比 + 近 14 天逐日入库曲线（本地时区 Asia/Shanghai，禁 toISOString）
   * geoint  : 国别事件分布（30 天）+ 八大要道关联事件（与 reports-engine CHOKE 同源正则）
   * 缓存 120s：前端全局定时器高频重渲染，避免同源连接挤占。 */
  let _icCache = null, _icCacheAt = 0;
  router.get('/intel-center', async (req, res) => {
    try {
      if (_icCache && Date.now() - _icCacheAt < 120000) {
        return res.json(_icCache);
      }
      const P = {};
      /* —— ① 信源统计（与 source-cred 同口径聚合；#718 实时口径排除补采回灌） —— */
      P.sources = q(
        `SELECT COALESCE(NULLIF(source,''), (data_json->>'source')) AS src,
                COUNT(*) AS v30,
                COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days') AS a7,
                COUNT(*) FILTER (WHERE data_json->>'chinaRelated' = 'true') AS cn,
                MAX(collect_time) AS last_seen
         FROM intel_data WHERE collect_time >= NOW() - INTERVAL '30 days' AND ${FRESH}
         GROUP BY 1 ORDER BY v30 DESC LIMIT 60`
      );
      /* —— ② 采集通道分布（_sourceType，30 天） —— */
      P.channels = q(
        `SELECT COALESCE(NULLIF(data_json->>'_sourceType',''),'未标注') AS k, COUNT(*)::int AS c,
                COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS a7,
                MAX(collect_time) AS last_seen
         FROM intel_data WHERE collect_time >= NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY c DESC LIMIT 20`
      );
      /* —— ③ 真实社媒/采集池条目（近 7 天哨兵与社媒通道） —— */
      P.osint = q(
        `SELECT id, data_type, title, country, source, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '7 days'
           AND data_json->>'_sourceType' IN ('socmint_watch','social_media','wechat_oa','cn_security_watch','consular_watch')
         ORDER BY collect_time DESC LIMIT 40`
      );
      /* —— ④ 拦截池口径（近 7 天，真实入库闸拒收原因分布） —— */
      P.sidepool = q(
        `SELECT reason, COUNT(*)::int AS c
         FROM intel_sidepool WHERE blocked_at >= NOW() - INTERVAL '7 days'
         GROUP BY 1 ORDER BY c DESC LIMIT 12`
      ).catch(() => ({ rows: [] })); /* 表不存在时如实空返回 */
      /* —— ⑤ 近 7 天红橙事件（analysis tab，审核通过；#718 实时口径） —— */
      P.recent = q(
        `SELECT id, data_type, title, country, source, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '7 days' AND audit_status = 'approved' AND ${FRESH}
         ORDER BY collect_time DESC LIMIT 600`
      );
      /* —— ⑥ 国别 7 天环比 + 逐日曲线（本地时区 Asia/Shanghai；#718 实时口径） —— */
      P.countryTrend = q(
        `SELECT COALESCE(NULLIF(country,''),'未标注') AS c,
                COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days')::int AS d7,
                COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND collect_time < NOW() - INTERVAL '7 days')::int AS prev7,
                COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '7 days' AND COALESCE(NULLIF(data_json->>'level_norm',''),NULLIF(severity,'')) = 'red')::int AS red7
         FROM intel_data WHERE collect_time >= NOW() - INTERVAL '14 days' AND ${FRESH}
         GROUP BY 1`
      );
      P.daily = q(
        `SELECT to_char(collect_time AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
         FROM intel_data WHERE collect_time >= NOW() - INTERVAL '14 days' AND ${FRESH}
         GROUP BY 1 ORDER BY 1`
      );
      /* —— ⑦ 近 30 天国别分布 + 要道匹配池（geoint tab；#718 实时口径） —— */
      P.geo = q(
        `SELECT id, data_type, title, country, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '30 days' AND audit_status = 'approved' AND ${FRESH}
         ORDER BY collect_time DESC LIMIT 3000`
      );
      const [sources, channels, osint, sidepool, recent, countryTrend, daily, geo] = await Promise.all(
        [P.sources, P.channels, P.osint, P.sidepool, P.recent, P.countryTrend, P.daily, P.geo]
      );

      /* sources 分级（与 source-cred 完全同口径） */
      const WIRE = /reuters|associated press|^ap\b|\bafp\b|press trust|xinhua|^\s*bbc\b|the guardian|new york times|bloomberg|al\s*jazeera|washington post|france 24|dw\.com|^\s*dawn\b|the current\.pk|times of india|^\s*al-?arabiya/i;
      const srcRows = sources.rows.map(r => {
        const s = String(r.src || '').trim();
        const v30 = Number(r.v30), a7 = Number(r.a7), cn = Number(r.cn);
        const grade = WIRE.test(s) ? 'A' : (v30 >= 60 && a7 > 0) ? 'B' : v30 >= 15 ? 'C' : 'D';
        return { source: s, grade, volume30d: v30, active7d: a7, chinaRate: v30 ? Math.round(cn / v30 * 100) : 0, lastSeen: _fmtTime(r.last_seen) };
      }).filter(x => x.source);
      const dist = { A: 0, B: 0, C: 0, D: 0 };
      srcRows.forEach(x => dist[x.grade]++);

      /* osint：社媒/哨兵真实条目（脏摘要护栏与 _dg 同口径） */
      const osintItems = osint.rows.map(r => {
        const j = r.data_json || {};
        let d = String(j.content_zh || j.summary || j.content || '').replace(/<[^>]*>/g, ' ');
        if (/\[object/i.test(d)) d = '';
        d = d.replace(/(?:在|从|据|由|至|到|来源|源自)?\s*(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, '').replace(/\s+/g, ' ').trim().slice(0, 120);
        return {
          id: r.id, title: String(r.title_cn || r.title || '').slice(0, 90),
          country: _iso2cnTry(r.country || j.country_cn || ''),
          channel: _CH_CN[j._sourceType] || j._sourceType || '采集通道',
          sourceType: j._sourceType || '', source: r.source || j.source || '',
          level: _lv(j, r.severity), time: _fmtTime(r.collect_time),
          digest: d, url: j.url || '',
          china: String(j.chinaRelated) === 'true' || !!isChina(String(r.title || '') + ' ' + String(r.title_cn || ''))
        };
      });

      /* analysis：近 7 天红橙事件（真实预警，替代演示结论） */
      const recItems = recent.rows.map(r => {
        const j = r.data_json || {};
        return {
          id: r.id, title: String(r.title_cn || r.title || '').slice(0, 90), type: r.data_type,
          typeName: _CAT_CN[r.data_type] || r.data_type,
          country: _iso2cnTry(r.country || j.country_cn || ''), level: _lv(j, r.severity),
          time: _fmtTime(r.collect_time), url: j.url || '',
          china: String(j.chinaRelated) === 'true' || !!isChina(String(r.title || '') + ' ' + String(r.title_cn || '')),
          corr: Number(j.corroboration || 0), deaths: Number(j.deaths || 0)
        };
      });
      const hotEvents = recItems.filter(i => i.level === 'red' || i.level === 'orange');
      const _score = i => ({ red: 100, orange: 60, yellow: 30, blue: 10 }[i.level] || 5) + (i.china ? 25 : 0) + i.corr * 5 + i.deaths;
      hotEvents.sort((a, b) => _score(b) - _score(a));
      const typeDist = {};
      recItems.forEach(i => { typeDist[i.typeName] = (typeDist[i.typeName] || 0) + 1; });

      /* timeline：国别环比（只留 7 天有量的国别，按增量排序） */
      const trendRows = countryTrend.rows
        .map(r => {
          const d7 = Number(r.d7), prev7 = Number(r.prev7);
          const delta = d7 - prev7;
          const pct = prev7 > 0 ? Math.round(delta / prev7 * 100) : (d7 > 0 ? 100 : 0);
          return { country: _iso2cnTry(r.c) || '未标注', d7, prev7, delta, pct, red7: Number(r.red7), trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
        })
        .filter(x => x.d7 > 0 || x.prev7 > 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 15);
      const dailyRows = daily.rows.map(r => ({ date: r.d, n: Number(r.n) }));

      /* geoint：国别分布 + 八大要道关联事件（与 reports-engine CHOKE_INCIDENT_RE 同源口径） */
      const CHOKE_RE = /袭击|劫持|扣押|水雷|封锁|海盗|导弹|爆炸|无人机|攻击|扰动|中断|停航|绕行|险情|碰撞|失事|商船|货轮|油轮|集装箱船|航运|拦截|驱离|对峙|交火|军演|演习|布雷|登临|劫船/;
      const byCountry = {};
      const geoItems = geo.rows.map(r => {
        const j = r.data_json || {};
        return {
          id: r.id, title: String(r.title_cn || r.title || ''), country: _iso2cnTry(r.country || j.country_cn || ''),
          level: _lv(j, r.severity), time: _fmtTime(r.collect_time), url: j.url || '',
          china: String(j.chinaRelated) === 'true'
        };
      });
      geoItems.forEach(i => {
        const c = i.country || '未标注';
        if (!byCountry[c]) byCountry[c] = { country: c, n: 0, red: 0, orange: 0, china: 0 };
        byCountry[c].n++;
        if (i.level === 'red') byCountry[c].red++;
        if (i.level === 'orange') byCountry[c].orange++;
        if (i.china) byCountry[c].china++;
      });
      const countries = Object.values(byCountry).sort((a, b) => b.n - a.n).slice(0, 20);
      const chokes = INTEREST_BASE.STRAIT_CHANNELS.map(ch => {
        const hit = geoItems.filter(i => ch.re.test(i.title) && CHOKE_RE.test(i.title));
        return {
          name: ch.name, note: ch.note, n: hit ? hit.length : 0,
          red: hit ? hit.filter(i => i.level === 'red').length : 0,
          china: hit ? hit.filter(i => i.china).length : 0,
          items: hit ? hit.slice(0, 3).map(i => ({ id: i.id, title: i.title.slice(0, 80), level: i.level, time: i.time.slice(0, 10), url: i.url })) : []
        };
      }).sort((a, b) => b.n - a.n);

      const out = {
        ok: true, generatedAt: _nowCn(),
        sources: {
          total: srcRows.length, dist,
          rows: srcRows.sort((a, b) => (a.grade.charCodeAt(0) - b.grade.charCodeAt(0)) || b.volume30d - a.volume30d).slice(0, 24),
          channels: channels.rows.map(r => ({
            key: r.k, name: _CH_CN[r.k] || r.k, n: Number(r.c), active7d: Number(r.a7),
            lastSeen: _fmtTime(r.last_seen)
          })),
          note: '信源分级口径：A=权威通讯社/主流大报名单匹配；B=30天入库≥60条且近7天活跃；C=≥15条；D=低频待观察。通道分布按 data_json._sourceType 真实字段聚合。'
        },
        osint: {
          total: osintItems.length,
          sidepool: sidepool.rows.map(r => ({ reason: r.reason, n: Number(r.c) })),
          items: osintItems,
          note: '口径：近 7 天社媒哨兵（Mastodon）/社媒采集/公众号线索/涉华与领事哨兵通道真实入库条目；拦截池为入库闸近 7 天真实拒收原因分布（intel_sidepool）。'
        },
        analysis: {
          total: recItems.length, red: recItems.filter(i => i.level === 'red').length,
          orange: recItems.filter(i => i.level === 'orange').length,
          china: recItems.filter(i => i.china).length,
          hot: hotEvents.slice(0, 16),
          typeDist: Object.entries(typeDist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => ({ name: x[0], n: x[1] })),
          note: '口径：近 7 天审核通过条目按级别归一（level_norm 优先，脏值回落 yellow），红橙为高关注事件，排序加权：级别+涉华+多源印证+伤亡。'
        },
        timeline: { rows: trendRows, daily: dailyRows, note: '口径：国别近 7 天入库量 vs 前 7 天环比（真实库聚合）；逐日曲线按北京时间（Asia/Shanghai）切日。' },
        geoint: {
          total: geoItems.length, countries, chokes,
          note: '口径：近 30 天审核通过条目的国别分布（含红橙与涉华计数）；要道关联=标题命中八大通道正则且含航安事件关键词（与要道评估报告同源）。'
        }
      };
      _icCache = out; _icCacheAt = Date.now();
      res.json(out);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ⑥ 事件研判专报（#664 用户指令：历史相似事件分析 + 事件时间流研判 → 智能研判 + 自带公文输出） ----------
   * 参数：id 或 q（标题关键词）+ country + type。
   * 装配：锚点事件 → 时间流召回（同事件签名/同URL/词元重合，30天）→ 相似历史事件（同类别90天词元加权）
   *      → 级别/国别/趋势复合统计 → LLM 智能研判（失败回落规则模板，引用真实数字，零模拟）
   *      → govdoc.renderGovHtml 红头公文（图表复合分析与周期简报同一引擎）。
   * 返回 JSON：anchor / stages / related / sims / stats / daily / govHtml / llmOk。 */
  router.get('/event-report', async (req, res) => {
    try {
      const id = req.query.id, kw = String(req.query.q || '').trim(),
        country = String(req.query.country || '').trim(), type = String(req.query.type || '').trim();
      let anchor = null;
      if (id) {
        const r = await q(`SELECT id, data_type, title, country, severity, source, collect_time, event_date, audit_status, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn FROM intel_data WHERE id=$1`, [id]);
        anchor = r.rows[0] || null;
      } else if (kw) {
        /* #664 多关键词 AND 检索：空格分隔的每个词元都须命中（标题或中文译题），
         * 用户自然语言输入（"刚果金 袭击"）不再要求整串连续命中；
         * 标点归一：两侧同去括号/空格/连字符后比对（"刚果金" 可命中 "刚果（金）"） */
        const PUNCT_RE = '[ （）()·\\-—、，,。.：:；;"\'\'""【】\\[\\]]'; /* SQL 字面量内 ''=转义单引号 */
        const _norm = s => String(s).replace(/[\s（）()·\-—、，,。.：:；;"''""【】\[\]]/g, '');
        const words = kw.split(/\s+/).filter(Boolean).slice(0, 4);
        const conds = words.map((_, i) => "(regexp_replace(COALESCE(title,''), '" + PUNCT_RE + "', '', 'g') ILIKE $" + (i + 1) + " OR regexp_replace(COALESCE(data_json->>'title_zh',''), '" + PUNCT_RE + "', '', 'g') ILIKE $" + (i + 1) + ")").join(' AND ');
        const r = await q(`SELECT id, data_type, title, country, severity, source, collect_time, event_date, audit_status, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
                FROM intel_data WHERE ${conds} ORDER BY collect_time DESC LIMIT 1`, words.map(w => '%' + _norm(w) + '%'));
        anchor = r.rows[0] || null;
      }
      if (!anchor) return res.json({ ok: false, error: '未找到锚点事件（请提供事件 id 或标题关键词）' });
      const j = anchor.data_json || {};
      const anchorTitle = anchor.title_cn || anchor.title || '';
      const anchorTk = _tokens(anchorTitle);
      const anchorType = type || anchor.data_type;
      const anchorCountry = country || _iso2cnTry(anchor.country);
      /* #712 历史锚点标记：事件发生距今天数（publish_time/event_date 优先）。
       * >30 天 = 历史事件 → 案卷降级为「历史复盘」模式（旧数据的合法去处），
       * 前端打徽章 + 研判提示语切换，绝不冒充近期实时威胁。 */
      const evAgeD = _evAgeD(anchor);
      const evDateStr = _evDate(anchor);
      const historic = evAgeD > 30;

      /* —— A. 时间流召回：同事件签名 / 同 URL / 标题词元重合（#669 全库不限时，正序） ——
       * 2026-09-07 用户指令：时间要求不受限，去掉原 30 天帽；LIMIT 控制成本。 */
      const relQ = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, event_date, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE (data_json->>'_eventSig' = $1 AND $1 <> '' OR (data_json->>'url' = $2 AND $2 <> '') OR title ILIKE $3)
         ORDER BY collect_time ASC LIMIT 200`,
        [j._eventSig || '', j.url || '', '%' + String(anchorTitle).slice(0, 18) + '%']
      );
      const related = relQ.rows.filter(r => {
        if (r.id === anchor.id) return true;
        if (j._eventSig && (r.data_json || {})._eventSig === j._eventSig) return true;
        if (j.url && (r.data_json || {}).url === j.url) return true;
        return _overlap(anchorTk, _tokens(r.title_cn || r.title)) >= 2;
      }).map(r => ({
        id: r.id, title: String(r.title_cn || r.title || '').slice(0, 120),
        country: _iso2cnTry(r.country), level: _lv(r.data_json, r.severity),
        source: r.source || ((r.data_json || {}).source || '全网检索'),
        time: _fmtTime(r.collect_time), url: (r.data_json || {}).url || '',
        digest: String((r.data_json || {}).content_zh || (r.data_json || {}).summary || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      }));

      /* —— B. 相似历史事件：同类别词元加权（#669 全库不限时，同国加成）——
       * 2026-09-07 用户指令：去掉原 90 天帽，取全库该类别最新 1500 条参与匹配。 */
      const simQ = await q(
        `SELECT id, data_type, title, country, severity, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data WHERE data_type = $1 ORDER BY collect_time DESC LIMIT 1500`,
        [anchorType]
      );
      const sims = simQ.rows
        .filter(r => r.id !== anchor.id)
        .map(r => {
          const t = r.title_cn || r.title || '';
          const ov = _overlap(anchorTk, _tokens(t));
          const sameCountry = anchorCountry && _iso2cnTry(r.country) === anchorCountry;
          return { r, ov, sameCountry, score: ov * 2 + (sameCountry ? 3 : 0) };
        })
        .filter(x => x.score >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map(x => ({
          id: x.r.id, title: String(x.r.title_cn || x.r.title || '').slice(0, 120),
          country: _iso2cnTry(x.r.country), level: _lv(x.r.data_json, x.r.severity),
          time: _fmtTime(x.r.collect_time), sameCountry: x.sameCountry, overlap: x.ov,
          url: (x.r.data_json || {}).url || '',
          digest: String((x.r.data_json || {}).content_zh || (x.r.data_json || {}).summary || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
        }));

      /* —— C. 复合统计（全部真实库聚合） —— */
      /* #669 全库月度规律：该类别自建库以来逐月事件量（历史相似性趋势的根基，
       * 不做任何时间截断；用户口径：时间不受限） */
      let typeMonthly = [], typeTotal = 0;
      try {
        const mq = await q(
          `SELECT to_char(collect_time, 'YYYY-MM') AS m, COUNT(*)::int AS c
           FROM intel_data WHERE data_type = $1 GROUP BY 1 ORDER BY 1`, [anchorType]);
        typeMonthly = mq.rows.map(x => ({ m: x.m, n: x.c }));
        typeTotal = typeMonthly.reduce((s, x) => s + x.n, 0);
      } catch (e) { console.warn('[INSIGHT] 月度规律查询失败:', e.message); }
      const all = related.concat(sims.filter(s => !related.some(r => r.id === s.id)));
      const lvDist = { red: 0, orange: 0, yellow: 0, blue: 0 };
      all.forEach(i => { if (lvDist[i.level] != null) lvDist[i.level]++; });
      const byCountry = {};
      all.forEach(i => { const c = i.country || '未标注'; byCountry[c] = (byCountry[c] || 0) + 1; });
      const hotCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const chinaCnt = all.filter(i => isChina(i.title)).length;
      /* 逐日趋势（本地时区切日） */
      const byDay = {};
      all.forEach(i => { const d = String(i.time || '').slice(0, 10); if (d) byDay[d] = (byDay[d] || 0) + 1; });
      const daily = Object.keys(byDay).sort().map(d => ({ date: d, n: byDay[d] }));
      /* 复发间隔：相似事件相邻日期间隔中位数（天） */
      const simDays = sims.map(s => String(s.time).slice(0, 10)).filter(Boolean).sort();
      let recur = null;
      if (simDays.length >= 3) {
        const gaps = [];
        for (let k = 1; k < simDays.length; k++) {
          const g = Math.round((new Date(simDays[k]) - new Date(simDays[k - 1])) / 86400000);
          if (g >= 0) gaps.push(g);
        }
        gaps.sort((a, b) => a - b);
        if (gaps.length) recur = gaps[Math.floor(gaps.length / 2)];
      }
      const srcSet = new Set(related.map(i => i.source).filter(Boolean));
      const first = related[0] || { time: _fmtTime(anchor.collect_time), title: anchorTitle, source: anchor.source || '采集通道' };

      /* —— D. 生命周期五阶段（真实字段，无数据如实标注） —— */
      const stages = [
        { key: 'collect', name: '首次采集', time: String(first.time || ''), detail: '来源：' + first.source + '；' + String(first.title || '').slice(0, 60), done: true },
        { key: 'corrob', name: '多源印证', time: srcSet.size > 1 ? String((related[related.length - 1] || first).time || '') : '', detail: srcSet.size > 1 ? ('库内 ' + srcSet.size + ' 个独立信源报道同一事件：' + Array.from(srcSet).slice(0, 5).join('、')) : '单一信源，尚无库内交叉印证', done: srcSet.size > 1 },
        { key: 'alert', name: '预警入列', time: '', detail: '当前级别：' + _lv(j, anchor.severity) + '；涉华关联：' + (isChina(String(anchor.title || '') + ' ' + anchorTitle) ? '是' : '否'), done: true },
        { key: 'audit', name: '审核入库', time: _fmtTime(anchor.collect_time), detail: '审核状态：' + (anchor.audit_status || 'approved'), done: !!anchor.audit_status },
        { key: 'archive', name: '归档复盘', time: '', detail: related.length > 3 ? '已进入归档检索范围（相关条目 ' + related.length + ' 条）' : '事件仍在活跃监测窗口内', done: related.length > 3 }
      ];

      /* —— E. 智能研判：LLM 优先，失败回落规则模板（引用真实数字，零虚构） —— */
      const stats = { total: all.length, red: lvDist.red, orange: lvDist.orange, yellow: lvDist.yellow, blue: lvDist.blue, chinaCount: chinaCnt };
      const hot3 = hotCountries.slice(0, 3).map(x => x[0] + ' ' + x[1] + ' 起').join('、') || '分布零散';
      const ruleJudge = [
        (historic ? '【历史复盘模式】本事件发生于 ' + evDateStr + '（距今 ' + evAgeD + ' 天），属历史事件复盘研判，非近期实时威胁，仅供历史规律参考与同类事件防范借鉴。' : '') +
        '一、事件概况。锚点事件"' + anchorTitle.slice(0, 50) + '"（' + (anchorCountry || '未标注国别') + '，' + (_CAT_CN[anchorType] || anchorType) + '类，' + (_lv(j, anchor.severity) || 'yellow') + '级）。库内时间流召回相关条目 ' + related.length + ' 条，独立信源 ' + srcSet.size + ' 个；全库同类别历史事件 ' + typeTotal + ' 条，其中检索到相似事件 ' + sims.length + ' 起（同国别 ' + sims.filter(s => s.sameCountry).length + ' 起）。',
        '二、时间流研判。该事件自首次采集（' + String(first.time || '时间不详') + '）以来，' + (related.length > 3 ? '呈多节点持续演进态势，库内累计 ' + related.length + ' 个时间节点的后续报道，事件仍处于活跃发展窗口' : '库内后续演进报道 ' + related.length + ' 条，事件链条相对收敛') + '。' + (srcSet.size > 1 ? '已获 ' + srcSet.size + ' 个独立信源交叉印证，事件真实性置信度高。' : '目前为单一信源，建议持续跟踪等待多源印证。'),
        '三、历史相似事件规律。全库同类事件 ' + typeTotal + ' 条，集中于：' + hot3 + '。级别分布为红 ' + lvDist.red + '、橙 ' + lvDist.orange + '、黄 ' + lvDist.yellow + '、蓝 ' + lvDist.blue + '。' + (recur != null ? '相似事件复发间隔中位数约 ' + recur + ' 天，' : '') + (lvDist.red + lvDist.orange > 0 ? '同类事件中红橙级占比 ' + Math.round((lvDist.red + lvDist.orange) / (all.length || 1) * 100) + '%，同类风险烈度不容忽视。' : '同类事件总体烈度可控。'),
        '四、对策建议。' + (chinaCnt > 0 ? '本事件链涉华关联条目 ' + chinaCnt + ' 条，建议领事保护条线今日内完成专项过筛，逐条核实中方人员机构安全状态；' : '') + (sims.filter(s => s.sameCountry).length >= 3 ? anchorCountry + '方向同类事件密集复发，建议驻外机构对照历史处置案例前置部署防范措施；' : '') + '建议值班条线将该事件纳入重点盯防清单，按复发周期加密跟踪，后续演进节点实时入库复盘。'
      ].join('\n');
      let judgeText = ruleJudge, llmOk = false;
      /* #682 quick 模式：跳过 LLM（规则模板秒出，引用真实数字），供自主研判队列自动立卷；
       * 完整模式（无 quick）走 Kimi 大模型深度研判。 */
      if (llmCall && !req.query.quick) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是国家安全情报研判参谋，为海外利益保护情报预警平台撰写事件研判专报的综合研判段（参谋助手级，须可直接供值班领导决策使用）。必须分五段，段落标题固定：「一、事件概况与研判结论」「二、时间流研判」「三、历史相似事件规律」「四、风险预测（30天窗口）」「五、对策建议」。硬性要求：①概况段先给一句话总结论（事件性质+当前阶段+是否需要升级关注），再给置信度档位（高/中/低）及定档依据（信源数/链条长度/样本量）；②时间流段判断事件当前处于发展/收敛/复发阶段并给依据；③规律段引用给定热点国别、级别分布、复发中位数，指出可直接类比的历史事件；④预测段给30天内该事件链的演化方向与应盯的具体信号（升级触发条件）；⑤建议段步骤化（一是/二是/三是）、每条带时限与责任条线（领事保护/企业安全/值班条线）。全部基于给定真实数据，禁止虚构数字与事件，信息不足处如实标注，禁止口号式空话。';
          const usr = (historic ? '【重要背景：本事件为历史事件，发生于 ' + evDateStr + '（距今 ' + evAgeD + ' 天）。本卷为历史复盘研判：结论必须明确区分「历史规律参考」与「近期实时威胁」，不得把历史事件表述为当前正在发生的威胁，防范建议以类比借鉴为基调。】\n' : '') +
            '锚点事件：' + anchorTitle + '\n国别：' + (anchorCountry || '未标注') + '；类别：' + (_CAT_CN[anchorType] || anchorType) + '；级别：' + (_lv(j, anchor.severity) || 'yellow') +
            '\n时间流相关条目 ' + related.length + ' 条，独立信源 ' + srcSet.size + ' 个，首次采集 ' + String(first.time || '不详') +
            '\n全库同类别事件 ' + typeTotal + ' 条，其中相似事件 ' + sims.length + ' 起（同国别 ' + sims.filter(s => s.sameCountry).length + ' 起），热点国别：' + hot3 +
            '\n级别分布：红' + lvDist.red + ' 橙' + lvDist.orange + ' 黄' + lvDist.yellow + ' 蓝' + lvDist.blue + '；涉华关联 ' + chinaCnt + ' 条' + (recur != null ? '；复发间隔中位数 ' + recur + ' 天' : '') +
            '\n月度规律：近6个月该类别事件量 ' + typeMonthly.slice(-6).map(x => x.m + ':' + x.n).join('、') +
            '\n时间流最新演进（含日期与来源）：\n' + related.slice(-5).map((i, ix) => (ix + 1) + '.「' + i.title.slice(0, 55) + '」（' + String(i.time).slice(0, 10) + '，' + i.level + '级，' + i.source + '）').join('\n') +
            '\n相似历史事件（含日期/国别/是否同国复发）：\n' + sims.slice(0, 8).map((s, i) => (i + 1) + '.「' + s.title.slice(0, 55) + '」（' + s.country + '，' + String(s.time).slice(0, 10) + '，' + s.level + '级' + (s.sameCountry ? '，同国复发' : '') + '）').join('\n');
          const r = await llmCall(pv, sys, usr);
          if (r && r.text && r.text.length > 300) {
            /* 去 Markdown 残留（星号加粗 / 井号标题 / 列表符），公文段只留纯文本 */
            judgeText = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[INSIGHT] event-report LLM 研判失败，回落规则模板:', e.message); }
      }

      /* —— F. 公文输出：复用 reports-engine 红头版式引擎（图表复合分析板块自动装配） —— */
      const now = new Date();
      const pkey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const def = { name: '事件研判专报' };
      const toItem = i => ({ title: i.title, level: i.level, country: i.country, time: i.time, url: i.url, digest: i.digest, _t: i.time });
      const win = [new Date(now.getTime() - 90 * 86400000), new Date(now.getTime() + 86400000)];
      const govData = {
        title: '关于"' + anchorTitle.slice(0, 40) + '"事件的研判专报' + (historic ? '（历史复盘）' : ''),
        stats, win,
        sections: [
          { name: '事件时间流（库内演进链条）', count: related.length, red: related.filter(i => i.level === 'red').length, orange: related.filter(i => i.level === 'orange').length, items: related.map(toItem), note: '按采集时间正序，同事件签名/同源链接/标题词元召回。' },
          { name: '相似历史事件（全库同类别）', count: sims.length, red: sims.filter(i => i.level === 'red').length, orange: sims.filter(i => i.level === 'orange').length, items: sims.slice(0, 20).map(toItem), note: '同类别+标题实质词元重合加权（同国加成），全库不限时检索。' }
        ],
        chart: [
          { label: '时间流条目', value: related.length },
          { label: '同国相似事件', value: sims.filter(s => s.sameCountry).length },
          { label: '他国相似事件', value: sims.filter(s => !s.sameCountry).length }
        ].concat(hotCountries.slice(0, 4).map(x => ({ label: x[0], value: x[1] }))),
        chartCap: '事件链条与相似事件构成（条）'
      };
      let govHtml = '';
      try {
        govHtml = reportsEngine.govdoc.renderGovHtml(def, pkey, govData, judgeText, true, { perSec: 12, digest: true, digestLen: 120 });
      } catch (e) { console.warn('[INSIGHT] 公文渲染失败:', e.message); }

      res.json({
        ok: true,
        anchor: { id: anchor.id, title: anchorTitle.slice(0, 120), country: anchorCountry, type: _CAT_CN[anchorType] || anchorType, level: _lv(j, anchor.severity), evDate: evDateStr, evAgeDays: evAgeD, historic },
        stages, related, sims, daily, typeMonthly,
        stats: Object.assign({}, stats, { typeTotal: typeTotal, simCount: sims.length, sameCountry: sims.filter(s => s.sameCountry).length, srcCount: srcSet.size, recurMedian: recur, hotCountries: hotCountries.map(x => ({ country: x[0], n: x[1] })) }),
        judgment: judgeText, llmOk, govHtml,
        generatedAt: _nowCn(),
        note: '口径（#669 全库不限时）：时间流=同事件签名/同URL/词元重合召回（全库）；相似事件=同类别+词元加权（全库）；月度规律=该类别建库以来逐月事件量；研判=' + (llmOk ? 'Kimi 大模型' : '规则模板（引用真实库统计数字' + (req.query.quick ? '，quick 模式未调用大模型，可点击"AI 深度研判"升级' : '，大模型暂不可用') + '）') + '；全部平台数据库真实数据，零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============================================================
   * #682 GET /api/insight/event-docket — 自主研判队列（常开 · 零输入 · 零触发）
   * ================================================================
   * 用户口径（2026-09-07 18:43）：「事件研判中心不要搜集引擎设计——自主设计，复合性」。
   * 打开即自动装配，不做任何用户检索动作：
   *   ① KPI：72h 待研判红橙 / 今日新增 / 红橙涉华 / 活跃事件链（7d 签名链≥3）
   *   ② 研判队列（TOP12）：72h 红橙候选 × 复合研判价值评分
   *      评分 = 级别权重 × 时近衰减 + 涉华加成 + 独立信源印证加成 + 链条长度加成
   *   ③ 突发事件链：48h 国别×类别聚合簇（红橙 ≥4 条，爆发态检测）
   *   ④ 7 日类别分布 + 国别×类别热度矩阵（复合态势底牌）
   * 前端点击队列条目 → /event-report?id=X&quick=1 秒级立卷（规则模板），
   * 「AI 深度研判」按钮再升级完整 LLM + 公文输出。全部真实库计算，零模拟。 */
  router.get('/event-docket', async (req, res) => {
    try {
      const LVW = { red: 4, orange: 3, yellow: 2, blue: 1 };

      /* ① 72h 红橙候选（level_norm 归一优先，severity 兜底，标题红橙关键词补漏） */
      const candQ = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '72 hours' AND audit_status = 'approved'
           AND COALESCE(country,'') <> '中国'
           AND (COALESCE(data_json->>'level_norm','') IN ('red','orange')
                OR lower(COALESCE(severity,'')) IN ('red','orange')
                OR title ~* '(红色|橙色|严重|危急)'
                OR COALESCE(data_json->>'title_zh','') ~* '(红色|橙色|严重|危急)')
         ORDER BY collect_time DESC LIMIT 400`
      );
      /* #712 主面板时效闸：候选先过「事件发生近 7 日」闸（publish_time/event_date 优先，
       * regex-cast 脏值容错；无事件日期回落采集时间判定），杜绝补采回灌/旧文重发
       * 被采集时间伪装成新鲜事件（2004 阿富汗 11 工人案实证） */
      const candidates = candQ.rows
        .filter(r => _evFresh(r, 7))
        .map(r => {
        const j = r.data_json || {};
        const t = r.title_cn || r.title || '';
        return {
          id: r.id, title: String(t).slice(0, 120),
          country: _iso2cnTry(r.country), type: r.data_type,
          level: _lv(j, r.severity), source: r.source || '采集通道',
          time: _fmtTime(r.collect_time), ts: new Date(r.collect_time).getTime(),
          evDate: _evDate(r), evAge: _evAgeD(r),
          sig: j._eventSig || '', digest: String(j.content_zh || j.summary || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
          china: isChina(t + ' ' + (r.title || ''))
        };
      }).filter(r => r.level === 'red' || r.level === 'orange');

      /* ② 7d 事件签名链（信源印证数 + 链条长度，供队列评分） */
      const sigQ = await q(
        `SELECT data_json->>'_eventSig' AS sig, COUNT(*)::int AS n, COUNT(DISTINCT source)::int AS srcs
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '7 days' AND COALESCE(data_json->>'_eventSig','') <> ''
         GROUP BY 1`
      );
      const sigMap = {};
      sigQ.rows.forEach(x => { if (x.sig) sigMap[x.sig] = x; });

      /* ③ 复合研判价值评分 → TOP12 队列（国别多样性去重：同国≤2 条 + 标题词元去重防模板化刷屏） */
      const now = Date.now();
      const ranked = candidates.map(c => {
        const sig = sigMap[c.sig] || { n: 1, srcs: 1 };
        const hours = Math.max(0, (now - c.ts) / 3600000);
        const recency = Math.max(0.4, 1 - hours / 72);
        const score = LVW[c.level] * recency * 10
          + (c.china ? 40 : 0)   /* #698-③ 涉华权重强化：海外涉华事件优先入列（用户口径：核心重点数据须涉华海外相关） */
          + Math.min(sig.srcs, 5) * 4
          + Math.min(sig.n, 10) * 2;
        return { c, sig, score: Math.round(score * 10) / 10, tk: _tokens(c.title) };
      }).sort((a, b) => b.score - a.score);
      const queue = [];
      const countryN = {};
      for (const x of ranked) {
        if (queue.length >= 12) break;
        const cy = x.c.country || '未标注';
        if ((countryN[cy] || 0) >= 2) continue;                       /* 同国≤2 条 */
        if (queue.some(qq => _overlap(qq._tk, x.tk) >= 2)) continue;  /* 标题词元重复剔除 */
        countryN[cy] = (countryN[cy] || 0) + 1;
        queue.push({
          id: x.c.id, title: x.c.title, country: x.c.country, type: _CAT_CN[x.c.type] || x.c.type,
          level: x.c.level, time: x.c.time, evDate: x.c.evDate, evAge: x.c.evAge, china: x.c.china, srcs: x.sig.srcs,
          chain: x.sig.n, score: x.score, digest: x.c.digest, _tk: x.tk
        });
      }
      queue.forEach(qq => { delete qq._tk; });

      /* ④ 突发事件链：48h 国别×类别红橙聚合簇（≥4 条，聚焦安全类事件——恐袭/冲突/暴力/治安/动荡/政权）
       * #712 事件时效闸：事件发生日期（event_date/publish_time，regex-cast 脏值容错，
       * 无有效日期视为实时通道放行）须在近 7 日内——补采回灌的历史簇不再伪装突发 */
      const EVGATE_SQL = `COALESCE((substring(COALESCE(NULLIF(event_date,''), data_json->>'publish_time') from '^[0-9]{4}-[0-9]{2}-[0-9]{2}'))::date, CURRENT_DATE) >= CURRENT_DATE - 7`;
      const chainQ = await q(
        `SELECT country, data_type, COUNT(*)::int AS n,
                SUM(CASE WHEN COALESCE(data_json->>'level_norm','')='red' THEN 1 ELSE 0 END)::int AS red,
                MAX(collect_time) AS last
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '48 hours' AND COALESCE(country,'') <> ''
           AND COALESCE(data_json->>'level_norm','') IN ('red','orange')
           AND data_type IN ('terror_events','military_conflicts','mass_violence','crime_events','social_unrest','regime_change')
           AND ${EVGATE_SQL}
         GROUP BY 1, 2 HAVING COUNT(*) >= 4
         ORDER BY n DESC LIMIT 10`
      );
      /* #700 链明细：每链 top8 红橙条目（内联国别研判用，点击国别就地展开，不再跳转） */
      let chainEvents = [];
      if (chainQ.rows.length) {
        try {
          const evQ = await q(
            `SELECT country, data_type, id,
                    COALESCE(NULLIF(data_json->>'title_zh',''), title) AS t,
                    COALESCE(data_json->>'level_norm','') AS lv,
                    collect_time AS ct,
                    (data_json->>'chinaRelated') = 'true' AS cr
             FROM intel_data
             WHERE collect_time >= NOW() - INTERVAL '48 hours'
               AND COALESCE(data_json->>'level_norm','') IN ('red','orange')
               AND data_type IN ('terror_events','military_conflicts','mass_violence','crime_events','social_unrest','regime_change')
               AND country = ANY($1) AND data_type = ANY($2)
               AND ${EVGATE_SQL}
             ORDER BY collect_time DESC LIMIT 80`,
            [chainQ.rows.map(r => r.country), [...new Set(chainQ.rows.map(r => r.data_type))]]
          );
          chainEvents = evQ.rows || [];
        } catch (e) { /* 明细缺失不阻断 docket */ }
      }
      const chains = chainQ.rows.map(r => ({
        country: _iso2cnTry(r.country), type: _CAT_CN[r.data_type] || r.data_type,
        n: r.n, red: r.red, last: _fmtTime(r.last),
        /* #700 明细按 原始country+data_type 归组，每国别≤8 条 */
        events: chainEvents
          .filter(ev => ev.country === r.country && ev.data_type === r.data_type)
          .slice(0, 8)
          .map(ev => ({ id: ev.id, title: String(ev.t || '').slice(0, 90), level: ev.lv || 'orange', time: _fmtTime(ev.ct), china: ev.cr === true }))
      }));

      /* ⑤ 7 日类别分布 + 国别×类别热度矩阵 */
      const typeQ = await q(
        `SELECT data_type, COUNT(*)::int AS n FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`
      );
      const mtxQ = await q(
        `SELECT country, data_type, COUNT(*)::int AS n FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '7 days' AND COALESCE(country,'') <> ''
         GROUP BY 1, 2`
      );
      const cTot = {}, tTot = {}, cell = {};
      mtxQ.rows.forEach(r => {
        const c = _iso2cnTry(r.country);
        cTot[c] = (cTot[c] || 0) + r.n;
        tTot[r.data_type] = (tTot[r.data_type] || 0) + r.n;
        cell[c + '|' + r.data_type] = r.n;
      });
      const topCountries = Object.entries(cTot).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
      const topTypes = Object.entries(tTot).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);

      /* ⑥ KPI */
      const todayQ = await q(
        `SELECT COUNT(*)::int AS n FROM intel_data WHERE collect_time >= date_trunc('day', NOW())`
      );
      const kpi = {
        pending72: candidates.length,
        todayNew: todayQ.rows[0] ? todayQ.rows[0].n : 0,
        chinaRedOrange: candidates.filter(c => c.china).length,
        activeChains: sigQ.rows.filter(x => x.n >= 3).length
      };

      res.json({
        ok: true, kpi, queue, chains,
        typeDist7: typeQ.rows.map(r => ({ type: _CAT_CN[r.data_type] || r.data_type, n: r.n })),
        matrix: { countries: topCountries, types: topTypes.map(t => _CAT_CN[t] || t), typeKeys: topTypes, cell },
        generatedAt: _nowCn(),
        note: '口径：研判队列=近72小时红橙事件 × 复合研判价值评分（级别权重×时近衰减 + 涉华加成 + 信源印证加成 + 链条长度加成，全库真实计算）· #712 事件时效闸：候选须事件发生于近7日内（event_date/publish_time 优先判定，补采回灌/旧文重发不进主面板，历史数据走 lifecycle/similar/案卷历史复盘）；突发事件链=48小时国别×类别红橙聚合簇（≥4条，同受时效闸约束）；矩阵=近7日国别×类别事件量。零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
};
