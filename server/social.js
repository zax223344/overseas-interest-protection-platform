/* social.js — 境外社交媒体情报（SOCMINT）爬虫工具
 * ================================================================
 * 目标：抓取境外社交媒体上涉及我海外利益安全的公开信息（早期弱信号）。
 *
 * 铁律（不可违背）：
 *   1) 只抓取真实可达的公开数据源，绝不生成任何模拟/示例/随机内容；
 *   2) 实测不可达的平台一律如实标注「通道预留 / 不可用」并写明真实原因，
 *      对应计数恒为 0，绝不以任何形式凑数；
 *   3) 所有抓取结果必须经过 chinaOverseasGate 相关性闸门；
 *   4) 社交媒体属未经证实的开源线索，一律 verified:false 进入待审核队列，
 *      经人工审核后方可进入预警中心；可信度扣分由实体规则引擎 R-S04 统一处理。
 *
 * 本机出网环境逐项实测（2026-08-02，决定各通道 status，均可复现）：
 *   · Lemmy 联邦社交网络开放检索 API   → 可用（多实例，支持任意关键词全文检索）★主力
 *   · Telegram 公开频道 JSON 镜像       → 部分可用（镜像仅收录固定频道，实测 4 个可读）
 *   · Hacker News 全文检索 Algolia API  → 可用（科技/地缘议题讨论）
 *   · Telegram 官方预览 t.me/s/<频道>   → 不可用（t.me 网络层不可达，fetch failed）
 *   · X / Mastodon / Bluesky / Reddit / Nitter / YouTube / Substack → 网络层不可达
 *   · VK                                 → 站点可达，newsfeed.search 需 access_token
 *   · 4chan 公开 API                     → 网络可达，但匿名版内容不可溯源、噪声与
 *                                          违规内容比例极高，经研判不作为情报源（不采用）
 * ================================================================ */
'use strict';

const scrapers = require('./scrapers');
const crawler = require('./crawler');
const ENTITY = require('../entities.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ============================================================
 * 一、监控目标清单
 * ============================================================ */

/* Telegram：镜像 tg.i-c-a.su 实测可读的境外公开频道（逐个探测确认，失效频道已剔除）
 * 说明：该镜像仅能读取其内部 peer 库已收录的频道，未收录频道返回
 *      "This peer is not present in the internal peer database"，属镜像侧限制。 */
const TELEGRAM_CHANNELS = [
  { user: 'insiderpaper', name: 'Insider Paper', tag: '国际突发' },
  { user: 'disclosetv', name: 'Disclose.tv', tag: '国际突发' },
  { user: 'WarMonitors', name: 'War Monitor', tag: '冲突监控' },
  { user: 'IntelSlava', name: 'Intel Slava Z', tag: '冲突监控' }
];

/* 镜像未收录（实测 ERR），如实登记，不参与采集、计数恒为 0 */
const TELEGRAM_UNAVAILABLE = [
  'bbcbreaking', 'sputnik_int', 'trtworld', 'AJENews', 'globaltimesnews', 'ANI_news',
  'sentdefender', 'clashreport', 'visegrad24', 'rybar', 'MiddleEastEye'
];

/* Lemmy 联邦社交网络：实测可用实例（联邦互通，跨实例内容有重叠，落地统一去重） */
const LEMMY_INSTANCES = [
  { host: 'sh.itjust.works', name: 'sh.itjust.works' },
  { host: 'feddit.org', name: 'feddit.org' },
  { host: 'discuss.online', name: 'discuss.online' },
  { host: 'lemmy.world', name: 'lemmy.world' }
];

/* ============================================================
 * 社交检索关键词集（entity-driven，覆盖多企业/多项目/多国家）
 * 生成逻辑：从 ENTITY 注册库提取企业英文别名、项目名、高风险国别，
 * 与风险场景动词组合，最大化真实召回。闸门类铁律不变，仅扩大查询面。
 * ============================================================ */
function _buildSocialQueries() {
  const out = [];
  /* 1) 高频风险场景（保留原有 6 条并扩展） */
  const SCENARIOS = [
    'Chinese workers attack', 'Chinese nationals kidnapped', 'Chinese company protest',
    'Chinese embassy security', 'Belt and Road project', 'Chinese mine workers',
    'Chinese vessel seized', 'evacuation Chinese nationals', 'anti-China protest overseas',
    'Chinese factory shutdown', 'forced labour Chinese overseas', 'Chinese engineers killed'
  ];
  out.push(...SCENARIOS);
  /* 2) 重点中资企业（英文别名召回率最高；取有英文别名的企业） */
  const ENT_RISK = ['attack', 'protest', 'sanction', 'seized', 'security', 'dispute'];
  ENTITY.ENTERPRISES.forEach(function(e) {
    const enAlias = (e.alias || []).filter(function(a) { return /^[A-Za-z]/.test(a); });
    if (!enAlias.length) return;
    const nm = enAlias[0]; /* 取第一个英文别名 */
    out.push(nm + ' overseas');
    out.push(nm + ' ' + ENT_RISK[Math.floor(Math.random() * ENT_RISK.length)]);
  });
  /* 3) 重点海外项目（en 优先，name 备选） */
  ENTITY.PROJECTS.forEach(function(p) {
    const nm = (p.en || p.name || '').trim();
    if (!nm || nm.length < 2) return;
    out.push(nm + ' security');
  });
  /* 4) 重点国家（中资聚集/高风险，中英双语各一条） */
  const KEY_COUNTRIES = [
    'Pakistan', 'Myanmar', 'Indonesia', 'Serbia', 'Hungary', 'Kenya', 'Nigeria',
    'Angola', 'Zambia', 'DRC', 'Ethiopia', 'Laos', 'Cambodia', 'Kazakhstan',
    'Iran', 'Iraq', 'Saudi Arabia', 'UAE', 'Vietnam', 'Bangladesh', 'Sri Lanka',
    'Tanzania', 'Egypt', 'Algeria', 'Afghanistan', 'Syria', 'Yemen', 'Sudan'
  ];
  KEY_COUNTRIES.forEach(function(c) {
    out.push('Chinese ' + c + ' company');
    out.push('China ' + c + ' investment');
  });
  /* 去重并截断上限（防止 Lemmy 串行超时） */
  const uniq = [];
  const seen = {};
  for (let i = 0; i < out.length; i++) {
    const k = out[i].toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen[k]) continue;
    seen[k] = 1; uniq.push(out[i]);
  }
  return uniq.slice(0, 36); /* 上限 36 条，覆盖企业+项目+国家+场景 */
}
const SOCIAL_QUERIES = _buildSocialQueries();

