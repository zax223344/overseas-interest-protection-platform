/* ============================================================
 * models-analysis.js — 「专题分析模型」分析计算层（2026-09-02 新增功能区）
 * ================================================================
 * 定位：只读复用平台已沉淀数据（intel_data 活跃库 + intel_archive 归档库），
 *       服务端完成四大模型计算（SQL 聚合 + Node 透明公式），零模拟数据：
 *       样本不足即如实返回 insufficient，绝不编造。
 * 挂载：server.js 仅一行 app.use('/api/models', modelsAnalysis({ query }))。
 * 缓存：全量事件底数 + 各端点结果均带 10 分钟内存 TTL 缓存（Map+时间戳），
 *       50 人并发只触发一次 DB 扫描。
 * 预警联动：第一阶段仅在功能区内呈现告警卡（/api/models/alerts），
 *          不直写 datahub_store（预警中心接入留二期，由 lead 协调）。
 * ================================================================ */
const express = require('express');
const fs = require('fs');
const path = require('path');

/* ===== 常量口径（全部透明可解释）===== */
const CACHE_TTL = 10 * 60 * 1000;          /* 10 分钟 */
const MIN_ORG_EVENTS = 20;                 /* 专题一：组织画像最低样本 */
const HAWKES_MIN_EVENTS = 30;              /* 专题二：国家级拟合最低样本 */
const ORG_OBS_DAYS = 14;                   /* 专题一：观测窗（数据全窗约 45 天，90 天窗无意义，适配为 14 天） */
const KL_ALERT_THRESHOLD = 0.5;            /* 专题一：KL 偏离告警阈值（bit） */

/* 手法分桶（按优先级先命中先归类，透明规则） */
const METHOD_BUCKETS = [
  { k: 'suicide', n: '自杀式袭击', re: /自杀式|自杀袭击|suicide/i },
  { k: 'ied', n: '爆炸/简易爆炸装置', re: /爆炸|炸弹|汽车炸弹|炸弹袭击|bomb|blast|explosion|\bied\b|vbied/i },
  { k: 'shooting', n: '枪击', re: /枪击|开枪|射杀|扫射|枪手|交火|shooting|gunmen|gunfire|shot dead/i },
  { k: 'kidnap_hijack', n: '绑架/劫持', re: /绑架|劫持|人质|勒索赎金|kidnap|abduct|hostage/i },
  { k: 'ambush', n: '伏击', re: /伏击|埋伏|ambush/i },
  { k: 'drone_missile', n: '无人机/导弹/火箭弹', re: /无人机|导弹|火箭弹|空袭|drone|missile|rocket|airstrike/i },
  { k: 'other', n: '其他袭击', re: /袭击|攻击|attack|袭击事件/i }
];

/* 目标类型分桶（按优先级：我方 > 军警 > 政府 > 基础设施 > 商业 > 平民） */
const TARGET_BUCKETS = [
  { k: 'china', n: '我方人员与资产', re: /中国|中方|中资|中企|华人|华侨|Chinese|China|CPEC|一带一路|中巴经济走廊/i },
  { k: 'military', n: '军警目标', re: /军队|军方|士兵|安全部队|军警|警察|边防|哨所|military|soldier|police|army|troops/i },
  { k: 'government', n: '政府目标', re: /政府|官员|部会|议会|ministry|government|official/i },
  { k: 'infra', n: '基础设施', re: /管道|电站|铁路|公路|桥梁|机场|港口|基础设施|infrastructure|pipeline|railway|power grid/i },
  { k: 'business', n: '商业设施', re: /商业|市场|银行|公司|商铺|酒店|business|bank|market|hotel/i },
  { k: 'civilian', n: '平民目标', re: /平民|村民|民众|清真寺|学校|医院|集会|civilian|villager|worship|school/i }
];

/* 绑架事件识别（中英双语，题名口径） */
const KIDNAP_RE = /绑架|劫持|人质|勒索赎金|kidnap|abduct|hostage/i;
/* 恐袭类事件口径（系统真实分类） */
const TERROR_TYPES = ['terror_events'];
/* 安全类（专题四·安全维） */
const SECURITY_TYPES = ['terror_events', 'military_conflicts'];

/* severity → 权重（透明映射；兼容库内少量中文/英文混杂值） */
function sevWeight(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'red' || v === '高') return 4;
  if (v === 'orange' || v === '中' || v === 'medium') return 3;
  if (v === 'yellow' || v === '低' || v === 'low') return 2;
  if (v === 'blue') return 1;
  return 2;
}

/* ===== 数学工具（全部透明公式）===== */
function entropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return Math.round(h * 1000) / 1000;
}
/* KL 散度（拉普拉斯平滑避免零除；单位 bit） */
function klDivergence(nowCounts, baseCounts) {
  const keys = new Set([...Object.keys(nowCounts), ...Object.keys(baseCounts)]);
  const nowTotal = Object.values(nowCounts).reduce((a, b) => a + b, 0);
  const baseTotal = Object.values(baseCounts).reduce((a, b) => a + b, 0);
  if (nowTotal <= 0 || baseTotal <= 0) return 0;
  let d = 0;
  for (const k of keys) {
    const pn = ((nowCounts[k] || 0) + 0.5) / (nowTotal + 0.5 * keys.size);
    const pb = ((baseCounts[k] || 0) + 0.5) / (baseTotal + 0.5 * keys.size);
    d += pn * Math.log2(pn / pb);
  }
  return Math.round(d * 1000) / 1000;
}
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
/* Dice 二元组相似度（相似案例检索，透明无黑箱） */
function diceSimilarity(a, b) {
  const bigrams = s => {
    const t = String(s || '').replace(/\s+/g, '');
    const set = new Set();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/* ===== 威胁组织库：解析前端 threats.js 的 THREAT_DATA（name+aliases 归因源）===== */
let _ORG_LIST = null;
function loadOrgs() {
  if (_ORG_LIST) return _ORG_LIST;
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'threats.js'), 'utf8');
    const i = src.indexOf('const THREAT_DATA=');
    if (i < 0) throw new Error('THREAT_DATA 未找到');
    const rest = src.slice(i + 'const THREAT_DATA='.length);
    let depth = 0, end = -1, inStr = false, esc = false;
    for (let k = 0; k < rest.length; k++) {
      const ch = rest[k];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
    }
    const obj = (new Function('return ' + rest.slice(0, end + 1)))();
    _ORG_LIST = (obj.organizations || []).map(o => ({
      id: o.id, name: o.name, aliases: o.aliases || [],
      type: o.type || '', threatLevel: o.threatLevel || 0, status: o.status || ''
    }));
  } catch (e) {
    console.warn('[MODELS] threats.js 组织库解析失败:', e.message);
    _ORG_LIST = [];
  }
  return _ORG_LIST;
}
/* 组织正则：name+aliases 全部参与，ASCII 缩写加词边界 */
function buildOrgMatchers() {
  return loadOrgs().map(o => {
    const terms = [o.name, ...o.aliases].map(s => String(s).trim()).filter(s => s.length >= 2);
    const parts = terms
      .sort((a, b) => b.length - a.length)
      .map(t => /^[\x21-\x7e]+$/.test(t) ? t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^(.+)$/, '(?:^|[^a-z])$1(?:[^a-z]|$)') : t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(parts.join('|'), 'i');
    return { org: o, re };
  });
}

