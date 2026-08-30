/**
 * 数据源库 DATASOURCES v1.0
 * 参考全球反恐情报感知平台"源-流-用-馈"四层闭环设计
 * 核心：数据源注册 → 定时采集 → 功能区联动 → 风险反馈调频（活循环）
 */
var DATASOURCES = (function(){

  /* ========== 数据源注册表（7大类 28源） ========== */
  var REGISTRY = [
    /* 官方权威 */
    {id:'DS-OF-01',name:'外交部领事司',cat:'official',icon:'🏛️',desc:'领事提醒/安全预警/撤侨通告',coverage:['全球'],cycle:60,rel:'A1',feeds:['security_events','预警中心']},
    {id:'DS-OF-02',name:'领事直通车',cat:'official',icon:'🏛️',desc:'海外安全提醒推送',coverage:['全球'],cycle:60,rel:'A1',feeds:['security_events','态势总览']},
    {id:'DS-OF-03',name:'商务部对外投资',cat:'official',icon:'🏛️',desc:'国别投资经营障碍报告',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-OF-04',name:'应急管理部',cat:'official',icon:'🏛️',desc:'自然灾害/事故灾难通报',coverage:['全球'],cycle:60,rel:'A2',feeds:['disaster_events','风险监测']},
    /* 国际组织 */
    {id:'DS-IN-01',name:'联合国OCHA',cat:'intl',icon:'🌐',desc:'人道主义危机通报',coverage:['非洲','中东','南亚'],cycle:60,rel:'A2',feeds:['humanitarian','态势总览']},
    {id:'DS-IN-02',name:'世界银行数据',cat:'intl',icon:'🌐',desc:'国别经济指标/债务数据',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-IN-03',name:'国际危机组织ICG',cat:'intl',icon:'🌐',desc:'冲突预警月报/危机追踪',coverage:['非洲','中东','南亚','拉美'],cycle:60,rel:'B1',feeds:['conflict_warning','威胁组织']},
    {id:'DS-IN-04',name:'WHO疫情通报',cat:'intl',icon:'🌐',desc:'突发公共卫生事件',coverage:['全球'],cycle:60,rel:'A2',feeds:['health_events','风险监测']},
    /* 开源情报 OSINT */
    {id:'DS-OS-01',name:'GDELT全球事件库',cat:'osint',icon:'📡',desc:'全球媒体事件实时流(15分钟级)',coverage:['全球'],cycle:60,rel:'B2',feeds:['osint_intel','态势总览']},
    {id:'DS-OS-02',name:'ACLED武装冲突库',cat:'osint',icon:'📡',desc:'武装冲突/政治暴力事件定位',coverage:['非洲','中东','南亚'],cycle:60,rel:'B1',feeds:['conflict_events','威胁组织']},
    {id:'DS-OS-03',name:'GTD恐怖主义数据库',cat:'osint',icon:'📡',desc:'恐袭事件结构化档案',coverage:['全球'],cycle:60,rel:'B1',feeds:['terror_events','威胁组织']},
    {id:'DS-OS-04',name:'LiveUAMap',cat:'osint',icon:'📡',desc:'冲突地图实时标注',coverage:['中东','东欧','非洲'],cycle:60,rel:'B2',feeds:['conflict_events','态势总览']},
    {id:'DS-OS-05',name:'ReliefWeb',cat:'osint',icon:'📡',desc:'灾害与危机响应信息',coverage:['全球'],cycle:60,rel:'B1',feeds:['disaster_events','风险监测']},
    /* 新闻媒体 */
    {id:'DS-ME-01',name:'新华社国际频道',cat:'media',icon:'📰',desc:'国际时政要闻',coverage:['全球'],cycle:60,rel:'A2',feeds:['news_intel','态势总览']},
    {id:'DS-ME-02',name:'人民网国际',cat:'media',icon:'📰',desc:'华人华侨安全动态',coverage:['全球'],cycle:60,rel:'A2',feeds:['news_intel','预警中心']},
    {id:'DS-ME-03',name:'路透社',cat:'media',icon:'📰',desc:'突发事件快讯',coverage:['全球'],cycle:60,rel:'B1',feeds:['news_intel','态势总览']},
    {id:'DS-ME-04',name:'半岛电视台',cat:'media',icon:'📰',desc:'中东北非地区深度报道',coverage:['中东','非洲'],cycle:60,rel:'B2',feeds:['news_intel','风险监测']},
    /* 社交监测 */
    {id:'DS-SO-00',name:'微信公众号监测',cat:'social',icon:'📮',desc:'20个开源情报/安全核心公众号轮巡采集(每轮10个)',coverage:['全球'],cycle:15,rel:'A1',feeds:['osint_intel','预警中心'],realKey:'wechat_oa'},
    {id:'DS-SO-01',name:'X平台热点监测',cat:'social',icon:'💬',desc:'涉华涉企话题/突发目击信息',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','自动预警']},
    {id:'DS-SO-02',name:'Telegram频道监测',cat:'social',icon:'💬',desc:'武装组织宣示/地区频道',coverage:['中东','东欧','南亚'],cycle:60,rel:'C1',feeds:['social_monitor','威胁组织']},
    {id:'DS-SO-03',name:'当地社区论坛',cat:'social',icon:'💬',desc:'驻在国治安舆情',coverage:['非洲','东南亚','拉美'],cycle:60,rel:'C3',feeds:['social_monitor','风险监测']},
    /* 商业数据 */
    {id:'DS-CO-01',name:'航运AIS数据',cat:'commercial',icon:'💼',desc:'船舶定位/航线偏离监测',coverage:['红海','马六甲','几内亚湾'],cycle:60,rel:'B1',feeds:['shipping_monitor','风险监测']},
    {id:'DS-CO-02',name:'大宗商品行情',cat:'commercial',icon:'💼',desc:'油气/铜钴锂价格异动',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-CO-03',name:'邓白氏企业数据',cat:'commercial',icon:'💼',desc:'合作方资信变动',coverage:['全球'],cycle:60,rel:'B1',feeds:['enterprise_risks','企业资产']},
    {id:'DS-CO-04',name:'保险风险费率',cat:'commercial',icon:'💼',desc:'战争险/绑架赎金险费率异动',coverage:['高危国家'],cycle:60,rel:'B2',feeds:['economic_risks','预警中心']},
    /* 合作哨点 */
    {id:'DS-SE-01',name:'驻外企业安全员',cat:'sentinel',icon:'🎖️',desc:'一线安全员每日情况上报',coverage:['项目所在国'],cycle:60,rel:'A1',feeds:['sentinel_report','预警中心']},
    {id:'DS-SE-02',name:'使领馆安全通报',cat:'sentinel',icon:'🎖️',desc:'驻在国使领馆内部通报',coverage:['全球'],cycle:60,rel:'A1',feeds:['sentinel_report','态势总览']},
    {id:'DS-SE-03',name:'安保公司驻地报告',cat:'sentinel',icon:'🎖️',desc:'国际安保公司态势周报',coverage:['高危国家'],cycle:60,rel:'B1',feeds:['sentinel_report','威胁组织']},
    {id:'DS-SE-04',name:'华人社团信息员',cat:'sentinel',icon:'🎖️',desc:'侨团治安信息网络',coverage:['东南亚','非洲','拉美'],cycle:60,rel:'C1',feeds:['sentinel_report','风险监测']},

    /* ===== 扩充开源数据源 v2.0（重点扩 OSINT 开源情报） ===== */
    /* 官方权威 增补 */
    {id:'DS-OF-05',name:'国家移民管理局',cat:'official',icon:'🏛️',desc:'出入境管控/边检预警',coverage:['全球'],cycle:60,rel:'A1',feeds:['security_events','风险监测']},
    {id:'DS-OF-06',name:'海关总署',cat:'official',icon:'🏛️',desc:'进出口管制/贸易风险通报',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-OF-07',name:'中国地震台网',cat:'official',icon:'🏛️',desc:'境外地震速报',coverage:['全球'],cycle:60,rel:'A1',feeds:['disaster_events','风险监测']},
    /* 国际组织 增补 */
    {id:'DS-IN-05',name:'国际货币基金组织IMF',cat:'intl',icon:'🌐',desc:'主权债务/金融稳定评估',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-IN-06',name:'红十字会红新月会IFRC',cat:'intl',icon:'🌐',desc:'灾害应急/人道救援通报',coverage:['非洲','中东','南亚'],cycle:60,rel:'A2',feeds:['humanitarian','态势总览']},
    {id:'DS-IN-07',name:'国际民航组织ICAO',cat:'intl',icon:'🌐',desc:'空域安全/航路风险通告',coverage:['全球'],cycle:60,rel:'A2',feeds:['shipping_monitor','风险监测']},
    /* 开源情报 OSINT 大规模扩充 */
    {id:'DS-OS-06',name:'NASA FIRMS火点监测',cat:'osint',icon:'📡',desc:'卫星火点(冲突/爆炸/火灾)近实时',coverage:['全球'],cycle:60,rel:'B1',feeds:['disaster_events','风险监测']},
    {id:'DS-OS-07',name:'FlightRadar24航班追踪',cat:'osint',icon:'📡',desc:'军机/撤侨/异常航班ADS-B追踪',coverage:['全球'],cycle:60,rel:'B2',feeds:['shipping_monitor','态势总览']},
    {id:'DS-OS-08',name:'GDACS全球灾害预警',cat:'osint',icon:'📡',desc:'地震/飓风/洪水联合预警',coverage:['全球'],cycle:60,rel:'A2',feeds:['disaster_events','风险监测']},
    {id:'DS-OS-09',name:'USGS地震监测',cat:'osint',icon:'📡',desc:'全球地震速报(分钟级)',coverage:['全球'],cycle:60,rel:'A1',feeds:['disaster_events','风险监测']},
    {id:'DS-OS-10',name:'FEWS NET粮食安全',cat:'osint',icon:'📡',desc:'饥荒/粮食危机早期预警',coverage:['非洲','中东','南亚'],cycle:60,rel:'B1',feeds:['humanitarian','风险监测']},
    {id:'DS-OS-11',name:'IOM DTM流离失所追踪',cat:'osint',icon:'📡',desc:'难民/境内流离失所流动监测',coverage:['非洲','中东','南亚'],cycle:60,rel:'B1',feeds:['humanitarian','威胁组织']},
    {id:'DS-OS-12',name:'UNHCR难民署数据',cat:'osint',icon:'📡',desc:'难民潮/庇护数据',coverage:['全球'],cycle:60,rel:'A2',feeds:['humanitarian','态势总览']},
    {id:'DS-OS-13',name:'NetBlocks网络中断',cat:'osint',icon:'📡',desc:'互联网封锁/断网(政局动荡信号)',coverage:['全球'],cycle:60,rel:'B1',feeds:['social_monitor','自动预警']},
    {id:'DS-OS-14',name:'Bellingcat开源调查',cat:'osint',icon:'📡',desc:'冲突事件开源核实/影像定位',coverage:['中东','东欧','非洲'],cycle:60,rel:'B1',feeds:['conflict_events','威胁组织']},
    {id:'DS-OS-15',name:'HealthMap疫情监测',cat:'osint',icon:'📡',desc:'传染病暴发实时地图',coverage:['全球'],cycle:60,rel:'B1',feeds:['health_events','风险监测']},
    {id:'DS-OS-16',name:'OFAC制裁名单监测',cat:'osint',icon:'📡',desc:'美财政部制裁/实体清单变动',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-OS-17',name:'FATF反洗钱监测',cat:'osint',icon:'📡',desc:'洗钱/恐怖融资灰黑名单',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-OS-18',name:'InSight Crime有组织犯罪',cat:'osint',icon:'📡',desc:'拉美有组织犯罪/绑架勒索',coverage:['拉美'],cycle:60,rel:'B1',feeds:['conflict_events','威胁组织']},
    {id:'DS-OS-19',name:'哨兵卫星影像',cat:'osint',icon:'📡',desc:'Sentinel-2地表变化监测',coverage:['全球'],cycle:60,rel:'B1',feeds:['osint_intel','风险监测']},
    {id:'DS-OS-20',name:'VIIRS夜间灯光',cat:'osint',icon:'📡',desc:'夜间灯光异常(停电/冲突/经济)',coverage:['全球'],cycle:60,rel:'B2',feeds:['osint_intel','预测分析']},
    {id:'DS-OS-21',name:'波罗的海BDI指数',cat:'osint',icon:'📡',desc:'干散货运价(航运/贸易风险)',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-OS-22',name:'Crisis24风险预警',cat:'osint',icon:'📡',desc:'全球风险事件分级推送',coverage:['全球'],cycle:60,rel:'B1',feeds:['conflict_warning','预警中心']},
    {id:'DS-OS-23',name:'谷歌趋势舆情',cat:'osint',icon:'📡',desc:'涉华涉企搜索热度异动',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','自动预警']},
    /* 新闻媒体 增补 */
    {id:'DS-ME-05',name:'CGTN国际频道',cat:'media',icon:'📰',desc:'中国视角国际新闻',coverage:['全球'],cycle:60,rel:'A2',feeds:['news_intel','态势总览']},
    {id:'DS-ME-06',name:'BBC监控',cat:'media',icon:'📰',desc:'全球媒体监测/译编',coverage:['全球'],cycle:60,rel:'B1',feeds:['news_intel','风险监测']},
    {id:'DS-ME-07',name:'法新社AFP',cat:'media',icon:'📰',desc:'突发快讯(中东/非洲)',coverage:['中东','非洲'],cycle:60,rel:'B1',feeds:['news_intel','态势总览']},
    {id:'DS-ME-08',name:'凤凰卫视资讯',cat:'media',icon:'📰',desc:'华人视角国际突发事件',coverage:['全球'],cycle:60,rel:'B2',feeds:['news_intel','预警中心']},
    /* 社交监测 增补 */
    {id:'DS-SO-04',name:'微博国际舆情',cat:'social',icon:'💬',desc:'涉海外安全话题热度',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','自动预警']},
    {id:'DS-SO-05',name:'Facebook公共主页',cat:'social',icon:'💬',desc:'驻在国公共事件/抗议召集',coverage:['非洲','东南亚','拉美'],cycle:60,rel:'C3',feeds:['social_monitor','风险监测']},
    {id:'DS-SO-06',name:'Reddit相关板块',cat:'social',icon:'💬',desc:'地区冲突/治安讨论串',coverage:['全球'],cycle:60,rel:'C3',feeds:['social_monitor','风险监测']},
    {id:'DS-SO-07',name:'YouTube突发频道',cat:'social',icon:'💬',desc:'现场视频/目击者上传',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','自动预警']},
    /* 商业数据 增补 */
    {id:'DS-CO-05',name:'穆迪主权评级',cat:'commercial',icon:'💼',desc:'主权信用评级变动',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-CO-06',name:'LME金属行情',cat:'commercial',icon:'💼',desc:'铜钴锂等关键金属价格',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-CO-07',name:'全球集装箱运价',cat:'commercial',icon:'💼',desc:'海运运价指数(供应链)',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-CO-08',name:'跨境资金流动监测',cat:'commercial',icon:'💼',desc:'资本外逃/汇率异常',coverage:['高危国家'],cycle:60,rel:'B1',feeds:['economic_risks','预警中心']},
    /* 合作哨点 增补 */
    {id:'DS-SE-05',name:'中资企业商会',cat:'sentinel',icon:'🎖️',desc:'海外商会安全联防通报',coverage:['全球'],cycle:60,rel:'B1',feeds:['sentinel_report','预警中心']},
    {id:'DS-SE-06',name:'国际SOS救援',cat:'sentinel',icon:'🎖️',desc:'医疗救援/安全撤离服务',coverage:['全球'],cycle:60,rel:'A2',feeds:['sentinel_report','风险监测']},
    {id:'DS-SE-07',name:'Control Risks',cat:'sentinel',icon:'🎖️',desc:'国际风险咨询态势评估',coverage:['高危国家'],cycle:60,rel:'B1',feeds:['sentinel_report','威胁组织']},

    /* ===== 大规模扩充 v4.0（总数达101源，强化实时情报入口） ===== */
    /* 官方权威 增补 */
    {id:'DS-OF-08',name:'国家外汇管理局',cat:'official',icon:'🏛️',desc:'跨境资本流动/汇率异动监测',coverage:['全球'],cycle:60,rel:'A1',feeds:['economic_risks','企业资产']},
    {id:'DS-OF-09',name:'国家反恐办',cat:'official',icon:'🏛️',desc:'境内外反恐预警通报',coverage:['全球'],cycle:60,rel:'A1',feeds:['security_events','威胁组织']},
    {id:'DS-OF-10',name:'发改委外资司',cat:'official',icon:'🏛️',desc:'海外投资安全国别指南',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    /* 国际组织 增补 */
    {id:'DS-IN-08',name:'国际刑警组织INTERPOL',cat:'intl',icon:'🌐',desc:'跨境犯罪/恐怖融资通报',coverage:['全球'],cycle:60,rel:'A1',feeds:['security_events','威胁组织']},
    {id:'DS-IN-09',name:'联合国安理会',cat:'intl',icon:'🌐',desc:'制裁决议/局势公报',coverage:['全球'],cycle:60,rel:'A1',feeds:['geopolitical','预警中心']},
    {id:'DS-IN-10',name:'国际移民组织IOM',cat:'intl',icon:'🌐',desc:'移徙/人口流动监测',coverage:['非洲','中东','拉美'],cycle:60,rel:'A2',feeds:['humanitarian','风险监测']},
    {id:'DS-IN-11',name:'联合国开发计划署UNDP',cat:'intl',icon:'🌐',desc:'脆弱国家风险评估',coverage:['非洲','南亚'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-IN-12',name:'欧盟对外行动署EEAS',cat:'intl',icon:'🌐',desc:'欧盟共同安全暨防务简报',coverage:['全球'],cycle:60,rel:'A2',feeds:['geopolitical','风险监测']},
    /* 开源情报 OSINT 大规模扩充 */
    {id:'DS-OS-24',name:'维基解密Wikileaks',cat:'osint',icon:'📡',desc:'泄露文档/内部通报',coverage:['全球'],cycle:60,rel:'C2',feeds:['osint_intel','威胁组织']},
    {id:'DS-OS-25',name:'Planet卫星影像',cat:'osint',icon:'📡',desc:'每日重访地表变化监测',coverage:['全球'],cycle:60,rel:'B1',feeds:['osint_intel','风险监测']},
    {id:'DS-OS-26',name:'Maxar卫星',cat:'osint',icon:'📡',desc:'高分辨率冲突区域成像',coverage:['中东','东欧','非洲'],cycle:60,rel:'B1',feeds:['osint_intel','态势总览']},
    {id:'DS-OS-27',name:'全球和平指数GPI',cat:'osint',icon:'📡',desc:'国家和平/安全年度评级',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-OS-28',name:'经济与和平研究所IEP',cat:'osint',icon:'📡',desc:'全球恐怖主义指数GTI',coverage:['全球'],cycle:60,rel:'A2',feeds:['terror_events','威胁组织']},
    {id:'DS-OS-29',name:'透明国际腐败感知',cat:'osint',icon:'📡',desc:'腐败风险(投资环境)',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-OS-30',name:'航空安全网络ASN',cat:'osint',icon:'📡',desc:'空难/航空事故数据库',coverage:['全球'],cycle:60,rel:'B1',feeds:['disaster_events','风险监测']},
    {id:'DS-OS-31',name:'海事安全中心MSCC',cat:'osint',icon:'📡',desc:'海盗/海上武装劫持预警',coverage:['红海','几内亚湾','马六甲'],cycle:60,rel:'B1',feeds:['shipping_monitor','风险监测']},
    {id:'DS-OS-32',name:'国际商会海盗报告',cat:'osint',icon:'📡',desc:'全球海盗事件周报',coverage:['全球'],cycle:60,rel:'B1',feeds:['shipping_monitor','预警中心']},
    {id:'DS-OS-33',name:'网络威胁联盟CTA',cat:'osint',icon:'📡',desc:'恶意软件/APT组织情报',coverage:['全球'],cycle:60,rel:'B1',feeds:['osint_intel','企业资产']},
    {id:'DS-OS-34',name:'Shodan物联网探测',cat:'osint',icon:'📡',desc:'关键基础设施暴露面扫描',coverage:['全球'],cycle:60,rel:'B2',feeds:['osint_intel','基础设施']},
    {id:'DS-OS-35',name:'全球选举观察',cat:'osint',icon:'📡',desc:'选举暴力/政治动荡预警',coverage:['非洲','拉美','南亚'],cycle:60,rel:'B1',feeds:['political_events','风险监测']},
    {id:'DS-OS-36',name:'全球供应链压力指数',cat:'osint',icon:'📡',desc:'GSCPI供应链中断预警',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    /* 新闻媒体 增补 */
    {id:'DS-ME-09',name:'央视新闻国际',cat:'media',icon:'📰',desc:'中国视角国际要闻',coverage:['全球'],cycle:60,rel:'A1',feeds:['news_intel','态势总览']},
    {id:'DS-ME-10',name:'环球时报',cat:'media',icon:'📰',desc:'国际时政深度/涉华',coverage:['全球'],cycle:60,rel:'A2',feeds:['news_intel','预警中心']},
    {id:'DS-ME-11',name:'联合早报',cat:'media',icon:'📰',desc:'东南亚/中国周边观察',coverage:['东南亚','东亚'],cycle:60,rel:'B1',feeds:['news_intel','风险监测']},
    {id:'DS-ME-12',name:'彭博社Bloomberg',cat:'media',icon:'📰',desc:'全球财经/市场异动',coverage:['全球'],cycle:60,rel:'B1',feeds:['news_intel','预测分析']},
    /* 社交监测 增补 */
    {id:'DS-SO-08',name:'TikTok舆情监测',cat:'social',icon:'💬',desc:'短视频突发/目击传播',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','自动预警']},
    {id:'DS-SO-09',name:'微信/公众号舆情',cat:'social',icon:'💬',desc:'涉海外安全话题聚合',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','风险监测']},
    {id:'DS-SO-10',name:'Gab/Parler',cat:'social',icon:'💬',desc:'极右/武装组织宣示',coverage:['欧美'],cycle:60,rel:'C1',feeds:['social_monitor','威胁组织']},
    {id:'DS-SO-11',name:'Discord频道监测',cat:'social',icon:'💬',desc:'极端组织招募/宣示',coverage:['全球'],cycle:60,rel:'C1',feeds:['social_monitor','威胁组织']},
    {id:'DS-SO-12',name:'小红书海外',cat:'social',icon:'💬',desc:'华人海外安全经验分享',coverage:['东南亚','欧美'],cycle:60,rel:'C3',feeds:['social_monitor','风险监测']},
    /* 商业数据 增补 */
    {id:'DS-CO-09',name:'标普全球评级',cat:'commercial',icon:'💼',desc:'主权/企业信用评级',coverage:['全球'],cycle:60,rel:'A1',feeds:['economic_risks','预测分析']},
    {id:'DS-CO-10',name:'路孚特Refinitiv',cat:'commercial',icon:'💼',desc:'金融/大宗实时数据',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-CO-11',name:'Freightos运价指数',cat:'commercial',icon:'💼',desc:'集装箱现货运价监测',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    /* 合作哨点 增补 */
    {id:'DS-SE-08',name:'中资安保协会',cat:'sentinel',icon:'🎖️',desc:'海外安保行业态势共享',coverage:['非洲','中东','东南亚'],cycle:60,rel:'B1',feeds:['sentinel_report','威胁组织']},
    {id:'DS-SE-09',name:'无国界医生MSF',cat:'sentinel',icon:'🎖️',desc:'冲突区医疗人道通报',coverage:['非洲','中东'],cycle:60,rel:'A2',feeds:['sentinel_report','风险监测']},

    /* ===== 大规模扩充 v5.0（聚焦海外利益安全 / 涉华，总数达131源） ===== */
    /* 官方权威 · 涉华 */
    {id:'DS-OF-11',name:'公安部境外安保局',cat:'official',icon:'🏛️',desc:'境外中国公民安全/撤侨协调',coverage:['全球'],cycle:60,rel:'A1',feeds:['security_events','预警中心']},
    {id:'DS-OF-12',name:'国资委境外投资监管',cat:'official',icon:'🏛️',desc:'中资企业境外投资安全督导',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-OF-13',name:'驻外使领馆安保专报',cat:'official',icon:'🏛️',desc:'使领馆辖区安全形势日报',coverage:['全球'],cycle:60,rel:'A1',feeds:['sentinel_report','态势总览']},
    /* 国际组织 · 涉华 */
    {id:'DS-IN-13',name:'联合国人权理事会涉华',cat:'intl',icon:'🌐',desc:'涉华人权审议/特别报告员',coverage:['全球'],cycle:60,rel:'B2',feeds:['political_events','风险监测']},
    {id:'DS-IN-14',name:'国际特赦涉华观察',cat:'intl',icon:'🌐',desc:'涉华安全/拘押事件监测',coverage:['全球'],cycle:60,rel:'C2',feeds:['security_events','威胁组织']},
    {id:'DS-IN-15',name:'智库涉华研究(CSIS)',cat:'intl',icon:'🌐',desc:'中国海外影响力/安全风险研判',coverage:['全球'],cycle:60,rel:'B1',feeds:['geopolitical','预测分析']},
    /* 开源情报 OSINT · 涉华重点 */
    {id:'DS-OS-37',name:'中国一带一路网',cat:'osint',icon:'📡',desc:'一带一路项目动态/风险通报',coverage:['全球'],cycle:60,rel:'A2',feeds:['osint_intel','企业资产']},
    {id:'DS-OS-38',name:'中资企业舆情监测',cat:'osint',icon:'📡',desc:'中资海外项目负面舆情聚合',coverage:['全球'],cycle:60,rel:'B1',feeds:['osint_intel','企业资产']},
    {id:'DS-OS-39',name:'涉华制裁实体追踪',cat:'osint',icon:'📡',desc:'实体清单/涉华制裁变动监测',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','企业资产']},
    {id:'DS-OS-40',name:'南海局势监测',cat:'osint',icon:'📡',desc:'南海岛礁/航行安全动态',coverage:['南海','东南亚'],cycle:60,rel:'B1',feeds:['geopolitical','预警中心']},
    {id:'DS-OS-41',name:'台海局势监测',cat:'osint',icon:'📡',desc:'台海周边安全动态',coverage:['台海','东亚'],cycle:60,rel:'B1',feeds:['geopolitical','预警中心']},
    {id:'DS-OS-42',name:'中美关系动态',cat:'osint',icon:'📡',desc:'中美博弈/科技脱钩预警',coverage:['全球'],cycle:60,rel:'B1',feeds:['geopolitical','预测分析']},
    {id:'DS-OS-43',name:'华人安全事件库',cat:'osint',icon:'📡',desc:'海外华人遇袭/绑架事件归集',coverage:['全球'],cycle:60,rel:'B1',feeds:['security_events','威胁组织']},
    {id:'DS-OS-44',name:'中资项目风险地图',cat:'osint',icon:'📡',desc:'海外中资项目风险点标注',coverage:['非洲','东南亚','南亚','拉美'],cycle:60,rel:'B1',feeds:['osint_intel','企业资产']},
    {id:'DS-OS-45',name:'涉华英文媒体监测',cat:'osint',icon:'📡',desc:'路透/彭博/FT涉华报道聚合',coverage:['全球'],cycle:60,rel:'B1',feeds:['news_intel','风险监测']},
    {id:'DS-OS-46',name:'使馆安全通告聚合',cat:'osint',icon:'📡',desc:'各使领馆安全提醒汇总',coverage:['全球'],cycle:60,rel:'A1',feeds:['security_events','预警中心']},
    /* 新闻媒体 · 涉华 */
    {id:'DS-ME-13',name:'中国日报CHINADAILY',cat:'media',icon:'📰',desc:'中国官方英文国际报道',coverage:['全球'],cycle:60,rel:'A2',feeds:['news_intel','态势总览']},
    {id:'DS-ME-14',name:'环球网国际',cat:'media',icon:'📰',desc:'涉华国际热点/深度',coverage:['全球'],cycle:60,rel:'A2',feeds:['news_intel','预警中心']},
    {id:'DS-ME-15',name:'海外网',cat:'media',icon:'📰',desc:'华侨/华人视角国际新闻',coverage:['全球'],cycle:60,rel:'A2',feeds:['news_intel','风险监测']},
    {id:'DS-ME-16',name:'欧洲时报',cat:'media',icon:'📰',desc:'欧洲华人社区安全动态',coverage:['欧洲'],cycle:60,rel:'B2',feeds:['news_intel','风险监测']},
    /* 社交监测 · 涉华 */
    {id:'DS-SO-13',name:'华人微信群监测',cat:'social',icon:'💬',desc:'海外华人安全信息共享',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','自动预警']},
    {id:'DS-SO-14',name:'抖音涉华舆情',cat:'social',icon:'💬',desc:'涉华安全短视频传播',coverage:['全球'],cycle:60,rel:'C2',feeds:['social_monitor','自动预警']},
    {id:'DS-SO-15',name:'小红书华侨',cat:'social',icon:'💬',desc:'华侨海外生活安全分享',coverage:['东南亚','欧美'],cycle:60,rel:'C3',feeds:['social_monitor','风险监测']},
    /* 商业数据 · 涉华 */
    {id:'DS-CO-12',name:'中信保(SINOSURE)',cat:'commercial',icon:'💼',desc:'海外投资政治险/违约险数据',coverage:['全球'],cycle:60,rel:'A1',feeds:['economic_risks','企业资产']},
    {id:'DS-CO-13',name:'中国对外投资统计',cat:'commercial',icon:'💼',desc:'ODI存量/流量国别分布',coverage:['全球'],cycle:60,rel:'A2',feeds:['economic_risks','预测分析']},
    {id:'DS-CO-14',name:'中资企业资信库',cat:'commercial',icon:'💼',desc:'中资海外子公司资信变动',coverage:['全球'],cycle:60,rel:'B1',feeds:['enterprise_risks','企业资产']},
    /* 合作哨点 · 涉华 */
    {id:'DS-SE-10',name:'中资企业境外商会',cat:'sentinel',icon:'🎖️',desc:'一带一路商会安全联防',coverage:['非洲','东南亚','中东'],cycle:60,rel:'B1',feeds:['sentinel_report','威胁组织']},
    {id:'DS-SE-11',name:'华人联合会',cat:'sentinel',icon:'🎖️',desc:'侨团治安信息网络(涉华)',coverage:['东南亚','欧美','非洲'],cycle:60,rel:'C1',feeds:['sentinel_report','风险监测']},
    {id:'DS-SE-12',name:'中资安保公司',cat:'sentinel',icon:'🎖️',desc:'驻地武装护卫/撤离服务',coverage:['非洲','中东'],cycle:60,rel:'A2',feeds:['sentinel_report','预警中心']},

    /* ===== 全球新闻媒体数据源注册表 v3.0（2286 条通道） ===== */
    {id:'DS-GM-01',name:'全球新闻媒体监测网',cat:'global_media',icon:'🌍',desc:'2286条通道：190国/地区×12主题(Google News国家聚合)+6家国际主流媒体，全部与中国海外利益安全(A-I九维)关联',coverage:['全球'],cycle:60,rel:'B2',feeds:['global_media','态势总览']}
  ];

  var CATS = {
    official:{label:'官方权威',color:'#e74c3c'},
    intl:{label:'国际组织',color:'#3498db'},
    osint:{label:'开源情报',color:'#00d4ff'},
    media:{label:'新闻媒体',color:'#f39c12'},
    global_media:{label:'全球新闻媒体',color:'#1abc9c'},
    social:{label:'社交监测',color:'#9b59b6'},
    commercial:{label:'商业数据',color:'#2ecc71'},
    sentinel:{label:'合作哨点',color:'#e67e22'}
  };

  /* 数据源 feeds[0] → 采集库(COLLECTED_DB) 分类映射：打通数据源库与采集库 */
  var FEED_TO_CAT = {
    security_events:'security_events', humanitarian:'public_health', economic_risks:'sanctions_data',
    disaster_events:'natural_disasters', conflict_warning:'military_conflicts', terror_events:'terror_events',
    conflict_events:'military_conflicts', osint_intel:'osint_intel', news_intel:'osint_intel',
    global_media:'global_media', social_monitor:'social_unrest', shipping_monitor:'infrastructure',
    enterprise_risks:'sanctions_data', sentinel_report:'security_events', health_events:'public_health',
    geopolitical:'geopolitical_intel'
  };

  /* 实战模式：已移除模拟内容模板（TPL/TPL_CTY）。采集只注入真实抓取数据，绝不模板生成。 */
  /* 重点监控国家（监控覆盖范围参考，非情报数据；真实数据按采集结果统计） */
  var MONITOR_COUNTRIES = ['巴基斯坦','苏丹','缅甸','刚果(金)','尼日利亚','伊拉克','也门','马里','尼日尔','肯尼亚','埃塞俄比亚','秘鲁','墨西哥','南非','伊朗','印度','土耳其','埃及','哥伦比亚','菲律宾','阿富汗','叙利亚','孟加拉国','泰国','阿尔及利亚','阿根廷','智利','委内瑞拉','利比亚','索马里','中非','莫桑比克','坦桑尼亚','赞比亚','津巴布韦','乌克兰','阿联酋','沙特','哈萨克斯坦','蒙古','老挝','柬埔寨','印尼','马来西亚','越南','安哥拉','摩洛哥','突尼斯','约旦','塞尔维亚'];

  /* ========== 运行时状态 ========== */
  var state = {};      /* id -> {status,health,lastT,nextDue,todayN,totalN,boost} */
  var LOG = [];        /* 采集日志流 */
  var flowStats = {};  /* 功能区流向计数 */
  var _timer = null, _fbTimer = null, _inited = false, _uiVisible = false;
  var _totalToday = 0, _startTs = Date.now();

  function pk(a){ return a[Math.floor(Math.random()*a.length)]; }
  function pd(n){ return String(n).padStart(2,'0'); }
  function nowStr(){ var d=new Date(); return pd(d.getHours())+':'+pd(d.getMinutes())+':'+pd(d.getSeconds()); }

  /* ========== 真实抓取池（同源后端 /api/scrape，无 CORS） ========== */
  /* 必须与后端 CAT_TO_SCRAPE 的 12 个分类严格一致，漏一类即整类真实数据抓不到
   * （曾漏 economic_risks，导致 USTR 等经贸风险源采集到的数据前端永远看不到） */
  var REAL_CATS = ['terror_events','security_events','military_conflicts','political_events','natural_disasters','public_health','sanctions_data','social_unrest','infrastructure','geopolitical_intel','osint_intel','economic_risks','global_media'];
  var realPool = {};        /* cat -> [真实条目] */
  var _realTimer = null;
  /* 前端相关性兜底：后端已过滤，此处再拦一层，确保绝不混入无关养生/娱乐内容 */
  var RELEVANT_KW = ['安全','袭击','攻击','冲突','战争','战乱','制裁','政变','抗议','示威','游行','罢工','骚乱','地震','灾害','台风','洪水','疫情','传染病','卫生','疾病','恐怖','绑架','爆炸','危机','风险','外交','地缘','投资','中资','华人','华侨','使馆','撤侨','武装','动荡','港口','基建','能源','关税','债务','边境','军事','国防','海盗','劫持','暴乱','撤离','维和','安保'];
  /* 英文关键词（RT/France24/Bing 等境外真实源为英文，必须能过闸，否则真实数据全被误杀） */
  var RELEVANT_KW_EN = ['attack','security','sanction','conflict','war','strike','protest','riot','unrest','earthquake','quake','disaster','typhoon','hurricane','flood','epidemic','outbreak','virus','terror','kidnap','abduct','explos','blast','bomb','crisis','risk','threat','diplomat','geopolit','china','chinese','beijing','embassy','evacuat','armed','militar','defense','defence','port','infrastructure','energy','tariff','debt','border','pirate','hijack','missile','drone','shoot','killed','dead','death','injur','hostage','coup','clash','tension','warning','alert','seize','detain','arrest','spy','espionage','cyber','hack','iran','gaza','ukraine','strait','navy','troops','rebel','insurg','violence','emergency','fire','crash','collapse'];
  /* 统一 API 基址：优先 APIClient 探测值；file:// 双击打开时回退本地后端，保证采集链路永远可达 */
  function _apiBase(){
    if(typeof APIClient!=='undefined'&&APIClient._baseUrl&&/^https?:/.test(APIClient._baseUrl)) return APIClient._baseUrl;
    if(typeof window!=='undefined'&&window.location&&/^https?:/.test(window.location.origin||'')) return window.location.origin;
    return 'http://localhost:3000';
  }
  function _relevantText(t){
    if(!t) return false;
    for(var i=0;i<RELEVANT_KW.length;i++){ if(t.indexOf(RELEVANT_KW[i])>=0) return true; }
    var low=t.toLowerCase();
    for(var j=0;j<RELEVANT_KW_EN.length;j++){ if(low.indexOf(RELEVANT_KW_EN[j])>=0) return true; }
    return false;
  }
  function _refreshReal(){
    if(_refreshBusy) return;
    _refreshBusy = true;
    /* 90s 强制解锁，防止全量采集超时导致后续周期被永久跳过 */
    var _unlock = setTimeout(function(){ _refreshBusy=false; }, 90000);
    try{
      var base=_apiBase();
      if(!base) return;
      /* 1) 按分类刷新前端 realPool */
      REAL_CATS.forEach(function(cat){
        fetch(base+'/api/scrape?category='+encodeURIComponent(cat),{signal:AbortSignal.timeout(20000)})
          .then(function(r){return r&&r.ok?r.json():null;})
          .then(function(j){
            /* 新数据插队首 + 按稳定键去重（_fillPool 统一实现）：
             * 旧实现 push 到队尾 + 截断，池子一满截掉的恰是刚抓到的新条目；
             * 且用译文标题做键——同一原文经不同翻译通道措辞会漂移，去重失效。 */
            if(j&&j.items&&j.items.length) _fillPool(cat, j.items);
          }).catch(function(){});
      });
      /* 3) 全球海量媒体真实情报（后端 /api/media，每1分钟刷新）—— 接入采集池，
       *    汇入 自动采集 → 入口闸门 → COLLECTED_DB → DBCenter → 预警/态势 全链路。
       *    铁律一：仅填充真实抓取条目；后端缓存为空时静默跳过，绝不伪造。 */
      fetch(base+'/api/media?limit=200',{signal:AbortSignal.timeout(20000)})
        .then(function(r){return r&&r.ok?r.json():null;})
        .then(function(j){
          if(j&&j.ok&&j.items&&j.items.length){
            var norm=j.items.map(function(it){
              return Object.assign({}, it, {
                country: it.country_cn || it.country || '',
                title: it.title_zh || it.title || '',
                url: it.url || '',
                content: it.content || it.content_zh || '',
                _fromSource: it._fromSource || 'GLOBAL_MEDIA'
              });
            });
            var added=_fillPool('osint_intel', norm);
            if(added>0) console.log('[REFRESH] 全球媒体接入采集池 +'+added+' 条');
          }
        }).catch(function(){});
      /* 2) 同时触发全量采集，填充服务端公开缓存（供 pollLive / SSE 读取）
       *    无 PostgreSQL 时，公开端点 /api/intel/public/osint_intel 依赖此缓存。
       *    ★ 2026-08-05 修复：全量结果同时回填 realPool。
       *    原实现只打了条日志就把 277 条已翻译、已按12要素分类的数据丢掉了，
       *    而 realPool 是"消费型"（collect 每次 shift 取走一条），120s 才补一次、
       *    补的又是同标题被去重掉的旧条目 → 池子干涸 → 自动采集表面上"停了"。 */
      fetch(base+'/api/scrape?all=1',{signal:AbortSignal.timeout(90000)})
        .then(function(r){return r&&r.ok?r.json():null;})
        .then(function(j){
          if(j&&j.ok&&j.data){
            var total=0, refill=0, cats=Object.keys(j.data);
            cats.forEach(function(c){
              var arr=j.data[c]||[]; total+=arr.length;
              if(REAL_CATS.indexOf(c)<0) return;
              refill += _fillPool(c, arr);
            });
            if(total>0) console.log('[REFRESH] 全量采集 '+total+' 条(已中文化), 回填实时池 '+refill+' 条, 覆盖 '+cats.length+' 分类');
          }
        }).catch(function(e){});
    }catch(e){}
  }
  /* 统一补池：新条目插队首、按标题去重、上限 150。返回实际新增数 */
  function _fillPool(cat, items){
    if(!items||!items.length) return 0;
    var p = realPool[cat] || (realPool[cat]=[]);
    var seen={}, k, i;
    for(i=0;i<p.length;i++){ k=_poolKey(p[i]); if(k) seen[k]=1; }
    var fresh=[];
    for(i=0;i<items.length;i++){
      k=_poolKey(items[i]);
      if(!k||seen[k]) continue;
      /* 已入过库的不再回池，避免池子被历史条目占满导致新情报挤不进来 */
      if(_consumed[k]) continue;
      seen[k]=1; fresh.push(items[i]);
    }
    if(fresh.length) realPool[cat]=fresh.concat(p).slice(0,150);
    return fresh.length;
  }
  /* 池内去重键：优先英文原标题(翻译通道措辞会漂移，中文标题不稳定) */
  function _poolKey(it){
    if(!it) return '';
    var s = it.title_en || it.url || it.title || '';
    return String(s).replace(/\s+/g,'').slice(0,60);
  }
  var _consumed = {};        /* 已被 collect 消费过的条目键，防重复入库 */
  var _lastRefill = 0;       /* 低水位补池节流时间戳 */
  var _refreshBusy = false;  /* _refreshReal 忙标志，防1分钟周期内请求重叠 */
  /* 池总量 */
  function _poolSize(){
    var n=0; for(var k in realPool){ if(realPool[k]) n+=realPool[k].length; }
    return n;
  }
  /* 低水位自动补池：池子快空时立即拉一次，不必干等 120s */
  function _ensurePool(){
    if(_poolSize() > 20) return;
    var now=Date.now();
    if(now-_lastRefill < 30000) return;   /* 30s 节流，防止空池时疯狂打后端 */
    _lastRefill = now;
    console.log('[REFRESH] 实时池低水位('+_poolSize()+'条), 触发即时补充');
    try{ _refreshReal(); }catch(e){}
  }

  /* ========== 初始化运行时 ========== */
  function bootState(){
    /* 全球新闻媒体聚合源的真实通道数（2286 条），从 SOURCE_REGISTRY 动态读取 */
    var gmChannels = 1;
    try{
      if(typeof SOURCE_REGISTRY!=='undefined' && SOURCE_REGISTRY.global_media && SOURCE_REGISTRY.global_media.sources && SOURCE_REGISTRY.global_media.sources.length>1){
        gmChannels = SOURCE_REGISTRY.global_media.sources.length;
      } else if(typeof window!=='undefined' && window.GLOBAL_MEDIA_REGISTRY && window.GLOBAL_MEDIA_REGISTRY.length>1){
        gmChannels = window.GLOBAL_MEDIA_REGISTRY.length;
      }
    }catch(e){ gmChannels = 2286; }
    REGISTRY.forEach(function(s){
      /* 聚合型数据源用真实通道数加权统计，避免注册 2286 条却只显示 1 条 */
      var realChannels = (s.id==='DS-GM-01') ? gmChannels : 1;
      state[s.id] = {
        status:'online', health: 95,
        lastT:'-', nextDue: Date.now() + Math.random()*s.cycle*1000*0.5,
        /* 实战模式：不虚构历史累计采集量，totalN 从0起算，只统计真实抓取 */
        todayN: 0, totalN: 0,
        boost: 1,
        realChannels: realChannels
      };
    });
  }

  /* ========== 采集执行（活数据核心） ========== */
  function collect(src){
    var st = state[src.id];
    st.lastT = nowStr();
    st.nextDue = Date.now() + (src.cycle/st.boost)*1000;
    /* 官方渠道(国家反恐办/公安部境外安保局/外交部等)：无公开API、未获授权接入。
       诚实原则：绝不以官方名义生成模拟数据 —— 仅作为"通道预留"，只透传真实抓取池数据且改署真实来源 */
    var isOfficial = (src.cat==='official');
    /* 实战模式：不模拟源异常/自愈，状态保持稳定在线（健康度仅反映真实抓取结果） */
    st.status='online';

    var n = 1 + Math.floor(Math.random()*2);
    for(var i=0;i<n;i++){
      var c = '';
      var txt = '';
      var isReal = false;
      /* 真实抓取优先：后端已抓到该分类真实情报则用之（否则跳过，不注入任何数据） */
      try{
        var _cat = FEED_TO_CAT[src.feeds[0]] || 'osint_intel';
        var _pool = realPool[_cat];
        if(_pool && _pool.length){
          var _ri = _pool.shift();
          try{ var _ck=_poolKey(_ri); if(_ck) _consumed[_ck]=1; }catch(e){}
          /* 硬网关：仅通过 chinaOverseasGate 的"中国海外利益安全"相关条目才入库 */
          var _gatePass = (typeof GATE!=='undefined' && GATE.chinaOverseasGate) ? GATE.chinaOverseasGate(_ri.title+' '+(_ri.content||'')).pass : _relevantText(_ri.title+' '+(_ri.content||''));
          if(_ri && _ri.title && _gatePass){
            txt = _ri.title;
            isReal = true;
            if(_ri.country) c = _ri.country; else c = '';   /* 无国家不瞎编，避免"巴基斯坦-护肝习惯" */
          }
        }
      }catch(e){}
      /* 无任何真实抓取数据时，直接跳过（绝不以模板生成模拟情报） */
      if(!isReal) continue;
      st.todayN++; st.totalN++; _totalToday++; _markCollected();
      var dest = src.feeds[1] || '态势总览';
      flowStats[dest] = (flowStats[dest]||0)+1;
      LOG.unshift({t:nowStr(), src:src.name, icon:src.icon, cat:src.cat, txt:txt, cty:c, dest:dest, rel:src.rel});
      if(LOG.length>80) LOG.length=80;

      /* 联动闭环③：每条采集入库 —— 写入采集库(待审核)，打通 数据源库↔自动采集↔审核↔全系统
         注意：只入采集库（→自动镜像到数据中心 pending），绝不直注预警中心。
         预警中心的唯一入口 = 数据中心审核通过后分发（审核总闸）。 */
      try{
        if(typeof COLLECTED_DB!=='undefined' && typeof COLLECTED_DB.add==='function'){
          var _cat2 = FEED_TO_CAT[src.feeds[0]] || 'osint_intel';
          var _ttl2 = (isReal ? txt : src.name+'：'+txt);
          /* 涉华安全类必须真实命中中国要素，否则降级为开源情报 */
          if (_cat2 === 'security_events') {
            var _chinaSig = /中国|中资|中企|中方|华人|华侨|华裔|涉华|对华|一带一路|驻华|访华|Chinese|China|Beijing|Belt and Road|CPEC/i.test(_ttl2+' '+(_ri && _ri.content || ''));
            if (!_chinaSig) _cat2 = 'osint_intel';
          }
          if(!_dupInCollected(_cat2,_ttl2) && COLLECTED_DB.count(_cat2) < 400){
            COLLECTED_DB.add(_cat2, {
              title: _ttl2,
              /* 落库即中文（铁律三）：后端已把 title 覆盖为译文，
                 title_zh/title_en 必须一并透传，否则数据中心丢失原文溯源。 */
              title_zh: (_ri && _ri.title_zh) || '',
              title_en: (_ri && _ri.title_en) || '',
              content_zh: (_ri && _ri.content_zh) || '',
              content_en: (_ri && _ri.content_en) || '',
              country: c,
              /* 无正文时不再编造"数据源「XX」采集"占位文本（2026-08-13：占位文本会污染预警描述），直接用标题兜底 */
              content: (_ri && _ri.content) ? _ri.content : txt,
              /* 来源铁律（2026-08-30）：真实条目必须署真实来源——用后端返回的 it.source，
               * 绝不套用当前轮到的注册源名（src.name）。否则"中国要求塔吉克斯坦保护公民"
               * 这类 Google News 真实新闻会被错标为"Shodan物联网探测"等风马牛不相及的源。 */
              source: (_ri && _ri.source) ? _ri.source : '实时采集',
              severity: (isReal && _ri && _ri.severity ? _ri.severity : '中'),
              category: (src.feeds[1]||'采集'),
              data_type: _cat2,
              enterprise: '',
              url: (_ri && _ri.url) || '',
              tags: [c, src.feeds[1]||''],
              /* 关联标记必须透传，否则 _ingestApproved 入口会丢失 interestLinked 导致实时数据被拦截 */
              interestLinked: (_ri && _ri.interestLinked === true) ? true : undefined,
              chinaRelated: !!(_ri && _ri.chinaRelated),
              chinaNegative: !!(_ri && _ri.chinaNegative),
              _fromSource: src.id,
              _real: isReal ? true : false,
              _sim: false
            });
          }
        }
      }catch(e){}
    }
    if(_uiVisible) renderDynamic();
  }

  /* 调度器：每5秒检查到期源 */
  function tick(){
    var now = Date.now();
    REGISTRY.forEach(function(s){ if(now >= state[s.id].nextDue) collect(s); });
    /* 池子被消费空后立即补充，而不是干等下一个 120s 周期 */
    _ensurePool();
  }

  /* 联动闭环②：风险反馈调频 —— 高危国家的预警多 → 覆盖源自动加速 */
  function feedback(){
    var hotCty = {};
    /* 从实时预警红/橙国家 + COUNTRIES 综合风险>=7 的国家 共同决定热点 */
    var la = (typeof LIVE_ALERTS!=='undefined') ? LIVE_ALERTS : [];
    la.slice(0,60).forEach(function(a){ if(a.level==='red'||a.level==='orange') hotCty[a.country]=1; });
    try{
      if(typeof COUNTRIES!=='undefined'){
        COUNTRIES.forEach(function(c){
          if(typeof calcOverall==='function' && calcOverall(c.scores)>=7.0) hotCty[c.name]=1;
        });
      }
    }catch(e){}
    var hotRegions = {'中东':['伊拉克','也门','伊朗','叙利亚','黎巴嫩','以色列','巴勒斯坦'],'非洲':['苏丹','马里','尼日尔','尼日利亚','刚果(金)','肯尼亚','埃塞俄比亚','索马里','喀麦隆','乍得'],'南亚':['巴基斯坦','阿富汗','印度','孟加拉国','斯里兰卡'],'东南亚':['缅甸','泰国','菲律宾','印度尼西亚'],'拉美':['墨西哥','哥伦比亚','秘鲁','委内瑞拉','巴西'],'东欧':['乌克兰','白俄罗斯','俄罗斯']};
    REGISTRY.forEach(function(s){
      var st = state[s.id], hit=false;
      if(s.coverage.indexOf('全球')>=0 || s.coverage.indexOf('高危国家')>=0 || s.coverage.indexOf('项目所在国')>=0){
        hit = Object.keys(hotCty).length>0;
      } else {
        s.coverage.forEach(function(rg){
          (hotRegions[rg]||[rg]).forEach(function(cc){ if(hotCty[cc]) hit=true; });
        });
      }
      var baseBoost = hit ? 2 : 1;
      /* 健康度联动：优质源额外加速，劣质源降速（自我净化+资源再分配） */
      if(st.health>=85) baseBoost *= 1.3;
      else if(st.health<40) baseBoost *= 0.6;
      st.boost = Math.round(baseBoost*10)/10;
      if(st.boost>3) st.boost=3;
    });
    if(_uiVisible) renderDynamic();
  }

  /* 去重：同一分类下标题归一化后已存在则视为重复（防止采集库无限膨胀/重复数据） */
  function _dupInCollected(cat,title){
    try{
      var k=(typeof _normTitle==='function')?_normTitle(title):String(title||'').toLowerCase().replace(/\s+/g,'');
      if(!k) return false;
      return COLLECTED_DB.getAll(cat).some(function(d){ return ((typeof _normTitle==='function')?_normTitle(d.title||''):String(d.title||'').toLowerCase().replace(/\s+/g,''))===k; });
    }catch(e){ return false; }
  }

  /* 供"自动采集"按钮调用：立即从全部注册源采集一轮进入采集库（数据源库 ↔ 自动采集 相通） */
  function contributeBurst(){
    var n=0;
    REGISTRY.forEach(function(s){
      var c = '';
      var txt = '';
      var isReal = false;
      /* 真实抓取优先：该分类有真实情报则用之；否则跳过（绝不模板生成模拟情报） */
      try{
        var _cat = FEED_TO_CAT[s.feeds[0]] || 'osint_intel';
        var _pool = realPool[_cat];
        if(_pool && _pool.length){
          var _ri = _pool.shift();
          /* 硬网关：仅通过 chinaOverseasGate 的"中国海外利益安全"相关条目才入库 */
          var _gatePass = (typeof GATE!=='undefined' && GATE.chinaOverseasGate) ? GATE.chinaOverseasGate(_ri.title+' '+(_ri.content||'')).pass : _relevantText(_ri.title+' '+(_ri.content||''));
          if(_ri && _ri.title && _gatePass){
            txt = _ri.title;
            if(_ri.country) c = _ri.country; else c = '';
            isReal = true;
          }
        }
      }catch(e){}
      if(!isReal) return;   /* 跳过：无真实数据则绝不以模板生成模拟情报 */
      try{
        if(typeof COLLECTED_DB!=='undefined' && typeof COLLECTED_DB.add==='function'){
          var _cat = FEED_TO_CAT[s.feeds[0]] || 'osint_intel';
          /* 来源铁律（2026-08-30）：真实条目标题不加注册源前缀、来源署真实源（it.source），
           * 注册源关联只记在 _fromSource 字段，不再污染标题与来源展示。 */
          var _ttl = txt;
          /* 去重 + 单类上限，防止采集库无限膨胀 */
          if(!_dupInCollected(_cat,_ttl) && COLLECTED_DB.count(_cat) < 400){
            COLLECTED_DB.add(_cat, {
              title: _ttl, country:c,
              content: txt,
              source: (_ri && _ri.source) ? _ri.source : '实时采集', severity:(isReal && _ri && _ri.severity ? _ri.severity : '中'),
              category:(s.feeds[1]||'采集'), data_type:_cat, enterprise:'', url:'',
              tags:[c, s.feeds[1]||''], _fromSource:s.id,
              interestLinked: (_ri && _ri.interestLinked === true) ? true : undefined,
              chinaRelated: !!(_ri && _ri.chinaRelated), chinaNegative: !!(_ri && _ri.chinaNegative)
            });
            n++;
          }
        }
      }catch(e){}
      /* 注意：采集数据一律先进采集库→数据中心(待审核)，审核通过才入预警中心，不再绕过审核直注实时流 */
    });
    console.log('[DATASOURCES] 自动采集触发: 从 '+REGISTRY.length+' 个源采集 '+n+' 条真实情报进入采集库');
    return n;
  }

  /* ========== 一键自动采集：拉取全量真实情报并注入全系统 ========== */
  async function realBurst(){
    try{
      var base=_apiBase();
      if(!base) return 0;
      console.log('[REALBURST] 一键采集：从后端拉取全部分类真实情报...');
      var r=await fetch(base+'/api/scrape?all=1',{signal:AbortSignal.timeout(60000)});
      if(!r.ok) return 0;
      var j=await r.json();
      var data=j.data||{};
      var cats=Object.keys(data);
      if(!cats.length) return 0;
      var n=0, alerts=0;
      cats.forEach(function(cat){
        (data[cat]||[]).forEach(function(it){
          if(!it||!it.title) return;
          /* 硬网关：仅"中国海外利益安全"相关条目入库（二次把关） */
          var _gp=(typeof GATE!=='undefined'&&GATE.chinaOverseasGate)?GATE.chinaOverseasGate(it.title+' '+(it.content||'')).pass:_relevantText(it.title+' '+(it.content||''));
          if(!_gp) return;
          var country=it.country||'';
          var _ttl=(it.source?it.source+'：':'')+it.title;
          try{
            if(typeof COLLECTED_DB!=='undefined'&&typeof COLLECTED_DB.add==='function'){
              if(!_dupInCollected(cat,_ttl) && COLLECTED_DB.count(cat)<400){
                COLLECTED_DB.add(cat,{ title:_ttl, country:country, content:it.content||it.title, source:it.source||'实时采集', severity:it.severity||'中', category:(it.source||'安全风险'), data_type:cat, enterprise:'', url:it.url||'', tags:[country].filter(Boolean), _fromSource:'REALBURST', _real:true, interestLinked:it.interestLinked===true?true:undefined, chinaRelated:!!it.chinaRelated, chinaNegative:!!it.chinaNegative });
                n++;
              }
            }
          }catch(e){}
        });
      });
      /* 数据流（用户定版）：一键采集数据一律先进采集库(pending 待审核)，
       * 人工审核通过 → 转入数据库 → 15s 自循环分发 → 预警中心/态势感知。不绕过审核。 */
      console.log('[REALBURST] 一键采集完成：入库真实情报 '+n+' 条（覆盖 '+cats.length+' 个分类，自动审核并实时分发）');
      return n;
    }catch(e){ console.warn('[REALBURST] 失败(无真实数据回退):', e.message); return 0; }
  }

  /* ========== 特种兵全网爬虫：一键采集核心（突破注册源，全球海外利益安全信息） ==========
   * 与 realBurst(底座) 的区别：realBurst 拉的是"注册数据源"(常规力量)；
   * crawlBurst 调用后端 crawler.js 对全网(搜索引擎/社交/各国媒体)做深度抓取(特种兵)。
   * 数据流（用户定版）：后端按12要素自动分类 → 采集库(pending待审核) → 人工审核通过
   * → 转入数据库 → _approvedSyncScan(15s)自循环分发 → 预警中心/态势感知/全功能区。 */
  async function crawlBurst(){
    try{
      var base=_apiBase();
      if(!base) return 0;
      console.log('[CRAWLBURST] 特种兵爬虫出动：一键全网深抓(涉华负面+各国媒体+社交)...');
      var r=await fetch(base+'/api/crawl?all=1',{signal:AbortSignal.timeout(90000)});
      if(!r.ok) return 0;
      var j=await r.json();
      var items=j.items||[];
      if(!items.length) return 0;
      /* ── 数据流（用户定版）：爬虫 → 采集库(待审核 pending) → 人工审核通过 → 转入数据库
       *    → _approvedSyncScan(15s) 自动分发 → 预警中心/态势感知/全功能区。
       *    绝不绕过审核直接注入预警——审核环节就是功能区联通的总闸。 ── */
      var VALID_TYPES={terror_events:1,security_events:1,military_conflicts:1,political_events:1,
        natural_disasters:1,public_health:1,sanctions_data:1,social_unrest:1,
        infrastructure:1,geopolitical_intel:1,osint_intel:1};
      var TYPE_LABEL={terror_events:'恐袭事件',security_events:'涉华安全',military_conflicts:'武装冲突',
        political_events:'政治风险',natural_disasters:'自然灾害',public_health:'公共卫生',
        sanctions_data:'制裁合规',social_unrest:'社会动荡',infrastructure:'基础设施',
        geopolitical_intel:'地缘情报',osint_intel:'开源情报'};
      var n=0, cnN=0, catStat={};
      items.forEach(function(it){
        if(!it||!it.title) return;
        /* 后端已过闸门+自动分类；前端兜底：硬网关 chinaOverseasGate 作为权威最后一道闸 */
        var _gp=(typeof GATE!=='undefined'&&GATE.chinaOverseasGate)?GATE.chinaOverseasGate(it.title+' '+(it.content||'')).pass:(it.chinaNegative||it.chinaRelated||_relevantText(it.title+' '+(it.content||'')));
        if(!_gp) return;
        var country=it.country||'';
        var dt=(it.data_type||it.category);
        if(!VALID_TYPES[dt]) dt='osint_intel';
        var _ttl=(it.platform?it.platform+'：':'')+it.title;
        try{
          if(typeof COLLECTED_DB!=='undefined'&&typeof COLLECTED_DB.add==='function'){
            if(!_dupInCollected(dt,_ttl) && COLLECTED_DB.count(dt)<400){
              COLLECTED_DB.add(dt,{
                title:(it.platform?it.platform+'：':'')+it.title, country:country,
                content:it.content||it.title, source:it.source||'特种兵爬虫',
                severity:it.severity||(it.chinaNegative?'高':'中'),
                category:TYPE_LABEL[dt]||'开源情报',
                data_type:dt, enterprise:'', url:it.url||'',
                tags:[country,it.platform,TYPE_LABEL[dt]].filter(Boolean),
                _real:true, _crawler:true, chinaNegative:!!it.chinaNegative,
                interestLinked:it.interestLinked===true?true:undefined, chinaRelated:!!it.chinaRelated
              });
              n++; catStat[TYPE_LABEL[dt]]=(catStat[TYPE_LABEL[dt]]||0)+1;
              if(it.chinaNegative) cnN++;
            }
          }
        }catch(e){}
      });
      console.log('[CRAWLBURST] 特种兵返回：'+n+' 条已按要素分类入库（涉华负面 '+cnN+' 条）｜分布: '+JSON.stringify(catStat));
      console.log('[CRAWLBURST] 数据流：采集 → 入口闸门 → DBCenter自动审核 → _ingestApproved实时分发 → 预警中心/态势感知');
      if(typeof showToast==='function'&&n>0){ try{ showToast('🕷️ 特种兵爬虫入库 '+n+' 条（已按12要素分类，自动审核并实时分发）'); }catch(e){} }
      return n;
    }catch(e){ console.warn('[CRAWLBURST] 失败(无真实数据回退):', e.message); return 0; }
  }

  /* ========== 引擎启动（全局，与UI无关，保证系统活） ========== */
  function startEngine(){
    if(_timer) return;
    bootState();
    _timer = setInterval(tick, 5000);
    _fbTimer = setInterval(feedback, 60000);
    setTimeout(feedback, 8000);
    /* 真实抓取：启动即拉一次 + 每1分钟刷新真实情报池（后端同源，无CORS） */
    try{ _refreshReal(); }catch(e){}
    if(_realTimer) clearInterval(_realTimer);
    _realTimer = setInterval(_refreshReal, 60000);
    /* 顶栏实时采集状态 */
    _updateLiveStatus();
    if(_statusTimer) clearInterval(_statusTimer);
    _statusTimer = setInterval(_updateLiveStatus, 5000);
    console.log('[DATASOURCES] 数据源引擎启动: '+REGISTRY.length+'个源, 5s调度, 60s风险反馈调频, 真实抓取池每1分钟刷新');
  }

  /* ========== 实时采集状态（顶栏可见性 + 手动触发） ========== */
  var _lastCollectTime = 0;
  function _fmtClock(d){ function p(n){ return (n<10?'0':'')+n; } return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }
  function _updateLiveStatus(){
    try{
      var el=document.getElementById('live-collect-text');
      if(!el) return;
      var total=_totalToday||0;
      var pool=_poolSize();
      var last=_lastCollectTime ? ('最近 '+_fmtClock(new Date(_lastCollectTime))) : '尚未采集';
      el.textContent='实时采集：本次会话已采 '+total+' 条 · 池 '+pool+' 条 · '+last;
    }catch(e){}
  }
  function _markCollected(){ _lastCollectTime=Date.now(); _updateLiveStatus(); }
  /* 手动"立即采集"：立即补池 + 马上消费池内条目入库（不等下一个5s tick），让数据即时可见 */
  function collectNow(){
    try{ _lastRefill=0; _refreshReal(); }catch(e){}
    try{
      var n=0;
      for(var pass=0; pass<30; pass++){
        var picked=null;
        for(var i=0;i<REGISTRY.length;i++){
          var s=REGISTRY[i];
          var cat=FEED_TO_CAT[s.feeds[0]]||'osint_intel';
          var pool=realPool[cat];
          if(pool&&pool.length){ picked=s; break; }
        }
        if(!picked) break;
        collect(picked); n++;
      }
      if(n) _markCollected();
      console.log('[COLLECT-NOW] 手动触发采集 '+n+' 条');
    }catch(e){}
    _updateLiveStatus();
    return '已触发采集';
  }

  /* ========== UI ========== */
  function relColor(r){ return r[0]==='A'?'var(--green)':r[0]==='B'?'var(--cyan)':'var(--orange)'; }

  function render(){
    var el = document.getElementById('view-datasources');
    if(!el) return;
    _uiVisible = true;
    var cats = Object.keys(CATS);
    el.innerHTML =
      /* 全球社交媒体采集（SOCMINT）面板：与全网数据并列为本视图两大采集工具 */
      (window.SOCMINT?'<div style="margin-bottom:12px">'+SOCMINT.panelHtml()+'</div>':'')+
      '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:12px" id="ds-stats"></div>'+
      '<div style="display:grid;grid-template-columns:1.6fr 1fr;gap:12px">'+
        '<div class="card" style="padding:12px">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">'+
            '<b style="color:var(--cyan);font-size:13px">📚 数据源注册表</b>'+
            '<div id="ds-cattabs" style="display:flex;gap:4px;margin-left:auto;flex-wrap:wrap">'+
              '<span class="ds-tab" data-cat="all" style="cursor:pointer;font-size:10px;padding:2px 8px;border-radius:10px;background:var(--cyan);color:#000;font-weight:700">全部</span>'+
              cats.map(function(c){return '<span class="ds-tab" data-cat="'+c+'" style="cursor:pointer;font-size:10px;padding:2px 8px;border-radius:10px;background:var(--panel2);color:var(--text2);border:1px solid var(--border)">'+CATS[c].label+'</span>';}).join('')+
            '</div>'+
          '</div>'+
          '<div id="ds-table" style="max-height:520px;overflow-y:auto"></div>'+
        '</div>'+
        '<div class="card" style="padding:12px;grid-column:1/-1">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
            '<b style="color:var(--cyan);font-size:13px">🌐 国际情报源接入状态</b>'+
            '<span id="ds-intl-sum" style="font-size:10px;color:var(--text3)">读取中…</span>'+
            '<span style="margin-left:auto;font-size:9px;color:var(--text3)">状态由后端真实抓取结果生成，未接通即如实标注，不做任何填充</span>'+
          '</div>'+
          '<div id="ds-intl" style="max-height:300px;overflow-y:auto"></div>'+
        '</div>'+
        '<div class="card" style="padding:12px;grid-column:1/-1">'+
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">'+
            '<b style="color:var(--cyan);font-size:13px">🔌 AgentKey 深度采集</b>'+
            '<span id="ak-status" style="font-size:10px;color:var(--text3)">状态读取中…</span>'+
            '<span style="margin-left:auto;font-size:9px;color:var(--text3)">经 AgentKey 连接器拉取真实全文情报（标题+完整正文+来源+URL）；未配置密钥时回退内置真实种子库</span>'+
          '</div>'+
          '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">'+
            '<input id="ak-queries" placeholder="关键词，用 | 分隔，如 Afghanistan attack | Pakistan China security" style="flex:1;min-width:260px;background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:8px;font-size:12px"/>'+
            '<button id="ak-collect" style="background:var(--cyan);color:#000;border:none;padding:6px 14px;border-radius:8px;font-weight:700;cursor:pointer">⚡ 一键深度采集</button>'+
          '</div>'+
          '<div id="ak-results" style="max-height:380px;overflow-y:auto"></div>'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:12px">'+
          '<div class="card" style="padding:12px;flex:1">'+
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
              '<b style="color:var(--cyan);font-size:13px">🌍 全球媒体监测状态</b>'+
              '<span id="ds-gm-status" style="font-size:10px;color:var(--text3)">读取中…</span>'+
            '</div>'+
            '<div id="ds-gm-panel" style="max-height:250px;overflow-y:auto"></div>'+
          '</div>'+
        '</div>'+
      '</div>';
    el.querySelectorAll('.ds-tab').forEach(function(tb){
      tb.onclick = function(){
        el.querySelectorAll('.ds-tab').forEach(function(x){ x.style.background='var(--panel2)'; x.style.color='var(--text2)'; x.style.fontWeight='400'; });
        tb.style.background='var(--cyan)'; tb.style.color='#000'; tb.style.fontWeight='700';
        _catFilter = tb.dataset.cat; renderTable();
      };
    });
    renderDynamic();
    _startIntlPolling();
    _startAgentKeyPanel();
    /* 加载社交通道健康台账（全球社交媒体采集工具） */
    if(window.SOCMINT){ try{ SOCMINT.loadChannels(); }catch(e){} }
  }

  var _catFilter = 'all';

  function renderStats(){
    var box = document.getElementById('ds-stats'); if(!box) return;
    var registered=0, online=0, boost=0;
    REGISTRY.forEach(function(s){
      var rc = (state[s.id] && state[s.id].realChannels) || 1;
      registered += rc;
      if(state[s.id].status==='online') online += rc;
      if(state[s.id].boost>1) boost += rc;
    });
    var rate = (_totalToday / Math.max(1,(Date.now()-_startTs)/60000)).toFixed(1);
    var ctySet={}; MONITOR_COUNTRIES.forEach(function(c){ctySet[c]=1;});
    var items=[
      {n:registered,l:'注册数据源',c:'var(--cyan)'},
      {n:online,l:'在线源',c:'var(--green)'},
      {n:_totalToday,l:'本次会话采集',c:'var(--cyan)'},
      {n:rate+'/min',l:'实时流速',c:'var(--yellow)'},
      {n:boost,l:'⚡加速中的源',c:'var(--orange)'},
      {n:Object.keys(ctySet).length,l:'覆盖重点国家',c:'var(--purple,#b366ff)'}
    ];
    box.innerHTML = items.map(function(it){
      return '<div class="card" style="padding:10px;text-align:center"><div style="font-size:20px;font-weight:700;color:'+it.c+'">'+it.n+'</div><div style="font-size:10px;color:var(--text3)">'+it.l+'</div></div>';
    }).join('');
  }

  function renderTable(){
    var box = document.getElementById('ds-table'); if(!box) return;
    var list = REGISTRY.filter(function(s){ return _catFilter==='all'||s.cat===_catFilter; });
    box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11px">'+
      '<tr style="color:var(--text3);font-size:10px;text-align:left"><th style="padding:4px">数据源</th><th>类别</th><th>可靠性</th><th>周期</th><th>健康度</th><th>本次采集</th><th>状态</th></tr>'+
      list.map(function(s){
        var st = state[s.id];
        var eff = Math.round(s.cycle/st.boost);
        var stColor = st.status==='online'?'var(--green)':'var(--orange)';
        var stLabel = st.status==='online'?'在线':'降级';
        /* 官方渠道：无公开API、未授权接入 —— 诚实标注"通道预留"，不伪装在线采集 */
        if(s.cat==='official'){ stColor='var(--text3)'; stLabel='通道预留'; }
        return '<tr style="border-top:1px solid var(--border)">'+
          '<td style="padding:6px 4px"><span style="margin-right:4px">'+s.icon+'</span><b style="color:var(--text)">'+s.name+'</b>'+(st.boost>1?' <span style="color:var(--orange);font-size:9px;animation:livePulse 1.2s infinite">⚡加速</span>':'')+'<div style="color:var(--text3);font-size:9px">'+s.desc+' → '+(s.feeds[1]||'')+'</div></td>'+
          '<td><span style="color:'+CATS[s.cat].color+';font-size:10px">'+CATS[s.cat].label+'</span></td>'+
          '<td><b style="color:'+relColor(s.rel)+'">'+s.rel+'</b></td>'+
          '<td style="color:var(--text2)">'+eff+'s'+(st.boost>1?'<s style="color:var(--text3);font-size:9px;margin-left:2px">'+s.cycle+'s</s>':'')+'</td>'+
          '<td><div style="width:44px;height:5px;background:var(--panel2);border-radius:3px;display:inline-block"><div style="width:'+st.health+'%;height:5px;border-radius:3px;background:'+(st.health>75?'var(--green)':st.health>50?'var(--yellow)':'var(--red)')+'"></div></div> <span style="font-size:9px;color:var(--text3)">'+st.health+'</span></td>'+
          '<td><b style="color:var(--cyan)">'+st.todayN+'</b> <span style="color:var(--text3);font-size:9px">/累计'+st.totalN+'</span></td>'+
          '<td><span class="pulse-dot" style="background:'+stColor+';display:inline-block;width:6px;height:6px;border-radius:50%"></span> <span style="color:'+stColor+';font-size:10px">'+stLabel+'</span><div style="font-size:9px;color:var(--text3)">'+st.lastT+'</div></td>'+
        '</tr>';
      }).join('')+'</table>';
  }

  /* 国际情报源接入状态：直接读后端 /api/sources 的真实健康快照。
   * online=本轮真实抓到条目；reserved=通道已注册但国内直连不通/需授权，按指数退避周期重试；
   * offline=可达性异常；idle=尚未轮询。全部为实测结果，不做任何美化或填充。 */
  var _intlTimer = null;
  function renderIntlSources(){
    var box = document.getElementById('ds-intl'); if(!box) return;
    var base = _apiBase();
    if(!base){ box.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">后端未连接，无法读取国际源状态</div>'; return; }
    fetch(base+'/api/sources',{signal:AbortSignal.timeout(12000)})
      .then(function(r){return r&&r.ok?r.json():null;})
      .then(function(j){
        if(!j||!j.sources){ box.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">暂无源状态数据</div>'; return; }
        var S={online:{l:'在线供数',c:'var(--green)'},reserved:{l:'通道预留·重试中',c:'var(--text3)'},
               offline:{l:'不可达',c:'var(--orange)'},idle:{l:'待轮询',c:'var(--text3)'}};
        var sum=document.getElementById('ds-intl-sum');
        if(sum) sum.textContent='共 '+j.stat.total+' 源 ｜ 在线 '+j.stat.online+' ｜ 预留 '+j.stat.reserved+
          ' ｜ 不可达 '+j.stat.offline+' ｜ 本轮真实条目 '+j.stat.items;
        var order={online:0,offline:1,idle:2,reserved:3};
        var list=j.sources.slice().sort(function(a,b){
          if(order[a.status]!==order[b.status]) return order[a.status]-order[b.status];
          return (b.items||0)-(a.items||0);
        });
        box.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:11px">'+
          '<tr style="color:var(--text3);font-size:10px;text-align:left"><th style="padding:4px">情报源</th><th>类别</th><th>通道</th><th>本轮条目</th><th>响应</th><th>状态</th><th>最近成功</th></tr>'+
          list.map(function(s){
            var m=S[s.status]||S.idle;
            return '<tr style="border-top:1px solid var(--border)">'+
              '<td style="padding:5px 4px"><b style="color:var(--text)">'+s.name+'</b><div style="color:var(--text3);font-size:9px">'+String(s.id)+'</div></td>'+
              '<td style="color:var(--text2);font-size:10px">'+s.category+'</td>'+
              '<td style="font-size:10px;color:'+(s.tier==='live'?'var(--cyan)':'var(--text3)')+'">'+(s.tier==='live'?'直连':'预留')+'</td>'+
              '<td><b style="color:'+(s.items>0?'var(--cyan)':'var(--text3)')+'">'+(s.items||0)+'</b></td>'+
              '<td style="color:var(--text3);font-size:10px">'+(s.ms?s.ms+'ms':'-')+'</td>'+
              '<td><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:'+m.c+'"></span> <span style="color:'+m.c+';font-size:10px">'+m.l+'</span>'+
                (s.err?'<div style="font-size:9px;color:var(--text3)">'+String(s.err).slice(0,28)+'</div>':'')+'</td>'+
              '<td style="color:var(--text3);font-size:9px">'+(s.lastOk?String(s.lastOk).slice(5,16).replace('T',' '):'—')+'</td>'+
            '</tr>';
          }).join('')+'</table>';
      }).catch(function(){
        box.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">源状态读取失败（后端未启动或不可达）</div>';
      });
  }

  function renderLog(){
    var box = document.getElementById('ds-log'); if(!box) return;
    if(!LOG.length){ box.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px;text-align:center">等待首轮采集...</div>'; return; }
    box.innerHTML = LOG.slice(0,30).map(function(l){
      return '<div style="padding:5px 2px;border-bottom:1px solid var(--border);font-size:10px;line-height:1.4">'+
        '<span style="color:var(--cyan);font-family:monospace">'+l.t+'</span> '+l.icon+' '+
        '<b style="color:'+CATS[l.cat].color+'">'+l.src+'</b> '+
        '<span style="color:'+relColor(l.rel)+';font-size:9px">['+l.rel+']</span><br>'+
        '<span style="color:var(--text2)">'+l.txt+'</span> '+
        '<span style="color:var(--text3);font-size:9px">→ '+l.dest+'</span>'+
      '</div>';
    }).join('');
  }

  function renderFlow(){
    var box = document.getElementById('ds-flow'); if(!box) return;
    var dests = Object.keys(flowStats).sort(function(a,b){return flowStats[b]-flowStats[a];});
    var liveN = (typeof LIVE_ALERTS!=='undefined')?LIVE_ALERTS.length:0;
    var boostN = REGISTRY.filter(function(s){return state[s.id].boost>1;}).length;
    box.innerHTML =
      '<div style="font-size:10px;line-height:1.7">'+
      '<div style="color:var(--text2)">① 采集入库: <b style="color:var(--cyan)">'+_totalToday+'</b> 条 → 主题库</div>'+
      (dests.length? '<div style="padding-left:10px">'+dests.map(function(d){
        var w = Math.min(100, flowStats[d]/Math.max(1,_totalToday)*100*2);
        return '<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="color:var(--text3);width:64px;font-size:9px">'+d+'</span><div style="flex:1;height:5px;background:var(--panel2);border-radius:3px"><div style="width:'+w+'%;height:5px;background:var(--cyan);border-radius:3px"></div></div><b style="color:var(--cyan);font-size:9px">'+flowStats[d]+'</b></div>';
      }).join('')+'</div>' : '')+
      '<div style="color:var(--text2)">② 升级预警: <b style="color:var(--orange)">'+liveN+'</b> 条实时预警在全系统流转</div>'+
      '<div style="color:var(--text2)">③ 风险反馈: 红/橙预警国家 → <b style="color:var(--orange)">'+boostN+'</b> 个源自动加速采集(周期减半)</div>'+
      '<div style="color:var(--green)">④ 闭环: 加速采集 → 更多情报 → 更快预警 ⟳ 系统持续自我驱动</div>'+
      '</div>';
  }

  function renderGlobalMediaStatus(){
    var box=document.getElementById('ds-gm-panel'); if(!box) return;
    var base=_apiBase(); if(!base){ box.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">后端未连接</div>'; return; }
    fetch(base+'/api/media?status=1',{signal:AbortSignal.timeout(12000)})
      .then(function(r){return r&&r.ok?r.json():null;})
      .then(function(j){
        if(!j||!j.ok){ box.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">暂无状态</div>'; return; }
        var status=document.getElementById('ds-gm-status'); if(status) status.textContent='数据源 '+j.sources+' 个 / 覆盖 '+j.distinctCountries+' 国 / 缓存 '+j.total+' 条';
        var items=(j.itemCountries||[]).slice(0,30);
        var html='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">'+
          items.map(function(c){return '<span style="font-size:10px;padding:2px 8px;background:var(--panel2);border:1px solid var(--border);border-radius:10px;color:var(--text2)">'+c+'</span>';}).join('')+
        '</div>'+
        '<div style="font-size:10px;color:var(--text3);line-height:1.6">'+
          '<div>配置国家：'+j.countries+' 个</div>'+
          '<div>最近更新：'+(j.updatedAt?new Date(j.updatedAt).toLocaleString('zh-CN'):'—')+'</div>'+
          '<div>数据状态：后端每 12 分钟自动刷新，实时入数据库系统</div>'+
        '</div>';
        box.innerHTML=html;
      }).catch(function(){ box.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">读取失败</div>'; });
  }
  function renderDynamic(){ renderStats(); renderTable(); renderGlobalMediaStatus(); }
  /* 国际源状态面板独立节流刷新（30s）：避免跟随 5s 主循环高频打后端 */
  function _startIntlPolling(){
    try{ renderIntlSources(); renderGlobalMediaStatus(); }catch(e){}
    if(_intlTimer) clearInterval(_intlTimer);
    _intlTimer = setInterval(function(){
      if(document.getElementById('ds-intl')) { try{ renderIntlSources(); }catch(e){} }
      if(document.getElementById('ds-gm-panel')) { try{ renderGlobalMediaStatus(); }catch(e){} }
    }, 30000);
  }

  /* AgentKey 深度采集面板：经 AgentKey 连接器拉取真实详细全文情报，
   * 满足用户要求"数据要详细（标题+完整正文+来源+URL），并可直接入库/翻译" */
  function _startAgentKeyPanel(){
    var statusBox=document.getElementById('ak-status');
    var resBox=document.getElementById('ak-results');
    var input=document.getElementById('ak-queries');
    var btn=document.getElementById('ak-collect');
    if(!statusBox||!btn) return;
    function _esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _catLabel(c){
      var M={terror_events:'恐怖事件',military_conflicts:'军事冲突',security_events:'安全事件',political_events:'政治事件',social_unrest:'社会动荡',natural_disasters:'自然灾害',public_health:'公共卫生',sanctions_data:'制裁数据',infrastructure:'基础设施',geopolitical_intel:'地缘情报',osint_intel:'开源情报',economic_risks:'经济风险',global_media:'全球新闻媒体'};
      return M[c]||c;
    }
    function _mapCat(c){ return c==='economic_risks'?'geopolitical_intel':c; }
    function _toast(m){ if(typeof showToast==='function') showToast(m); }
    function _renderStatus(st){
      if(!st){ statusBox.textContent='状态未知'; return; }
      var s=st.search&&st.search.length?st.search.join(' / '):'未配置';
      var sc=st.scrape&&st.scrape.length?st.scrape.join(' / '):'未配置';
      statusBox.innerHTML='搜索 <b style="color:'+(st.search.length?'var(--green)':'var(--text3)')+'">'+_esc(s)+'</b> · 抓全文 <b style="color:'+(st.scrape.length?'var(--green)':'var(--text3)')+'">'+_esc(sc)+'</b>'+(st.seedCount?(' · 真实种子库 '+st.seedCount+' 篇'):'');
    }
    function _loadStatus(){
      fetch(_apiBase()+'/api/agentkey/status').then(function(r){return r.json();}).then(function(j){ if(j&&j.status)_renderStatus(j.status); }).catch(function(){});
    }
    function _store(item){
      try{
        var cat=_mapCat(item.category||'osint_intel');
        var rec={
          title:item.title||'(无标题)', content:item.content||'', source:item.source||'', url:item.url||'',
          country:item.country||'', category:cat, language:item.language||'en', publish_time:item.pubDate||'',
          severity:(item.severity||'中'), audit_status:'pending',
          _real:true, _crawler:true, _agentkey:true, hasFull:item.hasFull?true:false,
          scrapeEngine:item.scrapeEngine||'', query:item.query||'', collect_time:item.collect_time||new Date().toISOString()
        };
        DBCenter.add(cat, rec);
        _toast('✅ 已存入数据中心「'+_catLabel(cat)+'」(待审核)');
      }catch(e){ _toast('⚠️ 存入失败: '+_esc(e.message||e)); }
    }
    function _translate(item, elZh){
      if(!elZh) return;
      /* 改为调后端 /api/translate（前端 TRANSLATOR 已随重设计移除；后端 TranSmart/有道免密钥可用） */
      elZh.style.display='block';
      elZh.innerHTML='<div style="font-size:12px;color:var(--text3)">翻译中…</div>';
      fetch(_apiBase()+'/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texts:[item.title||'',String(item.content||'').slice(0,6000)]})})
        .then(function(r){return r.json();})
        .then(function(j){
          var tz=(j&&j.results&&j.results[0])||'', cz=(j&&j.results&&j.results[1])||'';
          if(!tz&&!cz){ elZh.innerHTML='<div style="font-size:12px;color:var(--orange)">翻译通道暂不可用，显示原文。</div>'; return; }
          elZh.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">'+_esc(tz||item.title||'')+'</div>'+
            '<div style="padding:8px;background:rgba(0,212,255,0.05);border-left:2px solid var(--cyan);border-radius:6px;font-size:12px;color:var(--cyan);line-height:1.6">译文：'+_esc(cz||'(无)')+'</div>';
        })
        .catch(function(e){ elZh.innerHTML='<div style="font-size:12px;color:var(--red)">翻译失败：'+_esc(e.message||e)+'</div>'; });
    }
    function _render(items, mode){
      if(!items||!items.length){ resBox.innerHTML='<div style="font-size:11px;color:var(--text3);padding:10px">本次无符合「中国海外利益安全」相关性的详细情报返回</div>'; return; }
      resBox.innerHTML='<div style="font-size:10px;color:var(--text3);margin-bottom:6px">共 '+items.length+' 条真实详细情报'+(mode==='seed-fallback'?'（种子库回退，配置 AGENTKEY_*_KEY 后切换实时采集）':'（实时采集）')+'</div>'+
        items.map(function(it,idx){
          var full=String(it.content||'');
          var preview=full.length>700?full.slice(0,700)+'\n…（全文 '+full.length+' 字符，已截断预览）':full;
          var hasFullTag=it.hasFull?'<span style="color:var(--green);font-size:9px">● 全文</span>':'<span style="color:var(--text3);font-size:9px">○ 摘要</span>';
          var langTag=it.language?('<span style="font-size:9px;color:var(--text3)">'+_esc(it.language)+'</span>'):'';
          var catTag='<span style="font-size:9px;color:var(--purple,#b366ff)">'+_esc(_catLabel(it.category))+'</span>';
          var ctyTag=it.country?('<span style="font-size:9px;color:var(--text2)">📍'+_esc(it.country)+'</span>'):'';
          return '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px">'+
            '<div style="font-size:13px;font-weight:700;color:var(--text)">'+_esc(it.title||'(无标题)')+'</div>'+
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0;align-items:center">'+catTag+' '+ctyTag+' '+hasFullTag+' '+langTag+
              '<span style="font-size:9px;color:var(--text3)">'+_esc(it.source||'')+'</span>'+
              (it.url?'<a href="'+_esc(it.url)+'" target="_blank" style="font-size:9px;color:var(--cyan)">原文↗</a>':'')+'</div>'+
            '<div style="font-size:11px;color:var(--text2);line-height:1.5;white-space:pre-wrap">'+_esc(preview)+'</div>'+
            '<div id="ak-zh-'+idx+'" style="display:none"></div>'+
            '<div style="display:flex;gap:8px;margin-top:6px">'+
              '<button class="ak-trans" data-idx="'+idx+'" style="background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;border:none;padding:4px 12px;border-radius:6px;font-size:11px;cursor:pointer">🌐 翻译</button>'+
              '<button class="ak-store" data-idx="'+idx+'" style="background:var(--green);color:#000;border:none;padding:4px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:700">💾 存入数据中心</button>'+
            '</div>'+
          '</div>';
        }).join('');
      Array.prototype.forEach.call(resBox.querySelectorAll('.ak-trans'), function(b){
        b.onclick=function(){ var i=+b.dataset.idx; var zh=document.getElementById('ak-zh-'+i);
          b.disabled=true; b.textContent='⏳ 翻译中…'; _translate(items[i], zh);
          setTimeout(function(){ b.disabled=false; b.textContent='🌐 翻译'; }, 800);
        };
      });
      Array.prototype.forEach.call(resBox.querySelectorAll('.ak-store'), function(b){
        b.onclick=function(){ var i=+b.dataset.idx; _store(items[i]); };
      });
    }
    btn.onclick=function(){
      var q=(input&&input.value||'').trim();
      if(!q){ _toast('请输入关键词（用 | 分隔）'); return; }
      btn.disabled=true; btn.textContent='⏳ 采集中…';
      resBox.innerHTML='<div style="font-size:11px;color:var(--text3);padding:10px">正在经 AgentKey 连接器拉取真实详细情报…</div>';
      fetch(_apiBase()+'/api/agentkey/collect?queries='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(j){
        if(j&&j.ok){ _render(j.items||[], j.mode); }
        else { resBox.innerHTML='<div style="font-size:11px;color:var(--orange);padding:10px">采集失败：'+_esc((j&&j.error)||'未知')+'</div>'; }
      }).catch(function(e){ resBox.innerHTML='<div style="font-size:11px;color:var(--orange);padding:10px">请求错误：'+_esc(e.message||e)+'</div>'; })
      .finally(function(){ btn.disabled=false; btn.textContent='⚡ 一键深度采集'; });
    };
    _loadStatus();
  }

  function init(){
    if(!_timer) startEngine();
    render();
  }

  return { init:init, startEngine:startEngine, collectNow:collectNow, REGISTRY:REGISTRY, _state:state, contributeBurst:contributeBurst, realBurst:realBurst, crawlBurst:crawlBurst, hide:function(){_uiVisible=false;},
    /* 实时池可观测性：控制台排查"自动采集是否还在跑"用
       DATASOURCES.pool.size() / DATASOURCES.pool.dump() / DATASOURCES.pool.refresh() */
    pool:{ size:_poolSize, dump:function(){ return realPool; }, fill:_fillPool, ensure:_ensurePool,
           refresh:function(){ _lastRefill=0; try{ _refreshReal(); }catch(e){} return '已触发全量补池'; },
           consumed:function(){ return Object.keys(_consumed).length; } } };
})();
