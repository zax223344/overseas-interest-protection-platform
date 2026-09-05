/* ============================================================
 * command-center.js v1.1 — 实战指挥调度中心
 * 核心能力：事件接警 → 人员/机构/预案关联 → 行动工单派发 → 处置反馈 → 复盘归档
 * 与 autoalert.js、ALERTS、EVENTS 实时联动。
 * ============================================================ */
(function(){
  'use strict';

  const STORAGE_KEYS = {
    incidents: 'orps_cmd_incidents',
    workorders: 'orps_cmd_workorders',
    playbooks: 'orps_cmd_playbooks',
    audit: 'orps_cmd_audit',
    contacts: 'orps_cmd_contacts',
    resources: 'orps_cmd_resources',
    dispatches: 'orps_cmd_dispatches',
    conferences: 'orps_cmd_conferences'
  };

  /* 默认应急资源库（2026-08-14：资源可管理/可增删改，调度有表单有记录） */
  const DEFAULT_RESOURCES = [
    { id: 'R-medical', name: '医疗救援队', type: 'medical', status: 'available', count: '2组', contact: '驻外使领馆领保电话' },
    { id: 'R-sec', name: '安保增援队', type: 'security', status: 'available', count: '1队', contact: '企业海外安保部' },
    { id: 'R-veh', name: '应急撤离车辆', type: 'transport', status: 'available', count: '3辆', contact: '当地车队调度' },
    { id: 'R-sat', name: '卫星通信设备', type: 'comm', status: 'available', count: '5套', contact: '应急通信保障组' },
    { id: 'R-air', name: '撤侨包机运力', type: 'air', status: 'standby', count: '待命', contact: '民航局应急办' }
  ];
  const RES_STATUS = { available: { label: '在库可用', color: 'var(--green)' }, dispatched: { label: '已派出', color: 'var(--orange)' }, standby: { label: '待命', color: 'var(--yellow)' } };

  /* 部门预案与响应等级 */
  const RESPONSE_LEVELS = [
    { level: 1, code: 'red', name: 'Ⅰ级响应（红色）', color: '#ff3355', desc: '特别重大海外安全事件', actions: ['部长级会商','启动国家应急机制','驻外使领馆全面响应','公安部专案组','企业总部应急指挥中心','上报中央'] },
    { level: 2, code: 'orange', name: 'Ⅱ级响应（橙色）', color: '#ff8800', desc: '重大海外安全事件', actions: ['司局级协调','发布安全提醒','暂停高危活动','加强领事保护','企业升级安保'] },
    { level: 3, code: 'yellow', name: 'Ⅲ级响应（黄色）', color: '#ffcc00', desc: '较大海外安全事件', actions: ['加强监测','发布风险提示','企业内部排查','使领馆关注'] },
    { level: 4, code: 'blue', name: 'Ⅳ级响应（蓝色）', color: '#00d4ff', desc: '一般海外安全关注', actions: ['纳入日常监测','定期通报','保持联络'] }
  ];

  /* 默认应急预案库（实战化、可扩展） */
  const DEFAULT_PLAYBOOKS = [
    /* ===== 安全类 ===== */
    { id: 'PB-terror-001', name: '海外恐袭应急处置预案', category: '恐怖袭击', trigger: ['爆炸','枪击','恐袭','炸弹','自杀式','武装袭击','路边炸弹','IED'], dept: ['mfa','mps','mofcom','enterprise','health'], steps: ['立即核实伤亡情况与中方人员位置','通知驻外使领馆、警务联络官和当地安全部门','启动企业营地封控与安保升级','发布领事安全提醒，暂停非必要外出','协调医疗救援与伤员转运','固定现场证据，配合案件侦办','24小时内提交事件初报'], contacts: ['外交部领事保护中心','公安部海保局','驻外使领馆领保电话','企业海外安保部门'], resources: ['医疗救援包','安保增援队伍','应急撤离车辆','卫星电话'] },
    { id: 'PB-kidnap-001', name: '海外人员被绑架应急处置预案', category: '绑架劫持', trigger: ['绑架','劫持','人质','赎金','被绑'], dept: ['mfa','mps','enterprise','intel'], steps: ['确认被绑人员身份、数量与最后位置','第一时间通知家属并成立专班安抚','启动谈判或营救方案评估','通报驻在国政府与国际警务合作渠道','严格媒体与信息管控','协调医疗与心理援助','事件结束后组织复盘与人员轮换'], contacts: ['外交部领事保护中心','公安部国际刑警联络处','驻外使领馆','专业危机谈判顾问'], resources: ['谈判专家','情报支援','应急资金','医疗后送通道'] },
    { id: 'PB-camp-001', name: '海外项目营地遇袭应急处置预案', category: '营地安全', trigger: ['营地','项目部','袭击','围攻','抢劫','暴徒','入侵'], dept: ['enterprise','mfa','mps','mofcom'], steps: ['立即启动营地警报与人员集结清点','封锁营地出入口，启动武装/非武装防卫','向驻外使领馆、当地警察和军方报警','组织非必要人员进入安全掩体','拍摄取证并记录袭击者特征','评估设施损失与人员伤亡','启动保险理赔与人员心理干预'], contacts: ['企业海外应急指挥中心','驻外使领馆','当地军警','保险公司'], resources: ['营地防卫力量','应急发电机','医疗站','卫星通信'] },
    { id: 'PB-piracy-001', name: '海上安全与海盗袭击应对预案', category: '海上安全', trigger: ['海盗','亚丁湾','红海','商船','劫持','索马里','胡塞','曼德海峡'], dept: ['mofcom','mfa','mps','transport'], steps: ['确认船舶位置、船员国籍与遇袭情况','通报海军护航编队、船旗国与保险公司','指导船舶执行防海盗战术 manoeuvers','协调最近军事力量或私人武装护卫','发布航经该区域船只安全提醒','组织船员医疗与心理援助','评估货物与船舶损失'], contacts: ['交通运输部海事局','中远海运应急中心','海军护航编队','船东互保协会'], resources: ['护航编队','私人海上保安','安全舱','应急通讯'] },
    { id: 'PB-cyber-001', name: '网络攻击与数据泄露应急处置预案', category: '网络安全', trigger: ['网络攻击','黑客','勒索软件','数据泄露','DDoS','钓鱼','APT','入侵'], dept: ['mps','mofcom','enterprise','cyber'], steps: ['立即隔离受感染系统，阻断攻击扩散','保留日志与样本，开展技术溯源','通知受影响企业与关键信息基础设施运营者','启动网络安全应急响应与数据备份恢复','上报国家网信部门和公安机关','开展国际执法合作与威胁情报共享','评估业务影响并发布公开声明'], contacts: ['国家互联网应急中心','公安部网络安全保卫局','工信部网络安全管理局','企业CSO'], resources: ['应急响应团队','威胁情报平台','备份系统','法务支持'] },
    { id: 'PB-nbc-001', name: '核生化安全事件应对预案', category: '核生化', trigger: ['核泄漏','化学武器','毒气','辐射','生化','污染','有害物质'], dept: ['mfa','mps','health','mofcom','enterprise'], steps: ['确认事件类型、地点与扩散范围','指导当地中方人员就地避险或撤离上风方向','通报国际原子能机构/世卫组织等专业机构','协调专业防护装备与检测支援','启动医疗救治与去污洗消','发布专项安全提醒与防护指南','长期跟踪环境与健康影响'], contacts: ['国家核安全局','卫健委应急办','驻外使领馆','国际专业机构'], resources: ['防护装备','辐射/化学检测仪器','专业医疗队','去污设施'] },
    { id: 'PB-infra-001', name: '关键基础设施破坏应对预案', category: '基础设施', trigger: ['电网','管道','港口','铁路','通信','机场','变电站','爆炸破坏'], dept: ['mofcom','enterprise','mfa','energy'], steps: ['评估设施损毁程度与运营影响','启动备用电源/路由/供应链方案','协调当地维修力量与安保升级','通知用户与合作伙伴调整计划','上报主管部门并申请支援','开展事故调查与保险理赔','制定恢复运营时间表'], contacts: ['国家发改委运行局','能源局','国资委','驻外使领馆'], resources: ['抢修队伍','备用设备','应急资金','技术专家'] },

    /* ===== 政治与社会类 ===== */
    { id: 'PB-riot-001', name: '社会骚乱与政局动荡应对预案', category: '社会骚乱', trigger: ['政变','抗议','骚乱','冲突','示威','游行','暴乱','打砸抢'], dept: ['mfa','mofcom','enterprise','mps'], steps: ['评估局势升级风险与持续时间','统计受影响公民、企业与项目','发布领事提醒与安全等级调整','指导企业暂停作业、人员撤回营地','协调撤侨运力与临时安置点','与当地警方、军方建立联络机制','局势稳定后组织复工复产评估'], contacts: ['外交部领事保护中心','商务部合作司','驻外使领馆','民航/海事部门'], resources: ['撤侨包机/船舶','临时安置点','应急资金','翻译与向导'] },
    { id: 'PB-election-001', name: '选举争议与政权更迭应对预案', category: '政治风险', trigger: ['选举','大选','政权更迭','政府换届','政治危机','宪政危机'], dept: ['mfa','mofcom','enterprise','intel'], steps: ['研判选举结果与反对派反应','评估政策连续性与合同效力风险','发布领事提醒与企业风险提示','暂停大型活动与敏感项目施工','加强与各政治派别沟通','制定政策变化应对预案','跟踪新政府外资与安全政策'], contacts: ['外交部非洲/欧亚/拉美司','商务部美大/欧亚司','驻外使领馆','律所'], resources: ['政策分析团队','政府关系顾问','法律顾问','应急资金'] },
    { id: 'PB-opinion-001', name: '舆情危机与信息战应对预案', category: '舆情风险', trigger: ['舆论','抹黑','虚假信息','信息战','谣言','负面报道','仇恨言论'], dept: ['mfa','mofcom','enterprise','media'], steps: ['监测舆情源头、传播路径与关键账号','核实事实，准备权威回应口径','协调驻外使领馆与企业统一发声','通过事实核查与本地媒体澄清','必要时采取法律手段制止恶意传播','评估对项目运营与人员安全的实际影响','建立长期舆情监测与快速响应机制'], contacts: ['外交部新闻司','驻外使领馆新闻处','企业品牌公关','法务'], resources: ['舆情监测系统','媒体资源库','多语种声明模板','律师团队'] },

    /* ===== 自然灾害与公共卫生类 ===== */
    { id: 'PB-natural-001', name: '重大自然灾害应对预案', category: '自然灾害', trigger: ['地震','洪水','台风','海啸','山火','火山','泥石流','干旱'], dept: ['mfa','mofcom','enterprise','health','civil'], steps: ['确认灾区中国公民与项目位置','启动使领馆应急机制与企业自救','协调专业救援力量与物资支援','发布灾情通报与安全避险指南','组织撤离或就地安置','评估工程设施损毁与恢复方案','开展灾后防疫与心理疏导'], contacts: ['应急管理部','中国红十字会','驻外使领馆','企业海外应急队'], resources: ['救援队伍','应急物资','医疗设备','工程抢险机械'] },
    { id: 'PB-health-001', name: '海外公共卫生危机应对预案', category: '公共卫生', trigger: ['疫情','传染病','霍乱','疟疾','埃博拉','新冠','登革热','猴痘','公共卫生'], dept: ['health','mfa','mofcom','enterprise'], steps: ['确认疫情类型、传播范围与医疗资源','统计中方人员健康状况与暴露风险','发布防疫提醒与旅行建议','储备防疫物资与药品','协调疫苗接种与医疗后送','实施项目营地封闭管理与健康监测','与当地卫生部门建立信息共享'], contacts: ['国家卫健委','疾控中心','驻外使领馆','当地医疗机构'], resources: ['防疫物资','疫苗','抗病毒药物','隔离设施'] },

    /* ===== 经济与合规类 ===== */
    { id: 'PB-sanction-001', name: '制裁与合规风险应对预案', category: '合规制裁', trigger: ['制裁','实体清单','出口管制','SDN','禁运','二级制裁','合规'], dept: ['mofcom','enterprise','mps','legal'], steps: ['评估制裁范围、主体与业务影响','启动合规审查与风险敞口排查','调整合同、结算与供应链方案','申请许可或寻求法律救济','通知合作伙伴与金融机构','建立替代供应商与技术方案','持续跟踪制裁动态与执法趋势'], contacts: ['商务部产业安全局','国资委法规局','律师事务所','银行合规部'], resources: ['合规数据库','法律顾问','替代供应商清单','应急资金'] },
    { id: 'PB-currency-001', name: '货币危机与汇率风险应对预案', category: '经济风险', trigger: ['货币贬值','汇率暴跌','通胀','资本管制','外汇冻结','债务危机'], dept: ['mofcom','enterprise','bank','mfa'], steps: ['监测汇率、通胀与资本管制动态','评估当地资产、应收款与合同敞口','启动汇率对冲与外汇集中管理','调整计价货币与结算方式','压缩本地货币头寸','制定资金汇出应急预案','向主管部门报告重大损失风险'], contacts: ['人民银行','外汇管理局','国资委','商业银行'], resources: ['外汇衍生品','离岸账户','应急流动性','财务顾问'] },
    { id: 'PB-contract-001', name: '合同违约与政治征用应对预案', category: '法律风险', trigger: ['违约','征用','国有化','合同取消','罚款','诉讼','仲裁'], dept: ['mofcom','enterprise','legal','mfa'], steps: ['梳理合同条款、保险与担保安排','固定对方违约/征用证据','启动双边投资保护协定磋商','准备国际仲裁或当地诉讼','评估项目停工与人员撤留方案','协调政府间交涉','制定资产保全与索赔策略'], contacts: ['商务部条法司','贸促会','律师事务所','驻外使领馆'], resources: ['合同档案','法律团队','保险保单','仲裁基金'] },

    /* ===== 地缘与军事类 ===== */
    { id: 'PB-conflict-001', name: '武装冲突与撤侨应急处置预案', category: '武装冲突', trigger: ['战争','武装冲突','内战','跨境冲突','军事行动','空袭','炮击','撤侨'], dept: ['mfa','mps','mofcom','defense','enterprise'], steps: ['研判冲突规模、战线与升级趋势','清点中方公民与项目分布','发布最高级别安全提醒','启动使领馆24小时应急值守','制定陆/海/空多渠道撤离方案','协调军方、民航、海运运力','在边境/安全区设立集结点','战后评估损失与恢复方案'], contacts: ['外交部领事保护中心','国防部维和事务办公室','民航局','海军护航编队'], resources: ['撤侨运力','安全集结点','应急通信','医疗后送'] },
    { id: 'PB-geo-001', name: '地缘政治危机应对预案', category: '地缘战略风险', trigger: ['地缘','大国博弈','制裁升级','军事对峙','封锁','航道中断','外交降级'], dept: ['mfa','mofcom','enterprise','intel'], steps: ['研判危机对区域与行业的传导路径','评估关键通道（海峡、运河、管道）风险','调整供应链与物流路线','发布区域风险提示','加强与相关国家政府沟通','制定项目暂停与资产保全方案','跟踪国际斡旋与局势降温信号'], contacts: ['外交部政策司','商务部合作司','智库','驻外使领馆'], resources: ['情报分析','替代航线/路线','战略储备','政策顾问'] },

    /* ===== 交通与运营类 ===== */
    { id: 'PB-traffic-001', name: '重大交通安全事故应对预案', category: '交通安全', trigger: ['车祸','空难','船难','交通事故','坠机','沉船','大巴'], dept: ['mfa','mofcom','transport','enterprise'], steps: ['确认事故地点、伤亡与涉事人员身份','通知驻外使领馆、企业与家属','协调当地救援与医疗救治','派员赶赴现场协助处置','处理保险理赔与善后事宜','发布安全提醒，排查同类交通风险','总结教训并加强安全培训'], contacts: ['外交部领事保护中心','交通运输部','民航局','保险公司'], resources: ['医疗救援','交通运力','翻译','殡仪服务'] },
    { id: 'PB-labor-001', name: '劳资纠纷与社区冲突应对预案', category: '社会文化风险', trigger: ['罢工','劳资','社区','抗议','堵路','索赔','本地员工'], dept: ['enterprise','mofcom','mfa','labor'], steps: ['了解诉求核心与参与人数','启动对话机制，避免冲突升级','保障中方人员安全，必要时撤回营地','协调当地政府、工会与社区领袖','评估对项目进度的影响','制定补偿与和解方案','完善未来社区关系管理'], contacts: ['企业人力资源部','驻外使领馆','当地律师','社区代表'], resources: ['谈判团队','应急资金','安保力量','社区基金'] }
  ];

  /* 默认联系人（可扩展） */
  const DEFAULT_CONTACTS = [
    { id: 'C-mfa-duty', name: '外交部值班室', dept: 'mfa', role: '领事保护值班', phone: '010-XXXXXXXX', channel: '专线' },
    { id: 'C-mps-duty', name: '公安部海保局值班室', dept: 'mps', role: '海外利益保护值班', phone: '010-XXXXXXXX', channel: '专线' },
    { id: 'C-mofcom-duty', name: '商务部海外安全值班', dept: 'mofcom', role: '境外企业安全', phone: '010-XXXXXXXX', channel: '专线' },
    { id: 'C-12308', name: '12308 热线', dept: 'mfa', role: '公民求助', phone: '+86-10-12308', channel: '热线' }
  ];

  /* 状态映射 */
  const INC_STATUS = {
    open:     { label: '待处理',  cls: 'b-yellow' },
    processing:{ label: '处置中', cls: 'b-blue' },
    closed:   { label: '已结案',  cls: 'b-green' }
  };

  const WO_STATUS = {
    pending:  { label: '待办', cls: 'b-yellow' },
    processing:{ label: '进行中', cls: 'b-blue' },
    done:     { label: '已完成', cls: 'b-green' }
  };

  const DEPT_NAMES = {
    mfa:'外交部', mps:'公安部', mofcom:'商务部', enterprise:'中资企业',
    health:'卫健委', intel:'情报', cyber:'网信办', transport:'交通部',
    defense:'国防/军方', bank:'人民银行/外汇', legal:'法务', media:'宣传',
    civil:'应急管理', energy:'能源', labor:'人社/劳工'
  };

  function _esc(s){
    if(typeof window.esc === 'function') return window.esc(s);
    return String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.COMMAND = {
    _incidents: null,
    _workorders: null,
    _playbooks: null,
    _audit: null,
    _contacts: null,
    _currentIncident: null,
    _serverLoaded: false,

    init(){
      this._load();
      this._seedDefaults();
      this._bindGlobalShortcuts();
      this.render();
    },

    _load(){
      this._incidents = this._read(STORAGE_KEYS.incidents, []);
      this._workorders = this._read(STORAGE_KEYS.workorders, []);
      this._playbooks = this._read(STORAGE_KEYS.playbooks, []);
      this._audit = this._read(STORAGE_KEYS.audit, []);
      this._contacts = this._read(STORAGE_KEYS.contacts, []);
      this._resources = this._read(STORAGE_KEYS.resources, []);
      this._dispatches = this._read(STORAGE_KEYS.dispatches, []);
      this._conferences = this._read(STORAGE_KEYS.conferences, []);
      /* 服务端闭环状态（2026-08-13 P1-4）：服务端版本更新则覆盖本地并重渲染 */
      var me = this;
      try{
        fetch('/api/command/state').then(function(r){return r.ok?r.json():null;}).then(function(d){
          me._serverLoaded = true;
          var st = d && d.state;
          if(!st || !st.updatedAt) return;
          var localAt = me._read('orps_command_local_at', '');
          if(String(st.updatedAt) <= String(localAt)) return;
          me._incidents = st.incidents || me._incidents;
          me._workorders = st.workorders || me._workorders;
          me._playbooks = st.playbooks || me._playbooks;
          me._audit = st.audit || me._audit;
          me._contacts = st.contacts || me._contacts;
          me._resources = st.resources || me._resources;
          me._dispatches = st.dispatches || me._dispatches;
          me._conferences = st.conferences || me._conferences;
          me._pruneOrphans();
          me._saveLocal();
          try{ me.render(); }catch(e){}
        }).catch(function(){ me._serverLoaded = true; });
      }catch(e){ me._serverLoaded = true; }
      this._pruneOrphans();
    },

    _read(key, def){
      try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch(e){ return def; }
    },

    _saveLocal(){
      try { localStorage.setItem(STORAGE_KEYS.incidents, JSON.stringify(this._incidents.slice(-300))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.workorders, JSON.stringify(this._workorders.slice(-500))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.playbooks, JSON.stringify(this._playbooks)); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.audit, JSON.stringify(this._audit.slice(-500))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify(this._contacts)); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.resources, JSON.stringify(this._resources)); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.dispatches, JSON.stringify(this._dispatches.slice(-300))); } catch(e){}
      try { localStorage.setItem(STORAGE_KEYS.conferences, JSON.stringify(this._conferences.slice(-200))); } catch(e){}
    },

    _save(){
      this._saveLocal();
      /* 服务端状态未加载前禁止回写，防止空本地态覆盖共享数据（2026-08-14 竞态修复） */
      if(this._serverLoaded === false) return;
      /* 同步到服务端（跨终端/多岗位共享；失败静默，本地兜底） */
      var now = new Date().toISOString();
      try { localStorage.setItem('orps_command_local_at', JSON.stringify(now)); } catch(e){}
      try{
        var _st = { state: {
          incidents: this._incidents.slice(-300),
          workorders: this._workorders.slice(-500),
          playbooks: this._playbooks,
          audit: this._audit.slice(-500),
          contacts: this._contacts,
          resources: this._resources,
          dispatches: this._dispatches.slice(-300),
          conferences: this._conferences.slice(-200),
          updatedAt: now
        }};
        /* 服务端挂 _signCheck（无 authMiddleware 但签名密钥由 Bearer token 派生），
         * 裸 fetch 无头必 401 静默失败 → 跨终端共享实际从未生效；走 APIClient 自动带签名头 */
        if (typeof APIClient !== 'undefined' && APIClient._fetch && APIClient.getToken && APIClient.getToken()) {
          APIClient._fetch('PUT', '/api/command/state', _st).catch(function(){});
        } else {
          fetch('/api/command/state', {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify(_st)
          }).catch(function(){});
        }
      }catch(e){}
    },

    _seedDefaults(){
      if(!this._playbooks.length){
        this._playbooks = DEFAULT_PLAYBOOKS.map(p => ({...p, system: true}));
      }
      if(!this._contacts.length){
        this._contacts = DEFAULT_CONTACTS.map(c => ({...c, system: true}));
      }
      if(!this._resources.length){
        this._resources = DEFAULT_RESOURCES.map(r => ({...r, system: true}));
      }
      this._save();
    },

    _bindGlobalShortcuts(){
      var me = this;
      document.addEventListener('keydown', function(e){
        if(e.ctrlKey && e.key === 'F12'){
          e.preventDefault();
          me.createIncidentFromSelection();
        }
      });
    },

    _newId(prefix){ return prefix + '_' + Date.now() + '_' + Math.floor(Math.random()*1000); },

    _log(action, targetType, targetId, detail){
      var user = (window.AUTH && AUTH.currentUser && AUTH.currentUser.name) || 'system';
      this._audit.push({
        id: this._newId('AUD'), time: new Date().toISOString(), user: user,
        action: action, targetType: targetType, targetId: targetId, detail: detail || ''
      });
      this._save();
    },

    /* 从预警/事件接警，生成指挥事件 */
    createIncidentFromAlert(alert, opts){
      opts = opts || {};
      if(!alert) return null;
      var id = this._newId('INC');
      var level = this._resolveResponseLevel(alert.level || 'yellow');
      var incident = {
        id: id,
        title: alert.title || '未命名事件',
        desc: this._stripHtml(alert.desc || alert.content || '').slice(0, 800), /* 2026-09-05：_stripHtml 实体反转义+剥标签——预警 desc 常含转义 <a href>，不处理变生文本污染详情页 */
        country: alert.country || '',
        countryCode: '',
        level: level,
        levelName: RESPONSE_LEVELS.find(r => r.level === level).name,
        status: 'open',
        sourceType: 'alert',
        sourceId: alert.id || '',
        sourceName: alert.source || '', /* 2026-09-05：溯源保留——专题分析中心转来的事件记'专题分析中心'，预警转来的记原通道名（此前丢弃，incident.source=null 无法回溯出处） */
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedDepts: this._suggestDepts(alert),
        playbookIds: this._matchPlaybooks(alert).map(p => p.id),
        personnelIds: [],
        orgIds: [],
        assetIds: [],
        resourceIds: [],
        workorderIds: [],
        tags: (alert.type ? [alert.type] : []).concat(opts.auto ? ['自动接警'] : []),
        location: { lat: alert.lat || 0, lon: alert.lon || 0, name: alert.location || alert.country || '' },
        notes: '',
        isSimulated: alert.isSimulated || false,
        autoIntake: !!opts.auto
      };
      this._incidents.unshift(incident);
      this._autoCreateWorkorders(incident);
      this._log(opts.auto ? '自动接警' : '接警建案', 'incident', id, '来源预警: ' + (alert.title || ''));
      if(!opts.deferSave) this._save();
      return incident;
    },

    /* 手工建案 */
    createIncidentManual(opts){
      var id = this._newId('INC');
      var level = opts.level || 3;
      var title = opts.title || '手工录入事件';
      var desc = opts.desc || '';
      /* 根据标题/描述自动匹配预案 */
      var matchedPlaybooks = this._matchPlaybooks({ title: title, desc: desc });
      var incident = {
        id: id,
        title: title,
        desc: desc,
        country: opts.country || '',
        level: level,
        levelName: RESPONSE_LEVELS.find(r => r.level === level).name,
        status: 'open',
        sourceType: 'manual',
        sourceId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedDepts: opts.depts || this._suggestDepts({ type: (matchedPlaybooks[0] && matchedPlaybooks[0].category) || '' }),
        playbookIds: opts.playbookIds && opts.playbookIds.length ? opts.playbookIds : matchedPlaybooks.map(p => p.id),
        personnelIds: [],
        orgIds: [],
        assetIds: [],
        resourceIds: [],
        workorderIds: [],
        tags: opts.tags || [],
        location: opts.location || {},
        notes: opts.notes || '',
        isSimulated: opts.isSimulated || false
      };
      this._incidents.unshift(incident);
      this._autoCreateWorkorders(incident);
      this._log('手工建案', 'incident', id, incident.title);
      this._save();
      return incident;
    },

    /* 从选中文本快速建案 */
    createIncidentFromSelection(){
      var sel = window.getSelection ? window.getSelection().toString() : '';
      if(!sel) { showToast && showToast('请先选中一段文本再按 Ctrl+F12 建案'); return; }
      var title = sel.slice(0, 40) + (sel.length > 40 ? '...' : '');
      this.createIncidentManual({ title: title, desc: sel, level: 3, tags: ['快速建案'] });
      showToast && showToast('已快速建立指挥事件');
    },

    _resolveResponseLevel(lv){
      /* 将预警等级/严重程度映射到响应等级 */
      var s = String(lv || '').toLowerCase();
      if(s === 'red' || s === 'critical' || s === '高' || s === '严重') return 1;
      if(s === 'orange' || s === 'high' || s === '中') return 2;
      if(s === 'yellow' || s === 'medium' || s === '低') return 3;
      if(s === 'blue' || s === 'low') return 4;
      return 3;
    },

    _suggestDepts(alert){
      var type = String(alert.type || '').toLowerCase();
      var title = String(alert.title || '');
      if(/恐怖袭击|绑架|安全|网络|核生化|基础设施|营地|海盗/.test(type) || /绑架|恐袭|海盗|网络攻击|核泄漏/.test(title)) return ['mfa','mps','mofcom','enterprise'];
      if(/政治|政变|骚乱|选举|舆情/.test(type) || /政变|骚乱|抗议|选举/.test(title)) return ['mfa','mofcom','enterprise','intel'];
      if(/经济|制裁|合规|法律|货币/.test(type) || /制裁|贬值|征用|仲裁/.test(title)) return ['mofcom','enterprise','legal','bank'];
      if(/自然|灾害|公共卫生/.test(type) || /地震|洪水|疫情|传染病/.test(title)) return ['mfa','mofcom','enterprise','health'];
      if(/武装冲突|地缘|撤侨/.test(type) || /撤侨|战争|冲突|封锁/.test(title)) return ['mfa','mps','mofcom','defense','enterprise'];
      if(/交通|社会文化/.test(type) || /车祸|罢工|社区/.test(title)) return ['mfa','mofcom','enterprise','transport','labor'];
      return ['mfa','mofcom','enterprise'];
    },

    _matchPlaybooks(alert){
      var title = (alert.title || '') + ' ' + (alert.desc || '');
      var type = alert.type || '';
      var country = alert.country || '';
      var level = alert.level || '';
      var hits = [];
      this._playbooks.forEach(p => {
        var score = 0;
        /* 1) trigger 精确匹配 */
        p.trigger.forEach(t => { if(title.indexOf(t) >= 0) score += 4; });
        /* 2) 类别关键词扩展匹配 */
        var catKeywords = {
          '恐怖袭击': /爆炸|枪击|恐袭|炸弹|自杀式|武装袭击|IED|路边炸弹/,
          '绑架劫持': /绑架|劫持|人质|赎金|被绑/,
          '营地安全': /营地|项目部|围攻|入侵|暴徒冲击/,
          '海上安全': /海盗|商船|劫持|红海|亚丁湾|曼德海峡|胡塞/,
          '社会骚乱': /骚乱|抗议|示威|政变|冲突|动荡|游行|暴乱|打砸抢/,
          '选举争议': /选举|大选|政权更迭|政府换届|宪政危机/,
          '舆情风险': /舆论|抹黑|虚假信息|谣言|负面报道|仇恨言论/,
          '自然灾害': /地震|洪水|台风|海啸|山火|火山|泥石流|干旱/,
          '公共卫生': /疫情|传染病|霍乱|埃博拉|新冠|登革热|猴痘/,
          '网络安全': /网络攻击|黑客|勒索|数据泄露|DDoS|钓鱼|APT|入侵/,
          '核生化': /核泄漏|化学武器|毒气|辐射|生化|有害物质/,
          '基础设施': /电网|管道|港口|铁路|通信|机场|变电站|爆炸破坏/,
          '合规制裁': /制裁|实体清单|出口管制|SDN|禁运|二级制裁/,
          '经济风险': /货币贬值|汇率暴跌|通胀|资本管制|外汇冻结|债务危机/,
          '法律风险': /违约|征用|国有化|合同取消|诉讼|仲裁/,
          '武装冲突': /战争|武装冲突|内战|跨境冲突|军事行动|空袭|炮击|撤侨/,
          '地缘战略风险': /地缘|大国博弈|封锁|航道中断|外交降级|军事对峙/,
          '交通安全': /车祸|空难|船难|交通事故|坠机|沉船/,
          '社会文化风险': /罢工|劳资|社区|堵路|索赔|本地员工/
        };
        if(catKeywords[p.category] && catKeywords[p.category].test(title)) score += 3;
        /* 3) 类型直接匹配 */
        var typeToCat = {
          '安全风险': ['恐怖袭击','绑架劫持','营地安全','海上安全','网络安全','核生化','基础设施'],
          '政治风险': ['社会骚乱','选举争议','舆情风险'],
          '经济风险': ['经济风险','合规制裁','法律风险'],
          '地缘战略风险': ['武装冲突','地缘战略风险'],
          '自然环境风险': ['自然灾害','公共卫生'],
          '运营风险': ['基础设施','交通安全','社会文化风险']
        };
        var cats = typeToCat[type] || [];
        if(cats.indexOf(p.category) >= 0) score += 2;
        /* 4) 国家/地区关键词匹配 */
        if(country && title.indexOf(country) >= 0) score += 1;
        /* 5) 等级加权：红色预警优先高烈度预案 */
        if(level === 'red' && /武装冲突|恐怖袭击|绑架劫持|核生化|撤侨/.test(p.category)) score += 2;
        if(score > 0) hits.push({ p: p, score: score });
      });
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, 3).map(h => h.p);
    },

    /* 自动根据预案生成行动工单；无匹配预案时生成通用处置工单 */
    _autoCreateWorkorders(incident){
      var me = this;
      var pbs = this._playbooks.filter(p => incident.playbookIds.includes(p.id));
      var created = 0;
      pbs.forEach(pb => {
        pb.steps.forEach((step, idx) => {
          var wo = {
            id: me._newId('WO'),
            incidentId: incident.id,
            title: step,
            desc: '来自预案 ' + pb.name + ' 第' + (idx+1) + '步' + (pb.contacts ? ' | 联络：' + pb.contacts.slice(0,2).join('、') : ''),
            dept: pb.dept[idx % pb.dept.length] || pb.dept[0] || 'mfa',
            status: 'pending',
            priority: incident.level,
            assignedTo: '',
            dueHours: incident.level <= 1 ? (idx < 2 ? 1 : 4) : incident.level <= 2 ? (idx < 2 ? 2 : 12) : (idx < 2 ? 4 : 24),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            feedback: '',
            playbookId: pb.id,
            playbookName: pb.name,
            resources: pb.resources || [],
            contacts: pb.contacts || [],
            isAuto: true
          };
          me._workorders.push(wo);
          incident.workorderIds.push(wo.id);
          created++;
        });
      });
      /* 无匹配预案：按响应等级生成通用处置工单，确保指挥链路不中断 */
      if(created === 0){
        var genericSteps = [
          { title: '核实事件基本情况与受影响人员/资产', dept: 'mfa', hours: 1 },
          { title: '通知相关驻外使领馆与警务联络官', dept: 'mfa', hours: 2 },
          { title: '评估中资企业项目与人员暴露面', dept: 'mofcom', hours: 4 },
          { title: '协调企业内部安保与应急响应', dept: 'enterprise', hours: 6 },
          { title: '持续跟踪事态并上报处置进展', dept: 'mfa', hours: 24 }
        ];
        if(incident.level <= 2){
          genericSteps.unshift({ title: '启动部级/司局级应急会商', dept: 'mfa', hours: 1 });
          genericSteps.splice(2, 0, { title: '通知公安部海保局介入研判', dept: 'mps', hours: 2 });
        }
        genericSteps.forEach((step, idx) => {
          var wo = {
            id: me._newId('WO'),
            incidentId: incident.id,
            title: step.title,
            desc: '通用处置流程 第' + (idx+1) + '步（响应等级：' + incident.levelName + '）',
            dept: step.dept,
            status: 'pending',
            priority: incident.level,
            assignedTo: '',
            dueHours: step.hours,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            feedback: '',
            playbookId: '',
            isAuto: true
          };
          me._workorders.push(wo);
          incident.workorderIds.push(wo.id);
          created++;
        });
      }
      this._log('自动生成工单', 'incident', incident.id, '生成 ' + created + ' 张工单');
    },

    addWorkorder(incidentId, opts){
      var wo = {
        id: this._newId('WO'),
        incidentId: incidentId,
        title: opts.title || '行动任务',
        desc: opts.desc || '',
        dept: opts.dept || 'mfa',
        status: 'pending',
        priority: opts.priority || 3,
        assignedTo: opts.assignedTo || '',
        dueHours: opts.dueHours || 24,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        feedback: '',
        playbookId: opts.playbookId || '',
        isAuto: false
      };
      this._workorders.push(wo);
      var inc = this._incidents.find(i => i.id === incidentId);
      if(inc){ inc.workorderIds.push(wo.id); inc.updatedAt = new Date().toISOString(); }
      this._log('新增工单', 'workorder', wo.id, wo.title);
      this._save();
      return wo;
    },

    updateWorkorderStatus(woId, status, feedback){
      var wo = this._workorders.find(w => w.id === woId);
      if(!wo) return false;
      wo.status = status;
      wo.feedback = feedback || wo.feedback;
      wo.updatedAt = new Date().toISOString();
      this._log('更新工单状态', 'workorder', woId, status + (feedback ? ': ' + feedback : ''));
      var inc = this._incidents.find(i => i.id === wo.incidentId);
      if(inc){ inc.updatedAt = new Date().toISOString(); }
      this._save();
      return true;
    },

    startProcessing(incidentId){
      var inc = this._incidents.find(i => i.id === incidentId);
      if(!inc) return false;
      inc.status = 'processing';
      inc.updatedAt = new Date().toISOString();
      this._log('开始处置', 'incident', incidentId, '状态流转为处置中');
      this._save();
      this.render();
      this.openIncidentDetail(incidentId);
      return true;
    },

    closeIncident(incidentId, result){
      var inc = this._incidents.find(i => i.id === incidentId);
      if(!inc) return false;
      /* 处置闭环：结案必须填处置结果/复盘要点（2026-08-13 用户指令：处置闭环） */
      if(result === undefined || result === null || result === ''){
        result = prompt('结案复盘要点（处置结果/经验教训，必填）：') || '';
        if(!result){ showToast('结案必须填写复盘要点'); return false; }
      }
      inc.status = 'closed';
      inc.result = result;
      inc.closedAt = new Date().toISOString();
      inc.updatedAt = new Date().toISOString();
      /* 闭环回流：关联预警自动置为"已解除"，预警中心同步消警 */
      try {
        if (inc.sourceType === 'alert' && inc.sourceId && typeof ALERTS !== 'undefined') {
          var hit = ALERTS.find(function(a){ return String(a.id) === String(inc.sourceId); });
          if (hit) {
            hit.status = 'resolved';
            hit.resolvedBy = '指挥调度中心';
            hit.resolvedAt = inc.closedAt;
            if (typeof DataHub !== 'undefined' && DataHub.save) DataHub.save('alerts');
          }
        }
      } catch (e) {}
      this._log('结案', 'incident', incidentId, result || '');
      this._save();
      this.render();
      this.openIncidentDetail(incidentId);
      showToast('✅ 已结案并回流处置状态，关联预警已解除');
      return true;
    },

    reopenIncident(incidentId){
      var inc = this._incidents.find(i => i.id === incidentId);
      if(!inc) return false;
      inc.status = 'open';
      inc.updatedAt = new Date().toISOString();
      this._log('重启案件', 'incident', incidentId, '');
      this._save();
      this.render();
      this.openIncidentDetail(incidentId);
      return true;
    },

    addIncidentNote(incidentId, note){
      var inc = this._incidents.find(i => i.id === incidentId);
      if(!inc) return false;
      var line = '[' + new Date().toLocaleString('zh-CN') + '] ' + note;
      inc.notes = (inc.notes ? inc.notes + '\n' : '') + line;
      inc.updatedAt = new Date().toISOString();
      this._log('添加备注', 'incident', incidentId, note);
      this._save();
      this.openIncidentDetail(incidentId);
      return true;
    },

    linkPersonnel(incidentId, personIds){
      var inc = this._incidents.find(i => i.id === incidentId);
      if(!inc) return;
      personIds.forEach(pid => { if(!inc.personnelIds.includes(pid)) inc.personnelIds.push(pid); });
      inc.updatedAt = new Date().toISOString();
      this._log('关联人员', 'incident', incidentId, '人员数: ' + inc.personnelIds.length);
      this._save();
    },

    linkOrgs(incidentId, orgIds){
      var inc = this._incidents.find(i => i.id === incidentId);
      if(!inc) return;
      orgIds.forEach(oid => { if(!inc.orgIds.includes(oid)) inc.orgIds.push(oid); });
      inc.updatedAt = new Date().toISOString();
      this._log('关联机构', 'incident', incidentId, '机构数: ' + inc.orgIds.length);
      this._save();
    },

    linkAssets(incidentId, assetIds){
      var inc = this._incidents.find(i => i.id === incidentId);
      if(!inc) return;
      assetIds.forEach(aid => { if(!inc.assetIds.includes(aid)) inc.assetIds.push(aid); });
      inc.updatedAt = new Date().toISOString();
      this._log('关联资产', 'incident', incidentId, '资产数: ' + inc.assetIds.length);
      this._save();
    },

    /* 渲染指挥调度中心视图 */
    render(){
      var el = document.getElementById('view-command');
      if(!el) return;
      this._autoIntake();
      var html = this._renderDashboard();
      el.innerHTML = html;
      this._bindEvents(el);
    },

    /* ===== 自动接警（2026-08-14 用户指令：指挥调度中心要有真实内容）=====
     * 红色活跃预警：全部自动转指挥事件（Ⅰ级响应，不容漏接）；
     * 橙色活跃预警：按时间倒序自动接入，自动接警在办上限 20 件、单轮最多 8 件，
     * 超出部分留在"实时预警接入"面板人工一键转。
     * 只接 24h 内活跃预警；按 sourceId 去重；批量建案后一次性落库。 */
    _autoIntake(){
      try{
        if(typeof ALERTS === 'undefined' || !ALERTS.length) return;
        var now = Date.now();
        if(this._lastIntake && now - this._lastIntake < 60000) return;
        this._lastIntake = now;
        var me = this;
        var hot = ALERTS.filter(function(a){
          if(!a || a.status === 'resolved') return false;
          if(a.level !== 'red' && a.level !== 'orange') return false;
          var t = new Date(a.time || a.date || 0).getTime();
          if(t && (now - t) > 24*3600*1000) return false;
          return true;
        });
        if(!hot.length) return;
        hot.sort(function(a, b){
          if(a.level !== b.level) return a.level === 'red' ? -1 : 1;
          return String(b.time || '').localeCompare(String(a.time || ''));
        });
        var autoOpen = this._incidents.filter(function(i){ return i.autoIntake && i.status === 'open'; }).length;
        var created = 0;
        hot.forEach(function(a){
          if(created >= 8) return;
          var dup = me._incidents.some(function(i){ return i.sourceType === 'alert' && String(i.sourceId) === String(a.id); });
          if(dup) return;
          if(a.level !== 'red' && autoOpen >= 20) return; /* 橙色受自动接警上限约束，红色不受限 */
          var inc = me.createIncidentFromAlert(a, { auto: true, deferSave: true });
          if(inc){ created++; autoOpen++; }
        });
        if(created){
          this._log('自动接警', 'incident', '', '红/橙活跃预警自动转指挥事件 ' + created + ' 件');
          this._save();
        }
      }catch(e){}
    },

    /* 孤儿数据清理：事件被删/被清洗后，其工单/调度/会商记录不得残留 */
    _pruneOrphans(){
      var ids = {};
      this._incidents.forEach(function(i){ ids[i.id] = 1; });
      var before = this._workorders.length + this._dispatches.length + this._conferences.length;
      this._workorders = this._workorders.filter(function(w){ return !w.incidentId || ids[w.incidentId]; });
      this._dispatches = this._dispatches.filter(function(d){ return !d.incidentId || ids[d.incidentId]; });
      this._conferences = this._conferences.filter(function(c){ return !c.incidentId || ids[c.incidentId]; });
      var after = this._workorders.length + this._dispatches.length + this._conferences.length;
      if(after !== before) this._save();
    },

    _renderDashboard(){
      var now = new Date();
      var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
      var pending = this._incidents.filter(i => i.status === 'open');
      var processing = this._incidents.filter(i => i.status === 'processing');
      var closed = this._incidents.filter(i => i.status === 'closed');
      var todayNew = this._incidents.filter(i => {
        var d = i.createdAt ? i.createdAt.slice(0,10) : '';
        return d === todayStr;
      }).length;
      /* 逾期工单统计 */
      var nowTs = Date.now();
      var overdueWo = this._workorders.filter(function(w){
        if(w.status === 'done') return false;
        var due = new Date(w.createdAt).getTime() + (w.dueHours || 24)*3600000;
        return due < nowTs;
      });
      var pendingWo = this._workorders.filter(function(w){ return w.status !== 'done'; });
      /* 闭环指标：结案率 + 平均处置时长 */
      var closedInc = this._incidents.filter(function(i){ return i.status === 'closed'; });
      var closureRate = this._incidents.length ? Math.round(closedInc.length / this._incidents.length * 100) : 0;
      var avgHandle = 0;
      var withTime = closedInc.filter(function(i){ return i.createdAt && i.closedAt; });
      if (withTime.length) {
        avgHandle = Math.round(withTime.reduce(function(s, i){ return s + (new Date(i.closedAt) - new Date(i.createdAt)); }, 0) / withTime.length / 3600000 * 10) / 10;
      }

      /* ===== 威胁姿态判定（未来指挥环境核心：全中心一盏姿态灯） ===== */
      var active = pending.concat(processing);
      var worstLv = active.length ? Math.min.apply(null, active.map(function(i){ return i.level || 4; })) : 0;
      var posture = worstLv === 1 ? { t: 'Ⅰ级战备', c: '#ff3355', bg: 'rgba(255,51,85,0.12)' }
        : worstLv === 2 ? { t: 'Ⅱ级戒备', c: '#ff8800', bg: 'rgba(255,136,0,0.10)' }
        : worstLv === 3 ? { t: 'Ⅲ级关注', c: '#ffcc00', bg: 'rgba(255,204,0,0.08)' }
        : active.length ? { t: 'Ⅳ级常态', c: '#00d4ff', bg: 'rgba(0,212,255,0.08)' }
        : { t: '战备空置', c: '#00ff9f', bg: 'rgba(0,255,159,0.06)' };

      var html = '<div class="command-center">' +
        /* ===== 未来指挥头部带：姿态灯 + 实时时钟 + 指挥动作 ===== */
        '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px;padding:12px 16px;background:linear-gradient(135deg,rgba(0,212,255,0.06),rgba(124,58,237,0.06));border:1px solid var(--border);border-radius:10px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="position:relative;width:14px;height:14px;flex-shrink:0"><span style="position:absolute;inset:0;border-radius:50%;background:' + posture.c + ';opacity:.35;animation:cmdPulse 1.6s ease-out infinite"></span><span style="position:absolute;inset:3px;border-radius:50%;background:' + posture.c + '"></span></span>' +
            '<div><div style="font-size:16px;font-weight:800;color:var(--text1)">🎯 实战指挥调度中心</div>' +
            '<div style="font-size:10px;color:var(--text3);letter-spacing:1px">COMMAND &amp; CONTROL · 接警→立案→派发→处置→复盘 全链闭环</div></div>' +
          '</div>' +
          '<span style="font-size:12px;font-weight:800;padding:4px 14px;border-radius:5px;border:1px solid ' + posture.c + ';color:' + posture.c + ';background:' + posture.bg + '">' + posture.t + '</span>' +
          '<div style="text-align:right;margin-left:auto">' +
            '<div id="cmd-clock" style="font-size:19px;font-weight:800;color:var(--cyan);font-family:monospace;letter-spacing:2px">' + now.toTimeString().slice(0,8) + '</div>' +
            '<div style="font-size:10px;color:var(--text3)">北京时间 · ' + todayStr + ' 值班序列</div>' +
          '</div>' +
          '<div class="cmd-actions" style="display:flex;gap:7px;flex-wrap:wrap">' +
            '<button class="btn primary sm" onclick="COMMAND.openCreateModal()">+ 手工建案</button>' +
            '<button class="btn sm" style="background:linear-gradient(135deg,var(--red),#b91c1c);color:#fff;border:none" onclick="COMMAND._startJointResponse()">🚀 联合响应</button>' +
            '<button class="btn sm" onclick="COMMAND.render()">🔄 刷新</button>' +
            '<button class="btn sm" onclick="COMMAND.showAuditLog()">📝 审计</button>' +
            '<button class="btn sm" onclick="COMMAND.showPlaybookLibrary()">📖 预案库</button>' +
            '<button class="btn sm" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none" onclick="if(typeof GOVDOC!==\'undefined\')GOVDOC.open(\'command\')" title="按当前在案事件与工单资源，生成公文《指挥调度指令》">📄 公文</button>' +
          '</div>' +
        '</div>' +
        '<div class="stat-grid">' +
          this._renderStatCard('待处理事件', pending.length, 'b-yellow', 'clock') +
          this._renderStatCard('处置中', processing.length, 'b-blue', 'spin') +
          this._renderStatCard('已结案', closed.length, 'b-green', 'check') +
          this._renderStatCard('今日新增', todayNew, 'b-purple', 'plus') +
          this._renderStatCard('在办工单', pendingWo.length, 'b-blue', 'list') +
          this._renderStatCard('逾期工单', overdueWo.length, overdueWo.length?'b-yellow':'b-green', 'clock') +
          this._renderStatCard('处置闭环率', closureRate + '%', closureRate >= 80 ? 'b-green' : 'b-yellow', 'check') +
          this._renderStatCard('平均处置时长', avgHandle ? avgHandle + 'h' : '—', 'b-purple', 'clock') +
        '</div>' +
        /* ===== 第一行：警情接入流水 + 部门协同矩阵（均可交互） ===== */
        '<div style="display:grid;grid-template-columns:3fr 2fr;gap:12px;margin-bottom:12px">' +
          '<div class="card" style="margin:0;border:1px solid rgba(255,51,85,0.25)"><div class="card-tt" style="font-size:12px"><span class="ic">🚨</span>警情接入流水 <span style="font-size:10px;color:var(--text3);font-weight:400">红色自动接警 · 橙色限量接入 · 一键转指挥</span></div>' +
            '<div style="max-height:240px;overflow-y:auto">' + this._renderAlertIntake() + '</div></div>' +
          '<div class="card" style="margin:0"><div class="card-tt" style="font-size:12px"><span class="ic">🏛️</span>部门协同矩阵 <span style="font-size:10px;color:var(--text3);font-weight:400">点击部门条 → 该部工单清单</span></div>' +
            '<div style="max-height:240px;overflow-y:auto">' + this._renderDeptLoad() + '</div></div>' +
        '</div>' +
        /* ===== 第二行：作战指挥板（未来指挥环境核心重设计） ===== */
        '<div class="card" style="margin:0 0 12px 0;border:1px solid rgba(0,212,255,0.18)"><div class="card-tt" style="font-size:12px"><span class="ic">🎛️</span>作战指挥板 <span style="font-size:10px;color:var(--text3);font-weight:400">事件卡 = 等级色条 + T+计时 + 工单进度 + 卡上快捷指挥动作 · 点卡进详情</span></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' +
            this._renderKanbanCol('待处理', pending, 'var(--yellow)', 'open') +
            this._renderKanbanCol('处置中', processing, 'var(--cyan)', 'processing') +
            this._renderKanbanCol('已结案', closed.slice(0, 10), 'var(--green)', 'closed') +
          '</div></div>' +
        /* ===== 第三行：战备资源阵 + 应急联络 ===== */
        '<div style="display:grid;grid-template-columns:3fr 2fr;gap:12px;margin-bottom:12px">' +
          '<div class="card" style="margin:0"><div class="card-tt" style="font-size:12px"><span class="ic">🚁</span>战备资源阵 <span style="font-size:10px;color:var(--text3);font-weight:400">点击资源卡 → 向最高等级事件派出</span></div>' +
            this._renderResourceDesk() + '</div>' +
          '<div class="card" style="margin:0"><div class="card-tt" style="font-size:12px"><span class="ic">📞</span>应急联络 <span style="font-size:10px;color:var(--text3);font-weight:400">点击号码即复制</span></div>' +
            this._renderContacts() + '</div>' +
        '</div>' +
        /* ===== 全量事件列表（状态过滤 chips） ===== */
        '<div class="card cmd-table-panel">' +
          '<div class="card-tt"><span class="ic">🗃️</span> 全部指挥事件 <span style="font-size:10px;color:var(--text3);font-weight:400">行点击进详情</span>' +
          '<span style="margin-left:auto;display:flex;gap:6px">' +
            this._filterChip('all', '全部 ' + this._incidents.length) +
            this._filterChip('open', '待处理 ' + pending.length) +
            this._filterChip('processing', '处置中 ' + processing.length) +
            this._filterChip('closed', '已结案 ' + closed.length) +
          '</span></div>' +
          '<div class="table-wrap"><table class="cmd-table"><thead><tr>' +
            '<th>事件ID</th><th>标题</th><th>国家/地区</th><th>响应等级</th><th>状态</th><th>创建时间</th><th>工单进度</th><th>操作</th>' +
          '</tr></thead><tbody>' +
          (this._filteredIncidents().length ? this._filteredIncidents().map(i => this._renderIncidentRow(i)).join('') : this._renderEmptyRow()) +
          '</tbody></table></div>' +
        '</div>' +
      '</div>';
      this._tickClock();
      return html;
    },

    /* 实时时钟（渲染后启动，2.5s 间隔自刷，先清旧定时器防叠加） */
    _tickClock(){
      var me = this;
      if (this._clockT) { clearInterval(this._clockT); this._clockT = null; }
      this._clockT = setInterval(function(){
        var el = document.getElementById('cmd-clock');
        if (!el) { clearInterval(me._clockT); me._clockT = null; return; }
        el.textContent = new Date().toTimeString().slice(0,8);
      }, 1000);
    },
    /* 列表状态过滤 */
    _filterChip(key, label){
      var on = (this._listFilter || 'all') === key;
      return '<span onclick="COMMAND._setFilter(\'' + key + '\')" style="font-size:10.5px;padding:2px 10px;border-radius:10px;cursor:pointer;border:1px solid ' + (on ? 'var(--cyan)' : 'var(--border)') + ';color:' + (on ? 'var(--cyan)' : 'var(--text3)') + ';background:' + (on ? 'rgba(0,212,255,0.08)' : 'transparent') + '">' + label + '</span>';
    },
    _setFilter(key){ this._listFilter = key; this.render(); },
    _filteredIncidents(){
      var f = this._listFilter || 'all';
      if (f === 'all') return this._incidents;
      return this._incidents.filter(function(i){ return i.status === f; });
    },
    /* T+ 经过时间（未来指挥环境标配计时） */
    _elapsed(createdAt){
      var t = new Date(createdAt || 0).getTime();
      if (!t) return '—';
      var m = Math.max(0, Math.floor((Date.now() - t) / 60000));
      if (m < 60) return 'T+' + m + 'm';
      var h = Math.floor(m / 60);
      if (h < 24) return 'T+' + h + 'h' + (m % 60 ? (m % 60) + 'm' : '');
      return 'T+' + Math.floor(h / 24) + 'd' + (h % 24 ? (h % 24) + 'h' : '');
    },
    /* 事件工单进度（x/y 完成） */
    _woProgress(inc){
      var ids = inc.workorderIds || [];
      if (!ids.length) return { done: 0, total: 0, pct: 0 };
      var me = this;
      var done = ids.filter(function(id){
        var w = me._workorders.find(function(x){ return x.id === id; });
        return w && w.status === 'done';
      }).length;
      return { done: done, total: ids.length, pct: Math.round(done / ids.length * 100) };
    },

    /* 实时预警接入：红/橙活跃预警 → 一键转指挥事件 */
    _renderAlertIntake(){
      try{
        if(typeof ALERTS === 'undefined') return '<div class="cmd-empty">预警数据未加载</div>';
        var me = this;
        var now = Date.now();
        var all = ALERTS.filter(function(a){ return (a.level === 'red' || a.level === 'orange') && a.status !== 'resolved'; });
        var fresh = all.filter(function(a){
          var t = new Date(a.time || a.date || 0).getTime();
          return !t || (now - t) <= 24*3600*1000;
        });
        var redN = fresh.filter(function(a){ return a.level === 'red'; }).length;
        var orN = fresh.length - redN;
        var linked = fresh.filter(function(a){
          return me._incidents.some(function(i){ return i.sourceType === 'alert' && String(i.sourceId) === String(a.id); });
        }).length;
        var summary = '<div style="display:flex;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);font-size:10px;color:var(--text2);background:rgba(255,51,85,0.05)">' +
          '<span>🔴 红色 <b style="color:var(--red)">' + redN + '</b></span>' +
          '<span>🟠 橙色 <b style="color:var(--orange)">' + orN + '</b></span>' +
          '<span>✅ 已接入 <b style="color:var(--green)">' + linked + '</b></span>' +
          '<span style="margin-left:auto;color:var(--text3)">红色自动接警 · 橙色限量自动接入</span></div>';
        if(!fresh.length){
          var staleN = all.length;
          return summary + '<div class="cmd-empty" style="padding:16px">当前无 24h 内红/橙级活跃预警' + (staleN ? '（另有 ' + staleN + ' 条超时未消警，已在预警中心归档口径外）' : '') + '</div>';
        }
        var hot = fresh.slice(0, 20);
        return summary + hot.map(function(a){
          var lvColor = a.level === 'red' ? 'var(--red)' : 'var(--orange)';
          var already = me._incidents.some(function(i){ return i.sourceType === 'alert' && String(i.sourceId) === String(a.id); });
          return '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border)">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + lvColor + ';flex-shrink:0"></span>' +
            '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:600;color:var(--text1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(a.title || '') + '</div>' +
            '<div style="font-size:9px;color:var(--text3)">' + (a.country || '全球') + ' · ' + (a.time || '') + '</div></div>' +
            (already
              ? '<span style="font-size:9px;color:var(--green);flex-shrink:0">✓ 已建案</span>'
              : '<button class="btn sm" style="font-size:9px;padding:2px 8px;flex-shrink:0" onclick="convertAlertToIncident(\'' + String(a.id).replace(/'/g, '') + '\')">⚡ 转指挥</button>') +
          '</div>';
        }).join('') + (fresh.length > 20 ? '<div style="padding:6px 10px;font-size:10px;color:var(--text3);text-align:center">… 其余 ' + (fresh.length - 20) + ' 条见预警中心</div>' : '');
      }catch(e){ return '<div class="cmd-empty">预警接入异常</div>'; }
    },

    /* 部门协同矩阵（可交互：点击部门条 → 该部在办工单清单弹窗，可直接完成工单） */
    _renderDeptLoad(){
      var load = {};
      this._workorders.forEach(function(w){
        if(w.status === 'done') return;
        load[w.dept] = (load[w.dept] || 0) + 1;
      });
      var keys = Object.keys(load).sort(function(a, b){ return load[b] - load[a]; });
      if(!keys.length) return '<div class="cmd-empty" style="padding:16px">暂无在办工单 · 各部门值守中</div>';
      var max = load[keys[0]] || 1;
      return keys.map(function(d){
        var pct = Math.round(load[d] / max * 100);
        var hot = load[d] >= 10;
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;border-radius:5px" onmouseover="this.style.background=\'rgba(0,212,255,0.06)\'" onmouseout="this.style.background=\'transparent\'" onclick="COMMAND._deptWoModal(\'' + d + '\')" title="点击查看 ' + (DEPT_NAMES[d] || d) + ' 在办工单">' +
          '<span style="width:88px;font-size:11px;color:var(--text2)">' + (DEPT_NAMES[d] || d) + '</span>' +
          '<div style="flex:1;height:12px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,' + (hot ? 'rgba(255,51,85,0.45),rgba(255,51,85,0.85)' : 'rgba(0,212,255,0.4),rgba(0,212,255,0.85)') + ');border-radius:3px"></div></div>' +
          '<span style="width:28px;font-size:11px;font-weight:700;color:' + (hot ? 'var(--red)' : 'var(--cyan)') + ';text-align:right">' + load[d] + '</span></div>';
      }).join('');
    },

    /* 部门在办工单清单弹窗（矩阵点击落点：可完成/重启工单，直达事件详情） */
    _deptWoModal(dept){
      var me = this;
      var wos = this._workorders.filter(function(w){ return w.dept === dept && w.status !== 'done'; });
      var overlay = document.createElement('div');
      overlay.className = 'cmd-modal-overlay';
      var rows = wos.map(function(w){
        var inc = me._incidents.find(function(i){ return i.id === w.incidentId; });
        var due = new Date(w.createdAt).getTime() + (w.dueHours || 24)*3600000;
        var overdue = due < Date.now();
        var stTxt = w.status === 'processing' ? '<span style="color:var(--cyan)">进行中</span>' : '<span style="color:var(--yellow)">待办</span>';
        return '<div style="border:1px solid var(--border);border-left:3px solid ' + (overdue ? 'var(--red)' : 'var(--cyan)') + ';border-radius:6px;padding:9px 11px;margin-bottom:7px;background:var(--bg2)">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="flex:1;font-size:12px;font-weight:600;color:var(--text1)">' + _esc(w.title || w.task || '工单') + '</span>' + stTxt +
            (overdue ? '<span style="font-size:9.5px;color:var(--red)">⚠ 逾期</span>' : '') +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:10px;color:var(--text3)">' +
            '<span>' + _esc(w.id) + '</span><span>关联 ' + _esc(w.incidentId || '—') + '</span><span>时限 ' + (w.dueHours || 24) + 'h</span>' +
            '<span style="margin-left:auto;display:flex;gap:5px">' +
              (inc ? '<button class="btn sm" style="font-size:9.5px;padding:2px 9px" onclick="COMMAND.openIncidentDetail(\'' + inc.id + '\')">事件详情</button>' : '') +
              '<button class="btn sm" style="font-size:9.5px;padding:2px 9px;background:rgba(0,255,159,0.10);border-color:var(--green);color:var(--green)" onclick="COMMAND._promptDone(\'' + w.id + '\')">✅ 完成</button>' +
            '</span>' +
          '</div></div>';
      }).join('');
      overlay.innerHTML = '<div class="cmd-modal" style="max-width:640px"><div class="cmd-modal-hd"><h3>🏛️ ' + (DEPT_NAMES[dept] || dept) + ' · 在办工单（' + wos.length + '）</h3>' +
        '<button class="cmd-modal-close" onclick="this.closest(\'.cmd-modal-overlay\').remove()">×</button></div>' +
        '<div style="padding:14px 16px;max-height:60vh;overflow-y:auto">' +
        (rows || '<div style="color:var(--text3);font-size:12px;padding:10px 0">该部门当前无在办工单</div>') +
        '</div></div>';
      overlay.addEventListener('click', function(e){ if(e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    },

    /* ===== 作战指挥板泳道列（2026-09-05 用户指令三：死面板 → 未来指挥环境）=====
     * 每张事件卡是独立的微型指挥单元：
     *   等级色条 + T+计时 + 工单进度条 + 卡上快捷指挥动作（开始处置/会商/调度/结案，按状态出），
     *   点卡体进完整详情；空列显示战备值守语而非冷冰冰「暂无事件」。 */
    _renderKanbanCol(title, list, color, statusKey){
      var MAX_SHOW = 12;
      var me = this;
      var shown = list.slice(0, MAX_SHOW);
      var stIcon = statusKey === 'open' ? '⏳' : statusKey === 'processing' ? '⚙️' : '✅';
      var html = '<div style="background:var(--bg2);border:1px solid var(--border);border-top:2px solid ' + color + ';border-radius:8px;min-height:150px">' +
        '<div style="padding:8px 10px;font-size:11px;font-weight:700;color:' + color + ';border-bottom:1px solid var(--border);display:flex;align-items:center;gap:7px">' +
          '<span>' + stIcon + '</span><span>' + title + '</span>' +
          '<span style="background:' + color + '22;border:1px solid ' + color + '55;border-radius:9px;padding:0 8px;font-size:10px">' + list.length + '</span>' +
          (statusKey === 'processing' && list.length ? '<span style="font-size:9px;color:var(--text3);font-weight:400;margin-left:auto">处置中事件持续计时</span>' : '') +
        '</div>' +
        '<div style="padding:6px;display:flex;flex-direction:column;gap:7px;max-height:330px;overflow-y:auto">';
      if(!list.length){
        html += '<div style="text-align:center;padding:20px 8px">' +
          '<div style="font-size:22px;opacity:.5">' + (statusKey === 'open' ? '🛰️' : statusKey === 'processing' ? '🎯' : '🏁') + '</div>' +
          '<div style="color:var(--text3);font-size:11px;margin-top:5px">' + (statusKey === 'open' ? '战备空置 · 警情流水持续接入' : statusKey === 'processing' ? '无在办事件 · 从待处理列发起处置' : '尚无结案 · 处置闭环后归档于此') + '</div></div>';
      }
      shown.forEach(function(i){
        var lv = RESPONSE_LEVELS.find(function(r){ return r.level === i.level; }) || RESPONSE_LEVELS[2];
        var prog = me._woProgress(i);
        var el = me._elapsed(i.createdAt);
        /* 卡上快捷指挥动作：按状态出，stopPropagation 防穿透到详情 */
        var acts = '';
        if (statusKey === 'open') {
          acts = '<button class="btn sm" style="font-size:9.5px;padding:2px 9px;background:rgba(0,212,255,0.12);border-color:var(--cyan);color:var(--cyan)" onclick="event.stopPropagation();COMMAND.startProcessing(\'' + i.id + '\')">▶ 处置</button>' +
            '<button class="btn sm" style="font-size:9.5px;padding:2px 9px" onclick="event.stopPropagation();COMMAND._openDispatchForm(\'' + i.id + '\',\'\')">🚁 调度</button>' +
            '<button class="btn sm" style="font-size:9.5px;padding:2px 9px" onclick="event.stopPropagation();COMMAND._openConferenceForm(\'' + i.id + '\')">📞 会商</button>';
        } else if (statusKey === 'processing') {
          acts = '<button class="btn sm" style="font-size:9.5px;padding:2px 9px;background:rgba(0,255,159,0.10);border-color:var(--green);color:var(--green)" onclick="event.stopPropagation();COMMAND._promptClose(\'' + i.id + '\')">✅ 结案</button>' +
            '<button class="btn sm" style="font-size:9.5px;padding:2px 9px" onclick="event.stopPropagation();COMMAND._openDispatchForm(\'' + i.id + '\',\'\')">🚁 调度</button>' +
            '<button class="btn sm" style="font-size:9.5px;padding:2px 9px" onclick="event.stopPropagation();COMMAND._openConferenceForm(\'' + i.id + '\')">📞 会商</button>';
        } else {
          acts = '<button class="btn sm" style="font-size:9.5px;padding:2px 9px" onclick="event.stopPropagation();COMMAND.reopenIncident(\'' + i.id + '\')">🔄 重启</button>';
        }
        html += '<div style="background:var(--panel2);border:1px solid var(--border);border-left:3px solid ' + lv.color + ';border-radius:7px;padding:9px 10px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor=\'' + lv.color + '\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.borderLeftColor=\'' + lv.color + '\'" onclick="COMMAND.openIncidentDetail(\'' + i.id + '\')">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span class="badge b-' + lv.code + '" style="font-size:9px">' + lv.name.split('（')[0] + '</span>' +
            (i.autoIntake ? '<span style="font-size:9px;color:var(--purple)">自动接警</span>' : '') +
            '<span style="font-size:9.5px;color:var(--cyan);font-family:monospace;margin-left:auto" title="接警至今经过时间">' + el + '</span>' +
          '</div>' +
          '<div style="font-size:11.5px;font-weight:600;color:var(--text1);line-height:1.45;margin-top:5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + _esc(i.title) + '</div>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:5px;font-size:9.5px;color:var(--text3)">' +
            '<span>📍' + _esc(i.country || '—') + '</span>' +
            '<span style="margin-left:auto">📋' + prog.done + '/' + prog.total + '</span>' +
          '</div>' +
          (prog.total ? '<div style="height:3.5px;background:var(--bg);border-radius:2px;margin-top:5px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.max(4, prog.pct) + '%;background:' + (prog.pct >= 100 ? 'var(--green)' : 'var(--cyan)') + ';border-radius:2px"></span></div>' : '') +
          '<div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">' + acts + '</div>' +
        '</div>';
      });
      if(list.length > MAX_SHOW){
        html += '<div style="text-align:center;color:var(--text3);font-size:10px;padding:6px 0">… 其余 ' + (list.length - MAX_SHOW) + ' 件见下方全量列表</div>';
      }
      html += '</div></div>';
      return html;
    },

    /* 战备资源阵：资源卡整卡可点（向最高等级事件派出），状态脉冲点，实时反映派出批次 */
    _renderResourceDesk(){
      var icons = { medical:'🚑', security:'🛡️', transport:'🚗', comm:'📡', air:'✈️' };
      var res = this._resources && this._resources.length ? this._resources : DEFAULT_RESOURCES;
      var dispatches = this._dispatches || [];
      var me = this;
      var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:8px;padding:4px">' +
        res.map(function(r){
          var outN = dispatches.filter(function(d){ return d.resourceId === r.id && d.status === '派出中'; }).length;
          var st = RES_STATUS[r.status] || RES_STATUS.available;
          var statusTxt = outN > 0 ? '派出 ' + outN + ' 批' : st.label;
          var statusColor = outN > 0 ? 'var(--orange)' : st.color;
          return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor=\'var(--cyan)\'" onmouseout="this.style.borderColor=\'var(--border)\'" onclick="COMMAND._dispatchToActive(\'' + r.type + '\')" title="点击 → 向最高等级待处理事件派出该资源">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:12px">' + (icons[r.type] || '📦') + ' <b>' + _esc(r.name) + '</b></span><span style="font-size:10px;color:var(--cyan)">' + _esc(r.count || '') + '</span></div>' +
            '<div style="font-size:9px;color:var(--text3);margin-bottom:3px">' + _esc(r.contact || '') + '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;font-size:9px;color:' + statusColor + '">' +
              '<span style="width:6px;height:6px;border-radius:50%;background:' + statusColor + ';box-shadow:0 0 5px ' + statusColor + '"></span>' + statusTxt +
              '<span style="margin-left:auto;color:var(--text3)">点击派出 →</span></div>' +
          '</div>';
        }).join('') + '</div>';
      /* 最近调度记录（真实，来自 _dispatches，新的在前） */
      var recent = dispatches.slice(0, 4);
      if(recent.length){
        html += '<div style="padding:2px 6px 6px;font-size:10px;color:var(--text3)">最近调度：</div>' +
          recent.map(function(d){
            var stColor = d.status === '抵达' ? 'var(--green)' : d.status === '撤回' ? 'var(--text3)' : 'var(--orange)';
            return '<div style="display:flex;gap:8px;align-items:center;padding:4px 10px;font-size:10px;border-top:1px dashed var(--border)">' +
              '<span style="color:' + stColor + '">● ' + _esc(d.status || '派出中') + '</span>' +
              '<span style="color:var(--text1);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(d.resourceName) + ' × ' + _esc(d.qty || '') + (d.destination ? ' → ' + _esc(d.destination) : '') + '</span>' +
              '<span style="color:var(--text3)">' + String(d.time || '').slice(5, 16).replace('T', ' ') + '</span></div>';
          }).join('');
      }
      return html;
    },

    /* 调度资源到最高等级待处理事件（打开调度表单，用户自行填写） */
    _dispatchToActive(type){
      var open = this._incidents.filter(function(i){ return i.status !== 'closed'; })
        .sort(function(a, b){ return a.level - b.level; });
      if(!open.length){ showToast('当前无待处置事件，请先建案或转指挥事件'); return; }
      /* 按类型预选资源 */
      var r = (this._resources || []).find(function(x){ return x.type === type; });
      this._openDispatchForm(open[0].id, r ? r.id : '');
    },

    /* 应急联络（点击号码即复制，一键对最高等级事件发起会商） */
    _renderContacts(){
      var html = '<div style="display:flex;flex-direction:column;gap:6px;padding:4px">';
      this._contacts.forEach(function(c){
        html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor=\'var(--cyan)\'" onmouseout="this.style.borderColor=\'var(--border)\'" onclick="COMMAND._copyPhone(this,\'' + _esc(c.phone).replace(/'/g, '') + '\')" title="点击复制号码">' +
          '<span style="font-size:14px">📞</span>' +
          '<div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:600;color:var(--text1)">' + _esc(c.name) + '</div>' +
          '<div style="font-size:9px;color:var(--text3)">' + _esc(c.role) + ' · ' + _esc(c.channel) + '</div></div>' +
          '<span style="font-size:10px;color:var(--cyan);font-family:monospace">' + _esc(c.phone) + '</span></div>';
      });
      html += '<button class="btn sm" style="font-size:10px;margin-top:4px" onclick="COMMAND._conferenceActive()">📞 对最高等级事件发起多部门会商</button></div>';
      return html;
    },
    _copyPhone(el, phone){
      var done = function(){
        if (typeof showToast === 'function') showToast('号码已复制：' + phone);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(phone).then(done, done);
      else { var ta = document.createElement('textarea'); ta.value = phone; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch(e){} ta.remove(); done(); }
    },

    _conferenceActive(){
      var open = this._incidents.filter(function(i){ return i.status !== 'closed'; })
        .sort(function(a, b){ return a.level - b.level; });
      if(!open.length){ showToast('当前无待处置事件'); return; }
      this._openConferenceForm(open[0].id);
    },

    _renderStatCard(label, value, cls, icon){
      var icons = { clock:'⏳', spin:'🔄', check:'✅', plus:'➕', list:'📋', medical:'🚑', shield:'🛡️' };
      return '<div class="stat-card">' +
        '<div class="stat-ic" style="background:' + (cls==='b-yellow'?'rgba(255,204,0,0.1)':cls==='b-blue'?'rgba(0,212,255,0.1)':cls==='b-green'?'rgba(0,255,159,0.1)':'rgba(179,102,255,0.1)')+';color:var('+(cls==='b-yellow'?'--yellow':cls==='b-blue'?'--cyan':cls==='b-green'?'--green':'--purple')+')">' + (icons[icon]||'•') + '</div>' +
        '<div class="stat-info"><div class="stat-label">' + label + '</div><div class="stat-val">' + value + '</div></div>' +
      '</div>';
    },

    _renderEmptyRow(){
      return '<tr class="empty-row"><td colspan="8"><div class="cmd-empty">' +
        '<div>暂无指挥事件，请从预警详情转指挥事件或手工建案</div>' +
      '</div></td></tr>';
    },

    _renderIncidentRow(i){
      var lv = RESPONSE_LEVELS.find(r => r.level === i.level) || RESPONSE_LEVELS[2];
      var st = INC_STATUS[i.status] || INC_STATUS.open;
      var stat = this._woProgress(i);
      var progressPct = stat.total ? Math.round(stat.done / stat.total * 100) : 0;
      return '<tr data-id="' + i.id + '" onclick="COMMAND.openIncidentDetail(\'' + i.id + '\')">' +
        '<td><span style="font-family:Courier New,monospace;color:var(--text3)">' + i.id + '</span></td>' +
        '<td><b>' + _esc(i.title) + '</b></td>' +
        '<td>' + (i.country || '—') + '</td>' +
        '<td><span class="badge b-' + lv.code + '">' + lv.name + '</span></td>' +
        '<td><span class="badge ' + st.cls + '">' + st.label + '</span></td>' +
        '<td style="color:var(--text2)">' + this._fmtTime(i.createdAt) + '</td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:11px;color:var(--text2)">' + stat.done + '/' + stat.total + '</span>' +
            '<div class="risk-bar" style="width:70px"><div class="risk-bar-fill" style="width:' + progressPct + '%;background:' + (progressPct===100?'var(--green)':'var(--cyan)') + '"></div></div>' +
          '</div>' +
        '</td>' +
        '<td><button class="btn sm" onclick="event.stopPropagation();COMMAND.openIncidentDetail(\'' + i.id + '\')">详情</button></td>' +
      '</tr>';
    },

    _woProgress(inc){
      var total = inc.workorderIds.length;
      var done = 0;
      inc.workorderIds.forEach(wid => {
        var w = this._workorders.find(x => x.id === wid);
        if(w && w.status === 'done') done++;
      });
      return { done: done, total: total };
    },

    _fmtTime(iso){
      if(!iso) return '—';
      try { return new Date(iso).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }); }
      catch(e){ return iso; }
    },

    _fmtDateTime(iso){
      if(!iso) return '—';
      try { return new Date(iso).toLocaleString('zh-CN'); }
      catch(e){ return iso; }
    },

    _dueText(wo){
      if(!wo.createdAt) return '—';
      var due = new Date(new Date(wo.createdAt).getTime() + (wo.dueHours || 24)*3600000);
      var text = due.toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      if(wo.status === 'done') return text;
      if(due < new Date()) return '<span style="color:var(--red)">已逾期 ' + text + '</span>';
      return '<span style="color:var(--text2)">' + text + '</span>';
    },

    _bindEvents(el){
      // 主要交互通过内联 onclick 处理，此处保留扩展入口
    },

    _promptDone(woId){
      var fb = prompt('请输入完成反馈：');
      if(fb === null) return;
      this.updateWorkorderStatus(woId, 'done', fb);
      this.render();
      var wo = this._workorders.find(w => w.id === woId);
      if(wo && wo.incidentId){ this.openIncidentDetail(wo.incidentId); }
    },

    _promptClose(incidentId){
      var result = prompt('请输入结案结论：');
      if(result === null) return;
      this.closeIncident(incidentId, result);
    },

    _promptAddNote(incidentId){
      var note = prompt('请输入备注内容：');
      if(note){ this.addIncidentNote(incidentId, note); }
    },

    _promptAddWorkorder(incidentId){
      var title = prompt('工单标题：');
      if(!title) return;
      var dept = prompt('负责部门代码（如 mfa/mps/mofcom/enterprise）：') || 'mfa';
      var hours = parseInt(prompt('截止小时数：') || '24', 10);
      var inc = this._incidents.find(i => i.id === incidentId);
      this.addWorkorder(incidentId, { title: title, dept: dept, dueHours: hours, priority: inc ? inc.level : 3 });
      this.render();
      this.openIncidentDetail(incidentId);
    },

    openIncidentDetail(id){
      var inc = this._incidents.find(i => i.id === id);
      if(!inc) return;
      this._currentIncident = inc;
      var old = document.getElementById('cmd-detail-overlay');
      if(old) old.remove();
      var overlay = document.createElement('div');
      overlay.className = 'cmd-modal-overlay';
      overlay.id = 'cmd-detail-overlay';
      overlay.innerHTML = '<div class="cmd-modal">' + this._renderDetailContent(inc) + '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e){ if(e.target === overlay){ overlay.remove(); } });
    },

    _closeDetail(){
      var old = document.getElementById('cmd-detail-overlay');
      if(old) old.remove();
    },

    _renderDetailContent(inc){
      var lv = RESPONSE_LEVELS.find(r => r.level === inc.level) || RESPONSE_LEVELS[2];
      var st = INC_STATUS[inc.status] || INC_STATUS.open;
      var stat = this._woProgress(inc);

      var statusActions = '';
      if(inc.status === 'open'){
        statusActions += '<button class="btn primary sm" onclick="COMMAND.startProcessing(\'' + inc.id + '\')">🚀 开始处置</button>';
      }
      if(inc.status === 'open' || inc.status === 'processing'){
        statusActions += '<button class="btn primary sm" onclick="COMMAND._promptClose(\'' + inc.id + '\')">✅ 结案</button>';
      }
      if(inc.status === 'closed'){
        statusActions += '<button class="btn sm" onclick="COMMAND.reopenIncident(\'' + inc.id + '\')">🔄 重启</button>';
      }

      var sourceInfo = '手工录入';
      if(inc.sourceType === 'alert' && inc.sourceId){
        sourceInfo = '来源预警 <span style="font-family:Courier New,monospace">' + inc.sourceId + '</span>';
      }

      var html = '' +
        '<div class="cmd-modal-hd">' +
          '<h3>📁 事件详情：' + _esc(inc.title) + '</h3>' +
          '<button class="cmd-modal-close" onclick="COMMAND._closeDetail()">×</button>' +
        '</div>' +
        '<div class="cmd-modal-bd">' +
          '<div class="cmd-section">' +
            '<h4>📝 基本信息</h4>' +
            '<div class="cmd-info-grid">' +
              '<div class="cmd-info-item wide"><div class="lb">事件标题</div><div class="vl">' + _esc(inc.title) + '</div></div>' +
              '<div class="cmd-info-item"><div class="lb">国家/地区</div><div class="vl">' + (inc.country || '—') + '</div></div>' +
              '<div class="cmd-info-item"><div class="lb">响应等级</div><div class="vl"><span class="badge b-' + lv.code + '">' + lv.name + '</span></div></div>' +
              '<div class="cmd-info-item"><div class="lb">当前状态</div><div class="vl"><span class="badge ' + st.cls + '">' + st.label + '</span></div></div>' +
              '<div class="cmd-info-item"><div class="lb">来源</div><div class="vl">' + sourceInfo + '</div></div>' +
              '<div class="cmd-info-item"><div class="lb">创建时间</div><div class="vl">' + this._fmtDateTime(inc.createdAt) + '</div></div>' +
              '<div class="cmd-info-item"><div class="lb">工单进度</div><div class="vl">' + stat.done + ' / ' + stat.total + ' 已完成</div></div>' +
              '<div class="cmd-info-item wide"><div class="lb">负责部门</div><div class="vl">' + (inc.assignedDepts || []).map(d => DEPT_NAMES[d] || d).join('、') + '</div></div>' +
            '</div>' +
            this._descBlockHTML(inc.desc) +
            '<div class="cmd-actions-row">' + statusActions +
              '<button class="btn sm" onclick="COMMAND._promptAddNote(\'' + inc.id + '\')">📝 添加备注</button>' +
              '<button class="btn sm" onclick="COMMAND._promptAddWorkorder(\'' + inc.id + '\')">➕ 生成新工单</button>' +
            '</div>' +
          '</div>' +
          '<div class="cmd-section">' +
            '<h4>📖 匹配应急预案</h4>' +
            this._renderMatchedPlaybooks(inc) +
          '</div>' +
          '<div class="cmd-section">' +
            '<h4>🔧 行动工单</h4>' +
            this._renderWorkorderTable(inc) +
          '</div>' +
          '<div class="cmd-section">' +
            '<h4>🗺️ 态势标绘</h4>' +
            this._renderMapSection(inc) +
          '</div>' +
          '<div class="cmd-section">' +
            '<h4>🚁 资源调度与会商</h4>' +
            this._renderResourceSection(inc) +
          '</div>' +
          '<div class="cmd-section">' +
            '<h4>📜 处置时间线 / 审计</h4>' +
            this._renderTimeline(inc.id) +
          '</div>' +
          (inc.notes ? '<div class="cmd-section"><h4>🗒️ 备注</h4><div class="cmd-desc" style="white-space:pre-wrap">' + _esc(inc.notes) + '</div></div>' : '') +
        '</div>';
      return html;
    },

    /* HTML 清洗（2026-09-05 一类问题根治）：两轮实体反转义（&amp;lt; 双重转义→<）→ 剥标签 → 清尾部截断残标签（<fo…无闭合） */
    _stripHtml(s){
      var t = String(s || '');
      for(var i = 0; i < 2; i++){
        t = t.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
      }
      return t.replace(/<[^>]+>/g, ' ').replace(/<[a-zA-Z][^>]*$/, ' ').replace(/\s+/g, ' ').trim();
    },

    /* 事件描述结构化：研判说明段 + 「样例：」后的条目逐条编号列表（消灭文字墙 2026-09-05） */
    _descBlockHTML(desc){
      var clean = this._stripHtml(desc);
      if(!clean) return '<div class="cmd-desc mt-12">暂无描述</div>';
      var parts = clean.split(/样例[:：]/);
      var html = '<div class="cmd-desc mt-12"><div class="cmd-desc-lead">' + _esc(parts[0].trim()) + '</div>';
      if(parts.length > 1){
        var samples = parts.slice(1).join('；').split(/[；;]\s*|\s+-\s+/)
          .map(function(s){ return s.trim().replace(/^[、，。\s]+/, ''); })
          .filter(function(s){ return s.length >= 6; });
        if(samples.length){
          html += '<ul class="cmd-samples">' + samples.map(function(s, i){
            return '<li data-i="' + ('0' + (i + 1)).slice(-2) + '">' + _esc(s) + '</li>';
          }).join('') + '</ul>';
        }
      }
      return html + '</div>';
    },

    _renderMatchedPlaybooks(inc){
      if(!inc.playbookIds || !inc.playbookIds.length){
        return '<div class="cmd-empty">未匹配到应急预案，将使用通用处置流程生成工单</div>';
      }
      var html = '';
      inc.playbookIds.forEach(pid => {
        var p = this._playbooks.find(x => x.id === pid);
        if(!p) return;
        html += this._playbookCardHTML(p, true);
      });
      return html;
    },

    /* 预案卡（详情匹配/预案库共用 2026-09-05）：触发词 chips + 处置步骤可展开 */
    _playbookCardHTML(p, withSteps){
      return '<div class="cmd-playbook-card">' +
        '<h5>' + _esc(p.name) + '</h5>' +
        '<div class="cmd-playbook-meta">' + _esc(p.category) + ' · 责任部门：' + p.dept.map(d => DEPT_NAMES[d] || d).join('、') + '</div>' +
        '<ul class="cmd-playbook-list">' +
          '<li><span class="cmd-playbook-label">触发词</span><span class="cmd-tags">' + (p.trigger && p.trigger.length ? p.trigger.slice(0, 12).map(function(t){ return '<span class="cmd-tag">' + _esc(t) + '</span>'; }).join('') + (p.trigger.length > 12 ? '<span class="cmd-tag">+' + (p.trigger.length - 12) + '</span>' : '') : '—') + '</span></li>' +
          '<li><span class="cmd-playbook-label">处置步骤</span><span>' + p.steps.length + ' 步</span></li>' +
          '<li><span class="cmd-playbook-label">联系人</span><span>' + (p.contacts || []).join('、') + '</span></li>' +
          '<li><span class="cmd-playbook-label">资源</span><span>' + (p.resources || []).join('、') + '</span></li>' +
        '</ul>' +
        (withSteps && p.steps && p.steps.length ?
          '<details class="cmd-pb-steps"><summary>▶ 展开 ' + p.steps.length + ' 步处置流程</summary><ol>' +
            p.steps.map(function(s){ return '<li>' + _esc(s) + '</li>'; }).join('') +
          '</ol></details>' : '') +
      '</div>';
    },

    _renderWorkorderTable(inc){
      var wos = this._workorders.filter(w => w.incidentId === inc.id);
      if(!wos.length){
        return '<div class="cmd-empty">暂无工单</div>';
      }
      var html = '<table class="cmd-wo-table"><thead><tr>' +
        '<th>状态</th><th>工单标题</th><th>负责部门/人</th><th>截止时间</th><th>操作</th>' +
      '</tr></thead><tbody>';
      wos.forEach(w => {
        var wst = WO_STATUS[w.status] || WO_STATUS.pending;
        var deptName = DEPT_NAMES[w.dept] || w.dept;
        var actions = '';
        if(w.status !== 'done'){
          actions += '<button class="btn sm" onclick="COMMAND._promptDone(\'' + w.id + '\')">✅ 完成</button>';
        } else {
          actions += '<button class="btn sm" onclick="COMMAND.updateWorkorderStatus(\'' + w.id + '\', \'pending\', \'\');COMMAND.openIncidentDetail(\'' + inc.id + '\')">🔄 重启</button>';
        }
        html += '<tr>' +
          '<td><span class="badge ' + wst.cls + '">' + wst.label + '</span></td>' +
          '<td>' + _esc(w.title) + (w.feedback ? '<div style="font-size:11px;color:var(--text2);margin-top:4px">反馈：' + _esc(w.feedback) + '</div>' : '') + '</td>' +
          '<td>' + deptName + (w.assignedTo ? ' / ' + _esc(w.assignedTo) : '') + '</td>' +
          '<td>' + this._dueText(w) + '</td>' +
          '<td>' + actions + '</td>' +
        '</tr>';
      });
      html += '</tbody></table>';
      return html;
    },

    _renderMapSection(inc){
      var lat=parseFloat(inc.location&&inc.location.lat)||0;
      var lon=parseFloat(inc.location&&inc.location.lon)||0;
      var hasCoord=lat!==0||lon!==0;
      var mapId='cmd-map-'+inc.id.replace(/[^a-zA-Z0-9]/g,'_');
      var html='<div id="'+mapId+'" style="width:100%;height:260px;border-radius:8px;border:1px solid var(--border);background:var(--bg2)"></div>'+
        '<div style="display:flex;gap:10px;margin-top:8px;font-size:11px;color:var(--text2);flex-wrap:wrap">'+
        '<span>📍 '+(inc.location&&inc.location.name?_esc(inc.location.name):(inc.country||'未知位置'))+'</span>'+
        '<span>🌐 '+(hasCoord?lat.toFixed(4)+', '+lon.toFixed(4):'无精确坐标')+'</span>'+
        '</div>';
      setTimeout(function(){
        var el=document.getElementById(mapId);
        if(!el||!window.L)return;
        try{
          var center=hasCoord?[lat,lon]:[20,0];
          var zoom=hasCoord?10:2;
          var map=L.map(mapId,{zoomControl:false,attributionControl:false}).setView(center,zoom);
          /* 天地图街道底图（2026-08-14 用户密钥，合规白名单内）；失败自动回退本地矢量底图 */
          el.style.background='#070d18';
          if(typeof TDT_BASEMAP!=='undefined'){ TDT_BASEMAP.addTo(map,'street'); }
          else if(typeof LOCAL_BASEMAP!=='undefined'){ LOCAL_BASEMAP.addTo(map); }
          if(hasCoord){
            L.marker([lat,lon]).addTo(map).bindPopup('<b>'+_esc(inc.title)+'</b><br>'+(inc.country||'')).openPopup();
          }
        }catch(e){console.warn('[cmd-map]',e);}
      },100);
      return html;
    },
    /* ===== 资源调度与会商（2026-08-14 重设计：资源可管理、调度/会商有表单有记录）===== */
    _renderResourceSection(inc){
      var me = this;
      var res = this._resources || [];
      var dispatches = (this._dispatches || []).filter(function(d){ return d.incidentId === inc.id; });
      var confs = (this._conferences || []).filter(function(c){ return c.incidentId === inc.id; });

      /* 资源卡：显示状态，可单独派出 */
      var cardsHtml = res.map(function(r){
        var st = RES_STATUS[r.status] || RES_STATUS.available;
        var used = dispatches.filter(function(d){ return d.resourceId === r.id && d.status !== '撤回'; }).length;
        return '<div style="padding:10px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;display:flex;flex-direction:column;gap:4px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:12px;font-weight:600">' + _esc(r.name) + '</span><span style="font-size:10px;color:' + st.color + ';font-weight:700">' + st.label + '</span></div>' +
          '<div style="font-size:10px;color:var(--text2)">数量：<b>' + _esc(r.count) + '</b>' + (used ? ' <span style="color:var(--orange)">（本事件派出 ' + used + ' 次）</span>' : '') + '</div>' +
          '<span style="font-size:10px;color:var(--text3)">📞 ' + _esc(r.contact) + '</span>' +
          '<button class="btn sm" style="font-size:10px;margin-top:2px" onclick="COMMAND._openDispatchForm(\'' + inc.id + '\',\'' + r.id + '\')">派出 →</button>' +
          '</div>';
      }).join('');

      /* 调度记录 */
      var dispHtml = '';
      if (dispatches.length) {
        dispHtml = '<div style="margin-top:10px"><div style="font-size:11px;font-weight:700;color:var(--cyan);margin-bottom:6px">📦 本事件调度记录（' + dispatches.length + '）</div>' +
          dispatches.map(function(d){
            var stColor = d.status === '已抵达' ? 'var(--green)' : d.status === '撤回' ? 'var(--text3)' : 'var(--orange)';
            return '<div style="padding:8px 10px;background:var(--bg2);border-left:3px solid ' + stColor + ';border-radius:6px;margin-bottom:6px;font-size:11px">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<b>' + _esc(d.resourceName) + '</b><span style="color:var(--text3)">× ' + _esc(d.qty) + '</span>' +
              '<span style="color:' + stColor + ';font-weight:700">' + d.status + '</span>' +
              '<span style="color:var(--text3);font-size:10px">' + me._fmtDateTime(d.time) + '</span>' +
              (d.status !== '撤回' && d.status !== '已抵达' ?
                '<span style="margin-left:auto;display:flex;gap:4px">' +
                '<button class="btn sm" style="font-size:9px;padding:1px 6px" onclick="COMMAND._dispatchSetStatus(\'' + d.id + '\',\'已抵达\')">✅ 抵达</button>' +
                '<button class="btn sm" style="font-size:9px;padding:1px 6px;color:var(--red)" onclick="COMMAND._dispatchSetStatus(\'' + d.id + '\',\'撤回\')">↩️ 撤回</button></span>' : '') +
              '</div>' +
              '<div style="color:var(--text2);margin-top:3px;font-size:10px">目的地：' + _esc(d.destination || '—') + (d.eta ? ' · 预计 ' + d.eta + ' 小时到达' : '') + (d.note ? ' · ' + _esc(d.note) : '') + '</div>' +
              '</div>';
          }).join('') + '</div>';
      }

      /* 会商记录 */
      var confHtml = '';
      if (confs.length) {
        confHtml = '<div style="margin-top:10px"><div style="font-size:11px;font-weight:700;color:var(--purple);margin-bottom:6px">📞 会商记录（' + confs.length + '）</div>' +
          confs.map(function(c){
            return '<div style="padding:8px 10px;background:var(--bg2);border-left:3px solid var(--purple);border-radius:6px;margin-bottom:6px;font-size:11px">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>' + _esc(c.subject) + '</b>' +
              '<span style="color:var(--text3);font-size:10px">' + me._fmtDateTime(c.time) + ' · 主持：' + _esc(c.host || '—') + '</span></div>' +
              '<div style="color:var(--text2);margin-top:3px;font-size:10px">参与：' + _esc((c.depts || []).join('、')) + '</div>' +
              (c.agenda ? '<div style="color:var(--text2);margin-top:2px;font-size:10px">议题：' + _esc(c.agenda) + '</div>' : '') +
              (c.conclusion ?
                '<div style="margin-top:4px;padding:5px 8px;background:rgba(0,255,159,0.06);border-left:2px solid var(--green);border-radius:4px;font-size:10px;color:var(--green)">结论：' + _esc(c.conclusion) + '</div>' :
                '<button class="btn sm" style="font-size:9px;padding:1px 8px;margin-top:5px" onclick="COMMAND._conferenceConclude(\'' + c.id + '\')">📝 录入会商结论</button>') +
              '</div>';
          }).join('') + '</div>';
      }

      return '<div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:8px">' +
          '<button class="btn sm" style="font-size:10px" onclick="COMMAND._openResourceMgr()">⚙️ 资源库管理</button>' +
          '<button class="btn sm" style="font-size:10px" onclick="COMMAND._openDispatchForm(\'' + inc.id + '\',\'\')">🚁 发起调度</button>' +
          '<button class="btn sm primary" style="font-size:10px" onclick="COMMAND._openConferenceForm(\'' + inc.id + '\')">📞 发起会商</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px">' + cardsHtml + '</div>' +
        dispHtml + confHtml;
    },

    /* ----- 通用弹窗 ----- */
    _cmdModal(title, bodyHtml){
      var old = document.getElementById('cmd-form-overlay');
      if (old) old.remove();
      var overlay = document.createElement('div');
      overlay.className = 'cmd-modal-overlay';
      overlay.id = 'cmd-form-overlay';
      overlay.innerHTML = '<div class="cmd-modal"><div class="cmd-modal-hd"><h3>' + title + '</h3>' +
        '<button class="cmd-modal-close" onclick="this.closest(\'.cmd-modal-overlay\').remove()">×</button></div>' +
        '<div class="cmd-modal-bd">' + bodyHtml + '</div></div>';
      document.body.appendChild(overlay);
    },
    _mv(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; },

    /* ----- 调度表单 ----- */
    _openDispatchForm(incidentId, resourceId){
      var inc = this._incidents.find(function(i){ return i.id === incidentId; });
      if (!inc) return;
      var opts = (this._resources || []).map(function(r){
        return '<option value="' + r.id + '"' + (r.id === resourceId ? ' selected' : '') + '>' + _esc(r.name) + '（' + _esc(r.count) + ' · ' + ((RES_STATUS[r.status] || {}).label || r.status) + '）</option>';
      }).join('');
      this._cmdModal('🚁 发起资源调度 — ' + _esc(inc.title).slice(0, 30),
        '<div style="display:flex;flex-direction:column;gap:10px;font-size:12px">' +
        '<label>调度资源<br><select id="df-res" style="width:100%;padding:6px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text1)">' + opts + '</select></label>' +
        '<label>数量 / 规模<br><input id="df-qty" class="auth-input" placeholder="例：1组 / 3辆 / 5套" style="width:100%"></label>' +
        '<label>目的地<br><input id="df-dest" class="auth-input" value="' + _esc(inc.country || '') + '" style="width:100%"></label>' +
        '<label>预计到达时间（小时）<br><input id="df-eta" class="auth-input" type="number" min="1" value="4" style="width:100%"></label>' +
        '<label>任务说明<br><textarea id="df-note" class="auth-input" rows="3" placeholder="例：前往营地接应伤员，携带血浆与便携式监护仪" style="width:100%"></textarea></label>' +
        '<button class="btn primary" onclick="COMMAND._submitDispatch(\'' + incidentId + '\')">确认派出</button>' +
        '</div>');
    },
    _submitDispatch(incidentId){
      var resId = this._mv('df-res');
      var r = (this._resources || []).find(function(x){ return x.id === resId; });
      if (!r) { showToast('请选择资源'); return; }
      var qty = this._mv('df-qty') || r.count;
      var d = {
        id: this._newId('DSP'), incidentId: incidentId,
        resourceId: r.id, resourceName: r.name, qty: qty,
        destination: this._mv('df-dest'), eta: this._mv('df-eta'),
        note: this._mv('df-note'), status: '派出中',
        time: new Date().toISOString()
      };
      this._dispatches.unshift(d);
      r.status = 'dispatched';
      var deptMap = { medical: 'health', security: 'mps', transport: 'transport', air: 'transport', comm: 'enterprise' };
      this.addWorkorder(incidentId, { title: '调度' + r.name + '（' + qty + '）至' + (d.destination || '事发地'), desc: d.note, dept: deptMap[r.type] || 'enterprise', dueHours: parseInt(d.eta, 10) || 4, priority: 2 });
      this._log('资源调度', 'incident', incidentId, r.name + ' × ' + qty + ' → ' + (d.destination || ''));
      this._save();
      var ov = document.getElementById('cmd-form-overlay'); if (ov) ov.remove();
      this.openIncidentDetail(incidentId);
      showToast('🚁 已派出：' + r.name + ' × ' + qty);
    },
    _dispatchSetStatus(dispId, status){
      var d = (this._dispatches || []).find(function(x){ return x.id === dispId; });
      if (!d) return;
      d.status = status;
      if (status === '撤回') {
        var r = (this._resources || []).find(function(x){ return x.id === d.resourceId; });
        if (r) r.status = 'available';
      }
      this._log('调度' + status, 'incident', d.incidentId, d.resourceName + ' × ' + d.qty);
      this._save();
      this.openIncidentDetail(d.incidentId);
      showToast(status === '撤回' ? '↩️ 资源已撤回到库' : '✅ 资源已抵达');
    },

    /* ----- 会商表单 ----- */
    _openConferenceForm(incidentId){
      var inc = this._incidents.find(function(i){ return i.id === incidentId; });
      if (!inc) return;
      var deptOpts = Object.keys(DEPT_NAMES).map(function(k){
        var checked = (inc.assignedDepts || []).indexOf(k) >= 0 ? ' checked' : '';
        return '<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0;font-size:11px"><input type="checkbox" class="cf-dept" value="' + k + '"' + checked + '>' + DEPT_NAMES[k] + '</label>';
      }).join('');
      this._cmdModal('📞 发起多部门会商',
        '<div style="display:flex;flex-direction:column;gap:10px;font-size:12px">' +
        '<label>会商主题<br><input id="cf-subject" class="auth-input" value="[' + _esc(inc.country || '') + '] ' + _esc(inc.title).slice(0, 40) + '" style="width:100%"></label>' +
        '<div>参与部门<br><div style="padding:6px;background:var(--bg2);border-radius:6px">' + deptOpts + '</div></div>' +
        '<label>主持人<br><input id="cf-host" class="auth-input" placeholder="例：值班处长 / 企业应急总指挥" style="width:100%"></label>' +
        '<label>议题<br><textarea id="cf-agenda" class="auth-input" rows="3" placeholder="例：1.核实中方人员安全状况 2.评估撤离路线与运力 3.明确各部门分工与时间节点" style="width:100%"></textarea></label>' +
        '<button class="btn primary" onclick="COMMAND._submitConference(\'' + incidentId + '\')">发起会商</button>' +
        '</div>');
    },
    _submitConference(incidentId){
      var depts = [];
      document.querySelectorAll('.cf-dept:checked').forEach(function(cb){ depts.push(DEPT_NAMES[cb.value] || cb.value); });
      var c = {
        id: this._newId('CNF'), incidentId: incidentId,
        subject: this._mv('cf-subject') || '多部门会商',
        depts: depts, host: this._mv('cf-host'), agenda: this._mv('cf-agenda'),
        conclusion: '', time: new Date().toISOString()
      };
      this._conferences.unshift(c);
      this.addWorkorder(incidentId, { title: '组织会商：' + c.subject, desc: '参与：' + depts.join('、') + '；议题：' + c.agenda, dept: 'mfa', dueHours: 2, priority: 2 });
      this._log('发起会商', 'incident', incidentId, c.subject + '（' + depts.join('、') + '）');
      this._save();
      var ov = document.getElementById('cmd-form-overlay'); if (ov) ov.remove();
      this.openIncidentDetail(incidentId);
      showToast('📞 会商已发起：' + c.subject);
    },
    _conferenceConclude(confId){
      var c = (this._conferences || []).find(function(x){ return x.id === confId; });
      if (!c) return;
      this._cmdModal('📝 录入会商结论',
        '<div style="display:flex;flex-direction:column;gap:10px;font-size:12px">' +
        '<div style="color:var(--text2)">' + _esc(c.subject) + '</div>' +
        '<textarea id="cc-conclusion" class="auth-input" rows="4" placeholder="例：确认2名伤员转送至首都医院；安保升级至二级；48小时内完成撤离预案推演" style="width:100%"></textarea>' +
        '<button class="btn primary" onclick="COMMAND._submitConclusion(\'' + confId + '\')">保存结论</button>' +
        '</div>');
    },
    _submitConclusion(confId){
      var c = (this._conferences || []).find(function(x){ return x.id === confId; });
      if (!c) return;
      c.conclusion = this._mv('cc-conclusion');
      this._log('会商结论', 'incident', c.incidentId, c.conclusion.slice(0, 60));
      this._save();
      var ov = document.getElementById('cmd-form-overlay'); if (ov) ov.remove();
      this.openIncidentDetail(c.incidentId);
      showToast('📝 会商结论已记录');
    },

    /* ----- 资源库管理（增删改） ----- */
    _openResourceMgr(){
      var rows = (this._resources || []).map(function(r){
        var st = RES_STATUS[r.status] || RES_STATUS.available;
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 8px;background:var(--bg2);border-radius:6px;margin-bottom:5px;font-size:11px">' +
          '<b style="flex:1">' + _esc(r.name) + '</b><span style="color:var(--text3)">' + _esc(r.count) + '</span>' +
          '<span style="color:' + st.color + '">' + st.label + '</span>' +
          '<button class="btn sm" style="font-size:9px;padding:1px 6px" onclick="COMMAND._openResourceForm(\'' + r.id + '\')">✏️</button>' +
          '<button class="btn sm" style="font-size:9px;padding:1px 6px;color:var(--red)" onclick="COMMAND._deleteResource(\'' + r.id + '\')">🗑️</button>' +
          '</div>';
      }).join('');
      this._cmdModal('⚙️ 应急资源库管理',
        rows +
        '<button class="btn primary" style="margin-top:8px" onclick="COMMAND._openResourceForm(\'\')">➕ 新增资源</button>');
    },
    _openResourceForm(resId){
      var r = resId ? (this._resources || []).find(function(x){ return x.id === resId; }) : null;
      var typeOpts = ['medical', 'security', 'transport', 'air', 'comm', 'other'].map(function(t){
        var names = { medical: '医疗', security: '安保', transport: '运输', air: '航空运力', comm: '通信', other: '其他' };
        return '<option value="' + t + '"' + (r && r.type === t ? ' selected' : '') + '>' + names[t] + '</option>';
      }).join('');
      this._cmdModal(r ? '✏️ 编辑资源' : '➕ 新增资源',
        '<div style="display:flex;flex-direction:column;gap:10px;font-size:12px">' +
        '<label>资源名称<br><input id="rf-name" class="auth-input" value="' + (r ? _esc(r.name) : '') + '" placeholder="例：医疗救援队" style="width:100%"></label>' +
        '<label>类型<br><select id="rf-type" style="width:100%;padding:6px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;color:var(--text1)">' + typeOpts + '</select></label>' +
        '<label>数量 / 规模<br><input id="rf-count" class="auth-input" value="' + (r ? _esc(r.count) : '') + '" placeholder="例：2组 / 3辆 / 待命" style="width:100%"></label>' +
        '<label>联系渠道<br><input id="rf-contact" class="auth-input" value="' + (r ? _esc(r.contact) : '') + '" placeholder="例：驻外使领馆领保电话 / 具体联系人电话" style="width:100%"></label>' +
        '<button class="btn primary" onclick="COMMAND._submitResource(\'' + resId + '\')">保存</button>' +
        '</div>');
    },
    _submitResource(resId){
      var name = this._mv('rf-name');
      if (!name) { showToast('请填写资源名称'); return; }
      var r = resId ? (this._resources || []).find(function(x){ return x.id === resId; }) : null;
      if (r) {
        r.name = name; r.type = this._mv('rf-type'); r.count = this._mv('rf-count') || r.count; r.contact = this._mv('rf-contact');
      } else {
        this._resources.push({ id: this._newId('R'), name: name, type: this._mv('rf-type'), status: 'available', count: this._mv('rf-count') || '1', contact: this._mv('rf-contact') });
      }
      this._save();
      this._openResourceMgr();
      showToast('✅ 资源已保存');
    },
    _deleteResource(resId){
      if (!confirm('确认删除该资源？相关调度记录保留。')) return;
      this._resources = (this._resources || []).filter(function(x){ return x.id !== resId; });
      this._save();
      this._openResourceMgr();
      showToast('🗑️ 资源已删除');
    },

    _renderTimeline(incidentId){
      var entries = this._audit.filter(a => {
        if(a.targetId === incidentId) return true;
        if(a.targetType === 'workorder'){
          var w = this._workorders.find(x => x.id === a.targetId);
          if(w && w.incidentId === incidentId) return true;
        }
        return false;
      }).sort(function(a,b){ return new Date(b.time) - new Date(a.time); });
      if(!entries.length) return '<div class="cmd-empty">暂无审计记录</div>';
      var html = '<div class="cmd-timeline">';
      entries.forEach(a => {
        html += '<div class="cmd-timeline-item">' +
          '<div class="cmd-timeline-dot"></div>' +
          '<span class="cmd-timeline-time">' + this._fmtDateTime(a.time) + '</span>' +
          '<span class="cmd-timeline-action">' + _esc(a.action) + '</span>' +
          (a.detail ? ' — <span style="color:var(--text2)">' + _esc(a.detail) + '</span>' : '') +
        '</div>';
      });
      html += '</div>';
      return html;
    },

    showAuditLog(){
      var overlay = document.createElement('div');
      overlay.className = 'cmd-modal-overlay';
      overlay.id = 'cmd-audit-overlay';
      var entries = this._audit.slice().sort(function(a,b){ return new Date(b.time) - new Date(a.time); });
      var html = '<div class="cmd-modal"><div class="cmd-modal-hd"><h3>📝 审计日志</h3><button class="cmd-modal-close" onclick="this.closest(\'.cmd-modal-overlay\').remove()">×</button></div>' +
        '<div class="cmd-modal-bd">';
      if(!entries.length){
        html += '<div class="cmd-empty">暂无审计记录</div>';
      } else {
        html += '<div class="cmd-timeline">';
        entries.forEach(a => {
          html += '<div class="cmd-timeline-item"><div class="cmd-timeline-dot"></div>' +
            '<span class="cmd-timeline-time">' + this._fmtDateTime(a.time) + '</span>' +
            '<span class="cmd-timeline-action">' + _esc(a.action) + '</span>' +
            ' <span style="color:var(--text3)">[' + _esc(a.targetType) + ' ' + _esc(a.targetId) + ']</span>' +
            (a.detail ? ' — <span style="color:var(--text2)">' + _esc(a.detail) + '</span>' : '') +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div></div>';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e){ if(e.target === overlay){ overlay.remove(); } });
    },

    showPlaybookLibrary(){
      var overlay = document.createElement('div');
      overlay.className = 'cmd-modal-overlay';
      overlay.id = 'cmd-playbook-overlay';
      var html = '<div class="cmd-modal"><div class="cmd-modal-hd"><h3>📖 应急预案库</h3><button class="cmd-modal-close" onclick="this.closest(\'.cmd-modal-overlay\').remove()">×</button></div>' +
        '<div class="cmd-modal-bd"><div class="cmd-playbook-lib">';
      this._playbooks.forEach(p => {
        html += this._playbookCardHTML(p, true);
      });
      html += '</div></div></div>';
      overlay.innerHTML = html;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e){ if(e.target === overlay){ overlay.remove(); } });
    },

    openCreateModal(){
      var title = prompt('事件标题：');
      if(!title) return;
      var country = prompt('涉及国家/地区：') || '';
      var level = parseInt(prompt('响应等级 1-红 2-橙 3-黄 4-蓝：') || '3', 10);
      this.createIncidentManual({ title: title, country: country, level: level });
      this.render();
    },

    /* 启动联合响应：批量为所有待处理事件生成会商+资源调度工单 */
    _startJointResponse(){
      var pending=this._incidents.filter(i=>i.status==='open');
      if(!pending.length){showToast('当前没有待处理事件');return;}
      if(!confirm('将为 '+pending.length+' 个待处理事件批量生成联合响应工单（会商+医疗+安保+通信），是否继续？'))return;
      var created=0;
      pending.forEach(function(inc){
        try{
          this.addWorkorder(inc.id,{title:'['+inc.country+']'+inc.title+' — 多部门会商',desc:'自动召集外交、公安、商务部门会商',dept:'mfa',dueHours:2,priority:inc.level});
          this.addWorkorder(inc.id,{title:'调度医疗救援队支援'+inc.country,dept:'health',dueHours:4,priority:inc.level});
          this.addWorkorder(inc.id,{title:'调度安保增援队支援'+inc.country,dept:'mps',dueHours:4,priority:inc.level});
          this.addWorkorder(inc.id,{title:'启动卫星通信与现场情报回传',dept:'enterprise',dueHours:2,priority:inc.level});
          this._log('启动联合响应', 'incident', inc.id, '自动生成4张联合响应工单');
          created+=4;
        }catch(e){}
      }, this);
      this.render();
      showToast('已为 '+pending.length+' 个事件生成 '+created+' 张联合响应工单');
    },

    /* 暴露给外部调用的接口 */
    getOpenIncidents(){ return this._incidents.filter(i => i.status === 'open'); },
    getStats(){ return { open: this._incidents.filter(i => i.status === 'open').length, closed: this._incidents.filter(i => i.status === 'closed').length, pendingWo: this._workorders.filter(w => w.status === 'pending').length }; },
    getResponseLevels(){ return RESPONSE_LEVELS; }
  };
})();