/**
 * backfill.js — 历史补采引擎（2026-09-06 用户指令三，任务 #649）
 * ================================================================
 * 背景：系统 2026-08-27 才首采，年报要求全年数据。补采窗口 2026-01-01 → 2026-08-26
 * 共 238 天，每日目标 1500 条（类别配额按 GAP_CAT_TARGET 140 等比缩放 ≈85/类/日，
 * 与日常采集类别分布同口径——用户已拍板：全量后台直推 + backfill 标记 + 现有类别配额）。
 *
 * 设计要点：
 * ① 主源 GDELT DOC API 绝对时间窗（startdatetime/enddatetime，crawler.gdeltSearch
 *    已支持）；每国每日 1 宽查询（18 类 gap 词并集，单一来源 CAT_STD.GAP_KEYWORDS 动态拼）
 *    + TIER1 国全文国名腿（sourcecountry=该国媒体发布≠关于该国，与 gap-scheduler 同教训）；
 * ② 全程唯一管线 _ingestLinkedItems → _preInsertGate，零虚构铁律不变；
 *    _sourceType='backfill' 全程可溯源/可单独清理；
 * ③ 配套闸门改造（server.js 同步落地，缺一补采全灭）：
 *    - _isFreshEnough backfill 分支：历史日期以发布时间为准绳放行（event_date=发布日）；
 *    - stale-single-source 印证闸豁免（6h 窗+48h 库内印证对数月前事件系统性误杀）；
 *    - _eventClusterOk/_ruUaQuotaOk/_dominantQuotaOk 按「事件日」计数（不按采集日），
 *      否则 1500 条挤在今天一个桶里全触帽；
 *    - _semanticEventDup 对 backfill 条目要求同事件日才判重（跨日同伤亡数不误杀）；
 *    - _serverAlertGen / _runGapScheduler 矩阵统计排除 backfill（预警中心只放实时，
 *      缺口调度器地板账不被补采量灌假绿）。
 * ④ 进度表 backfill_progress 逐日记账（done/error/attempts），服务重启自动续跑；
 *    backfill_state 持久化 paused 标志；/api/backfill/status 全程可观测。
 * ⑤ 翻译只译标题+摘要（正文不抓不译，_untranslated_body 交周期回填）——35 万条
 *    全译正文会烧穿翻译配额；落库即中文铁律指标题，不受影响。
 */
'use strict';

const archive = require('./backfill-archive'); /* 窗外双源：GDELT 2.1 事件归档 + ReliefWeb（#654/#655） */
const titles = require('./backfill-titles');   /* #714④ SOURCEURL 真实标题回捞 */

/* #714① 窗口终点锁死（2026-09-08 用户拍板）：01-01 → 08-27，08-28 起系统已有
 * 实时采集不再重叠。旧版动态扩到昨日的 IIFE 已删——动态窗口会让账本日复一日
 * 增生新任务，与「重补历史窗口」语义冲突。 */
const WIN_START = '2026-01-01';
const WIN_END = '2026-08-27';
const DAILY_TARGET = 1500;             /* 用户指令：每日净入库 1500 条 */
/* #714③ 选择目标与配额重定（12 类均衡 + 国别均衡，2026-09-08 用户指令）：
 * 入选 2000（闸门自然拒收 ~25-30% 后净落 ~1500）；单类帽 600（30%，杜绝旧档
 * geopolitical 88% 失衡）；单国帽 120（8%，头部热国让位中小国）。 */
const SELECT_TARGET = 2000;
const CAT_CAP = 600;
const COUNTRY_CAP = 120;
const TITLE_FETCH_CAP = 3000;          /* #714④ 单历史日 SOURCEURL 回捞上限（mentions 降序截断） */
const INGEST_CAP = 24000;              /* #714⑦ 单自然日全 worker 合计入库硬帽（15 历史日/日 × 1500 + 余量） */
const SYNTHETIC_MAX_SHARE = 0.05;      /* #714④ 合成兜底占入选比 ≤5% */
const WORKERS = 4;                     /* #661：4 worker 并行处理历史日（归档日互不依赖） */
const DAY_RETRY_MAX = 3;               /* 单日失败最多重试次数 */

let D = null;                          /* deps */
const S = { running: false, currentDay: null, lastError: '' };
/* 归档站自身熔断状态（与 DOC API 熔断完全解耦） */
let _archFailStreak = 0, _archCoolUntil = 0, _archProbe = { t: 0, ok: true };

