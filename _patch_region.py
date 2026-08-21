# -*- coding: utf-8 -*-
# server.js：区域均衡采集器 + 入库国别软配额
import io
p = 'server/server.js'
s = io.open(p, encoding='utf-8').read()

anchor = "function startGlobalMediaCron() {"
assert s.count(anchor) == 1
block = '''/* ===== 区域均衡采集器（2026-08-17 用户指令：采集不能全是美/伊/俄乌，要全球均衡+高质量）=====
 * 每 30 分钟：统计今日各区域入库量，挑最薄弱的 2 个区域，用 GDELT sourcecountry 定向采集
 * （拉美/非洲/中亚/中东非伊以/欧洲五区轮换）。葡语/西语/俄语内容由 pivot 翻译管线处理。 */
const REGION_PACKS = {
  latam: {
    name: '拉美',
    countries: ['墨西哥', '巴西', '哥伦比亚', '秘鲁', '智利', '阿根廷', '委内瑞拉', '厄瓜多尔', '玻利维亚'],
    queries: [
      'sourcecountry:MX (kidnapping OR cartel OR attack OR killed)',
      'sourcecountry:BR (attack OR killed OR police OR security)',
      'sourcecountry:CO (attack OR armed OR ELN OR killed)',
      'sourcecountry:PE (protest OR mining OR security)',
      'sourcecountry:VE (sanctions OR oil OR crisis)'
    ]
  },
  africa: {
    name: '非洲',
    countries: ['尼日利亚', '肯尼亚', '埃塞俄比亚', '苏丹', '马里', '尼日尔', '刚果', '索马里', '布基纳法索', '喀麦隆', '南非', '埃及', '利比亚', '中非', '莫桑比克', '坦桑尼亚'],
    queries: [
      'sourcecountry:NG (Boko OR bandits OR kidnapped OR attack)',
      'sourcecountry:KE (attack OR al-Shabaab OR security)',
      'sourcecountry:ET (conflict OR Amhara OR Oromo OR killed)',
      'sourcecountry:SD (RSF OR fighting OR killed)',
      'sourcecountry:SO (al-Shabaab OR attack OR Mogadishu)'
    ]
  },
  centralasia: {
    name: '中亚',
    countries: ['哈萨克斯坦', '乌兹别克斯坦', '吉尔吉斯斯坦', '塔吉克斯坦', '土库曼斯坦', '蒙古'],
    queries: [
      '(Kazakhstan OR Uzbekistan OR Kyrgyzstan OR Tajikistan) (China OR security OR border OR protest)',
      '(Kazakhstan OR Central Asia) (railway OR pipeline OR China OR investment)',
      'sourcecountry:KZ (China OR security OR government)'
    ]
  },
  mideast: {
    name: '中东（非伊以）',
    countries: ['沙特阿拉伯', '阿联酋', '埃及', '卡塔尔', '约旦', '伊拉克', '也门', '阿曼', '科威特', '巴林', '摩洛哥', '突尼斯', '阿尔及利亚', '黎巴嫩'],
    queries: [
      'sourcecountry:SA (Houthi OR oil OR security OR China)',
      'sourcecountry:EG (security OR Sinai OR economy OR Suez)',
      'sourcecountry:IQ (attack OR militia OR security)',
      'sourcecountry:JO (security OR border OR economy)'
    ]
  },
  europe: {
    name: '欧洲',
    countries: ['法国', '德国', '英国', '波兰', '意大利', '西班牙', '荷兰', '比利时', '瑞典', '挪威', '罗马尼亚', '捷克', '塞尔维亚', '匈牙利', '希腊'],
    queries: [
      'sourcecountry:FR (attack OR security OR terrorism OR protest)',
      'sourcecountry:DE (security OR China OR sanctions OR economy)',
      'sourcecountry:GB (security OR defense OR China OR sanctions)',
      'sourcecountry:PL (border OR security OR Belarus)'
    ]
  }
};
const _COUNTRY_TO_REGION = {};
Object.keys(REGION_PACKS).forEach(k => REGION_PACKS[k].countries.forEach(c => { _COUNTRY_TO_REGION[c] = k; }));
let _regionBalanceBusyUntil = 0;
async function _runRegionBalance() {
  if (Date.now() < _regionBalanceBusyUntil) return;
  _regionBalanceBusyUntil = Date.now() + BUSY_LOCK_TIMEOUT_MS;
  const t0 = Date.now();
  try {
    /* 今日各区域入库量 */
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const cnt = await query('SELECT country, COUNT(*) n FROM intel_data WHERE collect_time >= $1 GROUP BY 1', [dayStart]);
    const regionN = { latam: 0, africa: 0, centralasia: 0, mideast: 0, europe: 0 };
    cnt.rows.forEach(r => { const rg = _COUNTRY_TO_REGION[r.country]; if (rg) regionN[rg] += parseInt(r.n, 10); });
    /* 挑最薄弱的 2 个区域 */
    const weakest = Object.keys(regionN).sort((a, b) => regionN[a] - regionN[b]).slice(0, 2);
    let inserted = 0, fetched = 0;
    for (const rg of weakest) {
      const pack = REGION_PACKS[rg];
      /* 每区域轮换取 2 个查询（避免查询组合爆炸） */
      const qi = Math.floor(Date.now() / (30 * 60 * 1000)) % pack.queries.length;
      const qs = [pack.queries[qi], pack.queries[(qi + 1) % pack.queries.length]];
      for (const q of qs) {
        let arts = [];
        try { arts = await crawler.gdeltSearch(q, { timespan: '1d', maxrecords: 12 }); } catch (e) { console.warn('[REGION] 查询失败:', q.slice(0, 30), e.message); }
        fetched += arts.length;
        arts.forEach(a => { a._sourceType = 'region_' + rg; });
        if (arts.length) {
          try { await _translateListToZhParallel(arts, 4); } catch (e) {}
          arts.forEach(it => {
            try {
              const before = it.interestLinked;
              ENTITY.enrich(it);
              if (before === true) it.interestLinked = true;
            } catch (e) {}
          });
          /* 过滤：过海外利益门禁（重点国安全事件经 F+G 外溢规则放行，涉华直接放行） */
          const linked = arts.filter(it => {
            if (it.interestLinked === true) return true;
            try { return scrapers.chinaOverseasGate(String(it.title || '') + ' ' + String(it.content || '')).pass; } catch (e) { return false; }
          });
          const titleKeys = await _getRecentTitleKeys();
          for (const it of linked) {
            const u = it.url || it.title;
            if (!u) continue;
            if (_isDupTitle(titleKeys, it)) continue;
            if (!_isFreshEnough(it)) continue;
            try {
              it._eventSig = _eventSignature(it);
              _tagAssets(it); const _lv = _normLevelForStore(it); it.level_norm = _lv; const _dt = _classifyIntelType(it); it.data_type = _dt;
              await query(
                `INSERT INTO intel_data (data_type, title, country, location, event_date, severity, description, source, data_json, audit_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [_dt, it.title || '', it.country || it.country_cn || '', it.location || it.city || '', it.date || it.publishedAt || it.publish_time || '', _lv, it.content || '', it.source || ('区域均衡·' + pack.name), JSON.stringify(it), 'approved']
              );
              _addTitleKey(titleKeys, it);
              inserted++;
            } catch (e) { /* URL 唯一冲突等 */ }
          }
        }
      }
    }
    console.log('[REGION] 均衡采集(' + ((Date.now() - t0) / 1000).toFixed(1) + 's): 薄弱区 ' + weakest.map(w => REGION_PACKS[w].name + '(' + regionN[w] + ')').join('+') + ' | 抓取 ' + fetched + ' 入库 ' + inserted);
  } catch (e) { console.warn('[REGION] 采集失败:', e.message); }
  finally { _regionBalanceBusyUntil = 0; }
}

function startGlobalMediaCron() {'''
s = s.replace(anchor, block, 1)

o2 = """  // 中文媒体通道：每10分钟一轮——涉华突发（人员伤亡/项目遇袭）国内信源首报最快（2026-08-17）
  setTimeout(_runCnMedia, 40000);
  setInterval(_runCnMedia, 10 * 60 * 1000);
}"""
n2 = """  // 中文媒体通道：每10分钟一轮——涉华突发（人员伤亡/项目遇袭）国内信源首报最快（2026-08-17）
  setTimeout(_runCnMedia, 40000);
  setInterval(_runCnMedia, 10 * 60 * 1000);
  // 区域均衡采集器：每30分钟挑最薄弱2区域定向采集（2026-08-17 用户指令：采集全球均衡）
  setTimeout(_runRegionBalance, 90000);
  setInterval(_runRegionBalance, 30 * 60 * 1000);
}"""
assert s.count(o2) == 1
s = s.replace(o2, n2, 1)

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('DONE')
