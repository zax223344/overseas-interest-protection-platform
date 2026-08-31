/* ============================================================
 * manual-entry.js — 手动录入独立工作区（前端主逻辑）v1
 * 2026-09-01
 *
 * · 12 类情报体系卡片式录入（对齐 server INTEL_TYPES + 经济金融类）
 * · 智能辅助：涉华预检 / severity 建议 / 自动归类建议 / 重复检测
 * · 并发安全：服务端 UUID + request_id 幂等 + version 乐观锁(409) + 草稿自动保存
 * · 复合化 HUD 布局：左主表单 / 右实时面板 / 底部最近录入 / 模板库 / CSV 批量
 * · 铁律：提交成功 → 同步写入 ALERTS（预警中心），手动条目带 is_manual 标记
 * ============================================================ */
(function () {
  'use strict';

  /* ===== 12 类情报体系（与服务端 manual-entry.js CATS 同源） ===== */
  var CATS = [
    { key: 'terror_events', ic: '💥', label: '恐怖袭击', color: '#ff3355', sub: ['自杀式爆炸', '武装袭击', '汽车炸弹', 'IED爆炸', '绑架劫持', '无人机攻击', '枪击扫射'], kws: '恐袭|恐怖袭击|爆炸|自杀式|炸弹|IED|枪击|绑架|武装袭击|塔利班|ISIS|基地组织' },
    { key: 'security_events', ic: '🛡️', label: '涉华安全', color: '#ff8800', sub: ['中资企业遇袭', '中国公民受害', '绑架劫持', '使馆领保案件', '排华事件', '项目营地遇袭'], kws: '中资|中企|华人|华侨|中方人员|中国公民|使馆|领保|撤侨|排华' },
    { key: 'military_conflicts', ic: '⚔️', label: '武装冲突', color: '#ff5577', sub: ['武装冲突', '内战', '跨境冲突', '空袭炮击', '边境对峙', '停火破裂'], kws: '冲突|交火|空袭|内战|炮击|战线|停火|军事对抗|叛乱' },
    { key: 'political_events', ic: '🏛️', label: '政治风险', color: '#b366ff', sub: ['政变军变', '政府更迭', '选举争议', '大规模示威', '紧急状态', '议会危机'], kws: '政变|选举|议会|总统|临时政府|紧急状态|军方接管' },
    { key: 'geopolitical_intel', ic: '🌐', label: '地缘情报', color: '#00d4ff', sub: ['双边关系', '多边外交', '安全预警', '战略调整', '领事提醒', '军事部署'], kws: '外交|双边|峰会|地缘|战略|台海|南海|军演|部署' },
    { key: 'sanctions_data', ic: '🚫', label: '制裁合规', color: '#ffcc00', sub: ['经济制裁', '实体清单', '出口管制', '金融制裁', '贸易限制', '反倾销'], kws: '制裁|实体清单|出口管制|OFAC|关税|禁运|反倾销|黑名单' },
    { key: 'social_unrest', ic: '💬', label: '社会动荡', color: '#ffaa00', sub: ['罢工停工', '抗议示威', '骚乱打砸', '民众运动', '排外情绪', '抢购潮'], kws: '罢工|骚乱|示威|游行|暴乱|抢购|堵路|停产' },
    { key: 'natural_disasters', ic: '🌊', label: '自然灾害', color: '#00ff9f', sub: ['地震', '台风气旋', '洪水涝灾', '火山喷发', '山火', '海啸'], kws: '地震|台风|洪水|海啸|火山|山火|气旋|泥石流|干旱' },
    { key: 'public_health', ic: '🧧', label: '公共卫生', color: '#00cc88', sub: ['传染病疫情', '霍乱疟疾', '食品安全', '环境污染', '医疗挤兑', '疫苗事件'], kws: '疫情|传染病|霍乱|埃博拉|疟疾|污染|食品安全|感染' },
    { key: 'infrastructure', ic: '🚧', label: '基础设施', color: '#66aaff', sub: ['港口码头', '铁路公路', '电站电网', '油气管道', '工业园区', '通信网络'], kws: '港口|铁路|公路|电站|断电|管网|园区|机场|大桥' },
    { key: 'osint_intel', ic: '🕵️', label: '开源情报', color: '#88ddff', sub: ['社媒情报', '泄露文件', '组织声明', '舆情动态', '线人线索', '影像判读'], kws: '开源|社媒|泄露|声明|舆情|线索|Telegram|研判素材' },
    { key: 'economic_risk', ic: '📉', label: '经济金融', color: '#ffd24d', sub: ['汇率波动', '通胀恶化', '外汇管制', '债务违约', '银行挤兑', '资产冻结'], kws: '汇率|通胀|违约|外汇|破产|货币贬值|股市|债务|挤兑' }
  ];
  var LEVEL_META = {
    red: { label: '红色', color: '#ff3355', desc: '重大威胁，需立即响应' },
    orange: { label: '橙色', color: '#ff8800', desc: '显著风险，需加密关注' },
    yellow: { label: '黄色', color: '#ffcc00', desc: '一般风险，持续跟踪' },
    blue: { label: '蓝色', color: '#00d4ff', desc: '提示级动态，供研判参考' }
  };
  var REL_META = {
    A: { label: '完全可信', desc: '多源交叉验证 / 官方权威发布' },
    B: { label: '通常可信', desc: '可靠渠道单源，与背景相符' },
    C: { label: '基本可信', desc: '单一来源，逻辑合理待验证' },
    D: { label: '存疑', desc: '来源不明或与他源矛盾' },
    E: { label: '不可信', desc: '传闻 / 无法核实' }
  };
  var CLASSIFICATIONS = ['公开', '内部', '秘密'];
  var CHANNELS = ['现场联络员', '使领馆通报', '中企项目组', '属地安保', '公开新闻', '官方公报', '社交媒体', '线人渠道', '内部简报', '其他'];
  var CURRENCIES = ['USD', 'CNY', 'EUR', 'PKR', 'SAR', 'AED', 'RUB', 'KZT', 'IDR', 'MYR', '其他'];

  /* ===== 状态 ===== */
  var S = {
    inited: false, cat: null, mode: 'single',
    list: [], meta: null, tierCountries: [],
    scope: 'all', searchQ: '', filterCat: '', filterLevel: '', page: 1, PAGE: 15,
    drafts: [], formTs: 0, submitting: false,
    edit: null,            /* {id, version, entry, conflict} */
    batchQueue: [],        /* 批量模式暂存行 */
    batchBusy: false
  };

  /* ===== 工具 ===== */
  function $(id) { return document.getElementById(id); }
  function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toast(msg) { try { showToast(msg); } catch (e) { console.log('[MANUAL]', msg); } }
  function _user() { try { return (AUTH && AUTH.user && AUTH.user.name) || '未知用户'; } catch (e) { return '未知用户'; } }
  function _token() { try { return (typeof APIClient !== 'undefined' && APIClient.getToken()) || ''; } catch (e) { return ''; } }
  function _uuid() {
    try { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxxyxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }) + Date.now(); }
    catch (e) { return 'me-' + Date.now() + '-' + Math.floor(Math.random() * 1e8); }
  }
  function _nowLocal() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }
  function _fmtTs(t) { try { return String(t || '').replace('T', ' ').slice(0, 19); } catch (e) { return ''; } }
  function catOf(k) { for (var i = 0; i < CATS.length; i++) if (CATS[i].key === k) return CATS[i]; return null; }

  /* API 封装（不用 APIClient._fetch：需要拿 409 响应体） */
  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var tk = _token(); if (tk) headers['Authorization'] = 'Bearer ' + tk;
    var opts = { method: method, headers: headers };
    if (body !== undefined && method !== 'GET') opts.body = JSON.stringify(body);
    return fetch('/api/manual-entries' + path, opts).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    }).catch(function (e) { return { ok: false, status: 0, data: { error: '网络异常: ' + e.message } }; });
  }

  /* ===== 智能辅助：涉华预检 ===== */
  function chinaPrecheck(title, content) {
    var t = String(title || '') + ' ' + String(content || '');
    if (!t.trim()) return { known: false, hit: false };
    try {
      if (typeof GATE !== 'undefined' && GATE.isChinaRelatedStrict) return { known: true, hit: !!GATE.isChinaRelatedStrict(t) };
    } catch (e) { }
    return { known: false, hit: /中国|中资|中企|中方|华人|华侨|涉华|对华|驻外使馆|Chinese|China/i.test(t) };
  }
  /* ===== 智能辅助：severity 建议（规则：伤亡 > 涉华 > 类别烈度） ===== */
  function suggestSeverity(d) {
    var deaths = Number(d.deaths) || 0, injured = Number(d.injured) || 0;
    var txt = String(d.title || '') + ' ' + String(d.content || '');
    var china = d.china_related === true || chinaPrecheck(d.title, d.content).hit;
    if (deaths >= 10) return { level: 'red', why: '重大伤亡（死亡≥10人）' };
    if (china && (deaths > 0 || /绑架|劫持|人质|遇害|身亡|被杀/.test(txt))) return { level: 'red', why: '涉华且出现人员遇害/绑架要素' };
    if (/撤侨|使馆.*遇袭|袭击.*(营地|项目)|海盗劫船/.test(txt) && china) return { level: 'red', why: '涉华重大安全事件要素' };
    if (deaths > 0 || injured >= 10) return { level: 'orange', why: deaths > 0 ? '有人员死亡' : '受伤≥10人' };
    if (/爆炸|空袭|恐袭|袭击|冲突|交火|政变|制裁|骚乱|劫持/.test(txt)) return { level: 'orange', why: '高烈度事件要素' };
    if (china) return { level: 'orange', why: '涉华关联（建议至少橙色关注）' };
    var c = catOf(d.data_type);
    if (c && (c.key === 'social_unrest' || c.key === 'public_health')) return { level: 'yellow', why: '动荡/卫生类事件，一般风险' };
    if (c && (c.key === 'geopolitical_intel' || c.key === 'osint_intel' || c.key === 'economic_risk')) return { level: 'yellow', why: '情报/经济类，提示级跟踪' };
    return { level: 'blue', why: '无伤亡与高烈度要素' };
  }
  /* ===== 智能辅助：类别建议 ===== */
  function suggestCat(title, content) {
    var t = String(title || '') + ' ' + String(content || '');
    if (!t.trim()) return null;
    var best = null, bestN = 0;
    CATS.forEach(function (c) {
      var kws = c.kws.split('|'), n = 0;
      kws.forEach(function (k) { if (t.indexOf(k) >= 0) n++; });
      if (n > bestN) { bestN = n; best = c; }
    });
    return bestN > 0 ? best : null;
  }
  /* ===== 智能辅助：标题相似度（字符二元组 Jaccard） ===== */
  function _bigrams(s) { s = String(s || '').replace(/\s+/g, ''); var g = {}; for (var i = 0; i < s.length - 1; i++) g[s.substr(i, 2)] = 1; return Object.keys(g); }
  function titleSim(a, b) {
    var A = _bigrams(a), B = {}; _bigrams(b).forEach(function (x) { B[x] = 1; });
    if (!A.length || !Object.keys(B).length) return 0;
    var hit = 0; A.forEach(function (x) { if (B[x]) hit++; });
    return hit / (A.length + Object.keys(B).length - hit);
  }
  function dupCheck(title) {
    if (!title || title.length < 6) return [];
    var out = [];
    S.list.forEach(function (x) {
      var t = x.title || (x.entry && x.entry.title) || '';
      var sc = titleSim(title, t);
      if (sc >= 0.55) out.push({ item: x, score: Math.round(sc * 100) });
    });
    return out.slice(0, 3);
  }

  /* ===== 项目/企业选项（ENTERPRISES 底数，双写法兼容 {n,c,inv,p} 与全称） ===== */
  function projectOptions() {
    var seen = {}, out = [];
    try {
      (window.ENTERPRISES || []).forEach(function (e) {
        (e.projects || []).forEach(function (p) {
          var name = (p && (p.name || p.n)) || '', c = (p && (p.country || p.c)) || '';
          if (name && !seen[name]) { seen[name] = 1; out.push({ name: name, country: c, ent: e.short || e.name || '' }); }
        });
      });
    } catch (e) { }
    return out;
  }
  function entOptions() {
    var out = [];
    try { (window.ENTERPRISES || []).forEach(function (e) { if (e.short || e.name) out.push(e.short || e.name); }); } catch (e) { }
    return out;
  }
  function countryOptions() {
    var out = [];
    (S.tierCountries || []).forEach(function (c) { out.push(c); });
    try {
      (window.COUNTRIES || []).forEach(function (c) { if (c && c.name && out.indexOf(c.name) < 0) out.push(c.name); });
    } catch (e) { }
    return out;
  }

  /* ===== CSS（HUD 深空风格：与系统情报指挥中心一致，禁止浅色） ===== */
  var CSS_ID = 'manual-entry-css';
  var CSS_TEXT = [
    '#view-manual-entry{padding:0}',
    '.me-root{padding:14px 16px 20px;max-width:1660px;margin:0 auto}',
    '.me-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:linear-gradient(90deg,rgba(0,212,255,.08),transparent 70%);border:1px solid var(--border);border-radius:10px}',
    '.me-head .tt{font-size:15px;font-weight:800;letter-spacing:1px;color:var(--cyan);text-shadow:0 0 12px rgba(0,212,255,.35)}',
    '.me-head .sub{font-size:11px;color:var(--text2)}',
    '.me-modes{margin-left:auto;display:flex;gap:6px}',
    '.me-mode-btn{padding:5px 14px;border-radius:14px;border:1px solid var(--border2);background:var(--bg2);color:var(--text2);font-size:11px;cursor:pointer;transition:.15s;white-space:nowrap}',
    '.me-mode-btn:hover{color:var(--cyan);border-color:var(--cyan)}',
    '.me-mode-btn.on{background:rgba(0,212,255,.15);color:var(--cyan);border-color:var(--cyan);box-shadow:0 0 10px rgba(0,212,255,.25)}',
    '.me-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:12px;align-items:start}',
    '@media(max-width:1180px){.me-grid{grid-template-columns:1fr}.me-side{order:2}}',
    '.me-panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px;position:relative;overflow:hidden}',
    '.me-panel::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(0,212,255,.4),transparent)}',
    '.me-ptt{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:800;color:var(--text);letter-spacing:1px;margin-bottom:10px}',
    '.me-ptt .ic{color:var(--cyan)}',
    '.me-ptt .cnt{margin-left:auto;font-size:10px;color:var(--text3);font-weight:400}',
    '/* 类别卡片 */',
    '.me-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px}',
    '.me-cat{position:relative;padding:9px 8px;border-radius:9px;border:1px solid var(--border);background:var(--bg2);cursor:pointer;text-align:center;transition:.18s;overflow:hidden}',
    '.me-cat:hover{border-color:var(--c);box-shadow:0 0 14px -2px var(--c);transform:translateY(-2px)}',
    '.me-cat .ic{font-size:19px;display:block;margin-bottom:3px;filter:drop-shadow(0 0 6px var(--c))}',
    '.me-cat .lb{font-size:11.5px;font-weight:700;color:var(--text2)}',
    '.me-cat .hd{font-size:9px;color:var(--text3);margin-top:2px;height:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.me-cat.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 12%,transparent)}',
    '.me-cat.on .lb{color:var(--text)}',
    '.me-cat.on::after{content:"●";position:absolute;top:4px;right:6px;font-size:8px;color:var(--c);text-shadow:0 0 6px var(--c)}',
    '/* 表单 */',
    '.me-fgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px 10px}',
    '.me-f.full{grid-column:1/3}',
    '.me-lb{display:block;font-size:10.5px;color:var(--text2);margin-bottom:3px;letter-spacing:.5px}',
    '.me-lb .req{color:var(--red)}',
    '.me-in,.me-sel,textarea.me-ta{width:100%;padding:7px 9px;background:rgba(7,11,20,.7);border:1px solid var(--border);border-radius:7px;color:var(--text);font-size:12px;font-family:inherit;transition:.15s;outline:none}',
    '.me-in:focus,.me-sel:focus,textarea.me-ta:focus{border-color:var(--cyan);box-shadow:0 0 0 2px rgba(0,212,255,.12)}',
    '.me-sel option{background:#0c1120}',
    'textarea.me-ta{resize:vertical;line-height:1.6}',
    '.me-in::placeholder,textarea.me-ta::placeholder{color:var(--text3)}',
    '.me-3col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}',
    '.me-2col{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '/* severity 色环 */',
    '.me-sev{display:flex;gap:10px}',
    '.me-sev-item{width:52px;height:52px;border-radius:50%;border:2px solid var(--c);background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--c) 20%,transparent),rgba(7,11,20,.8));cursor:pointer;position:relative;transition:.18s;display:flex;align-items:center;justify-content:center;flex-direction:column}',
    '.me-sev-item:hover{box-shadow:0 0 14px -2px var(--c);transform:scale(1.06)}',
    '.me-sev-item .lb{font-size:11px;font-weight:800;color:var(--c)}',
    '.me-sev-item .sc{font-size:8px;color:var(--text3)}',
    '.me-sev-item.on{background:var(--c);box-shadow:0 0 18px var(--c)}',
    '.me-sev-item.on .lb{color:#000;font-weight:900}',
    '.me-sev-item.on .sc{color:rgba(0,0,0,.6)}',
    '/* 可靠度 */',
    '.me-rel{display:flex;gap:6px}',
    '.me-rel-item{flex:1;padding:6px 4px;border:1px solid var(--border);border-radius:7px;background:var(--bg2);text-align:center;cursor:pointer;transition:.15s}',
    '.me-rel-item .k{font-size:13px;font-weight:900;color:var(--text2)}',
    '.me-rel-item .v{font-size:8.5px;color:var(--text3)}',
    '.me-rel-item:hover{border-color:var(--cyan)}',
    '.me-rel-item.on{border-color:var(--cyan);background:rgba(0,212,255,.12)}',
    '.me-rel-item.on .k{color:var(--cyan)}',
    '/* 密级/开关/chips */',
    '.me-chiprow{display:flex;gap:6px;flex-wrap:wrap}',
    '.me-chip{padding:4px 12px;border-radius:12px;border:1px solid var(--border);background:var(--bg2);font-size:10.5px;color:var(--text2);cursor:pointer;transition:.15s;white-space:nowrap}',
    '.me-chip:hover{border-color:var(--cyan);color:var(--cyan)}',
    '.me-chip.on{background:rgba(0,212,255,.14);border-color:var(--cyan);color:var(--cyan)}',
    '.me-chip.picked{background:rgba(0,255,159,.1);border-color:var(--green);color:var(--green)}',
    '.me-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none}',
    '.me-sw{width:34px;height:18px;border-radius:9px;background:var(--bg2);border:1px solid var(--border2);position:relative;transition:.2s}',
    '.me-sw::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--text3);transition:.2s}',
    '.me-switch.on .me-sw{background:rgba(0,255,159,.2);border-color:var(--green)}',
    '.me-switch.on .me-sw::after{left:18px;background:var(--green);box-shadow:0 0 8px var(--green)}',
    '.me-switch .t{font-size:11px;color:var(--text2)}',
    '.me-switch.on .t{color:var(--green);font-weight:700}',
    '/* 智能提示浮动条 */',
    '.me-ai{margin:0 0 10px;padding:8px 12px;border-radius:8px;background:linear-gradient(90deg,rgba(0,212,255,.1),rgba(179,102,255,.06));border:1px solid rgba(0,212,255,.25);display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:11px;min-height:36px}',
    '.me-ai .tag{color:var(--text3);font-weight:800;letter-spacing:1px;font-size:10px}',
    '.me-ai .it{display:flex;align-items:center;gap:5px;color:var(--text2)}',
    '.me-badge{padding:1px 8px;border-radius:9px;font-size:10px;font-weight:800;border:1px solid}',
    '.me-ai .adopt{padding:1px 9px;border-radius:9px;border:1px solid var(--cyan);color:var(--cyan);font-size:10px;cursor:pointer;background:rgba(0,212,255,.08);white-space:nowrap}',
    '.me-ai .adopt:hover{background:rgba(0,212,255,.2)}',
    '.me-warn{margin:0 0 10px;padding:8px 12px;border-radius:8px;background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.35);font-size:11px;color:var(--orange)}',
    '/* 按钮 */',
    '.me-btn{padding:8px 20px;border-radius:8px;border:none;cursor:pointer;font-size:12.5px;font-weight:800;transition:.15s;letter-spacing:1px}',
    '.me-btn.main{background:linear-gradient(135deg,var(--cyan),#0077aa);color:#000;box-shadow:0 0 14px rgba(0,212,255,.3)}',
    '.me-btn.main:hover{box-shadow:0 0 22px rgba(0,212,255,.5);transform:translateY(-1px)}',
    '.me-btn.main:disabled{opacity:.45;cursor:not-allowed;transform:none}',
    '.me-btn.ghost{background:var(--bg2);border:1px solid var(--border2);color:var(--text2)}',
    '.me-btn.ghost:hover{border-color:var(--cyan);color:var(--cyan)}',
    '.me-btn.danger{background:rgba(255,51,85,.12);border:1px solid var(--red);color:var(--red)}',
    '.me-btn.sm{padding:3px 10px;font-size:10.5px;font-weight:600;border-radius:6px}',
    '/* 右侧面板 */',
    '.me-stat3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:10px}',
    '.me-stat{padding:9px 6px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;text-align:center;position:relative;overflow:hidden}',
    '.me-stat .v{font-size:19px;font-weight:900;color:var(--cyan);text-shadow:0 0 10px rgba(0,212,255,.4);font-family:\'Courier New\',monospace}',
    '.me-stat .k{font-size:9.5px;color:var(--text3);margin-top:2px}',
    '.me-bars{display:grid;gap:5px;max-height:170px;overflow-y:auto;padding-right:3px}',
    '.me-bar-row{display:grid;grid-template-columns:76px 1fr 26px;gap:6px;align-items:center;font-size:10px;color:var(--text2)}',
    '.me-bar-track{height:8px;background:var(--bg2);border-radius:4px;overflow:hidden}',
    '.me-bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--c),color-mix(in srgb,var(--c) 40%,transparent));box-shadow:0 0 6px var(--c);transition:width .5s}',
    '.me-bar-row .n{text-align:right;color:var(--text3);font-weight:700}',
    '.me-draft{display:flex;align-items:center;gap:7px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:var(--bg2);margin-bottom:5px;font-size:10.5px}',
    '.me-draft .t{flex:1;min-width:0;color:var(--text2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.me-draft .ts{color:var(--text3);font-size:9px}',
    '.me-feed-item{display:flex;gap:7px;padding:5px 6px;border-radius:6px;font-size:10.5px;cursor:pointer;border-left:2px solid var(--c);background:rgba(255,255,255,.02);margin-bottom:4px;transition:.15s}',
    '.me-feed-item:hover{background:rgba(0,212,255,.07)}',
    '.me-feed-item .tt{flex:1;min-width:0;color:var(--text2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.me-feed-item .meta{color:var(--text3);font-size:9px;white-space:nowrap}',
    '/* 底部表格 */',
    '.me-tabs{display:flex;gap:6px;margin-bottom:8px;align-items:center;flex-wrap:wrap}',
    '.me-tab{padding:3px 13px;border-radius:12px;font-size:11px;color:var(--text2);cursor:pointer;border:1px solid transparent}',
    '.me-tab.on{background:rgba(0,212,255,.13);color:var(--cyan);border-color:var(--cyan)}',
    '.me-table{width:100%;border-collapse:collapse;font-size:11px}',
    '.me-table th{text-align:left;padding:6px 8px;color:var(--text3);font-size:9.5px;letter-spacing:1px;border-bottom:1px solid var(--border2);position:sticky;top:0;background:var(--bg2);z-index:2}',
    '.me-table td{padding:6px 8px;border-bottom:1px solid rgba(0,212,255,.06);color:var(--text2);vertical-align:middle}',
    '.me-table tr:hover td{background:rgba(0,212,255,.04)}',
    '.me-table .tt{color:var(--text);max-width:340px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.me-scroll{max-height:330px;overflow-y:auto;border:1px solid var(--border);border-radius:8px}',
    '/* 编辑弹层 & 冲突面板 */',
    '.me-modal{position:fixed;inset:0;z-index:9500;background:rgba(4,7,14,.82);backdrop-filter:blur(5px);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:36px 14px}',
    '.me-modal-card{width:880px;max-width:96vw;background:rgba(10,16,30,.97);border:1px solid var(--border2);border-radius:12px;padding:16px;box-shadow:0 12px 60px rgba(0,0,0,.6),0 0 40px rgba(0,212,255,.08)}',
    '.me-conflict{padding:12px;border-radius:9px;background:rgba(255,51,85,.08);border:1px solid var(--red);margin-bottom:12px;font-size:12px;color:var(--text2)}',
    '.me-conflict .h{color:var(--red);font-weight:800;font-size:13px;margin-bottom:6px}',
    '.me-conflict pre{white-space:pre-wrap;background:rgba(0,0,0,.3);padding:8px;border-radius:6px;font-size:11px;color:var(--text3);max-height:120px;overflow-y:auto;margin:8px 0}',
    '.me-batchprev td.ok{color:var(--green)} .me-batchprev td.bad{color:var(--red)}',
    '.me-empty{padding:26px;text-align:center;color:var(--text3);font-size:11px}',
    '.me-sec{font-size:11px;font-weight:800;color:var(--cyan);letter-spacing:2px;margin:2px 0 8px;display:flex;align-items:center;gap:8px}',
    '.me-sec::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(0,212,255,.3),transparent)}'
  ].join('\n');

  /* ===== 模板库（12 类各一个预填模板） ===== */
  function templateOf(catKey) {
    var c = catOf(catKey); if (!c) return {};
    var base = {
      terror_events: { title: '【地点】发生【袭击类型】，造成【伤亡】', content: '事发经过：\n时间：\n地点：\n袭击方式：\n伤亡情况：\n袭击方（如已知）：\n对周边中资项目/人员影响：', severity: 'orange', tags: '恐袭' },
      security_events: { title: '【国别】中资/中方人员【事件类型】', content: '涉事主体：\n事件经过：\n中方人员/资产受损情况：\n应急处置：\n领保进展：', severity: 'orange', china_related: true, tags: '涉华' },
      military_conflicts: { title: '【国别】【地区】武装冲突【态势】', content: '冲突双方：\n战线/区域变化：\n武器与烈度：\n平民影响：\n对中资项目区影响：', severity: 'orange', tags: '冲突' },
      political_events: { title: '【国别】政局变动：【事件】', content: '事件经过：\n各方反应：\n对华立场信号：\n对项目/投资环境影响预判：', severity: 'yellow', tags: '政治' },
      geopolitical_intel: { title: '【国别/区域】地缘动态：【主题】', content: '情报要点：\n信号解读：\n对我海外利益影响：\n建议关注方向：', severity: 'yellow', tags: '地缘' },
      sanctions_data: { title: '【发起方】对【目标】实施【制裁类型】', content: '制裁主体与依据：\n被制裁对象清单：\n生效时间与范围：\n涉华企业/项目影响：\n合规建议：', severity: 'yellow', tags: '制裁' },
      social_unrest: { title: '【国别】【城市】发生【动荡类型】', content: '起因：\n规模与人群：\n暴力程度：\n对中资企业与人员影响：', severity: 'yellow', tags: '动荡' },
      natural_disasters: { title: '【国别】遭遇【灾害类型】', content: '灾害规模（震级/风力/水位）：\n影响范围：\n人员与基础设施损失：\n中资项目受灾情况：', severity: 'yellow', tags: '灾害' },
      public_health: { title: '【国别】出现【卫生事件】', content: '事件类型与规模：\n扩散趋势：\n当地医疗资源状况：\n对中方人员健康风险：', severity: 'yellow', tags: '卫生' },
      infrastructure: { title: '【国别】【设施】【状态/事件】', content: '设施类型与位置：\n事件/状态：\n运营影响：\n与中资项目关联：', severity: 'blue', tags: '基础设施' },
      osint_intel: { title: '【来源渠道】情报：【主题】', content: '信息来源与时间：\n内容要点：\n可信度评估：\n待核实点：', severity: 'blue', tags: '开源' },
      economic_risk: { title: '【国别】经济风险：【事件】', content: '事件概况：\n数据/指标：\n对中资企业经营影响：\n资金与汇率风险：', severity: 'yellow', tags: '经济' }
    }[catKey] || {};
    base.data_type = catKey;
    base.reliability = 'B'; base.classification = '内部';
    return base;
  }

  /* ===== 表单默认值 ===== */
  function emptyForm() {
    return {
      data_type: '', country: '', city: '', lat: '', lon: '',
      event_time: '', obtained_time: _nowLocal(),
      title: '', content: '', china_related: false, china_note: '',
      related_projects: [], related_enterprises: [], related_personnel: '',
      deaths: '', injured: '', asset_loss_value: '', asset_loss_currency: 'USD',
      source_channel: '', source_desc: '', source_url: '',
      reliability: 'B', classification: '内部', severity: 'yellow',
      tags: '', attachments: ''
    };
  }

  /* ===== 读/写表单 DOM ===== */
  function readForm() {
    var g = function (id) { var el = $(id); return el ? el.value : ''; };
    var d = {
      data_type: S.cat || '',
      country: g('mf-country'), city: g('mf-city'), lat: g('mf-lat'), lon: g('mf-lon'),
      event_time: g('mf-event-time'), obtained_time: g('mf-obtained-time'),
      title: g('mf-title'), content: g('mf-content'),
      china_note: g('mf-china-note'), related_personnel: g('mf-personnel'),
      deaths: g('mf-deaths'), injured: g('mf-injured'),
      asset_loss_value: g('mf-loss'), asset_loss_currency: g('mf-currency'),
      source_channel: g('mf-channel'), source_desc: g('mf-source-desc'), source_url: g('mf-source-url'),
      tags: g('mf-tags'), attachments: g('mf-attachments')
    };
    d.china_related = !!($('mf-china-sw') && $('mf-china-sw').classList.contains('on'));
    d.reliability = S._rel || 'B';
    d.classification = S._cls || '内部';
    d.severity = S._sev || 'yellow';
    d.related_projects = (S._picks && S._picks.projects) || [];
    d.related_enterprises = (S._picks && S._picks.enterprises) || [];
    return d;
  }
  function writeForm(d) {
    d = d || {};
    var s = function (id, v) { var el = $(id); if (el) el.value = v == null ? '' : v; };
    S.cat = d.data_type || S.cat;
    S._rel = d.reliability || 'B'; S._cls = d.classification || '内部'; S._sev = d.severity || 'yellow';
    S._picks = { projects: (d.related_projects || []).slice(), enterprises: (d.related_enterprises || []).slice() };
    s('mf-country', d.country); s('mf-city', d.city); s('mf-lat', d.lat); s('mf-lon', d.lon);
    s('mf-event-time', d.event_time); s('mf-obtained-time', d.obtained_time || _nowLocal());
    s('mf-title', d.title); s('mf-content', d.content); s('mf-china-note', d.china_note); s('mf-personnel', d.related_personnel);
    s('mf-deaths', d.deaths); s('mf-injured', d.injured); s('mf-loss', d.asset_loss_value); s('mf-currency', d.asset_loss_currency || 'USD');
    s('mf-channel', d.source_channel); s('mf-source-desc', d.source_desc); s('mf-source-url', d.source_url);
    s('mf-tags', d.tags); s('mf-attachments', d.attachments);
    var sw = $('mf-china-sw'); if (sw) sw.classList.toggle('on', d.china_related === true);
  }

  /* ============================================================
   * 渲染
   * ============================================================ */
  function render() {
    var root = $('manual-entry-root'); if (!root) return;
    if (!document.getElementById(CSS_ID)) {
      var st = document.createElement('style'); st.id = CSS_ID; st.textContent = CSS_TEXT; document.head.appendChild(st);
    }
    root.innerHTML = renderSkeleton();
    renderCats();
    renderFormMain();
    renderRightPanel();
    renderTable();
    bindFormEvents();
    refreshMeta();
    refreshList();
  }

  function renderSkeleton() {
    var manualInCenter = 0;
    try { manualInCenter = (window.ALERTS || []).filter(function (a) { return a && a.is_manual; }).length; } catch (e) { }
    return '<div class="me-root">' +
      '<div class="me-head">' +
      '<span style="font-size:20px;filter:drop-shadow(0 0 10px rgba(0,212,255,.5))">✍️</span>' +
      '<div><div class="tt">手动录入工作区</div><div class="sub">结构化情报录入 · 多人并发安全 · 提交即入预警中心（无上限）</div></div>' +
      '<div class="me-modes">' +
      '<span class="me-mode-btn' + (S.mode === 'single' ? ' on' : '') + '" onclick="MANUALENTRY.setMode(\'single\')">📝 单条录入</span>' +
      '<span class="me-mode-btn' + (S.mode === 'batch' ? ' on' : '') + '" onclick="MANUALENTRY.setMode(\'batch\')">📊 批量 CSV</span>' +
      '</div>' +
      '</div>' +
      '<div class="me-grid">' +
      '<div class="me-main">' + (S.mode === 'single' ? renderSingleArea() : renderBatchArea()) + '</div>' +
      '<div class="me-side" id="me-side"></div>' +
      '</div>' +
      '<div class="me-panel" id="me-bottom"></div>' +
      '</div>';
  }

  function renderSingleArea() {
    return '<div class="me-panel">' +
      '<div class="me-ptt"><span class="ic">◈</span>第一步 · 选择情报类别（12 类情报体系）<span class="cnt" id="me-cat-hint"></span></div>' +
      '<div class="me-cats" id="me-cats"></div>' +
      '</div>' +
      '<div class="me-panel" id="me-form-panel"></div>';
  }

  function renderCats() {
    var el = $('me-cats'); if (!el) return;
    el.innerHTML = CATS.map(function (c) {
      return '<div class="me-cat' + (S.cat === c.key ? ' on' : '') + '" style="--c:' + c.color + '" onclick="MANUALENTRY.pickCat(\'' + c.key + '\')" title="' + esc(c.label) + '">' +
        '<span class="ic">' + c.ic + '</span><span class="lb">' + c.label + '</span><span class="hd">' + c.sub.slice(0, 3).join(' · ') + '</span></div>';
    }).join('');
    var hint = $('me-cat-hint');
    if (hint) {
      var c = catOf(S.cat);
      hint.textContent = c ? ('已选：' + c.label + ' — 模板：<a style="color:var(--cyan);cursor:pointer" onclick="MANUALENTRY.loadTemplate()">一键载入' + c.label + '模板</a>') : '未选择（必选）';
    }
  }

  function renderFormMain() {
    var el = $('me-form-panel'); if (!el) return;
    if (!S.cat) {
      el.innerHTML = '<div class="me-empty">请先在上方选择情报类别，表单将按类别动态生成<br><span style="font-size:10px">（智能辅助：涉华预检 / severity 建议 / 自动归类 / 重复检测将在填写时自动工作）</span></div>';
      return;
    }
    var c = catOf(S.cat);
    var d = S._pendingForm || emptyForm();
    var countries = countryOptions();
    var projects = projectOptions(), ents = entOptions();
    el.innerHTML =
      '<div class="me-ptt"><span class="ic">◈</span>第二步 · 结构化录入 <span class="cnt">' + c.ic + ' ' + esc(c.label) + '</span></div>' +
      '<div id="me-ai-bar"></div><div id="me-warn-bar"></div>' +
      '<div class="me-fgrid">' +
      /* 标题 */
      '<div class="me-f full"><label class="me-lb">情报标题 <span class="req">*</span></label><input class="me-in" id="mf-title" placeholder="一句话概括事件（用于预警中心展示与查重）" value="' + esc(d.title) + '"></div>' +
      /* 国别 */
      '<div class="me-f"><label class="me-lb">国别/地区 <span class="req">*</span> <span style="color:var(--text3);font-size:9px">（54国梯队优先，可自定义）</span></label><input class="me-in" id="mf-country" list="me-country-list" placeholder="输入或选择国家/地区" value="' + esc(d.country) + '">' +
      '<datalist id="me-country-list">' + countries.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>' +
      /* 事发地 */
      '<div class="me-f"><label class="me-lb">事发地（城市）</label><div class="me-3col"><input class="me-in" id="mf-city" placeholder="城市" value="' + esc(d.city) + '"><input class="me-in" id="mf-lat" placeholder="纬度(可选)" value="' + esc(d.lat) + '"><input class="me-in" id="mf-lon" placeholder="经度(可选)" value="' + esc(d.lon) + '"></div></div>' +
      /* 时间 */
      '<div class="me-f"><label class="me-lb">事发时间</label><input class="me-in" type="datetime-local" id="mf-event-time" value="' + esc(d.event_time) + '"></div>' +
      '<div class="me-f"><label class="me-lb">信息获取时间 <span class="req">*</span></label><input class="me-in" type="datetime-local" id="mf-obtained-time" value="' + esc(d.obtained_time || _nowLocal()) + '"></div>' +
      /* 内容 */
      '<div class="me-f full"><label class="me-lb">内容详述 <span class="req">*</span></label><textarea class="me-ta" id="mf-content" rows="5" placeholder="事件经过 / 情报要点 / 影响评估…">' + esc(d.content) + '</textarea></div>' +
      /* 涉华 */
      '<div class="me-f"><label class="me-lb">涉华关联（预检结果可覆盖）</label><div style="display:flex;gap:10px;align-items:center"><span class="me-switch' + (d.china_related ? ' on' : '') + '" id="mf-china-sw" onclick="MANUALENTRY.toggleChina()"><span class="me-sw"></span><span class="t">涉华</span></span><input class="me-in" id="mf-china-note" placeholder="关联说明（如涉哪些项目/人员）" value="' + esc(d.china_note) + '"></div></div>' +
      /* 我方利益关联 */
      '<div class="me-f full"><label class="me-lb">我方利益关联（项目/企业/人员）</label>' +
      '<div class="me-chiprow" style="margin-bottom:5px;max-height:74px;overflow-y:auto">' + projects.map(function (p) {
        return '<span class="me-chip' + ((d.related_projects || []).indexOf(p.name) >= 0 ? ' picked' : '') + '" onclick="MANUALENTRY.togglePick(\'projects\',\'' + esc(p.name).replace(/'/g, "\\'") + '\')" title="' + esc(p.country + (p.ent ? ' · ' + p.ent : '')) + '">📦 ' + esc(p.name) + '</span>';
      }).join('') + '</div>' +
      '<div class="me-chiprow" style="max-height:60px;overflow-y:auto">' + ents.map(function (e) {
        return '<span class="me-chip' + ((d.related_enterprises || []).indexOf(e) >= 0 ? ' picked' : '') + '" onclick="MANUALENTRY.togglePick(\'enterprises\',\'' + esc(e).replace(/'/g, "\\'") + '\')">🏢 ' + esc(e) + '</span>';
      }).join('') + '</div>' +
      '<input class="me-in" id="mf-personnel" placeholder="涉及我方人员（如：某项目组中方员工12人）" style="margin-top:5px" value="' + esc(d.related_personnel) + '"></div>' +
      /* 伤亡 */
      '<div class="me-f"><label class="me-lb">人员伤亡</label><div class="me-2col"><input class="me-in" id="mf-deaths" type="number" min="0" placeholder="死亡人数" value="' + esc(d.deaths) + '"><input class="me-in" id="mf-injured" type="number" min="0" placeholder="受伤人数" value="' + esc(d.injured) + '"></div></div>' +
      /* 资产损失 */
      '<div class="me-f"><label class="me-lb">资产损失</label><div class="me-2col"><input class="me-in" id="mf-loss" type="number" min="0" placeholder="损失金额" value="' + esc(d.asset_loss_value) + '"><select class="me-sel" id="mf-currency">' + CURRENCIES.map(function (x) { return '<option' + (x === (d.asset_loss_currency || 'USD') ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div></div>' +
      /* 来源 */
      '<div class="me-f"><label class="me-lb">信息来源（渠道）</label><select class="me-sel" id="mf-channel"><option value="">请选择</option>' + CHANNELS.map(function (x) { return '<option' + (x === d.source_channel ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '<option value="其他">其他</option></select></div>' +
      '<div class="me-f"><label class="me-lb">来源描述</label><input class="me-in" id="mf-source-desc" placeholder="如：驻XX使馆经商处通报" value="' + esc(d.source_desc) + '"></div>' +
      '<div class="me-f full"><label class="me-lb">来源 URL / 附件链接</label><div class="me-2col"><input class="me-in" id="mf-source-url" placeholder="原文/通报链接 URL" value="' + esc(d.source_url) + '"><input class="me-in" id="mf-attachments" placeholder="附件链接（多个用分号分隔）" value="' + esc(d.attachments) + '"></div></div>' +
      /* 可靠度 */
      '<div class="me-f full"><label class="me-lb">信息可靠度（A-E 分级）</label><div class="me-rel" id="mf-rel">' + Object.keys(REL_META).map(function (k) {
        return '<div class="me-rel-item' + ((d.reliability || 'B') === k ? ' on' : '') + '" onclick="MANUALENTRY.pickRel(\'' + k + '\')" title="' + esc(REL_META[k].label + '：' + REL_META[k].desc) + '"><div class="k">' + k + '</div><div class="v">' + REL_META[k].label + '</div></div>';
      }).join('') + '</div></div>' +
      /* 密级 + severity */
      '<div class="me-f"><label class="me-lb">密级</label><div class="me-chiprow" id="mf-cls">' + CLASSIFICATIONS.map(function (x) {
        return '<span class="me-chip' + ((d.classification || '内部') === x ? ' on' : '') + '" onclick="MANUALENTRY.pickCls(\'' + x + '\')">🔒 ' + x + '</span>';
      }).join('') + '</div></div>' +
      '<div class="me-f"><label class="me-lb">严重程度 severity <span class="req">*</span></label><div class="me-sev" id="mf-sev">' + Object.keys(LEVEL_META).map(function (k) {
        return '<div class="me-sev-item' + ((d.severity || 'yellow') === k ? ' on' : '') + '" style="--c:' + LEVEL_META[k].color + '" onclick="MANUALENTRY.pickSev(\'' + k + '\')" title="' + esc(LEVEL_META[k].desc) + '"><span class="lb">' + LEVEL_META[k].label + '</span><span class="sc">SEV</span></div>';
      }).join('') + '</div></div>' +
      /* 标签 */
      '<div class="me-f full"><label class="me-lb">标签（分号分隔）</label><input class="me-in" id="mf-tags" placeholder="如：恐袭；俾路支；CPEC" value="' + esc(d.tags) + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--border);flex-wrap:wrap">' +
      '<button class="me-btn main" id="mf-submit" onclick="MANUALENTRY.submit()">✅ 提交并进入预警中心</button>' +
      '<button class="me-btn ghost" onclick="MANUALENTRY.clearForm()">🧹 清空（草稿已自动保存）</button>' +
      '<span style="font-size:10px;color:var(--text3)" id="mf-draft-tip">草稿每 0.8s 自动保存 · 崩溃/断网不丢失</span>' +
      '<span style="margin-left:auto;font-size:10px;color:var(--green)">⚡ 并发安全：服务端生成唯一 ID · 防重复提交 · 乐观锁防覆盖</span>' +
      '</div>';
    delete S._pendingForm;
    renderAiBar();
    S.formTs = S.formTs || Date.now();
  }

  /* ===== 智能提示条 ===== */
  function renderAiBar() {
    var el = $('me-ai-bar'); if (!el) return;
    var d = readForm();
    var cp = chinaPrecheck(d.title, d.content);
    var sv = suggestSeverity(d);
    var sg = suggestCat(d.title, d.content);
    var h = '<span class="tag">智能辅助</span>';
    h += '<span class="it">涉华预检：<span class="me-badge" style="color:' + (cp.hit ? 'var(--green)' : 'var(--text3)') + ';border-color:' + (cp.hit ? 'var(--green)' : 'var(--border2)') + '">' + (cp.hit ? '✓ 判定涉华' : '○ 未命中涉华要素') + '</span>' +
      (cp.hit && !d.china_related ? '<span class="adopt" onclick="MANUALENTRY.adoptChina()">采纳并开启涉华</span>' : '') +
      '<span style="font-size:9px;color:var(--text3)">(' + (cp.known ? 'gate.isChinaRelatedStrict' : '关键词兜底') + ')</span></span>';
    h += '<span class="it">severity 建议：<span class="me-badge" style="color:' + LEVEL_META[sv.level].color + ';border-color:' + LEVEL_META[sv.level].color + '">' + LEVEL_META[sv.level].label + '</span>' +
      '<span style="font-size:9px;color:var(--text3)">' + esc(sv.why) + '</span>' +
      (d.severity !== sv.level ? '<span class="adopt" onclick="MANUALENTRY.adoptSev(\'' + sv.level + '\')">采纳</span>' : '<span style="font-size:9px;color:var(--green)">已采用</span>') + '</span>';
    if (sg && sg.key !== d.data_type) h += '<span class="it">归类建议：<span class="me-badge" style="color:' + sg.color + ';border-color:' + sg.color + '">' + sg.ic + ' ' + sg.label + '</span><span class="adopt" onclick="MANUALENTRY.adoptCat(\'' + sg.key + '\')">切换类别</span></span>';
    el.innerHTML = h;
    var wb = $('me-warn-bar');
    if (wb) {
      var dups = dupCheck(d.title);
      wb.innerHTML = dups.length ? ('<b>⚠ 重复检测：</b>与最近录入存在相似条目 —— ' + dups.map(function (x) {
        return esc((x.item.title || '').slice(0, 40)) + '（相似度 ' + x.score + '% · ' + esc(x.item.submitter || '') + '）';
      }).join('；') + '<span style="color:var(--text3)"> —— 若确为新事件请继续提交</span>') : '';
    }
  }

  /* ===== 右侧实时面板 ===== */
  function renderRightPanel() {
    var el = $('me-side'); if (!el) return;
    var manualInCenter = 0;
    try { manualInCenter = (window.ALERTS || []).filter(function (a) { return a && a.is_manual; }).length; } catch (e) { }
    var m = S.meta || {};
    var mine = (m.by_user || []).filter(function (x) { return x.user === _user(); })[0];
    var todayMine = 0;
    try {
      todayMine = S.list.filter(function (x) { return x.submitter === _user() && new Date(x.created_at).toDateString() === new Date().toDateString(); }).length;
    } catch (e) { }
    var catCounts = {};
    (m.by_category || {});
    var total = 0; Object.keys(m.by_category || {}).forEach(function (k) { total += m.by_category[k]; });
    var rows = CATS.map(function (c) { return { c: c, n: (m.by_category || {})[c.key] || 0 }; }).filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    /* 草稿 */
    var drafts = loadDrafts();
    S.drafts = drafts;
    var html = '';
    /* 统计 */
    html += '<div class="me-panel"><div class="me-ptt"><span class="ic">◈</span>录入态势</div>' +
      '<div class="me-stat3">' +
      '<div class="me-stat"><div class="v">' + (m.today_total || 0) + '</div><div class="k">今日全队</div></div>' +
      '<div class="me-stat"><div class="v" style="color:var(--green)">' + todayMine + '</div><div class="k">今日本人</div></div>' +
      '<div class="me-stat"><div class="v" style="color:var(--orange)">' + manualInCenter + '</div><div class="k">预警中心手动条目</div></div>' +
      '</div></div>';
    /* 类别分布 */
    html += '<div class="me-panel"><div class="me-ptt"><span class="ic">◈</span>类别分布 <span class="cnt">共 ' + total + ' 条</span></div><div class="me-bars">' +
      (rows.length ? rows.slice(0, 12).map(function (x) {
        return '<div class="me-bar-row" title="' + esc(x.c.label) + '"><span>' + x.c.ic + ' ' + x.c.label + '</span><div class="me-bar-track"><div class="me-bar-fill" style="--c:' + x.c.color + ';width:' + (rows[0].n ? Math.max(6, Math.round(x.n / rows[0].n * 100)) : 0) + '%"></div></div><span class="n">' + x.n + '</span></div>';
      }).join('') : '<div class="me-empty">暂无数据</div>') + '</div></div>';
    /* 草稿箱 */
    html += '<div class="me-panel"><div class="me-ptt"><span class="ic">◈</span>我的草稿箱 <span class="cnt">' + drafts.length + ' 份</span></div>' +
      (drafts.length ? drafts.map(function (d, i) {
        return '<div class="me-draft"><span>' + (catOf(d.cat) ? catOf(d.cat).ic : '📄') + '</span><span class="t" title="' + esc(d.title) + '">' + esc(d.title || '(未填标题)') + '</span><span class="ts">' + d.timeText + '</span>' +
          '<button class="me-btn ghost sm" onclick="MANUALENTRY.restoreDraft(' + i + ')">恢复</button><button class="me-btn danger sm" onclick="MANUALENTRY.delDraft(' + i + ')">删</button></div>';
      }).join('') : '<div style="font-size:10px;color:var(--text3);padding:6px 2px">填写表单后自动保存，按用户名隔离</div>') + '</div>';
    /* 批量队列（batch 模式）或说明 */
    if (S.mode === 'batch') {
      html += '<div class="me-panel"><div class="me-ptt"><span class="ic">◈</span>待提交队列 <span class="cnt">' + S.batchQueue.length + ' 条</span></div>' +
        (S.batchQueue.length ? ('<div style="font-size:10.5px;color:var(--text2);margin-bottom:8px">已解析 ' + S.batchQueue.length + ' 行，其中有效 ' + S.batchQueue.filter(function (x) { return x._ok; }).length + ' 条</div>' +
          '<button class="me-btn main" style="width:100%" ' + (S.batchBusy ? 'disabled' : '') + ' onclick="MANUALENTRY.submitBatch()">' + (S.batchBusy ? '⏳ 提交中…' : '📤 分批提交（50条/批）') + '</button>') : '<div style="font-size:10px;color:var(--text3)">上传 CSV 后在此暂存</div>') + '</div>';
    }
    /* 团队动态 */
    var feed = S.list.slice(0, 8);
    html += '<div class="me-panel"><div class="me-ptt"><span class="ic">◈</span>团队动态 <span class="cnt">最近录入流</span></div>' +
      (feed.length ? feed.map(function (x) {
        var lv = LEVEL_META[x.level] || LEVEL_META.yellow;
        return '<div class="me-feed-item" style="--c:' + lv.color + '" onclick="MANUALENTRY.openEdit(\'' + x.id + '\')">' +
          '<span style="color:' + lv.color + ';font-weight:800;font-size:9px">' + lv.label + '</span>' +
          '<span class="tt" title="' + esc(x.title) + '">' + esc(x.title || '') + '</span>' +
          '<span class="meta">' + esc(x.submitter || '') + ' · ' + _fmtTs(x.updated_at).slice(5, 16) + '</span></div>';
      }).join('') : '<div class="me-empty">暂无录入</div>') + '</div>';
    el.innerHTML = html;
  }

  /* ===== 底部最近录入表格 ===== */
  function renderTable() {
    var el = $('me-bottom'); if (!el) return;
    var rows = S.list.slice();
    if (S.scope === 'mine') rows = rows.filter(function (x) { return x.submitter === _user(); });
    if (S.filterCat) rows = rows.filter(function (x) { return x.data_type === S.filterCat; });
    if (S.filterLevel) rows = rows.filter(function (x) { return x.level === S.filterLevel; });
    if (S.searchQ) {
      var q = S.searchQ.toLowerCase();
      rows = rows.filter(function (x) { return String(x.title || '').toLowerCase().indexOf(q) >= 0 || String(x.country || '').toLowerCase().indexOf(q) >= 0 || String(x.submitter || '').toLowerCase().indexOf(q) >= 0; });
    }
    var pages = Math.max(1, Math.ceil(rows.length / S.PAGE));
    if (S.page > pages) S.page = 1;
    var view = rows.slice((S.page - 1) * S.PAGE, S.page * S.PAGE);
    el.innerHTML = '<div class="me-ptt"><span class="ic">◈</span>最近录入（可编辑 / 软删 / 追溯）<span class="cnt">' + rows.length + ' 条</span></div>' +
      '<div class="me-tabs">' +
      '<span class="me-tab' + (S.scope === 'all' ? ' on' : '') + '" onclick="MANUALENTRY.setScope(\'all\')">全团队</span>' +
      '<span class="me-tab' + (S.scope === 'mine' ? ' on' : '') + '" onclick="MANUALENTRY.setScope(\'mine\')">我的</span>' +
      '<input class="me-in" style="width:180px;padding:4px 9px;font-size:11px" placeholder="🔍 搜索标题/国别/提交人" value="' + esc(S.searchQ) + '" oninput="MANUALENTRY.setSearch(this.value)">' +
      '<select class="me-sel" style="width:110px;padding:4px 6px;font-size:11px" onchange="MANUALENTRY.setFilterCat(this.value)"><option value="">全部类别</option>' + CATS.map(function (c) { return '<option value="' + c.key + '"' + (S.filterCat === c.key ? ' selected' : '') + '>' + c.label + '</option>'; }).join('') + '</select>' +
      '<select class="me-sel" style="width:100px;padding:4px 6px;font-size:11px" onchange="MANUALENTRY.setFilterLevel(this.value)"><option value="">全部级别</option>' + Object.keys(LEVEL_META).map(function (k) { return '<option value="' + k + '"' + (S.filterLevel === k ? ' selected' : '') + '>' + LEVEL_META[k].label + '</option>'; }).join('') + '</select>' +
      '<button class="me-btn ghost sm" style="margin-left:auto" onclick="MANUALENTRY.gotoAlerts()">🚨 查看预警中心手动条目</button>' +
      '</div>' +
      (view.length ? ('<div class="me-scroll"><table class="me-table"><thead><tr><th>时间</th><th>级别</th><th>标题</th><th>类别</th><th>国别</th><th>涉华</th><th>提交人</th><th>版本</th><th>最后修改</th><th style="width:150px">操作</th></tr></thead><tbody>' +
        view.map(function (x) {
          var lv = LEVEL_META[x.level] || LEVEL_META.yellow, c = catOf(x.data_type);
          var canEdit = x.submitter === _user() || (window.PERM && PERM.isAdmin && PERM.isAdmin());
          return '<tr><td style="font-family:Courier New,monospace;font-size:10px;white-space:nowrap">' + _fmtTs(x.created_at).slice(0, 16) + '</td>' +
            '<td><span class="me-badge" style="color:' + lv.color + ';border-color:' + lv.color + '">' + lv.label + '</span></td>' +
            '<td class="tt" title="' + esc(x.title) + '">' + esc(x.title) + '</td>' +
            '<td>' + (c ? c.ic + ' ' + c.label : esc(x.data_type)) + '</td>' +
            '<td>' + esc(x.country) + '</td>' +
            '<td>' + (x.china_related ? '<span style="color:var(--green);font-weight:700">是</span>' : '<span style="color:var(--text3)">否</span>') + '</td>' +
            '<td>' + esc(x.submitter) + '</td>' +
            '<td style="font-family:Courier New,monospace">v' + x.version + '</td>' +
            '<td style="font-size:10px;color:var(--text3)">' + esc(x.updated_by || x.submitter || '') + '<br>' + _fmtTs(x.updated_at).slice(5, 16) + '</td>' +
            '<td><button class="me-btn ghost sm" onclick="MANUALENTRY.openEdit(\'' + x.id + '\')">✏️ 编辑</button> ' +
            (canEdit ? '<button class="me-btn danger sm" onclick="MANUALENTRY.removeEntry(\'' + x.id + '\')">🗑️ 删除</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        (pages > 1 ? ('<div style="display:flex;gap:6px;justify-content:center;margin-top:9px;align-items:center;font-size:11px;color:var(--text3)">' +
          '<button class="me-btn ghost sm"' + (S.page <= 1 ? ' disabled' : '') + ' onclick="MANUALENTRY.setPage(' + (S.page - 1) + ')">‹ 上一页</button>' +
          ' ' + S.page + ' / ' + pages + ' ' +
          '<button class="me-btn ghost sm"' + (S.page >= pages ? ' disabled' : '') + ' onclick="MANUALENTRY.setPage(' + (S.page + 1) + ')">下一页 ›</button></div>') : '')) :
        '<div class="me-empty">暂无匹配条目</div>');
  }

  /* ============================================================
   * 批量模式
   * ============================================================ */
  function renderBatchArea() {
    return '<div class="me-panel">' +
      '<div class="me-ptt"><span class="ic">◈</span>CSV 批量导入 <span class="cnt">模板 22 列 · 单批最多 200 条</span></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
      '<button class="me-btn main" onclick="MANUALENTRY.downloadTemplate()">⬇️ 下载 CSV 模板</button>' +
      '<label class="me-btn ghost" style="display:inline-block">📂 选择 CSV 文件<input type="file" id="me-csv-file" accept=".csv,text/csv" style="display:none" onchange="MANUALENTRY.parseCsvFile(this)"></label>' +
      '<span style="font-size:10px;color:var(--text3)">severity 填 red/orange/yellow/blue；china_related 填 是/否；data_type 填类别英文键（见模板示例）</span>' +
      '</div>' +
      '<div id="me-batch-prev">' + (S.batchQueue.length ? '' : '<div class="me-empty">选择文件后在此预览、校验并分批提交</div>') + '</div>' +
      '</div>';
  }
  function renderBatchPreview() {
    var el = $('me-batch-prev'); if (!el) return;
    if (!S.batchQueue.length) { el.innerHTML = '<div class="me-empty">选择文件后在此预览、校验并分批提交</div>'; return; }
    var okN = S.batchQueue.filter(function (x) { return x._ok; }).length;
    el.innerHTML = '<div style="font-size:11px;margin-bottom:8px;color:var(--text2)">共解析 <b style="color:var(--cyan)">' + S.batchQueue.length + '</b> 行，校验通过 <b style="color:var(--green)">' + okN + '</b> 条，不通过 <b style="color:var(--red)">' + (S.batchQueue.length - okN) + '</b> 条（不通过行不会提交）</div>' +
      '<div class="me-scroll" style="max-height:260px"><table class="me-table me-batchprev"><thead><tr><th>#</th><th>状态</th><th>类别</th><th>国别</th><th>标题</th><th>级别</th><th>涉华</th><th>错误</th></tr></thead><tbody>' +
      S.batchQueue.map(function (x, i) {
        var c = catOf(x.data_type);
        return '<tr><td>' + (i + 1) + '</td><td class="' + (x._ok ? 'ok' : 'bad') + '">' + (x._ok ? '✓' : '✗') + '</td>' +
          '<td>' + (c ? c.label : esc(x.data_type)) + '</td><td>' + esc(x.country) + '</td>' +
          '<td class="tt">' + esc(x.title) + '</td><td>' + esc(x.severity) + '</td>' +
          '<td>' + (x.china_related ? '是' : '否') + '</td><td class="bad" style="font-size:10px">' + esc(x._err || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div style="display:flex;gap:10px;margin-top:10px">' +
      '<button class="me-btn main" ' + (S.batchBusy || !okN ? 'disabled' : '') + ' onclick="MANUALENTRY.submitBatch()">' + (S.batchBusy ? '⏳ 提交中…' : '📤 提交 ' + okN + ' 条（自动分批）') + '</button>' +
      '<button class="me-btn ghost" onclick="MANUALENTRY.clearBatch()">清空队列</button></div>';
  }
  /* CSV 解析（支持引号转义） */
  function parseCsv(text) {
    var rows = [], row = [], cur = '', inQ = false;
    text = String(text || '').replace(/^\ufeff/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(cur); cur = '';
          if (row.some(function (c2) { return c2.trim() !== ''; })) rows.push(row);
          row = [];
        } else cur += ch;
      }
    }
    row.push(cur);
    if (row.some(function (c2) { return c2.trim() !== ''; })) rows.push(row);
    return rows;
  }
  function csvToEntries(text) {
    var rows = parseCsv(text);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    var validCats = {}; CATS.forEach(function (c) { validCats[c.key] = 1; });
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i], e = {};
      for (var j = 0; j < head.length; j++) e[head[j]] = (r[j] || '').trim();
      if (/^示例/.test(String(e.title || ''))) continue; /* 跳过模板示例行 */
      var errs = [];
      if (!e.title) errs.push('标题');
      if (!e.content) errs.push('内容');
      if (!e.country) errs.push('国别');
      if (!validCats[e.data_type]) errs.push('类别');
      if (['red', 'orange', 'yellow', 'blue'].indexOf(e.severity) < 0) errs.push('级别');
      e.china_related = (e.china_related === '是' || e.china_related === 'true' || e.china_related === '1');
      e.related_projects = e.related_projects ? e.related_projects.split(/[;；、]/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
      e.related_enterprises = e.related_enterprises ? e.related_enterprises.split(/[;；、]/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
      e.tags = e.tags || '';
      e.obtained_time = e.obtained_time || _nowLocal();
      e._ok = errs.length === 0; e._err = errs.join('、');
      e.request_id = _uuid();
      out.push(e);
    }
    return out;
  }

  /* ============================================================
   * 草稿（localStorage 按用户名隔离）
   * ============================================================ */
  function draftPrefix() { return 'manual_draft_' + _user() + '_'; }
  function saveDraft() {
    if (!S.cat && S.mode !== 'single') return;
    try {
      var d = readForm();
      if (!d.title && !d.content && !d.country) return; /* 空表单不存 */
      d.data_type = S.cat;
      var key = draftPrefix() + (S.formTs || Date.now());
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), cat: S.cat, title: d.title, data: d }));
      renderRightPanel();
    } catch (e) { }
  }
  function loadDrafts() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(draftPrefix()) === 0) {
          try {
            var v = JSON.parse(localStorage.getItem(k));
            var d = new Date(v.ts || Date.now());
            out.push({ key: k, ts: v.ts, cat: v.cat, title: v.title, data: v.data, timeText: (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') });
          } catch (e) { }
        }
      }
      out.sort(function (a, b) { return b.ts - a.ts; });
    } catch (e) { }
    return out.slice(0, 12);
  }
  function clearCurrentDraft() {
    try { localStorage.removeItem(draftPrefix() + S.formTs); } catch (e) { }
  }

  /* ============================================================
   * 数据刷新
   * ============================================================ */
  function refreshMeta() {
    api('GET', '/meta/summary').then(function (r) {
      if (r.ok && r.data) {
        S.meta = r.data;
        if (r.data.tier_countries && r.data.tier_countries.length) S.tierCountries = r.data.tier_countries;
        renderRightPanel();
      }
    });
  }
  function refreshList() {
    api('GET', '/?limit=300').then(function (r) {
      if (r.ok && Array.isArray(r.data)) {
        S.list = r.data;
        renderTable(); renderRightPanel();
      }
    });
  }
  /* 预警中心同步：手动条目写入本地 ALERTS 并持久化（铁律） */
  function syncAlertLocal(alert) {
    try {
      if (window.ALERTS && alert && alert.id) {
        var idx = -1;
        for (var i = 0; i < ALERTS.length; i++) if (ALERTS[i] && ALERTS[i].id === alert.id) { idx = i; break; }
        if (idx >= 0) ALERTS[idx] = alert; else ALERTS.unshift(alert);
        if (typeof DataHub !== 'undefined' && DataHub.save) DataHub.save('alerts');
        if (typeof AVIEW !== 'undefined' && window._currentView === 'alerts') { try { AVIEW.renderQueue(); AVIEW.renderStats(); } catch (e) { } }
      }
    } catch (e) { console.warn('[MANUAL] 预警中心本地同步失败:', e); }
  }
  function removeAlertLocal(id) {
    try {
      if (window.ALERTS) {
        ALERTS = ALERTS.filter(function (a) { return !(a && a.id === id); });
        if (typeof DataHub !== 'undefined' && DataHub.save) DataHub.save('alerts');
      }
    } catch (e) { }
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bindFormEvents() {
    var panel = $('me-form-panel'); if (!panel) return;
    var t = null;
    panel.addEventListener('input', function (ev) {
      if (ev.target && (ev.target.id || '').indexOf('mf-') === 0) {
        clearTimeout(t);
        t = setTimeout(function () { renderAiBar(); saveDraft(); }, 800);
      }
    });
    panel.addEventListener('change', function (ev) {
      if (ev.target && (ev.target.id === 'mf-event-time' || ev.target.id === 'mf-obtained-time' || ev.target.id === 'mf-deaths' || ev.target.id === 'mf-injured')) renderAiBar();
    });
  }

  /* ============================================================
   * 对外动作（window.MANUALENTRY.*）
   * ============================================================ */
  var ME = {
    init: function () {
      if (!S.inited) S.inited = true;
      S.formTs = S.formTs || Date.now();
      render();
    },
    setMode: function (m) { S.mode = m; render(); },
    pickCat: function (k) {
      var d = S.cat ? readForm() : null;
      S.cat = k;
      if (d) { d.data_type = k; S._pendingForm = d; } else { var t = templateOf(k); t.data_type = k; t.title = ''; t.content = ''; S._pendingForm = t; }
      renderCats(); renderFormMain(); renderAiBar();
    },
    loadTemplate: function () {
      if (!S.cat) return;
      var d = readForm();
      var t = templateOf(S.cat);
      /* 模板只填空位，不覆盖已填内容 */
      Object.keys(t).forEach(function (k) {
        if (d[k] === '' || d[k] == null || (Array.isArray(d[k]) && !d[k].length)) d[k] = t[k];
      });
      d.data_type = S.cat;
      S._pendingForm = d;
      renderFormMain();
      toast('已载入「' + catOf(S.cat).label + '」模板，按占位符填写');
    },
    toggleChina: function () {
      var sw = $('mf-china-sw'); if (!sw) return;
      sw.classList.toggle('on');
      renderAiBar(); saveDraft();
    },
    adoptChina: function () {
      var sw = $('mf-china-sw'); if (sw) sw.classList.add('on');
      renderAiBar(); saveDraft();
    },
    pickRel: function (k) { S._rel = k; var el = $('mf-rel'); if (el) Array.prototype.forEach.call(el.children, function (c) { c.classList.toggle('on', c.querySelector('.k').textContent === k); }); saveDraft(); },
    pickCls: function (k) { S._cls = k; var el = $('mf-cls'); if (el) Array.prototype.forEach.call(el.children, function (c) { c.classList.toggle('on', c.textContent.trim().indexOf(k) >= 0); }); saveDraft(); },
    pickSev: function (k) {
      S._sev = k;
      var el = $('mf-sev'); if (el) Array.prototype.forEach.call(el.children, function (c, i) { c.classList.toggle('on', Object.keys(LEVEL_META)[i] === k); });
      renderAiBar(); saveDraft();
    },
    adoptSev: function (k) { ME.pickSev(k); },
    adoptCat: function (k) { ME.pickCat(k); },
    togglePick: function (kind, name) {
      var picks = S._picks = S._picks || { projects: [], enterprises: [] };
      var arr = picks[kind] = picks[kind] || [];
      var i = arr.indexOf(name);
      if (i >= 0) arr.splice(i, 1); else arr.push(name);
      var panel = $('me-form-panel'); if (!panel) return;
      Array.prototype.forEach.call(panel.querySelectorAll('.me-chip'), function (chip) {
        var isProj = chip.textContent.indexOf('📦') === 0, isEnt = chip.textContent.indexOf('🏢') === 0;
        if ((kind === 'projects' && isProj) || (kind === 'enterprises' && isEnt)) {
          var txt = chip.textContent.replace(/^[📦🏢]\s*/, '').trim();
          if (txt === name) chip.classList.toggle('picked', arr.indexOf(name) >= 0);
        }
      });
      saveDraft();
    },
    clearForm: function () {
      S.cat = null; S._pendingForm = null;
      clearCurrentDraft();
      S.formTs = Date.now();
      renderCats(); renderFormMain();
      toast('表单已清空');
    },
    /* ===== 提交 ===== */
    submit: function () {
      if (S.submitting) return;
      if (!S.cat) { toast('⚠️ 请先选择情报类别'); return; }
      var d = readForm();
      if (!d.title.trim()) { toast('⚠️ 请填写情报标题'); return; }
      if (!d.content.trim()) { toast('⚠️ 请填写内容详述'); return; }
      if (!d.country.trim()) { toast('⚠️ 请填写国别/地区'); return; }
      var sv = suggestSeverity(d);
      d.severity_ai_suggested = sv.level;
      d.submitter = _user();
      d.request_id = _uuid(); /* 幂等键：防双击重复提交 */
      S.submitting = true;
      var btn = $('mf-submit');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ 提交中…'; }
      api('POST', '/', d).then(function (r) {
        S.submitting = false;
        if (btn) { btn.disabled = false; btn.textContent = '✅ 提交并进入预警中心'; }
        if (!r.ok) { toast('❌ 提交失败：' + (r.data && r.data.error)); return; }
        if (r.data.duplicate) { toast('ℹ️ 该提交已受理（幂等去重）：' + (r.data.entry && r.data.entry.title || '')); }
        else {
          syncAlertLocal(r.data.alert); /* 铁律：手动数据进预警中心 */
          toast('✅ 已录入并同步预警中心（' + (LEVEL_META[d.severity] || LEVEL_META.yellow).label + '级 · ' + r.data.id.slice(0, 8) + '）');
        }
        clearCurrentDraft();
        S.cat = null; S._pendingForm = null; S.formTs = Date.now();
        renderCats(); renderFormMain();
        refreshList(); refreshMeta();
      });
    },
    /* ===== 编辑（乐观锁） ===== */
    openEdit: function (id) {
      api('GET', '/' + id).then(function (r) {
        if (!r.ok) { toast('❌ ' + (r.data && r.data.error)); return; }
        S.edit = { id: id, version: r.data.version, entry: r.data.entry, updated_by: r.data.updated_by, conflict: null };
        renderEditModal();
      });
    },
    saveEdit: function (force) {
      if (!S.edit || S.edit.saving) return;
      var modal = $('me-edit-modal'); if (!modal) return;
      /* 从弹层 DOM 收集 */
      var g = function (id) { var el = $(id); return el ? el.value : ''; };
      var d = S.edit.entry;
      d.title = g('ed-title'); d.content = g('ed-content'); d.country = g('ed-country'); d.city = g('ed-city');
      d.event_time = g('ed-event-time'); d.source_url = g('ed-source-url'); d.deaths = g('ed-deaths'); d.injured = g('ed-injured');
      d.severity = S.edit._sev || d.severity;
      d.china_related = !!($('ed-china-sw') && $('ed-china-sw').classList.contains('on'));
      if (!d.title.trim() || !d.content.trim() || !d.country.trim()) { toast('⚠️ 标题/内容/国别为必填'); return; }
      S.edit.saving = true;
      var btn = $('ed-save'); if (btn) { btn.disabled = true; btn.textContent = '⏳ 保存中…'; }
      var ver = force && S.edit.conflict ? S.edit.conflict.current_version : S.edit.version;
      api('PUT', '/' + S.edit.id, Object.assign({}, d, { version: ver })).then(function (r) {
        S.edit.saving = false;
        if (btn) { btn.disabled = false; btn.textContent = '💾 保存修改'; }
        if (r.status === 409) {
          /* 乐观锁冲突：他人已修改 —— 展示冲突面板（对比/覆盖/放弃） */
          S.edit.conflict = r.data;
          renderEditModal();
          toast('⚠️ 版本冲突：他人已修改该条目');
          return;
        }
        if (!r.ok) { toast('❌ 保存失败：' + (r.data && r.data.error)); return; }
        S.edit = null;
        var mb = $('me-edit-modal'); if (mb) mb.remove();
        syncAlertLocal(r.data.alert);
        toast('✅ 已保存（v' + r.data.version + '）并同步预警中心');
        refreshList(); refreshMeta();
      });
    },
    reloadEdit: function () {
      if (!S.edit) return;
      api('GET', '/' + S.edit.id).then(function (r) {
        if (r.ok) { S.edit = { id: S.edit.id, version: r.data.version, entry: r.data.entry, updated_by: r.data.updated_by, conflict: null }; renderEditModal(); }
      });
    },
    closeEdit: function () { S.edit = null; var mb = $('me-edit-modal'); if (mb) mb.remove(); },
    /* ===== 删除（二次确认） ===== */
    removeEntry: function (id) {
      var row = S.list.filter(function (x) { return x.id === id; })[0];
      if (!row) return;
      var t = row.title || '';
      if (!window.confirm('⚠️ 第一次确认：删除手动录入条目？\n\n「' + t.slice(0, 60) + '」\n\n删除后将同时从预警中心移除。')) return;
      if (!window.confirm('⚠️ 第二次确认（不可撤销）：确认删除？\n\n该条目将从手动录入库软删除并移出预警中心。')) return;
      api('DELETE', '/' + id).then(function (r) {
        if (!r.ok) { toast('❌ ' + (r.data && r.data.error)); return; }
        removeAlertLocal(id);
        toast('🗑️ 已删除并移出预警中心');
        refreshList(); refreshMeta();
      });
    },
    /* ===== 草稿 ===== */
    restoreDraft: function (i) {
      var d = S.drafts[i]; if (!d) return;
      S.cat = d.cat || d.data && d.data.data_type;
      S.formTs = Number(d.key.slice(draftPrefix().length)) || Date.now();
      S._pendingForm = d.data; S._pendingForm.data_type = S.cat;
      renderCats(); renderFormMain();
      try { localStorage.removeItem(d.key); } catch (e) { }
      renderRightPanel();
      toast('草稿已恢复');
    },
    delDraft: function (i) {
      var d = S.drafts[i]; if (!d) return;
      try { localStorage.removeItem(d.key); } catch (e) { }
      renderRightPanel();
    },
    /* ===== 批量 ===== */
    downloadTemplate: function () {
      fetch('/api/manual-entries/template.csv', { headers: { 'Authorization': 'Bearer ' + _token() } })
        .then(function (r) { return r.blob(); })
        .then(function (b) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(b); a.download = 'manual-entry-template.csv';
          document.body.appendChild(a); a.click(); a.remove();
          toast('模板已下载（UTF-8 带 BOM，Excel 直接可用）');
        });
    },
    parseCsvFile: function (input) {
      var f = input.files && input.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        S.batchQueue = csvToEntries(fr.result);
        renderBatchPreview(); renderRightPanel();
        toast('解析 ' + S.batchQueue.length + ' 行（校验通过 ' + S.batchQueue.filter(function (x) { return x._ok; }).length + ' 条）');
      };
      fr.readAsText(f, 'utf-8');
    },
    clearBatch: function () { S.batchQueue = []; renderBatchPreview(); renderRightPanel(); },
    submitBatch: function () {
      if (S.batchBusy) return;
      var items = S.batchQueue.filter(function (x) { return x._ok; });
      if (!items.length) { toast('没有可提交的有效行'); return; }
      S.batchBusy = true; renderBatchPreview();
      var batches = [];
      for (var i = 0; i < items.length; i += 50) batches.push(items.slice(i, i + 50));
      var done = 0, okTotal = 0, failTotal = 0, lastAlert = null;
      (function next() {
        if (!batches.length) {
          S.batchBusy = false;
          S.batchQueue = [];
          if (lastAlert) syncAlertLocal(lastAlert);
          toast('📊 批量提交完成：成功 ' + okTotal + ' / 失败 ' + failTotal);
          renderBatchArea && (function () { render(); })();
          refreshList(); refreshMeta();
          return;
        }
        var b = batches.shift();
        api('POST', '/batch', { items: b }).then(function (r) {
          if (r.ok) { okTotal += r.data.ok || 0; failTotal += r.data.failed || 0; if (r.data.results) { for (var j = r.data.results.length - 1; j >= 0; j--) { /* noop */ } } }
          else failTotal += b.length;
          done++;
          renderBatchPreview();
          next();
        });
      })();
    },
    /* ===== 视图切换/筛选 ===== */
    setScope: function (s) { S.scope = s; renderTable(); },
    setSearch: function (q) { S.searchQ = q; S.page = 1; renderTable(); },
    setFilterCat: function (v) { S.filterCat = v; S.page = 1; renderTable(); },
    setFilterLevel: function (v) { S.filterLevel = v; S.page = 1; renderTable(); },
    setPage: function (p) { S.page = p; renderTable(); },
    gotoAlerts: function () { navigateTo('alerts'); }
  };
  window.MANUALENTRY = ME;

  /* ===== 编辑弹层渲染 ===== */
  function renderEditModal() {
    if (!S.edit) return;
    var mb = $('me-edit-modal');
    if (!mb) { mb = document.createElement('div'); mb.id = 'me-edit-modal'; mb.className = 'me-modal'; document.body.appendChild(mb); }
    var e = S.edit, d = e.entry || {}, c = catOf(d.data_type);
    var lv = LEVEL_META[d.severity] || LEVEL_META.yellow;
    e._sev = d.severity;
    var conflictHtml = '';
    if (e.conflict) {
      conflictHtml = '<div class="me-conflict"><div class="h">⚠️ 他人已修改该条目（v' + e.conflict.current_version + '，修改人：' + esc(e.conflict.updated_by) + ' · ' + _fmtTs(e.conflict.updated_at) + '）</div>' +
        '您的修改基于旧版本 v' + e.version + '。最新内容：<pre>' + esc((e.conflict.current_entry && e.conflict.current_entry.title) + '\n' + String((e.conflict.current_entry && e.conflict.current_entry.content) || '').slice(0, 300)) + '</pre>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="me-btn ghost sm" onclick="MANUALENTRY.reloadEdit()">↻ 放弃我的修改，加载最新</button>' +
        '<button class="me-btn danger sm" onclick="MANUALENTRY.saveEdit(true)">⚠ 以我的版本覆盖保存</button>' +
        '</div></div>';
    }
    mb.innerHTML = '<div class="me-modal-card">' +
      '<div class="me-ptt"><span class="ic">◈</span>编辑手动录入条目 <span class="cnt">' + (c ? c.ic + ' ' + c.label : '') + ' · v' + e.version + ' · 提交人 ' + esc(e.updated_by || d.submitter || '') + '</span>' +
      '<button class="me-btn ghost sm" style="margin-left:auto" onclick="MANUALENTRY.closeEdit()">✕ 关闭</button></div>' +
      conflictHtml +
      '<div class="me-fgrid">' +
      '<div class="me-f full"><label class="me-lb">情报标题 <span class="req">*</span></label><input class="me-in" id="ed-title" value="' + esc(d.title) + '"></div>' +
      '<div class="me-f"><label class="me-lb">国别/地区 <span class="req">*</span></label><input class="me-in" id="ed-country" value="' + esc(d.country) + '"></div>' +
      '<div class="me-f"><label class="me-lb">城市</label><input class="me-in" id="ed-city" value="' + esc(d.city) + '"></div>' +
      '<div class="me-f full"><label class="me-lb">内容详述 <span class="req">*</span></label><textarea class="me-ta" id="ed-content" rows="5">' + esc(d.content) + '</textarea></div>' +
      '<div class="me-f"><label class="me-lb">事发时间</label><input class="me-in" type="datetime-local" id="ed-event-time" value="' + esc(d.event_time) + '"></div>' +
      '<div class="me-f"><label class="me-lb">来源 URL</label><input class="me-in" id="ed-source-url" value="' + esc(d.source_url) + '"></div>' +
      '<div class="me-f"><label class="me-lb">死亡 / 受伤</label><div class="me-2col"><input class="me-in" id="ed-deaths" type="number" value="' + esc(d.deaths) + '"><input class="me-in" id="ed-injured" type="number" value="' + esc(d.injured) + '"></div></div>' +
      '<div class="me-f"><label class="me-lb">severity</label><div class="me-sev" id="ed-sev">' + Object.keys(LEVEL_META).map(function (k) {
        return '<div class="me-sev-item' + (d.severity === k ? ' on' : '') + '" style="--c:' + LEVEL_META[k].color + '" onclick="MANUALENTRY._edSev(\'' + k + '\')" title="' + esc(LEVEL_META[k].desc) + '"><span class="lb">' + LEVEL_META[k].label + '</span><span class="sc">SEV</span></div>';
      }).join('') + '</div></div>' +
      '<div class="me-f"><label class="me-lb">涉华关联</label><span class="me-switch' + (d.china_related ? ' on' : '') + '" id="ed-china-sw" onclick="this.classList.toggle(\'on\')"><span class="me-sw"></span><span class="t">涉华</span></span></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">' +
      '<button class="me-btn main" id="ed-save" onclick="MANUALENTRY.saveEdit(false)">💾 保存修改</button>' +
      '<span style="font-size:10px;color:var(--text3);align-self:center">乐观锁 v' + e.version + '：若他人已先保存将提示冲突，可选择对比后覆盖</span>' +
      '</div></div>';
    mb.style.display = 'flex';
  }
  ME._edSev = function (k) {
    if (!S.edit) return;
    S.edit._sev = k;
    var el = $('ed-sev'); if (el) Array.prototype.forEach.call(el.children, function (c, i) { c.classList.toggle('on', Object.keys(LEVEL_META)[i] === k); });
  };
})();
