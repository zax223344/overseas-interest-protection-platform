/* entities.js — 中国海外利益「主体—项目—国别—资产」实体识别与预警规则引擎
 * ================================================================
 * 定位：本文件是全平台唯一的"关联中枢"。任何一条情报（无论来自 RSS 底座、
 *      开放网络检索、社交媒体爬虫还是 GEOINT），在进入数据中心之前都必须
 *      经过 ENTITY.enrich()，被打上：
 *        · enterprises[]  命中的中资企业主体
 *        · projects[]     命中的海外重大项目
 *        · countries[]    项目/事件所在国
 *        · assets[]       受影响的海外利益资产类型（人员/机构/工程/航运…）
 *        · riskScore      0-100 多因子风险分
 *        · alertLevel     红/橙/黄/蓝 四级预警
 *        · ruleHits[]     命中的可审计规则 ID
 *      从而消除"预警中心 / 态势感知 / 企业安全 / 情报总线"之间的内容割裂。
 *
 * 铁律：本文件只提供【识别词典】与【规则参数】，不生成任何情报内容。
 *      词典与参数属于规则配置，不是模拟数据；无命中即为空，绝不臆造。
 * 前后端同源：Node 端 require('../entities.js')，浏览器端 window.ENTITY。
 * ================================================================ */
