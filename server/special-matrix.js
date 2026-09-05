/* ===== 专项采集矩阵（2026-09-03 任务 #531 用户铁指令）=====
 * 五类专项：涉华情报 / 中资项目安全 / 威胁组织活动 / 海上咽喉要道 / 制裁合规动态。
 * 与既有五路哨兵（cnsec/project/org/channel/compliance，均 24h 窗+查询帽）的差异定位：
 *   ① 48h 回看窗——跨日边界漏采的 24-48h 高价值条目在此补捞（_freshWindowFor 专项放宽）；
 *   ② 采集无上限——_sourceType='special_matrix' 豁免事件簇帽/类别结构帽/预警国别帽，
 *      单轮查询量与入库量均不设上限，仅保留全站统一质量闸（噪声/去重/墓碑/历史旧案/翻译）；
 *   ③ 高质量——每类设"类别双要素相关性正则"前置过滤（涉华类必须真涉华、通道类必须
 *      命中咽喉要素），再走 _ingestLinkedItems → _preInsertGate 唯一管线。
 * 频度：60 分钟一轮（30min 哨兵管 24h 增量面，矩阵管 48h 深度补捞，错峰不打爆外网）。
 * 铁律：零模拟；本模块只采集不直接写库；出网一律 netx.smartFetch（返回须 .text()），
 * GDELT 走 crawler.gdeltSearch + 30s 硬竞速；GNews 英文原子查询（不支持 OR/中文）。 */
'use strict';
const netx = require('./netx');
const scrapers = require('./scrapers');
const crawler = require('./crawler');

const FRESH_MS = 48 * 60 * 60 * 1000; /* 48h 时限（用户铁指令） */

/* 噪声词表（与 server.js _BAL_NOISE 同源精简版：体育/娱乐/生活类噪声一票否决） */
const _NOISE = /(football|soccer|cricket|NBA|tennis|olympic|world cup|champions league|celebrity|movie|album|concert|wedding|recipe|netflix|box office|球赛|足球|篮球|娱乐|明星|演唱会|综艺|美食|旅游攻略|旅游推荐)/i;

/* GDELT 单查询 30s 硬竞速（复杂查询偶发挂起，绝不让单次检索阻塞矩阵轮次） */
const _gdelt = (q, o) => Promise.race([
  crawler.gdeltSearch(q, o).catch(() => []),
  new Promise(res => setTimeout(() => res([]), 30000))
]);

/* GNews RSS：串行+重试×2（并发即限流，铁律）；when:2d 对齐 48h 窗 */
async function _gnewsRss(q, max) {
  const _once = () => Promise.race([
    netx.smartFetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:2d') + '&hl=en-US&gl=US&ceid=US:en',
      { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } })
      .then(r => (r && r.ok) ? r.text() : null).catch(() => null),
    new Promise(res => setTimeout(() => res(null), 14000))
  ]);
  try {
    let text = await _once();
    for (let r = 0; !text && r < 2; r++) { await new Promise(s => setTimeout(s, 2000)); text = await _once(); }
    if (!text) return [];
    const items = (scrapers.parseRss(text) || []).slice(0, max || 40);
    return items.map(it => ({
      title: it.title || '', content: it.description || '', url: it.link || '',
      publish_time: it.pubDate || '', source: 'Google News', country: ''
    }));
  } catch (e) { return []; }
}

/* GDELT seendate(20260829T120000Z) → ISO（与 compliance-watch 同源） */
const _sdIso = (a) => {
  if (a.publish_time || a.publishedAt) return a.publish_time || a.publishedAt;
  if (!a.seendate) return a.pubDate || '';
  const iso = String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
  return iso !== String(a.seendate) ? iso : (a.pubDate || a.seendate || '');
};

/* ===== 五类查询矩阵（每类：data_type + 类别相关性正则 + GNews/GDELT 查询组） =====
 * 相关性正则 = 类别双要素闸：条目标题+摘要须命中本类核心要素才放行，
 * 防"关键词碰瓷"（如涉华查询捞出纯当地新闻）。 */
