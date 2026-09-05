/* 开放网络深度检索面板（前端）
 * ------------------------------------------------------------------
 * 能力：任意关键词 → 远程真实检索（AP 通讯社站内检索 + GDELT 全球全文检索）
 *      → 跟进命中的真实文章 URL → 抓取真实正文 → 涉华海外利益相关性闸门
 *      → 实体关联引擎（中资主体 / 海外项目 / 国别 / 资产 / 风险分 / 预警等级）
 * 铁律：
 *   1. 只展示真实检索结果；无结果即显示"未检索到"，绝不编造；
 *   2. 检索结果一律以 pending（待审核）写入数据中心，
 *      必须经人工审核通过后才由既有链路同步进预警中心，不得绕过审核。
 */
(function () {
  'use strict';

  var DEEPSEARCH = {
    _items: [],
    _channels: [],
    _busy: false,
    _lastQuery: '',
    /* 预置检索式：覆盖我海外利益安全的高频风险场景（均为真实检索关键词，非样例数据） */
    _presets: [
      { k: 'Chinese workers attacked', label: '中方人员遇袭' },
      { k: 'Chinese engineers kidnapped', label: '中方人员被绑架' },
      { k: 'Chinese company project suspended', label: '中资项目受阻' },
      { k: 'Chinese-owned mine protest', label: '中资矿山抗议' },
      { k: 'Chinese embassy security warning', label: '使馆安全提醒' },
      { k: 'Belt and Road project dispute', label: '一带一路项目争议' },
      { k: 'Chinese vessel seized', label: '中方船舶被扣' },
      { k: 'evacuation Chinese nationals', label: '中国公民撤离' }
    ],

    panelHtml: function () {
      var chips = this._presets.map(function (p) {
        return '<span class="chip" style="cursor:pointer;font-size:10px;padding:3px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;margin:2px;display:inline-block" ' +
          'onclick="DEEPSEARCH.run(\'' + p.k.replace(/'/g, "\\'") + '\')">' + p.label + '</span>';
      }).join(' ');
      return '<div class="card" style="border:1px solid rgba(0,212,255,0.25)">' +
        '<div class="card-tt"><span class="ic">\uD83D\uDD0E</span>开放网络深度检索 ' +
        '<span style="font-size:10px;color:var(--text3);font-weight:400">— 关键词 → 全球公开媒体真实检索 → 跟进原文 → 抽正文 → 相关性闸门 → 实体关联定级</span></div>' +
        '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:end;margin-bottom:8px">' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">检索关键词（支持中英文，英文命中率更高）</label>' +
        '<input class="input" id="ds-q" placeholder="如：Chinese workers attacked Pakistan" style="font-size:12px;width:100%" ' +
        'onkeydown="if(event.key===\'Enter\')DEEPSEARCH.run()"></div>' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">时间窗</label>' +
        '<select class="select" id="ds-span" style="font-size:12px"><option value="1d">近1天</option><option value="3d">近3天</option>' +
        '<option value="7d" selected>近7天</option><option value="14d">近14天</option><option value="1m">近1月</option></select></div>' +
        '<div><label class="text-xs text-muted" style="display:block;margin-bottom:4px">条数</label>' +
        '<select class="select" id="ds-max" style="font-size:12px"><option>8</option><option selected>12</option><option>20</option></select></div>' +
        '<button class="btn primary sm" onclick="DEEPSEARCH.run()" style="white-space:nowrap">\u26A1 开始检索</button>' +
        '</div>' +
        '<div style="margin-bottom:8px"><span class="text-xs text-muted">高频风险场景：</span> ' + chips + '</div>' +
        '<div id="ds-channels" style="margin-bottom:8px"></div>' +
        '<div id="ds-status" style="font-size:11px;color:var(--text3);margin-bottom:6px">就绪。检索为实时远程请求，单次约需 20~70 秒（需逐条跟进原文抓取正文）。</div>' +
        '<div id="ds-results"></div>' +
        '</div>';
    },

    /* 通道健康台账：如实展示各检索通道实测状态 */
    loadChannels: function () {
      var me = this;
      fetch(this._api('/api/deepsearch/channels')).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) return;
        me._channels = j.channels || [];
        me.renderChannels();
      }).catch(function () {
        var el = document.getElementById('ds-channels');
        if (el) el.innerHTML = '<div class="text-xs" style="color:var(--orange)">通道台账获取失败：后端服务未启动或不可达。</div>';
      });
    },

    renderChannels: function () {
      var el = document.getElementById('ds-channels');
      if (!el) return;
      var map = { live: ['var(--green)', '可用'], degraded: ['var(--orange)', '受限'], reserved: ['var(--text3)', '通道预留'], unavailable: ['var(--text3)', '不可用'] };
      var html = this._channels.map(function (c) {
        var m = map[c.status] || ['var(--text3)', c.status];
        var dim = (c.status === 'unavailable' || c.status === 'reserved') ? 'opacity:.55;' : '';
        return '<span title="' + me_esc(c.note || '') + '" style="' + dim + 'display:inline-block;font-size:10px;margin:2px;padding:3px 8px;border:1px solid var(--border);border-radius:12px;background:var(--bg2)">' +
          '<span style="color:' + m[0] + '">\u25CF</span> ' + me_esc(c.name) + ' · ' + m[1] + '</span>';
      }).join('');
      el.innerHTML = '<div class="text-xs text-muted" style="margin-bottom:4px">检索通道台账（实测状态，鼠标悬停看说明）：</div>' + html;
    },

    _api: function (p) {
      if (typeof APIClient !== 'undefined' && APIClient.baseUrl) return APIClient.baseUrl.replace(/\/api$/, '') + p;
      if (location.protocol === 'file:') return 'http://localhost:3000' + p;
      return p;
    },

    run: function (preset) {
      if (this._busy) { this._status('检索进行中，请稍候…', 'var(--orange)'); return; }
      var q = preset || (document.getElementById('ds-q') || {}).value || '';
      q = String(q).trim();
      if (!q) { this._status('请输入检索关键词。', 'var(--orange)'); return; }
      if (preset) { var inp = document.getElementById('ds-q'); if (inp) inp.value = q; }
      var span = (document.getElementById('ds-span') || {}).value || '7d';
      var max = (document.getElementById('ds-max') || {}).value || '12';
      this._busy = true; this._lastQuery = q;
      this._status('正在远程检索「' + q + '」… 需逐条跟进原文抓取正文，请耐心等待（约 20~70 秒）。', 'var(--cyan)');
      var me = this, t0 = Date.now();
      fetch(this._api('/api/deepsearch?q=' + encodeURIComponent(q) + '&timespan=' + span + '&max=' + max))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          me._busy = false;
          if (!j || !j.ok) { me._status('检索失败：' + ((j && j.error) || '后端无响应'), 'var(--red)'); return; }
          me._items = j.items || [];
          if (j.channels) { me._channels = j.channels; me.renderChannels(); }
          var sec = ((Date.now() - t0) / 1000).toFixed(1);
          if (!me._items.length) {
            me._status('检索完成（' + sec + 's）：未检索到与我海外利益安全相关的公开信息。' +
              '可能原因——该时间窗内确无相关报道，或检索通道当前受限（见上方台账）。系统不会以任何方式补造数据。', 'var(--orange)');
            document.getElementById('ds-results').innerHTML = '';
            return;
          }
          me._status('检索完成（' + sec + 's）：命中 ' + me._items.length + ' 条真实公开信息，其中与我海外利益直接关联 ' +
            (j.interestLinked || 0) + ' 条。可勾选后一键入库（入库为待审核状态）。', 'var(--green)');
          me.renderResults();
        })
        .catch(function (e) {
          me._busy = false;
          me._status('检索请求失败：' + e.message + '（请确认后端服务已启动）', 'var(--red)');
        });
    },

    _status: function (t, c) {
      var el = document.getElementById('ds-status');
      if (el) { el.textContent = t; el.style.color = c || 'var(--text3)'; }
    },

    renderResults: function () {
      var el = document.getElementById('ds-results');
      if (!el) return;
      var lvColor = { '红色': 'var(--red)', '橙色': 'var(--orange)', '黄色': '#e6c34a', '蓝色': 'var(--cyan)' };
      var rows = this._items.map(function (it, i) {
        var lv = it.alertLevel || '蓝色';
        var col = lvColor[lv] || 'var(--cyan)';
        var ents = (it.rel_enterprises || []).concat(it.rel_projects || []);
        var entHtml = ents.length
          ? ents.map(function (n) { return '<span class="badge b-blue" style="margin:1px">' + me_esc(n) + '</span>'; }).join('')
          : '<span class="text-xs text-muted">未匹配到已登记的中资主体/项目</span>';
        var assets = (it.rel_assets || []).map(function (a) { return '<span class="badge" style="margin:1px;background:var(--bg2)">' + me_esc(a) + '</span>'; }).join('');
        return '<div style="border:1px solid var(--border);border-left:3px solid ' + col + ';border-radius:8px;padding:10px;margin-bottom:8px;background:var(--bg2)">' +
          '<div style="display:flex;gap:8px;align-items:flex-start">' +
          '<input type="checkbox" class="ds-ck" data-i="' + i + '" checked style="margin-top:3px">' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:13px;line-height:1.4">' + me_esc(it.title || '(无标题)') + '</div>' +
          '<div style="font-size:11px;color:var(--text3);margin:4px 0">' +
          '<span style="color:' + col + ';font-weight:600">' + lv + ' · 风险 ' + (it.riskScore || 0) + '</span>' +
          ' | 国别：' + me_esc(it.country || '未识别') +
          ' | 来源：' + me_esc(it.source || '') +
          ' | 通道：' + me_esc(it._channel === 'apnews' ? 'AP站内检索' : (it._channel === 'gdelt' ? 'GDELT全球检索' : (it._channel || ''))) +
          ' | 正文：' + (it._textFetched ? '已抓取原文' : '仅标题（原文抓取失败）') +
          '</div>' +
          '<div style="margin:4px 0">' + entHtml + ' ' + assets + '</div>' +
          '<div style="font-size:11px;color:var(--text2);max-height:52px;overflow:hidden;line-height:1.5">' + me_esc((it.content || '').slice(0, 220)) + '…</div>' +
          (it.riskRationale ? '<div style="font-size:10px;color:var(--text3);margin-top:4px">定级依据：' + me_esc(it.riskRationale) + '</div>' : '') +
          '<div style="margin-top:6px"><a href="' + me_esc(it.url || '#') + '" target="_blank" rel="noopener" style="font-size:11px;color:var(--cyan)">\uD83D\uDD17 查看原文</a></div>' +
          '</div></div></div>';
      }).join('');
      el.innerHTML =
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">' +
        '<button class="btn sm" onclick="DEEPSEARCH.toggleAll(true)">全选</button>' +
        '<button class="btn sm" onclick="DEEPSEARCH.toggleAll(false)">全不选</button>' +
        '<button class="btn primary sm" onclick="DEEPSEARCH.ingest()">\uD83D\uDCE5 勾选项入数据中心（待审核）</button>' +
        '<span class="text-xs text-muted">入库后需在「数据中心」人工审核通过，方可进入预警中心与态势感知。</span>' +
        '</div>' + rows;
    },

    toggleAll: function (v) {
      var cks = document.querySelectorAll('.ds-ck');
      for (var i = 0; i < cks.length; i++) cks[i].checked = !!v;
    },

    /* 入库：写入数据中心 osint_intel，状态 pending，严格遵守"采集→审核→预警"链路 */
    ingest: function () {
      var cks = document.querySelectorAll('.ds-ck'), picked = [];
      for (var i = 0; i < cks.length; i++) {
        if (cks[i].checked) { var it = this._items[parseInt(cks[i].getAttribute('data-i'), 10)]; if (it) picked.push(it); }
      }
      if (!picked.length) { this._status('未勾选任何条目。', 'var(--orange)'); return; }
      if (typeof DBCenter === 'undefined') { this._status('数据中心未就绪。', 'var(--red)'); return; }
      var rows = picked.map(function (it) {
        return {
          title: it.title, content: it.content, country: it.country || '',
          source: it.source || '开放网络检索', url: it.url || '',
          severity: it.severity || '中', category: it.category || '', data_type: it.data_type || 'osint',
          platform: '开放网络深度检索', pubDate: it.pubDate || '', publishedAt: it.publishedAt || '',
          chinaNegative: !!it.chinaNegative, chinaRelated: !!it.chinaRelated,
          rel_enterprises: it.rel_enterprises || [], rel_projects: it.rel_projects || [],
          rel_assets: it.rel_assets || [], riskScore: it.riskScore || 0,
          alertLevel: it.alertLevel || '蓝色', ruleHits: it.ruleHits || [],
          riskRationale: it.riskRationale || '', interestLinked: !!it.interestLinked,
          intel_type: 'OSINT', verified: false, audit_status: 'pending',
          /* 细节字段透传：正文全文 / 原摘要 / 结构化要素 / 规范编号 / 原文外链 / 待补全标记 */
          excerpt: it.excerpt || '', factSheet: it.factSheet || null,
          alert_no: it.alert_no || '', ext_url: it.ext_url || it.extUrl || '',
          author: it.author || '', siteName: it.siteName || '', charCount: it.charCount || 0,
          _ftPending: (typeof it._ftPending === 'boolean') ? it._ftPending : (String(it.content || '').length < 400),
          _deep: true, _real: true, _channel: it._channel || ''
        };
      });
      var n = DBCenter.addBatch('osint_intel', rows);
      if (typeof DBCenter.addLog === 'function') DBCenter.addLog('\uD83D\uDD0E 开放网络深度检索入库 ' + n + ' 条（关键词：' + this._lastQuery + '），状态：待审核');
      this._status('已写入数据中心 ' + n + ' 条（待审核）。请到「数据中心 → 待审核」人工研判后放行至预警中心。', 'var(--green)');
      if (typeof toast === 'function') toast('已入库 ' + n + ' 条，等待人工审核');
      if (typeof DATACENTER !== 'undefined' && DATACENTER.render) { try { DATACENTER.render(); } catch (e) {} }
    }
  };

  /* 轻量转义（避免检索到的外文标题里的引号/尖括号破坏结构） */
  function me_esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  window.me_esc = window.me_esc || me_esc;
  window.DEEPSEARCH = DEEPSEARCH;
})();
