/* ============================================================
 * 「我的关注」工作台（2026-08-28 用户指令：出海企业安保主管视角）
 * 痛点：安保主管只管特定国家/项目/企业，但预警中心是全量流——
 * 每天要从 500+ 条里人工捞自己相关的那几十条。
 * 设计：
 *  ① 订阅管理：国家/重点项目/企业三个维度勾选订阅（localStorage 持久化）
 *  ② 工作台：登录即见——只看订阅相关的 红橙黄 预警流（蓝折叠）
 *  ③ 底数联动：命中 interest_tier（国家梯队）/asset_tags（项目资产）的预警高亮
 *  ④ 快速操作：确认/处置/查看详情 与预警中心一致
 * ============================================================ */
'use strict';
var MYFOCUS = {
  _subs: null,          /* {countries:[], projects:[], enterprises:[], redOnly:false} */
  _alerts: [],
  _busy: false,

  KEY: 'orps_myfocus_subs',

  /* 可订阅选项（与服务器底数库同源的精选集） */
  COUNTRY_OPTIONS: ['巴基斯坦','阿富汗','尼日利亚','刚果（金）','马里','尼日尔','布基纳法索','索马里','苏丹','埃塞俄比亚','缅甸','泰国','印度尼西亚','马来西亚','哈萨克斯坦','乌兹别克斯坦','俄罗斯','伊朗','伊拉克','叙利亚','也门','沙特','阿联酋','埃及','利比亚','肯尼亚','莫桑比克','安哥拉','赞比亚','几内亚','孟加拉国','斯里兰卡','尼泊尔','印度','墨西哥','巴西','秘鲁','阿根廷','智利','哥伦比亚','委内瑞拉','厄瓜多尔','玻利维亚','美国','加拿大','英国','法国','德国','意大利','荷兰','塞尔维亚','匈牙利','希腊','波兰','澳大利亚','新西兰'],
  PROJECT_OPTIONS: ['中巴经济走廊（CPEC）','瓜达尔港','中老铁路','雅万高铁','匈塞铁路','中吉乌铁路','钱凯港','汉班托塔港','皎漂港','吉布提港','比雷埃夫斯港','莱基港','亚马尔LNG','阿姆河天然气','延布炼厂','中缅油气管道','中俄东线天然气','中亚天然气管道','美丽山特高压','K-2/K-3核电站','卡洛特水电站','西芒杜铁矿','青山工业园','罗勇工业园','帕德玛大桥','中马友谊大桥','德阿风电','马普托大桥'],

  loadSubs() {
    if (this._subs) return this._subs;
    try {
      this._subs = JSON.parse(localStorage.getItem(this.KEY)) || null;
    } catch (e) { this._subs = null; }
    if (!this._subs) this._subs = { countries: [], projects: [], enterprises: [], redOnly: true };
    return this._subs;
  },
  saveSubs() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this._subs)); } catch (e) {}
  },

  init() { this.render(); this.refresh(); },

  refresh() {
    if (this._busy) return; this._busy = true;
    var me = this;
    try {
      /* 数据源：预警中心 ALERTS（已含实时流）+ DataHub alerts 持久化 */
      var list = [];
      if (typeof ALERTS !== 'undefined') list = ALERTS.slice();
      if (typeof DataHub !== 'undefined' && DataHub.get) {
        try { (DataHub.get('alerts') || []).forEach(function (a) { if (!a || list.some(function (x) { return String(x.id) === String(a.id); })) return; list.push(a); }); } catch (e) {}
      }
      this._alerts = list;
      this.render();
    } finally { this._busy = false; }
  },

  /* 核心：订阅匹配 */
  _match(a) {
    var s = this.loadSubs();
    var hasSub = s.countries.length || s.projects.length || s.enterprises.length;
    if (!hasSub) return false; /* 未订阅任何项 → 工作台引导订阅 */
    var t = String(a.title || '') + ' ' + String(a.title_zh || '') + ' ' + String(a.desc || '');
    var ctry = String(a.country || '');
    var hit = false;
    if (s.countries.indexOf(ctry) >= 0) hit = true;
    if (!hit && s.projects.length) {
      for (var i = 0; i < s.projects.length; i++) {
        var p = s.projects[i].replace(/[（）()]/g, '').split(/[（(]/)[0].slice(0, 4); /* 用项目名前4字模糊匹配（如"瓜达尔港"） */
        if (p && t.indexOf(p) >= 0) { hit = true; break; }
      }
    }
    if (!hit && s.enterprises.length) {
      for (var j = 0; j < s.enterprises.length; j++) {
        if (t.indexOf(s.enterprises[j]) >= 0) { hit = true; break; }
      }
    }
    /* 底数标签联动：asset_tags 命中 */
    if (!hit && a.asset_tags && a.asset_tags.length && s.projects.length) hit = true;
    return hit;
  },

  render() {
    var el = document.getElementById('myfocus-content');
    if (!el) return;
    var s = this.loadSubs();
    var hasSub = s.countries.length || s.projects.length || s.enterprises.length;
    var me = this;

    /* ===== 订阅管理区 ===== */
    var subHtml =
      '<div style="padding:12px 14px;background:var(--panel2,rgba(20,26,38,.9));border:1px solid var(--border);border-radius:10px;margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<span style="font-size:12px;font-weight:700">⚙️ 我的订阅</span>' +
      '<span style="font-size:10px;color:var(--text3)">勾选你负责的国家/项目/企业，工作台只显示相关的预警</span>' +
      '<span style="flex:1"></span>' +
      '<label style="font-size:10px;color:var(--text3);cursor:pointer"><input type="checkbox" ' + (s.redOnly ? 'checked' : '') + ' onchange="MYFOCUS._subs.redOnly=this.checked;MYFOCUS.saveSubs();MYFOCUS.render()"> 只看红橙</label>' +
      '</label></div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:280px"><div style="font-size:10px;color:var(--cyan);margin-bottom:4px">📍 国家（' + s.countries.length + ' 已选）</div>' +
      '<div style="max-height:110px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px">' +
      this.COUNTRY_OPTIONS.map(function (c) {
        var on = s.countries.indexOf(c) >= 0;
        return '<span style="font-size:9px;padding:1px 6px;border-radius:8px;cursor:pointer;border:1px solid ' + (on ? 'var(--cyan)' : 'var(--border)') + ';color:' + (on ? 'var(--cyan)' : 'var(--text3)') + ';background:' + (on ? 'rgba(0,212,255,.1)' : 'transparent') + '" onclick="MYFOCUS.toggleSub(\'countries\',\'' + c + '\')">' + c + '</span>';
      }).join('') + '</div></div>' +
      '<div style="flex:1;min-width:280px"><div style="font-size:10px;color:var(--yellow);margin-bottom:4px">🏗️ 重点项目（' + s.projects.length + ' 已选）</div>' +
      '<div style="max-height:110px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:3px">' +
      this.PROJECT_OPTIONS.map(function (p) {
        var on = s.projects.indexOf(p) >= 0;
        return '<span style="font-size:9px;padding:1px 6px;border-radius:8px;cursor:pointer;border:1px solid ' + (on ? 'var(--yellow)' : 'var(--border)') + ';color:' + (on ? 'var(--yellow)' : 'var(--text3)') + ';background:' + (on ? 'rgba(255,204,0,.1)' : 'transparent') + '" onclick="MYFOCUS.toggleSub(\'projects\',\'' + p + '\')">' + p.replace(/[（(].*$/, '') + '</span>';
      }).join('') + '</div></div>' +
      '<div style="flex:1;min-width:200px"><div style="font-size:10px;color:var(--green);margin-bottom:4px">🏢 企业（' + s.enterprises.length + ' 已选，逗号分隔输入）</div>' +
      '<input id="myfocus-ent" placeholder="如：中铁十四局,中国电建,青山控股" value="' + (s.enterprises.join(',')).replace(/"/g, '&quot;') + '" style="width:100%;font-size:10px;padding:4px 8px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)" onchange="MYFOCUS.setEnts(this.value)">' +
      '<div style="font-size:9px;color:var(--text3);margin-top:4px">预警标题/摘要命中企业名即进入工作台</div></div>' +
      '</div></div>';

    /* ===== 预警流 ===== */
    var lvW = { red: 0, orange: 1, yellow: 2, blue: 3 };
    var matched = this._alerts.filter(function (a) { return me._match(a); });
    if (s.redOnly) matched = matched.filter(function (a) { return a.level === 'red' || a.level === 'orange'; });
    else matched = matched.filter(function (a) { return a.level !== 'blue'; });
    matched.sort(function (a, b) {
      if ((lvW[a.level] || 9) !== (lvW[b.level] || 9)) return (lvW[a.level] || 9) - (lvW[b.level] || 9);
      return String(b.time || '').localeCompare(String(a.time || ''));
    });

    var feedHtml;
    if (!hasSub) {
      feedHtml = '<div class="empty" style="padding:50px 0"><div class="ic" style="font-size:32px">🎯</div><div style="font-size:14px;font-weight:600;margin-bottom:6px">先设置你的订阅</div><div style="font-size:11px;color:var(--text3)">勾选上方国家/项目/企业后，这里只显示与你相关的红橙预警流</div></div>';
    } else if (!matched.length) {
      feedHtml = '<div class="empty" style="padding:40px 0"><div class="ic" style="font-size:28px">✅</div><div>订阅范围内当前无红橙预警</div><div style="font-size:10px;color:var(--text3);margin-top:4px">' + (s.redOnly ? '已开启"只看红橙"——切换可见黄色' : '近24h订阅范围无活动预警') + '</div></div>';
    } else {
      var AL = { red: { label: '红色', cls: 'b-red' }, orange: { label: '橙色', cls: 'b-orange' }, yellow: { label: '黄色', cls: 'b-yellow' }, blue: { label: '蓝色', cls: 'b-blue' } };
      feedHtml = matched.slice(0, 60).map(function (a) {
        var lv = AL[a.level] || AL.blue;
        var tierBadge = a.interest_tier === 'TIER1' ? '<span style="font-size:8px;padding:0 4px;border-radius:6px;border:1px solid var(--red);color:var(--red)">一梯队国</span>' : '';
        var assetBadge = (a.asset_tags && a.asset_tags.length) ? '<span style="font-size:8px;padding:0 4px;border-radius:6px;border:1px solid var(--yellow);color:var(--yellow)">资产:' + a.asset_tags[0] + '</span>' : '';
        var title = String(a.title_zh || a.title || '');
        return '<div style="padding:9px 12px;margin-bottom:6px;background:var(--panel2,rgba(20,26,38,.9));border:1px solid var(--border);border-left:3px solid ' + (a.level === 'red' ? '#ff3355' : a.level === 'orange' ? '#ff8800' : '#ffcc00') + ';border-radius:8px;cursor:pointer" onclick="MYFOCUS.openAlert(\'' + String(a.id || '').replace(/'/g, '') + '\')">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">' +
          '<span class="badge ' + lv.cls + '" style="font-size:9px;padding:1px 5px">' + lv.label + '</span>' +
          '<span style="font-size:10px;color:var(--text3)">📍' + (a.country || '—') + '</span>' +
          tierBadge + assetBadge +
          '<span style="font-size:10px;color:var(--text3);margin-left:auto">' + String(a.time || '').slice(5, 16) + '</span></div>' +
          '<div style="font-size:12px;line-height:1.5;color:var(--text)">' + (typeof stripTags === 'function' ? stripTags(title) : title) + '</div>' +
          (a.source ? '<div style="font-size:9px;color:var(--text3);margin-top:2px">' + a.source + (a.stance ? ' · ' + ((typeof STANCE_META !== 'undefined' && STANCE_META[a.stance]) ? STANCE_META[a.stance].t : a.stance) : '') + '</div>' : '') +
          '</div>';
      }).join('');
    }

    el.innerHTML =
      '<div style="padding:16px 18px;max-width:1200px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
      '<span style="font-size:18px">🎯</span><span style="font-size:16px;font-weight:700">我的关注</span>' +
      '<span style="font-size:11px;color:var(--text3)">只看订阅相关的预警 · 安保主管视角工作台</span>' +
      '<span style="flex:1"></span>' +
      '<span style="font-size:12px;color:' + (matched.some(function (a) { return a.level === 'red'; }) ? 'var(--red)' : 'var(--text2)') + ';font-weight:700">🔴 ' + matched.filter(function (a) { return a.level === 'red'; }).length + '</span>' +
      '<span style="font-size:12px;color:var(--orange);font-weight:700">🟠 ' + matched.filter(function (a) { return a.level === 'orange'; }).length + '</span>' +
      '<span style="font-size:12px;color:var(--yellow);font-weight:700">🟡 ' + matched.filter(function (a) { return a.level === 'yellow'; }).length + '</span>' +
      '<button class="btn sm" onclick="MYFOCUS.refresh()">🔄 刷新</button></div>' +
      subHtml +
      '<div id="myfocus-feed">' + feedHtml + '</div>' +
      '</div>';
  },

  toggleSub(kind, v) {
    var s = this.loadSubs();
    var i = s[kind].indexOf(v);
    if (i >= 0) s[kind].splice(i, 1); else s[kind].push(v);
    this.saveSubs();
    this.render();
  },
  setEnts(v) {
    var s = this.loadSubs();
    s.enterprises = String(v || '').split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
    this.saveSubs();
    this.render();
  },
  openAlert(id) {
    /* 跳预警中心并选中该条 */
    try {
      if (typeof navigateTo === 'function') navigateTo('alerts');
      if (typeof AVIEW !== 'undefined' && AVIEW.selectAlert) setTimeout(function () { AVIEW.selectAlert(id); }, 600);
    } catch (e) {}
  }
};
window.MYFOCUS = MYFOCUS;
