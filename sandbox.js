/* ============================================================
 * sandbox.js v1.0 — 沙盘推演与联合研判
 * 1. 历史案例推演：选择典型案例，系统输出影响评估与处置建议。
 * 2. 假设场景压力测试：用户设定参数，模拟事件演化。
 * 3. 联合研判专题：多方在线会签、版本留痕、统一口径。
 * ============================================================ */
(function(){
  'use strict';

  const STORAGE_KEYS = {
    scenarios: 'orps_sandbox_scenarios',
    drills: 'orps_sandbox_drills',
    studies: 'orps_sandbox_studies'
  };

  const SCENARIOS = [
    { id: 'SC-1', name: '某国突发政变与撤侨', category: '政局动荡', params: { country: 'X国', citizens: 1200, enterprises: 8, distanceKm: 500 }, description: '模拟友好国家突发军事政变，机场关闭、通信中断，需评估撤侨需求与企业人员转移。' },
    { id: 'SC-2', name: '海外项目营地遇袭', category: '恐怖袭击', params: { country: 'Y国', personnel: 350, campLat: 12.5, campLon: 45.2 }, description: '模拟中资企业海外营地遭武装袭击，需启动应急处置、医疗救援与案件侦办。' },
    { id: 'SC-3', name: '关键海峡封锁 30 天', category: '地缘通道', params: { chokepoint: '霍尔木兹海峡', cargoTons: 500000, rerouteDays: 14 }, description: '模拟关键航运通道被封锁，评估能源运输、供应链中断与替代航线。' },
    { id: 'SC-4', name: '大规模网络攻击致业务中断', category: '网络安全', params: { country: 'Z国', affectedSystems: 12, downtimeHours: 72 }, description: '模拟关键基础设施遭勒索软件攻击，评估恢复时间、合规影响与国际执法合作。' }
  ];

  window.SANDBOX = {
    _scenarios: null,
    _drills: null,
    _studies: null,

    init(){
      this._load();
      this._seedDefaults();
    },

    _load(){
      this._scenarios = this._read(STORAGE_KEYS.scenarios, []);
      this._drills = this._read(STORAGE_KEYS.drills, []);
      this._studies = this._read(STORAGE_KEYS.studies, []);
    },

    _read(key, def){
      try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e){ return def; }
    },

    _save(){
      try { localStorage.setItem(STORAGE_KEYS.scenarios, JSON.stringify(this._scenarios)); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.drills, JSON.stringify(this._drills.slice(-100))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.studies, JSON.stringify(this._studies.slice(-100))); } catch(e){}
    },

    _seedDefaults(){
      if(!this._scenarios.length) this._scenarios = SCENARIOS.map(s => ({...s}));
      this._save();
    },

    /* 运行一次推演 */
    runDrill(scenarioId, params){
      var sc = this._scenarios.find(s => s.id === scenarioId);
      if(!sc) return null;
      params = Object.assign({}, sc.params, params || {});
      var result = this._evaluate(sc.id, params);
      var drill = {
        id: 'DR-' + Date.now(),
        scenarioId: sc.id,
        scenarioName: sc.name,
        params: params,
        result: result,
        createdAt: new Date().toISOString()
      };
      this._drills.unshift(drill);
      this._save();
      return drill;
    },

    _evaluate(scenarioId, p){
      if(scenarioId === 'SC-1'){
        var needEvac = p.citizens > 500;
        var flights = Math.ceil(p.citizens / 280);
        return {
          impactLevel: p.citizens > 1000 ? 'red' : 'orange',
          summary: '约 ' + p.citizens + ' 名公民、' + p.enterprises + ' 家企业受影响，建议启动' + (needEvac ? 'Ⅰ/Ⅱ级' : 'Ⅲ级') + '响应。',
          actions: ['启动使领馆应急机制','统计精确人员位置','协调 ' + flights + ' 架次撤侨航班','通知企业暂停非必要活动'],
          estimatedHours: needEvac ? 72 : 24
        };
      }
      if(scenarioId === 'SC-2'){
        var severity = p.personnel > 200 ? 'red' : 'orange';
        return {
          impactLevel: severity,
          summary: '营地 ' + p.personnel + ' 人面临直接安全威胁，需立即升级安保并启动医疗救援。',
          actions: ['启动营地封锁与撤离','联系当地军警和安保公司','通知警务联络官','医疗直升机待命','案件证据固定'],
          estimatedHours: 6
        };
      }
      if(scenarioId === 'SC-3'){
        var cost = Math.round(p.cargoTons * 0.05 * p.rerouteDays / 10000);
        return {
          impactLevel: 'orange',
          summary: p.chokepoint + ' 封锁 ' + p.rerouteDays + ' 天，预计额外成本 ' + cost + ' 万美元，建议启用替代航线。',
          actions: ['评估原油库存','协调替代航线','通知航运企业','启动能源保供机制'],
          estimatedHours: 168
        };
      }
      if(scenarioId === 'SC-4'){
        return {
          impactLevel: p.affectedSystems > 10 ? 'red' : 'orange',
          summary: p.affectedSystems + ' 个系统中断 ' + p.downtimeHours + ' 小时，需启动网络安全应急响应。',
          actions: ['隔离受影响系统','启动备份','技术溯源','通知监管部门','国际执法合作'],
          estimatedHours: p.downtimeHours
        };
      }
      return { impactLevel: 'yellow', summary: '场景评估完成', actions: ['持续监测'], estimatedHours: 24 };
    },

    /* 联合研判专题 */
    createStudy(title, eventDesc){
      var study = {
        id: 'ST-' + Date.now(),
        title: title,
        eventDesc: eventDesc,
        status: 'open',
        createdAt: new Date().toISOString(),
        opinions: [],
        finalText: '',
        signatures: []
      };
      this._studies.unshift(study);
      this._save();
      return study;
    },

    addOpinion(studyId, dept, text){
      var st = this._studies.find(s => s.id === studyId);
      if(!st) return false;
      st.opinions.push({ dept: dept, text: text, time: new Date().toISOString(), user: (window.AUTH && AUTH.currentUser && AUTH.currentUser.name) || 'user' });
      this._save();
      return true;
    },

    signOff(studyId, dept){
      var st = this._studies.find(s => s.id === studyId);
      if(!st) return false;
      if(!st.signatures.find(s => s.dept === dept)){
        st.signatures.push({ dept: dept, time: new Date().toISOString() });
      }
      this._save();
      return true;
    },

    /* 渲染 */
    render(){
      var el = document.getElementById('view-sandbox');
      if(!el) return;
      el.innerHTML = '<div class="sb-center">' +
        '<div class="sb-header"><h2>🎲 沙盘推演 & 联合研判</h2></div>' +
        '<div class="sb-grid">' +
          '<div class="sb-panel">' +
            '<h3>📋 场景库</h3>' + this._scenarios.map(s =>
              '<div class="sb-scenario-row" data-id="' + s.id + '">' +
                '<b>' + esc(s.name) + '</b>' +
                '<span>' + esc(s.category) + '</span>' +
                '<button class="sb-btn sm" onclick="SANDBOX.runAndRender(\'' + s.id + '\')">推演</button>' +
              '</div>'
            ).join('') +
          '</div>' +
          '<div class="sb-panel">' +
            '<h3>📊 最新推演结果</h3>' +
            (this._drills.length ? this._drills.slice(0, 5).map(d =>
              '<div class="sb-drill-row">' +
                '<b>' + esc(d.scenarioName) + '</b>' +
                '<span>等级 ' + d.result.impactLevel + '</span>' +
                '<div class="sb-drill-summary">' + esc(d.result.summary) + '</div>' +
              '</div>'
            ).join('') : '<div class="sb-empty">暂无推演记录</div>') +
          '</div>' +
        '</div>' +
        '<div class="sb-panel" style="margin-top:12px">' +
          '<h3>🤝 联合研判专题</h3>' +
          '<button class="sb-btn" onclick="SANDBOX.promptCreateStudy()">+ 新建研判专题</button>' +
          (this._studies.length ? this._studies.slice(0, 5).map(s =>
            '<div class="sb-study-row">' +
              '<b>' + esc(s.title) + '</b>' +
              '<span>' + s.signatures.length + ' 方会签</span>' +
              '<button class="sb-btn sm" onclick="SANDBOX.openStudy(\'' + s.id + '\')">进入</button>' +
            '</div>'
          ).join('') : '<div class="sb-empty">暂无研判专题</div>') +
        '</div>' +
      '</div>';
    },

    runAndRender(scenarioId){
      var drill = this.runDrill(scenarioId, {});
      if(drill){
        alert('推演完成：' + drill.result.summary);
        this.render();
      }
    },

    promptCreateStudy(){
      var title = prompt('研判专题标题：');
      if(!title) return;
      var desc = prompt('事件描述：') || '';
      this.createStudy(title, desc);
      this.render();
    },

    openStudy(id){
      var st = this._studies.find(s => s.id === id);
      if(!st) return;
      var modal = document.createElement('div');
      modal.className = 'sb-modal-overlay';
      modal.innerHTML = '<div class="sb-modal">' +
        '<div class="sb-modal-hd"><h3>' + esc(st.title) + '</h3><button onclick="this.closest(\'.sb-modal-overlay\').remove()">×</button></div>' +
        '<div class="sb-modal-bd">' +
          '<p><b>事件描述：</b>' + esc(st.eventDesc) + '</p>' +
          '<h4>各方意见</h4>' + st.opinions.map(o =>
            '<div class="sb-opinion"><b>' + esc(o.dept) + '</b> <span>' + o.time.slice(0,16) + '</span><p>' + esc(o.text) + '</p></div>'
          ).join('') +
          '<h4>添加意见</h4>' +
          '<select id="sb-op-dept"><option value="外交部">外交部</option><option value="商务部">商务部</option><option value="公安部">公安部</option><option value="企业">企业</option></select>' +
          '<textarea id="sb-op-text" rows="3" placeholder="请输入研判意见"></textarea>' +
          '<button class="sb-btn" onclick="SANDBOX.submitOpinion(\'' + st.id + '\')">提交意见</button>' +
          '<button class="sb-btn" onclick="SANDBOX.submitSign(\'' + st.id + '\')">会签</button>' +
        '</div>' +
      '</div>';
      document.body.appendChild(modal);
    },

    submitOpinion(id){
      var dept = document.getElementById('sb-op-dept').value;
      var text = document.getElementById('sb-op-text').value;
      if(!text) return;
      this.addOpinion(id, dept, text);
      this.openStudy(id);
    },

    submitSign(id){
      var dept = document.getElementById('sb-op-dept').value;
      this.signOff(id, dept);
      alert('已会签：' + dept);
    }
  };
})();
