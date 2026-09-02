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
               data_json->>'chinaRelated' AS china,
               data_json->>'url' AS url,
               data_json->>'city' AS city,
               COALESCE(NULLIF(data_json->>'source',''), source) AS source
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
          url: x.url || '',
          city: x.city || '',
          source: x.source || '',
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

  /* ================================================================
   * 大情报分析中枢 · 六大专项算法端点（2026-09-02 重设计扩展）
   * 每专项 = 算法引擎（下方 GET 端点）+ 智能体（POST /agent/:modelKey）
   * ================================================================ */

  /* ---- 通用小工具 ---- */
  const evBrief = e => ({
    id: e.id, title: e.title.slice(0, 120), country: e.country, city: e.city || '',
    time: new Date(e.t).toISOString().slice(0, 10), severity: e.severity, url: e.url || ''
  });
  const PSEUDO_COUNTRIES = new Set(['国际', '未知', '', '全球', '多国']);

  /* ============ 专项一：恐怖组织动态（org-index / org-network / org-radar）============ */

  /* 组织活动指数：Hawkes 强度 + 地理扩散 + 目标多样性熵 + 战术演进 KL（全透明权重） */
  function buildOrgActivity(byOrg, spanDays, t1) {
    const rows = [];
    const obsDays = Math.min(ORG_OBS_DAYS, spanDays);
    const obsStart = t1 - obsDays * DAY, baseStart = t1 - (obsDays * 2) * DAY;
    for (const [orgId, list] of byOrg.entries()) {
      const org = loadOrgs().find(o => o.id === orgId);
      if (!org) continue;
      const times = list.map(e => e.d).sort((a, b) => a - b);
      const Tdays = Math.max(1, (times[times.length - 1] - times[0]) + 1);
      /* Hawkes 当前强度（复用专项二拟合器；样本少时 μ 用均值） */
      let lam = 0;
      if (times.length >= 8) {
        const fit = fitHawkes(times, Tdays);
        lam = hawkesIntensityAt(times, times[times.length - 1], fit.mu, fit.alpha, fit.beta);
      } else {
        lam = times.length / Math.max(1, Tdays);
      }
      /* 地理扩散：distinct 国家（排除伪国家） */
      const cset = new Set(list.map(e => e.country).filter(c => !PSEUDO_COUNTRIES.has(c)));
      /* 目标多样性熵（bit） */
      const tdist = namedDist(list, classifyTarget, TARGET_BUCKETS);
      const tEntropy = entropy(tdist.map(x => x.c));
      /* 战术演进 KL：近 obsDays vs 之前基线 */
      const nowL = list.filter(e => e.t >= obsStart), baseL = list.filter(e => e.t >= baseStart && e.t < obsStart);
      const kl = (nowL.length >= 5 && baseL.length >= 5)
        ? klDivergence(distOf(nowL, classifyMethod), distOf(baseL, classifyMethod)) : null;
      /* 涉华威胁比例 */
      const chinaHits = list.filter(e => e.china || /中国|中方|中资|中企|华人|Chinese|China|CPEC/i.test(e.title + ' ' + e.content)).length;
      rows.push({
        id: orgId, name: org.name, status: org.status || '', count: list.length,
        lam: Math.round(lam * 1000) / 1000,
        geoSpread: cset.size, countries: [...cset].slice(0, 8),
        targetEntropy: tEntropy, tacticKL: kl, chinaShare: Math.round(chinaHits / list.length * 1000) / 1000,
        sufficient: list.length >= MIN_ORG_EVENTS
      });
    }
    /* 归一化合成活动指数（0-100）：λ 40% + 地理 20% + 目标熵 20% + 战术KL 20% */
    const maxLam = Math.max(...rows.map(r => r.lam), 1e-9);
    const maxGeo = Math.max(...rows.map(r => r.geoSpread), 1);
    const maxH = Math.max(...rows.map(r => r.targetEntropy), 1e-9);
    const maxKL = Math.max(...rows.map(r => r.tacticKL || 0), 1e-9);
    rows.forEach(r => {
      r.activityIndex = Math.round(
        (r.lam / maxLam * 40 + r.geoSpread / maxGeo * 20 + r.targetEntropy / maxH * 20 + ((r.tacticKL || 0) / maxKL * 20)) * 10) / 10;
    });
    rows.sort((a, b) => b.activityIndex - a.activityIndex);
    return rows;
  }

  router.get('/org-index', async (req, res) => {
    try {
      const data = await cache.wrap('v2:org-index', async () => {
        const { evs, t1, spanDays } = await loadEvents();
        const { byOrg } = await loadOrgIndex();
        const rows = buildOrgActivity(byOrg, spanDays, t1);
        return {
          ok: true, total: evs.length, spanDays,
          formula: '活动指数 = λ(Hawkes当前强度,40%) + 地理扩散(distinct国,20%) + 目标多样性熵(20%) + 战术演进KL(近14天vs基线,20%)，各维 min-max 归一化',
          minEvents: MIN_ORG_EVENTS,
          rows
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 组织共现网络：节点=组织，边=同一事件共现计数 */
  router.get('/org-network', async (req, res) => {
    try {
      const data = await cache.wrap('v2:org-network', async () => {
        const { byOrg, evOrgs } = await loadOrgIndex();
        const nodes = [...byOrg.entries()]
          .filter(([, l]) => l.length >= 3)
          .map(([id, l]) => {
            const org = loadOrgs().find(o => o.id === id) || {};
            return { id, name: org.name || id, count: l.length, sufficient: l.length >= MIN_ORG_EVENTS };
          });
        const valid = new Set(nodes.map(n => n.id));
        const edge = new Map();
        for (const orgIds of evOrgs.values()) {
          const ids = [...new Set(orgIds)].filter(x => valid.has(x));
          for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++) {
              const k = ids[i] + '|' + ids[j];
              edge.set(k, (edge.get(k) || 0) + 1);
            }
        }
        const links = [...edge.entries()].filter(([, w]) => w >= 1).map(([k, w]) => {
          const [a, b] = k.split('|');
          return { source: a, target: b, weight: w };
        }).sort((x, y) => y.weight - x.weight);
        return {
          ok: true, nodes, links,
          method: '同事件共现（题名+正文前500字双组织同时命中）',
          note: '组织间关联仅为文本共现统计，不代表真实组织结盟关系'
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 组织能力雷达：六维 0-1（活动强度/地理跨度/战术多样/目标多样/涉华威胁/战术演进） */
  router.get('/org-radar', async (req, res) => {
    const id = String(req.query.id || '');
    try {
      const data = await cache.wrap('v2:org-radar', async () => {
        const { t1, spanDays } = await loadEvents();
        const { byOrg } = await loadOrgIndex();
        const rows = buildOrgActivity(byOrg, spanDays, t1);
        return { rows, spanDays };
      });
      const rows = data.rows;
      const me = rows.find(r => r.id === id) || rows[0];
      if (!me) return res.json({ ok: false, error: '组织无归因事件' });
      const maxLam = Math.max(...rows.map(r => r.lam), 1e-9);
      const maxGeo = Math.max(...rows.map(r => r.geoSpread), 1);
      const maxH = Math.max(...rows.map(r => r.targetEntropy), 1e-9);
      const maxKL = Math.max(...rows.map(r => r.tacticKL || 0), 1e-9);
      const maxChina = Math.max(...rows.map(r => r.chinaShare), 1e-9);
      const { byOrg } = await loadOrgIndex();
      const list = byOrg.get(me.id) || [];
      const mdist = namedDist(list, classifyMethod, METHOD_BUCKETS);
      const mEntropy = entropy(mdist.map(x => x.c));
      const axes = [
        { k: 'strength', n: '活动强度', v: Math.round(me.lam / maxLam * 100) / 100 },
        { k: 'geo', n: '地理跨度', v: Math.round(me.geoSpread / maxGeo * 100) / 100 },
        { k: 'tactic', n: '战术多样', v: Math.round(mEntropy / Math.log2(8) * 100) / 100 },
        { k: 'target', n: '目标多样', v: Math.round(me.targetEntropy / Math.log2(7) * 100) / 100 },
        { k: 'china', n: '涉华威胁', v: Math.round(me.chinaShare / maxChina * 100) / 100 },
        { k: 'evolution', n: '战术演进', v: me.tacticKL == null ? 0 : Math.min(1, Math.round(me.tacticKL / maxKL * 100) / 100) }
      ];
      res.json({
        ok: true, id: me.id, name: me.name, count: me.count, sufficient: me.sufficient,
        minEvents: MIN_ORG_EVENTS, axes, activityIndex: me.activityIndex,
        normNote: '战术/目标多样按满熵归一；其余按全榜 max 归一（相对量纲）'
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专项二：国别恐袭行为画像（behavior?country=）============ */

  /* 伤亡数字抽取（题名+正文正则；无数字不编造） */
  function extractCasualties(events) {
    const reDead = /(\d{1,4})\s*(?:人)?(?:死亡|遇难|丧生|身亡|被打死|killed|dead|deaths)/i;
    const reInj = /(\d{1,4})\s*(?:人)?(?:受伤|受伤者|injured|wounded)/i;
    let dead = [], inj = [], covered = 0;
    for (const e of events) {
      const t = e.title + ' ' + e.content;
      const m1 = t.match(reDead), m2 = t.match(reInj);
      if (m1) { dead.push(parseInt(m1[1], 10)); covered++; }
      if (m2) inj.push(parseInt(m2[1], 10));
    }
    const stat = a => a.length ? {
      n: a.length, avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10,
      max: Math.max(...a), p90: Math.round(quantile([...a].sort((x, y) => x - y), 0.9) * 10) / 10
    } : null;
    return { dead: stat(dead), injured: stat(inj), covered, total: events.length, note: '伤亡数字按题名/正文正则抽取，未含数字事件不计入统计' };
  }

  router.get('/behavior', async (req, res) => {
    const country = String(req.query.country || '尼日利亚');
    try {
      const data = await cache.wrap('v2:behavior:' + country, async () => {
        const { evs, t0, spanDays } = await loadEvents();
        const list = evs.filter(e => TERROR_TYPES.includes(e.type) && e.country === country);
        if (list.length < 5) return { ok: true, insufficient: true, count: list.length, minEvents: 5, country, note: '样本不足（需≥5），不生成行为画像' };
        /* 时段/星期分布（带时刻事件子集） */
        const hourHist = new Array(24).fill(0), weekHist = new Array(7).fill(0);
        let withHour = 0;
        for (const e of list) {
          const d = new Date(e.t);
          const h = d.getUTCHours();
          if (h !== 0 || d.getUTCMinutes() !== 0) { hourHist[h]++; withHour++; }
          weekHist[d.getUTCDay()]++;
        }
        /* 手法/目标 */
        const methods = namedDist(list, classifyMethod, METHOD_BUCKETS);
        const targets = namedDist(list, classifyTarget, TARGET_BUCKETS);
        /* 伤亡模式 */
        const casualty = extractCasualties(list);
        /* 热点迁移：按半月 × 城市/地点聚合 */
        const halfSpan = Math.max(7, Math.floor(spanDays / 2));
        const firstHalf = list.filter(e => e.t < t0 + halfSpan * DAY);
        const secondHalf = list.filter(e => e.t >= t0 + halfSpan * DAY);
        const aggCity = arr => {
          const m = new Map();
          arr.forEach(e => { const k = e.city || e.country; m.set(k, (m.get(k) || 0) + 1); });
          return [...m.entries()].map(([k, c]) => ({ place: k, c })).sort((a, b) => b.c - a.c).slice(0, 6);
        };
        /* Hawkes 7 日预测（复用拟合器 + 自适应 μ） */
        const times = list.map(e => e.d).sort((a, b) => a - b);
        let hawkes = null;
        if (times.length >= HAWKES_MIN_EVENTS) {
          const fit = fitHawkes(times, spanDays);
          const nowDay = DAY0(Date.now());
          const mu = adaptiveMu(times, nowDay, 21);
          const lamNow = hawkesIntensityAt(times, nowDay, mu, fit.alpha, fit.beta);
          hawkes = {
            params: { mu, alpha: fit.alpha, beta: fit.beta },
            lamNow: Math.round(lamNow * 100) / 100,
            ex7: Math.round(hawkesForecast(times, nowDay, 7, mu, fit.alpha, fit.beta) * 100) / 100,
            ex30: Math.round(hawkesForecast(times, nowDay, 30, mu, fit.alpha, fit.beta) * 100) / 100
          };
        }
        /* 事件链聚类：3 日窗口同国 ≥3 起连续（回溯链） */
        const chains = [];
        let cur = null;
        times.forEach((d, i) => {
          if (cur && d - cur.last <= 3) { cur.last = d; cur.count++; }
          else { if (cur && cur.count >= 3) chains.push(cur); cur = { start: d, last: d, count: 1 }; }
        });
        if (cur && cur.count >= 3) chains.push(cur);
        const chainOut = chains.map(c => ({
          start: new Date(c.start * DAY).toISOString().slice(0, 10),
          end: new Date(c.last * DAY).toISOString().slice(0, 10),
          count: c.count, days: c.last - c.start + 1
        })).sort((a, b) => b.count - a.count).slice(0, 8);
        return {
          ok: true, insufficient: false, country, count: list.length, spanDays,
          ttp: {
            hourHist, withHour, weekHist, methods, targets, casualty,
            hourNote: '小时分布基于带时刻事件 ' + withHour + '/' + list.length + ' 起'
          },
          hotspotMig: { firstHalf: aggCity(firstHalf), secondHalf: aggCity(secondHalf), halfSpanDays: halfSpan },
          hawkes, chains: chainOut,
          recent: list.slice(-12).reverse().map(evBrief),
          evidenceIds: list.map(e => e.id)
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专项三：海外绑架行动模式（kidnap-modes）============ */
  const KIDNAP_MODES = [
    { k: 'ransom', n: '赎金勒索型', re: /赎金|ransom/i, desc: '以赎金为目的，典型于尼日利亚/萨赫勒' },
    { k: 'hijack', n: '劫持载具型', re: /劫持|hijack|劫车|劫机|劫持客车|bus hijack/i, desc: '劫持车辆/飞机/船只连带人质' },
    { k: 'quick', n: '快闪/未遂型', re: /未遂|foiled|thwart|挫败.*绑架|绑架.*挫败|quick snatch/i, desc: '快速劫持或未遂案件' },
    { k: 'militant', n: '武装组织绑架', re: /武装分子|gunmen|叛军|militant|insurgent|terrorist/i, desc: '武装组织实施，常涉政治诉求' },
    { k: 'other', n: '其他/未明', re: null, desc: '上述模式未命中' }
  ];
  const VICTIM_NATS = [
    ['中国公民', /中国公民|中国籍|Chinese (national|citizen)s?|chinese workers?|中方人员/i],
    ['美国', /美国公民|American (national|citizen)s?|US (national|citizen)s?|Americans?/i],
    ['法国', /法国|French (national|citizen)s?|French/i],
    ['印度', /印度|Indian (national|citizen)s?|Indians?/i],
    ['土耳其', /土耳其|Turkish/i],
    ['韩国', /韩国|Korean/i],
    ['日本', /日本|Japanese/i],
    ['菲律宾', /菲律宾|Filipino/i],
    ['俄罗斯', /俄罗斯|Russian/i],
    ['英国', /英国|British/i],
    ['德国', /德国|German/i],
    ['意大利', /意大利|Italian/i],
    ['西班牙', /西班牙|Spanish/i],
    ['加拿大', /加拿大|Canadian/i],
    ['澳大利亚', /澳大利亚|Australian/i],
    ['南非', /南非|South African/i],
    ['哥伦比亚', /哥伦比亚|Colombian/i],
    ['墨西哥', /墨西哥|Mexican/i],
    ['巴西', /巴西|Brazilian/i],
    ['缅甸', /缅甸|Myanmar/i],
    ['泰国', /泰国|Thai/i],
    ['巴基斯坦', /巴基斯坦|Pakistani/i],
    ['尼日利亚', /尼日利亚|Nigerian/i]
  ];
  const VICTIM_ROLES = [
    ['工程/矿业人员', /工程师|engineer|矿工|miner|工程人员|technician/i],
    ['工人/劳工', /工人|worker|laborer|劳工/i],
    ['企业雇员/商人', /商人|businessman|经理|manager|雇员|employee|staff|executive/i],
    ['记者/媒体', /记者|journalist|reporter|media/i],
    ['宗教人士', /传教士|missionary|牧师|priest|修女|nun/i],
    ['医疗人员', /医生|doctor|护士|nurse|medical/i],
    ['教师/学生', /教师|teacher|学生|student|教授|professor/i],
    ['游客', /游客|tourist|traveler|traveller/i],
    ['海员/船员', /海员|sailor|船员|crew|seafarer/i],
    ['援助人员', /援助|aid worker|人道|humanitarian/i]
  ];

  router.get('/kidnap-modes', async (req, res) => {
    try {
      const data = await cache.wrap('v2:kidnap-modes', async () => {
        const { evs, t0, spanDays } = await loadEvents();
        const all = evs.filter(e => KIDNAP_RE.test(e.title) || KIDNAP_RE.test(e.content));
        /* 模式聚类（规则优先级，透明） */
        const modeRows = KIDNAP_MODES.map(m => ({ ...m, count: 0, events: [] }));
        for (const e of all) {
          const t = e.title + ' ' + e.content;
          let hit = modeRows.find(m => m.re && m.re.test(t));
          if (!hit) hit = modeRows[modeRows.length - 1];
          hit.count++;
          if (hit.events.length < 5) hit.events.push(e);
        }
        const modes = modeRows.map(m => ({
          k: m.k, n: m.n, desc: m.desc, count: m.count,
          share: all.length ? Math.round(m.count / all.length * 1000) / 10 : 0,
          samples: m.events.map(evBrief)
        })).filter(m => m.count > 0);
        /* 受害画像：国籍/职业（题名+正文正则） */
        const natCnt = {}, roleCnt = {};
        const natByCountry = new Map();
        for (const e of all) {
          const t = e.title + ' ' + e.content;
          for (const [n, re] of VICTIM_NATS) {
            if (re.test(t)) {
              natCnt[n] = (natCnt[n] || 0) + 1;
              if (!natByCountry.has(e.country)) natByCountry.set(e.country, {});
              const o = natByCountry.get(e.country); o[n] = (o[n] || 0) + 1;
              break;
            }
          }
          for (const [n, re] of VICTIM_ROLES) { if (re.test(t)) { roleCnt[n] = (roleCnt[n] || 0) + 1; break; } }
        }
        /* 绑架走廊：发生国 → 受害国籍（可识别子集） */
        const corridors = [...natByCountry.entries()].map(([c, o]) => {
          const top = Object.entries(o).sort((a, b) => b[1] - a[1])[0];
          return { from: c, toLabel: top[0], count: top[1], total: all.filter(e => e.country === c).length };
        }).sort((a, b) => b.count - a.count).slice(0, 10);
        /* 周度趋势 */
        const nWeeks = Math.max(1, Math.ceil(spanDays / 7));
        const weekly = new Array(nWeeks).fill(0);
        all.forEach(e => { const w = Math.floor((e.t - t0) / (7 * DAY)); if (w >= 0 && w < nWeeks) weekly[w]++; });
        return {
          ok: true, total: all.length, spanDays, modes,
          victimNat: Object.entries(natCnt).map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c),
          victimRole: Object.entries(roleCnt).map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c),
          victimNote: '受害画像按题名/正文正则识别，未识别 ' + (all.length - Object.values(natCnt).reduce((a, b) => a + b, 0)) + ' 起不计入',
          corridors,
          weekly: weekly.map((c, i) => ({ w: '第' + (i + 1) + '周', c })),
          evidenceIds: all.map(e => e.id)
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专项四：地缘溢出传导 + 30 日趋势（geo-spill?country=）============ */
  const NEIGHBORS = {
    '巴基斯坦': ['印度', '阿富汗', '伊朗', '中国'],
    '尼日利亚': ['尼日尔', '乍得', '喀麦隆', '贝宁'],
    '阿富汗': ['巴基斯坦', '伊朗', '塔吉克斯坦', '乌兹别克斯坦', '土库曼斯坦', '中国'],
    '缅甸': ['泰国', '老挝', '印度', '孟加拉国', '中国'],
    '刚果（金）': ['乌干达', '卢旺达', '布隆迪', '坦桑尼亚', '赞比亚', '安哥拉', '中非共和国', '南苏丹'],
    '马里': ['尼日尔', '布基纳法索', '阿尔及利亚', '毛里塔尼亚', '几内亚', '科特迪瓦', '塞内加尔'],
    '尼日尔': ['尼日利亚', '马里', '布基纳法索', '利比亚', '阿尔及利亚', '乍得', '贝宁'],
    '索马里': ['肯尼亚', '埃塞俄比亚', '吉布提'],
    '也门': ['沙特阿拉伯', '阿曼'],
    '印度': ['巴基斯坦', '尼泊尔', '不丹', '孟加拉国', '缅甸', '中国'],
    '伊朗': ['伊拉克', '土耳其', '阿富汗', '巴基斯坦', '亚美尼亚', '阿塞拜疆', '土库曼斯坦'],
    '伊拉克': ['叙利亚', '伊朗', '土耳其', '约旦', '科威特', '沙特阿拉伯'],
    '苏丹': ['南苏丹', '埃及', '利比亚', '乍得', '中非共和国', '埃塞俄比亚', '厄立特里亚'],
    '南苏丹': ['苏丹', '埃塞俄比亚', '肯尼亚', '乌干达', '刚果（金）', '中非共和国'],
    '利比亚': ['埃及', '突尼斯', '阿尔及利亚', '尼日尔', '乍得', '苏丹'],
    '墨西哥': ['美国', '危地马拉', '伯利兹'],
    '哥伦比亚': ['委内瑞拉', '巴西', '秘鲁', '厄瓜多尔', '巴拿马'],
    '委内瑞拉': ['哥伦比亚', '巴西', '圭亚那'],
    '肯尼亚': ['索马里', '埃塞俄比亚', '乌干达', '坦桑尼亚', '南苏丹'],
    '埃塞俄比亚': ['索马里', '肯尼亚', '苏丹', '南苏丹', '厄立特里亚', '吉布提'],
    '叙利亚': ['土耳其', '伊拉克', '约旦', '以色列', '黎巴嫩'],
    '泰国': ['缅甸', '老挝', '柬埔寨', '马来西亚'],
    '印度尼西亚': ['马来西亚', '巴布亚新几内亚', '东帝汶'],
    '几内亚': ['几内亚比绍', '塞内加尔', '马里', '科特迪瓦', '利比里亚', '塞拉利昂'],
    '布基纳法索': ['马里', '尼日尔', '贝宁', '多哥', '加纳', '科特迪瓦'],
    '喀麦隆': ['尼日利亚', '乍得', '中非共和国', '刚果（布）', '加蓬', '赤道几内亚'],
    '秘鲁': ['厄瓜多尔', '哥伦比亚', '巴西', '玻利维亚', '智利'],
    '智利': ['秘鲁', '玻利维亚', '阿根廷'],
    '阿根廷': ['智利', '玻利维亚', '巴拉圭', '巴西', '乌拉圭'],
    '土耳其': ['叙利亚', '伊拉克', '伊朗', '亚美尼亚', '格鲁吉亚', '希腊', '保加利亚']
  };

  router.get('/geo-spill', async (req, res) => {
    const country = String(req.query.country || '尼日利亚');
    try {
      const data = await cache.wrap('v2:geo-spill:' + country, async () => {
        const { evs, t0, spanDays } = await loadEvents();
        const nbs = NEIGHBORS[country] || [];
        const nWeeks = Math.max(1, Math.ceil(spanDays / 7));
        /* 本国与邻国防袭+军事周度序列，算 Pearson 相关 + 邻国 R 值 */
        const secTypes = SECURITY_TYPES;
        const weekSeries = c => {
          const w = new Array(nWeeks).fill(0);
          evs.forEach(e => {
            if (e.country === c && secTypes.includes(e.type)) {
              const k = Math.floor((e.t - t0) / (7 * DAY));
              if (k >= 0 && k < nWeeks) w[k]++;
            }
          });
          return w;
        };
        const pearson = (a, b) => {
          const n = a.length;
          if (n < 3) return null;
          const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
          let num = 0, da = 0, db = 0;
          for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
          if (da === 0 || db === 0) return null;
          return Math.round(num / Math.sqrt(da * db) * 100) / 100;
        };
        const meW = weekSeries(country);
        /* 复用 geo 六维模型取邻国 R */
        const { countries: geoAll } = buildGeoModel(evs, t0, spanDays);
        const geoMap = new Map(geoAll.map(g => [g.country, g]));
        const spill = nbs.map(nb => {
          const w = weekSeries(nb);
          const total = w.reduce((a, b) => a + b, 0);
          const g = geoMap.get(nb);
          return {
            neighbor: nb, secTotal: total,
            R: g ? g.R : null, deltaR: g ? g.deltaR : null,
            corr: total >= 3 ? pearson(meW, w) : null,
            weekly: w
          };
        }).sort((a, b) => (b.secTotal - a.secTotal));
        /* 本国 30 日趋势预测：周度 R 序列线性回归外推 4 周 + 1.96σ 置信带 */
        const me = geoMap.get(country);
        let forecast30 = null;
        if (me && me.series && me.series.length >= 4) {
          const ys = me.series;
          const n = ys.length;
          const xs = ys.map((_, i) => i);
          const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
          let num = 0, den = 0;
          for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
          const b = den ? num / den : 0, a = my - b * mx;
          const resid = ys.map((y, i) => y - (a + b * xs[i]));
          const sigma = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2));
          forecast30 = [1, 2, 3, 4].map(k => {
            const x = n - 1 + k;
            const pred = a + b * x;
            const se = sigma * Math.sqrt(1 + 1 / n + ((x - mx) ** 2) / (den || 1));
            return {
              w: '未来第' + k + '周',
              pred: Math.round(pred * 10) / 10,
              lo: Math.round(Math.max(0, pred - 1.96 * se) * 10) / 10,
              hi: Math.round((pred + 1.96 * se) * 10) / 10
            };
          });
        }
        return {
          ok: true, country, spanDays, nWeeks,
          spill, spillNote: '传导强度 = 邻国防袭/军事事件量；corr = 与本国周度安全事件序列 Pearson 相关（样本≥3 周才计算）',
          forecast30, forecastNote: forecast30 ? '线性回归外推 4 周 ± 1.96σ 置信带（仅趋势参考，非因果预测）' : '样本不足（需≥4 周），不做趋势外推',
          meWeekly: meW,
          curR: me ? me.curR : null, deltaR: me ? me.deltaR : null, changepoints: me ? me.changepoints : [],
          evidenceIds: evs.filter(e => e.country === country && secTypes.includes(e.type)).slice(-60).map(e => e.id)
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专项五：对华制裁专项（sanctions）============ */
  const SANCTION_RE = /制裁|sanction|实体清单|entity list|出口管制|export control|禁运|embargo|SDN|OFAC|投资限制|investment ban|投资禁令|签证限制|visa ban|冻结资产|asset freeze|关税|tariff|CFIUS/i;
  const SANCTION_TYPES = [
    { k: 'export', n: '出口管制/实体清单', re: /出口管制|export control|entity list|实体清单|EAR|未经核实清单|unverified list/i },
    { k: 'financial', n: '金融制裁', re: /金融制裁|financial sanction|冻结|asset freeze|SDN|SWIFT|银行.*制裁|secondary sanction|次级制裁/i },
    { k: 'invest', n: '投资限制', re: /投资限制|investment (ban|restriction)|投资禁令|CFIUS|投资审查|outbound investment/i },
    { k: 'visa', n: '签证/旅行限制', re: /签证限制|visa (ban|restriction)|旅行禁令|travel ban/i },
    { k: 'trade', n: '关税/贸易措施', re: /关税|tariff|贸易制裁|trade sanction|禁运|embargo|301|反倾销|anti-dumping/i }
  ];
  const CN_ENTITIES = [
    ['华为', /华为|Huawei/i], ['中芯国际', /中芯|SMIC/i], ['大疆', /大疆|DJI/i],
    ['中兴', /中兴|ZTE/i], ['海康威视', /海康|Hikvision/i], ['字节跳动/TikTok', /字节|TikTok|ByteDance/i],
    ['腾讯', /腾讯|Tencent/i], ['阿里巴巴', /阿里|Alibaba/i], ['商汤', /商汤|SenseTime/i],
    ['科大讯飞', /科大讯飞|iFlytek/i], ['旷视', /旷视|Megvii/i], ['大华', /大华|Dahua/i],
    ['中电科', /中电科|CETC/i], ['中国船舶', /中国船舶|CSSC/i], ['航天科技', /航天科技|CASC/i],
    ['北方工业', /北方工业|NORINCO/i], ['中广核', /中广核|CGN/i], ['中国移动', /中国移动|China Mobile/i],
    ['中国电信', /中国电信|China Telecom/i], ['中国联通', /中国联通|China Unicom/i],
    ['长江存储', /长江存储|YMTC/i], ['寒武纪', /寒武纪|Cambricon/i], ['浪潮', /浪潮|Inspur/i]
  ];

  async function loadSanctionEvents() {
    return cache.wrap('v2:base-sanctions', async () => {
      const { evs, t0, spanDays } = await loadEvents();
      const hits = evs.filter(e => SANCTION_RE.test(e.title) || SANCTION_RE.test(e.content));
      return { hits, t0, spanDays };
    });
  }

  router.get('/sanctions', async (req, res) => {
    try {
      const data = await cache.wrap('v2:sanctions', async () => {
        const INTEREST_BASE = require('./interest-base');
        const { hits, t0, spanDays } = await loadSanctionEvents();
        /* 类型分类 */
        const typeCnt = new Map();
        const evType = e => {
          const t = e.title + ' ' + e.content;
          for (const ty of SANCTION_TYPES) if (ty.re.test(t)) return ty;
          return { k: 'other', n: '其他/综合' };
        };
        /* 实体抽取 */
        const entMap = new Map(); /* name → {hits,latest,evidence[]} */
        /* 涉我项目关联 */
        const projMap = new Map();
        for (const e of hits) {
          const ty = evType(e);
          typeCnt.set(ty.n, (typeCnt.get(ty.n) || 0) + 1);
          const t = e.title + ' ' + e.content;
          for (const [n, re] of CN_ENTITIES) {
            if (re.test(t)) {
              if (!entMap.has(n)) entMap.set(n, { name: n, hits: 0, latest: null, evidence: [] });
              const o = entMap.get(n); o.hits++;
              if (o.evidence.length < 4) o.evidence.push(e);
              if (!o.latest || e.t > o.latest.t) o.latest = e;
              break;
            }
          }
          const projs = INTEREST_BASE.matchProjects(t);
          for (const p of projs) {
            if (!projMap.has(p.name)) projMap.set(p.name, { name: p.name, country: p.country, hits: 0, latest: null });
            const o = projMap.get(p.name); o.hits++;
            if (!o.latest || e.t > o.latest.t) o.latest = e;
          }
        }
        /* 时间线：周度聚合 */
        const nWeeks = Math.max(1, Math.ceil(spanDays / 7));
        const weekly = new Array(nWeeks).fill(0);
        hits.forEach(e => { const w = Math.floor((e.t - t0) / (7 * DAY)); if (w >= 0 && w < nWeeks) weekly[w]++; });
        const entities = [...entMap.values()].sort((a, b) => b.hits - a.hits).map(o => ({
          name: o.name, hits: o.hits,
          latest: o.latest ? new Date(o.latest.t).toISOString().slice(0, 10) : null,
          latestTitle: o.latest ? o.latest.title.slice(0, 90) : '',
          evidence: o.evidence.map(evBrief)
        }));
        return {
          ok: true, total: hits.length, spanDays,
          scope: 'sanctions_data 分类 + 全库题名/正文制裁关键词命中（中英双语）',
          weekly: weekly.map((c, i) => ({ w: '第' + (i + 1) + '周', c })),
          types: [...typeCnt.entries()].map(([n, c]) => ({ n, c })).sort((a, b) => b.c - a.c),
          entities, entityNote: entities.length ? '实体按内置中企/机构词表正则抽取' : '窗口内未识别到具名中企实体（仅政策/宏观类制裁情报）',
          projects: [...projMap.values()].sort((a, b) => b.hits - a.hits).map(o => ({ ...o, latest: new Date(o.latest.t).toISOString().slice(0, 10) })),
          recent: hits.slice(-20).reverse().map(e => ({ ...evBrief(e), stype: evType(e).n })),
          evidenceIds: hits.map(e => e.id)
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 专项六：关键矿产及海关监控（minerals）============ */
  const MINERAL_TERMS = [
    { k: 'lithium', n: '锂', re: /锂|lithium/i },
    { k: 'cobalt', n: '钴', re: /钴|cobalt/i },
    { k: 'copper', n: '铜', re: /铜矿|铜|copper/i },
    { k: 'rare_earth', n: '稀土', re: /稀土|rare earth/i },
    { k: 'nickel', n: '镍', re: /镍|nickel/i },
    { k: 'bauxite', n: '铝土矿', re: /铝土|bauxite|氧化铝|alumina/i },
    { k: 'iron', n: '铁矿', re: /铁矿|iron ore/i },
    { k: 'uranium', n: '铀矿', re: /铀|uranium/i },
    { k: 'gold', n: '金矿', re: /金矿|gold mine/i }
  ];
  const CUSTOMS_TERMS = [
    { k: 'customs', n: '海关/关税', re: /海关|customs|关税|tariff/i },
    { k: 'port', n: '港口/码头', re: /港口|port strike|码头|terminal|harbor|harbour|seaport/i },
    { k: 'strike', n: '罢工/封锁', re: /罢工|strike|封锁|blockade|中断|disruption/i },
    { k: 'export_ban', n: '出口禁令', re: /出口禁令|export ban|禁止出口|export restriction|出口限制|出口配额/i }
  ];
  const MINERAL_ANY_RE = new RegExp([...MINERAL_TERMS, ...CUSTOMS_TERMS].map(x => x.re.source).join('|'), 'i');

  async function loadMineralEvents() {
    return cache.wrap('v2:base-minerals', async () => {
      const { evs, t0, spanDays } = await loadEvents();
      const hits = evs.filter(e => MINERAL_ANY_RE.test(e.title) || MINERAL_ANY_RE.test(e.content));
      return { hits, t0, spanDays };
    });
  }

  router.get('/minerals', async (req, res) => {
    try {
      const data = await cache.wrap('v2:minerals', async () => {
        const INTEREST_BASE = require('./interest-base');
        const { hits, t0, spanDays } = await loadMineralEvents();
        const { evs } = await loadEvents();
        const { countries: geoAll } = buildGeoModel(evs, t0, spanDays);
        const geoMap = new Map(geoAll.map(g => [g.country, g]));
        /* 矿产/海关分类计数 */
        const mineralCnt = MINERAL_TERMS.map(m => ({ k: m.k, n: m.n, c: hits.filter(e => m.re.test(e.title + ' ' + e.content)).length })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
        const customsCnt = CUSTOMS_TERMS.map(m => ({ k: m.k, n: m.n, c: hits.filter(e => m.re.test(e.title + ' ' + e.content)).length })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
        /* 矿产项目映射（KEY_PROJECTS 中 cat=mineral）+ 事件关联 + 供应链风险指数 */
        const mineralProjects = (INTEREST_BASE.KEY_PROJECTS || []).filter(p => p.cat === 'mineral');
        const projRows = mineralProjects.map(p => {
          const related = hits.filter(e => p.re.test(e.title + ' ' + e.content));
          const sevAvg = related.length ? related.reduce((a, e) => a + sevWeight(e.severity), 0) / related.length : 0;
          const g = geoMap.get(p.country);
          const geoR = g ? g.curR : 0;
          /* 咽喉通道命中 */
          const chSet = new Set();
          related.forEach(e => INTEREST_BASE.matchChannels(e.title + ' ' + e.content).forEach(c => chSet.add(c.name)));
          /* 供应链风险指数 = 事件数 × severity均值 × (1+geoR/100) × (1+通道命中×0.15)，满分不限，>15 标红 */
          const supplyRisk = Math.round(related.length * sevAvg * (1 + geoR / 100) * (1 + chSet.size * 0.15) * 100) / 100;
          return {
            name: p.name, country: p.country, hits: related.length,
            sevAvg: Math.round(sevAvg * 100) / 100, geoR,
            channels: [...chSet], supplyRisk,
            formula: related.length + '起 × ' + (Math.round(sevAvg * 100) / 100) + '(sev均值) × (1+' + geoR + '/100 国别R) × (1+' + chSet.size + '×0.15 通道)',
            latest: related.length ? new Date(Math.max(...related.map(e => e.t))).toISOString().slice(0, 10) : null,
            samples: related.slice(-3).map(evBrief)
          };
        }).sort((a, b) => b.supplyRisk - a.supplyRisk);
        /* 供应链风险总榜（国家维度）：矿产事件国 × geoR */
        const cMap = new Map();
        hits.forEach(e => { if (!PSEUDO_COUNTRIES.has(e.country)) cMap.set(e.country, (cMap.get(e.country) || 0) + 1); });
        const countryRisk = [...cMap.entries()].map(([c, n]) => {
          const g = geoMap.get(c);
          return { country: c, hits: n, geoR: g ? g.curR : null, deltaR: g ? g.deltaR : null };
        }).sort((a, b) => b.hits - a.hits).slice(0, 12);
        /* 周度情报流 */
        const nWeeks = Math.max(1, Math.ceil(spanDays / 7));
        const weekly = new Array(nWeeks).fill(0);
        hits.forEach(e => { const w = Math.floor((e.t - t0) / (7 * DAY)); if (w >= 0 && w < nWeeks) weekly[w]++; });
        return {
          ok: true, total: hits.length, spanDays,
          scope: '锂/钴/铜/稀土/镍/铝土/铁/铀/金 + 海关/港口/罢工/出口禁令 关键词命中',
          mineralCnt, customsCnt, projects: projRows,
          riskFormula: '供应链风险指数 = 项目事件数 × severity均值 × (1+国别R/100) × (1+咽喉通道命中×0.15)',
          countryRisk, weekly: weekly.map((c, i) => ({ w: '第' + (i + 1) + '周', c })),
          recent: hits.slice(-20).reverse().map(evBrief),
          evidenceIds: hits.map(e => e.id)
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ============ 事件详情（证据链展开用）============ */
  router.get('/event/:id', async (req, res) => {
    const id = String(req.params.id || '');
    try {
      const { evs } = await loadEvents();
      const e = evs.find(x => x.id === id);
      if (!e) return res.json({ ok: false, error: '事件不存在或不在当前窗口' });
      const { evOrgs } = await loadOrgIndex();
      const orgTags = (evOrgs.get(id) || []).map(oid => (loadOrgs().find(o => o.id === oid) || {}).name).filter(Boolean);
      res.json({
        ok: true, event: {
          id: e.id, title: e.title, country: e.country, city: e.city || '',
          severity: e.severity, time: new Date(e.t).toISOString().replace('T', ' ').slice(0, 16),
          url: e.url || '', source: e.source || '', content: e.content,
          type: e.type, china: e.china, orgTags
        }
      });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  /* ================================================================
   * 智能体统一端点：POST /agent/:modelKey
   * 数据装配（真实计算+事件样本）→ Kimi 主 → Spark 备 → 规则化模板降级
   * 返回 { ok, agent:{sections:[{title,body}], evidenceIds, model, source, elapsed} }
   * ================================================================ */

  /* OpenAI 兼容直连（与 server.js _callOpenAiCompat 同款；自包含避免跨文件依赖） */
  function llmCallOne(pv, prompt) {
    return new Promise(resolve => {
      try {
        const https = require('https');
        const body = JSON.stringify({ model: pv.model, messages: [{ role: 'user', content: prompt }], max_tokens: pv.maxTokens });
        const u = new URL(pv.base.replace(/\/+$/, '') + '/chat/completions');
        const rq = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: pv.timeout, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pv.key, 'Content-Length': Buffer.byteLength(body) } }, r2 => {
          const chunks = [];
          r2.on('data', c => chunks.push(c));
          r2.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let j = {};
            try { j = JSON.parse(raw); } catch (e) { return resolve({ text: '', error: '解析失败(HTTP ' + r2.statusCode + ')' }); }
            if (j.error || (j.code && j.code !== 0)) return resolve({ text: '', error: 'HTTP ' + r2.statusCode + ' ' + ((j.error && j.error.message) || j.message || j.code) });
            const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
            if (!msg.content) return resolve({ text: '', error: '空内容' });
            resolve({ text: msg.content, error: '' });
          });
        });
        rq.on('error', e => resolve({ text: '', error: e.message }));
        rq.on('timeout', () => { rq.destroy(); resolve({ text: '', error: '调用超时' }); });
        rq.end(body);
      } catch (e) { resolve({ text: '', error: e.message }); }
    });
  }
  async function llmChain(prompt) {
    const providers = [
      { name: 'Kimi', base: process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1', key: process.env.LLM_API_KEY || '', model: process.env.LLM_MODEL || 'kimi-k2.6', maxTokens: 4000, timeout: 90000 },
      { name: 'Spark', base: process.env.LLM2_BASE_URL || 'https://spark-api-open.xf-yun.com/v1', key: process.env.LLM2_API_KEY || '', model: process.env.LLM2_MODEL || '4.0Ultra', maxTokens: 3000, timeout: 60000 }
    ].filter(x => x.key);
    let lastErr = '未配置 LLM_API_KEY';
    for (const pv of providers) {
      const r = await llmCallOne(pv, prompt);
      if (r.text) return { text: r.text, model: pv.model, usedBy: pv.name, lastErr: '' };
      lastErr = pv.name + ': ' + (r.error || '空内容');
      console.warn('[MODELS-AGENT] ' + pv.name + ' 失败，切换下一通道:', lastErr);
    }
    return { text: '', model: '', usedBy: '', lastErr };
  }

  /* 解析 LLM 输出为 sections；要求 LLM 输出 JSON，解析失败整段兜底 */
  function parseSections(text) {
    try {
      const m = String(text).match(/\{[\s\S]*\}/);
      if (m) {
        const j = JSON.parse(m[0]);
        if (Array.isArray(j.sections) && j.sections.length) {
          return j.sections.map(s => ({ title: String(s.title || '研判').slice(0, 30), body: String(s.body || '') })).filter(s => s.body);
        }
      }
    } catch (e) { /* 兜底 */ }
    return [{ title: '综合研判', body: String(text).trim() }];
  }

  /* ---- 各专项数据装配 + 降级模板（真实数字填充）---- */
  const AGENTS = {
    /* ① 组织画像师 */
    'org-analyst': {
      name: '组织画像师', needs: 'org',
      async assemble(p) {
        const { evs, t1, spanDays } = await loadEvents();
        const { byOrg } = await loadOrgIndex();
        const rows = buildOrgActivity(byOrg, spanDays, t1);
        const orgId = p.org || (rows.find(r => r.sufficient) || rows[0] || {}).id;
        const me = rows.find(r => r.id === orgId);
        if (!me) return { error: '组织无归因事件' };
        const list = byOrg.get(orgId) || [];
        const recent = list.slice(-10).reverse();
        const mdist = namedDist(list, classifyMethod, METHOD_BUCKETS);
        const tdist = namedDist(list, classifyTarget, TARGET_BUCKETS);
        const ctx = {
          org: me.name, count: me.count, activityIndex: me.activityIndex, lam: me.lam,
          geoSpread: me.geoSpread, countries: me.countries, targetEntropy: me.targetEntropy,
          tacticKL: me.tacticKL, chinaShare: me.chinaShare, sufficient: me.sufficient,
          minEvents: MIN_ORG_EVENTS, spanDays,
          methodTop: mdist.slice(0, 4).map(x => x.n + ' ' + Math.round(x.c / list.length * 100) + '%'),
          targetTop: tdist.slice(0, 4).map(x => x.n + ' ' + Math.round(x.c / list.length * 100) + '%'),
          recentTitles: recent.slice(0, 6).map(e => '[' + new Date(e.t).toISOString().slice(0, 10) + '][' + e.country + ']' + e.title.slice(0, 60))
        };
        return { ctx, evidenceIds: recent.map(e => e.id) };
      },
      promptOf(ctx) {
        return '你是海外安全情报机构的资深组织画像分析师。以下是恐怖组织「' + ctx.org + '」在近 ' + ctx.spanDays + ' 天数据窗口内的真实统计（零模拟）：\n'
          + '归因事件 ' + ctx.count + ' 起；活动指数 ' + ctx.activityIndex + '/100；Hawkes 当前强度 λ=' + ctx.lam + ' 起/日；地理扩散 ' + ctx.geoSpread + ' 国（' + (ctx.countries || []).join('、') + '）；\n'
          + '目标多样性熵 ' + ctx.targetEntropy + ' bit；战术演进 KL 偏离 ' + (ctx.tacticKL == null ? '样本不足' : ctx.tacticKL + ' bit') + '；涉华威胁比例 ' + Math.round(ctx.chinaShare * 100) + '%；\n'
          + '手法分布 Top：' + (ctx.methodTop || []).join('、') + '；目标分布 Top：' + (ctx.targetTop || []).join('、') + '；\n'
          + '近期代表性事件：\n' + (ctx.recentTitles || []).join('\n') + '\n\n'
          + '请严格基于以上真实数据输出该组织动态画像研判（禁止虚构）。用 JSON 返回 {"sections":[{"title":"...","body":"..."}]}，包含 4 节：①组织活动态势（活动周期与强度判读）②战术演进特征③下一步目标预测（基于手法/目标分布与近期事件）④对我海外利益威胁评估（结合涉华比例与地理分布）。每节 80-150 字。';
      },
      fallback(ctx) {
        const sections = [];
        sections.push({ title: '组织活动态势', body: ctx.org + ' 在近 ' + ctx.spanDays + ' 天窗口内归因事件 ' + ctx.count + ' 起，活动指数 ' + ctx.activityIndex + '/100，Hawkes 当前强度 λ=' + ctx.lam + ' 起/日。地理扩散 ' + ctx.geoSpread + ' 国（' + (ctx.countries || []).slice(0, 5).join('、') + '）。' + (ctx.sufficient ? '样本量满足画像门槛（≥' + ctx.minEvents + ' 起），统计结论可靠。' : '样本不足（' + ctx.count + '/' + ctx.minEvents + ' 起），以下研判仅供参考。') });
        sections.push({ title: '战术演进特征', body: '手法分布 Top：' + (ctx.methodTop || []).join('、') + '。目标偏好 Top：' + (ctx.targetTop || []).join('、') + '。战术演进 KL 偏离 ' + (ctx.tacticKL == null ? '因基线样本不足无法计算' : ctx.tacticKL + ' bit（' + (ctx.tacticKL > KL_ALERT_THRESHOLD ? '显著偏离基线，战术正在转型' : '与基线基本一致，战术延续') + '）') + '。目标多样性熵 ' + ctx.targetEntropy + ' bit（熵越高目标越分散）。' });
        sections.push({ title: '下一步目标预测', body: '基于目标分布：' + (ctx.targetTop || []).slice(0, 2).join('与') + ' 为最可能延续的攻击方向。近期事件样本：' + (ctx.recentTitles || []).slice(0, 2).join('；') + '。' });
        sections.push({ title: '对我海外利益威胁评估', body: '涉华威胁比例 ' + Math.round(ctx.chinaShare * 100) + '%（' + ctx.count + ' 起中命中涉华关联）。' + (ctx.chinaShare > 0.1 ? '该组织对我海外人员与项目构成现实威胁，建议纳入重点监控清单。' : '涉华直接命中较低，但活动国与我利益重叠区需保持关注。') });
        return sections;
      }
    },
    /* ② 反恐分析师 */
    'counter-terror': {
      name: '反恐分析师', needs: 'country',
      async assemble(p) {
        const { evs, t0, spanDays } = await loadEvents();
        const country = p.country || '尼日利亚';
        const list = evs.filter(e => TERROR_TYPES.includes(e.type) && e.country === country);
        if (list.length < 5) return { error: '该国恐袭样本不足（' + list.length + '/5）' };
        const times = list.map(e => e.d).sort((a, b) => a - b);
        const fit = times.length >= HAWKES_MIN_EVENTS ? fitHawkes(times, spanDays) : null;
        const nowDay = DAY0(Date.now());
        const mu = fit ? adaptiveMu(times, nowDay, 21) : null;
        const ex7 = fit ? hawkesForecast(times, nowDay, 7, mu, fit.alpha, fit.beta) : null;
        const methods = namedDist(list, classifyMethod, METHOD_BUCKETS);
        const targets = namedDist(list, classifyTarget, TARGET_BUCKETS);
        const casualty = extractCasualties(list);
        const weekHist = new Array(7).fill(0);
        list.forEach(e => weekHist[new Date(e.t).getUTCDay()]++);
        const peakDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][weekHist.indexOf(Math.max(...weekHist))];
        const recent = list.slice(-8).reverse();
        return {
          ctx: {
            country, count: list.length, spanDays,
            hawkes: fit ? { mu, alpha: fit.alpha, beta: fit.beta, ex7: Math.round(ex7 * 10) / 10 } : null,
            methodTop: methods.slice(0, 4).map(x => x.n + ' ' + Math.round(x.c / list.length * 100) + '%'),
            targetTop: targets.slice(0, 4).map(x => x.n + ' ' + Math.round(x.c / list.length * 100) + '%'),
            casualty, peakDay,
            recentTitles: recent.slice(0, 6).map(e => '[' + new Date(e.t).toISOString().slice(0, 10) + ']' + e.title.slice(0, 60))
          },
          evidenceIds: recent.map(e => e.id)
        };
      },
      promptOf(ctx) {
        return '你是反恐情报分析师。以下为 ' + ctx.country + ' 近 ' + ctx.spanDays + ' 天恐袭数据（真实采集，零模拟）：\n'
          + '恐袭事件 ' + ctx.count + ' 起；' + (ctx.hawkes ? 'Hawkes 预测未来 7 天期望 ' + ctx.hawkes.ex7 + ' 起（μ=' + ctx.hawkes.mu + ' α=' + ctx.hawkes.alpha + ' β=' + ctx.hawkes.beta + '）；' : '样本不足未拟合 Hawkes；')
          + '高发星期：' + ctx.peakDay + '；手法 Top：' + (ctx.methodTop || []).join('、') + '；目标 Top：' + (ctx.targetTop || []).join('、') + '；\n'
          + '伤亡模式：' + (ctx.casualty.dead ? '死亡数字命中 ' + ctx.casualty.dead.n + ' 起，平均 ' + ctx.casualty.dead.avg + ' 人/起，最大 ' + ctx.casualty.dead.max + ' 人' : '事件文本未含可抽取死亡数字') + '；\n'
          + '近期事件：\n' + (ctx.recentTitles || []).join('\n') + '\n\n'
          + '请严格基于以上数据输出该国恐袭行为画像研判。JSON 返回 {"sections":[{"title":"...","body":"..."}]}，4 节：①行为模式总览②高风险时段与手法③未来 7 日强度研判④对中资项目/人员威胁评估与防护建议。每节 80-150 字，禁止虚构。';
      },
      fallback(ctx) {
        const sections = [];
        sections.push({ title: '行为模式总览', body: ctx.country + ' 近 ' + ctx.spanDays + ' 天恐袭 ' + ctx.count + ' 起。手法以 ' + (ctx.methodTop || []).slice(0, 2).join('、') + ' 为主；目标集中于 ' + (ctx.targetTop || []).slice(0, 2).join('、') + '。' + (ctx.casualty.dead ? '含死亡数字事件 ' + ctx.casualty.dead.n + ' 起，平均 ' + ctx.casualty.dead.avg + ' 人/起，最大单次 ' + ctx.casualty.dead.max + ' 人。' : '') });
        sections.push({ title: '高风险时段与手法', body: '高发星期为' + ctx.peakDay + '。手法 Top：' + (ctx.methodTop || []).join('、') + '。目标 Top：' + (ctx.targetTop || []).join('、') + '。' });
        sections.push({ title: '未来 7 日强度研判', body: ctx.hawkes ? 'Hawkes 自激励模型（μ=' + ctx.hawkes.mu + '，α=' + ctx.hawkes.alpha + '，β=' + ctx.hawkes.beta + '）预测未来 7 天期望 ' + ctx.hawkes.ex7 + ' 起。α/β 比值反映事件连锁聚集强度，当前 ' + (ctx.hawkes.alpha > 0.5 ? '自激励效应明显，短期高发概率大' : '以基线散发为主') + '。' : '样本不足（需≥' + HAWKES_MIN_EVENTS + ' 起）未拟合 Hawkes，不做强度预测。' });
        sections.push({ title: '对中资威胁评估', body: '目标分布中涉华/中方相关占比见「我方人员与资产」桶（' + (ctx.targetTop || []).join('、') + '）。建议驻' + ctx.country + '中资项目在' + ctx.peakDay + '前后提升安保等级，规避目标偏好区域。' });
        return sections;
      }
    },
    /* ③ 绑架模式分析师 */
    'kidnap-analyst': {
      name: '绑架模式分析师', needs: 'text',
      async assemble(p) {
        const { evs, spanDays } = await loadEvents();
        const all = evs.filter(e => KIDNAP_RE.test(e.title) || KIDNAP_RE.test(e.content));
        const q = String(p.text || '').trim();
        let sims = [];
        if (q) {
          sims = all.map(e => ({ e, sim: diceSimilarity(q, e.title) })).sort((a, b) => b.sim - a.sim).slice(0, 5)
            .map(x => ({ title: x.e.title.slice(0, 70), country: x.e.country, time: new Date(x.e.t).toISOString().slice(0, 10), sim: Math.round(x.sim * 1000) / 1000, id: x.e.id }));
        }
        const modeCnt = {};
        for (const e of all) {
          const t = e.title + ' ' + e.content;
          const m = KIDNAP_MODES.find(mm => mm.re && mm.re.test(t)) || KIDNAP_MODES[KIDNAP_MODES.length - 1];
          modeCnt[m.n] = (modeCnt[m.n] || 0) + 1;
        }
        const natCnt = {};
        for (const e of all) { const t = e.title + ' ' + e.content; for (const [n, re] of VICTIM_NATS) { if (re.test(t)) { natCnt[n] = (natCnt[n] || 0) + 1; break; } } }
        const cMap = new Map();
        all.forEach(e => { if (!PSEUDO_COUNTRIES.has(e.country)) cMap.set(e.country, (cMap.get(e.country) || 0) + 1); });
        const topCountries = [...cMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        return {
          ctx: {
            q, total: all.length, spanDays,
            modes: Object.entries(modeCnt).map(([n, c]) => n + ' ' + c + '起'),
            victimTop: Object.entries(natCnt).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => n + ' ' + c + '起'),
            topCountries: topCountries.map(([c, n]) => c + ' ' + n + '起'),
            sims: sims.map(s => '[' + s.time + '][' + s.country + '][相似度' + s.sim + ']' + s.title)
          },
          evidenceIds: sims.map(s => s.id)
        };
      },
      promptOf(ctx) {
        return '你是绑架案件模式分析师。全库近 ' + ctx.spanDays + ' 天绑架类事件 ' + ctx.total + ' 起（真实数据）。\n'
          + '模式分布：' + (ctx.modes || []).join('、') + '；受害画像 Top：' + (ctx.victimTop || []).join('、') + '；高发国家 Top：' + (ctx.topCountries || []).join('、') + '。\n'
          + (ctx.q ? '用户输入事件描述：「' + ctx.q + '」，Dice 相似度检索历史案例 Top：\n' + (ctx.sims || []).join('\n') + '\n' : '')
          + '请输出绑架行动模式研判。JSON 返回 {"sections":[{"title":"...","body":"..."}]}，4 节：①模式匹配结论（描述事件最接近的历史模式）②相似案例启示③高风险区域与人群提示④处置参考建议（报案/谈判/撤离/预防）。每节 80-150 字，严格基于数据，禁止虚构。';
      },
      fallback(ctx) {
        const sections = [];
        sections.push({ title: '模式匹配结论', body: (ctx.q ? '针对输入「' + ctx.q + '」：' : '') + '全库绑架事件 ' + ctx.total + ' 起，模式分布为 ' + (ctx.modes || []).join('、') + '。' + (ctx.sims && ctx.sims.length ? '最相似历史案例为 ' + ctx.sims[0] + '。' : '未提供具体描述，展示全库模式分布。') });
        sections.push({ title: '相似案例启示', body: ctx.sims && ctx.sims.length ? 'Dice 相似检索 Top5：' + ctx.sims.join('；') : '输入事件描述后可检索相似案例（题名 Dice 二元组相似度）。' });
        sections.push({ title: '高风险区域与人群', body: '高发国家 Top：' + (ctx.topCountries || []).join('、') + '。受害画像 Top：' + (ctx.victimTop || []).join('、') + '。' });
        sections.push({ title: '处置参考建议', body: '①事发国别立即启动领事保护报案流程；②赎金型案件不建议直接支付，优先专业谈判渠道；③高发区中方人员执行结伴出行与路线报备制度；④参考相似案例处置周期制定预案。' });
        return sections;
      }
    },
    /* ④ 地缘研判官 */
    'geo-officer': {
      name: '地缘研判官', needs: 'country',
      async assemble(p) {
        const { evs, t0, spanDays } = await loadEvents();
        const country = p.country || '伊朗';
        const { countries: geoAll } = buildGeoModel(evs, t0, spanDays);
        const me = geoAll.find(g => g.country === country);
        if (!me) return { error: '该国六维样本不足（建模门槛 ≥20 条）' };
        const recent = evs.filter(e => e.country === country).slice(-8).reverse();
        const nbs = (NEIGHBORS[country] || []).slice(0, 5);
        const nbInfo = nbs.map(nb => {
          const g = geoAll.find(x => x.country === nb);
          return g ? nb + '(R=' + g.curR + ',Δ' + (g.deltaR >= 0 ? '+' : '') + g.deltaR + ')' : nb + '(样本不足)';
        });
        return {
          ctx: {
            country, spanDays, curR: me.curR, deltaR: me.deltaR,
            changepoints: me.changepoints, series: me.series,
            attribution: me.attribution.slice(0, 3).map(a => a.name + (a.contrib >= 0 ? '+' : '') + a.contrib),
            neighbors: nbInfo,
            recentTitles: recent.slice(0, 6).map(e => '[' + new Date(e.t).toISOString().slice(0, 10) + '][' + e.type + ']' + e.title.slice(0, 60))
          },
          evidenceIds: recent.map(e => e.id)
        };
      },
      promptOf(ctx) {
        return '你是地缘安全研判官。以下为 ' + ctx.country + ' 近 ' + ctx.spanDays + ' 天六维地缘风险数据（真实采集）：\n'
          + '当前 R=' + ctx.curR + '，周 ΔR=' + (ctx.deltaR >= 0 ? '+' : '') + ctx.deltaR + '，CUSUM 变点 ' + ctx.changepoints.length + ' 处（第 ' + (ctx.changepoints || []).map(i => i + 1).join('、') + ' 周）；周度 R 序列：' + (ctx.series || []).join(' → ') + '；\n'
          + '主要驱动维度：' + (ctx.attribution || []).join('、') + '；邻国态势：' + (ctx.neighbors || []).join('、') + '；\n'
          + '近期事件：\n' + (ctx.recentTitles || []).join('\n') + '\n\n'
          + '请输出地缘风险研判。JSON 返回 {"sections":[{"title":"...","body":"..."}]}，4 节：①异动归因叙述（变点前后对比）②走向研判（结合周度序列斜率）③邻国溢出风险④对我国利益影响与对策。每节 80-150 字，严格基于数据，禁止虚构。';
      },
      fallback(ctx) {
        const sections = [];
        const trend = ctx.series.length >= 2 ? (ctx.series[ctx.series.length - 1] - ctx.series[0]) : 0;
        sections.push({ title: '异动归因叙述', body: ctx.country + ' 当前地缘风险 R=' + ctx.curR + '，周 ΔR=' + (ctx.deltaR >= 0 ? '+' : '') + ctx.deltaR + '。CUSUM 检出变点 ' + ctx.changepoints.length + ' 处。主要驱动维度：' + (ctx.attribution || []).join('、') + '。近期信号：' + (ctx.recentTitles || []).slice(0, 2).join('；') });
        sections.push({ title: '走向研判', body: '周度 R 序列 ' + (ctx.series || []).join(' → ') + '，全窗净变化 ' + (trend >= 0 ? '+' : '') + (Math.round(trend * 10) / 10) + '，' + (trend > 2 ? '总体上行，风险发酵中' : trend < -2 ? '总体回落，局势趋缓' : '区间震荡，方向不明朗') + '。' });
        sections.push({ title: '邻国溢出风险', body: '邻国态势：' + (ctx.neighbors || []).join('、') + '。' });
        sections.push({ title: '对我国利益影响', body: '按六维中「涉我」维与项目暴露评估：' + ctx.country + ' 涉我维度变动见归因 Top（' + (ctx.attribution || []).join('、') + '）。建议对在该中资项目核对人员台账与应急撤离预案。' });
        return sections;
      }
    },
    /* ⑤ 制裁合规官 */
    'sanctions-officer': {
      name: '制裁合规官', needs: 'enterprise',
      async assemble(p) {
        const { hits, spanDays } = await loadSanctionEvents();
        const ent = String(p.enterprise || '').trim();
        const kw = ent ? new RegExp(ent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
        const matched = kw ? hits.filter(e => kw.test(e.title) || kw.test(e.content)) : [];
        const pool = matched.length ? matched : hits;
        const typeCnt = {};
        for (const e of pool) {
          const t = e.title + ' ' + e.content;
          const ty = SANCTION_TYPES.find(x => x.re.test(t));
          const n = ty ? ty.n : '其他/综合';
          typeCnt[n] = (typeCnt[n] || 0) + 1;
        }
        const INTEREST_BASE = require('./interest-base');
        const projSet = new Set();
        pool.slice(0, 80).forEach(e => INTEREST_BASE.matchProjects(e.title + ' ' + e.content).forEach(x => projSet.add(x.name + '（' + x.country + '）')));
        const recent = pool.slice(-8).reverse();
        return {
          ctx: {
            ent: ent || '(未指定，全库口径)', scopeTotal: hits.length, matched: matched.length, spanDays,
            typeTop: Object.entries(typeCnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => n + ' ' + c + '起'),
            projects: [...projSet].slice(0, 6),
            recentTitles: recent.slice(0, 6).map(e => '[' + new Date(e.t).toISOString().slice(0, 10) + '][' + e.country + ']' + e.title.slice(0, 60))
          },
          evidenceIds: recent.map(e => e.id)
        };
      },
      promptOf(ctx) {
        return '你是制裁合规官。制裁情报库近 ' + ctx.spanDays + ' 天共 ' + ctx.scopeTotal + ' 条命中。'
          + (ctx.matched > 0 ? '其中与「' + ctx.ent + '」直接相关 ' + ctx.matched + ' 条。' : '未检索到与「' + ctx.ent + '」直接相关条目（展示全库动态）。')
          + '\n类型分布：' + (ctx.typeTop || []).join('、') + '；受影响项目关联：' + ((ctx.projects || []).join('、') || '无直接项目命中') + '；\n'
          + '近期制裁动态：\n' + (ctx.recentTitles || []).join('\n') + '\n\n'
          + '请输出制裁暴露评估。JSON 返回 {"sections":[{"title":"...","body":"..."}]}，4 节：①制裁暴露评估（对指定主体/全行业）②受影响业务与项目③法律与合规风险点④应对建议（合规排查/供应链/结算路径）。每节 80-150 字，严格基于数据，禁止虚构。';
      },
      fallback(ctx) {
        const sections = [];
        sections.push({ title: '制裁暴露评估', body: '制裁情报库近 ' + ctx.spanDays + ' 天 ' + ctx.scopeTotal + ' 条命中。' + (ctx.matched > 0 ? '「' + ctx.ent + '」直接相关 ' + ctx.matched + ' 条，存在明确暴露。' : '「' + ctx.ent + '」未见直接命中，当前暴露较低，但需关注行业次级制裁外溢。') + '类型构成：' + (ctx.typeTop || []).join('、') + '。' });
        sections.push({ title: '受影响业务与项目', body: '项目关联命中：' + ((ctx.projects || []).join('、') || '无直接命中') + '。近期动态样本：' + (ctx.recentTitles || []).slice(0, 2).join('；') });
        sections.push({ title: '法律与合规风险点', body: '按类型分布（' + (ctx.typeTop || []).join('、') + '），首要合规敞口为 ' + ((ctx.typeTop || [])[0] || '出口管制') + '。涉美技术/美元结算/美籍员工三条链路需逐项核查。' });
        sections.push({ title: '应对建议', body: '①对涉美技术与物料清单（BOM）做出口管制分类号（ECCN）排查；②评估美元结算替代路径；③对涉 ' + ((ctx.projects || [])[0] || '重点项目') + ' 的合同嵌入制裁变更条款；④建立制裁名单 72h 复核机制。' });
        return sections;
      }
    },
    /* ⑥ 供应链哨兵 */
    'supply-sentinel': {
      name: '供应链哨兵', needs: 'mineral',
      async assemble(p) {
        const { hits, spanDays } = await loadMineralEvents();
        const { evs, t0 } = await loadEvents();
        const { countries: geoAll } = buildGeoModel(evs, t0, spanDays);
        const geoMap = new Map(geoAll.map(g => [g.country, g]));
        const mineral = String(p.mineral || '').trim();
        const kw = mineral ? new RegExp(mineral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
        const matched = kw ? hits.filter(e => kw.test(e.title) || kw.test(e.content)) : hits;
        const cMap = new Map();
        matched.forEach(e => { if (!PSEUDO_COUNTRIES.has(e.country)) cMap.set(e.country, (cMap.get(e.country) || 0) + 1); });
        const topCountries = [...cMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([c, n]) => { const g = geoMap.get(c); return c + ' ' + n + '起（国别R=' + (g ? g.curR : '—') + '）'; });
        const INTEREST_BASE = require('./interest-base');
        const chSet = new Set();
        matched.slice(0, 100).forEach(e => INTEREST_BASE.matchChannels(e.title + ' ' + e.content).forEach(c => chSet.add(c.name)));
        const projSet = new Set();
        matched.slice(0, 100).forEach(e => INTEREST_BASE.matchProjects(e.title + ' ' + e.content).forEach(x => { if (x.cat === 'mineral') projSet.add(x.name + '（' + x.country + '）'); }));
        const recent = matched.slice(-8).reverse();
        return {
          ctx: {
            mineral: mineral || '(全品类)', total: matched.length, scopeTotal: hits.length, spanDays,
            topCountries, channels: [...chSet].slice(0, 6), projects: [...projSet].slice(0, 6),
            recentTitles: recent.slice(0, 6).map(e => '[' + new Date(e.t).toISOString().slice(0, 10) + '][' + e.country + ']' + e.title.slice(0, 60))
          },
          evidenceIds: recent.map(e => e.id)
        };
      },
      promptOf(ctx) {
        return '你是关键矿产供应链安全分析师。矿产/海关情报库近 ' + ctx.spanDays + ' 天共 ' + ctx.scopeTotal + ' 条命中，其中「' + ctx.mineral + '」相关 ' + ctx.total + ' 条。\n'
          + '热点国家：' + (ctx.topCountries || []).join('、') + '；涉矿产项目：' + ((ctx.projects || []).join('、') || '无直接命中') + '；涉咽喉通道：' + ((ctx.channels || []).join('、') || '无直接命中') + '；\n'
          + '近期动态：\n' + (ctx.recentTitles || []).join('\n') + '\n\n'
          + '请输出供应链安全研判。JSON 返回 {"sections":[{"title":"...","body":"..."}]}，4 节：①供应链动态总览②中断风险研判（结合热点国别 R 与通道命中）③对我国矿产安全影响④替代通道与储备建议。每节 80-150 字，严格基于数据，禁止虚构。';
      },
      fallback(ctx) {
        const sections = [];
        sections.push({ title: '供应链动态总览', body: '「' + ctx.mineral + '」相关情报 ' + ctx.total + ' 条（全库矿产/海关 ' + ctx.scopeTotal + ' 条）。热点国家：' + (ctx.topCountries || []).join('、') + '。涉项目：' + ((ctx.projects || []).join('、') || '无直接命中') + '。' });
        sections.push({ title: '中断风险研判', body: '涉咽喉通道命中：' + ((ctx.channels || []).join('、') || '无直接命中') + '。' + (ctx.topCountries && ctx.topCountries.length ? '首要热点 ' + ctx.topCountries[0] + '，需评估其国别风险对矿产出口/运输的传导。' : '') });
        sections.push({ title: '对我国矿产安全影响', body: '我国海外矿产项目命中 ' + ((ctx.projects || []).length || 0) + ' 个（' + ((ctx.projects || []).join('、') || '无') + '）。结合热点国别 R 值，对 R≥40 国家项目执行每日监控。' });
        sections.push({ title: '替代通道与储备建议', body: '①对单一通道依赖品类（如经 ' + ((ctx.channels || [])[0] || '主要通道') + ' 运输）评估替代路线；②对热点国别矿产执行安全库存上浮；③跟踪出口禁令与港口罢工类信号（本窗口已监测到相关情报流）。' });
        return sections;
      }
    }
  };

  router.post('/agent/:modelKey', async (req, res) => {
    const modelKey = String(req.params.modelKey || '');
    const agent = AGENTS[modelKey];
    if (!agent) return res.status(404).json({ ok: false, error: '未知智能体：' + modelKey, available: Object.keys(AGENTS) });
    const p = req.body || {};
    const t0ms = Date.now();
    try {
      const cacheKey = 'agent:' + modelKey + ':' + JSON.stringify(p).slice(0, 200);
      const data = await cache.wrap(cacheKey, async () => {
        const assembled = await agent.assemble(p);
        if (assembled.error) return { ok: true, agent: { error: assembled.error, model: '规则化研判引擎', source: 'fallback' }, evidenceIds: [] };
        const ctx = assembled.ctx;
        const prompt = agent.promptOf(ctx);
        const llm = await llmChain(prompt);
        let sections, model, source;
        if (llm.text) {
          sections = parseSections(llm.text);
          model = llm.model + (llm.usedBy === 'Spark' ? '（星火备援）' : '');
          source = 'llm';
        } else {
          sections = agent.fallback(ctx);
          model = '规则化研判引擎（降级）';
          source = 'fallback';
          console.warn('[MODELS-AGENT] LLM 全部失败，降级模板。原因:', llm.lastErr);
        }
        return {
          ok: true, agent: {
            key: modelKey, name: agent.name, sections, model, source,
            lastErr: source === 'fallback' ? llm.lastErr : '',
            dataNote: '研判严格基于 /api/models/* 真实计算与事件样本，零模拟数据',
            elapsed: ((Date.now() - t0ms) / 1000).toFixed(1) + 's'
          },
          evidenceIds: assembled.evidenceIds || [],
          ctx: { /* 供前端展示装配底数 */ }
        };
      });
      res.json(data);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* 智能体清单（前端导航树元数据） */
  router.get('/agents', (req, res) => {
    res.json({
      ok: true,
      agents: Object.entries(AGENTS).map(([k, a]) => ({ key: k, name: a.name, needs: a.needs })),
      chain: 'Kimi 主 → Spark 备 → 规则化模板降级（真实数字填充）'
    });
  });

  return router;
};
