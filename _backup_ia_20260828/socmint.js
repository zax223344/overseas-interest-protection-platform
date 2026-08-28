/* 境外社交媒体情报（SOCMINT）采集面板（前端）
 * ------------------------------------------------------------------
 * 能力：Lemmy 联邦社交网络 / Telegram 公开频道 / Hacker News 全文检索
 *      → 相关性闸门（涉我海外利益安全）→ 实体关联引擎（中资主体/海外项目/资产/国别）
 *      → 预警规则定级（社交媒体来源自动 -8 可信度扣分）→ 系统自动审核入库 → 实时分发
 * 铁律：
 *   1. 只展示真实抓取到的公开内容；通道不可达即如实标注，计数恒为 0，绝不编造；
 *   2. 社交媒体属未经证实的开源线索，保留 verified:false / credibility 标记供分析员研判；
 *      新架构无人工审核环节——入库即系统自动审核（audit_status:'approved'），
 *      仅 interestLinked（关联我海外利益）的线索实时分发进预警中心/态势，未关联线索留在数据中心备查。
 */
(function () {
  'use strict';

  var SOCMINT = {
    _items: [],
    _channels: [],
    _health: null,
    _busy: false,
    _lastQuery: '',
    /* 预置检索式：涉我海外利益安全高频风险场景（真实检索关键词，非样例数据） */
    _presets: [
      { k: 'Chinese workers', label: '中方外派人员' },
      { k: 'Chinese company protest', label: '中资企业抗议' },
      { k: 'Chinese embassy', label: '驻外使领馆' },
      { k: 'Chinese mine', label: '中资矿业资产' },
      { k: 'Belt and Road', label: '一带一路项目' },
      { k: 'Chinese nationals kidnapped', label: '中国公民被绑架' },
      { k: 'Chinese vessel', label: '中方船舶' },
      { k: 'forced labour Chinese', label: '用工合规争议' }
    ],

    panelHtml: function () {
      var chips = this._presets.map(function (p) {
        return '<span style="cursor:pointer;font-size:10px;padding:3px 8px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin:2px;display:inline-block" ' +
          'onclick="SOCMINT.search(\'' + p.k.replace(/'/g, "\\'") + '\')">' + p.label + '</span>';
      }).join(' ');
      return '<div class="card" style="padding:12px;border:1px solid rgba(179,102,255,0.25)">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
        '<b style="color:#b366ff;font-size:13px">\uD83D\uDCE1 境外社交媒体情报采集（SOCMINT）</b>' +
        '<span style="font-size:10px;color:var(--text3)">社交平台公开内容 \u2192 相关性闸门 \u2192 实体关联 \u2192 预警定级 \u2192 自动审核 \u2192 实时分发</span>' +
        '<span style="margin-left:auto;font-size:9px;color:var(--orange)">社交媒体为未证实开源线索，来源可信度自动扣分；关联我海外利益的线索自动入库并实时分发预警</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center">' +
        '<input id="sm-q" placeholder="关键词定向检索（英文命中率更高），如：Chinese workers Pakistan" ' +
        'style="flex:1;min-width:260px;background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:8px;font-size:12px" ' +
        'onkeydown="if(event.key===\'Enter\')SOCMINT.search()">' +
        '<button onclick="SOCMINT.search()" style="background:#b366ff;color:#000;border:none;padding:6px 14px;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px">\uD83D\uDD0D 定向检索</button>' +
        '<button onclick="SOCMINT.collect()" style="background:var(--panel2);color:var(--text);border:1px solid var(--border);padding:6px 14px;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px">\uD83D\uDCE5 全通道采集</button>' +
        '</div>' +
        '<div style="margin-bottom:8px"><span style="font-size:10px;color:var(--text3)">监控主题：</span> ' + chips + '</div>' +
        '<div id="sm-channels" style="margin-bottom:8px"></div>' +
        '<div id="sm-status" style="font-size:11px;color:var(--text3);margin-bottom:6px">就绪。定向检索约 30~70 秒；全通道采集覆盖多企业/多项目/多国家，约 3~8 分钟（串行规避限流）。</div>' +
        '<div id="sm-exec" style="margin-bottom:8px"></div>' +
        '<div id="sm-results" style="max-height:520px;overflow-y:auto"></div>' +
        '</div>';
    },

    _api: function (p) {
      if (typeof APIClient !== 'undefined' && APIClient.baseUrl) return APIClient.baseUrl.replace(/\/api$/, '') + p;
      if (location.protocol === 'file:') return 'http://localhost:3000' + p;
      return p;
    },

    _esc: function (s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    _status: function (t, c) {
      var el = document.getElementById('sm-status');
      if (el) { el.textContent = t; el.style.color = c || 'var(--text3)'; }
    },

    /* 通道健康台账：如实展示各社交平台实测可达性 */
    loadChannels: function () {
      var me = this;
      fetch(this._api('/api/social/channels')).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.ok) return;
        me._health = j.channels || null;
        me.renderChannels();
      }).catch(function () {
        var el = document.getElementById('sm-channels');
        if (el) el.innerHTML = '<div style="font-size:11px;color:var(--orange)">社交通道台账获取失败：后端服务未启动或不可达。</div>';
      });
    },

    renderChannels: function () {
      var el = document.getElementById('sm-channels');
      if (!el || !this._health) return;
      var me = this;
      var map = {
        live: ['var(--green)', '可用'],
        degraded: ['var(--orange)', '部分可用'],
        reserved: ['var(--text3)', '通道预留'],
        unavailable: ['var(--text3)', '不可用'],
        rejected: ['var(--text3)', '研判不采用']
      };
      var html = (this._health.channels || []).map(function (c) {
        var m = map[c.status] || ['var(--text3)', c.status];
        var dim = (c.status === 'live' || c.status === 'degraded') ? '' : 'opacity:.55;';
        return '<span title="' + me._esc(c.method + ' — ' + c.note) + '" style="' + dim +
          'display:inline-block;font-size:10px;margin:2px;padding:3px 8px;border:1px solid var(--border);border-radius:12px;background:var(--panel2)">' +
          '<span style="color:' + m[0] + '">\u25CF</span> ' + me._esc(c.name) + ' · ' + m[1] + '</span>';
      }).join('');
      var h = this._health;
      var tg = (h.telegramChannels || []).map(function (c) { return '@' + c.user; }).join('、');
      el.innerHTML =
        '<div style="font-size:10px;color:var(--text3);margin-bottom:4px">社交通道台账（本机实测，鼠标悬停看说明）：' +
        '可用 ' + (h.live || 0) + ' · 部分可用 ' + (h.degraded || 0) + ' · 预留 ' + (h.reserved || 0) + ' · 不可用 ' + (h.unavailable || 0) + '</div>' +
        html +
        (tg ? '<div style="font-size:9px;color:var(--text3);margin-top:4px">Telegram 实测可读频道：' + this._esc(tg) +
          '（镜像仅收录固定频道，其余频道返回未收录，不参与采集）</div>' : '');
    },

    /* 关键词定向检索 */
    search: function (preset) {
      var q = preset || (document.getElementById('sm-q') || {}).value || '';
      q = String(q).trim();
      if (!q) { this._status('请输入检索关键词，或点击「全通道采集」按预置主题轮询。', 'var(--orange)'); return; }
      if (preset) { var inp = document.getElementById('sm-q'); if (inp) inp.value = q; }
      this._run('/api/social?q=' + encodeURIComponent(q) + '&limit=25', '定向检索「' + q + '」', q);
    },

    /* 全通道采集（按预置关键词轮询 Lemmy + Telegram 频道 + HN） */
    collect: function () {
      this._run('/api/social?limit=20', '全通道采集（Lemmy + Telegram 公开频道 + Hacker News）', '(全通道采集)');
    },

    _run: function (path, label, tag) {
      if (this._busy) { this._status('采集进行中，请稍候…', 'var(--orange)'); return; }
      this._busy = true; this._lastQuery = tag;
      this._status('正在执行' + label + '… 为规避平台限流需串行抓取，请耐心等待。', '#b366ff');
      var me = this, t0 = Date.now();
      fetch(this._api(path)).then(function (r) { return r.json(); }).then(function (j) {
        me._busy = false;
        if (!j || !j.ok) { me._status('采集失败：' + ((j && j.error) || '后端无响应'), 'var(--red)'); return; }
        me._items = j.items || [];
        me._channels = j.channels || [];
        me.renderExec(j.stats || {});
        var sec = ((Date.now() - t0) / 1000).toFixed(1);
        if (!me._items.length) {
          document.getElementById('sm-results').innerHTML = '';
          me._status('采集完成（' + sec + 's）：本次未获取到与我海外利益安全直接关联的社交媒体线索。' +
            '原始抓取 ' + ((j.stats && j.stats.rawFetched) || 0) + ' 条，经相关性闸门与关联复核全部过滤。系统不会以任何方式补造数据。', 'var(--orange)');
          return;
        }
        me._status('采集完成（' + sec + 's）：原始 ' + ((j.stats && j.stats.rawFetched) || 0) + ' 条 → 过滤 ' +
          ((j.stats && j.stats.filtered) || 0) + ' 条 → 命中 ' + me._items.length + ' 条涉我海外利益线索' +
          '（其中橙色及以上 ' + ((j.stats && j.stats.redOrange) || 0) + ' 条）。可勾选入库（系统自动审核并实时分发）。', 'var(--green)');
        me.renderResults();
      }).catch(function (e) {
        me._busy = false;
        me._status('采集请求失败：' + e.message + '（请确认后端服务已启动）', 'var(--red)');
      });
    },

    /* 本次各通道真实执行结果（抓取条数 / 失败原因，如实展示） */
    renderExec: function (stats) {
      var el = document.getElementById('sm-exec');
      if (!el) return;
      var me = this;
      if (!this._channels.length) { el.innerHTML = ''; return; }
      var rows = this._channels.map(function (c) {
        var ok = c.fetched > 0;
        var col = ok ? 'var(--green)' : (c.error ? 'var(--text3)' : 'var(--orange)');
        return '<tr>' +
          '<td style="padding:3px 8px;font-size:10px;color:var(--text2)">' + me._esc(c.channel) + '</td>' +
          '<td style="padding:3px 8px;font-size:10px;color:var(--text3)">' + me._esc(c.user || '') + '</td>' +
          '<td style="padding:3px 8px;font-size:10px;color:' + col + ';font-weight:700;text-align:right">' + c.fetched + '</td>' +
          '<td style="padding:3px 8px;font-size:9px;color:var(--text3)">' + me._esc(c.error || '') + '</td>' +
          '</tr>';
      }).join('');
      el.innerHTML = '<details style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:6px 10px">' +
        '<summary style="font-size:10px;color:var(--text3);cursor:pointer">本次通道执行明细（' + this._channels.length + ' 个通道，含未接通原因）</summary>' +
        '<table style="width:100%;border-collapse:collapse;margin-top:6px"><thead><tr>' +
        '<th style="text-align:left;font-size:9px;color:var(--text3);padding:3px 8px">通道</th>' +
        '<th style="text-align:left;font-size:9px;color:var(--text3);padding:3px 8px">目标</th>' +
        '<th style="text-align:right;font-size:9px;color:var(--text3);padding:3px 8px">抓取</th>' +
        '<th style="text-align:left;font-size:9px;color:var(--text3);padding:3px 8px">说明 / 未接通原因</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></details>';
    },

    renderResults: function () {
      var el = document.getElementById('sm-results');
      if (!el) return;
      var me = this;
      var lvColor = { '红色': 'var(--red)', '橙色': 'var(--orange)', '黄色': '#e6c34a', '蓝色': 'var(--cyan)' };
      var pfIcon = { 'Lemmy': '\uD83C\uDF10', 'Telegram': '\u2708\uFE0F', 'Hacker News': '\uD83D\uDCBB' };
      var rows = this._items.map(function (it, i) {
        var lv = it.alertLevel || '蓝色';
        var col = lvColor[lv] || 'var(--cyan)';
        var ents = (it.rel_enterprises || []).concat(it.rel_projects || []);
        var entHtml = ents.length
          ? ents.map(function (n) { return '<span class="badge b-blue" style="margin:1px">' + me._esc(n) + '</span>'; }).join('')
          : '';
        var assets = (it.rel_assets || []).map(function (a) {
          return '<span style="display:inline-block;font-size:9px;margin:1px;padding:2px 6px;border-radius:8px;background:var(--bg2);color:var(--text3)">' + me._esc(a) + '</span>';
        }).join('');
        var eng = it.engagement || {};
        var engTxt = [];
        if (eng.score) engTxt.push('赞 ' + eng.score);
        if (eng.comments) engTxt.push('评论 ' + eng.comments);
        if (eng.views) engTxt.push('阅读 ' + eng.views);
        return '<div style="border:1px solid var(--border);border-left:3px solid ' + col + ';border-radius:8px;padding:10px;margin-bottom:8px;background:var(--panel2)">' +
          '<div style="display:flex;gap:8px;align-items:flex-start">' +
          '<input type="checkbox" class="sm-ck" data-i="' + i + '" checked style="margin-top:3px">' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:12px;line-height:1.4">' +
          (pfIcon[it.social_platform] || '\uD83D\uDCE1') + ' ' + me._esc(it.title || '(无标题)') + '</div>' +
          '<div style="font-size:10px;color:var(--text3);margin:4px 0">' +
          '<span style="color:' + col + ';font-weight:700">' + lv + ' · 风险 ' + (it.riskScore || 0) + '</span>' +
          ' | 平台：' + me._esc(it.social_platform || '') +
          ' | 板块：' + me._esc(it.channel_tag || '-') +
          ' | 国别：' + me._esc(it.country || '未识别') +
          (it.publishedAt ? ' | ' + me._esc(String(it.publishedAt).slice(0, 16).replace('T', ' ')) : '') +
          (engTxt.length ? ' | ' + engTxt.join(' · ') : '') +
          '</div>' +
          (entHtml || assets ? '<div style="margin:4px 0">' + entHtml + ' ' + assets + '</div>' : '') +
          '<div style="font-size:11px;color:var(--text2);max-height:48px;overflow:hidden;line-height:1.5">' +
          me._esc((it.content || '').slice(0, 200)) + '…</div>' +
          (it.riskRationale ? '<div style="font-size:9px;color:var(--text3);margin-top:4px">定级依据：' + me._esc(it.riskRationale) + '</div>' : '') +
          '<div style="margin-top:6px;display:flex;gap:10px;flex-wrap:wrap">' +
          '<a href="' + me._esc(it.url || '#') + '" target="_blank" rel="noopener" style="font-size:10px;color:#b366ff">\uD83D\uDD17 查看原帖</a>' +
          (it.ext_url ? '<a href="' + me._esc(it.ext_url) + '" target="_blank" rel="noopener" style="font-size:10px;color:var(--cyan)">\uD83D\uDCF0 引用外链</a>' : '') +
          '<span style="font-size:9px;color:var(--orange)">' + me._esc(it.credibility || '未证实') + '</span>' +
          '</div></div></div></div>';
      }).join('');
      el.innerHTML =
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">' +
        '<button class="btn sm" onclick="SOCMINT.toggleAll(true)">全选</button>' +
        '<button class="btn sm" onclick="SOCMINT.toggleAll(false)">全不选</button>' +
        '<button class="btn primary sm" onclick="SOCMINT.ingest()">\uD83D\uDCE5 勾选项入数据中心（自动审核·实时分发）</button>' +
        '<span style="font-size:10px;color:var(--text3)">社交线索未经证实，已标记可信度供研判；入库即系统自动审核，关联我海外利益者实时进入预警中心。</span>' +
        '</div>' + rows;
    },

    toggleAll: function (v) {
      var cks = document.querySelectorAll('.sm-ck');
      for (var i = 0; i < cks.length; i++) cks[i].checked = !!v;
    },

    /* 入库：写入数据中心 osint_intel（SOCMINT 属 OSINT 子类），由 DBCenter 自动审核并实时分发。
     * 不再设 audit_status:'pending' —— 新架构无人工审核环节；DBCenter.addBatch 统一置 approved
     * 并触发 _ingestApproved 实时分发（仅 interestLinked 关联我海外利益者进预警中心）。 */
    ingest: function () {
      var cks = document.querySelectorAll('.sm-ck'), picked = [];
      for (var i = 0; i < cks.length; i++) {
        if (cks[i].checked) { var it = this._items[parseInt(cks[i].getAttribute('data-i'), 10)]; if (it) picked.push(it); }
      }
      if (!picked.length) { this._status('未勾选任何条目。', 'var(--orange)'); return; }
      if (typeof DBCenter === 'undefined') { this._status('数据中心未就绪。', 'var(--red)'); return; }
      var rows = picked.map(function (it) {
        return {
          title: it.title, title_zh: it.title_zh || '', content: it.content, content_zh: it.content_zh || '',
          country: it.country || '',
          source: it.source || '社交媒体', url: it.url || '', ext_url: it.ext_url || '',
          severity: it.severity || '中', category: it.category || '', data_type: it.data_type || 'socmint',
          platform: '社交媒体情报', social_platform: it.social_platform || '', channel_tag: it.channel_tag || '',
          author: it.author || '', engagement: it.engagement || {},
          pubDate: it.pubDate || '', publishedAt: it.publishedAt || '',
          chinaNegative: !!it.chinaNegative, chinaRelated: !!it.chinaRelated,
          rel_enterprises: it.rel_enterprises || [], rel_projects: it.rel_projects || [],
          rel_assets: it.rel_assets || [], riskScore: it.riskScore || 0,
          alertLevel: it.alertLevel || '蓝色', ruleHits: it.ruleHits || [],
          riskRationale: it.riskRationale || '', interestLinked: !!it.interestLinked,
          credibility: it.credibility || '未证实（社交媒体单源）',
          intel_type: 'SOCMINT', verified: false,
          _social: true, _real: true
        };
      });
      /* DBCenter.addBatch 自动审核（approved）→ _ingestApproved 实时分发 → _refreshAllViews 刷新视图 */
      var n = DBCenter.addBatch('osint_intel', rows);
      var linked = rows.filter(function (r) { return r.interestLinked; }).length;
      if (typeof DBCenter.addLog === 'function') {
        DBCenter.addLog('\uD83D\uDCE1 境外社交媒体情报入库 ' + n + ' 条（' + this._lastQuery + '），自动审核通过，关联我海外利益 ' + linked + ' 条已实时分发预警');
      }
      this._status('已写入数据中心 ' + n + ' 条社交媒体线索（系统自动审核）。其中关联我海外利益 ' + linked + ' 条已实时分发至预警中心/态势；社交情报未经证实，可信度标记供研判参考。', 'var(--green)');
      if (typeof showToast === 'function') showToast('\uD83D\uDCE1 社交情报已自动审核入库 ' + n + ' 条，实时分发 ' + linked + ' 条');
      else if (typeof toast === 'function') toast('已入库 ' + n + ' 条，实时分发 ' + linked + ' 条');
      if (typeof DATACENTER !== 'undefined' && DATACENTER.renderCollectedPanel) { try { DATACENTER.renderCollectedPanel(); } catch (e) {} }
    }
  };

  window.SOCMINT = SOCMINT;
})();