/* ============================================================
 * 二、通道健康台账（真实状态，前端「社交媒体情报」面板直接展示）
 * ============================================================ */
const SOCIAL_CHANNELS = [
  { id: 'lemmy', name: 'Lemmy 联邦社交网络', platform: 'Lemmy', status: 'live', method: '开放检索 API（/api/v3/search）',
    note: '主力通道：' + LEMMY_INSTANCES.length + ' 个实例，支持任意关键词检索帖文与评论，无需授权' },
  { id: 'telegram', name: 'Telegram 公开频道', platform: 'Telegram', status: 'degraded', method: '公开频道 JSON 镜像',
    note: '部分可用：镜像仅收录固定频道，实测可读 ' + TELEGRAM_CHANNELS.length + ' 个；存在 FLOOD_WAIT 限流，需串行抓取' },
  { id: 'hackernews', name: 'Hacker News 全文检索', platform: 'Hacker News', status: 'live', method: 'Algolia 公开检索 API',
    note: '科技/地缘议题讨论，支持任意关键词全文检索（含帖文与评论）' },
  { id: 'telegram_web', name: 'Telegram 官方预览页', platform: 'Telegram', status: 'unavailable', method: 't.me/s/<频道> 服务端渲染页',
    note: '不可用：t.me 本机网络层不可达（fetch failed），无法读取任意公开频道' },
  { id: 'vk', name: 'VK（俄语社交网络）', platform: 'VK', status: 'reserved', method: '开放平台 API',
    note: '通道预留：站点可达，但 newsfeed.search 需 access_token 授权，未配置授权则不采集' },
  { id: 'x', name: 'X（原 Twitter）', platform: 'X', status: 'reserved', method: '官方 API v2',
    note: '通道预留：官方检索接口需付费授权，且本机出网环境不可达' },
  { id: 'facebook', name: 'Facebook / Meta', platform: 'Facebook', status: 'reserved', method: 'Graph API',
    note: '通道预留：需应用审核授权，公开检索接口已关闭' },
  { id: 'mastodon', name: 'Mastodon 联邦宇宙', platform: 'Mastodon', status: 'unavailable', method: '实例公开时间线 API',
    note: '不可用：mastodon.social / mstdn.social 等实例网络层不可达' },
  { id: 'bluesky', name: 'Bluesky', platform: 'Bluesky', status: 'unavailable', method: 'AT Protocol 公开检索',
    note: '不可用：public.api.bsky.app 网络层不可达' },
  { id: 'reddit', name: 'Reddit', platform: 'Reddit', status: 'unavailable', method: '公开 JSON 检索',
    note: '不可用：reddit.com 网络层不可达（Lemmy 通道为其联邦式替代）' },
  { id: 'nitter', name: 'Nitter（X 镜像）', platform: 'X', status: 'unavailable', method: '公开实例网页检索',
    note: '不可用：nitter.net 等公开实例网络层不可达' },
  { id: 'youtube', name: 'YouTube', platform: 'YouTube', status: 'unavailable', method: '频道 RSS',
    note: '不可用：youtube.com 网络层不可达' },
  { id: '4chan', name: '4chan 公开版块', platform: '4chan', status: 'rejected', method: '公开 JSON API',
    note: '不采用：网络可达，但匿名版内容不可溯源、无法核实发布主体，噪声与违规内容比例极高，经研判不作为情报源' }
];

