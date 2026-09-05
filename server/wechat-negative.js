/* ===== 公众号涉华负面专项采集（2026-08-26）=====
 * 背景：20 个白名单公众号的涉华负面报道（遇袭/绑架/制裁/风险提示等）是预警中心最高价值来源，
 * 但搜狗基线检索按相关度排序，涉华负面新文常被埋在旧文之后（刺猬安全等 12 个号历史零采集）。
 * 本专项改用「账号名 + 中国/袭击」组合词检索——组合词改变排序，把涉华负面文章顶到结果页前部，
 * 再按涉华+负面双信号过滤，确保这类信息不漏。
 * 零模拟铁律：所有条目来自搜狗结果页/文章页真实数据；解析失败用搜狗摘要保底，绝不编造。
 */
'use strict';
const oa = require('./wechat-oa');

const CN_RE = /中国|中资|中企|中方|华人|华侨|华裔|涉华|对华|一带一路|驻华|访华|中国使领馆|中国驻|Chinese|China|Beijing|Belt\s*and\s*Road|CPEC/i;
const NEG_RE = /袭击|绑架|劫持|人质|带走|掳走|劫走|枪击|爆炸|恐袭|恐怖|死亡|遇难|身亡|伤亡|骚乱|抗议|制裁|抵制|扣押|逮捕|拘留|起诉|警告|预警|风险|威胁|冲突|摩擦|争端|驱逐|关闭|限制|审查|调查|债务陷阱|渗透|间谍|attack|kidnap|abduct|hostage|shooting|blast|explosion|terror|killed|dead|protest|sanction|boycott|detain|arrest|warning|risk|threat|clash|expel|ban|probe|spy/i;

/* 涉华+负面双信号同时命中才算（与 server.js _isChinaNegative 口径一致，独立实现避免循环依赖） */
function isChinaNegative(text) {
  const t = String(text || '');
  return CN_RE.test(t) && NEG_RE.test(t);
}

/* 涉华组合词池（2026-08-26 #384 扩查）：原来只有「中国/袭击」2 个词，涉华负面表述远不止这两种。
 * 每号每轮从池中轮换取 2 个词（单轮请求量与原来相同），跨 4 轮覆盖全部 8 个词，
 * 轮换进度存增量文件 qRot，服务重启不丢。 */
const QUERY_TERMS = ['中国', '华人', '中资', '袭击', '绑架', '安全预警', '海外', '风险'];

