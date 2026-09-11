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
const ENT_ASSETS = require('./ent-assets'); /* #746 P0-3：35 企注册表（项目/投资/人员档案口径），影响传导资产底数 */

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
      /* #743 预测核验公示（真实对账数据；尚无已核验时公示机制运行状态与首批到期日） */
      try {
        const { rows: fr } = await q(`SELECT
            COUNT(*) FILTER (WHERE verify_status IS NOT NULL)::int AS verified,
            COUNT(*) FILTER (WHERE verify_status='hit')::int AS hit,
            COUNT(*) FILTER (WHERE verify_status='near')::int AS near,
            COUNT(*) FILTER (WHERE verify_status IS NULL)::int AS pending,
            (MIN(ts) FILTER (WHERE verify_status IS NULL) + INTERVAL '7 days')::text AS nd
          FROM ai_forecast_history`, []);
        const f = fr[0] || {};
        if (f.verified) advice.push('预测核验公示：' + f.verified + ' 条 7 天预测已满期回算，方向命中率 ' + Math.round(f.hit / f.verified * 100) + '%（命中 ' + f.hit + '，方向对/幅度不足 ' + f.near + '）');
        else if (f.pending) advice.push('预测对账机制运行中：' + f.pending + ' 条预测滚动留底，首批 ' + String(f.nd || '').slice(5, 10).replace('-', '月') + '日 满 7 天自动核验公示');
      } catch (e) { /* 表未建/权限静默 */ }
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

  /* ---------- #744 P0-2 企业风险订阅画像「我的风险」工作台 ----------
   * 三维过滤（企业/行业/国别，默认全集）→ 项目档案卡 + 近 24h 涉企预警流 + 企业定制要报摘要。
   * 数据源：enterprise_projects（项目档案）+ intel_data（近 24h 红橙/涉华）。
   * 缓存：按入参 key 45s；无模拟——空选中项返回 empty projects。 */
  let _mrCache = null;
  function _csv(qs) { return String(qs || '').split(',').map(s => s.trim()).filter(Boolean); }
  router.get('/my-risk', async (req, res) => {
    try {
      const wantEnterprises = _csv(req.query.enterprises);
      const wantSectors = _csv(req.query.sectors);
      const wantCountries = _csv(req.query.countries);
      const cacheKey = JSON.stringify([wantEnterprises, wantSectors, wantCountries]);
      const now = Date.now();
      if (_mrCache && _mrCache.key === cacheKey && now - _mrCache.at < 45000) return res.json(_mrCache.data);
      /* ① 元数据全集（取库内真实全集，非入参子集） */
      const { rows: ents } = await q(`SELECT enterprise, COUNT(*)::int AS n FROM enterprise_projects WHERE enterprise<>'' GROUP BY 1 ORDER BY 2 DESC, 1`, []);
      const { rows: sctrs } = await q(`SELECT data_json->>'sector' AS sector, COUNT(*)::int AS n FROM enterprise_projects GROUP BY 1 ORDER BY 2 DESC, 1`, []);
      const { rows: ctrs } = await q(`SELECT country, COUNT(*)::int AS n FROM enterprise_projects WHERE country<>'' GROUP BY 1 ORDER BY 2 DESC, 1`, []);
      /* ② 过滤命中项目 */
      let projSql = `SELECT id, enterprise, project, country, location, status, data_json, updated_at
        FROM enterprise_projects WHERE enterprise<>''`;
      const projParams = []; const projCond = [];
      if (wantEnterprises.length) { projParams.push(wantEnterprises); projCond.push('enterprise = ANY($' + projParams.length + '::text[])'); }
      if (wantCountries.length) { projParams.push(wantCountries); projCond.push('country = ANY($' + projParams.length + '::text[])'); }
      if (projCond.length) projSql += ' AND ' + projCond.join(' AND ');
      projSql += ' ORDER BY updated_at DESC LIMIT 200';
      const { rows: projs } = await q(projSql, projParams);
      /* 行业在 data_json 里，过滤后再筛 */
      let filtered = projs;
      if (wantSectors.length) filtered = projs.filter(p => wantSectors.indexOf(String((p.data_json || {}).sector || '')) >= 0);
      /* ③ 项目所在国（去重） */
      const projCountries = Array.from(new Set(filtered.map(p => p.country).filter(Boolean)));
      /* ④ 近 24h 红橙/涉华事件流（仅查命中项目所在国；涉华判定在 JS 层用 isChina()——与 leader-brief 同口径） */
      let alerts24 = [];
      if (projCountries.length) {
        const { rows: al } = await q(`SELECT id, collect_time, country, severity, data_type, source, title,
            COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
          FROM intel_data
          WHERE collect_time >= NOW() - INTERVAL '24 hours'
            AND audit_status='approved' AND ${FRESH}
            AND COALESCE(country,'') <> '中国'
            AND country = ANY($1::text[])
            AND severity IN ('red','orange','yellow')
          ORDER BY collect_time DESC LIMIT 150`, [projCountries]);
        alerts24 = al.map(r => {
          const cn = isChina(String(r.title || '') + ' ' + String(r.title_cn || ''));
          return {
            id: r.id, time: new Date(r.collect_time).toISOString().replace('T', ' ').slice(0, 16) + 'Z',
            country: r.country || '—', level: r.severity, type: _CAT_CN[r.data_type] || r.data_type,
            source: r.source || '', title: (r.title_cn || '').slice(0, 90), china: cn
          };
        }).filter(a => a.level === 'red' || a.level === 'orange' || a.china);
      }
      /* ⑤ 项目档案卡（解析 data_json） + 风险等级分布 */
      const riskDist = { high: 0, medium: 0, low: 0, unrated: 0 };
      const projects = filtered.map(p => {
        const j = p.data_json || {};
        const rl = String(j.risk_level || '').toLowerCase();
        if (riskDist[rl] != null) riskDist[rl]++; else riskDist.unrated++;
        const lastEv = Array.isArray(j.risk_events) && j.risk_events.length ? j.risk_events[j.risk_events.length - 1] : null;
        return {
          id: String(p.id), enterprise: p.enterprise || j.enterprise || '',
          project: p.project || j.project_name || '', country: p.country || '',
          location: p.location || j.city || '', sector: j.sector || '—',
          status: p.status || j.status || '—',
          investment: j.investment || '—', startDate: j.start_date || '',
          riskLevel: rl || 'unrated', riskLabel: ({ high: '高', medium: '中', low: '低' }[rl] || '未评级'),
          desc: (j.desc || '').slice(0, 140),
          lastEvent: lastEv ? { t: lastEv.t, level: lastEv.level, evt: (lastEv.evt || '').slice(0, 80) } : null,
          updatedAt: p.updated_at
        };
      });
      /* ⑥ 定制要报摘要 */
      const brief = {
        selectedEnterprises: wantEnterprises.length, selectedSectors: wantSectors.length, selectedCountries: wantCountries.length,
        projects: projects.length,
        red24: alerts24.filter(a => a.level === 'red').length,
        orange24: alerts24.filter(a => a.level === 'orange').length,
        china24: alerts24.filter(a => a.china).length,
        riskDist: riskDist,
        topCountries: (() => {
          const m = {};
          alerts24.forEach(a => { m[a.country] = (m[a.country] || 0) + 1; });
          return Object.entries(m).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([c, n]) => ({ country: c, n }));
        })()
      };
      const out = {
        ok: true, generatedAt: _nowCn(),
        meta: {
          enterprises: ents.map(r => ({ name: r.enterprise, n: r.n })),
          sectors: sctrs.map(r => ({ name: r.sector || '未分类', n: r.n })),
          countries: ctrs.map(r => ({ name: r.country, n: r.n }))
        },
        selected: { enterprises: wantEnterprises, sectors: wantSectors, countries: wantCountries },
        brief, projects, alerts24,
        note: '「我的风险」工作台：按企业/行业/国别三维过滤 enterprise_projects 69 项目 + 近 24h 红橙/涉华事件流；项目档案=企业/项目/国别/行业/状态/投资额/风险等级/最近一次预警；零模拟——选中项为空时 projects 为空、alerts24 按项目国去空返回。'
      };
      _mrCache = { key: cacheKey, at: now, data: out };
      res.json(out);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #746 P0-3 事件→资产影响传导研判（红级事件 × 中资项目 proximity 关联 + AI 三段式） ----------
   * 端点A GET /impact-chain        近 72h 红级事件 → 自动关联同国别/地理邻近/行业定向中资项目（含匹配依据），45s 缓存
   * 端点B GET /impact-chain/ai?id= 单事件 AI 三段式研判（传导路径→影响量级→建议动作），Kimi 参谋级，
   *        150s 硬超时回落规则模板；按事件 id 10min 缓存 + in-flight 合并（AI 研判类现算端点铁律）。
   * 资产底数：enterprise_projects（库内动态在册）+ ent-assets.js 35 企注册表（平台档案口径，补充覆盖，按项目名去重）。
   * 匹配三维：同国别（必选）+ 项目驻地词命中事件标题（地理邻近加成）+ 事件类型×行业定向冲击。 */
  const _ENT_REG = ENT_ASSETS.ENTERPRISES || [];
  /* 事件类型 → 定向冲击行业（缺省=该类型对全行业构成普遍安全暴露） */
  const _IC_SECTOR_HIT = {
    regime_change: ['建筑工程', '矿业资源', '能源石化', '能源电力', '能源核电', '工程承包'],
    election_events: ['建筑工程', '矿业资源', '能源石化', '农业食品'],
    policy_shift: ['通信科技', '新能源汽车', '农业食品', '综合贸易', '综合投资'],
    sanctions_data: ['通信科技', '能源石化', '矿业资源', '能源核电', '物流运输'],
    infrastructure: ['建筑工程', '物流运输', '能源电力'],
    environmental_event: ['矿业资源', '能源电力', '农业食品'],
    industrial_accident: ['建筑工程', '能源石化', '能源电力'],
    financial_market: ['综合投资', '物流运输', '建筑工程'],
    business_climate: ['建筑工程', '工程承包', '综合贸易']
  };
  let _icListCache = null;

  /* 事件行 → 标准事件对象（列表/详情共用） */
  function _icEvObj(r) {
    const j = r.data_json || {};
    return {
      id: r.id, type: r.data_type, typeCn: _CAT_CN[r.data_type] || r.data_type,
      title: String(r.title_cn || r.title || '').slice(0, 120),
      rawTitle: String(r.title || ''),
      country: _iso2cnTry(r.country || j.country_cn || ''),
      level: _lv(j, r.severity),
      source: r.source || '', url: j.url || '',
      time: _fmtTime(j.publish_time || r.event_date || r.collect_time),
      china: !!isChina(String(r.title || '') + ' ' + String(r.title_cn || '')),
      _r: r
    };
  }
  /* 资产底数：库内在册 + 注册表（全量加载，量级 <500 行，单请求内复用） */
  async function _icLoadBases() {
    const { rows: projRows } = await q(`SELECT enterprise, project, country, location, status, data_json FROM enterprise_projects WHERE enterprise<>''`, []);
    const dbProj = projRows.map(p => {
      const j = p.data_json || {};
      return {
        src: 'db', name: p.project || j.project_name || p.enterprise, enterprise: p.enterprise,
        country: _iso2cnTry(p.country || ''), location: p.location || j.city || '',
        sector: j.sector || '—', status: p.status || j.status || '—',
        investment: Number(j.investment) || 0, invTxt: j.investment ? String(j.investment) + ' 亿美元' : '', personnel: 0
      };
    });
    const regProj = [];
    _ENT_REG.forEach(en => (en.projects || []).forEach(p => regProj.push({
      src: 'reg', name: p.n, enterprise: en.short || en.name, enterpriseFull: en.name,
      country: p.c, location: '', sector: en.industry || '—', status: '在营（注册表档案口径）',
      investment: Number(p.inv) || 0, invTxt: p.inv ? String(p.inv) + ' 亿美元' : '', personnel: Number(p.p) || 0
    })));
    const seen = new Set(dbProj.map(p => p.name + '|' + p.country));
    return { dbProj, regProj: regProj.filter(p => !seen.has(p.name + '|' + p.country)), regProjAll: regProj };
  }
  /* 单事件匹配（地理邻近 = 项目驻地词命中事件标题；行业定向 = 事件类型→行业映射） */
  function _icMatch(ev, bases) {
    const sectorHit = _IC_SECTOR_HIT[ev.type];
    const hit = bases.dbProj.filter(p => p.country === ev.country)
      .concat(bases.regProj.filter(p => p.country === ev.country));
    const tLow = ev.rawTitle.toLowerCase();
    const projects = hit.map(p => {
      const reasons = ['同国别（' + ev.country + '）'];
      if (p.location && p.location.length >= 2 && (ev.title.indexOf(p.location) >= 0 || tLow.indexOf(p.location.toLowerCase()) >= 0)) reasons.push('事件提及项目驻地「' + p.location + '」（地理邻近）');
      if (sectorHit == null) reasons.push('该事件类型对全行业构成普遍安全暴露');
      else if (sectorHit.indexOf(p.sector) >= 0) reasons.push('事件类型定向冲击 ' + p.sector + ' 行业');
      return { src: p.src, name: p.name, enterprise: p.enterprise, country: p.country, location: p.location, sector: p.sector, status: p.status, investment: p.investment, invTxt: p.invTxt, personnel: p.personnel, reasons, score: 1 + reasons.length };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
    return {
      projects, projCount: projects.length,
      enterprises: Array.from(new Set(projects.map(p => p.enterprise))).length,
      investment: Math.round(projects.reduce((s, p) => s + (p.investment || 0), 0) * 10) / 10,
      personnel: projects.reduce((s, p) => s + (p.personnel || 0), 0)
    };
  }
  async function _icScan() {
    if (_icListCache && Date.now() - _icListCache.at < 45000) return _icListCache.data;
    /* ① 近 72h 候选（#712 事件时效闸：publish_time/event_date 优先判定，补采回灌/旧文重发出局） */
    const { rows: evRows } = await q(
      `SELECT id, data_type, title, country, severity, source, collect_time, event_date, data_json,
              COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
       FROM intel_data
       WHERE collect_time >= NOW() - INTERVAL '72 hours' AND audit_status='approved' AND ${FRESH}
         AND COALESCE(country,'') NOT IN ('中国','')
       ORDER BY collect_time DESC LIMIT 400`, []
    );
    const evs = evRows.map(_icEvObj).filter(e => e.level === 'red' && _evFresh(e._r, 3)).slice(0, 30);
    /* ② 资产底数 + ③ 逐事件匹配 */
    const bases = await _icLoadBases();
    const events = evs.map(ev => {
      const m = _icMatch(ev, bases);
      const o = { id: ev.id, type: ev.type, typeCn: ev.typeCn, title: ev.title, country: ev.country, level: ev.level, source: ev.source, url: ev.url, time: ev.time, china: ev.china };
      return Object.assign(o, m);
    }).sort((a, b) => (b.projCount - a.projCount) || (String(b.time).localeCompare(String(a.time))));
    /* 汇总（按 项目名|国别 去重） */
    const pSet = new Set(), eSet = new Set();
    events.forEach(e => (e.projects || []).forEach(p => { pSet.add(p.name + '|' + p.country); eSet.add(p.enterprise); }));
    const out = {
      ok: true, generatedAt: _nowCn(),
      stats: {
        redEvents: events.length, eventsWithProjects: events.filter(e => e.projCount > 0).length,
        exposedProjects: pSet.size, enterprises: eSet.size
      },
      events,
      note: '影响传导研判：近 72h 红级事件（#712 事件时效闸，publish_time/event_date 优先）× 中资资产（enterprise_projects 在册 + 35 企注册表档案，按项目名去重）；匹配三维=同国别（必选）+ 项目驻地词命中事件标题（地理邻近）+ 事件类型×行业定向；投资/人员为注册表档案口径。零模拟——事件全部来自实时采集库。'
    };
    _icListCache = { at: Date.now(), data: out };
    return out;
  }
  router.get('/impact-chain', async (req, res) => {
    try { res.json(await _icScan()); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- #746 端点B：单事件 AI 三段式（传导路径→影响量级→建议动作） ---------- */
  const _icAiCache = new Map(), _icAiBusy = new Map();
  function _icAiFallback(ev) {
    const ps = ev.projects || [];
    const entStr = Array.from(new Set(ps.map(p => p.enterprise))).slice(0, 5).join('、') || '—';
    const path = '【传导路径】' + ev.country + '发生' + ev.typeCn + '红级事件「' + String(ev.title).slice(0, 60) + '」，按同国别/地理邻近/行业暴露三维匹配，' + ps.length + ' 个中资项目处于暴露半径内（涉及 ' + entStr + ' 等）。传导链路：现场安全威胁（人员遇袭/营地受扰/交通中断）→ 项目运营中断（施工停滞/物流受阻/工期承压）→ 商务与合规连锁（违约金、保险费率上调、驻在国审查收紧）。';
    const mag = '【影响量级】总体档位：' + (ev.china ? '高（事件涉华直接关联）' : ((ps.length >= 3 || (ev.investment || 0) >= 10) ? '中（多项目/高投资暴露）' : '低（单项目有限暴露）')) + '。量化口径：关联项目 ' + ps.length + ' 个、企业 ' + (ev.enterprises || 0) + ' 家，账面投资合计约 ' + (ev.investment || 0) + ' 亿美元，驻外人员合计约 ' + (ev.personnel || 0) + ' 人（注册表档案口径）。';
    const act = '【建议动作】一是对暴露半径内项目立即执行人员安全清点与营地安防加固，对接项目现场应急预案；二是向驻' + ev.country + '使领馆报备人员分布并保持联络机制热更新；三是对人员密集项目预置撤离预案（集合点、撤离路线、包机通道三要素）；四是评估供应链替代方案，关键物资运输改道或提前备货；五是建立事件专项案卷，跟踪后续 72 小时同类事件密度，密度上升即上调关联项目风险等级并触发复核。';
    return { ok: true, llmOk: false, path, magnitude: mag, actions: act, generatedAt: _nowCn(), note: '大模型研判暂不可用，本段为规则模板装配（事件、项目、投资、人员数字全部引用真实库与注册表档案）；链路恢复后自动升级 Kimi 参谋级研判。' };
  }
  async function _icAiGen(ev) {
    const pv = reportsEngine._test.pvKimi();
    const sys = '你是海外利益保护情报预警平台的首席情报参谋，执行「事件→资产影响传导」专项研判任务。严格按以下三段格式输出，段首标记必须逐字一致：【传导路径】2-4 句，从事件本体出发，写清传导机制（安全威胁→运营中断→商务合规连锁），落到具体受影响项目；【影响量级】先给总体档位（高/中/低）及定档依据，再引用给定的关联项目数、投资额、人员数量化口径；【建议动作】3-5 条，每条以「一是/二是/三是」开头，具体可执行（人员清点、使领馆报备、撤离预案预置、供应链备份、风险等级复核），对接应急预案与处置闭环。全部基于给定真实数据外推，禁止编造事件与数字；信息不足处写「样本不足」。';
    const usr = '【红级事件（真实采集库）】\n国别：' + ev.country + '\n类别：' + ev.typeCn + '\n标题：' + ev.title + '\n发生时间：' + ev.time + (ev.china ? '\n涉华关联：是' : '') + '\n\n【暴露半径内中资项目（同国别/地理邻近/行业定向匹配，真实档案）】\n' + ((ev.projects || []).map((p, i) => (i + 1) + '. ' + p.name + '（' + p.enterprise + '，' + p.country + (p.location ? '·' + p.location : '') + '，' + p.sector + (p.invTxt ? '，投资' + p.invTxt : '') + (p.personnel ? '，人员' + p.personnel + '人' : '') + '；匹配依据：' + p.reasons.join('；') + '）').join('\n') || '（无匹配项目）') + '\n\n汇总：关联项目 ' + (ev.projCount || 0) + ' 个、企业 ' + (ev.enterprises || 0) + ' 家，账面投资合计约 ' + (ev.investment || 0) + ' 亿美元，驻外人员合计约 ' + (ev.personnel || 0) + ' 人。\n请输出三段式影响传导研判。';
    try {
      /* #740 实测：kimi-k2.7 真实研判 prompt 需 >60s，放宽到 150s（10min 缓存兜底） */
      const r = await Promise.race([llmCall(pv, sys, usr), new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT_150s')), 150000))]);
      if (r && r.text && String(r.text).length > 250) {
        const txt = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
        const pB = txt.split(/【传导路径】/)[1] || '';
        const mB = pB.split(/【影响量级】/);
        const aB = txt.split(/【建议动作】/);
        const path = String(mB[0] || '').trim();
        const magnitude = String((mB[1] || '').split(/【建议动作】/)[0] || '').trim();
        const actions = String(aB[1] || '').trim();
        if (path.length > 60 && actions.length > 40) {
          return { ok: true, llmOk: true, path, magnitude: magnitude || '（模型未按格式输出量级段，请结合项目数字复核）', actions, generatedAt: _nowCn(), note: 'Kimi 大模型基于真实事件与项目档案生成（事件与项目全部真实，研判为模型外推，事实以原文链接为准）；按事件 10 分钟缓存。' };
        }
      }
    } catch (e) { console.warn('[INSIGHT] impact-chain-ai LLM 失败，回落规则模板:', e.message); }
    return _icAiFallback(ev);
  }
  router.get('/impact-chain/ai', async (req, res) => {
    try {
      const id = String(req.query.id || '').trim();
      if (!id) return res.status(400).json({ ok: false, error: '缺少事件 id' });
      const cached = _icAiCache.get(id);
      if (cached && Date.now() - cached.at < 600000) return res.json(cached.data);
      if (_icAiBusy.has(id)) return res.json(await _icAiBusy.get(id));
      /* in-flight 合并：busy promise 必须在任何 await 之前入表（并发窗口归零） */
      const job = (async () => {
        /* 事件 + 匹配装配（不依赖列表缓存，单查） */
        const { rows } = await q(`SELECT id, data_type, title, country, severity, source, collect_time, event_date, data_json,
            COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn FROM intel_data WHERE id=$1`, [id]);
        if (!rows.length) throw Object.assign(new Error('未找到事件 id=' + id), { statusCode: 404 });
        const ev = _icEvObj(rows[0]);
        const bases = await _icLoadBases();
        const obj = { id: ev.id, type: ev.type, typeCn: ev.typeCn, title: ev.title, country: ev.country, level: ev.level, source: ev.source, url: ev.url, time: ev.time, china: ev.china };
        Object.assign(obj, _icMatch(ev, bases));
        const data = await _icAiGen(obj);
        return Object.assign({ event: obj }, data);
      })();
      _icAiBusy.set(id, job);
      try {
        const out = await job;
        _icAiCache.set(id, { at: Date.now(), data: out });
        res.json(out);
      } finally { _icAiBusy.delete(id); }
    } catch (e) {
      const sc = e && e.statusCode ? e.statusCode : 500;
      res.status(sc).json({ ok: false, error: e.message });
    }
  });

  /* ---------- #754 智能预警中心·单事件 AI 深度研判：深度研判→未来发展趋势→对华影响真实性评估 ----------
   * POST /api/insight/ai-judge  body={id(SRV-<n>|裸id), alert_no, title, desc, content, country, type, level, url, source, time, chinaRelated}
   * 库内事件回源 intel_data 取全文；语境全部真实库统计（同国 7d 密度/红级/涉华、同类全球量、同国同类近 30d、
   * 中资项目暴露复用影响传导三维匹配）。Kimi 参谋级 150s 硬超时回落规则模板；按事件 10min 缓存 + in-flight 合并。
   * 2026-09-10 铁律：替代前端原 setTimeout 假模拟 AI 分析——研判必须真调大模型/真引统计，零模拟。 */
  const _ajCache = new Map(), _ajBusy = new Map();
  function _ajParseIntelId(id) {
    const s = String(id || '');
    const m = s.match(/^SRV-(\d+)$/);
    if (m) return Number(m[1]);
    if (/^\d+$/.test(s)) return Number(s);
    return null;
  }
  /* 规则模板回落：数字全部引用真实库统计与注册表档案，零虚构 */
  function _ajFallback(ev, ctx) {
    const trendDir = ctx.recent3d > ctx.prev4d ? '上升' : (ctx.recent3d < ctx.prev4d ? '回落' : '持平');
    const entStr = ctx.projects && ctx.projects.length ? Array.from(new Set(ctx.projects.map(p => p.enterprise))).slice(0, 3).join('、') : '';
    const judge = '【深度研判】' + (ev.country || '未知地区') + '发生' + (ev.typeCn || '安全') + '类' + (ev.level === 'red' ? '红级' : ev.level === 'orange' ? '橙级' : '监测级') + '事件「' + String(ev.title).slice(0, 60) + '」。真实库背景：同国近 7 天事件 ' + ctx.country7d + ' 条（红级 ' + ctx.red7d + ' 条、涉华关联 ' + ctx.china7d + ' 条），近 3 天 ' + ctx.recent3d + ' 条对比前 4 天 ' + ctx.prev4d + ' 条，事件密度' + trendDir + '；该类别全球近 7 天 ' + ctx.type7d + ' 条。' + (ev.china ? '事件命中涉华严格检测（isChinaRelatedStrict），存在明确涉华要素。' : '事件未命中涉华严格检测，涉华关联待核。') + (ctx.projects && ctx.projects.length ? '同国别在册中资项目 ' + ctx.projCount + ' 个（账面投资合计约 ' + ctx.investment + ' 亿美元、驻外人员约 ' + ctx.personnel + ' 人）处于国别暴露半径。' : '同国别暂无在册中资项目档案。');
    const trend = '【未来发展趋势】短期（24 小时）：以事件现场处置与信息扩散为主，关注同源后续报道密度；中期（7 天）：同国事件密度呈' + trendDir + '态势' + (trendDir === '上升' ? '，不排除同类事件连锁' : '，预计按既有密度演化') + '；长期（30 天）：视驻在国局势结构性因素而定，样本期内以持续监测为主。观察指标：① 同国 72 小时内同类事件新增量（≥3 条视为升级信号）；② 是否出现中方机构/人员直接卷入的报道；③ 驻在国政府/军方表态是否升级。';
    const impact = '【对华影响真实性评估】涉华关联性质：' + (ev.china ? '检测命中（存在直接关联要素）' : '未命中涉华检测（无直接关联，影响为间接国别暴露）') + '。信息可信度：来源 ' + (ev.source || '未知') + '，多源印证数 ' + (ev.corr || 0) + ((ev.corr || 0) >= 2 ? '（多源交叉）' : '（单源线索）') + '。实质影响：' + (ctx.projects && ctx.projects.length ? '同国 ' + ctx.projCount + ' 个在册中资项目存在国别级安全暴露（涉及 ' + entStr + ' 等）' : '无在册项目暴露记录，影响以人员安全提示与国别风险等级为主') + '。真实性评级：' + (ev.china && (ev.corr || 0) >= 2 ? '高（涉华要素明确且多源印证）' : ev.china ? '中（涉华要素明确但单源）' : '低（无直接涉华关联）') + '。';
    return { ok: true, llmOk: false, judge, trend, impact, generatedAt: _nowCn(), note: '大模型研判暂不可用，本段为规则模板装配（事件、同国密度、暴露项目、印证数全部引用真实库与注册表档案）；链路恢复后自动升级 Kimi 参谋级研判（10 分钟缓存周期后重试）。' };
  }
  /* 事件装配：库内回源全文 + 同国/同类真实统计 + 项目暴露三维匹配 */
  async function _ajLoad(p) {
    const intelId = _ajParseIntelId(p.id);
    let row = null;
    if (intelId != null) {
      const { rows } = await q(`SELECT id, data_type, title, country, severity, source, collect_time, event_date, data_json,
          COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn FROM intel_data WHERE id=$1`, [intelId]);
      row = rows[0] || null;
    }
    let ev;
    if (row) {
      const j = row.data_json || {};
      ev = _icEvObj(row);
      ev.corr = Number(j.corroboration || 0);
      ev.content = String(j.content || j.desc || '').slice(0, 2600);
    } else {
      /* 手动录入/已清扫条目：以前端真实载荷为准（仍是真实数据，零模拟） */
      ev = {
        id: String(p.id || ''), type: '', typeCn: String(p.type || '安全风险'), title: String(p.title || '未命名事件').slice(0, 120),
        rawTitle: String(p.titleRaw || ''), country: String(p.country || ''), level: String(p.level || ''),
        source: String(p.source || ''), url: String(p.url || ''), time: String(p.time || ''),
        china: !!p.chinaRelated, corr: 0, content: String(p.content || p.desc || '').slice(0, 2600)
      };
    }
    const ctx = { country7d: 0, red7d: 0, china7d: 0, type7d: 0, recent3d: 0, prev4d: 0, similar: [], projects: [], projCount: 0, enterprises: 0, investment: 0, personnel: 0 };
    if (ev.country) {
      /* 精确总量/红级/3d/4d 窗口拆分（独立 COUNT 聚合，防 LIMIT 300 截断把 recent3d 撑满、红级漏检） */
      const { rows: aggRows } = await q(`SELECT COUNT(*)::int n,
          COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '3 days')::int recent3d,
          COUNT(*) FILTER (WHERE severity='red' OR COALESCE(data_json->>'risk_zone','') IN ('红','red')
            OR ((data_json->>'risk_score') ~ '^[0-9]+(\\.[0-9]+)?$' AND (data_json->>'risk_score')::float >= 61))::int reds
          FROM intel_data WHERE country=$1 AND collect_time >= NOW() - INTERVAL '7 days' AND audit_status='approved'`, [ev.country]);
      ctx.country7d = Number((aggRows[0] && aggRows[0].n) || 0);
      ctx.recent3d = Number((aggRows[0] && aggRows[0].recent3d) || 0);
      ctx.prev4d = Math.max(ctx.country7d - ctx.recent3d, 0);
      ctx.red7d = Number((aggRows[0] && aggRows[0].reds) || 0);
      const { rows: cRows } = await q(`SELECT id, data_type, title, country, severity, source, collect_time, event_date, data_json,
          COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn FROM intel_data
          WHERE country=$1 AND collect_time >= NOW() - INTERVAL '7 days' AND audit_status='approved' ORDER BY collect_time DESC LIMIT 300`, [ev.country]);
      ctx.china7d = cRows.filter(r => isChina(String(r.title || '') + ' ' + String(r.title_cn || ''))).length;
      if (ev.type) {
        ctx.similar = cRows.filter(r => r.data_type === ev.type).slice(0, 5)
          .map(r => ({ title: String(r.title_cn || r.title || '').slice(0, 80), time: _fmtTime((r.data_json || {}).publish_time || r.event_date || r.collect_time) }));
      }
    }
    if (ev.type) {
      const { rows: tRows } = await q(`SELECT COUNT(*) n FROM intel_data WHERE data_type=$1 AND collect_time >= NOW() - INTERVAL '7 days' AND audit_status='approved'`, [ev.type]);
      ctx.type7d = Number((tRows[0] && tRows[0].n) || 0);
    }
    try {
      const bases = await _icLoadBases();
      const m = _icMatch(ev, bases);
      ctx.projects = m.projects; ctx.projCount = m.projCount; ctx.enterprises = m.enterprises; ctx.investment = m.investment; ctx.personnel = m.personnel;
    } catch (e) { console.warn('[INSIGHT] ai-judge 项目暴露装配失败:', e.message); }
    return { ev, ctx };
  }
  async function _ajGen(ev, ctx) {
    if (!llmCall) return _ajFallback(ev, ctx);
    const pv = reportsEngine._test.pvKimi();
    const sys = '你是海外利益保护情报预警平台的首席情报参谋，执行「单事件深度研判」任务。严格按以下三段格式输出，段首标记必须逐字一致：【深度研判】3-5 句，判断事件本质与性质（偶发/蓄意/系统性风险）、直接动因与背后结构性因素、现阶段最需要关注的要点；【未来发展趋势】必须分三个时段（24小时内／7天内／30天内），每时段给出走向判断（升级/僵持/缓和）、概率估计（百分比）与 1-2 个可观察的升级或缓和信号；【对华影响真实性评估】先判定涉华关联性质（直接关联/间接关联/无实质关联），再评实质影响（人员安全/项目运营/供应链/合规声誉，凡提及必须落到给定事实），再评信息可信度（来源立场、多源印证数），最后给真实性评级（高/中/低）与一句依据；若涉华关联被媒体夸大或无实质影响，必须明确指出，不得迎合。全部基于给定真实数据外推，禁止编造事件、数字与来源；信息不足处写「样本不足」。';
    const usr = '【事件（真实采集库）】\n标题：' + ev.title + '\n国别：' + (ev.country || '—') + ' | 类别：' + (ev.typeCn || '—') + ' | 级别：' + (ev.level || '—') + ' | 时间：' + (ev.time || '—') + '\n来源：' + (ev.source || '—') + ' | 多源印证数：' + (ev.corr || 0) + ' | 涉华严格检测：' + (ev.china ? '命中' : '未命中') + (ev.rawTitle ? '\n原文标题：' + ev.rawTitle : '') + '\n正文摘录：' + (ev.content && ev.content.length > 30 ? ev.content : '（无正文，仅有标题级信息）') + '\n\n【同国真实库背景（近 7 天）】\n同国事件 ' + ctx.country7d + ' 条（红级 ' + ctx.red7d + ' 条、涉华关联 ' + ctx.china7d + ' 条）；近 3 天 ' + ctx.recent3d + ' 条 vs 前 4 天 ' + ctx.prev4d + ' 条；\n该类别全球近 7 天 ' + ctx.type7d + ' 条；\n同国近期同类事件：\n' + (ctx.similar.length ? ctx.similar.map((s, i) => (i + 1) + '. ' + s.title + '（' + s.time + '）').join('\n') : '（样本不足）') + '\n\n【中资项目暴露（同国别/地理邻近/行业定向匹配，真实档案）】\n' + ((ctx.projects || []).map((p2, i) => (i + 1) + '. ' + p2.name + '（' + p2.enterprise + '，' + p2.sector + (p2.invTxt ? '，投资' + p2.invTxt : '') + (p2.personnel ? '，人员' + p2.personnel + '人' : '') + '）').join('\n') || '（无匹配项目）') + '\n汇总：项目 ' + ctx.projCount + ' 个、企业 ' + ctx.enterprises + ' 家，账面投资约 ' + ctx.investment + ' 亿美元，驻外人员约 ' + ctx.personnel + ' 人。\n\n请输出三段式深度研判（【深度研判】【未来发展趋势】【对华影响真实性评估】）。';
    try {
      /* #740 实测：kimi-k2.7 真实研判 prompt 需 >60s，放宽到 150s（10min 缓存兜底） */
      const r = await Promise.race([llmCall(pv, sys, usr), new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT_150s')), 150000))]);
      if (r && r.text && String(r.text).length > 300) {
        const txt = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
        const jB = String(txt.split(/【深度研判】/)[1] || '').split(/【未来发展趋势】/)[0].trim();
        const tB = String(txt.split(/【未来发展趋势】/)[1] || '').split(/【对华影响真实性评估】/)[0].trim();
        const iB = String(txt.split(/【对华影响真实性评估】/)[1] || '').trim();
        if (jB.length > 100 && iB.length > 60) {
          return { ok: true, llmOk: true, judge: jB, trend: tB || '（模型未按格式输出趋势段，请结合观察指标复核）', impact: iB, generatedAt: _nowCn(), note: 'Kimi 大模型基于真实事件全文与同国/同类/项目暴露真实统计生成；趋势与影响为模型外推预测，事实以原文链接为准；按事件 10 分钟缓存。' };
        }
      }
    } catch (e) { console.warn('[INSIGHT] ai-judge LLM 失败，回落规则模板:', e.message); }
    return _ajFallback(ev, ctx);
  }
  router.post('/ai-judge', async (req, res) => {
    try {
      const p = req.body || {};
      const key = String(p.id || p.alert_no || p.title || '').slice(0, 60);
      if (!key) return res.status(400).json({ ok: false, error: '缺少事件标识' });
      const cached = _ajCache.get(key);
      if (cached && Date.now() - cached.at < 600000) return res.json(cached.data);
      if (_ajBusy.has(key)) return res.json(await _ajBusy.get(key));
      /* in-flight 合并：busy promise 必须在任何 await 之前入表（并发窗口归零） */
      const job = (async () => {
        const { ev, ctx } = await _ajLoad(p);
        const data = await _ajGen(ev, ctx);
        return Object.assign({
          event: { id: ev.id, title: ev.title, country: ev.country, level: ev.level, url: ev.url },
          ctxStats: { country7d: ctx.country7d, red7d: ctx.red7d, china7d: ctx.china7d, type7d: ctx.type7d, recent3d: ctx.recent3d, prev4d: ctx.prev4d, projCount: ctx.projCount, enterprises: ctx.enterprises, investment: ctx.investment, personnel: ctx.personnel }
        }, data);
      })();
      _ajBusy.set(key, job);
      try {
        const out = await job;
        _ajCache.set(key, { at: Date.now(), data: out });
        res.json(out);
      } finally { _ajBusy.delete(key); }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* ============================================================
   * #747 供应链中断传导预测 — GET /api/insight/supply-chain
   * 物流/港口/运河/罢工/地缘中断事件（真实库 30d）→ 六大咽喉点 + 六大走廊映射
   * → 事件密度/红级/涉华/趋势 → 受影响中资项目与行业（复用影响传导资产底数）
   * → 规则式传导链（中断→运价/绕行→交期→项目物资→成本）。零模拟。
   * ============================================================ */
  const SC_KW = '(港口|海运|航运|运河|红海|曼德|巴拿马|马六甲|霍尔木兹|苏伊士|北极航道|物流|供应链|罢工|封锁|航道|海峡|货轮|集装箱|货船|运输中断|改道|滞留|停摆|堵|port|canal|strait|shipping|freight|container|strike|blockade|supply chain|logistics|rerout|stranded)';
  /* 咽喉点档案（事实与前端 CHOKEPOINTS 同源；risk 为档案静态值，动态=近 7d 事件命中） */
  const SC_CHOKES = [
    { key: 'hormuz', name: '霍尔木兹海峡', risk: 7, ents: ['中石油', '中石化'], re: /(霍尔木兹|Hormuz)/, impact: '全球约 20% 石油运输要道，封锁将冲击能源运输' },
    { key: 'babelmandeb', name: '红海-曼德海峡', risk: 9.5, ents: ['中远海运', '招商局'], re: /(红海|曼德|胡塞|也门袭击|Red Sea|Bab el-Mandeb|Houthi)/, impact: '亚欧集装箱主通道，袭击即触发绕行好望角（运价↑、交期+7~14 天）' },
    { key: 'suez', name: '苏伊士运河', risk: 7.5, ents: ['中远海运'], re: /(苏伊士|Suez)/, impact: '受红海局势联动，通行量下降传导欧亚航线运力' },
    { key: 'malacca', name: '马六甲海峡', risk: 5.5, ents: ['中远海运', '中石油'], re: /(马六甲|Malacca)/, impact: '中国约 80% 能源进口经此通道' },
    { key: 'panama', name: '巴拿马运河', risk: 4, ents: ['中远海运'], re: /(巴拿马运河|Panama Canal)/, impact: '干旱/通行管制时太平洋航线延误' },
    { key: 'arctic', name: '北极航道', risk: 5, ents: ['中远海运'], re: /(北极航道|Arctic (?:route|passage))/, impact: '新兴战略通道，基础设施与地缘博弈并存' }
  ];
  const SC_CORRIDORS = [
    { key: 'cpec', name: '中巴经济走廊', countries: ['巴基斯坦'], ents: 5, inv: 62 },
    { key: 'cmec', name: '中缅经济走廊', countries: ['缅甸'], ents: 4, inv: 19 },
    { key: 'chinaeu', name: '中欧班列通道', countries: ['俄罗斯', '哈萨克斯坦', '波兰', '德国'], ents: 3, inv: 30 },
    { key: 'laosrail', name: '中老铁路走廊', countries: ['老挝'], ents: 2, inv: 17 },
    { key: 'jakartahsr', name: '雅万高铁走廊', countries: ['印度尼西亚'], ents: 3, inv: 16 },
    { key: 'piraeus', name: '比雷埃夫斯港走廊', countries: ['希腊', '塞尔维亚'], ents: 3, inv: 16 }
  ];
  let _scCache = null, _scCacheAt = 0;
  async function _scLoad() {
    if (_scCache && Date.now() - _scCacheAt < 300000) return _scCache;
    const { rows } = await q(
      `SELECT id, data_type, title, country, severity, source, collect_time, data_json,
              COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
       FROM intel_data
       WHERE collect_time >= NOW() - INTERVAL '30 days' AND audit_status='approved' AND ${FRESH}
         AND (COALESCE(NULLIF(data_json->>'title_zh',''), title) ~ '${SC_KW}' OR title ~ '${SC_KW}')
       ORDER BY collect_time DESC LIMIT 2000`, []);
    const evs = rows.map(_icEvObj);
    const now = Date.now();
    const chokes = SC_CHOKES.map(c => {
      const hit = evs.filter(e => c.re.test(e.title) || c.re.test(e.rawTitle));
      const d7 = hit.filter(e => now - Date.parse(String(e.time).replace(' ', 'T') + '+08:00') < 7 * 86400000 || now - _evTs(e._r) < 7 * 86400000);
      const prev7 = hit.filter(e => { const a = now - _evTs(e._r); return a >= 7 * 86400000 && a < 14 * 86400000; });
      return {
        key: c.key, name: c.name, risk: c.risk, ents: c.ents, impact: c.impact,
        events30d: hit.length, events7d: d7.length, prev7d: prev7.length,
        red7d: d7.filter(e => e.level === 'red').length,
        china7d: d7.filter(e => e.china).length,
        trend: d7.length > prev7.length ? 'up' : d7.length < prev7.length ? 'down' : 'flat',
        hot: d7.length >= 3 || d7.some(e => e.level === 'red'),
        samples: d7.slice(0, 3).map(e => ({ id: e.id, title: e.title.slice(0, 70), level: e.level, time: String(e.time).slice(0, 16), url: e.url }))
      };
    });
    const corridors = SC_CORRIDORS.map(c => {
      const hit = evs.filter(e => c.countries.includes(e.country));
      const d7 = hit.filter(e => now - _evTs(e._r) < 7 * 86400000);
      return {
        key: c.key, name: c.name, countries: c.countries.join('/'), ents: c.ents, inv: c.inv,
        events30d: hit.length, events7d: d7.length,
        red7d: d7.filter(e => e.level === 'red').length,
        china7d: d7.filter(e => e.china).length,
        hot: d7.length >= 5 || d7.some(e => e.level === 'red'),
        samples: d7.slice(0, 2).map(e => ({ id: e.id, title: e.title.slice(0, 70), level: e.level, time: String(e.time).slice(0, 16), url: e.url }))
      };
    });
    /* 受影响中资项目（同国别匹配：走廊国 + 咽喉点事件国） */
    const bases = await _icLoadBases();
    const hotCountries = new Set();
    chokes.forEach(c => { if (c.hot) c.samples.forEach(s => hotCountries.add(s.title)); });
    corridors.filter(c => c.hot).forEach(c => c.countries.split('/').forEach(x => hotCountries.add(x)));
    const exposed = [];
    bases.dbProj.concat(bases.regProj).forEach(p => {
      if (p.country && hotCountries.has(p.country)) exposed.push(p);
    });
    const byCountry = {};
    evs.forEach(e => { if (e.country) byCountry[e.country] = (byCountry[e.country] || 0) + 1; });
    const out = {
      ok: true, generatedAt: _nowCn(), window: '30d',
      stats: {
        total30d: evs.length,
        total7d: evs.filter(e => now - _evTs(e._r) < 7 * 86400000).length,
        red30d: evs.filter(e => e.level === 'red').length,
        china30d: evs.filter(e => e.china).length,
        hotChokes: chokes.filter(c => c.hot).length,
        hotCorridors: corridors.filter(c => c.hot).length
      },
      chokes, corridors,
      topCountries: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => ({ country: x[0], n: x[1] })),
      exposedProjects: exposed.slice(0, 30).map(p => ({ name: p.name, enterprise: p.enterprise, country: p.country, sector: p.sector, invTxt: p.invTxt || '—', personnel: p.personnel || '—' })),
      events: evs.filter(e => e.level === 'red' || e.china).slice(0, 30).map(e => ({ id: e.id, title: e.title.slice(0, 80), country: e.country, level: e.level, china: e.china, time: String(e.time).slice(0, 16), url: e.url, source: e.source }))
    };
    _scCache = out; _scCacheAt = Date.now();
    return out;
  }
  router.get('/supply-chain', async (req, res) => {
    try { res.json(await _scLoad()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* #747 单咽喉点/走廊 AI 传导链研判（150s 超时 + 10min 缓存 + in-flight 合并 + 规则回落） */
  const _scAiCache = new Map(), _scAiBusy = new Map();
  function _scAiFallback(unit, evs) {
    const dir = unit.events7d > unit.prev7d ? '上升' : unit.events7d < unit.prev7d ? '回落' : '持平';
    const chain = '【传导链】' + unit.name + '近 30 天命中中断类事件 ' + unit.events30d + ' 条（近 7 天 ' + (unit.events7d != null ? unit.events7d : unit.events30d) + ' 条、红级 ' + (unit.red7d || 0) + ' 条、涉华 ' + (unit.china7d || 0) + ' 条，密度较前 7 天' + dir + '）。一级传导（运输层）：' + (unit.impact || '通道通行受阻') + '；二级传导（贸易层）：运价上行与交期延长，高时效货物（电子、生鲜、合同违约敏感件）率先承压；三级传导（项目层）：依赖该通道进口物资/设备的中资海外项目施工节奏与成本预算受压，需评估替代路线与提前备货。';
    const pred = '【中断概率】短期（7 天）：' + (unit.hot ? '中高——通道处于活跃事件窗口，保持逐日跟踪' : '低——事件密度处于基线水平') + '。中期（30 天）：取决于驻在国局势与航运公司绕行决策；若红级事件再现或出现中方船只直接卷入，上调一级。观察信号：① 72 小时内同类事件新增量；② 主要班轮公司是否公告绕行/停航；③ 驻在国政府/军方对通道通行表态。';
    const act = '【建议动作】一是对经' + unit.name + '的在建项目物资排程做压力测试，关键设备识别替代路线（好望角/中欧班列/空运）并测算交期增量；二是与航运代理建立运价周报机制，锁定中长期舱位对冲即期涨价；三是涉通道船舶投保战争险条款复核；四是把该通道列入供应链专项监测清单，红级事件即触发项目层重排产评估。';
    return { ok: true, llmOk: false, chain, prediction: pred, actions: act, generatedAt: _nowCn(), note: '大模型暂不可用，本段为规则模板装配（事件数/红级/涉华/密度趋势全部引用真实库统计）；链路恢复后自动升级 Kimi 参谋级研判。' };
  }
  router.post('/supply-chain/ai', async (req, res) => {
    try {
      const p = req.body || {};
      const key = 'sc:' + String(p.name || '').slice(0, 40);
      if (!p.name) return res.status(400).json({ ok: false, error: '缺少通道/走廊名称' });
      const cached = _scAiCache.get(key);
      if (cached && Date.now() - cached.at < 600000) return res.json(cached.data);
      if (_scAiBusy.has(key)) return res.json(await _scAiBusy.get(key));
      const job = (async () => {
        const sc = await _scLoad();
        const unit = sc.chokes.find(c => c.name === p.name) || sc.corridors.find(c => c.name === p.name);
        if (!unit) throw Object.assign(new Error('未找到通道/走廊：' + p.name), { statusCode: 404 });
        const evs = (unit.samples || []).map(s => s.title);
        if (!llmCall) return Object.assign({ unit }, _scAiFallback(unit, evs));
        const pv = reportsEngine._test.pvKimi();
        const sys = '你是海外利益保护情报预警平台的首席供应链情报参谋，执行「通道中断→供应链传导」专项研判。严格按以下三段格式输出，段首标记逐字一致：【传导链】从运输层→贸易层→项目层逐级写清传导机制与时效，落到中资海外项目；【中断概率】给出短期 7 天/中期 30 天两档判断与观察信号（逐条编号）；【建议动作】3-5 条，每条以「一是/二是」开头，具体可执行（替代路线、舱位锁定、战争险、排产重评）。全部基于给定真实统计外推，禁止编造事件与数字；信息不足写「样本不足」。';
        const usr = '【通道/走廊档案】' + unit.name + '：' + (unit.impact || '') + '\n【真实库统计（30 天窗口）】命中中断类事件 ' + unit.events30d + ' 条；近 7 天 ' + (unit.events7d != null ? unit.events7d : '—') + ' 条（红级 ' + (unit.red7d || 0) + '，涉华 ' + (unit.china7d || 0) + '）。\n【近 7 天代表事件】\n' + (evs.map((t, i) => (i + 1) + '. ' + t).join('\n') || '（近 7 天无代表事件）') + '\n请输出三段式供应链传导研判。';
        try {
          const r = await Promise.race([llmCall(pv, sys, usr), new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT_150s')), 150000))]);
          if (r && r.text && String(r.text).length > 250) {
            const txt = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            const cB = String(txt.split(/【传导链】/)[1] || '').split(/【中断概率】/)[0].trim();
            const pB = String(txt.split(/【中断概率】/)[1] || '').split(/【建议动作】/)[0].trim();
            const aB = String(txt.split(/【建议动作】/)[1] || '').trim();
            if (cB.length > 80 && aB.length > 40) {
              return Object.assign({ unit }, { ok: true, llmOk: true, chain: cB, prediction: pB, actions: aB, generatedAt: _nowCn(), note: 'Kimi 大模型基于真实通道档案与库内中断事件统计生成；研判为模型外推，事实以事件原文链接为准；按通道 10 分钟缓存。' });
            }
          }
        } catch (e) { console.warn('[INSIGHT] supply-chain-ai LLM 失败，回落规则模板:', e.message); }
        return Object.assign({ unit }, _scAiFallback(unit, evs));
      })();
      _scAiBusy.set(key, job);
      try { const out = await job; _scAiCache.set(key, { at: Date.now(), data: out }); res.json(out); }
      finally { _scAiBusy.delete(key); }
    } catch (e) {
      const sc = e && e.statusCode ? e.statusCode : 500;
      res.status(sc).json({ ok: false, error: e.message });
    }
  });

  /* ============================================================
   * #748 国别准入壁垒日历 — GET /api/insight/barrier-calendar
   * 贸易救济（反倾销/反补贴/关税）× 出口管制 × 投资审查 × 制裁清单
   * 按国别×日历聚合（60d），涉华标记 + 国别×类别矩阵 + 14 天前瞻跟踪。零模拟。
   * ============================================================ */
  const BC_CATS = [
    { key: 'trade_remedy', name: '贸易救济', re: /(反倾销|反补贴|保障措施|关税|加征|税则|anti-?dumping|countervailing|tariff|duties)/ },
    { key: 'export_control', name: '出口管制', re: /(出口管制|两用物项|技术出口|禁运|export control|dual-?use)/ },
    { key: 'investment_screen', name: '投资审查', re: /(投资审查|外资安全|国家安全审查|并购审查|投资限制|investment screen|CFIUS|FDI)/ },
    { key: 'sanctions', name: '制裁与清单', re: /(制裁|实体清单|黑名单|未经验证|制裁名单|sanction|entity list|blacklist|embargo|SDN)/ }
  ];
  const BC_KW_ALL = BC_CATS.map(c => c.re.source).join('|');
  let _bcCache = null, _bcCacheAt = 0;
  async function _bcLoad() {
    if (_bcCache && Date.now() - _bcCacheAt < 300000) return _bcCache;
    const { rows } = await q(
      `SELECT id, data_type, title, country, severity, source, collect_time, event_date, data_json,
              COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
       FROM intel_data
       WHERE collect_time >= NOW() - INTERVAL '60 days' AND audit_status='approved' AND ${FRESH}
         AND (COALESCE(NULLIF(data_json->>'title_zh',''), title) ~ '${BC_KW_ALL}' OR title ~ '${BC_KW_ALL}')
       ORDER BY collect_time DESC LIMIT 3000`, []);
    const evs = rows.map(_icEvObj).map(e => {
      const cat = BC_CATS.find(c => c.re.test(e.title) || c.re.test(e.rawTitle));
      return Object.assign(e, { cat: cat ? cat.key : '', catName: cat ? cat.name : '其他壁垒' });
    }).filter(e => e.cat);
    /* 日历（按天 × 类别） */
    const cal = {};
    evs.forEach(e => {
      const d = String(e.time).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      if (!cal[d]) cal[d] = { date: d, n: 0, china: 0, red: 0, cats: {} };
      cal[d].n++; if (e.china) cal[d].china++; if (e.level === 'red') cal[d].red++;
      cal[d].cats[e.cat] = (cal[d].cats[e.cat] || 0) + 1;
    });
    /* 国别 × 类别矩阵 */
    const matrix = {};
    evs.forEach(e => {
      const c = e.country || '未知';
      if (!matrix[c]) matrix[c] = { country: c, trade_remedy: 0, export_control: 0, investment_screen: 0, sanctions: 0, total: 0, china: 0, red: 0 };
      matrix[c][e.cat]++; matrix[c].total++; if (e.china) matrix[c].china++; if (e.level === 'red') matrix[c].red++;
    });
    const chinas = evs.filter(e => e.china);
    const out = {
      ok: true, generatedAt: _nowCn(), window: '60d',
      stats: {
        total: evs.length, china: chinas.length, red: evs.filter(e => e.level === 'red').length,
        countries: Object.keys(matrix).length,
        byCat: BC_CATS.map(c => ({ key: c.key, name: c.name, n: evs.filter(e => e.cat === c.key).length }))
      },
      calendar: Object.values(cal).sort((a, b) => b.date.localeCompare(a.date)),
      matrix: Object.values(matrix).sort((a, b) => b.total - a.total).slice(0, 20),
      chinaList: chinas.slice(0, 30).map(e => ({ id: e.id, title: e.title.slice(0, 80), country: e.country, cat: e.catName, level: e.level, time: String(e.time).slice(0, 16), url: e.url, source: e.source })),
      recent: evs.slice(0, 40).map(e => ({ id: e.id, title: e.title.slice(0, 80), country: e.country, cat: e.catName, level: e.level, china: e.china, time: String(e.time).slice(0, 16), url: e.url }))
    };
    _bcCache = out; _bcCacheAt = Date.now();
    return out;
  }
  router.get('/barrier-calendar', async (req, res) => {
    try { res.json(await _bcLoad()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============================================================
   * #749 撤离与应急方案自动生成 — POST /api/insight/evac-plan
   * body={country, projectId?} → 同国在册项目档案 + 近 14d 红级事件 + 30d 事件统计
   * → LLM 五段式撤离预案（形势研判/撤离分级/路线与交通/驻留保障/联络机制），
   * 150s 超时 + 10min 缓存 + in-flight 合并 + 规则回落（引用真实项目/事件，零模拟）。
   * ============================================================ */
  const _evCache = new Map(), _evBusy = new Map();
  function _evFallback(country, ctx) {
    const ps = ctx.projects || [];
    const entStr = Array.from(new Set(ps.map(p => p.enterprise))).slice(0, 4).join('、') || '—';
    const situ = '【形势研判】' + country + '近 30 天入库事件 ' + ctx.total30d + ' 条（近 14 天红级 ' + ctx.red14d + ' 条、涉华 ' + ctx.china14d + ' 条）。在册中资项目 ' + ps.length + ' 个（涉及 ' + entStr + ' 等，账面投资合计约 ' + ctx.investment + ' 亿美元、注册表口径驻外人员约 ' + ctx.personnel + ' 人）。' + (ctx.red14d >= 3 ? '红级事件密度高，建议进入撤离预备状态。' : ctx.red14d >= 1 ? '存在红级事件，建议按条件撤离准备执行。' : '红级事件稀少，建议维持常态应急戒备。');
    const lvl = '【撤离分级】一级（建议撤离）：非必要人员及家属先行转移；二级（准备撤离）：关键岗位轮换压缩至最小运营单元，证件物资预置；三级（就地避险）：全员营地集结令演练，避难所路线熟悉。当前建议档位：' + (ctx.red14d >= 5 ? '一级' : ctx.red14d >= 1 ? '二级' : '三级') + '（依据近 14 天红级 ' + ctx.red14d + ' 条真实事件密度）。';
    const route = '【撤离路线与交通】以最近国际机场/口岸为主通道、陆路邻国口岸为备份通道（具体口岸以国别应急指南真实档案为准）；包机/商业航班并行评估，撤离车队按 3 车编组（前导警戒/人员/物资）昼间机动；路线避开事件聚集区（近 14 天红级事件分布见下）。';
    const stay = '【驻留与保障】最小运营单元预置 30 天水、食品、燃油与医药物资；营地安防加固（外围警戒/门禁双人制/通信冗余：卫星电话+本地双运营商）；现金与关键证照随身化管理制度。';
    const comm = '【联络与应急机制】撤离指挥长—安全官—后勤官三级指挥链定人定责；与中国驻' + country + '使领馆报备人员名册并保持 24h 联络（外交部全球领保热线 +86-10-12308 兜底）；每 4 小时全员点名一次，撤离期间提升至每 2 小时。';
    return { ok: true, llmOk: false, situ, level: lvl, route, stay, comm, generatedAt: _nowCn(), note: '大模型暂不可用，本段为规则模板装配（项目/投资/人员/红级事件密度全部引用真实库与注册表档案）；链路恢复后自动升级 Kimi 参谋级预案（10 分钟缓存周期后重试）。' };
  }
  router.post('/evac-plan', async (req, res) => {
    try {
      const p = req.body || {};
      const country = String(p.country || '').trim();
      if (!country) return res.status(400).json({ ok: false, error: '缺少国别参数' });
      const key = 'evac:' + country + ':' + String(p.projectId || '');
      const cached = _evCache.get(key);
      if (cached && Date.now() - cached.at < 600000) return res.json(cached.data);
      if (_evBusy.has(key)) return res.json(await _evBusy.get(key));
      const job = (async () => {
        const bases = await _icLoadBases();
        let projects = bases.dbProj.concat(bases.regProj).filter(b => b.country === country);
        if (p.projectId) {
          const one = projects.find(b => String(b.name).includes(String(p.projectId)));
          if (one) projects = [one];
        }
        const agg = await q(`SELECT COUNT(*)::int total30d,
            COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days')::int total14d,
            COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND severity='red')::int red14d,
            COUNT(*) FILTER (WHERE collect_time >= NOW() - INTERVAL '14 days' AND severity='orange')::int orange14d
          FROM intel_data WHERE country=$1 AND collect_time >= NOW() - INTERVAL '30 days' AND audit_status='approved' AND ${FRESH}`, [country]);
        const reds = await q(`SELECT id, data_type, title, severity, collect_time, data_json,
              COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
          FROM intel_data WHERE country=$1 AND severity IN ('red','orange') AND collect_time >= NOW() - INTERVAL '14 days' AND audit_status='approved' AND ${FRESH}
          ORDER BY collect_time DESC LIMIT 6`, [country]);
        const chinaAgg = await q(`SELECT COUNT(*)::int n FROM intel_data WHERE country=$1 AND collect_time >= NOW() - INTERVAL '14 days' AND audit_status='approved' AND ${FRESH}`, [country]);
        const ctx = {
          total30d: agg.rows[0].total30d, total14d: agg.rows[0].total14d,
          red14d: agg.rows[0].red14d, orange14d: agg.rows[0].orange14d,
          china14d: chinaAgg.rows[0].n, projects,
          investment: Math.round(projects.reduce((s, x) => s + (x.investment || 0), 0)),
          personnel: projects.reduce((s, x) => s + (x.personnel || 0), 0),
          redEvents: reds.rows.map(_icEvObj)
        };
        let data;
        if (!llmCall) {
          data = _evFallback(country, ctx);
        } else {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是海外利益保护情报预警平台的首席应急处置参谋，执行「驻外人员与项目撤离应急预案」生成任务。严格按以下五段格式输出，段首标记逐字一致：【形势研判】基于给定的真实事件统计与项目档案给出现场形势判断；【撤离分级】给出一级建议撤离/二级准备撤离/三级就地避险三档定义，并依据真实红级事件密度明确当前建议档位与依据；【撤离路线与交通】主通道+备份通道+编队原则（信息不足写「以使领馆指引为准」）；【驻留与保障】最小运营单元物资/安防/通信冗余要求；【联络与应急机制】指挥链、使领馆报备、点名节奏（明确小时数）。全部基于给定真实数据外推，禁止编造事件与数字。';
          const usr = '【国别】' + country + '\n【真实库统计（近 30 天）】事件 ' + ctx.total30d + ' 条；近 14 天 ' + ctx.total14d + ' 条（红级 ' + ctx.red14d + ' 条、橙级 ' + ctx.orange14d + ' 条）。\n【近 14 天红/橙级代表事件（真实采集）】\n' + (ctx.redEvents.map((e, i) => (i + 1) + '. [' + (e.level === 'red' ? '红' : '橙') + '] ' + e.title.slice(0, 60) + '（' + String(e.time).slice(0, 10) + '）').join('\n') || '（无）') + '\n\n【在册中资项目档案（真实）】\n' + (projects.map((x, i) => (i + 1) + '. ' + x.name + '（' + x.enterprise + '，' + (x.location || x.country) + '，' + x.sector + (x.invTxt ? '，投资' + x.invTxt : '') + (x.personnel ? '，人员' + x.personnel + '人' : '') + '）').join('\n') || '（无在册项目档案）') + '\n汇总：项目 ' + projects.length + ' 个，账面投资合计约 ' + ctx.investment + ' 亿美元，注册表口径驻外人员约 ' + ctx.personnel + ' 人。\n请输出五段式撤离应急预案。';
          try {
            const r = await Promise.race([llmCall(pv, sys, usr), new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT_150s')), 150000))]);
            if (r && r.text && String(r.text).length > 400) {
              const txt = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
              const cut = (h) => String(txt.split(h)[1] || '').split(/【/)[0].trim();
              const situ = cut('【形势研判】'), level = cut('【撤离分级】'), route = cut('【撤离路线与交通】'), stay = cut('【驻留与保障】'), comm = cut('【联络与应急机制】');
              if (situ.length > 60 && level.length > 40) {
                data = { ok: true, llmOk: true, situ, level, route: route || '（以使领馆指引为准）', stay, comm, generatedAt: _nowCn(), note: 'Kimi 大模型基于真实事件统计与项目档案生成；预案为模型推演，执行以使领馆与现场指挥为准；按国别 10 分钟缓存。' };
              }
            }
          } catch (e) { console.warn('[INSIGHT] evac-plan LLM 失败，回落规则模板:', e.message); }
          if (!data) data = _evFallback(country, ctx);
        }
        return Object.assign({
          country,
          ctxStats: { total30d: ctx.total30d, total14d: ctx.total14d, red14d: ctx.red14d, orange14d: ctx.orange14d, china14d: ctx.china14d, projCount: projects.length, investment: ctx.investment, personnel: ctx.personnel },
          projects: projects.slice(0, 20).map(x => ({ name: x.name, enterprise: x.enterprise, location: x.location, sector: x.sector, invTxt: x.invTxt || '', personnel: x.personnel || 0 })),
          redEvents: ctx.redEvents.map(e => ({ id: e.id, title: e.title.slice(0, 70), level: e.level, time: String(e.time).slice(0, 16), url: e.url }))
        }, data);
      })();
      _evBusy.set(key, job);
      try { const out = await job; _evCache.set(key, { at: Date.now(), data: out }); res.json(out); }
      finally { _evBusy.delete(key); }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /* ============================================================
   * #750 境外社媒舆情监测 — GET /api/insight/social-pulse
   * 库内社媒通道（social_media TG/Reddit 采集 + socmint_watch 哨兵）7d 聚合：
   * 平台/频道分布、国别分布、涉华占比、红级数、日趋势、涉华舆情流 TOP。
   * 零模拟：库内有多少算多少，通道不可达即如实为 0。
   * ============================================================ */
  let _spCache = null, _spCacheAt = 0;
  async function _spLoad() {
    if (_spCache && Date.now() - _spCacheAt < 120000) return _spCache;
    const { rows } = await q(
      `SELECT id, data_type, title, country, severity, source, collect_time, data_json,
              COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
       FROM intel_data
       WHERE collect_time >= NOW() - INTERVAL '7 days' AND audit_status='approved'
         AND (COALESCE(data_json->>'_sourceType','') IN ('social_media','socmint_watch')
              OR data_type='socmint_intel')
       ORDER BY collect_time DESC LIMIT 1500`, []);
    const evs = rows.map(r => {
      const j = r.data_json || {};
      const e = _icEvObj(r);
      e.platform = String(j.social_platform || (String(r.source).includes('Reddit') ? 'reddit' : j._sourceType === 'socmint_watch' ? 'mastodon' : 'telegram'));
      return e;
    });
    const byPlat = {}, byChan = {}, byCountry = {}, byDay = {};
    evs.forEach(e => {
      byPlat[e.platform] = (byPlat[e.platform] || 0) + 1;
      byChan[e.source] = (byChan[e.source] || 0) + 1;
      const c = e.country || '未知';
      byCountry[c] = (byCountry[c] || 0) + 1;
      const d = String(e.time).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        if (!byDay[d]) byDay[d] = { date: d, n: 0, china: 0, red: 0 };
        byDay[d].n++; if (e.china) byDay[d].china++; if (e.level === 'red') byDay[d].red++;
      }
    });
    const chinas = evs.filter(e => e.china);
    const out = {
      ok: true, generatedAt: _nowCn(), window: '7d',
      stats: {
        total: evs.length, china: chinas.length,
        red: evs.filter(e => e.level === 'red').length,
        orange: evs.filter(e => e.level === 'orange').length,
        platforms: Object.keys(byPlat).length, channels: Object.keys(byChan).length,
        chinaPct: evs.length ? Math.round(chinas.length / evs.length * 100) : 0
      },
      byPlatform: Object.entries(byPlat).sort((a, b) => b[1] - a[1]).map(x => ({ platform: x[0], n: x[1] })),
      byChannel: Object.entries(byChan).sort((a, b) => b[1] - a[1]).slice(0, 20).map(x => ({ channel: x[0], n: x[1] })),
      byCountry: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => ({ country: x[0], n: x[1] })),
      byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
      chinaFeed: chinas.slice(0, 30).map(e => ({ id: e.id, title: e.title.slice(0, 90), country: e.country, platform: e.platform, level: e.level, time: String(e.time).slice(0, 16), url: e.url, source: e.source })),
      feed: evs.slice(0, 40).map(e => ({ id: e.id, title: e.title.slice(0, 90), country: e.country, platform: e.platform, level: e.level, china: e.china, time: String(e.time).slice(0, 16), url: e.url, source: e.source }))
    };
    _spCache = out; _spCacheAt = Date.now();
    return out;
  }
  router.get('/social-pulse', async (req, res) => {
    try { res.json(await _spLoad()); } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
};
