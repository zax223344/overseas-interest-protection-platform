/* ============================================================
 * server/terror-center.js — 全球恐袭态势监测中心（#672 / #681 改名）
 * ================================================================
 * 设计定位（2026-09-07 用户指令，16:12 口径）：
 *   「不要用搜集的设计，用数据库或实时情报流」——本中心是**常开雷达（always-on）**：
 *   打开页面即呈现全景，数据 100% 来自既有数据库聚合（intel_data / terror_events），
 *   与 threatroom（实体触发专项采集）彻底差异化，零用户输入、零采集动作。
 *   #681（2026-09-07 18:43 用户口径）：侧栏与标题改名「全球恐袭态势监测中心」；
 *   组织档案分类纠错（阿富汗塔利班/HTS/胡塞→执政当局；武装力量/政治力量分级），
 *   THREAT_DATA 支持 matchExclude 字段防止名称相近组织（阿塔 vs TTP）交叉误归因。
 *
 * 三端点：
 *   ① GET /api/terror/overview  全景态势（KPI + 30天日度态势带 + 国别热度 + 级别金字塔
 *      + 红橙24h预警 + 最新情报流）。研判口径 = 恐怖词元过滤（terror_events 上游分类有噪声），
 *      同时报 rawCount 保持透明。
 *   ② GET /api/terror/orgs      组织活跃度雷达：威胁实体档案（#687 起 83 家，剔除执政当局与国家武装力量）× 近14天
 *      情报流标题自动碰撞 → 活跃度指数（红4/橙3/黄2/蓝1加权）+ 近7日vs前7日环比异动
 *      + 活动地域与档案 operatingRegions 印证。#687：仅移出执政当局（阿富汗塔利班/HTS/胡塞）
 *      与国家武装力量（IRGC）4 家，83 家在榜。
 *   ③ GET /api/terror/judge     AI 智库研判（scope=global|org&id=）：真实统计装配 →
 *      Kimi 大模型（失败回落规则模板，引用真实库数字，零虚构）→
 *      govdoc.renderGovHtml 红头《反恐态势通报》/《组织动态研判专报》。
 * 挂载：server.js 两行（require + app.use('/api/terror', terrorCenter(ctx))）。
 * ============================================================ */
'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const scrapers = require('./scrapers');
const reportsEngine = require('./reports-engine');

/* ---------- 研判口径：恐怖词元过滤层 ---------- */
/* 强信号词：命中即判为恐袭/恐组相关（即使有噪声词也不否决） */
const _STRONG_RE = /(恐袭|恐怖|武装分子|武装袭击|圣战|自杀式|人质|劫持|绑架|斩首|枪手|枪战|伏击|屠杀|极端组织|极端分子|汽车炸弹|路边炸弹|土制炸弹|简易爆炸|无人机袭击|火箭弹袭击|militant|jihad|hostage|kidnap|gunmen|ambush|massacre|extremist|insurgent|behead|car bomb|suicide bomb|suicide attack|armed attack|terror)/i;
/* 弱信号词：单独命中可能为事故/演练噪声 */
const _WEAK_RE = /(袭击|爆炸|枪击|突袭|炸弹|attack|attacks|blast|bomb|gunshot|assault|raid|rocket|mortar|grenade|shelling|IED)/i;
/* 噪声词：事故/演练/体育语境（配合强信号豁免） */
const _NOISE_RE = /(起火|火灾|倒塌|坍塌|事故|车祸|演习|训练|演练|选拔赛|联赛|锦标赛|友谊赛|fire\b|blaze|collapse|accident|drill|tournament|championship)/i;
function _isTerrorRelevant(title) {
  const t = String(title || '');
  if (!t) return false;
  if (_STRONG_RE.test(t)) return true;
  if (_WEAK_RE.test(t) && !_NOISE_RE.test(t)) return true;
  return false;
}

/* ---------- 级别归一：severity 脏值，level_norm 优先，非四色回落 yellow ---------- */
function _lv(levelNorm, sev) {
  const l = String(levelNorm || sev || 'yellow').toLowerCase();
  return ['red', 'orange', 'yellow', 'blue'].includes(l) ? l : 'yellow';
}
const _LV_W = { red: 4, orange: 3, yellow: 2, blue: 1 };