const MATRIX = {
  china: {
    name: '涉华情报', dataType: 'security_events', category: '涉华情报专项',
    rel: /chinese|china\b|beijing|sino-|中(国|方|资|企)|华人|华侨|华商/i,
    gnews: [
      'Chinese nationals attacked', 'Chinese nationals kidnapped', 'Chinese nationals killed',
      'Chinese workers attacked', 'Chinese workers kidnapped', 'Chinese citizens detained',
      'Chinese embassy attacked', 'Chinese citizens evacuated', 'Chinese engineers abducted',
      'Chinese nationals injured', 'Chinese students attacked', 'Chinese tourists robbed'
    ],
    gdelt: [
      '"Chinese nationals" attack', '"Chinese nationals" kidnapped', '"Chinese nationals" killed',
      '"Chinese workers" attack', '"Chinese citizens" detained', '"Chinese embassy" attack'
    ]
  },
  project: {
    name: '中资项目安全', dataType: 'security_events', category: '中资项目安全',
    rel: /chinese|china\b|sino-|belt and road|bri\b|cpec|gwadar|hambantota|piraeus|kyaukpyu|simandou|kamoa|中(国|方|资|企)|一带一路/i,
    gnews: [
      'Gwadar port attack', 'CPEC project attack', 'Chinese company attacked',
      'Chinese-owned mine attack', 'Belt and Road project protest', 'Chinese mining company attack',
      'Chinese factory workers attacked', 'Chinese construction site attack'
    ],
    gdelt: [
      '"Chinese company" attack', '"Chinese project" attack', '"Belt and Road" attack',
      'gwadar attack', 'cpec attack', '"Chinese firm" attack'
    ]
  },
  org: {
    name: '威胁组织活动', dataType: 'terror_events', category: '威胁组织动态',
    rel: /baloch|blf\b|bla\b|ttp\b|tehrik|iswap|jnim|jamaat|al-?shabaab|houthi|ansar allah|isis-?k|iskp|islamic state|isil\b|boko haram|al-?qaeda|m23\b|wagner|armed group|militants|rebel|叛军|武装组织|胡塞|塔利班|博科圣地/i,
    gnews: [
      'Balochistan Liberation Army attack', 'TTP attack Pakistan', 'ISWAP attack',
      'JNIM attack', 'al-Shabaab attack', 'Houthi vessel attack',
      'ISIS-K attack', 'Boko Haram attack', 'M23 attack Congo', 'Wagner Group Africa'
    ],
    gdelt: [
      '"Balochistan Liberation Army"', '"Tehrik-i-Taliban" attack', 'iswap attack',
      'jnim attack', '"al-Shabaab" attack', 'houthi attack ship'
    ]
  },
  chokepoint: {
    name: '海上咽喉要道', dataType: 'infrastructure', category: '海上通道安全',
    rel: /strait|hormuz|malacca|mandeb|red sea|suez|panama canal|taiwan strait|gulf of guinea|gulf of aden|pirac|pirate|hijack|seiz.*vessel|tanker|vessel attacked|ship attacked|boarding.*vessel|海峡|海盗|劫持|油轮|商船|航道/i,
    gnews: [
      'Strait of Hormuz tanker', 'Malacca Strait piracy', 'Red Sea ship attacked',
      'Suez Canal disruption', 'Panama Canal shipping restriction', 'Taiwan Strait naval',
      'Gulf of Guinea piracy', 'Gulf of Aden hijack', 'tanker attacked', 'merchant vessel attacked'
    ],
    gdelt: [
      'hormuz tanker', 'malacca piracy', '"red sea" ship attack',
      '"suez canal" disruption', '"panama canal" restriction', '"gulf of guinea" piracy'
    ]
  },
  sanction: {
    name: '制裁合规动态', dataType: 'sanctions_data', category: '制裁合规',
    rel: /sanction|entity list|export control|cfius|tariff|embargo|blacklist|ofac|designat|anti-dumping|countervailing|管制|制裁|实体清单|关税|禁运/i,
    gnews: [
      'OFAC sanctions designation', 'entity list addition China', 'export controls China',
      'CFIUS review Chinese', 'EU sanctions China', 'sanctions Chinese companies',
      'Chinese firms sanctioned', 'China trade restriction'
    ],
    gdelt: [
      'ofac sanction china', '"entity list" chinese', '"export control" china',
      'cfius chinese', 'sanction "chinese companies"'
    ]
  }
};

