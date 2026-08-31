/* ============================================================
 * role-ui.js v2.0 — 角色与信息分级
 * 角色：外交部领事保护 / 商务部海外安全 / 公安部海保 / 中企海外安全
 * 信息分级：公开 / 内部 / 敏感 / 涉密
 * 根据登录角色重构默认视图、侧边栏、信息过滤与数据脱敏。
 * ============================================================ */
(function(){
  'use strict';

  const ROLES = {
    mfa: { key: 'mfa', name: '外交部领事保护', icon: '🛂', defaultView: 'situation', focus: ['人员','领保案件','使领馆'], maxClearance: 'sensitive' },
    mofcom: { key: 'mofcom', name: '商务部海外安全', icon: '🏭', defaultView: 'country', focus: ['企业','项目','供应链'], maxClearance: 'sensitive' },
    mps: { key: 'mps', name: '公安部海保局', icon: '🛡️', defaultView: 'threatorgs', focus: ['威胁','案件','线索'], maxClearance: 'secret' },
    enterprise: { key: 'enterprise', name: '中企海外安全', icon: '🏢', defaultView: 'country', focus: ['本企业','项目风险','上级指令'], maxClearance: 'internal' }
  };

  const CLEARANCE_LEVELS = [
    { key: 'public', name: '公开', color: '#00d4ff' },
    { key: 'internal', name: '内部', color: '#00ff9f' },
    { key: 'sensitive', name: '敏感', color: '#ffcc00' },
    { key: 'secret', name: '涉密', color: '#ff3355' }
  ];

  const CLEARANCE_MAP = {
    '公开': 'public', '内部': 'internal', '敏感': 'sensitive', '涉密': 'secret',
    'public': 'public', 'internal': 'internal', 'sensitive': 'sensitive', 'secret': 'secret'
  };

  const VIEW_LABELS = {
    situation:'态势总览', workbench:'联合作业台', threatroom:'专项情报作战室', myfocus:'我的关注', command:'指挥调度中心', monitor:'风险监测', threatorgs:'威胁组织',
    intel:'情报影像中心', alerts:'预警中心', country:'国别档案', countryfile:'国家档案总表', reports:'情报报告中心',
    datapool:'数据中枢', datagov:'数据治理', settings:'系统设置',
    /* 合并前的旧键（兼容跳转用） */
    autoalert:'智能联动预警', matrix:'风险矩阵', forecast:'预测推演', analysis:'研判简报', aireport:'AI情报分析报告',
    explain:'可解释审计', role:'角色分级', datasources:'数据源库', datacenter:'数据中心', sidepool:'非预警数据池',
    dailyreport:'每日简报', wechat:'公众号采集', assets:'企业资产',
    anomaly:'异动信号', funnel:'采集漏斗', archive:'归档检索'
  };

  /* 各角色可见的侧边栏入口；未列出者默认按角色最大权限显示 */
  const VISIBLE_VIEWS = {
    mfa: Object.keys(VIEW_LABELS),
    mofcom: Object.keys(VIEW_LABELS),
    mps: Object.keys(VIEW_LABELS),
    enterprise: ['situation','myfocus','threatroom','command','monitor','intel','alerts','country','countryfile','reports','datapool','datagov','settings']
  };

  const PERMISSION_MATRIX = [
    { key: 'situation', label: '态势总览', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'workbench', label: '联合作业台（任务工作区+情报图层+安全指数）', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'threatroom', label: '专项情报作战室（实体专项采集+态势预警分析报告+预警图）', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'myfocus', label: '我的关注', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'alerts', label: '预警中心（实时队列+智能联动+异动信号）', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'country', label: '国别档案（矩阵+推演+企业资产）', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'countryfile', label: '国家档案总表（风险值+预警+项目+人员）', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'command', label: '指挥调度', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'threatorgs', label: '威胁组织', roles: ['mfa','mofcom','mps'] },
    { key: 'datagov', label: '数据治理（数据池+漏斗+归档检索+审计）', roles: ['mfa','mofcom','mps'] },
    { key: 'datapool', label: '数据中枢', roles: ['mfa','mofcom','mps'] },
    { key: 'reports', label: '情报报告中心', roles: ['mfa','mofcom','mps','enterprise'] },
    { key: 'settings', label: '系统设置', roles: ['mfa','mofcom','mps','enterprise'] }
  ];

  function _normClearance(c){
    if(!c) return 'public';
    return CLEARANCE_MAP[String(c)] || 'public';
  }

  window.ROLE_UI = {
    _role: null,
    _clearanceFilter: ['public','internal','sensitive','secret'],

    init(){
      this.detectRole();
      this.applySidebar();
      this.applyDefaultView();
    },

    detectRole(){
      var user = (window.AUTH && AUTH.currentUser) || {};
      var roleKey = user.role || localStorage.getItem('orps_demo_role') || 'mfa';
      roleKey = this._mapRoleKey(roleKey);
      if(!ROLES[roleKey]) roleKey = 'mfa';
      this._role = ROLES[roleKey];
      this._clearanceFilter = this._maxClearance(roleKey);
    },

    _mapRoleKey(roleKey){
      if(!roleKey) return 'mfa';
      var r = String(roleKey).toLowerCase();
      if(r === 'admin') return 'mps';
      if(r.indexOf('enterprise')>=0 || r.indexOf('企业')>=0 || r.indexOf('company')>=0) return 'enterprise';
      if(r.indexOf('mps')>=0 || r.indexOf('公安')>=0 || r.indexOf('police')>=0 || r.indexOf('public')>=0) return 'mps';
      if(r.indexOf('mofcom')>=0 || r.indexOf('商务')>=0 || r.indexOf('commerce')>=0) return 'mofcom';
      if(r.indexOf('mfa')>=0 || r.indexOf('外交')>=0 || r.indexOf('consular')>=0) return 'mfa';
      return r;
    },

    _maxClearance(roleKey){
      var max = (ROLES[roleKey] && ROLES[roleKey].maxClearance) || 'internal';
      var allowed = [];
      for(var i=0;i<CLEARANCE_LEVELS.length;i++){
        allowed.push(CLEARANCE_LEVELS[i].key);
        if(CLEARANCE_LEVELS[i].key === max) break;
      }
      return allowed;
    },

    getRole(){ return this._role; },

    allowedViews(){
      if(!this._role) return Object.keys(VIEW_LABELS);
      return VISIBLE_VIEWS[this._role.key] || Object.keys(VIEW_LABELS);
    },

    /* 过滤数据：只显示当前角色允许的信息级别（支持中文/英文 clearance） */
    filterByClearance(items, key){
      key = key || 'clearance';
      var me = this;
      return (items || []).filter(function(it){
        var c = _normClearance(it[key]);
        return me._clearanceFilter.indexOf(c) >= 0;
      });
    },

    /* 数据脱敏：低密级角色看不到敏感字段 */
    canSeeSensitive(){ return this._clearanceFilter.indexOf('sensitive') >= 0 || this._clearanceFilter.indexOf('secret') >= 0; },

    maskPersonnel(p){
      if(!p) return p;
      var out = Object.assign({}, p);
      if(!this.canSeeSensitive()){
        if(out.phone) out.phone = '*** 隐藏 ***';
        if(out.lat !== undefined) out.lat = null;
        if(out.lon !== undefined) out.lon = null;
        if(out.lastCheckin) out.lastCheckin = '***';
      }
      return out;
    },

    maskResource(r){
      if(!r) return r;
      var out = Object.assign({}, r);
      if(!this.canSeeSensitive()){
        if(out.contact) out.contact = '*** 隐藏 ***';
        if(out.capability && out.capability.indexOf('撤侨')>=0) out.capability = '*** 受限 ***';
      }
      return out;
    },

    applySidebar(){
      var role = this._role;
      var allowed = this.allowedViews();
      var items = document.querySelectorAll('.sb-item');
      items.forEach(function(item){
        var view = item.getAttribute('data-view');
        if(!view) return;
        item.style.display = allowed.indexOf(view) >= 0 ? '' : 'none';
      });
      var roleBadge = document.getElementById('role-badge');
      if(roleBadge && role){ roleBadge.textContent = role.icon + ' ' + role.name; }
    },

    applyDefaultView(){
      if(!this._role || !this._role.defaultView || typeof navigateTo !== 'function') return;
      var allowed = this.allowedViews();
      var cur = window._currentView || 'situation';
      if(allowed.indexOf(cur) < 0){
        navigateTo(this._role.defaultView);
      }
    },

    /* 渲染角色视图 */
    render(){
      var el = document.getElementById('view-role');
      if(!el) return;
      var role = this._role || ROLES.mfa;
      var allowed = this.allowedViews();
      var clearanceNames = this._clearanceFilter.map(function(c){ var l = CLEARANCE_LEVELS.find(function(x){return x.key===c;}); return l ? l.name : c; }).join(' / ');
      var html = '<div class="role-center" style="padding:16px">' +
        '<div class="role-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px"><h2 style="margin:0;font-size:18px">' + role.icon + ' 角色与信息分级</h2>' +
        '<span class="badge b-blue" style="font-size:11px">当前：' + esc(role.name) + '</span></div>' +
        '<div class="role-card" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">' +
          '<h3 style="margin:0 0 8px;font-size:15px">当前角色：' + role.name + '</h3>' +
          '<p style="margin:4px 0;color:var(--text2);font-size:13px">关注重点：' + role.focus.join('、') + '</p>' +
          '<p style="margin:4px 0;color:var(--text2);font-size:13px">默认首页：<b style="color:var(--cyan)">' + (VIEW_LABELS[role.defaultView]||role.defaultView) + '</b></p>' +
          '<p style="margin:4px 0;color:var(--text2);font-size:13px">信息可见级别：' + clearanceNames + '</p>' +
        '</div>' +
        '<div class="role-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">' +
          '<div class="role-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px">' +
            '<h3 style="margin:0 0 12px;font-size:14px">🎛️ 权限矩阵</h3>' +
            '<div style="display:grid;gap:6px">' + PERMISSION_MATRIX.map(function(p){
              var ok = p.roles.indexOf(role.key) >= 0;
              return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg2);border-radius:6px;font-size:12px">' +
                '<span>' + p.label + '</span>' +
                '<span style="color:' + (ok ? 'var(--green)' : 'var(--text3)') + ';font-weight:700">' + (ok ? '✓ 可见' : '— 隐藏') + '</span>' +
              '</div>';
            }).join('') + '</div>' +
          '</div>' +
          '<div class="role-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px">' +
            '<h3 style="margin:0 0 12px;font-size:14px">🔓 可见视图</h3>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px">' + allowed.map(function(v){
              return '<span style="padding:4px 10px;background:var(--bg2);border-radius:12px;font-size:11px;color:var(--text2)">' + (VIEW_LABELS[v]||v) + '</span>';
            }).join('') + '</div>' +
            '<h3 style="margin:16px 0 10px;font-size:14px">🔒 信息密级说明</h3>' +
            '<div style="display:grid;gap:6px">' + CLEARANCE_LEVELS.map(function(l){
              var active = ROLE_UI._clearanceFilter.indexOf(l.key) >= 0;
              return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg2);border-radius:6px;font-size:12px;opacity:' + (active ? '1' : '0.5') + '">' +
                '<span style="color:' + l.color + '">●</span> ' + l.name +
              '</div>';
            }).join('') + '</div>' +
          '</div>' +
          '<div class="role-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px">' +
            '<h3 style="margin:0 0 12px;font-size:14px">🎭 切换角色（演示）</h3>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + Object.values(ROLES).map(function(r){
              return '<button class="role-btn" onclick="ROLE_UI.switchRole(\'' + r.key + '\')" style="padding:8px 10px;background:' + (role.key===r.key?'var(--cyan-bg)':'var(--bg2)') + ';color:' + (role.key===r.key?'var(--cyan)':'var(--text2)') + ';border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px">' + r.icon + ' ' + r.name + '</button>';
            }).join('') + '</div>' +
            '<p style="margin-top:10px;font-size:11px;color:var(--text3)">切换后自动应用侧边栏过滤、默认首页与数据脱敏。</p>' +
          '</div>' +
          '<div class="role-panel" style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px">' +
            '<h3 style="margin:0 0 12px;font-size:14px">🔒 数据脱敏预览</h3>' +
            '<div style="display:grid;gap:6px;font-size:12px">' +
            '<div style="padding:8px 10px;background:var(--bg2);border-radius:6px;display:flex;justify-content:space-between"><span>人员电话/坐标</span><span style="color:'+(this.canSeeSensitive()?'var(--green)':'var(--orange)')+'">'+(this.canSeeSensitive()?'可见':'脱敏')+'</span></div>' +
            '<div style="padding:8px 10px;background:var(--bg2);border-radius:6px;display:flex;justify-content:space-between"><span>资源联络方式</span><span style="color:'+(this.canSeeSensitive()?'var(--green)':'var(--orange)')+'">'+(this.canSeeSensitive()?'可见':'脱敏')+'</span></div>' +
            '<div style="padding:8px 10px;background:var(--bg2);border-radius:6px;display:flex;justify-content:space-between"><span>撤侨/特殊能力</span><span style="color:'+(this.canSeeSensitive()?'var(--green)':'var(--orange)')+'">'+(this.canSeeSensitive()?'可见':'受限')+'</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
      el.innerHTML = html;
    },

    switchRole(roleKey){
      if(!ROLES[roleKey]) return;
      this._role = ROLES[roleKey];
      this._clearanceFilter = this._maxClearance(roleKey);
      /* 同步到 AUTH 当前会话与本地存储（演示用途） */
      try {
        localStorage.setItem('orps_demo_role', roleKey);
        if(window.AUTH && AUTH.user){ AUTH.user.role = roleKey; }
        var saved = localStorage.getItem('orps_user');
        if(saved){ var u = JSON.parse(saved); u.role = roleKey; localStorage.setItem('orps_user', JSON.stringify(u)); }
      } catch(e){}
      this.applySidebar();
      if(typeof navigateTo === 'function') navigateTo(this._role.defaultView);
      this.render();
      if(typeof EXPLAINABILITY !== 'undefined') EXPLAINABILITY.log('切换角色','audit',roleKey,{roleName:this._role.name});
      showToast && showToast('已切换为：' + this._role.name);
    }
  };
})();