/* ---------- 时间工具：禁 toISOString（UTC 错位），全部本地时区 ---------- */
function _fmtTime(t) {
  if (t == null || t === '') return '';
  const d = (t instanceof Date) ? t : new Date(String(t).replace('T', ' '));
  if (isNaN(d.getTime())) return String(t).slice(0, 16).replace('T', ' ');
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function _dayKey(t) { return _fmtTime(t).slice(0, 10); }
function _nowCn() {
  const n = new Date();
  return n.getFullYear() + '年' + (n.getMonth() + 1) + '月' + n.getDate() + '日 ' +
    String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
}
function _localMidnight(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (daysAgo || 0));
  return d;
}

/* ---------- 国名归一（英文→中文） ---------- */
const _COUNTRY_CN = {
  'United States': '美国', 'United Kingdom': '英国', 'Russia': '俄罗斯', 'Ukraine': '乌克兰',
  'Pakistan': '巴基斯坦', 'Afghanistan': '阿富汗', 'India': '印度', 'Nigeria': '尼日利亚',
  'Iraq': '伊拉克', 'Syria': '叙利亚', 'Yemen': '也门', 'Somalia': '索马里', 'Mali': '马里',
  'Niger': '尼日尔', 'Burkina Faso': '布基纳法索', 'Mozambique': '莫桑比克', 'Kenya': '肯尼亚',
  'Ethiopia': '埃塞俄比亚', 'Sudan': '苏丹', 'Egypt': '埃及', 'Libya': '利比亚',
  'Democratic Republic of the Congo': '刚果（金）', 'DR Congo': '刚果（金）', 'Congo': '刚果',
  'Philippines': '菲律宾', 'Indonesia': '印度尼西亚', 'Thailand': '泰国', 'Myanmar': '缅甸',
  'Bangladesh': '孟加拉国', 'Iran': '伊朗', 'Israel': '以色列', 'Palestine': '巴勒斯坦',
  'Lebanon': '黎巴嫩', 'Turkey': '土耳其', 'Türkiye': '土耳其', 'France': '法国',
  'Germany': '德国', 'Saudi Arabia': '沙特阿拉伯', 'Cameroon': '喀麦隆', 'Chad': '乍得',
  'Colombia': '哥伦比亚', 'Mexico': '墨西哥', 'Algeria': '阿尔及利亚', 'Tunisia': '突尼斯'
};
function _iso2cnTry(c) {
  if (!c) return '';
  if (/[一-龥]/.test(c)) return c;
  return _COUNTRY_CN[String(c).trim()] || c;
}

/* ---------- THREAT_DATA 提取：threats.js 尾部含浏览器渲染代码，不能整体 require，
 * 用括号平衡扫描提取 `const THREAT_DATA={...}` 字面量（inStr 字符串态 + \\ 跳义） ---------- */
let _threatCache = { mtime: 0, orgs: null };
function _loadThreatOrgs() {
  try {
    const fp = path.join(__dirname, '..', 'threats.js');
    const st = fs.statSync(fp);
    if (_threatCache.orgs && _threatCache.mtime === st.mtimeMs) return _threatCache.orgs;
    const src = fs.readFileSync(fp, 'utf8');
    const start = src.indexOf('const THREAT_DATA=');
    if (start < 0) return [];
    let i = src.indexOf('{', start), depth = 0, inStr = false, strCh = '';
    for (; i < src.length; i++) {
      const ch = src[i];
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === strCh) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    const data = new Function('return ' + src.slice(src.indexOf('{', start), i))();
    const orgs = (data && data.organizations) || [];
    _threatCache = { mtime: st.mtimeMs, orgs };
    return orgs;
  } catch (e) {
    console.warn('[TERROR] THREAT_DATA 提取失败:', e.message);
    return _threatCache.orgs || [];
  }
}