/* 48h 时效预过滤：可解析时间的条目超窗拒收；无法解析交全站时效闸兜底 */
function _ageOk(it) {
  const t = Date.parse(String(it.publish_time || '')) || Date.parse(String(it.publishedAt || ''));
  if (!t) return true;
  return Date.now() - t <= FRESH_MS;
}

/* 单条放行判定：噪声/类别相关性/48h 窗/最小信息量 */
function _pass(def, it) {
  const txt = String(it.title || '') + ' ' + String(it.content || it.description || '');
  if (!txt || String(it.title || '').trim().length < 12) return false;
  if (_NOISE.test(txt)) return false;
  if (!def.rel.test(txt)) return false;
  if (!it.url) return false;
  return _ageOk(it);
}

/* ===== 一轮矩阵采集：五类串行（类别内 GNews 串行 + GDELT 串行，防限流雪崩） =====
 * opts.gdelt=true/false 可关 GDELT 腿（限流期省时）；返回 { items, stats }。 */
async function runSpecialMatrix(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const items = [];
  const seenUrl = new Set();
  const stats = { startedAt: new Date().toISOString(), categories: {}, ms: 0 };
  for (const key of Object.keys(MATRIX)) {
    const def = MATRIX[key];
    const st = { collected: 0, passed: 0, gnewsHit: 0, gdeltHit: 0 };
    const push = (list, from) => (list || []).forEach(a => {
      st.collected++;
      if (!a || !a.url || seenUrl.has(a.url)) return;
      const it = from === 'gdelt'
        ? { title: a.title || '', content: a.content || '', url: a.url || '', publish_time: _sdIso(a), source: 'GDELT·' + (a.domain || 'news'), country: a.country || '', _src: 'gdelt' }
        : Object.assign({}, a, { _src: 'gnews' });
      if (!_pass(def, it)) return;
      seenUrl.add(it.url);
      it._sourceType = 'special_matrix'; /* 必须在 _isFreshEnough 之前（铁律） */
      it._smCat = key;
      it.data_type = def.data_type;
      it.category = def.category;
      it.interestLinked = true;
      if (from === 'gdelt') st.gdeltHit++; else st.gnewsHit++;
      st.passed++;
      items.push(it);
    });
    try {
      for (const q of def.gnews) push(await _gnewsRss(q, 40), 'gnews');
    } catch (e) { /* 单类失败不阻塞整轮 */ }
    if (opts.gdelt !== false) {
      for (const q of def.gdelt) {
        try { push(await _gdelt(q + ' sourcelang:english', { timespan: '2d', maxrecords: 200 }), 'gdelt'); }
        catch (e) { /* 竞速兜底已兜 */ }
      }
    }
    stats.categories[key] = st;
    console.log('[SPECIAL-MATRIX] ' + def.name + '：检索 ' + st.collected + ' / 过闸 ' + st.passed + '（GNews ' + st.gnewsHit + ' + GDELT ' + st.gdeltHit + '）');
  }
  stats.passed = items.length;
  stats.ms = Date.now() - t0;
  console.log('[SPECIAL-MATRIX] 本轮合计过闸 ' + items.length + ' 条，耗时 ' + stats.ms + 'ms');
  return { items, stats };
}

module.exports = { runSpecialMatrix, runOnce: runSpecialMatrix, MATRIX, _test: { _ageOk, _pass, _NOISE } };
