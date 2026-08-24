/* ============================================================
 * distribute.js —— 实时分发器（新架构：单库 DBCenter + 自动审核 + 实时流转 + 入口把关）
 * ------------------------------------------------------------
 * 职责：DBCenter.add/addBatch 自动审核通过后，把情报"实时"分发到全系统各功能区——
 *   预警中心(ALERTS) / 事件流ticker(EVENTS) / 恐袭库(TERROR_EVENTS) / 国家风险分数(COUNTRIES)
 *   → DataHub 持久化 + 通知订阅 → 当前打开视图自动重绘。
 *
 * 与旧人工审核架构的区别（2026-08-04 重设计）：
 *   1. 不再有"人工审核通过才分发"——入库即自动 approved，立即分发；
 *   2. 不再强制 interestLinked=true（那是人工判断优先的旧逻辑）；
 *      现在尊重入口闸门的 enrich 判定：interestLinked!==true 的情报留在数据中心可查，
 *      但不进预警中心/态势，避免无关外讯污染预警；
 *   3. 入口把关（chinaOverseasGate 相关性 + nonIntelGenre 体裁）在采集与入库环节已执行，
 *      此处仅做预警中心的轻量兜底，不重复"入库后杀数据"。
 *
 * 依赖（均由先加载的脚本提供，全部 typeof 防御，绝不抛错冻结页面）：
 *   ALERTS/EVENTS/TERROR_EVENTS/COUNTRIES/DIMS/DataHub/SITUATION/AVIEW (app.js)
 *   ENTITY (entities.js)  GATE (gate.js)
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 小工具（自包含，不依赖被删的旧函数） ---------- */
  function _normTitle(t) {
    if (!t) return '';
    return String(t).toLowerCase().replace(/[\s　]+/g, '').replace(/[^一-龥a-z0-9]/g, '').slice(0, 80);
  }
  function _fmtNow() {
    var d = new Date(); function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function _hash4(s) {
    var h = 5381, str = String(s || '');
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    var x = h.toString(36).toUpperCase();
    return (x.length > 4 ? x.slice(-4) : ('0000' + x).slice(-4));
  }
  var _ALERT_TYPE_CODE = {
    '安全风险': 'SEC', '恐怖袭击': 'TER', '社会动荡': 'UNR', '军事冲突': 'MIL',
    '政治风险': 'POL', '经济制裁': 'SAN', '经济风险': 'SAN', '法律合规': 'LEG',
    '自然灾害': 'DIS', '自然环境风险': 'DIS', '公共卫生': 'HLT', '基础设施': 'INF',
    '运营风险': 'INF', '网络安全': 'CYB', '开源情报': 'OSI', '地缘政治': 'GEO',
    '地缘战略风险': 'GEO', '舆情风险': 'OPN', '社会文化风险': 'UNR'
  };
  function _makeAlertNo(it) {
    if (!it) return '';
    var code = _ALERT_TYPE_CODE[it.type] || _ALERT_TYPE_CODE[it.category] || 'OSI';
    var d = new Date();
    var src = it.publishedAt || it.pubDate || it.time;
    if (src) { var p = new Date(src); if (!isNaN(p.getTime())) d = p; }
    function z(n) { return String(n).padStart(2, '0'); }
    var ymd = d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate());
    return 'CN-' + code + '-' + ymd + '-' + _hash4(String(it.title || '') + '|' + (it.url || ''));
  }
  function _extractCountryFromText(t) {
    t = String(t || '');
    try { if (typeof COUNTRIES !== 'undefined') { for (var i = 0; i < COUNTRIES.length; i++) { if (COUNTRIES[i].name && t.indexOf(COUNTRIES[i].name) >= 0) return COUNTRIES[i].name; } } } catch (e) {}
    var fl = ['巴基斯坦', '苏丹', '缅甸', '刚果', '尼日利亚', '伊拉克', '也门', '马里', '尼日尔', '肯尼亚', '埃塞俄比亚', '秘鲁', '墨西哥', '南非', '伊朗', '印度', '土耳其', '埃及', '哥伦比亚', '菲律宾', '阿富汗', '叙利亚', '孟加拉国', '泰国', '阿尔及利亚', '阿根廷', '智利', '委内瑞拉', '利比亚', '索马里', '乌克兰', '沙特', '哈萨克斯坦', '印尼', '马来西亚', '越南', '安哥拉', '摩洛哥', '约旦', '塞尔维亚', '以色列', '黎巴嫩', '巴勒斯坦', '俄罗斯', '巴西', '瓜达尔', '红海', '马六甲'];
    for (var j = 0; j < fl.length; j++) { if (t.indexOf(fl[j]) >= 0) return fl[j]; }
    return '';
  }

  /* ---------- 已分发记录去重（防刷新/重复注入） ---------- */
  var _ingestedIds = {};
  var _liveCount = 0;
  /* ---------- 事件级去重（同一事件不同来源/分类只进一次预警中心） ---------- */
  var _eventFingerprints = {};
  function _eventFingerprint(item) {
    var title = String(item.title || item.title_zh || '').toLowerCase().replace(/[\s\[\]【】]+/g, '').replace(/[^\u4e00-\u9fa5a-z0-9]/g, '').slice(0, 40);
    var country = item.country || _extractCountryFromText(title + ' ' + (item.content || item.desc || ''));
    return country + '|' + title;
  }
  function _isDuplicateEvent(item) {
    var fp = _eventFingerprint(item);
    if (_eventFingerprints[fp]) return true;
    _eventFingerprints[fp] = Date.now();
    return false;
  }

  /* ---------- 预警级别归一（2026-08-12 用户铁律） ----------
   * 红色（紧急）：仅限"直接涉华要素 + 严重安全事件"（中资/华人/使馆/一带一路项目 + 死亡/袭击/爆炸/绑架等）
   * 橙色（警告）：不涉华的严重安全事件（俄乌/中东等他国战争伤亡）/ 涉华一般风险
   * 黄色（关注）：一般安全风险、轻微政治变化、局部社会事件
   * 蓝色（提示）：普通资讯
   * 红色绝不能乱标：上游/后端给了 red 但不涉华的，一律降橙。 */
  var _CHINA_DIRECT_RE = /中资|中企|中方|华人|华侨|华裔|中国公民|中国游客|留学生|一带一路|瓜达尔|中巴经济走廊|汉班托塔|比雷埃夫斯|皎漂|吉布提|中国|Chinese|China|Beijing|驻外使馆|驻外领馆|我使馆|我国驻|中国使领馆|中国驻|Chinese embassy|Chinese consulate/i;
  var _SEVERE_RE = /死亡|伤亡|遇害|遇难|绑架|人质|劫持|恐袭|爆炸|空袭|枪击|战争|政变|屠杀|撤侨|沉船|坠机|重大事故|重大灾害|地震.*伤亡|海啸|台风.*登陆|洪水.*淹没/i;
  function _hasChinaDirect(text) { return _CHINA_DIRECT_RE.test(String(text || '')); }
  function _normLevel(item) {
    var text = String(item.title || item.title_zh || item.desc || item.content || '');
    var china = _hasChinaDirect(text);
    var l = item.level || item.alertLevel || item.severity || item.risk_level || item.impact || '';
    /* 严重事件：涉华→红色；不涉华→橙色（他国战争伤亡不构成我海外利益直接威胁） */
    if (_SEVERE_RE.test(text)) {
      if (china) return 'red';
      /* 提级关注（2026-08-14 安全部实战视角）：非涉华但重大伤亡（死亡≥5人）或大规模袭击特征 → 提级红色 */
      var cm = text.match(/(\d{1,4})\s*(?:名|人|个)?\s*(?:死亡|身亡|遇难|丧生|被打死|被击毙)/) ||
               text.match(/(\d{1,4})\s*(?:people\s+)?(?:killed|dead|deaths)/i) ||
               text.match(/(?:death toll|kills)\s*(\d{1,4})/i);
      var casN = cm ? parseInt(cm[1], 10) : 0;
      if (casN >= 5 || /大屠杀|大规模袭击|自杀式|集体处决|灭门|massacre|mass shooting|suicide bomb/i.test(text)) {
        item._promoted = '重大伤亡提级';
        return 'red';
      }
      return 'orange';
    }
    /* 上游标的红：涉华校验，不涉华降橙 */
    if (l === 'red') return china ? 'red' : 'orange';
    if (['orange', 'yellow', 'blue'].indexOf(l) >= 0) return l;
    /* 橙色：中资/华人/项目遇袭或重大风险、严重制裁、重大运营中断 */
    if (/中资.*(?:遇袭|袭击|冲突|威胁|风险|损失|中断|停工|冻结|制裁)|中企.*(?:遇袭|袭击|冲突|威胁|风险|损失|中断|停工|冻结|制裁)|华人.*(?:遇害|被绑|袭击|威胁|风险)|华侨.*(?:遇害|被绑|袭击|威胁|风险)|使馆.*(?:遇袭|袭击|威胁|风险)|项目.*(?:遇袭|中断|停工|冻结|重大风险|重大损失)|重大制裁|严厉制裁|大规模抗议|军事冲突|武装冲突|资产.*冻结|重大损失/i.test(text)) return 'orange';
    /* 黄色：一般安全风险/轻微政治变化/一般经济波动 */
    if (/袭击|冲突|骚乱|抗议|制裁|封锁|限制|风险|警惕|关注|波动|延误|紧张|摩擦|争端|审查|调查|批评|指责/i.test(text)) return 'yellow';
    return 'blue';
  }

  /* ---------- 实时情报 → 国家风险分数联动（打通态势/矩阵/预测） ---------- */
  function _applyLiveToCountryScore(a) {
    try {
      if (typeof COUNTRIES === 'undefined') return;
      var ct = COUNTRIES.find(function (c) { return c.name === a.country; });
      if (!ct || !ct.scores) return;
      var dimMap = { '安全风险': 'security', '政治风险': 'political', '经济风险': 'economic', '地缘战略风险': 'geopolitical', '运营风险': 'operational', '社会文化风险': 'social', '法律风险': 'legal', '自然环境风险': 'natural' };
      var dim = dimMap[a.type] || 'security';
      var bump = a.level === 'red' ? 0.4 : a.level === 'orange' ? 0.2 : a.level === 'yellow' ? 0.08 : 0.03;
      if (!ct._baseScores) ct._baseScores = JSON.parse(JSON.stringify(ct.scores));
      var old = ct.scores[dim] || 5;
      ct.scores[dim] = Math.min(10, Math.round((old + bump) * 100) / 100);
      ct.lastUpdate = a.time || _fmtNow();
      ct.trend = 'up';
      var maxDim = dim, maxV = -1;
      Object.keys(ct.scores).forEach(function (k) { if ((ct.scores[k] || 0) > maxV) { maxV = ct.scores[k]; maxDim = k; } });
      if (typeof DIMS !== 'undefined') { var d0 = DIMS.find(function (d) { return d.key === maxDim; }); if (d0) ct.mainRisk = d0.name; }
    } catch (e) {}
  }

  /* ---------- 当前打开视图随实时数据自动重绘（节流，全防御） ---------- */
  var _liveRefreshT = 0;
  function _refreshOpenViewLive() {
    var now = Date.now();
    if (now - _liveRefreshT < 2000) return; /* 节流 2s */
    _liveRefreshT = now;
    var v = window._currentView || 'situation';
    try {
      if (v === 'situation' && typeof SITUATION !== 'undefined') { SITUATION.renderLiveStats && SITUATION.renderLiveStats(); SITUATION.renderIntelPanels && SITUATION.renderIntelPanels(); SITUATION.renderAlertSummary && SITUATION.renderAlertSummary(); SITUATION.renderLiveCollected && SITUATION.renderLiveCollected(); }
      else if (v === 'alerts' && typeof AVIEW !== 'undefined') { AVIEW.renderQueue && AVIEW.renderQueue(); AVIEW.renderStats && AVIEW.renderStats(); AVIEW.renderFeed && AVIEW.renderFeed(); }
      else if (v === 'autoalert' && typeof AUTOALERT !== 'undefined' && AUTOALERT.render) AUTOALERT.render();
      else if (v === 'datacenter' && typeof DATACENTER !== 'undefined' && DATACENTER.renderTable) { DATACENTER.renderStats && DATACENTER.renderStats(); DATACENTER.renderTable(); DATACENTER.renderCollectedPanel && DATACENTER.renderCollectedPanel(); }
      else if (v === 'assets' && typeof ASSETS !== 'undefined' && ASSETS.init) ASSETS.init();
      else if (v === 'threatorgs' && typeof THREATS !== 'undefined' && THREATS.render) THREATS.render();
    } catch (e) {}
    try { if (typeof renderTicker === 'function') renderTicker(); } catch (e) {}
    /* 侧边栏预警徽章 */
    try {
      if (typeof ALERTS !== 'undefined') {
        var cnt = ALERTS.filter(function (x) { return x.status === 'active'; }).length;
        var badge = document.getElementById('sb-alert-count');
        if (badge) { badge.textContent = cnt; badge.classList.toggle('zero', cnt === 0); }
        var mb = document.getElementById('sb-mon-count');
        if (mb) { mb.textContent = cnt; mb.classList.toggle('zero', cnt === 0); }
      }
    } catch (e) {}
  }

  /* ============================================================
   * 核心：_ingestApproved(item, cat)
   * DBCenter.add/addBatch 在自动审核后调用本函数，把情报实时分发全系统。
   * ============================================================ */
  /* 海外利益关联评分（2026-08-16 用户指令：预警中心每条必须体现对中国海外利益安全的影响） */
  var _INTEREST_CN_RE = /中国|中资|中企|中方|华人|华侨|华裔|一带一路|涉华|对华|驻[^，。]{0,4}使馆|孔子|撤侨|Chinese|China|Beijing|CPEC|Belt and Road/i;
  var _INTEREST_ASSET_RE = /瓜达尔|中巴经济走廊|汉班托塔|比雷埃夫斯|皎漂|中老铁路|雅万|蒙内|亚吉|钱凯|科伦坡港口城|中白工业园|吉布提|莱基|坦赞|西芒杜|中欧班列|China Railway Express/i;
  var _INTEREST_ORG_RE = /塔利班|青年党|博科圣地|伊斯兰国|基地组织|胡塞|真主党|哈马斯|俾路支|Taliban|Shabaab|Boko|ISIS|Qaeda|Houthi|BLA|TTP/i;
  var _FOCUS_COUNTRIES = ['巴基斯坦','哈萨克斯坦','乌兹别克斯坦','吉尔吉斯斯坦','塔吉克斯坦','土库曼斯坦','老挝','柬埔寨','缅甸','印度尼西亚','马来西亚','泰国','越南','塞尔维亚','匈牙利','希腊','埃塞俄比亚','肯尼亚','吉布提','埃及','斯里兰卡','孟加拉国','尼泊尔','沙特阿拉伯','阿联酋','土耳其','白俄罗斯','波兰','苏丹','刚果(金)','刚果（金）','尼日利亚','伊拉克','也门','马里','尼日尔','索马里','阿富汗','叙利亚','利比亚','中非','莫桑比克','坦桑尼亚','赞比亚','津巴布韦','安哥拉','摩洛哥','突尼斯','阿尔及利亚','约旦','黎巴嫩','伊朗','印度','菲律宾','哥伦比亚','秘鲁','墨西哥','南非','阿根廷','智利','委内瑞拉','蒙古','喀麦隆','乍得','南苏丹'];
  function _interestScoreOf(a) {
    var txt = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '') + ' ' + String(a.content || '');
    var sc = 0;
    if (_INTEREST_CN_RE.test(txt)) sc += 30;
    if (_INTEREST_ASSET_RE.test(txt) || (a.asset_tags && a.asset_tags.length)) sc += 30;
    if (_INTEREST_ORG_RE.test(txt)) sc += 10;
    var dm = txt.match(/(\d+)\s*(?:人)?(?:死亡|遇难|身亡|丧生)|(\d+)\s*(?:killed|dead)/i);
    var dn = dm ? parseInt(dm[1] || dm[2], 10) : 0;
    if (dn >= 10) sc += 20; else if (dn > 0) sc += 8;
    if (_FOCUS_COUNTRIES.indexOf(String(a.country || '')) >= 0) sc += 20; /* 重点关注国安全事件=中方环境风险 */
    if ((a.corroboration || 0) > 1) sc += 5;
    return sc;
  }

  function _ingestApproved(item, cat) {
    if (!item) return;
    var key = 'K-' + cat + '-' + (item.id || _normTitle(item.title || item.title_zh || ''));
    if (_ingestedIds[key]) return;
    _ingestedIds[key] = 1;

    /* 事件级去重：同一事件不同来源/分类只生成一条预警，避免刷屏 */
    if (_isDuplicateEvent(item)) {
      try { console.log('[INGEST DEDUP] 事件级去重跳过: ' + String(item.title || '').slice(0, 40)); } catch (e) {}
      return;
    }

    /* 采集数据可能未跑 enrich：补跑实体关联判定（硬/软关联 + 体裁闸门） */
    if (typeof ENTITY !== 'undefined' && ENTITY.enrich && item.interestLinked === undefined) {
      try { item = ENTITY.enrich(item) || item; } catch (e) {}
    }

    /* 入口把关兜底①：预警中心只接收"与我海外利益直接关联"的情报。
     * 未关联(interestLinked!==true)的情报保留在数据中心可人工查阅，但不进预警/态势。 */
    /* 【铁律·2026-08-11 用户指令】所有采集数据必须全部进预警中心，不再以 interestLinked 拦截 */
    if (false && item.interestLinked !== true) return;

    /* 入口把关兜底②：相关性闸门（涉我海外利益安全），剔除纯国内/无关外讯（GEOINT 等受保护记录除外）。
     * 2026-08-20 修正：恢复 domestic-china / china-domestic-incident 等国内事务拦截，防止境内民生/治安新闻混入。
     * 此前 if(false&&...) 误放行"秦皇岛火灾"等纯国内事件。 */
    var text = (item.title_zh || item.title || '') + ' ' + (item.content_zh || item.content || item.desc || '');
    try {
      if (typeof GATE !== 'undefined' && GATE.chinaOverseasGate && !(GATE._isProtected && GATE._isProtected(item))) {
        var gr = GATE.chinaOverseasGate(text);
        if (!gr.pass) {
          console.log('[INGEST-GATE] 拦截非海外利益安全条目: ' + String(item.title || '').slice(0, 40) + ' | reason=' + gr.reason);
          return;
        }
      }
    } catch (e) {}
    /* 入口把关兜底③：体裁闸门（评论/学术论述 + 商业榜单/经济统计 一票否决） */
    try {
      if (typeof ENTITY !== 'undefined' && ENTITY.nonIntelGenre && ENTITY.nonIntelGenre(item)) return;
    } catch (e) {}
    /* 入口把关兜底④：原始时间闸门（2026-08-16 用户铁律：旧闻绝不盖新戳冒充今日预警）。
     * 预警时间一律采用情报自身的发布/采集时间；非今日 → 只留数据中心，不进预警中心。
     * 无任何时间字段的条目：仅当 DBCenter 本轮新入（collect_time 为当下）才放行。 */
    var _origTs = 0;
    try {
      /* 时效铁律（2026-08-18 修正）：发布时间只认来源原始时间字段 publish_time/publishedAt/pubDate/event_date/date，
       * 绝不拿"采集时间 collect_time"冒充发布时间——否则旧闻会被盖上今日新戳混入最新预警。
       * 实测：1/19 喀布尔中国餐馆爆炸（6个月前）无源日期 → 兜底采集时间 → 冒充今日预警。
       * 此前闸门漏读 publish_time（GTHEME 采集的日期存这里），导致大量条目误判为"无日期"走兜底。 */
      /* 日期解析需兼容两种格式：publish_time 是 RFC2822（"Tue, 18 Aug 2026 09:05:00 +0000"，Date.parse 原生支持，
       * 若先 replace 空格会破坏）；publishedAt/event_date 是 "YYYY-MM-DD HH:MM:SS"（需空格→T 转 ISO）。 */
      var _pts=function(s){ s=String(s||'').trim(); if(!s)return 0; var t=Date.parse(s); if(!isNaN(t))return t; t=Date.parse(s.replace(' ','T')); return isNaN(t)?0:t; };
      _origTs = _pts(item.publish_time) || _pts(item.publishedAt) || _pts(item.pubDate) || _pts(item.event_date) || _pts(item.date) || 0;
    } catch (e) {}
    /* 24小时滚动窗（2026-08-18 修正）：近24h才算"最新预警"。比"日历日零点切割"更稳——
     * 严格日历日会导致凌晨刚过零点时预警中心近乎清空（昨日数据一夜全被剔），滚动窗不会。
     * 同时仍满足"旧闻绝不冒充新讯"：超过24h的一律不进。 */
    var _freshCut = Date.now() - 24 * 60 * 60 * 1000;
    if (!_origTs) {
      /* 【铁律·2026-08-25 用户指令】旧闻绝不盖新戳冒充今日预警。
       * 无来源发布日期时，只认"真实采集时间"（collect_time，服务端/API 均已回填）兜底；
       * 严禁 Date.now()——那会把 5 月的旧闻盖上当下时间戳混入最新预警（实测：id 11233
       * 刚果村庄 5-08 旧闻无任何时间字段 → Date.now() → 显示为今日 00:39 预警，用户震怒）。
       * 本轮新采数据必经 DBCenter.add（采集时写入 collect_time=当下），不受影响；
       * 连采集时间都没有的 = 历史库中时效不可验证的存量 → 不进最新预警，数据中心留档可查。 */
      _origTs = _pts(item.collect_time) || _pts(item.collected_at) || _pts(item.time) || 0;
      if (!_origTs) {
        console.log('[INGEST-GATE] 无任何时间字段（时效不可验证）不入最新预警: ' + String(item.title || '').slice(0, 40));
        return;
      }
      item._noSourceDate = true;
    }
    if (_origTs < _freshCut) {
      /* 唯一保留的时效闸：能确定是 24h 之前的旧闻（无论源日期还是采集日期）才不进 */
      console.log('[INGEST-GATE] 超过24小时旧闻不入最新预警: ' + String(item.title || '').slice(0, 40) + ' | ' + new Date(_origTs).toISOString().slice(0, 10));
      return;
    }

    /* 归一化为预警对象（schema 对齐 ALERTS / AVIEW 渲染字段）
     * 国家标注修正（2026-08-12）：item.country 是"来源媒体所在国"（如 India.com 报道伊朗事件被标印度），
     * 优先从正文提取事发国，提不到才用来源国兜底。 */
    var country = _extractCountryFromText(text) || ((item.country && item.country !== '未知') ? item.country : '');
    var lv = _normLevel(item);
    /* 涉华一般信息保底黄色（红色判定已在 _normLevel 内完成：涉华+严重=红，不涉华+严重=橙） */
    if (lv === 'blue' && _hasChinaDirect(text)) lv = 'yellow';
    /* 蓝色级别不构成预警（2026-08-13 恢复执行分级铁律：蓝色=普通动态/分析文章，
     * 不进预警中心，数据中心/实时情报流保留可查） */
    if (lv === 'blue') {
      console.log('[INGEST-GATE] 蓝色提示级不入预警中心: ' + String(item.title || '').slice(0, 40));
      return;
    }
    /* 利益关联闸（2026-08-16 用户指令：预警中心只放与中国海外利益相关的预警）：
     * 黄色低烈度且无涉华/资产/威胁组织关联的，留数据中心不进预警中心；红/橙级一律放行 */
    /* 俄乌话题无涉华/资产关联 → 不进预警中心（2026-08-17 用户指令，数据中心留档） */
    if (/乌克兰|俄罗斯|Ukraine|Russia|Kyiv|Moscow|Zelensky|Putin|克里米亚|基辅|莫斯科|普京|泽连斯基|顿巴斯/i.test(String(item.title||'')+' '+String(item.title_zh||'')+' '+String(item.content||''))
        && !/中国|中资|中企|中方|华人|一带一路|涉华|Chinese|China|CPEC|瓜达尔|中欧班列/i.test(String(item.title||'')+' '+String(item.title_zh||'')+' '+String(item.content||''))) {
      console.log('[INGEST-GATE] 俄乌无涉华关联不入预警中心: ' + String(item.title || '').slice(0, 40));
      return;
    }
    if (_interestScoreOf(item) < 10) { /* 阈值 20→10（2026-08-17 日产≥200 条目标） */
      /* 2026-08-17：全级别利益关联闸——无涉华/资产/组织/重大伤亡关联的（含红橙俄乌战况）不生成预警 */
      console.log('[INGEST-GATE] 无利益关联不入预警中心: ' + String(item.title || '').slice(0, 40));
      return;
    }
    var typeMap = { terror_events: '安全风险', security_events: '安全风险', military_conflicts: '安全风险', political_events: '政治风险', natural_disasters: '自然环境风险', public_health: '安全风险', sanctions_data: '经济风险', social_unrest: '社会文化风险', infrastructure: '运营风险', geopolitical_intel: '地缘战略风险', osint_intel: '安全风险', socmint_intel: '安全风险' };
    var type = item.type || typeMap[cat] || '安全风险';
    var title = item.title || item.content || '实时情报';
    _liveCount++;
    var a = {
      id: item.id || ('LIVE-' + Date.now() + '-' + _liveCount),
      alert_no: item.alert_no || _makeAlertNo({ title: title, url: item.url || '', type: type, publishedAt: item.publishedAt || item.pubDate || '' }),
      level: lv, type: type, country: country, enterprise: item.enterprise || '',
      title: title,
      desc: (item.content_zh || item.content || item.desc || title),
      time: (function(){ var d=new Date(_origTs); var p=function(x){return String(x).padStart(2,'0');}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); })(), status: 'active', affectedP: item.affectedP || 0, affectedA: item.affectedA || 0,
      source: item.source || '实时采集', url: item.url || '', ext_url: item.ext_url || '',
      title_zh: item.title_zh || '', content_zh: item.content_zh || '',
      author: item.author || '', publishedAt: item.publishedAt || item.pubDate || '',
      alertLevel: item.alertLevel || '', credibility: item.credibility || '', social_platform: item.social_platform || '',
      corroboration: item.corroboration || 0,
      _live: true, _approved: true, _seq: _liveCount
    };

    /* 写入可解释性元数据 */
    try { if (typeof EXPLAINABILITY !== 'undefined') EXPLAINABILITY.explainAlert(a); } catch (e) {}

    /* 注入预警中心 ALERTS（去重 + 头插 + 上限） */
    try {
      if (typeof ALERTS !== 'undefined') {
        var normA = _normTitle(a.title || '');
        var dupIdx = -1;
        for (var _ai = 0; _ai < ALERTS.length; _ai++) {
          if ((ALERTS[_ai].country || '') === (a.country || '') && _normTitle(ALERTS[_ai].title || '') === normA && normA.length >= 8) {
            dupIdx = _ai; break;
          }
        }
        if (dupIdx >= 0) {
          var dup = ALERTS[dupIdx];
          var levelOrder = { red: 4, orange: 3, yellow: 2, blue: 1 };
          if ((levelOrder[a.level] || 0) > (levelOrder[dup.level] || 0)) dup.level = a.level;
          if (a.time && (!dup.time || new Date(a.time) > new Date(dup.time))) dup.time = a.time;
          if (a.url && !dup.url) dup.url = a.url;
          console.log('[INGEST DEDUP] ALERTS 已存在同标题记录，合并: ' + String(a.title).slice(0, 40));
        } else {
          ALERTS = ALERTS.filter(function (x) { return String(x.id) !== String(a.id); });
          ALERTS.unshift(a);
          if (ALERTS.length > 500) ALERTS.length = 500;
        }
      }
    } catch (e) {}
    /* 注入事件流 EVENTS（ticker 联动） */
    try {
      if (typeof EVENTS !== 'undefined') {
        EVENTS.unshift({ id: 'live-' + a.id, title: a.title, country: a.country, date: a.time, type: a.type, severity: lv === 'red' ? 'critical' : lv === 'orange' ? 'high' : 'medium', status: 'active', _live: true });
        if (EVENTS.length > 300) EVENTS.length = 300;
      }
    } catch (e) {}
    /* 注入恐袭库 TERROR_EVENTS（安全类 / 红橙） */
    try {
      if (typeof TERROR_EVENTS !== 'undefined' && (type === '安全风险' || lv === 'red' || lv === 'orange')) {
        TERROR_EVENTS.unshift({ id: a.id, title: a.title, location: a.country, date: a.time, severity: lv === 'red' ? '高' : lv === 'orange' ? '中' : '低', type: a.type, _live: true });
        if (TERROR_EVENTS.length > 200) TERROR_EVENTS.length = 200;
      }
    } catch (e) {}

    /* 国家风险分数联动 */
    _applyLiveToCountryScore(a);

    /* 情报总线联动：让企业资产/威胁组织/风险矩阵/情报中心同步收到实时信号。
     * 之前只有 _addLiveAlert 走 INTELBUS，导致 DATASOURCES→DBCenter→_ingestApproved 链路的数据无法联动各功能区。 */
    try { if (typeof INTELBUS !== 'undefined' && INTELBUS.publish && typeof normalizeLiveAlert === 'function') INTELBUS.publish(normalizeLiveAlert(a)); } catch (e) {}

    /* 持久化 + 通知订阅（SITUATION 等） */
    try { if (typeof DataHub !== 'undefined' && DataHub.save) { DataHub.save('alerts'); DataHub.save('events'); DataHub.save('terror_events'); DataHub.save('countries'); } } catch (e) {}
    try { if (typeof DataHub !== 'undefined' && DataHub._notify) DataHub._notify('live'); } catch (e) {}

    /* 情报总线联动：把通过数据中心的实时数据也扇出到情报中心/企业资产/威胁组织/风险矩阵 */
    try { if (typeof INTELBUS !== 'undefined' && INTELBUS.publish && typeof normalizeLiveAlert === 'function') INTELBUS.publish(normalizeLiveAlert(a)); } catch (e) {}

    /* 自动预警事件驱动：将实时审核通过数据送入自动预警原始候选队列 */
    try {
      if (typeof AUTOALERT !== 'undefined' && AUTOALERT.onLiveItem) {
        AUTOALERT.onLiveItem(item, cat);
      }
    } catch (e) {}

    /* 情报总线联动：让企业资产/威胁组织/风险矩阵/情报中心实时感知新数据 */
    try { if (typeof INTELBUS !== 'undefined' && INTELBUS.publish && typeof normalizeLiveAlert === 'function') INTELBUS.publish(normalizeLiveAlert(a)); } catch (e) {}

    /* 情报总线联动：把实时预警规范化为统一事件，扇出到企业资产/威胁组织/风险矩阵/情报中心 */
    try {
      if (typeof INTELBUS !== 'undefined' && INTELBUS.publish && typeof normalizeLiveAlert === 'function') {
        INTELBUS.publish(normalizeLiveAlert(a));
      }
    } catch (e) {}

    /* 情报总线联动：把实时预警扇出到 情报中心/企业资产/威胁组织/风险矩阵，
     * 修复 DATASOURCES 自动采集链路只进 ALERTS 不进 INTELBUS 的断裂。 */
    try {
      if (typeof INTELBUS !== 'undefined' && INTELBUS.publish && typeof normalizeLiveAlert === 'function') {
        INTELBUS.publish(normalizeLiveAlert(a));
      }
    } catch (e) {}

    /* 当前打开视图自动重绘 */
    _refreshOpenViewLive();

    /* 情报总线联动：让通过 DBCenter 分发的数据也能联动 情报中心/企业资产/威胁组织/风险矩阵。
     * 避免 DATASOURCES 采集链路只进 ALERTS 却未触发跨模块联动。 */
    try {
      if (typeof INTELBUS !== 'undefined' && INTELBUS.publish && typeof normalizeLiveAlert === 'function') {
        INTELBUS.publish(normalizeLiveAlert(a));
      }
    } catch (e) {}

    try { console.log('[INGEST ✓] 实时分发: ' + String(title).slice(0, 30) + ' (' + (country || '全球') + ' / ' + lv + ')'); } catch (e) {}
  }

  /* ============================================================
   * DATACENTER._refreshAllViews —— DBCenter.add 后刷新数据中心各面板
   * （当前 app.js 在 DBCenter.add 里调用它，但此前从未定义 → 静默空操作）
   * ============================================================ */
  function _installDatacenterRefresh() {
    if (typeof DATACENTER === 'undefined') return;
    if (typeof DATACENTER._refreshAllViews === 'function') return; /* 已存在则不覆盖 */
    DATACENTER._refreshAllViews = function () {
      try { this.updateBadge && this.updateBadge(); } catch (e) {}
      /* 仅当用户正在数据中心视图时才重绘表格，避免后台频繁重绘 */
      try {
        if (window._currentView === 'datacenter') {
          this.renderStats && this.renderStats();
          this.renderTabs && this.renderTabs();
          this.renderTable && this.renderTable();
          this.renderCollectedPanel && this.renderCollectedPanel();
        }
      } catch (e) {}
    };
  }

  /* 存量预警修正：非涉华红色降橙 + 机器生成条目的国家标注按正文纠错 */
  function _fixExistingAlerts() {
    if (typeof ALERTS === 'undefined') return 0;
    var lvFixed = 0, ctyFixed = 0, purged = 0, staleDropped = 0;
    /* 定向清除（2026-08-12 用户指令删除）：阿富汗/塔吉克斯坦中国工人死亡条目 */
    var PURGE_RE = /阿富汗承诺在跨境袭击中合作.*塔吉克斯坦|3名中国工人在塔吉克斯坦死亡/i;
    /* 时效铁律（2026-08-13 用户指令）：预警中心只保留近 48 小时的预警，旧闻达不到预警效果 */
    var FRESH_MS = 24 * 60 * 60 * 1000;
    for (var i = ALERTS.length - 1; i >= 0; i--) {
      var a0 = ALERTS[i];
      var t0 = String(a0.title || '') + ' ' + String(a0.desc || '') + ' ' + String(a0.title_zh || '');
      if (PURGE_RE.test(t0)) { ALERTS.splice(i, 1); purged++; continue; }
      /* 时效清理（2026-08-13 加严）：无可解析日期 = 旧种子数据，直接移出；
       * 有日期但超 24h 的旧预警同样移出（数据中心档案保留） */
      var ts = a0.publishedAt || a0.pubDate || a0.time || '';
      var d0 = ts ? new Date(String(ts).replace('T', ' ').replace('Z', '')) : null;
      if (!d0 || isNaN(d0.getTime())) { ALERTS.splice(i, 1); staleDropped++; continue; }
      if ((Date.now() - d0.getTime()) > FRESH_MS) { ALERTS.splice(i, 1); staleDropped++; continue; }
      /* 蓝色提示级移出预警中心（分级铁律） */
      if (a0.level === 'blue') { ALERTS.splice(i, 1); staleDropped++; continue; }
      var text = t0;
      if (a0.level === 'red' && !_hasChinaDirect(text)) { a0.level = 'orange'; lvFixed++; }
      if (a0._live) {
        var c = _extractCountryFromText(text);
        if (c && a0.country && c !== a0.country) { a0.country = c; ctyFixed++; }
      }
    }
    /* 同题去重（2026-08-13 用户指令）：预警队列同一标题只留最新一条 */
    var _seenAlertT = {}, dedupDropped = 0;
    for (var q = ALERTS.length - 1; q >= 0; q--) {
      var aq = ALERTS[q];
      var kk = String(aq.title_zh || aq.title || '').toLowerCase().replace(/[^\w一-龥]+/g, '').slice(0, 40);
      if (kk && _seenAlertT[kk]) { ALERTS.splice(q, 1); dedupDropped++; }
      else if (kk) _seenAlertT[kk] = 1;
    }
    if (dedupDropped) { try { if (typeof DataHub !== 'undefined' && DataHub.save) DataHub.save('alerts'); } catch (e) {} console.log('[BACKFILL] 预警队列同题去重 ' + dedupDropped + ' 条'); }
    /* 同步清除事件流/实时流中的对应条目（含无日期/超龄旧数据）
     * 2026-08-13 修：事件流条目用 date 字段（如 2026-08-13），此前漏判 o.date
     * 导致事件追踪列表被整体清空；LIVE_ALERTS 用 time。此处只清"超龄"，无日期不再一刀切 */
    if (purged || staleDropped) {
      var _stale = function (o) {
        if (!o) return true;
        if (PURGE_RE.test(String(o.title || '') + ' ' + String(o.title_zh || ''))) return true;
        var ts = o.publishedAt || o.pubDate || o.time || o.date || o.createdAt || '';
        var dd = ts ? new Date(String(ts).replace('T', ' ').replace('Z', '')) : null;
        if (!dd || isNaN(dd.getTime())) return false; /* 无日期：保留（事件流为手工/业务登记，不是采集旧闻） */
        return (Date.now() - dd.getTime()) > FRESH_MS;
      };
      /* EVENTS 是业务登记的追踪对象（合法跨越数周），不按 24h 情报时效清理，只清定向删除项 */
      try { if (typeof EVENTS !== 'undefined') { for (var j = EVENTS.length - 1; j >= 0; j--) { if (PURGE_RE.test(String(EVENTS[j].title || ''))) EVENTS.splice(j, 1); } } } catch (e) {}
      try { if (typeof LIVE_ALERTS !== 'undefined') { for (var k = LIVE_ALERTS.length - 1; k >= 0; k--) { if (_stale(LIVE_ALERTS[k])) LIVE_ALERTS.splice(k, 1); } } } catch (e) {}
      /* 同步清除 DBCenter 本地库存根（否则下次回填会复活）；
       * SEED_RE：早期人造演示数据（违反零模拟铁律），从本地库永久清除 */
      var SEED_RE = /可疑车辆.*疑似侦察|大豆压榨厂|中粮集团.*巴西|示例数据|演示数据/i;
      try {
        if (typeof DBCenter !== 'undefined') {
          ['terror_events','security_events','military_conflicts','political_events','natural_disasters','public_health','sanctions_data','social_unrest','infrastructure','geopolitical_intel','osint_intel'].forEach(function (s) {
            var rows = DBCenter.getAll(s) || [];
            var kept = rows.filter(function (r) {
              var rt = String(r.title || '') + ' ' + String(r.title_zh || '') + ' ' + String(r.content || '');
              return !PURGE_RE.test(rt) && !SEED_RE.test(rt);
            });
            if (kept.length !== rows.length) DBCenter._w(s, kept);
          });
        }
      } catch (e) {}
      try { if (typeof DataHub !== 'undefined' && DataHub.save) { DataHub.save('alerts'); DataHub.save('events'); } } catch (e) {}
      if (purged) console.log('[BACKFILL] 定向清除塔吉克斯坦条目 ' + purged + ' 条（含DBCenter存根）');
      if (staleDropped) console.log('[BACKFILL] 时效清理：移出超48小时旧预警 ' + staleDropped + ' 条');
    }
    if (lvFixed || ctyFixed) {
      try { if (typeof DataHub !== 'undefined' && DataHub.save) DataHub.save('alerts'); } catch (e) {}
      console.log('[BACKFILL] 存量修正：红色降橙 ' + lvFixed + ' 条，国家纠错 ' + ctyFixed + ' 条');
    }
    return lvFixed + ctyFixed + purged + staleDropped;
  }

  /* ============================================================
   * 历史数据回填（2026-08-11 用户指令：所有采集数据必须进预警中心）
   * 之前被 interestLinked/相关性/蓝色级别三道闸门拦在预警中心之外的历史情报，
   * 页面加载后一次性回填分发，保证 DBCenter 全量数据都进入 ALERTS。
   * ============================================================ */
  function _backfillAllToAlerts() {
    if (typeof DBCenter === 'undefined' || !DBCenter.getAll) return;
    var stores = ['terror_events', 'security_events', 'military_conflicts', 'political_events', 'natural_disasters', 'public_health', 'sanctions_data', 'social_unrest', 'infrastructure', 'geopolitical_intel', 'osint_intel'];
    var n = 0;
    var FRESH_MS = 24 * 60 * 60 * 1000;
    stores.forEach(function (s) {
      var rows = [];
      try { rows = DBCenter.getAll(s) || []; } catch (e) {}
      rows.forEach(function (it) {
        if (!it || it.audit_status === 'rejected') return;
        /* 时效闸（2026-08-19 按用户铁律放宽）：发布时间或采集时间 ≤24h 即回填。
         * 无源日期条目用 collect_time 兜底——所有采集数据必须进预警中心，
         * 仅"能确定超过24h"的才不回填（防历史旧闻每晚复活）。 */
        var ts = it.publish_time || it.publishedAt || it.pubDate || it.event_date || it.date || it.time || it.collect_time || '';
        /* 日期解析兼容 RFC2822（publish_time="Tue, 18 Aug 2026..."）与 ISO（"YYYY-MM-DD HH:MM:SS"）。
         * 原 .replace('T',' ') 会把 RFC 开头 "Tue/Thu" 的 T 替换掉 → 解析失败 → 误删正常今日新讯。 */
        var d = null;
        if (ts) { var _s = String(ts).trim(); var _t = Date.parse(_s); if (isNaN(_t)) _t = Date.parse(_s.replace(' ', 'T')); if (!isNaN(_t)) d = new Date(_t); }
        if (!d) return;
        if ((Date.now() - d.getTime()) > FRESH_MS) return;
        try { _ingestApproved(it, s); n++; } catch (e) {}
      });
    });
    try { if (typeof DataHub !== 'undefined' && DataHub.save) { DataHub.save('alerts'); DataHub.save('events'); DataHub.save('terror_events'); } } catch (e) {}
    try { console.log('[BACKFILL] 历史数据回填预警中心完成，处理 ' + n + ' 条，ALERTS=' + (typeof ALERTS !== 'undefined' ? ALERTS.length : '?')); } catch (e) {}
    /* 回填完成后修正存量：非涉华红色降橙 + 国家标注纠错 */
    _fixExistingAlerts();
    _refreshOpenViewLive();
  }
  window._backfillAllToAlerts = _backfillAllToAlerts;

  /* ============================================================
   * 服务端→前端数据同步（2026-08-19 铁律：所有采集数据必须进预警中心）
   * 架构缺口修复：服务器 7×24 采集进 PostgreSQL，但前端只 push 不 pull，
   * 服务端数据从未进过浏览器。现每 5 分钟拉取 11 类库合并进 DBCenter（去重），
   * 再走回填进预警中心——浏览器关闭期间服务器采的数据也能看到了。
   * 注意：直接 _w 写库，不走 DBCenter.add（add 会回推服务器形成环路）。
   * ============================================================ */
  function _syncServerToDBCenter(done) {
    if (typeof APIClient === 'undefined' || !APIClient.getIntel || typeof DBCenter === 'undefined') { if (done) done(); return; }
    var stores = ['terror_events', 'security_events', 'military_conflicts', 'political_events', 'natural_disasters', 'public_health', 'sanctions_data', 'social_unrest', 'infrastructure', 'geopolitical_intel', 'osint_intel'];
    var pending = stores.length, added = 0;
    function fin() { if (--pending === 0) { try { console.log('[SYNC] 服务端→前端同步完成，新增 ' + added + ' 条进 DBCenter'); } catch (e) {} if (done) done(); } }
    stores.forEach(function (s) {
      var settled = false;
      function done() { if (!settled) { settled = true; clearTimeout(guard); fin(); } }
      var guard = setTimeout(done, 12000); /* 单库 12s 超时兜底 */
      APIClient.getIntel(s).then(function (rows) {
        var list = Array.isArray(rows) ? rows : ((rows && rows.data) || []);
        if (list.length) {
          var existing = [];
          try { existing = DBCenter.getAll(s) || []; } catch (e) {}
          var seen = {};
          existing.forEach(function (e) { seen[(e.link || e.url || '') + '|' + String(e.title_en || e.title || '').slice(0, 60)] = 1; });
          var fresh = [];
          list.forEach(function (it) {
            if (!it || !it.title) return;
            var k = (it.link || it.url || '') + '|' + String(it.title_en || it.title || '').slice(0, 60);
            if (seen[k]) return;
            seen[k] = 1;
            it._fromServer = true;
            if (!it.audit_status) it.audit_status = 'approved';
            fresh.push(it);
          });
          if (fresh.length) {
            var merged = existing.concat(fresh);
            if (merged.length > 800) merged = merged.slice(-800);
            try { DBCenter._w(s, merged); } catch (e) {}
            added += fresh.length;
          }
        }
        done();
      }).catch(done);
    });
  }
  window._syncServerToDBCenter = _syncServerToDBCenter;

  /* 页面加载后：先同步服务端数据 → 再回填预警中心；之后每 5 分钟循环（实时性保障） */
  function _syncThenBackfill() {
    try { _syncServerToDBCenter(function () { try { _backfillAllToAlerts(); } catch (e) {} }); }
    catch (e) { try { _backfillAllToAlerts(); } catch (e2) {} }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(_syncThenBackfill, 4000); });
  } else {
    setTimeout(_syncThenBackfill, 4000);
  }
  setInterval(_syncThenBackfill, 5 * 60 * 1000);

  /* ---------- 导出到全局 ---------- */
  window._ingestApproved = _ingestApproved;
  window._refreshOpenViewLive = _refreshOpenViewLive;
  window._applyLiveToCountryScore = _applyLiveToCountryScore;
  window._normTitle = window._normTitle || _normTitle;
  window._fmtNow = window._fmtNow || _fmtNow;
  window._makeAlertNo = window._makeAlertNo || _makeAlertNo;
  window._extractCountryFromText = window._extractCountryFromText || _extractCountryFromText;

  /* 安装 DATACENTER._refreshAllViews（DOM 就绪后，确保 DATACENTER 已定义） */
  if (typeof DATACENTER !== 'undefined') _installDatacenterRefresh();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _installDatacenterRefresh);
  else _installDatacenterRefresh();
})();
