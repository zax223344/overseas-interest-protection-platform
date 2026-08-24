/* ============================================================
 * explanability.js v2.0 — 可解释性与审计
 * 为每条预警/事件/自动动作提供：来源、规则、置信度、影响面、建议动作。
 * 操作审计日志：时间、用户、动作、对象、结果，支持追溯、过滤、导出。
 * ============================================================ */
(function(){
  'use strict';

  const STORAGE_KEYS = {
    audit: 'orps_exp_audit',
    explain: 'orps_exp_explain'
  };

  const ACTION_TYPES = {
    '查看预警':'alert','升级预警':'alert','降级预警':'alert','更新预警状态':'alert',
    '转指挥事件':'incident','智能晋升':'autoalert','自动扫描完成':'system',
    '生成预警':'alert','创建预警':'alert','删除预警':'alert','编辑预警':'alert'
  };

  window.EXPLAINABILITY = {
    _audit: null,
    _explain: null,
    _filter: 'all',
    _selectedId: null,

    init(){
      this._load();
    },

    _load(){
      this._audit = this._read(STORAGE_KEYS.audit, []);
      this._explain = this._read(STORAGE_KEYS.explain, {});
    },

    _read(key, def){
      try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e){ return def; }
    },

    _save(){
      /* 懒初始化防护（2026-08-24 修复：init 未先于 log/setExplain 调用时 _audit/_explain 为 null，
       * push/slice 直接抛错，把 showAlertDetail 等主流程一并打死） */
      if (!Array.isArray(this._audit)) this._audit = [];
      if (!this._explain || typeof this._explain !== 'object') this._explain = {};
      try { localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(this._audit.slice(-500))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.explain, JSON.stringify(this._explain)); } catch(e){}
    },

    _user(){
      return (window.AUTH && AUTH.currentUser && AUTH.currentUser.name) || 'system';
    },

    /* 记录解释元数据 */
    setExplain(targetId, meta){
      this._explain[targetId] = Object.assign({
        sources: [],
        rules: [],
        confidence: 0,
        impactSurface: '',
        suggestedActions: [],
        createdAt: new Date().toISOString()
      }, meta);
      this._save();
    },

    /* 通用审计日志 */
    log(action, targetType, targetId, detail){
      if (!Array.isArray(this._audit)) this._audit = []; /* 懒初始化（同上防护） */
      this._audit.push({
        id: 'AUD-' + Date.now() + '-' + Math.floor(Math.random()*1000),
        time: new Date().toISOString(),
        user: this._user(),
        action: action,
        targetType: targetType,
        targetId: targetId,
        detail: detail || ''
      });
      this._save();
    },

    /* 包装 alert 生成解释 */
    explainAlert(alert){
      if(!alert) return null;
      var meta = {
        sources: alert.source ? [alert.source] : ['实时数据流'],
        rules: alert.ruleId ? [alert.ruleId] : (alert.rule ? [alert.rule] : ['事件驱动规则']),
        confidence: alert.confidence || 0.65,
        impactSurface: '国家:' + (alert.country || '—') + '; 企业:' + (alert.enterprise || '—') + '; 等级:' + (alert.level || '—'),
        suggestedActions: this._suggestActions(alert),
        reasonText: alert.reason || '基于实时采集数据与规则引擎匹配结果'
      };
      var key = 'alert:' + (alert.id || alert.title);
      this.setExplain(key, meta);
      this.log('生成预警','alert',alert.id,{title:alert.title,level:alert.level,country:alert.country,confidence:meta.confidence,rules:meta.rules.join(',')});
      return meta;
    },

    _suggestActions(alert){
      var lv = String(alert.level).toLowerCase();
      if(lv === 'red') return ['立即上报','启动Ⅰ级响应','通知驻外使领馆','协调撤侨/救援'];
      if(lv === 'orange') return ['司局级研判','发布安全提醒','企业升级安保','加强监测'];
      if(lv === 'yellow') return ['纳入重点关注','内部通报','企业自查'];
      return ['持续监测'];
    },

    setFilter(t){
      this._filter = t || 'all';
      this.render();
    },

    select(id){
      this._selectedId = id;
      this.render();
    },

    _filteredAudit(){
      var f = this._filter;
      return (this._audit || []).slice().reverse().filter(a => {
        if(f === 'all') return true;
        if(f === 'audit') return a.action.indexOf('审计')>=0 || a.action.indexOf('清空')>=0 || a.action.indexOf('导出')>=0;
        if(f === 'system') return (ACTION_TYPES[a.action]||a.targetType) === 'system';
        return (ACTION_TYPES[a.action]||a.targetType) === f;
      });
    },

    exportAudit(){
      var data = { exportedAt: new Date().toISOString(), total: this._audit.length, logs: this._audit };
      var blob = new Blob(['\ufeff'+JSON.stringify(data, null, 2)], {type:'application/json;charset=utf-8'});
      var link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'orps_audit_' + new Date().toISOString().slice(0,10) + '.json';
      link.click();
      this.log('导出审计','audit','-',{count:this._audit.length});
      showToast && showToast('已导出 ' + this._audit.length + ' 条审计日志');
    },

    clearAudit(){
      if(!confirm('确定清空审计日志？')) return;
      this._audit = [];
      this._selectedId = null;
      this._save();
      this.render();
    },

    _renderExplainCard(a){
      if(!a){
        return '<div style="padding:40px 20px;text-align:center;color:var(--text3);font-size:13px">'+
          '<div style="font-size:40px;margin-bottom:12px">🧭</div>'+
          '<div>从左侧选择一条审计记录，查看其可解释性卡片</div>'+
          '<div style="margin-top:8px;font-size:11px">每条预警/事件自动附带：数据来源、触发规则、置信度、影响面、建议动作与推理链路</div>'+
        '</div>';
      }
      var key = 'alert:' + (a.targetId || '');
      var meta = this._explain[key] || this._explain[String(a.targetId)] || null;
      if(!meta && a.detail && typeof a.detail === 'object'){
        meta = {
          sources: a.detail.sources || (a.detail.alertId ? ['操作上下文'] : ['审计记录']),
          rules: a.detail.rules || [],
          confidence: a.detail.confidence || 0,
          impactSurface: a.detail.impactSurface || ('国家:'+(a.detail.country||'—')+'; 对象:'+(a.targetId||'—')),
          suggestedActions: a.detail.suggestedActions || [],
          reasonText: a.detail.reasonText || ('用户 <b>'+esc(a.user)+'</b> 执行 <b>'+esc(a.action)+'</b>，目标 <b>'+esc(a.targetType+':'+(a.targetId||''))+'</b>')
        };
      }
      if(!meta){
        meta = {
          sources: ['审计日志'],
          rules: [],
          confidence: 0,
          impactSurface: '—',
          suggestedActions: [],
          reasonText: '用户 <b>'+esc(a.user)+'</b> 执行 <b>'+esc(a.action)+'</b>，目标 <b>'+esc(a.targetType+':'+(a.targetId||''))+'</b>'
        };
      }
      function row(label,val){ return '<div style="padding:10px 12px;background:var(--bg2);border-radius:6px"><div style="font-size:11px;color:var(--text3);margin-bottom:2px">'+label+'</div><div style="font-size:13px;font-weight:600;line-height:1.5">'+val+'</div></div>'; }
      var html = '<div style="padding:16px">';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'+
        '<h3 style="margin:0;font-size:16px">🧠 可解释性卡片</h3>'+
        '<span class="badge b-blue" style="font-size:10px">'+esc(a.targetType)+'</span></div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        row('数据来源', (meta.sources||[]).join('、') || '—') +
        row('触发规则', (meta.rules||[]).join('、') || '—') +
        row('置信度', meta.confidence ? (Math.round(meta.confidence*100)+'%') : '—') +
        row('审计时间', a.time.slice(0,19).replace('T',' ')) +
      '</div>';
      html += row('影响面', meta.impactSurface || '—');
      html += '<div style="margin-top:12px">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:6px">建议动作</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:6px">'+
          ((meta.suggestedActions||[]).length ? meta.suggestedActions.map(act => '<span style="padding:4px 10px;background:var(--blue-bg);color:var(--cyan);border-radius:12px;font-size:11px">'+esc(act)+'</span>').join('') : '<span style="color:var(--text3);font-size:12px">—</span>') +
        '</div>'+
      '</div>';
      html += '<div style="margin-top:14px;padding:12px;background:rgba(0,212,255,0.05);border-left:3px solid var(--cyan);border-radius:6px">'+
        '<div style="font-size:11px;color:var(--cyan);margin-bottom:4px">推理链路</div>'+
        '<div style="font-size:12px;line-height:1.7;color:var(--text2)">'+meta.reasonText+'</div>'+
      '</div>';
      html += '<div style="margin-top:12px;font-size:11px;color:var(--text3)">操作用户：'+esc(a.user)+' | 对象ID：'+esc(a.targetId||'—')+' | 结果：'+esc((a.detail&&a.detail.result)?a.detail.result:'已记录')+'</div>';
      html += '</div>';
      return html;
    },

    /* 渲染审计视图 */
    render(){
      var el = document.getElementById('view-explain');
      if(!el) return;
      var filters = [
        {k:'all',l:'全部'},
        {k:'alert',l:'预警'},
        {k:'incident',l:'事件'},
        {k:'system',l:'系统'},
        {k:'audit',l:'审计'}
      ];
      var list = this._filteredAudit();
      var selected = this._selectedId ? list.find(x => x.id === this._selectedId) : null;
      if(!selected && list.length) selected = list[0];
      var html = '<div class="exp-center" style="padding:16px;height:100%;box-sizing:border-box">' +
        '<div class="exp-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">'+
          '<h2 style="margin:0;font-size:18px">🔍 可解释性与审计</h2>'+
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
            filters.map(f => '<button class="btn sm" style="font-size:11px;padding:4px 10px;background:'+(this._filter===f.k?'var(--cyan-bg)':'var(--bg2)')+';color:'+(this._filter===f.k?'var(--cyan)':'var(--text2)')+';border:1px solid var(--border)" onclick="EXPLAINABILITY.setFilter(\''+f.k+'\')">'+f.l+'</button>').join('') +
          '</div>'+
          '<div style="display:flex;gap:8px">'+
            '<button class="btn sm" style="font-size:11px;padding:5px 12px;background:var(--green-bg);color:var(--green);border-color:var(--green)" onclick="EXPLAINABILITY.exportAudit()">📥 导出审计</button>'+
            '<button class="btn sm" style="font-size:11px;padding:5px 12px;background:var(--red-bg);color:var(--red);border-color:var(--red)" onclick="EXPLAINABILITY.clearAudit()">🗑️ 清空日志</button>'+
          '</div>'+
        '</div>' +
        '<div class="exp-grid" style="display:grid;grid-template-columns:minmax(320px,1fr) 1.4fr;gap:14px;height:calc(100% - 60px)">' +
          '<div class="exp-panel" style="background:var(--panel);border-radius:10px;border:1px solid var(--border);overflow:hidden;display:flex;flex-direction:column">' +
            '<div style="padding:12px 14px;border-bottom:1px solid var(--border);font-weight:600;font-size:13px;display:flex;justify-content:space-between">'+
              '<span>📜 操作审计日志</span><span style="font-size:11px;color:var(--text3)">'+list.length+' 条</span></div>'+
            '<div class="exp-audit-list" style="flex:1;overflow-y:auto;padding:8px">' +
              (list.length ? list.map(a => {
                var isSel = selected && selected.id === a.id;
                return '<div class="exp-audit-row" onclick="EXPLAINABILITY.select(\''+a.id+'\')" style="padding:10px 12px;border-radius:8px;margin-bottom:6px;cursor:pointer;font-size:12px;background:'+(isSel?'rgba(0,212,255,0.12)':'var(--bg2)')+';border-left:3px solid '+(isSel?'var(--cyan)':'transparent')+'">' +
                  '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:var(--text3);font-size:11px;font-family:monospace">'+a.time.slice(0,19).replace('T',' ')+'</span><span style="font-size:10px;color:var(--cyan)">'+esc(a.user)+'</span></div>' +
                  '<div style="font-weight:600;margin-bottom:2px">'+esc(a.action)+'</div>' +
                  '<div style="font-size:11px;color:var(--text2)">'+esc(a.targetType+':'+(a.targetId||''))+(a.detail&&a.detail.title?' · '+esc(String(a.detail.title).slice(0,30)):'')+'</div>' +
                '</div>';
              }).join('') : '<div style="padding:30px;text-align:center;color:var(--text3);font-size:12px">暂无审计记录</div>') +
            '</div>' +
          '</div>' +
          '<div class="exp-panel" style="background:var(--panel);border-radius:10px;border:1px solid var(--border);overflow:hidden;display:flex;flex-direction:column">' +
            this._renderExplainCard(selected) +
          '</div>' +
        '</div>' +
      '</div>';
      el.innerHTML = html;
    },

    getExplain(targetId){ return this._explain[targetId]; },
    getAudit(){ return this._audit; }
  };
})();
