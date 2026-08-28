/* ============================================================
 * 非预警数据池（2026-08-28 用户指令）
 * 痛点：每天采集几百条，但闸门拦截后数据"消失"，用户看不见采到了什么。
 * 设计：服务端把所有被闸门拦截的条目落 intel_sidepool（带拦截原因），
 * 本视图 = 今日采集全景（拦截原因分布 + 通道分布 + 被拦条目明细），
 * 支持人工复核：提升入库（有价值）/ 删除（确认垃圾）。
 * 回答用户三个问题：今天采了什么？拦了什么？为什么被拦？
 * ============================================================ */
'use strict';
var SIDEPOOL = {
  _data: null, _filterReason: '', _busy: false,

  REASON_LABELS: {
    'domestic-china': { t: '国内数据', c: '#f5a623', d: '判定为纯国内新闻（非海外利益安全）' },
    'stale-over24h': { t: '超24h旧闻', c: '#8b8fa3', d: '事件时间超过24小时时效窗' },
    'stale-single-source': { t: '单源未印证', c: '#ff6b81', d: '事件超6小时仍无第二信源印证' },
    'bad-title': { t: '低质标题', c: '#8b8fa3', d: '标题残缺/机翻残留/要素不足' },
    'event-sig-dup': { t: '事件签名重复', c: '#4da3ff', d: '同一事件已有入库版本（互证源）' },
    'ruua-quota': { t: '俄乌配额', c: '#8b8fa3', d: '俄乌话题超当日配额' },
    'dominant-quota': { t: '高发国配额', c: '#8b8fa3', d: '单国当日入库超配额' },
    'tombstoned': { t: '已删除过', c: '#8b8fa3', d: '用户此前删除过该数据' }
  },

  init() {
    this.render();
    this.load();
  },

  async load() {
    if (this._busy) return; this._busy = true;
    var el = document.getElementById('sidepool-content');
    try {
      var j = (typeof APIClient !== 'undefined' && APIClient._fetch)
        ? await APIClient._fetch('GET', '/api/intel/sidepool?days=1&limit=150')
        : await (await fetch('/api/intel/sidepool?days=1&limit=150')).json();
      this._data = j;
      this.render();
      /* 侧边栏徽标 */
      var b = document.getElementById('sb-sp-count');
      if (b) { b.textContent = j.total || 0; b.classList.toggle('zero', !(j.total > 0)); }
    } catch (e) {
      if (el) el.innerHTML = '<div class="empty"><div class="ic">⚠️</div><div>加载失败：' + (e.message || e) + '</div></div>';
    } finally { this._busy = false; }
  },

  render() {
    var el = document.getElementById('sidepool-content');
    if (!el) return;
    var d = this._data;
    if (!d) {
      el.innerHTML = '<div class="empty" style="padding:60px 0"><div class="ic" style="font-size:32px">🌊</div><div>正在加载今日采集全景…</div></div>';
      return;
    }
    var me = this;
    /* ===== 顶部统计条 ===== */
    var reasons = (d.byReason || []).slice(0, 10);
    var tags = (d.byTag || []).slice(0, 10);
    var statHtml =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
      '<div style="flex:1;min-width:200px;padding:12px 14px;background:var(--bg2,#141a26);border:1px solid var(--border);border-radius:10px">' +
      '<div style="font-size:11px;color:var(--text3)">近24h被拦截（未入正式库）</div>' +
      '<div style="font-size:26px;font-weight:800;color:var(--orange)">' + (d.total || 0) + '</div>' +
      '<div style="font-size:10px;color:var(--text3);margin-top:2px">这些数据全部可查、可复核、可提升入库</div></div>' +
      '<div style="flex:2;min-width:320px;padding:12px 14px;background:var(--bg2,#141a26);border:1px solid var(--border);border-radius:10px">' +
      '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">拦截原因分布</div>' +
      reasons.map(function (r) {
        var m = me.REASON_LABELS[r.reason] || { t: r.reason, c: '#8b8fa3' };
        var pct = d.total ? Math.round(100 * r.n / d.total) : 0;
        return '<div style="display:flex;align-items:center;gap:8px;margin:3px 0" title="' + (m.d || '') + '">' +
          '<span style="min-width:86px;font-size:11px;color:' + m.c + '">' + m.t + '</span>' +
          '<div style="flex:1;height:7px;background:rgba(128,128,128,.15);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:' + m.c + '"></div></div>' +
          '<span style="min-width:36px;text-align:right;font-size:11px;color:var(--text3)">' + r.n + '</span></div>';
      }).join('') +
      (reasons.length ? '' : '<div style="font-size:11px;color:var(--text3)">近24h无拦截记录</div>') +
      '</div>' +
      '<div style="flex:1;min-width:200px;padding:12px 14px;background:var(--bg2,#141a26);border:1px solid var(--border);border-radius:10px">' +
      '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">拦截来源通道</div>' +
      tags.map(function (t) {
        return '<div style="display:flex;justify-content:space-between;font-size:11px;margin:2px 0"><span style="color:var(--text2)">' + (t.source_tag || '(未标)') + '</span><span style="color:var(--text3)">' + t.n + '</span></div>';
      }).join('') + '</div></div>';

    /* ===== 过滤器 ===== */
    var filtHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' +
      '<button class="btn sm ' + (this._filterReason === '' ? 'primary' : '') + '" onclick="SIDEPOOL.filter(\'\')">全部</button>' +
      reasons.map(function (r) {
        var m = me.REASON_LABELS[r.reason] || { t: r.reason, c: '#8b8fa3' };
        return '<button class="btn sm ' + (me._filterReason === r.reason ? 'primary' : '') + '" style="' + (me._filterReason === r.reason ? '' : 'color:' + m.c) + '" onclick="SIDEPOOL.filter(\'' + r.reason + '\')">' + m.t + ' ' + r.n + '</button>';
      }).join('') + '</div>';

    /* ===== 条目明细 ===== */
    var items = (d.items || []).filter(function (it) { return !me._filterReason || it.reason === me._filterReason; });
    var listHtml = items.map(function (it) {
      var m = me.REASON_LABELS[it.reason] || { t: it.reason, c: '#8b8fa3' };
      var title = String(it.title_zh || it.title || '');
      var orig = it.title_zh ? String(it.title || '') : '';
      var tm = String(it.blocked_at || '').replace('T', ' ').slice(5, 16);
      return '<div style="padding:9px 12px;margin-bottom:6px;background:var(--bg2,#141a26);border:1px solid var(--border);border-radius:8px">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">' +
        '<span style="font-size:9px;padding:0 5px;border-radius:6px;border:1px solid ' + m.c + '66;color:' + m.c + '" title="' + (m.d || '') + '">' + m.t + '</span>' +
        '<span style="font-size:10px;color:var(--text3)">' + (it.source_tag || '') + '</span>' +
        (it.country ? '<span style="font-size:10px;color:var(--text3)">📍' + it.country + '</span>' : '') +
        '<span style="font-size:10px;color:var(--text3);margin-left:auto">' + tm + '</span></div>' +
        '<div style="font-size:12px;line-height:1.5;color:var(--text1)">' + (typeof stripTags === 'function' ? stripTags(title) : title) + '</div>' +
        (orig && orig !== title ? '<div style="font-size:10px;color:var(--text3);margin-top:2px">原文：' + orig.slice(0, 90) + '</div>' : '') +
        '<div style="display:flex;gap:6px;margin-top:5px">' +
        (it.url ? '<a href="' + it.url + '" target="_blank" rel="noopener" style="font-size:10px;color:var(--cyan)">🔗 原文</a>' : '') +
        '<button class="btn sm primary" style="font-size:9px;padding:1px 6px" onclick="SIDEPOOL.promote(' + it.id + ')" title="人工复核后提升入正式库">⬆ 提升入库</button>' +
        '<button class="btn sm danger" style="font-size:9px;padding:1px 6px" onclick="SIDEPOOL.remove(' + it.id + ')" title="确认垃圾，移出数据池">🗑 确认删除</button>' +
        '</div></div>';
    }).join('') || '<div class="empty" style="padding:40px 0"><div class="ic">✅</div><div>' + (this._filterReason ? '该原因下暂无被拦条目' : '近24h没有被拦截的数据') + '</div></div>';

    el.innerHTML =
      '<div style="padding:16px 18px;max-width:1200px">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span style="font-size:18px">🌊</span><span style="font-size:16px;font-weight:700">非预警数据池</span>' +
      '<span style="font-size:11px;color:var(--text3)">所有被闸门拦截的采集数据在此可见 · 可复核 · 可提升</span>' +
      '<button class="btn sm" style="margin-left:auto" onclick="SIDEPOOL.load()">🔄 刷新</button></div>' +
      '<div style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.6">数据流向说明：采集 → 清洗闸门 → <b style="color:var(--green)">通过 → 正式库 → 预警中心/数据中心</b>；<b style="color:var(--orange)">拦截 → 本数据池（保留72小时）</b>。被拦原因标注在每条上方，误拦的条目可人工提升入库。</div>' +
      statHtml + filtHtml + listHtml + '</div>';
  },

  filter(reason) { this._filterReason = reason; this.render(); },

  async promote(id) {
    if (!confirm('确认将此条提升入正式情报库？提升后将进入数据中心与预警链路。')) return;
    try {
      var j = (typeof APIClient !== 'undefined' && APIClient._fetch)
        ? await APIClient._fetch('POST', '/api/intel/sidepool/promote', { id: id })
        : await (await fetch('/api/intel/sidepool/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })).json();
      if (j.ok) { this.load(); } else { alert('提升失败：' + (j.error || '')); }
    } catch (e) { alert('提升失败：' + (e.message || e)); }
  },

  async remove(id) {
    try {
      if (typeof APIClient !== 'undefined' && APIClient._fetch) await APIClient._fetch('DELETE', '/api/intel/sidepool/' + id);
      else await fetch('/api/intel/sidepool/' + id, { method: 'DELETE' });
      this.load();
    } catch (e) {}
  }
};
window.SIDEPOOL = SIDEPOOL;
