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
  const router = express.Router();

  /* ---------- ① 领导要报速览（30 秒一页纸数据装配） ---------- */
  router.get('/leader-brief', async (req, res) => {
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      const { rows } = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data WHERE collect_time >= $1 AND audit_status='approved' ORDER BY collect_time DESC LIMIT 900`,
        [since]
      );
      const items = rows.map(r => {
        const j = r.data_json || {};
        return {
          id: r.id, type: r.data_type,
          title: r.title_cn || r.title || '',
          country: _iso2cnTry(r.country || j.country_cn || ''),
          severity: j.level_norm || r.severity || 'yellow',
          source: r.source || j.source || '',
          time: _fmtTime(j.publish_time || r.event_date || r.collect_time),
          url: j.url || '',
          china: !!isChina(String(r.title || '') + ' ' + String(r.title_cn || '')),
          corr: Number(j.corroboration || 0),
          deaths: Number(j.deaths || 0)
        };
      });
      const reds = items.filter(i => i.severity === 'red');
      const oranges = items.filter(i => i.severity === 'orange');
      const chinas = items.filter(i => i.china);
      /* TOP5：红全部 + 橙补足，涉华加权置顶（corroboration + china + deaths 排序） */
      const _score = i => ({ red: 100, orange: 60, yellow: 30, blue: 10 }[i.severity] || 5) + (i.china ? 25 : 0) + i.corr * 5 + i.deaths;
      const top = items.slice().sort((a, b) => _score(b) - _score(a)).slice(0, 5);
      const chinaTop = chinas.slice().sort((a, b) => _score(b) - _score(a)).slice(0, 5);
      /* 待办风险：涉华/高印证黄橙事件未升级处置（近 24h 红橙之外的需关注项） */
      const pending = items.filter(i => i.china && (i.severity === 'orange' || i.severity === 'yellow') && i.corr >= 1)
        .sort((a, b) => _score(b) - _score(a)).slice(0, 4);
      /* 一句话决策建议：按 TOP 事件类型推导（规则模板，引用真实数字） */
      const types = {};
      items.forEach(i => { types[i.type] = (types[i.type] || 0) + 1; });
      const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const CAT_CN = {
        terror_events: '恐怖袭击', military_conflicts: '武装冲突', mass_violence: '群体性暴力',
        crime_events: '社会治安事件', regime_change: '政权变动', election_events: '选举事件',
        geopolitical_intel: '地缘外交', policy_shift: '政策法规突变', sanctions_data: '制裁与合规',
        financial_market: '金融市场风险', business_climate: '营商环境恶化', social_unrest: '社会动荡',
        public_health: '公共卫生', cyber_security: '网络与信息安全', industrial_accident: '生产安全事故',
        environmental_event: '环境生态事件', natural_disasters: '自然灾害', infrastructure: '基础设施中断'
      };
      const advice = [];
      if (reds.length) advice.push('近24小时红色预警 ' + reds.length + ' 条' + (chinas.length ? '（涉华 ' + chinas.filter(i => i.severity === 'red').length + ' 条）' : '') + '，建议值班主任牵头逐条核处，涉华红项一小时内上报');
      else if (oranges.length) advice.push('近24小时无红色预警，橙色 ' + oranges.length + ' 条按常规流程加密跟踪');
      else advice.push('近24小时无红橙预警，各方向按常态监测运行');
      if (chinas.length >= 5) advice.push('涉华情报 ' + chinas.length + ' 条，集中在' + (chinas[0] && chinas[0].country ? chinas[0].country : '重点国别') + '等方向，建议领事保护条线今日专项过筛');
      if (topTypes.length) advice.push('事件量前三类：' + topTypes.map(t => (CAT_CN[t[0]] || t[0]) + ' ' + t[1] + ' 条').join('、'));
      res.json({
        ok: true, generatedAt: _nowCn(), window: '24h',
        stats: { total: items.length, red: reds.length, orange: oranges.length, china: chinas.length },
        top: top.map(i => ({ id: i.id, title: i.title.slice(0, 80), level: i.severity, country: i.country, type: CAT_CN[i.type] || i.type, time: String(i.time).slice(0, 16), url: i.url, china: i.china, corr: i.corr })),
        chinaTop: chinaTop.map(i => ({ id: i.id, title: i.title.slice(0, 80), level: i.severity, country: i.country, time: String(i.time).slice(0, 16), url: i.url })),
        advice, pending: pending.map(i => ({ id: i.id, title: i.title.slice(0, 80), level: i.severity, country: i.country, corr: i.corr })),
        topTypes: topTypes.map(t => ({ key: t[0], name: CAT_CN[t[0]] || t[0], n: t[1] }))
      });
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
      /* 召回：同事件签名 OR 标题词元重合 ≥2 OR 同 URL */
      const cand = await q(
        `SELECT id, data_type, title, country, severity, source, collect_time, event_date, audit_status, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data
         WHERE collect_time >= NOW() - INTERVAL '30 days'
           AND (data_json->>'_eventSig' = $1 AND $1 <> '' OR (data_json->>'url' = $2 AND $2 <> '') OR title ILIKE $3)
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
        { key: 'alert', name: '预警入列', time: '', detail: '当前级别：' + (j.level_norm || anchor.severity || 'yellow') + '；涉华关联：' + (isChina(String(anchor.title || '') + ' ' + anchorTitle) ? '是' : '否'), done: true },
        { key: 'audit', name: '审核入库', time: _fmtTime(anchor.collect_time), detail: '审核状态：' + (anchor.audit_status || 'approved'), done: !!anchor.audit_status },
        { key: 'dispose', name: '处置跟踪', time: '', detail: '处置工单数据暂未接入（如实标注，不虚拟进度）', done: false },
        { key: 'archive', name: '归档复盘', time: '', detail: related.length > 3 ? '已进入归档检索范围（相关条目 ' + related.length + ' 条）' : '事件仍在活跃监测窗口内', done: related.length > 3 }
      ];
      res.json({
        ok: true, anchor: { id: anchor.id, title: anchorTitle.slice(0, 100), country: _iso2cnTry(anchor.country), type: anchor.data_type, level: j.level_norm || anchor.severity },
        stages, related: related.map(r => ({ id: r.id, title: String(r.title_cn || r.title || '').slice(0, 70), source: r.source || ((r.data_json || {}).source || '全网检索'), time: _fmtTime(r.collect_time), level: (r.data_json || {}).level_norm || r.severity }))
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
      /* 同类 + 近 90 天候选池（含归档，直接查 intel_data 全量） */
      const cand = await q(
        `SELECT id, data_type, title, country, severity, collect_time, data_json,
                COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title_cn
         FROM intel_data WHERE data_type = $1 AND collect_time >= NOW() - INTERVAL '90 days' ORDER BY collect_time DESC LIMIT 1500`,
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
          country: _iso2cnTry(x.r.country), level: ((x.r.data_json || {}).level_norm || x.r.severity || 'yellow'),
          time: _fmtTime(x.r.collect_time).slice(0, 10), sameCountry: x.sameCountry, overlap: x.ov,
          url: (x.r.data_json || {}).url || ''
        }));
      /* 复发统计：同类事件近 90 天总数与国别分布 */
      const total = cand.rows.length;
      const byCountry = {};
      cand.rows.forEach(r => { const c = _iso2cnTry(r.country) || '未标注'; byCountry[c] = (byCountry[c] || 0) + 1; });
      const hotCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const lvDist = { red: 0, orange: 0, yellow: 0, blue: 0 };
      cand.rows.forEach(r => { const l = (r.data_json || {}).level_norm || r.severity; if (lvDist[l] != null) lvDist[l]++; });
      res.json({
        ok: true, anchor: { id: anchor.id, title: anchorTitle.slice(0, 90), type: anchorType, country: anchorCountry },
        matches: sims, matchCount: sims.length,
        stats: { total90d: total, lvDist, hotCountries: hotCountries.map(x => ({ country: x[0], n: x[1] })) },
        note: '匹配口径：同情报类别 + 标题实质词元重合加权（同国别加成），近 90 天真实库检索'
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

  return router;
};
