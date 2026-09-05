/* gate-admin.js — 海外利益安全数据拦截管理工具
 * 功能：① 自定义拦截规则 ② 数据审计（扫描全系统可疑条目）③ 一键清洗 ④ 拦截日志
 * 挂载点：系统设置页（navigateTo('settings') 时自动渲染） */
(function(root){
  'use strict';

  var STORE_KEY = 'orps_gate_admin';
  var LOG_KEY   = 'orps_gate_admin_log';

  /* 默认拦截规则（与 gate.js 同源，支持用户扩展） */
  var DEFAULT_RULES = [
    { id:'r1',  type:'keyword',  value:'青年奔赴湖南',           desc:'纯国内民生',  enabled:true },
    { id:'r2',  type:'keyword',  value:'广西创新开展民族团结进步促进法', desc:'纯国内政务',  enabled:true },
    { id:'r3',  type:'keyword',  value:'海事部门保障超大型外籍船舶顺利抵穗进厂维修', desc:'纯国内政务',  enabled:true },
    { id:'r4',  type:'keyword',  value:'民进党',                 desc:'台内政务',    enabled:true },
    { id:'r5',  type:'keyword',  value:'全民防卫',               desc:'台内政务',    enabled:true },
    { id:'r6',  type:'keyword',  value:'马背上的法官',           desc:'纯国内民生',  enabled:true },
    { id:'r7',  type:'keyword',  value:'奔赴高原',               desc:'纯国内民生',  enabled:true },
    { id:'r8',  type:'keyword',  value:'防晒霜',                 desc:'健康科普',    enabled:true },
    { id:'r9',  type:'regex',    value:'乒乓球.*金牌|亚运.*金牌|混双.*决赛', desc:'体育娱乐', enabled:true },
    { id:'r10', type:'regex',    value:'美丽乡村.*建设|生活污水.*治理', desc:'纯国内民生', enabled:true },
  ];

  function _loadRules(){
    try{
      var s = localStorage.getItem(STORE_KEY);
      if(s) return JSON.parse(s);
    }catch(e){}
    return JSON.parse(JSON.stringify(DEFAULT_RULES));
  }
  function _saveRules(rules){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(rules)); }catch(e){}
  }
  function _loadLog(){
    try{
      var s = localStorage.getItem(LOG_KEY);
      if(s) return JSON.parse(s);
    }catch(e){}
    return [];
  }
  function _addLog(entry){
    try{
      var logs = _loadLog();
      logs.unshift({ time: new Date().toLocaleString('zh-CN'), ...entry });
      if(logs.length > 200) logs = logs.slice(0, 200);
      localStorage.setItem(LOG_KEY, JSON.stringify(logs));
    }catch(e){}
  }

  /* 判断文本是否命中拦截规则 */
  function _matchRules(text, rules){
    if(!text) return null;
    for(var i = 0; i < rules.length; i++){
      var r = rules[i];
      if(!r.enabled) continue;
      if(r.type === 'keyword'){
        if(text.indexOf(r.value) >= 0) return r;
      }else if(r.type === 'regex'){
        try{ if(new RegExp(r.value).test(text)) return r; }catch(e){}
      }
    }
    return null;
  }

  /* 扫描所有 localStorage key，返回可疑条目列表 */
  function auditAllData(){
    var rules = _loadRules();
    var suspicious = [];
    var keysScanned = 0, totalItems = 0;
    for(var ki = 0; ki < localStorage.length; ki++){
      var key = localStorage.key(ki);
      if(!key) continue;
      keysScanned++;
      try{
        var raw = localStorage.getItem(key);
        var arr = JSON.parse(raw);
        if(!Array.isArray(arr)) continue;
        arr.forEach(function(it, idx){
          if(!it || typeof it !== 'object') return;
          totalItems++;
          var text = (it.title || '') + ' ' + (it.content || it.desc || it.summary || it.description || it.detail || '');
          var matched = _matchRules(text, rules);
          if(matched){
            suspicious.push({
              key: key, index: idx, id: it.id,
              title: it.title || '(无标题)', rule: matched.value, ruleDesc: matched.desc,
              textPreview: text.slice(0, 80)
            });
          }
        });
      }catch(e){}
    }
    return { suspicious: suspicious, keysScanned: keysScanned, totalItems: totalItems };
  }

  /* 一键清洗：删除所有命中拦截规则的条目 */
  function purgeAllSuspicious(){
    var rules = _loadRules();
    var totalDeleted = 0, keysAffected = [];
    for(var ki = 0; ki < localStorage.length; ki++){
      var key = localStorage.key(ki);
      if(!key) continue;
      try{
        var raw = localStorage.getItem(key);
        var arr = JSON.parse(raw);
        if(!Array.isArray(arr)) continue;
        var n = arr.length;
        arr = arr.filter(function(it){
          if(!it || typeof it !== 'object') return true;
          var text = (it.title || '') + ' ' + (it.content || it.desc || it.summary || it.description || it.detail || '');
          return !_matchRules(text, rules);
        });
        if(arr.length < n){
          localStorage.setItem(key, JSON.stringify(arr));
          totalDeleted += (n - arr.length);
          keysAffected.push(key + ':' + (n - arr.length));
        }
      }catch(e){}
    }
    _addLog({ action: '一键清洗', deleted: totalDeleted, keys: keysAffected.join(', ') });
    return { deleted: totalDeleted, keysAffected: keysAffected };
  }

  /* 删除单条条目 */
  function deleteItem(key, itemId){
    try{
      var arr = JSON.parse(localStorage.getItem(key) || '[]');
      var n = arr.length;
      arr = arr.filter(function(it){ return it.id !== itemId; });
      if(arr.length < n){
        localStorage.setItem(key, JSON.stringify(arr));
        _addLog({ action: '单条删除', key: key, itemId: itemId });
        return true;
      }
    }catch(e){}
    return false;
  }

  /* 渲染拦截管理面板到系统设置页 */
  function renderInto(containerId){
    var el = document.getElementById(containerId);
    if(!el) return;
    var rules = _loadRules();
    var logs = _loadLog();

    var html = '<div style="padding:16px">'+
      '<h2 style="margin:0 0 16px;font-size:18px;color:var(--cyan)">🛡️ 数据拦截管理工具</h2>'+
      '<p style="color:var(--text3);font-size:12px;margin-bottom:16px">本平台仅保留"中国海外利益安全"相关情报。下方规则用于拦截纯国内民生/政务/体育/娱乐/健康科普等噪声。</p>'+

      /* 统计卡片 */
      '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">'+
        '<div style="flex:1;min-width:140px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px">'+
          '<div style="font-size:11px;color:var(--text3)">拦截规则数</div>'+
          '<div style="font-size:22px;font-weight:700;color:var(--cyan)">'+rules.length+'</div>'+
        '</div>'+
        '<div style="flex:1;min-width:140px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px">'+
          '<div style="font-size:11px;color:var(--text3)">启用规则</div>'+
          '<div style="font-size:22px;font-weight:700;color:var(--green)">'+rules.filter(function(r){return r.enabled}).length+'</div>'+
        '</div>'+
        '<div style="flex:1;min-width:140px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px">'+
          '<div style="font-size:11px;color:var(--text3)">拦截日志</div>'+
          '<div style="font-size:22px;font-weight:700;color:var(--orange)">'+logs.length+'</div>'+
        '</div>'+
      '</div>'+

      /* 操作按钮 */
      '<div style="display:flex;gap:8px;margin-bottom:16px">'+
        '<button id="ga-btn-audit" style="padding:8px 16px;background:var(--cyan);color:#000;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">🔍 数据审计（扫描可疑条目）</button>'+
        '<button id="ga-btn-purge" style="padding:8px 16px;background:var(--red);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">🗑️ 一键清洗（删除所有可疑）</button>'+
      '</div>'+
      '<div id="ga-audit-result" style="margin-bottom:16px"></div>'+

      /* 规则列表 */
      '<h3 style="font-size:14px;color:var(--text);margin:0 0 8px">拦截规则</h3>'+
      '<div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden">'+
        '<table style="width:100%;border-collapse:collapse;font-size:12px">'+
          '<thead><tr style="background:rgba(0,212,255,0.08)">'+
            '<th style="padding:8px 10px;text-align:left;color:var(--text3);font-weight:600">启用</th>'+
            '<th style="padding:8px 10px;text-align:left;color:var(--text3);font-weight:600">类型</th>'+
            '<th style="padding:8px 10px;text-align:left;color:var(--text3);font-weight:600">规则内容</th>'+
            '<th style="padding:8px 10px;text-align:left;color:var(--text3);font-weight:600">说明</th>'+
            '<th style="padding:8px 10px;text-align:center;color:var(--text3);font-weight:600">操作</th>'+
          '</tr></thead>'+
          '<tbody>';

    rules.forEach(function(r, i){
      html += '<tr style="border-top:1px solid var(--border)">'+
        '<td style="padding:6px 10px"><input type="checkbox" data-idx="'+i+'" class="ga-rule-toggle" '+(r.enabled?'checked':'')+' style="cursor:pointer"></td>'+
        '<td style="padding:6px 10px"><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:'+(r.type==='keyword'?'rgba(0,255,159,0.15)':'rgba(179,102,255,0.15)')+';color:'+(r.type==='keyword'?'var(--green)':'var(--purple)')+'">'+(r.type==='keyword'?'关键词':'正则')+'</span></td>'+
        '<td style="padding:6px 10px;font-family:monospace;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">'+_esc(r.value)+'</td>'+
        '<td style="padding:6px 10px;color:var(--text3)">'+_esc(r.desc)+'</td>'+
        '<td style="padding:6px 10px;text-align:center"><button data-idx="'+i+'" class="ga-rule-del" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:16px">×</button></td>'+
      '</tr>';
    });

    html += '</tbody></table></div>'+

      /* 添加规则 */
      '<div style="margin-top:12px;display:flex;gap:8px">'+
        '<select id="ga-new-type" style="padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">'+
          '<option value="keyword">关键词</option><option value="regex">正则</option>'+
        '</select>'+
        '<input id="ga-new-value" type="text" placeholder="输入拦截内容（如：美丽乡村）" style="flex:1;padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">'+
        '<input id="ga-new-desc" type="text" placeholder="说明（如：纯国内民生）" style="flex:1;padding:6px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">'+
        '<button id="ga-btn-add" style="padding:6px 14px;background:var(--green);color:#000;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">+ 添加</button>'+
      '</div>'+

      /* 日志 */
      '<h3 style="font-size:14px;color:var(--text);margin:16px 0 8px">最近拦截日志</h3>'+
      '<div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;max-height:200px;overflow:auto;padding:8px;font-size:11px">';
    if(!logs.length){
      html += '<div style="color:var(--text3);text-align:center;padding:12px">暂无日志</div>';
    }else{
      logs.slice(0, 20).forEach(function(l){
        html += '<div style="padding:4px 0;border-bottom:1px solid var(--border);display:flex;gap:8px">'+
          '<span style="color:var(--text3);white-space:nowrap">'+_esc(l.time)+'</span>'+
          '<span style="color:var(--cyan)">'+_esc(l.action)+'</span>'+
          '<span style="color:var(--text2)">'+_esc(l.deleted !== undefined ? '删除 '+l.deleted+' 条' : (l.key||''))+'</span>'+
        '</div>';
      });
    }
    html += '</div></div>';

    el.innerHTML = html;

    /* 绑定事件 */
    _bindEvents(el);
  }

  function _bindEvents(el){
    /* 审计 */
    var btnAudit = el.querySelector('#ga-btn-audit');
    if(btnAudit) btnAudit.onclick = function(){
      var r = auditAllData();
      var resEl = el.querySelector('#ga-audit-result');
      if(r.suspicious.length === 0){
        resEl.innerHTML = '<div style="padding:12px;background:rgba(0,255,159,0.08);border:1px solid rgba(0,255,159,0.2);border-radius:8px;color:var(--green);font-size:13px">✅ 审计完成：扫描了 '+r.keysScanned+' 个 key、'+r.totalItems+' 条数据，未发现可疑条目。</div>';
      }else{
        var html = '<div style="padding:12px;background:rgba(255,51,85,0.08);border:1px solid rgba(255,51,85,0.2);border-radius:8px">'+
          '<div style="color:var(--red);font-weight:600;margin-bottom:8px">⚠️ 发现 '+r.suspicious.length+' 条可疑数据（共扫描 '+r.totalItems+' 条）</div>'+
          '<div style="max-height:240px;overflow:auto">';
        r.suspicious.forEach(function(s){
          html += '<div style="padding:6px;background:var(--bg2);border-radius:4px;margin-bottom:4px;font-size:11px;display:flex;gap:8px;align-items:center">'+
            '<span style="color:var(--text3);white-space:nowrap">'+_esc(s.key)+'</span>'+
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+_esc(s.title)+'</span>'+
            '<span style="color:var(--orange);white-space:nowrap">命中: '+_esc(s.rule)+'</span>'+
            '<button class="ga-item-del" data-key="'+_esc(s.key)+'" data-id="'+_esc(s.id||'')+'" style="background:var(--red);color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer">删除</button>'+
          '</div>';
        });
        html += '</div></div>';
        resEl.innerHTML = html;
        /* 绑定单条删除 */
        resEl.querySelectorAll('.ga-item-del').forEach(function(b){
          b.onclick = function(){
            var k = this.getAttribute('data-key');
            var id = this.getAttribute('data-id');
            if(deleteItem(k, id)){
              this.parentElement.style.display = 'none';
              showToast('已删除');
            }
          };
        });
      }
      _addLog({ action: '数据审计', found: r.suspicious.length, total: r.totalItems });
    };

    /* 一键清洗 */
    var btnPurge = el.querySelector('#ga-btn-purge');
    if(btnPurge) btnPurge.onclick = function(){
      if(!confirm('确定删除所有命中拦截规则的数据？此操作不可撤销。')) return;
      var r = purgeAllSuspicious();
      showToast('🗑️ 已清洗 '+r.deleted+' 条可疑数据');
      var resEl = el.querySelector('#ga-audit-result');
      resEl.innerHTML = '<div style="padding:12px;background:rgba(0,255,159,0.08);border:1px solid rgba(0,255,159,0.2);border-radius:8px;color:var(--green);font-size:13px">✅ 一键清洗完成：删除 '+r.deleted+' 条，涉及 key：'+r.keysAffected.join(', ')+'</div>';
      /* 刷新面板 */
      setTimeout(function(){ renderInto(document.querySelector('#ga-panel') ? 'ga-panel' : 'settings-content'); }, 500);
    };

    /* 规则开关 */
    el.querySelectorAll('.ga-rule-toggle').forEach(function(cb){
      cb.onchange = function(){
        var rules = _loadRules();
        var idx = parseInt(this.getAttribute('data-idx'));
        if(rules[idx]){ rules[idx].enabled = this.checked; _saveRules(rules); }
      };
    });

    /* 删除规则 */
    el.querySelectorAll('.ga-rule-del').forEach(function(btn){
      btn.onclick = function(){
        var rules = _loadRules();
        var idx = parseInt(this.getAttribute('data-idx'));
        if(rules[idx]){
          if(!confirm('删除规则：'+rules[idx].value+'？')) return;
          rules.splice(idx, 1); _saveRules(rules); renderInto('settings-content');
        }
      };
    });

    /* 添加规则 */
    var btnAdd = el.querySelector('#ga-btn-add');
    if(btnAdd) btnAdd.onclick = function(){
      var type = el.querySelector('#ga-new-type').value;
      var value = el.querySelector('#ga-new-value').value.trim();
      var desc = el.querySelector('#ga-new-desc').value.trim() || '自定义规则';
      if(!value){ showToast('请输入规则内容'); return; }
      var rules = _loadRules();
      rules.push({ id: 'r' + Date.now(), type: type, value: value, desc: desc, enabled: true });
      _saveRules(rules);
      _addLog({ action: '添加规则', rule: value });
      renderInto('settings-content');
      showToast('规则已添加');
    };
  }

  function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* 公开 API */
  var GATE_ADMIN = {
    renderInto: renderInto,
    auditAllData: auditAllData,
    purgeAllSuspicious: purgeAllSuspicious,
    deleteItem: deleteItem,
    matchRules: function(text){ return _matchRules(text, _loadRules()); },
    loadRules: _loadRules,
    loadLog: _loadLog,
    addLog: _addLog
  };

  if(typeof module !== 'undefined' && module.exports) module.exports = GATE_ADMIN;
  if(root) root.GATE_ADMIN = GATE_ADMIN;
})(typeof window !== 'undefined' ? window : null);