/* ---------- 工具 ---------- */
function _dayList() {
  const out = [];
  const d = new Date(WIN_START + 'T00:00:00Z');
  const end = new Date(WIN_END + 'T00:00:00Z');
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function _gdDt(day, tail) { return day.replace(/-/g, '') + tail; } /* YYYYMMDD + 000000/235959 */
function _shiftDay(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function _seenISO(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z' : '';
}

/* 宽查询词并集：从 CAT_STD.GAP_KEYWORDS 动态拼（受控词表单一来源，不维护副本） */
let _BROAD_KW = '';
let _CAT_TERMS = [];                   /* [{ct, terms:[..]}] 配额分桶用轻量匹配 */
function _buildKw() {
  const all = new Set();
  _CAT_TERMS = [];
  Object.keys(D.CAT_STD.GAP_KEYWORDS).forEach(ct => {
    const gap = String(D.CAT_STD.GAP_KEYWORDS[ct] || '');
    const terms = gap.replace(/[()"]/g, ' ').split(/\s+OR\s+|\s+/i)
      .map(x => x.trim().toLowerCase()).filter(x => x && x !== 'or' && !/:/.test(x));
    /* gap 串形如 (attack OR bombing OR kidnapping)，上面按空格切会把多词短语拆散——
     * 重新按 OR 切保留短语 */
    const phrases = gap.replace(/[()"]/g, '').split(/\s+OR\s+/i)
      .map(x => x.trim().toLowerCase()).filter(Boolean);
    _CAT_TERMS.push({ ct, terms: phrases });
    phrases.forEach(p => all.add(p));
  });
  _BROAD_KW = '(' + Array.from(all).map(p => (p.indexOf(' ') >= 0 ? '"' + p + '"' : p)).join(' OR ') + ')';
  console.log('[BACKFILL] 宽查询词 ' + all.size + ' 个 / 类别桶 ' + _CAT_TERMS.length + ' 个');
}
function _catOf(title) {
  const t = String(title || '').toLowerCase();
  for (const c of _CAT_TERMS) {
    if (c.terms.some(p => t.indexOf(p) >= 0)) return c.ct;
  }
  return 'geopolitical_intel';         /* 兜底类（不设目标，与缺口调度器同语义） */
}

/* ---------- DB ---------- */
async function _ensureTables() {
  await D.query(`CREATE TABLE IF NOT EXISTS backfill_progress (
    day date PRIMARY KEY, status text NOT NULL DEFAULT 'pending',
    fetched int DEFAULT 0, inserted int DEFAULT 0, rejected int DEFAULT 0,
    by_cat jsonb, attempts int DEFAULT 0, note text,
    started_at timestamptz, finished_at timestamptz)`);
  await D.query(`CREATE TABLE IF NOT EXISTS backfill_state (k text PRIMARY KEY, v text)`);
  /* 重启自愈：上次进程死在路上留下的 running 一律回 pending（幂等重跑，闸门去重保底） */
  await D.query(`UPDATE backfill_progress SET status='pending' WHERE status='running'`);
}
/* #714②/#715 暂停状态分层：
 * - paused（'1'/'0'，兼容历史脏值 'true'）：总开关
 * - pause_reason：'user'（人工暂停，永不自动恢复）| 'cap'（单日硬帽，次日 00:30 哨兵
 *   自动恢复）| 'yield'（实时采集停滞让路，恢复/跨日解除）| 'trial'（试跑完成待人工
 *   验收）| ''（未暂停）
 * 哨兵（backfill-watch.js）是 cap/yield 自动恢复的唯一执行方，引擎只负责置位。 */
async function _getState(k) {
  try {
    const { rows } = await D.query(`SELECT v FROM backfill_state WHERE k=$1`, [k]);
    return rows.length ? String(rows[0].v) : '';
  } catch (e) { return ''; }
}
async function _setState(k, v) {
  await D.query(`INSERT INTO backfill_state (k,v) VALUES ($1,$2)
    ON CONFLICT (k) DO UPDATE SET v=$2`, [k, String(v)]);
}
async function _isPaused() {
  /* #714② 兼容历史脏值：曾有写入方存 'true'（字符串），旧判定 v==='1' 恒假 →
   * 引擎在"已暂停"状态下照跑（乱采根因之一）。双值兼容。 */
  const v = await _getState('paused');
  return v === '1' || v === 'true';
}
async function _setPaused(p, reason) {
  await _setState('paused', p ? '1' : '0');
  if (reason !== undefined) await _setState('pause_reason', p ? String(reason) : '');
}
/* PG date 列 → JS Date（本地午夜），String(date).slice(0,10) 得 'Thu Jan 01' 键错位
 * → _nextPendingDay 永远返回同一日造成热循环（2026-09-06 attempts 10万+/分钟事故）。
 * 必须用本地 getter 手工拼，禁 toISOString（+8 时区会回退一天）。 */
function _dayKey(d) {
  if (d instanceof Date) {
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return String(d).slice(0, 10);
}
/* GDELT DOC API 官方硬限：只检索最近 ~3 个月（实测 2026-09-06 对 2026-01-01 窗外查询
 * 返回错位近闻/空集）。窗外日期一律 skipped（终态），不浪费查询配额。 */
const GDELT_MIN_DAY = (() => {
  const d = new Date(Date.now() - 84 * 86400000);
  return _dayKey(d);
})();
async function _nextPendingDay() {
  const { rows } = await D.query(`SELECT day, status, attempts FROM backfill_progress`);
  const m = {};
  rows.forEach(r => { m[_dayKey(r.day)] = r; });
  for (const day of _dayList()) {
    /* 窗外日（day < GDELT_MIN_DAY）不再跳过：走归档双源（#654/#655 用户拍板），
     * 与窗内 GDELT DOC 模式共用进度表/配额/管线，顺序天然先补窗外 */
    const r = m[day];
    if (!r) return day;
    if (r.status === 'done' || r.status === 'skipped') continue;
    if ((r.status === 'pending' || r.status === 'error' || r.status === 'partial') && (r.attempts || 0) < DAY_RETRY_MAX) return day;
  }
  return '';
}
/* #661 多 worker 原子领日：INSERT..ON CONFLICT..WHERE 条件抢占，RETURNING 命中才算领到。
 * 两个 worker 同时看中同一天时只有一个能抢到，输家重选下一日。 */
async function _claimDay(day) {
  const { rows } = await D.query(
    `INSERT INTO backfill_progress (day, status, started_at, attempts)
     VALUES ($1,'running',NOW(),1)
     ON CONFLICT (day) DO UPDATE SET status='running', started_at=NOW(),
       attempts=backfill_progress.attempts+1
     WHERE backfill_progress.status IN ('pending','error','partial')
       AND backfill_progress.attempts < $2
     RETURNING day`, [day, DAY_RETRY_MAX]);
  return rows.length > 0;
}

/* ---------- 国家清单（梯队顺序，FIPS 码 + 英文名双备） ---------- */
let _COUNTRIES = [];
function _buildCountries() {
  _COUNTRIES = [];
  ['TIER1', 'TIER2', 'TIER3'].forEach(tier => {
    (D.INTEREST_BASE.COUNTRY_TIERS[tier] || []).forEach(x => {
      const fips = D.crawler.gdCode(x.cn);
      const en = (D.GAP_COUNTRY_EN || {})[x.cn] || D.crawler.gdEn(x.cn);
      if (!fips && !en) return;
      _COUNTRIES.push({ cn: x.cn, tier, fips, en });
    });
  });
  console.log('[BACKFILL] 国家清单 ' + _COUNTRIES.length + ' 国（TIER1 ' +
    _COUNTRIES.filter(c => c.tier === 'TIER1').length + '）');
}

/* ---------- 单日处理 ---------- */
async function processDay(day, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const startdt = _gdDt(day, '000000'), enddt = _gdDt(day, '235959');
  if (!opts.partial && !opts.claimed) {   /* claimed：worker 已原子领日，不再重复记账 */
    await D.query(`INSERT INTO backfill_progress (day, status, started_at)
      VALUES ($1,'running',NOW())
      ON CONFLICT (day) DO UPDATE SET status='running', started_at=NOW(),
        attempts=backfill_progress.attempts+1`, [day]);
  }
  /* 心跳护栏（领日后立即启动，#716 根修二段）：标题回捞阶段（池 3~5k 逐条 HTTP，
   * 大池实测 25~35min）在翻译阶段之前就超哨兵 30min 僵死阈值——2026-09-08 主战役
   * 首批 01-07~01-10（池 4405/4735/4802/3109）若不前移将重演 stale-rec 双跑险情。
   * 真全程心跳：领日即跳，哨兵判据只杀真僵死（进程被杀/死循环）。 */
  const _hb = setInterval(() => {
    D.query(`UPDATE backfill_progress SET started_at=NOW() WHERE day=$1 AND status='running'`, [day]).catch(() => {});
  }, 60 * 1000);

  const countries = opts.onlyCountries || _COUNTRIES;
  const pool = []; const seenUrl = new Set();
  let qN = 0;
  /* 2026-09-07 根修：全窗口走归档双源（GDELT 2.1 事件归档 + ReliefWeb）。
   * 旧版窗内日走 DOC API——DOC 与实时采集共享配额，429 熔断期间召回恒 0，
   * 73 个窗内日三连败烧光 attempts（事故记录见 MEMORY）。归档站独立无限流、
   * 池深 4~8k/日（DOC 查询仅 ~2k），且标题走 CAMEO 模板中文（免翻译，翻译链熔断免疫）。
   * DOC 路径仅保留给 test-day 指定国实测。 */
  const archiveMode = !opts.onlyCountries;
  if (archiveMode) {
    const apool = await archive.fetchPool(day);
    apool.forEach(a => {
      if (!a.url || seenUrl.has(a.url)) return;
      seenUrl.add(a.url);
      pool.push(a);
    });
    qN = 9;   /* 8 zip + 1 reliefweb（记账用） */
    /* #714④ SOURCEURL 真实标题回捞：模板标题只是死链兜底。
     * mentions 降序截断 TITLE_FETCH_CAP（低报道量事件价值低，不浪费回捞配额）。 */
    if (pool.length > TITLE_FETCH_CAP) pool.length = TITLE_FETCH_CAP;
    try {
      const ts = await titles.recoverTitles(pool, { day });
      console.log('[BACKFILL] ' + day + ' 标题回捞：池 ' + ts.pool + ' / 需捞 ' + ts.need + ' / 真实 ' + ts.real + '（缓存 ' + ts.cached + '）/ 死链 ' + ts.dead + ' / 失败 ' + ts.fail);
      /* 二轮回捞（2026-09-08 试跑实测：首轮失败率 46%，多为网络抖动/代理饱和的
       * 一次性失败）：retry 态条目再试一轮，二败才判死（DEAD_AFTER_TRIES=2 在此
       * 闭环）。缓存命中项自动跳过，二轮只花在失败子集上。 */
      if (ts.fail > 0) {
        const ts2 = await titles.recoverTitles(pool, { day });
        console.log('[BACKFILL] ' + day + ' 标题回捞二轮：真实 ' + ts2.real + '（救回 ' + (ts2.real - ts.real) + '）/ 死链 ' + ts2.dead + ' / 仍失败 ' + ts2.fail);
      }
    } catch (e) {
      console.warn('[BACKFILL] ' + day + ' 标题回捞异常（全批按合成兜底）:', e.message);
      pool.forEach(it => { if (it._tplTitle) it._synthetic = true; });
    }
  } else
  for (const c of countries) {
    /* 主腿：sourcecountry 码 × 宽事件词 × 英文源（召回 <8 回落全语言） */
    let arts = [];
    const isoTry = [];
    if (c.fips) isoTry.push(c.fips);
    if (c.en) isoTry.push('"' + c.en + '"');
    for (const iso of isoTry) {
      try {
        arts = await D.crawler.gdeltSearch('sourcecountry:' + iso + ' ' + _BROAD_KW + ' sourcelang:english',
          { startdatetime: startdt, enddatetime: enddt, maxrecords: 250, noCache: true }); qN++;
      } catch (e) {}
      if (arts.length >= 8) break;
      try {
        const a2 = await D.crawler.gdeltSearch('sourcecountry:' + iso + ' ' + _BROAD_KW,
          { startdatetime: startdt, enddatetime: enddt, maxrecords: 250, noCache: true }); qN++;
        a2.forEach(a => { if (!arts.some(x => x.url === a.url)) arts.push(a); });
      } catch (e) {}
      if (arts.length) break;
    }
    /* TIER1 全文国名腿：召回「全球媒体报道该国」（sourcecountry 语义缺陷补偿，同 gap-scheduler） */
    if (c.tier === 'TIER1' && c.en) {
      try {
        const ft = await D.crawler.gdeltSearch('"' + c.en + '" ' + _BROAD_KW + ' sourcelang:english',
          { startdatetime: startdt, enddatetime: enddt, maxrecords: 120, noCache: true }); qN++;
        const re = new RegExp(c.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        ft.filter(a => re.test(String(a.title || ''))).forEach(a => { if (!arts.some(x => x.url === a.url)) arts.push(a); });
      } catch (e) {}
    }
    arts.forEach(a => {
      if (!a.url || seenUrl.has(a.url)) return;
      /* 窗外钳位防线：GDELT 对超 3 月窗口不报错而是返回「最近新闻」——
       * seendate 不在请求日 ±1 天（时区冗余）的一律丢弃，防近闻冒充历史（零虚构铁律） */
      const sd = _seenISO(a.seendate);
      if (sd) {
        const dd = sd.slice(0, 10);
        if (dd !== day && dd !== _shiftDay(day, -1) && dd !== _shiftDay(day, 1)) return;
      }
      seenUrl.add(a.url);
      a._qCountry = c.cn;
      pool.push(a);
    });
  }
  const fetched = pool.length;
  /* GDELT 熔断嫌疑：全天全池 <20 大概率是限流/熔断不是真空——记 error 留待重试 */
  if (!opts.partial && fetched < 20) {
    clearInterval(_hb);   /* 早退防定时器泄漏（心跳已前移到领日后） */
    await D.query(`UPDATE backfill_progress SET status='error', fetched=$2, note='gdelt-recall-too-low', finished_at=NOW() WHERE day=$1`, [day, fetched]);
    console.warn('[BACKFILL] ' + day + ' 召回仅 ' + fetched + '，疑似 GDELT 熔断/限流，记 error 待重试');
    return { day, fetched, inserted: 0, error: 'recall-too-low' };
  }

  /* 选择：涉华优先（不占类别帽）→ 类别轮循（CAP 85/类，总量 1500；归档日 350/类，总量 2400 超额选） */
  /* 分类：#714④ 真实标题条目重分类——CAMEO 精确子码（恐袭/制裁高置信）优先 →
   * 真实标题关键词（GAP_KEYWORDS 受控词表）→ CAMEO 根码兜底。真实标题语义
   * 覆盖面远宽于 7 个 CAMEO 类，是 12 类别均衡的前提。 */
  pool.forEach(it => {
    if (it._realTitle) {
      it._cat = (archive.preciseCat && archive.preciseCat(it)) || _catOf(it.title) || it._cat || 'geopolitical_intel';
    } else {
      it._cat = it._cat || _catOf(it.title);
    }
  });
  /* 选择：涉华优先（不占类别帽）→ 类别轮循 + 国别均衡（用户 2026-09-07 指令：
   * 类别要均衡、国别要均衡、不要全是美俄以伊）。
   * ① 同标题选择去重：模板标题在 (a1,a2,同root不同子码) 变体间完全相同，
   *    只按 URL 选会把同题变体全选进来喂给标题去重闸（实测 1521/1857 白选）；
   * ② 国别帽：归档日 ~70/国（2400 目标 ÷ ~35 个活跃国），头部热国让位中小国。 */
  const selTarget = SELECT_TARGET;      /* #714③：归档/DOC 统一 2000 入选目标（净落 ~1500） */
  const ccap = archiveMode ? COUNTRY_CAP : 1e9;   /* test-day 指定国实测不受国帽 */
  const _normT = s => String(s || '').toLowerCase().replace(/[^\w一-龥]+/g, '').slice(0, 48);
  const selTitle = new Set();
  const ctryCount = {};
  const _tryAdd = (it, uncapped) => {
    if (selected.length >= selTarget) return false;
    if (!it.url || selUrl.has(it.url)) return false;
    const tk = _normT(it.title);
    if (tk.length >= 10 && selTitle.has(tk)) return false;
    const c = String(it.country || '');
    if (!uncapped && c && (ctryCount[c] || 0) >= ccap) return false;
    selUrl.add(it.url); if (tk.length >= 10) selTitle.add(tk);
    if (c) ctryCount[c] = (ctryCount[c] || 0) + 1;
    selected.push(it);
    return true;
  };
  let chinaN = 0;
  const china = pool.filter(it => { try { return D.isChinaRelated(String(it.title || '')); } catch (e) { return false; } });
  const byCat = {};
  pool.forEach(it => { if (!byCat[it._cat]) byCat[it._cat] = []; byCat[it._cat].push(it); });
  const selected = [];
  const selUrl = new Set();
  china.forEach(it => { if (_tryAdd(it, true)) chinaN++; });   /* 涉华核心不受国别帽限（重点铁律） */
  const catKeys = Object.keys(byCat).filter(k => k !== 'geopolitical_intel')
    .sort((a, b) => byCat[a].length - byCat[b].length);  /* 小类先补（稀缺优先） */
  const catCap = CAT_CAP;               /* #714③：单类 ≤600（30%），杜绝旧档单类 88% 失衡 */
  const catCount = {};
  const tried = new Set();   /* 轮循内已看过的 URL（题重/国帽挡下也算看过，防死循环；补偿轮仍可捞回） */
  let more = true;
  while (more && selected.length < selTarget) {
    more = false;
    for (const ct of catKeys.concat(['geopolitical_intel'])) {
      if (selected.length >= selTarget) break;
      if ((catCount[ct] || 0) >= catCap) continue;
      const arr = byCat[ct] || [];
      const it = arr.find(x => !tried.has(x.url));
      if (!it) continue;
      tried.add(it.url);
      if (!_tryAdd(it, false)) continue;
      catCount[ct] = (catCount[ct] || 0) + 1;
      more = true;
    }
  }
  /* 国别均衡补偿轮：首轮被国别帽拦下的空额，按「当前入选最少国」放开国帽再补一轮。
   * 2026-09-08 类别均衡根修：补偿轮同样受类别帽约束——旧版此处不查 catCount，
   * 归档池 ~80% 是言语冲突（root 10-13/16 → geopolitical_intel），兜底条目全灌
   * 单一类别（实测新入库 94% geopolitical），违背用户「12 类别均衡化」指令。
   * 帽后若喂不满 1500 目标，宁可少而均衡（真空缺类由实时通道补）。 */
  if (archiveMode && selected.length < selTarget) {
    const leftovers = pool.filter(x => !selUrl.has(x.url))
      .sort((a, b) => (ctryCount[String(a.country || '')] || 0) - (ctryCount[String(b.country || '')] || 0));
    for (const it of leftovers) {
      if (selected.length >= selTarget) break;
      const ct0 = it._cat || 'geopolitical_intel';
      if ((catCount[ct0] || 0) >= catCap) continue;
      const tk = _normT(it.title);
      if (tk.length >= 10 && selTitle.has(tk)) continue;
      selUrl.add(it.url); if (tk.length >= 10) selTitle.add(tk);
      const c = String(it.country || ''); if (c) ctryCount[c] = (ctryCount[c] || 0) + 1;
      catCount[ct0] = (catCount[ct0] || 0) + 1;
      selected.push(it);
    }
  }

  /* #714④ 合成兜底 ≤5% 硬预算：超预算按 mentions 最低者先弃（宁少勿滥）。 */
  const synMax = Math.ceil(selected.length * SYNTHETIC_MAX_SHARE);
  const synItems = selected.filter(it => it._synthetic);
  if (synItems.length > synMax) {
    synItems.sort((a, b) => (a.mentions || 0) - (b.mentions || 0));
    const dropUrls = new Set(synItems.slice(0, synItems.length - synMax).map(x => x.url));
    for (let i = selected.length - 1; i >= 0; i--) if (dropUrls.has(selected[i].url)) selected.splice(i, 1);
    console.log('[BACKFILL] ' + day + ' 合成兜底超预算：' + synItems.length + ' → 弃 ' + (synItems.length - synMax) + ' 留 ' + synMax);
  }
  const realN = selected.filter(it => it._realTitle).length;
  const synN = selected.filter(it => it._synthetic).length;

  /* 字段归一：seendate→发布时间；_sourceType 必须在任何闸门之前（铁律，gap-scheduler 教训） */
  selected.forEach(it => {
    const iso = _seenISO(it.seendate) || (day + 'T12:00:00Z');
    it.publish_time = it.publish_time || iso;
    it.publishedAt = it.publishedAt || iso;
    it.event_date = it.event_date || iso;
    it.date = it.date || iso;
    it.country = it.country || '';
    it._fallbackCountry = it._qCountry;
    it._sourceType = 'backfill';
    it._backfillDay = day;
    it.interestLinked = true;
    if (!it.source) it.source = it.domain || 'GDELT历史回扫';   /* 归档/ReliefWeb 自带来源不覆盖 */
    /* 正文不抓不译：标题/摘要翻译由 translate 完成，正文交周期回填（翻译配额护栏） */
  });

  /* 心跳已前移到领日后立即启动（#716 根修二段：标题回捞大池 25~35min 也需覆盖），
   * 此处原第二份 setInterval 已删除，cap 早退与 finally 的 clearInterval 继续生效 */

  /* 翻译 + 实体富化（与 gap-scheduler 同管线）；#714 用户新约束一（不挤兑实时采集）：
   * 40 条/批 + 批间 2s 限速——实时采集翻译配额绝对优先，补采降速档慢灌。 */
  const _needTr = selected.filter(it => !it._zhTitle);
  for (let i = 0; i < _needTr.length; i += 40) {
    try { await D.translate(_needTr.slice(i, i + 40), 4); }
    catch (e) { console.warn('[BACKFILL] 翻译批异常（保留原文继续）:', e.message); }
    await new Promise(r => setTimeout(r, 2000));
  }
  /* 2026-09-07 #661：归档/中文条目标题本就是中文，title_zh 同步回填——
   * 空 title_zh 在入库闸加 @事件日 后缀会变常量键全批互撞（入库 1/2400 根因），
   * 且前端 COALESCE/涉华判定/导出全链路都依赖 title_zh 字段 */
  selected.forEach(it => {
    if (!it.title_zh && it.title && /[\u4e00-\u9fa5]/.test(it.title)) it.title_zh = it.title;
  });
  selected.forEach(it => {
    try { D.enrich(it); } catch (e) {}
    /* 国别兜底：标题证据回填交给 _ingestLinkedItems 的 _backfillCountry；
     * 仍无国别证据时落查询国（sourcecountry=该国媒体，本地新闻大概率关于本国） */
    if (!String(it.country || '').trim()) {
      try { if (D.fillCountry && D.fillCountry(it)) return; } catch (e) {}
      it.country = it._fallbackCountry;
    }
  });

  /* #714⑦ 单自然日入库硬帽（24,000）：到帽自暂停（reason=cap），当日记回 pending
   * （重选零损失——账本未记 done），哨兵次日 00:30 自动恢复。多 worker 并发时
   * 引擎侧前置自查 + 哨兵 5min 兜底双保险。 */
  try {
    const { rows } = await D.query(`SELECT count(*) n FROM intel_data
      WHERE collect_time >= CURRENT_DATE AND COALESCE(data_json->>'_sourceType','')='backfill'`);
    if (((rows[0] || {}).n || 0) >= INGEST_CAP) {
      await _setPaused(true, 'cap');
      await _setState('cap_day', _dayKey(new Date()));
      clearInterval(_hb);   /* 早退防定时器泄漏 */
      await D.query(`UPDATE backfill_progress SET status='pending', note='cap-deferred', finished_at=NOW() WHERE day=$1`, [day]);
      console.warn('[BACKFILL] ' + day + ' 前置触达单日硬帽 ' + INGEST_CAP + '，自暂停（cap）次日 00:30 哨兵恢复');
      return { day, fetched, selected: selected.length, china: chinaN, inserted: 0, capPaused: true };
    }
  } catch (e) { console.warn('[BACKFILL] 硬帽检查异常（放行继续）:', e.message); }

  let inserted = 0;
  /* 心跳已提前到翻译阶段前统一启动（#716 修复），此处仅消费 */
  try {
    const r = await D.ingest(selected, 'BACKFILL', ' day=' + day + (opts.partial ? ' partial' : ''));
    inserted = (r && r.inserted) || 0;
  } catch (e) {
    S.lastError = e.message;
    console.warn('[BACKFILL] ' + day + ' 入库异常:', e.message);
  } finally { clearInterval(_hb); }
  const secs = Math.round((Date.now() - t0) / 1000);
  if (!opts.partial) {
    await D.query(`UPDATE backfill_progress SET status=$2, fetched=$3, inserted=$4, by_cat=$5, finished_at=NOW(), note=$6 WHERE day=$1`,
      [day, 'done', fetched, inserted, JSON.stringify(catCount),
       'queries=' + qN + ' china=' + chinaN + ' real=' + realN + ' syn=' + synN + ' ' + secs + 's']);
    /* #714 试跑模式（P1 质量门验收）：trial 计数递减，归零自动暂停（reason=trial）
     * 等待人工验收——GET /api/backfill/watch 看逐日质量门报告，达标后
     * POST /api/backfill/resume 放行主战役。防止未验收就把 239 天全灌完。 */
    const tv = parseInt(await _getState('trial'), 10) || 0;
    if (tv > 0) {
      const left = tv - 1;
      await _setState('trial', String(left));
      if (left <= 0) {
        await _setPaused(true, 'trial');
        console.log('[BACKFILL] 试跑完成（trial 归零），自动暂停等待人工验收：GET /api/backfill/watch 质量门报告 / POST /api/backfill/resume 放行主战役');
      }
    }
  }
  console.log('[BACKFILL] ' + day + ' 完成：召回 ' + fetched + ' / 入选 ' + selected.length + '（真实标题 ' + realN + ' / 合成 ' + synN + ' / 涉华 ' + chinaN + '）/ 入库 ' + inserted + ' / 查询 ' + qN + ' 次 / 国别 ' + Object.keys(ctryCount).length + ' / ' + secs + 's');
  return { day, fetched, selected: selected.length, china: chinaN, realTitle: realN, synthetic: synN, inserted, queries: qN, secs, byCat: catCount };
}

/* ---------- 主循环（#661 多 worker 并行，可中断恢复） ---------- */
async function _worker(id) {
  /* 错峰起步，避免 4 个 worker 同时扑向归档站 */
  await new Promise(r => setTimeout(r, id * 2000));
  for (;;) {
    if (await _isPaused()) { console.log('[BACKFILL w' + id + '] 已暂停，退出'); return; }
    const day = await _nextPendingDay();
    if (!day) { console.log('[BACKFILL w' + id + '] 无待办日，退出'); return; }
    /* 归档站护栏（2026-09-07 根修）：补采全窗口走 data.gdeltproject.org 归档站，
     * 与 DOC API（api.gdeltproject.org）是两套独立服务——DOC 熔断不代表归档站挂。
     * 旧版直接看 DOC 熔断状态，把补采全员卡死在等待循环（实测归档站畅通无限流）。
     * 改为探归档站本身：连续 3 次探活失败才冷却 10 分钟；探活结果缓存 120s 防 4 worker 空转打站。 */
    try {
      const _now = Date.now();
      if (_now < _archCoolUntil) {
        console.log('[BACKFILL w' + id + '] 归档站冷却中（探活连败），60s 后重看（不消耗 ' + day + ' 的 attempts）');
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      if (_now - _archProbe.t > 120000) {
        const pr = await archive.probeArchive(day);
        _archProbe = { t: _now, ok: pr.ok };
        if (pr.ok) { _archFailStreak = 0; }
        else {
          if (++_archFailStreak >= 3) {
            _archCoolUntil = _now + 10 * 60 * 1000;
            console.warn('[BACKFILL] 归档站探活三连败（' + pr.err + '），冷却 10 分钟');
          } else {
            console.warn('[BACKFILL w' + id + '] 归档站探活失败（' + pr.err + '，第' + _archFailStreak + '次），60s 后重看（不消耗 ' + day + ' 的 attempts）');
          }
          await new Promise(r => setTimeout(r, 60000));
          continue;
        }
      } else if (!_archProbe.ok) {
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
    } catch (e) {}
    if (!(await _claimDay(day))) { await new Promise(r => setTimeout(r, 500)); continue; }  /* 被别的 worker 抢先，重选 */
    S['w' + id] = day;
    try { await processDay(day, { claimed: true }); }
    catch (e) {
      S.lastError = e.message;
      console.warn('[BACKFILL w' + id + '] ' + day + ' 处理异常:', e.message);
      try { await D.query(`UPDATE backfill_progress SET status='error', note=$2, finished_at=NOW() WHERE day=$1`, [day, String(e.message || '').slice(0, 200)]); } catch (e2) {}
    }
    S['w' + id] = null;
  }
}
async function loop() {
  if (S.running) { console.log('[BACKFILL] 已在运行，忽略重复启动'); return; }
  S.running = true;
  console.log('[BACKFILL] 主循环启动（窗口 ' + WIN_START + ' → ' + WIN_END + '，目标 ' + DAILY_TARGET + '/日 × ' + WORKERS + ' workers）');
  try {
    const jobs = [];
    for (let i = 1; i <= WORKERS; i++) jobs.push(_worker(i));
    await Promise.all(jobs);
    console.log('[BACKFILL] 全部 worker 退出（窗口 ' + _dayList().length + ' 天处理完毕或已暂停）');
  } finally {
    S.running = false;
    for (let i = 1; i <= WORKERS; i++) S['w' + i] = null;
    S.currentDay = null;
  }
}

/* ---------- API ---------- */
function init(deps) {
  D = deps;
  _buildKw();
  _buildCountries();
  archive.init(deps);   /* FIPS 反查表（#654/#655） */
  titles.init(deps);    /* #714④ SOURCEURL 真实标题回捞引擎 */
  const app = D.app, auth = D.auth;
  _ensureTables().catch(e => console.warn('[BACKFILL] 建表异常:', e.message)); /* 立即建表，不等开机自检 */

  app.get('/api/backfill/status', auth, async (req, res) => {
    try {
      const days = _dayList();
      const { rows } = await D.query(`SELECT day, status, fetched, inserted, attempts, note, started_at, finished_at FROM backfill_progress ORDER BY day DESC LIMIT 400`);
      const done = rows.filter(r => r.status === 'done');
      const insertedSum = done.reduce((s, r) => s + (r.inserted || 0), 0);
      const fetchedSum = done.reduce((s, r) => s + (r.fetched || 0), 0);
      /* 速率估算 ETA：最近 5 个 done 的平均耗时 */
      const recent = done.filter(r => r.started_at && r.finished_at).slice(0, 5);
      const avgSecs = recent.length
        ? recent.reduce((s, r) => s + (new Date(r.finished_at) - new Date(r.started_at)) / 1000, 0) / recent.length : 0;
      const outOfWindow = days.filter(d => d < GDELT_MIN_DAY).length;
      const remaining = days.length - done.length;   /* 窗外日也计任务（归档双源兜底） */
      res.json({
        window: { start: WIN_START, end: WIN_END, totalDays: days.length,
                  gdeltEffectiveStart: GDELT_MIN_DAY, outOfWindowDays: outOfWindow,
                  archiveMode: 'gdelt-events-realurl' },
        running: S.running, currentDay: S.currentDay, paused: await _isPaused(),
        pauseReason: await _getState('pause_reason'),
        capDay: await _getState('cap_day'),
        trialLeft: parseInt(await _getState('trial'), 10) || 0,
        ingestCap: INGEST_CAP,
        workers: WORKERS,
        workerDays: [1, 2, 3, 4].slice(0, WORKERS).map(i => S['w' + i] || null),
        lastError: S.lastError,
        progress: {
          done: done.length, remaining,
          errors: rows.filter(r => r.status === 'error').length,
          fetched: fetchedSum, inserted: insertedSum,
          dailyTarget: DAILY_TARGET, selectTarget: SELECT_TARGET,
          catCap: CAT_CAP, countryCap: COUNTRY_CAP,
          avgSecsPerDay: Math.round(avgSecs),
          etaHours: avgSecs ? Math.round(remaining * avgSecs / 3600 * 10) / 10 : null
        },
        recent: rows.slice(0, 30)
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/backfill/pause', auth, async (req, res) => {
    try { await _setPaused(true, 'user'); res.json({ ok: true, paused: true, reason: 'user' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/backfill/resume', auth, async (req, res) => {
    try {
      /* 人工恢复清除一切暂停原因（含 trial 验收放行 / cap / yield / user） */
      await _setPaused(false);
      /* #713：server 进程只解 DB 暂停旗，worker 进程 60s 轮询接管续跑——
       * 绝不在 server 进程 spawn loop（回到同进程抢资源的老路） */
      if (process.env.ORPS_ROLE === 'worker' && !S.running) loop();
      res.json({ ok: true, paused: false, running: S.running || process.env.ORPS_ROLE === 'worker',
        note: process.env.ORPS_ROLE === 'worker' ? undefined : '已解除暂停：worker 进程（PM2 orps-workers）60s 内自动续跑' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/backfill/start', auth, async (req, res) => {
    try {
      if (S.running) return res.json({ ok: true, already: true });
      await _setPaused(false);
      if (process.env.ORPS_ROLE === 'worker') {
        loop();
        res.json({ ok: true, running: true });
      } else {
        res.json({ ok: true, running: false, note: '补采已迁 worker 进程（PM2 orps-workers）：已清除暂停旗，worker 60s 内自动启动' });
      }
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  /* 小规模实测：指定日 + 前 n 个 TIER1 国，真采真入库（零虚构——实测数据本身就是有效补采），
   * 不标 done（部分日，主循环会补全剩余国家） */
  app.post('/api/backfill/test-day', auth, async (req, res) => {
    try {
      const day = String((req.body || {}).day || '2026-01-15').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < WIN_START || day > WIN_END)
        return res.status(400).json({ error: 'day 须在 ' + WIN_START + '~' + WIN_END + ' 之间' });
      const n = Math.max(1, Math.min(10, parseInt((req.body || {}).n, 10) || 3));
      const onlyCountries = _COUNTRIES.filter(c => c.tier === 'TIER1').slice(0, n);
      const r = await processDay(day, { partial: true, onlyCountries });
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /* 开机自恢复 + 常驻接管轮询（#713：只在 worker 进程）。
   * 60s 开机自检：有未完任务且未暂停则自动续跑（PM2 重启不丢进度）；
   * 每 60s 接管轮询：server 进程经 API 解除暂停旗后，worker 在此自动启动 loop——
   * DB paused 旗是唯一控制通道，两进程不抢跑。受 SCHED backfill 类暂停双闸管控。 */
  if (process.env.ORPS_ROLE === 'worker') {
    const _bootCheck = async () => {
      try {
        if (require('./scheduler').klassPaused('backfill')) {
          console.log('[BACKFILL] 开机自检：backfill 类被暂停（POST /api/sched/resume {scope:"class",name:"backfill"} 恢复）');
          return;
        }
        await _ensureTables();
        const next = await _nextPendingDay();
        if (next && !(await _isPaused())) {
          console.log('[BACKFILL] 开机自检：发现未完任务（下一日 ' + next + '），自动续跑');
          loop();
        } else if (!next) {
          console.log('[BACKFILL] 开机自检：窗口内全部完成，待机');
        } else {
          console.log('[BACKFILL] 开机自检：已暂停（/api/backfill/resume 恢复），下一日 ' + next);
        }
      } catch (e) { console.warn('[BACKFILL] 开机自检异常:', e.message); }
    };
    setTimeout(_bootCheck, 60 * 1000);
    setInterval(async () => {
      try {
        if (S.running) return;
        if (await _isPaused()) return;
        if (require('./scheduler').klassPaused('backfill')) return;
        const next = await _nextPendingDay();
        if (next) { console.log('[BACKFILL] 接管轮询：暂停已解除且有未完任务（' + next + '），自动续跑'); loop(); }
      } catch (e) { /* 轮询失败静默，下轮再试 */ }
    }, 60 * 1000);
  }

  console.log('[BACKFILL] 历史补采引擎已挂载（窗口 ' + WIN_START + ' → ' + WIN_END + '，' + _dayList().length + ' 天 × ' + DAILY_TARGET + ' 条/日）');
}

/* 哨兵（backfill-watch.js）共享：暂停分层状态机 + 硬帽常量的单一来源（防双份漂移） */
module.exports = { init, _dayList, INGEST_CAP, _isPaused, _setPaused, _getState, _setState };