/* ---------- 组织别名匹配器：短拉丁别名（≤5字符）走词边界正则防误中，其余小写包含 ---------- */
function _buildMatcher(aliases) {
  const pats = [];
  (aliases || []).forEach(a => {
    a = String(a || '').trim();
    if (!a) return;
    if (/^[A-Za-z0-9 .&/-]{2,5}$/.test(a)) {
      pats.push(new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'));
    } else {
      pats.push(a.toLowerCase());
    }
  });
  return title => {
    const low = String(title || '').toLowerCase();
    return pats.some(p => (p instanceof RegExp) ? p.test(title) : low.includes(p));
  };
}

module.exports = function terrorCenter(ctx) {
  const q = ctx.query;
  const isChina = ctx.isChinaRelated || scrapers.isChinaRelatedStrict;
  const llmCall = (ctx.llm && ctx.llm.callMsg) || null;
  const router = express.Router();

  /* 拉取近 N 天 terror_events 原始行（统一字段口径） */
  async function _fetchRows(days, limit) {
    const since = _localMidnight(days);
    const { rows } = await q(
      `SELECT id, title, country, location, severity, source, collect_time,
              COALESCE(NULLIF(data_json->>'title_zh',''), '') AS title_zh,
              data_json->>'level_norm' AS level_norm,
              COALESCE(NULLIF(data_json->>'url',''), '') AS url,
              COALESCE(NULLIF(data_json->>'description_zh',''), NULLIF(data_json->>'description',''), '') AS digest
       FROM intel_data
       WHERE data_type='terror_events' AND collect_time >= $1 AND audit_status='approved'
       ORDER BY collect_time DESC LIMIT $2`,
      [since, limit || 8000]
    );
    return rows.map(r => {
      const lv = _lv(r.level_norm, r.severity);
      const titleCn = r.title_zh || r.title || '';
      return {
        id: r.id, title: titleCn, titleRaw: r.title || '',
        country: _iso2cnTry(r.country || ''), location: r.location || '',
        level: lv, source: r.source || '', url: r.url || '',
        time: _fmtTime(r.collect_time), day: _dayKey(r.collect_time),
        digest: String(r.digest || '').slice(0, 160),
        relevant: _isTerrorRelevant(titleCn + ' ' + (r.title || '')),
        china: isChina(titleCn + ' ' + (r.title || ''))
      };
    });
  }

  /* 全景聚合：KPI + 30天日度态势带 + 国别热度 + 级别金字塔 + 红橙24h + 最新流 */
  function _computeOverview(rows) {
    const rel = rows.filter(r => r.relevant);
    const todayKey = _dayKey(new Date());
    const d7 = _dayKey(_localMidnight(7)), d14 = _dayKey(_localMidnight(14));
    const today = rel.filter(r => r.day === todayKey);
    const last7 = rel.filter(r => r.day >= d7);
    const prev7 = rel.filter(r => r.day >= d14 && r.day < d7);
    const redOrange7 = last7.filter(r => r.level === 'red' || r.level === 'orange');
    const china7 = last7.filter(r => r.china);
    const dayMap = {};
    rel.forEach(r => {
      dayMap[r.day] = dayMap[r.day] || { day: r.day, total: 0, red: 0, orange: 0, yellow: 0, blue: 0 };
      dayMap[r.day].total++; dayMap[r.day][r.level]++;
    });
    const daily30 = [];
    for (let i = 29; i >= 0; i--) {
      const k = _dayKey(_localMidnight(i));
      daily30.push(dayMap[k] || { day: k, total: 0, red: 0, orange: 0, yellow: 0, blue: 0 });
    }
    const cMap = {};
    last7.forEach(r => { if (r.country) cMap[r.country] = (cMap[r.country] || 0) + 1; });
    const countryTop = Object.entries(cMap).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([country, n]) => ({ country, n }));
    const pyramid = {
      red: last7.filter(r => r.level === 'red').length,
      orange: last7.filter(r => r.level === 'orange').length,
      yellow: last7.filter(r => r.level === 'yellow').length,
      blue: last7.filter(r => r.level === 'blue').length
    };
    const h24 = _fmtTime(new Date(Date.now() - 24 * 3600 * 1000));
    const alerts24 = rel.filter(r => r.time >= h24 && (r.level === 'red' || r.level === 'orange'))
      .slice(0, 40).map(r => ({ id: r.id, title: r.title, country: r.country, level: r.level, time: r.time, source: r.source, url: r.url, china: r.china }));
    const wow = prev7.length ? Math.round((last7.length - prev7.length) / prev7.length * 100) : (last7.length ? 100 : 0);
    return {
      kpi: {
        todayCount: today.length,
        last7: last7.length, prev7: prev7.length, wow,
        redOrange7: redOrange7.length,
        red7: pyramid.red, orange7: pyramid.orange,
        chinaCount7: china7.length,
        topCountry: countryTop[0] || null,
        rawCount30: rows.length, filteredCount30: rel.length
      },
      daily30, countryTop, pyramid, alerts24,
      latest: rel.slice(0, 20).map(r => ({ id: r.id, title: r.title, country: r.country, level: r.level, time: r.time, source: r.source, url: r.url, china: r.china }))
    };
  }

  /* 组织活跃度雷达：威胁实体档案 × 近14天情报流碰撞 */
  function _computeOrgs(rows) {
    /* #687 用户口径（20:10 修正）：仅移出执政当局（阿富汗塔利班/沙姆解放组织/胡塞武装）
     * 与国家武装力量（伊朗伊斯兰革命卫队）共 4 家——87→83；
     * 极端组织/犯罪组织/武装力量/政治力量按用户指示保留在榜 */
    const _DROP_TYPES = ['执政当局', '国家武装力量'];
    const orgs = _loadThreatOrgs().filter(o => !_DROP_TYPES.includes((o.type || '').trim()));
    const rel = rows.filter(r => r.relevant);
    const d7 = _dayKey(_localMidnight(7));
    const results = orgs.map(o => {
      const match = _buildMatcher([o.name].concat(o.aliases || []));
      /* #681 matchExclude：名称相近组织（如阿富汗塔利班 vs 巴基斯坦塔利班）交叉误归因剔除 */
      const exRe = o.matchExclude ? new RegExp(o.matchExclude, 'i') : null;
      const hits = rel.filter(r => match(r.title + ' ' + r.titleRaw) && !(exRe && exRe.test(r.title + ' ' + r.titleRaw)));
      const h7 = hits.filter(r => r.day >= d7), p7 = hits.filter(r => r.day < d7);
      const score7 = h7.reduce((s, r) => s + _LV_W[r.level], 0);
      const scorePrev7 = p7.reduce((s, r) => s + _LV_W[r.level], 0);
      const cMap = {};
      hits.forEach(r => { if (r.country) cMap[r.country] = (cMap[r.country] || 0) + 1; });
      const activeCountries = Object.entries(cMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
      const regions = o.operatingRegions || [];
      const confirmed = activeCountries.filter(c => regions.some(g => c.includes(g) || g.includes(c)));
      return {
        id: o.id, name: o.name, aliases: (o.aliases || []).slice(0, 6),
        type: o.type || '', category: o.category || '',
        threatLevel: o.threatLevel, threatTrend: o.threatTrend || '',
        leader: o.leader || '', operatingRegions: regions,
        score7, scorePrev7,
        deltaPct: scorePrev7 ? Math.round((score7 - scorePrev7) / scorePrev7 * 100) : (score7 ? 100 : 0),
        events7: h7.length, events14: hits.length,
        redOrange7: h7.filter(r => r.level === 'red' || r.level === 'orange').length,
        activeCountries, confirmedRegions: confirmed,
        sample: hits.slice(0, 5).map(r => ({ title: r.title, country: r.country, level: r.level, time: r.time, url: r.url }))
      };
    }).sort((a, b) => (b.score7 - a.score7) || (b.threatLevel || 0) - (a.threatLevel || 0));
    return results;
  }

  /* ---------- ① 全景态势 ---------- */
  router.get('/overview', async (req, res) => {
    try {
      const rows = await _fetchRows(30);
      const ov = _computeOverview(rows);
      res.json({
        ok: true,
        kpi: ov.kpi, daily30: ov.daily30, countryTop: ov.countryTop,
        pyramid: ov.pyramid, alerts24: ov.alerts24, latest: ov.latest,
        generatedAt: _nowCn(),
        note: '研判口径：terror_events 30天全量 ' + ov.kpi.rawCount30 + ' 条经恐怖词元过滤得研判口径 ' + ov.kpi.filteredCount30 + ' 条（剔除上游分类噪声如事故/演练类条目）；级别归一 level_norm 优先；全部平台数据库真实数据，零模拟。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ② 组织活跃度雷达 ---------- */
  router.get('/orgs', async (req, res) => {
    try {
      const rows = await _fetchRows(14);
      const orgs = _computeOrgs(rows);
      res.json({
        ok: true, orgs, total: orgs.length,
        activeCount: orgs.filter(o => o.events14 > 0).length,
        surging: orgs.filter(o => o.score7 > 0 && o.deltaPct >= 50).length,
        generatedAt: _nowCn(),
        note: '碰撞口径：' + orgs.length + ' 家威胁实体档案（恐怖组织/极端组织/武装力量/政治力量/犯罪组织；执政当局（阿富汗塔利班等）与国家武装力量已出榜，matchExclude 剔除名称相近组织误归因）× 近14天 terror_events 研判口径标题自动匹配；活跃度指数 = Σ 事件级别权重（红4/橙3/黄2/蓝1）；环比 = 近7日 vs 前7日指数变化率；地域印证 = 命中事件国别与组织档案活动区域比对。'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ---------- ③ AI 智库研判 + 红头公文（scope=global|org&id=） ----------
   * #719 修复"无法生成公文报告"：judge 全程现算（30 天聚合 + Kimi 排队）忙时
   * 100s+，前端/用户等不到即判死。对齐每日简报/china-briefing 模式：
   * ① 30min 结果缓存（cached:true 命中秒回）；② in-flight 合并（并发点击/自刷
   * 只算一次，后来者共享同一 Promise）；③ LLM 60s 硬超时（排队过久回落规则
   * 模板，公文照常出，绝不等 Kimi 无限挂）。 */
  const _jCache = new Map();                    /* key -> {at, data, inflight} */
  const J_TTL = 30 * 60 * 1000, J_LLM_MS = 60 * 1000;
  const _llmTimeout = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('LLM_TIMEOUT_' + J_LLM_MS / 1000 + 's')), J_LLM_MS))
  ]);
  router.get('/judge', async (req, res) => {
    try {
      const scope = String(req.query.scope || 'global');
      const ck = scope === 'org' ? ('org:' + String(req.query.id || '')) : 'global';
      const hit = _jCache.get(ck);
      if (!req.query.refresh && hit && hit.data && Date.now() - hit.at < J_TTL) {
        return res.json(Object.assign({ cached: true }, hit.data));
      }
      if (hit && hit.inflight) {
        try { const d = await hit.inflight; if (d) return res.json(Object.assign({ shared: true }, d)); }
        catch (e) { /* 在飞请求失败则本请求重算 */ }
      }
      let _settle;
      const inflight = new Promise((r2, j2) => { _settle = { r2, j2 }; });
      _jCache.set(ck, { at: 0, data: null, inflight });
      const _emit = (data) => {
        _jCache.set(ck, { at: Date.now(), data, inflight: null });
        _settle.r2(data);
        return res.json(data);
      };
      const _fail = (e) => {
        _jCache.set(ck, { at: 0, data: null, inflight: null });
        _settle.j2(e);
        throw e;
      };
      const now = new Date();
      const pkey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const rows30 = await _fetchRows(30);
      const rows14 = rows30.filter(r => r.day >= _dayKey(_localMidnight(14)));
      const orgsAll = _computeOrgs(rows14);
      const surging = orgsAll.filter(o => o.score7 > 0 && o.deltaPct >= 50);
      const orgTop = orgsAll.filter(o => o.events14 > 0).slice(0, 8);

      if (scope === 'org') {
        /* —— 组织专项研判 —— */
        const org = orgsAll.find(o => o.id === String(req.query.id || ''));
        if (!org) { _jCache.set(ck, { at: 0, data: null, inflight: null }); _settle.r2(null); return res.status(404).json({ ok: false, error: '未找到组织档案：' + req.query.id }); }
        const match = _buildMatcher([org.name].concat(org.aliases || []));
        const exRe = org.matchExclude ? new RegExp(org.matchExclude, 'i') : null;
        const evs = rows14.filter(r => r.relevant && match(r.title + ' ' + r.titleRaw) && !(exRe && exRe.test(r.title + ' ' + r.titleRaw)));
        const lvDist = { red: 0, orange: 0, yellow: 0, blue: 0 };
        evs.forEach(r => lvDist[r.level]++);
        const chinaCnt = evs.filter(r => r.china).length;
        const stats = { total: evs.length, red: lvDist.red, orange: lvDist.orange, yellow: lvDist.yellow, blue: lvDist.blue, chinaCount: chinaCnt };
        const trendTxt = org.scorePrev7 ? (org.deltaPct >= 50 ? '环比异动上升' + org.deltaPct + '%，活动显著增强' : org.deltaPct <= -50 ? '环比下降' + Math.abs(org.deltaPct) + '%，活动趋缓' : '环比基本持平（' + org.deltaPct + '%）') : (org.score7 ? '前期无命中，近7日新发活动' : '近14日库内无公开情报命中');
        const ruleJudge = [
          '一、组织概况。' + org.name + '（' + (org.type || '威胁组织') + '，' + (org.category || '未分类') + '），档案威胁等级 ' + (org.threatLevel != null ? org.threatLevel + '/10' : '未评级') + '，威胁趋势：' + (org.threatTrend || '不详') + '。现任头目：' + (org.leader || '不详') + '。档案活动区域：' + ((org.operatingRegions || []).join('、') || '不详') + '。',
          '二、近期活动研判。近14日库内命中该组织相关情报 ' + evs.length + ' 条（红 ' + lvDist.red + '、橙 ' + lvDist.orange + '、黄 ' + lvDist.yellow + '、蓝 ' + lvDist.blue + '），近7日活跃度指数 ' + org.score7 + '（前7日 ' + org.scorePrev7 + '），' + trendTxt + '。' + (org.activeCountries.length ? '近期活动集中地域：' + org.activeCountries.join('、') + '，与档案活动区域' + (org.confirmedRegions.length ? '高度吻合（' + org.confirmedRegions.join('、') + '获库内事件印证）' : '存在偏移，建议核查是否为分支活动或归因误报') + '。' : '近期无地域命中信息。'),
          '三、威胁评估。该组织近7日红橙级关联事件 ' + org.redOrange7 + ' 起，涉华关联情报 ' + chinaCnt + ' 条。' + (org.score7 >= 12 ? '活跃度指数处于高位，列为重点监控对象，建议按日跟踪其活动节点。' : org.score7 > 0 ? '活跃度处于中低位，维持常态监视即可。' : '近14日无公开情报命中，处于静默期，不排除转入地下活动，建议保持档案级监控。'),
          '四、对策建议。建议将该组织纳入全球恐怖组织动态雷达持续碰撞监测；' + (chinaCnt > 0 ? '其关联情报含涉华条目 ' + chinaCnt + ' 条，建议涉华条线逐条核实中方人员与项目安全状态；' : '') + '如其活动区域与中资海外项目所在地（' + ((org.operatingRegions || []).slice(0, 4).join('、') || '档案区域') + '）重叠，请项目安保条线对照历史手法前置防范。'
        ].join('\n');
        let judgeText = ruleJudge, llmOk = false;
        if (llmCall) {
          try {
            const pv = reportsEngine._test.pvKimi();
            const sys = '你是国家安全反恐情报研判专家，为海外利益保护情报预警平台撰写威胁组织动态研判专报的综合研判段。要求：公文语体，分"一、二、三、四"四段（组织概况/近期活动研判/威胁评估/对策建议），每段120-200字，全部基于给定真实数据，禁止虚构数字与事件，禁止口号式空话。注意：若组织类型为"执政当局"或"武装力量"，行文不得将其称为"恐怖组织"，按威胁实体/政治军事力量口径表述。';
            const usr = '组织：' + org.name + '（' + (org.aliases || []).join('/') + '），类型：' + (org.type || '') + '/' + (org.category || '') + '，威胁等级 ' + org.threatLevel + '/10，趋势：' + (org.threatTrend || '不详') + '\n档案活动区域：' + (org.operatingRegions || []).join('、') + '；头目：' + (org.leader || '不详') + '\n近14日命中情报 ' + evs.length + ' 条（红' + lvDist.red + ' 橙' + lvDist.orange + ' 黄' + lvDist.yellow + ' 蓝' + lvDist.blue + '），涉华 ' + chinaCnt + ' 条\n近7日活跃度指数 ' + org.score7 + '（前7日 ' + org.scorePrev7 + '，环比 ' + org.deltaPct + '%），红橙关联 ' + org.redOrange7 + ' 起\n命中活动地域：' + org.activeCountries.join('、') + '\n代表事件：\n' + evs.slice(0, 8).map((r, i) => (i + 1) + '.' + r.title + '（' + r.country + '，' + r.level + '级，' + r.time.slice(0, 10) + '）').join('\n');
            const r = await _llmTimeout(llmCall(pv, sys, usr));
            if (r && r.text && r.text.length > 200) {
              judgeText = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
              llmOk = true;
            }
          } catch (e) { console.warn('[TERROR] org judge LLM 失败/超时，回落规则模板:', e.message); }
        }
        const govData = {
          title: '关于' + org.name + '组织动态的研判专报',
          stats, win: [_localMidnight(14), new Date(now.getTime() + 86400000)],
          sections: [
            {
              name: '组织关联情报事件（近14日·研判口径）', count: evs.length,
              red: lvDist.red, orange: lvDist.orange,
              items: evs.slice(0, 30).map(r => ({ title: r.title, level: r.level, country: r.country, time: r.time, url: r.url, digest: r.digest, _t: r.time })),
              note: '组织名称与别名 × 情报流标题自动碰撞；活跃度指数近7日 ' + org.score7 + '、前7日 ' + org.scorePrev7 + '（环比 ' + org.deltaPct + '%）。'
            }
          ],
          chart: [
            { label: '红级关联', value: lvDist.red }, { label: '橙级关联', value: lvDist.orange },
            { label: '黄级关联', value: lvDist.yellow }, { label: '蓝级关联', value: lvDist.blue }
          ],
          chartCap: '组织关联事件级别构成（近14日）'
        };
        let govHtml = '';
        try { govHtml = reportsEngine.govdoc.renderGovHtml({ name: (org.type === '恐怖组织' ? '恐怖组织研判专报' : '组织动态研判专报') }, pkey, govData, judgeText, true, { perSec: 12, digest: true, digestLen: 120 }); }
        catch (e) { console.warn('[TERROR] org 公文渲染失败:', e.message); }
        return _emit({
          ok: true, scope: 'org',
          org: {
            id: org.id, name: org.name, aliases: org.aliases, type: org.type, category: org.category,
            threatLevel: org.threatLevel, threatTrend: org.threatTrend, leader: org.leader,
            operatingRegions: org.operatingRegions, score7: org.score7, scorePrev7: org.scorePrev7,
            deltaPct: org.deltaPct, events14: org.events14, activeCountries: org.activeCountries
          },
          events: evs.slice(0, 30).map(r => ({ title: r.title, level: r.level, country: r.country, time: r.time, url: r.url, china: r.china })),
          stats, judgment: judgeText, llmOk, govHtml, generatedAt: _nowCn(),
          note: '口径：组织档案 × 近14天研判口径情报流碰撞；研判=' + (llmOk ? 'Kimi 大模型' : '规则模板（大模型暂不可用，引用真实库统计数字）') + '；平台数据库真实数据，零模拟。'
        });
      }

      /* —— 全球态势研判（默认） —— */
      const ov = _computeOverview(rows30);
      const stats = Object.assign({}, ov.pyramid, { total: ov.kpi.last7, chinaCount: ov.kpi.chinaCount7 });
      const ruleJudge = [
        '一、总体态势。近7日全球恐怖袭击类情报（研判口径）共 ' + ov.kpi.last7 + ' 条（前7日 ' + ov.kpi.prev7 + ' 条，环比 ' + (ov.kpi.wow > 0 ? '+' : '') + ov.kpi.wow + '%），其中红级 ' + ov.kpi.red7 + ' 条、橙级 ' + ov.kpi.orange7 + ' 条。' + (ov.kpi.topCountry ? '热点地域首位为' + ov.kpi.topCountry.country + '（' + ov.kpi.topCountry.n + ' 条）。' : '') + '研判口径由恐怖词元过滤上游分类噪声后得出（30天原始量 ' + ov.kpi.rawCount30 + ' → 研判口径 ' + ov.kpi.filteredCount30 + '）。',
        '二、组织活跃度。近14日情报流与组织档案碰撞命中活跃组织 ' + orgTop.length + ' 家，其中异动上升（环比≥50%）' + surging.length + ' 家。' + (orgTop.length ? '活跃度前列：' + orgTop.slice(0, 5).map(o => o.name + '（指数' + o.score7 + '，环比' + (o.deltaPct > 0 ? '+' : '') + o.deltaPct + '%）').join('、') + '。' : '库内暂无组织归因命中，公开报道焦点为无署名零散袭击事件。'),
        '三、重点国别与涉华。' + (ov.countryTop.length ? '近7日国别热度前列：' + ov.countryTop.slice(0, 5).map(c => c.country + ' ' + c.n + '条').join('、') + '。' : '') + '涉华关联情报 ' + ov.kpi.chinaCount7 + ' 条，' + (ov.kpi.chinaCount7 > 0 ? '建议涉华条线逐条过筛核实中方人员机构安全状态。' : '近7日无直接涉华恐怖袭击情报。'),
        '四、对策建议。' + (ov.kpi.redOrange7 > 20 ? '红橙量处于高位（' + ov.kpi.redOrange7 + ' 条），建议对热点国别按日加密跟踪；' : '红橙量处于常态区间（' + ov.kpi.redOrange7 + ' 条），维持按周研判节奏；') + '建议将本通报与全球态势总览、事件研判中心联动使用，形成"雷达发现—组织归因—事件研判—公文通报"闭环。'
      ].join('\n');
      let judgeText = ruleJudge, llmOk = false;
      if (llmCall) {
        try {
          const pv = reportsEngine._test.pvKimi();
          const sys = '你是国家安全反恐情报研判专家，为海外利益保护情报预警平台撰写《反恐态势通报》的综合研判段。要求：公文语体，分"一、二、三、四"四段（总体态势/组织活跃度/重点国别与涉华/对策建议），每段120-200字，全部基于给定真实数据，禁止虚构数字与事件，禁止口号式空话。';
          const usr = '近7日研判口径情报 ' + ov.kpi.last7 + ' 条（前7日 ' + ov.kpi.prev7 + ' 条，环比 ' + ov.kpi.wow + '%），红 ' + ov.kpi.red7 + '、橙 ' + ov.kpi.orange7 + '\n国别热度TOP5：' + ov.countryTop.slice(0, 5).map(c => c.country + ' ' + c.n + '条').join('、') + '\n涉华关联 ' + ov.kpi.chinaCount7 + ' 条；30天原始量 ' + ov.kpi.rawCount30 + ' → 研判口径 ' + ov.kpi.filteredCount30 + '\n活跃组织（近14日碰撞）' + orgTop.length + ' 家：' + orgTop.slice(0, 6).map(o => o.name + '（指数' + o.score7 + '，环比' + o.deltaPct + '%）').join('、') + '\n代表红橙事件：\n' + ov.alerts24.slice(0, 8).map((r, i) => (i + 1) + '.' + r.title + '（' + r.country + '，' + r.level + '级）').join('\n');
          const r = await _llmTimeout(llmCall(pv, sys, usr));
          if (r && r.text && r.text.length > 200) {
            judgeText = String(r.text).replace(/\*\*/g, '').replace(/^#{1,4}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').trim();
            llmOk = true;
          }
        } catch (e) { console.warn('[TERROR] global judge LLM 失败/超时，回落规则模板:', e.message); }
      }
      const govData = {
        title: '全球反恐态势通报（近7日）',
        stats, win: [_localMidnight(7), new Date(now.getTime() + 86400000)],
        sections: [
          {
            name: '红橙级重点事件（近24小时）', count: ov.alerts24.length,
            red: ov.alerts24.filter(r => r.level === 'red').length, orange: ov.alerts24.filter(r => r.level === 'orange').length,
            items: ov.alerts24.map(r => ({ title: r.title, level: r.level, country: r.country, time: r.time, url: r.url, china: r.china, _t: r.time })),
            note: '研判口径（恐怖词元过滤）下近24小时红橙级事件，按采集时间倒序。'
          },
          {
            name: '活跃组织关联事件（近14日）', count: orgTop.reduce((s, o) => s + o.events14, 0),
            red: 0, orange: 0,
            items: orgTop.slice(0, 6).flatMap(o => (o.sample || []).map(s => ({ title: '[' + o.name + '] ' + s.title, level: s.level, country: s.country, time: s.time, url: s.url, _t: s.time }))).slice(0, 24),
            note: '组织档案别名 × 情报流碰撞命中的代表事件（每个活跃组织取前5条）。'
          }
        ],
        chart: [
          { label: '红级（7日）', value: ov.kpi.red7 }, { label: '橙级（7日）', value: ov.kpi.orange7 },
          { label: '黄级（7日）', value: ov.pyramid.yellow }, { label: '蓝级（7日）', value: ov.pyramid.blue }
        ].concat(ov.countryTop.slice(0, 4).map(c => ({ label: c.country, value: c.n }))),
        chartCap: '级别构成与热点国别（近7日研判口径）'
      };
      let govHtml = '';
      try { govHtml = reportsEngine.govdoc.renderGovHtml({ name: '反恐态势通报' }, pkey, govData, judgeText, true, { perSec: 12, digest: true, digestLen: 120 }); }
      catch (e) { console.warn('[TERROR] global 公文渲染失败:', e.message); }
      _emit({
        ok: true, scope: 'global',
        kpi: ov.kpi, countryTop: ov.countryTop,
        orgTop: orgTop.map(o => ({ id: o.id, name: o.name, score7: o.score7, deltaPct: o.deltaPct, events14: o.events14, threatLevel: o.threatLevel })),
        judgment: judgeText, llmOk, govHtml, generatedAt: _nowCn(),
        note: '口径：近7日研判口径统计 + 近14日组织碰撞；研判=' + (llmOk ? 'Kimi 大模型' : '规则模板（大模型暂不可用，引用真实库统计数字）') + '；平台数据库真实数据，零模拟。'
      });
    } catch (e) { try { _fail(e); } catch (e2) { /* _fail 重抛后走这里 */ } res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
};