const _norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
/* 结果块公众号名与清单名互相包含即认为同号（清单名常带"订阅号"等后缀差异） */
function _accMatch(resultAccount, target) {
  const a = _norm(resultAccount), b = _norm(target);
  if (!a || !b) return false;
  return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

async function collectNegative(opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const accounts = (opts.accounts && opts.accounts.length) ? opts.accounts : oa.listAccounts();
  const stats = { channel: 'wechat-neg', accounts: 0, accountsOk: 0, queries: 0, fetched: 0, fresh: 0, bodyOk: 0, errors: [] };
  const items = [];
  const incr = oa._internals.loadIncr();
  const tk = oa._internals.titleKey;
  let bodyBudget = opts.bodyBudget || 8;       /* 正文抓取预算（正文页是风控重灾区） */
  let resolveBudget = opts.resolveBudget || 10; /* 跳转解析预算（搜狗最敏感环节） */

  for (const name of accounts) {
    stats.accounts++;
    if (oa._internals.isFreqCooling()) { stats.errors.push('搜狗风控冷却中，涉华负面专项本轮终止'); break; }
    const negKey = name + '|neg';
    incr[negKey] = incr[negKey] || {};
    incr[name] = incr[name] || {};
    const seenNeg = incr[negKey].seenTitles || [];
    const seenMain = incr[name].seenTitles || [];
    let found = false;

    /* 组合词轮换（2026-08-26 #384）：从 8 词池中按 qRot 取 2 个，命中涉华负面新文即停；
     * 单轮请求量不变（≤2 查询/号），跨 4 轮（8h）每号覆盖全部组合词。 */
    const qRot = (incr[negKey].qRot | 0) % QUERY_TERMS.length;
    const queries = [0, 1].map(i => name + ' ' + QUERY_TERMS[(qRot + i) % QUERY_TERMS.length]);
    incr[negKey].qRot = (qRot + 1) % QUERY_TERMS.length;
    for (const q of queries) {
      if (found) break;
      await oa._internals.sleep(oa._internals.jitter(2500, 4500));
      stats.queries++;
      const sr = await oa._internals.sogouSearch(name, q);
      if (sr.antispider) {
        oa._internals.noteAntispider();
        stats.errors.push('搜狗反爬触发（涉华负面专项），冷却90分钟');
        oa._internals.saveIncr(incr);
        return { items, stats };
      }
      if (sr.error) { stats.errors.push(name + ': ' + sr.error); continue; }
      stats.accountsOk++;
      const list = (sr.list || []).filter(x => _accMatch(x.account, name));
      stats.fetched += list.length;
      const fresh = list.filter(x => !x.ts || (Date.now() - x.ts) <= 45 * 864e5);
      /* 增量去重：专项通道与主通道都已见标题均跳过；涉华+负面双信号过滤 */
      const news = fresh.filter(x => {
        const k = tk(x.title);
        return k && !seenNeg.includes(k) && !seenMain.includes(k) && isChinaNegative(x.title + ' ' + x.digest);
      });
      news.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const take = news.slice(0, 3);   /* 单号单轮最多 3 条，防风控 */
      if (take.length) found = true;
      stats.fresh += take.length;

      for (const it of take) {
        let rv = null;
        if (resolveBudget > 0) {
          await oa._internals.sleep(oa._internals.jitter(6000, 10000));
          const r0 = await oa._internals.sogouResolve(it.href);
          resolveBudget--;
          if (r0.antispider) {
            oa._internals.noteAntispider();
            stats.errors.push('搜狗反爬触发(跳转)，冷却90分钟；本轮剩余新文以快照摘要入库');
          } else if (!r0.error) rv = r0;
        }
        let body = '', ct = 0, canonical = '', nickname = '';
        if (rv && bodyBudget > 0) {
          await oa._internals.sleep(oa._internals.jitter(1000, 2500));
          const full = await oa._internals.fetchArticleFull(rv.url);
          bodyBudget--;
          if (!full.blocked) {
            body = full.body || ''; ct = full.ct || 0;
            canonical = full.canonical || ''; nickname = full.nickname || '';
            if (body) stats.bodyOk++;
          }
        }
        const ts = ct || it.ts || 0;
        items.push({
          title: it.title,
          url: canonical || (rv && rv.url) || (String(it.href).startsWith('http') ? it.href : 'https://weixin.sogou.com' + it.href),
          content: body || it.digest,
          digest: it.digest,
          source: '公众号·' + (nickname || it.account || name),
          date: ts ? new Date(ts).toISOString() : '',
          publishedAt: ts ? new Date(ts).toISOString() : '',
          data_type: 'osint_intel',
          category: '公众号监测',
          language: 'zh',
          severity: '高',
          interestLinked: true,
          chinaRelated: true,
          _chinaNegative: true,
          _real: true,
          _fromSource: 'WECHAT_NEG',
          _sourceType: 'wechat_oa',
          _viaSearch: true,
          _signedUrl: !canonical,
          _unresolved: !rv,
          _wechatAccount: nickname || it.account || name
        });
        seenNeg.push(tk(it.title));
      }
    }
    incr[negKey].seenTitles = seenNeg.slice(-200);
    incr[negKey].lastTime = Date.now();
    oa._internals.saveIncr(incr);
    await oa._internals.sleep(oa._internals.jitter(2000, 3500));
  }
  oa._internals.saveIncr(incr);
  return { items, stats };
}

module.exports = { collectNegative, isChinaNegative };