/* ============================================================
 * 三、抓取实现（全部为真实公开数据）
 * ============================================================ */

/* HTML 实体解码 + 标签剥离（社交平台返回文本常含 <a>/&#x27; 等） */
const _ENT_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function _decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, function (m, d) { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, function (m, k) { return _ENT_MAP[k] || m; })
    .replace(/\s+/g, ' ').trim();
}
function _stripHtml(s) {
  return _decodeEntities(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
}
/* Markdown 清洗（Lemmy 正文为 Markdown） */
function _stripMd(s) {
  return _decodeEntities(String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`#]+/g, ' ')
    .replace(/<[^>]+>/g, ' '));
}
/* 纯链接/无实义内容判定（如频道被出售后只剩一条 fragment.com 链接） */
function _isJunk(t) {
  const s = String(t || '').trim();
  if (s.length < 25) return true;
  const noUrl = s.replace(/https?:\/\/\S+/g, '').replace(/[\s\W]+/g, '');
  return noUrl.length < 18;
}

/* --- 通道 1：Lemmy 联邦社交网络开放检索（主力） --- */
async function fetchLemmy(q, limit, opts) {
  opts = opts || {};
  const insts = LEMMY_INSTANCES.slice(0, opts.maxInstances || 2);
  const want = Math.min(50, limit || 20);
  const out = [], seen = {};
  let lastErr = '';
  for (let i = 0; i < insts.length && out.length < want; i++) {
    const inst = insts[i];
    const url = 'https://' + inst.host + '/api/v3/search?q=' + encodeURIComponent(String(q || '').trim()) +
                '&type_=Posts&sort=New&limit=' + Math.min(40, want);
    try {
      const tmo = opts.timeout || 18000;
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(tmo) });
      if (!r.ok) { lastErr = inst.host + ' HTTP ' + r.status; continue; }
      const j = await r.json();
      (j.posts || []).forEach(pv => {
        const p = pv && pv.post; if (!p) return;
        if (p.removed || p.deleted || p.nsfw) return;
        const title = _decodeEntities(p.name || '');
        const key = title.replace(/\s+/g, '').slice(0, 60).toLowerCase();
        if (!title || seen[key]) return;
        seen[key] = 1;
        const body = _stripMd(p.body || '');
        const community = (pv.community && (pv.community.title || pv.community.name)) || '';
        const creator = (pv.creator && pv.creator.name) || '';
        const cnt = pv.counts || {};
        out.push({
          rawTitle: title.slice(0, 160),
          /* 帖文正文可能为空（纯链接贴），此时以标题+社区+外链构成可研判内容 */
          content: (body || title).slice(0, 1200),
          url: p.ap_id || ('https://' + inst.host + '/post/' + p.id),
          extUrl: p.url || '',
          source: 'Lemmy · ' + (community ? ('c/' + community) : inst.name),
          publishedAt: p.published || '',
          channelTag: community ? ('c/' + community) : '联邦社区',
          platformName: 'Lemmy',
          author: creator,
          engagement: { score: cnt.score || 0, comments: cnt.comments || 0 }
        });
      });
    } catch (e) { lastErr = inst.host + ' 网络不可达: ' + String(e.message || e).slice(0, 30); }
    await _sleep(400);
  }
  return { items: out, error: out.length ? '' : (lastErr || '无命中') };
}

/* --- 通道 2：Telegram 公开频道（JSON 镜像） --- */
async function fetchTelegram(ch, limit) {
  const url = 'https://tg.i-c-a.su/json/' + encodeURIComponent(ch.user) + '?limit=' + (limit || 20);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
    const txt = await r.text();
    let j;
    try { j = JSON.parse(txt); } catch (e) { return { items: [], error: '响应非 JSON' }; }
    if (j && j.errors) {
      const em = JSON.stringify(j.errors).slice(0, 90);
      return { items: [], error: /FLOOD_WAIT/.test(em) ? '平台限流(FLOOD_WAIT)' : (/not present in the internal peer/.test(em) ? '镜像未收录该频道' : ('频道不可读: ' + em)) };
    }
    const msgs = (j && j.messages) || [];
    const out = [];
    msgs.forEach(m => {
      const body = _stripHtml(m.message || '');
      if (_isJunk(body)) return;                       /* 剔除纯链接/空消息（失效频道常见） */
      const date = m.date ? new Date(m.date * 1000).toISOString() : '';
      const views = m.views || 0;
      out.push({
        rawTitle: body.split(/[.。!！?？\n]/)[0].slice(0, 140) || body.slice(0, 140),
        content: body.slice(0, 1200),
        url: 'https://t.me/' + ch.user + '/' + (m.id || ''),
        source: 'Telegram · ' + ch.name,
        publishedAt: date,
        channelTag: ch.tag,
        platformName: 'Telegram',
        author: ch.name,
        engagement: { views: views }
      });
    });
    return { items: out, error: '' };
  } catch (e) {
    return { items: [], error: '网络不可达: ' + String(e.message || e).slice(0, 40) };
  }
}

/* --- 通道 3：Hacker News 全文检索（Algolia 公开 API） ---
 * 只取主题帖（story）：实测评论（comment）绝大多数为技术产品讨论，
 * 仅因文中出现 "China" 被召回，与我海外利益安全无关，属纯噪声，故不采集。 */
async function fetchHackerNews(q, limit) {
  const url = 'https://hn.algolia.com/api/v1/search_by_date?query=' + encodeURIComponent(q) +
              '&tags=story&hitsPerPage=' + (limit || 20);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { items: [], error: 'HTTP ' + r.status };
    const j = await r.json();
    const out = [];
    (j.hits || []).forEach(h => {
      const isComment = !!h.comment_text;
      const body = _stripHtml(h.story_text || h.comment_text || h.title || '');
      if (_isJunk(body)) return;
      /* 评论以其所属主题为标题，避免用评论首句冒充标题 */
      const title = isComment
        ? (h.story_title ? ('[讨论] ' + h.story_title) : body.slice(0, 120))
        : String(h.title || body).slice(0, 160);
      out.push({
        rawTitle: _decodeEntities(title),
        content: body.slice(0, 1200),
        url: h.url || ('https://news.ycombinator.com/item?id=' + (h.objectID || '')),
        source: 'Hacker News' + (isComment ? ' · 评论' : ''),
        publishedAt: h.created_at || '',
        channelTag: '科技地缘讨论',
        platformName: 'Hacker News',
        author: h.author || '',
        engagement: { score: h.points || 0, comments: h.num_comments || 0 }
      });
    });
    return { items: out, error: '' };
  } catch (e) {
    return { items: [], error: '网络不可达: ' + String(e.message || e).slice(0, 40) };
  }
}

/* ============================================================
 * 四、归一化：闸门过滤 → 12要素分类 → 实体关联 → 预警定级
 * ============================================================ */
function _normalize(raw) {
  raw.rawTitle = _decodeEntities(raw.rawTitle);
  raw.content = _decodeEntities(raw.content);
  const text = (raw.rawTitle || '') + ' ' + (raw.content || '');
  /* 相关性闸门：只留涉我海外利益安全线索（与前端 gate.js 完全同源） */
  if (!scrapers.chinaOverseasGate(text).pass) return null;
  const cr = crawler.chinaRelated(text);
  const cn = crawler.chinaNegative(text);
  const cat = crawler.classify(text, cr, cn);
  const item = {
    title: raw.rawTitle || '(社交媒体线索)',
    content: raw.content,
    country: scrapers.extractCountry(text) || '',
    source: raw.source,
    url: raw.url,
    ext_url: raw.extUrl || '',
    category: cat,
    data_type: cat,
    platform: '社交媒体',
    social_platform: raw.platformName,
    channel_tag: raw.channelTag,
    author: raw.author || '',
    engagement: raw.engagement || {},
    pubDate: raw.publishedAt,
    publishedAt: raw.publishedAt,
    chinaRelated: cr,
    chinaNegative: cn,
    severity: cn ? '高' : '中',
    intel_type: 'SOCMINT',
    credibility: '未证实（社交媒体单源）',
    verified: false,          /* 社交媒体线索未经证实，必须人工审核 */
    _social: true,
    _real: true
  };
  /* 实体关联 + 预警定级（含 R-S04 社交媒体来源 -8 可信度扣分） */
  try { ENTITY.enrich(item); } catch (e) {}
  return item;
}

/* 落地相关性复核（社交媒体从严）：
 * 社交媒体是弱信号源，噪声比远高于新闻媒体（大量"提到 China"的科技/产业议题讨论
 * 与我海外利益安全无关）。故要求必须与我方海外利益直接关联才可入队：
 *   命中中资主体 / 我方海外项目（强关联），或
 *   命中海外利益资产（中国公民/外派人员/使领馆/中资机构/工程/船舶/矿业/能源…）且同时具备涉华信号。
 * 另放行一类：涉华负面 + 命中威胁类型 + 风险 ≥40（罕见但确属安全事件）。
 * 其余一律过滤，并在统计中如实计数，绝不为凑数放宽。 */
function _passFinal(it) {
  if (!it) return false;
  if (it.interestLinked) return true;
  if (it.chinaNegative && it.chinaSignal && (it.riskScore || 0) >= 40) return true;
  return false;
}

function _collect(rawList) {
  const seen = {}, items = [];
  let dropped = 0;
  rawList.forEach(raw => {
    const it = _normalize(raw);
    if (!it) { dropped++; return; }
    if (!_passFinal(it)) { dropped++; return; }
    const key = (it.title || '').replace(/\s+/g, '').slice(0, 50).toLowerCase();
    if (!key || seen[key]) return;
    seen[key] = 1;
    items.push(it);
  });
  items.sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
  return { items: items, dropped: dropped };
}

/* ============================================================
 * 五、对外主入口
 * ============================================================ */

/* 全通道社交采集：Lemmy 多关键词检索 + Telegram 串行抓取 + HN 检索
 * 返回 { items, channels, stats }，channels 为本次每个通道的真实执行结果 */
async function collectSocial(opts) {
  opts = opts || {};
  const wantLemmy = opts.lemmy !== false;
  const wantTg = opts.telegram !== false;
  const wantHn = opts.hackernews !== false;
  const perChannel = opts.perChannel || opts.limit || 20;
  const qs = (opts.queries && opts.queries.length) ? opts.queries : SOCIAL_QUERIES;
  const report = [];
  const rawList = [];

  /* Lemmy：按关键词逐条检索（串行，规避实例限流；采集用单实例+短超时保速度） */
  if (wantLemmy) {
    let n = 0, err = '';
    for (let i = 0; i < qs.length; i++) {
      const r = await fetchLemmy(qs[i], 20, { maxInstances: 1, timeout: 12000 });
      r.items.forEach(x => rawList.push(x));
      n += r.items.length;
      if (r.error && r.error !== '无命中') err = r.error;
      await _sleep(200);
    }
    report.push({ channel: 'Lemmy 联邦社交网络', user: '(' + qs.length + ' 个关键词 × 1 实例)', fetched: n, error: err });
  }

  /* Telegram：串行 + 间隔，规避 FLOOD_WAIT */
  if (wantTg) {
    const chans = TELEGRAM_CHANNELS.slice(0, opts.maxChannels || TELEGRAM_CHANNELS.length);
    for (let i = 0; i < chans.length; i++) {
      const r = await fetchTelegram(chans[i], perChannel);
      report.push({ channel: 'Telegram · ' + chans[i].name, user: '@' + chans[i].user, fetched: r.items.length, error: r.error || '' });
      r.items.forEach(x => rawList.push(x));
      await _sleep(1600);
    }
  }

  /* Hacker News：并发检索 */
  if (wantHn) {
    const rs = await Promise.allSettled(qs.map(q => fetchHackerNews(q, 15)));
    let n = 0, err = '';
    rs.forEach(x => {
      if (x.status === 'fulfilled') { x.value.items.forEach(y => rawList.push(y)); n += x.value.items.length; if (x.value.error) err = x.value.error; }
      else err = '请求失败';
    });
    report.push({ channel: 'Hacker News 全文检索', user: '(' + qs.length + ' 个关键词)', fetched: n, error: err });
  }

  const c = _collect(rawList);

  /* 未实现/不可达/不采用通道如实登记，计数恒为 0 */
  SOCIAL_CHANNELS.forEach(ch => {
    if (ch.status === 'live' || ch.status === 'degraded') return;
    report.push({ channel: ch.name, user: '-', fetched: 0, error: ch.note });
  });

  return {
    items: c.items,
    channels: report,
    stats: {
      rawFetched: rawList.length,
      passedGate: c.items.length,
      filtered: c.dropped,
      linked: c.items.filter(x => x.interestLinked).length,
      redOrange: c.items.filter(x => (x.alertLevelCode || 4) <= 2).length
    }
  };
}

/* 按关键词做社交媒体定向检索（特种兵模式） */
async function searchSocial(q, opts) {
  opts = opts || {};
  q = String(q || '').trim();
  if (!q) return { items: [], channels: [], stats: {} };
  const report = [], rawList = [];
  const limit = opts.limit || 25;

  /* Lemmy（主力，多实例） */
  const lm = await fetchLemmy(q, limit, { maxInstances: opts.maxInstances || 3 });
  report.push({ channel: 'Lemmy 联邦社交网络', user: q, fetched: lm.items.length, error: lm.error === '无命中' ? '' : (lm.error || '') });
  lm.items.forEach(x => rawList.push(x));

  /* Hacker News */
  const hn = await fetchHackerNews(q, limit);
  report.push({ channel: 'Hacker News 全文检索', user: q, fetched: hn.items.length, error: hn.error || '' });
  hn.items.forEach(x => rawList.push(x));

  /* Telegram 无公开全文检索接口 → 拉取重点频道近期消息后按关键词本地过滤 */
  if (opts.telegram !== false) {
    const kw = q.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const chans = TELEGRAM_CHANNELS.slice(0, opts.maxChannels || TELEGRAM_CHANNELS.length);
    let hit = 0, lastErr = '';
    for (let i = 0; i < chans.length; i++) {
      const r = await fetchTelegram(chans[i], 40);
      if (r.error) lastErr = r.error;
      r.items.forEach(x => {
        const low = (x.rawTitle + ' ' + x.content).toLowerCase();
        if (kw.some(k => low.indexOf(k) >= 0)) { rawList.push(x); hit++; }
      });
      await _sleep(1600);
    }
    report.push({ channel: 'Telegram 重点频道本地检索', user: '(' + chans.length + ' 频道近 40 条)', fetched: hit, error: lastErr });
  }

  const c = _collect(rawList);
  return {
    items: c.items, channels: report,
    stats: {
      rawFetched: rawList.length, passedGate: c.items.length, filtered: c.dropped,
      linked: c.items.filter(x => x.interestLinked).length,
      redOrange: c.items.filter(x => (x.alertLevelCode || 4) <= 2).length
    }
  };
}

/* 通道健康快照（真实状态，不可用通道如实标注） */
function socialHealth() {
  return {
    channels: SOCIAL_CHANNELS,
    live: SOCIAL_CHANNELS.filter(c => c.status === 'live').length,
    degraded: SOCIAL_CHANNELS.filter(c => c.status === 'degraded').length,
    reserved: SOCIAL_CHANNELS.filter(c => c.status === 'reserved').length,
    unavailable: SOCIAL_CHANNELS.filter(c => c.status === 'unavailable' || c.status === 'rejected').length,
    telegramChannels: TELEGRAM_CHANNELS,
    telegramUnavailable: TELEGRAM_UNAVAILABLE,
    lemmyInstances: LEMMY_INSTANCES,
    queries: SOCIAL_QUERIES
  };
}

module.exports = {
  collectSocial, searchSocial, socialHealth,
  fetchTelegram, fetchHackerNews, fetchLemmy,
  SOCIAL_CHANNELS, TELEGRAM_CHANNELS, LEMMY_INSTANCES, SOCIAL_QUERIES
};