/* ===== TTL 缓存 ===== */
function ttlCache() {
  const store = new Map();
  return {
    async wrap(key, fn) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.at < CACHE_TTL) return hit.val;
      const val = await fn();
      store.set(key, { at: Date.now(), val });
      return val;
    }
  };
}

/* ===== 事件有效时间：event_date 优先（须落在采集窗口−30天 ~ 当前+7天内，离群回落 collect_time），否则回落 collect_time ===== */
function effTimeMs(row, minCollect) {
  const ed = row.event_date;
  if (ed && /^\d{4}-\d{2}-\d{2}/.test(String(ed))) {
    const t = Date.parse(String(ed).replace(' ', 'T'));
    if (!isNaN(t) && t > (minCollect - 30 * DAY) && t < Date.now() + 7 * DAY) return t;
  }
  return row.collect_time ? Date.parse(row.collect_time) : 0;
}
const DAY = 864e5;
const DAY0 = d => Math.floor(d / DAY);

module.exports = function modelsAnalysis(ctx) {
  const { query } = ctx;
  const router = express.Router();
  const cache = ttlCache();

  /* ===== 全量事件底数（10 分钟 TTL，一次扫描两库）===== */
  async function loadEvents() {
    return cache.wrap('base:events', async () => {
      const sql = `
        SELECT id, data_type, COALESCE(NULLIF(data_json->>'title_zh',''), title) AS title,
               country, severity, event_date, collect_time,
               LEFT(COALESCE(data_json->>'content',''), 500) AS content,
               data_json->>'chinaRelated' AS china
        FROM (
          SELECT * FROM intel_data WHERE audit_status='approved'
          UNION ALL
          SELECT id + 100000000, data_type, title, country, location, event_date, severity,
                 description, source, data_json, audit_status, audit_time, collect_time, created_at, updated_at
          FROM intel_archive WHERE audit_status='approved'
        ) u`;
      const r = await query(sql);
      /* 两遍：先取 collect_time 最小值作锚，再定每条有效时间（event_date 离群回落入库时间） */
      let minCollect = Infinity;
      r.rows.forEach(x => {
        const c = x.collect_time ? Date.parse(x.collect_time) : 0;
        if (c > 0 && c < minCollect) minCollect = c;
      });
      if (!isFinite(minCollect)) minCollect = Date.now();
      const evs = r.rows.map(x => {
        const t = effTimeMs(x, minCollect);
        return {
          id: String(x.id),
          type: x.data_type || '',
          title: x.title || '',
          content: x.content || '',
          country: (x.country || '').trim() || '未知',
          severity: x.severity || '',
          china: x.china === 'true',
          t,
          d: DAY0(t)
        };
      }).filter(e => e.t > 0);
      evs.sort((a, b) => a.t - b.t);
      const t0 = evs.length ? evs[0].t : Date.now();
      const t1 = evs.length ? evs[evs.length - 1].t : Date.now();
      return { evs, t0, t1, spanDays: Math.max(1, Math.ceil((t1 - t0) / DAY)) };
    });
  }

  /* ===== 组织归因映射（缓存；题名+正文前 500 字符关键词匹配，不区分大小写）===== */
  async function loadOrgIndex() {
    return cache.wrap('base:orgIndex', async () => {
      const { evs } = await loadEvents();
      const matchers = buildOrgMatchers();
      const byOrg = new Map();   /* orgId → events[] */
      const evOrgs = new Map();  /* evId → orgId[] */
      for (const ev of evs) {
        const text = ev.title + ' ' + ev.content;
        for (const m of matchers) {
          if (m.re.test(text)) {
            if (!byOrg.has(m.org.id)) byOrg.set(m.org.id, []);
            byOrg.get(m.org.id).push(ev);
            if (!evOrgs.has(ev.id)) evOrgs.set(ev.id, []);
            evOrgs.get(ev.id).push(m.org.id);
          }
        }
      }
      return { byOrg, evOrgs };
    });
  }

  /* 手法/目标归类（优先级先命中先归） */
  function bucketOf(text, buckets) {
    for (const b of buckets) if (b.re.test(text)) return b;
    return null;
  }
  function classifyMethod(ev) {
    const b = bucketOf(ev.title + ' ' + ev.content, METHOD_BUCKETS);
    return b ? b : { k: 'unclassified', n: '未明' };
  }
  function classifyTarget(ev) {
    const b = bucketOf(ev.title + ' ' + ev.content, TARGET_BUCKETS);
    return b ? b : { k: 'unclassified', n: '未明' };
  }
  function distOf(events, fn) {
    const c = {};
    for (const e of events) {
      const b = fn(e);
      c[b.k] = (c[b.k] || 0) + 1;
    }
    return c;
  }
  function namedDist(events, fn, buckets) {
    const c = distOf(events, fn);
    const out = [];
    const allKeys = [...buckets.map(b => b.k), 'unclassified'];
    for (const k of allKeys) {
      if (c[k] === undefined) continue;
      const def = buckets.find(b => b.k === k);
      out.push({ k, n: def ? def.n : '未分类', c: c[k] });
    }
    return out.sort((a, b) => b.c - a.c);
  }

  /* ============ 通用端点：/overview 数据底数 + 筛选器元数据 ============ */
  router.get('/overview', async (req, res) => {
    try {
      const data = await cache.wrap('overview', async () => {
        const { evs, t0, t1, spanDays } = await loadEvents();
        const byType = {}, byCountry = {};
        let china = 0;
        for (const e of evs) {
          byType[e.type] = (byType[e.type] || 0) + 1;
          byCountry[e.country] = (byCountry[e.country] || 0) + 1;
          if (e.china) china++;
        }
        const { byOrg } = await loadOrgIndex();
        const orgs = loadOrgs().map(o => ({
          id: o.id, name: o.name, count: (byOrg.get(o.id) || []).length
        })).filter(o => o.count > 0).sort((a, b) => b.count - a.count);
        return {
          ok: true,
          window: {
            from: new Date(t0).toISOString().slice(0, 10),
            to: new Date(t1).toISOString().slice(0, 10),
            spanDays,
            totalEvents: evs.length,
            chinaRelated: china,
            note: '数据底数为活跃库+归档库全量已审计事件（滚动归档：活跃库仅留近 7 天，历史在归档库）'
          },
          byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
          countries: Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => ({ country: x[0], count: x[1] })),
          orgs: orgs.slice(0, 30),
          thresholds: { minOrgEvents: MIN_ORG_EVENTS, hawkesMin: HAWKES_MIN_EVENTS, obsDays: ORG_OBS_DAYS, klAlert: KL_ALERT_THRESHOLD }
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专题一：组织行动模式 ============ */
  router.get('/orgs', async (req, res) => {
    try {
      const data = await cache.wrap('orgs:list', async () => {
        const { byOrg } = await loadOrgIndex();
        return {
          ok: true, minEvents: MIN_ORG_EVENTS,
          orgs: loadOrgs().map(o => {
            const evs = byOrg.get(o.id) || [];
            return { id: o.id, name: o.name, type: o.type, threatLevel: o.threatLevel, status: o.status, count: evs.length, sufficient: evs.length >= MIN_ORG_EVENTS };
          }).sort((a, b) => b.count - a.count)
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 组织行为画像（熵 + KL 偏离 + 节律热力） */
  router.get('/orgs/profile', async (req, res) => {
    const id = String(req.query.id || '');
    const obsDays = Math.max(3, Math.min(30, parseInt(req.query.obsDays, 10) || ORG_OBS_DAYS));
    try {
      const data = await cache.wrap('orgs:profile:' + id + ':' + obsDays, async () => {
        const org = loadOrgs().find(o => o.id === id);
        if (!org) return { ok: false, error: '组织不存在' };
        const { byOrg } = await loadOrgIndex();
        const all = (byOrg.get(id) || []).slice();
        if (all.length < MIN_ORG_EVENTS) {
          return { ok: true, insufficient: true, org, count: all.length, minEvents: MIN_ORG_EVENTS };
        }
        const now = all[all.length - 1].t;
        const obsStart = now - obsDays * DAY;
        const base = all.filter(e => e.t < obsStart);
        const obs = all.filter(e => e.t >= obsStart);
        /* 三维分布 + 熵 */
        const methodDist = namedDist(all, classifyMethod, METHOD_BUCKETS);
        const targetDist = namedDist(all, classifyTarget, TARGET_BUCKETS);
        const regionC = {};
        all.forEach(e => { regionC[e.country] = (regionC[e.country] || 0) + 1; });
        const regionDist = Object.entries(regionC).map(([k, c]) => ({ k, n: k, c })).sort((a, b) => b.c - a.c);
        const ent = {
          method: entropy(methodDist.map(x => x.c)),
          target: entropy(targetDist.map(x => x.c)),
          region: entropy(regionDist.map(x => x.c))
        };
        /* KL 偏离度（观测窗 vs 基线；基线不足 10 起时如实降级） */
        let kl = null, klDegraded = false;
        if (obs.length >= 5 && base.length >= 10) {
          kl = {
            method: klDivergence(distOf(obs, classifyMethod), distOf(base, classifyMethod)),
            target: klDivergence(distOf(obs, classifyTarget), distOf(base, classifyTarget)),
            region: klDivergence(distOf(obs, e => ({ k: e.country })), distOf(base, e => ({ k: e.country })))
          };
          kl.overall = Math.round(((kl.method + kl.target + kl.region) / 3) * 1000) / 1000;
        } else klDegraded = true;
        /* 节律热力：星期 × 数据周序号 */
        const week0 = DAY0(all[0].t);
        const heat = [];
        for (let w = 0; w <= Math.floor((DAY0(now) - week0) / 7); w++) heat.push([0, 0, 0, 0, 0, 0, 0]);
        all.forEach(e => {
          const dt = new Date(e.t);
          const wk = Math.floor((DAY0(e.t) - week0) / 7);
          if (wk >= 0 && wk < heat.length) heat[wk][dt.getUTCDay()]++;
        });
        /* 近 4 周 KL 滚动序列 */
        const dSeries = [];
        for (let k = 4; k >= 1; k--) {
          const end = now - (k - 1) * 7 * DAY, start = end - 7 * DAY;
          const prior = all.filter(e => e.t < start);
          const win = all.filter(e => e.t >= start && e.t < end);
          if (win.length >= 3 && prior.length >= 10) {
            dSeries.push({
              label: '近' + k + '周',
              d: klDivergence(distOf(win, classifyMethod), distOf(prior, classifyMethod))
            });
          }
        }
        return {
          ok: true, insufficient: false, org, count: all.length,
          obsDays, obsCount: obs.length, baseCount: base.length,
          methodDist, targetDist, regionDist: regionDist.slice(0, 12),
          entropy: ent, kl, klDegraded, klAlertThreshold: KL_ALERT_THRESHOLD,
          klAlert: !!(kl && kl.overall > KL_ALERT_THRESHOLD),
          rhythm: { heat, weekLabels: heat.map((_, i) => '第' + (i + 1) + '周') },
          dSeries,
          recent: all.slice(-10).reverse().map(e => ({
            title: e.title.slice(0, 100), country: e.country, time: new Date(e.t).toISOString().slice(0, 10), type: e.type
          }))
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 组织对比（2-4 个，手法/目标/地域分布 + 熵，供雷达对比） */
  router.get('/orgs/compare', async (req, res) => {
    const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
    try {
      const data = await cache.wrap('orgs:compare:' + ids.join(','), async () => {
        const { byOrg } = await loadOrgIndex();
        const out = [];
        for (const id of ids) {
          const org = loadOrgs().find(o => o.id === id);
          const evs = byOrg.get(id) || [];
          if (!org || evs.length < MIN_ORG_EVENTS) { out.push({ id, name: org ? org.name : id, insufficient: true, count: evs.length }); continue; }
          const methodDist = namedDist(evs, classifyMethod, METHOD_BUCKETS);
          const targetDist = namedDist(evs, classifyTarget, TARGET_BUCKETS);
          out.push({
            id, name: org.name, count: evs.length, insufficient: false,
            method: METHOD_BUCKETS.map(b => ({
              k: b.k, n: b.n,
              p: Math.round(((methodDist.find(x => x.k === b.k) || { c: 0 }).c / evs.length) * 1000) / 10
            })),
            targets: targetDist.slice(0, 5),
            entropy: {
              method: entropy(methodDist.map(x => x.c)),
              target: entropy(targetDist.map(x => x.c))
            }
          });
        }
        return { ok: true, orgs: out };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专题二：国别恐袭 Hawkes ============ */
  /* Hawkes 似然：λ(t)=μ+Σα·exp(−β(t−ti))；网格搜索 MLE */
  function fitHawkes(timesDay, Tdays) {
    const n = timesDay.length;
    const mu = n / Tdays;
    let best = { ll: -Infinity, alpha: 0, beta: 0 };
    /* 预计算事件间差，供似然快速求和 */
    for (let ai = 1; ai <= 15; ai++) {
      const alpha = ai * 0.1;
      for (let bi = 1; bi <= 50; bi++) {
        const beta = bi * 0.01;
        let ll = 0;
        for (let i = 0; i < n; i++) {
          let lam = mu;
          for (let j = 0; j < i; j++) {
            const dt = timesDay[i] - timesDay[j];
            if (dt > 0) lam += alpha * Math.exp(-beta * dt);
          }
          ll += Math.log(lam);
        }
        /* 积分项：μT + (α/β)Σ(1−e^{−β(T−ti)}) */
        let integ = mu * Tdays;
        for (let i = 0; i < n; i++) integ += (alpha / beta) * (1 - Math.exp(-beta * (Tdays - timesDay[i])));
        ll -= integ;
        if (ll > best.ll) best = { ll, alpha, beta };
      }
    }
    return { mu, alpha: best.alpha, beta: best.beta, ll: best.ll };
  }
  function hawkesIntensityAt(timesDay, t, mu, alpha, beta) {
    let lam = mu;
    for (let i = 0; i < timesDay.length; i++) {
      const dt = t - timesDay[i];
      if (dt >= 0) lam += alpha * Math.exp(-beta * dt);
    }
    return lam;
  }
  /* 未来 h 天期望事件数：μh + (α/β)·Σe^{−βΔ}(1−e^{−βh}) */
  function hawkesForecast(timesDay, nowDay, h, mu, alpha, beta) {
    let ex = mu * h;
    for (let i = 0; i < timesDay.length; i++) {
      const dt = nowDay - timesDay[i];
      if (dt >= 0) ex += (alpha / beta) * Math.exp(-beta * dt) * (1 - Math.exp(-beta * h));
    }
    return ex;
  }
  const TERROR_REGION = {
    '巴基斯坦': '南亚', '阿富汗': '南亚', '印度': '南亚', '孟加拉国': '南亚',
    '尼日利亚': '西非', '马里': '西非', '尼日尔': '西非', '布基纳法索': '西非', '塞内加尔': '西非', '喀麦隆': '西非', '加纳': '西非',
    '索马里': '东非', '肯尼亚': '东非', '埃塞俄比亚': '东非', '刚果（金）': '中非', '莫桑比克': '东非', '乌干达': '东非',
    '伊拉克': '中东', '叙利亚': '中东', '伊朗': '中东', '也门': '中东', '以色列': '中东', '巴勒斯坦': '中东', '黎巴嫩': '中东', '沙特阿拉伯': '中东', '土耳其': '中东',
    '俄罗斯': '欧洲', '乌克兰': '欧洲',
    '菲律宾': '东南亚', '泰国': '东南亚', '缅甸': '东南亚', '印度尼西亚': '东南亚', '马来西亚': '东南亚',
    '美国': '美洲', '秘鲁': '美洲', '哥伦比亚': '美洲', '墨西哥': '美洲', '巴西': '美洲', '海地': '美洲'
  };

  /* 自适应基线率：近 windowDays 天日均（采集量随时间递增，全窗平稳 μ 会低估近期强度，如实改用近期基线并明示） */
  function adaptiveMu(times, nowDay, windowDays) {
    const w = Math.max(3, Math.min(windowDays, Math.floor(nowDay / 2) || 3));
    let c = 0;
    for (const td of times) if (td >= nowDay - w && td < nowDay) c++;
    return c / w;
  }

  /* 各国概览（红橙黄蓝分级） */
  router.get('/hawkes/overview', async (req, res) => {
    try {
      const data = await cache.wrap('hawkes:overview', async () => {
        const { evs, t0, spanDays } = await loadEvents();
        const T = spanDays;
        const byCountry = new Map();
        evs.filter(e => TERROR_TYPES.includes(e.type)).forEach(e => {
          if (!byCountry.has(e.country)) byCountry.set(e.country, []);
          byCountry.get(e.country).push(e);
        });
        /* 先拟合所有 ≥30 起国家，供区域平均 */
        const fitted = {};
        for (const [c, list] of byCountry) {
          if (list.length >= HAWKES_MIN_EVENTS) fitted[c] = fitHawkes(list.map(e => (e.t - t0) / DAY), T);
        }
        const regionParams = {};
        for (const [c, f] of Object.entries(fitted)) {
          const r = TERROR_REGION[c] || '其他';
          if (!regionParams[r]) regionParams[r] = [];
          regionParams[r].push(f);
        }
        const regionAvg = {};
        for (const [r, arr] of Object.entries(regionParams)) {
          regionAvg[r] = {
            alpha: arr.reduce((a, x) => a + x.alpha, 0) / arr.length,
            beta: arr.reduce((a, x) => a + x.beta, 0) / arr.length
          };
        }
        const nowDay = T;
        const out = [];
        for (const [c, list] of byCountry) {
          if (list.length < 5 || c === '国际' || c === '未知') continue; /* 少于 5 起或伪国家不评级 */
          const times = list.map(e => (e.t - t0) / DAY);
          let mu, alpha, beta, paramsSource;
          if (list.length >= HAWKES_MIN_EVENTS) {
            const f = fitted[c]; alpha = f.alpha; beta = f.beta; paramsSource = '本国MLE拟合（α/β）+ 近21天自适应μ';
          } else {
            const r = TERROR_REGION[c] || '其他';
            const avg = regionAvg[r] || { alpha: 0.5, beta: 0.1 };
            alpha = avg.alpha; beta = avg.beta;
            paramsSource = '区域平均参数（' + r + '，样本 ' + list.length + ' < ' + HAWKES_MIN_EVENTS + '）';
          }
          mu = adaptiveMu(times, nowDay, 21);
          const ex7 = hawkesForecast(times, nowDay, 7, mu, alpha, beta);
          const ex30 = hawkesForecast(times, nowDay, 30, mu, alpha, beta);
          /* 分级阈值：该国历史 7 天滚动计数分位（真实数据标定，透明） */
          const daily = new Array(T + 1).fill(0);
          times.forEach(td => { const d = Math.floor(td); if (d >= 0 && d <= T) daily[d]++; });
          const roll7 = [];
          for (let d = 6; d <= T; d++) roll7.push(daily.slice(d - 6, d + 1).reduce((a, b) => a + b, 0));
          const sorted = roll7.slice().sort((a, b) => a - b);
          const th = { q50: quantile(sorted, 0.5), q75: quantile(sorted, 0.75), q90: quantile(sorted, 0.9), q95: quantile(sorted, 0.95) };
          let level;
          if (ex7 >= th.q95) level = 'red';
          else if (ex7 >= th.q90) level = 'orange';
          else if (ex7 >= th.q75) level = 'yellow';
          else level = 'blue';
          out.push({
            country: c, count: list.length, paramsSource,
            mu: Math.round(mu * 1000) / 1000, alpha: Math.round(alpha * 100) / 100, beta: Math.round(beta * 100) / 100,
            ex7: Math.round(ex7 * 100) / 100, ex30: Math.round(ex30 * 100) / 100,
            thresholds: th, level
          });
        }
        return { ok: true, minEvents: HAWKES_MIN_EVENTS, countries: out.sort((a, b) => b.ex7 - a.ex7), spanDays: T };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 单国详情：拟合 + 强度回放 + 预测 + 回测 + 手法矩阵 + 组织贡献 */
  router.get('/hawkes', async (req, res) => {
    const country = String(req.query.country || '');
    try {
      const data = await cache.wrap('hawkes:' + country, async () => {
        const { evs, t0, spanDays: T } = await loadEvents();
        const list = evs.filter(e => TERROR_TYPES.includes(e.type) && e.country === country);
        if (!list.length) return { ok: false, error: '该国无恐袭类事件', country };
        const times = list.map(e => (e.t - t0) / DAY);
        /* 参数：≥30 本国 MLE（α/β）+ 近 21 天自适应 μ；否则全库平均 α/β（如实标注） */
        let mu, alpha, beta, paramsSource;
        if (list.length >= HAWKES_MIN_EVENTS) {
          const f = fitHawkes(times, T);
          alpha = f.alpha; beta = f.beta;
          paramsSource = '本国 ' + list.length + ' 起事件 MLE 网格搜索（α/β）+ 近 21 天自适应基线 μ';
        } else {
          /* 全库平均参数（拟合所有 ≥30 国取均值） */
          const byCountry = new Map();
          evs.filter(e => TERROR_TYPES.includes(e.type)).forEach(e => {
            if (!byCountry.has(e.country)) byCountry.set(e.country, []);
            byCountry.get(e.country).push(e);
          });
          const fs = [];
          for (const [c, l] of byCountry) if (l.length >= HAWKES_MIN_EVENTS) fs.push(fitHawkes(l.map(e => (e.t - t0) / DAY), T));
          alpha = fs.reduce((a, x) => a + x.alpha, 0) / fs.length;
          beta = fs.reduce((a, x) => a + x.beta, 0) / fs.length;
          paramsSource = '全库平均参数（本国样本 ' + list.length + ' < ' + HAWKES_MIN_EVENTS + '）+ 近 21 天自适应基线 μ';
        }
        mu = adaptiveMu(times, T, 21);
        /* 历史强度回放（逐日 λ） */
        const replay = [];
        for (let d = 0; d <= T; d++) {
          replay.push({ d, date: new Date(t0 + d * DAY).toISOString().slice(0, 10), lam: hawkesIntensityAt(times, d, mu, alpha, beta) });
        }
        /* 未来 30 天逐日预测强度 */
        const forecast = [];
        for (let h = 1; h <= 30; h++) {
          forecast.push({ h, lam: hawkesIntensityAt(times, T + h, mu, alpha, beta), ex: hawkesForecast(times, T, h, mu, alpha, beta) });
        }
        const ex7 = hawkesForecast(times, T, 7, mu, alpha, beta);
        const ex30 = hawkesForecast(times, T, 30, mu, alpha, beta);
        /* 分级（与 overview 同口径） */
        const daily = new Array(T + 1).fill(0);
        times.forEach(td => { const d = Math.floor(td); if (d >= 0 && d <= T) daily[d]++; });
        const roll7 = [];
        for (let d = 6; d <= T; d++) roll7.push(daily.slice(d - 6, d + 1).reduce((a, b) => a + b, 0));
        const sorted = roll7.slice().sort((a, b) => a - b);
        const th = { q50: quantile(sorted, 0.5), q75: quantile(sorted, 0.75), q90: quantile(sorted, 0.9), q95: quantile(sorted, 0.95) };
        let level;
        if (ex7 >= th.q95) level = 'red';
        else if (ex7 >= th.q90) level = 'orange';
        else if (ex7 >= th.q75) level = 'yellow';
        else level = 'blue';
        /* 回测：直接回测分级规则（预测未来7天期望数 vs 历史P90阈值），后30%时段逐日滚动评估 */
        let backtest = null;
        if (list.length >= 15 && T >= 14) {
          const evalStart = Math.floor(T * 0.7);
          /* 评估窗右边界：最后事件日前 7 天（避免数据截止截断 actual7 的边缘伪影） */
          const lastDay = Math.floor(times[times.length - 1]);
          const evalEnd = Math.max(evalStart + 1, Math.min(T - 1, lastDay - 7));
          /* 训练期（前70%）滚动7天计数分位 → 阈值 */
          const trainCounts = new Array(evalStart + 1).fill(0);
          times.forEach(td => { const d = Math.floor(td); if (d <= evalStart) trainCounts[d]++; });
          const roll7Train = [];
          for (let d = 6; d <= evalStart; d++) roll7Train.push(trainCounts.slice(d - 6, d + 1).reduce((a, b) => a + b, 0));
          const sTrain = roll7Train.slice().sort((a, b) => a - b);
          const thQ90 = quantile(sTrain, 0.9);
          let highPred = 0, hit = 0, actualHigh = 0, captured = 0;
          const evalDays = [];
          for (let d = evalStart; d <= evalEnd; d++) {
            const past = times.filter(td => td < d);
            const muD = adaptiveMu(past, d, 21); /* 逐日前向自适应基线（无未来信息泄漏） */
            const ex7d = hawkesForecast(past, d, 7, muD, alpha, beta);
            const actual7 = times.filter(td => td >= d && td < d + 7).length;
            const isPredHigh = ex7d >= thQ90, isActualHigh = actual7 >= thQ90;
            if (isPredHigh) { highPred++; if (isActualHigh) hit++; }
            if (isActualHigh) { actualHigh++; if (isPredHigh) captured++; }
            if (evalDays.length < 5 && isPredHigh) evalDays.push({ day: d, ex7: Math.round(ex7d * 10) / 10, actual7 });
          }
          backtest = {
            evalWindow: '第 ' + evalStart + '~' + evalEnd + ' 天逐日滚动（训练期前 ' + evalStart + ' 天定 P90 阈值=' + Math.round(thQ90 * 10) / 10 + ' 起/7天）',
            holdoutEvents: times.filter(td => td >= evalStart).length,
            highPredDays: highPred,
            hitRate: highPred ? Math.round(hit / highPred * 1000) / 10 : null,       /* 预测高风险日中实际确为高发的比例% */
            actualHighDays: actualHigh,
            missRate: actualHigh ? Math.round((1 - captured / actualHigh) * 1000) / 10 : null, /* 实际高发日未预警比例% */
            samples: evalDays
          };
        }
        /* 手法偏好矩阵：该国手法概率 */
        const mDist = namedDist(list, classifyMethod, METHOD_BUCKETS);
        const methodProfile = mDist.map(x => ({ n: x.n, p: Math.round(x.c / list.length * 1000) / 10, c: x.c }));
        /* 组织贡献：专题一归因映射复用（限该国） */
        const { evOrgs } = await loadOrgIndex();
        const orgCount = {};
        list.forEach(e => {
          (evOrgs.get(e.id) || []).forEach(oid => { orgCount[oid] = (orgCount[oid] || 0) + 1; });
        });
        const orgContribution = Object.entries(orgCount)
          .map(([oid, c]) => ({ id: oid, name: (loadOrgs().find(o => o.id === oid) || {}).name || oid, c, p: Math.round(c / list.length * 1000) / 10 }))
          .sort((a, b) => b.c - a.c).slice(0, 6);
        return {
          ok: true, country, count: list.length, spanDays: T,
          params: { mu: Math.round(mu * 1000) / 1000, alpha: Math.round(alpha * 100) / 100, beta: Math.round(beta * 100) / 100, source: paramsSource, formula: 'λ(t)=μ+Σα·exp(−β·(t−tᵢ))' },
          ex7: Math.round(ex7 * 100) / 100, ex30: Math.round(ex30 * 100) / 100,
          thresholds: th, level,
          replay: replay.map(x => ({ date: x.date, lam: Math.round(x.lam * 1000) / 1000 })),
          forecast: forecast.map(x => ({ h: x.h, lam: Math.round(x.lam * 1000) / 1000, ex: Math.round(x.ex * 100) / 100 })),
          backtest, methodProfile, orgContribution,
          recent: list.slice(-8).reverse().map(e => ({ title: e.title.slice(0, 90), time: new Date(e.t).toISOString().slice(0, 10), severity: e.severity }))
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 手法偏好矩阵（国家×手法概率，多国） */
  router.get('/hawkes/matrix', async (req, res) => {
    try {
      const data = await cache.wrap('hawkes:matrix', async () => {
        const { evs } = await loadEvents();
        const byCountry = new Map();
        evs.filter(e => TERROR_TYPES.includes(e.type)).forEach(e => {
          if (!byCountry.has(e.country)) byCountry.set(e.country, []);
          byCountry.get(e.country).push(e);
        });
        const top = [...byCountry.entries()].filter(([, l]) => l.length >= 20).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
        const rows = top.map(([c, l]) => {
          const dist = namedDist(l, classifyMethod, METHOD_BUCKETS);
          const row = { country: c, count: l.length, methods: {} };
          METHOD_BUCKETS.forEach(b => {
            const hit = dist.find(x => x.k === b.k);
            row.methods[b.n] = hit ? Math.round(hit.c / l.length * 1000) / 10 : 0;
          });
          return row;
        });
        return { ok: true, rows, methodNames: METHOD_BUCKETS.map(b => b.n) };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专题三：绑架行动模型 ============ */
  const kidnapEvents = evs => evs.filter(e => KIDNAP_RE.test(e.title) || KIDNAP_RE.test(e.content));

  router.get('/kidnap', async (req, res) => {
    const country = String(req.query.country || '');
    try {
      const data = await cache.wrap('kidnap:' + (country || 'ALL'), async () => {
        const base = await loadEvents();
        const { evs, t0, spanDays } = base;
        const INTEREST_BASE = require('./interest-base');
        const all = kidnapEvents(evs);
        /* 国家密度（severity 加权） */
        const byCountry = new Map();
        all.forEach(e => {
          if (!byCountry.has(e.country)) byCountry.set(e.country, []);
          byCountry.get(e.country).push(e);
        });
        const density = [...byCountry.entries()].map(([c, l]) => ({
          country: c, count: l.length,
          sevAvg: Math.round(l.reduce((a, e) => a + sevWeight(e.severity), 0) / l.length * 100) / 100
        })).sort((a, b) => b.count - a.count);
        /* 选中国家（或全库）周度趋势 */
        const series = country ? (byCountry.get(country) || []) : all;
        const nWeeks = Math.max(1, Math.ceil(spanDays / 7));
        const weekly = new Array(nWeeks).fill(0);
        series.forEach(e => {
          const w = Math.floor((DAY0(e.t) - DAY0(t0)) / 7);
          if (w >= 0 && w < nWeeks) weekly[w]++;
        });
        /* 高风险时段：星期×小时（小时仅 event_date 带时间的事件，如实标注覆盖） */
        const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
        let withHour = 0;
        series.forEach(e => {
          const d = new Date(e.t);
          heat[d.getUTCDay()][d.getUTCHours()]++;
          if (d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0) withHour++;
        });
        /* 对象风险清单：KEY_PROJECTS 按透明加权公式排序
         * score = 该国绑架数(全窗) × severity均值 × 项目暴露系数(TIER1=1.5/TIER2=1.25/TIER3=1.1，涉华项目基础=1) */
        const tierOf = cn => {
          const t = INTEREST_BASE.getTier ? INTEREST_BASE.getTier(cn) : null;
          return t || 'TIER3'; /* getTier 返回 'TIER1'|'TIER2'|'TIER3'|null */
        };
        const tierFactor = t => t === 'TIER1' ? 1.5 : t === 'TIER2' ? 1.25 : 1.1;
        const objects = (INTEREST_BASE.KEY_PROJECTS || []).map(p => {
          const c = p.country;
          const l = byCountry.get(c) || [];
          const sevAvg = l.length ? l.reduce((a, e) => a + sevWeight(e.severity), 0) / l.length : 0;
          const tier = tierOf(c);
          const score = Math.round(l.length * sevAvg * tierFactor(tier) * 100) / 100;
          return {
            name: p.name, country: c, cat: p.cat, tier,
            kidnapCount: l.length, sevAvg: Math.round(sevAvg * 100) / 100,
            exposure: tierFactor(tier), score,
            formula: l.length + '起 × ' + (Math.round(sevAvg * 100) / 100) + '(severity均值) × ' + tierFactor(tier) + '(TIER' + tier.slice(4) + '暴露)'
          };
        }).sort((a, b) => b.score - a.score).slice(0, 20);
        const topCut = objects.length ? objects[0].score * 0.5 : 0; /* 前 50% 分位标红 */
        /* 相似案例检索在独立端点 */
        const scoped = country ? (byCountry.get(country) || []) : all;
        return {
          ok: true, country: country || null, total: all.length, spanDays,
          windowNote: '数据窗口约 ' + spanDays + ' 天（滚动归档口径），趋势以周度呈现',
          density: density.slice(0, 15),
          weekly: weekly.map((c, i) => ({ w: '第' + (i + 1) + '周', c })),
          rhythm: {
            heat, withHour,
            note: '小时分布基于带时刻的事件（' + withHour + '/' + series.length + '），仅含日期的按 00:00 计入'
          },
          objects: objects.map(o => ({ ...o, red: o.score >= topCut && o.score > 0 })),
          formulaDesc: '对象风险分 = 该国绑架事件数 × severity加权均值 × 项目暴露系数（TIER1=1.5 / TIER2=1.25 / TIER3=1.1，涉华重点项目）',
          survivalNote: '历史绑架案的结案时长字段缺失，不做生存分析（零模拟铁律），仅呈现分布与排序',
          recent: scoped.slice(-10).reverse().map(e => ({
            title: e.title.slice(0, 100), country: e.country, time: new Date(e.t).toISOString().slice(0, 10), severity: e.severity
          }))
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 相似案例检索（Dice 二元组相似度，透明） */
  router.get('/kidnap/search', async (req, res) => {
    const q = String(req.query.q || '').slice(0, 100);
    try {
      if (!q) return res.json({ ok: true, q, results: [] });
      const data = await cache.wrap('kidnap:search:' + q, async () => {
        const { evs } = await loadEvents();
        const all = kidnapEvents(evs);
        const scored = all.map(e => ({
          title: e.title.slice(0, 120), country: e.country,
          time: new Date(e.t).toISOString().slice(0, 10), severity: e.severity,
          sim: Math.round(diceSimilarity(q, e.title) * 1000) / 1000
        })).sort((a, b) => b.sim - a.sim).slice(0, 20);
        return { ok: true, q, method: '题名 Dice 二元组相似度', results: scored };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专题四：国别地缘安全风险模型 ============ */
  const GEO_DIMS = [
    { k: 'political', n: '政治', types: ['political_events'], w: 0.15 },
    { k: 'economic', n: '经济', types: ['economic_risk'], w: 0.15 },
    { k: 'social', n: '社会', types: ['social_unrest'], w: 0.15 },
    { k: 'security', n: '安全', types: ['terror_events', 'military_conflicts'], w: 0.25 },
    { k: 'external', n: '外部干预', types: ['sanctions_data'], w: 0.15 },
    { k: 'china', n: '涉我', types: null, w: 0.15 } /* chinaRelated=true 的全类事件 */
  ];

  function buildGeoModel(evs, t0, spanDays) {
    const nWeeks = Math.max(1, Math.ceil(spanDays / 7));
    /* 国家×周×维 计数 */
    const cube = new Map(); /* country → [weeks][dims] */
    const totals = new Map();
    for (const e of evs) {
      const w = Math.floor((DAY0(e.t) - DAY0(t0)) / 7);
      if (w < 0 || w >= nWeeks) continue;
      const dimIdx = [];
      GEO_DIMS.forEach((d, i) => {
        if (d.k === 'china') { if (e.china) dimIdx.push(i); }
        else if (d.types.includes(e.type)) dimIdx.push(i);
      });
      if (!dimIdx.length) continue; /* 六维之外的事件（如 geopolitical_intel 通用新闻）不计入 */
      if (!cube.has(e.country)) { cube.set(e.country, Array.from({ length: nWeeks }, () => new Array(GEO_DIMS.length).fill(0))); }
      if (!totals.has(e.country)) totals.set(e.country, 0);
      totals.set(e.country, totals.get(e.country) + dimIdx.length);
      const arr = cube.get(e.country);
      dimIdx.forEach(i => arr[w][i]++);
    }
    /* 只对总量 ≥20 的国家建模（样本门槛，如实） */
    const countries = [...cube.keys()].filter(c => (totals.get(c) || 0) >= 20 && c !== '国际' && c !== '未知');
    /* 各维 min-max 归一化（跨国家×周） */
    const norm = {};
    GEO_DIMS.forEach((d, i) => {
      let mn = Infinity, mx = -Infinity;
      countries.forEach(c => cube.get(c).forEach(wk => {
        const v = wk[i];
        if (v < mn) mn = v; if (v > mx) mx = v;
      }));
      norm[d.k] = { mn, mx: mx > mn ? mx : mn + 1 };
    });
    const normVal = (k, v) => (v - norm[k].mn) / (norm[k].mx - norm[k].mn);
    /* R(c,w) = Σ γ_j·norm_j */
    const R = c => cube.get(c).map(wk => {
      let r = 0;
      GEO_DIMS.forEach((d, i) => { r += d.w * normVal(d.k, wk[i]); });
      return Math.round(r * 1000) / 10; /* 0-100 */
    });
    const out = {};
    for (const c of countries) {
      const series = R(c);
      const dims = cube.get(c).map(wk => {
        const o = {};
        GEO_DIMS.forEach((d, i) => {
          o[d.k] = { raw: wk[i], norm: Math.round(normVal(d.k, wk[i]) * 1000) / 1000 };
        });
        return o;
      });
      /* CUSUM 简化变点：前半均值 μ 与 σ；S 累积正偏移，超过 3σ 判风险升级 */
      const half = Math.max(2, Math.floor(series.length / 2));
      const head = series.slice(0, half);
      const mu = head.reduce((a, b) => a + b, 0) / (head.length || 1);
      const sd = Math.sqrt(head.reduce((a, b) => a + (b - mu) ** 2, 0) / (head.length || 1)) || 0.01;
      let S = 0; const cusum = [];
      const changepoints = [];
      series.forEach((v, i) => {
        S = Math.max(0, S + (v - mu - 0.5 * sd));
        cusum.push(Math.round(S * 100) / 100);
        if (S > 3 * sd && (i === 0 || cusum[i - 1] <= 3 * sd)) changepoints.push(i);
      });
      /* 当周 ΔR 六维归因 */
      const cur = series[series.length - 1], prev = series.length > 1 ? series[series.length - 2] : cur;
      const dR = GEO_DIMS.map((d, i) => {
        const curN = normVal(d.k, cube.get(c)[series.length - 1][i]);
        const prevN = normVal(d.k, cube.get(c)[Math.max(0, series.length - 2)][i]);
        return { dim: d.k, name: d.n, contrib: Math.round(d.w * (curN - prevN) * 1000) / 10 };
      });
      out[c] = {
        country: c, totalEvents: totals.get(c), series, weeks: nWeeks, dims,
        curR: cur, prevR: prev, deltaR: Math.round((cur - prev) * 10) / 10,
        cusum, changepoints, attribution: dR.sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
      };
    }
    return { model: out, nWeeks, countries: Object.values(out).sort((a, b) => b.curR - a.curR) };
  }

  router.get('/geo', async (req, res) => {
    const country = String(req.query.country || '');
    try {
      const data = await cache.wrap('geo:' + (country || 'ALL'), async () => {
        const { evs, t0, spanDays } = await loadEvents();
        const { model, nWeeks, countries } = buildGeoModel(evs, t0, spanDays);
        /* COSRI 对照（四维研究底数） */
        let cosri = null;
        try {
          const INTEREST_BASE = require('./interest-base');
          const ind = INTEREST_BASE.COUNTRY_RISK_INDICATORS;
          if (ind) {
            cosri = country && ind.scores[country]
              ? { country, scores: ind.scores[country], asOf: ind.asOf }
              : { note: '选择国家后显示 COSRI 四维对照', asOf: ind.asOf };
          }
        } catch (e) { cosri = { note: 'COSRI 库不可用' }; }
        const weights = GEO_DIMS.map(d => ({ k: d.k, n: d.n, w: d.w }));
        const weekLabels = Array.from({ length: nWeeks }, (_, i) => '第' + (i + 1) + '周');
        if (country) {
          return {
            ok: true, mode: 'country', country, weights, weekLabels, spanDays, cosri,
            dimsMeta: GEO_DIMS.map(d => ({ k: d.k, n: d.n, types: d.types || ['chinaRelated=true'], w: d.w })),
            detail: model[country] || null,
            note: '数据窗口约 ' + spanDays + ' 天 → 采用周度聚合（月度样本不足）；geopolitical_intel 通用新闻类不计入六维（避免虚增）'
          };
        }
        return {
          ok: true, mode: 'all', weights, weekLabels, spanDays, cosri,
          dimsMeta: GEO_DIMS.map(d => ({ k: d.k, n: d.n, types: d.types || ['chinaRelated=true'], w: d.w })),
          ranking: countries.map(x => ({
            country: x.country, curR: x.curR, deltaR: x.deltaR, totalEvents: x.totalEvents,
            upgraded: x.changepoints.length > 0,
            attribution: x.attribution.slice(0, 3),
            lastDims: x.dims[x.dims.length - 1] /* 供前端调权重/情景推演本地重算 */
          })),
          note: '数据窗口约 ' + spanDays + ' 天 → 采用周度聚合（月度样本不足）；geopolitical_intel 通用新闻类不计入六维（避免虚增）'
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 模型异动信号（第一阶段：功能区内告警卡）============ */
  router.get('/alerts', async (req, res) => {
    try {
      const data = await cache.wrap('alerts', async () => {
        const alerts = [];
        /* ① 组织 KL 模式异动 */
        try {
          const { byOrg } = await loadOrgIndex();
          const now = Date.now();
          for (const [oid, evs] of byOrg) {
            if (evs.length < MIN_ORG_EVENTS) continue;
            const obsStart = now - ORG_OBS_DAYS * DAY;
            const base = evs.filter(e => e.t < obsStart);
            const obs = evs.filter(e => e.t >= obsStart);
            if (obs.length < 5 || base.length < 10) continue;
            const kl = klDivergence(distOf(obs, classifyMethod), distOf(base, classifyMethod));
            if (kl > KL_ALERT_THRESHOLD) {
              const org = loadOrgs().find(o => o.id === oid) || { name: oid };
              alerts.push({
                model: '组织行动模式', level: kl > 1 ? 'red' : 'orange',
                title: org.name + ' 行为模式异动（KL=' + kl + ' bit）',
                desc: '近 ' + ORG_OBS_DAYS + ' 天手法分布相对历史基线 KL 散度 ' + kl + '，超过阈值 ' + KL_ALERT_THRESHOLD + '；观测窗 ' + obs.length + ' 起 / 基线 ' + base.length + ' 起'
              });
            }
          }
        } catch (e) { /* 单模型失败不影响其他 */ }
        /* ② Hawkes 红橙级国家 */
        try {
          const ov = await cache.wrap('alerts:hawkes', async () => {
            /* 复用 overview 逻辑 */
            const { evs, t0, spanDays } = await loadEvents();
            const T = spanDays;
            const byCountry = new Map();
            evs.filter(e => TERROR_TYPES.includes(e.type)).forEach(e => {
              if (!byCountry.has(e.country)) byCountry.set(e.country, []);
              byCountry.get(e.country).push(e);
            });
            const fitted = {};
            for (const [c, list] of byCountry) if (list.length >= HAWKES_MIN_EVENTS) fitted[c] = fitHawkes(list.map(e => (e.t - t0) / DAY), T);
            const vals = Object.values(fitted);
            const gAlpha = vals.length ? vals.reduce((a, x) => a + x.alpha, 0) / vals.length : 0.5;
            const gBeta = vals.length ? vals.reduce((a, x) => a + x.beta, 0) / vals.length : 0.1;
            const out = [];
            for (const [c, list] of byCountry) {
              if (list.length < 5) continue;
              const times = list.map(e => (e.t - t0) / DAY);
              const f = fitted[c] || { alpha: gAlpha, beta: gBeta };
              const muC = adaptiveMu(times, T, 21);
              const ex7 = hawkesForecast(times, T, 7, muC, f.alpha, f.beta);
              const daily = new Array(T + 1).fill(0);
              times.forEach(td => { const d = Math.floor(td); if (d >= 0 && d <= T) daily[d]++; });
              const roll7 = [];
              for (let d = 6; d <= T; d++) roll7.push(daily.slice(d - 6, d + 1).reduce((a, b) => a + b, 0));
              const s = roll7.sort((a, b) => a - b);
              const q95 = quantile(s, 0.95), q90 = quantile(s, 0.9);
              if (ex7 >= q95) out.push({ c, ex7, level: 'red', q95 });
              else if (ex7 >= q90) out.push({ c, ex7, level: 'orange', q90 });
            }
            return out;
          });
          ov.forEach(x => alerts.push({
            model: '国别恐袭 Hawkes', level: x.level,
            title: x.c + ' 未来 7 天恐袭强度 ' + (x.level === 'red' ? '红色' : '橙色') + '（期望 ' + x.ex7.toFixed(1) + ' 起）',
            desc: '自激励点过程预测未来 7 天期望 ' + Math.round(x.ex7 * 10) / 10 + ' 起，超过该国历史 7 天滚动计数 ' + (x.level === 'red' ? 'P95' : 'P90') + ' 阈值'
          }));
        } catch (e) { /* 忽略 */ }
        /* ③ 绑架对象标红（前 3） */
        try {
          const kd = await cache.wrap('kidnap:ALL', async () => {
            const { evs } = await loadEvents();
            return kidnapEvents(evs);
          });
          const INTEREST_BASE = require('./interest-base');
          const byCountry = new Map();
          kd.forEach(e => {
            if (!byCountry.has(e.country)) byCountry.set(e.country, []);
            byCountry.get(e.country).push(e);
          });
          const objs = (INTEREST_BASE.KEY_PROJECTS || []).map(p => {
            const l = byCountry.get(p.country) || [];
            const sevAvg = l.length ? l.reduce((a, e) => a + sevWeight(e.severity), 0) / l.length : 0;
            const tier = INTEREST_BASE.getTier ? (INTEREST_BASE.getTier(p.country) || 'TIER3') : 'TIER3';
            const tf = tier === 'TIER1' ? 1.5 : tier === 'TIER2' ? 1.25 : 1.1;
            return { name: p.name, country: p.country, score: l.length * sevAvg * tf, count: l.length };
          }).sort((a, b) => b.score - a.score);
          const top = objs.filter(o => o.score > 0).slice(0, 3);
          top.forEach(o => alerts.push({
            model: '绑架对象风险', level: o.score > 20 ? 'red' : 'orange',
            title: '重点项目绑架风险：' + o.name + '（' + o.country + '）',
            desc: '该国绑架 ' + o.count + ' 起 × severity 加权 × 项目暴露 → 风险分 ' + Math.round(o.score * 100) / 100
          }));
        } catch (e) { /* 忽略 */ }
        /* ④ 地缘风险升级 */
        try {
          const { evs, t0, spanDays } = await loadEvents();
          const { countries } = buildGeoModel(evs, t0, spanDays);
          countries.filter(x => x.changepoints.length > 0 && x.deltaR > 0).slice(0, 5).forEach(x => {
            alerts.push({
              model: '国别地缘风险', level: x.deltaR > 5 ? 'orange' : 'yellow',
              title: x.country + ' 地缘风险升级（CUSUM 变点 ' + x.changepoints.length + ' 处，周 ΔR +' + x.deltaR + '）',
              desc: '主要驱动：' + x.attribution.slice(0, 2).map(a => a.name + (a.contrib > 0 ? '+' : '') + a.contrib).join('、')
            });
          });
        } catch (e) { /* 忽略 */ }
        const order = { red: 0, orange: 1, yellow: 2, blue: 3 };
        alerts.sort((a, b) => order[a.level] - order[b.level]);
        return {
          ok: true, alerts,
          phaseNote: '第一阶段：模型异动信号仅在「专题分析模型」功能区内呈现；预警中心（datahub_store）接入留二期'
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
};
