import io, sys

path = r"C:\Users\28737\Desktop\新建文件夹\server\server.js"
with io.open(path, 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = "async function _runRegionBalance() {"
end_marker = "function startGlobalMediaCron"

si = content.index(start_marker)
ei = content.index(end_marker)
# ei points at 'function startGlobalMediaCron'; we keep everything from ei onward.
# The slice content[si:ei] is the old function plus trailing whitespace.

new_func = '''async function _runRegionBalance() {
  if (Date.now() < _regionBalanceBusyUntil) return;
  _regionBalanceBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  const t0 = Date.now();
  const REGION_TARGET = 42;   // 单区域当日达标量，达标后不再补（自限，防过采）
  /* 轻量噪声排除：体育/娱乐/民生攻略类（不重跑严格门禁，避免把当地安全风险新闻误掐） */
  const _NOISE = /(football|soccer|cricket|NBA|tennis|olympic|world cup|champions league|celebrity|movie|album|concert|wedding|recipe|netflix|box office|球赛|足球|篮球|娱乐|明星|演唱会|综艺|美食|旅游攻略|旅游推荐)/i;
  const _EXCLUDE = ['伊朗', '以色列', 'IR', 'IL'];   // 中东包明确排除伊以
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const cnt = await query('SELECT country, COUNT(*) n FROM intel_data WHERE collect_time >= $1 GROUP BY 1', [dayStart]);
    const regionN = {}; Object.keys(REGION_PACKS).forEach(k => regionN[k] = 0);
    cnt.rows.forEach(r => { const rg = _COUNTRY_TO_REGION[r.country]; if (rg && regionN[rg] !== undefined) regionN[rg] += parseInt(r.n, 10); });
    /* 仅补未达标的区域；全部达标则空闲，不重复过采 */
    const targets = Object.keys(regionN).filter(k => regionN[k] < REGION_TARGET)
      .sort((a, b) => regionN[a] - regionN[b]).slice(0, 4);
    if (!targets.length) { console.log('[REGION] 各区域均已达标(' + REGION_TARGET + ')，本轮回填空闲'); return; }
    const cyc = Math.floor(Date.now() / (30 * 60 * 1000));
    let inserted = 0, fetched = 0, rejected = 0;
    for (const rg of targets) {
      const pack = REGION_PACKS[rg];
      /* 每区域本轮：2 条风险查询 + 1 条类别查询（轮换，避免组合爆炸） */
      const ql = []; const nq = pack.queries.length, nc = (pack.catQueries || []).length;
      const qi = cyc % nq;
      ql.push(pack.queries[qi], pack.queries[(qi + 1) % nq]);
      if (nc) ql.push(pack.catQueries[cyc % nc]);
      let arts = [];
      for (const q of ql) {
        let a = [];
        try { a = await crawler.gdeltSearch(q, { timespan: '1d', maxrecords: 12 }); } catch (e) { console.warn('[REGION] 查询失败:', q.slice(0, 28), e.message); }
        /* GDELT 限流/无召回时回退 AP 站内检索（GDELT 对单 IP 有惩罚箱，不能单点依赖） */
        if (!a.length) {
          try { const apq = q.replace(/sourcecountry:\\w+/g, '').replace(/[()"]/g, ' ').replace(/OR/g, ' ').replace(/\\s+/g, ' ').trim();
            a = await crawler.apSearch(apq, { maxrecords: 12, pages: 1 }); a.forEach(x => { x._viaAp = true; }); } catch (e) {}
        }
        if (a.length) arts = arts.concat(a);
      }
      fetched += arts.length;
      if (arts.length) { try { await _translateListToZhParallel(arts, 4); } catch (e) {} arts.forEach(it => { try { ENTITY.enrich(it); } catch (e) {} }); }
      const titleKeys = await _getRecentTitleKeys();
      let regIns = 0;
      for (const it of arts) {
        const text = String(it.title || '') + ' ' + String(it.content || it.description || '');
        if (_NOISE.test(text)) { rejected++; continue; }
        const cc = (it.country || '') + ' ' + (it.country_cn || '');
        if (_EXCLUDE.some(x => cc.indexOf(x) >= 0)) { rejected++; continue; }
        /* 国别 × 风险/类别查询 = 海外利益暴露面信号（中资/华人/一带一路项目所在国的安全与风险事件），
           直接标记利益关联，不再重跑严格门禁（那会把没提"中国"二字的当地安全风险新闻掐掉）。 */
        it.interestLinked = true;
        const u = it.url || it.title; if (!u) continue;
        if (_isDupTitle(titleKeys, it)) { rejected++; continue; }
        if (!_isFreshEnough(it)) { rejected++; continue; }
        if (!_dominantQuotaOk(it)) { rejected++; continue; }
        try {
          it._eventSig = _eventSignature(it); _tagAssets(it);
          const _lv = _normLevelForStore(it); it.level_norm = _lv;
          const _dt = _classifyIntelType(it); it.data_type = _dt;
          await query(
            `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || it.publish_time || '', _lv, it.content || '', it.source || ('区域均衡·' + pack.name), JSON.stringify(it), 'approved']
          );
          _addTitleKey(titleKeys, it); inserted++; regIns++;
          if (regIns >= 10) break;   // 单区域单轮回填上限，均衡铺开
        } catch (e) { /* URL 唯一冲突等 */ }
      }
    }
    console.log('[REGION] 均衡采集(' + ((Date.now() - t0) / 1000).toFixed(1) + 's): 补 ' + targets.map(w => REGION_PACKS[w].name + '(' + regionN[w] + ')').join('+') + ' | 抓取 ' + fetched + ' 入库 ' + inserted + ' 排除 ' + rejected);
  } catch (e) { console.warn('[REGION] 采集失败:', e.message); }
  finally { _regionBalanceBusyUntil = 0; }
}

'''

new_content = content[:si] + new_func + content[ei:]
with io.open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)
print("OK: replaced _runRegionBalance, new length=%d (was %d)" % (len(new_content), len(content)))
