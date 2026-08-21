/* ============================================================
 * personnel-assets.js v1.0 — 人员、机构、项目资产与救援资源库
 * 说明：
 *   · 人员数据为模拟数据，仅用于演示框架，界面明确标注【模拟】，并提供导入接口。
 *   · 项目/资产/救援资源数据优先从公开网络抓取（真实），同时保留手动录入接口。
 * ============================================================ */
(function(){
  'use strict';

  const STORAGE_KEYS = {
    personnel: 'orps_pa_personnel',
    orgs: 'orps_pa_orgs',
    projects: 'orps_pa_projects',
    resources: 'orps_pa_resources',
    importQueue: 'orps_pa_import_queue'
  };

  const DEPT_NAMES = {
    mfa: '外交部领事保护', mps: '公安部海保局', mofcom: '商务部海外安全', enterprise: '中企海外安全'
  };

  /* 模拟海外人员库（明确标记为模拟） */
  const SIMULATED_PERSONNEL = [
    { id: 'P-sim-001', name: '王某某', category: '外派员工', type: '模拟', country: '巴基斯坦', city: '伊斯兰堡', orgId: 'E-CNPC', projectId: 'PR-CNPC-001', lat: 33.68, lon: 73.04, status: '在岗', phone: '+92-3XX-XXXXXXX', lastCheckin: '2026-08-07', clearance: '内部' },
    { id: 'P-sim-002', name: '李某某', category: '外派员工', type: '模拟', country: '巴基斯坦', city: '卡拉奇', orgId: 'E-CNPC', projectId: 'PR-CNPC-001', lat: 24.86, lon: 67.00, status: '在岗', phone: '+92-3XX-XXXXXXX', lastCheckin: '2026-08-07', clearance: '内部' },
    { id: 'P-sim-003', name: '张某某', category: '务工人员', type: '模拟', country: '安哥拉', city: '罗安达', orgId: 'E-CITIC', projectId: 'PR-CITIC-001', lat: -8.83, lon: 13.23, status: '在岗', phone: '+244-9XX-XXXXXX', lastCheckin: '2026-08-06', clearance: '内部' },
    { id: 'P-sim-004', name: '刘某某', category: '留学人员', type: '模拟', country: '美国', city: '纽约', orgId: 'ORG-EDU-US', projectId: '', lat: 40.71, lon: -74.00, status: '在境', phone: '+1-XXX-XXXXXXX', lastCheckin: '2026-08-07', clearance: '公开' },
    { id: 'P-sim-005', name: '陈某某', category: '侨民', type: '模拟', country: '缅甸', city: '仰光', orgId: 'ORG-OC-MMR', projectId: '', lat: 16.86, lon: 96.19, status: '在境', phone: '+95-9-XXXXXXX', lastCheckin: '2026-08-05', clearance: '公开' },
    { id: 'P-sim-006', name: '赵某某', category: '外派员工', type: '模拟', country: '尼日利亚', city: '拉各斯', orgId: 'E-CSCEC', projectId: 'PR-CSCEC-001', lat: 6.52, lon: 3.37, status: '在岗', phone: '+234-8XX-XXXXXXX', lastCheckin: '2026-08-07', clearance: '内部' },
    { id: 'P-sim-007', name: '孙某某', category: '商务人员', type: '模拟', country: '阿联酋', city: '迪拜', orgId: 'E-COSCO', projectId: 'PR-COSCO-001', lat: 25.20, lon: 55.27, status: '出差', phone: '+971-5X-XXXXXXX', lastCheckin: '2026-08-07', clearance: '公开' },
    { id: 'P-sim-008', name: '周某某', category: '外派员工', type: '模拟', country: '塞尔维亚', city: '贝尔格莱德', orgId: 'E-Zijin', projectId: 'PR-Zijin-001', lat: 44.78, lon: 20.44, status: '在岗', phone: '+381-6X-XXXXXXX', lastCheckin: '2026-08-07', clearance: '内部' }
  ];

  /* 机构库（部分真实中资企业 + 使领馆模板） */
  const DEFAULT_ORGS = [
    { id: 'E-CNPC', name: '中国石油天然气集团', short: '中石油', type: '中资企业', industry: '能源石化', hq: '北京', countries: ['伊拉克','哈萨克斯坦','苏丹','委内瑞拉','尼日利亚','俄罗斯','伊朗','利比亚','南苏丹'], clearance: '内部' },
    { id: 'E-Sinopec', name: '中国石油化工集团', short: '中石化', type: '中资企业', industry: '能源石化', hq: '北京', countries: ['沙特阿拉伯','俄罗斯','哈萨克斯坦','尼日利亚','伊拉克','伊朗','安哥拉'], clearance: '内部' },
    { id: 'E-CSCEC', name: '中国建筑集团', short: '中建', type: '中资企业', industry: '建筑工程', hq: '北京', countries: ['巴基斯坦','缅甸','埃塞俄比亚','越南','印度尼西亚','阿联酋','埃及','阿尔及利亚'], clearance: '内部' },
    { id: 'E-Zijin', name: '紫金矿业', short: '紫金', type: '中资企业', industry: '矿业资源', hq: '龙岩', countries: ['塞尔维亚','刚果(金)','哥伦比亚','澳大利亚','俄罗斯','秘鲁','苏里南'], clearance: '内部' },
    { id: 'E-Huawei', name: '华为技术', short: '华为', type: '中资企业', industry: '通信科技', hq: '深圳', countries: ['美国','俄罗斯','巴基斯坦','越南','印度尼西亚','南非','巴西','沙特阿拉伯','阿联酋','泰国','土耳其','肯尼亚'], clearance: '内部' },
    { id: 'EMB-PK', name: '驻巴基斯坦大使馆', short: '驻巴使馆', type: '驻外使领馆', industry: '外交机构', hq: '伊斯兰堡', countries: ['巴基斯坦'], clearance: '内部' },
    { id: 'EMB-AGO', name: '驻安哥拉大使馆', short: '驻安使馆', type: '驻外使领馆', industry: '外交机构', hq: '罗安达', countries: ['安哥拉'], clearance: '内部' },
    { id: 'POL-LNK-PK', name: '驻巴基斯坦警务联络官', short: '警务联络官(巴)', type: '警务联络官', industry: '执法合作', hq: '伊斯兰堡', countries: ['巴基斯坦'], clearance: '敏感' }
  ];

  /* 项目与资产库（真实公开信息，带输入接口） */
  const DEFAULT_PROJECTS = [
    { id: 'PR-CNPC-001', name: '鲁迈拉油田', country: '伊拉克', city: '巴士拉', orgId: 'E-CNPC', type: '油气资产', investment: 120, personnel: 450, lat: 30.51, lon: 47.78, status: '运营中', risk: '高', source: '公开信息' },
    { id: 'PR-CITIC-001', name: '安哥拉社会住房', country: '安哥拉', city: '罗安达', orgId: 'E-CITIC', type: '房建工程', investment: 6, personnel: 500, lat: -8.83, lon: 13.23, status: '在建', risk: '中', source: '公开信息' },
    { id: 'PR-CSCEC-001', name: 'PKM高速公路', country: '巴基斯坦', city: '伊斯兰堡-白沙瓦', orgId: 'E-CSCEC', type: '交通基建', investment: 28, personnel: 1200, lat: 33.68, lon: 73.04, status: '运营', risk: '高', source: '公开信息' },
    { id: 'PR-Zijin-001', name: '博尔铜矿', country: '塞尔维亚', city: '博尔', orgId: 'E-Zijin', type: '矿产资产', investment: 8, personnel: 400, lat: 44.08, lon: 22.10, status: '运营', risk: '中', source: '公开信息' },
    { id: 'PR-COSCO-001', name: '比雷埃夫斯港', country: '希腊', city: '比雷埃夫斯', orgId: 'E-COSCO', type: '港口资产', investment: 8, personnel: 500, lat: 37.94, lon: 23.64, status: '运营', risk: '低', source: '公开信息' }
  ];

  /* 执法与救援资源 */
  const DEFAULT_RESOURCES = [
    { id: 'R-MED-001', name: '北京999急救中心', type: '医疗救援', country: '中国', city: '北京', capability: '航空医疗转运', contact: '010-999', clearance: '内部' },
    { id: 'R-SEC-001', name: '德威国际安保(示例)', type: '私营安保', country: '全球', city: '迪拜', capability: '要人保护/驻地安保', contact: '备案', clearance: '内部' },
    { id: 'R-AIR-001', name: '国航海外撤侨运力', type: '航空运力', country: '中国', city: '北京', capability: '包机/撤侨', contact: '民航局协调', clearance: '敏感' },
    { id: 'R-INS-001', name: '中国信保海外投资险', type: '保险理赔', country: '中国', city: '北京', capability: '政治风险/战争险', contact: '010-XXXXXXXX', clearance: '内部' }
  ];

  window.PERSONNEL_ASSETS = {
    _personnel: null,
    _orgs: null,
    _projects: null,
    _resources: null,

    init(){
      this._load();
      this._seedDefaults();
    },

    _load(){
      this._personnel = this._read(STORAGE_KEYS.personnel, []);
      this._orgs = this._read(STORAGE_KEYS.orgs, []);
      this._projects = this._read(STORAGE_KEYS.projects, []);
      this._resources = this._read(STORAGE_KEYS.resources, []);
    },

    _read(key, def){
      try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e){ return def; }
    },

    _save(){
      try { localStorage.setItem(STORAGE_KEYS.personnel, JSON.stringify(this._personnel)); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.orgs, JSON.stringify(this._orgs)); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(this._projects)); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.resources, JSON.stringify(this._resources)); } catch(e){}
    },

    _seedDefaults(){
      if(!this._personnel.length){
        this._personnel = SIMULATED_PERSONNEL.map(p => ({...p, _simulated: true}));
      }
      if(!this._orgs.length) this._orgs = DEFAULT_ORGS.map(o => ({...o}));
      if(!this._projects.length) this._projects = DEFAULT_PROJECTS.map(p => ({...p}));
      if(!this._resources.length) this._resources = DEFAULT_RESOURCES.map(r => ({...r}));
      this._save();
    },

    _visiblePersonnel(){
      var list = (typeof ROLE_UI !== 'undefined') ? ROLE_UI.filterByClearance(this._personnel, 'clearance') : this._personnel;
      return list.map(p => (typeof ROLE_UI !== 'undefined') ? ROLE_UI.maskPersonnel(p) : p);
    },

    _visibleResources(){
      var list = (typeof ROLE_UI !== 'undefined') ? ROLE_UI.filterByClearance(this._resources, 'clearance') : this._resources;
      return list.map(r => (typeof ROLE_UI !== 'undefined') ? ROLE_UI.maskResource(r) : r);
    },

    /* 人员查询：按国家/城市/机构/项目筛选 */
    queryPersonnel(filters){
      filters = filters || {};
      return this._visiblePersonnel().filter(p => {
        if(filters.country && p.country !== filters.country) return false;
        if(filters.city && p.city !== filters.city) return false;
        if(filters.orgId && p.orgId !== filters.orgId) return false;
        if(filters.projectId && p.projectId !== filters.projectId) return false;
        if(filters.category && p.category !== filters.category) return false;
        if(filters.near && filters.radiusKm && p.lat && p.lon){
          var d = this._haversine(p.lat, p.lon, filters.near.lat, filters.near.lon);
          if(d > filters.radiusKm) return false;
        }
        return true;
      });
    },

    /* 项目查询 */
    queryProjects(filters){
      filters = filters || {};
      return this._projects.filter(p => {
        if(filters.country && p.country !== filters.country) return false;
        if(filters.orgId && p.orgId !== filters.orgId) return false;
        if(filters.type && p.type !== filters.type) return false;
        return true;
      });
    },

    /* 机构查询 */
    queryOrgs(filters){
      filters = filters || {};
      return this._orgs.filter(o => {
        if(filters.country && !o.countries.includes(filters.country)) return false;
        if(filters.type && o.type !== filters.type) return false;
        return true;
      });
    },

    /* 救援资源查询 */
    queryResources(filters){
      filters = filters || {};
      return this._visibleResources().filter(r => {
        if(filters.country && r.country !== filters.country) return false;
        if(filters.type && r.type !== filters.type) return false;
        return true;
      });
    },

    /* 根据事件位置计算暴露面 */
    computeExposure(lat, lon, radiusKm){
      var visiblePeople = this._visiblePersonnel();
      var visibleResources = this._visibleResources();
      var people = visiblePeople.filter(p => p.lat && p.lon && this._haversine(lat, lon, p.lat, p.lon) <= radiusKm);
      var projects = this._projects.filter(p => p.lat && p.lon && this._haversine(lat, lon, p.lat, p.lon) <= radiusKm);
      var orgs = this._orgs.filter(o => projects.some(pr => pr.orgId === o.id));
      var resources = visibleResources.filter(r => r.country === '全球' || projects.some(pr => pr.country === r.country));
      return { people: people, projects: projects, orgs: orgs, resources: resources, radiusKm: radiusKm };
    },

    _haversine(lat1, lon1, lat2, lon2){
      var R = 6371;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)*Math.sin(dLon/2);
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    },

    /* 数据导入接口 */
    importPersonnel(rows){
      if(!Array.isArray(rows)) return 0;
      var cnt = 0;
      rows.forEach(row => {
        if(!row || !row.name) return;
        row.id = row.id || 'P-import-' + Date.now() + '-' + Math.floor(Math.random()*1000);
        row.type = '导入';
        row._simulated = false;
        this._personnel.push(row);
        cnt++;
      });
      this._save();
      return cnt;
    },

    importProjects(rows){
      if(!Array.isArray(rows)) return 0;
      var cnt = 0;
      rows.forEach(row => {
        if(!row || !row.name) return;
        row.id = row.id || 'PR-import-' + Date.now() + '-' + Math.floor(Math.random()*1000);
        this._projects.push(row);
        cnt++;
      });
      this._save();
      return cnt;
    },

    importOrgs(rows){
      if(!Array.isArray(rows)) return 0;
      var cnt = 0;
      rows.forEach(row => {
        if(!row || !row.name) return;
        row.id = row.id || 'ORG-import-' + Date.now() + '-' + Math.floor(Math.random()*1000);
        this._orgs.push(row);
        cnt++;
      });
      this._save();
      return cnt;
    },

    importResources(rows){
      if(!Array.isArray(rows)) return 0;
      var cnt = 0;
      rows.forEach(row => {
        if(!row || !row.name) return;
        row.id = row.id || 'R-import-' + Date.now() + '-' + Math.floor(Math.random()*1000);
        this._resources.push(row);
        cnt++;
      });
      this._save();
      return cnt;
    },

    /* 渲染人员资产视图 */
    render(){
      var el = document.getElementById('view-personnel');
      if(!el) return;
      var visibleP = this._visiblePersonnel();
      var visibleR = this._visibleResources();
      el.innerHTML = '<div class="pa-center">' +
        '<div class="pa-header"><h2>👥 人员与机构精准定位</h2></div>' +
        '<div class="pa-stats">' +
          '<div class="pa-stat"><b>' + visibleP.length + '</b><span>海外人员</span><small>' + visibleP.filter(p => p._simulated).length + ' 模拟</small></div>' +
          '<div class="pa-stat"><b>' + this._orgs.length + '</b><span>机构</span></div>' +
          '<div class="pa-stat"><b>' + this._projects.length + '</b><span>项目/资产</span></div>' +
          '<div class="pa-stat"><b>' + visibleR.length + '</b><span>救援资源</span></div>' +
        '</div>' +
        '<div class="pa-grid">' +
          '<div class="pa-panel">' +
            '<h3>🔍 快速暴露面测算</h3>' +
            '<div class="pa-form">' +
              '<input id="pa-lat" placeholder="纬度" value="33.68">' +
              '<input id="pa-lon" placeholder="经度" value="73.04">' +
              '<input id="pa-radius" placeholder="半径 km" value="100">' +
              '<button class="pa-btn" onclick="PERSONNEL_ASSETS.runExposure()">测算</button>' +
            '</div>' +
            '<div id="pa-exposure-result"></div>' +
          '</div>' +
          '<div class="pa-panel">' +
            '<h3>📥 数据导入</h3>' +
            '<button class="pa-btn" onclick="PERSONNEL_ASSETS.openImportModal(\'personnel\')">导入人员</button>' +
            '<button class="pa-btn" onclick="PERSONNEL_ASSETS.openImportModal(\'projects\')">导入项目</button>' +
            '<button class="pa-btn" onclick="PERSONNEL_ASSETS.openImportModal(\'orgs\')">导入机构</button>' +
            '<button class="pa-btn" onclick="PERSONNEL_ASSETS.openImportModal(\'resources\')">导入资源</button>' +
          '</div>' +
        '</div>' +
        '<div class="pa-panel" style="margin-top:12px">' +
          '<h3>🌍 海外人员分布（模拟数据已标注）</h3>' +
          '<div class="pa-personnel-list">' + visibleP.slice(0, 20).map(p =>
            '<div class="pa-person-row ' + (p._simulated ? 'simulated' : '') + '">' +
              '<span>' + esc(p.name) + '</span>' +
              '<span>' + esc(p.category) + '</span>' +
              '<span>' + esc(p.country + ' / ' + (p.city||'—')) + '</span>' +
              '<span>' + (p.phone ? '📵 ' + esc(p.phone) : '') + '</span>' +
              '<span>' + (p._simulated ? '<b>[模拟]</b>' : '导入/真实') + '</span>' +
            '</div>'
          ).join('') + '</div>' +
        '</div>' +
      '</div>';
    },

    runExposure(){
      var lat = parseFloat(document.getElementById('pa-lat').value) || 0;
      var lon = parseFloat(document.getElementById('pa-lon').value) || 0;
      var r = parseFloat(document.getElementById('pa-radius').value) || 100;
      var exp = this.computeExposure(lat, lon, r);
      var el = document.getElementById('pa-exposure-result');
      el.innerHTML = '<div class="pa-exp-result">' +
        '<p>半径 ' + r + ' km 内：</p>' +
        '<ul>' +
          '<li>人员：' + exp.people.length + ' 人 ' + (exp.people.length ? '(含模拟 ' + exp.people.filter(p => p._simulated).length + ')' : '') + '</li>' +
          '<li>项目/资产：' + exp.projects.length + ' 个</li>' +
          '<li>关联机构：' + exp.orgs.length + ' 个</li>' +
          '<li>可用救援资源：' + exp.resources.length + ' 项</li>' +
        '</ul>' +
        (exp.people.length ? '<div class="pa-exp-people"><b>人员名单：</b>' + exp.people.map(p => p.name + '(' + p.category + ')').join('、') + '</div>' : '') +
      '</div>';
    },

    openImportModal(type){
      var json = prompt('请输入 JSON 数组（每行一个对象）：');
      if(!json) return;
      try {
        var rows = JSON.parse(json);
        if(!Array.isArray(rows)) throw new Error('必须是数组');
        var cnt = 0;
        if(type === 'personnel') cnt = this.importPersonnel(rows);
        else if(type === 'projects') cnt = this.importProjects(rows);
        else if(type === 'orgs') cnt = this.importOrgs(rows);
        else if(type === 'resources') cnt = this.importResources(rows);
        alert('成功导入 ' + cnt + ' 条');
        this.render();
      } catch(e) {
        alert('导入失败：' + e.message);
      }
    },

    getAll(){ return { personnel: this._personnel, orgs: this._orgs, projects: this._projects, resources: this._resources }; }
  };
})();