(function (root) {
  'use strict';

  /* ============================================================
   * 一、中资海外经营主体库（真实企业，含中英文别名）
   * type: 央企 | 地方国企 | 民企 | 金融机构
   * ============================================================ */
  var ENTERPRISES = [
    // —— 能源与油气 ——
    { id: 'CNPC', name: '中国石油天然气集团', type: '央企', sector: '油气能源', alias: ['中石油', '中国石油', 'CNPC', 'PetroChina', '中油国际'] },
    { id: 'SINOPEC', name: '中国石油化工集团', type: '央企', sector: '油气能源', alias: ['中石化', '中国石化', 'Sinopec', '联合石化'] },
    { id: 'CNOOC', name: '中国海洋石油集团', type: '央企', sector: '油气能源', alias: ['中海油', 'CNOOC', 'China National Offshore Oil'] },
    { id: 'CNCEC', name: '中国化学工程集团', type: '央企', sector: '化工工程', alias: ['中国化学', 'CNCEC'] },
    { id: 'SINOCHEM', name: '中国中化控股', type: '央企', sector: '化工', alias: ['中化集团', 'Sinochem', '中国化工', 'ChemChina', '先正达', 'Syngenta'] },
    // —— 电力与核电 ——
    { id: 'SGCC', name: '国家电网', type: '央企', sector: '电力', alias: ['国网', 'State Grid', 'SGCC'] },
    { id: 'CSG', name: '中国南方电网', type: '央企', sector: '电力', alias: ['南方电网', 'China Southern Power Grid'] },
    { id: 'CHNENERGY', name: '国家能源投资集团', type: '央企', sector: '电力煤炭', alias: ['国家能源集团', '神华', 'China Energy', 'Shenhua'] },
    { id: 'HUANENG', name: '中国华能集团', type: '央企', sector: '电力', alias: ['华能', 'Huaneng'] },
    { id: 'DATANG', name: '中国大唐集团', type: '央企', sector: '电力', alias: ['大唐', 'China Datang'] },
    { id: 'HUADIAN', name: '中国华电集团', type: '央企', sector: '电力', alias: ['华电', 'China Huadian'] },
    { id: 'SPIC', name: '国家电力投资集团', type: '央企', sector: '电力', alias: ['国家电投', 'SPIC'] },
    { id: 'CGN', name: '中国广核集团', type: '央企', sector: '核电', alias: ['中广核', 'CGN', 'China General Nuclear'] },
    { id: 'CNNC', name: '中国核工业集团', type: '央企', sector: '核电', alias: ['中核', 'CNNC', '中原对外工程'] },
    // —— 基建与工程 ——
    { id: 'CCCC', name: '中国交通建设集团', type: '央企', sector: '基础设施', alias: ['中交建', '中国交建', 'CCCC', '中国港湾', 'China Harbour', '中国路桥', 'China Road and Bridge', '振华重工', 'ZPMC'] },
    { id: 'CRCC', name: '中国铁建', type: '央企', sector: '轨道交通', alias: ['中铁建', 'CRCC', 'China Railway Construction'] },
    { id: 'CREC', name: '中国中铁', type: '央企', sector: '轨道交通', alias: ['中铁', 'CREC', 'China Railway Group', '中铁国际'] },
    { id: 'CSCEC', name: '中国建筑集团', type: '央企', sector: '建筑', alias: ['中建', '中国建筑', 'CSCEC', 'China State Construction'] },
    { id: 'POWERCHINA', name: '中国电力建设集团', type: '央企', sector: '电力工程', alias: ['中国电建', 'PowerChina', '中国水电', 'Sinohydro'] },
    { id: 'ENERGYCHINA', name: '中国能源建设集团', type: '央企', sector: '电力工程', alias: ['中国能建', 'Energy China', '葛洲坝', 'Gezhouba'] },
    { id: 'MCC', name: '中国冶金科工集团', type: '央企', sector: '冶金工程', alias: ['中国中冶', 'MCC', '中冶'] },
    { id: 'SINOMACH', name: '中国机械工业集团', type: '央企', sector: '机械工程', alias: ['国机集团', 'Sinomach', '中工国际', 'CAMCE'] },
    { id: 'CGCOC', name: '中地海外集团', type: '民企', sector: '基础设施', alias: ['CGCOC', '中地海外'] },
    // —— 矿业与资源 ——
    { id: 'MINMETALS', name: '中国五矿集团', type: '央企', sector: '矿业', alias: ['五矿', 'Minmetals', 'MMG'] },
    { id: 'CHINALCO', name: '中国铝业集团', type: '央企', sector: '有色金属', alias: ['中铝', 'Chinalco', '中国铝业'] },
    { id: 'CNMC', name: '中国有色矿业集团', type: '央企', sector: '有色金属', alias: ['中色', 'CNMC', '中国有色'] },
    { id: 'ZIJIN', name: '紫金矿业', type: '民企', sector: '矿业', alias: ['紫金', 'Zijin Mining'] },
    { id: 'CMOC', name: '洛阳钼业', type: '民企', sector: '矿业', alias: ['洛钼', 'CMOC', 'China Molybdenum'] },
    { id: 'TSINGSHAN', name: '青山控股集团', type: '民企', sector: '不锈钢镍业', alias: ['青山集团', 'Tsingshan'] },
    { id: 'GANFENG', name: '赣锋锂业', type: '民企', sector: '锂资源', alias: ['赣锋', 'Ganfeng Lithium'] },
    { id: 'TIANQI', name: '天齐锂业', type: '民企', sector: '锂资源', alias: ['天齐', 'Tianqi Lithium'] },
    { id: 'SHANDONGGOLD', name: '山东黄金', type: '地方国企', sector: '矿业', alias: ['鲁金', 'Shandong Gold'] },
    // —— 航运港口与物流 ——
    { id: 'COSCO', name: '中国远洋海运集团', type: '央企', sector: '航运港口', alias: ['中远海运', 'COSCO', '中远', '中远海控'] },
    { id: 'CMG', name: '招商局集团', type: '央企', sector: '港口金融', alias: ['招商局', 'China Merchants', '招商港口'] },
    { id: 'SINOTRANS', name: '中国外运', type: '央企', sector: '物流', alias: ['Sinotrans', '中外运'] },
    { id: 'CSSC', name: '中国船舶集团', type: '央企', sector: '船舶制造', alias: ['中船', 'CSSC', '中国船舶'] },
    // —— 通信与数字 ——
    { id: 'HUAWEI', name: '华为技术', type: '民企', sector: '信息通信', alias: ['华为', 'Huawei'] },
    { id: 'ZTE', name: '中兴通讯', type: '民企', sector: '信息通信', alias: ['中兴', 'ZTE'] },
    { id: 'HMN', name: '华海通信', type: '民企', sector: '海底光缆', alias: ['华为海洋', 'HMN Tech', 'Huawei Marine'] },
    { id: 'CHINAMOBILE', name: '中国移动', type: '央企', sector: '电信运营', alias: ['China Mobile', '移动国际'] },
    { id: 'CHINATELECOM', name: '中国电信', type: '央企', sector: '电信运营', alias: ['China Telecom'] },
    { id: 'CHINAUNICOM', name: '中国联通', type: '央企', sector: '电信运营', alias: ['China Unicom'] },
    { id: 'ALIBABA', name: '阿里巴巴集团', type: '民企', sector: '数字经济', alias: ['阿里巴巴', 'Alibaba', '阿里云', 'Alicloud', '速卖通', 'AliExpress', 'Lazada'] },
    { id: 'TENCENT', name: '腾讯控股', type: '民企', sector: '数字经济', alias: ['腾讯', 'Tencent', '微信', 'WeChat'] },
    { id: 'BYTEDANCE', name: '字节跳动', type: '民企', sector: '数字经济', alias: ['ByteDance', 'TikTok', '抖音国际'] },
    { id: 'SHEIN', name: '希音', type: '民企', sector: '跨境电商', alias: ['SHEIN'] },
    { id: 'TEMU', name: '拼多多海外', type: '民企', sector: '跨境电商', alias: ['Temu', 'PDD', '拼多多'] },
    // —— 制造与新能源 ——
    { id: 'CRRC', name: '中国中车', type: '央企', sector: '轨道装备', alias: ['中车', 'CRRC'] },
    { id: 'AVIC', name: '中国航空工业集团', type: '央企', sector: '航空', alias: ['中航工业', 'AVIC'] },
    { id: 'COMAC', name: '中国商用飞机', type: '央企', sector: '航空', alias: ['中国商飞', 'COMAC'] },
    { id: 'BYD', name: '比亚迪', type: '民企', sector: '新能源汽车', alias: ['BYD'] },
    { id: 'CATL', name: '宁德时代', type: '民企', sector: '动力电池', alias: ['CATL', '宁德'] },
    { id: 'SAIC', name: '上汽集团', type: '地方国企', sector: '汽车', alias: ['上汽', 'SAIC', 'MG名爵'] },
    { id: 'CHERY', name: '奇瑞汽车', type: '地方国企', sector: '汽车', alias: ['奇瑞', 'Chery'] },
    { id: 'GEELY', name: '吉利控股', type: '民企', sector: '汽车', alias: ['吉利', 'Geely', '沃尔沃汽车'] },
    { id: 'GWM', name: '长城汽车', type: '民企', sector: '汽车', alias: ['长城汽车', 'Great Wall Motor', 'GWM'] },
    { id: 'LONGI', name: '隆基绿能', type: '民企', sector: '光伏', alias: ['隆基', 'LONGi'] },
    { id: 'JINKO', name: '晶科能源', type: '民企', sector: '光伏', alias: ['晶科', 'JinkoSolar'] },
    { id: 'TRINA', name: '天合光能', type: '民企', sector: '光伏', alias: ['天合', 'Trina Solar'] },
    { id: 'GOLDWIND', name: '金风科技', type: '民企', sector: '风电', alias: ['金风', 'Goldwind'] },
    { id: 'SANY', name: '三一重工', type: '民企', sector: '工程机械', alias: ['三一', 'SANY'] },
    { id: 'XCMG', name: '徐工集团', type: '地方国企', sector: '工程机械', alias: ['徐工', 'XCMG'] },
    { id: 'ZOOMLION', name: '中联重科', type: '地方国企', sector: '工程机械', alias: ['中联', 'Zoomlion'] },
    { id: 'HAIER', name: '海尔智家', type: '民企', sector: '家电', alias: ['海尔', 'Haier'] },
    { id: 'MIDEA', name: '美的集团', type: '民企', sector: '家电', alias: ['美的', 'Midea'] },
    { id: 'TCL', name: 'TCL科技', type: '民企', sector: '电子', alias: ['TCL'] },
    { id: 'XIAOMI', name: '小米集团', type: '民企', sector: '消费电子', alias: ['小米', 'Xiaomi'] },
    { id: 'TRANSSION', name: '传音控股', type: '民企', sector: '消费电子', alias: ['传音', 'Transsion', 'Tecno', 'Infinix'] },
    // —— 农业与食品 ——
    { id: 'COFCO', name: '中粮集团', type: '央企', sector: '农业粮食', alias: ['中粮', 'COFCO'] },
    { id: 'CHINAFISHERY', name: '中国水产集团', type: '央企', sector: '远洋渔业', alias: ['中水集团', '远洋渔业'] },
    // —— 金融与保险 ——
    { id: 'BOC', name: '中国银行', type: '金融机构', sector: '银行', alias: ['中行', 'Bank of China'] },
    { id: 'ICBC', name: '中国工商银行', type: '金融机构', sector: '银行', alias: ['工行', 'ICBC'] },
    { id: 'CCB', name: '中国建设银行', type: '金融机构', sector: '银行', alias: ['建行', 'China Construction Bank'] },
    { id: 'ABC', name: '中国农业银行', type: '金融机构', sector: '银行', alias: ['农行', 'Agricultural Bank of China'] },
    { id: 'CDB', name: '国家开发银行', type: '金融机构', sector: '政策性银行', alias: ['国开行', 'China Development Bank'] },
    { id: 'EXIMBANK', name: '中国进出口银行', type: '金融机构', sector: '政策性银行', alias: ['口行', 'China Exim Bank'] },
    { id: 'SINOSURE', name: '中国出口信用保险公司', type: '金融机构', sector: '出口信保', alias: ['中国信保', 'Sinosure'] },
    { id: 'CIC', name: '中国投资有限责任公司', type: '金融机构', sector: '主权基金', alias: ['中投', 'China Investment Corporation'] },
    { id: 'AIIB', name: '亚洲基础设施投资银行', type: '金融机构', sector: '多边机构', alias: ['亚投行', 'AIIB'] },
    { id: 'SILKROADFUND', name: '丝路基金', type: '金融机构', sector: '开发基金', alias: ['Silk Road Fund'] }
  ];

  /* ============================================================
   * 二、海外重大项目库（真实项目，含所在国与承建/投资主体）
   * tier: 1=国家级旗舰 2=重点 3=一般
   * ============================================================ */
  var PROJECTS = [
    // 南亚 / 中巴经济走廊
    { id: 'CPEC', name: '中巴经济走廊', en: 'CPEC', country: '巴基斯坦', tier: 1, corp: ['CCCC', 'POWERCHINA', 'CREC'], alias: ['China-Pakistan Economic Corridor', '中巴走廊'] },
    { id: 'GWADAR', name: '瓜达尔港', en: 'Gwadar Port', country: '巴基斯坦', tier: 1, corp: ['CCCC', 'CMG'], alias: ['Gwadar'] },
    { id: 'DASU', name: '达苏水电站', en: 'Dasu Hydropower', country: '巴基斯坦', tier: 1, corp: ['CGGC', 'ENERGYCHINA'], alias: ['Dasu'] },
    { id: 'KAROT', name: '卡洛特水电站', en: 'Karot Hydropower', country: '巴基斯坦', tier: 2, corp: ['POWERCHINA'], alias: ['Karot'] },
    { id: 'CHASHMA', name: '恰希玛核电站', en: 'Chashma Nuclear', country: '巴基斯坦', tier: 2, corp: ['CNNC'], alias: ['Chashma', 'C-5'] },
    { id: 'KANUPP', name: '卡拉奇核电K2K3', en: 'Karachi K2/K3', country: '巴基斯坦', tier: 2, corp: ['CNNC'], alias: ['KANUPP', 'K-2', 'K-3'] },
    { id: 'ORANGELINE', name: '拉合尔轨道交通橙线', en: 'Lahore Orange Line', country: '巴基斯坦', tier: 2, corp: ['CREC'], alias: ['Orange Line'] },
    { id: 'SAHIWAL', name: '萨希瓦尔燃煤电站', en: 'Sahiwal Power Plant', country: '巴基斯坦', tier: 3, corp: ['HUANENG'], alias: ['Sahiwal'] },
    { id: 'THAR', name: '塔尔煤田', en: 'Thar Coalfield', country: '巴基斯坦', tier: 2, corp: ['CHNENERGY'], alias: ['Thar Block'] },
    { id: 'HAMBANTOTA', name: '汉班托塔港', en: 'Hambantota Port', country: '斯里兰卡', tier: 1, corp: ['CMG'], alias: ['Hambantota'] },
    { id: 'COLOMBOPC', name: '科伦坡港口城', en: 'Colombo Port City', country: '斯里兰卡', tier: 1, corp: ['CCCC'], alias: ['Port City Colombo'] },
    { id: 'CHITTAGONG', name: '孟加拉卡纳普里河底隧道', en: 'Karnaphuli Tunnel', country: '孟加拉国', tier: 2, corp: ['CCCC'], alias: ['Karnaphuli'] },
    // 东南亚
    { id: 'CLR', name: '中老铁路', en: 'China-Laos Railway', country: '老挝', tier: 1, corp: ['CREC', 'CRCC'], alias: ['Boten-Vientiane', '万象铁路'] },
    { id: 'JBHSR', name: '雅万高铁', en: 'Jakarta-Bandung HSR', country: '印度尼西亚', tier: 1, corp: ['CREC'], alias: ['Whoosh', 'Jakarta Bandung'] },
    { id: 'MOROWALI', name: '印尼青山工业园', en: 'Morowali Industrial Park', country: '印度尼西亚', tier: 1, corp: ['TSINGSHAN'], alias: ['IMIP', 'Morowali', 'Weda Bay', '纬达贝'] },
    { id: 'ECRL', name: '马来西亚东海岸铁路', en: 'East Coast Rail Link', country: '马来西亚', tier: 1, corp: ['CCCC'], alias: ['ECRL'] },
    { id: 'SIHANOUKVILLE', name: '西哈努克港经济特区', en: 'Sihanoukville SEZ', country: '柬埔寨', tier: 2, corp: [], alias: ['SSEZ', '西港特区'] },
    { id: 'NAMOU', name: '南欧江梯级水电站', en: 'Nam Ou Cascade', country: '老挝', tier: 2, corp: ['POWERCHINA'], alias: ['Nam Ou'] },
    { id: 'KYAUKPHYU', name: '皎漂港与经济特区', en: 'Kyaukphyu Port', country: '缅甸', tier: 1, corp: ['CITIC'], alias: ['Kyaukpyu'] },
    { id: 'MMPIPE', name: '中缅油气管道', en: 'China-Myanmar Pipeline', country: '缅甸', tier: 1, corp: ['CNPC'], alias: ['Myanmar-China pipeline'] },
    { id: 'LETPADAUNG', name: '莱比塘铜矿', en: 'Letpadaung Copper Mine', country: '缅甸', tier: 2, corp: ['MINMETALS'], alias: ['Letpadaung'] },
    { id: 'THAIRAIL', name: '中泰铁路', en: 'Thailand-China Railway', country: '泰国', tier: 2, corp: ['CREC'], alias: ['Thai-China high-speed'] },
    // 中亚 / 俄罗斯 / 中东欧
    { id: 'CAGP', name: '中亚天然气管道', en: 'Central Asia-China Gas Pipeline', country: '土库曼斯坦', tier: 1, corp: ['CNPC'], alias: ['Line D', '中亚管道'] },
    { id: 'CKU', name: '中吉乌铁路', en: 'China-Kyrgyzstan-Uzbekistan Railway', country: '吉尔吉斯斯坦', tier: 1, corp: ['CREC'], alias: ['CKU Railway'] },
    { id: 'YAMAL', name: '亚马尔LNG', en: 'Yamal LNG', country: '俄罗斯', tier: 1, corp: ['CNPC', 'SILKROADFUND'], alias: ['Yamal LNG', '亚马尔LNG', 'Yamal project'] },
    { id: 'ARCTICLNG2', name: '北极LNG2', en: 'Arctic LNG 2', country: '俄罗斯', tier: 1, corp: ['CNPC', 'CNOOC'], alias: ['Arctic LNG-2'] },
    { id: 'POWERSIBERIA', name: '中俄东线天然气管道', en: 'Power of Siberia', country: '俄罗斯', tier: 1, corp: ['CNPC'], alias: ['Power of Siberia'] },
    { id: 'BUDBEL', name: '匈塞铁路', en: 'Budapest-Belgrade Railway', country: '塞尔维亚', tier: 1, corp: ['CREC', 'CRCC'], alias: ['Belgrade-Budapest'] },
    { id: 'SMEDEREVO', name: '河钢塞尔维亚斯梅代雷沃钢厂', en: 'HBIS Smederevo', country: '塞尔维亚', tier: 2, corp: ['HBIS'], alias: ['Smederevo'] },
    { id: 'BOR', name: '紫金塞尔维亚博尔铜矿', en: 'Zijin Bor Copper', country: '塞尔维亚', tier: 2, corp: ['ZIJIN'], alias: ['Bor mine', 'RTB Bor'] },
    { id: 'PELJESAC', name: '佩列沙茨大桥', en: 'Peljesac Bridge', country: '克罗地亚', tier: 2, corp: ['CRCC'], alias: ['Peljesac'] },
    { id: 'PIRAEUS', name: '比雷埃夫斯港', en: 'Piraeus Port', country: '希腊', tier: 1, corp: ['COSCO'], alias: ['Piraeus'] },
    { id: 'GREATSTONE', name: '中白工业园', en: 'Great Stone Industrial Park', country: '白俄罗斯', tier: 2, corp: ['SINOMACH'], alias: ['Great Stone'] },
    { id: 'CATLHU', name: '宁德时代德布勒森工厂', en: 'CATL Debrecen Plant', country: '匈牙利', tier: 2, corp: ['CATL'], alias: ['Debrecen'] },
    { id: 'CRE', name: '中欧班列', en: 'China-Europe Railway Express', country: '欧洲', tier: 1, corp: ['CREC'], alias: ['China Railway Express', '中欧班列'] },
    // 非洲
    { id: 'SGR', name: '蒙内铁路', en: 'Mombasa-Nairobi SGR', country: '肯尼亚', tier: 1, corp: ['CRCC', 'CCCC'], alias: ['Mombasa-Nairobi', 'Kenya SGR'] },
    { id: 'ADDISDJIBOUTI', name: '亚吉铁路', en: 'Addis Ababa-Djibouti Railway', country: '埃塞俄比亚', tier: 1, corp: ['CREC', 'CRCC'], alias: ['Addis-Djibouti'] },
    { id: 'TAZARA', name: '坦赞铁路', en: 'TAZARA Railway', country: '坦桑尼亚', tier: 1, corp: ['CREC'], alias: ['TAZARA'] },
    { id: 'BENGUELA', name: '本格拉铁路', en: 'Benguela Railway', country: '安哥拉', tier: 2, corp: ['CREC'], alias: ['Benguela'] },
    { id: 'LEKKI', name: '莱基深水港', en: 'Lekki Deep Sea Port', country: '尼日利亚', tier: 1, corp: ['CHEC', 'CCCC'], alias: ['Lekki Port'] },
    { id: 'ABUJARAIL', name: '阿布贾城铁', en: 'Abuja Light Rail', country: '尼日利亚', tier: 3, corp: ['CCECC', 'CREC'], alias: ['Abuja rail'] },
    { id: 'KAMOA', name: '卡莫阿-卡库拉铜矿', en: 'Kamoa-Kakula', country: '刚果（金）', tier: 1, corp: ['ZIJIN'], alias: ['Kamoa', 'Kakula'] },
    { id: 'TENKE', name: '特恩克-丰古鲁姆铜钴矿', en: 'Tenke Fungurume', country: '刚果（金）', tier: 1, corp: ['CMOC'], alias: ['Tenke', 'TFM'] },
    { id: 'KISANFU', name: 'KFM铜钴矿', en: 'Kisanfu Mine', country: '刚果（金）', tier: 2, corp: ['CMOC'], alias: ['Kisanfu', 'KFM'] },
    { id: 'CHAMBISHI', name: '谦比希铜矿与经贸区', en: 'Chambishi Copper', country: '赞比亚', tier: 2, corp: ['CNMC'], alias: ['Chambishi'] },
    { id: 'SIMANDOU', name: '西芒杜铁矿', en: 'Simandou Iron Ore', country: '几内亚', tier: 1, corp: ['CHINALCO', 'BAOWU'], alias: ['Simandou', 'Winning Consortium'] },
    { id: 'EGYPTCBD', name: '埃及新首都CBD', en: 'New Administrative Capital CBD', country: '埃及', tier: 1, corp: ['CSCEC'], alias: ['New Capital CBD'] },
    { id: 'DJIBOUTIBASE', name: '吉布提保障基地', en: 'Djibouti Support Base', country: '吉布提', tier: 1, corp: [], alias: ['Djibouti base', '海外保障基地'] },
    { id: 'MOZLNG', name: '莫桑比克天然气项目', en: 'Mozambique LNG', country: '莫桑比克', tier: 2, corp: ['CNPC'], alias: ['Mozambique LNG', 'Cabo Delgado'] },
    // 中东
    { id: 'YASREF', name: '延布炼厂', en: 'Yasref Refinery', country: '沙特阿拉伯', tier: 2, corp: ['SINOPEC'], alias: ['Yasref', 'Yanbu'] },
    { id: 'HASSYAN', name: '哈斯彦清洁燃煤电站', en: 'Hassyan Power Plant', country: '阿联酋', tier: 2, corp: ['ENERGYCHINA', 'HARBIN'], alias: ['Hassyan'] },
    { id: 'ALDUQM', name: '杜库姆产业园', en: 'Duqm Industrial Park', country: '阿曼', tier: 2, corp: [], alias: ['Duqm'] },
    { id: 'RUMAILA', name: '鲁迈拉油田', en: 'Rumaila Oilfield', country: '伊拉克', tier: 1, corp: ['CNPC'], alias: ['Rumaila'] },
    { id: 'HALFAYA', name: '哈法亚油田', en: 'Halfaya Oilfield', country: '伊拉克', tier: 2, corp: ['CNPC'], alias: ['Halfaya'] },
    { id: 'MAJNOON', name: '马吉努油田', en: 'Majnoon Oilfield', country: '伊拉克', tier: 2, corp: ['CNPC'], alias: ['Majnoon'] },
    // 拉美
    { id: 'CHANCAY', name: '钱凯港', en: 'Chancay Port', country: '秘鲁', tier: 1, corp: ['COSCO'], alias: ['Chancay'] },
    { id: 'LASBAMBAS', name: '拉斯邦巴斯铜矿', en: 'Las Bambas', country: '秘鲁', tier: 1, corp: ['MINMETALS'], alias: ['Las Bambas', 'MMG'] },
    { id: 'TOROMOCHO', name: '特罗莫克铜矿', en: 'Toromocho', country: '秘鲁', tier: 2, corp: ['CHINALCO'], alias: ['Toromocho'] },
    { id: 'BELOMONTE', name: '美丽山特高压输电', en: 'Belo Monte UHV', country: '巴西', tier: 1, corp: ['SGCC'], alias: ['Belo Monte'] },
    { id: 'CAUCHARI', name: '高查瑞光伏电站', en: 'Cauchari Solar', country: '阿根廷', tier: 2, corp: ['POWERCHINA'], alias: ['Cauchari'] },
    { id: 'SANTACRUZ', name: '圣克鲁斯水电站', en: 'Santa Cruz Hydro', country: '阿根廷', tier: 2, corp: ['ENERGYCHINA'], alias: ['Condor Cliff'] },
    { id: 'ECUADORCCS', name: '科卡科多水电站', en: 'Coca Codo Sinclair', country: '厄瓜多尔', tier: 2, corp: ['SINOHYDRO', 'POWERCHINA'], alias: ['Coca Codo'] },
    /* ══ 2026-08-31 扩充（用户指令：按商务部《对外投资合作国别(地区)指南》口径全面补充；
     * 优先补安全风险高发国别——苏丹/尼日尔/乍得/尼泊尔/巴新等此前空白，联动预警直接受益）══ */
    { id: 'KHARTOUMREF', name: '喀土穆炼油厂', en: 'Khartoum Refinery', country: '苏丹', tier: 1, corp: ['CNPC'], alias: ['Khartoum refinery', '苏丹炼厂'] },
    { id: 'AGADEM', name: '阿加德姆油田与原油外输管道', en: 'Agadem Oilfield & Pipeline', country: '尼日尔', tier: 1, corp: ['CNPC'], alias: ['Agadem', 'Niger-Benin pipeline', '尼日尔-贝宁管道'] },
    { id: 'RONIER', name: 'Ronier 油田', en: 'Ronier Oilfield', country: '乍得', tier: 2, corp: ['CNPC'], alias: ['Ronier'] },
    { id: 'POKHARA', name: '博克拉国际机场', en: 'Pokhara International Airport', country: '尼泊尔', tier: 2, corp: ['CCCC', 'CACC'], alias: ['Pokhara airport'] },
    { id: 'VAKHSH', name: '瓦亚铁路', en: 'Vakhdat-Yavan Railway', country: '塔吉克斯坦', tier: 2, corp: ['CRCC'], alias: ['Vahdat-Yavan'] },
    { id: 'SHYMKENT', name: '奇姆肯特炼厂现代化改造', en: 'Shymkent Refinery Upgrade', country: '哈萨克斯坦', tier: 2, corp: ['CNPC', 'SINOPEC'], alias: ['Shymkent refinery', 'PKOP'] },
    { id: 'PAPANGREN', name: '安格连燃煤电站', en: 'Pap Angren Coal Power', country: '乌兹别克斯坦', tier: 2, corp: ['POWERCHINA'], alias: ['Angren PP'] },
    { id: 'PENGSHENG', name: '鹏盛工业园', en: 'Pengsheng Industrial Park', country: '乌兹别克斯坦', tier: 2, corp: [], alias: ['Pengsheng', '锡尔河工业园'] },
    { id: 'NORTHAZADEGAN', name: '北阿扎德甘油田', en: 'North Azadegan Oilfield', country: '伊朗', tier: 1, corp: ['CNPC'], alias: ['North Azadegan'] },
    { id: 'PAYRA', name: '帕亚拉燃煤电站', en: 'Payra Power Plant', country: '孟加拉国', tier: 2, corp: ['CMC'], alias: ['Payra'] },
    { id: 'NARIAN', name: '内马铁路', en: 'Nairobi-Narok-Malaba SGR', country: '肯尼亚', tier: 2, corp: ['CCCC', 'CRCC'], alias: ['Nairobi-Malaba railway', 'SGR Phase 2'] },
    { id: 'RAMUNICO', name: '瑞木镍钴矿', en: 'Ramu NiCo Mine', country: '巴布亚新几内亚', tier: 1, corp: ['MCC'], alias: ['Ramu NiCo', '瑞木'] },
    { id: 'COASTAL2', name: '沿海二期燃煤电站', en: 'Duyen Hai II Power Plant', country: '越南', tier: 3, corp: ['POWERCHINA'], alias: ['Duyen Hai 2', '沿海电厂'] },
    { id: 'RAMADANCITY', name: '斋月十日城市郊轻轨', en: '10th of Ramadan City LRT', country: '埃及', tier: 2, corp: ['AVIC', 'CRRC'], alias: ['10th Ramadan LRT'] },
    { id: 'TANGERTECH', name: '丹吉尔科技城', en: 'Tangier Tech City', country: '摩洛哥', tier: 3, corp: ['CCCC'], alias: ['Tangier Tech'] },
    { id: 'EASTWEST', name: '东西高速公路', en: 'East-West Highway', country: '阿尔及利亚', tier: 2, corp: ['CITIC', 'CSCEC'], alias: ['East-West expressway'] },
    /* ══ 2026-08-31 二次扩充（用户指令：全网按商务部/国资委/一带一路网口径全面补充；
     * 50 项新增，苏丹/伊拉克/津巴布韦/巴新等安全高风险国别优先；来源：商务部国别指南、
     * 中国一带一路网、国资委央企报道、新华社/人民日报、格鲁吉亚中资企业商会 ══ */
    // 苏丹（安全风险高发国——战乱区中资存量资产）
    { id: 'MEROWE', name: '麦洛维大坝', en: 'Merowe Dam', country: '苏丹', tier: 1, corp: ['POWERCHINA'], alias: ['Merowe', '麦洛维水电站', '印在苏丹钞票的大坝'] },
    { id: 'UPPERATBARA', name: '上阿特巴拉大坝', en: 'Upper Atbara Dam', country: '苏丹', tier: 3, corp: ['POWERCHINA'], alias: ['Upper Atbara', 'Setit'] },
    // 非洲新增
    { id: 'KRIBIHWY', name: '克里比-罗拉贝高速公路', en: 'Kribi-Lolabe Highway', country: '喀麦隆', tier: 2, corp: ['CCCC'], alias: ['Kribi highway'] },
    { id: 'SAKAISOLAR', name: '萨卡伊光伏电站', en: 'Sakai Solar Plant', country: '中非共和国', tier: 3, corp: ['ENERGYCHINA'], alias: ['Sakai solar', '中非光伏'] },
    { id: 'KINGFISHER', name: '翠鸟油田与东非原油管道', en: 'Kingfisher & EACOP', country: '乌干达', tier: 1, corp: ['CNOOC'], alias: ['Kingfisher', 'EACOP', 'East African Crude Oil Pipeline'] },
    { id: 'KALETA', name: '凯乐塔水电站', en: 'Kaleta Hydropower', country: '几内亚', tier: 3, corp: ['POWERCHINA'], alias: ['Kaleta'] },
    { id: 'SOUAPITI', name: '苏阿皮蒂水利枢纽（西非三峡）', en: 'Souapiti Hydropower', country: '几内亚', tier: 1, corp: ['CCCC'], alias: ['Souapiti', '苏阿皮蒂'] },
    { id: 'AUHQ', name: '非盟会议中心', en: 'AU Conference Center', country: '埃塞俄比亚', tier: 2, corp: ['CSCEC'], alias: ['African Union headquarters', '非盟总部'] },
    { id: 'ADAMAWIND', name: '阿达玛风电项目', en: 'Adama Wind Farm', country: '埃塞俄比亚', tier: 3, corp: ['POWERCHINA'], alias: ['Adama wind'] },
    { id: 'MAPUTOBRIDGE', name: '马普托大桥', en: 'Maputo Bridge', country: '莫桑比克', tier: 2, corp: ['CCCC'], alias: ['Maputo-Katembe Bridge', '非洲第一大悬索桥'] },
    { id: 'WALVISBAYOIL', name: '鲸湾油码头', en: 'Walvis Bay Oil Terminal', country: '纳米比亚', tier: 3, corp: ['CCCC'], alias: ['Walvis Bay', '鲸湾港'] },
    { id: 'DANGOTE', name: '丹格特炼油厂（中企承建）', en: 'Dangote Refinery', country: '尼日利亚', tier: 2, corp: ['SINOMACH'], alias: ['Dangote', '莱基炼厂'] },
    { id: 'LAGOSBLUE', name: '拉各斯轻轨蓝线', en: 'Lagos Blue Line Rail', country: '尼日利亚', tier: 3, corp: ['CRCC'], alias: ['Lagos light rail', 'Lagos Blue Line'] },
    { id: 'DEZIWA', name: '迪兹瓦铜钴矿', en: 'Deziwa Copper-Cobalt', country: '刚果（金）', tier: 2, corp: ['CNMC'], alias: ['Deziwa', '迪兹瓦矿业'] },
    { id: 'LUANSHYA', name: '中色卢安夏铜矿', en: 'CNMC Luanshya Copper', country: '赞比亚', tier: 3, corp: ['CNMC'], alias: ['Luanshya', '卢安夏'] },
    { id: 'ARCADIA', name: '华友阿卡迪亚锂矿（非洲首座硫酸锂厂）', en: 'Arcadia Lithium Mine', country: '津巴布韦', tier: 1, corp: ['TSINGSHAN'], alias: ['Arcadia', 'Prospect Lithium', '华友津巴布韦'] },
    { id: 'BIKITA', name: '中矿Bikita锂矿', en: 'Bikita Minerals', country: '津巴布韦', tier: 2, corp: ['CNMC'], alias: ['Bikita', '中矿资源津巴布韦'] },
    { id: 'DINSON', name: '鼎森钢铁Manhize钢厂', en: 'Dinson Manhize Steel', country: '津巴布韦', tier: 2, corp: ['TSINGSHAN'], alias: ['Manhize', 'Dinson Iron and Steel'] },
    { id: 'ABIDJANTERM', name: '阿比让港第二集装箱码头', en: 'Abidjan Terminal 2', country: '科特迪瓦', tier: 2, corp: ['CCCC'], alias: ['Abidjan port', '阿比让港'] },
    // 中东新增
    { id: 'ALKARSAA', name: '阿尔卡萨光伏电站（世界杯绿色能源）', en: 'Al Kharsaah Solar', country: '卡塔尔', tier: 1, corp: ['POWERCHINA'], alias: ['Al Kharsaah', 'Alcazar solar', '卡塔尔光伏'] },
    { id: 'QATARWATER', name: '卡塔尔国家超大型蓄水池', en: 'Qatar Mega Reservoir', country: '卡塔尔', tier: 2, corp: ['ENERGYCHINA'], alias: ['Mega Reservoir', '卡塔尔蓄水池'] },
    { id: 'JAZAN', name: '吉赞燃机联合循环电站', en: 'Jizan Power Plant', country: '沙特阿拉伯', tier: 2, corp: ['POWERCHINA'], alias: ['Jizan', '吉赞电站'] },
    { id: 'YANBU3', name: '延布三期燃油电站', en: 'Yanbu Phase 3', country: '沙特阿拉伯', tier: 2, corp: ['POWERCHINA'], alias: ['Yanbu 3', '延布电站'] },
    { id: 'RABIGH3', name: '拉比格三期海水淡化', en: 'Rabigh 3 Desalination', country: '沙特阿拉伯', tier: 3, corp: ['POWERCHINA'], alias: ['Rabigh III', '拉比格'] },
    { id: 'SHUAIBAH', name: '阿尔舒巴赫2.6GW光伏', en: 'Al Shuaibah Solar', country: '沙特阿拉伯', tier: 2, corp: ['ENERGYCHINA'], alias: ['Shuaibah', 'ASB solar'] },
    { id: 'REDSEA', name: '红海新城公用事业基础设施', en: 'Red Sea Utilities', country: '沙特阿拉伯', tier: 2, corp: ['POWERCHINA'], alias: ['Red Sea Project', 'NEOM', '红海新城'] },
    { id: 'KUWAITUNIV', name: '科威特大学城', en: 'Kuwait University City', country: '科威特', tier: 3, corp: ['POWERCHINA'], alias: ['Sabah Al-Salem University'] },
    { id: 'IQSCHOOLS', name: '伊拉克679所学校项目群', en: 'Iraq 679 Schools Program', country: '伊拉克', tier: 2, corp: ['POWERCHINA'], alias: ['Iraq schools', '伊拉克学校'] },
    { id: 'RATAWI', name: '拉塔维1GW光伏电站（巴士拉）', en: 'Al-Ratawi Solar', country: '伊拉克', tier: 2, corp: ['ENERGYCHINA'], alias: ['Ratawi', 'Ratavi', '巴士拉光伏'] },
    { id: 'UMMQUWAIN', name: '乌姆盖万海水淡化厂', en: 'Umm Al Quwain Desal', country: '阿联酋', tier: 3, corp: ['ENERGYCHINA'], alias: ['Umm Al Quwain'] },
    { id: 'MANAH2', name: 'Manah II 光伏电站', en: 'Manah II Solar', country: '阿曼', tier: 3, corp: ['ENERGYCHINA'], alias: ['Manah solar', 'Ibri'] },
    // 高加索/欧洲新增
    { id: 'E60HWY', name: 'E60高速公路改造', en: 'E60 Highway', country: '格鲁吉亚', tier: 2, corp: ['CCCC', 'CSCEC'], alias: ['E60 expressway', '格鲁吉亚E60'] },
    { id: 'GEORAIL', name: '格鲁吉亚现代化铁路（泽斯塔波尼-哈舒里）', en: 'Georgian Modern Railway', country: '格鲁吉亚', tier: 2, corp: ['CREC'], alias: ['Zestafoni-Khashuri', '中间走廊铁路'] },
    { id: 'POTITERM', name: '波季港多式联运集装箱堆场', en: 'Poti Container Yard', country: '格鲁吉亚', tier: 3, corp: ['CREC'], alias: ['Poti port', '波季港'] },
    { id: 'ZEMUNBRIDGE', name: '泽蒙-博尔察大桥（中企欧洲首桥）', en: 'Zemun-Borc? Bridge', country: '塞尔维亚', tier: 2, corp: ['CCCC'], alias: ['Zemun-Borca', 'Mihajlo Pupin Bridge', '中国桥'] },
    { id: 'E763HWY', name: 'E763高速公路', en: 'E763 Highway', country: '塞尔维亚', tier: 2, corp: ['CCCC'], alias: ['E763', '塞高速'] },
    { id: 'LINGLONG', name: '玲珑轮胎兹雷尼亚宁工厂', en: 'Linglong Zrenjanin Plant', country: '塞尔维亚', tier: 3, corp: [], alias: ['Linglong Tire Serbia'] },
    // 南亚/印度洋新增
    { id: 'SINOMABRIDGE', name: '中马友谊大桥（印度洋首座跨海大桥）', en: 'China-Maldives Friendship Bridge', country: '马尔代夫', tier: 1, corp: ['CCCC'], alias: ['Sinamalé Bridge', '中马大桥'] },
    { id: 'VELANA', name: '维拉纳国际机场扩建', en: 'Velana Airport Expansion', country: '马尔代夫', tier: 3, corp: ['CCCC'], alias: ['Velana', '马累机场'] },
    // 东南亚新增
    { id: 'PHNOMHWY', name: '金港高速公路（柬埔寨首条高速）', en: 'Phnom Penh-Sihanoukville Expressway', country: '柬埔寨', tier: 1, corp: ['CCCC'], alias: ['金港高速', 'GS Expressway'] },
    { id: 'BATAANPP', name: '巴丹燃煤电厂码头工程', en: 'Bataan Power Plant Jetty', country: '菲律宾', tier: 3, corp: ['CCCC'], alias: ['Bataan', 'Mariveles'] },
    // 中亚新增
    { id: 'BARSKOON', name: '巴尔斯科恩-别迭里公路', en: 'Barskoon-Bedery Highway', country: '吉尔吉斯斯坦', tier: 3, corp: ['CCCC'], alias: ['Barskoon', '别迭里口岸公路'] },
    // 拉美/加勒比新增
    { id: 'LAPAZWATER', name: '拉巴斯供水项目', en: 'La Paz Water Supply', country: '玻利维亚', tier: 3, corp: ['POWERCHINA'], alias: ['Taipichaca', '拉巴斯大坝'] },
    { id: 'JAMNORTH', name: '牙买加南北高速公路', en: 'Jamaica North-South Highway', country: '牙买加', tier: 2, corp: ['CCCC'], alias: ['North-South Highway', '牙买加高速'] },
    { id: 'ARIMAHOSP', name: '阿利玛总医院', en: 'Arima General Hospital', country: '特立尼达和多巴哥', tier: 3, corp: ['CRCC'], alias: ['Arima hospital'] },
    { id: 'CJIATERM', name: '切迪·贾根国际机场扩建', en: 'Cheddi Jagan Airport Expansion', country: '圭亚那', tier: 3, corp: ['CCCC'], alias: ['Cheddi Jagan', 'Timehri'] },
    // 太平洋岛国新增
    { id: 'NORDCENTER', name: '巴新诺德中心（南太第一高楼）', en: 'Nord Center', country: '巴布亚新几内亚', tier: 3, corp: ['CRCC'], alias: ['Nord Center', '莫尔兹比港诺德'] },
    { id: 'HIGHLANDHWY', name: '巴新高地高速公路', en: 'PNG Highlands Highway', country: '巴布亚新几内亚', tier: 3, corp: ['MINMETALS'], alias: ['Highlands Highway Phase 2'] },
    { id: 'FRIEDARIVER', name: '弗里达河铜金矿', en: 'Frieda River Copper-Gold', country: '巴布亚新几内亚', tier: 2, corp: ['MINMETALS'], alias: ['Frieda River', 'PanAust', 'Sepik'] }
  ];

  /* ============================================================
   * 三、经济走廊 / 区域框架（用于区域级关联）
   * ============================================================ */
  var CORRIDORS = [
    { id: 'CPEC_C', name: '中巴经济走廊', countries: ['巴基斯坦'] },
    { id: 'CMREC', name: '中蒙俄经济走廊', countries: ['蒙古国', '俄罗斯'] },
    { id: 'NELB', name: '新亚欧大陆桥', countries: ['哈萨克斯坦', '俄罗斯', '波兰', '德国'] },
    { id: 'CCWA', name: '中国-中亚-西亚经济走廊', countries: ['哈萨克斯坦', '乌兹别克斯坦', '土库曼斯坦', '伊朗', '土耳其'] },
    { id: 'CICPEC', name: '中国-中南半岛经济走廊', countries: ['越南', '老挝', '柬埔寨', '泰国', '缅甸', '马来西亚'] },
    { id: 'BCIM', name: '孟中印缅经济走廊', countries: ['孟加拉国', '印度', '缅甸'] },
    { id: 'MSR', name: '21世纪海上丝绸之路', countries: ['印度尼西亚', '马来西亚', '斯里兰卡', '肯尼亚', '希腊'] }
  ];

  /* ============================================================
   * 四、海外利益资产类型识别（人员 / 机构 / 工程 / 航运 / 数字）
   * ============================================================ */
  var ASSET_TYPES = [
    { id: 'PERSON_CITIZEN', name: '中国公民', weight: 1.0, re: /中国公民|中方人员|中国籍|我国公民|中国游客|中国留学生|华人|华侨|华裔|侨胞|Chinese national|Chinese citizen|Chinese tourist|Chinese student|overseas Chinese|ethnic Chinese/i },
    { id: 'PERSON_WORKER', name: '外派劳务与工程人员', weight: 1.0, re: /中方员工|中国工人|劳务人员|外派人员|工程技术人员|中国工程师|项目人员|Chinese worker|Chinese engineer|Chinese staff|Chinese labou?r|Chinese personnel|Chinese crew/i },
    { id: 'ORG_DIPLOMATIC', name: '驻外使领馆与外交人员', weight: 1.0, re: /中国使馆|中国大使馆|中国领事馆|中国领馆|中国外交人员|中国大使|中国驻|Chinese embassy|Chinese consulate|Chinese diplomat|Chinese ambassador|China's ambassador|China's embassy/i },
    { id: 'ORG_INSTITUTION', name: '驻外中资机构', weight: 0.9, re: /中资机构|中资企业|中国公司|驻外机构|办事处|代表处|分公司|工业园|经贸合作区|Chinese firm|Chinese company|Chinese enterprise|Chinese-run|Chinese-owned|industrial park/i },
    { id: 'ASSET_PROJECT', name: '境外工程与基础设施', weight: 0.95, re: /项目工地|施工现场|工程项目|营地|厂区|矿区|电站|大坝|港口|铁路|公路|管道|输电线|基地|construction site|project site|camp|plant|mine site|dam|power station|pipeline|railway|highway|terminal|refinery/i },
    { id: 'ASSET_SHIPPING', name: '航运船舶与海上通道', weight: 0.9, re: /中国籍船|商船|货轮|集装箱船|油轮|渔船|船员|航线|海峡|航道|Chinese vessel|Chinese ship|cargo ship|tanker|container ship|fishing vessel|crew|shipping lane|strait|sea lane/i },
    { id: 'ASSET_AVIATION', name: '民航航线与机场', weight: 0.8, re: /中国航空|国航|东航|南航|航班|机场|领空|China Eastern|China Southern|Air China|Chinese flight|Chinese airport|Chinese airspace/i },
    { id: 'ASSET_ENERGY', name: '境外能源资产', weight: 0.95, re: /油田|气田|炼厂|LNG|油气管道|加油站|储油|oilfield|gas field|refinery|LNG terminal|oil terminal|pipeline/i },
    { id: 'ASSET_MINE', name: '境外矿业资产', weight: 0.95, re: /铜矿|铁矿|钴矿|锂矿|金矿|镍矿|煤矿|选矿厂|尾矿|copper mine|iron ore|cobalt|lithium|gold mine|nickel|coal mine|smelter|tailings/i },
    { id: 'ASSET_DIGITAL', name: '数字资产与数据安全', weight: 0.7, re: /数据中心|服务器|网络攻击|勒索软件|数据泄露|海底光缆|基站|data cent(?:er|re)|cyber ?attack|ransomware|data breach|submarine cable|base station/i },
    { id: 'ASSET_FINANCE', name: '境外金融与投资权益', weight: 0.8, re: /股权|资产冻结|征收|国有化|外汇管制|汇兑|违约|债务重组|制裁|expropriat|nationaliz|asset freeze|capital control|default|debt restructur|sanction/i }
  ];

  /* ============================================================
   * 五、威胁类型权重（预警规则参数，非情报数据）
   * ============================================================ */
  var THREAT_RULES = [
    { id: 'R-T01', name: '中国人员伤亡', score: 38, re: /(中国|中方|华人|华侨|中资|Chinese)[^。.]{0,40}(死亡|遇难|身亡|遇害|丧生|kill(?:ed|ing|s)?|dead|death|fatalit|casualt)|(kill(?:ed|ing|s)?|dead|死亡|遇难|遇害)[^。.]{0,40}(Chinese|中国公民|中方人员|中国工人)/i },
    { id: 'R-T18', name: '中国人员受伤与人身侵害', score: 28, re: /(中国|中方|华人|华侨|中资|Chinese)[^。.]{0,40}(受伤|负伤|伤者|被打|被袭|遇袭|被殴|injur|wounded|hurt|attacked|assaulted|stabbed|beaten)|(injur(?:ed|y|ies)|wounded|assaulted|stabbed)[^。.]{0,40}(Chinese|中方人员|中国公民|中国工人)/i },
    { id: 'R-T02', name: '绑架劫持中国人员', score: 36, re: /(中国|中方|华人|华侨|中资|中企|Chinese)[^。.]{0,40}(绑架|劫持|扣押|失踪|人质|带走|掳走|劫走|被掳|kidnap|abduct|hostage|seiz(?:ed|ure) of|missing)|(绑架|劫持|扣押|人质|带走|掳走|劫走|被掳|kidnap(?:ped|ping)?|abduct(?:ed|ion)?|hostage)[^。.]{0,40}(Chinese|中国公民|中方人员|中国工人|中国|华人|中资)/i },
    { id: 'R-T03', name: '恐怖袭击与爆炸', score: 34, re: /恐怖袭击|恐袭|自杀式|爆炸|炸弹|简易爆炸装置|terror(?:ist)? attack|suicide bomb|bomb(?:ing)?|IED|explosion|blast/i },
    { id: 'R-T04', name: '武装袭击与枪击', score: 30, re: /武装袭击|枪击|扫射|袭击车队|伏击|armed attack|gunmen|shooting|ambush|opened fire|militant attack/i },
    { id: 'R-T05', name: '战争与武装冲突', score: 28, re: /战争|交火|空袭|炮击|导弹袭击|无人机袭击|军事打击|军事冲突|叛军|内战|\bwar\b|\bwarfare\b|airstrike|shelling|armed conflict|insurgen|civil war|militia|missile (?:strike|attack)|drone (?:strike|attack)|rocket attack|artillery|strikes? (?:has |have )?hit|struck by/i },
    { id: 'R-T06', name: '大规模抗议与骚乱', score: 22, re: /骚乱|暴乱|示威|罢工|封路|冲击厂区|排华|反华游行|riot|unrest|protest|demonstration|labou?r strike|general strike|workers? strike|walkout|blockade|anti-Chinese/i },
    { id: 'R-T07', name: '政变与政局突变', score: 26, re: /政变|军管|紧急状态|政权更迭|大选危机|coup|state of emergency|martial law|regime change|junta/i },
    { id: 'R-T08', name: '资产征收与国有化', score: 25, re: /征收|国有化|吊销执照|强制收购|资产冻结|撤销许可|expropriat|nationaliz|licen[cs]e revok|asset freeze|forced (?:sale|transfer)/i },
    { id: 'R-T09', name: '制裁与出口管制', score: 24, re: /制裁|实体清单|出口管制|禁令|关税壁垒|反倾销|sanction|entity list|export control|embargo|tariff|anti-dumping/i },
    { id: 'R-T10', name: '项目停工与撤离', score: 26, re: /停工|停产|撤离|撤侨|疏散|中止合同|项目暂停|suspend(?:ed)? (?:work|operation|project)|evacuat|withdraw|halt(?:ed)? construction|shut down/i },
    { id: 'R-T11', name: '海盗与海上劫掠', score: 28, re: /海盗|劫船|扣船|拦截船只|piracy|pirate|hijack(?:ed)? (?:ship|vessel)|vessel seiz/i },
    { id: 'R-T12', name: '网络攻击与数据窃取', score: 20, re: /网络攻击|黑客|勒索软件|数据泄露|窃密|cyber ?attack|hack(?:ed|ing)|ransomware|data breach|espionage|malware/i },
    { id: 'R-T13', name: '自然灾害与重大事故', score: 18, re: /地震|海啸|飓风|台风|洪水|山体滑坡|矿难|坍塌|火灾|重大事故|earthquake|tsunami|hurricane|typhoon|flood(?:ing|s)?\b|landslide|mine accident|collapse|major accident|blaze|building fire|wildfire/i },
    { id: 'R-T17', name: '抢劫盗抢与治安侵害', score: 24, re: /抢劫|抢夺|盗抢|入室|哄抢|偷盗财物|治安案件|robbery|robbed|looting|looted|armed theft|burglar|mugging|ransack/i },
    { id: 'R-T14', name: '疫情与公共卫生事件', score: 16, re: /疫情|传染病|埃博拉|霍乱|疟疾|封控|epidemic|outbreak|Ebola|cholera|pandemic|quarantine/i },
    { id: 'R-T15', name: '法律纠纷与合规风险', score: 14, re: /诉讼|仲裁|罚款|反腐调查|逮捕高管|合规调查|lawsuit|arbitration|criminal investigation|regulatory probe|\bfined\b|penalt(?:y|ies)|bribery|corruption probe|arrest(?:ed)? executive/i },
    { id: 'R-T16', name: '舆论抹黑与政治打压', score: 12, re: /抹黑|污名化|debt trap|债务陷阱|新殖民|间谍指控|驱逐|smear|stigmatiz|neo-?colonial|spy allegation|expel|espionage claim/i },
    /* 以下两类为中资企业"走出去"高发的非传统安全风险，
     * 由实测漏判案例补入（巴西将中资车企列入用工"耻辱名单"、境外矿业社区与环保纠纷）。 */
    { id: 'R-T19', name: '用工与人权合规争议', score: 20, re: /强迫劳动|奴役|欠薪|拖欠工资|童工|劳工权益|用工违规|血汗工厂|工伤瞒报|forced labou?r|slavery|slave-?like|labou?r (?:abuse|violation|rights|exploitation)|wage theft|unpaid wages|child labou?r|sweatshop|worker exploitation|list of shame/i },
    { id: 'R-T20', name: '环境与社区纠纷', score: 18, re: /环境污染|环保抗议|征地纠纷|拆迁|水源污染|尾矿泄漏|生态破坏|社区冲突|环评未过|environmental (?:protest|damage|violation|breach|concern)|water pollution|land (?:dispute|grab)|forced resettlement|community (?:opposition|conflict|backlash)|tailings (?:spill|leak|dam)|deforestation/i }
  ];

  /* ============================================================
   * 六、国别安全基线（规则参数：0-100，越高越危险）
   * 说明：此为预警规则的国别权重基线，可在规则配置中调整，
   *      不代表任何实时情报判断。
   * ============================================================ */
  var COUNTRY_RISK = {
    '阿富汗': 95, '叙利亚': 93, '也门': 92, '索马里': 92, '南苏丹': 90, '利比亚': 89,
    '苏丹': 88, '马里': 88, '海地': 88, '缅甸': 86, '尼日尔': 85, '布基纳法索': 85,
    '刚果（金）': 84, '中非': 84, '巴基斯坦': 83, '伊拉克': 80, '尼日利亚': 80,
    '莫桑比克': 76, '喀麦隆': 74, '埃塞俄比亚': 74, '乌克兰': 82, '巴勒斯坦': 88,
    '黎巴嫩': 78, '伊朗': 72, '委内瑞拉': 74, '洪都拉斯': 72, '厄瓜多尔': 70,
    '肯尼亚': 62, '坦桑尼亚': 55, '赞比亚': 55, '几内亚': 68, '乍得': 80,
    '津巴布韦': 60, '安哥拉': 58, '埃及': 58, '阿尔及利亚': 58, '突尼斯': 58,
    '孟加拉国': 62, '斯里兰卡': 55, '尼泊尔': 50, '印度': 60, '菲律宾': 58,
    '印度尼西亚': 52, '柬埔寨': 55, '老挝': 45, '越南': 45, '泰国': 48, '马来西亚': 42,
    '哈萨克斯坦': 45, '吉尔吉斯斯坦': 55, '塔吉克斯坦': 58, '乌兹别克斯坦': 45,
    '土库曼斯坦': 45, '蒙古国': 40, '俄罗斯': 62, '白俄罗斯': 55, '土耳其': 58,
    '沙特阿拉伯': 50, '阿联酋': 35, '卡塔尔': 32, '科威特': 40, '阿曼': 35,
    '以色列': 72, '约旦': 48, '秘鲁': 60, '巴西': 58, '阿根廷': 50, '智利': 42,
    '哥伦比亚': 65, '墨西哥': 68, '玻利维亚': 58, '巴布亚新几内亚': 70,
    '所罗门群岛': 60, '斐济': 40, '塞尔维亚': 42, '希腊': 35, '匈牙利': 32,
    '波兰': 35, '德国': 30, '法国': 35, '英国': 32, '意大利': 32, '西班牙': 30,
    '荷兰': 28, '美国': 45, '加拿大': 28, '澳大利亚': 35, '新西兰': 25,
    '日本': 32, '韩国': 32, '南非': 68, '摩洛哥': 45, '塞内加尔': 50, '加纳': 50,
    '科特迪瓦': 58, '吉布提': 55, '厄立特里亚': 70, '乌干达': 58, '卢旺达': 45
  };
  var COUNTRY_RISK_DEFAULT = 45;

  /* 英文/常用别名 → 中文国名（开放网络与社交媒体多为英文，必须能落到国别） */
  var COUNTRY_ALIAS = {
    /* 我方本国名（用于国别归一，出现即表明事发地在境内，由相关性闸门另行判定） */
    'China': '中国', 'PRC': '中国', "People's Republic of China": '中国',
    'Hong Kong': '中国香港', 'Macao': '中国澳门', 'Macau': '中国澳门', 'Taiwan': '中国台湾',
    'Afghanistan': '阿富汗', 'Syria': '叙利亚', 'Yemen': '也门', 'Somalia': '索马里',
    'South Sudan': '南苏丹', 'Libya': '利比亚', 'Sudan': '苏丹', 'Mali': '马里',
    'Haiti': '海地', 'Myanmar': '缅甸', 'Burma': '缅甸', 'Niger': '尼日尔',
    'Burkina Faso': '布基纳法索', 'DR Congo': '刚果（金）', 'DRC': '刚果（金）',
    'Democratic Republic of the Congo': '刚果（金）', 'Congo': '刚果（金）',
    'Central African Republic': '中非', 'Pakistan': '巴基斯坦', 'Iraq': '伊拉克',
    'Nigeria': '尼日利亚', 'Mozambique': '莫桑比克', 'Cameroon': '喀麦隆',
    'Ethiopia': '埃塞俄比亚', 'Ukraine': '乌克兰', 'Palestine': '巴勒斯坦', 'Gaza': '巴勒斯坦',
    'Lebanon': '黎巴嫩', 'Iran': '伊朗', 'Venezuela': '委内瑞拉', 'Honduras': '洪都拉斯',
    'Ecuador': '厄瓜多尔', 'Kenya': '肯尼亚', 'Tanzania': '坦桑尼亚', 'Zambia': '赞比亚',
    'Guinea': '几内亚', 'Chad': '乍得', 'Zimbabwe': '津巴布韦', 'Angola': '安哥拉',
    'Egypt': '埃及', 'Algeria': '阿尔及利亚', 'Tunisia': '突尼斯', 'Bangladesh': '孟加拉国',
    'Sri Lanka': '斯里兰卡', 'Nepal': '尼泊尔', 'India': '印度', 'Philippines': '菲律宾',
    'Indonesia': '印度尼西亚', 'Cambodia': '柬埔寨', 'Laos': '老挝', 'Vietnam': '越南',
    'Thailand': '泰国', 'Malaysia': '马来西亚', 'Kazakhstan': '哈萨克斯坦',
    'Kyrgyzstan': '吉尔吉斯斯坦', 'Tajikistan': '塔吉克斯坦', 'Uzbekistan': '乌兹别克斯坦',
    'Turkmenistan': '土库曼斯坦', 'Mongolia': '蒙古国', 'Russia': '俄罗斯',
    'Belarus': '白俄罗斯', 'Turkey': '土耳其', 'Türkiye': '土耳其',
    'Saudi Arabia': '沙特阿拉伯', 'Saudi': '沙特阿拉伯', 'UAE': '阿联酋',
    'United Arab Emirates': '阿联酋', 'Qatar': '卡塔尔', 'Kuwait': '科威特',
    'Oman': '阿曼', 'Israel': '以色列', 'Jordan': '约旦', 'Peru': '秘鲁',
    'Brazil': '巴西', 'Argentina': '阿根廷', 'Chile': '智利', 'Colombia': '哥伦比亚',
    'Mexico': '墨西哥', 'Bolivia': '玻利维亚', 'Papua New Guinea': '巴布亚新几内亚',
    'Solomon Islands': '所罗门群岛', 'Fiji': '斐济', 'Serbia': '塞尔维亚',
    'Greece': '希腊', 'Hungary': '匈牙利', 'Poland': '波兰', 'Germany': '德国',
    'France': '法国', 'United Kingdom': '英国', 'Britain': '英国', 'UK': '英国',
    'Italy': '意大利', 'Spain': '西班牙', 'Netherlands': '荷兰',
    'United States': '美国', 'US': '美国', 'U.S.': '美国', 'USA': '美国',
    'Washington': '美国', 'Canada': '加拿大', 'Australia': '澳大利亚',
    'New Zealand': '新西兰', 'Japan': '日本', 'South Korea': '韩国', 'Korea': '韩国',
    'South Africa': '南非', 'Morocco': '摩洛哥', 'Senegal': '塞内加尔', 'Ghana': '加纳',
    "Côte d'Ivoire": '科特迪瓦', 'Ivory Coast': '科特迪瓦', 'Djibouti': '吉布提',
    'Eritrea': '厄立特里亚', 'Uganda': '乌干达', 'Rwanda': '卢旺达',
    'Croatia': '克罗地亚', 'Bulgaria': '保加利亚', 'Romania': '罗马尼亚'
  };

  /* 来源可信度（规则参数） */
  var SOURCE_CREDIBILITY = [
    { id: 'R-S01', name: '官方与权威机构', delta: 8, re: /外交部|领事|使馆|商务部|应急管理|联合国|UN |OCHA|ReliefWeb|WHO|IMF|World Bank|government|ministry|official/i },
    { id: 'R-S02', name: '国际主流通讯社', delta: 6, re: /Reuters|路透|AP |Associated Press|AFP|法新|BBC|新华|Xinhua|Bloomberg|彭博|Al ?Jazeera|半岛/i },
    { id: 'R-S03', name: '开放网络检索', delta: 0, re: /开放网络检索|GDELT|open ?web/i },
    { id: 'R-S04', name: '社交媒体（需核实）', delta: -8, re: /社交媒体|Telegram|Hacker News|Twitter|X平台|Mastodon|Reddit|Lemmy|联邦社交|VK|Bluesky|social ?media/i }
  ];

  /* ============================================================
   * 七、内部工具
   * ============================================================ */
  function _s(v) { return v == null ? '' : String(v); }
  function _esc(s) { return _s(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  /* 英文短词用整词匹配，避免 "MCC" 命中 "accommodation" 之类误伤 */
  function _hit(text, kw) {
    if (!kw) return false;
    if (/^[\x20-\x7e]+$/.test(kw)) {
      var re = new RegExp('(?:^|[^A-Za-z0-9])' + _esc(kw) + '(?:$|[^A-Za-z0-9])', 'i');
      return re.test(text);
    }
    /* 中文：短词（≤2字）必须边界隔离，避免人名/地名片段误命中（如"阿西夫·阿里·扎尔达里"含"阿里"）。
     * 边界=空白/标点/开头/结尾，不能是英文/数字/点号等任意非中文字符。 */
    if (kw.length <= 2) {
      var re = new RegExp('(?:^|[\\s\\b\\(\\[\\{\"\'\\，。！？；：、\\/\\|\\-—])' + _esc(kw) + '(?:$|[\\s\\b\\)\\]\\}\"\'\\，。！？；：、\\/\\|\\-—])');
      return re.test(text);
    }
    return text.indexOf(kw) >= 0;
  }

  /* 由 PROJECTS 反查国家（当条目未标注国别时补全） */
  function _countryOfProjects(projs) {
    for (var i = 0; i < projs.length; i++) { if (projs[i].country) return projs[i].country; }
    return '';
  }

  /* ============================================================
   * 八、识别引擎：从任意文本中提取「企业 / 项目 / 国家 / 资产」
   * ============================================================ */
  function identify(text, hintCountry) {
    var t = _s(text);
    var res = { enterprises: [], projects: [], countries: [], assets: [], corridors: [] };
    if (!t) return res;

    var i, j, e, p;
    /* 企业主体 */
    for (i = 0; i < ENTERPRISES.length; i++) {
      e = ENTERPRISES[i];
      var names = [e.name].concat(e.alias || []);
      for (j = 0; j < names.length; j++) {
        if (_hit(t, names[j])) {
          res.enterprises.push({ id: e.id, name: e.name, type: e.type, sector: e.sector, matched: names[j] });
          break;
        }
      }
    }
    /* 重大项目 */
    for (i = 0; i < PROJECTS.length; i++) {
      p = PROJECTS[i];
      var pn = [p.name, p.en].concat(p.alias || []);
      for (j = 0; j < pn.length; j++) {
        if (pn[j] && _hit(t, pn[j])) {
          res.projects.push({ id: p.id, name: p.name, country: p.country, tier: p.tier, matched: pn[j] });
          if (p.country && res.countries.indexOf(p.country) < 0) res.countries.push(p.country);
          break;
        }
      }
    }
    /* 国别（中文名直匹配 + 英文/别名整词匹配，保证外文情报也能落到国别） */
    for (var c in COUNTRY_RISK) {
      if (!Object.prototype.hasOwnProperty.call(COUNTRY_RISK, c)) continue;
      if (t.indexOf(c) >= 0 && res.countries.indexOf(c) < 0) res.countries.push(c);
    }
    for (var en in COUNTRY_ALIAS) {
      if (!Object.prototype.hasOwnProperty.call(COUNTRY_ALIAS, en)) continue;
      var cn = COUNTRY_ALIAS[en];
      if (res.countries.indexOf(cn) >= 0) continue;
      if (_hit(t, en)) res.countries.push(cn);
    }
    if (hintCountry && res.countries.indexOf(hintCountry) < 0) res.countries.unshift(hintCountry);
    /* 资产类型 */
    for (i = 0; i < ASSET_TYPES.length; i++) {
      if (ASSET_TYPES[i].re.test(t)) {
        res.assets.push({ id: ASSET_TYPES[i].id, name: ASSET_TYPES[i].name, weight: ASSET_TYPES[i].weight });
      }
    }
    /* 经济走廊（按命中国家反查） */
    for (i = 0; i < CORRIDORS.length; i++) {
      for (j = 0; j < res.countries.length; j++) {
        if (CORRIDORS[i].countries.indexOf(res.countries[j]) >= 0) {
          if (res.corridors.indexOf(CORRIDORS[i].name) < 0) res.corridors.push(CORRIDORS[i].name);
          break;
        }
      }
    }
    return res;
  }

  /* ============================================================
   * 九、预警规则引擎：多因子风险评分 → 四级预警（规则可审计）
   * 因子：威胁类型 × 资产权重 + 主体命中 + 项目层级 + 国别基线
   *      + 时效衰减 + 来源可信度 + 涉华负面
   * ============================================================ */
  function assessRisk(input) {
    input = input || {};
    var text = _s(input.title) + ' ' + _s(input.content) + ' ' + _s(input.summary);
    var ent = input.entities || identify(text, input.country);
    var hits = [], score = 0, i;

    /* 1) 威胁类型（取命中的最高两项，避免堆叠虚高） */
    var threatScores = [];
    for (i = 0; i < THREAT_RULES.length; i++) {
      if (THREAT_RULES[i].re.test(text)) {
        threatScores.push({ id: THREAT_RULES[i].id, name: THREAT_RULES[i].name, s: THREAT_RULES[i].score });
      }
    }
    threatScores.sort(function (a, b) { return b.s - a.s; });
    if (threatScores[0]) { score += threatScores[0].s; hits.push({ rule: threatScores[0].id, name: threatScores[0].name, add: threatScores[0].s }); }
    if (threatScores[1]) { var s2 = Math.round(threatScores[1].s * 0.35); score += s2; hits.push({ rule: threatScores[1].id, name: threatScores[1].name + '（叠加）', add: s2 }); }

    /* 2) 资产权重加成（人员类最高） */
    var aw = 0;
    for (i = 0; i < ent.assets.length; i++) aw = Math.max(aw, ent.assets[i].weight);
    if (aw > 0) {
      var addA = Math.round(aw * 14);
      score += addA;
      hits.push({ rule: 'R-A01', name: '涉我海外利益资产（' + ent.assets.map(function (x) { return x.name; }).slice(0, 3).join('、') + '）', add: addA });
    }

    /* 3) 中资主体直接命中 */
    if (ent.enterprises.length) {
      var addE = Math.min(18, 10 + ent.enterprises.length * 4);
      score += addE;
      hits.push({ rule: 'R-E01', name: '命中中资经营主体：' + ent.enterprises.map(function (x) { return x.name; }).slice(0, 3).join('、'), add: addE });
    }
    /* 4) 重大项目命中（按层级） */
    if (ent.projects.length) {
      var topTier = 3;
      for (i = 0; i < ent.projects.length; i++) topTier = Math.min(topTier, ent.projects[i].tier || 3);
      var addP = topTier === 1 ? 22 : (topTier === 2 ? 15 : 9);
      score += addP;
      hits.push({ rule: 'R-P0' + topTier, name: '命中海外' + (topTier === 1 ? '旗舰' : topTier === 2 ? '重点' : '一般') + '项目：' + ent.projects.map(function (x) { return x.name; }).slice(0, 3).join('、'), add: addP });
    }

    /* 5) 国别安全基线 */
    var cty = (ent.countries && ent.countries[0]) || input.country || '';
    if (cty) {
      var base = COUNTRY_RISK[cty] != null ? COUNTRY_RISK[cty] : COUNTRY_RISK_DEFAULT;
      var addC = Math.round(base * 0.18);
      score += addC;
      hits.push({ rule: 'R-C01', name: '国别安全基线（' + cty + '：' + base + '）', add: addC });
    }

    /* 6) 时效衰减 */
    var ts = input.publishedAt || input.published_at || input.time || input.timestamp;
    if (ts) {
      var d = (typeof ts === 'number') ? ts : Date.parse(ts);
      if (!isNaN(d)) {
        var hrs = (Date.now() - d) / 3600000;
        var addT = hrs <= 24 ? 10 : hrs <= 72 ? 6 : hrs <= 168 ? 3 : 0;
        if (addT) { score += addT; hits.push({ rule: 'R-D01', name: '时效性（' + (hrs <= 24 ? '24小时内' : hrs <= 72 ? '3日内' : '7日内') + '）', add: addT }); }
      }
    }

    /* 7) 来源可信度 */
    var srcTxt = _s(input.source) + ' ' + _s(input.platform);
    for (i = 0; i < SOURCE_CREDIBILITY.length; i++) {
      if (SOURCE_CREDIBILITY[i].re.test(srcTxt)) {
        score += SOURCE_CREDIBILITY[i].delta;
        if (SOURCE_CREDIBILITY[i].delta !== 0) hits.push({ rule: SOURCE_CREDIBILITY[i].id, name: '来源：' + SOURCE_CREDIBILITY[i].name, add: SOURCE_CREDIBILITY[i].delta });
        break;
      }
    }

    /* 8) 涉华负面信号 */
    if (input.chinaNegative === true) { score += 8; hits.push({ rule: 'R-N01', name: '涉华负面信号', add: 8 }); }

    /* 9) 无威胁约束：未命中任何威胁类型规则的，属"关联情报"而非"安全预警"，
     *    分值封顶 25 并降为蓝色，避免中性/正面报道被误判为黄色以上预警。 */
    var threatless = threatScores.length === 0;
    if (threatless && score > 25) {
      hits.push({ rule: 'R-X01', name: '未命中威胁类型，判定为关联情报（非预警）', add: 25 - score });
      score = 25;
    }
    /* 10) 弱关联约束：既无中资主体、也无项目、也无海外利益资产命中的，
     *     即便威胁等级高也不属我海外利益安全预警，最高降至蓝色。 */
    if (!ent.enterprises.length && !ent.projects.length && !ent.assets.length && score > 29) {
      hits.push({ rule: 'R-X02', name: '未命中我方主体/项目/资产，关联度不足降级', add: 29 - score });
      score = 29;
    }
    /* 11) 红色预警硬约束：必须直接命中中资主体/项目/高权重资产（人员/机构/工程/能源/矿业），
     *     仅有涉华负面或一般资产不足以触发最高等级。 */
    var hasHardTarget = ent.enterprises.length || ent.projects.length || ent.assets.some(function(a){ return (a.weight||0) >= 0.9; });
    if (score >= 80 && !hasHardTarget) {
      hits.push({ rule: 'R-X03', name: '无中资主体/项目/核心资产命中，红色预警降级', add: 79 - score });
      score = 79;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    var level = score >= 80 ? '红色' : score >= 60 ? '橙色' : score >= 40 ? '黄色' : '蓝色';
    var levelCode = score >= 80 ? 1 : score >= 60 ? 2 : score >= 40 ? 3 : 4;
    var severity = score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 40 ? 'medium' : 'low';

    return {
      riskScore: score, alertLevel: level, alertLevelCode: levelCode, severity: severity,
      ruleHits: hits, entities: ent,
      relevanceCountry: cty,
      rationale: hits.map(function (h) { return h.name + '(' + (h.add > 0 ? '+' : '') + h.add + ')'; }).join('；')
    };
  }

  /* ============================================================
   * 九·五、体裁闸门 isCommentaryPiece —— 剔除评论/学术/意识形态论述
   * ------------------------------------------------------------
   * 背景（2026-08-04 用户指出）：Lemmy 政治评论社区（c/Pravda News! 等）的
   * 意识形态文章混入情报流，如「中国社会主义道路上的坎坷我们该不该讨论？」
   *「《中国工人阶级的形成（1840-1989）》」「丝绸之路制造业：全球化的另一条道路」。
   * 这些文章正文密集提及中国 + 命中资产类型词，从而通过 softLink，但它们是
   * 观点论述而非安全事件，对海外利益保护无研判价值。
   *
   * 判定原则：体裁信号命中 且 无具体安全事件信号 → 判为评论体裁，不予入库。
   * 之所以要求"无安全事件信号"，是为了避免误杀「中国公民在X国遇袭，谁之责？」
   * 这类带疑问句式/评论标记但确有实质安全事件的真情报。
   * ============================================================ */
  /* 强体裁信号：纯论述/学术体裁标记，几乎不可能是安全事件报道 → 直接拦截。
   * 不受正文影响：这类长文常在历史叙述中出现"罢工/封锁"等词（如工人运动史、
   * 技术封锁论述），若让正文安全词放行会导致漏放（实测踩坑）。 */
  var _COMMENTARY_STRONG_RE = new RegExp([
    'notes on the|an alternative path|a critical (?:review|reflection)|reflections on|a history of|towards a theory',
    '社会主义道路|工人阶级的形成|帝国主义和殖民主义|殖民主义事业|革命的错误',
    '的另一条道路|之我见|刍议|浅析|试论|论纲|再思考|历史考察'
  ].join('|'), 'i');
  /* 弱体裁信号：评论前缀/疑问句式——真实事件的评论文章也会命中，
   * 故需附加「无具体安全事件信号」才判为噪声，避免误杀
   *（如「[Opinion] Why China must evacuate nationals from Sudan」是有价值的撤侨情报）。 */
  var _COMMENTARY_WEAK_RE = new RegExp([
    '^\\s*[\\[【(（]\\s*(opinion|comment|editorial|analysis|review|essay|点评|评论|社论|书评|时评|观点)',
    '^should we\\b|^why (?:we|the|china|america)\\b|^what (?:if|does|is)\\b|^how (?:should|do|can) we\\b',
    '我们该不该|我们是否应该|该不该讨论|如何看待|意味着什么\\s*[？?]\\s*$|的真相\\s*$'
  ].join('|'), 'i');
  /* 具体安全事件信号：出现任一即认定为实质情报，弱体裁信号放行 */
  var _SECURITY_EVENT_RE = new RegExp([
    '袭击|遇袭|爆炸|枪击|绑架|劫持|扣押|人质|遇害|死亡|伤亡|受伤|失踪',
    '撤侨|撤离|疏散|宵禁|骚乱|暴乱|示威冲突|武装冲突|交火|空袭|导弹',
    '制裁|罚款|起诉|查封|冻结资产|拘留|逮捕|驱逐|吊销|禁令|反倾销',
    '停工|停产|违约|毁约|征收|国有化|撤资|断供|港口关闭',
    '海盗|走私|诈骗|勒索|网络攻击|数据泄露|间谍',
    'attack|bomb|shoot|kidnap|hostage|casualt|evacuat|sanction|arrest|detain|seiz|riot|clash'
  ].join('|'), 'i');
  function isCommentaryPiece(item) {
    if (!item) return false;
    var titleZh = _s(item.title);
    var head = _s(item.title_en || item.title) + ' ' + titleZh;
    var body = _s(item.content || item.summary || item.description);
    /* 1) 强体裁信号 → 直接拦截 */
    if (_COMMENTARY_STRONG_RE.test(head)) return true;
    /* 2) 书目/论文式标题：《…》且含年代区间，如《中国工人阶级的形成（1840-1989）》 */
    if (/[《»].{2,40}[》«]/.test(titleZh) && /1[6-9]\d{2}\s*[-–—]\s*(1[6-9]|20)\d{2}/.test(head)) return true;
    /* 3) 弱信号与意识形态密度 → 需无具体安全事件信号 */
    var hasEvent = _SECURITY_EVENT_RE.test(head) || _SECURITY_EVENT_RE.test(body.slice(0, 400));
    if (hasEvent) return false;
    if (_COMMENTARY_WEAK_RE.test(head)) return true;
    var ideo = (body.match(/革命|社会主义|资本主义|帝国主义|殖民主义|无产阶级|人民民主|意识形态|马克思|列宁|阶级斗争/g) || []).length;
    if (ideo >= 3) return true;
    return false;
  }

  /* ============================================================
   * 九·六、体裁闸门 isRankingPiece —— 剔除商业榜单/排行/经济统计资讯
   * ------------------------------------------------------------
   * 背景（2026-08-04 用户指出）：以下两类混入实时情报流：
   *   ①「中国企业联合会发布"2025中国企业500强"榜单，入围门槛达479.6亿元」
   *   ②「《财富》世界500强营收总和41.7万亿美元，沃尔玛连续12年居首，
   *      中国国家电网位列第三，中国石油第五」
   * 它们是经济统计资讯，不含任何海外利益安全事件，无研判价值。
   *
   * 【混入机制 —— 比评论体裁更危险】
   * 这类榜单文必然罗列中资巨头（中国石油/国家电网/中国建筑…），直接命中
   * ent.enterprises → hardLink=true。而 hardLink 在 enrich 中是"直接通过"，
   * 连 softLink 的风险分≥35 门槛都不需要过，等于一路绿灯。
   * 因此本闸门必须与 commentary 同级一票否决，压过 hardLink。
   *
   * 【防误杀】命中榜单词但标题/首句含实质安全事件 → 放行，例如
   *  「某500强中企在尼日利亚工地遭袭」「中国石油因美方制裁跌出榜单」。
   * ============================================================ */
  /* 榜单核心标识：出现即为"排行/榜单"话语场 */
  var _RANK_CORE_RE = new RegExp([
    /* 注意：不能写成 '\\d{2,4}\\s*强\\b' —— JS 的 \b 基于 ASCII 词字符判定，
       "500强出炉" 中"强"与"出"都是非词字符，两者之间不存在词边界，该分支永远
       不匹配，导致「2025中国企业500强出炉 入围门槛479.6亿元」长期漏网(2026-08-05 实测)。 */
    '(?:世界|全球|中国|亚洲|欧洲|美国|财富|福布斯|胡润)?\\s*\\d{2,4}\\s*强(?![a-zA-Z])',
    '排行榜|排名榜|榜单|富豪榜|品牌榜|财富榜|榜首|百强|十强|龙虎榜',
    'fortune\\s*(?:global\\s*)?500|forbes|global\\s*2000|league table',
    'top\\s*\\d+\\s*(?:compan|firm|bank|brand|list)|\\brankings?\\b'
  ].join('|'), 'i');
  /* 统计/排名特征：榜单报道特有的量化叙述 */
  var _RANK_STAT_RE = new RegExp([
    '入围门槛|上榜门槛|入围标准|上榜(?:企业|公司|门槛|名单|数量)|入围企业',
    '位列第|排名第|名列第|蝉联|连续第\\s*[\\d一二三四五六七八九十]+\\s*(?:年|次|届)',
    '营业收入总和|营收总和|净利润总和|收入总和|资产总额|净资产总额|利润总和',
    '总和(?:约)?(?:为|达)|门槛(?:提高|降低|从|达到)|同比增长约',
    'threshold|combined revenue|total revenue|aggregate revenue',
    'net profits? (?:of|total)|consecutive year|largest compan'
  ].join('|'), 'i');
  function isRankingPiece(item) {
    if (!item) return false;
    var head = _s(item.title_en || item.title) + ' ' + _s(item.title);
    var body = _s(item.content || item.summary || item.description);
    var full = head + ' ' + body;
    if (!_RANK_CORE_RE.test(full)) return false;
    /* 标题/首句含实质安全事件 → 是真情报，放行（防误杀"500强中企遭袭/被制裁"） */
    if (_SECURITY_EVENT_RE.test(head) || _SECURITY_EVENT_RE.test(body.slice(0, 200))) return false;
    /* 标题即榜单，且全文无任何安全事件信号 → 纯榜单报道 */
    if (_RANK_CORE_RE.test(head) && !_SECURITY_EVENT_RE.test(full)) return true;
    /* 否则要求统计特征共现，避免"某文顺带提到排名"被误伤 */
    return _RANK_STAT_RE.test(full);
  }

  /* 体裁总闸门：返回噪声体裁标识，无则返回 ''（供入库与存量清洗统一调用） */
  function nonIntelGenre(item) {
    if (!item) return '';
    if (isCommentaryPiece(item)) return 'commentary-piece';
    if (isRankingPiece(item)) return 'ranking-list';
    return '';
  }

  /* ============================================================
   * 十、enrich：全平台统一入口 —— 任何情报入库前必须调用
   * 为条目挂载关联与预警字段，实现"全数据关联、消除割裂"
   * ============================================================ */
  function enrich(item) {
    if (!item || typeof item !== 'object') return item;
    var text = _s(item.title) + ' ' + _s(item.content || item.summary || item.description);
    var ent = identify(text, item.country);
    var r = assessRisk({
      title: item.title, content: item.content || item.summary || item.description,
      country: item.country, source: item.source, platform: item.platform,
      publishedAt: item.publishedAt || item.published_at || item.time || item.timestamp,
      chinaNegative: item.chinaNegative, entities: ent
    });

    item.entities = ent;
    item.rel_enterprises = ent.enterprises.map(function (x) { return x.name; });
    item.rel_enterprise_ids = ent.enterprises.map(function (x) { return x.id; });
    item.rel_projects = ent.projects.map(function (x) { return x.name; });
    item.rel_project_ids = ent.projects.map(function (x) { return x.id; });
    item.rel_assets = ent.assets.map(function (x) { return x.name; });
    item.rel_corridors = ent.corridors;
    item.country = normalizeCountry(item.country || r.relevanceCountry || '');
    item.riskScore = r.riskScore;
    item.alertLevel = r.alertLevel;
    item.alertLevelCode = r.alertLevelCode;
    item.ruleHits = r.ruleHits;
    item.riskRationale = r.rationale;
    /* 与既有 severity 字段对齐：仅在缺失或明显低估时提升，不覆盖人工判定 */
    if (!item.severity || item._autoSeverity) { item.severity = r.severity; item._autoSeverity = true; }
    /* 关联度判定（收严 · v2）：
     * 资产类型（矿山/港口/工程/使馆/民航…）本身不含"中国"属性——外国矿企财报、外国港口新闻、
     * 外交礼仪接待、宇航员返航等同样会命中资产正则，若仅凭"命中资产 + 提到中国"即判定关联，
     * 会把大量无关外讯（风险分<35的蓝色低危信息）错误纳入预警链路。
     * 
     * 判定标准：
     *   hardLink = 命中中资企业主体 或 命中我方海外重大项目 → 强关联（直接通过）
     *   softLink = 命中资产类型 + 涉华信号 + （风险分≥35 或 涉华负面 或 资产权重≥0.9）
     *             → 弱关联（需附加安全价值信号方可通过） */
    var _t = String((item.title || '') + ' ' + (item.content || ''));
    var chinaSignal = /中国|中方|中资|中企|华人|华侨|侨胞|使馆|领事|一带一路|中欧班列|撤侨|国企|央企|Chin(?:a|ese)|Sino-|PRC|Belt and Road|CPEC/i.test(_t);
    /* CPEC/俾路支热点（2026-08-18 用户指令）：BLA/TTP/BLF 在俾路支省及中巴经济走廊沿线
     * 以中资项目/矿业/工程/营地为主要袭击目标。该语境下 矿业/项目/公司/营地 + 武装绑架/袭击
     * 即视为高度涉我海外利益，即便一手英文报道未点名"Chinese"
     * （如 2026-08-12 沙盖 Chagai 铜矿7名矿工被 BLA 绑架，Dawn 仅称 "private copper mining company"，
     *   无中国词 → 原闸门判 indirect-no-china-link 丢弃、enrich 判 interestLinked=false，双重漏报）。
     * 判为 hardLink（强关联），使其进入预警中心而非滞留数据中心。
     * 注意：袭击词仅限武装/绑架/伏击等激进语境，剔除"瓦斯爆炸/矿难事故"类纯安全事故，避免误纳巴国内矿难。 */
    var cpecHotspot = /俾路支|balochistan|chagai|沙盖|瓜达尔|gwadar|quetta|奎达|中巴经济走廊|CPEC|开伯尔|khyber|gilgit|吉尔吉特|waziristan|瓦济里斯坦/i.test(_t)
      && /矿|mine|mining|copper|gold|coal|project|company|firm|construction|engineer|worker|camp|port|power plant|dam|refinery|工程|项目|公司|企业|铜|金|煤|工人|工程师|营地|港口|电站/i.test(_t)
      && /绑架|劫持|袭击|武装袭击|武装分子|恐怖分子?|枪击|伏击|人质|枪手|自杀式|abduct\w*|kidnap\w*|attack\w*|gunmen|gunman|armed (?:men|attackers?|assailants?|militants?)|militant\w*|insurgent\w*|terror\w*|ambush|hostage|suicide (?:bomb|attack|blast)|IED/i.test(_t);
    var hardLink = !!(ent.enterprises.length || ent.projects.length) || cpecHotspot;
    var maxAssetWeight = ent.assets.reduce(function(m, a) { return Math.max(m, a.weight || 0); }, 0);
    /* softLink 附加条件：风险分≥35（黄色以上有安全价值） 或 涉华负面（明确威胁信号）
     * 或 高权重资产（≥0.95，能源/矿业/工程等核心资产）且风险分≥30（至少具备可研判价值）
     * 排除项：外交礼仪接待（权重1.0但风险分通常<30）、宇航员返航等低危蓝色信息 */
    var softLink = !!(ent.assets.length && chinaSignal && (
      r.riskScore >= 35 || item.chinaNegative || (maxAssetWeight >= 0.95 && r.riskScore >= 30)
    ));
    /* 体裁闸门（v4 · 2026-08-04）：一票否决，压过 hardLink。
     *   commentary —— 评论/学术/意识形态论述，从 softLink 混入；
     *   ranking    —— 商业榜单/经济统计（500强榜单等），因罗列中资巨头命中
     *                 ent.enterprises 触发 hardLink 而"一路绿灯"，危害更大。
     * 二者均无安全研判价值，必须在 interestLinked 上一票否决。 */
    var genre = nonIntelGenre(item);
    var commentary = (genre === 'commentary-piece');
    item._commentary = commentary;
    item._ranking = (genre === 'ranking-list');
    item._genreNoise = !!genre;
    /* 铁律(2026-08-18 用户)：凡采集到的数据全部进预警中心/预警队列，不再以 interestLinked 分量拦截。
     * 仅体裁噪声(评论/榜单, genre)一票否决，其余一律视为已关联、进预警中心。 */
    item.interestLinked = !genre;
    if (genre) item.filterReason = genre;
    item._cpecHotspot = cpecHotspot; /* 审计：标记 CPEC/俾路支热点命中，便于在数据中心核查来源 */
    /* 海外安全态势（2026-08-18 用户指令）：外国安全/恐怖/犯罪事件，即便与中国无直接关联，
     * 凡 ① 涉恐怖/极端武装/犯罪组织/黑帮 或 ② 发生在中国海外利益集中国家（重点国），
     * 均纳入预警评估（interestLinked=true）——服务端 _srvAlertScore 会按 重点国/恐怖组织/伤亡
     * 自动分级：显著的进预警中心，一般的留数据中心，避免低价值治安噪声灌预警中心。
     * 标记 _globalSecurity 以便审计区分（全球安全态势，非涉华关联）。体裁噪声仍一票否决。 */
    var _secEv = /恐怖袭击|爆炸|枪击|绑架|劫持|袭击|冲突|伏击|自杀式|汽车炸弹|武装|杀死|杀害|死亡|遇难|身亡|伤亡|政变|海盗|屠杀|terror|attack|blast|bomb|explos|shoot|shot|gunmen|gunman|gunfire|kill|dead|death|hostage|kidnap|abduct|clash|ambush|armed|suicide|car bomb|IED|coup|piracy|massacre|casualt|wound/i.test(_t);
    var _terrOrg = /恐怖组织|恐怖分子|恐怖主义|极端组织|极端分子|武装组织|武装分子|犯罪组织|有组织犯罪|黑帮|黑手党|贩毒集团|恐怖|伊斯兰国|基地组织|塔利班|博科圣地|青年党|胡塞|真主党|哈马斯|俾路支|叛乱|反叛军|叛军|雇佣兵|terror|militant|insurgent|jihad|extremist|ISIS|ISIL|Islamic State|al[- ]?Qaeda|Taliban|Boko Haram|Al[- ]?Shabaab|Shabaab|Houthi|Hezbollah|Hamas|ISWAP|cartel|mafia|gang|crime syndicate|armed group|rebel|mercenar/i.test(_t);
    var _focusC = /俾路支|瓜达尔|巴基斯坦|哈萨克|乌兹别克|吉尔吉斯|塔吉克|土库曼|老挝|柬埔寨|缅甸|印度尼西亚|印尼|马来西亚|泰国|越南|塞尔维亚|匈牙利|希腊|埃塞俄比亚|肯尼亚|吉布提|埃及|斯里兰卡|孟加拉国|尼泊尔|沙特|阿联酋|土耳其|白俄罗斯|波兰|苏丹|刚果|尼日利亚|伊拉克|也门|马里|尼日尔|索马里|阿富汗|叙利亚|利比亚|中非|莫桑比克|坦桑尼亚|赞比亚|津巴布韦|安哥拉|摩洛哥|突尼斯|阿尔及利亚|约旦|黎巴嫩|伊朗|印度|菲律宾|哥伦比亚|秘鲁|墨西哥|南非|阿根廷|智利|委内瑞拉|蒙古|喀麦隆|乍得|南苏丹|Balochistan|Gwadar|Pakistan|Kazakhstan|Uzbekistan|Kyrgyzstan|Tajikistan|Turkmenistan|Laos|Cambodia|Myanmar|Indonesia|Malaysia|Thailand|Vietnam|Serbia|Hungary|Greece|Ethiopia|Kenya|Djibouti|Egypt|Sri Lanka|Bangladesh|Nepal|Saudi|UAE|Emirates|Turkey|Belarus|Poland|Sudan|Congo|DRC|Nigeria|Iraq|Yemen|Mali|Niger|Somalia|Afghanistan|Syria|Libya|Central African|Mozambique|Tanzania|Zambia|Zimbabwe|Angola|Morocco|Tunisia|Algeria|Jordan|Lebanon|Iran|India|Philippines|Colombia|Peru|Mexico|South Africa|Argentina|Chile|Venezuela|Mongolia|Cameroon|Chad|South Sudan/i.test(_t);
    if (!item.interestLinked && !genre && _secEv && (_terrOrg || _focusC)) {
      item.interestLinked = true; item._globalSecurity = true;
    }
    item.chinaSignal = chinaSignal;
    item.linkStrength = (ent.enterprises.length ? 2 : 0) + (ent.projects.length ? 2 : 0) +
                        (ent.assets.length ? (chinaSignal ? 1 : 0) : 0);
    return item;
  }

  /* 批量 */
  function enrichAll(list) {
    if (!list || !list.length) return list || [];
    for (var i = 0; i < list.length; i++) enrich(list[i]);
    return list;
  }

  /* 统计：按企业 / 项目 / 国家聚合，供态势感知与企业安全模块共用同一数据口径 */
  function aggregate(list) {
    var byEnt = {}, byProj = {}, byCountry = {}, byLevel = { '红色': 0, '橙色': 0, '黄色': 0, '蓝色': 0 };
    (list || []).forEach(function (it) {
      (it.rel_enterprises || []).forEach(function (n) { byEnt[n] = (byEnt[n] || 0) + 1; });
      (it.rel_projects || []).forEach(function (n) { byProj[n] = (byProj[n] || 0) + 1; });
      if (it.country) byCountry[it.country] = (byCountry[it.country] || 0) + 1;
      if (it.alertLevel && byLevel[it.alertLevel] != null) byLevel[it.alertLevel]++;
    });
    function top(o) {
      return Object.keys(o).map(function (k) { return { name: k, count: o[k] }; })
        .sort(function (a, b) { return b.count - a.count; });
    }
    return { enterprises: top(byEnt), projects: top(byProj), countries: top(byCountry), levels: byLevel, total: (list || []).length };
  }

  /* 国名归一化：英文/别名 → 中文国名（保证全平台国别口径一致，消除中英混杂割裂） */
  function normalizeCountry(name) {
    var n = _s(name).trim();
    if (!n) return '';
    if (COUNTRY_RISK[n] != null) return n;
    if (COUNTRY_ALIAS[n]) return COUNTRY_ALIAS[n];
    for (var k in COUNTRY_ALIAS) {
      if (!Object.prototype.hasOwnProperty.call(COUNTRY_ALIAS, k)) continue;
      if (k.toLowerCase() === n.toLowerCase()) return COUNTRY_ALIAS[k];
    }
    return n;
  }

  var ENTITY = {
    ENTERPRISES: ENTERPRISES, PROJECTS: PROJECTS, CORRIDORS: CORRIDORS,
    COUNTRY_ALIAS: COUNTRY_ALIAS, normalizeCountry: normalizeCountry,
    ASSET_TYPES: ASSET_TYPES, THREAT_RULES: THREAT_RULES,
    COUNTRY_RISK: COUNTRY_RISK, SOURCE_CREDIBILITY: SOURCE_CREDIBILITY,
    identify: identify, assessRisk: assessRisk, enrich: enrich, enrichAll: enrichAll, aggregate: aggregate,
    isCommentaryPiece: isCommentaryPiece,
    isRankingPiece: isRankingPiece,
    nonIntelGenre: nonIntelGenre,
    stats: function () {
      return { enterprises: ENTERPRISES.length, projects: PROJECTS.length, corridors: CORRIDORS.length, assetTypes: ASSET_TYPES.length, threatRules: THREAT_RULES.length, countries: Object.keys(COUNTRY_RISK).length };
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ENTITY;
  if (root) root.ENTITY = ENTITY;
})(typeof window !== 'undefined' ? window : null);
